import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CustomsRefSource } from '@prisma/client';
import {
  CUSTOMS_REF_SOURCE_LABELS,
  ShipmentCustomsRefService,
} from '../src/customs/shipment-customs-ref.service';

describe('ShipmentCustomsRefService', () => {
  it('kennt Labels für alle CustomsRefSource-Werte', () => {
    for (const source of Object.values(CustomsRefSource)) {
      assert.ok(
        CUSTOMS_REF_SOURCE_LABELS[source],
        `fehlendes Label für ${source}`,
      );
    }
  });

  it('upsertFromOrder speichert MRN/LRN und verknüpft Sendung', async () => {
    const upsertCalls: any[] = [];
    const prisma = {
      shipmentCustomsRef: {
        upsert: async (args: any) => {
          upsertCalls.push(args);
          return { id: 'ref-1', ...args.create };
        },
        deleteMany: async () => ({ count: 0 }),
        findMany: async () => [],
      },
    };
    const customerDocs = {
      findShipmentForSoloplanOrder: async () => ({
        id: 'ship-1',
        trackingNumber: 'WOG2608TEST',
      }),
    };

    const svc = new ShipmentCustomsRefService(prisma as any, customerDocs as any);
    const row = await svc.upsertFromOrder({
      organizationId: 'org-1',
      orderNumber: 443153,
      consignmentIndex: 1,
      source: CustomsRefSource.EZOLL_CC599,
      mrn: '26AT ABC 123',
      lrn: '443153.1/C',
      sourceFileName: '443153.1_CC599CC.xml',
    });

    assert.ok(row);
    assert.equal(upsertCalls.length, 1);
    const call = upsertCalls[0];
    assert.equal(call.create.mrn, '26ATABC123');
    assert.equal(call.create.lrn, '443153.1/C');
    assert.equal(call.create.shipmentId, 'ship-1');
    assert.equal(call.create.source, CustomsRefSource.EZOLL_CC599);
    assert.equal(call.where.organizationId_orderNumber_consignmentIndex_source.orderNumber, '443153');
  });

  it('upsertFromOrder ohne MRN/LRN schreibt nichts', async () => {
    let called = false;
    const prisma = {
      shipmentCustomsRef: {
        upsert: async () => {
          called = true;
          return {};
        },
      },
    };
    const svc = new ShipmentCustomsRefService(prisma as any, {
      findShipmentForSoloplanOrder: async () => null,
    } as any);
    const row = await svc.upsertFromOrder({
      organizationId: 'org-1',
      orderNumber: '1',
      source: CustomsRefSource.EZOLL_CC529,
      mrn: '  ',
      lrn: null,
    });
    assert.equal(row, null);
    assert.equal(called, false);
  });

  it('purgeExpired löscht Einträge älter als 60 Tage', async () => {
    let where: any;
    const prisma = {
      shipmentCustomsRef: {
        deleteMany: async (args: any) => {
          where = args.where;
          return { count: 2 };
        },
      },
    };
    const svc = new ShipmentCustomsRefService(prisma as any, {} as any);
    const count = await svc.purgeExpired();
    assert.equal(count, 2);
    assert.ok(where.lastSeenAt.lt instanceof Date);
    const ageMs = Date.now() - where.lastSeenAt.lt.getTime();
    const sixtyDays = 60 * 24 * 60 * 60 * 1000;
    assert.ok(ageMs >= sixtyDays - 5_000 && ageMs <= sixtyDays + 5_000);
  });

  it('upsertMercurio nutzt Soloplan-Ref aus Sendung', async () => {
    const upsertCalls: any[] = [];
    const prisma = {
      shipment: {
        findFirst: async () => ({ id: 'ship-ch', soloplanRef: '442650.2' }),
      },
      shipmentCustomsRef: {
        upsert: async (args: any) => {
          upsertCalls.push(args);
          return { id: 'ref-ch', ...args.create };
        },
      },
    };
    const svc = new ShipmentCustomsRefService(prisma as any, {
      findShipmentForSoloplanOrder: async () => null,
    } as any);

    await svc.upsertMercurio({
      organizationId: 'org-1',
      shipmentId: 'ship-ch',
      mrn: 'CH123456789012',
      lrn: 'LRN-CH-1',
    });

    assert.equal(upsertCalls.length, 1);
    assert.equal(upsertCalls[0].create.orderNumber, '442650');
    assert.equal(upsertCalls[0].create.consignmentIndex, 2);
    assert.equal(upsertCalls[0].create.source, CustomsRefSource.MERCURIO_CH);
    assert.equal(upsertCalls[0].create.shipmentId, 'ship-ch');
  });
});
