import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';

/** Einfacher CSV-Parser (BOM, Anführungszeichen, "" Escapes). */
export function parseCsv(content: string): { headers: string[]; rows: Record<string, string>[] } {
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',' || ch === ';') {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };

  const headers = parseLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] ?? '';
    });
    return row;
  });
  return { headers, rows };
}

function cell(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim()) return String(row[k]).trim();
    const hit = Object.keys(row).find((h) => h.toLowerCase() === k.toLowerCase());
    if (hit && String(row[hit]).trim()) return String(row[hit]).trim();
  }
  return '';
}

/** Header-Teiltreffer (UI kürzt z. B. „LM-Buchungen erzeuge“). */
function cellIncludes(row: Record<string, string>, ...needles: string[]): string {
  for (const needle of needles) {
    const n = needle.toLowerCase();
    const hit = Object.keys(row).find((h) => h.toLowerCase().includes(n));
    if (hit && String(row[hit]).trim()) return String(row[hit]).trim();
  }
  return '';
}

/** Soloplan Ja/Nein → boolean; null wenn Spalte fehlt/unlesbar. */
export function parseSoloplanJaNein(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (['ja', 'yes', 'true', '1', 'j'].includes(v)) return true;
  if (['nein', 'no', 'false', '0', 'n'].includes(v)) return false;
  return null;
}

@Injectable()
export class MasterDataService {
  private readonly logger = new Logger(MasterDataService.name);
  private inboundDirs: string[];

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.inboundDirs = [
      join(sftpInbound, 'soloplan', 'business-partners'),
      join(sftpInbound, 'soloplan', 'master-data'),
      join(process.cwd(), '../../data/integrations/soloplan/master-data/in'),
    ];
  }

  async processInboundDir(organizationId?: string) {
    const org =
      (organizationId
        ? await this.prisma.organization.findUnique({ where: { id: organizationId } })
        : null) ||
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } }));
    if (!org) return { processed: 0, packaging: 0, documentCategories: 0 };

    let processed = 0;
    let packaging = 0;
    let documentCategories = 0;

    for (const dir of this.inboundDirs) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.csv'));
      const processedDir = join(dir, 'processed');
      if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });

      for (const fileName of files) {
        const lower = fileName.toLowerCase();
        const full = join(dir, fileName);
        try {
          const raw = readFileSync(full, 'utf8');
          if (/verpackung/.test(lower)) {
            const n = await this.importPackagingCsv(org.id, raw);
            packaging += n;
            processed += 1;
            this.logger.log(`Verpackung import ${fileName}: ${n} Datensätze`);
          } else if (/dokumentenkategor/.test(lower)) {
            const n = await this.importDocumentCategoryCsv(org.id, raw);
            documentCategories += n;
            processed += 1;
            this.logger.log(`Dokumentenkategorien import ${fileName}: ${n} Datensätze`);
          } else {
            continue;
          }
          renameSync(full, join(processedDir, `${Date.now()}_${fileName}`));
        } catch (err: any) {
          this.logger.error(`Master-data import failed ${fileName}`, err?.message || err);
        }
      }
    }

    return { processed, packaging, documentCategories };
  }

  async importPackagingCsv(organizationId: string, content: string) {
    const { rows } = parseCsv(content);
    let count = 0;
    for (const row of rows) {
      const numberRaw = cell(row, 'Nummer', 'Number', 'Nr');
      const matchcode = cell(row, 'Matchcode', 'Code');
      const label = cell(row, 'Bezeichnung', 'Name', 'Label') || matchcode;
      if (!numberRaw || !matchcode) continue;
      const soloplanNumber = Number(numberRaw);
      if (!Number.isFinite(soloplanNumber)) continue;

      const createBookingsRaw =
        cell(
          row,
          'LM-Buchungen erzeugen',
          'LM-Buchungen erzeuge',
          'CreateLoadingUnitBookings',
          'Create bookings',
        ) || cellIncludes(row, 'lm-buchungen', 'buchungen erzeug');
      const createBookingsParsed = parseSoloplanJaNein(createBookingsRaw);
      // Ohne Spalte: Default true (bestehende Exporte); Nein typen müssen explizit Nein sein
      const createBookings = createBookingsParsed ?? true;

      await this.prisma.packagingType.upsert({
        where: {
          organizationId_soloplanNumber: { organizationId, soloplanNumber },
        },
        create: {
          organizationId,
          soloplanNumber,
          matchcode,
          label,
          content: cell(row, 'Inhalt', 'Content') || null,
          article: cell(row, 'Artikel', 'Article') || null,
          active: true,
          createBookings,
        },
        update: {
          matchcode,
          label,
          content: cell(row, 'Inhalt', 'Content') || null,
          article: cell(row, 'Artikel', 'Article') || null,
          active: true,
          createBookings,
        },
      });
      count += 1;
    }
    return count;
  }

  async importDocumentCategoryCsv(organizationId: string, content: string) {
    const { rows } = parseCsv(content);
    let count = 0;
    for (const row of rows) {
      const numberRaw = cell(row, 'Nummer', 'Number', 'Nr');
      const matchcode = cell(row, 'Matchcode', 'Code');
      const label = cell(row, 'Bezeichnung', 'Name', 'Label') || matchcode;
      if (!numberRaw || !matchcode) continue;
      const soloplanNumber = Number(numberRaw);
      if (!Number.isFinite(soloplanNumber)) continue;

      await this.prisma.documentCategory.upsert({
        where: {
          organizationId_soloplanNumber: { organizationId, soloplanNumber },
        },
        create: {
          organizationId,
          soloplanNumber,
          matchcode,
          label,
          description: cell(row, 'Beschreibung', 'Description') || null,
          active: true,
        },
        update: {
          matchcode,
          label,
          description: cell(row, 'Beschreibung', 'Description') || null,
          active: true,
        },
      });
      count += 1;
    }
    return count;
  }

  /** Für Colli-Dropdown: unique Matchcodes, bevorzugte Bezeichnung. */
  async listPackagingTypes(user: AuthUser) {
    const rows = await this.prisma.packagingType.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: [{ label: 'asc' }, { soloplanNumber: 'asc' }],
    });

    const byCode = new Map<string, (typeof rows)[0]>();
    for (const row of rows) {
      const key = row.matchcode.toUpperCase();
      const existing = byCode.get(key);
      if (!existing) {
        byCode.set(key, row);
        continue;
      }
      // Bei doppeltem Matchcode (z. B. EUP): sprechendere Bezeichnung bevorzugen
      if (row.label.length > existing.label.length) byCode.set(key, row);
    }

    return [...byCode.values()]
      .sort((a, b) => a.label.localeCompare(b.label, 'de'))
      .map((r) => ({
        code: r.matchcode,
        label: r.label,
        soloplanNumber: r.soloplanNumber,
        content: r.content,
        article: r.article,
        createBookings: r.createBookings,
      }));
  }

  listDocumentCategories(user: AuthUser) {
    return this.prisma.documentCategory.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: [{ label: 'asc' }, { soloplanNumber: 'asc' }],
      select: {
        id: true,
        soloplanNumber: true,
        matchcode: true,
        label: true,
        description: true,
      },
    });
  }
}
