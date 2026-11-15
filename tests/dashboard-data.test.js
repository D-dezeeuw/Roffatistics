import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortByValue, sumOf, weightedMean, cityValue, cityKpis, KPI_KEYS,
  formatNumber, formatValue, formatTick, formatShort, niceTicks, linearScale, barDomain, scatterPoints,
} from '../modules/dashboard-data.js';
import { crimeRatePer1000, mergeWijkCrime, buildWijkCrimeUrl, CRIME_TABLE, CRIME_PERIOD } from '../modules/areas.js';

const area = (code, name, values) => ({ code, name, values });
const A = [
  area('WK1', 'Charlois', { population: 1000, avgIncome: 30, wozValue: null }),
  area('WK2', 'Centrum',  { population: 3000, avgIncome: 50, wozValue: 400 }),
  area('WK3', 'Botlek',   { population: 0,    avgIncome: null, wozValue: null }),
  area('WK4', 'Noord',    { population: 2000, avgIncome: 40, wozValue: 300 }),
];

describe('sortByValue', () => {
  it('sorts descending with missing values last, never dropped', () => {
    assert.deepEqual(sortByValue(A, 'avgIncome').map(a => a.code), ['WK2', 'WK4', 'WK1', 'WK3']);
  });
  it('ascending keeps nulls last, ordered by name', () => {
    assert.deepEqual(sortByValue(A, 'wozValue', { desc: false }).map(a => a.code), ['WK4', 'WK2', 'WK3', 'WK1']);
  });
  it('handles empty input', () => assert.deepEqual(sortByValue(undefined, 'x'), []));
});

describe('averages', () => {
  it('sumOf skips nulls', () => assert.equal(sumOf(A, 'population'), 6000));
  it('weightedMean weights by population and skips zero weights', () => {
    assert.equal(weightedMean(A, 'avgIncome'), (30 * 1000 + 50 * 3000 + 40 * 2000) / 6000);
    assert.equal(weightedMean(A, 'wozValue'), (400 * 3000 + 300 * 2000) / 5000);
  });
  it('weightedMean is null without data', () => assert.equal(weightedMean(A, 'missing'), null));
  it('cityValue sums population and weights everything else', () => {
    assert.equal(cityValue(A, 'population'), 6000);
    assert.equal(cityValue(A, 'avgIncome'), weightedMean(A, 'avgIncome'));
  });
  it('cityKpis returns the six KPI keys with formatted text', () => {
    const k = cityKpis(A);
    assert.deepEqual(k.map(x => x.key), [...KPI_KEYS]);
    assert.equal(k[0].text, '6.000 inw.');
    assert.equal(k.find(x => x.key === 'highEdu').text, 'geen data');
  });
});

describe('formatting (nl-NL)', () => {
  it('formatNumber uses nl separators', () => {
    assert.equal(formatNumber(1234567), '1.234.567');
    assert.equal(formatNumber(12.345, 1), '12,3');
    assert.equal(formatNumber(null), '—');
  });
  it('formatValue adds units per dataset', () => {
    assert.equal(formatValue(38.44, 'avgIncome'), '€ 38.400');
    assert.equal(formatValue(312, 'wozValue'), '€ 312.000');
    assert.equal(formatValue(45.27, 'highEdu'), '45,3%');
    assert.equal(formatValue(62.1, 'crimeRate'), '62,1 per 1.000 inw.');
    assert.equal(formatValue(12345, 'population'), '12.345 inw.');
    assert.equal(formatValue(null, 'population'), 'geen data');
  });
  it('formatShort drops long unit suffixes', () => {
    assert.equal(formatShort(62.14, 'crimeRate'), '62,1');
    assert.equal(formatShort(42565, 'population'), '42.565');
    assert.equal(formatShort(45.27, 'highEdu'), '45,3%');
    assert.equal(formatShort(null, 'highEdu'), '—');
  });
  it('formatTick is short', () => {
    assert.equal(formatTick(300, 'wozValue'), '€300k');
    assert.equal(formatTick(20, 'pop65plus'), '20%');
    assert.equal(formatTick(50000, 'population'), '50k');
  });
});

describe('scales and ticks', () => {
  it('niceTicks covers the range with round steps', () => {
    const t = niceTicks(3, 97, 5);
    assert.equal(t.min, 0); assert.equal(t.max, 100); assert.equal(t.step, 20);
    assert.deepEqual(t.ticks, [0, 20, 40, 60, 80, 100]);
  });
  it('niceTicks widens a zero range and survives nulls', () => {
    const t = niceTicks(5, 5);
    assert.ok(t.min < 5 && t.max > 5);
    assert.deepEqual(niceTicks(null, 3).ticks, [0, 0.25, 0.5, 0.75, 1]);
  });
  it('niceTicks avoids float noise', () => {
    assert.deepEqual(niceTicks(0, 0.7, 7).ticks, [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
  });
  it('linearScale maps and handles a zero domain', () => {
    assert.equal(linearScale([0, 10], [0, 100])(2.5), 25);
    assert.equal(linearScale([0, 10], [100, 0])(10), 0);
    assert.equal(linearScale([5, 5], [0, 10])(5), 5);
  });
  it('barDomain always includes zero', () => {
    assert.equal(barDomain([40, 60, null]).min, 0);
    assert.equal(barDomain([]).max, 1);
  });
  it('scatterPoints keeps areas with both values and counts the rest', () => {
    const { points, missing } = scatterPoints(A, 'avgIncome', 'wozValue');
    assert.deepEqual(points.map(p => p.code), ['WK2', 'WK4']);
    assert.equal(missing, 2);
  });
});

describe('wijk crime (47018NED)', () => {
  it('builds a dataderden URL for the total of the last full year', () => {
    const u = buildWijkCrimeUrl();
    assert.ok(u.startsWith(`https://dataderden.cbs.nl/ODataApi/odata/${CRIME_TABLE}/TypedDataSet?`));
    const f = new URL(u).searchParams.get('$filter');
    assert.ok(f.includes(`Perioden eq '${CRIME_PERIOD}'`) && f.includes("SoortMisdrijf eq '0.0.0 '") && f.includes("'WK0599'"));
  });
  it('crimeRatePer1000 divides by inhabitants and rejects tiny populations', () => {
    assert.equal(crimeRatePer1000(9731, 42565), 228.6);
    assert.equal(crimeRatePer1000(520, 70), null);
    assert.equal(crimeRatePer1000(null, 5000), null);
  });
  it('mergeWijkCrime fills crimeRate and totalCrimes by padded code, leaves others untouched', () => {
    const areas = [area('WK059901', 'Stadscentrum', { population: 42565, crimeRate: null }), area('WK059902', 'X', { population: 10, crimeRate: null })];
    const out = mergeWijkCrime(areas, [{ WijkenEnBuurten: 'WK059901  ', GeregistreerdeMisdrijven_1: 9731 }]);
    assert.equal(out[0].values.crimeRate, 228.6);
    assert.equal(out[0].values.totalCrimes, 9731);
    assert.equal(out[1], areas[1]);
    assert.equal(areas[0].values.crimeRate, null);
  });
});
