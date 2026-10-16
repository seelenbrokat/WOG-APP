import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Regression: TourConsignment.soloplanOrderNumber = Soloplan-TO (z. B. 989353),
 * orderNumber = CarLo-Auftrag (z. B. 462291) = Portal Shipment.soloplanRef.
 * Ohne orderNumber im Match landet der Ablieferbeleg nur als TourDocument,
 * nicht an der Quehenberger-Portal-Sendung (Prod: TO 989353 / Sendung 462291.1).
 */
describe('Ablieferbeleg TO → Portal-Auftrag Match', () => {
  it('leitet CarLo-Auftragsnummer aus TourConsignment ab', () => {
    const transportOrderNumber = '989353';
    const cons = {
      soloplanOrderNumber: '989353',
      orderNumber: '462291',
      consignmentIndex: 1,
      externalConsignmentNumber: 'A-21950637-A-1',
    };

    const candidates = new Set<string>([transportOrderNumber]);
    if (cons.soloplanOrderNumber) candidates.add(cons.soloplanOrderNumber);
    if (cons.externalConsignmentNumber) candidates.add(cons.externalConsignmentNumber);
    if (cons.orderNumber) {
      candidates.add(String(cons.orderNumber));
      if (cons.consignmentIndex != null && cons.consignmentIndex > 0) {
        candidates.add(`${cons.orderNumber}.${cons.consignmentIndex}`);
      }
    }

    const list = [...candidates];
    assert.ok(list.includes('462291'), 'CarLo-Auftrag muss im Match sein');
    assert.ok(list.includes('462291.1'), 'Sendungsnummer muss im Match sein');
    assert.ok(list.includes('989353'), 'TO bleibt als Kandidat');
    assert.ok(list.includes('A-21950637-A-1'));

    const portalSoloplanRef = '462291';
    assert.ok(
      list.includes(portalSoloplanRef),
      'Portal-Sendung mit soloplanRef=462291 muss gefunden werden',
    );
  });
});
