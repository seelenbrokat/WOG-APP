import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { DocumentType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';

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
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const stream = createWriteStream(storagePath);
      doc.pipe(stream);

      doc.fontSize(18).fillColor('#111').text('WOG Logistics', { continued: false });
      doc.fontSize(14).text('Auftragsbestätigung / Ladeliste');
      doc.moveDown(0.4);
      doc
        .moveTo(48, doc.y)
        .lineTo(547, doc.y)
        .strokeColor('#cccccc')
        .stroke();
      doc.moveDown(0.6);

      doc.fontSize(11).fillColor('#000');
      doc.text(`Auftrag: ${order.externalNumber}`);
      doc.text(`Mandant: ${order.mandant?.name || '–'}`);
      doc.text(`Frachtzahler: ${order.freightPayer?.name || '–'}`);
      doc.text(`Datum: ${new Date().toLocaleString('de-AT')}`);
      doc.text(`Status Auftrag: ${order.status}`);
      if (order.soloplanRef) {
        doc.fontSize(9).fillColor('#555').text(`TMS-Referenz: ${order.soloplanRef}`);
        doc.fontSize(11).fillColor('#000');
      }
      doc.moveDown();

      const totalColli = order.shipments.reduce(
        (sum: number, s: any) => sum + (s.packageCount || s.colli?.length || 0),
        0,
      );
      const totalWeight = order.shipments.reduce(
        (sum: number, s: any) => sum + (Number(s.weightKg) || 0),
        0,
      );
      doc.text(`Sendungen: ${order.shipments.length}  ·  Colli gesamt: ${totalColli}  ·  Gewicht: ${totalWeight || '–'} kg`);
      doc.moveDown(0.8);

      let colloRunning = 0;
      order.shipments.forEach((shipment: any, idx: number) => {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(12).fillColor('#000').text(`Sendung ${idx + 1}: ${shipment.trackingNumber}`, {
          underline: false,
        });
        doc.fontSize(9).fillColor('#444');
        if (shipment.reference) doc.text(`Referenz: ${shipment.reference}`);
        doc.text(`Status: ${shipment.status}`);
        doc.text(
          `Von: ${[shipment.pickupCompany, shipment.pickupStreet, `${shipment.pickupZip || ''} ${shipment.pickupCity || ''}`, shipment.pickupCountry].filter(Boolean).join(', ')}`,
        );
        doc.text(
          `Nach: ${[shipment.deliveryCompany, shipment.deliveryStreet, `${shipment.deliveryZip || ''} ${shipment.deliveryCity || ''}`, shipment.deliveryCountry].filter(Boolean).join(', ')}`,
        );
        if (shipment.goodsDescription) doc.text(`Ware: ${shipment.goodsDescription}`);
        doc.moveDown(0.3);

        const rows =
          shipment.colli?.length > 0
            ? shipment.colli
            : (shipment.positions || []).map((p: any, i: number) => ({
                itemNumber: i + 1,
                sscc: p.sscc,
                content: p.description,
                weightKg: p.weightKg,
                lengthCm: p.lengthCm,
                widthCm: p.widthCm,
                heightCm: p.heightCm,
              }));

        if (!rows.length) {
          doc.text(`  Colli: ${shipment.packageCount || 1}  Gewicht: ${shipment.weightKg ?? '–'} kg`);
        } else {
          doc.fontSize(9).fillColor('#000');
          for (const c of rows) {
            colloRunning += 1;
            const dims =
              c.lengthCm != null || c.widthCm != null || c.heightCm != null
                ? `${c.lengthCm ?? '–'}×${c.widthCm ?? '–'}×${c.heightCm ?? '–'} cm`
                : '–';
            doc.text(
              `  ${colloRunning}. Collo ${c.itemNumber ?? ''}  ${c.content || '–'}  ·  ${c.weightKg ?? '–'} kg  ·  ${dims}${c.sscc ? `  ·  SSCC ${c.sscc}` : ''}`,
            );
          }
        }
        doc.moveDown(0.7);
      });

      if (doc.y > 680) doc.addPage();
      doc.moveDown();
      doc.fontSize(10).fillColor('#000');
      doc.text('Übergabe an Fahrer / Empfangsbestätigung');
      doc.moveDown(0.5);
      doc.text('Name: ____________________________  Unterschrift: ____________________________');
      doc.moveDown(0.4);
      doc.text('Datum/Uhrzeit: ____________________  Kennzeichen: ____________________');
      doc.moveDown(1);
      doc.fontSize(8).fillColor('#666').text(
        'Dieses Dokument bestätigt die Übermittlung des Auftrags an WOG und dient als Ladeliste für die Abholung.',
      );

      doc.end();
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });
  }
}
