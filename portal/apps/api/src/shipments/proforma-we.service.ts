import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GoodsReceiptService } from './goods-receipt.service';
import {
  extractTextFromPdfBuffer,
  parseProformaInvoiceText,
  ParsedProformaInvoice,
  ProformaShipmentLine,
} from './proforma-invoice.parser';
import { AuthUser } from '../auth/auth.types';
import { UserRole } from '@prisma/client';

const execFileAsync = promisify(execFile);

const MISSING_SHIPMENT_MAIL_TO =
  process.env.PROFORMA_MISSING_MAIL_TO || 'info@worldofgreen.ch';

/**
 * Proforma-Rechnung (PDF) per SFTP → Wareneingangs-Session für TC57.
 * Fehlende BK-Sendungen → E-Mail an info@worldofgreen.ch.
 */
@Injectable()
export class ProformaWeService {
  private readonly logger = new Logger(ProformaWeService.name);
  private readonly inboundDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private notifications: NotificationsService,
    private goodsReceipt: GoodsReceiptService,
  ) {
    const root =
      this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound');
    this.inboundDir = join(root, 'proforma');
    for (const d of [this.inboundDir, join(this.inboundDir, 'processed'), join(this.inboundDir, 'failed')]) {
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
    }
  }

  status() {
    return {
      inboundDir: this.inboundDir,
      missingMailTo: MISSING_SHIPMENT_MAIL_TO,
      pending: existsSync(this.inboundDir)
        ? readdirSync(this.inboundDir).filter((f) => /\.(pdf|txt)$/i.test(f)).length
        : 0,
    };
  }

  /** Worker: neue Proforma-PDFs verarbeiten. */
  async processInboundDir(organizationId?: string) {
    const orgId =
      organizationId ||
      (
        await this.prisma.organization.findFirst({
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
      )?.id;
    if (!orgId || !existsSync(this.inboundDir)) {
      return { processed: 0, failed: 0, results: [] as unknown[] };
    }

    const files = readdirSync(this.inboundDir).filter((f) => /\.(pdf|txt)$/i.test(f));
    const results: unknown[] = [];
    let processed = 0;
    let failed = 0;

    const admin = await this.prisma.user.findFirst({
      where: { organizationId: orgId, role: UserRole.ORG_ADMIN },
      include: { mandantAccess: { select: { mandantId: true } } },
    });
    if (!admin) {
      this.logger.warn('Kein ORG_ADMIN für Proforma-WE');
      return { processed: 0, failed: files.length, results };
    }
    const authUser = this.toAuthUser(admin);

    for (const fileName of files) {
      const full = join(this.inboundDir, fileName);
      try {
        const res = await this.processProformaFile(authUser, full, fileName);
        results.push(res);
        renameSync(full, join(this.inboundDir, 'processed', `${Date.now()}_${fileName}`));
        processed += 1;
      } catch (err: any) {
        failed += 1;
        this.logger.warn(`Proforma ${fileName}: ${err?.message || err}`);
        try {
          renameSync(full, join(this.inboundDir, 'failed', `${Date.now()}_${fileName}`));
        } catch {
          /* ignore */
        }
        results.push({ fileName, ok: false, error: err?.message || String(err) });
      }
    }
    return { processed, failed, results };
  }

  async processProformaFile(user: AuthUser, fullPath: string, fileName: string) {
    const text = await this.readInvoiceText(fullPath);
    const parsed = parseProformaInvoiceText(text);
    if (!parsed.lines.length) {
      throw new Error('Keine BK-Nummern in der Proforma gefunden');
    }

    const customer = await this.resolveCustomer(user.organizationId, parsed);
    const matched: Array<{
      line: ProformaShipmentLine;
      shipmentId: string;
      trackingNumber: string;
      reference: string | null;
      packageCount: number;
    }> = [];
    const missing: ProformaShipmentLine[] = [];
    let fallbackShipments: Array<{ id: string; reference: string | null }> = [];

    for (const line of parsed.lines) {
      const shipment = await this.findShipmentForBk(user.organizationId, line.bk, customer?.id);
      if (shipment) {
        // BK in extras merken
        const prevExtras =
          shipment.extras && typeof shipment.extras === 'object' && !Array.isArray(shipment.extras)
            ? (shipment.extras as Record<string, unknown>)
            : {};
        await this.prisma.shipment.update({
          where: { id: shipment.id },
          data: {
            extras: {
              ...prevExtras,
              externalShipmentNumber: line.bk,
              liNumber: line.li,
              proforma: parsed.proformaNumber,
            },
            notes: shipment.notes?.includes(line.bk)
              ? shipment.notes
              : [shipment.notes, `Externe Sendungsnr. ${line.bk}${line.li ? ` / ${line.li}` : ''}`]
                  .filter(Boolean)
                  .join('\n'),
          },
        });
        matched.push({
          line,
          shipmentId: shipment.id,
          trackingNumber: shipment.trackingNumber,
          reference: shipment.reference,
          packageCount: shipment.packageCount || 0,
        });
      } else {
        missing.push(line);
      }
    }

    // Sammel-WE nach Colli/kg (Soloplan exportiert oft einen WE für die ganze Proforma)
    if (customer && parsed.totalColli) {
      const we = await this.findWeByTotals(
        user.organizationId,
        customer.id,
        parsed.totalColli,
        parsed.totalWeightKg,
      );
      if (we.length) {
        fallbackShipments = we.map((s) => ({ id: s.id, reference: s.reference }));
        for (const s of we) {
          const prev =
            s.extras && typeof s.extras === 'object' && !Array.isArray(s.extras)
              ? (s.extras as Record<string, unknown>)
              : {};
          await this.prisma.shipment.update({
            where: { id: s.id },
            data: {
              extras: {
                ...prev,
                proforma: parsed.proformaNumber,
                proformaMatchedByTotals: true,
                expectedColli: parsed.totalColli,
                expectedWeightKg: parsed.totalWeightKg,
                expectedBks: parsed.lines.map((l) => l.bk),
              },
            },
          });
        }
      }
    }

    // Mail nur wenn keine passende WE gefunden (weder BK noch Sammel)
    const mailedMissing = missing.length > 0 && fallbackShipments.length === 0;
    if (mailedMissing) {
      await this.mailMissingShipments(parsed, missing, fileName);
    }

    // WE-Session: genau eine passende WE-Referenz (Sammel bevorzugt), nie alle Kunden-WEs
    let session: Awaited<ReturnType<GoodsReceiptService['openSession']>> | null = null;
    const sessionDate = new Date().toISOString().slice(0, 10);
    const sessionLabel = parsed.proformaNumber || `PROFORMA-${sessionDate}`;

    const preferredFromMatched = (() => {
      const weMatched = matched.filter((m) => m.reference && /^WE-/i.test(m.reference));
      if (!weMatched.length) return null;
      if (parsed.totalColli) {
        const exact = weMatched.find((m) => m.packageCount === parsed.totalColli);
        if (exact) return exact.reference;
      }
      // größte WE-Sendung (Sammel), nicht die kleinste Teil-WE
      return [...weMatched].sort((a, b) => b.packageCount - a.packageCount)[0]?.reference || null;
    })();

    const preferredRef =
      fallbackShipments.find((s) => s.reference)?.reference || preferredFromMatched;
    const weRef = preferredRef ? preferredRef.replace(/^WE-/i, '') : null;

    try {
      if (weRef && customer) {
        session = await this.goodsReceipt.openSession(user, {
          customerId: customer.id,
          date: sessionDate,
          externalRef: weRef,
          sessionLabel,
        });
      }
    } catch (err: any) {
      this.logger.warn(`WE-Session aus Proforma: ${err?.message || err}`);
    }

    const summary = {
      ok: true,
      fileName,
      proformaNumber: parsed.proformaNumber,
      customer: customer?.name,
      lines: parsed.lines.length,
      matched: matched.length,
      missing: missing.map((m) => m.bk),
      fallbackWe: fallbackShipments.map((s) => s.reference),
      mailedMissing,
      sessionId: session?.id,
      sessionRef: session?.externalRef,
      expectedColli: session?.summary?.expected,
      pendingColli: session?.summary?.pending,
    };
    this.logger.log(
      `Proforma ${parsed.proformaNumber || fileName}: matched=${matched.length} missing=${missing.length} fallback=${fallbackShipments.length} session=${session?.externalRef || '—'}`,
    );
    return summary;
  }

  private async readInvoiceText(fullPath: string): Promise<string> {
    const lower = fullPath.toLowerCase();
    if (lower.endsWith('.txt')) return readFileSync(fullPath, 'utf8');

    // 1) pdftotext (poppler-utils im api/worker-Image) – Unitec-PDFs sind komprimiert
    try {
      const { stdout } = await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', fullPath, '-'], {
        timeout: 20_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (stdout && /BK\d+/i.test(stdout)) return stdout;
      if (stdout?.trim()) return stdout;
    } catch (err: any) {
      this.logger.warn(`pdftotext fehlgeschlagen: ${err?.message || err}`);
    }

    // 2) Roh-PDF-Strings
    const buf = readFileSync(fullPath);
    return extractTextFromPdfBuffer(buf);
  }

  private async resolveCustomer(organizationId: string, parsed: ParsedProformaInvoice) {
    if (parsed.customerName) {
      const byName = await this.prisma.customer.findFirst({
        where: {
          organizationId,
          name: { contains: parsed.customerName.split(/\s+/).slice(0, 2).join(' '), mode: 'insensitive' },
        },
      });
      if (byName) return byName;
    }
    return this.prisma.customer.findFirst({
      where: { organizationId, name: { contains: 'Unitec', mode: 'insensitive' } },
    });
  }

  private async findShipmentForBk(organizationId: string, bk: string, customerId?: string) {
    const weFilter = {
      OR: [
        { reference: { startsWith: 'WE-' } },
        { goodsDescription: { contains: 'Wareneingang', mode: 'insensitive' as const } },
      ],
    };

    const byExtras = await this.prisma.shipment.findFirst({
      where: {
        organizationId,
        ...(customerId ? { customerId } : {}),
        AND: [weFilter, { extras: { path: ['externalShipmentNumber'], equals: bk } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (byExtras) return byExtras;

    const byNotes = await this.prisma.shipment.findFirst({
      where: {
        organizationId,
        ...(customerId ? { customerId } : {}),
        AND: [weFilter, { notes: { contains: bk, mode: 'insensitive' } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (byNotes) return byNotes;

    const cons = await this.prisma.tourConsignment.findFirst({
      where: {
        tour: { organizationId },
        OR: [
          { externalConsignmentNumber: { equals: bk, mode: 'insensitive' } },
          { soloplanOrderNumber: { equals: bk } },
        ],
      },
      orderBy: { id: 'desc' },
    });
    if (cons) {
      const linked = await this.prisma.shipment.findFirst({
        where: {
          organizationId,
          ...(customerId ? { customerId } : {}),
          AND: [
            weFilter,
            {
              OR: [
                { reference: cons.externalConsignmentNumber || undefined },
                { reference: cons.soloplanOrderNumber || undefined },
                { notes: { contains: cons.soloplanOrderNumber || bk, mode: 'insensitive' } },
              ],
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      if (linked) return linked;
    }

    return null;
  }

  private async findWeByTotals(
    organizationId: string,
    customerId: string,
    totalColli: number,
    totalWeightKg?: number,
  ) {
    const since = new Date();
    since.setDate(since.getDate() - 2);
    const rows = await this.prisma.shipment.findMany({
      where: {
        organizationId,
        customerId,
        createdAt: { gte: since },
        packageCount: totalColli,
        AND: [
          {
            OR: [
              { reference: { startsWith: 'WE-' } },
              { goodsDescription: { contains: 'Wareneingang', mode: 'insensitive' } },
            ],
          },
        ],
      },
      include: { _count: { select: { colli: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Fallback: Colli-Anzahl über Relation, falls packageCount abweicht
    const rows2 =
      rows.length > 0
        ? rows
        : await this.prisma.shipment.findMany({
            where: {
              organizationId,
              customerId,
              createdAt: { gte: since },
              AND: [
                {
                  OR: [
                    { reference: { startsWith: 'WE-' } },
                    { goodsDescription: { contains: 'Wareneingang', mode: 'insensitive' } },
                  ],
                },
              ],
            },
            include: { _count: { select: { colli: true } } },
            orderBy: { createdAt: 'desc' },
            take: 200,
          });

    const byColli = rows2.filter(
      (s) => s.packageCount === totalColli || s._count.colli === totalColli,
    );
    if (!byColli.length) return [];
    if (!totalWeightKg) return byColli.slice(0, 1);

    const matched = byColli.filter((s) => {
      if (s.weightKg == null) return true;
      const w = Number(s.weightKg);
      if (!Number.isFinite(w)) return true;
      const pkg = Math.max(1, s.packageCount || s._count.colli || 1);
      const candidates = [w, w / pkg];
      return candidates.some((c) => Math.abs(c - totalWeightKg) <= totalWeightKg * 0.25);
    });
    return (matched.length ? matched : byColli).slice(0, 1);
  }

  private async mailMissingShipments(
    parsed: ParsedProformaInvoice,
    missing: ProformaShipmentLine[],
    fileName: string,
  ) {
    const lines = missing
      .map(
        (m) =>
          `- ${m.bk}${m.li ? ` / ${m.li}` : ''}` +
          (m.weightKg != null ? ` · ${m.weightKg} kg` : '') +
          (m.colli != null ? ` · Colli ${m.colli}` : ''),
      )
      .join('\n');
    const subject = `Fehlende Sendung(en) für Proforma ${parsed.proformaNumber || fileName}`;
    const body = [
      `Hallo,`,
      ``,
      `Zur Proforma-Rechnung ${parsed.proformaNumber || fileName} fehlen folgende Sendungen im WOG-Portal`,
      `(externe Sendungsnummer = BK):`,
      ``,
      lines,
      ``,
      `Kunde: ${parsed.customerName || '—'}`,
      `Erwartet gesamt: ${parsed.totalColli ?? '—'} Colli / ${parsed.totalWeightKg ?? '—'} kg`,
      `Datei: ${fileName}`,
      ``,
      `Bitte die Sendungen in Soloplan exportieren (Wareneingang) bzw. anlegen.`,
      ``,
      `WOG Portal`,
    ].join('\n');

    await this.notifications.sendRaw(MISSING_SHIPMENT_MAIL_TO, subject, body);
    // Merker-Datei im Outbox-Spiegel
    try {
      const noteDir = join(this.inboundDir, 'processed');
      writeFileSync(
        join(noteDir, `${Date.now()}_missing-${parsed.proformaNumber || 'proforma'}.txt`),
        `${subject}\n\n${body}\n`,
      );
    } catch {
      /* ignore */
    }
  }

  private toAuthUser(admin: {
    id: string;
    organizationId: string;
    role: UserRole;
    customerId?: string | null;
    email: string;
    mandantAccess?: Array<{ mandantId: string }>;
  }): AuthUser {
    return {
      id: admin.id,
      organizationId: admin.organizationId,
      role: admin.role,
      customerId: admin.customerId || null,
      email: admin.email,
      mandantIds: (admin.mandantAccess || []).map((a) => a.mandantId),
    };
  }
}
