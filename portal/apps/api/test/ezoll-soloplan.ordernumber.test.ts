import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { EzollSoloplanService } from '../src/customs/ezoll-soloplan.service';

describe('EzollSoloplanService OrderEzollDuplicat-v5', () => {
  it('schreibt ordernumber als Interface-Lookup { number }, nicht als Integer', () => {
    const root = mkdtempSync(join(tmpdir(), 'ezoll-ordernumber-'));
    try {
      const config = {
        get: (key: string) => {
          if (key === 'SOLOPLAN_EZOLL_OUT_DIR') return root;
          if (key === 'SOLOPLAN_EZOLL_ROOT') return 'consignment';
          return undefined;
        },
      } as ConfigService;

      const svc = new EzollSoloplanService(config);
      const path = svc.writeCc529FlagUpdate(
        { kind: 'orderConsignment', orderNumber: 441929, consignmentIndex: 1 },
        '441929.1_CC529CC.pdf',
        {
          mrn: '26ATTEST1234567890',
          lrn: '441929.1/C TEST',
          totalItems: 2,
          eur1Number: null,
        },
      );

      const json = JSON.parse(readFileSync(path, 'utf8')) as {
        consignment: Array<Record<string, unknown>>;
      };

      assert.ok(Array.isArray(json.consignment));
      assert.equal(json.consignment.length, 1);

      const row = json.consignment[0];
      assert.equal(typeof row.ordernumber, 'object');
      assert.notEqual(typeof row.ordernumber, 'number');
      assert.deepEqual(row.ordernumber, { number: 441929 });
      assert.equal(row.itemNumber, 1);
      assert.equal(row.cC529C, true);
      assert.equal(row.mRNATAPI, '26ATTEST1234567890');
      assert.equal(row.lRN, '441929.1/C TEST');
      assert.equal(row.tarifnummerATAPI, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
