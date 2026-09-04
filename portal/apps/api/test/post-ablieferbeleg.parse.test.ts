import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PostAblieferbelegService } from '../src/integrations/post-ablieferbeleg.service';

/** Leichtgewichtiger Parser-Test ohne Nest-DI. */
describe('Post-Ablieferbeleg Dateiname', () => {
  const svc = Object.create(PostAblieferbelegService.prototype) as PostAblieferbelegService;

  it('parst Auftrag.Position + Barcode', () => {
    const p = svc.parseInboundFileName('435958.1__99.00.123456.12345678.pdf');
    assert.equal(p.shipmentNumber, '435958.1');
    assert.equal(p.postBarcode, '99.00.123456.12345678');
  });

  it('parst Tracking + POD-Marker', () => {
    const p = svc.parseInboundFileName('WOG2608ABCDEF__POD__beleg.pdf');
    assert.equal(p.trackingNumber, 'WOG2608ABCDEF');
  });

  it('parst nur Auftragsnummer', () => {
    const p = svc.parseInboundFileName('435958__POD__x.pdf');
    assert.equal(p.orderNumber, '435958');
  });
});
