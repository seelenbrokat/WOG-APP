import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CustomerDocCategory,
  DocumentType,
  NotificationEvent,
  ShipmentStatus,
} from '@prisma/client';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

export type PostAblieferbelegIngestInput = {
  /** Soloplan Auftrag.Sendung, z. B. 435958.1 */
  shipmentNumber?: string | null;
  /** Nur Auftragsnummer, zusammen mit itemNumber */
  orderNumber?: string | null;
  itemNumber?: number | string | null;
  /** Portal-Trackingnummer, z. B. WOG2608… */
  trackingNumber?: string | null;
  /** Swiss-Post-Barcode / Paketnummer */
  postBarcode?: string | null;
  /** Freie Kunden-/Client-Referenz */
  clientReference?: string | null;
  /** Zustellzeitpunkt ISO-8601 */
  deliveredAt?: string | null;
  /** true → Sendungsstatus DELIVERED setzen */
  markDelivered?: boolean;
  /** Idempotenz-/Quelldateiname */
  sourceFileName?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  buffer: Buffer;
};

export type PostAblieferbelegIngestResult = {
  ok: true;
  documentId: string;
  shipmentId: string;
  trackingNumber: string;
  soloplanRef: string | null;
  customerId: string | null;
  fileName: string;
  delivered: boolean;
  duplicated: boolean;
};

/**
 * Inbound für Swiss-Post-Ablieferbelege (POD).
 * Auth: Header X-API-KEY = POST_ABLIEFERBELEG_API_KEY
 * Speichert Dokument als POD (Kundenmodul-Kategorie POD) an der Portal-Sendung.
 */
@Injectable()
export class PostAblieferbelegService {
  private readonly log = new Logger(PostAblieferbelegService.name);
  private readonly uploadDir: string;
  private readonly inboundRoot: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private notifications: NotificationsService,
  ) {
    this.uploadDir =
      this.config.get('UPLOAD_DIR') || join(process.cwd(), '../../data/uploads');
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') ||
      join(process.cwd(), '../../data/sftp/inbound');
    this.inboundRoot = join(sftpInbound, 'post-ablieferbelege');
    for (const dir of [
      join(this.uploadDir, 'post-ablieferbelege'),
      this.inboundRoot,
      join(this.inboundRoot, 'processed'),
      join(this.inboundRoot, 'failed'),
      join(this.inboundRoot, 'failed', 'unmatched'),
    ]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  assertApiKey(apiKey: string | undefined) {
    const expected = String(this.config.get('POST_ABLIEFERBELEG_API_KEY') || '').trim();
    if (!expected) {
      throw new ServiceUnavailableException(
        'Post-Ablieferbeleg-API nicht konfiguriert (POST_ABLIEFERBELEG_API_KEY fehlt)',
      );
    }
    if (!apiKey || apiKey.trim() !== expected) {
      throw new UnauthorizedException('Ungültiger API-Key');
    }
  }

  status() {
    const configured = Boolean(String(this.config.get('POST_ABLIEFERBELEG_API_KEY') || '').trim());
    return {
      ok: true,
      service: 'wog-post-ablieferbeleg',
      configured,
      inboundDir: this.inboundRoot,
    };
  }

  async ingest(input: PostAblieferbelegIngestInput): Promise<PostAblieferbelegIngestResult> {
    if (!input.buffer?.length) {
      throw new BadRequestException('Datei fehlt (leerer Inhalt)');
    }
    const mime = (input.mimeType || 'application/pdf').toLowerCase();
    if (!mime.includes('pdf') && !mime.includes('jpeg') && !mime.includes('jpg') && !mime.includes('png')) {
      throw new BadRequestException('Nur PDF/JPG/PNG erlaubt');
    }

    const orgId = await this.resolveOrganizationId();
    const shipment = await this.findShipment(orgId, input);
    if (!shipment) {
      throw new NotFoundException(
        'Keine Portal-Sendung gefunden – bitte shipmentNumber (z. B. 435958.1), trackingNumber oder postBarcode angeben',
      );
    }

    const sourceFileName =
      String(input.sourceFileName || input.fileName || '').trim() ||
      `post-pod-${Date.now()}.pdf`;
    const existing = await this.prisma.document.findFirst({
      where: {
        shipmentId: shipment.id,
        source: 'POST',
        OR: [
          { sourceFileName },
          ...(input.postBarcode
            ? [{ sourceFileName: { contains: String(input.postBarcode) } }]
            : []),
        ],
        type: { in: [DocumentType.POD, DocumentType.ABLIEFERBELEG] },
      },
      select: { id: true, fileName: true },
    });
    if (existing) {
      return {
        ok: true,
        documentId: existing.id,
        shipmentId: shipment.id,
        trackingNumber: shipment.trackingNumber,
        soloplanRef: shipment.soloplanRef,
        customerId: shipment.customerId,
        fileName: existing.fileName,
        delivered: shipment.status === ShipmentStatus.DELIVERED,
        duplicated: true,
      };
    }

    const ext = mime.includes('png') ? 'png' : mime.includes('jp') ? 'jpg' : 'pdf';
    const displayName = `Post-Ablieferbeleg ${
      shipment.soloplanRef || shipment.trackingNumber
    }.${ext}`;
    const safe = `${Date.now()}-post-${sourceFileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = join(this.uploadDir, 'post-ablieferbelege', safe);
    writeFileSync(storagePath, input.buffer);
    const sizeBytes = statSync(storagePath).size;

    const doc = await this.prisma.document.create({
      data: {
        organizationId: shipment.organizationId,
        shipmentId: shipment.id,
        customerId: shipment.customerId,
        type: DocumentType.POD,
        categoryCode: CustomerDocCategory.POD,
        source: 'POST',
        sourceFileName,
        importedAt: new Date(),
        fileName: displayName,
        mimeType: mime.includes('pdf')
          ? 'application/pdf'
          : mime.includes('png')
            ? 'image/png'
            : 'image/jpeg',
        storagePath,
        sizeBytes,
      },
    });

    let delivered = false;
    if (input.markDelivered !== false) {
      const deliveredAt = this.parseDate(input.deliveredAt) || new Date();
      if (shipment.status !== ShipmentStatus.DELIVERED) {
        await this.prisma.shipment.update({
          where: { id: shipment.id },
          data: {
            status: ShipmentStatus.DELIVERED,
            deliveryDate: shipment.deliveryDate || deliveredAt,
          },
        });
        await this.prisma.statusEvent.create({
          data: {
            shipmentId: shipment.id,
            status: ShipmentStatus.DELIVERED,
            message: input.postBarcode
              ? `Post-Ablieferbeleg (Barcode ${input.postBarcode})`
              : 'Post-Ablieferbeleg empfangen',
            createdAt: deliveredAt,
          },
        });
      }
      delivered = true;
    }

    try {
      await this.notifyPodMail(shipment, doc.fileName, storagePath, doc.mimeType);
    } catch (e: any) {
      this.log.warn(`POD-Notify ${shipment.trackingNumber}: ${e?.message || e}`);
    }

    this.log.log(
      `Post-Ablieferbeleg → ${shipment.trackingNumber}` +
        (shipment.soloplanRef ? ` (${shipment.soloplanRef})` : '') +
        ` doc=${doc.id}` +
        (delivered ? ' DELIVERED' : ''),
    );

    return {
      ok: true,
      documentId: doc.id,
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
      soloplanRef: shipment.soloplanRef,
      customerId: shipment.customerId,
      fileName: doc.fileName,
      delivered,
      duplicated: false,
    };
  }

  /** SFTP-Drop: {SFTP_INBOUND}/post-ablieferbelege/*.pdf */
  async processInboundDir(limit = 40) {
    let processed = 0;
    let unmatched = 0;
    let failed = 0;
    const files = this.listPending().slice(0, limit);
    for (const filePath of files) {
      const fileName = basename(filePath);
      try {
        const parsed = this.parseInboundFileName(fileName);
        const buf = readFileSync(filePath);
        const result = await this.ingest({
          ...parsed,
          buffer: buf,
          sourceFileName: fileName,
          fileName,
          mimeType: fileName.toLowerCase().endsWith('.png')
            ? 'image/png'
            : fileName.toLowerCase().endsWith('.jpg') ||
                fileName.toLowerCase().endsWith('.jpeg')
              ? 'image/jpeg'
              : 'application/pdf',
          markDelivered: true,
        });
        processed += 1;
        this.move(
          filePath,
          join(this.inboundRoot, 'processed', `${Date.now()}_${fileName}`),
        );
        this.log.log(
          `Post-SFTP ${fileName} → ${result.trackingNumber} (${result.documentId})`,
        );
      } catch (e: any) {
        if (e instanceof NotFoundException) {
          unmatched += 1;
          this.move(
            filePath,
            join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
          );
        } else {
          failed += 1;
          this.log.warn(`Post-SFTP ${fileName}: ${e?.message || e}`);
          this.move(
            filePath,
            join(this.inboundRoot, 'failed', `${Date.now()}_${fileName}`),
          );
        }
      }
    }
    return { processed, unmatched, failed, pending: this.listPending().length };
  }

  /**
   * Dateiname:
   * - 435958.1__99.00.123456.12345678.pdf
   * - 435958.1__POD__beleg.pdf
   * - WOG2608ABC__POD__beleg.pdf
   */
  parseInboundFileName(fileName: string): Partial<PostAblieferbelegIngestInput> {
    const base = fileName.replace(/\.(pdf|png|jpe?g)$/i, '');
    const parts = base.split('__').map((p) => p.trim()).filter(Boolean);
    const head = parts[0] || base;
    const out: Partial<PostAblieferbelegIngestInput> = {};

    if (/^\d{5,7}\.\d{1,3}$/.test(head)) {
      out.shipmentNumber = head;
    } else if (/^WOG/i.test(head)) {
      out.trackingNumber = head;
    } else if (/^\d{5,7}$/.test(head)) {
      out.orderNumber = head;
    } else {
      out.clientReference = head;
    }

    for (const p of parts.slice(1)) {
      if (/^POD$/i.test(p) || /^ABLIEFER/i.test(p)) continue;
      if (/^\d{5,7}\.\d{1,3}$/.test(p)) {
        out.shipmentNumber = p;
        continue;
      }
      // typische Post-Barcode-Muster (locker)
      if (/^[\d.]{8,}$/.test(p) || /^99\./.test(p) || /^98\./.test(p)) {
        out.postBarcode = p;
        continue;
      }
      if (!out.postBarcode) out.postBarcode = p;
    }
    return out;
  }

  private async resolveOrganizationId() {
    const slug = String(this.config.get('POST_ABLIEFERBELEG_ORG_SLUG') || 'wog').trim();
    const org = await this.prisma.organization.findFirst({
      where: { slug },
      select: { id: true },
    });
    if (!org) throw new ServiceUnavailableException(`Organisation ${slug} nicht gefunden`);
    return org.id;
  }

  private async findShipment(
    organizationId: string,
    input: PostAblieferbelegIngestInput,
  ) {
    const shipmentNumber = String(input.shipmentNumber || '').trim();
    const trackingNumber = String(input.trackingNumber || '').trim();
    const postBarcode = String(input.postBarcode || '').trim();
    const clientReference = String(input.clientReference || '').trim();
    let orderNumber = String(input.orderNumber || '').trim();
    let itemNumber: number | null = null;
    if (input.itemNumber != null && String(input.itemNumber).trim() !== '') {
      const n = Number(input.itemNumber);
      if (Number.isFinite(n) && n > 0) itemNumber = n;
    }

    if (/^\d{5,7}\.\d{1,3}$/.test(shipmentNumber)) {
      const [o, i] = shipmentNumber.split('.');
      orderNumber = o;
      itemNumber = Number(i);
    } else if (/^\d{5,7}$/.test(shipmentNumber) && !orderNumber) {
      orderNumber = shipmentNumber;
    }

    const or: any[] = [];
    if (trackingNumber) {
      or.push({ trackingNumber: { equals: trackingNumber, mode: 'insensitive' } });
    }
    if (shipmentNumber) {
      or.push({ soloplanRef: { equals: shipmentNumber, mode: 'insensitive' } });
      or.push({ reference: { equals: shipmentNumber, mode: 'insensitive' } });
    }
    if (orderNumber) {
      or.push({ soloplanRef: { equals: orderNumber, mode: 'insensitive' } });
      or.push({ order: { soloplanRef: { equals: orderNumber, mode: 'insensitive' } } });
      or.push({ order: { externalNumber: { equals: orderNumber, mode: 'insensitive' } } });
      if (itemNumber != null) {
        const dotted = `${orderNumber}.${itemNumber}`;
        or.push({ soloplanRef: { equals: dotted, mode: 'insensitive' } });
        or.push({ reference: { equals: dotted, mode: 'insensitive' } });
      }
    }
    if (postBarcode) {
      or.push({ reference: { equals: postBarcode, mode: 'insensitive' } });
      or.push({ soloplanRef: { equals: postBarcode, mode: 'insensitive' } });
      or.push({ trackingNumber: { equals: postBarcode, mode: 'insensitive' } });
    }
    if (clientReference) {
      or.push({ reference: { equals: clientReference, mode: 'insensitive' } });
      or.push({ soloplanRef: { equals: clientReference, mode: 'insensitive' } });
    }

    if (!or.length) return null;

    const candidates = await this.prisma.shipment.findMany({
      where: { organizationId, OR: or },
      select: {
        id: true,
        trackingNumber: true,
        organizationId: true,
        customerId: true,
        soloplanRef: true,
        reference: true,
        status: true,
        deliveryDate: true,
        extras: true,
        customer: { select: { customerNumber: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];

    // Bei mehreren Treffern: Barcode in extras bevorzugen
    if (postBarcode) {
      const hit = candidates.find((c) => {
        const raw = JSON.stringify(c.extras || {}).toLowerCase();
        return raw.includes(postBarcode.toLowerCase());
      });
      if (hit) return hit;
    }
    if (shipmentNumber) {
      const hit = candidates.find(
        (c) =>
          c.soloplanRef?.toLowerCase() === shipmentNumber.toLowerCase() ||
          c.reference?.toLowerCase() === shipmentNumber.toLowerCase(),
      );
      if (hit) return hit;
    }
    return candidates[0];
  }

  /**
   * POD-Mail analog Herzog-Austritt (Portal-User + optional CC).
   * Quehenberger (4390): PDF-Anhang + CC (Standard: marcel.burtscher@worldofgreen.ch).
   * Falls noch keine Portal-User: Direktversand an QUEHENBERGER_POD_MAIL_TO.
   */
  private async notifyPodMail(
    shipment: {
      id: string;
      trackingNumber: string;
      soloplanRef: string | null;
      customerId: string | null;
      customer?: { customerNumber: string; name: string } | null;
    },
    fileName: string,
    storagePath: string,
    mimeType: string,
  ) {
    let customerNumber = shipment.customer?.customerNumber || null;
    let customerName = shipment.customer?.name || null;
    if (!customerNumber && shipment.customerId) {
      const cust = await this.prisma.customer.findUnique({
        where: { id: shipment.customerId },
        select: { customerNumber: true, name: true },
      });
      customerNumber = cust?.customerNumber || null;
      customerName = cust?.name || null;
    }

    const isQuehenberger = customerNumber === '4390';
    const cc = isQuehenberger
      ? this.notifications.normalizeEmails(
          this.config.get('QUEHENBERGER_POD_MAIL_CC') ||
            'marcel.burtscher@worldofgreen.ch',
        )
      : [];
    const attachment = {
      filename: fileName,
      path: storagePath,
      contentType: mimeType,
    };

    await this.notifications.notifyShipmentUsers(
      shipment.id,
      NotificationEvent.POD_AVAILABLE,
      {
        fileName,
        category: CustomerDocCategory.POD,
        source: 'POST',
      },
      {
        attachments: isQuehenberger ? [attachment] : undefined,
        cc: cc.length ? cc : undefined,
      },
    );

    if (!isQuehenberger) return;

    // Direktversand an feste Empfänger, falls noch kein Portal-User existiert
    const existingUsers = await this.prisma.user.findMany({
      where: { customerId: shipment.customerId || undefined, active: true },
      select: { email: true },
    });
    const have = new Set(existingUsers.map((u) => u.email.toLowerCase()));
    const fallbackTo = this.notifications
      .normalizeEmails(
        this.config.get('QUEHENBERGER_POD_MAIL_TO') ||
          'christian.kerschbaumer@quehenberger.com,Michael.Ecker@quehenberger.com',
      )
      .filter((e) => !have.has(e.toLowerCase()));
    if (!fallbackTo.length) return;

    const subject = `POD verfügbar ${shipment.trackingNumber}`;
    const body = [
      `Hallo,`,
      '',
      `Neuer Ablieferbeleg (POD) von der Post für Quehenberger.`,
      '',
      `Sendung: ${shipment.trackingNumber}`,
      shipment.soloplanRef ? `Auftrag/Sendung: ${shipment.soloplanRef}` : null,
      customerName ? `Kunde: ${customerName} (${customerNumber})` : null,
      `Datei: ${fileName}`,
      '',
      `Portal: ${this.config.get('APP_URL') || 'https://wog.logistikberater.at'}`,
      '',
      'WOG – World of Green Logistics',
    ]
      .filter(Boolean)
      .join('\n');

    await this.notifications.sendRaw(
      fallbackTo.join(', '),
      subject,
      body,
      NotificationEvent.POD_AVAILABLE,
      [attachment],
      cc.length ? { cc } : undefined,
    );
    this.log.log(
      `Quehenberger POD-Mail → ${fallbackTo.join(', ')}` +
        (cc.length ? ` cc=${cc.join(',')}` : ''),
    );
  }

  private parseDate(raw: string | null | undefined): Date | null {
    if (!raw) return null;
    const d = new Date(String(raw));
    return Number.isFinite(d.getTime()) ? d : null;
  }

  private listPending(): string[] {
    if (!existsSync(this.inboundRoot)) return [];
    return readdirSync(this.inboundRoot, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.(pdf|png|jpe?g)$/i.test(e.name))
      .map((e) => join(this.inboundRoot, e.name))
      .sort();
  }

  private move(from: string, to: string) {
    mkdirSync(dirname(to), { recursive: true });
    try {
      renameSync(from, to);
    } catch {
      copyFileSync(from, to);
      try {
        unlinkSync(from);
      } catch {
        /* ignore */
      }
    }
  }
}
