import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { zurichDayKey, zurichDayRange } from '../common/zurich-date';
import { parseTourXml } from './tour-xml.parser';

@Injectable()
export class TourService {
  private readonly logger = new Logger(TourService.name);
  private inboundDirs: string[];

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.inboundDirs = [
      join(sftpInbound, 'soloplan', 'tours'),
      join(sftpInbound, 'soloplan', 'business-partners'),
      // Intouch liefert StdTelematics-Touren hierher
      join(sftpInbound, 'intouch', 'meldungen'),
    ];
  }

  async processInboundDir(organizationId?: string) {
    const org =
      (organizationId
        ? await this.prisma.organization.findUnique({ where: { id: organizationId } })
        : null) ||
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } }));
    if (!org) return { processed: 0, imported: 0, deleted: 0 };

    let processed = 0;
    let imported = 0;
    let deleted = 0;

    for (const dir of this.inboundDirs) {
      if (!existsSync(dir)) continue;
      const processedDir = join(dir, 'processed');
      if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });

      const files = readdirSync(dir)
        .filter((f) => {
          const lower = f.toLowerCase();
          return lower.endsWith('.xml') && lower.includes('tour_');
        })
        .sort();

      for (const fileName of files) {
        const full = join(dir, fileName);
        try {
          const xml = readFileSync(full, 'utf8');
          const result = await this.importTourXml(org.id, xml, fileName);
          processed += 1;
          if (result.action === 'Delete') deleted += 1;
          else imported += 1;
          renameSync(full, join(processedDir, `${Date.now()}_${fileName}`));
          this.logger.log(`Tour import ${fileName}: ${result.tourNumber} (${result.action})`);
        } catch (err: any) {
          this.logger.error(`Tour import failed ${fileName}`, err?.message || err);
        }
      }
    }

    return { processed, imported, deleted };
  }

  /** Standard-Mandant für Soloplan-Touren (WOG Logistics AG / code AG). */
  async resolveDefaultMandantId(organizationId: string): Promise<string | undefined> {
    const code = this.config.get('DEFAULT_TOUR_MANDANT_CODE') || 'AG';
    const mandant =
      (await this.prisma.mandant.findFirst({
        where: { organizationId, code, active: true },
      })) ||
      (await this.prisma.mandant.findFirst({
        where: { organizationId, active: true },
        orderBy: { code: 'asc' },
      }));
    return mandant?.id;
  }

  async importTourXml(organizationId: string, xml: string, fileName?: string) {
    const parsed = parseTourXml(xml, fileName);
    if (!parsed) throw new Error('Ungültiges Tour-XML');

    const { header } = parsed;
    let vehicleId: string | undefined;
    const mandantId = await this.resolveDefaultMandantId(organizationId);

    if (header.vehicleId) {
      const vehicle = await this.prisma.vehicle.upsert({
        where: {
          organizationId_soloplanVehicleId: {
            organizationId,
            soloplanVehicleId: header.vehicleId,
          },
        },
        create: {
          organizationId,
          mandantId,
          soloplanVehicleId: header.vehicleId,
          number: parsed.truckNumber || header.vehicleId,
          matchcode: parsed.truckMatchcode,
          licensePlate: parsed.truckLicensePlate,
        },
        update: {
          number: parsed.truckNumber || header.vehicleId,
          matchcode: parsed.truckMatchcode || undefined,
          licensePlate: parsed.truckLicensePlate || undefined,
          mandantId: mandantId || undefined,
          active: true,
        },
      });
      vehicleId = vehicle.id;
    }

    if (!parsed.hasData || header.action === 'Delete') {
      const existing = await this.prisma.tour.findUnique({
        where: {
          organizationId_soloplanTourId: {
            organizationId,
            soloplanTourId: header.tourId,
          },
        },
      });
      if (existing) {
        await this.prisma.tour.update({
          where: { id: existing.id },
          data: {
            lastAction: 'Delete',
            status: 'CANCELLED',
            lastSendDate: header.sendDate,
            lastFileName: fileName,
            vehicleId: vehicleId || existing.vehicleId,
          },
        });
      } else {
        await this.prisma.tour.create({
          data: {
            organizationId,
            soloplanTourId: header.tourId,
            tourNumber: header.tourNumber,
            lastAction: 'Delete',
            status: 'CANCELLED',
            lastSendDate: header.sendDate,
            lastFileName: fileName,
            vehicleId,
          },
        });
      }
      return { tourNumber: header.tourNumber, action: 'Delete' as const };
    }

    const tour = await this.prisma.tour.upsert({
      where: {
        organizationId_soloplanTourId: {
          organizationId,
          soloplanTourId: header.tourId,
        },
      },
      create: {
        organizationId,
        mandantId,
        soloplanTourId: header.tourId,
        tourNumber: header.tourNumber,
        lastAction: header.action,
        status: 'PLANNED',
        caption: parsed.caption,
        infoText: parsed.infoText,
        targetStart: parsed.targetStart,
        targetEnd: parsed.targetEnd,
        targetLoadKm: parsed.targetLoadKm,
        driverName: parsed.driverName,
        driverFirstName: parsed.driverFirstName,
        driverLastName: parsed.driverLastName,
        driverTelematicsId: parsed.driverTelematicsId,
        vehicleId,
        dispatcherName: parsed.dispatcherName,
        dispatcherEmail: parsed.dispatcherEmail,
        dispatcherPhone: parsed.dispatcherPhone,
        stopCount: parsed.stops.length,
        orderCount: parsed.consignments.length,
        lastSendDate: header.sendDate,
        lastFileName: fileName,
      },
      update: {
        tourNumber: header.tourNumber,
        lastAction: header.action,
        status: 'PLANNED',
        mandantId: mandantId || undefined,
        caption: parsed.caption,
        infoText: parsed.infoText,
        targetStart: parsed.targetStart,
        targetEnd: parsed.targetEnd,
        targetLoadKm: parsed.targetLoadKm,
        driverName: parsed.driverName,
        driverFirstName: parsed.driverFirstName,
        driverLastName: parsed.driverLastName,
        driverTelematicsId: parsed.driverTelematicsId,
        vehicleId,
        dispatcherName: parsed.dispatcherName,
        dispatcherEmail: parsed.dispatcherEmail,
        dispatcherPhone: parsed.dispatcherPhone,
        stopCount: parsed.stops.length,
        orderCount: parsed.consignments.length,
        lastSendDate: header.sendDate,
        lastFileName: fileName,
      },
    });

    await this.prisma.tourStop.deleteMany({ where: { tourId: tour.id } });
    await this.prisma.tourConsignment.deleteMany({ where: { tourId: tour.id } });

    if (parsed.stops.length) {
      await this.prisma.tourStop.createMany({
        data: parsed.stops.map((s) => ({
          tourId: tour.id,
          soloplanTourStopId: s.soloplanTourStopId,
          sequence: s.sequence,
          stopType: s.stopType,
          transportOrderNumber: s.transportOrderNumber,
          name: s.name,
          street: s.street,
          zip: s.zip,
          city: s.city,
          country: s.country,
          latitude: s.latitude,
          longitude: s.longitude,
          targetStart: s.targetStart,
          targetEnd: s.targetEnd,
          activityDescription: s.activityDescription,
          phone: s.phone,
        })),
      });
    }

    if (parsed.consignments.length) {
      await this.prisma.tourConsignment.createMany({
        data: parsed.consignments.map((c) => ({
          tourId: tour.id,
          soloplanOrderNumber: c.soloplanOrderNumber,
          externalConsignmentNumber: c.externalConsignmentNumber,
          senderName: c.senderName,
          senderBpNumber: c.senderBpNumber,
          receiverName: c.receiverName,
          loadingUnits: c.loadingUnits ?? undefined,
        })),
      });
    }

    return { tourNumber: header.tourNumber, action: header.action, tourId: tour.id };
  }

  listTours(
    user: AuthUser,
    opts?: {
      vehicleId?: string;
      mandantId?: string;
      date?: string;
      q?: string;
      includeCancelled?: boolean;
    },
  ) {
    if (user.role === UserRole.CUSTOMER_USER) {
      throw new NotFoundException();
    }
    const where: Record<string, unknown> = { organizationId: user.organizationId };
    if (opts?.vehicleId) where.vehicleId = opts.vehicleId;
    if (opts?.mandantId) where.mandantId = opts.mandantId;
    if (!opts?.includeCancelled) where.status = { not: 'CANCELLED' };
    if (opts?.date) {
      const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : zurichDayKey(new Date(opts.date));
      if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
        const range = zurichDayRange(dayKey);
        where.targetStart = { gte: range.from, lt: range.to };
      }
    }
    const q = opts?.q?.trim();
    if (q) {
      where.OR = [
        { tourNumber: { contains: q, mode: 'insensitive' } },
        { driverName: { contains: q, mode: 'insensitive' } },
        { dispatcherName: { contains: q, mode: 'insensitive' } },
        { caption: { contains: q, mode: 'insensitive' } },
        { vehicle: { licensePlate: { contains: q, mode: 'insensitive' } } },
        { vehicle: { number: { contains: q, mode: 'insensitive' } } },
        { vehicle: { matchcode: { contains: q, mode: 'insensitive' } } },
      ];
    }
    return this.prisma.tour.findMany({
      where,
      include: {
        vehicle: true,
        mandant: { select: { id: true, code: true, name: true } },
        stops: { orderBy: { sequence: 'asc' }, take: 8 },
        _count: { select: { stops: true, consignments: true } },
      },
      orderBy: [{ targetStart: 'desc' }, { tourNumber: 'desc' }],
      take: 200,
    });
  }

  async getTour(user: AuthUser, id: string) {
    if (user.role === UserRole.CUSTOMER_USER) throw new NotFoundException();
    const tour = await this.prisma.tour.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        vehicle: true,
        mandant: { select: { id: true, code: true, name: true } },
        stops: { orderBy: { sequence: 'asc' } },
        consignments: { orderBy: { soloplanOrderNumber: 'asc' } },
      },
    });
    if (!tour) throw new NotFoundException('Tour nicht gefunden');
    return tour;
  }

  listVehicles(user: AuthUser, opts?: { mandantId?: string }) {
    if (user.role === UserRole.CUSTOMER_USER) throw new NotFoundException();
    return this.prisma.vehicle.findMany({
      where: {
        organizationId: user.organizationId,
        active: true,
        ...(opts?.mandantId ? { mandantId: opts.mandantId } : {}),
      },
      include: {
        mandant: { select: { id: true, code: true, name: true } },
        tours: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: { targetStart: 'desc' },
          take: 5,
          select: {
            id: true,
            tourNumber: true,
            caption: true,
            status: true,
            telematicsStatus: true,
            targetStart: true,
            driverName: true,
            stopCount: true,
            orderCount: true,
          },
        },
        _count: {
          select: { tours: { where: { status: { not: 'CANCELLED' } } } },
        },
      },
      orderBy: [{ licensePlate: 'asc' }, { matchcode: 'asc' }],
    });
  }

  /**
   * Dispo-Dashboard: Tour-/Zustellungsfortschritt je Mandant.
   * Standard: nur Touren mit Startdatum = heute (Europe/Zurich).
   * Zustellung „erledigt“ = UnloadingFinished | UnloadingPlaceLeft.
   */
  async opsDashboard(user: AuthUser, opts?: { mandantId?: string; date?: string }) {
    if (user.role === UserRole.CUSTOMER_USER) throw new NotFoundException();
    const mandantFilter = opts?.mandantId ? { mandantId: opts.mandantId } : {};
    const orgId = user.organizationId;
    const day =
      opts?.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : zurichDayKey(new Date());
    const range = zurichDayRange(day);
    const startFilter = { targetStart: { gte: range.from, lt: range.to } };

    const [tours, consignments, vehiclesGps, mandanten] = await Promise.all([
      this.prisma.tour.findMany({
        where: {
          organizationId: orgId,
          status: { not: 'CANCELLED' },
          ...mandantFilter,
          ...startFilter,
        },
        select: { id: true, status: true, telematicsStatus: true, orderCount: true },
      }),
      this.prisma.tourConsignment.findMany({
        where: {
          tour: {
            organizationId: orgId,
            status: { not: 'CANCELLED' },
            ...mandantFilter,
            ...startFilter,
          },
        },
        select: { status: true },
      }),
      this.prisma.vehicle.count({
        where: {
          organizationId: orgId,
          active: true,
          lastLatitude: { not: null },
          ...mandantFilter,
        },
      }),
      this.prisma.mandant.findMany({
        where: { organizationId: orgId, active: true },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const doneStatuses = new Set(['UnloadingFinished', 'UnloadingPlaceLeft']);
    const inProgressStatuses = new Set([
      'LoadingStart',
      'LoadingFinished',
      'LoadingPlaceLeft',
      'UnloadingStart',
    ]);

    let deliveriesDone = 0;
    let deliveriesInProgress = 0;
    let deliveriesOpen = 0;
    for (const c of consignments) {
      if (!c.status) deliveriesOpen += 1;
      else if (doneStatuses.has(c.status)) deliveriesDone += 1;
      else if (inProgressStatuses.has(c.status)) deliveriesInProgress += 1;
      else deliveriesOpen += 1;
    }
    const deliveriesTotal = consignments.length;
    const percentDone =
      deliveriesTotal > 0 ? Math.round((deliveriesDone / deliveriesTotal) * 1000) / 10 : 0;

    const tourStats = {
      total: tours.length,
      planned: tours.filter((t) => t.status === 'PLANNED').length,
      active: tours.filter((t) => t.status === 'ACTIVE' || t.telematicsStatus === 'Started').length,
      completed: tours.filter((t) => t.status === 'COMPLETED' || t.telematicsStatus === 'Finished')
        .length,
    };

    return {
      mandantId: opts?.mandantId || null,
      date: day,
      mandanten,
      tours: tourStats,
      deliveries: {
        total: deliveriesTotal,
        done: deliveriesDone,
        inProgress: deliveriesInProgress,
        open: deliveriesOpen,
        percentDone,
      },
      vehiclesWithGps: vehiclesGps,
    };
  }

  /**
   * Abweichungs-Cockpit: verspätete Zustellungen, fehlende Telematik, offene WE.
   */
  async exceptionsCockpit(user: AuthUser, opts?: { mandantId?: string; date?: string }) {
    if (user.role === UserRole.CUSTOMER_USER || user.role === UserRole.PARTNER) {
      throw new NotFoundException();
    }
    const mandantFilter = opts?.mandantId ? { mandantId: opts.mandantId } : {};
    const orgId = user.organizationId;
    const day =
      opts?.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : zurichDayKey(new Date());
    const range = zurichDayRange(day);
    const startFilter = { targetStart: { gte: range.from, lt: range.to } };
    const now = new Date();
    const staleBefore = new Date(now.getTime() - 45 * 60 * 1000);
    const doneStatuses = new Set(['UnloadingFinished', 'UnloadingPlaceLeft']);

    const [tours, openWe] = await Promise.all([
      this.prisma.tour.findMany({
        where: {
          organizationId: orgId,
          status: { not: 'CANCELLED' },
          ...mandantFilter,
          ...startFilter,
        },
        select: {
          id: true,
          tourNumber: true,
          status: true,
          telematicsStatus: true,
          lastStatusAt: true,
          targetEnd: true,
          driverName: true,
          vehicle: {
            select: {
              licensePlate: true,
              lastLocationAt: true,
            },
          },
          stops: {
            orderBy: { sequence: 'asc' },
            select: {
              id: true,
              sequence: true,
              name: true,
              city: true,
              targetEnd: true,
              transportOrderNumber: true,
            },
          },
          consignments: {
            select: {
              id: true,
              soloplanOrderNumber: true,
              receiverName: true,
              status: true,
              lastStatusAt: true,
            },
          },
        },
        orderBy: { tourNumber: 'asc' },
        take: 300,
      }),
      this.prisma.goodsReceiptSession.findMany({
        where: {
          organizationId: orgId,
          status: 'OPEN',
          ...(opts?.mandantId ? { mandantId: opts.mandantId } : {}),
        },
        include: {
          customer: { select: { id: true, name: true, customerNumber: true } },
          _count: { select: { checks: true } },
        },
        orderBy: { sessionDate: 'desc' },
        take: 100,
      }),
    ]);

    const delayed: Array<{
      tourId: string;
      tourNumber: string;
      driverName: string | null;
      vehiclePlate: string | null;
      orderNumber: string | null;
      receiverName: string | null;
      consignmentStatus: string | null;
      targetEnd: string | null;
      minutesLate: number;
    }> = [];

    for (const tour of tours) {
      for (const c of tour.consignments) {
        if (c.status && doneStatuses.has(c.status)) continue;
        const stop =
          tour.stops.find((s) => s.transportOrderNumber === c.soloplanOrderNumber) ||
          tour.stops[tour.stops.length - 1];
        const targetEnd = stop?.targetEnd || tour.targetEnd;
        if (!targetEnd || targetEnd >= now) continue;
        delayed.push({
          tourId: tour.id,
          tourNumber: tour.tourNumber,
          driverName: tour.driverName,
          vehiclePlate: tour.vehicle?.licensePlate || null,
          orderNumber: c.soloplanOrderNumber,
          receiverName: c.receiverName,
          consignmentStatus: c.status,
          targetEnd: targetEnd.toISOString(),
          minutesLate: Math.round((now.getTime() - targetEnd.getTime()) / 60_000),
        });
      }
    }
    delayed.sort((a, b) => b.minutesLate - a.minutesLate);

    const staleTelematics = tours
      .filter((t) => t.status === 'ACTIVE' || t.telematicsStatus === 'Started')
      .filter((t) => {
        const last = t.lastStatusAt || t.vehicle?.lastLocationAt;
        return !last || last < staleBefore;
      })
      .map((t) => {
        const last = t.lastStatusAt || t.vehicle?.lastLocationAt || null;
        return {
          tourId: t.id,
          tourNumber: t.tourNumber,
          status: t.status,
          telematicsStatus: t.telematicsStatus,
          driverName: t.driverName,
          vehiclePlate: t.vehicle?.licensePlate || null,
          lastStatusAt: last?.toISOString() || null,
          minutesSinceUpdate: last
            ? Math.round((now.getTime() - last.getTime()) / 60_000)
            : null,
        };
      })
      .sort((a, b) => (b.minutesSinceUpdate ?? 9999) - (a.minutesSinceUpdate ?? 9999));

    return {
      mandantId: opts?.mandantId || null,
      date: day,
      staleThresholdMinutes: 45,
      delayed: delayed.slice(0, 80),
      staleTelematics: staleTelematics.slice(0, 80),
      openGoodsReceipts: openWe.map((s) => ({
        id: s.id,
        externalRef: s.externalRef,
        sessionDate: s.sessionDate.toISOString(),
        customerName: s.customer?.name || null,
        customerNumber: s.customer?.customerNumber || null,
        checkCount: s._count.checks,
        createdAt: s.createdAt.toISOString(),
      })),
      counts: {
        delayed: delayed.length,
        staleTelematics: staleTelematics.length,
        openGoodsReceipts: openWe.length,
      },
    };
  }

  private partnerBpKeys(partner: {
    soloplanBusinessPartnerId: string | null;
    matchcode: string | null;
    code: string;
  }) {
    return [partner.soloplanBusinessPartnerId, partner.matchcode, partner.code].filter(
      (v): v is string => Boolean(v && String(v).trim()),
    );
  }

  async resolvePartnerForUser(user: AuthUser) {
    if (user.role !== UserRole.PARTNER) return null;
    return this.prisma.partner.findFirst({
      where: { userId: user.id, organizationId: user.organizationId, active: true },
    });
  }

  /** Partner-Self-Service: Touren mit eigenen Sendungen (Absender-BP). */
  async listPartnerTours(user: AuthUser, opts?: { date?: string }) {
    if (user.role !== UserRole.PARTNER) throw new NotFoundException();
    const partner = await this.resolvePartnerForUser(user);
    if (!partner) throw new ForbiddenException('Kein Partnerkonto verknüpft');
    const keys = this.partnerBpKeys(partner);
    if (!keys.length) return [];

    const where: Record<string, unknown> = {
      organizationId: user.organizationId,
      status: { not: 'CANCELLED' },
      consignments: { some: { senderBpNumber: { in: keys } } },
    };
    if (opts?.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
      const range = zurichDayRange(opts.date);
      where.targetStart = { gte: range.from, lt: range.to };
    }

    return this.prisma.tour.findMany({
      where,
      include: {
        vehicle: {
          select: { id: true, licensePlate: true, number: true, matchcode: true },
        },
        mandant: { select: { id: true, code: true, name: true } },
        stops: { orderBy: { sequence: 'asc' } },
        consignments: {
          where: { senderBpNumber: { in: keys } },
          orderBy: { soloplanOrderNumber: 'asc' },
        },
      },
      orderBy: [{ targetStart: 'desc' }, { tourNumber: 'desc' }],
      take: 100,
    });
  }

  async getPartnerTour(user: AuthUser, id: string) {
    if (user.role !== UserRole.PARTNER) throw new NotFoundException();
    const partner = await this.resolvePartnerForUser(user);
    if (!partner) throw new ForbiddenException('Kein Partnerkonto verknüpft');
    const keys = this.partnerBpKeys(partner);
    const tour = await this.prisma.tour.findFirst({
      where: {
        id,
        organizationId: user.organizationId,
        consignments: { some: { senderBpNumber: { in: keys } } },
      },
      include: {
        vehicle: true,
        mandant: { select: { id: true, code: true, name: true } },
        stops: { orderBy: { sequence: 'asc' } },
        consignments: {
          where: { senderBpNumber: { in: keys } },
          orderBy: { soloplanOrderNumber: 'asc' },
        },
      },
    });
    if (!tour) throw new NotFoundException('Tour nicht gefunden');
    return tour;
  }
}
