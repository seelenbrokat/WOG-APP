import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSoloplanMatchFromFilename,
  parseSoloplanMatchFromLrn,
} from './ezoll-doc-types';

describe('ezoll Soloplan-Match', () => {
  it('liest Auftrag.Sendung aus Dateiname', () => {
    assert.deepEqual(parseSoloplanMatchFromFilename('441929.1_CC529CC.pdf'), {
      kind: 'orderConsignment',
      orderNumber: 441929,
      consignmentIndex: 1,
    });
    assert.deepEqual(
      parseSoloplanMatchFromFilename('1786307468677_442397.1_CC529CC.pdf'),
      {
        kind: 'orderConsignment',
        orderNumber: 442397,
        consignmentIndex: 1,
      },
    );
  });

  it('liest Auftrag.Sendung aus LRN', () => {
    assert.deepEqual(parseSoloplanMatchFromLrn('441929.1/C TEAM/POR'), {
      kind: 'orderConsignment',
      orderNumber: 441929,
      consignmentIndex: 1,
    });
  });
});
