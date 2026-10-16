import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { NotificationEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  private transporter: nodemailer.Transporter | null = null;
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const host = this.config.get('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(this.config.get('SMTP_PORT') || 587),
        secure: false,
        connectionTimeout: 8_000,
        greetingTimeout: 8_000,
        socketTimeout: 12_000,
        auth: this.config.get('SMTP_USER')
          ? {
              user: this.config.get('SMTP_USER'),
              pass: this.config.get('SMTP_PASS'),
            }
          : undefined,
      });
    }
  }

  async sendRaw(
    toEmail: string,
    subject: string,
    body: string,
    event?: NotificationEvent,
    attachments?: Array<{ filename: string; path?: string; content?: Buffer; contentType?: string }>,
    opts?: { replyTo?: string; cc?: string | string[] },
  ) {
    const ccList = this.normalizeEmails(opts?.cc);
    const outbox = await this.prisma.emailOutbox.create({
      data: {
        toEmail: ccList.length ? `${toEmail} (cc: ${ccList.join(', ')})` : toEmail,
        subject,
        body,
        event,
      },
    });
    try {
      if (this.transporter) {
        await this.transporter.sendMail({
          from:
            this.config.get('SMTP_FROM') ||
            this.config.get('SMTP_USER') ||
            'info@logistikberater.at',
          to: toEmail,
          ...(ccList.length ? { cc: ccList } : {}),
          subject,
          text: body,
          ...(opts?.replyTo ? { replyTo: opts.replyTo } : {}),
          attachments: attachments?.map((a) => ({
            filename: a.filename,
            path: a.path,
            content: a.content,
            contentType: a.contentType,
          })),
        });
      } else {
        this.logger.log(
          `[DEV-MAIL] to=${toEmail}` +
            (ccList.length ? ` cc=${ccList.join(',')}` : '') +
            ` subject=${subject}`,
        );
      }
      await this.prisma.emailOutbox.update({
        where: { id: outbox.id },
        data: { sentAt: new Date() },
      });
    } catch (err: any) {
      await this.prisma.emailOutbox.update({
        where: { id: outbox.id },
        data: { error: err?.message || String(err) },
      });
      this.logger.error(`Mail failed: ${err?.message}`);
    }
  }

  async notifyShipmentUsers(
    shipmentId: string,
    event: NotificationEvent,
    payload: Record<string, unknown>,
    opts?: {
      attachments?: Array<{
        filename: string;
        path?: string;
        content?: Buffer;
        contentType?: string;
      }>;
      cc?: string | string[];
    },
  ) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        customer: { include: { users: { include: { notificationPrefs: true } } } },
        mandant: true,
      },
    });
    if (!shipment) return;

    // Wareneingang (Intouch/Soloplan oder manuell) erzeugt viele Sendungen –
    // keine „Neuer Auftrag“-Mails dafür.
    if (event === NotificationEvent.SHIPMENT_CREATED && this.isWareneingangShipment(shipment)) {
      this.logger.debug(
        `Skip SHIPMENT_CREATED mail for Wareneingang ${shipment.trackingNumber} (${shipment.reference})`,
      );
      return;
    }

    const subjectMap: Record<NotificationEvent, string> = {
      SHIPMENT_CREATED: `Neuer Auftrag ${shipment.trackingNumber}`,
      STATUS_CHANGED: `Statusupdate ${shipment.trackingNumber}`,
      POD_AVAILABLE: `POD verfügbar ${shipment.trackingNumber}`,
      DOCUMENT_RECEIVED: `Neues Dokument ${shipment.trackingNumber}`,
      PARTNER_FILE_IMPORTED: `Partnerdatei verarbeitet`,
    };

    // Payload-Felder, die nicht in den Mailtext gehören
    const { storagePath: _sp, mimeType: _mt, ...publicPayload } = payload as Record<
      string,
      unknown
    > & { storagePath?: unknown; mimeType?: unknown };

    const body = [
      `Sendung: ${shipment.trackingNumber}`,
      shipment.soloplanRef ? `Auftrag/Sendung: ${shipment.soloplanRef}` : null,
      `Mandant: ${shipment.mandant.name}`,
      `Kunde: ${shipment.customer.name}`,
      `Event: ${event}`,
      ...Object.entries(publicPayload).map(([k, v]) => `${k}: ${v}`),
      '',
      `Portal: ${this.config.get('APP_URL') || 'https://wog.logistikberater.at'}`,
    ]
      .filter(Boolean)
      .join('\n');

    const cc = this.normalizeEmails(opts?.cc);
    for (const user of shipment.customer.users) {
      const pref = user.notificationPrefs.find((p) => p.event === event);
      if (pref && !pref.email) continue;
      if (!user.active) continue;
      // CC nicht an den Empfänger selbst spiegeln
      const userCc = cc.filter((e) => e.toLowerCase() !== user.email.toLowerCase());
      await this.sendRaw(
        user.email,
        subjectMap[event],
        `Hallo ${user.firstName},\n\n${body}\n`,
        event,
        opts?.attachments,
        userCc.length ? { cc: userCc } : undefined,
      );
    }
  }

  /** Komma-/Semikolon-getrennte oder Array-Adressen → eindeutige Liste. */
  normalizeEmails(raw?: string | string[] | null): string[] {
    if (!raw) return [];
    const parts = Array.isArray(raw) ? raw : String(raw).split(/[,;]+/);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const p of parts) {
      const e = String(p || '').trim();
      if (!e || !e.includes('@')) continue;
      const key = e.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
    return out;
  }

  /** Wareneingang-Sendungen: Referenz WE-* oder Warenbeschreibung. */
  private isWareneingangShipment(shipment: {
    reference: string | null;
    goodsDescription: string | null;
  }): boolean {
    const ref = shipment.reference || '';
    const goods = shipment.goodsDescription || '';
    return (
      /^WE-/i.test(ref) ||
      /wareneingang/i.test(ref) ||
      /wareneingang/i.test(goods)
    );
  }
}
