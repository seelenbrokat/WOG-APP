import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
} from 'fs';
import { basename, join } from 'path';
import {
  detectEzollDocType,
  linkMobilitySmsAddress,
  normalizePhoneE164,
  normalizeSmartBorderPlate,
  type EzollDocType,
} from '@wog/shared';
import { CustomsRefSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShipmentCustomsRefService } from './shipment-customs-ref.service';

/** Dokumente, die an SmartBorder pdf-ingest gehen. */
const SMARTBORDER_DOC_TYPES = new Set<EzollDocType>(['CCATBT02BC', 'CCATBT12BC']);

/** Offene Verzollungsaufträge: Match-Fenster nach Kennzeichen. */
const MATCH_LOOKBACK_DAYS = 7;

export type EzollSmartborderIngestResult = {
  processed: number;
  failed: number;
  skipped: number;
  linked: number;
  files: string[];
};

/**
 * eZoll CCATBT-PDFs → SmartBorder pdf-ingest:
 * - CCATBT02BC Grenzzollstellen-Eingangsschein (Korridor) – Warenort aus PDF
 * - CCATBT12BC Transit-Eingangsschein – warenortId (Default hohenems-schwefelbad)
 *
 * Verknüpfung Verzollungsauftrag: Kennzeichen aus PDF (kein Portal/Soloplan-Ref auf GZES/Transit).
 * Bei Treffer: driverPhone an Ingest, Token speichern, Link per E-Mail / SMS (LinkMobility).
 */
@Injectable()
export class EzollSmartborderService {
  private readonly log = new Logger(EzollSmartborderService.name);
  private readonly inboundRoot: string;
  private readonly enabled: boolean;
  private readonly apiBase: string;
  private readonly ingestKey: string;
  private readonly defaultWarenortId: string;
  private readonly smsDomain: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private customsRefs: ShipmentCustomsRefService,
  ) {
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') ||
      join(process.cwd(), '../../data/sftp/inbound');
    this.inboundRoot = join(sftpInbound, 'Ezoll-Dokumente');

    this.apiBase = (
      this.config.get<string>('SMARTBORDER_API_BASE') ||
      'https://api.logistikberater.at'
    ).replace(/\/$/, '');
    this.ingestKey =
      this.config.get<string>('SMARTBORDER_INGEST_KEY') ||
      this.config.get<string>('GEOTRACKER_INGEST_KEY') ||
      '';
    this.defaultWarenortId =
      this.config.get<string>('SMARTBORDER_DEFAULT_WARENORT_ID') ||
      'hohenems-schwefelbad';
    this.smsDomain =
      this.config.get<string>('SMARTBORDER_SMS_EMAIL_DOMAIN') ||
      'email2sms.linkmobility.eu';

    const flag = this.config.get('SMARTBORDER_EZOLL_INGEST_ENABLED');
    this.enabled = flag !== 'false' && !!this.ingestKey;

    for (const dir of [
      join(this.inboundRoot, 'processed', 'smartborder'),
      join(this.inboundRoot, 'failed', 'smartborder'),
    ]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  async processInboundBatch(limit = 20): Promise<EzollSmartborderIngestResult> {
    if (!this.enabled) {
      return { processed: 0, failed: 0, skipped: 0, linked: 0, files: [] };
    }

    const pending = this.listPendingSmartborderPdfs().slice(0, limit);
    let processed = 0;
    let failed = 0;
    let linked = 0;
    const files: string[] = [];

    for (const filePath of pending) {
      const fileName = basename(filePath);
      const docType = detectEzollDocType(fileName);
      try {
        const result = await this.ingestAndLink(filePath, docType);
        if (!result.ok) {
          failed += 1;
          this.move(
            filePath,
            join(this.inboundRoot, 'failed', 'smartborder', `${Date.now()}_${fileName}`),
          );
          this.log.warn(
            `SmartBorder ingest fehlgeschlagen ${fileName}: ${result.error || 'unknown'}`,
          );
          continue;
        }
        processed += 1;
        files.push(fileName);
        if (result.linked) linked += 1;
        this.move(
          filePath,
          join(this.inboundRoot, 'processed', 'smartborder', `${Date.now()}_${fileName}`),
        );
        this.log.log(
          `SmartBorder ← ${fileName} (${docType}` +
            (result.corridorType ? ` / ${result.corridorType}` : '') +
            (result.plate ? ` plate=${result.plate}` : '') +
            (result.orderExternal ? ` → ${result.orderExternal}` : '') +
            (result.token ? ` token…${result.token.slice(-8)}` : '') +
            ')',
        );
      } catch (e: any) {
        failed += 1;
        this.move(
          filePath,
          join(this.inboundRoot, 'failed', 'smartborder', `${Date.now()}_${fileName}`),
        );
        this.log.warn(`SmartBorder ingest Exception ${fileName}: ${e?.message || e}`);
      }
    }

    return { processed, failed, skipped: 0, linked, files };
  }

  private async ingestAndLink(
    filePath: string,
    docType: EzollDocType,
  ): Promise<{
    ok: boolean;
    error?: string;
    token?: string;
    corridorType?: string;
    plate?: string;
    orderExternal?: string;
    linked?: boolean;
  }> {
    const fileName = basename(filePath);
    const buf = readFileSync(filePath);

    // 1) Parse → Kennzeichen (einziger stabiler Hook zu Verzollungsauftrag)
    const parsed = await this.pdfIngest(buf, fileName, docType, { action: 'parse' });
    if (!parsed.ok) {
      return { ok: false, error: parsed.error || 'parse failed' };
    }

    const plateRaw =
      parsed.extracted?.licensePlateFront ||
      parsed.extracted?.licensePlateRear ||
      '';
    const plateCountry = parsed.extracted?.licensePlateCountry || null;
    const plate = plateRaw
      ? normalizeSmartBorderPlate(plateRaw, plateCountry)
      : '';

    const order = plate ? await this.findCustomsOrderByPlate(plate) : null;
    const driverPhone = order?.driverPhone
      ? normalizePhoneE164(order.driverPhone)
      : null;

    // 2) Create mit optionaler Fahrernummer aus Verzollungsauftrag
    const created = await this.pdfIngest(buf, fileName, docType, {
      action: 'create',
      driverPhone: driverPhone || undefined,
    });
    if (!created.ok) {
      return { ok: false, error: created.error || 'create failed' };
    }

    const token = created.token;
    const url =
      created.url ||
      (token
        ? `https://smartborder.logistikberater.at/geotracker/?t=${token}`
        : undefined);

    let linked = false;
    if (order && (token || url)) {
      await this.prisma.customsOrder.update({
        where: { id: order.id },
        data: {
          smartborderToken: token || order.smartborderToken,
          smartborderUrl: url || order.smartborderUrl,
          smartborderLinkedAt: new Date(),
        },
      });
      linked = true;
      await this.notifySmartborderLink(order, url || '', plate);
    } else if (plate && !order) {
      this.log.log(
        `SmartBorder ${fileName}: kein offener Verzollungsauftrag für Kennzeichen ${plate}`,
      );
    }

    const borderTxn =
      created.extracted?.borderTransactionNumber ||
      parsed.extracted?.borderTransactionNumber ||
      token ||
      null;
    const orgId = order?.organizationId;
    if (orgId && (borderTxn || plate)) {
      const source =
        docType === 'CCATBT12BC'
          ? CustomsRefSource.SMARTBORDER_CCATBT12
          : CustomsRefSource.SMARTBORDER_CCATBT02;
      await this.customsRefs
        .upsertSmartborder({
          organizationId: orgId,
          source,
          mrn: borderTxn,
          lrn: plate || null,
          sourceFileName: fileName,
          customsExternalNumber: order?.externalNumber || null,
        })
        .catch((e: any) =>
          this.log.warn(`SmartBorder CustomsRef ${fileName}: ${e?.message || e}`),
        );
    }

    return {
      ok: true,
      token,
      corridorType: created.corridorType || parsed.corridorType,
      plate: plate || undefined,
      orderExternal: order?.externalNumber || undefined,
      linked,
    };
  }

  private async pdfIngest(
    buf: Buffer,
    fileName: string,
    docType: EzollDocType,
    opts: { action: 'parse' | 'create'; driverPhone?: string },
  ): Promise<{
    ok: boolean;
    error?: string;
    token?: string;
    url?: string;
    corridorType?: string;
    extracted?: {
      licensePlateFront?: string;
      licensePlateRear?: string;
      licensePlateCountry?: string;
      borderTransactionNumber?: string;
    };
  }> {
    const form = new FormData();
    form.append(
      'pdf',
      new Blob([new Uint8Array(buf)], { type: 'application/pdf' }),
      fileName,
    );
    form.append('action', opts.action);
    if (docType === 'CCATBT12BC') {
      form.append('warenortId', this.defaultWarenortId);
    }
    if (opts.driverPhone) {
      form.append('driverPhone', opts.driverPhone);
      form.append('callOnClearance', 'true');
    }

    const url = `${this.apiBase}/smartborder/v1/pdf-ingest`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-Ingest-Key': this.ingestKey,
      },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });

    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }

    if (!res.ok || body?.ok === false) {
      const err =
        body?.error ||
        body?.message ||
        `HTTP ${res.status}${body ? ` ${JSON.stringify(body).slice(0, 200)}` : ''}`;
      return { ok: false, error: String(err) };
    }

    return {
      ok: true,
      token: typeof body?.token === 'string' ? body.token : undefined,
      url: typeof body?.url === 'string' ? body.url : undefined,
      corridorType:
        typeof body?.corridorType === 'string' ? body.corridorType : undefined,
      extracted: body?.extracted && typeof body.extracted === 'object' ? body.extracted : undefined,
    };
  }

  /**
   * Match Verzollungsauftrag über Kennzeichen.
   * Bei mehreren offenen Aufträgen: jüngster ohne SmartBorder-Link, sonst jüngster.
   */
  private async findCustomsOrderByPlate(plate: string) {
    const since = new Date(Date.now() - MATCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const plateKey = plate.replace(/[\s\-.]/g, '').toUpperCase();

    const candidates = await this.prisma.customsOrder.findMany({
      where: {
        createdAt: { gte: since },
        status: { notIn: ['DONE', 'CANCELLED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const matched = candidates.filter((o) => {
      const k = normalizeSmartBorderPlate(o.kennzeichen, o.zulassungsland)
        .replace(/[\s\-.]/g, '')
        .toUpperCase();
      const t = o.kennzeichenAnhaenger
        ? normalizeSmartBorderPlate(
            o.kennzeichenAnhaenger,
            o.zulassungslandAnhaenger,
          )
            .replace(/[\s\-.]/g, '')
            .toUpperCase()
        : '';
      return k === plateKey || (t && t === plateKey);
    });

    if (!matched.length) return null;
    if (matched.length > 1) {
      this.log.warn(
        `SmartBorder Kennzeichen ${plate}: ${matched.length} offene Verzollungsaufträge – nehme ${matched.find((m) => !m.smartborderToken)?.externalNumber || matched[0].externalNumber}`,
      );
    }
    return matched.find((m) => !m.smartborderToken) || matched[0];
  }

  private async notifySmartborderLink(
    order: {
      id: string;
      externalNumber: string | null;
      kennzeichen: string;
      driverPhone: string | null;
      smartborderNotifyEmail: string | null;
      smartborderSendSms: boolean;
    },
    url: string,
    plate: string,
  ) {
    if (!url) return;
    const subject = `SmartBorder-Link ${order.externalNumber || order.id} · ${plate}`;
    const body =
      `Ihr SmartBorder-Fahrerlink zum Verzollungsauftrag ${order.externalNumber || ''}.\n\n` +
      `Kennzeichen: ${plate}\n` +
      `Link: ${url}\n\n` +
      `Bitte im Browser oder in der WOG Companion App öffnen.\n`;

    const recipients = new Set<string>();
    if (order.smartborderNotifyEmail) {
      recipients.add(order.smartborderNotifyEmail);
    }
    if (order.smartborderSendSms && order.driverPhone) {
      const smsTo = linkMobilitySmsAddress(order.driverPhone, this.smsDomain);
      if (smsTo) recipients.add(smsTo);
      else {
        this.log.warn(
          `SMS-Adresse ungültig für Order ${order.externalNumber}: ${order.driverPhone}`,
        );
      }
    }

    for (const to of recipients) {
      try {
        await this.notifications.sendRaw(to, subject, body);
        this.log.log(`SmartBorder-Link gesendet an ${to} (${order.externalNumber})`);
      } catch (e: any) {
        this.log.warn(`SmartBorder-Link Mail fehlgeschlagen ${to}: ${e?.message || e}`);
      }
    }
  }

  private listPendingSmartborderPdfs(): string[] {
    if (!existsSync(this.inboundRoot)) return [];
    const skip = new Set(['processed', 'failed', 'pending-customer-exit', '.cache']);
    const out: string[] = [];
    for (const entry of readdirSync(this.inboundRoot, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (skip.has(entry.name)) continue;
      if (!/\.pdf$/i.test(entry.name)) continue;
      const typ = detectEzollDocType(entry.name);
      if (!SMARTBORDER_DOC_TYPES.has(typ)) continue;
      out.push(join(this.inboundRoot, entry.name));
    }
    return out.sort((a, b) => a.localeCompare(b));
  }

  private move(from: string, to: string) {
    try {
      renameSync(from, to);
    } catch {
      mkdirSync(join(to, '..'), { recursive: true });
      renameSync(from, to);
    }
  }
}
