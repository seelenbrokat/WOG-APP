import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'fs';
import { basename, join } from 'path';
import {
  detectEzollDocType,
  extractCc529FieldsFromPdfText,
  extractCc529FieldsFromXml,
  extractEz92xFieldsFromXml,
  isCc529Xml,
  matchesFilenameIgnorePrefix,
  parseSoloplanMatchFromFilename,
  parseSoloplanMatchFromLrn,
  soloplanMatchKey,
  type EzollCc529Fields,
  type EzollSoloplanMatch,
} from '@wog/shared';
import { OrganizationsService } from '../organizations/organizations.service';
import { PrismaService } from '../prisma/prisma.service';
import { EzollSoloplanService } from './ezoll-soloplan.service';

/**
 * eZoll-Inbound (PDF + XML):
 * 1) Ignore-Muster → processed/ignored/
 * 2) CC529C(C) → OrderEzoll (bestätigte Felder), XML primär
 * 3) EZ922/EZ923 XML → eZ922/eZ923, CRN→mRNATAPI, MwSt→mWSTAT, Zoll→zollabgabenAT
 * Match nur über Auftrag.Sendungsnummer – nie MRN/CRN.
 */
@Injectable()
export class EzollInboundService {
  private readonly log = new Logger(EzollInboundService.name);
  private readonly inboundRoot: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private organizations: OrganizationsService,
    private ezollSoloplan: EzollSoloplanService,
  ) {
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.inboundRoot = join(sftpInbound, 'Ezoll-Dokumente');
    for (const dir of [
      this.inboundRoot,
      join(this.inboundRoot, 'processed'),
      join(this.inboundRoot, 'processed', 'ignored'),
      join(this.inboundRoot, 'processed', 'cc529'),
      join(this.inboundRoot, 'processed', 'ez92x'),
      join(this.inboundRoot, 'failed'),
      join(this.inboundRoot, 'failed', 'unmatched'),
    ]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  async processInboundDir(organizationId?: string) {
    const orgId = organizationId || (await this.resolveDefaultOrganizationId());
    if (!orgId) {
      return {
        ignored: 0,
        cc529: 0,
        ez92x: 0,
        unmatched: 0,
        pending: 0,
        prefixes: [] as string[],
      };
    }

    const prefixes = await this.organizations.getEzollFilenameIgnorePrefixes(orgId);
    let ignored = 0;
    for (const filePath of this.listPendingFiles()) {
      const fileName = basename(filePath);
      if (!matchesFilenameIgnorePrefix(fileName, prefixes)) continue;
      this.move(
        filePath,
        join(this.inboundRoot, 'processed', 'ignored', `${Date.now()}_${fileName}`),
      );
      ignored += 1;
      this.log.log(`eZoll ignoriert (${prefixes.join(', ')}): ${fileName}`);
    }

    const enabled = this.config.get('SOLOPLAN_EZOLL_CC529_ENABLED') !== 'false';
    let cc529 = 0;
    let ez92x = 0;
    let unmatched = 0;
    if (enabled) {
      const a = this.processCc529Batch(40);
      cc529 = a.processed;
      unmatched += a.unmatched;
      const b = this.processEz92xBatch(40);
      ez92x = b.processed;
      unmatched += b.unmatched;
    }

    const pending = this.listPendingFiles().length;
    return { ignored, cc529, ez92x, unmatched, pending, prefixes };
  }

  private processCc529Batch(limit: number) {
    let processed = 0;
    let unmatched = 0;
    const pending = this.listPendingFiles().filter(
      (p) => detectEzollDocType(basename(p)) === 'CC529CC',
    );

    const xmlFiles = pending.filter((p) => /\.xml$/i.test(p));
    const pdfFiles = pending.filter((p) => /\.pdf$/i.test(p));
    const xmlKeys = new Set<string>();
    for (const p of xmlFiles) {
      const key = soloplanMatchKey(parseSoloplanMatchFromFilename(basename(p)));
      if (key) xmlKeys.add(key);
    }

    const queue = [
      ...xmlFiles,
      ...pdfFiles.filter((p) => {
        const key = soloplanMatchKey(parseSoloplanMatchFromFilename(basename(p)));
        return !key || !xmlKeys.has(key);
      }),
    ].slice(0, limit);

    for (const filePath of queue) {
      const fileName = basename(filePath);
      const isXml = /\.xml$/i.test(fileName);
      try {
        const fields = isXml
          ? this.fieldsFromCc529Xml(filePath, fileName)
          : extractCc529FieldsFromPdfText(this.pdfText(filePath));
        if (!fields) {
          unmatched += 1;
          this.move(
            filePath,
            join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
          );
          this.log.warn(`CC529 kein gültiges CC529C: ${fileName}`);
          continue;
        }

        const match = this.resolveMatch(fileName, fields);
        if (!match || match.kind === 'tour') {
          unmatched += 1;
          this.move(
            filePath,
            join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
          );
          this.log.warn(`CC529 ohne Auftrag/Sendung: ${fileName}`);
          continue;
        }
        this.ezollSoloplan.writeCc529FlagUpdate(match, fileName, fields);
        this.move(
          filePath,
          join(this.inboundRoot, 'processed', 'cc529', `${Date.now()}_${fileName}`),
        );
        processed += 1;
        this.log.log(
          `CC529 ${this.matchLabel(match)} [${isXml ? 'XML' : 'PDF'}] mRNATAPI=${fields.mrn || '-'} lRN=${fields.lrn || '-'} Tarifanzahl=${fields.totalItems ?? '-'} EUR1=${fields.eur1Number || '-'} ← ${fileName}`,
        );
      } catch (e: any) {
        unmatched += 1;
        this.log.warn(`CC529 ${fileName}: ${e?.message || e}`);
        this.move(
          filePath,
          join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
        );
      }
    }
    return { processed, unmatched };
  }

  private processEz92xBatch(limit: number) {
    let processed = 0;
    let unmatched = 0;
    const files = this.listPendingFiles()
      .filter((p) => {
        const t = detectEzollDocType(basename(p));
        return (t === 'EZ922' || t === 'EZ923') && /\.xml$/i.test(p);
      })
      .slice(0, limit);

    for (const filePath of files) {
      const fileName = basename(filePath);
      try {
        const xml = readFileSync(filePath, 'utf8');
        const fields = extractEz92xFieldsFromXml(xml);
        if (!fields) {
          unmatched += 1;
          this.move(
            filePath,
            join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
          );
          this.log.warn(`EZ92x kein gültiges MsgTyp: ${fileName}`);
          continue;
        }

        const match = parseSoloplanMatchFromFilename(fileName);
        if (!match || match.kind === 'tour') {
          unmatched += 1;
          this.move(
            filePath,
            join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
          );
          this.log.warn(`${fields.msgTyp} ohne Auftrag/Sendung: ${fileName}`);
          continue;
        }

        this.ezollSoloplan.writeEz92xUpdate(match, fileName, fields);
        this.move(
          filePath,
          join(this.inboundRoot, 'processed', 'ez92x', `${Date.now()}_${fileName}`),
        );
        processed += 1;
        this.log.log(
          `${fields.msgTyp} ${this.matchLabel(match)} CRN=${fields.crn || '-'} Konto=${fields.abgabenkonto || '-'} MWST=${fields.mwstAt ?? '-'} Zoll=${fields.zollabgabenAt ?? '-'} ← ${fileName}`,
        );
      } catch (e: any) {
        unmatched += 1;
        this.log.warn(`EZ92x ${fileName}: ${e?.message || e}`);
        this.move(
          filePath,
          join(this.inboundRoot, 'failed', 'unmatched', `${Date.now()}_${fileName}`),
        );
      }
    }
    return { processed, unmatched };
  }

  private fieldsFromCc529Xml(filePath: string, fileName: string): EzollCc529Fields | null {
    const xml = readFileSync(filePath, 'utf8');
    if (!isCc529Xml(xml) && detectEzollDocType(fileName) !== 'CC529CC') {
      return null;
    }
    if (!isCc529Xml(xml)) {
      this.log.warn(`XML ohne CC529C-MsgTyp, Dateiname sagt CC529: ${fileName}`);
    }
    return extractCc529FieldsFromXml(xml);
  }

  private resolveMatch(
    fileName: string,
    fields: EzollCc529Fields,
  ): EzollSoloplanMatch | null {
    const fromName = parseSoloplanMatchFromFilename(fileName);
    if (fromName && (fromName.kind === 'orderConsignment' || fromName.kind === 'order')) {
      return fromName;
    }
    if (fields.lrn) {
      const fromLrn = parseSoloplanMatchFromLrn(fields.lrn);
      if (fromLrn) return fromLrn;
    }
    return fromName;
  }

  private pdfText(filePath: string): string {
    try {
      return execFileSync('pdftotext', ['-layout', filePath, '-'], {
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
        timeout: 15_000,
      });
    } catch {
      try {
        return execFileSync('pdftotext', [filePath, '-'], {
          encoding: 'utf8',
          maxBuffer: 2 * 1024 * 1024,
          timeout: 15_000,
        });
      } catch {
        return '';
      }
    }
  }

  private matchLabel(match: EzollSoloplanMatch): string {
    if (match.kind === 'orderConsignment') {
      return `${match.orderNumber}.${match.consignmentIndex}`;
    }
    if (match.kind === 'order') return String(match.orderNumber);
    return `Tour ${match.tourNumber}`;
  }

  private async resolveDefaultOrganizationId(): Promise<string | undefined> {
    const org = await this.prisma.organization.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return org?.id;
  }

  private listPendingFiles(): string[] {
    if (!existsSync(this.inboundRoot)) return [];
    const skip = new Set(['processed', 'failed', '.cache']);
    const out: string[] = [];
    for (const entry of readdirSync(this.inboundRoot, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (skip.has(entry.name)) continue;
      if (entry.name === 'README.txt') continue;
      if (!/\.(pdf|xml)$/i.test(entry.name)) continue;
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
