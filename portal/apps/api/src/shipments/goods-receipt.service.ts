import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentType, UserRole } from '@prisma/client';
import { existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { NotificationsService } from '../notifications/notifications.service';
import { normalizeScanCode, parseSsccFromScan, ssccMatchCandidates } from '../labels/sscc';
import {
  ETB_DIMS_CHANGED_MARKER,
  writeEntladeberichtPdf,
  type EtbSurplusLine,
} from './entladebericht-pdf';

function dayBounds(dateStr: string): { start: Date; end: Date } {
  // dateStr YYYY-MM-DD (lokal als UTC-Tag)
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new BadRequestException('Ungültiges Datum (YYYY-MM-DD erwartet)');
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function normalizeExternalRef(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^WE-/i.test(s)) return s.replace(/^WE-/i, '');
  return s;
}

@Injectable()
export class GoodsReceiptService {
  private readonly logger = new Logger(GoodsReceiptService.name);
  private readonly uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private notifications: NotificationsService,
  ) {
    this.uploadDir = this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
  }

  private assertWarehouseRole(user: AuthUser) {
    if (user.role === UserRole.CUSTOMER_USER) {
      throw new ForbiddenException('Wareneingangs-Kontrolle nur für Lager / Disposition');
    }
  }

  private async scanningMandantId(user: AuthUser): Promise<string> {
    const code = this.config.get<string>('SCANNING_MANDANT_CODE') || 'AG';
    const mandant = await this.prisma.mandant.findFirst({
      where: { organizationId: user.organizationId, code, active: true },
      select: { id: true },
    });
    if (!mandant) {
      throw new BadRequestException(`Scanning-Mandant „${code}“ nicht gefunden`);
    }
    if (
      (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) &&
      !user.mandantIds.includes(mandant.id)
    ) {
      throw new ForbiddenException('Kein Zugriff auf Scanning-Mandant');
    }
    return mandant.id;
  }

  /** Offene Wareneingangs-Gruppen zum Filtern (Kunde / Datum / externe Nr.). */
  async listGroups(
    user: AuthUser,
    opts: { customerId?: string; date?: string; q?: string },
  ) {
    this.assertWarehouseRole(user);
    const mandantId = await this.scanningMandantId(user);

    const where: any = {
      organizationId: user.organizationId,
      mandantId,
      // Nur echte Wareneingangs-Importe (nicht normale Portal-/Soloplan-Aufträge)
      OR: [
        { reference: { startsWith: 'WE-' } },
        { goodsDescription: { contains: 'Wareneingang', mode: 'insensitive' } },
      ],
    };
    if (opts.customerId) where.customerId = opts.customerId;
    if (opts.date) {
      const { start, end } = dayBounds(opts.date);
      where.createdAt = { gte: start, lt: end };
    }
    if (opts.q?.trim()) {
      const q = opts.q.trim();
      const ref = normalizeExternalRef(q);
      where.AND = [
        {
          OR: [
            { reference: { contains: q, mode: 'insensitive' } },
            { soloplanRef: { contains: ref, mode: 'insensitive' } },
            { trackingNumber: { contains: q, mode: 'insensitive' } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
            { customer: { customerNumber: { contains: q, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    const shipments = await this.prisma.shipment.findMany({
      where,
      select: {
        id: true,
        reference: true,
        soloplanRef: true,
        trackingNumber: true,
        createdAt: true,
        customerId: true,
        customer: { select: { id: true, name: true, customerNumber: true } },
        colli: {
          select: {
            id: true,
            warehouseStatus: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    type Group = {
      /** Anzeigename / Session-Schlüssel; bei Sammel z. B. ALLE oder Kundensuchbegriff */
      externalRef: string;
      /** true = alle WE-Sendungen des Kunden an diesem Tag */
      allCustomerShipments: boolean;
      customerId: string | null;
      customerName: string | null;
      customerNumber: string | null;
      date: string;
      shipmentIds: string[];
      shipmentCount: number;
      orderRefs: string[];
      expected: number;
      received: number;
      damaged: number;
    };

    // Primär: Sammelgruppe je Kunde + Tag (viele Soloplan-WE-Nr. gehören oft zu einer Kundenlieferung)
    const map = new Map<string, Group>();
    for (const s of shipments) {
      const orderRef =
        s.soloplanRef || (s.reference || '').replace(/^WE-/i, '') || s.reference || s.trackingNumber;
      const date = s.createdAt.toISOString().slice(0, 10);
      const key = `${s.customerId || 'none'}|${date}`;
      let g = map.get(key);
      if (!g) {
        g = {
          externalRef: 'ALLE',
          allCustomerShipments: true,
          customerId: s.customerId,
          customerName: s.customer?.name || null,
          customerNumber: s.customer?.customerNumber || null,
          date,
          shipmentIds: [],
          shipmentCount: 0,
          orderRefs: [],
          expected: 0,
          received: 0,
          damaged: 0,
        };
        map.set(key, g);
      }
      g.shipmentIds.push(s.id);
      g.shipmentCount += 1;
      if (orderRef && !g.orderRefs.includes(orderRef)) g.orderRefs.push(orderRef);
      g.expected += s.colli.length;
      g.received += s.colli.filter(
        (c) => c.warehouseStatus === 'RECEIVED' || c.warehouseStatus === 'DAMAGED',
      ).length;
      g.damaged += s.colli.filter((c) => c.warehouseStatus === 'DAMAGED').length;
    }

    for (const g of map.values()) {
      if (g.orderRefs.length === 1) {
        g.externalRef = g.orderRefs[0];
        // Eine einzige Soloplan-Nr. → Session genau darauf; sonst Sammel
        g.allCustomerShipments = false;
      } else {
        g.externalRef = 'ALLE';
        g.allCustomerShipments = true;
      }
    }

    return [...map.values()].sort(
      (a, b) => b.date.localeCompare(a.date) || (a.customerName || '').localeCompare(b.customerName || '', 'de'),
    );
  }

  /** Session öffnen/fortsetzen und Soll-Liste laden. */
  async openSession(
    user: AuthUser,
    data: {
      customerId?: string;
      date: string;
      externalRef: string;
      /** Alle WE-Sendungen des Kunden an diesem Tag (Sammelkontrolle) */
      allCustomerShipments?: boolean;
      /** Anzeigename/Session-Schlüssel, z. B. Kunden-Auftragsnr. RPK… */
      sessionLabel?: string;
    },
  ) {
    this.assertWarehouseRole(user);
    const mandantId = await this.scanningMandantId(user);
    const externalRefRaw = normalizeExternalRef(data.externalRef);
    if (!data.date) throw new BadRequestException('Datum fehlt');

    const { start, end } = dayBounds(data.date);
    const wantAll =
      !!data.allCustomerShipments ||
      !externalRefRaw ||
      externalRefRaw.toUpperCase() === 'ALLE' ||
      externalRefRaw === '*';

    const weClause = {
      OR: [
        { reference: { startsWith: 'WE-' } },
        { goodsDescription: { contains: 'Wareneingang', mode: 'insensitive' as const } },
      ],
    };

    if (wantAll && !data.customerId) {
      throw new BadRequestException('Für Sammelkontrolle bitte einen Kunden wählen');
    }

    let shipments = await this.prisma.shipment.findMany({
      where: {
        organizationId: user.organizationId,
        mandantId,
        ...(data.customerId ? { customerId: data.customerId } : {}),
        createdAt: { gte: start, lt: end },
        AND: [
          weClause,
          ...(wantAll
            ? []
            : [
                {
                  OR: [
                    { soloplanRef: externalRefRaw },
                    { reference: `WE-${externalRefRaw}` },
                    { reference: { equals: externalRefRaw, mode: 'insensitive' as const } },
                    { soloplanRef: { equals: externalRefRaw, mode: 'insensitive' as const } },
                  ],
                },
              ]),
        ],
      },
      include: {
        customer: { select: { id: true, name: true, customerNumber: true } },
        colli: { orderBy: { itemNumber: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Kunden-Auftragsnr. (z. B. RPK…) steckt oft nicht in Soloplan-WE → bei Kunde+Tag auf Sammel fallen
    if (!shipments.length && data.customerId && !wantAll) {
      shipments = await this.prisma.shipment.findMany({
        where: {
          organizationId: user.organizationId,
          mandantId,
          customerId: data.customerId,
          createdAt: { gte: start, lt: end },
          AND: [weClause],
        },
        include: {
          customer: { select: { id: true, name: true, customerNumber: true } },
          colli: { orderBy: { itemNumber: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    if (!shipments.length) {
      throw new NotFoundException(
        `Keine Wareneingangs-Sendungen${data.customerId ? ' für diesen Kunden' : ''} am ${data.date}`,
      );
    }

    const customerId = data.customerId || shipments[0].customerId;
    const sessionKey = normalizeExternalRef(
      data.sessionLabel || data.externalRef || (wantAll ? 'ALLE' : externalRefRaw),
    ) || 'ALLE';

    let session = await this.prisma.goodsReceiptSession.findFirst({
      where: {
        organizationId: user.organizationId,
        customerId: customerId || undefined,
        externalRef: sessionKey,
        sessionDate: start,
        status: 'OPEN',
      },
    });

    if (!session) {
      session = await this.prisma.goodsReceiptSession.create({
        data: {
          organizationId: user.organizationId,
          mandantId,
          customerId: customerId || undefined,
          externalRef: sessionKey,
          sessionDate: start,
          createdById: user.id,
          status: 'OPEN',
        },
      });
    }

    // Soll-Checks anlegen
    for (const s of shipments) {
      for (const collo of s.colli) {
        await this.prisma.goodsReceiptColloCheck.upsert({
          where: {
            sessionId_colloId: { sessionId: session.id, colloId: collo.id },
          },
          create: {
            sessionId: session.id,
            colloId: collo.id,
            status:
              collo.warehouseStatus === 'DAMAGED'
                ? 'DAMAGED'
                : collo.warehouseStatus === 'RECEIVED'
                  ? 'RECEIVED'
                  : 'PENDING',
            scannedAt: collo.receivedAt,
            scannedById: collo.receivedById,
            note: collo.warehouseNote,
          },
          update: {},
        });
      }
    }

    return this.getSession(user, session.id);
  }

  async getSession(user: AuthUser, sessionId: string) {
    this.assertWarehouseRole(user);
    const session = await this.prisma.goodsReceiptSession.findFirst({
      where: { id: sessionId, organizationId: user.organizationId },
      include: {
        customer: { select: { id: true, name: true, customerNumber: true } },
        checks: {
          include: {
            collo: {
              include: {
                shipment: {
                  select: {
                    id: true,
                    trackingNumber: true,
                    reference: true,
                    soloplanRef: true,
                    deliveryCompany: true,
                    deliveryZip: true,
                    deliveryCity: true,
                    deliveryCountry: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        surplus: { orderBy: { scannedAt: 'asc' } },
      },
    });
    if (!session) throw new NotFoundException('Kontrollsitzung nicht gefunden');

    const expected = session.checks.length;
    const received = session.checks.filter((c) => c.status === 'RECEIVED' || c.status === 'DAMAGED').length;
    const damaged = session.checks.filter((c) => c.status === 'DAMAGED').length;
    const cancelled = session.checks.filter((c) => c.status === 'CANCELLED').length;
    const pending = session.checks.filter((c) => c.status === 'PENDING' || c.status === 'MISSING').length;
    const missing =
      session.status === 'CLOSED'
        ? session.checks.filter((c) => c.status === 'MISSING' || c.status === 'PENDING').length
        : session.checks.filter((c) => c.status === 'PENDING').length;

    return {
      id: session.id,
      status: session.status,
      externalRef: session.externalRef,
      sessionDate: session.sessionDate.toISOString().slice(0, 10),
      customer: session.customer,
      notes: session.notes,
      closedAt: session.closedAt,
      documentId: session.documentId ?? null,
      summary: {
        expected,
        received,
        damaged,
        cancelled,
        pending: session.status === 'OPEN' ? pending : 0,
        missing: session.status === 'CLOSED' ? missing : session.checks.filter((c) => c.status === 'PENDING').length,
        surplus: session.surplus.length,
      },
      expectedColli: session.checks.map((c) => ({
        checkId: c.id,
        colloId: c.colloId,
        status: c.status,
        scannedAt: c.scannedAt,
        note: c.note,
        sscc: c.collo.sscc,
        itemNumber: c.collo.itemNumber,
        content: c.collo.content,
        packaging: c.collo.packaging,
        weightKg: c.collo.weightKg,
        lengthCm: c.collo.lengthCm,
        widthCm: c.collo.widthCm,
        heightCm: c.collo.heightCm,
        shipmentId: c.collo.shipment.id,
        trackingNumber: c.collo.shipment.trackingNumber,
        reference: c.collo.shipment.reference,
        deliveryCompany: c.collo.shipment.deliveryCompany,
        deliveryZip: c.collo.shipment.deliveryZip,
        deliveryCity: c.collo.shipment.deliveryCity,
        deliveryCountry: c.collo.shipment.deliveryCountry,
      })),
      surplus: session.surplus.map((s) => ({
        id: s.id,
        sscc: s.sscc,
        scannedAt: s.scannedAt,
        note: s.note,
        documentId: s.documentId,
      })),
    };
  }

  /** SSCC scannen: Soll treffen oder als Überzählig buchen. */
  async scan(
    user: AuthUser,
    sessionId: string,
    rawSscc: string,
    opts?: { damaged?: boolean; note?: string },
  ) {
    this.assertWarehouseRole(user);
    const candidates = ssccMatchCandidates(rawSscc);
    const sscc = candidates[0] || normalizeScanCode(rawSscc) || parseSsccFromScan(rawSscc);
    if (!sscc) throw new BadRequestException('Ungültige SSCC');

    const session = await this.prisma.goodsReceiptSession.findFirst({
      where: { id: sessionId, organizationId: user.organizationId },
    });
    if (!session) throw new NotFoundException('Kontrollsitzung nicht gefunden');
    if (session.status !== 'OPEN') throw new BadRequestException('Sitzung ist geschlossen');

    const check = await this.prisma.goodsReceiptColloCheck.findFirst({
      where: { sessionId, collo: { sscc: { in: candidates } } },
      include: {
        collo: {
          include: {
            shipment: {
              select: {
                id: true,
                trackingNumber: true,
                reference: true,
                deliveryCompany: true,
                deliveryZip: true,
                deliveryCity: true,
              },
            },
          },
        },
      },
    });

    if (check) {
      if (check.status === 'CANCELLED') {
        throw new BadRequestException(
          `SSCC ${check.collo.sscc || sscc} ist storniert (nicht andrucken)`,
        );
      }
      const status = opts?.damaged ? 'DAMAGED' : 'RECEIVED';
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.goodsReceiptColloCheck.update({
          where: { id: check.id },
          data: {
            status,
            scannedAt: now,
            scannedById: user.id,
            note: opts?.note || check.note,
          },
        }),
        this.prisma.shipmentCollo.update({
          where: { id: check.colloId },
          data: {
            warehouseStatus: status,
            receivedAt: now,
            receivedById: user.id,
            warehouseNote: opts?.note || undefined,
          },
        }),
      ]);
      return {
        kind: 'expected' as const,
        status,
        sscc: check.collo.sscc || sscc,
        alreadyScanned: check.status === 'RECEIVED' || check.status === 'DAMAGED',
        collo: {
          id: check.collo.id,
          itemNumber: check.collo.itemNumber,
          content: check.collo.content,
          packaging: check.collo.packaging,
          weightKg: check.collo.weightKg,
          lengthCm: check.collo.lengthCm,
          widthCm: check.collo.widthCm,
          heightCm: check.collo.heightCm,
        },
        shipment: check.collo.shipment,
        session: await this.getSession(user, sessionId),
      };
    }

    // Überzählig (nicht in Soll-Liste) – kanonische SSCC ohne AI-00 speichern
    let surplusRow = await this.prisma.goodsReceiptSurplus.findFirst({
      where: { sessionId, sscc: { in: candidates } },
    });
    const alreadySurplus = !!surplusRow;
    if (!surplusRow) {
      surplusRow = await this.prisma.goodsReceiptSurplus.create({
        data: {
          sessionId,
          sscc,
          scannedById: user.id,
          note: opts?.note || (opts?.damaged ? 'Beschädigt (überzählig)' : undefined),
        },
      });
    }

    // Falls SSCC irgendwo im System existiert – Info mitgeben
    const known = await this.prisma.shipmentCollo.findFirst({
      where: {
        sscc: { in: candidates },
        shipment: { organizationId: user.organizationId },
      },
      include: {
        shipment: {
          select: {
            id: true,
            trackingNumber: true,
            reference: true,
            soloplanRef: true,
            deliveryCompany: true,
            deliveryZip: true,
            deliveryCity: true,
            customer: { select: { name: true, customerNumber: true } },
          },
        },
      },
    });

    const photoRequired = !known && !surplusRow.documentId;

    return {
      kind: 'surplus' as const,
      status: 'SURPLUS',
      sscc,
      surplusId: surplusRow.id,
      alreadyScanned: alreadySurplus,
      photoRequired,
      hasPhoto: !!surplusRow.documentId,
      knownShipment: known
        ? {
            id: known.shipment.id,
            trackingNumber: known.shipment.trackingNumber,
            reference: known.shipment.reference,
            soloplanRef: known.shipment.soloplanRef,
            deliveryCompany: known.shipment.deliveryCompany,
            deliveryZip: known.shipment.deliveryZip,
            deliveryCity: known.shipment.deliveryCity,
            customer: known.shipment.customer,
          }
        : null,
      session: await this.getSession(user, sessionId),
    };
  }

  /**
   * Fehlende/offene Sendung stornieren → nicht andrucken (Shipment CANCELLED).
   */
  async cancelMissingCollo(
    user: AuthUser,
    sessionId: string,
    colloId: string,
    note?: string,
  ) {
    this.assertWarehouseRole(user);
    const check = await this.prisma.goodsReceiptColloCheck.findFirst({
      where: { sessionId, colloId, session: { organizationId: user.organizationId } },
      include: { collo: { select: { id: true, shipmentId: true, sscc: true } } },
    });
    if (!check) throw new NotFoundException('Packstück nicht in dieser Sitzung');
    if (check.status === 'RECEIVED' || check.status === 'DAMAGED') {
      throw new BadRequestException('Empfangene Packstücke können nicht storniert werden');
    }

    const stornoNote = note || 'Storno WE – nicht entladen / nicht andrucken';
    await this.prisma.$transaction([
      this.prisma.goodsReceiptColloCheck.update({
        where: { id: check.id },
        data: {
          status: 'CANCELLED',
          scannedById: user.id,
          note: stornoNote,
        },
      }),
      this.prisma.shipmentCollo.update({
        where: { id: colloId },
        data: {
          warehouseStatus: 'CANCELLED',
          warehouseNote: stornoNote,
        },
      }),
    ]);

    // Sendung nur stornieren, wenn alle Colli storniert sind → nicht andrucken
    await this.maybeCancelShipment(check.collo.shipmentId, stornoNote);

    return this.getSession(user, sessionId);
  }

  /**
   * Ganzen Auftrag stornieren: alle noch offenen/fehlenden Colli der Sendung in der Sitzung.
   * Empfangene/beschädigte bleiben unberührt.
   */
  async cancelMissingShipment(
    user: AuthUser,
    sessionId: string,
    shipmentId: string,
    note?: string,
  ) {
    this.assertWarehouseRole(user);
    const session = await this.prisma.goodsReceiptSession.findFirst({
      where: { id: sessionId, organizationId: user.organizationId },
      select: { id: true, status: true },
    });
    if (!session) throw new NotFoundException('Sitzung nicht gefunden');
    if (session.status !== 'OPEN') throw new BadRequestException('Sitzung ist geschlossen');

    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, organizationId: user.organizationId },
      select: { id: true, reference: true, trackingNumber: true },
    });
    if (!shipment) throw new NotFoundException('Auftrag nicht gefunden');

    const openChecks = await this.prisma.goodsReceiptColloCheck.findMany({
      where: {
        sessionId,
        status: { in: ['PENDING', 'MISSING'] },
        collo: { shipmentId },
      },
      select: { id: true, colloId: true },
    });
    if (!openChecks.length) {
      throw new BadRequestException('Keine offenen Packstücke zum Stornieren in diesem Auftrag');
    }

    const stornoNote =
      note ||
      `Storno WE Auftrag ${shipment.reference || shipment.trackingNumber} – nicht entladen / nicht andrucken`;
    const colloIds = openChecks.map((c) => c.colloId);
    const checkIds = openChecks.map((c) => c.id);

    await this.prisma.$transaction([
      this.prisma.goodsReceiptColloCheck.updateMany({
        where: { id: { in: checkIds } },
        data: {
          status: 'CANCELLED',
          scannedById: user.id,
          note: stornoNote,
        },
      }),
      this.prisma.shipmentCollo.updateMany({
        where: { id: { in: colloIds } },
        data: {
          warehouseStatus: 'CANCELLED',
          warehouseNote: stornoNote,
        },
      }),
    ]);

    await this.maybeCancelShipment(shipmentId, stornoNote);

    return this.getSession(user, sessionId);
  }

  /** Sendung CANCELLED setzen, wenn alle Colli storniert sind. */
  private async maybeCancelShipment(shipmentId: string, stornoNote: string) {
    const siblingColli = await this.prisma.shipmentCollo.findMany({
      where: { shipmentId },
      select: { warehouseStatus: true },
    });
    const allCancelled =
      siblingColli.length > 0 && siblingColli.every((c) => c.warehouseStatus === 'CANCELLED');
    if (allCancelled) {
      await this.prisma.shipment.update({
        where: { id: shipmentId },
        data: {
          status: 'CANCELLED',
          notes: stornoNote,
        },
      });
    }
  }

  async markDamaged(
    user: AuthUser,
    sessionId: string,
    colloId: string,
    note?: string,
  ) {
    this.assertWarehouseRole(user);
    const check = await this.prisma.goodsReceiptColloCheck.findFirst({
      where: { sessionId, colloId, session: { organizationId: user.organizationId } },
    });
    if (!check) throw new NotFoundException('Packstück nicht in dieser Sitzung');

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.goodsReceiptColloCheck.update({
        where: { id: check.id },
        data: {
          status: 'DAMAGED',
          scannedAt: check.scannedAt || now,
          scannedById: user.id,
          note: note || check.note || 'Beschädigt',
        },
      }),
      this.prisma.shipmentCollo.update({
        where: { id: colloId },
        data: {
          warehouseStatus: 'DAMAGED',
          receivedAt: check.scannedAt || now,
          receivedById: user.id,
          warehouseNote: note || 'Beschädigt',
        },
      }),
    ]);
    return this.getSession(user, sessionId);
  }

  /** Abmessungen / Gewicht eines Colli nach dem Scan korrigieren. */
  async updateColloDimensions(
    user: AuthUser,
    sessionId: string,
    colloId: string,
    data: {
      lengthCm?: number | null;
      widthCm?: number | null;
      heightCm?: number | null;
      weightKg?: number | null;
    },
  ) {
    this.assertWarehouseRole(user);
    const check = await this.prisma.goodsReceiptColloCheck.findFirst({
      where: { sessionId, colloId, session: { organizationId: user.organizationId } },
      include: { collo: true },
    });
    if (!check) throw new NotFoundException('Packstück nicht in dieser Sitzung');

    const prev = check.collo;
    const nextLen = data.lengthCm !== undefined ? data.lengthCm : prev.lengthCm;
    const nextWid = data.widthCm !== undefined ? data.widthCm : prev.widthCm;
    const nextHei = data.heightCm !== undefined ? data.heightCm : prev.heightCm;
    const nextWgt = data.weightKg !== undefined ? data.weightKg : prev.weightKg;

    const dimsChanged =
      nextLen !== prev.lengthCm ||
      nextWid !== prev.widthCm ||
      nextHei !== prev.heightCm ||
      nextWgt !== prev.weightKg;

    const patch: {
      lengthCm?: number | null;
      widthCm?: number | null;
      heightCm?: number | null;
      weightKg?: number | null;
    } = {};
    if (data.lengthCm !== undefined) patch.lengthCm = data.lengthCm;
    if (data.widthCm !== undefined) patch.widthCm = data.widthCm;
    if (data.heightCm !== undefined) patch.heightCm = data.heightCm;
    if (data.weightKg !== undefined) patch.weightKg = data.weightKg;

    const fmt = (l: number | null, w: number | null, h: number | null) =>
      l != null || w != null || h != null ? `${l ?? '–'}×${w ?? '–'}×${h ?? '–'} cm` : null;
    const prevDims = fmt(prev.lengthCm, prev.widthCm, prev.heightCm);
    const nextDims = fmt(nextLen ?? null, nextWid ?? null, nextHei ?? null);

    await this.prisma.$transaction(async (tx) => {
      await tx.shipmentCollo.update({
        where: { id: colloId },
        data: patch,
      });
      if (dimsChanged) {
        const baseNote = String(check.note || '')
          .replace(ETB_DIMS_CHANGED_MARKER, '')
          .replace(/Abmessungen angepasst:[^·]*/gi, '')
          .replace(/Gewicht:\s*[\d.,]+\s*kg[^·]*/gi, '')
          .replace(/[·]+/g, '·')
          .replace(/\s{2,}/g, ' ')
          .replace(/^[·\s]+|[·\s]+$/g, '')
          .trim();
        const note = [
          baseNote,
          ETB_DIMS_CHANGED_MARKER,
          nextDims
            ? `Abmessungen angepasst: ${nextDims}${
                prevDims && prevDims !== nextDims ? ` (vorher ${prevDims})` : ''
              }`
            : null,
          nextWgt != null
            ? `Gewicht: ${nextWgt} kg${
                prev.weightKg != null && prev.weightKg !== nextWgt
                  ? ` (vorher ${prev.weightKg} kg)`
                  : ''
              }`
            : null,
        ]
          .filter(Boolean)
          .join(' · ');
        await tx.goodsReceiptColloCheck.update({
          where: { id: check.id },
          data: { note },
        });
        await tx.shipmentCollo.update({
          where: { id: colloId },
          data: { warehouseNote: note },
        });
      }
    });

    return this.getSession(user, sessionId);
  }

  async attachPhotoMeta(
    user: AuthUser,
    sessionId: string,
    data: { colloId?: string; surplusId?: string; documentId: string; note?: string },
  ) {
    this.assertWarehouseRole(user);
    const session = await this.prisma.goodsReceiptSession.findFirst({
      where: { id: sessionId, organizationId: user.organizationId },
    });
    if (!session) throw new NotFoundException('Sitzung nicht gefunden');

    const doc = await this.prisma.document.findFirst({
      where: { id: data.documentId, organizationId: user.organizationId },
    });
    if (!doc) throw new NotFoundException('Dokument nicht gefunden');

    if (data.surplusId) {
      await this.prisma.goodsReceiptSurplus.updateMany({
        where: { id: data.surplusId, sessionId },
        data: { documentId: data.documentId, note: data.note },
      });
    }
    if (data.colloId && data.note) {
      await this.prisma.goodsReceiptColloCheck.updateMany({
        where: { sessionId, colloId: data.colloId },
        data: { note: data.note },
      });
      await this.prisma.shipmentCollo.update({
        where: { id: data.colloId },
        data: { warehouseNote: data.note },
      });
    }

    // Dokumenttyp auf WAREHOUSE_PHOTO setzen falls OTHER/CUSTOMER_UPLOAD
    if (doc.type === DocumentType.OTHER || doc.type === DocumentType.CUSTOMER_UPLOAD) {
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { type: DocumentType.WAREHOUSE_PHOTO },
      });
    }

    return this.getSession(user, sessionId);
  }

  /** Sitzung abschließen → fehlende Packstücke markieren, ETB-PDF + E-Mail. */
  async closeSession(user: AuthUser, sessionId: string, notes?: string) {
    this.assertWarehouseRole(user);
    const session = await this.prisma.goodsReceiptSession.findFirst({
      where: { id: sessionId, organizationId: user.organizationId },
      include: { checks: true, surplus: true },
    });
    if (!session) throw new NotFoundException('Sitzung nicht gefunden');
    if (session.status === 'CLOSED') return this.getSession(user, sessionId);

    // Unbekannte Überzählige ohne Label-Foto blockieren
    for (const s of session.surplus) {
      if (s.documentId) continue;
      const candidates = ssccMatchCandidates(s.sscc);
      const known = await this.prisma.shipmentCollo.findFirst({
        where: {
          sscc: { in: candidates.length ? candidates : [s.sscc] },
          shipment: { organizationId: user.organizationId },
        },
        select: { id: true },
      });
      if (!known) {
        throw new BadRequestException(
          `Überzähliger SSCC ${s.sscc} ist unbekannt – bitte zuerst Label-Foto aufnehmen`,
        );
      }
    }

    const pendingIds = session.checks
      .filter((c) => c.status === 'PENDING')
      .map((c) => c.id);
    if (pendingIds.length) {
      await this.prisma.goodsReceiptColloCheck.updateMany({
        where: { id: { in: pendingIds } },
        data: { status: 'MISSING' },
      });
    }

    const closedAt = new Date();
    await this.prisma.goodsReceiptSession.update({
      where: { id: sessionId },
      data: {
        status: 'CLOSED',
        closedAt,
        notes: notes || session.notes,
      },
    });

    try {
      await this.generateAndSendEntladebericht(user, sessionId);
    } catch (err: any) {
      this.logger.error(`ETB für Session ${sessionId} fehlgeschlagen: ${err?.message || err}`);
    }

    return this.getSession(user, sessionId);
  }

  /** ETB-PDF erzeugen, speichern (30 Tage), an festgelegte Empfänger mailen. */
  async generateAndSendEntladebericht(user: AuthUser, sessionId: string) {
    const session = await this.prisma.goodsReceiptSession.findFirst({
      where: { id: sessionId, organizationId: user.organizationId },
      include: {
        customer: { select: { id: true, name: true, customerNumber: true } },
        checks: {
          include: {
            collo: {
              include: {
                shipment: {
                  select: {
                    reference: true,
                    trackingNumber: true,
                    deliveryCompany: true,
                    deliveryZip: true,
                    deliveryCity: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        surplus: { orderBy: { scannedAt: 'asc' } },
      },
    });
    if (!session) throw new NotFoundException('Sitzung nicht gefunden');

    const ok = session.checks.filter((c) => c.status === 'RECEIVED').length;
    const damaged = session.checks.filter((c) => c.status === 'DAMAGED').length;
    const missing = session.checks.filter((c) => c.status === 'MISSING' || c.status === 'PENDING')
      .length;
    const cancelled = session.checks.filter((c) => c.status === 'CANCELLED').length;

    const surplusLines: EtbSurplusLine[] = [];
    for (const s of session.surplus) {
      const candidates = ssccMatchCandidates(s.sscc);
      const knownCollo = await this.prisma.shipmentCollo.findFirst({
        where: {
          sscc: { in: candidates.length ? candidates : [s.sscc] },
          shipment: { organizationId: session.organizationId },
        },
        include: {
          shipment: {
            select: {
              trackingNumber: true,
              reference: true,
              deliveryCompany: true,
              deliveryZip: true,
              deliveryCity: true,
              customer: { select: { name: true } },
            },
          },
        },
      });
      let photoPath: string | null = null;
      if (s.documentId) {
        const photoDoc = await this.prisma.document.findUnique({
          where: { id: s.documentId },
          select: { storagePath: true },
        });
        photoPath = photoDoc?.storagePath || null;
      }
      surplusLines.push({
        sscc: s.sscc,
        scannedAt: s.scannedAt,
        note: s.note,
        known: knownCollo
          ? {
              trackingNumber: knownCollo.shipment.trackingNumber,
              reference: knownCollo.shipment.reference,
              customerName: knownCollo.shipment.customer?.name,
              deliveryCompany: knownCollo.shipment.deliveryCompany,
              deliveryZip: knownCollo.shipment.deliveryZip,
              deliveryCity: knownCollo.shipment.deliveryCity,
            }
          : null,
        photoPath,
      });
    }

    const dateStr = session.sessionDate.toISOString().slice(0, 10);
    const safeRef = String(session.externalRef || 'ALLE').replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `ETB-${safeRef}-${dateStr}-${session.id.slice(-6)}.pdf`;
    const dir = join(this.uploadDir, 'entladeberichte');
    mkdirSync(dir, { recursive: true });
    const storagePath = join(dir, fileName);

    const closer = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { firstName: true, lastName: true, email: true },
    });

    await writeEntladeberichtPdf(
      {
        externalRef: session.externalRef,
        sessionDate: dateStr,
        customerName: session.customer?.name,
        customerNumber: session.customer?.customerNumber,
        closedAt: session.closedAt || new Date(),
        closedByName: closer
          ? `${closer.firstName} ${closer.lastName}`.trim() || closer.email
          : user.email,
        notes: session.notes,
        summary: {
          expected: session.checks.length,
          ok,
          damaged,
          missing,
          cancelled,
          surplus: session.surplus.length,
        },
        // Stornierte Colli nicht in den PDF-Positionen (nur Zähler in der Zusammenfassung)
        colli: session.checks
          .filter((c) => c.status !== 'CANCELLED')
          .map((c) => ({
            sscc: c.collo.sscc,
            status: c.status,
            itemNumber: c.collo.itemNumber,
            packaging: c.collo.packaging,
            content: c.collo.content,
            weightKg: c.collo.weightKg,
            lengthCm: c.collo.lengthCm,
            widthCm: c.collo.widthCm,
            heightCm: c.collo.heightCm,
            reference: c.collo.shipment.reference,
            trackingNumber: c.collo.shipment.trackingNumber,
            deliveryCompany: c.collo.shipment.deliveryCompany,
            deliveryZip: c.collo.shipment.deliveryZip,
            deliveryCity: c.collo.shipment.deliveryCity,
            scannedAt: c.scannedAt,
            note: c.note,
            dimensionsChanged: !!(c.note && c.note.includes(ETB_DIMS_CHANGED_MARKER)),
          })),
        surplus: surplusLines,
      },
      storagePath,
    );

    const doc = await this.prisma.document.create({
      data: {
        organizationId: session.organizationId,
        customerId: session.customerId || undefined,
        type: DocumentType.ENTLADEBERICHT,
        fileName,
        mimeType: 'application/pdf',
        storagePath,
        sizeBytes: statSync(storagePath).size,
        uploadedById: user.id,
      },
    });

    await this.prisma.goodsReceiptSession.update({
      where: { id: sessionId },
      data: { documentId: doc.id },
    });

    const recipients = this.etbNotifyEmails();
    const appUrl = this.config.get('APP_URL') || 'https://wog.logistikberater.at';
    const subject = `Entladebericht ${session.externalRef} · ${session.customer?.name || 'WE'} · ${dateStr}`;
    const body = [
      `Entladebericht (ETB) Wareneingangskontrolle`,
      ``,
      `Kunde: ${session.customer?.name || '–'} (${session.customer?.customerNumber || '–'})`,
      `Referenz: ${session.externalRef}`,
      `Datum: ${dateStr}`,
      `Soll ${session.checks.length} · OK ${ok} · Beschädigt ${damaged} · Fehlend ${missing} · Storniert ${cancelled} · Überzählig ${session.surplus.length}`,
      ``,
      `PDF liegt bei. Aufbewahrung im Portal: 30 Tage.`,
      `Download: ${appUrl}/api/documents/${doc.id}/download`,
      ``,
      `WOG Portal`,
    ].join('\n');

    for (const to of recipients) {
      await this.notifications.sendRaw(to, subject, body, undefined, [
        { filename: fileName, path: storagePath, contentType: 'application/pdf' },
      ]);
    }

    this.logger.log(`ETB ${doc.id} erzeugt und an ${recipients.join(', ')} gesendet`);
    return doc;
  }

  private etbNotifyEmails(): string[] {
    const raw =
      this.config.get<string>('GOODS_RECEIPT_ETB_NOTIFY_EMAILS') ||
      'info@worldofgreen.ch,mb@logistikberater.at';
    return raw
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** Geschlossenen ETB neu erzeugen und erneut mailen. */
  async resendEntladebericht(user: AuthUser, sessionId: string) {
    this.assertWarehouseRole(user);
    const session = await this.prisma.goodsReceiptSession.findFirst({
      where: { id: sessionId, organizationId: user.organizationId },
      select: { id: true, status: true },
    });
    if (!session) throw new NotFoundException('Sitzung nicht gefunden');
    if (session.status !== 'CLOSED') {
      throw new BadRequestException('ETB erst nach Abschluss der Kontrolle möglich');
    }
    const doc = await this.generateAndSendEntladebericht(user, sessionId);
    return { ok: true, documentId: doc.id, fileName: doc.fileName };
  }

  /** Geschlossene ETBs der letzten 30 Tage. */
  async listEntladeberichte(user: AuthUser, opts?: { take?: number }) {
    this.assertWarehouseRole(user);
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sessions = await this.prisma.goodsReceiptSession.findMany({
      where: {
        organizationId: user.organizationId,
        status: 'CLOSED',
        documentId: { not: null },
        closedAt: { gte: since },
      },
      include: {
        customer: { select: { id: true, name: true, customerNumber: true } },
      },
      orderBy: { closedAt: 'desc' },
      take: Math.min(opts?.take || 100, 200),
    });

    const docIds = sessions.map((s) => s.documentId!).filter(Boolean);
    const docs = docIds.length
      ? await this.prisma.document.findMany({
          where: { id: { in: docIds }, organizationId: user.organizationId },
        })
      : [];
    const byId = new Map(docs.map((d) => [d.id, d]));

    return sessions.map((s) => {
      const d = s.documentId ? byId.get(s.documentId) : undefined;
      return {
        sessionId: s.id,
        externalRef: s.externalRef,
        sessionDate: s.sessionDate.toISOString().slice(0, 10),
        closedAt: s.closedAt,
        customer: s.customer,
        documentId: s.documentId,
        fileName: d?.fileName || null,
        sizeBytes: d?.sizeBytes || null,
        createdAt: d?.createdAt || s.closedAt,
      };
    });
  }

  /** ETBs älter als 30 Tage löschen (Datei + Document + Session-Verweis). */
  async purgeExpiredEntladeberichte(olderThanDays = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    const docs = await this.prisma.document.findMany({
      where: {
        type: DocumentType.ENTLADEBERICHT,
        createdAt: { lt: cutoff },
      },
      select: { id: true, storagePath: true },
      take: 200,
    });
    let deleted = 0;
    for (const d of docs) {
      await this.prisma.goodsReceiptSession.updateMany({
        where: { documentId: d.id },
        data: { documentId: null },
      });
      if (d.storagePath && existsSync(d.storagePath)) {
        try {
          unlinkSync(d.storagePath);
        } catch (err: any) {
          this.logger.warn(`ETB-Datei nicht löschbar ${d.storagePath}: ${err?.message || err}`);
        }
      }
      await this.prisma.document.delete({ where: { id: d.id } });
      deleted += 1;
    }
    if (deleted) this.logger.log(`ETB-Retention: ${deleted} Dokument(e) älter als ${olderThanDays} Tage entfernt`);
    return { deleted };
  }
}
