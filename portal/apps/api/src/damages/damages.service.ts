import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DamageStatus, DocumentType, UserRole } from '@prisma/client';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { mandantFilter } from '../common/access';
import { AuditService } from '../audit/audit.service';

const STAFF: UserRole[] = [
  UserRole.ORG_ADMIN,
  UserRole.MANDANT_DISPATCHER,
  UserRole.WAREHOUSE_STAFF,
];

export type CreateDamageInput = {
  title: string;
  description: string;
  shipmentId?: string;
  location?: string;
};

@Injectable()
export class DamagesService {
  private uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private config: ConfigService,
  ) {
    this.uploadDir = join(
      this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads'),
      'damages',
    );
    if (!existsSync(this.uploadDir)) mkdirSync(this.uploadDir, { recursive: true });
  }

  private assertStaff(user: AuthUser) {
    if (!STAFF.includes(user.role)) {
      throw new ForbiddenException('Nur für interne WOG-Mitarbeiter');
    }
  }

  async list(user: AuthUser) {
    this.assertStaff(user);
    const mf = mandantFilter(user);
    return this.prisma.damage.findMany({
      where: {
        organizationId: user.organizationId,
        ...(mf.mandantId
          ? {
              OR: [
                { shipmentId: null },
                { shipment: { mandantId: mf.mandantId } },
              ],
            }
          : {}),
      },
      include: {
        shipment: {
          select: {
            id: true,
            trackingNumber: true,
            reference: true,
            mandantId: true,
            customer: { select: { name: true } },
          },
        },
        documents: {
          where: { type: DocumentType.DAMAGE_PHOTO },
          select: { id: true, fileName: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(user: AuthUser, id: string) {
    this.assertStaff(user);
    const damage = await this.prisma.damage.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        shipment: {
          include: {
            customer: { select: { name: true, customerNumber: true } },
            mandant: { select: { name: true, code: true } },
          },
        },
        documents: {
          where: { type: DocumentType.DAMAGE_PHOTO },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!damage) throw new NotFoundException();
    if (
      damage.shipment &&
      user.role !== UserRole.ORG_ADMIN &&
      !user.mandantIds.includes(damage.shipment.mandantId)
    ) {
      throw new ForbiddenException();
    }
    return damage;
  }

  async create(user: AuthUser, data: CreateDamageInput) {
    this.assertStaff(user);
    if (!data.title?.trim() || !data.description?.trim()) {
      throw new BadRequestException('Titel und Beschreibung erforderlich');
    }

    let customerId: string | undefined;
    if (data.shipmentId) {
      const shipment = await this.prisma.shipment.findFirst({
        where: {
          id: data.shipmentId,
          organizationId: user.organizationId,
          ...mandantFilter(user),
        },
      });
      if (!shipment) throw new NotFoundException('Sendung nicht gefunden');
      customerId = shipment.customerId;
    }

    const damage = await this.prisma.damage.create({
      data: {
        organizationId: user.organizationId,
        shipmentId: data.shipmentId || null,
        title: data.title.trim(),
        description: data.description.trim(),
        location: data.location?.trim() || null,
        reportedById: user.id,
        status: DamageStatus.OPEN,
      },
      include: {
        shipment: { select: { trackingNumber: true, reference: true } },
        documents: true,
      },
    });

    await this.audit.log(user.id, 'damage.create', 'Damage', damage.id, {
      title: damage.title,
      shipmentId: damage.shipmentId,
      customerId,
    });
    return damage;
  }

  async updateStatus(user: AuthUser, id: string, status: DamageStatus) {
    this.assertStaff(user);
    await this.get(user, id);
    if (!Object.values(DamageStatus).includes(status)) {
      throw new BadRequestException('Ungültiger Status');
    }
    return this.prisma.damage.update({
      where: { id },
      data: { status },
      include: {
        shipment: { select: { trackingNumber: true } },
        documents: { where: { type: DocumentType.DAMAGE_PHOTO } },
      },
    });
  }

  async addPhoto(user: AuthUser, damageId: string, file: Express.Multer.File) {
    this.assertStaff(user);
    if (!file) throw new BadRequestException('Datei fehlt');
    const damage = await this.get(user, damageId);

    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = join(this.uploadDir, safeName);
    await pipeline(Readable.from(file.buffer), createWriteStream(storagePath));

    const doc = await this.prisma.document.create({
      data: {
        organizationId: user.organizationId,
        damageId,
        shipmentId: damage.shipmentId,
        customerId: damage.shipment?.customerId,
        type: DocumentType.DAMAGE_PHOTO,
        fileName: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
        storagePath,
        sizeBytes: file.size,
        uploadedById: user.id,
      },
    });
    await this.audit.log(user.id, 'damage.photo', 'Document', doc.id, { damageId });
    return doc;
  }
}
