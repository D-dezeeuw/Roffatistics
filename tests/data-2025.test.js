// v0.13.0: 2025 base table with per-field 2024 fallback, buurt crime with
// sub-layers and trend, the 2026 city WOZ, and the grouped Layers dropdown.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WIJK_COLUMNS, WIJK_TABLE, WIJK_FALLBACK_TABLE, buildWijkUrl, extractAreaValues, mergeYearValues,
  describeDataYears, joinAreas, areaPanelData, per1000,
  CRIME_CATEGORIES, buildCrimeUrl, buildBuurtCrimeUrl, aggregateCrime, mergeCrime, percentChange,
  CRIME_MIN_POPULATION_BUURT, buildCityWozUrl, parseCityWoz,
} from '../modules/areas.js';
import { DATASETS, DATASET_KEYS, DATASET_GROUPS, groupDatasets, datasetInScope } from '../modules/datasets.js';
import { cityKpis, cityWozKpi, formatValue, KPI_KEYS } from '../modules/dashboard-data.js';
import { scoreAreas } from '../modules/ranking.js';

const C = WIJK_COLUMNS;
const row = (code, cols) => ({ [C.region]: code.padEnd(10), ...cols });

describe('86165NED column mapping', () => {
  it('reads the base table and builds the URL with gemeente, wijken and buurten', () => {
    assert.equal(WIJK_TABLE, '86165NED');
    assert.equal(WIJK_FALLBACK_TABLE, '85984NED');
    const f = new URL(buildWijkUrl()).searchParams.get('$filter');
    assert.ok(buildWijkUrl().includes('/86165NED/'));
    for (const p of ["'GM0599'", "'WK0599'", "'BU0599'"]) assert.ok(f.includes(p));
    assert.ok(buildWijkUrl(WIJK_FALLBACK_TABLE).includes('/85984NED/'));
  });
  it('maps the new housing, bijstand and distance columns', () => {
    assert.equal(C.ownerOccupied, 'Koopwoningen_47');
    assert.equal(C.rental, 'HuurwoningenTotaal_48');
    assert.equal(C.welfare, 'PersonenPerSoortUitkeringBijstand_87');
    assert.equal(C.distGP, 'AfstandTotHuisartsenpraktijk_110');
    assert.equal(C.distSupermarket, 'AfstandTotGroteSupermarkt_111');
    const v = extractAreaValues(row('WK059901', {
      [C.population]: 40000, [C.ownerOccupied]: 27, [C.rental]: 73, [C.welfare]: 1368, [C.distGP]: 0.6, [C.distSupermarket]: 0.4, [C.density]: 10183,
    }));
    assert.equal(v.ownerOccupiedPct, 27);
    assert.equal(v.rentalPct, 73);
    assert.equal(v.welfarePer1000, 34.2);
    assert.equal(v.distGP, 0.6);
    assert.equal(v.distSupermarket, 0.4);
    assert.equal(v.density, 10183);
    for (const k of DATASET_KEYS) assert.ok(k in v, `value key ${k}`);
  });
  it('per1000 needs 200 inhabitants by default', () => {
    assert.equal(per1000(10, 199), null);
    assert.equal(per1000(10, 200), 50);
    assert.equal(per1000(null, 5000), null);
  });
});

describe('per-field 2024 fallback', () => {
  const base = row('WK059901', { [C.population]: 42090, [C.wozValue]: 424, [C.avgIncome]: null, [C.lowEdu]: null, [C.medEdu]: null, [C.highEdu]: null, [C.age65plus]: 5000 });
  const old  = row('WK059901', { [C.population]: 41000, [C.wozValue]: 400, [C.avgIncome]: 42.7, [C.lowEdu]: 20, [C.medEdu]: 30, [C.highEdu]: 50, [C.age65plus]: 4800 });
  it('keeps 2025 values and takes null fields from 2024, marking their year', () => {
    const { values, years } = mergeYearValues(base, old);
    assert.equal(values.population, 42090);
    assert.equal(values.wozValue, 424);
    assert.equal(values.avgIncome, 42.7);
    assert.equal(values.highEdu, 50);
    assert.equal(values.lowEdu, 20);
    assert.deepEqual(years, { avgIncome: 2024, lowEdu: 2024, medEdu: 2024, highEdu: 2024 });
    assert.equal(values.pop65plus, 11.9, '2025 share stays on 2025 counts');
  });
  it('takes the education triple only as a whole', () => {
    const partial = row('WK059901', { [C.population]: 1000, [C.lowEdu]: 10, [C.medEdu]: 10, [C.highEdu]: null });
    const { years } = mergeYearValues(base, partial);
    assert.equal(years.highEdu, undefined);
  });
  it('without a fallback row nothing is marked', () => {
    assert.deepEqual(mergeYearValues(base, null).years, {});
  });
  it('describes data years for one area and for a set', () => {
    assert.equal(describeDataYears({}), '2025');
    assert.equal(describeDataYears({ avgIncome: 2024, highEdu: 2024, lowEdu: 2024 }), '2025 · opleiding, inkomen: 2024');
    const areas = [
      { values: { avgIncome: 40, wozValue: 300 }, years: { avgIncome: 2024, wozValue: 2024 } },
      { values: { avgIncome: 30, wozValue: 250 }, years: { avgIncome: 2024 } },
      { values: { avgIncome: null, wozValue: null }, years: {} },
    ];
    assert.equal(describeDataYears(areas), '2025 · inkomen: 2024 · WOZ: deels 2024');
  });
  it('joinAreas leaves codes missing from both tables as geen data and passes years to the panel', () => {
    const features = [{ properties: { statcode: 'WK059901', statnaam: 'Centrum' } }, { properties: { statcode: 'WK059999', statnaam: 'Nieuw' } }];
    const [a, b] = joinAreas(features, [base], [old]);
    assert.equal(a.years.avgIncome, 2024);
    assert.ok(DATASET_KEYS.every(k => b.values[k] == null));
    assert.equal(areaPanelData(a).dataYears, '2025 · opleiding, inkomen: 2024');
  });
});

describe('crime per wijk and buurt (47018NED)', () => {
  const r = (code, period, kind, n) => ({ WijkenEnBuurten: code.padEnd(10), Perioden: period, SoortMisdrijf: kind, GeregistreerdeMisdrijven_1: n });
  const rows = [
    r('BU05990110', '2025JJ00', '0.0.0 ', 3000), r('BU05990110', '2024JJ00', '0.0.0 ', 3354),
    r('BU05990110', '2025JJ00', '1.1.1 ', 20), r('BU05990110', '2025JJ00', '1.2.3 ', 400), r('BU05990110', '2025JJ00', '1.2.4 ', 60),
    r('BU05990110', '2025JJ00', '1.4.4 ', 100), r('BU05990110', '2025JJ00', '1.4.5 ', 150), r('BU05990110', '2025JJ00', '1.4.6 ', null),
    r('BU05990110', '2024JJ00', '1.4.5 ', 999),
    r('BU05990111', '2025JJ00', '0.0.0 ', 50), r('BU05990111', '2025JJ00', '1.4.1 ', null),
  ];
  it('builds one batched URL per level with both years and all categories', () => {
    const f = new URL(buildBuurtCrimeUrl()).searchParams.get('$filter');
    assert.ok(f.includes("'BU0599'") && f.includes("'2025JJ00'") && f.includes("'2024JJ00'") && f.includes("'0.0.0 '"));
    for (const k of Object.values(CRIME_CATEGORIES).flat()) assert.ok(f.includes(`SoortMisdrijf eq '${k}'`), k);
    assert.ok(new URL(buildCrimeUrl('WK0599')).searchParams.get('$filter').includes("'WK0599'"));
  });
  it('geweld sums all seven 1.4.x categories', () => {
    assert.deepEqual(CRIME_CATEGORIES.crimeViolence.map(k => k.trim()), ['1.4.1', '1.4.2', '1.4.3', '1.4.4', '1.4.5', '1.4.6', '1.4.7']);
  });
  it('aggregates totals, sub-categories and the previous-year total', () => {
    const agg = aggregateCrime(rows);
    const a = agg.get('BU05990110');
    assert.deepEqual(a, { total: 3000, totalPrev: 3354, crimeBurglary: 20, crimeBike: 400, crimePickpocket: 60, crimeViolence: 250,
      crimeStreetRobbery: null, crimeThreat: 100, crimeVehicle: null, crimeShoplifting: null, crimeVandalism: null, crimeDrugs: null });
    assert.equal(agg.get('BU05990111').crimeViolence, null, 'all parts null → null');
    assert.equal(a.crimeThreat, 100, '1.4.4 feeds Bedreiging and Geweld');
  });
  it('asks every SoortMisdrijf key once, also when two layers share it', () => {
    const f = new URL(buildBuurtCrimeUrl()).searchParams.get('$filter');
    assert.equal(f.split("SoortMisdrijf eq '1.4.4 '").length, 2);
    assert.equal(f.split("SoortMisdrijf eq '1.4.6 '").length, 2);
  });
  it('adds the v0.17 police categories with checked keys', () => {
    const want = { crimeStreetRobbery: '1.4.6', crimeThreat: '1.4.4', crimeVehicle: '1.2.1', crimeShoplifting: '2.5.2', crimeVandalism: '2.2.1', crimeDrugs: '3.1.1' };
    for (const [k, kind] of Object.entries(want)) {
      assert.deepEqual(CRIME_CATEGORIES[k].map(x => x.trim()), [kind], k);
      assert.equal(DATASETS[k].higherIsBetter, false, k);
      assert.equal(DATASETS[k].inOverall, false, k);
      assert.equal(DATASETS[k].scope, 'rotterdam', k);
      assert.equal(DATASETS[k].countKey, `${k}Count`, k);
    }
  });
  it('merges rates per 1,000, skips small buurten and computes the trend', () => {
    const areas = [
      { code: 'BU05990110', values: { population: 10000 } },
      { code: 'BU05990111', values: { population: 150 } },
      { code: 'BU05990112', values: { population: 900 } },
    ];
    const [a, b, c] = mergeCrime(areas, rows, { minPopulation: CRIME_MIN_POPULATION_BUURT });
    assert.equal(a.values.crimeRate, 300);
    assert.equal(a.values.crimeBurglary, 2);
    assert.equal(a.values.crimeBike, 40);
    assert.equal(a.values.crimePickpocket, 6);
    assert.equal(a.values.crimeViolence, 25);
    assert.equal(a.values.crimeTrend, -10.6);
    assert.equal(a.values.totalCrimes, 3000);
    assert.equal(b.values.crimeRate, null, 'under 200 inhabitants');
    assert.equal(b.values.totalCrimes, 50);
    assert.equal(c, areas[2], 'no crime row → unchanged');
  });
  it('percentChange handles missing and zero', () => {
    assert.equal(percentChange(110, 100), 10);
    assert.equal(percentChange(5, 0), null);
    assert.equal(percentChange(null, 5), null);
  });
});

describe('2026 city WOZ (85036NED)', () => {
  it('asks for the total (T001132), not overige verhuurders', () => {
    const f = new URL(buildCityWozUrl()).searchParams.get('$filter');
    assert.ok(f.includes("Eigendom eq 'T001132'") && f.includes("'2026JJ00'") && f.includes("'GM0599'"));
  });
  it('parses the figure and builds the KPI with source and peildatum', () => {
    const woz = parseCityWoz([{ RegioS: 'GM0599', Perioden: '2026JJ00', GemiddeldeWOZWaardeVanWoningen_1: 374 }]);
    assert.deepEqual(woz, { value: 374, year: 2026, peildatum: '1 januari 2026', table: '85036NED' });
    const k = cityWozKpi(woz);
    assert.equal(k.label, 'WOZ 2026 · gemeente');
    assert.equal(k.text, '€ 374.000');
    assert.match(k.note, /85036NED, peildatum 1 januari 2026/);
    assert.equal(parseCityWoz([]), null);
    assert.equal(cityWozKpi(null), null);
  });
  it('cityKpis prefers the gemeente figure and labels older years', () => {
    const wijken = [{ values: { population: 100, wozValue: 300, avgIncome: 30 } }, { values: { population: 100, wozValue: 200, avgIncome: 40 } }];
    const city = { values: { wozValue: 342, avgIncome: 37.4 }, years: { avgIncome: 2024 } };
    const k = Object.fromEntries(cityKpis(wijken, city).map(x => [x.key, x]));
    assert.equal(k.wozValue.value, 342);
    assert.equal(k.wozValue.label, 'Gem. WOZ 2025');
    assert.equal(k.avgIncome.label, 'Gem. inkomen 2024');
    assert.equal(k.population.value, 200, 'no gemeente value → wijk total');
    assert.deepEqual(cityKpis(wijken).map(x => x.key), [...KPI_KEYS]);
  });
});

describe('new layers and dropdown groups', () => {
  it('adds the layers with the right direction and scope', () => {
    const want = { ownerOccupiedPct: null, rentalPct: null, welfarePer1000: false, distGP: false, distSupermarket: false,
      crimeBurglary: false, crimeBike: false, crimePickpocket: false, crimeViolence: false, density: null };
    for (const [k, hib] of Object.entries(want)) assert.equal(DATASETS[k]?.higherIsBetter, hib, k);
    assert.ok(datasetInScope('distGP', 'rotterdam'));
    assert.ok(!datasetInScope('distGP', 'nederland'));
    assert.ok(datasetInScope('density', 'nederland'), 'Nederland rows have density');
    assert.ok(!datasetInScope('nope', 'rotterdam'));
  });
  it('groups every layer dataset into the categories, in order', () => {
    const groups = groupDatasets();
    assert.deepEqual(groups.map(g => g.label), ['Woonscore', 'Bevolking & huishoudens', 'Leeftijd', 'Herkomst', 'Criminaliteit', 'Opleiding', 'Welvaart & wonen', 'Voorzieningen']);
    assert.equal(groups.find(g => g.key === 'herkomst').scope, 'all', 'v0.28.0 regions: every level');
    assert.ok(datasetInScope('hr_noordAfrika', 'nederland') && datasetInScope('hr_noordAfrika', 'rotterdam'), 'Noord-Afrika: Marokko per wijk/buurt');
    assert.ok(datasetInScope('hr_oostAfrika', 'nederland') && !datasetInScope('hr_oostAfrika', 'rotterdam'), 'Oost-Afrika: gemeente only');
    assert.deepEqual(groups.find(g => g.key === 'score').datasets.map(d => d.key), ['woonscore']);
    const all = groupDatasets(undefined, undefined, { includeHidden: true });
    assert.deepEqual(all.flatMap(g => g.datasets.map(d => d.key)).sort(), [...DATASET_KEYS].sort());
    assert.deepEqual(groups.find(g => g.key === 'criminaliteit').datasets.map(d => d.key), ['crimeRate', 'crimeBurglary', 'crimeBike', 'crimePickpocket', 'crimeViolence',
      'crimeStreetRobbery', 'crimeThreat', 'crimeVehicle', 'crimeShoplifting', 'crimeVandalism', 'crimeDrugs', 'crimeDensity', 'crimeNearby']);
    assert.equal(groups.find(g => g.key === 'voorzieningen').scope, 'rotterdam');
    assert.equal(groups.find(g => g.key === 'bevolking').scope, 'all');
  });
  it('drops empty sections and sends unknown groups to the last one', () => {
    const groups = groupDatasets({ a: { key: 'a', group: 'bevolking' }, b: { key: 'b', group: 'x' } }, DATASET_GROUPS);
    assert.deepEqual(groups.map(g => [g.key, g.datasets.map(d => d.key)]), [['bevolking', ['a']], ['voorzieningen', ['b']]]);
  });
  it('formats km and density values', () => {
    assert.equal(formatValue(0.6, 'distGP'), '0,6 km');
    assert.equal(formatValue(10183, 'density'), '10.183 per km²');
    assert.equal(formatValue(34.2, 'welfarePer1000'), '34,2 per 1.000 inw.');
  });
  it('crime sub-layers stay out of the Totaalscore', () => {
    const areas = [{ code: 'A', name: 'A', values: { crimeRate: 10, crimeBike: 1 } }, { code: 'B', name: 'B', values: { crimeRate: 20, crimeBike: 0 } }];
    const rows = scoreAreas(areas, [DATASETS.crimeRate, DATASETS.crimeBike]);
    assert.equal(rows[0].used, 1);
    assert.equal(rows[0].possible, 1);
    assert.equal(rows[0].scores.crimeBike, 0);
  });
});

describe('panel fields', () => {
});
