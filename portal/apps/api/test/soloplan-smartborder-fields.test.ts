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
  it('mapped Telefon_Smartborder, MailSmartborder, SMSSmartBorder', () => {
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

  it('akzeptiert Schema-Keys auch aus extras', () => {
    const fields = resolveCustomsFileApiFields(
      baseShipment({
        extras: {
          Telefon_Smartborder: '+436641234567',
          MailSmartborder: 'Info@Beispiel.AT',
          SMSSmartBorder: 'true',
        },
      }),
    );

    assert.equal(fields.telefonSmartborder, '+436641234567');
    assert.equal(fields.mailSmartborder, 'info@beispiel.at');
    assert.equal(fields.smsSmartBorder, true);
  });

  it('schreibt Exact-Keys in OrderImportPORTAL-v6 Create-JSON', () => {
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
      order: Array<{ consignments: Array<Record<string, unknown>> }>;
    };

    const c = payload.order[0].consignments[0];
    assert.equal(c.Telefon_Smartborder, '+436769075070');
    assert.equal(c.MailSmartborder, 'disposition@beispiel.at');
    assert.equal(c.SMSSmartBorder, true);
    assert.equal(c.kennzeichen, 'W-12345T');
  });
});
