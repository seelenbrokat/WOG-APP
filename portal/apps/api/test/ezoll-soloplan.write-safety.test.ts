import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { EzollSoloplanService } from '../src/customs/ezoll-soloplan.service';

function makeService(root: string, rootMode = 'consignment') {
  const config = {
    get: (key: string) => {
      if (key === 'SOLOPLAN_EZOLL_OUT_DIR') return root;
      if (key === 'SOLOPLAN_EZOLL_ROOT') return rootMode;
      return undefined;
    },
  } as ConfigService;
  return new EzollSoloplanService(config);
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('OrderEzoll Write-Safety (vor Re-Enable)', () => {
  it('EZ922: Lookup über ordernumber.number + itemNumber, Felder korrekt', () => {
    const root = mkdtempSync(join(tmpdir(), 'ezoll-ez922-'));
    try {
      const svc = makeService(root);
      const path = svc.writeEz92xUpdate(
        { kind: 'orderConsignment', orderNumber: 441929, consignmentIndex: 1 },
        '441929.1_EZ922.xml',
        {
          msgTyp: 'EZ922',
          crn: '26ATCRNTEST000001',
          abgabenkonto: 'AT123456',
          mwstAt: 120.5,
          zollabgabenAt: 40.25,
          totalItems: 3,
          eur1Number: 'T0795166',
        },
      );

      const json = readJson(path);
      assert.ok(Array.isArray(json.consignment));
      const row = (json.consignment as Array<Record<string, unknown>>)[0];

      // OrderEzollDuplicat-v5: kein bare Integer → ObjectExpected vermeiden
      assert.deepEqual(row.ordernumber, { number: 441929 });
      assert.equal(row.itemNumber, 1);
      assert.equal(row.actionAttribute, 'update');
      assert.equal(row.eZ922, true);
      assert.equal(row.mRNATAPI, '26ATCRNTEST000001');
      assert.equal(row.aufschubkonto, 'AT123456');
      assert.equal(row.mWSTAT, 120.5);
      assert.equal(row.zollabgabenAT, 40.25);
      assert.equal(row.tarifnummerATAPI, 3);
      assert.equal(row.eUR1_API, 'T0795166');
      assert.equal(typeof row.ordernumber, 'object');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('order-only Match setzt itemNumber=1 und ordernumber-Lookup', () => {
    const root = mkdtempSync(join(tmpdir(), 'ezoll-order-only-'));
    try {
      const svc = makeService(root);
      const path = svc.writeCc529FlagUpdate(
        { kind: 'order', orderNumber: 441929 },
        '441929_CC529CC.pdf',
        { mrn: '26ATMRN', lrn: null, totalItems: null, eur1Number: 'X 613179' },
      );

      const json = readJson(path);
      const row = (json.consignment as Array<Record<string, unknown>>)[0];
      assert.deepEqual(row.ordernumber, { number: 441929 });
      assert.equal(row.itemNumber, 1);
      assert.equal(row.cC529C, true);
      assert.equal(row.eUR1_API, 'X 613179');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('Tour-Match darf kein Consignment-Update schreiben', () => {
    const root = mkdtempSync(join(tmpdir(), 'ezoll-tour-reject-'));
    try {
      const svc = makeService(root);
      assert.throws(
        () =>
          svc.writeCc529FlagUpdate(
            { kind: 'tour', tourNumber: 180001 },
            '180001_CC529CC.pdf',
          ),
        /Auftrag\/Sendung|Tour/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('order-Root: nested order.number + consignments.itemNumber nach consignment/', () => {
    const root = mkdtempSync(join(tmpdir(), 'ezoll-order-root-'));
    try {
      const svc = makeService(root, 'order');
      const path = svc.writeCc529FlagUpdate(
        { kind: 'orderConsignment', orderNumber: 443153, consignmentIndex: 1 },
        '443153.1_C ROBO_HEL_P_CC529CC.pdf',
        {
          mrn: '26AT920000XA0DHKA1',
          lrn: '443153.1/C ROBO/HELP',
          totalItems: 1,
          eur1Number: null,
        },
      );

      // Pickup-Pfad bleibt consignment/ (Automate), JSON-Root ist nested order
      assert.match(path, /[/\\]consignment[/\\]/);
      const json = readJson(path);
      assert.equal(json.consignment, undefined);
      assert.ok(Array.isArray(json.order));
      const order = (json.order as Array<Record<string, unknown>>)[0];
      assert.equal(order.actionAttribute, 'update');
      assert.equal(order.number, 443153);
      assert.ok(Array.isArray(order.consignments));
      const row = (order.consignments as Array<Record<string, unknown>>)[0];
      assert.equal(row.itemNumber, 1);
      assert.equal(row.cC529C, true);
      assert.equal(row.mRNATAPI, '26AT920000XA0DHKA1');
      assert.equal(row.lRN, '443153.1/C ROBO/HELP');
      assert.equal(row.tarifnummerATAPI, 1);
      assert.equal(row.ordernumber, undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('Mercurio EL: zugangscode + mRNAPI Order-Root', () => {
    const root = mkdtempSync(join(tmpdir(), 'ezoll-mercurio-el-'));
    try {
      const svc = makeService(root, 'order');
      const path = svc.writeMercurioEdecUpdate(
        { kind: 'orderConsignment', orderNumber: 443153, consignmentIndex: 1 },
        'edece-el-104-443153.1+CON-0-1.pdf',
        {
          docType: 'EINFUHRLISTE',
          chDeclarationNumber: '26CHEI004419042134',
          refNumber: '104/443153.1/CON/0/1',
          atExportMrn: '26AT920000XA0DHKA1',
          registrationNumber: '110525',
          accessCode: 'xtqzX5+o45JDrMFN',
          definitiv: true,
          kontoZoll: '14037-9',
          kontoMwst: '14037-9',
          zazKonto: null,
          mwstCh: null,
          zollabgabenCh: null,
          bearbeitungsgebuehrCh: null,
          totalItems: 1,
          bordereauNumber: null,
          veranlagungMwst: null,
          veranlagungZoll: null,
        },
      );

      assert.match(path, /[/\\]consignment[/\\]/);
      const json = readJson(path);
      const order = (json.order as Array<Record<string, unknown>>)[0];
      assert.equal(order.number, 443153);
      const row = (order.consignments as Array<Record<string, unknown>>)[0];
      assert.equal(row.itemNumber, 1);
      assert.equal(row.einfuhrliste, true);
      assert.equal(row.definitiv, true);
      assert.equal(row.mRNAPI, '26CHEI004419042134');
      assert.equal(row.zollanmeldungsnummer, '26CHEI004419042134');
      assert.equal(row.zugangscode, 'xtqzX5+o45JDrMFN');
      assert.equal(row.refNr, '104/443153.1/CON/0/1');
      assert.equal(row.kontoZoll, '14037-9');
      assert.equal(row.kontoMWST, '14037-9');
      assert.equal(row.mWSTCH, undefined);
      assert.equal(row.tarifnummernCHAPI, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('order-Root Mercurio eVV MWST: mWSTCH + Bordereau + Flag', () => {
    const root = mkdtempSync(join(tmpdir(), 'ezoll-order-evv-'));
    try {
      const svc = makeService(root, 'order');
      const path = svc.writeMercurioEdecUpdate(
        { kind: 'orderConsignment', orderNumber: 444230, consignmentIndex: 1 },
        'edece_evvvat-edeceinfuhr-104-444230.1+CON-0-1.pdf',
        {
          docType: 'EVV_MWST',
          chDeclarationNumber: '26CHEI004427317513',
          refNumber: '104/444230.1/CON/0/1',
          atExportMrn: null,
          registrationNumber: '110682',
          accessCode: 'ebN9HRo!e8QJVkOg',
          definitiv: true,
          kontoZoll: null,
          kontoMwst: '6898-0',
          zazKonto: null,
          mwstCh: 184.5,
          zollabgabenCh: null,
          bearbeitungsgebuehrCh: null,
          totalItems: 1,
          bordereauNumber: '1510331',
          veranlagungMwst: true,
          veranlagungZoll: null,
        },
      );
      const json = readJson(path);
      const order = (json.order as Array<Record<string, unknown>>)[0];
      const row = (order.consignments as Array<Record<string, unknown>>)[0];
      assert.equal(row.mWSTCH, 184.5);
      assert.equal(row.bordereaunummer, 1510331);
      assert.equal(typeof row.bordereaunummer, 'number');
      assert.equal(row.veranlagungsverfügungMWST, true);
      assert.equal(row.zugangscode, 'ebN9HRo!e8QJVkOg');
      assert.equal(row.kontoMWST, '6898-0');
      assert.equal(row.tarifnummernCHAPI, 1);
      assert.equal(row.definitiv, true);
      assert.equal(row.mRNAPI, '26CHEI004427317513');
      assert.equal(row.zollanmeldungsnummer, '26CHEI004427317513');
      assert.equal(row.refNr, '104/444230.1/CON/0/1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('order-Root Mercurio eVV Zoll: zollabgabenCH=0 + Flag + Integer-Bordereau', () => {
    const root = mkdtempSync(join(tmpdir(), 'ezoll-order-evvz-'));
    try {
      const svc = makeService(root, 'order');
      const path = svc.writeMercurioEdecUpdate(
        { kind: 'orderConsignment', orderNumber: 444230, consignmentIndex: 1 },
        'edece_evvdut-edeceinfuhr-104-444230.1+CON-0-1.pdf',
        {
          docType: 'EVV_ZOLL',
          chDeclarationNumber: '26CHEI004427317513',
          refNumber: '104/444230.1/CON/0/1',
          atExportMrn: null,
          registrationNumber: '110682',
          accessCode: 'ebN9HRo!e8QJVkOg',
          definitiv: true,
          kontoZoll: '6898-0',
          kontoMwst: null,
          zazKonto: null,
          mwstCh: null,
          zollabgabenCh: 0,
          bearbeitungsgebuehrCh: null,
          totalItems: 1,
          bordereauNumber: '1510331',
          veranlagungMwst: null,
          veranlagungZoll: true,
        },
      );
      const json = readJson(path);
      const order = (json.order as Array<Record<string, unknown>>)[0];
      const row = (order.consignments as Array<Record<string, unknown>>)[0];
      assert.equal(row.zollabgabenCH, 0);
      assert.equal(row.mWSTCH, undefined);
      assert.equal(row.bordereaunummer, 1510331);
      assert.equal(row.veranlagungsverfügungZoll, true);
      assert.equal(row.kontoZoll, '6898-0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('order-Root CC599: nur Flag unter nested consignments', () => {
    const root = mkdtempSync(join(tmpdir(), 'ezoll-order-cc599-'));
    try {
      const svc = makeService(root, 'order');
      const path = svc.writeCc599FlagUpdate(
        { kind: 'orderConsignment', orderNumber: 443153, consignmentIndex: 1 },
        '443153.1_C_ROBO_HEL_P_CC599CC.pdf',
        { mrn: null, lrn: null, totalItems: null, eur1Number: null },
        false,
      );

      assert.match(path, /[/\\]consignment[/\\]/);
      const json = readJson(path);
      const order = (json.order as Array<Record<string, unknown>>)[0];
      assert.equal(order.number, 443153);
      const row = (order.consignments as Array<Record<string, unknown>>)[0];
      assert.equal(row.itemNumber, 1);
      assert.equal(row.cC599C, true);
      assert.equal(row.mRNATAPI, undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
