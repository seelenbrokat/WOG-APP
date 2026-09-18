import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { Allow, IsOptional } from 'class-validator';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SoloplanService } from './soloplan.service';

/**
 * Soloplan/CarLo → Portal: echte Auftragsnummer nach Import zurückmelden.
 *
 * POST /api/integrations/soloplan/order-link
 *
 * Akzeptierte Bodies:
 * 1) Flach:
 *    { "externalNumber": "VLB…", "orderNumber": 454144, "consignmentNumber": 1 }
 * 2) Soloplan normalOrder (wie Automate oft sendet):
 *    { "normalOrder": [{ "externalNumber": "VLB…", "number": 454143,
 *        "consignments": [{ "number": 1, "externalNumber": "VLB…" }] }] }
 *
 * Vorerst ohne API-Key. Order-Nummer muss > 0 sein.
 */
class SoloplanOrderLinkDto {
  @IsOptional()
  @Allow()
  externalNumber?: unknown;

  @IsOptional()
  @Allow()
  ExternalNumber?: unknown;

  @IsOptional()
  @Allow()
  orderNumber?: unknown;

  @IsOptional()
  @Allow()
  OrderNumber?: unknown;

  /** Soloplan: Auftragsnummer heißt oft `number` */
  @IsOptional()
  @Allow()
  number?: unknown;

  @IsOptional()
  @Allow()
  consignmentNumber?: unknown;

  @IsOptional()
  @Allow()
  ConsignmentNumber?: unknown;

  @IsOptional()
  @Allow()
  consignments?: unknown;

  @IsOptional()
  @Allow()
  normalOrder?: unknown;
}

type NormalizedLink = {
  externalNumber: string;
  orderNumber: number;
  consignmentNumber?: number;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

function pickPositiveInt(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (v == null || String(v).trim() === '') continue;
    const n = Number(String(v).trim());
    if (Number.isFinite(n) && Number.isInteger(n) && n > 0) return Math.trunc(n);
  }
  return undefined;
}

function normalizeOne(raw: Record<string, unknown>): NormalizedLink | null {
  const consignments = Array.isArray(raw.consignments) ? raw.consignments : [];
  const firstCons = asRecord(consignments[0]);

  const externalNumber = pickStr(
    raw.externalNumber,
    raw.ExternalNumber,
    firstCons?.externalNumber,
    firstCons?.ExternalNumber,
  );
  const orderNumber = pickPositiveInt(
    raw.orderNumber,
    raw.OrderNumber,
    raw.number,
    raw.Number,
  );
  const consignmentNumber = pickPositiveInt(
    raw.consignmentNumber,
    raw.ConsignmentNumber,
    firstCons?.number,
    firstCons?.Number,
    firstCons?.consignmentNumber,
  );

  if (!externalNumber || orderNumber == null) return null;
  return { externalNumber, orderNumber, consignmentNumber };
}

function normalizeBody(dto: SoloplanOrderLinkDto): NormalizedLink[] {
  const root = dto as unknown as Record<string, unknown>;
  const fromRoot = normalizeOne(root);
  const out: NormalizedLink[] = [];
  if (fromRoot) out.push(fromRoot);

  const normalOrder = Array.isArray(dto.normalOrder)
    ? dto.normalOrder
    : dto.normalOrder
      ? [dto.normalOrder]
      : [];

  for (const item of normalOrder) {
    const rec = asRecord(item);
    if (!rec) continue;
    const n = normalizeOne(rec);
    if (n) out.push(n);
  }

  // Dedup by externalNumber (last wins)
  const byExt = new Map<string, NormalizedLink>();
  for (const n of out) byExt.set(n.externalNumber, n);
  return [...byExt.values()];
}

@Controller('integrations/soloplan')
export class SoloplanOrderLinkController {
  private readonly log = new Logger(SoloplanOrderLinkController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly soloplan: SoloplanService,
  ) {}

  @Public()
  @Post('order-link')
  async linkOrder(@Body() dto: SoloplanOrderLinkDto) {
    const links = normalizeBody(dto);
    if (!links.length) {
      const keys = Object.keys(dto || {}).join(',');
      this.log.warn(
        `Soloplan order-link: kein gültiges externalNumber/number (keys=${keys || '—'})`,
      );
      throw new BadRequestException(
        'externalNumber/orderNumber fehlen (flach oder normalOrder[].externalNumber + number)',
      );
    }

    const results = [];
    for (const link of links) {
      results.push(await this.applyLink(link));
    }

    if (results.length === 1) return results[0];
    return { ok: true, count: results.length, results };
  }

  private async applyLink(link: NormalizedLink) {
    const { externalNumber, orderNumber, consignmentNumber } = link;
    const orderKey = String(orderNumber);

    const customs = await this.prisma.customsOrder.findFirst({
      where: { externalNumber },
      select: {
        id: true,
        organizationId: true,
        soloplanRef: true,
        status: true,
        externalNumber: true,
      },
    });

    const transport = await this.prisma.transportOrder.findFirst({
      where: { externalNumber },
      select: {
        id: true,
        soloplanRef: true,
        shipments: { select: { id: true, soloplanRef: true } },
      },
    });

    if (!customs && !transport) {
      throw new NotFoundException(`Kein Portal-Auftrag mit externalNumber ${externalNumber}`);
    }

    const linked: string[] = [];

    if (customs) {
      const data: { soloplanRef: string; status?: string } = { soloplanRef: orderKey };
      if (customs.status === 'SUBMITTED' || customs.status === 'IN_PROGRESS') {
        data.status = 'ACCEPTED';
      }
      await this.prisma.customsOrder.update({ where: { id: customs.id }, data });
      linked.push(`customs:${customs.id}`);
      this.log.log(
        `Soloplan order-link: ${externalNumber} → Order ${orderKey}` +
          (consignmentNumber != null ? `.${consignmentNumber}` : '') +
          ` (CustomsOrder)`,
      );
    }

    if (transport) {
      if (transport.soloplanRef !== orderKey) {
        await this.prisma.transportOrder.update({
          where: { id: transport.id },
          data: { soloplanRef: orderKey },
        });
      }
      for (const s of transport.shipments) {
        if (s.soloplanRef !== orderKey) {
          await this.prisma.shipment.update({
            where: { id: s.id },
            data: { soloplanRef: orderKey },
          });
        }
      }
      linked.push(`transport:${transport.id}`);
    }

    let docs: { ok?: boolean; updateFileName?: string | null; reason?: string } | null = null;
    if (customs) {
      try {
        const res = await this.soloplan.exportCustomsOrder(customs.id);
        docs = {
          ok: Boolean(res?.ok),
          updateFileName: (res as { updateFileName?: string | null })?.updateFileName ?? null,
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log.warn(`Soloplan order-link Docs für ${externalNumber}: ${msg}`);
        docs = { ok: false, reason: msg };
      }
    }

    return {
      ok: true,
      externalNumber,
      orderNumber: orderKey,
      consignmentNumber: consignmentNumber ?? null,
      linked,
      docs,
    };
  }
}
