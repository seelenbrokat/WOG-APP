import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  isEtaText,
  parseEtaMessage,
  toTourEtaView,
  TourEtaView,
} from './tour-eta';

@Injectable()
export class TourEtaService {
  private readonly log = new Logger(TourEtaService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Strukturierte ETA von der Zustellapp.
   * Schreibt nur, wenn sich Text oder Zeit (±60s) geändert hat.
   */
  async upsertFromApp(opts: {
    organizationId: string;
    tourNumber: string;
    text: string;
    etaAt?: Date | string | null;
    source?: 'app' | 'chat' | 'location';
  }) {
    const tourNumber = String(opts.tourNumber || '').trim();
    if (!tourNumber) throw new NotFoundException('Tournummer fehlt');

    const text = String(opts.text || '').trim();
    const parsed = text ? parseEtaMessage(text) : null;
    let etaAt: Date | null = null;
    if (opts.etaAt) {
      const d = opts.etaAt instanceof Date ? opts.etaAt : new Date(opts.etaAt);
      if (!Number.isNaN(d.getTime())) etaAt = d;
    }
    if (!etaAt && parsed) etaAt = parsed.etaAt;
    if (!etaAt && !text) {
      return { updated: false, reason: 'empty' as const };
    }

    const tour = await this.prisma.tour.findFirst({
      where: { organizationId: opts.organizationId, tourNumber },
      select: {
        id: true,
        tourNumber: true,
        etaAt: true,
        etaText: true,
      },
    });
    if (!tour) {
      this.log.warn(`ETA für unbekannte Tour ${tourNumber} ignoriert`);
      throw new NotFoundException(`Tour ${tourNumber} nicht gefunden`);
    }

    const nextText = text || parsed?.text || tour.etaText || '';
    const sameText = (tour.etaText || '') === nextText;
    const sameTime =
      tour.etaAt &&
      etaAt &&
      Math.abs(tour.etaAt.getTime() - etaAt.getTime()) < 60_000;
    if (sameText && (sameTime || (!tour.etaAt && !etaAt))) {
      return { updated: false, reason: 'unchanged' as const, tourId: tour.id, tourNumber };
    }

    const updated = await this.prisma.tour.update({
      where: { id: tour.id },
      data: {
        etaAt: etaAt ?? undefined,
        etaText: nextText || undefined,
        etaUpdatedAt: new Date(),
        etaSource: opts.source || 'app',
      },
      select: {
        id: true,
        tourNumber: true,
        etaAt: true,
        etaText: true,
        etaUpdatedAt: true,
        etaSource: true,
      },
    });

    this.log.log(
      `ETA Tour ${updated.tourNumber}: ${updated.etaText || updated.etaAt?.toISOString()} (${updated.etaSource})`,
    );
    return { updated: true, reason: 'ok' as const, tour: updated };
  }

  /** Chat-/Location-Freitext auswerten und ggf. speichern */
  async ingestFreeText(opts: {
    organizationId: string;
    text: string;
    tourNumber?: string | null;
    source: 'chat' | 'location';
  }) {
    if (!isEtaText(opts.text)) return null;
    const parsed = parseEtaMessage(opts.text);
    if (!parsed) return null;
    const tourNumber = opts.tourNumber?.trim() || parsed.tourNumber;
    try {
      return await this.upsertFromApp({
        organizationId: opts.organizationId,
        tourNumber,
        text: opts.text,
        etaAt: parsed.etaAt,
        source: opts.source,
      });
    } catch (e: any) {
      this.log.warn(`ETA ingest (${opts.source}) failed: ${e?.message || e}`);
      return null;
    }
  }

  async findEtaForShipment(opts: {
    organizationId: string;
    soloplanRef?: string | null;
    trackingNumber?: string | null;
    reference?: string | null;
    orderExternalNumber?: string | null;
  }): Promise<TourEtaView | null> {
    const keys = [
      opts.soloplanRef,
      opts.trackingNumber,
      opts.reference,
      opts.orderExternalNumber,
    ]
      .map((k) => String(k || '').trim())
      .filter(Boolean);
    if (!keys.length) return null;

    const pickBest = (
      rows: Array<{
        tour: {
          tourNumber: string;
          etaAt: Date | null;
          etaText: string | null;
          etaUpdatedAt: Date | null;
          etaSource: string | null;
        } | null;
      }>,
    ) => {
      const tours = rows
        .map((r) => r.tour)
        .filter((t): t is NonNullable<typeof t> => Boolean(t?.etaAt || t?.etaText));
      tours.sort((a, b) => {
        const ta = a.etaUpdatedAt?.getTime() || 0;
        const tb = b.etaUpdatedAt?.getTime() || 0;
        return tb - ta;
      });
      return tours[0] ? toTourEtaView(tours[0]) : null;
    };

    // 1) TransportOrder-Nummer (TourConsignment.soloplanOrderNumber)
    const byTo = await this.prisma.tourConsignment.findMany({
      where: {
        soloplanOrderNumber: { in: keys },
        tour: { organizationId: opts.organizationId },
      },
      select: {
        tour: {
          select: {
            tourNumber: true,
            etaAt: true,
            etaText: true,
            etaUpdatedAt: true,
            etaSource: true,
          },
        },
      },
      take: 20,
    });
    const fromTo = pickBest(byTo);
    if (fromTo) return fromTo;

    // 2) OrderNumber / Sendungsnummer-Basis (432984 oder 432984.1)
    const orderBases = keys.flatMap((k) => {
      const m = k.match(/^(\d+)(?:\.\d+)?$/);
      return m ? [m[1]] : [];
    });
    if (orderBases.length) {
      const byOrder = await this.prisma.tourConsignment.findMany({
        where: {
          orderNumber: { in: orderBases },
          tour: { organizationId: opts.organizationId },
        },
        select: {
          tour: {
            select: {
              tourNumber: true,
              etaAt: true,
              etaText: true,
              etaUpdatedAt: true,
              etaSource: true,
            },
          },
        },
        take: 20,
      });
      const fromOrder = pickBest(byOrder);
      if (fromOrder) return fromOrder;
    }

    return null;
  }
}
