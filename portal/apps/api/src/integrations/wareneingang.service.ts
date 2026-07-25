import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentType, ShipmentStatus, UserRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
} from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { writeTransportLabelPdf, writeTransportLabelsPrintPdf } from '../labels/label-pdf';
import { normalizeIncomingSscc } from '../labels/sscc';
import { allocateVlbExternalNumber } from '../shipments/order-number';
import {
  isWareneingangXml,
  parseWareneingangXml,
  type ParsedWareneingangOrder,
} from './wareneingang-xml.parser';

function trackingNumber() {
  const d = new Date();
  const y = d.getFullYear().toString().slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const rand = randomBytes(3).toString('hex').toUpperCase();
  return `WOG${y}${m}${rand}`;
}

@Injectable()
export class WareneingangService {
  private readonly logger = new Logger(WareneingangService.name);
  private inboundDir: string;
  private uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.inboundDir = join(sftpInbound, 'intouch', 'dokumente');
    this.uploadDir =
      this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
    if (!existsSync(this.uploadDir)) mkdirSync(this.uploadDir, { recursive: true });
  }

  /** Worker: WareneingangXML.v1 aus Intouch dokumente/ importieren. */
  async processInboundDir(organizationId?: string, limit = 50) {
    const org =
      (organizationId
        ? await this.prisma.organization.findUnique({ where: { id: organizationId } })
        : null) ||
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } }));
    if (!org) return { processed: 0, skipped: 0, failed: 0 };

    if (!existsSync(this.inboundDir)) {
      return { processed: 0, skipped: 0, failed: 0 };
    }

    const processedDir = join(this.inboundDir, 'processed');
    if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });

    const files = readdirSync(this.inboundDir)
      .filter((f) => f !== 'processed' && !f.startsWith('.') && f.toLowerCase().endsWith('.xml'))
      .sort();

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    for (const fileName of files) {
      if (processed >= limit) break;
      const full = join(this.inboundDir, fileName);
      let preview = '';
      try {
        preview = readFileSync(full, 'utf8').slice(0, 800);
      } catch {
        continue;
      }
      if (!isWareneingangXml(fileName, preview)) {
        skipped += 1;
        continue;
      }

      try {
        const xml = readFileSync(full, 'utf8');
        const parsed = parseWareneingangXml(xml);
        if (!parsed) {
          failed += 1;
          this.logger.warn(`Wareneingang parse leer: ${fileName}`);
          continue;
        }

        await this.importOrder(org.id, parsed, fileName);

        const dest = join(processedDir, `${Date.now()}_${fileName}`);
        renameSync(full, dest);
        await this.prisma.intouchFile.create({
          data: {
            organizationId: org.id,
            channel: 'dokumente',
            fileName,
            storagePath: dest,
            sizeBytes: statSync(dest).size,
            status: 'PROCESSED',
            note: `Wareneingang Order ${parsed.orderNumber}`,
          },
        });
        processed += 1;
        this.logger.log(`Wareneingang importiert: ${parsed.orderNumber} (${fileName})`);
      } catch (err: unknown) {
        failed += 1;
        this.logger.error(
          `Wareneingang import failed ${fileName}`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (processed || failed) {
      this.logger.log(`Wareneingang: ${processed} importiert, ${failed} fehlgeschlagen`);
    }
    return { processed, skipped, failed };
  }

  /**
   * Bereits archivierte Wareneingang-XMLs aus processed/ nachziehen
   * (z. B. vor Parser-Existenz als „sonstige“ abgelegt).
   */
  async reimportFromProcessed(organizationId?: string, limit = 20) {
    const org =
      (organizationId
        ? await this.prisma.organization.findUnique({ where: { id: organizationId } })
        : null) ||
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } }));
    if (!org) return { processed: 0, failed: 0 };

    const processedDir = join(this.inboundDir, 'processed');
    if (!existsSync(processedDir)) return { processed: 0, failed: 0 };

    const files = readdirSync(processedDir)
      .filter((f) => f.toLowerCase().endsWith('.xml'))
      .sort()
      .reverse();

    let processed = 0;
    let failed = 0;

    for (const storedName of files) {
      if (processed >= limit) break;
      const full = join(processedDir, storedName);
      let xml: string;
      try {
        xml = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (!isWareneingangXml(storedName, xml.slice(0, 800))) continue;

      try {
        const parsed = parseWareneingangXml(xml);
        if (!parsed) {
          failed += 1;
          continue;
        }
        // schon als Sendung vorhanden?
        const existing = await this.prisma.shipment.findFirst({
          where: {
            organizationId: org.id,
            OR: [
              { reference: `WE-${parsed.orderNumber}` },
              { soloplanRef: parsed.orderNumber },
            ],
          },
          select: { id: true },
        });
        if (existing) continue;

        await this.importOrder(org.id, parsed, storedName);
        await this.prisma.intouchFile.create({
          data: {
            organizationId: org.id,
            channel: 'dokumente',
            fileName: storedName.includes('_')
              ? storedName.replace(/^\d+_/, '')
              : storedName,
            storagePath: full,
            sizeBytes: statSync(full).size,
            status: 'PROCESSED',
            note: `Wareneingang Order ${parsed.orderNumber} (Reimport)`,
          },
        });
        processed += 1;
      } catch (err: unknown) {
        failed += 1;
        this.logger.error(
          `Wareneingang reimport failed ${storedName}`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return { processed, failed };
  }

  private async importOrder(
    organizationId: string,
    parsed: ParsedWareneingangOrder,
    sourceFile: string,
  ) {
    const existing = await this.prisma.shipment.findFirst({
      where: {
        organizationId,
        OR: [{ reference: `WE-${parsed.orderNumber}` }, { soloplanRef: parsed.orderNumber }],
      },
      select: { id: true },
    });
    if (existing) return existing;

    const mandant = await this.resolveMandant(organizationId, parsed.orgaNumber);
    const customer = await this.resolveCustomer(organizationId, parsed);
    const consignment = parsed.consignments[0];
    if (!consignment) throw new Error(`Keine Consignment in Order ${parsed.orderNumber}`);

    const admin = await this.prisma.user.findFirst({
      where: { organizationId, role: UserRole.ORG_ADMIN },
      select: { id: true },
    });

    const externalNumber = await allocateVlbExternalNumber(this.prisma, organizationId);

    const order = await this.prisma.transportOrder.create({
      data: {
        organizationId,
        mandantId: mandant.id,
        freightPayerCustomerId: customer.id,
        externalNumber,
        createdById: admin?.id,
      },
    });

    const flatItems = consignment.items.length
      ? consignment.items
      : [
          {
            positionNumber: 1,
            quantity: 1,
            content: 'Wareneingang',
            packaging: undefined,
            weightKg: undefined,
          },
        ];

    // quantity>1 ohne SSCC → mehrere Colli
    const colliPlan: Array<{
      content?: string;
      packaging?: string;
      weightKg?: number;
      lengthCm?: number;
      widthCm?: number;
      heightCm?: number;
      sscc?: string;
    }> = [];
    for (const it of flatItems) {
      const qty = Math.max(1, it.quantity || 1);
      const unitW =
        it.weightKg != null && qty > 1
          ? Math.round((it.weightKg / qty) * 1000) / 1000
          : it.weightKg;
      for (let i = 0; i < qty; i++) {
        colliPlan.push({
          content: it.content,
          packaging: it.packaging,
          weightKg: unitW,
          lengthCm: it.lengthCm,
          widthCm: it.widthCm,
          heightCm: it.heightCm,
          sscc: i === 0 ? it.sscc : undefined,
        });
      }
    }

    const weightKg = colliPlan.reduce((s, c) => s + (c.weightKg || 0), 0) || undefined;
    const track = trackingNumber();

    const shipment = await this.prisma.shipment.create({
      data: {
        organizationId,
        mandantId: mandant.id,
        customerId: customer.id,
        orderId: order.id,
        trackingNumber: track,
        trackingPin: String(Math.floor(1000 + Math.random() * 9000)),
        reference: `WE-${parsed.orderNumber}`,
        soloplanRef: parsed.orderNumber,
        status: ShipmentStatus.SUBMITTED,
        goodsDescription: 'Wareneingang',
        packageCount: colliPlan.length,
        weightKg,
        pickupCompany: consignment.absName || parsed.name1,
        pickupStreet: consignment.absStreet || parsed.street,
        pickupZip: consignment.absZip || parsed.zipCode,
        pickupCity: consignment.absCity || parsed.location1,
        pickupCountry: consignment.absCountry || parsed.country || 'CH',
        pickupDate: consignment.ladeStart ? new Date(consignment.ladeStart) : undefined,
        deliveryCompany: consignment.empfName,
        deliveryStreet: consignment.empfStreet,
        deliveryZip: consignment.empfZip,
        deliveryCity: consignment.empfCity,
        deliveryCountry: consignment.empfCountry || 'AT',
        deliveryDate: consignment.lieferStart ? new Date(consignment.lieferStart) : undefined,
        notes: [
          consignment.transportOrderNumber
            ? `Soloplan-TO ${consignment.transportOrderNumber}`
            : null,
          `Quelle ${sourceFile}`,
        ]
          .filter(Boolean)
          .join(' · '),
      },
    });

    const createdColli: Array<{
      itemNumber: number;
      sscc: string;
      content?: string | null;
      packaging?: string | null;
      weightKg?: number | null;
      lengthCm?: number | null;
      widthCm?: number | null;
      heightCm?: number | null;
    }> = [];

    let itemNumber = 1;
    for (const plan of colliPlan) {
      let sscc = normalizeIncomingSscc(plan.sscc || '') || '';
      if (!sscc) {
        // Fallback: stabile synthetische SSCC-artige ID (nicht GS1) für Scan-Registry
        sscc = `WE${parsed.orderNumber}${String(itemNumber).padStart(4, '0')}`.slice(0, 32);
      }
      // Unique collision → Suffix
      const clash = await this.prisma.shipmentCollo.findUnique({ where: { sscc } });
      if (clash) sscc = `${sscc}-${itemNumber}`.slice(0, 32);

      await this.prisma.shipmentCollo.create({
        data: {
          shipmentId: shipment.id,
          itemNumber,
          sscc,
          content: plan.content || 'Wareneingang',
          packaging: plan.packaging,
          quantity: 1,
          weightKg: plan.weightKg,
          lengthCm: plan.lengthCm,
          widthCm: plan.widthCm,
          heightCm: plan.heightCm,
        },
      });
      createdColli.push({
        itemNumber,
        sscc,
        content: plan.content || 'Wareneingang',
        packaging: plan.packaging,
        weightKg: plan.weightKg,
        lengthCm: plan.lengthCm,
        widthCm: plan.widthCm,
        heightCm: plan.heightCm,
      });
      itemNumber += 1;
    }

    if (createdColli.length) {
      await this.writeLabels(shipment, customer.id, createdColli, admin?.id);
    }

    return shipment;
  }

  private async writeLabels(
    shipment: {
      id: string;
      organizationId: string;
      trackingNumber: string;
      reference: string | null;
      goodsDescription: string | null;
      pickupCompany: string | null;
      pickupStreet: string | null;
      pickupZip: string | null;
      pickupCity: string | null;
      pickupCountry: string | null;
      deliveryCompany: string | null;
      deliveryStreet: string | null;
      deliveryZip: string | null;
      deliveryCity: string | null;
      deliveryCountry: string | null;
    },
    customerId: string,
    colli: Array<{
      itemNumber: number;
      sscc: string;
      content?: string | null;
      packaging?: string | null;
      weightKg?: number | null;
      lengthCm?: number | null;
      widthCm?: number | null;
      heightCm?: number | null;
    }>,
    uploadedById?: string,
  ) {
    const labelShipment = {
      trackingNumber: shipment.trackingNumber,
      reference: shipment.reference,
      goodsDescription: shipment.goodsDescription,
      pickupCompany: shipment.pickupCompany,
      pickupStreet: shipment.pickupStreet,
      pickupZip: shipment.pickupZip,
      pickupCity: shipment.pickupCity,
      pickupCountry: shipment.pickupCountry,
      deliveryCompany: shipment.deliveryCompany,
      deliveryStreet: shipment.deliveryStreet,
      deliveryZip: shipment.deliveryZip,
      deliveryCity: shipment.deliveryCity,
      deliveryCountry: shipment.deliveryCountry,
      mandantName: 'WOG',
    };
    const labelColli = colli.map((c) => ({ ...c, totalColli: colli.length }));

    for (const collo of labelColli) {
      const fileName = `Label-${shipment.trackingNumber}-${collo.itemNumber}-${collo.sscc}.pdf`;
      const storagePath = join(this.uploadDir, fileName);
      await writeTransportLabelPdf(labelShipment, collo, storagePath);
      await this.prisma.document.create({
        data: {
          organizationId: shipment.organizationId,
          shipmentId: shipment.id,
          customerId,
          type: DocumentType.LABEL,
          fileName,
          mimeType: 'application/pdf',
          storagePath,
          sizeBytes: statSync(storagePath).size,
          uploadedById,
        },
      });
    }

    const printFileName = `Etiketten-${shipment.trackingNumber}.pdf`;
    const printPath = join(this.uploadDir, printFileName);
    await writeTransportLabelsPrintPdf(labelShipment, labelColli, printPath);
    await this.prisma.document.create({
      data: {
        organizationId: shipment.organizationId,
        shipmentId: shipment.id,
        customerId,
        type: DocumentType.LABEL,
        fileName: printFileName,
        mimeType: 'application/pdf',
        storagePath: printPath,
        sizeBytes: statSync(printPath).size,
        uploadedById,
      },
    });
  }

  private async resolveMandant(organizationId: string, orgaNumber?: string) {
    // OrgaNumber 2 ≈ WOG Logistics AG, 1 ≈ WOG GmbH (Soloplan-Org)
    const preferredCode = orgaNumber === '2' ? 'AG' : orgaNumber === '1' ? 'GMBH' : 'AG';
    const mandant =
      (await this.prisma.mandant.findFirst({
        where: { organizationId, code: preferredCode, active: true },
      })) ||
      (await this.prisma.mandant.findFirst({
        where: { organizationId, active: true },
        orderBy: { code: 'asc' },
      }));
    if (!mandant) throw new Error('Kein Mandant für Wareneingang');
    return mandant;
  }

  private async resolveCustomer(organizationId: string, parsed: ParsedWareneingangOrder) {
    const bpId = parsed.businessPartnerId;
    if (bpId) {
      const existing = await this.prisma.customer.findFirst({
        where: {
          organizationId,
          OR: [{ soloplanBusinessPartnerId: bpId }, { customerNumber: bpId }, { matchcode: bpId }],
        },
      });
      if (existing) {
        if (!existing.soloplanBusinessPartnerId) {
          await this.prisma.customer.update({
            where: { id: existing.id },
            data: { soloplanBusinessPartnerId: bpId, matchcode: existing.matchcode || bpId },
          });
        }
        return existing;
      }
      return this.prisma.customer.create({
        data: {
          organizationId,
          name: parsed.name1 || `BP ${bpId}`,
          customerNumber: bpId,
          matchcode: bpId,
          soloplanBusinessPartnerId: bpId,
          active: true,
        },
      });
    }

    const fallback = await this.prisma.customer.findFirst({
      where: { organizationId, customerNumber: 'WOGDIEPO' },
    });
    if (fallback) return fallback;
    throw new Error('Kein Kunde für Wareneingang');
  }
}
