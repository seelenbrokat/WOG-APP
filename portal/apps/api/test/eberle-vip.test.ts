import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  assertNoVipPrices,
  buildVipFile,
  formatVipDate,
  mapVipCountry,
  mapVipUnit,
} from '../src/integrations/eberle/vip.builder';
import {
  isVipStatusContent,
  parseVipStatus,
  vipStatusMatchKeys,
} from '../src/integrations/eberle/vip-status.parser';
import { mapVipStatusToTransportOrderStatus } from '../src/integrations/eberle/vip-status-to-telematics';
import type { VipShipmentInput } from '../src/integrations/eberle/vip.types';

describe('eberle VIP Builder', () => {
  const sample: VipShipmentInput = {
    orderNumber: '929841',
    deliveryNote: '433366.1',
    orderDate: new Date('2026-07-26T08:00:00'),
    loadingFrom: new Date('2026-07-26T08:00:00'),
    loadingUntil: new Date('2026-07-26T11:30:00'),
    unloadingFrom: new Date('2026-07-26T14:00:00'),
    unloadingUntil: new Date('2026-07-26T17:00:00'),
    sender: {
      name: 'SUN AG',
      street: 'Friedberg 234',
      country: 'CH',
      zip: '9427',
      city: 'Wolfhalden',
    },
    receiver: {
      name: 'MH Direkt e-commerce',
      name2: '& Co KG',
      street: 'Reitschulstraße 7',
      country: 'A',
      zip: '6923',
      city: 'Lauterach',
      contactName: 'Service',
    },
    palletCount: 3,
    goods: [
      {
        position: 1,
        quantity: 3,
        unit: 'EP',
        content: 'Pakete',
        weightKg: 1850,
        lengthCm: 120,
        widthCm: 80,
        heightCm: 110,
      },
    ],
  };

  it('baut K- und L-Zeile ohne Preise', () => {
    const content = buildVipFile([sample], { anr: '890037' });
    assertNoVipPrices(content);
    const lines = content.split(/\r?\n/).filter(Boolean);
    assert.equal(lines[0].startsWith('K;890037;929841;'), true);
    assert.equal(lines[1].startsWith('L;890037;929841;1;'), true);
    const k = lines[0].split(';');
    assert.equal(k[13], 'SUN AG'); // VNAME
    assert.equal(k[15], 'CH');
    assert.equal(k[26], 'MH Direkt e-commerce');
    assert.equal(k[28], 'AT'); // A → AT
    assert.equal(k[36], ''); // VBET leer
    assert.equal(k[37], ''); // NNBET leer
    assert.equal(k[58], '3'); // PAL
    const l = lines[1].split(';');
    assert.equal(l[6], 'Pal');
    assert.equal(l[17], '1850.000');
  });

  it('CR/LF und kein Semikolon in Textfeldern', () => {
    const dirty: VipShipmentInput = {
      ...sample,
      sender: { ...sample.sender, name: 'Firma; Test\nZeile' },
    };
    const content = buildVipFile([dirty], { anr: '890037', lineEnding: '\r\n' });
    assert.match(content, /\r\n/);
    assert.equal(content.includes('Firma, Test Zeile'), true);
    assert.equal(content.includes('Firma;'), false);
  });

  it('Hilfsfunktionen Datum/Land/Einheit', () => {
    assert.equal(formatVipDate(new Date(2026, 2, 11)), '2026.03.11');
    assert.equal(mapVipCountry('A'), 'AT');
    assert.equal(mapVipUnit('EP'), 'Pal');
  });
});

describe('eberle VIP Status', () => {
  const samplePath = join(__dirname, '../../../data/samples/eberle/status-sample.txt');

  it('erkennt und parst gpANLAGE-Status', () => {
    const content = readFileSync(samplePath, 'utf8');
    assert.equal(isVipStatusContent(content), true);
    const msg = parseVipStatus(content);
    assert.equal(msg.events.length, 2);
    assert.equal(msg.events[0].statusCode, 'B001-G0030');
    assert.equal(msg.events[1].statusCode, 'B001-G0031');
    assert.equal(msg.events[0].deliveryNote, 'LS-500296-007');
    assert.ok(msg.events[0].eventAt);
  });

  it('mappt Abholung und Auslieferung', () => {
    const content = readFileSync(samplePath, 'utf8');
    const msg = parseVipStatus(content);
    const pickup = mapVipStatusToTransportOrderStatus(msg.events[0]);
    const delivery = mapVipStatusToTransportOrderStatus(msg.events[1]);
    assert.equal(pickup?.status, 'LoadingFinished');
    assert.equal(delivery?.status, 'UnloadingFinished');
    assert.equal(delivery?.delivered, true);
    assert.ok(vipStatusMatchKeys(msg.events[0]).includes('LS-500296-007'));
  });
});
