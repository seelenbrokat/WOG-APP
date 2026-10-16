import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  linkMobilitySmsAddress,
  normalizePhoneE164,
  phoneDigitsForSmsGateway,
} from './phone-e164';

describe('phone-e164 / LinkMobility', () => {
  it('normalisiert AT-Nummern zu E.164', () => {
    assert.equal(normalizePhoneE164('+43 676 9075070'), '+436769075070');
    assert.equal(normalizePhoneE164('06769075070'), '+436769075070');
    assert.equal(normalizePhoneE164('00436769075070'), '+436769075070');
  });

  it('baut die LinkMobility email2sms-Adresse', () => {
    assert.equal(
      linkMobilitySmsAddress('+436769075070'),
      '436769075070@email2sms.linkmobility.eu',
    );
    assert.equal(phoneDigitsForSmsGateway('+436769075070'), '436769075070');
    assert.equal(linkMobilitySmsAddress('ungueltig'), null);
  });
});
