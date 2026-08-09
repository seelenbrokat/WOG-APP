import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, renameSync } from 'fs';
import { basename, join } from 'path';
import {
  detectEzollDocType,
  extractCc529FieldsFromPdfText,
  matchesFilenameIgnorePrefix,
  parseSoloplanMatchFromFilename,
  parseSoloplanMatchFromLrn,
  type EzollCc529Fields,
  type EzollSoloplanMatch,
} from '@wog/shared';
import { OrganizationsService } from '../organizations/organizations.service';
import { PrismaService } from '../prisma/prisma.service';
import { EzollSoloplanService } from './ezoll-soloplan.service';

/**
 * eZoll-PDF-Inbound:
 * 1) Ignore-Muster → processed/ignored/
 * 2) CC529CC → OrderEzoll (cC529C, mRNATAPI, lRN, tarifnummerATAPI)
 *    Match nur über Auftrag.Sendungsnummer (Dateiname / LRN-Prefix) – nie MRN.
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

    const cc529Enabled = this.config.get('SOLOPLAN_EZOLL_CC529_ENABLED') !== 'false';
    let cc529 = 0;
    let unmatched = 0;
    if (cc529Enabled) {
      const result = this.processCc529Batch(40);
      cc529 = result.processed;
      unmatched = result.unmatched;
    }

    const pending = this.listPendingFiles().length;
    return { ignored, cc529, unmatched, pending, prefixes };
  }

  private processCc529Batch(limit: number) {
    let processed = 0;
    let unmatched = 0;
    const files = this.listPendingFiles()
      .filter((p) => detectEzollDocType(basename(p)) === 'CC529CC')
      .slice(0, limit);

    for (const filePath of files) {
      const fileName = basename(filePath);
      try {
        const text = this.pdfText(filePath);
        const fields = extractCc529FieldsFromPdfText(text);
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
          `CC529 ${this.matchLabel(match)} mRNATAPI=${fields.mrn || '-'} lRN=${fields.lrn || '-'} Tarifanzahl=${fields.totalItems ?? '-'} EUR1=${fields.eur1Number || '-'} ← ${fileName}`,
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

  /**
   * Match-Priorität:
   * 1) Dateiname Sendungsnummer (442397.1_…)
   * 2) LRN-Prefix (442397.1/…)
   * MRN nie als Match.
   */
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
      if (!/\.pdf$/i.test(entry.name)) continue;
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
