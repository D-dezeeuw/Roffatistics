import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isScoreRanking, rowStatus } from '../modules/list.js';

describe('Ranglijst row status', () => {
  it('only Totaalscore and Woonscore leave non-residential areas out', () => {
    assert.equal(isScoreRanking('overall'), true);
    assert.equal(isScoreRanking('woonscore'), true);
    assert.equal(isScoreRanking('crimeRate'), false);
    assert.equal(isScoreRanking('avgIncome'), false);
  });
  it('marks business areas with the industry icon, keeps rank info in the title', () => {
    const r = { code: 'BU05990000', name: 'Waalhaven', nonResidential: 'Geen woonwijk (bedrijven-/havengebied)',
      values: { population: 40, housingStock: 5, nonResidentialStock: 300, businesses: 120 }, rank: null };
    const s = rowStatus(r);
    assert.equal(s.kind, 'nonres');
    assert.equal(s.icon, 'industry');
    assert.match(s.title, /telt niet mee/);
    assert.doesNotMatch(rowStatus({ ...r, rank: 3 }).title, /telt niet mee/);
  });
  it('marks rows without a value as no-data and leaves normal rows alone', () => {
    assert.equal(rowStatus({ code: 'WK059901', name: 'Stadsdriehoek', rank: null }).icon, 'nodata');
    assert.equal(rowStatus({ code: 'WK059901', name: 'Stadsdriehoek', rank: 1 }), null);
  });
});
