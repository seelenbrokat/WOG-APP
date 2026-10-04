import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CUSTOMS_VEHICLE_DEFERRED_BORDER,
  CUSTOMS_VEHICLE_DEFERRED_PLATE,
} from '../src/customs/customs-loading.service';

describe('customs Selbstfahrer Beladung', () => {
  it('deferred Platzhalter sind gesetzt (kein SIPO)', () => {
    assert.equal(CUSTOMS_VEHICLE_DEFERRED_PLATE, 'OFFEN');
    assert.equal(CUSTOMS_VEHICLE_DEFERRED_BORDER, 'OFFEN');
  });
});
