import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { DocumentType, UserRole } from '@prisma/client';
import { shipmentExtrasLabels, type ShipmentExtras } from '@wog/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { drawA4BrandHeader, drawA4Footer, WOG_PDF } from '../common/pdf-brand';

@Injectable()
export class OrdersService {
  private uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private audit: AuditService,
  ) {
    this.uploadDir = this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
    if (!existsSync(this.uploadDir)) mkdirSync(this.uploadDir, { recursive: true });
  }

  private orderScope(user: AuthUser) {
    const where: Record<string, unknown> = { organizationId: user.organizationId };
    if (user.role === UserRole.CUSTOMER_USER && user.customerId) {
      where.freightPayerCustomerId = user.customerId;
    }
    if (
      (user.role === UserRole.MANDANT_DISPATCHER || user.role === UserRole.PARTNER) &&
      user.mandantIds?.length
    ) {
      where.mandantId = { in: user.mandantIds };
    }
    return where;
  }

  list(user: AuthUser, opts?: { customerId?: string; openOnly?: boolean }) {
    const where: Record<string, unknown> = { ...this.orderScope(user) };
    if (opts?.customerId && user.role !== UserRole.CUSTOMER_USER) {
      where.freightPayerCustomerId = opts.customerId;
    }
    if (opts?.openOnly) {
      where.status = { in: ['OPEN', 'SUBMITTED'] };
    }
    return this.prisma.transportOrder.findMany({
      where,
      include: {
        mandant: true,
        freightPayer: true,
        shipments: {
          select: {
            id: true,
            trackingNumber: true,
            status: true,
            packageCount: true,
            weightKg: true,
            pickupCity: true,
            deliveryCity: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { shipments: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async get(user: AuthUser, id: string) {
    const order = await this.prisma.transportOrder.findFirst({
      where: { id, ...this.orderScope(user) },
      include: {
        mandant: true,
        freightPayer: true,
        shipments: {
          include: {
            positions: true,
            colli: { orderBy: { itemNumber: 'asc' } },
          },
          orderBy: { createdAt: 'asc' },
        },
        documents: {
          where: { type: DocumentType.LOADING_LIST },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });
    if (!order) throw new NotFoundException('Auftrag nicht gefunden');
    return order;
  }

  /** Kumulierte Ladeliste / Auftragsbestätigung für alle Sendungen des Auftrags. */
  async generateLoadingList(user: AuthUser, orderId: string) {
    const order = await this.get(user, orderId);
    if (!order.shipments.length) {
      throw new NotFoundException('Auftrag hat noch keine Sendungen');
    }

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fileName = `Ladeliste-${order.externalNumber}-${stamp}.pdf`;
    const storagePath = join(this.uploadDir, fileName);
    await this.writeLoadingListPdf(order, storagePath);

    const primaryShipment = order.shipments[0];
    const doc = await this.prisma.document.create({
      data: {
        organizationId: order.organizationId,
        transportOrderId: order.id,
        shipmentId: primaryShipment.id,
        customerId: order.freightPayerCustomerId,
        type: DocumentType.LOADING_LIST,
        fileName,
        mimeType: 'application/pdf',
        storagePath,
        sizeBytes: statSync(storagePath).size,
        uploadedById: user.id,
      },
    });

    await this.audit.log(user.id, 'document.loading_list', 'Document', doc.id, {
      orderId: order.id,
      externalNumber: order.externalNumber,
      shipmentCount: order.shipments.length,
    });

    return { order, document: doc };
  }

  private writeLoadingListPdf(order: any, storagePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        margin: 48,
        size: 'A4',
        bufferPages: true,
        info: {
          Title: `Ladeliste ${order.externalNumber}`,
          Author: 'WOG Logistics',
          Subject: 'Auftragsbestätigung / Ladeliste',
        },
      });
      const stream = createWriteStream(storagePath);
      doc.pipe(stream);

      const left = 48;
      const right = 547;
      const contentW = right - left;
      let pageNumber = 1;

      const ensureSpace = (need: number) => {
        // Platz für Footer im unteren Rand lassen
        if (doc.y + need > doc.page.height - 56) {
          doc.addPage();
          pageNumber += 1;
          drawA4BrandHeader(doc, {
            title: 'Auftragsbestätigung / Ladeliste',
            subtitle: `${order.externalNumber}  ·  Fortsetzung`,
          });
        }
      };

      drawA4BrandHeader(doc, {
        title: 'Auftragsbestätigung / Ladeliste',
        subtitle: 'Kundenportal  ·  verbindliche Abholunterlage',
      });

      // Meta-Box
      const metaTop = doc.y;
      doc.rect(left, metaTop, contentW, 78).fill(WOG_PDF.soft);
      doc.fillColor(WOG_PDF.ink).font('Helvetica-Bold').fontSize(11);
      doc.text(`Auftrag ${order.externalNumber}`, left + 12, metaTop + 10, { width: contentW / 2 - 16 });
      doc.font('Helvetica').fontSize(9).fillColor(WOG_PDF.muted);
      doc.text(`erstellt ${new Date().toLocaleString('de-AT')}`, left + contentW / 2, metaTop + 12, {
        width: contentW / 2 - 12,
        align: 'right',
      });

      doc.fillColor(WOG_PDF.ink).fontSize(9);
      const col1 = left + 12;
      const col2 = left + contentW / 2 + 4;
      let my = metaTop + 30;
      const metaLine = (x: number, y: number, label: string, value: string, labelW = 78) => {
        doc.font('Helvetica-Bold').fillColor(WOG_PDF.muted).text(label, x, y, {
          width: labelW,
          lineBreak: false,
        });
        doc.font('Helvetica').fillColor(WOG_PDF.ink).text(value, x + labelW, y, {
          width: contentW / 2 - labelW - 20,
          lineBreak: false,
        });
      };
      metaLine(col1, my, 'Mandant', order.mandant?.name || '–');
      metaLine(col2, my, 'Status', order.status, 55);
      my += 14;
      metaLine(col1, my, 'Frachtzahler', order.freightPayer?.name || '–');
      if (order.soloplanRef) {
        metaLine(col2, my, 'TMS', String(order.soloplanRef), 55);
      }
      my += 14;
      const totalColli = order.shipments.reduce(
        (sum: number, s: any) => sum + (s.packageCount || s.colli?.length || 0),
        0,
      );
      const totalWeight = order.shipments.reduce(
        (sum: number, s: any) => sum + (Number(s.weightKg) || 0),
        0,
      );
      metaLine(col1, my, 'Sendungen', String(order.shipments.length));
      metaLine(col2, my, 'Colli / kg', `${totalColli}  ·  ${totalWeight || '–'} kg`, 55);
      doc.x = left;
      doc.y = metaTop + 88;

      let colloRunning = 0;
      order.shipments.forEach((shipment: any, idx: number) => {
        ensureSpace(120);
        const headY = doc.y;
        doc.rect(left, headY, contentW, 18).fill(WOG_PDF.green);
        doc
          .fillColor(WOG_PDF.white)
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(
            `Sendung ${idx + 1}  ·  ${shipment.trackingNumber}${shipment.reference ? `  ·  Ref. ${shipment.reference}` : ''}`,
            left + 8,
            headY + 4,
            { width: contentW - 16 },
          );
        doc.y = headY + 24;

        doc.fillColor(WOG_PDF.ink).font('Helvetica').fontSize(9);
        const addrW = contentW / 2 - 8;
        const addrY = doc.y;
        doc.font('Helvetica-Bold').fillColor(WOG_PDF.greenDeep).text('Abholung', left, addrY);
        doc.font('Helvetica').fillColor(WOG_PDF.ink);
        doc.text(shipment.pickupCompany || '–', left, doc.y, { width: addrW });
        doc.text(shipment.pickupStreet || '', { width: addrW });
        doc.text(
          `${shipment.pickupZip || ''} ${shipment.pickupCity || ''}  ${shipment.pickupCountry || ''}`.trim(),
          { width: addrW },
        );
        const leftBottom = doc.y;

        doc.y = addrY;
        doc.font('Helvetica-Bold').fillColor(WOG_PDF.greenDeep).text('Zustellung', col2, addrY);
        doc.font('Helvetica').fillColor(WOG_PDF.ink);
        doc.text(shipment.deliveryCompany || '–', col2, doc.y, { width: addrW });
        doc.text(shipment.deliveryStreet || '', col2, doc.y, { width: addrW });
        doc.text(
          `${shipment.deliveryZip || ''} ${shipment.deliveryCity || ''}  ${shipment.deliveryCountry || ''}`.trim(),
          col2,
          doc.y,
          { width: addrW },
        );
        if (shipment.deliveryAvisPhone) {
          doc.fillColor(WOG_PDF.muted).text(`Avis: ${shipment.deliveryAvisPhone}`, col2, doc.y, {
            width: addrW,
          });
        }
        doc.y = Math.max(leftBottom, doc.y) + 6;
        doc.x = left;

        if (shipment.goodsDescription) {
          doc.fillColor(WOG_PDF.ink).font('Helvetica').text(`Ware: ${shipment.goodsDescription}`, {
            width: contentW,
          });
        }
        const extraLabels = shipmentExtrasLabels(shipment.extras as ShipmentExtras);
        if (extraLabels.length) {
          doc.fillColor(WOG_PDF.muted).text(`Zusatz: ${extraLabels.join(' · ')}`, { width: contentW });
        }
        doc.moveDown(0.25);

        const rows =
          shipment.colli?.length > 0
            ? shipment.colli
            : (shipment.positions || []).map((p: any, i: number) => ({
                itemNumber: i + 1,
                sscc: p.sscc,
                packaging: p.packaging,
                content: p.description,
                weightKg: p.weightKg,
                lengthCm: p.lengthCm,
                widthCm: p.widthCm,
                heightCm: p.heightCm,
              }));

        if (!rows.length) {
          doc
            .fillColor(WOG_PDF.ink)
            .text(`Colli: ${shipment.packageCount || 1}   Gewicht: ${shipment.weightKg ?? '–'} kg`);
        } else {
          ensureSpace(28 + rows.length * 14);
          const cols = [
            { key: 'nr', label: '#', w: 22 },
            { key: 'pkg', label: 'Verp.', w: 40 },
            { key: 'content', label: 'Inhalt', w: 150 },
            { key: 'kg', label: 'kg', w: 40 },
            { key: 'dims', label: 'L×B×H cm', w: 78 },
            { key: 'sscc', label: 'SSCC', w: 119 },
          ] as const;
          const tableX = left;
          let tx = tableX;
          const thY = doc.y;
          doc.rect(tableX, thY, contentW, 14).fill(WOG_PDF.line);
          doc.fillColor(WOG_PDF.ink).font('Helvetica-Bold').fontSize(8);
          for (const c of cols) {
            doc.text(c.label, tx + 2, thY + 3, { width: c.w - 4, lineBreak: false });
            tx += c.w;
          }
          doc.y = thY + 16;
          doc.font('Helvetica').fontSize(8);
          for (const c of rows) {
            ensureSpace(16);
            colloRunning += 1;
            const dims =
              c.lengthCm != null || c.widthCm != null || c.heightCm != null
                ? `${c.lengthCm ?? '–'}×${c.widthCm ?? '–'}×${c.heightCm ?? '–'}`
                : '–';
            const values = [
              String(colloRunning),
              c.packaging || '–',
              String(c.content || '–').slice(0, 42),
              c.weightKg != null ? String(c.weightKg) : '–',
              dims,
              c.sscc || '–',
            ];
            const rowY = doc.y;
            if (colloRunning % 2 === 0) {
              doc.rect(tableX, rowY - 1, contentW, 13).fill('#f7faf8');
            }
            doc.fillColor(WOG_PDF.ink);
            let cx = tableX;
            values.forEach((v, i) => {
              doc.text(v, cx + 2, rowY, { width: cols[i].w - 4, lineBreak: false });
              cx += cols[i].w;
            });
            doc.y = rowY + 13;
          }
          doc
            .moveTo(tableX, doc.y)
            .lineTo(tableX + contentW, doc.y)
            .strokeColor(WOG_PDF.line)
            .lineWidth(0.5)
            .stroke();
        }
        doc.moveDown(0.7);
        doc.x = left;
      });

      ensureSpace(110);
      const boxY = doc.y;
      doc.rect(left, boxY, contentW, 88).strokeColor(WOG_PDF.green).lineWidth(1).stroke();
      doc
        .fillColor(WOG_PDF.greenDeep)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('Übergabe an Fahrer / Empfangsbestätigung', left + 10, boxY + 8);
      doc.fillColor(WOG_PDF.ink).font('Helvetica').fontSize(9);
      doc.text('Name: ________________________________', left + 10, boxY + 28);
      doc.text('Unterschrift: _________________________', left + contentW / 2, boxY + 28);
      doc.text('Datum / Uhrzeit: ______________________', left + 10, boxY + 50);
      doc.text('Kennzeichen: _________________________', left + contentW / 2, boxY + 50);
      doc
        .fontSize(7)
        .fillColor(WOG_PDF.muted)
        .text(
          'Dieses Dokument bestätigt die Übermittlung des Auftrags an WOG und dient als Ladeliste für die Abholung.',
          left + 10,
          boxY + 70,
          { width: contentW - 20 },
        );

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
}
