import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream, existsSync, mkdirSync, createReadStream, statSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import PDFDocument from 'pdfkit';
import { DocumentType, NotificationEvent, ShipmentStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { drawA4BrandHeader, drawA4Footer } from '../common/pdf-brand';
import { SoloplanService } from '../integrations/soloplan.service';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private notifications: NotificationsService,
    private audit: AuditService,
    @Inject(forwardRef(() => SoloplanService)) private soloplan: SoloplanService,
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
    let shipmentExtras: Record<string, unknown> | null = null;
    let shipmentStatus: ShipmentStatus | null = null;

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
      shipmentExtras =
        shipment.extras && typeof shipment.extras === 'object' && !Array.isArray(shipment.extras)
          ? (shipment.extras as Record<string, unknown>)
          : null;
      shipmentStatus = shipment.status;
    }

    const docType = opts.type || DocumentType.CUSTOMER_UPLOAD;
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = join(this.uploadDir, safeName);
    await pipeline(Readable.from(file.buffer), createWriteStream(storagePath));

    const doc = await this.prisma.document.create({
      data: {
        organizationId,
        shipmentId,
        customerId,
        type: docType,
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

    // Verzollung: nach Rechnung Soloplan-Export nachziehen
    if (
      shipmentId &&
      docType === DocumentType.INVOICE &&
      shipmentStatus === ShipmentStatus.SUBMITTED &&
      shipmentExtras?.verzollung === true
    ) {
      try {
        await this.soloplan.exportShipment(shipmentId);
        this.logger.log(`Soloplan-Export nach Rechnungs-Upload für Sendung ${shipmentId}`);
      } catch (err: any) {
        this.logger.warn(
          `Soloplan-Export nach Rechnung fehlgeschlagen: ${err?.message || err}`,
        );
      }
    }

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
      const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
      const stream = createWriteStream(storagePath);
      doc.pipe(stream);
      drawA4BrandHeader(doc, {
        title: 'Ablieferbeleg',
        subtitle: shipment.trackingNumber,
      });
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
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        drawA4Footer(doc, i + 1, range.count);
      }
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
