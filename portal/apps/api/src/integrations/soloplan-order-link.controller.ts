import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { Allow, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { SoloplanService } from './soloplan.service';

/**
 * Soloplan/CarLo → Portal: echte Auftragsnummer nach Import zurückmelden.
 *
 * POST /api/integrations/soloplan/order-link
 * Body: { "externalNumber": "VLB…", "orderNumber": 454144, "consignmentNumber": 1 }
 *
 * Vorerst ohne API-Key (Automate: Authentifizierung = Keine).
 * orderNumber muss > 0 sein (0 wird abgelehnt).
 */
class SoloplanOrderLinkDto {
  @Allow()
  @Transform(({ value }) => String(value ?? '').trim())
  externalNumber!: string;

  /** Soloplan-Auftragsnummer (Zahl oder String) */
  @Allow()
  orderNumber!: number | string;

  @IsOptional()
  @Allow()
  consignmentNumber?: number | string;
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
    const externalNumber = String(dto.externalNumber || '').trim();
    if (!externalNumber) {
      throw new BadRequestException('externalNumber fehlt');
    }

    const orderNumber = Number(String(dto.orderNumber ?? '').trim());
    if (!Number.isFinite(orderNumber) || orderNumber <= 0 || !Number.isInteger(orderNumber)) {
      throw new BadRequestException(
        'orderNumber muss eine echte Soloplan-Auftragsnummer > 0 sein (0 ist ungültig)',
      );
    }
    const orderKey = String(Math.trunc(orderNumber));

    const consignmentRaw = dto.consignmentNumber;
    let consignmentNumber: number | undefined;
    if (consignmentRaw != null && String(consignmentRaw).trim() !== '') {
      const n = Number(String(consignmentRaw).trim());
      if (!Number.isFinite(n) || n < 1) {
        throw new BadRequestException('consignmentNumber ungültig');
      }
      consignmentNumber = Math.trunc(n);
    }

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
            data: {
              soloplanRef: orderKey,
              ...(consignmentNumber != null
                ? { extras: { soloplanConsignmentIndex: consignmentNumber } }
                : {}),
            },
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
