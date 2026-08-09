import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { basename, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { isBord512Content, parseBord512 } from './fortras/bord512.parser';
import { transformBord512ToSoloplan } from './fortras/bord512-to-soloplan';

export type PartnerOrderInboundFormat = 'BORD512' | 'AUTO';

/**
 * Inbound für Kunden-/Partner-Auftragsdateien (z. B. Quehenberger FORTRAS BORD512).
 *
 * Nur aktiv, wenn am Kunden/Partner `sftpInboundEnabled` freigeschaltet ist.
 * Ordner: {SFTP_INBOUND}/partner-orders/{sftpUsername}/
 * Ergebnis: Soloplan OrderImportPORTAL-v6 JSON → outbound/soloplan/orders/
 */
@Injectable()
export class PartnerOrdersInboundService {
  private readonly log = new Logger(PartnerOrdersInboundService.name);
  private readonly inboundRoot: string;
  private readonly ordersOutDir: string;
  private readonly integrationOrdersOutDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.inboundRoot = join(sftpInbound, 'partner-orders');
    const sftpOutbound =
      this.config.get('SFTP_OUTBOUND_DIR') || join(process.cwd(), '../../data/sftp/outbound');
    this.ordersOutDir =
      this.config.get('SOLOPLAN_ORDERS_OUT_DIR') || join(sftpOutbound, 'soloplan', 'orders');
    const integrationBase =
      this.config.get('INTEGRATION_DIR') || join(process.cwd(), '../../data/integrations');
    this.integrationOrdersOutDir = join(integrationBase, 'soloplan', 'orders', 'out');
    for (const dir of [
      this.inboundRoot,
      this.ordersOutDir,
      this.integrationOrdersOutDir,
    ]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  /** Relativer Drop-Pfad für einen SFTP-User */
  dropDirForUsername(username: string): string {
    return join(this.inboundRoot, username);
  }

  ensureDropDirs(username: string) {
    const root = this.dropDirForUsername(username);
    for (const dir of [root, join(root, 'processed'), join(root, 'failed')]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    return root;
  }

  async processInboundDir(limit = 40): Promise<{
    processed: number;
    failed: number;
    skipped: number;
    files: string[];
  }> {
    const sources = await this.listEnabledSources();
    let processed = 0;
    let failed = 0;
    let skipped = 0;
    const files: string[] = [];

    for (const src of sources) {
      const drop = this.ensureDropDirs(src.username);
      const pending = this.listPendingFiles(drop).slice(0, Math.max(0, limit - processed - failed));
      for (const filePath of pending) {
        const fileName = basename(filePath);
        try {
          const result = await this.ingestFile(filePath, src);
          if (result === 'skipped') {
            skipped += 1;
          } else {
            processed += 1;
            for (const name of result.outFileName.split(',').map((s) => s.trim()).filter(Boolean)) {
              files.push(name);
            }
            this.move(filePath, join(drop, 'processed', `${Date.now()}_${fileName}`));
          }
        } catch (e: any) {
          failed += 1;
          this.log.warn(
            `Partner-Order ${src.username}/${fileName}: ${e?.message || e}`,
          );
          this.move(filePath, join(drop, 'failed', `${Date.now()}_${fileName}`));
        }
      }
    }

    return { processed, failed, skipped, files };
  }

  /**
   * Datei manuell transformieren (Admin-Test / API).
   * Schreibt optional nach Soloplan-Outbound.
   */
  transformBuffer(
    content: Buffer | string,
    opts: {
      sourceFileName?: string;
      freightPayer?: {
        number?: string | null;
        matchcode?: string | null;
        name?: string | null;
        phone?: string | null;
        vatId?: string | null;
      };
      writeOutbound?: boolean;
      format?: PartnerOrderInboundFormat;
    } = {},
  ) {
    const format = opts.format || 'AUTO';
    if (format === 'BORD512' || (format === 'AUTO' && isBord512Content(content))) {
      const { bordero, files } = transformBord512ToSoloplan(content, {
        freightPayer: opts.freightPayer,
        sourceFileName: opts.sourceFileName,
      });
      if (opts.writeOutbound) {
        for (const file of files) {
          this.writeOutboundOrderFile(file.fileName, JSON.stringify(file.soloplan, null, 2));
        }
      }
      return {
        format: 'BORD512' as const,
        borderoNumber: bordero.borderoNumber,
        consignmentCount: bordero.consignments.length,
        orderCount: files.length,
        fileNames: files.map((f) => f.fileName),
        /** Erste Order-Datei (Kompatibilität) */
        fileName: files[0]?.fileName,
        soloplan: files[0]?.soloplan,
        orders: files.map((f) => ({
          fileName: f.fileName,
          consignmentNumber: f.consignmentNumber,
          borderoPosition: f.borderoPosition,
          soloplan: f.soloplan,
        })),
        summary: bordero.consignments.map((c) => ({
          position: c.borderoPosition,
          number: c.consignmentNumber,
          weightKg: c.weightKg,
          packages: c.positions.reduce((s, p) => s + (p.quantity || 0), 0),
          shipper: c.shipper?.name1,
          consignee: c.consignee?.name1,
        })),
      };
    }
    throw new Error('Unbekanntes Format – erwartet FORTRAS BORD512 (@@PHBORD512)');
  }

  private async listEnabledSources(): Promise<
    Array<{
      kind: 'CUSTOMER' | 'PARTNER';
      id: string;
      username: string;
      format: PartnerOrderInboundFormat;
      freightPayer: {
        number?: string | null;
        matchcode?: string | null;
        name?: string | null;
        phone?: string | null;
        vatId?: string | null;
      };
    }>
  > {
    const customers = await this.prisma.customer.findMany({
      where: { sftpInboundEnabled: true, active: true, sftpUsername: { not: null } },
      select: {
        id: true,
        name: true,
        phone: true,
        vatId: true,
        matchcode: true,
        customerNumber: true,
        soloplanBusinessPartnerId: true,
        sftpUsername: true,
        sftpInboundFormat: true,
      },
    });
    const partners = await this.prisma.partner.findMany({
      where: { sftpInboundEnabled: true, active: true, sftpUsername: { not: null } },
      select: {
        id: true,
        name: true,
        phone: true,
        matchcode: true,
        code: true,
        soloplanBusinessPartnerId: true,
        sftpUsername: true,
        sftpInboundFormat: true,
      },
    });

    return [
      ...customers
        .filter((c) => c.sftpUsername)
        .map((c) => ({
          kind: 'CUSTOMER' as const,
          id: c.id,
          username: String(c.sftpUsername),
          format: (c.sftpInboundFormat || 'AUTO') as PartnerOrderInboundFormat,
          freightPayer: {
            number: c.soloplanBusinessPartnerId || c.customerNumber,
            matchcode: c.matchcode,
            name: c.name,
            phone: c.phone,
            vatId: c.vatId,
          },
        })),
      ...partners
        .filter((p) => p.sftpUsername)
        .map((p) => ({
          kind: 'PARTNER' as const,
          id: p.id,
          username: String(p.sftpUsername),
          format: (p.sftpInboundFormat || 'AUTO') as PartnerOrderInboundFormat,
          freightPayer: {
            number: p.soloplanBusinessPartnerId || p.code,
            matchcode: p.matchcode,
            name: p.name,
            phone: p.phone,
            vatId: null,
          },
        })),
    ];
  }

  private listPendingFiles(dropDir: string): string[] {
    if (!existsSync(dropDir)) return [];
    return readdirSync(dropDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((n) => !n.startsWith('.'))
      .filter((n) => {
        const lower = n.toLowerCase();
        // Quehenberger u. a. nutzen oft Endungen wie .100 / .dat / ohne Ext.
        if (/\.(json|xml|pdf|png|jpe?g|zip|gz)$/i.test(lower)) return false;
        return true;
      })
      .sort()
      .map((n) => join(dropDir, n));
  }

  private async ingestFile(
    filePath: string,
    src: Awaited<ReturnType<PartnerOrdersInboundService['listEnabledSources']>>[number],
  ): Promise<'skipped' | { outFileName: string }> {
    const fileName = basename(filePath);
    const content = readFileSync(filePath);
    if (!content.length) return 'skipped';

    const format =
      src.format === 'BORD512' || (src.format === 'AUTO' && isBord512Content(content))
        ? 'BORD512'
        : src.format;

    if (format !== 'BORD512') {
      throw new Error(`Format ${src.format} für ${src.username} nicht unterstützt`);
    }

    // Je Sendung ein Auftrag – bestehende Outbound-Dateien einzeln überspringen
    const { files } = transformBord512ToSoloplan(content, {
      sourceFileName: fileName,
      freightPayer: src.freightPayer,
    });
    const pending = files.filter((f) => !existsSync(join(this.ordersOutDir, f.fileName)));
    if (!pending.length) {
      this.log.log(
        `Übersprungen (alle ${files.length} Aufträge bereits outbound): ${fileName}`,
      );
      return 'skipped';
    }

    for (const file of pending) {
      this.writeOutboundOrderFile(file.fileName, JSON.stringify(file.soloplan, null, 2));
    }

    const bordero = parseBord512(content, fileName);
    this.log.log(
      `${src.kind} ${src.username}: BORD512 ${bordero.borderoNumber} → ${pending.length}/${files.length} Aufträge (je Sendung)`,
    );
    return { outFileName: pending.map((f) => f.fileName).join(', ') };
  }

  private writeOutboundOrderFile(fileName: string, json: string) {
    const primary = join(this.ordersOutDir, fileName);
    const mirror = join(this.integrationOrdersOutDir, fileName);
    mkdirSync(this.ordersOutDir, { recursive: true });
    mkdirSync(this.integrationOrdersOutDir, { recursive: true });
    writeFileSync(primary, json);
    writeFileSync(mirror, json);
    const uid = Number(this.config.get('SOLOPLAN_SFTP_UID') || 997);
    const gid = Number(this.config.get('SOLOPLAN_SFTP_GID') || 986);
    for (const p of [primary, mirror]) {
      try {
        chmodSync(p, 0o664);
        chownSync(p, uid, gid);
      } catch {
        /* lokal ohne Soloplan-User ok */
      }
    }
  }

  private move(from: string, to: string) {
    try {
      mkdirSync(join(to, '..'), { recursive: true });
      renameSync(from, to);
    } catch (e: any) {
      this.log.warn(`Move failed ${from} → ${to}: ${e?.message || e}`);
    }
  }
}
