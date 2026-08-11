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
import { detectEzollDocType, type EzollDocType } from '@wog/shared';

/** Dokumente, die an SmartBorder pdf-ingest gehen. */
const SMARTBORDER_DOC_TYPES = new Set<EzollDocType>(['CCATBT02BC', 'CCATBT12BC']);

export type EzollSmartborderIngestResult = {
  processed: number;
  failed: number;
  skipped: number;
  files: string[];
};

/**
 * eZoll CCATBT-PDFs → SmartBorder pdf-ingest:
 * - CCATBT02BC Grenzzollstellen-Eingangsschein (Korridor) – Warenort aus PDF
 * - CCATBT12BC Transit-Eingangsschein – warenortId (Default hohenems-schwefelbad)
 */
@Injectable()
export class EzollSmartborderService {
  private readonly log = new Logger(EzollSmartborderService.name);
  private readonly inboundRoot: string;
  private readonly enabled: boolean;
  private readonly apiBase: string;
  private readonly ingestKey: string;
  private readonly defaultWarenortId: string;

  constructor(private config: ConfigService) {
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
      return { processed: 0, failed: 0, skipped: 0, files: [] };
    }

    const pending = this.listPendingSmartborderPdfs().slice(0, limit);
    let processed = 0;
    let failed = 0;
    const files: string[] = [];

    for (const filePath of pending) {
      const fileName = basename(filePath);
      const docType = detectEzollDocType(fileName);
      try {
        const result = await this.ingestPdf(filePath, docType);
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
        this.move(
          filePath,
          join(this.inboundRoot, 'processed', 'smartborder', `${Date.now()}_${fileName}`),
        );
        this.log.log(
          `SmartBorder ← ${fileName} (${docType}` +
            (result.corridorType ? ` / ${result.corridorType}` : '') +
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

    return { processed, failed, skipped: 0, files };
  }

  private async ingestPdf(
    filePath: string,
    docType: EzollDocType,
  ): Promise<{ ok: boolean; error?: string; token?: string; corridorType?: string }> {
    const fileName = basename(filePath);
    const buf = readFileSync(filePath);
    const form = new FormData();
    form.append(
      'pdf',
      new Blob([new Uint8Array(buf)], { type: 'application/pdf' }),
      fileName,
    );
    form.append('action', 'create');

    // Transit: Warenort manuell; Korridor/GZES: aus PDF, kein warenortId
    if (docType === 'CCATBT12BC') {
      form.append('warenortId', this.defaultWarenortId);
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
      corridorType:
        typeof body?.corridorType === 'string' ? body.corridorType : undefined,
    };
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
