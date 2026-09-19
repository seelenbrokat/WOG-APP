import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CustomerDocCategory,
  DocumentType,
  NotificationEvent,
} from '@prisma/client';
import { existsSync, statSync } from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export const QUEHENBERGER_CUSTOMER_NUMBER = '4390';

export type QuehenbergerPodSource = 'Post' | 'BT Swiss' | 'Zustellapp' | string;

/**
 * Quehenberger (BP 4390): POD-PDF per Mail an feste Empfänger (eine Mail, CC Marcel).
 * Genutzt von Post-Ablieferbeleg, BT Swiss Status und Zustellapp-Ablieferbeleg.
 */
@Injectable()
export class QuehenbergerPodMailService {
  private readonly log = new Logger(QuehenbergerPodMailService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private notifications: NotificationsService,
  ) {}

  isQuehenbergerCustomerNumber(customerNumber?: string | null): boolean {
    return String(customerNumber || '').trim() === QUEHENBERGER_CUSTOMER_NUMBER;
  }

  /**
   * Sendet Quehenberger-POD-Mail falls Kunde 4390.
   * Max. eine erfolgreiche Mail je Tracking-Nummer (keine Doppelmails Post+BT+App).
   */
  async notifyIfQuehenberger(opts: {
    shipment: {
      id: string;
      trackingNumber: string;
      soloplanRef?: string | null;
      customerId?: string | null;
      customer?: { customerNumber?: string | null; name?: string | null } | null;
      organizationId?: string;
    };
    fileName: string;
    storagePath: string;
    mimeType?: string;
    source: QuehenbergerPodSource;
    /** Portal-Dokument anlegen/aktualisieren (POD-Kategorie für Kundenportal) */
    ensurePortalDocument?: boolean;
  }): Promise<'sent' | 'skipped_not_quehenberger' | 'skipped_duplicate' | 'skipped_no_file'> {
    const customer = await this.resolveCustomer(opts.shipment);
    if (!this.isQuehenbergerCustomerNumber(customer?.customerNumber)) {
      return 'skipped_not_quehenberger';
    }

    if (!opts.storagePath || !existsSync(opts.storagePath)) {
      this.log.warn(
        `Quehenberger POD-Mail: Datei fehlt (${opts.fileName}) Sendung=${opts.shipment.trackingNumber}`,
      );
      return 'skipped_no_file';
    }

    const tracking = opts.shipment.trackingNumber;
    const already = await this.prisma.emailOutbox.findFirst({
      where: {
        subject: `POD verfügbar ${tracking}`,
        toEmail: { contains: 'quehenberger', mode: 'insensitive' },
        sentAt: { not: null },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (already) {
      this.log.debug(
        `Quehenberger POD-Mail übersprungen (bereits gesendet) ${tracking} Quelle=${opts.source}`,
      );
      return 'skipped_duplicate';
    }

    if (opts.ensurePortalDocument !== false) {
      await this.ensurePortalPodDocument({
        shipment: opts.shipment,
        customerId: customer?.id || opts.shipment.customerId || null,
        fileName: opts.fileName,
        storagePath: opts.storagePath,
        mimeType: opts.mimeType || 'application/pdf',
        source: opts.source,
      });
    }

    const toList = this.notifications.normalizeEmails(
      this.config.get('QUEHENBERGER_POD_MAIL_TO') ||
        'christian.kerschbaumer@quehenberger.com,Michael.Ecker@quehenberger.com',
    );
    const cc = this.notifications.normalizeEmails(
      this.config.get('QUEHENBERGER_POD_MAIL_CC') ||
        'marcel.burtscher@worldofgreen.ch',
    );
    if (!toList.length) {
      this.log.warn('Quehenberger POD-Mail: keine Empfänger konfiguriert');
      return 'skipped_no_file';
    }

    const mimeType = opts.mimeType || 'application/pdf';
    const subject = `POD verfügbar ${tracking}`;
    const body = [
      `Hallo,`,
      '',
      `Neuer Ablieferbeleg (POD) für Quehenberger (${opts.source}).`,
      '',
      `Sendung: ${tracking}`,
      opts.shipment.soloplanRef ? `Auftrag/Sendung: ${opts.shipment.soloplanRef}` : null,
      customer?.name
        ? `Kunde: ${customer.name} (${customer.customerNumber})`
        : null,
      `Quelle: ${opts.source}`,
      `Datei: ${opts.fileName}`,
      '',
      `Portal: ${this.config.get('APP_URL') || 'https://wog.logistikberater.at'}`,
      '',
      'WOG – World of Green Logistics',
    ]
      .filter(Boolean)
      .join('\n');

    await this.notifications.sendRaw(
      toList.join(', '),
      subject,
      body,
      NotificationEvent.POD_AVAILABLE,
      [
        {
          filename: opts.fileName,
          path: opts.storagePath,
          contentType: mimeType,
        },
      ],
      cc.length ? { cc } : undefined,
    );

    this.log.log(
      `Quehenberger POD-Mail (${opts.source}) → An: ${toList.join(', ')}` +
        (cc.length ? ` | CC: ${cc.join(', ')}` : '') +
        ` | ${tracking}`,
    );
    return 'sent';
  }

  /**
   * Shipment über Soloplan-/Tracking-Refs finden und ggf. mailen.
   */
  async notifyForRefs(opts: {
    organizationId?: string;
    refs: string[];
    fileName: string;
    storagePath: string;
    mimeType?: string;
    source: QuehenbergerPodSource;
  }): Promise<'sent' | 'skipped_not_quehenberger' | 'skipped_duplicate' | 'skipped_no_file' | 'skipped_no_shipment'> {
    const shipment = await this.findShipment(opts.refs, opts.organizationId);
    if (!shipment) return 'skipped_no_shipment';
    return this.notifyIfQuehenberger({
      shipment,
      fileName: opts.fileName,
      storagePath: opts.storagePath,
      mimeType: opts.mimeType,
      source: opts.source,
      ensurePortalDocument: true,
    });
  }

  private async resolveCustomer(shipment: {
    customerId?: string | null;
    customer?: {
      id?: string;
      customerNumber?: string | null;
      name?: string | null;
    } | null;
  }): Promise<{ id?: string; customerNumber: string; name: string } | null> {
    if (shipment.customer?.customerNumber) {
      return {
        id: shipment.customer.id,
        customerNumber: shipment.customer.customerNumber,
        name: shipment.customer.name || '',
      };
    }
    if (!shipment.customerId) return null;
    const cust = await this.prisma.customer.findUnique({
      where: { id: shipment.customerId },
      select: { id: true, customerNumber: true, name: true },
    });
    return cust;
  }

  private async findShipment(refs: string[], organizationId?: string) {
    const keys = [...new Set(refs.map((r) => String(r || '').trim()).filter(Boolean))];
    if (!keys.length) return null;

    const or = keys.flatMap((key) => [
      { trackingNumber: key },
      { soloplanRef: key },
      { reference: key },
      { order: { soloplanRef: key } },
      { order: { externalNumber: key } },
    ]);

    return this.prisma.shipment.findFirst({
      where: {
        ...(organizationId ? { organizationId } : {}),
        OR: or,
      },
      select: {
        id: true,
        trackingNumber: true,
        soloplanRef: true,
        customerId: true,
        organizationId: true,
        customer: { select: { id: true, customerNumber: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async ensurePortalPodDocument(opts: {
    shipment: {
      id: string;
      trackingNumber: string;
      organizationId?: string;
      customerId?: string | null;
    };
    customerId: string | null;
    fileName: string;
    storagePath: string;
    mimeType: string;
    source: string;
  }) {
    const orgId =
      opts.shipment.organizationId ||
      (
        await this.prisma.shipment.findUnique({
          where: { id: opts.shipment.id },
          select: { organizationId: true },
        })
      )?.organizationId;
    if (!orgId) return;

    const sizeBytes = statSync(opts.storagePath).size;
    const sourceTag = `QUEHENBERGER_POD:${opts.source}`;
    const existing = await this.prisma.document.findFirst({
      where: {
        shipmentId: opts.shipment.id,
        organizationId: orgId,
        OR: [
          { storagePath: opts.storagePath },
          { fileName: opts.fileName, type: { in: [DocumentType.POD, DocumentType.ABLIEFERBELEG] } },
          { sourceFileName: sourceTag },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await this.prisma.document.update({
        where: { id: existing.id },
        data: {
          fileName: opts.fileName,
          mimeType: opts.mimeType,
          storagePath: opts.storagePath,
          sizeBytes,
          categoryCode: CustomerDocCategory.POD,
          customerId: opts.customerId || existing.customerId,
          source: opts.source === 'Post' ? 'POST' : existing.source || opts.source.slice(0, 40),
          sourceFileName: existing.sourceFileName || sourceTag,
        },
      });
      return;
    }

    await this.prisma.document.create({
      data: {
        organizationId: orgId,
        shipmentId: opts.shipment.id,
        customerId: opts.customerId,
        type: DocumentType.POD,
        categoryCode: CustomerDocCategory.POD,
        source: opts.source === 'Post' ? 'POST' : opts.source.slice(0, 40),
        sourceFileName: sourceTag,
        importedAt: new Date(),
        fileName: opts.fileName,
        mimeType: opts.mimeType,
        storagePath: opts.storagePath,
        sizeBytes,
      },
    });
  }
}
