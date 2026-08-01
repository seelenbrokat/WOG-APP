import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationSystem, IntegrationTransferStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { CustomsExchangePayload } from './exchange.types';
import { LdvAdapter, MercurioAdapter, SoloplanCustomsAdapter } from './customs-adapters';

@Injectable()
export class ExchangeHubService {
  private readonly logger = new Logger(ExchangeHubService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private audit: AuditService,
    private ldv: LdvAdapter,
    private mercurio: MercurioAdapter,
    private soloplanCustoms: SoloplanCustomsAdapter,
  ) {}

  status() {
    return {
      hub: 'EZOLL Exchange Hub',
      routes: [
        'SOLOPLAN → LDV',
        'SOLOPLAN → MERCURIO',
        'LDV → SOLOPLAN',
        'MERCURIO → SOLOPLAN',
        'LDV → MERCURIO',
        'MERCURIO → LDV',
      ],
      adapters: {
        soloplan: {
          enabled:
            this.config.get('SOLOPLAN_CUSTOMS_ENABLED') === 'true' ||
            this.config.get('SOLOPLAN_ENABLED') === 'true',
          mode: this.config.get('SOLOPLAN_CUSTOMS_MODE') || this.config.get('SOLOPLAN_MODE') || 'stub',
        },
        ldv: {
          enabled: this.config.get('LDV_ENABLED') === 'true',
          mode: this.config.get('LDV_MODE') || 'stub',
        },
        mercurio: {
          enabled: this.config.get('MERCURIO_ENABLED') === 'true',
          mode: this.config.get('MERCURIO_MODE') || 'stub',
        },
      },
      note: 'Konkrete Feldmappings folgen mit der LDV-/Mercurio-Dokumentation.',
    };
  }

  listTransfers(user: AuthUser) {
    return this.prisma.integrationTransfer.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createTransfer(
    user: AuthUser,
    data: {
      fromSystem: IntegrationSystem;
      toSystem: IntegrationSystem;
      customsOrderId?: string;
      shipmentId?: string;
      reference?: string;
      payload?: Partial<CustomsExchangePayload>;
      processNow?: boolean;
    },
  ) {
    if (data.fromSystem === data.toSystem) {
      throw new BadRequestException('Quell- und Zielsystem müssen unterschiedlich sein');
    }

    let payload: CustomsExchangePayload = {
      exchangeVersion: '1.0',
      reference: data.reference || `EX-${Date.now()}`,
      sourceSystem: data.fromSystem,
      targetSystem: data.toSystem,
      ...data.payload,
    };

    if (data.customsOrderId) {
      const customs = await this.prisma.customsOrder.findFirst({
        where: { id: data.customsOrderId, organizationId: user.organizationId },
        include: { customer: true, mandant: true },
      });
      if (!customs) throw new NotFoundException('Verzollungsauftrag nicht gefunden');
      payload = {
        ...payload,
        reference: data.reference || `CUSTOMS-${customs.kennzeichen}-${customs.id.slice(-6)}`,
        customsOrderId: customs.id,
        kennzeichen: customs.kennzeichen,
        grenzuebergang: customs.grenzuebergang,
        zeit: customs.zeit.toISOString(),
        importeur: customs.importeur,
        customerNumber: customs.customer.customerNumber,
        mandantCode: customs.mandant?.code,
        notes: customs.notes || undefined,
        status: customs.status,
      };
    }

    if (data.shipmentId) {
      const shipment = await this.prisma.shipment.findFirst({
        where: { id: data.shipmentId, organizationId: user.organizationId },
        include: { customer: true, mandant: true },
      });
      if (!shipment) throw new NotFoundException('Sendung nicht gefunden');
      payload = {
        ...payload,
        reference: data.reference || shipment.trackingNumber,
        shipmentId: shipment.id,
        shipmentTrackingNumber: shipment.trackingNumber,
        customerNumber: shipment.customer.customerNumber,
        mandantCode: shipment.mandant.code,
        notes: shipment.notes || undefined,
        status: shipment.status,
      };
    }

    const transfer = await this.prisma.integrationTransfer.create({
      data: {
        organizationId: user.organizationId,
        fromSystem: data.fromSystem,
        toSystem: data.toSystem,
        status: IntegrationTransferStatus.PENDING,
        reference: payload.reference,
        customsOrderId: data.customsOrderId,
        shipmentId: data.shipmentId,
        payload: payload as object,
        createdById: user.id,
      },
    });

    await this.audit.log(user.id, 'integration.transfer.create', 'IntegrationTransfer', transfer.id, {
      from: data.fromSystem,
      to: data.toSystem,
      reference: payload.reference,
    });

    if (data.processNow !== false) {
      return this.processTransfer(transfer.id);
    }
    return transfer;
  }

  async processTransfer(id: string) {
    const transfer = await this.prisma.integrationTransfer.findUnique({ where: { id } });
    if (!transfer) throw new NotFoundException();

    await this.prisma.integrationTransfer.update({
      where: { id },
      data: { status: IntegrationTransferStatus.PROCESSING },
    });

    try {
      const adapter = this.adapterFor(transfer.toSystem);
      const payload = transfer.payload as unknown as CustomsExchangePayload;
      const result = await adapter.send({
        ...payload,
        sourceSystem: transfer.fromSystem,
        targetSystem: transfer.toSystem,
      });

      return this.prisma.integrationTransfer.update({
        where: { id },
        data: {
          status: result.ok ? IntegrationTransferStatus.SUCCESS : IntegrationTransferStatus.FAILED,
          fileName: result.fileName,
          message: result.message,
          responsePayload: (result.response as object) || undefined,
          processedAt: new Date(),
        },
      });
    } catch (err: any) {
      this.logger.error(`Transfer ${id} failed`, err);
      return this.prisma.integrationTransfer.update({
        where: { id },
        data: {
          status: IntegrationTransferStatus.FAILED,
          message: err?.message || String(err),
          processedAt: new Date(),
        },
      });
    }
  }

  /** Inbound-Dateien aus LDV/Mercurio/Soloplan abholen und Gegenrichtung anstoßen */
  async processInboundQueues(organizationId?: string) {
    const org =
      organizationId ||
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } }))?.id;
    if (!org) return { processed: 0 };

    const inbound: { from: IntegrationSystem; items: CustomsExchangePayload[] }[] = [
      { from: IntegrationSystem.LDV, items: await this.ldv.receiveInbound() },
      { from: IntegrationSystem.MERCURIO, items: await this.mercurio.receiveInbound() },
      { from: IntegrationSystem.SOLOPLAN, items: await this.soloplanCustoms.receiveInbound() },
    ];

    let processed = 0;
    for (const bucket of inbound) {
      for (const item of bucket.items) {
        const toSystem = (item.targetSystem || 'SOLOPLAN') as IntegrationSystem;
        if (toSystem === bucket.from) continue;
        const transfer = await this.prisma.integrationTransfer.create({
          data: {
            organizationId: org,
            fromSystem: bucket.from,
            toSystem,
            status: IntegrationTransferStatus.PENDING,
            reference: item.reference,
            customsOrderId: item.customsOrderId,
            shipmentId: item.shipmentId,
            payload: item as object,
            message: 'Aus Inbox übernommen',
          },
        });
        await this.processTransfer(transfer.id);
        processed += 1;
      }
    }
    return { processed };
  }

  private adapterFor(system: IntegrationSystem) {
    switch (system) {
      case IntegrationSystem.LDV:
        return this.ldv;
      case IntegrationSystem.MERCURIO:
        return this.mercurio;
      case IntegrationSystem.SOLOPLAN:
        return this.soloplanCustoms;
      default:
        throw new BadRequestException(`Unbekanntes System ${system}`);
    }
  }
}
