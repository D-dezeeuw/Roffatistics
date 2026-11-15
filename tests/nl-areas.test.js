import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  encodeLevel, decodeLevel, addCrimeRates, gemeenteOf, isGemeenteCode, areasInGemeente,
  buildGemeenteGeoUrl, slimGeo, loadNlLevel, loadNlAreas, loadGemeenteGeo, peekNlAreas, findNlArea,
  rescoreNlAreas, _resetNlCache, NL_DATA_URLS, NL_DATA_FORMAT, DERIVED_KEYS, minPopulationFor,
} from '../modules/nl-areas.js';
import { setPersonalPreset, GELIJK } from '../modules/presets.js';
import { scopeForArea, areaLink, areaModalHtml, PEER_TEXT } from '../modules/area-modal.js';
import { buildAreaDetail } from '../modules/area-detail.js';

const area = (code, values, years = {}) => ({ code, name: `n-${code}`, values, years });

const wijken = [
  area('WK059901', { population: 5000, totalCrimes: 500, crimeBurglaryCount: 10, avgIncome: 30, distGP: 0.5, woonscore: 50, distCentrum: 1 }, { avgIncome: 2024 }),
  area('WK036300', { population: 150, totalCrimes: 40, crimeBurglaryCount: 2, avgIncome: 40, distGP: 1.5 }, { avgIncome: 2024 }),
  area('WK036301', { population: 8000, totalCrimes: 80, crimeBurglaryCount: null, avgIncome: null, distGP: 0.9 }, { distGP: 2024 }),
];

describe('encodeLevel / decodeLevel', () => {
  const data = encodeLevel(wijken, { level: 'wijk', year: 2025, built: '2026-11-15' });

  it('stores columns as arrays, drops derived, scored and Rotterdam-only keys', () => {
    assert.equal(data.format, NL_DATA_FORMAT);
    assert.deepEqual(data.codes, ['WK059901', 'WK036300', 'WK036301']);
    assert.deepEqual(data.cols.population, [5000, 150, 8000]);
    for (const k of [...DERIVED_KEYS, 'woonscore', 'distCentrum']) assert.ok(!(k in data.cols), k);
  });

  it("marks fallback years per index, 'all' when every value fell back", () => {
    assert.deepEqual(data.fallback.avgIncome, { year: 2024, idx: 'all' });
    assert.deepEqual(data.fallback.distGP, { year: 2024, idx: [2] });
  });

  it('round-trips values, years, parents and gemeente', () => {
    const out = decodeLevel(JSON.parse(JSON.stringify(data)));
    assert.equal(out.length, 3);
    assert.equal(out[1].name, 'n-WK036300');
    assert.equal(out[1].parent, 'GM0363');
    assert.equal(out[1].gemeente, 'GM0363');
    assert.equal(out[1].level, 'wijk');
    assert.equal(out[2].values.distGP, 0.9);
    assert.deepEqual(out[0].years, { avgIncome: 2024 });
    assert.deepEqual(out[2].years, { distGP: 2024 });   // avgIncome null there: no year
  });

  it('derives crime rates from counts with the level threshold', () => {
    const out = decodeLevel(data);
    assert.equal(out[0].values.crimeRate, 100);
    assert.equal(out[0].values.crimeBurglary, 2);
    assert.equal(out[1].values.crimeRate, null);        // 150 inhabitants < 1,000 for wijken
    assert.equal(out[1].values.totalCrimes, 40);        // the count stays for the Absoluut mode
    assert.equal(out[2].values.crimeBurglary, null);
  });

  it('rejects an unknown format', () => {
    assert.throws(() => decodeLevel({ format: 99, codes: [] }), /format/);
  });

  it('addCrimeRates uses the buurt threshold of 200', () => {
    assert.equal(minPopulationFor('buurt'), 200);
    assert.equal(addCrimeRates({ population: 250, totalCrimes: 5 }, minPopulationFor('buurt')).crimeRate, 20);
  });
});

describe('gemeente helpers', () => {
  it('gemeenteOf / isGemeenteCode', () => {
    assert.equal(gemeenteOf('BU05990110'), 'GM0599');
    assert.equal(gemeenteOf(' wk036301 '), 'GM0363');
    assert.equal(gemeenteOf('GM0599'), null);
    assert.ok(isGemeenteCode('GM0014'));
    assert.ok(!isGemeenteCode('GM14') && !isGemeenteCode("GM0599' or 1=1"));
  });

  it('areasInGemeente filters by code prefix', () => {
    const list = [{ code: 'WK059901' }, { code: 'WK036300' }, { code: 'BU03630001' }];
    assert.deepEqual(areasInGemeente(list, 'GM0363').map(a => a.code), ['WK036300', 'BU03630001']);
    assert.deepEqual(areasInGemeente(list, 'nope'), []);
  });

  it('buildGemeenteGeoUrl filters the PDOK WFS on gmCode', () => {
    const url = new URL(buildGemeenteGeoUrl('buurt', 'GM0363'));
    assert.equal(url.origin + url.pathname, 'https://service.pdok.nl/cbs/gebiedsindelingen/2025/wfs/v1_0');
    assert.equal(url.searchParams.get('typeName'), 'gebiedsindelingen:buurt_gegeneraliseerd');
    assert.equal(url.searchParams.get('srsName'), 'EPSG:4326');
    assert.match(url.searchParams.get('FILTER'), /<PropertyName>gmCode<\/PropertyName><Literal>GM0363<\/Literal>/);
    assert.match(buildGemeenteGeoUrl('wijk', 'GM0599'), /wijk_gegeneraliseerd/);
    assert.throws(() => buildGemeenteGeoUrl('wijk', 'GM05'));
    assert.throws(() => buildGemeenteGeoUrl('straat', 'GM0599'));
  });

  it('slimGeo keeps the gemeente polygons, trims properties and rounds', () => {
    const geo = { features: [
      { properties: { statcode: 'WK036300 ', statnaam: 'Centrum', gmCode: 'GM0363', id: 1 }, geometry: { type: 'Polygon', coordinates: [[[4.1234567, 52.1234567], [4.2, 52.2], [4.3, 52.1], [4.1234567, 52.1234567]]] } },
      { properties: { statcode: 'WK059901' }, geometry: { type: 'Polygon', coordinates: [[[4, 51], [4.1, 51], [4, 51.1], [4, 51]]] } },
      { properties: { statcode: 'WK036399' }, geometry: null },
    ] };
    const out = slimGeo(geo, 'GM0363');
    assert.equal(out.features.length, 1);
    assert.deepEqual(out.features[0].properties, { statcode: 'WK036300', statnaam: 'Centrum' });
    assert.deepEqual(out.features[0].geometry.coordinates[0][0], [4.12346, 52.12346]);
  });
});

describe('lazy loaders', () => {
  beforeEach(() => { _resetNlCache(); setPersonalPreset(null); });

  const buurten = [
    area('BU03630001', { population: 900, totalCrimes: 30, avgIncome: 35, distGP: 0.4 }),
    area('BU03630002', { population: 120, totalCrimes: 30, avgIncome: 25, distGP: 2.4 }),
    area('BU05990110', { population: 4000, totalCrimes: 300, avgIncome: 42, distGP: 0.5 }),
  ];
  const files = {
    [NL_DATA_URLS.wijk]: encodeLevel(wijken, { level: 'wijk' }),
    [NL_DATA_URLS.buurt]: encodeLevel(buurten, { level: 'buurt' }),
  };
  const counting = (fail = new Set()) => {
    const calls = [];
    const fetcher = async url => {
      calls.push(url);
      if (fail.has(url)) return { ok: false, status: 503, json: async () => ({}) };
      const body = files[url] ?? { type: 'FeatureCollection', features: [{ properties: { statcode: 'WK036300', statnaam: 'Centrum' }, geometry: { type: 'Polygon', coordinates: [[[4, 52], [4.1, 52], [4, 52.1], [4, 52]]] } }] };
      return { ok: true, json: async () => JSON.parse(JSON.stringify(body)) };
    };
    return { calls, fetcher };
  };

  it('loads a level once, scores it among the national peers and caches it', async () => {
    const { calls, fetcher } = counting();
    const [a, b] = await Promise.all([loadNlLevel('wijk', { fetcher }), loadNlLevel('wijk', { fetcher })]);
    assert.equal(a, b);
    assert.equal(calls.length, 1);
    assert.ok(a.every(w => 'woonscore' in w.values));
    assert.equal(peekNlAreas().wijken.length, 3);
    assert.equal(peekNlAreas().buurten.length, 0);
    assert.equal(findNlArea('WK036301').name, 'n-WK036301');
  });

  it('buurten load the wijken first (parents) and loadNlAreas returns both', async () => {
    const { calls, fetcher } = counting();
    const { wijken: w, buurten: bu } = await loadNlAreas({ fetcher });
    assert.equal(w.length, 3);
    assert.equal(bu.length, 3);
    assert.deepEqual([...new Set(calls)].sort(), [NL_DATA_URLS.buurt, NL_DATA_URLS.wijk].sort());
    assert.equal(calls.length, 2);
  });

  it('a failed load is not cached', async () => {
    const fail = new Set([NL_DATA_URLS.wijk]);
    const { calls, fetcher } = counting(fail);
    await assert.rejects(loadNlLevel('wijk', { fetcher }));
    fail.clear();
    const ok = await loadNlLevel('wijk', { fetcher });
    assert.equal(ok.length, 3);
    assert.equal(calls.length, 2);
  });

  it('rescoreNlAreas applies the active preset in place', async () => {
    const { fetcher } = counting();
    const w = await loadNlLevel('wijk', { fetcher });
    const before = w.map(a => a.values.woonscore);
    setPersonalPreset(GELIJK);
    rescoreNlAreas();
    assert.equal(w[0].woonscore.code, 'WK059901');
    assert.ok(w.every(a => a.values.woonscore === null || Number.isFinite(a.values.woonscore)));
    assert.equal(before.length, 3);
  });

  it('caches gemeente geometry per level and gemeente', async () => {
    const { calls, fetcher } = counting();
    const g1 = await loadGemeenteGeo('wijk', 'GM0363', { fetcher });
    const g2 = await loadGemeenteGeo('wijk', 'GM0363', { fetcher });
    await loadGemeenteGeo('buurt', 'GM0363', { fetcher });
    assert.equal(g1, g2);
    assert.equal(g1.features[0].properties.statcode, 'WK036300');
    assert.equal(calls.length, 2);
    await assert.rejects(loadGemeenteGeo('wijk', 'bad', { fetcher }));
  });
});

describe('committed NL data files (scripts/build-nl-kwb.mjs)', () => {
  for (const [level, url, min] of [['wijk', NL_DATA_URLS.wijk, 3000], ['buurt', NL_DATA_URLS.buurt, 13000]]) {
    it(`${url} decodes to every NL ${level}, under 3.5 MB`, () => {
      const path = new URL(`../${url.slice(2)}`, import.meta.url);
      assert.ok(statSync(path).size < 3.5e6, `${url} is ${statSync(path).size} bytes`);
      const areas = decodeLevel(JSON.parse(readFileSync(path, 'utf8')));
      assert.ok(areas.length > min, `${areas.length} ${level}en`);
      assert.ok(areas.every(a => a.level === level));
      const rd = areas.find(a => a.code === (level === 'wijk' ? 'WK059901' : 'BU05990110'));
      assert.ok(rd?.values.population > 1000, 'Rotterdam area with inhabitants');
      const withPop = areas.filter(a => a.values.population > 0).length;
      assert.ok(withPop / areas.length > 0.8);
      for (const k of ['crimeRate', 'distGP', 'ownerOccupiedPct']) assert.ok(areas.filter(a => a.values[k] != null).length > areas.length / 2, k);
    });
  }
});

describe('area modal: Nederland peers', () => {
  it('scopeForArea keeps Rotterdam codes in the Rotterdam scope', () => {
    assert.equal(scopeForArea('BU05990110'), 'rotterdam');
    assert.equal(scopeForArea('WK036300'), 'nederland');
    const url = areaLink('WK036300', { scope: 'rotterdam', view: 'map', crime: 'rate' }, { origin: 'https://x.nl', pathname: '/' });
    assert.match(url, /scope=nederland/);
  });

  it('areaModalHtml names the national peers and drops Vergelijk', () => {
    const list = decodeLevel(encodeLevel(wijken, { level: 'wijk' }));
    const html = areaModalHtml(buildAreaDetail(list[1], { wijken: list, buurten: [] }), { peers: 'nederland' });
    assert.match(html, new RegExp(PEER_TEXT.nederland.adj));
    assert.doesNotMatch(html, /Rotterdamse/);
    assert.doesNotMatch(html, /data-area-action="compare"/);
    assert.match(areaModalHtml(buildAreaDetail(list[1], { wijken: list, buurten: [] })), /data-area-action="compare"/);
  });
});

import { addIncomeFallback, INCOME_FALLBACK_COLUMN, INCOME_FALLBACK_YEAR } from '../modules/nl-areas.js';
describe('addIncomeFallback', () => {
  it('fills only missing avgIncome from the 2023 table and marks the year', () => {
    const areas = [
      { code: 'BU1', values: { avgIncome: 40 }, years: {} },
      { code: 'BU2', values: { avgIncome: null }, years: {} },
      { code: 'BU3', values: {}, years: {} },
    ];
    addIncomeFallback(areas, [
      { WijkenEnBuurten: 'BU1  ', [INCOME_FALLBACK_COLUMN]: 99 },
      { WijkenEnBuurten: 'BU2', [INCOME_FALLBACK_COLUMN]: 35.5 },
    ]);
    assert.equal(areas[0].values.avgIncome, 40);
    assert.equal(areas[0].years.avgIncome, undefined);
    assert.equal(areas[1].values.avgIncome, 35.5);
    assert.equal(areas[1].years.avgIncome, INCOME_FALLBACK_YEAR);
    assert.equal(areas[2].values.avgIncome, undefined);
  });
});
