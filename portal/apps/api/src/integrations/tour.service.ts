import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
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

  async importTourXml(organizationId: string, xml: string, fileName?: string) {
    const parsed = parseTourXml(xml, fileName);
    if (!parsed) throw new Error('Ungültiges Tour-XML');

    const { header } = parsed;
    let vehicleId: string | undefined;

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
          soloplanVehicleId: header.vehicleId,
          number: parsed.truckNumber || header.vehicleId,
          matchcode: parsed.truckMatchcode,
          licensePlate: parsed.truckLicensePlate,
        },
        update: {
          number: parsed.truckNumber || header.vehicleId,
          matchcode: parsed.truckMatchcode || undefined,
          licensePlate: parsed.truckLicensePlate || undefined,
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
        })),
      });
    }

    return { tourNumber: header.tourNumber, action: header.action, tourId: tour.id };
  }

  listTours(
    user: AuthUser,
    opts?: { vehicleId?: string; date?: string; q?: string; includeCancelled?: boolean },
  ) {
    if (user.role === UserRole.CUSTOMER_USER) {
      throw new NotFoundException();
    }
    const where: Record<string, unknown> = { organizationId: user.organizationId };
    if (opts?.vehicleId) where.vehicleId = opts.vehicleId;
    if (!opts?.includeCancelled) where.status = { not: 'CANCELLED' };
    if (opts?.date) {
      const day = new Date(opts.date);
      if (!Number.isNaN(day.getTime())) {
        const start = new Date(day);
        start.setUTCHours(0, 0, 0, 0);
        const end = new Date(day);
        end.setUTCHours(23, 59, 59, 999);
        where.targetStart = { gte: start, lte: end };
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
        stops: { orderBy: { sequence: 'asc' } },
        consignments: { orderBy: { soloplanOrderNumber: 'asc' } },
      },
    });
    if (!tour) throw new NotFoundException('Tour nicht gefunden');
    return tour;
  }

  listVehicles(user: AuthUser) {
    if (user.role === UserRole.CUSTOMER_USER) throw new NotFoundException();
    return this.prisma.vehicle.findMany({
      where: { organizationId: user.organizationId, active: true },
      include: {
        tours: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: { targetStart: 'desc' },
          take: 5,
          select: {
            id: true,
            tourNumber: true,
            caption: true,
            status: true,
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
}
