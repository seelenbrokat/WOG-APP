import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractEur1NumberFromEz92xXml,
  extractEz92xFieldsFromXml,
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

describe('ezoll EZ92x EUR.1 (N954)', () => {
  it('liest EUR.1 aus DocCerts N954 / DRef', () => {
    const xml = `<?xml version="1.0"?>
      <Msg><MsgTyp>EZ923</MsgTyp>
        <Refs><CRN>26AT930200INR9CXW2</CRN></Refs>
        <Hea><TotItem>1</TotItem><DefPayRef>5500109</DefPayRef></Hea>
        <GdsItem>
          <DocCerts><DocCd>N864</DocCd><DRef>SZ100311</DRef></DocCerts>
          <DocCerts><DocCd>N954</DocCd><DRef>T 0735872</DRef><Avail>1</Avail></DocCerts>
          <DutyCalc><Ty>5EV</Ty><Amnt>10</Amnt></DutyCalc>
        </GdsItem>
      </Msg>`;
    const fields = extractEz92xFieldsFromXml(xml);
    assert.ok(fields);
    assert.equal(fields!.msgTyp, 'EZ923');
    assert.equal(fields!.eur1Number, 'T 0735872');
    assert.equal(extractEur1NumberFromEz92xXml(xml), 'T 0735872');
  });

  it('ignoriert N864 und liefert null ohne N954', () => {
    const xml = `<?xml version="1.0"?>
      <Msg><MsgTyp>EZ922</MsgTyp>
        <Refs><CRN>26ATTEST</CRN></Refs>
        <Hea><TotItem>1</TotItem></Hea>
        <GdsItem>
          <DocCerts><DocCd>N864</DocCd><DRef>SZ100311</DRef></DocCerts>
        </GdsItem>
      </Msg>`;
    const fields = extractEz92xFieldsFromXml(xml);
    assert.ok(fields);
    assert.equal(fields!.eur1Number, null);
  });
});
