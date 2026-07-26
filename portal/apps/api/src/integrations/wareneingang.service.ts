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
import {
  isWareneingangOrderJson,
  parseWareneingangJson,
} from './wareneingang-json.parser';

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
  /** Intouch: WareneingangXML */
  private inboundDir: string;
  /** Soloplan Order-Feedback JSON (ExternalNumber → OrderNumber) */
  private orderFeedbackDir: string;
  private uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.inboundDir = join(sftpInbound, 'intouch', 'dokumente');
    this.orderFeedbackDir = join(sftpInbound, 'wareneingang', 'rechnungen');
    this.uploadDir =
      this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
    if (!existsSync(this.uploadDir)) mkdirSync(this.uploadDir, { recursive: true });
    for (const d of [
      this.orderFeedbackDir,
      join(this.orderFeedbackDir, 'processed'),
      join(this.orderFeedbackDir, 'failed'),
    ]) {
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
    }
  }

  /** Worker: WareneingangXML + Soloplan-Order-JSON (ExternalNumber-Rückkopplung). */
  async processInboundDir(organizationId?: string, limit = 50) {
    const org =
      (organizationId
        ? await this.prisma.organization.findUnique({ where: { id: organizationId } })
        : null) ||
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } }));
    if (!org) return { processed: 0, skipped: 0, failed: 0, linked: 0 };

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let linked = 0;

    // Zuerst Order-Feedback-JSON (ExternalNumber→OrderNumber), damit XML-Masse das Limit nicht blockiert
    const jsonLimit = Math.min(40, Math.max(10, Math.floor(limit / 2)));
    const jsonResult = await this.processOrderFeedbackJson(org.id, jsonLimit);
    processed += jsonResult.processed;
    skipped += jsonResult.skipped;
    failed += jsonResult.failed;
    linked += jsonResult.linked;

    const remaining = Math.max(0, limit - processed);
    if (remaining > 0) {
      const xmlResult = await this.processXmlInbox(org.id, remaining);
      processed += xmlResult.processed;
      skipped += xmlResult.skipped;
      failed += xmlResult.failed;
      linked += xmlResult.linked;
    }

    if (processed || failed || linked) {
      this.logger.log(
        `Wareneingang: ${processed} verarbeitet (${linked} verknüpft), ${failed} fehlgeschlagen`,
      );
    }
    return { processed, skipped, failed, linked };
  }

  private async processXmlInbox(organizationId: string, limit: number) {
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let linked = 0;

    if (!existsSync(this.inboundDir)) {
      return { processed, skipped, failed, linked };
    }

    const processedDir = join(this.inboundDir, 'processed');
    if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });

    const files = readdirSync(this.inboundDir)
      .filter((f) => f !== 'processed' && !f.startsWith('.') && f.toLowerCase().endsWith('.xml'))
      .sort();

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

        const result = await this.importOrder(organizationId, parsed, fileName);
        if (result?.linked) linked += 1;

        const dest = join(processedDir, `${Date.now()}_${fileName}`);
        renameSync(full, dest);
        await this.prisma.intouchFile.create({
          data: {
            organizationId,
            channel: 'dokumente',
            fileName,
            storagePath: dest,
            sizeBytes: statSync(dest).size,
            status: 'PROCESSED',
            note: parsed.externalNumber
              ? `Wareneingang Order ${parsed.orderNumber} ↔ ${parsed.externalNumber}`
              : `Wareneingang Order ${parsed.orderNumber}`,
          },
        });
        processed += 1;
        this.logger.log(
          `Wareneingang XML: ${parsed.orderNumber}` +
            (parsed.externalNumber ? ` ↔ ${parsed.externalNumber}` : '') +
            ` (${fileName})`,
        );
      } catch (err: unknown) {
        failed += 1;
        this.logger.error(
          `Wareneingang import failed ${fileName}`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return { processed, skipped, failed, linked };
  }

  /**
   * Soloplan legt Order-Feedback als JSON unter inbound/wareneingang/rechnungen ab
   * (OrderNumber + ExternalNumber=VLB…). Verknüpft soloplanRef, ohne Doppel-WE anzulegen.
   */
  private async processOrderFeedbackJson(organizationId: string, limit: number) {
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let linked = 0;

    if (!existsSync(this.orderFeedbackDir)) {
      return { processed, skipped, failed, linked };
    }

    const processedDir = join(this.orderFeedbackDir, 'processed');
    if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });

    const files = readdirSync(this.orderFeedbackDir)
      .filter((f) => f !== 'processed' && f !== 'failed' && !f.startsWith('.') && f.toLowerCase().endsWith('.json'))
      .sort();

    for (const fileName of files) {
      if (processed >= limit) break;
      const full = join(this.orderFeedbackDir, fileName);
      let raw = '';
      try {
        raw = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      if (!isWareneingangOrderJson(fileName, raw.slice(0, 1200))) {
        skipped += 1;
        continue;
      }

      try {
        const parsed = parseWareneingangJson(raw);
        if (!parsed) {
          failed += 1;
          this.logger.warn(`Wareneingang JSON parse leer: ${fileName}`);
          continue;
        }

        const result = await this.importOrder(organizationId, parsed, fileName);
        if (result?.linked) linked += 1;

        const dest = join(processedDir, `${Date.now()}_${fileName}`);
        renameSync(full, dest);
        processed += 1;
        this.logger.log(
          `Wareneingang JSON: Soloplan ${parsed.orderNumber}` +
            (parsed.externalNumber ? ` ↔ ${parsed.externalNumber}` : '') +
            ` (${fileName})`,
        );
      } catch (err: unknown) {
        failed += 1;
        this.logger.error(
          `Wareneingang JSON failed ${fileName}`,
          err instanceof Error ? err.message : err,
        );
        try {
          renameSync(full, join(this.orderFeedbackDir, 'failed', `${Date.now()}_${fileName}`));
        } catch {
          /* ignore */
        }
      }
    }

    return { processed, skipped, failed, linked };
  }

  /**
   * Bereits archivierte Wareneingang-XMLs/JSONs nachziehen
   * (Verknüpfung ExternalNumber → Soloplan OrderNumber).
   */
  async reimportFromProcessed(organizationId?: string, limit = 20) {
    const org =
      (organizationId
        ? await this.prisma.organization.findUnique({ where: { id: organizationId } })
        : null) ||
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } }));
    if (!org) return { processed: 0, failed: 0, linked: 0 };

    let processed = 0;
    let failed = 0;
    let linked = 0;

    // 1) XML aus Intouch processed/
    const xmlDir = join(this.inboundDir, 'processed');
    if (existsSync(xmlDir)) {
      const files = readdirSync(xmlDir)
        .filter((f) => f.toLowerCase().endsWith('.xml'))
        .sort()
        .reverse();

      for (const storedName of files) {
        if (processed >= limit) break;
        const full = join(xmlDir, storedName);
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
          // Ohne ExternalNumber: nur nachziehen, wenn noch keine WE-Sendung existiert
          if (!parsed.externalNumber) {
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
          }
          const result = await this.importOrder(org.id, parsed, storedName);
          if (result?.linked) linked += 1;
          if (result) processed += 1;
        } catch (err: unknown) {
          failed += 1;
          this.logger.error(
            `Wareneingang reimport failed ${storedName}`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    // 2) Order-Feedback JSON aus rechnungen/ (+ processed/)
    const jsonDirs = [
      this.orderFeedbackDir,
      join(this.orderFeedbackDir, 'processed'),
    ];
    for (const dir of jsonDirs) {
      if (!existsSync(dir) || processed >= limit) continue;
      const files = readdirSync(dir)
        .filter((f) => f !== 'processed' && f !== 'failed' && f.toLowerCase().endsWith('.json'))
        .sort()
        .reverse();
      for (const storedName of files) {
        if (processed >= limit) break;
        const full = join(dir, storedName);
        let raw: string;
        try {
          raw = readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        if (!isWareneingangOrderJson(storedName, raw.slice(0, 1200))) continue;
        try {
          const parsed = parseWareneingangJson(raw);
          if (!parsed) {
            failed += 1;
            continue;
          }
          const result = await this.importOrder(org.id, parsed, storedName);
          if (result?.updated) {
            linked += 1;
            processed += 1;
          } else if (result?.linked) {
            // bereits verknüpft – nicht erneut auf Limit zählen
          } else if (result && !parsed.externalNumber) {
            processed += 1;
          } else if (result && parsed.externalNumber && !result.linked) {
            // kein Portal-Treffer
            processed += 1;
          }
          // Inbox-JSON nach processed verschieben
          if (dir === this.orderFeedbackDir) {
            const dest = join(this.orderFeedbackDir, 'processed', `${Date.now()}_${storedName}`);
            try {
              renameSync(full, dest);
            } catch {
              /* ignore */
            }
          }
        } catch (err: unknown) {
          failed += 1;
          this.logger.error(
            `Wareneingang JSON reimport failed ${storedName}`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    return { processed, failed, linked };
  }

  /** Customs: frühe Status, die bei Soloplan-Annahme auf ACCEPTED wechseln dürfen. */
  private static readonly CUSTOMS_ACCEPT_FROM = new Set(['SUBMITTED', 'IN_PROGRESS']);
  /** Sendungen: nur DRAFT/SUBMITTED → ACCEPTED (keine Rückstufung späterer Status). */
  private static readonly SHIPMENT_ACCEPT_FROM = new Set<ShipmentStatus>([
    ShipmentStatus.DRAFT,
    ShipmentStatus.SUBMITTED,
  ]);

  /**
   * Soloplan OrderNumber anhand ExternalNumber (VLB…) an Portal-Aufträge schreiben.
   * Trifft CustomsOrder und/oder TransportOrder (+ zugehörige Shipments).
   * Bei erfolgreicher Verknüpfung: Status → Angenommen (ACCEPTED).
   */
  private async linkSoloplanOrderNumber(
    organizationId: string,
    parsed: ParsedWareneingangOrder,
  ): Promise<{
    matched: number;
    updated: number;
    customsId?: string;
    transportOrderId?: string;
    shipmentIds: string[];
  }> {
    const orderNumber = String(parsed.orderNumber).trim();
    const ext = parsed.externalNumber?.trim() || undefined;
    const consExt = parsed.consignments
      .map((c) => c.externalNumber?.trim())
      .find((v) => v && v !== ext);

    let matched = 0;
    let updated = 0;
    let customsId: string | undefined;
    let transportOrderId: string | undefined;
    const shipmentIds: string[] = [];

    if (ext) {
      const customs = await this.prisma.customsOrder.findFirst({
        where: { organizationId, externalNumber: ext },
        select: { id: true, soloplanRef: true, status: true },
      });
      if (customs) {
        matched += 1;
        customsId = customs.id;
        const data: { soloplanRef?: string; status?: string } = {};
        if (customs.soloplanRef !== orderNumber) data.soloplanRef = orderNumber;
        if (WareneingangService.CUSTOMS_ACCEPT_FROM.has(customs.status)) {
          data.status = 'ACCEPTED';
        }
        if (Object.keys(data).length) {
          await this.prisma.customsOrder.update({ where: { id: customs.id }, data });
          updated += 1;
        }
      }

      const transport = await this.prisma.transportOrder.findFirst({
        where: { organizationId, externalNumber: ext },
        select: {
          id: true,
          soloplanRef: true,
          shipments: { select: { id: true, soloplanRef: true, status: true } },
        },
      });
      if (transport) {
        matched += 1;
        transportOrderId = transport.id;
        if (transport.soloplanRef !== orderNumber) {
          await this.prisma.transportOrder.update({
            where: { id: transport.id },
            data: { soloplanRef: orderNumber },
          });
          updated += 1;
        }
        for (const s of transport.shipments) {
          shipmentIds.push(s.id);
          const shipData: { soloplanRef?: string; status?: ShipmentStatus } = {};
          if (s.soloplanRef !== orderNumber) shipData.soloplanRef = orderNumber;
          if (
            WareneingangService.SHIPMENT_ACCEPT_FROM.has(s.status) &&
            s.status !== ShipmentStatus.ACCEPTED
          ) {
            shipData.status = ShipmentStatus.ACCEPTED;
          }
          if (Object.keys(shipData).length) {
            await this.prisma.shipment.update({ where: { id: s.id }, data: shipData });
            updated += 1;
          }
        }
      }
    }

    // Consignment-ExternalNumber kann Portal-Referenz sein (z. B. N04-…)
    if (consExt) {
      const byRef = await this.prisma.shipment.findFirst({
        where: { organizationId, reference: consExt },
        select: { id: true, orderId: true, soloplanRef: true, status: true },
      });
      if (byRef) {
        matched += 1;
        const shipData: { soloplanRef?: string; status?: ShipmentStatus } = {};
        if (byRef.soloplanRef !== orderNumber) shipData.soloplanRef = orderNumber;
        if (
          WareneingangService.SHIPMENT_ACCEPT_FROM.has(byRef.status) &&
          byRef.status !== ShipmentStatus.ACCEPTED
        ) {
          shipData.status = ShipmentStatus.ACCEPTED;
        }
        if (Object.keys(shipData).length) {
          await this.prisma.shipment.update({ where: { id: byRef.id }, data: shipData });
          updated += 1;
        }
        if (!shipmentIds.includes(byRef.id)) shipmentIds.push(byRef.id);
        if (byRef.orderId) {
          const to = await this.prisma.transportOrder.findUnique({
            where: { id: byRef.orderId },
            select: { soloplanRef: true },
          });
          if (to && to.soloplanRef !== orderNumber) {
            await this.prisma.transportOrder.update({
              where: { id: byRef.orderId },
              data: { soloplanRef: orderNumber },
            });
            updated += 1;
          }
          transportOrderId = transportOrderId || byRef.orderId;
        }
      }
    }

    if (updated > 0) {
      this.logger.log(
        `Soloplan OrderNumber ${orderNumber} verknüpft` +
          (ext ? ` über ExternalNumber ${ext}` : '') +
          (customsId ? ` Customs=${customsId}` : '') +
          (transportOrderId ? ` TO=${transportOrderId}` : '') +
          (shipmentIds.length ? ` Shipments=${shipmentIds.length}` : '') +
          ' → Status Angenommen',
      );
    }

    return { matched, updated, customsId, transportOrderId, shipmentIds };
  }

  private async importOrder(
    organizationId: string,
    parsed: ParsedWareneingangOrder,
    sourceFile: string,
  ): Promise<{ id?: string; linked?: boolean; updated?: boolean } | null> {
    // 1) Rückkopplung: ExternalNumber (VLB) → Soloplan OrderNumber speichern
    const link = await this.linkSoloplanOrderNumber(organizationId, parsed);
    if (link.matched > 0) {
      return {
        id: link.shipmentIds[0] || link.customsId || link.transportOrderId,
        linked: true,
        updated: link.updated > 0,
      };
    }

    // Feedback mit VLB, aber kein Portal-Treffer → keinen neuen WE-Auftrag erfinden
    if (parsed.externalNumber?.trim()) {
      this.logger.warn(
        `Wareneingang: Soloplan ${parsed.orderNumber} ExternalNumber ${parsed.externalNumber} ohne Portal-Treffer (${sourceFile})`,
      );
      return { linked: false };
    }

    // Soloplan Orga 1 = WOG GmbH (Mandant1) – im Portal deaktiviert, nicht importieren
    if (parsed.orgaNumber === '1') {
      this.logger.warn(
        `Wareneingang übersprungen (OrgaNumber 1 / Mandant GMBH): ${parsed.orderNumber} (${sourceFile})`,
      );
      return { linked: false };
    }

    const existing = await this.prisma.shipment.findFirst({
      where: {
        organizationId,
        OR: [{ reference: `WE-${parsed.orderNumber}` }, { soloplanRef: parsed.orderNumber }],
      },
      select: { id: true },
    });
    if (existing) return { id: existing.id, linked: false };

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

    return { id: shipment.id, linked: false };
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
    // OrgaNumber 2 ≈ WOG Logistics AG, 1 ≈ WOG GmbH (Soloplan-Org).
    // Kein Fallback von inaktivem GMBH → AG (sonst werden Mandant1-Aufträge falsch importiert).
    const preferredCode = orgaNumber === '2' ? 'AG' : orgaNumber === '1' ? 'GMBH' : 'AG';
    const mandant = await this.prisma.mandant.findFirst({
      where: { organizationId, code: preferredCode, active: true },
    });
    if (!mandant) {
      throw new Error(
        `Kein aktiver Mandant für OrgaNumber ${orgaNumber || '–'} (${preferredCode})`,
      );
    }
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
