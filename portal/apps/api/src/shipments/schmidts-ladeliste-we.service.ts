import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
} from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GoodsReceiptService } from './goods-receipt.service';
import { AuthUser } from '../auth/auth.types';
import { ssccMatchCandidates } from '../labels/sscc';
import { extractTextFromPdfBuffer } from './proforma-invoice.parser';
import {
  looksLikeSchmidtsLadeliste,
  parseSchmidtsLadelisteText,
  ParsedSchmidtsLadeliste,
  SchmidtsLadelisteLine,
} from './schmidts-ladeliste.parser';
import { proformaGoodsReceiptDate } from '../common/working-days';

const execFileAsync = promisify(execFile);

const MISSING_MAIL_TO =
  process.env.SCHMIDTS_LADELISTE_MISSING_MAIL_TO ||
  process.env.PROFORMA_MISSING_MAIL_TO ||
  'info@worldofgreen.ch';

/**
 * SCHMIDT'S Ladeliste (PDF) per SFTP → WE-Session für TC57.
 *
 * FTP:
 *   inbound/wareneingang/ladelisten/  ← primär
 *   inbound/wareneingang/listen/      ← ebenfalls (wenn LAK/Schmidts erkannt;
 *                                       Unitec-Entladeliste-Kopien werden übersprungen)
 *
 * LAK… = externe Sendungsnr. → Shipment.reference
 * Match primär über Collonummer/SSCC, sonst Empfänger+Colli+kg.
 */
@Injectable()
export class SchmidtsLadelisteWeService {
  private readonly logger = new Logger(SchmidtsLadelisteWeService.name);
  private readonly inboundDir: string;
  private readonly listenDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private notifications: NotificationsService,
    private goodsReceipt: GoodsReceiptService,
  ) {
    const root =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.inboundDir = join(root, 'wareneingang', 'ladelisten');
    this.listenDir = join(root, 'wareneingang', 'listen');
    for (const d of [
      this.inboundDir,
      join(this.inboundDir, 'processed'),
      join(this.inboundDir, 'failed'),
      this.listenDir,
      join(this.listenDir, 'processed'),
      join(this.listenDir, 'failed'),
    ]) {
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
    }
  }

  status() {
    const countPending = (dir: string) =>
      existsSync(dir) ? readdirSync(dir).filter((f) => /\.(pdf|txt)$/i.test(f)).length : 0;
    return {
      inboundDir: this.inboundDir,
      listenDir: this.listenDir,
      ftpPaths: {
        ladelisten: 'inbound/wareneingang/ladelisten',
        listen: 'inbound/wareneingang/listen',
      },
      missingMailTo: MISSING_MAIL_TO,
      pending: countPending(this.inboundDir) + countPending(this.listenDir),
    };
  }

  async processInboundDir(organizationId?: string) {
    const orgId =
      organizationId ||
      (
        await this.prisma.organization.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
      )?.id;
    if (!orgId) return { processed: 0, failed: 0, results: [] as unknown[] };

    const admin = await this.prisma.user.findFirst({
      where: { organizationId: orgId, role: UserRole.ORG_ADMIN },
      include: { mandantAccess: { select: { mandantId: true } } },
    });
    if (!admin) {
      this.logger.warn('Kein ORG_ADMIN für Schmidts-Ladeliste');
      return { processed: 0, failed: 0, results: [] as unknown[] };
    }
    const authUser = this.toAuthUser(admin);

    const results: unknown[] = [];
    let processed = 0;
    let failed = 0;

    for (const dir of [this.inboundDir, this.listenDir]) {
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => {
        if (!/\.(pdf|txt)$/i.test(f)) return false;
        // Unitec-Entladelisten-Kopien in listen/ nicht als Schmidts werten
        if (/entladeliste/i.test(f)) return false;
        return true;
      });
      for (const fileName of files) {
        const full = join(dir, fileName);
        try {
          // In listen/: nur verarbeiten wenn Inhalt nach Schmidts aussieht
          if (dir === this.listenDir) {
            const preview = await this.readListText(full);
            if (!looksLikeSchmidtsLadeliste(preview)) continue;
          }
          const res = await this.processLadelisteFile(authUser, full, fileName);
          results.push(res);
          renameSync(full, join(dir, 'processed', `${Date.now()}_${fileName}`));
          processed += 1;
        } catch (err: any) {
          failed += 1;
          this.logger.warn(`Schmidts-Ladeliste ${fileName}: ${err?.message || err}`);
          try {
            renameSync(full, join(dir, 'failed', `${Date.now()}_${fileName}`));
          } catch {
            /* ignore */
          }
          results.push({ fileName, ok: false, error: err?.message || String(err) });
        }
      }
    }
    return { processed, failed, results };
  }

  async processLadelisteFile(user: AuthUser, fullPath: string, fileName: string) {
    const text = await this.readListText(fullPath);
    if (!looksLikeSchmidtsLadeliste(text)) {
      throw new Error('Keine SCHMIDT\'S-Ladeliste (LAK…) erkannt');
    }
    const parsed = parseSchmidtsLadelisteText(text);
    if (!parsed.lines.length) {
      throw new Error('Keine LAK-Nummern in der Ladeliste gefunden');
    }

    const customer = await this.resolveCustomer(user.organizationId, parsed);
    const matched: Array<{
      line: SchmidtsLadelisteLine;
      shipmentId: string;
      trackingNumber: string;
      reference: string | null;
      soloplanRef: string | null;
      packageCount: number;
      matchBy: 'sscc' | 'totals';
    }> = [];
    const missing: SchmidtsLadelisteLine[] = [];

    for (const line of parsed.lines) {
      let found = await this.findShipmentForLak(user.organizationId, line, customer?.id);
      let matchBy: 'sscc' | 'totals' = 'sscc';
      if (!found && customer) {
        found = await this.findWeByLineTotals(
          user.organizationId,
          customer.id,
          line,
          matched.map((m) => m.shipmentId),
        );
        matchBy = 'totals';
      }
      if (!found) {
        missing.push(line);
        continue;
      }

      const prevExtras =
        found.extras && typeof found.extras === 'object' && !Array.isArray(found.extras)
          ? (found.extras as Record<string, unknown>)
          : {};
      const prevRef = found.reference?.trim() || null;
      const soloplanWeRef =
        (typeof prevExtras.soloplanWeReference === 'string' && prevExtras.soloplanWeReference) ||
        (prevRef && /^WE-/i.test(prevRef) ? prevRef : null) ||
        (found.soloplanRef ? `WE-${found.soloplanRef}` : null);

      await this.prisma.shipment.update({
        where: { id: found.id },
        data: {
          reference: line.lak,
          extras: {
            ...prevExtras,
            externalShipmentNumber: line.lak,
            ladeliste: parsed.transportNumber || parsed.listDate || fileName,
            ladelisteMatchBy: matchBy,
            ...(soloplanWeRef ? { soloplanWeReference: soloplanWeRef } : {}),
          },
          notes: found.notes?.includes(line.lak)
            ? found.notes
            : [found.notes, `Externe Sendungsnr. ${line.lak}`].filter(Boolean).join('\n'),
        },
      });

      matched.push({
        line,
        shipmentId: found.id,
        trackingNumber: found.trackingNumber,
        reference: line.lak,
        soloplanRef: found.soloplanRef,
        packageCount: found.packageCount || 0,
        matchBy,
      });
    }

    if (missing.length) {
      await this.mailMissing(parsed, missing, fileName);
    }

    // Session: Listen-Datum (WE-Tag) oder nächster Werktag
    const sessionDate = parsed.listDate || proformaGoodsReceiptDate();
    const listKey =
      parsed.transportNumber?.replace(/\//g, '-') ||
      parsed.listDate ||
      `LL-${sessionDate}`;
    const sessionLabel = `WE Schmidts · ${listKey}`;

    let session: Awaited<ReturnType<GoodsReceiptService['openSession']>> | null = null;
    const shipmentIds = [...new Set(matched.map((m) => m.shipmentId))];
    try {
      if (shipmentIds.length && customer) {
        session = await this.goodsReceipt.openSession(user, {
          customerId: customer.id,
          date: sessionDate,
          externalRef: listKey,
          sessionLabel,
          shipmentIds,
        });
      }
    } catch (err: any) {
      this.logger.warn(`WE-Session Schmidts-Ladeliste: ${err?.message || err}`);
    }

    const summary = {
      ok: true,
      fileName,
      listDate: parsed.listDate,
      transportNumber: parsed.transportNumber,
      customer: customer?.name,
      lines: parsed.lines.length,
      matched: matched.length,
      missing: missing.map((m) => m.lak),
      links: matched.map((m) => ({
        lak: m.line.lak,
        soloplanRef: m.soloplanRef,
        reference: m.reference,
        matchBy: m.matchBy,
      })),
      sessionId: session?.id,
      sessionRef: session?.externalRef,
      expectedColli: session?.summary?.expected,
    };
    this.logger.log(
      `Schmidts-Ladeliste ${parsed.transportNumber || fileName}: matched=${matched.length} missing=${missing.length} session=${session?.externalRef || '—'}`,
    );
    return summary;
  }

  private async findShipmentForLak(
    organizationId: string,
    line: SchmidtsLadelisteLine,
    customerId?: string,
  ) {
    const weFilter = {
      OR: [
        { reference: { startsWith: 'WE-' } },
        { reference: { startsWith: 'LAK', mode: 'insensitive' as const } },
        { goodsDescription: { contains: 'Wareneingang', mode: 'insensitive' as const } },
      ],
    };

    // Bereits verknüpft
    const byRef = await this.prisma.shipment.findFirst({
      where: {
        organizationId,
        ...(customerId ? { customerId } : {}),
        AND: [weFilter, { reference: { equals: line.lak, mode: 'insensitive' } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (byRef) return byRef;

    const byExtras = await this.prisma.shipment.findFirst({
      where: {
        organizationId,
        ...(customerId ? { customerId } : {}),
        AND: [weFilter, { extras: { path: ['externalShipmentNumber'], equals: line.lak } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (byExtras) return byExtras;

    // Primär: Collonummer / SSCC aus der Ladeliste
    for (const collo of line.colli) {
      const candidates = ssccMatchCandidates(collo.sscc);
      if (!candidates.length) continue;
      const hit = await this.prisma.shipmentCollo.findFirst({
        where: { sscc: { in: candidates } },
        include: { shipment: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!hit?.shipment) continue;
      if (hit.shipment.organizationId !== organizationId) continue;
      if (customerId && hit.shipment.customerId !== customerId) continue;
      // Nur WE-Sendungen
      const s = hit.shipment;
      const isWe =
        /^WE-/i.test(s.reference || '') ||
        /^LAK/i.test(s.reference || '') ||
        /wareneingang/i.test(s.goodsDescription || '');
      if (!isWe) continue;
      return s;
    }

    // Tour-Sendung mit LAK (TO) → Empfänger-Hinweis, kein direkter WE-Link
    const cons = await this.prisma.tourConsignment.findFirst({
      where: { externalConsignmentNumber: { equals: line.lak, mode: 'insensitive' } },
      orderBy: { id: 'desc' },
    });
    if (cons?.receiverName && customerId) {
      const byReceiver = await this.findWeByLineTotals(
        organizationId,
        customerId,
        { ...line, recipientName: line.recipientName || cons.receiverName },
        [],
      );
      if (byReceiver) return byReceiver;
    }

    return null;
  }

  private async findWeByLineTotals(
    organizationId: string,
    customerId: string,
    line: SchmidtsLadelisteLine,
    excludeIds: string[],
  ) {
    const since = new Date();
    since.setDate(since.getDate() - 5);
    const colli = line.colliCount || line.colli.length || undefined;
    const rows = await this.prisma.shipment.findMany({
      where: {
        organizationId,
        customerId,
        createdAt: { gte: since },
        ...(colli ? { packageCount: colli } : {}),
        ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
        OR: [
          { reference: { startsWith: 'WE-' } },
          { reference: { startsWith: 'LAK', mode: 'insensitive' } },
          { goodsDescription: { contains: 'Wareneingang', mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 80,
    });

    const free = rows.filter((s) => {
      const ex =
        s.extras && typeof s.extras === 'object' && !Array.isArray(s.extras)
          ? (s.extras as Record<string, unknown>)
          : {};
      return !ex.externalShipmentNumber;
    });

    let candidates = free;
    if (line.recipientName) {
      const token = line.recipientName.split(/\s+/).slice(0, 2).join(' ');
      const byName = free.filter(
        (s) =>
          (s.deliveryCompany || '').toLowerCase().includes(token.toLowerCase()) ||
          token.toLowerCase().includes((s.deliveryCompany || '').toLowerCase().slice(0, 8)),
      );
      if (byName.length) candidates = byName;
    }
    if (line.recipientZip) {
      const byZip = candidates.filter((s) => s.deliveryZip === line.recipientZip);
      if (byZip.length) candidates = byZip;
    }
    if (!candidates.length) return null;

    if (line.totalWeightKg == null) return candidates[0];
    const scored = candidates
      .map((s) => {
        const w = s.weightKg != null ? Number(s.weightKg) : null;
        if (w == null) return { s, score: 40 };
        const diff = Math.abs(w - line.totalWeightKg!);
        if (diff > Math.max(15, line.totalWeightKg! * 0.25)) return null;
        return { s, score: diff };
      })
      .filter((x): x is { s: (typeof candidates)[0]; score: number } => !!x)
      .sort((a, b) => a.score - b.score);
    return scored[0]?.s || null;
  }

  private async resolveCustomer(organizationId: string, parsed: ParsedSchmidtsLadeliste) {
    const byNumber = await this.prisma.customer.findFirst({
      where: { organizationId, customerNumber: '3441' },
    });
    if (byNumber) return byNumber;

    return this.prisma.customer.findFirst({
      where: {
        organizationId,
        OR: [
          { name: { contains: 'Schmidt', mode: 'insensitive' } },
          { name: { contains: "SCHMIDT'S", mode: 'insensitive' } },
        ],
      },
    });
  }

  private async mailMissing(
    parsed: ParsedSchmidtsLadeliste,
    missing: SchmidtsLadelisteLine[],
    fileName: string,
  ) {
    const subject = `Schmidts-Ladeliste: ${missing.length} LAK ohne Soloplan-WE · ${parsed.listDate || fileName}`;
    const body = [
      `Bei der Ladeliste konnten nicht alle LAK-Sendungen einem Soloplan-Wareneingang zugeordnet werden.`,
      ``,
      `Datei: ${fileName}`,
      `Listen-Datum: ${parsed.listDate || '–'}`,
      `Transport-Nr.: ${parsed.transportNumber || '–'}`,
      ``,
      `Fehlend:`,
      ...missing.map(
        (m) =>
          `· ${m.lak} · ${m.recipientName || '–'} · Colli ${m.colliCount ?? m.colli.length} · ${m.totalWeightKg ?? '–'} kg · SSCC ${m.colli.map((c) => c.sscc).join(', ') || '–'}`,
      ),
      ``,
      `Bitte WE in Soloplan prüfen / nachliefern.`,
      `WOG Portal`,
    ].join('\n');
    await this.notifications.sendRaw(MISSING_MAIL_TO, subject, body);
  }

  private async readListText(fullPath: string): Promise<string> {
    const lower = fullPath.toLowerCase();
    if (lower.endsWith('.txt')) return readFileSync(fullPath, 'utf8');
    try {
      const { stdout } = await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', fullPath, '-'], {
        timeout: 20_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (stdout && /LAK\d+/i.test(stdout)) return stdout;
      if (stdout?.trim()) return stdout;
    } catch (err: any) {
      this.logger.warn(`pdftotext fehlgeschlagen: ${err?.message || err}`);
    }
    return extractTextFromPdfBuffer(readFileSync(fullPath));
  }

  private toAuthUser(admin: {
    id: string;
    email: string;
    role: UserRole;
    organizationId: string;
    customerId: string | null;
    mandantAccess: { mandantId: string }[];
  }): AuthUser {
    return {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      organizationId: admin.organizationId,
      customerId: admin.customerId,
      mandantIds: admin.mandantAccess.map((m) => m.mandantId),
    };
  }
}
