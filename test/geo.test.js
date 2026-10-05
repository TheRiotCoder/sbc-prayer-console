import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchCountries } from './bundle.mjs';

describe('matchCountries', () => {
  it('tags Chad/Jordan with locative prepositions', () => {
    assert.ok(matchCountries('Christians in Jordan face pressure').includes('JO'));
    assert.ok(matchCountries('Pastor arrested in Chad').includes('TD'));
    assert.ok(matchCountries('In Chad, church burned').includes('TD'));
  });
  it('requires Georgia country context', () => {
    assert.ok(!matchCountries('missionaries serving in Georgia').includes('GE'));
    assert.ok(matchCountries('church in Tbilisi, Georgia').includes('GE'));
  });
  it('handles Niger Delta / New Mexico / Indian Ocean / DRC', () => {
    assert.ok(matchCountries('Niger Delta flooding').includes('NG'));
    assert.ok(!matchCountries('Niger Delta flooding').includes('NE'));
    assert.ok(matchCountries('Pastor in Niger kidnapped').includes('NE'));
    assert.ok(!matchCountries('New Mexico church').includes('MX'));
    assert.ok(!matchCountries('Indian Ocean').includes('IN'));
    const drc = matchCountries('Democratic Republic of the Congo');
    assert.ok(drc.includes('CD'));
    assert.ok(!drc.includes('CG'));
    assert.ok(matchCountries('Congo church burned').includes('CD'));
  });
});
