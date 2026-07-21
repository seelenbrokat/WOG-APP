import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';

const CHANNELS = ['meldungen', 'dokumente'] as const;
export type IntouchChannel = (typeof CHANNELS)[number];

/**
 * Intouch-Uploads per SFTP:
 *   inbound/intouch/meldungen
 *   inbound/intouch/dokumente
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
        return {
          channel: ch,
          path: `inbound/intouch/${ch}`,
          pendingFiles: files.length,
          files: files.slice(0, 20),
        };
      }),
    };
  }

  async processInboundDir(organizationId?: string, limit = 100) {
    const org =
      (organizationId
        ? await this.prisma.organization.findUnique({ where: { id: organizationId } })
        : null) ||
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } }));
    if (!org) return { processed: 0, channels: {} as Record<string, number> };

    const channels: Record<string, number> = { meldungen: 0, dokumente: 0 };
    let processed = 0;

    for (const ch of CHANNELS) {
      const dir = join(this.rootDir, ch);
      const processedDir = join(dir, 'processed');
      if (!existsSync(dir)) continue;
      if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });

      const files = readdirSync(dir)
        .filter((f) => f !== 'processed' && !f.startsWith('.'))
        .sort();

      for (const fileName of files) {
        if (processed >= limit) break;
        const full = join(dir, fileName);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (!st.isFile()) continue;

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
              status: 'RECEIVED',
            },
          });
          channels[ch] += 1;
          processed += 1;
        } catch (err: any) {
          this.logger.error(`Intouch import failed ${ch}/${fileName}`, err?.message || err);
        }
      }
    }

    if (processed) this.logger.log(`Intouch: ${processed} Datei(en) übernommen`);
    return { processed, channels };
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
