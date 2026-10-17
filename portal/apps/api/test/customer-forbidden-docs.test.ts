import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isForbiddenForCustomerDocument } from '../src/documents/customer-forbidden-docs';

describe('isForbiddenForCustomerDocument', () => {
  it('sperrt CH Bordereau für Kunden', () => {
    assert.equal(
      isForbiddenForCustomerDocument({
        fileName: 'CH Bordereau 1835982.pdf',
        type: 'CUSTOMS_PAPER',
        source: 'MERCURIO',
        categoryCode: null,
      }),
      true,
    );
    assert.equal(
      isForbiddenForCustomerDocument({
        fileName: 'x.pdf',
        sourceFileName: 'edece_bordereau_104_68980_CHE_1835982_72_20261003.pdf',
        type: 'CUSTOMS_PAPER',
        source: 'MERCURIO',
      }),
      true,
    );
  });

  it('lässt Austrittsbestätigung (CUSTOMS_EXIT) zu', () => {
    assert.equal(
      isForbiddenForCustomerDocument({
        fileName: 'Austritt.pdf',
        type: 'CUSTOMS_PAPER',
        categoryCode: 'CUSTOMS_EXIT',
        source: 'EZOLL',
      }),
      false,
    );
  });

  it('lässt normale Kunden-Uploads / POD zu', () => {
    assert.equal(
      isForbiddenForCustomerDocument({
        fileName: 'rechnung.pdf',
        type: 'INVOICE',
        categoryCode: 'INVOICE',
      }),
      false,
    );
    assert.equal(
      isForbiddenForCustomerDocument({
        fileName: 'Ablieferbeleg.pdf',
        type: 'POD',
        categoryCode: null,
      }),
      false,
    );
  });
});
