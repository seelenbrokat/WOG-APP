import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectMercurioEdecDocType,
  extractMercurioEdecFieldsFromPdfText,
  parseMercurioEdecMatchFromFilename,
  parseMercurioEdecMatchFromRef,
} from './mercurio-edec';

describe('mercurio e-dec', () => {
  it('erkennt Doc-Typ und Match aus Dateiname', () => {
    assert.equal(
      detectMercurioEdecDocType('edece-bs-104-443153.1+CON-0-1.pdf'),
      'BEZUGSSCHEIN',
    );
    assert.equal(
      detectMercurioEdecDocType('edece-el-104-442990.1+Diep-0-1.pdf'),
      'EINFUHRLISTE',
    );
    assert.deepEqual(
      parseMercurioEdecMatchFromFilename('edece-bs-104-443153.1+CON-0-1.pdf'),
      {
        kind: 'orderConsignment',
        orderNumber: 443153,
        consignmentIndex: 1,
        mandantCode: '104',
        siteCode: 'CON',
      },
    );
    assert.deepEqual(
      parseMercurioEdecMatchFromFilename('edece-el-104-442990.1+Diep-0-1.pdf'),
      {
        kind: 'orderConsignment',
        orderNumber: 442990,
        consignmentIndex: 1,
        mandantCode: '104',
        siteCode: 'Diep',
      },
    );
  });

  it('liest Match aus Ref-Nr.', () => {
    assert.deepEqual(parseMercurioEdecMatchFromRef('104/443153.1/CON/0/1'), {
      kind: 'orderConsignment',
      orderNumber: 443153,
      consignmentIndex: 1,
      mandantCode: '104',
      siteCode: 'CON',
    });
  });

  it('extrahiert CH-Nummer, Ref, Zugangscode und Konten aus Einfuhrliste', () => {
    const text = `
VORANMELDUNG FREI OHNE Einfuhrliste Definitiv
Zollstelle CH003451 Zoll Ost - Diepoldsau
Positionen:                 1
Anmeld. Nr.: 110525
Ref-Nr.: 104/443153.1/CON/0/1
Ausfuhrdeklaration, 26AT920000XA0DHKA1, ---
Konto Zoll:                 6898-0 WOG Logistics Diepoldsau
Konto MWST:                 6898-0 WOG Logistics Diepoldsau
MWST-Wert gesamt:           53'424
Zollansatz:                           0.00
Andere Gebühren-150, 1, 5.00
26CHEI004419042134.1
Zollanmeldungsnummer:       26CHEI004419042134
Zugangscode:      jzLBdDDNjvFSjRS0
`;
    const fields = extractMercurioEdecFieldsFromPdfText(
      text,
      'edece-el-104-443153.1+CON-0-1.pdf',
    );
    assert.equal(fields.docType, 'EINFUHRLISTE');
    assert.equal(fields.chDeclarationNumber, '26CHEI004419042134');
    assert.equal(fields.refNumber, '104/443153.1/CON/0/1');
    assert.equal(fields.atExportMrn, '26AT920000XA0DHKA1');
    assert.equal(fields.registrationNumber, '110525');
    assert.equal(fields.accessCode, 'jzLBdDDNjvFSjRS0');
    assert.equal(fields.definitiv, true);
    assert.equal(fields.kontoZoll, '6898-0');
    assert.equal(fields.kontoMwst, '6898-0');
    assert.equal(fields.mwstCh, 53424);
    assert.equal(fields.zollabgabenCh, 0);
    assert.equal(fields.bearbeitungsgebuehrCh, 5);
    assert.equal(fields.totalItems, 1);
  });

  it('Zugangscode mit Plus und Konto nur Nummer', () => {
    const text = `
Einfuhrliste Definitiv
Konto Zoll:                 14037-9 WOG Logistics Diepoldsau
Konto MWST:                 14037-9 WOG Logistics Diepoldsau
Zollanmeldungsnummer: 26CHEI004408357547
Zugangscode: xtqzX5+o45JDrMFN
`;
    const fields = extractMercurioEdecFieldsFromPdfText(text, 'edece-el-104-1.1+CON-0-1.pdf');
    assert.equal(fields.chDeclarationNumber, '26CHEI004408357547');
    assert.equal(fields.accessCode, 'xtqzX5+o45JDrMFN');
    assert.equal(fields.kontoZoll, '14037-9');
    assert.equal(fields.kontoMwst, '14037-9');
  });

  it('extrahiert CH-Nummer aus Bezugsschein-Barcode ohne Label', () => {
    const text = `
BEZUGSSCHEIN FREI OHNE VORANMELDUNG
Ref-Nr.: 104/442990.1/Diep/0/1
Ausfuhrdeklaration, 26AT920000RHSGICA2, ---
        26CHEI004419217290.1
                          26CHEI004419217290.1
`;
    const fields = extractMercurioEdecFieldsFromPdfText(
      text,
      'edece-bs-104-442990.1+Diep-0-1.pdf',
    );
    assert.equal(fields.docType, 'BEZUGSSCHEIN');
    assert.equal(fields.chDeclarationNumber, '26CHEI004419217290');
    assert.equal(fields.atExportMrn, '26AT920000RHSGICA2');
  });
});
