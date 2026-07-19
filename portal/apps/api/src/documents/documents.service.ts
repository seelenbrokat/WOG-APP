import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream, existsSync, mkdirSync, createReadStream, statSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import PDFDocument from 'pdfkit';
import { DocumentType, NotificationEvent, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class DocumentsService {
  private uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private notifications: NotificationsService,
    private audit: AuditService,
  ) {
    this.uploadDir = this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
    if (!existsSync(this.uploadDir)) mkdirSync(this.uploadDir, { recursive: true });
  }

  async saveUpload(
    user: AuthUser,
    file: Express.Multer.File,
    opts: { shipmentId?: string; customerId?: string; type?: DocumentType },
  ) {
    let shipmentId = opts.shipmentId;
    let customerId = opts.customerId || user.customerId || undefined;
    let organizationId = user.organizationId;

    if (shipmentId) {
      const shipment = await this.prisma.shipment.findFirst({
        where: {
          id: shipmentId,
          organizationId: user.organizationId,
          ...(user.role === UserRole.CUSTOMER_USER && user.customerId
            ? { customerId: user.customerId }
            : {}),
        },
      });
      if (!shipment) throw new NotFoundException('Sendung nicht gefunden');
      if (
        (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) &&
        !user.mandantIds.includes(shipment.mandantId)
      ) {
        throw new ForbiddenException();
      }
      customerId = shipment.customerId;
      organizationId = shipment.organizationId;
    }

    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = join(this.uploadDir, safeName);
    await pipeline(Readable.from(file.buffer), createWriteStream(storagePath));

    const doc = await this.prisma.document.create({
      data: {
        organizationId,
        shipmentId,
        customerId,
        type: opts.type || DocumentType.CUSTOMER_UPLOAD,
        fileName: file.originalname,
        mimeType: file.mimetype,
        storagePath,
        sizeBytes: file.size,
        uploadedById: user.id,
      },
    });

    if (shipmentId) {
      await this.notifications.notifyShipmentUsers(shipmentId, NotificationEvent.DOCUMENT_RECEIVED, {
        fileName: file.originalname,
      });
    }

    await this.audit.log(user.id, 'document.upload', 'Document', doc.id, {
      fileName: doc.fileName,
      type: doc.type,
    });
    return doc;
  }

  async get(user: AuthUser, id: string) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc || doc.organizationId !== user.organizationId) throw new NotFoundException();
    if (user.role === UserRole.CUSTOMER_USER && doc.customerId && doc.customerId !== user.customerId) {
      throw new ForbiddenException();
    }
    if (doc.shipmentId && (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER)) {
      const shipment = await this.prisma.shipment.findUnique({ where: { id: doc.shipmentId } });
      if (shipment && !user.mandantIds.includes(shipment.mandantId)) throw new ForbiddenException();
    }
    return doc;
  }

  async openStream(user: AuthUser, id: string) {
    const doc = await this.get(user, id);
    return { doc, stream: createReadStream(doc.storagePath) };
  }

  async generateAblieferbeleg(user: AuthUser, shipmentId: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: {
        id: shipmentId,
        organizationId: user.organizationId,
        ...(user.role === UserRole.CUSTOMER_USER && user.customerId
          ? { customerId: user.customerId }
          : {}),
      },
      include: { mandant: true, customer: true, positions: true },
    });
    if (!shipment) throw new NotFoundException();
    if (
      (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) &&
      !user.mandantIds.includes(shipment.mandantId)
    ) {
      throw new ForbiddenException();
    }

    const fileName = `Ablieferbeleg-${shipment.trackingNumber}.pdf`;
    const storagePath = join(this.uploadDir, fileName);
    await this.writeAblieferbelegPdf(shipment, storagePath);

    const doc = await this.prisma.document.create({
      data: {
        organizationId: shipment.organizationId,
        shipmentId: shipment.id,
        customerId: shipment.customerId,
        type: DocumentType.ABLIEFERBELEG,
        fileName,
        mimeType: 'application/pdf',
        storagePath,
        sizeBytes: statSync(storagePath).size,
        uploadedById: user.id,
      },
    });

    await this.audit.log(user.id, 'document.ablieferbeleg', 'Document', doc.id, {
      trackingNumber: shipment.trackingNumber,
    });
    return doc;
  }

  private writeAblieferbelegPdf(shipment: any, storagePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const stream = createWriteStream(storagePath);
      doc.pipe(stream);
      doc.fontSize(20).text('Ablieferbeleg', { align: 'left' });
      doc.moveDown();
      doc.fontSize(12).text(`Mandant: ${shipment.mandant.name}`);
      doc.text(`Sendungsnummer: ${shipment.trackingNumber}`);
      doc.text(`Referenz: ${shipment.reference || '-'}`);
      doc.text(`Kunde: ${shipment.customer.name}`);
      doc.moveDown();
      doc.text('Abholung:');
      doc.text(`${shipment.pickupCompany || ''}`);
      doc.text(`${shipment.pickupStreet || ''}`);
      doc.text(`${shipment.pickupZip || ''} ${shipment.pickupCity || ''} ${shipment.pickupCountry || ''}`);
      doc.moveDown();
      doc.text('Zustellung:');
      doc.text(`${shipment.deliveryCompany || ''}`);
      doc.text(`${shipment.deliveryStreet || ''}`);
      doc.text(
        `${shipment.deliveryZip || ''} ${shipment.deliveryCity || ''} ${shipment.deliveryCountry || ''}`,
      );
      doc.moveDown();
      doc.text(`Kolli: ${shipment.packageCount}  Gewicht: ${shipment.weightKg || '-'} kg`);
      doc.text(`Warenbeschreibung: ${shipment.goodsDescription || '-'}`);
      if (shipment.positions?.length) {
        doc.moveDown().text('Positionen:');
        for (const p of shipment.positions) {
          doc.text(`- ${p.quantity}x ${p.description}${p.sscc ? ` (SSCC ${p.sscc})` : ''}`);
        }
      }
      doc.moveDown(2);
      doc.text('Empfangsbestätigung: ________________________  Datum: __________');
      doc.end();
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });
  }

  listForShipment(user: AuthUser, shipmentId: string) {
    return this.prisma.document.findMany({
      where: {
        shipmentId,
        organizationId: user.organizationId,
        ...(user.role === UserRole.CUSTOMER_USER && user.customerId
          ? { customerId: user.customerId }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
