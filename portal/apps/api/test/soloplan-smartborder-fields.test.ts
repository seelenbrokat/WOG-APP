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

describe('Soloplan FileAPI – keine SmartBorder-Zusatzproperties', () => {
  it('resolveCustomsFileApiFields enthält keine SmartBorder-Kontaktfelder', () => {
    const fields = resolveCustomsFileApiFields(
      baseShipment({
        kennzeichen: 'W-12345T',
        extras: {
          Telefon_Smartborder: '+436641234567',
          MailSmartborder: 'Info@Beispiel.AT',
          SMSSmartBorder: 'true',
          driverPhone: '+436769075070',
          smartborderNotifyEmail: 'disposition@beispiel.at',
          smartborderSendSms: true,
        },
      }),
    );

    assert.equal(fields.kennzeichen, 'W-12345T');
    assert.equal('telefonSmartborder' in fields, false);
    assert.equal('mailSmartborder' in fields, false);
    assert.equal('smsSmartBorder' in fields, false);
  });

  it('Create-JSON enthält keine Telefon_Smartborder/MailSmartborder/SMSSmartBorder', () => {
    const payload = buildSoloplanFilePayload(
      baseShipment({
        verzollungsauftrag: true,
        kennzeichen: 'W-12345T',
        notes: 'Fahrertelefon: +436769075070',
        extras: {
          Telefon_Smartborder: '+436769075070',
          MailSmartborder: 'disposition@beispiel.at',
          SMSSmartBorder: true,
        },
      }),
      { format: 'order' },
    ) as {
      order: Array<{ consignments: Array<Record<string, unknown>> }>;
    };

    const c = payload.order[0].consignments[0];
    assert.equal(c.kennzeichen, 'W-12345T');
    assert.equal('Telefon_Smartborder' in c, false);
    assert.equal('MailSmartborder' in c, false);
    assert.equal('SMSSmartBorder' in c, false);
  });
});
