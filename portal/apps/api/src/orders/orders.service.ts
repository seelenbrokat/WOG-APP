import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { DocumentType, NotificationEvent, ShipmentStatus, UserRole } from '@prisma/client';
import { shipmentExtrasLabels, type ShipmentExtras } from '@wog/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { drawA4BrandHeader, drawA4Footer, formatPdfDateTime, WOG_PDF } from '../common/pdf-brand';
import { SoloplanService } from '../integrations/soloplan.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class OrdersService {
  private uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private audit: AuditService,
    private soloplan: SoloplanService,
    private notifications: NotificationsService,
  ) {
    this.uploadDir = this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
    if (!existsSync(this.uploadDir)) mkdirSync(this.uploadDir, { recursive: true });
  }

  private orderScope(user: AuthUser) {
    const where: Record<string, unknown> = { organizationId: user.organizationId };
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) {
        throw new ForbiddenException('Kein Kundenkonto verknüpft');
      }
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

  /** Ladeliste / Auftragsbestätigung für einen Auftrag (1 Sendung). */
  async generateLoadingList(user: AuthUser, orderId: string) {
    const order = await this.get(user, orderId);
    if (!order.shipments.length) {
      throw new NotFoundException('Auftrag hat noch keine Sendungen');
    }
    return this.createLoadingListDocument(user, [order]);
  }

  /**
   * Mehrere Aufträge markieren → eine gemeinsame Ladeliste.
   * handover=true: Entwürfe auf SUBMITTED setzen und Soloplan-Export anstoßen.
   */
  async generateBulkLoadingList(
    user: AuthUser,
    orderIds: string[],
    opts?: { handover?: boolean },
  ) {
    const uniqueIds = [...new Set((orderIds || []).filter(Boolean))];
    if (!uniqueIds.length) {
      throw new BadRequestException('Mindestens einen Auftrag auswählen');
    }
    if (uniqueIds.length > 50) {
      throw new BadRequestException('Maximal 50 Aufträge auf einmal');
    }

    const orders = [];
    for (const id of uniqueIds) {
      const order = await this.get(user, id);
      if (!order.shipments.length) {
        throw new BadRequestException(`Auftrag ${order.externalNumber} hat keine Sendung`);
      }
      orders.push(order);
    }

    const handover = opts?.handover !== false;
    const handedOver: string[] = [];
    if (handover) {
      for (const order of orders) {
        for (const shipment of order.shipments) {
          if (shipment.status === ShipmentStatus.DRAFT) {
            await this.prisma.shipment.update({
              where: { id: shipment.id },
              data: {
                status: ShipmentStatus.SUBMITTED,
                events: {
                  create: {
                    status: ShipmentStatus.SUBMITTED,
                    message: 'Auftrag übermittelt (Sammelübergabe)',
                    createdBy: user.id,
                  },
                },
              },
            });
            await this.notifications.notifyShipmentUsers(
              shipment.id,
              NotificationEvent.SHIPMENT_CREATED,
              {
                trackingNumber: shipment.trackingNumber,
                mandant: order.mandant?.name,
              },
            );
            // Sofort exportieren (nicht nur Worker-Queue): API und Worker
            // haben getrennte In-Memory-Queues – sonst landet nichts im SFTP.
            await this.soloplan.exportShipment(shipment.id);
            handedOver.push(shipment.id);
          } else if (!shipment.soloplanRef && !order.soloplanRef) {
            await this.soloplan.exportShipment(shipment.id);
          }
        }
        if (order.status === 'OPEN' || order.status === 'DRAFT') {
          await this.prisma.transportOrder.update({
            where: { id: order.id },
            data: { status: 'SUBMITTED' },
          });
        }
      }
    }

    const result = await this.createLoadingListDocument(user, orders);
    return {
      ...result,
      orderCount: orders.length,
      handedOverShipmentIds: handedOver,
      handover,
    };
  }

  private async createLoadingListDocument(user: AuthUser, orders: any[]) {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const numbers = orders.map((o) => o.externalNumber).join('+');
    const short =
      orders.length === 1
        ? orders[0].externalNumber
        : `${orders.length}Auftraege-${orders[0].externalNumber}`;
    const fileName = `Ladeliste-${short}-${stamp}.pdf`.replace(/[^\w.\-+]/g, '_');
    const storagePath = join(this.uploadDir, fileName);
    await this.writeLoadingListPdf(orders, storagePath);

    const primaryOrder = orders[0];
    const primaryShipment = primaryOrder.shipments[0];
    const doc = await this.prisma.document.create({
      data: {
        organizationId: primaryOrder.organizationId,
        transportOrderId: primaryOrder.id,
        shipmentId: primaryShipment.id,
        customerId: primaryOrder.freightPayerCustomerId,
        type: DocumentType.LOADING_LIST,
        fileName,
        mimeType: 'application/pdf',
        storagePath,
        sizeBytes: statSync(storagePath).size,
        uploadedById: user.id,
      },
    });

    await this.audit.log(user.id, 'document.loading_list', 'Document', doc.id, {
      orderIds: orders.map((o) => o.id),
      externalNumbers: orders.map((o) => o.externalNumber),
      orderCount: orders.length,
      shipmentCount: orders.reduce((n, o) => n + o.shipments.length, 0),
      label: numbers,
    });

    await this.notifyLoadingListCreated(user, orders, doc);

    return { orders, order: primaryOrder, document: doc };
  }

  /** Kundenpapiere (wie Verzollung) – mit Auftragsbestätigung per Mail. */
  private static readonly PAPER_DOC_TYPES: DocumentType[] = [
    DocumentType.INVOICE,
    DocumentType.CUSTOMER_UPLOAD,
    DocumentType.CMR,
    DocumentType.CUSTOMS_PAPER,
    DocumentType.OTHER,
  ];

  private async collectCustomerPaperDocs(orders: Array<{ shipments?: Array<{ id: string }> }>) {
    const shipmentIds = [
      ...new Set(
        (orders || []).flatMap((o) => (o.shipments || []).map((s) => s.id)).filter(Boolean),
      ),
    ];
    if (!shipmentIds.length) return [];

    const docs = await this.prisma.document.findMany({
      where: {
        shipmentId: { in: shipmentIds },
        type: { in: OrdersService.PAPER_DOC_TYPES },
      },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        storagePath: true,
        type: true,
      },
    });

    const seen = new Set<string>();
    const papers: Array<{
      id: string;
      fileName: string;
      mimeType: string;
      storagePath: string;
    }> = [];
    for (const d of docs) {
      if (!d.storagePath || !existsSync(d.storagePath)) continue;
      const key = `${d.fileName}|${d.storagePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      papers.push(d);
    }
    return papers;
  }

  /** Benachrichtigung an Dispo, wenn eine Ladeliste erzeugt wurde. */
  private async notifyLoadingListCreated(
    user: AuthUser,
    orders: any[],
    doc: { id: string; fileName: string; storagePath: string },
  ) {
    const raw =
      this.config.get<string>('LOADING_LIST_NOTIFY_EMAIL') ||
      'info@worldofgreen.ch';
    const recipients = raw
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!recipients.length) return;

    const paperDocs = await this.collectCustomerPaperDocs(orders);

    const appUrl = this.config.get('APP_URL') || 'https://wog.logistikberater.at';
    const numbers = orders.map((o) => o.externalNumber).join(', ');
    const freightPayers = [
      ...new Set(orders.map((o) => o.freightPayer?.name).filter(Boolean)),
    ].join(', ');
    const shipmentCount = orders.reduce((n, o) => n + (o.shipments?.length || 0), 0);
    const subject =
      orders.length === 1
        ? `WOG Portal – Ladeliste ${orders[0].externalNumber}`
        : `WOG Portal – Sammelladeliste (${orders.length} Aufträge)`;
    const body = [
      'Es wurde eine Ladeliste / Auftragsbestätigung erzeugt.',
      '',
      `Auftrag(e): ${numbers}`,
      freightPayers ? `Frachtzahler: ${freightPayers}` : null,
      `Sendungen: ${shipmentCount}`,
      `Datei: ${doc.fileName}`,
      `Erstellt von: ${user.email || user.id}`,
      '',
      paperDocs.length
        ? `Anhänge: ${paperDocs.length + 1} Datei(en) (inkl. Auftragsbestätigung)`
        : null,
      ...paperDocs.map((d) => `- ${d.fileName}`),
      paperDocs.length ? `- ${doc.fileName}` : null,
      '',
      `Portal: ${appUrl}`,
    ]
      .filter((line) => line != null)
      .join('\n');

    const attachments = [
      {
        filename: doc.fileName,
        path: doc.storagePath,
        contentType: 'application/pdf',
      },
      ...paperDocs.map((d) => ({
        filename: d.fileName,
        path: d.storagePath,
        contentType: d.mimeType || 'application/octet-stream',
      })),
    ];
    for (const to of recipients) {
      await this.notifications.sendRaw(to, subject, body, undefined, attachments);
    }
  }

  /**
   * Abhol-/Zustelltermine werden als UTC-Kalenderzeit gespeichert (00:00 = 00:00).
   * Deshalb hier UTC formatieren, nicht Europe/Vienna.
   */
  private formatScheduleDateTime(value?: Date | string | null): string | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString('de-CH', {
      timeZone: 'UTC',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private writeLoadingListPdf(orders: any[], storagePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const multi = orders.length > 1;
      const titleNumbers =
        orders.length === 1
          ? orders[0].externalNumber
          : `${orders.length} Aufträge`;

      const doc = new PDFDocument({
        margin: 48,
        size: 'A4',
        bufferPages: true,
        info: {
          Title: `Ladeliste ${titleNumbers}`,
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
        if (doc.y + need > doc.page.height - 56) {
          doc.addPage();
          pageNumber += 1;
          drawA4BrandHeader(doc, {
            title: 'Auftragsbestätigung / Ladeliste',
            subtitle: `${titleNumbers}  ·  Fortsetzung`,
          });
        }
      };

      drawA4BrandHeader(doc, {
        title: 'Auftragsbestätigung / Ladeliste',
        subtitle: multi
          ? 'Kundenportal  ·  Sammelübergabe'
          : 'Kundenportal  ·  verbindliche Abholunterlage',
      });

      const allShipments = orders.flatMap((o) => o.shipments || []);
      const totalColli = allShipments.reduce(
        (sum: number, s: any) => sum + (s.packageCount || s.colli?.length || 0),
        0,
      );
      const totalWeight = allShipments.reduce(
        (sum: number, s: any) => sum + (Number(s.weightKg) || 0),
        0,
      );

      const metaTop = doc.y;
      const metaH = multi ? 92 : 78;
      doc.rect(left, metaTop, contentW, metaH).fill(WOG_PDF.soft);
      doc.fillColor(WOG_PDF.ink).font('Helvetica-Bold').fontSize(11);
      doc.text(
        multi ? `Sammelladeliste · ${orders.length} Aufträge` : `Auftrag ${orders[0].externalNumber}`,
        left + 12,
        metaTop + 10,
        { width: contentW / 2 - 16 },
      );
      doc.font('Helvetica').fontSize(9).fillColor(WOG_PDF.muted);
      doc.text(`erstellt ${formatPdfDateTime()}`, left + contentW / 2, metaTop + 12, {
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

      if (multi) {
        metaLine(col1, my, 'Aufträge', String(orders.length));
        metaLine(col2, my, 'Colli / kg', `${totalColli}  ·  ${totalWeight || '–'} kg`, 55);
        my += 14;
        const list = orders.map((o) => o.externalNumber).join(', ');
        doc.font('Helvetica-Bold').fillColor(WOG_PDF.muted).text('Nummern', col1, my, {
          width: 78,
          lineBreak: false,
        });
        doc
          .font('Helvetica')
          .fillColor(WOG_PDF.ink)
          .text(list, col1 + 78, my, { width: contentW - 100 });
        my = Math.max(my + 14, doc.y);
      } else {
        const order = orders[0];
        metaLine(col1, my, 'Mandant', order.mandant?.name || '–');
        metaLine(col2, my, 'Status', order.status, 55);
        my += 14;
        metaLine(col1, my, 'Frachtzahler', order.freightPayer?.name || '–');
        my += 14;
        metaLine(col1, my, 'Sendung', String(allShipments.length));
        metaLine(col2, my, 'Colli / kg', `${totalColli}  ·  ${totalWeight || '–'} kg`, 55);
      }
      doc.x = left;
      doc.y = metaTop + metaH + 10;

      let colloRunning = 0;
      orders.forEach((order: any, orderIdx: number) => {
        ensureSpace(140);
        const orderHeadY = doc.y;
        doc.rect(left, orderHeadY, contentW, 20).fill(WOG_PDF.greenDeep || WOG_PDF.green);
        doc
          .fillColor(WOG_PDF.white)
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(
            multi
              ? `Auftrag ${orderIdx + 1}/${orders.length}  ·  ${order.externalNumber}`
              : `Auftrag ${order.externalNumber}`,
            left + 8,
            orderHeadY + 5,
            { width: contentW - 16 },
          );
        doc.y = orderHeadY + 26;
        doc.x = left;

        if (multi) {
          doc.fillColor(WOG_PDF.muted).font('Helvetica').fontSize(8);
          doc.text(
            [
              order.mandant?.name ? `Mandant: ${order.mandant.name}` : null,
              order.freightPayer?.name ? `Frachtzahler: ${order.freightPayer.name}` : null,
              order.status ? `Status: ${order.status}` : null,
            ]
              .filter(Boolean)
              .join('  ·  '),
            { width: contentW },
          );
          doc.moveDown(0.3);
        }

        (order.shipments || []).forEach((shipment: any, idx: number) => {
          ensureSpace(120);
          const headY = doc.y;
          doc.rect(left, headY, contentW, 18).fill(WOG_PDF.green);
          doc
            .fillColor(WOG_PDF.white)
            .font('Helvetica-Bold')
            .fontSize(10)
            .text(
              `Sendung${order.shipments.length > 1 ? ` ${idx + 1}` : ''}  ·  ${shipment.trackingNumber}${
                shipment.reference ? `  ·  Ref. ${shipment.reference}` : ''
              }`,
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
          const pickupWhen = this.formatScheduleDateTime(shipment.pickupDate);
          if (pickupWhen) {
            doc
              .font('Helvetica-Bold')
              .fillColor(WOG_PDF.ink)
              .text(`Termin: ${pickupWhen}`, left, doc.y, { width: addrW });
            doc.font('Helvetica');
          }
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
          const deliveryFrom = this.formatScheduleDateTime(shipment.deliveryDate);
          const deliveryTo = this.formatScheduleDateTime(shipment.deliveryDateEnd);
          if (deliveryFrom) {
            const deliveryLabel =
              deliveryTo && deliveryTo !== deliveryFrom
                ? `Termin: ${deliveryFrom} – ${deliveryTo}`
                : `Termin: ${deliveryFrom}`;
            doc
              .font('Helvetica-Bold')
              .fillColor(WOG_PDF.ink)
              .text(deliveryLabel, col2, doc.y, { width: addrW });
            doc.font('Helvetica');
          }
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
          multi
            ? `Dieses Dokument bestätigt die Übermittlung von ${orders.length} Aufträgen an WOG und dient als Ladeliste für die Abholung.`
            : 'Dieses Dokument bestätigt die Übermittlung des Auftrags an WOG und dient als Ladeliste für die Abholung.',
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
