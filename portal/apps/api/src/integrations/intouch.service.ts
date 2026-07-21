import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'fs';
import { basename, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { detectTelematicsKind } from './telematics-xml.parser';

const CHANNELS = ['meldungen', 'dokumente'] as const;
export type IntouchChannel = (typeof CHANNELS)[number];

/** Dateien, die TourService / TelematicsService fachlich verarbeiten. */
export function isIntouchTourFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.xml') && lower.includes('tour_');
}

export function isIntouchTelematicsFile(fileName: string): boolean {
  return !!detectTelematicsKind(fileName);
}

/**
 * Intouch-Uploads per SFTP:
 *   inbound/intouch/meldungen  → Tour-XMLs (StdTelematics Tour)
 *   inbound/intouch/dokumente  → Telematics (Status/Locations/POD) + sonstige Receipts
 *
 * Tour-/Telematics-Dateien bleiben im Inbox, bis TourService/TelematicsService sie
 * verarbeitet haben. Intouch archiviert nur Resttypen und katalogisiert processed/.
 */
@Injectable()
export class IntouchService {
  private readonly logger = new Logger(IntouchService.name);
  private rootDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.rootDir = join(sftpInbound, 'intouch');
    for (const ch of CHANNELS) {
      const dir = join(this.rootDir, ch);
      const processed = join(dir, 'processed');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (!existsSync(processed)) mkdirSync(processed, { recursive: true });
    }
  }

  status() {
    return {
      root: 'inbound/intouch',
      channels: CHANNELS.map((ch) => {
        const dir = join(this.rootDir, ch);
        const files = existsSync(dir)
          ? readdirSync(dir).filter((f) => f !== 'processed' && !f.startsWith('.'))
          : [];
        const tourPending = files.filter(isIntouchTourFile).length;
        const telematicsPending = files.filter(isIntouchTelematicsFile).length;
        return {
          channel: ch,
          path: `inbound/intouch/${ch}`,
          pendingFiles: files.length,
          tourPending,
          telematicsPending,
          otherPending: files.length - tourPending - telematicsPending,
          files: files.slice(0, 20),
        };
      }),
    };
  }

  async processInboundDir(organizationId?: string, limit = 200) {
    const org =
      (organizationId
        ? await this.prisma.organization.findUnique({ where: { id: organizationId } })
        : null) ||
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } }));
    if (!org) {
      return {
        processed: 0,
        archivedOther: 0,
        cataloged: 0,
        skippedForImport: 0,
        channels: {} as Record<string, number>,
      };
    }

    const channels: Record<string, number> = { meldungen: 0, dokumente: 0 };
    let archivedOther = 0;
    let skippedForImport = 0;
    let cataloged = 0;

    for (const ch of CHANNELS) {
      const dir = join(this.rootDir, ch);
      const processedDir = join(dir, 'processed');
      if (!existsSync(dir)) continue;
      if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });

      const files = readdirSync(dir)
        .filter((f) => f !== 'processed' && !f.startsWith('.'))
        .sort();

      for (const fileName of files) {
        if (archivedOther >= limit) break;
        const full = join(dir, fileName);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (!st.isFile()) continue;

        // Tour-/Telematics-XMLs nicht „wegarchivieren“ – fachlicher Import übernimmt sie
        if (ch === 'meldungen' && isIntouchTourFile(fileName)) {
          skippedForImport += 1;
          continue;
        }
        if (ch === 'dokumente' && isIntouchTelematicsFile(fileName)) {
          skippedForImport += 1;
          continue;
        }

        try {
          const dest = join(processedDir, `${Date.now()}_${fileName}`);
          renameSync(full, dest);
          await this.prisma.intouchFile.create({
            data: {
              organizationId: org.id,
              channel: ch,
              fileName,
              storagePath: dest,
              sizeBytes: st.size,
              status: 'ARCHIVED',
              note: 'Kein Tour/Telematics-Parser – nur archiviert',
            },
          });
          channels[ch] += 1;
          archivedOther += 1;
        } catch (err: any) {
          this.logger.error(`Intouch archive failed ${ch}/${fileName}`, err?.message || err);
        }
      }

      // Katalog: Dateien, die Tour/Telematics bereits nach processed/ verschoben haben
      cataloged += await this.catalogProcessed(org.id, ch, processedDir, limit);
    }

    if (archivedOther || cataloged) {
      this.logger.log(
        `Intouch: ${archivedOther} sonstige archiviert, ${cataloged} katalogisiert, ${skippedForImport} warten auf Import`,
      );
    }

    return {
      processed: archivedOther + cataloged,
      archivedOther,
      cataloged,
      skippedForImport,
      channels,
    };
  }

  /** IntouchFile-Einträge für bereits fachlich verarbeitete Dateien nachziehen. */
  private async catalogProcessed(
    organizationId: string,
    channel: IntouchChannel,
    processedDir: string,
    limit: number,
  ): Promise<number> {
    if (!existsSync(processedDir)) return 0;
    let count = 0;
    const files = readdirSync(processedDir)
      .filter((f) => !f.startsWith('.'))
      .sort()
      .reverse(); // neueste zuerst

    for (const storedName of files) {
      if (count >= limit) break;
      const full = join(processedDir, storedName);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;

      const existing = await this.prisma.intouchFile.findFirst({
        where: { organizationId, storagePath: full },
        select: { id: true },
      });
      if (existing) continue;

      const originalName = stripTimestampPrefix(storedName);
      await this.prisma.intouchFile.create({
        data: {
          organizationId,
          channel,
          fileName: originalName,
          storagePath: full,
          sizeBytes: st.size,
          status: 'PROCESSED',
          note: 'Fachlich importiert (Tour/Telematics)',
        },
      });
      count += 1;
    }
    return count;
  }

  list(user: AuthUser, channel?: string) {
    return this.prisma.intouchFile.findMany({
      where: {
        organizationId: user.organizationId,
        ...(channel ? { channel } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

/** `1784660644560_original.xml` → `original.xml` */
function stripTimestampPrefix(fileName: string): string {
  const base = basename(fileName);
  const m = base.match(/^\d{10,}_(.+)$/);
  return m ? m[1] : base;
}
