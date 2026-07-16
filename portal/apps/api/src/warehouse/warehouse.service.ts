import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentType, UserRole } from '@prisma/client';
import { workdayWindow, formatDateOnly } from '@wog/shared';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { assertMandantAccess, mandantFilter } from '../common/access';
import { AuditService } from '../audit/audit.service';

const STAFF: UserRole[] = [
  UserRole.ORG_ADMIN,
  UserRole.MANDANT_DISPATCHER,
  UserRole.WAREHOUSE_STAFF,
];

@Injectable()
export class WarehouseService {
  private uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private config: ConfigService,
  ) {
    this.uploadDir = join(
      this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads'),
      'warehouse',
    );
    if (!existsSync(this.uploadDir)) mkdirSync(this.uploadDir, { recursive: true });
  }

  private assertStaff(user: AuthUser) {
    if (!STAFF.includes(user.role)) {
      throw new ForbiddenException('Nur für interne WOG-Mitarbeiter');
    }
  }

  /** Touren für 10 Werktage zurück + 2 vor, inkl. Sendungen (auto-sync). */
  async listTours(user: AuthUser) {
    this.assertStaff(user);
    const days = workdayWindow({ past: 10, future: 2 });
    const mandanten = await this.prisma.mandant.findMany({
      where: {
        organizationId: user.organizationId,
        active: true,
        ...(user.role === UserRole.ORG_ADMIN
          ? {}
          : { id: { in: user.mandantIds.length ? user.mandantIds : ['__none__'] } }),
      },
      orderBy: { code: 'asc' },
    });

    for (const day of days) {
      for (const mandant of mandanten) {
        await this.ensureTourSynced(user.organizationId, mandant.id, mandant.name, day);
      }
    }

    const from = days[0];
    const to = days[days.length - 1];
    return this.prisma.tour.findMany({
      where: {
        organizationId: user.organizationId,
        date: { gte: from, lte: to },
        ...mandantFilter(user),
      },
      include: {
        mandant: { select: { id: true, code: true, name: true } },
        shipments: {
          select: { id: true },
        },
        _count: { select: { shipments: true, notesList: true } },
      },
      orderBy: [{ date: 'asc' }, { name: 'asc' }],
    });
  }

  async getTour(user: AuthUser, id: string) {
    this.assertStaff(user);
    const tour = await this.prisma.tour.findFirst({
      where: { id, organizationId: user.organizationId, ...mandantFilter(user) },
      include: {
        mandant: { select: { id: true, code: true, name: true } },
        shipments: {
          orderBy: { sortOrder: 'asc' },
          include: {
            shipment: {
              include: {
                customer: { select: { id: true, name: true, customerNumber: true } },
                documents: {
                  where: { type: DocumentType.WAREHOUSE_PHOTO },
                  orderBy: { createdAt: 'desc' },
                  select: {
                    id: true,
                    fileName: true,
                    mimeType: true,
                    sizeBytes: true,
                    createdAt: true,
                  },
                },
                warehouseNotes: {
                  orderBy: { createdAt: 'desc' },
                  take: 50,
                },
              },
            },
          },
        },
      },
    });
    if (!tour) throw new NotFoundException('Tour nicht gefunden');
    return tour;
  }

  async addNote(
    user: AuthUser,
    tourId: string,
    shipmentId: string,
    body: string,
  ) {
    this.assertStaff(user);
    if (!body?.trim()) throw new BadRequestException('Kommentar fehlt');
    const tour = await this.getTour(user, tourId);
    const link = tour.shipments.find((s) => s.shipmentId === shipmentId);
    if (!link) throw new BadRequestException('Sendung gehört nicht zu dieser Tour');

    const note = await this.prisma.warehouseNote.create({
      data: {
        shipmentId,
        tourId,
        body: body.trim(),
        createdById: user.id,
      },
    });
    await this.audit.log(user.id, 'warehouse.note', 'WarehouseNote', note.id, {
      tourId,
      shipmentId,
    });
    return note;
  }

  async addPhoto(
    user: AuthUser,
    tourId: string,
    shipmentId: string,
    file: Express.Multer.File,
  ) {
    this.assertStaff(user);
    if (!file) throw new BadRequestException('Datei fehlt');
    const tour = await this.getTour(user, tourId);
    const link = tour.shipments.find((s) => s.shipmentId === shipmentId);
    if (!link) throw new BadRequestException('Sendung gehört nicht zu dieser Tour');

    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = join(this.uploadDir, safeName);
    await pipeline(Readable.from(file.buffer), createWriteStream(storagePath));

    const doc = await this.prisma.document.create({
      data: {
        organizationId: user.organizationId,
        shipmentId,
        customerId: link.shipment.customerId,
        type: DocumentType.WAREHOUSE_PHOTO,
        fileName: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
        storagePath,
        sizeBytes: file.size,
        uploadedById: user.id,
      },
    });
    await this.audit.log(user.id, 'warehouse.photo', 'Document', doc.id, {
      tourId,
      shipmentId,
    });
    return doc;
  }

  private async ensureTourSynced(
    organizationId: string,
    mandantId: string,
    mandantName: string,
    day: Date,
  ) {
    const dateOnly = new Date(formatDateOnly(day) + 'T00:00:00.000Z');
    const label = `${formatDateOnly(day).split('-').reverse().join('.')}`;
    const tour = await this.prisma.tour.upsert({
      where: {
        organizationId_mandantId_date: { organizationId, mandantId, date: dateOnly },
      },
      update: {},
      create: {
        organizationId,
        mandantId,
        date: dateOnly,
        name: `Tour ${mandantName} ${label}`,
      },
    });

    const dayStart = dateOnly;
    const dayEnd = new Date(dateOnly);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const shipments = await this.prisma.shipment.findMany({
      where: {
        organizationId,
        mandantId,
        OR: [
          { pickupDate: { gte: dayStart, lt: dayEnd } },
          { deliveryDate: { gte: dayStart, lt: dayEnd } },
        ],
      },
      select: { id: true },
    });

    for (const [idx, s] of shipments.entries()) {
      await this.prisma.tourShipment.upsert({
        where: { tourId_shipmentId: { tourId: tour.id, shipmentId: s.id } },
        update: { sortOrder: idx },
        create: { tourId: tour.id, shipmentId: s.id, sortOrder: idx },
      });
    }

    return tour;
  }

  /** Hilfsfunktion für Seed/Tests – nicht im Controller. */
  async linkShipment(user: AuthUser, tourId: string, shipmentId: string) {
    this.assertStaff(user);
    const tour = await this.prisma.tour.findFirst({
      where: { id: tourId, organizationId: user.organizationId },
    });
    if (!tour) throw new NotFoundException();
    assertMandantAccess(user, tour.mandantId);
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, organizationId: user.organizationId, mandantId: tour.mandantId },
    });
    if (!shipment) throw new NotFoundException('Sendung nicht gefunden');
    return this.prisma.tourShipment.upsert({
      where: { tourId_shipmentId: { tourId, shipmentId } },
      update: {},
      create: { tourId, shipmentId },
    });
  }
}
