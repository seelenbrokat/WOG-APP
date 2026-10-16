import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ProformaWeService } from './proforma-we.service';
import { SchmidtsLadelisteWeService } from './schmidts-ladeliste-we.service';
import { looksLikeSchmidtsLadeliste } from './schmidts-ladeliste.parser';
import {
  extractTextFromPdfBuffer,
  parseProformaInvoiceText,
} from './proforma-invoice.parser';

const execFileAsync = promisify(execFile);

type GraphToken = { access_token: string; expires_at: number };

type GraphMessage = {
  id: string;
  subject?: string;
  receivedDateTime?: string;
  hasAttachments?: boolean;
  from?: { emailAddress?: { address?: string; name?: string } };
};

type GraphAttachment = {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  '@odata.type'?: string;
  contentBytes?: string;
};

type WeKind = 'schmidts' | 'proforma' | 'unknown';

/**
 * portal@worldofgreen.ch → WE-Scanning (TC57).
 *
 * Ungeleesene Mails mit PDF: Unitec-Proforma → rechnungen/,
 * Schmidts-Ladeliste → ladelisten/, danach bestehende WE-Pipelines.
 */
@Injectable()
export class PortalMailWeService {
  private readonly logger = new Logger(PortalMailWeService.name);
  private tokenCache: GraphToken | null = null;
  private readonly inboundRoot: string;
  private readonly mailbox: string;

  constructor(
    private config: ConfigService,
    private proformaWe: ProformaWeService,
    private schmidtsLadeliste: SchmidtsLadelisteWeService,
  ) {
    this.inboundRoot =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.mailbox = (
      this.config.get<string>('GRAPH_MAILBOX') ||
      this.config.get<string>('GRAPH_MAILBOXES') ||
      'portal@worldofgreen.ch'
    )
      .split(/[,;]+/)
      .map((s) => s.trim())
      .find((s) => /portal@worldofgreen\.ch/i.test(s)) || 'portal@worldofgreen.ch';
  }

  enabled() {
    const flag = (this.config.get<string>('GRAPH_WE_MAIL_ENABLED') || '1').trim();
    if (flag === '0' || /^false$/i.test(flag)) return false;
    return Boolean(
      this.config.get('GRAPH_TENANT_ID') &&
        this.config.get('GRAPH_CLIENT_ID') &&
        this.config.get('GRAPH_CLIENT_SECRET'),
    );
  }

  status() {
    return {
      enabled: this.enabled(),
      mailbox: this.mailbox,
      tenantConfigured: Boolean(this.config.get('GRAPH_TENANT_ID')),
      clientConfigured: Boolean(this.config.get('GRAPH_CLIENT_ID')),
      secretConfigured: Boolean(this.config.get('GRAPH_CLIENT_SECRET')),
    };
  }

  /** Worker: ungelesene Inbox-Mails mit PDF → WE-Session. */
  async processInbox(limit = 15) {
    if (!this.enabled()) {
      return { skipped: true, reason: 'graph_we_mail_disabled_or_unconfigured', processed: 0, failed: 0 };
    }

    const token = await this.getAccessToken();
    const messages = await this.listUnreadWithAttachments(token, Math.max(1, Math.min(40, limit)));
    const results: unknown[] = [];
    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const msg of messages) {
      try {
        const res = await this.processMessage(token, msg);
        results.push(res);
        if (res.ok) {
          processed += 1;
          await this.markReadAndArchive(token, msg.id, true);
        } else if (res.skipped) {
          skipped += 1;
          // ohne PDF / nicht relevant → als gelesen belassen, nicht archivieren
          if (res.markRead) await this.patchMessage(token, msg.id, { isRead: true });
        } else {
          failed += 1;
        }
      } catch (err: any) {
        failed += 1;
        this.logger.warn(`portal-mail ${msg.id}: ${err?.message || err}`);
        results.push({
          messageId: msg.id,
          subject: msg.subject,
          ok: false,
          error: err?.message || String(err),
        });
      }
    }

    return {
      skipped: false,
      mailbox: this.mailbox,
      scanned: messages.length,
      processed,
      failed,
      ignored: skipped,
      results,
    };
  }

  private async processMessage(token: string, msg: GraphMessage) {
    const attachments = await this.listPdfAttachments(token, msg.id);
    if (!attachments.length) {
      return {
        ok: false,
        skipped: true,
        markRead: false,
        messageId: msg.id,
        subject: msg.subject,
        reason: 'no_pdf_attachment',
      };
    }

    const fileResults: unknown[] = [];
    let wroteSchmidts = false;
    let wroteProforma = false;
    let anyFail = false;
    const written: Array<{ name?: string; kind: WeKind; fileName: string }> = [];

    for (const att of attachments) {
      const bytes = await this.downloadAttachment(token, msg.id, att);
      if (!bytes?.length) {
        anyFail = true;
        fileResults.push({ name: att.name, ok: false, error: 'empty_attachment' });
        continue;
      }

      const kind = await this.classifyPdf(att.name || '', msg.subject || '', bytes);
      if (kind === 'unknown') {
        fileResults.push({
          name: att.name,
          ok: false,
          skipped: true,
          reason: 'neither_schmidts_nor_unitec_proforma',
        });
        continue;
      }

      const safeName = this.safeFileName(att.name || `${kind}.pdf`);
      const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const targetDir =
        kind === 'schmidts'
          ? join(this.inboundRoot, 'wareneingang', 'ladelisten')
          : join(this.inboundRoot, 'wareneingang', 'rechnungen');
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      const fileName = `mail_${stamp}_${safeName}`;
      writeFileSync(join(targetDir, fileName), bytes);
      written.push({ name: att.name, kind, fileName });
      if (kind === 'schmidts') wroteSchmidts = true;
      else wroteProforma = true;
    }

    const pipelineResults: any[] = [];
    if (wroteSchmidts) {
      const batch = await this.schmidtsLadeliste.processInboundDir();
      pipelineResults.push(...(batch.results || []));
    }
    if (wroteProforma) {
      const batch = await this.proformaWe.processInboundDir();
      pipelineResults.push(...(batch.results || []));
    }

    for (const w of written) {
      const hit = pipelineResults.find(
        (r: any) => r?.fileName === w.fileName || String(r?.fileName || '').includes(w.fileName),
      );
      const ok = Boolean(hit?.ok);
      if (!ok) anyFail = true;
      fileResults.push({ name: w.name, kind: w.kind, fileName: w.fileName, ok, pipeline: hit });
    }

    const anyOk = written.some((w) =>
      pipelineResults.some((r: any) => r?.ok && r?.fileName === w.fileName),
    );

    if (anyOk && !anyFail) {
      return {
        ok: true,
        messageId: msg.id,
        subject: msg.subject,
        from: msg.from?.emailAddress?.address,
        files: fileResults,
      };
    }
    if (anyOk && anyFail) {
      return {
        ok: true,
        partial: true,
        messageId: msg.id,
        subject: msg.subject,
        files: fileResults,
      };
    }
    if (fileResults.every((f: any) => f.skipped)) {
      return {
        ok: false,
        skipped: true,
        markRead: true,
        messageId: msg.id,
        subject: msg.subject,
        reason: 'attachments_not_we_docs',
        files: fileResults,
      };
    }
    return {
      ok: false,
      messageId: msg.id,
      subject: msg.subject,
      files: fileResults,
    };
  }

  private async classifyPdf(fileName: string, subject: string, bytes: Buffer): Promise<WeKind> {
    const hint = `${fileName} ${subject}`.toLowerCase();
    if (/schweiz\s*fertig|ladeliste|schmidts/.test(hint)) return 'schmidts';
    if (/proforma|unitec|ausfuhr/.test(hint)) return 'proforma';

    const text = await this.pdfText(bytes);
    if (looksLikeSchmidtsLadeliste(text)) return 'schmidts';
    const parsed = parseProformaInvoiceText(text);
    if (parsed.lines.length > 0 || /\bBK\d{6,}\b/i.test(text)) return 'proforma';
    return 'unknown';
  }

  private async pdfText(bytes: Buffer): Promise<string> {
    const tmpDir = join(this.inboundRoot, 'wareneingang', '.mail-tmp');
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
    const tmp = join(tmpDir, `peek_${Date.now()}.pdf`);
    writeFileSync(tmp, bytes);
    try {
      const { stdout } = await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', tmp, '-'], {
        timeout: 20_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (stdout?.trim()) return stdout;
    } catch {
      /* fallback */
    }
    try {
      return extractTextFromPdfBuffer(bytes);
    } catch {
      return '';
    }
  }

  private safeFileName(name: string) {
    const base = name.replace(/[^\w.\- ()äöüÄÖÜß]+/g, '_').trim() || 'attachment.pdf';
    return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expires_at > now + 60_000) {
      return this.tokenCache.access_token;
    }
    const tenant = this.config.get<string>('GRAPH_TENANT_ID')!;
    const body = new URLSearchParams({
      client_id: this.config.get<string>('GRAPH_CLIENT_ID')!,
      client_secret: this.config.get<string>('GRAPH_CLIENT_SECRET')!,
      scope: this.config.get<string>('GRAPH_SCOPE') || 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json()) as any;
    if (!res.ok || !json.access_token) {
      throw new Error(`Graph token: ${json.error || res.status} ${json.error_description || ''}`);
    }
    this.tokenCache = {
      access_token: json.access_token,
      expires_at: now + Number(json.expires_in || 3600) * 1000,
    };
    return json.access_token;
  }

  private async graph<T = any>(token: string, path: string, init?: RequestInit): Promise<T> {
    const url = path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
    });
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      throw new Error(`Graph ${res.status}: ${json?.error?.message || JSON.stringify(json).slice(0, 300)}`);
    }
    return json as T;
  }

  private async listUnreadWithAttachments(token: string, top: number): Promise<GraphMessage[]> {
    const qs = new URLSearchParams({
      $top: String(top),
      $select: 'id,subject,receivedDateTime,hasAttachments,from',
      $orderby: 'receivedDateTime asc',
      $filter: 'isRead eq false',
    });
    const data = await this.graph<{ value: GraphMessage[] }>(
      token,
      `/users/${encodeURIComponent(this.mailbox)}/mailFolders/inbox/messages?${qs}`,
    );
    return (data.value || []).filter((m) => m.hasAttachments);
  }

  private async listPdfAttachments(token: string, messageId: string): Promise<GraphAttachment[]> {
    const data = await this.graph<{ value: GraphAttachment[] }>(
      token,
      `/users/${encodeURIComponent(this.mailbox)}/messages/${messageId}/attachments?$select=id,name,contentType,size`,
    );
    return (data.value || []).filter((a) => {
      const name = (a.name || '').toLowerCase();
      const ct = (a.contentType || '').toLowerCase();
      return name.endsWith('.pdf') || ct.includes('pdf');
    });
  }

  private async downloadAttachment(
    token: string,
    messageId: string,
    att: GraphAttachment,
  ): Promise<Buffer | null> {
    const full = await this.graph<GraphAttachment>(
      token,
      `/users/${encodeURIComponent(this.mailbox)}/messages/${messageId}/attachments/${att.id}`,
    );
    if (full.contentBytes) return Buffer.from(full.contentBytes, 'base64');
    return null;
  }

  private async patchMessage(token: string, messageId: string, body: Record<string, unknown>) {
    await this.graph(
      token,
      `/users/${encodeURIComponent(this.mailbox)}/messages/${messageId}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
  }

  private async markReadAndArchive(token: string, messageId: string, archive: boolean) {
    await this.patchMessage(token, messageId, { isRead: true });
    if (!archive) return;
    try {
      const folderId = await this.ensureProcessedFolder(token);
      await this.graph(
        token,
        `/users/${encodeURIComponent(this.mailbox)}/messages/${messageId}/move`,
        { method: 'POST', body: JSON.stringify({ destinationId: folderId }) },
      );
    } catch (err: any) {
      this.logger.warn(`portal-mail archive ${messageId}: ${err?.message || err}`);
    }
  }

  private async ensureProcessedFolder(token: string): Promise<string> {
    const name = 'WE-verarbeitet';
    const list = await this.graph<{ value: Array<{ id: string; displayName: string }> }>(
      token,
      `/users/${encodeURIComponent(this.mailbox)}/mailFolders?$top=50&$select=id,displayName`,
    );
    const existing = (list.value || []).find((f) => f.displayName === name);
    if (existing) return existing.id;
    const created = await this.graph<{ id: string }>(
      token,
      `/users/${encodeURIComponent(this.mailbox)}/mailFolders`,
      { method: 'POST', body: JSON.stringify({ displayName: name }) },
    );
    return created.id;
  }
}
