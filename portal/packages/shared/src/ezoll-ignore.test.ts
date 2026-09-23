import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEzollJunkFilename,
  matchesFilenameIgnorePrefix,
  stripEzollProcessorFilenamePrefix,
} from './ezoll-ignore';

describe('eZoll filename ignore / junk', () => {
  it('strippt Processor-Timestamp-Prefix', () => {
    assert.equal(
      stripEzollProcessorFilenamePrefix('1790107482731_671.221.2609.0078 Z_IMM_CC599CC.pdf'),
      '671.221.2609.0078 Z_IMM_CC599CC.pdf',
    );
    assert.equal(
      stripEzollProcessorFilenamePrefix('671.222.2609.0021_J_UST_CC599CC.pdf'),
      '671.222.2609.0021_J_UST_CC599CC.pdf',
    );
  });

  it('trifft 671. auch mit Timestamp-Prefix', () => {
    const prefixes = ['131.', '671.', 'HOLENSTEIN'];
    assert.equal(
      matchesFilenameIgnorePrefix('1790107482731_671.221.2609.0078 Z_IMM_CC599CC.pdf', prefixes),
      true,
    );
    assert.equal(matchesFilenameIgnorePrefix('671.221.2609.0075_CC529CC.pdf', prefixes), true);
    assert.equal(matchesFilenameIgnorePrefix('455657.1_C ISN_CC599CC.pdf', prefixes), false);
  });

  it('erkennt Junk 671./131.', () => {
    assert.equal(isEzollJunkFilename('1790107482731_671.221.x.pdf'), true);
    assert.equal(isEzollJunkFilename('131.999.foo.xml'), true);
    assert.equal(isEzollJunkFilename('455657.1_C ISN_CC599CC.pdf'), false);
  });
});
