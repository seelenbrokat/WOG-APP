import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Ausfuhr/Austritt: länger halten als Tour-Cache (Austritt oft verzögert). */
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type EzollConsignmentCacheSnapshot = {
  orderNumber: string;
  consignmentIndex: number;
  hasCc529: boolean;
  hasCc599: boolean;
  mrn: string | null;
  lrn: string | null;
  totalItems: number | null;
  eur1Number: string | null;
};

@Injectable()
export class EzollConsignmentCacheService {
  private readonly log = new Logger(EzollConsignmentCacheService.name);

  constructor(private prisma: PrismaService) {}

  private keys(organizationId: string, orderNumber: number | string, consignmentIndex: number) {
    return {
      organizationId,
      orderNumber: String(orderNumber).trim(),
      consignmentIndex: consignmentIndex > 0 ? consignmentIndex : 1,
    };
  }

  async getState(
    organizationId: string,
    orderNumber: number | string,
    consignmentIndex: number,
  ): Promise<EzollConsignmentCacheSnapshot | null> {
    const k = this.keys(organizationId, orderNumber, consignmentIndex);
    const row = await this.prisma.ezollConsignmentCache.findUnique({
      where: {
        organizationId_orderNumber_consignmentIndex: k,
      },
    });
    if (!row) return null;
    if (row.lastSeenAt.getTime() < Date.now() - WINDOW_MS) {
      await this.prisma.ezollConsignmentCache.delete({ where: { id: row.id } }).catch(() => undefined);
      return null;
    }
    return {
      orderNumber: row.orderNumber,
      consignmentIndex: row.consignmentIndex,
      hasCc529: !!row.cc529SeenAt,
      hasCc599: !!row.cc599SeenAt,
      mrn: row.mrn,
      lrn: row.lrn,
      totalItems: row.totalItems,
      eur1Number: row.eur1Number,
    };
  }

  async markCc529(input: {
    organizationId: string;
    orderNumber: number | string;
    consignmentIndex: number;
    mrn?: string | null;
    lrn?: string | null;
    totalItems?: number | null;
    eur1Number?: string | null;
    sourceFile: string;
  }): Promise<EzollConsignmentCacheSnapshot> {
    const k = this.keys(input.organizationId, input.orderNumber, input.consignmentIndex);
    const now = new Date();
    const existing = await this.prisma.ezollConsignmentCache.findUnique({
      where: { organizationId_orderNumber_consignmentIndex: k },
    });
    const sourceFiles = [...(existing?.sourceFiles || [])];
    if (input.sourceFile && !sourceFiles.includes(input.sourceFile)) {
      sourceFiles.push(input.sourceFile);
    }

    const row = await this.prisma.ezollConsignmentCache.upsert({
      where: { organizationId_orderNumber_consignmentIndex: k },
      create: {
        ...k,
        cc529SeenAt: now,
        mrn: input.mrn || undefined,
        lrn: input.lrn || undefined,
        totalItems: input.totalItems ?? undefined,
        eur1Number: input.eur1Number || undefined,
        sourceFiles,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        cc529SeenAt: existing?.cc529SeenAt || now,
        mrn: input.mrn || existing?.mrn || undefined,
        lrn: input.lrn || existing?.lrn || undefined,
        totalItems: input.totalItems ?? existing?.totalItems ?? undefined,
        eur1Number: input.eur1Number || existing?.eur1Number || undefined,
        sourceFiles,
        lastSeenAt: now,
      },
    });

    this.log.log(`ConsignmentCache ${k.orderNumber}.${k.consignmentIndex}: CC529 markiert`);
    return {
      orderNumber: row.orderNumber,
      consignmentIndex: row.consignmentIndex,
      hasCc529: !!row.cc529SeenAt,
      hasCc599: !!row.cc599SeenAt,
      mrn: row.mrn,
      lrn: row.lrn,
      totalItems: row.totalItems,
      eur1Number: row.eur1Number,
    };
  }

  async markCc599(input: {
    organizationId: string;
    orderNumber: number | string;
    consignmentIndex: number;
    sourceFile: string;
  }): Promise<EzollConsignmentCacheSnapshot> {
    const k = this.keys(input.organizationId, input.orderNumber, input.consignmentIndex);
    const now = new Date();
    const existing = await this.prisma.ezollConsignmentCache.findUnique({
      where: { organizationId_orderNumber_consignmentIndex: k },
    });
    const sourceFiles = [...(existing?.sourceFiles || [])];
    if (input.sourceFile && !sourceFiles.includes(input.sourceFile)) {
      sourceFiles.push(input.sourceFile);
    }

    const row = await this.prisma.ezollConsignmentCache.upsert({
      where: { organizationId_orderNumber_consignmentIndex: k },
      create: {
        ...k,
        cc599SeenAt: now,
        sourceFiles,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        cc599SeenAt: existing?.cc599SeenAt || now,
        sourceFiles,
        lastSeenAt: now,
      },
    });

    this.log.log(
      `ConsignmentCache ${k.orderNumber}.${k.consignmentIndex}: CC599 markiert (Ausfuhr=${row.cc529SeenAt ? 'ja' : 'nein'})`,
    );
    return {
      orderNumber: row.orderNumber,
      consignmentIndex: row.consignmentIndex,
      hasCc529: !!row.cc529SeenAt,
      hasCc599: !!row.cc599SeenAt,
      mrn: row.mrn,
      lrn: row.lrn,
      totalItems: row.totalItems,
      eur1Number: row.eur1Number,
    };
  }

  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - WINDOW_MS);
    const res = await this.prisma.ezollConsignmentCache.deleteMany({
      where: { lastSeenAt: { lt: cutoff } },
    });
    if (res.count) {
      this.log.log(`ConsignmentCache: ${res.count} Einträge >30 Tage gelöscht`);
    }
    return res.count;
  }
}
