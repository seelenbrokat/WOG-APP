import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { ParsedTourStopStatus } from './telematics-xml.parser';

@Injectable()
export class LoadingUnitService {
  private readonly logger = new Logger(LoadingUnitService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Bucht LoadingUnitExchange aus TourStopStatus.
   * Nur aktive PackagingType-Matchcodes (CSV) werden real gebucht.
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

      const existing = await this.prisma.loadingUnitPosting.findUnique({
        where: {
          organizationId_sourceFile_packagingMatchcode: {
            organizationId,
            sourceFile,
            packagingMatchcode: matchcode,
          },
        },
      });
      if (existing) continue;

      if (ex.given === 0 && ex.taken === 0) {
        skippedZero += 1;
        continue;
      }

      const packaging = await this.resolvePackagingType(organizationId, matchcode);
      if (!packaging) {
        skippedUnknown += 1;
        this.logger.warn(
          `Lademittel übersprungen (nicht in PackagingType-CSV): ${matchcode} @ ${sourceFile}`,
        );
        await this.prisma.loadingUnitPosting.create({
          data: {
            organizationId,
            packagingMatchcode: matchcode,
            given: ex.given,
            taken: ex.taken,
            balanceDelta: ex.given - ex.taken,
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

      await this.prisma.loadingUnitPosting.create({
        data: {
          organizationId,
          packagingTypeId: packaging.id,
          packagingMatchcode: packaging.matchcode,
          packagingLabel: packaging.label,
          given: ex.given,
          taken: ex.taken,
          balanceDelta: ex.given - ex.taken,
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
        status: 'BOOKED',
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
      _sum: { given: true, taken: true, balanceDelta: true },
      _count: { _all: true },
      _max: { occurredAt: true },
    });

    const balances = rows
      .map((r) => {
        const given = r._sum.given || 0;
        const taken = r._sum.taken || 0;
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
          postings: r._count._all,
          lastAt: r._max.occurredAt,
        };
      })
      .filter((r) => (opts?.includeZero ? true : r.given !== 0 || r.taken !== 0))
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
        return acc;
      },
      { given: 0, taken: 0, balance: 0 },
    );

    return { balances, totals, count: balances.length };
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
}
