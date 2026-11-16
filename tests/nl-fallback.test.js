// Third per-field fallback of the city loader: a value still null after
// 86165NED/85984NED takes the NL-wide data/nl file's value and year.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeNlFallback, describeDataYears } from '../modules/areas.js';
import { sliceLevel, decodeLevel, NL_DATA_FORMAT } from '../modules/nl-areas.js';

// Fixture in the data/nl file format: two Amsterdam buurten and one elsewhere.
const file = {
  format: NL_DATA_FORMAT, level: 'buurt', year: 2025,
  codes: ['BU00140000', 'BU0363AA01', 'BU0363AA02'], names: ['Elders', 'Kop Zeedijk', 'Oude Kerk'],
  cols: {
    avgIncome: [30, 41.2, 38.0], wozValue: [200, 450, null], population: [900, 1200, 800],
    lowEdu: [0.2, 0.3, 0.2], medEdu: [0.3, 0.3, 0.3], highEdu: [0.5, 0.4, 0.5],
  },
  fallback: { avgIncome: { year: 2023, idx: 'all' }, wozValue: { year: 2024, idx: [0, 1] } },
  nb: 'unused',
};
const city = (code, values, years = {}) => ({ code, level: 'buurt', values: { avgIncome: null, wozValue: null, population: null, lowEdu: null, medEdu: null, highEdu: null, crimeRate: null, ...values }, years });

describe('NL-wide fallback (mergeNlFallback)', () => {
  const nl = new Map(decodeLevel(sliceLevel(file, 'GM0363')).map(a => [a.code, a]));

  it('sliceLevel keeps only the gemeente, remaps fallback indices, drops nb', () => {
    const s = sliceLevel(file, 'GM0363');
    assert.deepEqual(s.codes, ['BU0363AA01', 'BU0363AA02']);
    assert.deepEqual(s.cols.avgIncome, [41.2, 38.0]);
    assert.deepEqual(s.fallback.wozValue, { year: 2024, idx: [0] });
    assert.equal(s.fallback.avgIncome.idx, 'all');
    assert.equal('nb' in s, false);
  });

  it('a null city value takes the NL value with its year', () => {
    const [a] = mergeNlFallback([city('BU0363AA01', { population: 1100 })], nl);
    assert.equal(a.values.avgIncome, 41.2);
    assert.equal(a.years.avgIncome, 2023);
    assert.equal(a.values.wozValue, 450);
    assert.equal(a.years.wozValue, 2024);
    assert.match(describeDataYears(a.years), /inkomen: 2023/);
  });

  it('never overwrites a non-null city value or its year', () => {
    const [a] = mergeNlFallback([city('BU0363AA01', { avgIncome: 35.5, population: 1100, wozValue: 400 }, { wozValue: 2024 })], nl);
    assert.equal(a.values.avgIncome, 35.5);
    assert.equal(a.years.avgIncome, undefined);
    assert.equal(a.values.population, 1100);
    assert.equal(a.values.wozValue, 400);
  });

  it('base-year NL values carry no year mark; crime and unknown codes are left alone', () => {
    const [a, b] = mergeNlFallback([city('BU0363AA02', {}), city('BU0363ZZ99', {})], nl);
    assert.equal(a.values.population, 800);
    assert.equal(a.years.population, undefined);
    assert.equal(a.values.wozValue, null);
    assert.equal(a.values.crimeRate, null);
    assert.deepEqual([a.values.lowEdu, a.values.medEdu, a.values.highEdu], [0.2, 0.3, 0.5]);
    assert.equal(b.values.avgIncome, null);
    assert.equal(mergeNlFallback([], new Map()).length, 0);
  });
});
