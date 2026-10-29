import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSchmidtsLadelisteText } from '../src/shipments/schmidts-ladeliste.parser';

describe('Schmidts-Ladeliste Parser – mehrzeiliger Empfänger', () => {
  it('trennt Name-Zeilen und Straße (LAK12296296 Ospelt)', () => {
    const text = `
Ladeliste: 29.10.2026
SCHMIDT'S Handelsgesellschaft mbH
LAK12296296 (Zustellung)
Kunde: SCHMIDT'S Handelsgesellschaft mbH
Absender: SCHMIDT'S Handelsgesellschaft mbH, 6706
Empfänger: Herbert Ospelt Anstalt Zentrale
Werkstätte TN Lager
Zentrale Werkstätte TN Lager
Schaanerstrasse 79
LI-9487 Bendern
Tel 1.: 0041583771000
Absender-Ref.:
Empfänger-Ref.: 910270121,
Frachtzahler-Ref.: KOM5871806
Zustellservice: Standard, 29.10.2026 bis 17:00
00369999990004281747 1 1/4 PAL 60x40 60 x 40 x 54,00 kg SDS
Gesamt: 1 Colli 0,25 STP 54,00 kg
Gesamt: 1 Colli 54,00 kg
`.trim();

    const parsed = parseSchmidtsLadelisteText(text);
    assert.equal(parsed.lines.length, 1);
    const line = parsed.lines[0];
    assert.equal(line.lak, 'LAK12296296');
    assert.equal(line.recipientName, 'Herbert Ospelt Anstalt Zentrale');
    assert.deepEqual(line.recipientNameExtra, [
      'Werkstätte TN Lager',
      'Zentrale Werkstätte TN Lager',
    ]);
    assert.equal(line.recipientStreet, 'Schaanerstrasse 79');
    assert.equal(line.recipientZip, '9487');
    assert.equal(line.recipientCity, 'Bendern');
    assert.equal(line.recipientCountry, 'LI');
    assert.ok((line.recipientStreet || '').length <= 60);
  });
});
