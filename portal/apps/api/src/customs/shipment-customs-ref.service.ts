import { Injectable, Logger } from '@nestjs/common';
import { CustomsRefSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerDocumentsInboundService } from '../documents/customer-documents-inbound.service';

/** Rollierende Aufbewahrung MRN/LRN an Sendungen (2 Monate). */
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

export const CUSTOMS_REF_SOURCE_LABELS: Record<CustomsRefSource, string> = {
  EZOLL_CC529: 'AT Ausfuhr (CC529)',
  EZOLL_CC599: 'AT Austritt (CC599)',
  EZOLL_EZ922: 'AT Import Abgaben (EZ922)',
  EZOLL_EZ923: 'AT Import Freigabe (EZ923)',
  EZOLL_CC029: 'AT Transit (CC029)',
  SMARTBORDER_CCATBT02: 'SmartBorder Eingang',
  SMARTBORDER_CCATBT12: 'SmartBorder Transit',
  MERCURIO_CH: 'CH e-dec (Mercurio)',
};

@Injectable()
export class ShipmentCustomsRefService {
  private readonly log = new Logger(ShipmentCustomsRefService.name);

  constructor(
    private prisma: PrismaService,
    private customerDocs: CustomerDocumentsInboundService,
  ) {}

  async upsertFromOrder(input: {
    organizationId: string;
    orderNumber: number | string;
    consignmentIndex?: number | null;
    source: CustomsRefSource;
    mrn?: string | null;
    lrn?: string | null;
    sourceFileName?: string | null;
  }) {
    const mrn = cleanRef(input.mrn);
    const lrn = cleanRef(input.lrn);
    if (!mrn && !lrn) return null;

    const orderNumber = String(input.orderNumber).trim();
    if (!orderNumber) return null;
    const consignmentIndex =
      input.consignmentIndex != null && input.consignmentIndex > 0
        ? input.consignmentIndex
        : 1;

    const shipment = await this.customerDocs.findShipmentForSoloplanOrder(
      input.organizationId,
      orderNumber,
      consignmentIndex,
    );

    const now = new Date();
    const row = await this.prisma.shipmentCustomsRef.upsert({
      where: {
        organizationId_orderNumber_consignmentIndex_source: {
          organizationId: input.organizationId,
          orderNumber,
          consignmentIndex,
          source: input.source,
        },
      },
      create: {
        organizationId: input.organizationId,
        shipmentId: shipment?.id || null,
        orderNumber,
        consignmentIndex,
        source: input.source,
        mrn,
        lrn,
        sourceFileName: input.sourceFileName || null,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        shipmentId: shipment?.id || undefined,
        mrn: mrn || undefined,
        lrn: lrn || undefined,
        sourceFileName: input.sourceFileName || undefined,
        lastSeenAt: now,
      },
    });

    this.log.log(
      `CustomsRef ${orderNumber}.${consignmentIndex} ${input.source}` +
        ` MRN=${mrn || '-'} LRN=${lrn || '-'}` +
        (shipment ? ` → ${shipment.trackingNumber}` : ' (ohne Sendung)'),
    );
    return row;
  }

  async upsertSmartborder(input: {
    organizationId: string;
    source: 'SMARTBORDER_CCATBT02' | 'SMARTBORDER_CCATBT12';
    mrn?: string | null;
    lrn?: string | null;
    sourceFileName?: string | null;
    /** Verzollungsauftrag externe Nummer – optional für spätere Verknüpfung */
    customsExternalNumber?: string | null;
  }) {
    const mrn = cleanRef(input.mrn);
    const lrn = cleanRef(input.lrn);
    if (!mrn && !lrn) return null;

    // SmartBorder oft ohne Soloplan-Auftrag: Key über Dateiname/Transaktion
    const orderKey = cleanRef(input.customsExternalNumber) || mrn || lrn || 'unknown';
    const now = new Date();
    return this.prisma.shipmentCustomsRef.upsert({
      where: {
        organizationId_orderNumber_consignmentIndex_source: {
          organizationId: input.organizationId,
          orderNumber: orderKey.slice(0, 64),
          consignmentIndex: 1,
          source: input.source,
        },
      },
      create: {
        organizationId: input.organizationId,
        orderNumber: orderKey.slice(0, 64),
        consignmentIndex: 1,
        source: input.source,
        mrn,
        lrn,
        sourceFileName: input.sourceFileName || null,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        mrn: mrn || undefined,
        lrn: lrn || undefined,
        sourceFileName: input.sourceFileName || undefined,
        lastSeenAt: now,
      },
    });
  }

  /** CH Mercurio Inbound – MRN/LRN an Sendung oder Referenz speichern. */
  async upsertMercurio(input: {
    organizationId: string;
    shipmentId?: string | null;
    orderNumber?: string | null;
    consignmentIndex?: number | null;
    mrn?: string | null;
    lrn?: string | null;
    sourceFileName?: string | null;
  }) {
    const mrn = cleanRef(input.mrn);
    const lrn = cleanRef(input.lrn);
    if (!mrn && !lrn) return null;

    let shipmentId = input.shipmentId || null;
    let orderNumber = cleanRef(input.orderNumber);
    let consignmentIndex =
      input.consignmentIndex != null && input.consignmentIndex > 0
        ? input.consignmentIndex
        : 1;

    if (shipmentId) {
      const shipment = await this.prisma.shipment.findFirst({
        where: { id: shipmentId, organizationId: input.organizationId },
        select: { id: true, soloplanRef: true },
      });
      if (!shipment) {
        shipmentId = null;
      } else if (!orderNumber && shipment.soloplanRef) {
        const m = String(shipment.soloplanRef).match(/^(\d+)(?:\.(\d+))?/);
        if (m) {
          orderNumber = m[1];
          if (m[2]) consignmentIndex = Number(m[2]);
        } else {
          orderNumber = String(shipment.soloplanRef).slice(0, 64);
        }
      }
    }

    if (!orderNumber && shipmentId) {
      // keine Soloplan-Ref: Key über Sendungs-ID
      orderNumber = `SHIP-${shipmentId.slice(-12)}`;
    }
    if (!orderNumber) {
      orderNumber = (mrn || lrn || 'unknown').slice(0, 64);
    }

    if (!shipmentId && orderNumber) {
      const shipment = await this.customerDocs.findShipmentForSoloplanOrder(
        input.organizationId,
        orderNumber,
        consignmentIndex,
      );
      shipmentId = shipment?.id || null;
    }

    const now = new Date();
    const row = await this.prisma.shipmentCustomsRef.upsert({
      where: {
        organizationId_orderNumber_consignmentIndex_source: {
          organizationId: input.organizationId,
          orderNumber: orderNumber.slice(0, 64),
          consignmentIndex,
          source: CustomsRefSource.MERCURIO_CH,
        },
      },
      create: {
        organizationId: input.organizationId,
        shipmentId,
        orderNumber: orderNumber.slice(0, 64),
        consignmentIndex,
        source: CustomsRefSource.MERCURIO_CH,
        mrn,
        lrn,
        sourceFileName: input.sourceFileName || null,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        shipmentId: shipmentId || undefined,
        mrn: mrn || undefined,
        lrn: lrn || undefined,
        sourceFileName: input.sourceFileName || undefined,
        lastSeenAt: now,
      },
    });

    this.log.log(
      `CustomsRef Mercurio ${orderNumber}.${consignmentIndex}` +
        ` MRN=${mrn || '-'} LRN=${lrn || '-'}` +
        (shipmentId ? ` → shipment ${shipmentId}` : ' (ohne Sendung)'),
    );
    return row;
  }

  async listForShipment(shipmentId: string) {
    const rows = await this.prisma.shipmentCustomsRef.findMany({
      where: { shipmentId },
      orderBy: { lastSeenAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      sourceLabel: CUSTOMS_REF_SOURCE_LABELS[r.source] || r.source,
      mrn: r.mrn,
      lrn: r.lrn,
      orderNumber: r.orderNumber,
      consignmentIndex: r.consignmentIndex,
      sourceFileName: r.sourceFileName,
      lastSeenAt: r.lastSeenAt,
    }));
  }

  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    const res = await this.prisma.shipmentCustomsRef.deleteMany({
      where: { lastSeenAt: { lt: cutoff } },
    });
    if (res.count > 0) {
      this.log.log(`CustomsRef-Purge: ${res.count} Einträge älter als 60 Tage entfernt`);
    }
    return res.count;
  }
}

function cleanRef(v: string | null | undefined): string | null {
  const s = String(v || '')
    .trim()
    .replace(/\s+/g, '');
  return s || null;
}
