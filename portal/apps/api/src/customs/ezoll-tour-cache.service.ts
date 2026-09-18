import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type EzollTourCacheSnapshot = {
  tourNumber: string;
  mrns: string[];
  lrns: string[];
  totalItems: number | null;
  sourceFiles: string[];
  isNew: boolean;
};

/**
 * 7-Tage-Fenster pro Soloplan-Tour für CC029C:
 * erste Datei → anlegen, weitere → MRNs/LRNs ergänzen, nach 7 Tagen löschen.
 */
@Injectable()
export class EzollTourCacheService {
  private readonly log = new Logger(EzollTourCacheService.name);

  constructor(private prisma: PrismaService) {}

  async mergeTourDocument(input: {
    organizationId: string;
    tourNumber: number | string;
    mrn?: string | null;
    lrn?: string | null;
    totalItems?: number | null;
    sourceFile: string;
  }): Promise<EzollTourCacheSnapshot> {
    const tourNumber = String(input.tourNumber).trim();
    const now = new Date();
    const cutoff = new Date(now.getTime() - WINDOW_MS);

    const existing = await this.prisma.ezollTourCache.findUnique({
      where: {
        organizationId_tourNumber: {
          organizationId: input.organizationId,
          tourNumber,
        },
      },
    });

    if (existing && existing.lastSeenAt < cutoff) {
      await this.prisma.ezollTourCache.delete({ where: { id: existing.id } });
    }

    const fresh = !existing || existing.lastSeenAt < cutoff;
    const mrns = fresh ? [] : [...existing!.mrns];
    const lrns = fresh ? [] : [...existing!.lrns];
    const sourceFiles = fresh ? [] : [...existing!.sourceFiles];

    if (input.mrn && !mrns.includes(input.mrn)) mrns.push(input.mrn);
    if (input.lrn && !lrns.includes(input.lrn)) lrns.push(input.lrn);
    if (input.sourceFile && !sourceFiles.includes(input.sourceFile)) {
      sourceFiles.push(input.sourceFile);
    }

    let totalItems = fresh ? null : existing!.totalItems;
    if (input.totalItems != null && input.totalItems > 0) {
      totalItems =
        totalItems == null ? input.totalItems : Math.max(totalItems, input.totalItems);
    }

    const row = await this.prisma.ezollTourCache.upsert({
      where: {
        organizationId_tourNumber: {
          organizationId: input.organizationId,
          tourNumber,
        },
      },
      create: {
        organizationId: input.organizationId,
        tourNumber,
        mrns,
        lrns,
        totalItems: totalItems ?? undefined,
        sourceFiles,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        mrns,
        lrns,
        totalItems: totalItems ?? undefined,
        sourceFiles,
        lastSeenAt: now,
        ...(fresh ? { firstSeenAt: now } : {}),
      },
    });

    this.log.log(
      `TourCache ${tourNumber}: ${fresh ? 'neu' : 'ergänzt'} MRNs=${row.mrns.length} LRNs=${row.lrns.length}`,
    );

    return {
      tourNumber: row.tourNumber,
      mrns: row.mrns,
      lrns: row.lrns,
      totalItems: row.totalItems,
      sourceFiles: row.sourceFiles,
      isNew: fresh,
    };
  }

  /** Einträge älter als 7 Tage (lastSeenAt) entfernen. */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - WINDOW_MS);
    const res = await this.prisma.ezollTourCache.deleteMany({
      where: { lastSeenAt: { lt: cutoff } },
    });
    if (res.count) {
      this.log.log(`TourCache: ${res.count} Einträge >7 Tage gelöscht`);
    }
    return res.count;
  }
}
