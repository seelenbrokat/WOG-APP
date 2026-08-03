import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
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
import {
  drawA4BrandHeader,
  drawA4Footer,
  drawLoadingUnitExchangeBox,
  formatPdfDateTime,
} from '../common/pdf-brand';
import { SoloplanService } from '../integrations/soloplan.service';
import {
  LoadingUnitExchangeNote,
  LoadingUnitService,
} from '../integrations/loading-unit.service';
import { isSignatureDocumentName } from '../integrations/zustellnachweis-pdf';
import {
  createDocumentDownloadToken,
  verifyDocumentDownloadToken,
} from './document-download-token';

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
    @Inject(forwardRef(() => LoadingUnitService)) private loadingUnits: LoadingUnitService,
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

    let alreadyExportedToSoloplan = false;
    if (shipmentId) {
      const shipment = await this.prisma.shipment.findFirst({
        where: {
          id: shipmentId,
          organizationId: user.organizationId,
          ...(user.role === UserRole.CUSTOMER_USER && user.customerId
            ? { customerId: user.customerId }
            : {}),
        },
        include: { order: { select: { soloplanRef: true } } },
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
      alreadyExportedToSoloplan = Boolean(shipment.soloplanRef || shipment.order?.soloplanRef);
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

    // Soloplan: Dokumente erst mit Create (noch im Pickup) oder nach Import/Abholung.
    // Nie blind exportShipment – das würde Create durch Update ersetzen bevor Soloplan importiert.
    const soloplanDocTypes: DocumentType[] = [
      DocumentType.INVOICE,
      DocumentType.ABLIEFERBELEG,
      DocumentType.POD,
      DocumentType.CMR,
      DocumentType.CUSTOMER_UPLOAD,
    ];
    const shouldExportForVerzollung =
      docType === DocumentType.INVOICE &&
      shipmentStatus === ShipmentStatus.SUBMITTED &&
      shipmentExtras?.verzollung === true;
    const shouldExportDocument =
      soloplanDocTypes.includes(docType) &&
      (shouldExportForVerzollung || alreadyExportedToSoloplan);

    if (shipmentId && shouldExportDocument) {
      try {
        const res = await this.soloplan.exportDocumentsIfReady(shipmentId);
        this.logger.log(
          `Soloplan-Dokument nach Upload (${docType}, mode=${res.mode}${res.reason ? `, ${res.reason}` : ''}) für Sendung ${shipmentId}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Soloplan-Export nach Dokument fehlgeschlagen: ${err?.message || err}`,
        );
      }
    }

    return doc;
  }

  async get(user: AuthUser, id: string) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc || doc.organizationId !== user.organizationId) throw new NotFoundException();
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) throw new ForbiddenException('Kein Kundenkonto verknüpft');
      // Dokumente ohne customerId sind für Kunden nicht sichtbar
      if (!doc.customerId || doc.customerId !== user.customerId) {
        throw new ForbiddenException();
      }
    }
    if (doc.shipmentId && (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER)) {
      const shipment = await this.prisma.shipment.findUnique({ where: { id: doc.shipmentId } });
      if (shipment && !user.mandantIds.includes(shipment.mandantId)) throw new ForbiddenException();
    }
    return doc;
  }

  private jwtSecret() {
    return this.config.get<string>('JWT_SECRET') || 'dev-secret';
  }

  /** Signierter Download-Link (ohne Login), z. B. für ETB-Mails. */
  createSignedDownloadUrl(docId: string, ttlSeconds = 30 * 24 * 60 * 60): string {
    const appUrl = String(this.config.get('APP_URL') || 'https://wog.logistikberater.at').replace(
      /\/$/,
      '',
    );
    const token = createDocumentDownloadToken(docId, this.jwtSecret(), ttlSeconds);
    return `${appUrl}/api/documents/${docId}/shared?t=${encodeURIComponent(token)}`;
  }

  async openStream(user: AuthUser, id: string) {
    const doc = await this.get(user, id);
    return this.openExistingFile(doc);
  }

  /** Download über signierten E-Mail-Token (ohne Session). */
  async openStreamBySignedToken(docId: string, token: string) {
    const verified = verifyDocumentDownloadToken(token, this.jwtSecret());
    if (!verified || verified.docId !== docId) {
      throw new UnauthorizedException('Download-Link ungültig oder abgelaufen');
    }
    const doc = await this.prisma.document.findUnique({ where: { id: docId } });
    if (!doc) throw new NotFoundException('Datei nicht gefunden');
    return this.openExistingFile(doc);
  }

  private openExistingFile(doc: { id: string; storagePath: string | null; fileName: string; mimeType: string | null; sizeBytes: number | null }) {
    if (!doc.storagePath || !existsSync(doc.storagePath)) {
      this.logger.warn(`Dokument ${doc.id}: Datei fehlt (${doc.storagePath || 'ohne Pfad'})`);
      throw new NotFoundException('Datei nicht gefunden');
    }
    const sizeBytes =
      doc.sizeBytes && doc.sizeBytes > 0 ? doc.sizeBytes : statSync(doc.storagePath).size;
    return {
      doc: { ...doc, sizeBytes },
      stream: createReadStream(doc.storagePath),
    };
  }

  async generateAblieferbeleg(user: AuthUser, shipmentId: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: {
        id: shipmentId,
        organizationId: user.organizationId,
        ...(user.role === UserRole.CUSTOMER_USER
          ? { customerId: user.customerId || '__none__' }
          : {}),
      },
      include: {
        mandant: true,
        customer: true,
        positions: true,
        order: { select: { soloplanRef: true } },
      },
    });
    if (!shipment) throw new NotFoundException();
    if (
      (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) &&
      !user.mandantIds.includes(shipment.mandantId)
    ) {
      throw new ForbiddenException();
    }

    return this.createAblieferbelegForShipment({
      shipment,
      uploadedById: user.id,
      auditUserId: user.id,
    });
  }

  /**
   * Sauberer Ablieferbeleg nach digitaler Unterschrift (VLB-Zustellapp):
   * inkl. Lademittel und Signatur-Bild, Export an Soloplan wenn möglich.
   */
  async generateDeliveryReceiptFromSignature(opts: {
    organizationId: string;
    uploadedById?: string;
    transportOrderNumber?: string | null;
    tourNumber?: string | null;
    tourStopId?: string | null;
    signaturePath: string;
    signatureFileName?: string;
    signedByName?: string | null;
    signedAt?: Date | null;
  }) {
    if (!opts.signaturePath || !existsSync(opts.signaturePath)) {
      throw new BadRequestException('Unterschriftsdatei fehlt');
    }

    const shipment = await this.resolveShipmentForDelivery(opts.organizationId, {
      transportOrderNumber: opts.transportOrderNumber,
      tourNumber: opts.tourNumber,
      tourStopId: opts.tourStopId,
    });
    if (!shipment) {
      throw new NotFoundException(
        `Keine Portal-Sendung zu TO=${opts.transportOrderNumber || '—'} / Tour=${opts.tourNumber || '—'}`,
      );
    }

    const exchangeNote = await this.loadingUnits.resolveExchangeNote({
      organizationId: opts.organizationId,
      tourStopExternalId: opts.tourStopId || undefined,
      tourNumber: opts.tourNumber || undefined,
      transportOrderNumber: opts.transportOrderNumber || undefined,
      partnerName: shipment.deliveryCompany,
    });
    // Fallback über Sendungs-Matching, falls Stop noch nicht verknüpft
    const note =
      exchangeNote.status !== 'UNKNOWN'
        ? exchangeNote
        : await this.loadingUnits.resolveExchangeNoteForShipment(opts.organizationId, shipment);

    // Weitere Fotos derselben TO auf denselben Beleg (kein separater Nachweis je Foto)
    const photos: Array<{ path: string; fileName?: string }> = [];
    const to = opts.transportOrderNumber?.trim();
    if (to) {
      const related = await this.prisma.tourDocument.findMany({
        where: {
          organizationId: opts.organizationId,
          transportOrderNumber: to,
          mimeType: { startsWith: 'image/' },
          NOT: [
            { fileName: { startsWith: 'Ablieferbeleg-' } },
            { fileName: { startsWith: 'Zustellnachweis-' } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 40,
      });
      for (const d of related) {
        if (!existsSync(d.storagePath)) continue;
        if (d.storagePath === opts.signaturePath) continue;
        photos.push({ path: d.storagePath, fileName: d.fileName });
      }
    }

    return this.createAblieferbelegForShipment({
      shipment,
      uploadedById: opts.uploadedById,
      auditUserId: opts.uploadedById,
      exchangeNote: note,
      signature: {
        path: opts.signaturePath,
        fileName: opts.signatureFileName,
        signedByName: opts.signedByName,
        signedAt: opts.signedAt || new Date(),
      },
      photos,
    });
  }

  private async createAblieferbelegForShipment(opts: {
    shipment: any;
    uploadedById?: string;
    auditUserId?: string;
    exchangeNote?: LoadingUnitExchangeNote | null;
    signature?: {
      path: string;
      fileName?: string;
      signedByName?: string | null;
      signedAt?: Date | null;
    } | null;
    photos?: Array<{ path: string; fileName?: string }> | null;
  }) {
    const shipment = opts.shipment;
    const exchangeNote =
      opts.exchangeNote ??
      (await this.loadingUnits.resolveExchangeNoteForShipment(shipment.organizationId, shipment));

    const fileName = `Ablieferbeleg-${shipment.trackingNumber}.pdf`;
    const storagePath = join(this.uploadDir, fileName);
    await this.writeAblieferbelegPdf(
      shipment,
      storagePath,
      exchangeNote,
      opts.signature,
      opts.photos || [],
    );

    // Alten Ablieferbeleg gleichen Namens ersetzen (ein sauberer Beleg je Sendung)
    const existing = await this.prisma.document.findFirst({
      where: {
        organizationId: shipment.organizationId,
        shipmentId: shipment.id,
        type: DocumentType.ABLIEFERBELEG,
        fileName,
      },
    });
    const doc = existing
      ? await this.prisma.document.update({
          where: { id: existing.id },
          data: {
            storagePath,
            sizeBytes: statSync(storagePath).size,
            uploadedById: opts.uploadedById || existing.uploadedById,
          },
        })
      : await this.prisma.document.create({
          data: {
            organizationId: shipment.organizationId,
            shipmentId: shipment.id,
            customerId: shipment.customerId,
            type: DocumentType.ABLIEFERBELEG,
            fileName,
            mimeType: 'application/pdf',
            storagePath,
            sizeBytes: statSync(storagePath).size,
            uploadedById: opts.uploadedById,
          },
        });

    if (opts.auditUserId) {
      await this.audit.log(opts.auditUserId, 'document.ablieferbeleg', 'Document', doc.id, {
        trackingNumber: shipment.trackingNumber,
        withSignature: Boolean(opts.signature?.path),
        loadingUnitStatus: exchangeNote?.status,
      });
    }

    // Unterschrift zusätzlich als eigenes POD (Soloplan-Kategorie UNTER) ablegen
    const signaturePod = await this.upsertSignaturePodDocument({
      shipment,
      uploadedById: opts.uploadedById,
      signature: opts.signature,
    });

    // Soloplan nur einmal je Sendung belasten: bei Collo-Fotos lokal PDF aktualisieren,
    // File-API-Export erst bei echter Unterschrift (oder manuell ohne Foto-Trigger).
    const sigName = (opts.signature?.fileName || '').trim();
    const photoOnlyRefresh =
      Boolean(opts.signature?.path) &&
      (!isSignatureDocumentName(sigName) || /^Signature_KeinTausch/i.test(sigName));

    if (
      !photoOnlyRefresh &&
      (shipment.soloplanRef || shipment.order?.soloplanRef)
    ) {
      try {
        const res = await this.soloplan.exportDocumentsIfReady(shipment.id);
        this.logger.log(
          `Soloplan nach Ablieferbeleg (mode=${res.mode}${res.reason ? `, ${res.reason}` : ''}) für Sendung ${shipment.id}${
            signaturePod ? `, Unterschrift=${signaturePod.fileName}` : ''
          }`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Soloplan-Update nach Ablieferbeleg fehlgeschlagen: ${err?.message || err}`,
        );
      }
    }

    return {
      documentId: doc.id,
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      fileName: doc.fileName,
      loadingUnitStatus: exchangeNote?.status,
      withSignature: Boolean(opts.signature?.path),
      signatureDocumentId: signaturePod?.id || null,
      signatureFileName: signaturePod?.fileName || null,
    };
  }

  /**
   * Empfangsunterschrift als separates Portal-Dokument (POD → Soloplan UNTER).
   * Der digitale Ablieferbeleg bleibt der gemeinsame PDF-Beleg.
   */
  private async upsertSignaturePodDocument(opts: {
    shipment: any;
    uploadedById?: string;
    signature?: {
      path: string;
      fileName?: string;
      signedByName?: string | null;
      signedAt?: Date | null;
    } | null;
  }) {
    const sig = opts.signature;
    if (!sig?.path || !existsSync(sig.path)) return null;
    const fileName = (sig.fileName || '').trim();
    // KeinTausch-Platzhalter und reine Entladefotos nicht als POD speichern
    if (fileName && /^Signature_KeinTausch/i.test(fileName)) return null;
    if (fileName && !isSignatureDocumentName(fileName)) return null;

    const shipment = opts.shipment;
    const podFileName =
      fileName ||
      `Unterschrift-${shipment.trackingNumber}${sig.path.toLowerCase().endsWith('.png') ? '.png' : '.jpg'}`;
    const mimeType = podFileName.toLowerCase().endsWith('.png')
      ? 'image/png'
      : podFileName.toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : 'image/jpeg';
    const sizeBytes = statSync(sig.path).size;

    const existing = await this.prisma.document.findFirst({
      where: {
        organizationId: shipment.organizationId,
        shipmentId: shipment.id,
        type: DocumentType.POD,
        OR: [{ fileName: podFileName }, { storagePath: sig.path }],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      return this.prisma.document.update({
        where: { id: existing.id },
        data: {
          fileName: podFileName,
          mimeType,
          storagePath: sig.path,
          sizeBytes,
          uploadedById: opts.uploadedById || existing.uploadedById,
        },
      });
    }

    return this.prisma.document.create({
      data: {
        organizationId: shipment.organizationId,
        shipmentId: shipment.id,
        customerId: shipment.customerId,
        type: DocumentType.POD,
        fileName: podFileName,
        mimeType,
        storagePath: sig.path,
        sizeBytes,
        uploadedById: opts.uploadedById,
      },
    });
  }

  private async resolveShipmentForDelivery(
    organizationId: string,
    refs: {
      transportOrderNumber?: string | null;
      tourNumber?: string | null;
      tourStopId?: string | null;
    },
  ) {
    const candidates = new Set<string>();
    if (refs.transportOrderNumber?.trim()) candidates.add(refs.transportOrderNumber.trim());

    if (refs.tourStopId) {
      const stop = await this.prisma.tourStop.findFirst({
        where: {
          soloplanTourStopId: refs.tourStopId,
          tour: { organizationId },
        },
        select: { transportOrderNumber: true },
      });
      if (stop?.transportOrderNumber) candidates.add(stop.transportOrderNumber);
    }

    if (refs.transportOrderNumber || refs.tourNumber) {
      const cons = await this.prisma.tourConsignment.findFirst({
        where: {
          tour: {
            organizationId,
            ...(refs.tourNumber ? { tourNumber: refs.tourNumber } : {}),
          },
          ...(refs.transportOrderNumber
            ? {
                OR: [
                  { soloplanOrderNumber: refs.transportOrderNumber },
                  { externalConsignmentNumber: refs.transportOrderNumber },
                ],
              }
            : {}),
        },
        orderBy: { id: 'desc' },
      });
      if (cons?.soloplanOrderNumber) candidates.add(cons.soloplanOrderNumber);
      if (cons?.externalConsignmentNumber) candidates.add(cons.externalConsignmentNumber);
    }

    const list = [...candidates].filter(Boolean);
    if (!list.length) return null;

    return this.prisma.shipment.findFirst({
      where: {
        organizationId,
        OR: [
          { trackingNumber: { in: list } },
          { reference: { in: list } },
          { soloplanRef: { in: list } },
          { order: { externalNumber: { in: list } } },
        ],
      },
      include: {
        mandant: true,
        customer: true,
        positions: true,
        order: { select: { soloplanRef: true, externalNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private writeAblieferbelegPdf(
    shipment: any,
    storagePath: string,
    exchangeNote?: LoadingUnitExchangeNote | null,
    signature?: {
      path: string;
      fileName?: string;
      signedByName?: string | null;
      signedAt?: Date | null;
    } | null,
    photos: Array<{ path: string; fileName?: string }> = [],
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Ablieferbeleg: immer genau eine A4-Seite
      const doc = new PDFDocument({ margin: 32, size: 'A4', bufferPages: true });
      doc.addPage = (() => doc) as typeof doc.addPage;
      const stream = createWriteStream(storagePath);
      doc.pipe(stream);
      const pageBottom = () => doc.page.height - 36;
      const fits = (need: number) => doc.y + need <= pageBottom();
      const auftraggeber =
        shipment.customer?.name ||
        shipment.pickupCompany ||
        shipment.mandant?.name ||
        null;
      drawA4BrandHeader(doc, {
        title: 'Ablieferbeleg',
        subtitle: auftraggeber
          ? `Auftraggeber: ${auftraggeber}`
          : shipment.trackingNumber,
      });
      doc
        .fontSize(9)
        .fillColor('#111')
        .text(`Sendungsnummer: ${shipment.trackingNumber}`)
        .text(`Referenz: ${shipment.reference || '-'}`)
        .text(`Auftraggeber: ${auftraggeber || '-'}`);
      doc.moveDown(0.35);
      doc.fontSize(9).text('Zustellung:');
      doc.text(`${shipment.deliveryCompany || ''}`);
      doc.text(`${shipment.deliveryStreet || ''}`);
      doc.text(
        `${shipment.deliveryZip || ''} ${shipment.deliveryCity || ''} ${shipment.deliveryCountry || ''}`,
      );
      doc
        .moveDown(0.25)
        .text(`Kolli: ${shipment.packageCount}  Gewicht: ${shipment.weightKg || '-'} kg`);
      if (shipment.goodsDescription) {
        doc.text(`Warenbeschreibung: ${String(shipment.goodsDescription).slice(0, 120)}`);
      }
      doc.moveDown(0.35);
      // Lademittel (Tausch / Nicht-Tausch) – Pflicht auf Ablieferbeleg
      if (fits(70)) {
        drawLoadingUnitExchangeBox(doc, exchangeNote);
      }

      const left = doc.page.margins.left;
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const sigBoxH = 72;

      if (signature?.path && existsSync(signature.path) && fits(sigBoxH + 36)) {
        doc.fontSize(10).fillColor('#111').text('Empfangsbestätigung (digital)');
        if (signature.signedByName) {
          doc.fontSize(9).text(`Übernehmer: ${signature.signedByName}`);
        }
        if (signature.signedAt) {
          doc.fontSize(9).text(`Datum: ${formatPdfDateTime(signature.signedAt)}`);
        }
        doc.moveDown(0.25);
        const boxY = doc.y;
        doc
          .roundedRect(left, boxY, width, sigBoxH, 4)
          .lineWidth(1)
          .strokeColor('#c5d0c9')
          .fillColor('#f7faf8')
          .fillAndStroke();
        try {
          doc.image(signature.path, left + 12, boxY + 6, {
            fit: [width - 24, sigBoxH - 12],
            align: 'center',
            valign: 'center',
          });
        } catch {
          doc
            .fillColor('#333')
            .fontSize(10)
            .text(signature.fileName || 'Unterschrift', left + 16, boxY + 28);
        }
        doc.y = boxY + sigBoxH + 8;
      } else if (fits(24)) {
        doc
          .fontSize(9)
          .text('Empfangsbestätigung: ________________________  Datum: __________');
      }

      const extraPhotos = photos.filter(
        (p) => p.path && existsSync(p.path) && p.path !== signature?.path,
      );
      if (extraPhotos.length && fits(70)) {
        const remain = pageBottom() - doc.y - 8;
        const photoH = Math.min(88, Math.max(52, remain - 18));
        const maxPhotos = Math.min(2, extraPhotos.length);
        doc
          .fontSize(10)
          .fillColor('#111')
          .text(maxPhotos === 1 ? 'Foto zur Zustellung' : 'Fotos zur Zustellung');
        doc.moveDown(0.2);
        const gap = 8;
        const colW = (width - gap) / 2;
        let col = 0;
        let rowTop = doc.y;
        for (let i = 0; i < maxPhotos; i++) {
          const photo = extraPhotos[i];
          if (col === 0 && rowTop + photoH > pageBottom()) break;
          const x = left + col * (colW + gap);
          doc
            .roundedRect(x, rowTop, colW, photoH, 4)
            .lineWidth(1)
            .strokeColor('#c5d0c9')
            .fillColor('#f7faf8')
            .fillAndStroke();
          try {
            doc.image(photo.path, x + 6, rowTop + 6, {
              fit: [colW - 12, photoH - 12],
              align: 'center',
              valign: 'center',
            });
          } catch {
            doc
              .fillColor('#666')
              .fontSize(8)
              .text(photo.fileName || 'Foto', x + 10, rowTop + photoH / 2, {
                width: colW - 20,
              });
          }
          col += 1;
          if (col >= 2) {
            col = 0;
            rowTop += photoH + 8;
            doc.y = rowTop;
          }
        }
        if (col !== 0) doc.y = rowTop + photoH + 8;
      }

      drawA4Footer(doc, 1, 1);
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
