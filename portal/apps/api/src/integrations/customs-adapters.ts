import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CustomsExchangePayload, CustomsSystemAdapter } from './exchange.types';

function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

/**
 * Datei-/Stub-Adapter für Zollsysteme.
 * Wenn LDV_/MERCURIO_/SOLOPLAN_ REST-URLs gesetzt sind, wird REST versucht,
 * sonst File-Drop unter data/integrations/{system}/out|in.
 */
@Injectable()
export class LdvAdapter implements CustomsSystemAdapter {
  readonly system = 'LDV' as const;
  private readonly logger = new Logger(LdvAdapter.name);
  private outDir: string;
  private inDir: string;

  constructor(private config: ConfigService) {
    const base =
      this.config.get('INTEGRATION_DIR') ||
      join(process.cwd(), '../../data/integrations');
    this.outDir = join(base, 'ldv', 'out');
    this.inDir = join(base, 'ldv', 'in');
    ensureDir(this.outDir);
    ensureDir(this.inDir);
  }

  async send(payload: CustomsExchangePayload) {
    const mode = this.config.get('LDV_MODE') || 'file';
    const enabled = this.config.get('LDV_ENABLED') === 'true';
    if (!enabled || mode === 'stub') {
      this.logger.log(`LDV stub send ${payload.reference}`);
      return { ok: true, message: 'LDV stub akzeptiert', response: { stub: true } };
    }
    if (mode === 'rest' && this.config.get('LDV_BASE_URL')) {
      const res = await fetch(`${this.config.get('LDV_BASE_URL')}/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.get('LDV_API_KEY') || ''}`,
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, response: body, message: res.ok ? 'LDV REST OK' : `LDV HTTP ${res.status}` };
    }
    const fileName = `ldv-${payload.reference}-${Date.now()}.json`;
    writeFileSync(join(this.outDir, fileName), JSON.stringify(payload, null, 2));
    return { ok: true, fileName, message: `LDV file export ${fileName}` };
  }

  async receiveInbound() {
    return readJsonInbox(this.inDir, 'LDV', this.logger);
  }
}

@Injectable()
export class MercurioAdapter implements CustomsSystemAdapter {
  readonly system = 'MERCURIO' as const;
  private readonly logger = new Logger(MercurioAdapter.name);
  private outDir: string;
  private inDir: string;

  constructor(private config: ConfigService) {
    const base =
      this.config.get('INTEGRATION_DIR') ||
      join(process.cwd(), '../../data/integrations');
    this.outDir = join(base, 'mercurio', 'out');
    this.inDir = join(base, 'mercurio', 'in');
    ensureDir(this.outDir);
    ensureDir(this.inDir);
  }

  async send(payload: CustomsExchangePayload) {
    const mode = this.config.get('MERCURIO_MODE') || 'file';
    const enabled = this.config.get('MERCURIO_ENABLED') === 'true';
    if (!enabled || mode === 'stub') {
      this.logger.log(`Mercurio stub send ${payload.reference}`);
      return { ok: true, message: 'Mercurio stub akzeptiert', response: { stub: true } };
    }
    if (mode === 'rest' && this.config.get('MERCURIO_BASE_URL')) {
      const res = await fetch(`${this.config.get('MERCURIO_BASE_URL')}/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.get('MERCURIO_API_KEY') || ''}`,
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, response: body, message: res.ok ? 'Mercurio REST OK' : `Mercurio HTTP ${res.status}` };
    }
    const fileName = `mercurio-${payload.reference}-${Date.now()}.json`;
    writeFileSync(join(this.outDir, fileName), JSON.stringify(payload, null, 2));
    return { ok: true, fileName, message: `Mercurio file export ${fileName}` };
  }

  async receiveInbound() {
    return readJsonInbox(this.inDir, 'MERCURIO', this.logger);
  }
}

@Injectable()
export class SoloplanCustomsAdapter implements CustomsSystemAdapter {
  readonly system = 'SOLOPLAN' as const;
  private readonly logger = new Logger(SoloplanCustomsAdapter.name);
  private outDir: string;
  private inDir: string;

  constructor(private config: ConfigService) {
    const base =
      this.config.get('INTEGRATION_DIR') ||
      join(process.cwd(), '../../data/integrations');
    this.outDir = join(base, 'soloplan', 'out');
    this.inDir = join(base, 'soloplan', 'in');
    ensureDir(this.outDir);
    ensureDir(this.inDir);
  }

  async send(payload: CustomsExchangePayload) {
    const mode = this.config.get('SOLOPLAN_CUSTOMS_MODE') || this.config.get('SOLOPLAN_MODE') || 'file';
    const enabled =
      this.config.get('SOLOPLAN_CUSTOMS_ENABLED') === 'true' ||
      this.config.get('SOLOPLAN_ENABLED') === 'true';
    if (!enabled || mode === 'stub') {
      this.logger.log(`Soloplan-customs stub send ${payload.reference}`);
      return { ok: true, message: 'Soloplan customs stub akzeptiert', response: { stub: true } };
    }
    if (mode === 'rest' && this.config.get('SOLOPLAN_BASE_URL')) {
      const res = await fetch(`${this.config.get('SOLOPLAN_BASE_URL')}/customs-exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.get('SOLOPLAN_API_KEY') || ''}`,
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, response: body, message: res.ok ? 'Soloplan REST OK' : `Soloplan HTTP ${res.status}` };
    }
    const fileName = `soloplan-customs-${payload.reference}-${Date.now()}.json`;
    writeFileSync(join(this.outDir, fileName), JSON.stringify(payload, null, 2));
    return { ok: true, fileName, message: `Soloplan customs file export ${fileName}` };
  }

  async receiveInbound() {
    return readJsonInbox(this.inDir, 'SOLOPLAN', this.logger);
  }
}

function readJsonInbox(
  inDir: string,
  fallbackSource: 'SOLOPLAN' | 'LDV' | 'MERCURIO',
  logger: Logger,
): CustomsExchangePayload[] {
  ensureDir(inDir);
  const files = readdirSync(inDir).filter((f) => f.endsWith('.json'));
  const items: CustomsExchangePayload[] = [];
  const processed = join(inDir, 'processed');
  ensureDir(processed);

  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(join(inDir, file), 'utf8')) as Partial<CustomsExchangePayload>;
      items.push({
        exchangeVersion: '1.0',
        reference: raw.reference || file.replace(/\.json$/, ''),
        sourceSystem: (raw.sourceSystem || fallbackSource) as CustomsExchangePayload['sourceSystem'],
        targetSystem: (raw.targetSystem || 'SOLOPLAN') as CustomsExchangePayload['targetSystem'],
        kennzeichen: raw.kennzeichen,
        grenzuebergang: raw.grenzuebergang,
        zeit: raw.zeit,
        importeur: raw.importeur,
        customsOrderId: raw.customsOrderId,
        shipmentTrackingNumber: raw.shipmentTrackingNumber,
        shipmentId: raw.shipmentId,
        mandantCode: raw.mandantCode,
        customerNumber: raw.customerNumber,
        status: raw.status,
        notes: raw.notes,
        raw: raw.raw || (raw as Record<string, unknown>),
      });
      renameSync(join(inDir, file), join(processed, file));
    } catch (err) {
      logger.error(`Inbox parse failed ${file}`, err as Error);
    }
  }
  return items;
}
