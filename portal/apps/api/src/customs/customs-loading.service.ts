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
import { drawA4BrandHeader, drawA4Footer, formatPdfDateTime, WOG_PDF } from '../common/pdf-brand';

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
      'Ankunftsaviso Verzollung (Sammelfahrzeug-Beladung)',
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
        const abs = `${o.absenderFirma}, ${o.absenderStreet}, ${o.absenderZip} ${o.absenderCity} (${o.absenderCountry})`;
        const emp = `${o.empfaengerFirma}, ${o.empfaengerStreet}, ${o.empfaengerZip} ${o.empfaengerCity} (${o.empfaengerCountry})`;
        return [
          `${i + 1}. ${o.externalNumber || o.id.slice(-6)}` + (solo ? ` · Soloplan ${solo}` : ''),
          `   Absender: ${abs}`,
          `   Empfänger: ${emp}`,
          `   Colli: ${o.packageCount ?? '–'}  ·  Gewicht: ${o.weightKg != null ? `${o.weightKg} kg` : '–'}`,
        ].join('\n');
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
        absenderStreet: string;
        absenderZip: string;
        absenderCity: string;
        absenderCountry: string;
        empfaengerFirma: string;
        empfaengerStreet: string;
        empfaengerZip: string;
        empfaengerCity: string;
        empfaengerCountry: string;
        packageCount: number | null;
        weightKg: number | null;
        netWeightKg?: number | null;
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
    const left = margin;
    const right = 547;
    const contentW = right - left;
    const col2 = left + contentW / 2 + 6;
    const addrW = contentW / 2 - 14;

    const totalColli = data.orders.reduce((s, o) => s + (o.packageCount || 0), 0);
    const totalWeight = data.orders.reduce((s, o) => s + (Number(o.weightKg) || 0), 0);

    const fmtAddr = (parts: {
      firma: string;
      street: string;
      zip: string;
      city: string;
      country: string;
    }) => ({
      firma: (parts.firma || '–').trim() || '–',
      street: (parts.street || '').trim(),
      place: `${parts.zip || ''} ${parts.city || ''}`.trim(),
      country: (parts.country || '').trim(),
    });

    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin,
        bufferPages: true,
        info: {
          Title: `Ladeliste Verzollung ${data.kennzeichen}`,
          Author: 'WOG Logistics',
          Subject: 'Beladung Sammelfahrzeug',
        },
      });
      const stream = createWriteStream(storagePath);
      doc.pipe(stream);
      let pageNo = 1;

      const ensureSpace = (need: number) => {
        if (doc.y + need > doc.page.height - 56) {
          drawA4Footer(doc, pageNo);
          doc.addPage();
          pageNo += 1;
          drawA4BrandHeader(doc, {
            title: 'Ladeliste Verzollung',
            subtitle: `${data.kennzeichen} · Fortsetzung`,
          });
          doc.y += 6;
        }
      };

      drawA4BrandHeader(doc, {
        title: 'Ladeliste Verzollung',
        subtitle: `${data.kennzeichen} · ${data.customerName}`,
      });

      const metaTop = doc.y + 6;
      const metaH = data.kennzeichenAnhaenger ? 88 : 74;
      doc.rect(left, metaTop, contentW, metaH).fill(WOG_PDF.soft);
      doc.fillColor(WOG_PDF.ink).font('Helvetica-Bold').fontSize(11);
      doc.text(
        `Beladung · ${data.orders.length} Sendung${data.orders.length === 1 ? '' : 'en'}`,
        left + 12,
        metaTop + 10,
        { width: contentW / 2 - 16 },
      );
      doc.font('Helvetica').fontSize(9).fillColor(WOG_PDF.muted);
      doc.text(`erstellt ${formatPdfDateTime()}`, left + contentW / 2, metaTop + 12, {
        width: contentW / 2 - 12,
        align: 'right',
      });

      const metaLine = (x: number, y: number, label: string, value: string, labelW = 92) => {
        doc.font('Helvetica-Bold').fillColor(WOG_PDF.muted).text(label, x, y, {
          width: labelW,
          lineBreak: false,
        });
        doc.font('Helvetica').fillColor(WOG_PDF.ink).text(value, x + labelW, y, {
          width: contentW / 2 - labelW - 20,
          lineBreak: false,
        });
      };
      let my = metaTop + 30;
      metaLine(
        left + 12,
        my,
        'Kunde',
        `${data.customerName}${data.customerNumber ? ` (${data.customerNumber})` : ''}`,
      );
      metaLine(col2, my, 'Colli / kg', `${totalColli || '–'}  ·  ${totalWeight || '–'} kg`, 58);
      my += 14;
      metaLine(left + 12, my, 'Kennzeichen', `${data.kennzeichen} (${data.zulassungsland})`);
      metaLine(col2, my, 'Grenze', data.grenzuebergang, 58);
      my += 14;
      metaLine(left + 12, my, 'Zeitpunkt', formatPdfDateTime(data.zeit));
      if (data.kennzeichenAnhaenger) {
        metaLine(col2, my, 'Anhänger', data.kennzeichenAnhaenger, 58);
      }

      doc.x = left;
      doc.y = metaTop + metaH + 14;

      for (let i = 0; i < data.orders.length; i++) {
        const o = data.orders[i];
        ensureSpace(150);

        const solo = this.displaySoloplanRef(o.soloplanRef);
        const headY = doc.y;
        doc.rect(left, headY, contentW, 22).fill(WOG_PDF.greenDeep);
        doc
          .fillColor(WOG_PDF.white)
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(
            `Sendung ${i + 1}/${data.orders.length}  ·  ${o.externalNumber || '–'}` +
              (solo ? `  ·  Soloplan ${solo}` : ''),
            left + 10,
            headY + 6,
            { width: contentW - 20 },
          );

        const bodyTop = headY + 22;
        let bodyY = bodyTop + 10;
        const abs = fmtAddr({
          firma: o.absenderFirma,
          street: o.absenderStreet,
          zip: o.absenderZip,
          city: o.absenderCity,
          country: o.absenderCountry,
        });
        const emp = fmtAddr({
          firma: o.empfaengerFirma,
          street: o.empfaengerStreet,
          zip: o.empfaengerZip,
          city: o.empfaengerCity,
          country: o.empfaengerCountry,
        });

        const addrStart = bodyY;
        doc.font('Helvetica-Bold').fontSize(8).fillColor(WOG_PDF.greenDeep);
        doc.text('ABSENDER', left + 10, addrStart);
        doc.text('EMPFÄNGER', col2, addrStart);

        doc.font('Helvetica-Bold').fontSize(9).fillColor(WOG_PDF.ink);
        doc.text(abs.firma, left + 10, addrStart + 12, { width: addrW });
        doc.font('Helvetica').fillColor(WOG_PDF.ink);
        if (abs.street) doc.text(abs.street, left + 10, doc.y, { width: addrW });
        if (abs.place) doc.text(abs.place, left + 10, doc.y, { width: addrW });
        if (abs.country) {
          doc.fillColor(WOG_PDF.muted).text(abs.country, left + 10, doc.y, { width: addrW });
        }
        const absBottom = doc.y;

        doc.y = addrStart + 12;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(WOG_PDF.ink);
        doc.text(emp.firma, col2, doc.y, { width: addrW });
        doc.font('Helvetica').fillColor(WOG_PDF.ink);
        if (emp.street) doc.text(emp.street, col2, doc.y, { width: addrW });
        if (emp.place) doc.text(emp.place, col2, doc.y, { width: addrW });
        if (emp.country) {
          doc.fillColor(WOG_PDF.muted).text(emp.country, col2, doc.y, { width: addrW });
        }
        const empBottom = doc.y;

        bodyY = Math.max(absBottom, empBottom) + 10;

        doc
          .moveTo(left + 10, bodyY)
          .lineTo(right - 10, bodyY)
          .lineWidth(0.8)
          .strokeColor(WOG_PDF.line)
          .stroke();
        bodyY += 8;

        const statsH = 28;
        const half = (contentW - 30) / 2;
        doc.rect(left + 10, bodyY, half, statsH).fill('#f3f7f4');
        doc.rect(col2, bodyY, half, statsH).fill('#f3f7f4');
        doc.font('Helvetica').fontSize(8).fillColor(WOG_PDF.muted);
        doc.text('COLLI', left + 18, bodyY + 5);
        doc.text('GEWICHT', col2 + 8, bodyY + 5);
        doc.font('Helvetica-Bold').fontSize(12).fillColor(WOG_PDF.ink);
        doc.text(o.packageCount != null ? String(o.packageCount) : '–', left + 18, bodyY + 14);
        doc.text(o.weightKg != null ? `${o.weightKg} kg` : '–', col2 + 8, bodyY + 14);
        bodyY += statsH + 8;

        if (o.goodsDescription?.trim()) {
          doc.font('Helvetica-Bold').fontSize(8).fillColor(WOG_PDF.muted);
          doc.text('WARE', left + 10, bodyY);
          bodyY += 11;
          doc.font('Helvetica').fontSize(9).fillColor(WOG_PDF.ink);
          doc.text(o.goodsDescription.trim(), left + 10, bodyY, { width: contentW - 20 });
          bodyY = doc.y + 6;
        }

        const bodyBottom = bodyY + 4;
        doc
          .rect(left, bodyTop, contentW, bodyBottom - bodyTop)
          .lineWidth(1)
          .strokeColor(WOG_PDF.line)
          .stroke();

        doc.y = bodyBottom + 12;
        doc.x = left;
      }

      ensureSpace(36);
      const sumY = doc.y;
      doc.rect(left, sumY, contentW, 28).fill(WOG_PDF.green);
      doc.fillColor(WOG_PDF.white).font('Helvetica-Bold').fontSize(10);
      doc.text(
        `Gesamt  ·  ${data.orders.length} Sendung${data.orders.length === 1 ? '' : 'en'}  ·  ${totalColli || '–'} Colli  ·  ${totalWeight || '–'} kg`,
        left + 10,
        sumY + 8,
        { width: contentW - 20 },
      );
      doc.y = sumY + 36;

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
