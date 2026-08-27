import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectMercurioEdecDocType,
  extractMercurioBordereauFieldsFromPdfText,
  extractMercurioEdecFieldsFromPdfText,
  extractMercurioEur1FromPdfText,
  parseMercurioAusfuhrGdrnFromFilename,
  parseMercurioEdecMatchFromFilename,
  parseMercurioEdecMatchFromRef,
  parseMercurioBordereauNumberFromFilename,
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
    assert.equal(
      detectMercurioEdecDocType('edece_evvvat-edeceinfuhr-104-444230.1+CON-0-1.pdf'),
      'EVV_MWST',
    );
    assert.equal(
      detectMercurioEdecDocType('edece_evvdut-edeceinfuhr-104-444230.1+CON-0-1.pdf'),
      'EVV_ZOLL',
    );
    assert.equal(
      detectMercurioEdecDocType(
        'edece_bordereau_104_68980_CHE409812868_1557466_72_20260824.pdf',
      ),
      'BORDEREAU',
    );
    assert.equal(
      detectMercurioEdecDocType(
        'ausfuhr_wa-a_wa_1000012896_104_417181.1Diep_0_1_26CH06EXGSPQ2YZ2N5.pdf',
      ),
      'AUSFUHR_WA',
    );
    assert.equal(
      detectMercurioEdecDocType(
        'ausfuhr_wa-a_vv_1000012896_104_417181.1Diep_0_1_26CH06EXGSPQ2YZ2N5.pdf',
      ),
      'AUSFUHR_VV',
    );
    assert.equal(
      detectMercurioEdecDocType(
        'durchfuhr_wa-d_vbd-grenze_1000012896_104_180485_1_1_26CH06NN5L604AK9J2.pdf',
      ),
      'DURCHFUHRT',
    );
    assert.equal(
      detectMercurioEdecDocType(
        'transportanmeldung_ta_dts_1000012896_104_180459_0_1_2606sQjAd.pdf',
      ),
      'TRANSPORT_DTS',
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
      parseMercurioEdecMatchFromFilename(
        'ausfuhr_wa-a_vv_1000012896_104_417181.1Diep_0_1_26CH06EXGSPQ2YZ2N5.pdf',
      ),
      {
        kind: 'orderConsignment',
        orderNumber: 417181,
        consignmentIndex: 1,
        mandantCode: '104',
        siteCode: 'Diep',
      },
    );
    assert.equal(
      parseMercurioAusfuhrGdrnFromFilename(
        'ausfuhr_wa-a_wa_1000012896_104_417181.1Diep_0_1_26CH06EXGSPQ2YZ2N5.pdf',
      ),
      '26CH06EXGSPQ2YZ2N5',
    );
    assert.deepEqual(
      parseMercurioEdecMatchFromFilename(
        'edece_evvvat-edeceinfuhr-104-444230.1+CON-0-1.pdf',
      ),
      {
        kind: 'orderConsignment',
        orderNumber: 444230,
        consignmentIndex: 1,
        mandantCode: '104',
        siteCode: 'CON',
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

  it('Einfuhrliste: Meta ja, Beträge nein (kommen aus eVV)', () => {
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
    assert.equal(fields.mwstCh, null);
    assert.equal(fields.zollabgabenCh, null);
    assert.equal(fields.bearbeitungsgebuehrCh, null);
    assert.equal(fields.totalItems, 1);
  });

  it('eVV MWST: Gesamtbetrag + Bordereau + Flag', () => {
    const text = `
VERANLAGUNGSVERFÜGUNG MWST Import Definitiv
Bordereaunummer: 1510331
Konto MWST:       68980-WOG Logistics Diepoldsau
Gesamtbetrag MWST [CHF]:                          184.50
Anmeld. Nr: 110682
Ref-Nr.: 104/444230.1/CON/0/1
Zollanmeldungsnummer: 26CHEI004427317513
Zugangscode: ebN9HRo!e8QJVkOg
`;
    const fields = extractMercurioEdecFieldsFromPdfText(
      text,
      'edece_evvvat-edeceinfuhr-104-444230.1+CON-0-1.pdf',
    );
    assert.equal(fields.docType, 'EVV_MWST');
    assert.equal(fields.mwstCh, 184.5);
    assert.equal(fields.bordereauNumber, '1510331');
    assert.equal(fields.veranlagungMwst, true);
    assert.equal(fields.veranlagungZoll, null);
    assert.equal(fields.chDeclarationNumber, '26CHEI004427317513');
    assert.equal(fields.accessCode, 'ebN9HRo!e8QJVkOg');
    assert.equal(fields.refNumber, '104/444230.1/CON/0/1');
    // eVV „68980-WOG“ → Ziffern ohne Bindestrich (Write macht 68980)
    assert.equal(fields.kontoMwst, '68980');
    assert.equal(fields.definitiv, true);
  });

  it('eVV Zoll: Zollabgaben + Flag + Konto', () => {
    const text = `
VERANLAGUNGSVERFÜGUNG ZOLL Import Definitiv
Bordereaunummer: 1510331
Konto Zoll:      68980-WOG Logistics Diepoldsau
Zollabgaben                                       0.00
Gesamtbetrag:                                     0.00
Ref-Nr.: 104/444230.1/CON/0/1
Zollanmeldungsnummer: 26CHEI004427317513
`;
    const fields = extractMercurioEdecFieldsFromPdfText(
      text,
      'edece_evvdut-edeceinfuhr-104-444230.1+CON-0-1.pdf',
    );
    assert.equal(fields.docType, 'EVV_ZOLL');
    assert.equal(fields.zollabgabenCh, 0);
    assert.equal(fields.veranlagungZoll, true);
    assert.equal(fields.bordereauNumber, '1510331');
    assert.equal(fields.kontoZoll, '68980');
  });

  it('Bordereau: Nr. aus Dateiname + VVZ/VVM-Zeilen', () => {
    assert.equal(
      parseMercurioBordereauNumberFromFilename(
        'edece_bordereau_104_68980_CHE409812868_1557466_72_20260824.pdf',
      ),
      '1557466',
    );
    const text = `
BORDEREAU DER ABGABEN
1557466
VVZ 104/445921.1/Diep/0/1 26CHEI004440158958.1                   0.00
VVM 104/445921.1/Diep/0/1 26CHEI004440158958.1                160.20
`;
    const b = extractMercurioBordereauFieldsFromPdfText(
      text,
      'edece_bordereau_104_68980_CHE409812868_1557466_72_20260824.pdf',
    );
    assert.equal(b.bordereauNumber, '1557466');
    assert.equal(b.lines.length, 2);
    assert.equal(b.lines[0].kind, 'VVZ');
    assert.equal(b.lines[0].match.orderNumber, 445921);
    assert.equal(b.lines[1].kind, 'VVM');
    assert.equal(b.lines[1].amountChf, 160.2);
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

  it('Passar Ausfuhr WA: GDRN + Zugangscode eVV + Ref, ohne Beträge', () => {
    const text = `
WARENANMELDUNG AUSFUHR
ordentlich
GDRN:                                    26CH06EXGSPQ2YZ2N5
Zugangscode eVV:                         2BsKQtCdngNdZPsH
Positionen total           1
104/417181.1/Diep/0
1                                                   9603.4000
`;
    const fields = extractMercurioEdecFieldsFromPdfText(
      text,
      'ausfuhr_wa-a_wa_1000012896_104_417181.1Diep_0_1_26CH06EXGSPQ2YZ2N5.pdf',
    );
    assert.equal(fields.docType, 'AUSFUHR_WA');
    assert.equal(fields.chDeclarationNumber, '26CH06EXGSPQ2YZ2N5');
    assert.equal(fields.accessCode, '2BsKQtCdngNdZPsH');
    assert.equal(fields.refNumber, '104/417181.1/Diep/0');
    assert.equal(fields.totalItems, 1);
    assert.equal(fields.mwstCh, null);
    assert.equal(fields.zollabgabenCh, null);
    assert.equal(fields.definitiv, null);
  });

  it('Passar Ausfuhr VV: GDRN ohne Suffix + EUR.1 + definitiv', () => {
    const text = `
VERANLAGUNGSVERFÜGUNG AUSFUHR
GDRN:                                                      26CH06EXVOIW7XIEN8.1
104/424111.2/DIEP/0
Begleitdokument (Typ, Ref.Nr.)   1. WVB EUR.1, T 0691198
1                                                   9603.4000
2                                                   3926.9000
`;
    const fields = extractMercurioEdecFieldsFromPdfText(
      text,
      'ausfuhr_wa-a_vv_1000012896_104_424111.2DIEP_0_1_26CH06EXVOIW7XIEN8.pdf',
    );
    assert.equal(fields.docType, 'AUSFUHR_VV');
    assert.equal(fields.chDeclarationNumber, '26CH06EXVOIW7XIEN8');
    assert.equal(fields.definitiv, true);
    assert.equal(fields.eur1Number, 'T 0691198');
    assert.equal(fields.totalItems, 2);
    assert.equal(fields.mwstCh, null);
  });

  it('EUR.1 Varianten T/R/S, digital ignorieren', () => {
    assert.equal(
      extractMercurioEur1FromPdfText('1. WVB EUR.1, T 0691146'),
      'T 0691146',
    );
    assert.equal(
      extractMercurioEur1FromPdfText('1. WVB EUR.1, R0252843'),
      'R0252843',
    );
    assert.equal(
      extractMercurioEur1FromPdfText('1. WVB EUR.1, S 0981912'),
      'S 0981912',
    );
    assert.equal(
      extractMercurioEur1FromPdfText('1. WVB EUR.1 digital, 260-123'),
      null,
    );
  });
});
