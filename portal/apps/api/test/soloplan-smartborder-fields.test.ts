import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSoloplanFilePayload,
  resolveCustomsFileApiFields,
  type PortalShipmentForSoloplan,
} from '../src/integrations/soloplan-order.mapper';

function baseShipment(
  overrides: Partial<PortalShipmentForSoloplan> = {},
): PortalShipmentForSoloplan {
  return {
    id: 'test',
    trackingNumber: 'VLBTEST',
    reference: 'VLBTEST',
    goodsDescription: 'Test',
    packageCount: 1,
    weightKg: 10,
    pickupCompany: 'A',
    pickupStreet: 'S 1',
    pickupZip: '6800',
    pickupCity: 'Feldkirch',
    pickupCountry: 'AT',
    deliveryCompany: 'B',
    deliveryStreet: 'S 2',
    deliveryZip: '9000',
    deliveryCity: 'St. Gallen',
    deliveryCountry: 'CH',
    customer: { customerNumber: '1', name: 'Kunde' },
    positions: [{ description: 'Test', quantity: 1 }],
    ...overrides,
  };
}

describe('Soloplan FileAPI SmartBorder-Felder', () => {
  it('mapped telefon_Smartborder, mailSmartborder, sMSSmartBorder', () => {
    const fields = resolveCustomsFileApiFields(
      baseShipment({
        telefonSmartborder: '+436769075070',
        mailSmartborder: 'disposition@beispiel.at',
        smsSmartBorder: true,
      }),
    );

    assert.equal(fields.telefonSmartborder, '+436769075070');
    assert.equal(fields.mailSmartborder, 'disposition@beispiel.at');
    assert.equal(fields.smsSmartBorder, true);
  });

  it('akzeptiert Schema-Keys und Legacy-Title-Keys aus extras', () => {
    const fields = resolveCustomsFileApiFields(
      baseShipment({
        extras: {
          telefon_Smartborder: '+436641234567',
          mailSmartborder: 'Info@Beispiel.AT',
          sMSSmartBorder: 'true',
        },
      }),
    );

    assert.equal(fields.telefonSmartborder, '+436641234567');
    assert.equal(fields.mailSmartborder, 'info@beispiel.at');
    assert.equal(fields.smsSmartBorder, true);
  });

  it('schreibt Schema-Property-Keys in OrderImportPORTAL-v6 Create-JSON', () => {
    const payload = buildSoloplanFilePayload(
      baseShipment({
        verzollungsauftrag: true,
        kennzeichen: 'W-12345T',
        telefonSmartborder: '+436769075070',
        mailSmartborder: 'disposition@beispiel.at',
        smsSmartBorder: true,
      }),
      { format: 'order' },
    ) as {
      order: Array<{
        verzollungsauftrag?: boolean;
        consignments: Array<Record<string, unknown>>;
      }>;
    };

    const order = payload.order[0];
    const c = order.consignments[0];
    assert.equal(order.verzollungsauftrag, true);
    assert.equal(c.telefon_Smartborder, '+436769075070');
    assert.equal(c.mailSmartborder, 'disposition@beispiel.at');
    assert.equal(c.sMSSmartBorder, true);
    assert.equal(c.kennzeichen, 'W-12345T');
    // Soloplan CFBOOLEAN8 „Verzollungsauftrag“
    assert.equal(
      (c.customFields as { customBool8?: boolean } | undefined)?.customBool8,
      true,
    );
    // Title-Schreibweise darf nicht im JSON landen (CarLo additionalProperties:false)
    assert.equal(c.Telefon_Smartborder, undefined);
    assert.equal(c.MailSmartborder, undefined);
    assert.equal(c.SMSSmartBorder, undefined);
  });

  it('setzt customBool8 auch bei extras.verzollung (Sendung mit Verzollung)', () => {
    const payload = buildSoloplanFilePayload(
      baseShipment({ extras: { verzollung: true } }),
      { format: 'order' },
    ) as {
      order: Array<{ consignments: Array<Record<string, unknown>> }>;
    };
    const cf = payload.order[0].consignments[0].customFields as {
      customBool8?: boolean;
      customBool10?: boolean;
    };
    assert.equal(cf.customBool8, true);
    assert.equal(cf.customBool10, true);
  });

  it('setzt customBool8 nicht ohne Verzollungsauftrag', () => {
    const payload = buildSoloplanFilePayload(baseShipment(), { format: 'order' }) as {
      order: Array<{ consignments: Array<Record<string, unknown>> }>;
    };
    const cf = payload.order[0].consignments[0].customFields as {
      customBool8?: boolean;
    };
    assert.equal(cf.customBool8, undefined);
  });

  it('teilt Absender-name1 bei >40 Zeichen (CarLo-Limit)', () => {
    const long =
      'Dobler Werbetextilien Gesellschaft m.b.H.'; // 41 Zeichen
    assert.ok(long.length > 40);
    const payload = buildSoloplanFilePayload(
      baseShipment({
        verzollungsauftrag: true,
        pickupCompany: long,
      }),
      { format: 'order' },
    ) as {
      order: Array<{ consignments: Array<Record<string, unknown>> }>;
    };
    const sender = payload.order[0].consignments[0].sender as {
      name1?: string;
      name2?: string;
    };
    assert.ok((sender.name1 || '').length <= 35);
    assert.ok((sender.name2 || '').length <= 35);
    assert.equal(
      [sender.name1, sender.name2].filter(Boolean).join(' '),
      long,
    );
  });

  it('Verzollung: Soloplan-Kunde bleibt Auftraggeber trotz abweichendem Frachtzahler', () => {
    const payload = buildSoloplanFilePayload(
      baseShipment({
        verzollungsauftrag: true,
        customer: {
          customerNumber: '845',
          name: 'Herzog Transportmanagement e.U.',
          matchcode: '845',
        },
        order: {
          externalNumber: 'VLB220900009',
          freightPayer: {
            customerNumber: '845',
            name: 'Heron CNC',
          },
        },
      }),
      { format: 'order' },
    ) as {
      order: Array<{ customer?: { number?: string | number; name1?: string } }>;
    };
    const customer = payload.order[0].customer || {};
    assert.equal(String(customer.number), '845');
    assert.equal(customer.name1, 'Herzog Transportmanagement e.U.');
  });
});
