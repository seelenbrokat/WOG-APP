import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import {
  zurichDayKey,
  zurichDayRange,
  zurichMonthKey,
  zurichMonthRange,
} from '../common/zurich-date';
import { parseTelematicsXml, ParsedTourStopStatus } from './telematics-xml.parser';
import {
  buildLuExportReport,
  luReportToMatrixCsv,
  luReportToOverviewCsv,
  luReportToPartnerCsv,
  writeLuOverviewPdf,
  writeLuPartnerPdf,
} from './loading-unit-export';

export type LoadingUnitExchangeNote = {
  status: 'EXCHANGED' | 'NOT_EXCHANGED' | 'MIXED' | 'UNKNOWN';
  headline: string;
  detail: string;
  lines: Array<{
    matchcode: string;
    label?: string | null;
    given: number;
    taken: number;
    owedQuantity?: number;
    status: string;
  }>;
};

/**
 * Fallback-Denylist, falls Stammdaten/CSV noch kein createBookings=false setzen.
 * Primär gilt PackagingType.createBookings (Soloplan „LM-Buchungen erzeugen“).
 */
export const NON_EXCHANGEABLE_MATCHCODES = [
  'EWP',
  'HP',
  'EINWEGPALE',
  'DIV',
  'GL',
  'CR',
] as const;

export function isExchangeBookableMatchcode(matchcode: string): boolean {
  return !NON_EXCHANGEABLE_MATCHCODES.includes(
    matchcode.trim().toUpperCase() as (typeof NON_EXCHANGEABLE_MATCHCODES)[number],
  );
}

@Injectable()
export class LoadingUnitService {
  private readonly logger = new Logger(LoadingUnitService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /**
   * Bucht LoadingUnitExchange aus TourStopStatus.
   * Nur aktive PackagingTypes mit createBookings=true (Soloplan „LM-Buchungen erzeugen = Ja“).
   */
  async bookTourStopStatus(
    organizationId: string,
    parsed: ParsedTourStopStatus,
    fileName?: string,
  ) {
    const sourceFile = fileName || `tourstopstatus-${parsed.tourNumber}-${parsed.tourStopId}`;
    const eventAt = parsed.statusDate || parsed.sendDate || new Date();

    let resolvedTour =
      (await this.prisma.tour.findFirst({
        where: { organizationId, tourNumber: parsed.tourNumber },
        orderBy: [{ updatedAt: 'desc' }],
        select: { id: true, tourNumber: true },
      })) || null;

    let stop = resolvedTour
      ? await this.prisma.tourStop.findFirst({
          where: { tourId: resolvedTour.id, soloplanTourStopId: parsed.tourStopId },
        })
      : null;

    if (!stop) {
      const stopWithTour = await this.prisma.tourStop.findFirst({
        where: {
          soloplanTourStopId: parsed.tourStopId,
          tour: { organizationId },
        },
        include: { tour: { select: { id: true, tourNumber: true } } },
        orderBy: { sequence: 'asc' },
      });
      if (stopWithTour) {
        const { tour: linkedTour, ...stopOnly } = stopWithTour;
        stop = stopOnly;
        if (!resolvedTour) resolvedTour = linkedTour;
      }
    }

    const partner = await this.resolvePartner(organizationId, stop, resolvedTour?.id);
    if (!partner.partnerName) {
      partner.partnerName = `Tour ${parsed.tourNumber} · Stop ${parsed.tourStopId}`;
    }

    let booked = 0;
    let skippedZero = 0;
    let skippedUnknown = 0;

    for (const ex of parsed.exchanges) {
      const matchcode = ex.matchcode.trim();
      if (!matchcode) continue;
      // Fallback-Denylist (EWP/HP/DIV/…) + Stammdaten createBookings
      if (!isExchangeBookableMatchcode(matchcode)) continue;

      const packaging = await this.resolvePackagingType(organizationId, matchcode);
      if (packaging && !packaging.createBookings) continue;
      const canonicalCode = packaging?.matchcode || matchcode;

      const existing = await this.prisma.loadingUnitPosting.findUnique({
        where: {
          organizationId_sourceFile_packagingMatchcode: {
            organizationId,
            sourceFile,
            packagingMatchcode: canonicalCode,
          },
        },
      });
      if (existing) continue;

      // Null-Tausch: nur für CSV-PackagingTypes erfassen (Übersicht „nicht getauscht“)
      if (ex.given === 0 && ex.taken === 0) {
        if (!packaging) {
          skippedUnknown += 1;
          continue;
        }
        const resolvedQty = await this.resolveOwedQuantity(organizationId, packaging.matchcode, {
          tourStopId: stop?.id,
          transportOrderNumber: stop?.transportOrderNumber,
          tourId: resolvedTour?.id,
        });
        // Bei Nicht-Tausch mindestens 1 Stück je gemeldetem Typ (sonst Anzahl fehlt)
        const owedQuantity = Math.max(1, resolvedQty);
        await this.prisma.loadingUnitPosting.create({
          data: {
            organizationId,
            packagingTypeId: packaging.id,
            packagingMatchcode: packaging.matchcode,
            packagingLabel: packaging.label,
            given: 0,
            taken: 0,
            balanceDelta: owedQuantity,
            owedQuantity,
            tourId: resolvedTour?.id,
            tourNumber: parsed.tourNumber,
            tourStopId: stop?.id,
            tourStopExternalId: parsed.tourStopId,
            partnerNumber: partner.partnerNumber,
            partnerName: partner.partnerName,
            partnerCity: partner.partnerCity,
            customerId: partner.customerId,
            vehicleSoloplanId: parsed.vehicleId,
            status: 'SKIPPED_ZERO',
            skipReason:
              resolvedQty > 0
                ? `Given=0 / Taken=0 – kein Tausch (${owedQuantity} Stück laut Sendung)`
                : `Given=0 / Taken=0 – kein Tausch (${owedQuantity} Stück)`,
            occurredAt: eventAt,
            sendDate: parsed.sendDate,
            sourceFile,
          },
        });
        skippedZero += 1;
        continue;
      }

      if (!packaging) {
        skippedUnknown += 1;
        this.logger.warn(
          `Lademittel übersprungen (nicht in PackagingType-CSV): ${matchcode} @ ${sourceFile}`,
        );
        const balanceDelta = ex.given - ex.taken;
        await this.prisma.loadingUnitPosting.create({
          data: {
            organizationId,
            packagingMatchcode: matchcode,
            given: ex.given,
            taken: ex.taken,
            balanceDelta,
            owedQuantity: Math.max(0, balanceDelta),
            tourId: resolvedTour?.id,
            tourNumber: parsed.tourNumber,
            tourStopId: stop?.id,
            tourStopExternalId: parsed.tourStopId,
            partnerNumber: partner.partnerNumber,
            partnerName: partner.partnerName,
            partnerCity: partner.partnerCity,
            customerId: partner.customerId,
            vehicleSoloplanId: parsed.vehicleId,
            status: 'SKIPPED_UNKNOWN_TYPE',
            skipReason: 'Matchcode nicht in aktiver PackagingType-CSV',
            occurredAt: eventAt,
            sendDate: parsed.sendDate,
            sourceFile,
          },
        });
        continue;
      }

      const balanceDelta = ex.given - ex.taken;
      await this.prisma.loadingUnitPosting.create({
        data: {
          organizationId,
          packagingTypeId: packaging.id,
          packagingMatchcode: packaging.matchcode,
          packagingLabel: packaging.label,
          given: ex.given,
          taken: ex.taken,
          balanceDelta,
          owedQuantity: Math.max(0, balanceDelta),
          tourId: resolvedTour?.id,
          tourNumber: parsed.tourNumber,
          tourStopId: stop?.id,
          tourStopExternalId: parsed.tourStopId,
          partnerNumber: partner.partnerNumber,
          partnerName: partner.partnerName,
          partnerCity: partner.partnerCity,
          customerId: partner.customerId,
          vehicleSoloplanId: parsed.vehicleId,
          status: 'BOOKED',
          occurredAt: eventAt,
          sendDate: parsed.sendDate,
          sourceFile,
        },
      });
      booked += 1;
    }

    await this.prisma.telematicsEvent.create({
      data: {
        organizationId,
        kind: 'TourStopStatus',
        tourId: resolvedTour?.id,
        tourNumber: parsed.tourNumber,
        status: parsed.status || 'LoadingUnitExchange',
        statusText:
          `LU booked=${booked} skipUnknown=${skippedUnknown} skipZero=${skippedZero}` +
          (partner.partnerName ? ` @ ${partner.partnerName}` : ''),
        latitude: parsed.location?.latitude,
        longitude: parsed.location?.longitude,
        eventAt,
        sendDate: parsed.sendDate,
        sourceFile,
      },
    });

    return { booked, skippedZero, skippedUnknown, partner };
  }

  private async resolvePackagingType(organizationId: string, matchcode: string) {
    const rows = await this.prisma.packagingType.findMany({
      where: {
        organizationId,
        active: true,
        matchcode: { equals: matchcode, mode: 'insensitive' },
      },
      orderBy: [{ soloplanNumber: 'asc' }],
    });
    return rows[0] || null;
  }

  /**
   * Bucht abgeschlossenen Lager-Lademittelschein in die Lademittelverwaltung
   * (Partner-Saldo / LoadingUnitPosting).
   * Mapping: übergibt (Out) → given, übernimmt (In) → taken.
   */
  async bookFromLademittelschein(schein: {
    id: string;
    number: string;
    organizationId: string;
    tourId?: string | null;
    tourNumber?: string | null;
    partnerNumber?: string | null;
    partnerName?: string | null;
    vehiclePlate?: string | null;
    occurredAt: Date;
    eupOut: number;
    rahmenOut: number;
    deckelOut: number;
    gitterboxOut: number;
    eupIn: number;
    rahmenIn: number;
    deckelIn: number;
    gitterboxIn: number;
    noExchangeNoStock?: boolean;
    noExchangeDriverRefuse?: boolean;
  }) {
    const sourceBase = `lademittelschein-${schein.number}`;
    const partnerName = (schein.partnerName || 'Partner').trim();
    const partnerNumber = schein.partnerNumber?.trim() || null;
    const lines: Array<{ aliases: string[]; preferred: string; given: number; taken: number }> = [
      { aliases: ['EUP'], preferred: 'EUP', given: schein.eupOut, taken: schein.eupIn },
      { aliases: ['RAH', 'ERAH', 'RAHMEN'], preferred: 'RAH', given: schein.rahmenOut, taken: schein.rahmenIn },
      {
        aliases: ['DECKEL', 'DKL', 'PALDECKEL'],
        preferred: 'DECKEL',
        given: schein.deckelOut,
        taken: schein.deckelIn,
      },
      {
        aliases: ['GIBO', 'GITTERBOX', 'GP'],
        preferred: 'GIBO',
        given: schein.gitterboxOut,
        taken: schein.gitterboxIn,
      },
    ];

    let booked = 0;
    let skipped = 0;

    for (const line of lines) {
      if (line.given <= 0 && line.taken <= 0) continue;
      let packaging: Awaited<ReturnType<typeof this.resolvePackagingType>> | null = null;
      for (const alias of line.aliases) {
        packaging = await this.resolvePackagingType(schein.organizationId, alias);
        if (packaging) break;
      }
      const matchcode = packaging?.matchcode || line.preferred;
      if (!isExchangeBookableMatchcode(matchcode) || (packaging && !packaging.createBookings)) {
        skipped += 1;
        continue;
      }
      const sourceFile = `${sourceBase}-${matchcode}`;
      const existing = await this.prisma.loadingUnitPosting.findUnique({
        where: {
          organizationId_sourceFile_packagingMatchcode: {
            organizationId: schein.organizationId,
            sourceFile,
            packagingMatchcode: matchcode,
          },
        },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      const balanceDelta = line.given - line.taken;
      await this.prisma.loadingUnitPosting.create({
        data: {
          organizationId: schein.organizationId,
          packagingTypeId: packaging?.id,
          packagingMatchcode: matchcode,
          packagingLabel: packaging?.label || null,
          given: line.given,
          taken: line.taken,
          balanceDelta,
          owedQuantity: Math.max(0, balanceDelta),
          tourId: schein.tourId || null,
          tourNumber: schein.tourNumber || null,
          partnerNumber,
          partnerName,
          vehicleSoloplanId: schein.vehiclePlate || null,
          status: packaging ? 'BOOKED' : 'SKIPPED_UNKNOWN_TYPE',
          skipReason: packaging ? null : 'Matchcode nicht in aktiver PackagingType-CSV',
          occurredAt: schein.occurredAt,
          sourceFile,
        },
      });
      booked += 1;
    }

    // Nicht getauscht (nur Markierung, keine Mengen)
    const anyQty = lines.some((l) => l.given > 0 || l.taken > 0);
    if (
      !anyQty &&
      (schein.noExchangeNoStock || schein.noExchangeDriverRefuse)
    ) {
      const packaging = await this.resolvePackagingType(schein.organizationId, 'EUP');
      const matchcode = packaging?.matchcode || 'EUP';
      const sourceFile = `${sourceBase}-NOEXCHANGE`;
      const existing = await this.prisma.loadingUnitPosting.findUnique({
        where: {
          organizationId_sourceFile_packagingMatchcode: {
            organizationId: schein.organizationId,
            sourceFile,
            packagingMatchcode: matchcode,
          },
        },
      });
      if (!existing && packaging) {
        const reason = [
          schein.noExchangeNoStock ? 'Keine Lademittel zum Tausch vorhanden' : null,
          schein.noExchangeDriverRefuse ? 'Fahrer wollte nicht tauschen' : null,
        ]
          .filter(Boolean)
          .join('; ');
        await this.prisma.loadingUnitPosting.create({
          data: {
            organizationId: schein.organizationId,
            packagingTypeId: packaging.id,
            packagingMatchcode: packaging.matchcode,
            packagingLabel: packaging.label,
            given: 0,
            taken: 0,
            balanceDelta: 1,
            owedQuantity: 1,
            tourId: schein.tourId || null,
            tourNumber: schein.tourNumber || null,
            partnerNumber,
            partnerName,
            vehicleSoloplanId: schein.vehiclePlate || null,
            status: 'SKIPPED_ZERO',
            skipReason: `Lademittelschein ${schein.number}: ${reason}`,
            occurredAt: schein.occurredAt,
            sourceFile,
          },
        });
        booked += 1;
      }
    }

    this.logger.log(
      `Lademittelschein ${schein.number} → Lademittelverwaltung: ${booked} gebucht, ${skipped} übersprungen`,
    );
    return { booked, skipped, sourceBase };
  }

  /**
   * Ermittelt die Anzahl schuldender Lademittel aus Portal-Sendung/Colli
   * (für Nicht-Tausch, wenn Telematics Given/Taken = 0 meldet).
   */
  private async resolveOwedQuantity(
    organizationId: string,
    matchcode: string,
    opts: {
      tourStopId?: string | null;
      transportOrderNumber?: string | null;
      tourId?: string | null;
    },
  ): Promise<number> {
    const mc = matchcode.trim().toUpperCase();
    if (!mc) return 0;

    const refs = new Set<string>();
    if (opts.transportOrderNumber?.trim()) refs.add(opts.transportOrderNumber.trim());

    if (opts.tourStopId) {
      const stop = await this.prisma.tourStop.findUnique({
        where: { id: opts.tourStopId },
        select: { transportOrderNumber: true },
      });
      if (stop?.transportOrderNumber?.trim()) refs.add(stop.transportOrderNumber.trim());
    }

    if (opts.tourId) {
      const consignments = await this.prisma.tourConsignment.findMany({
        where: {
          tourId: opts.tourId,
          ...(opts.transportOrderNumber
            ? {
                OR: [
                  { soloplanOrderNumber: opts.transportOrderNumber },
                  { externalConsignmentNumber: opts.transportOrderNumber },
                ],
              }
            : {}),
        },
        select: { soloplanOrderNumber: true, externalConsignmentNumber: true },
      });
      for (const c of consignments) {
        if (c.soloplanOrderNumber?.trim()) refs.add(c.soloplanOrderNumber.trim());
        if (c.externalConsignmentNumber?.trim()) refs.add(c.externalConsignmentNumber.trim());
      }
    }

    if (!refs.size) return 0;
    const refList = [...refs];

    const shipments = await this.prisma.shipment.findMany({
      where: {
        organizationId,
        OR: [
          { trackingNumber: { in: refList } },
          { reference: { in: refList } },
          { soloplanRef: { in: refList } },
          { order: { externalNumber: { in: refList } } },
        ],
      },
      select: {
        packageCount: true,
        colli: { select: { packaging: true, quantity: true } },
        positions: { select: { packaging: true, quantity: true } },
      },
      take: 20,
    });

    let total = 0;
    for (const s of shipments) {
      const fromColli = s.colli
        .filter((c) => (c.packaging || '').trim().toUpperCase() === mc)
        .reduce((sum, c) => sum + Math.max(0, c.quantity || 0), 0);
      const fromPos = s.positions
        .filter((p) => (p.packaging || '').trim().toUpperCase() === mc)
        .reduce((sum, p) => sum + Math.max(0, p.quantity || 0), 0);
      if (fromColli > 0) total += fromColli;
      else if (fromPos > 0) total += fromPos;
      else if (
        s.packageCount > 0 &&
        s.colli.length === 0 &&
        s.positions.length === 0
      ) {
        // Keine Colli/Positionen: packageCount nur zählen, wenn Typ tauschrelevant ist
        total += s.packageCount;
      }
    }
    return total;
  }

  /** Bestehende Nicht-Tausch-Buchungen um schuldende Anzahl aus Sendungen ergänzen. */
  async backfillOwedQuantities(organizationId: string) {
    const rows = await this.prisma.loadingUnitPosting.findMany({
      where: {
        organizationId,
        status: 'SKIPPED_ZERO',
        packagingMatchcode: { notIn: [...NON_EXCHANGEABLE_MATCHCODES] },
      },
      select: {
        id: true,
        packagingMatchcode: true,
        tourStopId: true,
        tourId: true,
        owedQuantity: true,
        tourStop: { select: { transportOrderNumber: true } },
      },
      take: 10000,
    });

    let updated = 0;
    for (const r of rows) {
      if (!isExchangeBookableMatchcode(r.packagingMatchcode)) continue;
      const resolved = await this.resolveOwedQuantity(organizationId, r.packagingMatchcode, {
        tourStopId: r.tourStopId,
        transportOrderNumber: r.tourStop?.transportOrderNumber,
        tourId: r.tourId,
      });
      const owed = Math.max(1, resolved);
      if (owed === r.owedQuantity && r.owedQuantity > 0) continue;
      await this.prisma.loadingUnitPosting.update({
        where: { id: r.id },
        data: {
          owedQuantity: owed,
          balanceDelta: owed,
          skipReason:
            resolved > 0
              ? `Given=0 / Taken=0 – kein Tausch (${owed} Stück laut Sendung)`
              : `Given=0 / Taken=0 – kein Tausch (${owed} Stück)`,
        },
      });
      updated += 1;
    }
    return { scanned: rows.length, updated };
  }

  private async resolvePartner(
    organizationId: string,
    stop:
      | {
          id: string;
          name: string | null;
          city: string | null;
          stopType: string | null;
          transportOrderNumber: string | null;
        }
      | null
      | undefined,
    tourId?: string | null,
  ) {
    let partnerName = stop?.name || null;
    let partnerCity = stop?.city || null;
    let partnerNumber: string | null = null;
    let customerId: string | null = null;

    if (stop?.transportOrderNumber && tourId) {
      const cons = await this.prisma.tourConsignment.findFirst({
        where: { tourId, soloplanOrderNumber: stop.transportOrderNumber },
      });
      const st = (stop.stopType || '').toLowerCase();
      const isSender =
        st.includes('sender') ||
        st.includes('load') ||
        st.includes('belad') ||
        st.includes('pickup') ||
        st.includes('abhol');
      if (isSender && cons?.senderBpNumber) {
        partnerNumber = cons.senderBpNumber;
        if (!partnerName && cons.senderName) partnerName = cons.senderName;
      } else if (!isSender && cons?.receiverName && !partnerName) {
        partnerName = cons.receiverName;
      } else if (isSender && cons?.senderName && !partnerName) {
        partnerName = cons.senderName;
      }
    }

    if (partnerNumber) {
      const cust = await this.prisma.customer.findFirst({
        where: {
          organizationId,
          OR: [
            { customerNumber: partnerNumber },
            { soloplanBusinessPartnerId: partnerNumber },
            { matchcode: partnerNumber },
          ],
        },
      });
      if (cust) {
        customerId = cust.id;
        if (!partnerName) partnerName = cust.name;
      }
    } else if (partnerName) {
      const cust = await this.prisma.customer.findFirst({
        where: { organizationId, name: partnerName, active: true },
      });
      if (cust) {
        customerId = cust.id;
        partnerNumber = cust.customerNumber || cust.matchcode || cust.soloplanBusinessPartnerId;
      }
    }

    return { partnerName, partnerCity, partnerNumber, customerId };
  }

  async listBalances(
    user: AuthUser,
    opts?: { q?: string; matchcode?: string; includeZero?: boolean },
  ) {
    if (user.role === UserRole.CUSTOMER_USER) throw new NotFoundException();

    const rows = await this.prisma.loadingUnitPosting.groupBy({
      by: [
        'partnerNumber',
        'partnerName',
        'partnerCity',
        'packagingMatchcode',
        'packagingLabel',
      ],
      where: {
        organizationId: user.organizationId,
        // Gebuchte Täusche + Nicht-Tausch mit bekannter schuldender Menge
        status: { in: ['BOOKED', 'SKIPPED_ZERO'] },
        ...(opts?.matchcode
          ? { packagingMatchcode: { equals: opts.matchcode, mode: 'insensitive' } }
          : {}),
        ...(opts?.q
          ? {
              OR: [
                { partnerName: { contains: opts.q, mode: 'insensitive' } },
                { partnerNumber: { contains: opts.q, mode: 'insensitive' } },
                { partnerCity: { contains: opts.q, mode: 'insensitive' } },
                { packagingMatchcode: { contains: opts.q, mode: 'insensitive' } },
                { packagingLabel: { contains: opts.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      _sum: { given: true, taken: true, balanceDelta: true, owedQuantity: true },
      _count: { _all: true },
      _max: { occurredAt: true },
    });

    const balances = rows
      .map((r) => {
        const given = r._sum.given || 0;
        const taken = r._sum.taken || 0;
        const owedQuantity = r._sum.owedQuantity || 0;
        const balance = r._sum.balanceDelta ?? given - taken;
        return {
          partnerNumber: r.partnerNumber,
          partnerName: r.partnerName || 'Unbekannter Partner',
          partnerCity: r.partnerCity,
          packagingMatchcode: r.packagingMatchcode,
          packagingLabel: r.packagingLabel,
          given,
          taken,
          balance,
          /** Anzahl schuldender Lademittel (Partner → WOG) */
          owedQuantity: owedQuantity > 0 ? owedQuantity : Math.max(0, balance),
          postings: r._count._all,
          lastAt: r._max.occurredAt,
        };
      })
      .filter((r) => isExchangeBookableMatchcode(r.packagingMatchcode))
      .filter((r) =>
        opts?.includeZero ? true : r.given !== 0 || r.taken !== 0 || r.owedQuantity !== 0,
      )
      .sort((a, b) => {
        const na = (a.partnerName || '').localeCompare(b.partnerName || '', 'de');
        if (na !== 0) return na;
        return a.packagingMatchcode.localeCompare(b.packagingMatchcode, 'de');
      });

    const totals = balances.reduce(
      (acc, r) => {
        acc.given += r.given;
        acc.taken += r.taken;
        acc.balance += r.balance;
        acc.owedQuantity += r.owedQuantity;
        return acc;
      },
      { given: 0, taken: 0, balance: 0, owedQuantity: 0 },
    );

    return { balances, totals, count: balances.length };
  }

  /**
   * Saubere Listen: Übersicht alle Partner oder Totale je Lademittel für einen Partner.
   * format: csv | csv-matrix | pdf
   * view: overview | partner
   */
  async exportLists(
    user: AuthUser,
    opts: {
      view?: 'overview' | 'partner';
      format?: 'csv' | 'csv-matrix' | 'pdf';
      partnerName?: string;
      q?: string;
      matchcode?: string;
    },
  ) {
    if (user.role !== UserRole.ORG_ADMIN && user.role !== UserRole.MANDANT_DISPATCHER) {
      throw new NotFoundException();
    }
    const view = opts.view === 'partner' ? 'partner' : 'overview';
    const format = opts.format || 'csv';
    if (view === 'partner' && !opts.partnerName?.trim()) {
      throw new BadRequestException('Partnername erforderlich für Partner-Liste');
    }

    const { balances } = await this.listBalances(user, {
      q: opts.q,
      matchcode: opts.matchcode,
      includeZero: false,
    });
    const filtered =
      view === 'partner'
        ? balances.filter(
            (b) =>
              b.partnerName.toLowerCase() === opts.partnerName!.trim().toLowerCase(),
          )
        : balances;
    const report = buildLuExportReport(filtered);
    const day = new Date().toISOString().slice(0, 10);
    const safePartner = (opts.partnerName || 'alle')
      .replace(/[^\w.\-äöüÄÖÜß ]+/g, '_')
      .trim()
      .slice(0, 60);

    if (format === 'pdf') {
      const buf =
        view === 'partner'
          ? await writeLuPartnerPdf(report, opts.partnerName!.trim())
          : await writeLuOverviewPdf(report);
      const fileName =
        view === 'partner'
          ? `Lademittel-Partner-${safePartner}-${day}.pdf`
          : `Lademittel-Uebersicht-${day}.pdf`;
      return { buffer: buf, contentType: 'application/pdf', fileName };
    }

    if (format === 'csv-matrix') {
      const csv = luReportToMatrixCsv(
        view === 'partner' ? report : buildLuExportReport(balances),
      );
      return {
        buffer: Buffer.from(csv, 'utf8'),
        contentType: 'text/csv; charset=utf-8',
        fileName: `Lademittel-Matrix-${day}.csv`,
      };
    }

    const csv =
      view === 'partner'
        ? luReportToPartnerCsv(report, opts.partnerName!.trim())
        : luReportToOverviewCsv(report);
    const fileName =
      view === 'partner'
        ? `Lademittel-Partner-${safePartner}-${day}.csv`
        : `Lademittel-Uebersicht-${day}.csv`;
    return { buffer: Buffer.from(csv, 'utf8'), contentType: 'text/csv; charset=utf-8', fileName };
  }

  async listPostings(
    user: AuthUser,
    opts?: {
      q?: string;
      matchcode?: string;
      partnerNumber?: string;
      partnerName?: string;
      take?: number;
      includeSkipped?: boolean;
    },
  ) {
    if (user.role === UserRole.CUSTOMER_USER) throw new NotFoundException();

    return this.prisma.loadingUnitPosting.findMany({
      where: {
        organizationId: user.organizationId,
        ...(opts?.includeSkipped ? {} : { status: 'BOOKED' }),
        ...(opts?.matchcode
          ? { packagingMatchcode: { equals: opts.matchcode, mode: 'insensitive' } }
          : {}),
        ...(opts?.partnerNumber ? { partnerNumber: opts.partnerNumber } : {}),
        ...(opts?.partnerName
          ? { partnerName: { equals: opts.partnerName, mode: 'insensitive' } }
          : {}),
        ...(opts?.q
          ? {
              OR: [
                { partnerName: { contains: opts.q, mode: 'insensitive' } },
                { partnerNumber: { contains: opts.q, mode: 'insensitive' } },
                { packagingMatchcode: { contains: opts.q, mode: 'insensitive' } },
                { tourNumber: { contains: opts.q, mode: 'insensitive' } },
                { sourceFile: { contains: opts.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(opts?.take || 200, 500),
      include: {
        packagingType: { select: { id: true, matchcode: true, label: true } },
        tour: { select: { id: true, tourNumber: true } },
      },
    });
  }

  /**
   * Einmaliger/manueller Backfill: SKIPPED_ZERO aus verarbeiteten TourStopStatus-XMLs.
   * Erzeugt keine neuen TelematicsEvents.
   */
  async backfillNoExchangeFromFiles(organizationId?: string) {
    const org =
      (organizationId
        ? await this.prisma.organization.findUnique({ where: { id: organizationId } })
        : null) ||
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } }));
    if (!org) return { scanned: 0, created: 0 };

    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    const roots = [
      join(sftpInbound, 'soloplan', 'business-partners'),
      join(sftpInbound, 'intouch', 'dokumente'),
    ];

    let scanned = 0;
    let created = 0;

    for (const root of roots) {
      for (const dir of [root, join(root, 'processed')]) {
        if (!existsSync(dir)) continue;
        for (const fileName of readdirSync(dir)) {
          if (!fileName.toLowerCase().includes('_tourstopstatus_') || !fileName.endsWith('.xml')) {
            continue;
          }
          scanned += 1;
          const sourceFile = fileName.replace(/^\d+_/, '');
          let xml: string;
          try {
            xml = readFileSync(join(dir, fileName), 'utf8');
          } catch {
            continue;
          }
          const parsed = parseTelematicsXml(xml, fileName);
          if (!parsed || parsed.kind !== 'TourStopStatus') continue;

          const eventAt = parsed.statusDate || parsed.sendDate || new Date();
          let resolvedTour =
            (await this.prisma.tour.findFirst({
              where: { organizationId: org.id, tourNumber: parsed.tourNumber },
              orderBy: [{ updatedAt: 'desc' }],
              select: { id: true, tourNumber: true },
            })) || null;
          let stop = resolvedTour
            ? await this.prisma.tourStop.findFirst({
                where: { tourId: resolvedTour.id, soloplanTourStopId: parsed.tourStopId },
              })
            : null;
          if (!stop) {
            const stopWithTour = await this.prisma.tourStop.findFirst({
              where: {
                soloplanTourStopId: parsed.tourStopId,
                tour: { organizationId: org.id },
              },
              include: { tour: { select: { id: true, tourNumber: true } } },
            });
            if (stopWithTour) {
              const { tour: linkedTour, ...stopOnly } = stopWithTour;
              stop = stopOnly;
              if (!resolvedTour) resolvedTour = linkedTour;
            }
          }
          const partner = await this.resolvePartner(org.id, stop, resolvedTour?.id);
          if (!partner.partnerName) {
            partner.partnerName = `Tour ${parsed.tourNumber} · Stop ${parsed.tourStopId}`;
          }

          for (const ex of parsed.exchanges) {
            if (ex.given !== 0 || ex.taken !== 0) continue;
            const matchcode = ex.matchcode.trim();
            if (!matchcode || !isExchangeBookableMatchcode(matchcode)) continue;
            const packaging = await this.resolvePackagingType(org.id, matchcode);
            if (!packaging || !packaging.createBookings) continue;

            const existing = await this.prisma.loadingUnitPosting.findUnique({
              where: {
                organizationId_sourceFile_packagingMatchcode: {
                  organizationId: org.id,
                  sourceFile,
                  packagingMatchcode: packaging.matchcode,
                },
              },
            });
            if (existing) continue;

            const resolvedQty = await this.resolveOwedQuantity(org.id, packaging.matchcode, {
              tourStopId: stop?.id,
              transportOrderNumber: stop?.transportOrderNumber,
              tourId: resolvedTour?.id,
            });
            const owedQuantity = Math.max(1, resolvedQty);
            await this.prisma.loadingUnitPosting.create({
              data: {
                organizationId: org.id,
                packagingTypeId: packaging.id,
                packagingMatchcode: packaging.matchcode,
                packagingLabel: packaging.label,
                given: 0,
                taken: 0,
                balanceDelta: owedQuantity,
                owedQuantity,
                tourId: resolvedTour?.id,
                tourNumber: parsed.tourNumber,
                tourStopId: stop?.id,
                tourStopExternalId: parsed.tourStopId,
                partnerNumber: partner.partnerNumber,
                partnerName: partner.partnerName,
                partnerCity: partner.partnerCity,
                customerId: partner.customerId,
                vehicleSoloplanId: parsed.vehicleId,
                status: 'SKIPPED_ZERO',
                skipReason:
                  resolvedQty > 0
                    ? `Given=0 / Taken=0 – kein Tausch (${owedQuantity} Stück laut Sendung)`
                    : `Given=0 / Taken=0 – kein Tausch (${owedQuantity} Stück)`,
                occurredAt: eventAt,
                sendDate: parsed.sendDate,
                sourceFile,
              },
            });
            created += 1;
          }
        }
      }
    }

    this.logger.log(`Lademittel Backfill Nicht-Tausch: scanned=${scanned} created=${created}`);
    return { scanned, created };
  }

  /**
   * Übersicht: Kunden ohne Lademitteltausch (Given=0/Taken=0), gruppiert nach Tag oder Monat.
   */
  async listNoExchangeOverview(
    user: AuthUser,
    opts?: {
      month?: string; // YYYY-MM
      day?: string; // YYYY-MM-DD
      groupBy?: 'day' | 'month' | 'customer';
      q?: string;
      includeInternal?: boolean;
    },
  ) {
    if (user.role === UserRole.CUSTOMER_USER) throw new NotFoundException();

    const groupBy = opts?.groupBy || 'day';
    const month = opts?.month || zurichMonthKey(new Date());
    const range = opts?.day
      ? zurichDayRange(opts.day)
      : zurichMonthRange(month);

    const rows = await this.prisma.loadingUnitPosting.findMany({
      where: {
        organizationId: user.organizationId,
        status: 'SKIPPED_ZERO',
        packagingMatchcode: { notIn: [...NON_EXCHANGEABLE_MATCHCODES] },
        occurredAt: { gte: range.from, lt: range.to },
        ...(opts?.q
          ? {
              OR: [
                { partnerName: { contains: opts.q, mode: 'insensitive' } },
                { partnerNumber: { contains: opts.q, mode: 'insensitive' } },
                { partnerCity: { contains: opts.q, mode: 'insensitive' } },
                { packagingMatchcode: { contains: opts.q, mode: 'insensitive' } },
                { tourNumber: { contains: opts.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ occurredAt: 'desc' }],
      include: {
        tour: { select: { id: true, tourNumber: true } },
        tourStop: { select: { id: true, stopType: true, name: true, city: true } },
      },
      take: 5000,
    });

    const filtered = rows.filter((r) => {
      if (!isExchangeBookableMatchcode(r.packagingMatchcode)) return false;
      if (opts?.includeInternal) return true;
      return !isInternalPartnerName(r.partnerName);
    });

    // Pro Stop/Datei nur einmal zählen (mehrere Matchcodes = ein Nicht-Tausch-Ereignis)
    type EventKey = string;
    const events = new Map<
      EventKey,
      {
        day: string;
        month: string;
        partnerName: string;
        partnerNumber: string | null;
        partnerCity: string | null;
        tourNumber: string | null;
        tourId: string | null;
        tourStopExternalId: string | null;
        stopType: string | null;
        packagingMatchcodes: string[];
        /** Schuldende Stückzahl je Matchcode */
        owedByMatchcode: Record<string, number>;
        owedQuantity: number;
        occurredAt: Date | null;
        sourceFile: string;
      }
    >();

    for (const r of filtered) {
      const at = r.occurredAt || r.createdAt;
      const day = zurichDayKey(at);
      const key = `${r.sourceFile}|${r.tourStopExternalId || ''}|${r.partnerName || ''}`;
      const owed = Math.max(0, r.owedQuantity || 0);
      const existing = events.get(key);
      if (existing) {
        if (!existing.packagingMatchcodes.includes(r.packagingMatchcode)) {
          existing.packagingMatchcodes.push(r.packagingMatchcode);
        }
        existing.owedByMatchcode[r.packagingMatchcode] =
          (existing.owedByMatchcode[r.packagingMatchcode] || 0) + owed;
        existing.owedQuantity += owed;
        continue;
      }
      events.set(key, {
        day,
        month: day.slice(0, 7),
        partnerName: r.partnerName || 'Unbekannter Kunde',
        partnerNumber: r.partnerNumber,
        partnerCity: r.partnerCity || r.tourStop?.city || null,
        tourNumber: r.tourNumber,
        tourId: r.tourId,
        tourStopExternalId: r.tourStopExternalId,
        stopType: r.tourStop?.stopType || null,
        packagingMatchcodes: [r.packagingMatchcode],
        owedByMatchcode: { [r.packagingMatchcode]: owed },
        owedQuantity: owed,
        occurredAt: r.occurredAt,
        sourceFile: r.sourceFile,
      });
    }

    const eventList = [...events.values()]
      .filter((e) => {
        if (opts?.day) return e.day === opts.day;
        return e.month === month;
      })
      .sort((a, b) => {
        const ta = a.occurredAt?.getTime() || 0;
        const tb = b.occurredAt?.getTime() || 0;
        return tb - ta;
      });

    if (groupBy === 'customer') {
      const byCustomer = new Map<
        string,
        {
          partnerName: string;
          partnerNumber: string | null;
          partnerCity: string | null;
          days: string[];
          events: number;
          owedQuantity: number;
          owedByMatchcode: Record<string, number>;
          packagingMatchcodes: string[];
          lastAt: Date | null;
        }
      >();
      for (const e of eventList) {
        const ck = `${e.partnerNumber || ''}|${e.partnerName}`;
        const cur = byCustomer.get(ck);
        if (!cur) {
          byCustomer.set(ck, {
            partnerName: e.partnerName,
            partnerNumber: e.partnerNumber,
            partnerCity: e.partnerCity,
            days: [e.day],
            events: 1,
            owedQuantity: e.owedQuantity,
            owedByMatchcode: { ...e.owedByMatchcode },
            packagingMatchcodes: [...e.packagingMatchcodes],
            lastAt: e.occurredAt,
          });
        } else {
          cur.events += 1;
          cur.owedQuantity += e.owedQuantity;
          if (!cur.days.includes(e.day)) cur.days.push(e.day);
          for (const mc of e.packagingMatchcodes) {
            if (!cur.packagingMatchcodes.includes(mc)) cur.packagingMatchcodes.push(mc);
          }
          for (const [mc, n] of Object.entries(e.owedByMatchcode)) {
            cur.owedByMatchcode[mc] = (cur.owedByMatchcode[mc] || 0) + n;
          }
          if (e.occurredAt && (!cur.lastAt || e.occurredAt > cur.lastAt)) cur.lastAt = e.occurredAt;
        }
      }
      const customers = [...byCustomer.values()]
        .map((c) => ({
          ...c,
          days: c.days.sort().reverse(),
          dayCount: c.days.length,
          packagingMatchcodes: c.packagingMatchcodes.sort(),
        }))
        .sort(
          (a, b) =>
            b.owedQuantity - a.owedQuantity ||
            b.events - a.events ||
            a.partnerName.localeCompare(b.partnerName, 'de'),
        );

      const byMatchcode: Record<string, number> = {};
      const owedByMatchcode: Record<string, number> = {};
      for (const e of eventList) {
        for (const mc of e.packagingMatchcodes) {
          byMatchcode[mc] = (byMatchcode[mc] || 0) + 1;
        }
        for (const [mc, n] of Object.entries(e.owedByMatchcode)) {
          owedByMatchcode[mc] = (owedByMatchcode[mc] || 0) + n;
        }
      }
      return {
        month,
        groupBy: 'customer' as const,
        range: { from: range.from, to: range.to },
        customers,
        excludedMatchcodes: [...NON_EXCHANGEABLE_MATCHCODES],
        totals: {
          stopsWithoutExchange: eventList.length,
          owedQuantity: eventList.reduce((s, e) => s + e.owedQuantity, 0),
          customers: customers.length,
          events: eventList.length,
          days: new Set(eventList.map((e) => e.day)).size,
          byMatchcode,
          owedByMatchcode,
        },
      };
    }

    // day | month → Tagesgruppen (bei month-Filter mehrere Tage; groupBy month fasst nur Stats)
    const byDay = new Map<
      string,
      {
        date: string;
        customers: Array<{
          partnerName: string;
          partnerNumber: string | null;
          partnerCity: string | null;
          tourNumber: string | null;
          tourId: string | null;
          stopType: string | null;
          packagingMatchcodes: string[];
          owedByMatchcode: Record<string, number>;
          owedQuantity: number;
          occurredAt: Date | null;
          events: number;
        }>;
      }
    >();

    for (const e of eventList) {
      const bucket = groupBy === 'month' ? e.month : e.day;
      if (!byDay.has(bucket)) byDay.set(bucket, { date: bucket, customers: [] });
      const dayBucket = byDay.get(bucket)!;
      const existing = dayBucket.customers.find(
        (c) =>
          c.partnerName === e.partnerName &&
          (c.partnerNumber || '') === (e.partnerNumber || '') &&
          (c.tourNumber || '') === (e.tourNumber || ''),
      );
      if (existing) {
        existing.events += 1;
        existing.owedQuantity += e.owedQuantity;
        for (const mc of e.packagingMatchcodes) {
          if (!existing.packagingMatchcodes.includes(mc)) existing.packagingMatchcodes.push(mc);
        }
        for (const [mc, n] of Object.entries(e.owedByMatchcode)) {
          existing.owedByMatchcode[mc] = (existing.owedByMatchcode[mc] || 0) + n;
        }
        if (e.occurredAt && (!existing.occurredAt || e.occurredAt > existing.occurredAt)) {
          existing.occurredAt = e.occurredAt;
        }
      } else {
        dayBucket.customers.push({
          partnerName: e.partnerName,
          partnerNumber: e.partnerNumber,
          partnerCity: e.partnerCity,
          tourNumber: e.tourNumber,
          tourId: e.tourId,
          stopType: e.stopType,
          packagingMatchcodes: [...e.packagingMatchcodes],
          owedByMatchcode: { ...e.owedByMatchcode },
          owedQuantity: e.owedQuantity,
          occurredAt: e.occurredAt,
          events: 1,
        });
      }
    }

    const days = [...byDay.values()]
      .map((d) => ({
        date: d.date,
        customerCount: d.customers.length,
        eventCount: d.customers.reduce((s, c) => s + c.events, 0),
        owedQuantity: d.customers.reduce((s, c) => s + c.owedQuantity, 0),
        customers: d.customers.sort((a, b) => a.partnerName.localeCompare(b.partnerName, 'de')),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const byMatchcode: Record<string, number> = {};
    const owedByMatchcode: Record<string, number> = {};
    for (const e of eventList) {
      for (const mc of e.packagingMatchcodes) {
        byMatchcode[mc] = (byMatchcode[mc] || 0) + 1;
      }
      for (const [mc, n] of Object.entries(e.owedByMatchcode)) {
        owedByMatchcode[mc] = (owedByMatchcode[mc] || 0) + n;
      }
    }

    return {
      month,
      groupBy,
      range: { from: range.from, to: range.to },
      days,
      excludedMatchcodes: [...NON_EXCHANGEABLE_MATCHCODES],
      totals: {
        /** Anzahl Stops/Kunden-Ereignisse ohne Tausch */
        stopsWithoutExchange: eventList.length,
        /** Summe schuldender Lademittel (Stück) */
        owedQuantity: eventList.reduce((s, e) => s + e.owedQuantity, 0),
        customers: new Set(eventList.map((e) => `${e.partnerNumber || ''}|${e.partnerName}`)).size,
        events: eventList.length,
        days: days.length,
        byMatchcode,
        owedByMatchcode,
      },
    };
  }

  /**
   * Lademitteltausch-Hinweis für Ablieferbeleg / Zustellnachweis.
   */
  async resolveExchangeNote(opts: {
    organizationId: string;
    tourStopId?: string | null;
    tourStopExternalId?: string | null;
    tourId?: string | null;
    tourNumber?: string | null;
    partnerName?: string | null;
    transportOrderNumber?: string | null;
  }): Promise<LoadingUnitExchangeNote> {
    const or: Array<Record<string, unknown>> = [];
    if (opts.tourStopId) or.push({ tourStopId: opts.tourStopId });
    if (opts.tourStopExternalId) or.push({ tourStopExternalId: opts.tourStopExternalId });
    if (opts.tourId && opts.partnerName) {
      or.push({
        tourId: opts.tourId,
        partnerName: { equals: opts.partnerName, mode: 'insensitive' },
      });
    }
    if (opts.tourNumber && opts.partnerName) {
      or.push({
        tourNumber: opts.tourNumber,
        partnerName: { equals: opts.partnerName, mode: 'insensitive' },
      });
    }
    if (opts.partnerName && !opts.tourStopId && !opts.tourStopExternalId) {
      or.push({ partnerName: { equals: opts.partnerName, mode: 'insensitive' } });
    }

    // Zusätzlich über Transportauftrag → Entladestopp auflösen
    if (opts.transportOrderNumber?.trim()) {
      const stops = await this.prisma.tourStop.findMany({
        where: {
          transportOrderNumber: opts.transportOrderNumber.trim(),
          tour: { organizationId: opts.organizationId },
        },
        select: { id: true, soloplanTourStopId: true },
        take: 20,
      });
      for (const s of stops) {
        or.push({ tourStopId: s.id });
        if (s.soloplanTourStopId) or.push({ tourStopExternalId: s.soloplanTourStopId });
      }
    }

    if (!or.length) {
      return {
        status: 'UNKNOWN',
        headline: 'Lademitteltausch',
        detail: 'Keine Telematics-Meldung vorhanden',
        lines: [],
      };
    }

    const rows = await this.prisma.loadingUnitPosting.findMany({
      where: {
        organizationId: opts.organizationId,
        status: { in: ['BOOKED', 'SKIPPED_ZERO'] },
        OR: or,
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 40,
    });

    // Pro Matchcode die neueste Meldung (ohne EWP/HP)
    const latestByCode = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (!isExchangeBookableMatchcode(r.packagingMatchcode)) continue;
      const key = r.packagingMatchcode.toUpperCase();
      if (!latestByCode.has(key)) latestByCode.set(key, r);
    }
    const lines = [...latestByCode.values()].map((r) => ({
      matchcode: r.packagingMatchcode,
      label: r.packagingLabel,
      given: r.given,
      taken: r.taken,
      owedQuantity: Math.max(0, r.owedQuantity || Math.max(0, r.given - r.taken)),
      status: r.status,
    }));

    if (!lines.length) {
      return {
        status: 'UNKNOWN',
        headline: 'Lademitteltausch',
        detail: 'Keine Telematics-Meldung vorhanden',
        lines: [],
      };
    }

    const hasBooked = lines.some((l) => l.status === 'BOOKED' && (l.given > 0 || l.taken > 0));
    const hasZero = lines.some(
      (l) => l.status === 'SKIPPED_ZERO' || (l.given === 0 && l.taken === 0),
    );
    const owedTotal = lines.reduce((s, l) => s + (l.owedQuantity || 0), 0);
    const fullyExchanged =
      hasBooked &&
      owedTotal === 0 &&
      lines.every((l) => l.given === l.taken) &&
      lines.some((l) => l.given > 0);
    const owedDetail =
      owedTotal > 0
        ? `Nicht getauscht: ${lines
            .filter((l) => (l.owedQuantity || 0) > 0)
            .map((l) => `${l.owedQuantity}× ${l.matchcode}`)
            .join(', ')}`
        : '';

    let status: LoadingUnitExchangeNote['status'] = 'UNKNOWN';
    let headline = 'Lademitteltausch';
    let detail = '';
    if (hasZero && !hasBooked) {
      status = 'NOT_EXCHANGED';
      headline = 'Lademittel NICHT getauscht';
      detail = owedDetail || 'Gegeben 0 / Erhalten 0';
    } else if (hasBooked && hasZero) {
      status = 'MIXED';
      headline = 'Lademitteltausch teilweise';
      detail = owedDetail || 'Mindestens ein Typ ohne Tausch';
    } else if (fullyExchanged) {
      status = 'EXCHANGED';
      headline = 'Lademittel vollständig getauscht';
      detail = '';
    } else if (hasBooked) {
      status = owedTotal > 0 ? 'MIXED' : 'EXCHANGED';
      headline = owedTotal > 0 ? 'Lademitteltausch teilweise' : 'Lademittel getauscht';
      detail = owedDetail;
    } else {
      status = 'NOT_EXCHANGED';
      headline = 'Lademittel NICHT getauscht';
      detail = owedDetail || 'Gegeben 0 / Erhalten 0';
    }

    return { status, headline, detail, lines };
  }

  /** Resolve für Portal-Sendung (Ablieferbeleg). */
  async resolveExchangeNoteForShipment(
    organizationId: string,
    shipment: {
      reference?: string | null;
      trackingNumber?: string | null;
      deliveryCompany?: string | null;
      deliveryCity?: string | null;
    },
  ): Promise<LoadingUnitExchangeNote> {
    const consOr: Array<Record<string, unknown>> = [];
    if (shipment.reference) {
      consOr.push({ externalConsignmentNumber: shipment.reference });
      consOr.push({ soloplanOrderNumber: shipment.reference });
    }
    if (shipment.trackingNumber) {
      consOr.push({ externalConsignmentNumber: shipment.trackingNumber });
    }
    if (shipment.deliveryCompany) {
      consOr.push({ receiverName: { equals: shipment.deliveryCompany, mode: 'insensitive' } });
    }

    let tourStopId: string | null = null;
    let tourStopExternalId: string | null = null;
    let tourId: string | null = null;
    let tourNumber: string | null = null;

    if (consOr.length) {
      const cons = await this.prisma.tourConsignment.findFirst({
        where: { tour: { organizationId }, OR: consOr },
        include: {
          tour: {
            select: {
              id: true,
              tourNumber: true,
              stops: {
                select: {
                  id: true,
                  soloplanTourStopId: true,
                  stopType: true,
                  name: true,
                  transportOrderNumber: true,
                  city: true,
                },
              },
            },
          },
        },
        orderBy: [{ lastStatusAt: 'desc' }],
      });
      if (cons) {
        tourId = cons.tourId;
        tourNumber = cons.tour.tourNumber;
        const stopKind = (t?: string | null) => {
          const s = (t || '').toLowerCase();
          if (
            s.includes('receiver') ||
            s.includes('unload') ||
            s.includes('entlad') ||
            s.includes('zustell') ||
            s.includes('delivery')
          ) {
            return 'receiver';
          }
          return 'other';
        };
        const unload =
          cons.tour.stops.find(
            (s) =>
              s.transportOrderNumber === cons.soloplanOrderNumber && stopKind(s.stopType) === 'receiver',
          ) ||
          cons.tour.stops.find(
            (s) =>
              shipment.deliveryCompany &&
              s.name &&
              s.name.toLowerCase() === shipment.deliveryCompany.toLowerCase(),
          ) ||
          cons.tour.stops.find((s) => stopKind(s.stopType) === 'receiver') ||
          null;
        tourStopId = unload?.id || null;
        tourStopExternalId = unload?.soloplanTourStopId || null;
      }
    }

    return this.resolveExchangeNote({
      organizationId,
      tourStopId,
      tourStopExternalId,
      tourId,
      tourNumber,
      partnerName: shipment.deliveryCompany,
    });
  }
}

function isInternalPartnerName(name?: string | null): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (n.startsWith('tour ') || n.includes(' · stop ')) return false;
  return (
    n === 'wog' ||
    n.startsWith('wog ') ||
    n.startsWith('wog-') ||
    n.includes('wog logistics') ||
    n.includes('wog lager') ||
    n.includes('wog aussenlager') ||
    n.includes('ottenareal')
  );
}
