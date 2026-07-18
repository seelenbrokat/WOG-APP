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
        auth: this.config.get('SMTP_USER')
          ? {
              user: this.config.get('SMTP_USER'),
              pass: this.config.get('SMTP_PASS'),
            }
          : undefined,
      });
    }
  }

  async sendRaw(toEmail: string, subject: string, body: string, event?: NotificationEvent) {
    const outbox = await this.prisma.emailOutbox.create({
      data: { toEmail, subject, body, event },
    });
    try {
      if (this.transporter) {
        await this.transporter.sendMail({
          from: this.config.get('SMTP_FROM') || 'noreply@wog.logistikberater.at',
          to: toEmail,
          subject,
          text: body,
        });
      } else {
        this.logger.log(`[DEV-MAIL] to=${toEmail} subject=${subject}`);
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
  ) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        customer: { include: { users: { include: { notificationPrefs: true } } } },
        mandant: true,
      },
    });
    if (!shipment) return;

    const subjectMap: Record<NotificationEvent, string> = {
      SHIPMENT_CREATED: `Neuer Auftrag ${shipment.trackingNumber}`,
      STATUS_CHANGED: `Statusupdate ${shipment.trackingNumber}`,
      POD_AVAILABLE: `POD verfügbar ${shipment.trackingNumber}`,
      DOCUMENT_RECEIVED: `Neues Dokument ${shipment.trackingNumber}`,
      PARTNER_FILE_IMPORTED: `Partnerdatei verarbeitet`,
    };

    const body = [
      `Sendung: ${shipment.trackingNumber}`,
      `Mandant: ${shipment.mandant.name}`,
      `Event: ${event}`,
      ...Object.entries(payload).map(([k, v]) => `${k}: ${v}`),
      '',
      `Portal: ${this.config.get('APP_URL') || 'https://wog.logistikberater.at'}`,
    ].join('\n');

    for (const user of shipment.customer.users) {
      const pref = user.notificationPrefs.find((p) => p.event === event);
      if (pref && !pref.email) continue;
      if (!user.active) continue;
      await this.sendRaw(user.email, subjectMap[event], `Hallo ${user.firstName},\n\n${body}\n`, event);
    }
  }
}
