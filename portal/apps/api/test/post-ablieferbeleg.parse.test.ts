import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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

  it('erkennt Tracking-only Dateiendungen', () => {
    assert.equal(svc.isTrackingOnlyFile('435958.1__99.00.1.json'), true);
    assert.equal(svc.isTrackingOnlyFile('x.track'), true);
    assert.equal(svc.isTrackingOnlyFile('x.txt'), true);
    assert.equal(svc.isTrackingOnlyFile('x.pdf'), false);
  });

  it('parst Tracking-only JSON (Dateiname + Body)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'post-track-'));
    try {
      const file = join(dir, '435958.1__ignored.json');
      writeFileSync(
        file,
        JSON.stringify({
          shipmentNumber: '435958.1',
          postBarcode: '99.00.123456.12345678',
        }),
      );
      const t = svc.parseTrackingOnlyFile(file, '435958.1__ignored.json');
      assert.equal(t.shipmentNumber, '435958.1');
      assert.equal(t.postBarcode, '99.00.123456.12345678');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parst Tracking-only aus Dateiname ohne Body', () => {
    const dir = mkdtempSync(join(tmpdir(), 'post-track-'));
    try {
      const name = '435958.1__99.00.999888.77766655.track';
      const file = join(dir, name);
      writeFileSync(file, '');
      const t = svc.parseTrackingOnlyFile(file, name);
      assert.equal(t.shipmentNumber, '435958.1');
      assert.equal(t.postBarcode, '99.00.999888.77766655');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parst Tracking-only TXT key=value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'post-track-'));
    try {
      const name = 'tracking.txt';
      const file = join(dir, name);
      writeFileSync(
        file,
        'shipmentNumber=440001.2\npostBarcode=99.60.111222.33334444\n',
      );
      const t = svc.parseTrackingOnlyFile(file, name);
      assert.equal(t.shipmentNumber, '440001.2');
      assert.equal(t.postBarcode, '99.60.111222.33334444');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
