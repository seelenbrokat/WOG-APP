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
import { DocumentType, UserRole } from '@prisma/client';
import {
  isValidGrenzuebergang,
  isValidSmartBorderPlate,
  normalizeSmartBorderPlate,
} from '@wog/shared';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SoloplanService } from '../integrations/soloplan.service';
import { drawA4BrandHeader, drawA4Footer, formatPdfDateTime } from '../common/pdf-brand';

/** Platzhalter bis Selbstfahrer LKW/Grenze bei Beladung setzt (keine Dispo durch WOG). */
export const CUSTOMS_VEHICLE_DEFERRED_PLATE = 'OFFEN';
export const CUSTOMS_VEHICLE_DEFERRED_BORDER = 'OFFEN';

export type ReleaseCustomsLoadingInput = {
  orderIds: string[];
  customerId?: string;
  kennzeichen: string;
  zulassungsland?: string;
  kennzeichenAnhaenger?: string;
  zulassungslandAnhaenger?: string;
  grenzuebergang: string;
  zeit: string;
  notes?: string;
};

@Injectable()
export class CustomsLoadingService {
  private readonly logger = new Logger(CustomsLoadingService.name);
  private uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private config: ConfigService,
    @Inject(forwardRef(() => SoloplanService))
    private soloplan: SoloplanService,
  ) {
    this.uploadDir = join(
      this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads'),
      'customs-loading',
    );
    if (!existsSync(this.uploadDir)) mkdirSync(this.uploadDir, { recursive: true });
  }

  /**
   * Offene Verzollungsaufträge ohne Beladungs-Tour (Selbstfahrer-Warteschlange).
   * Optional: nur deferred, oder alle ohne Tour.
   */
  async listPending(user: AuthUser, opts?: { customerId?: string; deferredOnly?: boolean }) {
    const where: Record<string, unknown> = {
      organizationId: user.organizationId,
      loadingTourId: null,
      status: { not: 'CANCELLED' },
    };
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) throw new ForbiddenException('Kein Kundenkonto verknüpft');
      where.customerId = user.customerId;
    } else if (opts?.customerId) {
      where.customerId = opts.customerId;
    }
    if (opts?.deferredOnly !== false) {
      where.vehicleDeferred = true;
    }

    return this.prisma.customsOrder.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, customerNumber: true } },
        mandant: { select: { name: true, code: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  listTours(user: AuthUser, opts?: { customerId?: string }) {
    const where: Record<string, unknown> = { organizationId: user.organizationId };
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) throw new ForbiddenException('Kein Kundenkonto verknüpft');
      where.customerId = user.customerId;
    } else if (opts?.customerId) {
      where.customerId = opts.customerId;
    }
    return this.prisma.customsLoadingTour.findMany({
      where,
      include: {
        customer: { select: { name: true, customerNumber: true } },
        orders: {
          select: {
            id: true,
            externalNumber: true,
            soloplanRef: true,
            absenderFirma: true,
            empfaengerFirma: true,
            packageCount: true,
            weightKg: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Checkbox-Auswahl → LKW/Grenze setzen, Soloplan-Update, Ladeliste, Ankunftsaviso.
   * Keine Dispo durch WOG: ERVO/Selbstfahrer.
   */
  async releaseTour(user: AuthUser, input: ReleaseCustomsLoadingInput) {
    const uniqueIds = [...new Set((input.orderIds || []).filter(Boolean))];
    if (!uniqueIds.length) {
      throw new BadRequestException('Mindestens eine Sendung auswählen');
    }
    if (uniqueIds.length > 80) {
      throw new BadRequestException('Maximal 80 Sendungen pro Beladung');
    }

    const orders = await this.prisma.customsOrder.findMany({
      where: {
        id: { in: uniqueIds },
        organizationId: user.organizationId,
        status: { not: 'CANCELLED' },
      },
      include: {
        customer: { select: { id: true, name: true, customerNumber: true } },
      },
    });
    if (orders.length !== uniqueIds.length) {
      throw new NotFoundException('Eine oder mehrere Sendungen wurden nicht gefunden');
    }
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) throw new ForbiddenException('Kein Kundenkonto verknüpft');
      if (orders.some((o) => o.customerId !== user.customerId)) {
        throw new ForbiddenException('Nur eigene Sendungen freigeben');
      }
    }
    const customerId = orders[0].customerId;
    if (orders.some((o) => o.customerId !== customerId)) {
      throw new BadRequestException('Alle Sendungen müssen denselben Auftraggeber haben');
    }
    if (input.customerId && input.customerId !== customerId) {
      throw new BadRequestException('customerId stimmt nicht mit den Sendungen überein');
    }
    const already = orders.filter((o) => o.loadingTourId);
    if (already.length) {
      throw new BadRequestException(
        `${already.length} Sendung(en) sind bereits einer Beladung zugeordnet`,
      );
    }

    const zulassungsland = (input.zulassungsland || 'AT').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(zulassungsland)) {
      throw new BadRequestException('Zulassungsland muss ein ISO-Ländercode (2 Buchstaben) sein');
    }
    const kennzeichen = normalizeSmartBorderPlate(input.kennzeichen, zulassungsland);
    if (!isValidSmartBorderPlate(kennzeichen, zulassungsland)) {
      throw new BadRequestException(
        'Kennzeichen entspricht nicht den Smart-Border-Austria-Eingaberichtlinien',
      );
    }
    const grenzuebergang = String(input.grenzuebergang || '').trim();
    if (!isValidGrenzuebergang(grenzuebergang)) {
      throw new BadRequestException('Grenzübergang bitte angeben');
    }
    const zeit = new Date(input.zeit);
    if (!Number.isFinite(zeit.getTime())) {
      throw new BadRequestException('Zeitpunkt an der Grenze ungültig');
    }

    let kennzeichenAnhaenger: string | null = null;
    let zulassungslandAnhaenger: string | null = null;
    const rawTrailer = (input.kennzeichenAnhaenger || '').trim();
    if (rawTrailer) {
      zulassungslandAnhaenger = (input.zulassungslandAnhaenger || zulassungsland)
        .trim()
        .toUpperCase();
      kennzeichenAnhaenger = normalizeSmartBorderPlate(rawTrailer, zulassungslandAnhaenger);
      if (!isValidSmartBorderPlate(kennzeichenAnhaenger, zulassungslandAnhaenger)) {
        throw new BadRequestException('Kennzeichen Anhänger ungültig');
      }
    }

    const tour = await this.prisma.customsLoadingTour.create({
      data: {
        organizationId: user.organizationId,
        customerId,
        kennzeichen,
        zulassungsland,
        kennzeichenAnhaenger,
        zulassungslandAnhaenger,
        grenzuebergang,
        zeit,
        notes: input.notes?.trim() || null,
        createdById: user.id,
        status: 'RELEASED',
        orders: {
          connect: uniqueIds.map((id) => ({ id })),
        },
      },
    });

    await this.prisma.customsOrder.updateMany({
      where: { id: { in: uniqueIds } },
      data: {
        kennzeichen,
        zulassungsland,
        kennzeichenAnhaenger,
        zulassungslandAnhaenger,
        grenzuebergang,
        grenzzollstelle: grenzuebergang,
        zeit,
        vehicleDeferred: false,
        loadingTourId: tour.id,
      },
    });

    // Soloplan-Update mit LKW/Grenze (File-API erneut)
    for (const id of uniqueIds) {
      try {
        await this.soloplan.exportCustomsOrder(id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Soloplan-Update Beladung ${id}: ${msg}`);
      }
    }

    const refreshed = await this.prisma.customsOrder.findMany({
      where: { id: { in: uniqueIds } },
      include: { customer: { select: { name: true, customerNumber: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const loadingList = await this.createLoadingListPdf(user, tour.id, {
      kennzeichen,
      zulassungsland,
      kennzeichenAnhaenger,
      grenzuebergang,
      zeit,
      customerName: refreshed[0]?.customer.name || '',
      customerNumber: refreshed[0]?.customer.customerNumber || '',
      orders: refreshed,
    });

    await this.prisma.customsLoadingTour.update({
      where: { id: tour.id },
      data: { loadingListDocumentId: loadingList.documentId },
    });

    const avisoTo =
      this.config.get<string>('CUSTOMS_ARRIVAL_AVISO_EMAIL') || 'zoll@worldofgreen.at';
    const when = zeit.toLocaleString('de-AT');
    const lines = [
      'Ankunftsaviso Verzollung (Selbstfahrer-Beladung)',
      '',
      `Kunde: ${refreshed[0]?.customer.name || ''} (${refreshed[0]?.customer.customerNumber || ''})`,
      `Kennzeichen: ${kennzeichen} (${zulassungsland})`,
      kennzeichenAnhaenger ? `Anhänger: ${kennzeichenAnhaenger}` : null,
      `Grenzübergang: ${grenzuebergang}`,
      `Zeitpunkt Grenze: ${when}`,
      `Sendungen: ${refreshed.length}`,
      '',
      'Sendungsliste:',
      ...refreshed.map((o, i) => {
        const solo = this.displaySoloplanRef(o.soloplanRef);
        return (
          `${i + 1}. ${o.externalNumber || o.id.slice(-6)}` +
          (solo ? ` · Soloplan ${solo}` : '') +
          ` · ${o.absenderFirma} → ${o.empfaengerFirma}` +
          (o.packageCount != null ? ` · ${o.packageCount} Colli` : '') +
          (o.weightKg != null ? ` · ${o.weightKg} kg` : '')
        );
      }),
      '',
      `Portal: ${this.config.get('APP_URL') || 'https://wog.logistikberater.at'}`,
      `Beladung-ID: ${tour.id}`,
    ].filter((l) => l != null);

    await this.notifications.sendRaw(
      avisoTo.trim(),
      `Ankunftsaviso ${kennzeichen} · ${refreshed.length} Sendung(en) · ${when}`,
      lines.join('\n'),
      undefined,
      [
        {
          filename: loadingList.fileName,
          path: loadingList.storagePath,
          contentType: 'application/pdf',
        },
      ],
    );

    await this.prisma.customsLoadingTour.update({
      where: { id: tour.id },
      data: { avisoSentAt: new Date() },
    });

    await this.audit.log(user.id, 'customs.loading.release', 'CustomsLoadingTour', tour.id, {
      orderIds: uniqueIds,
      kennzeichen,
      grenzuebergang,
      avisoTo,
      loadingListDocumentId: loadingList.documentId,
    });

    return {
      tourId: tour.id,
      orderCount: refreshed.length,
      kennzeichen,
      grenzuebergang,
      zeit: zeit.toISOString(),
      avisoTo,
      document: {
        id: loadingList.documentId,
        fileName: loadingList.fileName,
      },
      orders: refreshed.map((o) => ({
        id: o.id,
        externalNumber: o.externalNumber,
        soloplanRef: this.displaySoloplanRef(o.soloplanRef),
      })),
    };
  }

  private displaySoloplanRef(ref?: string | null): string | null {
    if (!ref) return null;
    if (ref.startsWith('FILE:') || ref.startsWith('SP-STUB-')) return null;
    return ref;
  }

  private async createLoadingListPdf(
    user: AuthUser,
    tourId: string,
    data: {
      kennzeichen: string;
      zulassungsland: string;
      kennzeichenAnhaenger?: string | null;
      grenzuebergang: string;
      zeit: Date;
      customerName: string;
      customerNumber: string;
      orders: Array<{
        id: string;
        organizationId: string;
        customerId: string;
        externalNumber: string | null;
        soloplanRef: string | null;
        absenderFirma: string;
        empfaengerFirma: string;
        packageCount: number | null;
        weightKg: number | null;
        goodsDescription: string | null;
      }>;
    },
  ) {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fileName = `Ladeliste-Zoll-${data.kennzeichen}-${stamp}-${tourId.slice(-6)}.pdf`.replace(
      /[^\w.\-]+/g,
      '_',
    );
    const storagePath = join(this.uploadDir, fileName);

    const margin = 48;
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin });
      const stream = createWriteStream(storagePath);
      doc.pipe(stream);
      let pageNo = 1;
      drawA4BrandHeader(doc, {
        title: 'Ladeliste Verzollung',
        subtitle: `${data.kennzeichen} · ${data.customerName}`,
      });
      let y = doc.y + 8;
      doc.fontSize(10).fillColor('#222');
      const meta = [
        `Kunde: ${data.customerName}${data.customerNumber ? ` (${data.customerNumber})` : ''}`,
        `Kennzeichen: ${data.kennzeichen} (${data.zulassungsland})`,
        data.kennzeichenAnhaenger ? `Anhänger: ${data.kennzeichenAnhaenger}` : null,
        `Grenzübergang: ${data.grenzuebergang}`,
        `Grenze: ${formatPdfDateTime(data.zeit)}`,
        `Sendungen: ${data.orders.length}`,
        `Erstellt: ${formatPdfDateTime(new Date())}`,
      ].filter(Boolean);
      for (const line of meta) {
        doc.text(String(line), margin, y);
        y += 14;
      }
      y += 8;
      doc.font('Helvetica-Bold').text('Mitzunehmende Sendungen', margin, y);
      y += 18;
      doc.font('Helvetica').fontSize(9);

      for (let i = 0; i < data.orders.length; i++) {
        const o = data.orders[i];
        if (y > 760) {
          drawA4Footer(doc, pageNo);
          doc.addPage();
          pageNo += 1;
          drawA4BrandHeader(doc, {
            title: 'Ladeliste Verzollung',
            subtitle: `${data.kennzeichen} · Fortsetzung`,
          });
          y = doc.y + 8;
          doc.font('Helvetica').fontSize(9);
        }
        const solo = this.displaySoloplanRef(o.soloplanRef);
        const head =
          `${i + 1}. ${o.externalNumber || '–'}` +
          (solo ? `  ·  Soloplan ${solo}` : '');
        doc.font('Helvetica-Bold').text(head, margin, y);
        y += 12;
        doc.font('Helvetica').fillColor('#333');
        doc.text(
          `${o.absenderFirma}  →  ${o.empfaengerFirma}`,
          margin,
          y,
          { width: 500 },
        );
        y += 12;
        doc.text(
          [
            o.packageCount != null ? `${o.packageCount} Colli` : null,
            o.weightKg != null ? `${o.weightKg} kg` : null,
            o.goodsDescription ? o.goodsDescription.slice(0, 80) : null,
          ]
            .filter(Boolean)
            .join(' · ') || '–',
          margin,
          y,
        );
        y += 16;
        doc.fillColor('#222');
      }

      drawA4Footer(doc, pageNo);
      doc.end();
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });

    const first = data.orders[0];
    const document = await this.prisma.document.create({
      data: {
        organizationId: first.organizationId,
        customerId: first.customerId,
        customsOrderId: first.id,
        type: DocumentType.LOADING_LIST,
        fileName,
        mimeType: 'application/pdf',
        storagePath,
        sizeBytes: statSync(storagePath).size,
        uploadedById: user.id,
      },
    });

    return { documentId: document.id, fileName, storagePath };
  }
}
