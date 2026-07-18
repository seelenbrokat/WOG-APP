import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PartnerJobStatus, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationEvent } from '@prisma/client';

export interface TransportIntegration {
  createOrder(shipmentId: string): Promise<void>;
  syncStatuses(): Promise<void>;
  pullPods(): Promise<void>;
}

@Injectable()
export class SoloplanService implements TransportIntegration {
  private readonly logger = new Logger(SoloplanService.name);
  private pendingCreates = new Set<string>();
  private outboundDir: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.outboundDir =
      this.config.get('SFTP_OUTBOUND_DIR') || join(process.cwd(), '../../data/sftp/outbound');
    if (!existsSync(this.outboundDir)) mkdirSync(this.outboundDir, { recursive: true });
  }

  async enqueueCreateOrder(shipmentId: string) {
    this.pendingCreates.add(shipmentId);
  }

  async createOrder(shipmentId: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { positions: true, mandant: true, customer: true },
    });
    if (!shipment) return;

    const mode = this.config.get('SOLOPLAN_MODE') || 'stub';
    const enabled = this.config.get('SOLOPLAN_ENABLED') === 'true';

    const payload = {
      trackingNumber: shipment.trackingNumber,
      mandant: shipment.mandant.code,
      customerNumber: shipment.customer.customerNumber,
      reference: shipment.reference,
      pickup: {
        company: shipment.pickupCompany,
        street: shipment.pickupStreet,
        zip: shipment.pickupZip,
        city: shipment.pickupCity,
        country: shipment.pickupCountry,
        date: shipment.pickupDate,
      },
      delivery: {
        company: shipment.deliveryCompany,
        street: shipment.deliveryStreet,
        zip: shipment.deliveryZip,
        city: shipment.deliveryCity,
        country: shipment.deliveryCountry,
        date: shipment.deliveryDate,
      },
      packages: shipment.packageCount,
      weightKg: shipment.weightKg,
      positions: shipment.positions,
    };

    if (!enabled || mode === 'stub') {
      const ref = `SP-STUB-${shipment.trackingNumber}`;
      await this.prisma.shipment.update({
        where: { id: shipmentId },
        data: { soloplanRef: ref },
      });
      this.logger.log(`Soloplan stub createOrder ${ref}`);
      return;
    }

    if (mode === 'file') {
      const file = join(this.outboundDir, `soloplan-order-${shipment.trackingNumber}.json`);
      writeFileSync(file, JSON.stringify(payload, null, 2));
      await this.prisma.shipment.update({
        where: { id: shipmentId },
        data: { soloplanRef: `FILE:${file}` },
      });
      this.logger.log(`Soloplan file export ${file}`);
      return;
    }

    // REST mode
    const base = this.config.get('SOLOPLAN_BASE_URL');
    const key = this.config.get('SOLOPLAN_API_KEY');
    if (!base) {
      this.logger.warn('SOLOPLAN_BASE_URL fehlt');
      return;
    }
    const res = await fetch(`${base}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key || ''}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      this.logger.error(`Soloplan REST error ${res.status}`);
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    await this.prisma.shipment.update({
      where: { id: shipmentId },
      data: { soloplanRef: json.id || `REST-${shipment.trackingNumber}` },
    });
  }

  async syncStatuses() {
    // Hook for pulling status from Soloplan – file mode reads inbound status files
    const inbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    if (!existsSync(inbound)) return;
    const files = readdirSync(inbound).filter((f) => f.startsWith('soloplan-status-') && f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(inbound, file), 'utf8')) as {
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
        const processed = join(inbound, 'processed');
        if (!existsSync(processed)) mkdirSync(processed, { recursive: true });
        renameSync(join(inbound, file), join(processed, file));
      } catch (err) {
        this.logger.error(`Status file failed ${file}`, err as Error);
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
          partnerId: partner?.id || (await this.ensureUnknownPartner()) ,
          direction: 'INBOUND',
          fileName,
          status: PartnerJobStatus.PROCESSING,
        },
      });

      try {
        const content = JSON.parse(readFileSync(full, 'utf8'));
        // Minimal: log success; shipment mapping can be extended per partner
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
            partner.sftpUsername ? `${partner.sftpUsername}@partners.local` : 'admin@wog.logistikberater.at',
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
