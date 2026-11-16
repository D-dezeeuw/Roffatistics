import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeAreaCode, areaLevel, parentCode, toNumber, hasValue, extractAreaValues, emptyAreaValues,
  valueRange, geoBounds, padBounds, joinAreas, areaPanelData, cleanRegionName, buildAreaIndex,
  buildWijkUrl, loadCityAreas, getAreaIndex, _resetAreaCache, WIJK_COLUMNS, WIJK_TABLE, DATASETS, DATASET_KEYS,
} from '../modules/areas.js';

const C = WIJK_COLUMNS;
const row = (code, extra = {}) => ({
  [C.region]: code.padEnd(10, ' '),
  [C.population]: 1000, [C.age65plus]: 150, [C.originOutsideEurope]: 400, [C.density]: 5000,
  [C.wozValue]: 300, [C.lowEdu]: 200, [C.medEdu]: 300, [C.highEdu]: 500, [C.avgIncome]: 40.5,
  ...extra,
});

describe('area codes', () => {
  it('normalizeAreaCode trims CBS padding and upper-cases', () => {
    assert.equal(normalizeAreaCode('WK059901  '), 'WK059901');
    assert.equal(normalizeAreaCode(' bu05990110'), 'BU05990110');
    assert.equal(normalizeAreaCode('   '), null);
    assert.equal(normalizeAreaCode(null), null);
  });

  it('areaLevel reads the prefix', () => {
    assert.equal(areaLevel('PV28  '), 'provincie');
    assert.equal(areaLevel('GM0599'), 'gemeente');
    assert.equal(areaLevel('WK059901'), 'wijk');
    assert.equal(areaLevel('BU05990110'), 'buurt');
    assert.equal(areaLevel('XX12'), null);
  });

  it('parentCode walks buurt → wijk → gemeente', () => {
    assert.equal(parentCode('BU05990110'), 'WK059901');
    assert.equal(parentCode('WK059901'), 'GM0599');
    assert.equal(parentCode('GM0599'), null);
  });
});

describe('value extraction', () => {
  it('toNumber / hasValue reject null, empty and NaN but keep 0', () => {
    assert.equal(toNumber(null), null);
    assert.equal(toNumber(''), null);
    assert.equal(toNumber('abc'), null);
    assert.equal(toNumber(0), 0);
    assert.equal(toNumber('4.5'), 4.5);
    assert.equal(hasValue(0), true);
    assert.equal(hasValue(undefined), false);
  });

  it('extractAreaValues maps CBS columns to dataset keys', () => {
    const v = extractAreaValues(row('WK059901'));
    assert.equal(v.population, 1000);
    assert.equal(v.avgIncome, 40.5);
    assert.equal(v.wozValue, 300);
    assert.equal(v.highEdu, 50);
    assert.equal(v.lowEdu, 20);
    assert.equal(v.pop65plus, 15);
    assert.equal(v.nonWesternPct, 40);
    assert.equal(v.density, 5000);
    assert.equal(v.crimeRate, null, 'crime is not in the wijk table');
  });

  it('every dataset key is present, missing cells give null', () => {
    const v = extractAreaValues(row('WK059901', { [C.avgIncome]: null, [C.population]: 0, [C.highEdu]: null }));
    for (const k of DATASET_KEYS) assert.ok(k in v, k);
    assert.equal(v.avgIncome, null);
    assert.equal(v.population, 0);
    assert.equal(v.pop65plus, null, 'no share of zero inhabitants');
    assert.equal(v.highEdu, null);
  });

  it('emptyAreaValues is all null', () => {
    assert.ok(Object.values(emptyAreaValues()).every(v => v === null));
  });

  it('valueRange skips nulls and returns null without data', () => {
    const areas = [{ values: { a: 3 } }, { values: { a: null } }, { values: { a: 9 } }];
    assert.deepEqual(valueRange(areas, 'a'), { min: 3, max: 9 });
    assert.equal(valueRange(areas, 'b'), null);
  });
});

describe('geometry helpers', () => {
  const sq = { type: 'Feature', properties: { statcode: 'WK059901', statnaam: 'Centrum' },
    geometry: { type: 'Polygon', coordinates: [[[4, 51], [5, 51], [5, 52], [4, 52], [4, 51]]] } };

  it('geoBounds returns [[s,w],[n,e]]', () => {
    assert.deepEqual(geoBounds(sq), [[51, 4], [52, 5]]);
    assert.equal(geoBounds({ type: 'FeatureCollection', features: [] }), null);
  });

  it('padBounds grows the box', () => {
    assert.deepEqual(padBounds([[0, 0], [10, 20]], 0.1), [[-1, -2], [11, 22]]);
  });

  it('joinAreas keeps areas without a CBS row (all values null)', () => {
    const other = { ...sq, properties: { statcode: 'WK059999', statnaam: 'Leeg' } };
    const areas = joinAreas([sq, other], [row('WK059901')]);
    assert.equal(areas.length, 2);
    assert.equal(areas[0].code, 'WK059901');
    assert.equal(areas[0].values.population, 1000);
    assert.equal(areas[0].parent, 'GM0599');
    assert.equal(areas[1].values.population, null);
    assert.deepEqual(areas[0].bounds, [[51, 4], [52, 5]]);
    assert.deepEqual(areaPanelData(areas[0]).regionCode, 'WK059901');
    assert.equal(areaPanelData(null), null);
  });
});

describe('search index', () => {
  it('cleanRegionName drops the CBS suffix', () => {
    assert.equal(cleanRegionName('Zuid-Holland (PV)'), 'Zuid-Holland');
    assert.equal(cleanRegionName('Rotterdam'), 'Rotterdam');
  });

  it('buildAreaIndex flattens all levels with scope and parent', () => {
    const idx = buildAreaIndex({
      provinces: [{ code: 'PV28', name: 'Zuid-Holland' }],
      gemeenten: [{ code: 'GM0599', name: 'Rotterdam' }],
      wijken:    [{ code: 'WK059901', name: 'Centrum', parent: 'GM0599' }],
      buurten:   [{ code: 'BU05990110', name: 'Stadsdriehoek', parent: 'WK059901' }],
    });
    assert.deepEqual(idx.map(e => e.level), ['provincie', 'gemeente', 'wijk', 'buurt']);
    assert.deepEqual(idx.map(e => e.scope), ['nederland', 'nederland', 'rotterdam', 'rotterdam']);
    assert.equal(idx[3].parent, 'WK059901');
  });
});

describe('DATASETS metadata', () => {
  it('ranking direction: income/edu/woz up, crime down, rest neutral', () => {
    assert.equal(DATASETS.avgIncome.higherIsBetter, true);
    assert.equal(DATASETS.highEdu.higherIsBetter, true);
    assert.equal(DATASETS.wozValue.higherIsBetter, true);
    assert.equal(DATASETS.crimeRate.higherIsBetter, false);
    assert.equal(DATASETS.population.higherIsBetter, null);
    for (const k of DATASET_KEYS) assert.ok(DATASETS[k].label && DATASETS[k].title && DATASETS[k].unit, k);
  });
});

describe('loaders (local files, stubbed CBS)', () => {
  beforeEach(() => _resetAreaCache());

  const root = new URL('../', import.meta.url);
  // CBS/police tables are own-origin snapshots now (modules/source.js): stub those, read the geometry files.
  const localFetch = cbs => async url => {
    if (url.startsWith('./data/snapshot/')) {
      if (url.includes('86165NED-gemeenten')) return { ok: true, json: async () => ({ value: [{ Key: 'GM0599    ', Title: 'Rotterdam' }] }) };
      return cbs();
    }
    if (url.startsWith('./')) {
      const body = await readFile(new URL(url.slice(2), root), 'utf8');
      return { ok: true, json: async () => JSON.parse(body) };
    }
    if (url.includes('/TypedDataSet')) return cbs();
    return { ok: true, json: async () => ({ value: [{ Key: 'GM0599    ', Title: 'Rotterdam' }] }) };
  };

  it('buildWijkUrl targets the wijk table and both prefixes', () => {
    const url = decodeURIComponent(buildWijkUrl());
    assert.ok(url.includes(`/${WIJK_TABLE}/TypedDataSet`));
    assert.ok(url.includes("startswith(WijkenEnBuurten,'WK0599')"));
    assert.ok(url.includes("startswith(WijkenEnBuurten,'BU0599')"));
  });

  it('loadCityAreas returns all 21 wijken and 91 buurten, values joined', async () => {
    const res = await loadCityAreas({
      fetcher: localFetch(() => ({ ok: true, json: async () => ({ value: [row('WK059901')] }) })),
      storage: null,
    });
    assert.equal(res.wijken.length, 21);
    assert.equal(res.buurten.length, 91);
    assert.ok(res.wijken.every(a => /^WK0599\d\d$/.test(a.code)));
    assert.ok(res.buurten.every(a => /^BU0599\d{4}$/.test(a.code) && a.parent.startsWith('WK0599')));
    assert.equal(res.wijken.find(a => a.code === 'WK059901').values.population, 1000);
    assert.equal(res.dataOk, true);
    const [[s, w], [n, e]] = res.bounds;
    assert.ok(s > 51.8 && n < 52.1 && w > 3.9 && e < 4.7, 'bounds around Rotterdam');
  });

  it('a CBS failure still yields every area, with null values', async () => {
    const res = await loadCityAreas({ fetcher: localFetch(() => ({ ok: false, status: 500 })), storage: null });
    assert.equal(res.dataOk, false);
    assert.equal(res.wijken.length, 21);
    assert.ok(res.wijken.every(a => a.values.population === null));
  });

  it('getAreaIndex combines provinces, gemeenten, wijken and buurten', async () => {
    const idx = await getAreaIndex({ fetcher: localFetch(() => ({ ok: true, json: async () => ({ value: [] }) })), storage: null });
    assert.equal(idx.filter(e => e.level === 'provincie').length, 12);
    assert.deepEqual(idx.find(e => e.level === 'gemeente'), { code: 'GM0599', name: 'Rotterdam', level: 'gemeente', scope: 'nederland' });
    assert.equal(idx.filter(e => e.level === 'wijk').length, 21);
    assert.equal(idx.filter(e => e.level === 'buurt').length, 91);
  });
});
