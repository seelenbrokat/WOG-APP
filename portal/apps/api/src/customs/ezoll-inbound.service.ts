import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readdirSync, renameSync } from 'fs';
import { basename, join } from 'path';
import { matchesFilenameIgnorePrefix } from '@wog/shared';
import { OrganizationsService } from '../organizations/organizations.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * eZoll-PDF-Inbound (Stufe 1): Ignore-Präfixe anwenden und Dateien
 * nach processed/ignored/ verschieben. Analyse/Soloplan folgt später.
 */
@Injectable()
export class EzollInboundService {
  private readonly log = new Logger(EzollInboundService.name);
  private readonly inboundRoot: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private organizations: OrganizationsService,
  ) {
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.inboundRoot = join(sftpInbound, 'Ezoll-Dokumente');
    for (const dir of [
      this.inboundRoot,
      join(this.inboundRoot, 'processed'),
      join(this.inboundRoot, 'processed', 'ignored'),
      join(this.inboundRoot, 'failed'),
    ]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  async processInboundDir(organizationId?: string, limit = 80) {
    const orgId = organizationId || (await this.resolveDefaultOrganizationId());
    if (!orgId) {
      return { ignored: 0, pending: 0, prefixes: [] as string[] };
    }

    const prefixes = await this.organizations.getEzollFilenameIgnorePrefixes(orgId);
    const files = this.listPendingFiles().slice(0, limit);
    let ignored = 0;
    let pending = 0;

    for (const filePath of files) {
      const fileName = basename(filePath);
      if (matchesFilenameIgnorePrefix(fileName, prefixes)) {
        this.move(
          filePath,
          join(this.inboundRoot, 'processed', 'ignored', `${Date.now()}_${fileName}`),
        );
        ignored += 1;
        this.log.log(`eZoll ignoriert (${prefixes.join(', ')}): ${fileName}`);
      } else {
        pending += 1;
      }
    }

    return { ignored, pending, prefixes };
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
