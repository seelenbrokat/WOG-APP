import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { PartnerJobStatus, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationEvent } from '@prisma/client';
import {
  buildSoloplanFilePayload,
  SoloplanFileFormat,
  soloplanOutboundFileName,
} from './soloplan-order.mapper';

export interface TransportIntegration {
  createOrder(shipmentId: string): Promise<void>;
  syncStatuses(): Promise<void>;
  pullPods(): Promise<void>;
}

@Injectable()
export class SoloplanService implements TransportIntegration {
  private readonly logger = new Logger(SoloplanService.name);
  private pendingCreates = new Set<string>();
  /** SFTP-Outbound-Root (z. B. /app/data/sftp/outbound) */
  private sftpOutboundRoot: string;
  /** Soloplan Order-Pickup: sftp/outbound/soloplan/orders */
  private ordersOutDir: string;
  /** Spiegel unter integrations/soloplan/orders/out */
  private integrationOrdersOutDir: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.sftpOutboundRoot =
      this.config.get('SFTP_OUTBOUND_DIR') || join(process.cwd(), '../../data/sftp/outbound');
    this.ordersOutDir =
      this.config.get('SOLOPLAN_ORDERS_OUT_DIR') ||
      join(this.sftpOutboundRoot, 'soloplan', 'orders');
    const integrationBase =
      this.config.get('INTEGRATION_DIR') || join(process.cwd(), '../../data/integrations');
    this.integrationOrdersOutDir = join(integrationBase, 'soloplan', 'orders', 'out');
    for (const dir of [this.sftpOutboundRoot, this.ordersOutDir, this.integrationOrdersOutDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  status() {
    const files = this.listOutboundFiles();
    return {
      enabled: this.config.get('SOLOPLAN_ENABLED') === 'true',
      mode: this.config.get('SOLOPLAN_MODE') || 'stub',
      fileFormat: this.getFileFormat(),
      baseUrlConfigured: Boolean(this.config.get('SOLOPLAN_BASE_URL')),
      ordersOutDir: this.ordersOutDir,
      integrationOrdersOutDir: this.integrationOrdersOutDir,
      pendingOutboundFiles: files.length,
      businessPartnerImportDir: 'data/integrations/soloplan/business-partners/in',
      apiVersion: 'SoloplanOrderImportPORTAL-v6',
    };
  }

  listOutboundFiles() {
    if (!existsSync(this.ordersOutDir)) return [];
    return readdirSync(this.ordersOutDir)
      .filter((f) => f.endsWith('.json'))
      .map((fileName) => {
        const full = join(this.ordersOutDir, fileName);
        const st = statSync(full);
        if (!st.isFile()) return null;
        return {
          fileName,
          size: st.size,
          modifiedAt: st.mtime.toISOString(),
          path: `soloplan/orders/${fileName}`,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  /**
   * Verschiebt abgeholt Dateien aus dem Soloplan-Pickup-Ordner nach archive/processed.
   * Erkennung: atime > mtime (Datei wurde nach dem Schreiben gelesen / per SFTP geöffnet).
   */
  archiveDownloadedOrders() {
    if (!existsSync(this.ordersOutDir)) return { archived: 0 as const, files: [] as string[] };
    const delaySec = Number(this.config.get('SOLOPLAN_ARCHIVE_DELAY_SEC') || 20);
    const delayMs = Math.max(5, delaySec) * 1000;
    const now = Date.now();

    const archiveDir = join(this.sftpOutboundRoot, 'soloplan', 'archive');
    const mirrorProcessedDir = join(dirname(this.integrationOrdersOutDir), 'processed');
    for (const dir of [archiveDir, mirrorProcessedDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    const archived: string[] = [];
    for (const fileName of readdirSync(this.ordersOutDir)) {
      if (!fileName.endsWith('.json')) continue;
      const primary = join(this.ordersOutDir, fileName);
      let st;
      try {
        st = statSync(primary);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;

      // Nach SFTP-Download ist atime neuer als mtime (Schreiben beim Export).
      const wasReadAfterWrite = st.atimeMs > st.mtimeMs + 500;
      const settled = now - st.atimeMs >= delayMs;
      if (!wasReadAfterWrite || !settled) continue;

      const target = join(archiveDir, fileName);
      try {
        renameSync(primary, target);
      } catch (err) {
        this.logger.warn(`Archivieren fehlgeschlagen ${fileName}: ${err}`);
        continue;
      }

      const mirror = join(this.integrationOrdersOutDir, fileName);
      if (existsSync(mirror)) {
        try {
          renameSync(mirror, join(mirrorProcessedDir, fileName));
        } catch (err) {
          this.logger.warn(`Spiegel-Archiv fehlgeschlagen ${fileName}: ${err}`);
        }
      }

      archived.push(fileName);
      this.logger.log(`Soloplan Order nach Download archiviert: ${fileName}`);
    }

    return { archived: archived.length, files: archived };
  }

  openOutboundFile(fileName: string) {
    const safe = fileName.replace(/[/\\]/g, '');
    if (!safe.endsWith('.json')) throw new BadRequestException('Nur .json Dateien');
    const full = join(this.ordersOutDir, safe);
    if (!existsSync(full)) throw new NotFoundException(`Datei ${safe} nicht gefunden`);
    return { fileName: safe, stream: createReadStream(full), fullPath: full };
  }

  async enqueueCreateOrder(shipmentId: string) {
    this.pendingCreates.add(shipmentId);
  }

  /** Exportiert eine Sendung sofort als Soloplan File-API JSON (auch wenn Worker noch nicht gelaufen ist). */
  async exportShipment(shipmentId: string) {
    await this.createOrder(shipmentId);
    const shipment = await this.prisma.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw new NotFoundException('Sendung nicht gefunden');
    return {
      ok: true,
      shipmentId,
      trackingNumber: shipment.trackingNumber,
      soloplanRef: shipment.soloplanRef,
      outbound: this.listOutboundFiles().filter((f) =>
        f.fileName.includes(shipment.trackingNumber) ||
        (shipment.reference ? f.fileName.includes(shipment.reference) : false),
      ),
    };
  }

  async createOrder(shipmentId: string) {
    const shipmentInclude = {
      positions: true,
      colli: { orderBy: { itemNumber: 'asc' as const } },
      mandant: true,
      customer: { include: { contacts: true } },
      order: { include: { freightPayer: { include: { contacts: true } } } },
    };

    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: shipmentInclude,
    });
    if (!shipment) return;

    // Ohne Portal-Auftrag keinen Soloplan-Export (Auftrag + mind. 1 Sendung erforderlich)
    if (!shipment.order) {
      this.logger.warn(`Soloplan export übersprungen – Sendung ${shipment.trackingNumber} hat keinen Auftrag`);
      return;
    }

    // Alle Sendungen des Auftrags (1:n) für kumulierten Order-Export
    const orderShipments = await this.prisma.shipment.findMany({
      where: { orderId: shipment.order.id },
      include: shipmentInclude,
      orderBy: { createdAt: 'asc' },
    });

    const mode = this.config.get('SOLOPLAN_MODE') || 'stub';
    const enabled = this.config.get('SOLOPLAN_ENABLED') === 'true';
    const format = this.getFileFormat();
    const payload = buildSoloplanFilePayload(shipment, {
      format,
      defaultSender: this.getDefaultSender(),
      trackingBaseUrl: this.config.get('APP_URL') || undefined,
      objectOwnerId: Number(this.config.get('SOLOPLAN_OBJECT_OWNER_ID') || 0) || undefined,
      orderShipments,
    });

    if (!enabled || mode === 'stub') {
      const ref = `SP-STUB-${shipment.order.externalNumber}`;
      await this.prisma.shipment.updateMany({
        where: { orderId: shipment.order.id },
        data: { soloplanRef: ref },
      });
      await this.prisma.transportOrder.update({
        where: { id: shipment.order.id },
        data: { soloplanRef: ref },
      });
      this.logger.log(`Soloplan stub createOrder ${ref}`);
      return;
    }

    if (mode === 'file') {
      const fileName = soloplanOutboundFileName(shipment, format);
      const json = JSON.stringify(payload, null, 2);
      const primary = join(this.ordersOutDir, fileName);
      const mirror = join(this.integrationOrdersOutDir, fileName);
      writeFileSync(primary, json);
      writeFileSync(mirror, json);
      const fileRef = `FILE:soloplan/orders/${fileName}`;
      await this.prisma.shipment.updateMany({
        where: { orderId: shipment.order.id },
        data: { soloplanRef: fileRef },
      });
      await this.prisma.transportOrder.update({
        where: { id: shipment.order.id },
        data: { soloplanRef: fileRef },
      });
      this.logger.log(
        `Soloplan PORTAL-v6 order export ${primary} (${orderShipments.length} consignments)`,
      );
      return;
    }

    // REST mode – SoloplanOrderImportPORTAL v6
    const base = String(this.config.get('SOLOPLAN_BASE_URL') || '').replace(/\/$/, '');
    const key = this.config.get('SOLOPLAN_API_KEY');
    if (!base) {
      this.logger.warn('SOLOPLAN_BASE_URL fehlt');
      return;
    }
    const endpoint =
      format === 'order'
        ? `${base}/api/SoloplanOrderImportPORTAL/v6/Order`
        : `${base}/api/SoloplanOrderImportPORTAL/v6/Consignment`;

    // REST erwartet oft das Objekt ohne Wrapper – File-API nutzt header+array.
    // Laut OpenAPI Create: Body = Consignment/Order Entity; File-Drop nutzt Wrapper.
    // Wir senden den File-Wrapper (wie Spec-Samples), Fallback: erstes Array-Element.
    const body = payload;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Soloplan REST error ${res.status}: ${text.slice(0, 300)}`);
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string | number };
    const ref = String(json.id || `REST-${shipment.order.externalNumber}`);
    await this.prisma.shipment.updateMany({
      where: { orderId: shipment.order.id },
      data: { soloplanRef: ref },
    });
    await this.prisma.transportOrder.update({
      where: { id: shipment.order.id },
      data: { soloplanRef: ref },
    });
  }

  async syncStatuses() {
    const inbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    const dirs = [inbound, join(inbound, 'soloplan')];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter(
        (f) => f.startsWith('soloplan-status-') && f.endsWith('.json'),
      );
      for (const file of files) {
        try {
          const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
            trackingNumber: string;
            status: ShipmentStatus;
            message?: string;
          };
          const shipment = await this.prisma.shipment.findUnique({
            where: { trackingNumber: raw.trackingNumber },
          });
          if (shipment && raw.status) {
            await this.prisma.shipment.update({
              where: { id: shipment.id },
              data: {
                status: raw.status,
                events: {
                  create: {
                    status: raw.status,
                    message: raw.message || 'Soloplan Statusupdate',
                    createdBy: 'soloplan',
                  },
                },
              },
            });
          }
          const processed = join(dir, 'processed');
          if (!existsSync(processed)) mkdirSync(processed, { recursive: true });
          renameSync(join(dir, file), join(processed, file));
        } catch (err) {
          this.logger.error(`Status file failed ${file}`, err as Error);
        }
      }
    }
  }

  async pullPods() {
    // Placeholder for POD retrieval from Soloplan
  }

  async syncPending() {
    for (const id of [...this.pendingCreates]) {
      try {
        await this.createOrder(id);
        this.pendingCreates.delete(id);
      } catch (err) {
        this.logger.error(`createOrder failed ${id}`, err as Error);
      }
    }
    await this.syncStatuses();
    await this.pullPods();
  }

  private getFileFormat(): SoloplanFileFormat {
    const raw = String(this.config.get('SOLOPLAN_FILE_FORMAT') || 'order').toLowerCase();
    return raw === 'consignment' ? 'consignment' : 'order';
  }

  private getDefaultSender() {
    const number = this.config.get('SOLOPLAN_DEFAULT_SENDER_BP') || '2';
    return {
      number,
      matchcode: this.config.get('SOLOPLAN_DEFAULT_SENDER_MATCHCODE') || 'WOGDIEPO',
      name: this.config.get('SOLOPLAN_DEFAULT_SENDER_NAME') || 'WOG Logistics AG',
      phone: this.config.get('SOLOPLAN_DEFAULT_SENDER_PHONE') || '+41 71 733 77 00',
      vatId: this.config.get('SOLOPLAN_DEFAULT_SENDER_VAT') || undefined,
      street: this.config.get('SOLOPLAN_DEFAULT_SENDER_STREET') || 'Wildenaustraße 22',
      zip: this.config.get('SOLOPLAN_DEFAULT_SENDER_ZIP') || '9444',
      city: this.config.get('SOLOPLAN_DEFAULT_SENDER_CITY') || 'Diepoldsau',
      country: this.config.get('SOLOPLAN_DEFAULT_SENDER_COUNTRY') || 'CH',
    };
  }
}

@Injectable()
export class PartnerImportService {
  private readonly logger = new Logger(PartnerImportService.name);
  private inboundDir: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {
    this.inboundDir =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    if (!existsSync(this.inboundDir)) mkdirSync(this.inboundDir, { recursive: true });
  }

  async processInbound() {
    if (!existsSync(this.inboundDir)) return;
    const files = readdirSync(this.inboundDir).filter(
      (f) => f.endsWith('.json') && !f.startsWith('soloplan-'),
    );
    for (const fileName of files) {
      const full = join(this.inboundDir, fileName);
      const partnerCode = fileName.split('_')[0]?.toUpperCase();
      const partner = partnerCode
        ? await this.prisma.partner.findFirst({ where: { code: partnerCode, active: true } })
        : null;

      const job = await this.prisma.partnerJob.create({
        data: {
          partnerId: partner?.id || (await this.ensureUnknownPartner()),
          direction: 'INBOUND',
          fileName,
          status: PartnerJobStatus.PROCESSING,
        },
      });

      try {
        const content = JSON.parse(readFileSync(full, 'utf8'));
        await this.prisma.partnerJob.update({
          where: { id: job.id },
          data: {
            status: PartnerJobStatus.SUCCESS,
            message: `Verarbeitet (${Array.isArray(content) ? content.length : 1} Datensatz/Datensätze)`,
            processedAt: new Date(),
          },
        });
        const processed = join(this.inboundDir, 'processed');
        if (!existsSync(processed)) mkdirSync(processed, { recursive: true });
        renameSync(full, join(processed, fileName));

        if (partner) {
          await this.notifications.sendRaw(
            partner.sftpUsername
              ? `${partner.sftpUsername}@partners.local`
              : 'admin@wog.logistikberater.at',
            'Partnerdatei importiert',
            `Datei ${fileName} erfolgreich verarbeitet.`,
            NotificationEvent.PARTNER_FILE_IMPORTED,
          );
        }
      } catch (err: any) {
        await this.prisma.partnerJob.update({
          where: { id: job.id },
          data: {
            status: PartnerJobStatus.FAILED,
            message: err?.message || String(err),
            processedAt: new Date(),
          },
        });
        this.logger.error(`Partner import failed ${fileName}`, err);
      }
    }
  }

  private async ensureUnknownPartner() {
    const org = await this.prisma.organization.findFirst({ where: { slug: 'wog' } });
    if (!org) throw new Error('WOG org missing');
    const existing = await this.prisma.partner.findFirst({
      where: { organizationId: org.id, code: 'UNKNOWN' },
    });
    if (existing) return existing.id;
    const created = await this.prisma.partner.create({
      data: { organizationId: org.id, name: 'Unbekannt', code: 'UNKNOWN' },
    });
    return created.id;
  }
}
