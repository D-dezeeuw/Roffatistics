// Gemeenschappen per land per gemeente (v0.55.0): CBS 85458NED countries, file
// data/nl/herkomst-land-gemeente-2026.json, datasets and categories.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LAND_COUNTRIES, LAND_METRICS, LAND_FORMAT, LAND_URL, LAND_PC4_KEYS, landSlug, encodeLand, decodeLand,
  isLandMetric, _setLandData, withLandShares, loadGemeenteLand, isLandLoaded,
} from '../modules/herkomst-land.js';
import { COUNTRIES, HK } from '../modules/herkomst.js';
import { HK_FORMER } from '../modules/herkomst-regio.js';
import { PC4_GROUPS } from '../modules/herkomst-pc4.js';
import { DETAIL_GROUPS } from '../modules/herkomst-gemeente.js';
import { ORIGIN_KEYS } from '../modules/presets.js';
import { DATASETS, datasetInScope, categoryDatasets, categoryHeadline, rankKeyForCategory, levelSourceText } from '../modules/datasets.js';
import { isStackable, defaultDirection } from '../modules/stapel.js';
import { GENERAL_SECTIONS } from '../modules/explain.js';

const FILE = JSON.parse(readFileSync(new URL('../data/nl/herkomst-land-gemeente-2026.json', import.meta.url), 'utf8'));

describe('herkomst-land: countries', () => {
  it('lists every single 85458NED country plus Nederlandse Cariben, no aggregate', () => {
    assert.equal(LAND_COUNTRIES.length, 46);
    assert.deepEqual(LAND_COUNTRIES.map(c => c.code).sort(), [...Object.keys(COUNTRIES), HK.caribbean].sort());
    for (const k of [...Object.keys(HK_FORMER), HK.africa, HK.europe, HK.eu, HK.asia, HK.america, HK.oceania, HK.total]) assert.ok(!LAND_COUNTRIES.some(c => c.code === k), k);
    assert.equal(new Set(LAND_METRICS).size, 46);
  });
  it('reuses the postcode keys and slugs the others', () => {
    for (const g of PC4_GROUPS.filter(g => g.plus.length === 1 && !g.minus.length && LAND_PC4_KEYS[g.plus[0]])) {
      assert.equal(LAND_COUNTRIES.find(c => c.code === g.plus[0]).metric, g.metric);
    }
    assert.equal(LAND_COUNTRIES.filter(c => c.pc4).length, 8);
    assert.equal(landSlug('Bosnië-Herzegovina'), 'bosnieHerzegovina');
    assert.equal(landSlug('Verenigd Koninkrijk'), 'verenigdKoninkrijk');
    assert.ok(isLandMetric('hk_syrie') && isLandMetric('hk_oekraine') && isLandMetric('hk_eritrea') && isLandMetric('hk_marokko'));
    assert.ok(!isLandMetric('hk_euNietEu') && !isLandMetric('hk_oceanie'));
  });
  it('a key shared with a detailed Gemeenschap group means the same single country', () => {
    for (const c of LAND_COUNTRIES) {
      const d = Object.values(DETAIL_GROUPS).find(x => x.key === c.metric);
      if (d) assert.deepEqual([[...d.group.plus], [...d.group.minus]], [[c.code], []], c.metric);
    }
  });
});

describe('herkomst-land: parser and file', () => {
  const rows = [
    { RegioS: 'GM0001  ', Herkomstland: 'T001040 ', Bevolking_1: 2000 },
    { RegioS: 'GM0001', Herkomstland: 'H008673', Bevolking_1: 101 },
    { RegioS: 'GM0001', Herkomstland: 'H008753', Bevolking_1: null },
    { RegioS: 'GM0001', Herkomstland: 'H008519', Bevolking_1: 500 },
    { RegioS: 'GM0002', Herkomstland: 'H008673', Bevolking_1: 5 },   // no total: left out
    { RegioS: 'PV20', Herkomstland: 'T001040', Bevolking_1: 9 },
  ];
  it('encodes one-decimal shares, null for an empty cell, gemeenten without total left out', () => {
    const b = encodeLand(rows);
    assert.deepEqual(b.codes, ['GM0001']);
    assert.deepEqual(b.countries, LAND_COUNTRIES.map(c => c.key));
    assert.equal(b.values[0][b.countries.indexOf('marokko')], 5.1);
    assert.equal(b.values[0][b.countries.indexOf('syrie')], null);
    assert.equal(b.values[0].length, 46);
  });
  it('decodes into hk_* shares and joins gemeente rows', () => {
    const m = decodeLand({ format: LAND_FORMAT, ...encodeLand(rows) });
    assert.equal(m.get('GM0001').hk_marokko, 5.1);
    assert.equal(m.get('GM0001').hk_syrie, null);
    assert.throws(() => decodeLand({ format: 99, codes: [] }));
    _setLandData({ format: LAND_FORMAT, ...encodeLand(rows) });
    const [a, b] = withLandShares([{ regionCode: 'GM0001', x: 1 }, { regionCode: 'PV20' }]);
    assert.equal(a.hk_marokko, 5.1); assert.equal(a.x, 1); assert.equal(b.hk_marokko, undefined);
    _setLandData(null);
  });
  it('the built file is compact, complete and plausible', () => {
    assert.equal(FILE.format, LAND_FORMAT);
    assert.equal(FILE.year, 2026);
    assert.equal(LAND_URL, './data/nl/herkomst-land-gemeente-2026.json');
    assert.deepEqual(FILE.countries, LAND_COUNTRIES.map(c => c.key));
    assert.ok(FILE.codes.length > 300 && FILE.codes.every(c => /^GM\d{4}$/.test(c)));
    assert.equal(FILE.values.length, FILE.codes.length);
    for (const row of FILE.values) {
      assert.equal(row.length, 46);
      for (const v of row) assert.ok(v === null || (v >= 0 && v <= 100 && Math.abs(Math.round(v * 10) - v * 10) < 1e-6));
    }
    const rtm = FILE.values[FILE.codes.indexOf('GM0599')];
    const at = k => rtm[FILE.countries.indexOf(k)];
    assert.ok(at('marokko') > 5 && at('turkije') > 5 && at('suriname') > 5, 'Rotterdam');
    assert.ok(at('cariben') >= at('curacao'), 'Nederlandse Cariben holds Curaçao');
    assert.ok(JSON.stringify(FILE).length < 90_000);
  });
  it('loads once through the fetcher', async () => {
    _setLandData(null);
    let calls = 0;
    const fetcher = async () => { calls++; return { ok: true, json: async () => FILE }; };
    await loadGemeenteLand({ fetcher }); await loadGemeenteLand({ fetcher });
    assert.equal(calls, 1); assert.ok(isLandLoaded());
    _setLandData(null);
  });
});

describe('herkomst-land: datasets', () => {
  it('neutral, not in the Woonscore, origin-guarded, stackable with a picked direction', () => {
    for (const c of LAND_COUNTRIES) {
      const d = DATASETS[c.metric];
      assert.equal(d.group, 'herkomstLand', c.metric);
      assert.equal(d.higherIsBetter, null);
      assert.equal(d.inOverall, false);
      assert.equal(d.scope, c.pc4 ? 'all' : 'nederland', c.metric);
      assert.ok(ORIGIN_KEYS.includes(c.metric), c.metric);
      assert.ok(isStackable(c.metric), c.metric);
      assert.equal(defaultDirection(c.metric), null, c.metric);
      assert.equal(levelSourceText(c.metric, 'gemeente'), 'CBS 2026');
      assert.equal(levelSourceText(c.metric, 'buurt'), c.pc4 ? 'geschat via postcode 2023' : '');
      assert.ok(d.source.some(s => s.id === '85458NED'));
      const text = [d.label, d.title, d.description, ...d.caveats].join(' ');
      assert.doesNotMatch(text, /mensen zoals jij|\b(goed|slecht)\b/i, c.metric);
    }
    assert.ok(datasetInScope('hk_syrie', 'nederland') && !datasetInScope('hk_syrie', 'rotterdam'));
    assert.ok(datasetInScope('hk_marokko', 'nederland') && datasetInScope('hk_marokko', 'rotterdam'));
    assert.equal(levelSourceText('hk_euNietEu', 'buurt'), '');
  });
  it('Ranglijst/Layers: sorted by label in both scopes', () => {
    const nl = categoryDatasets('herkomstLand', 'nederland');
    assert.equal(nl.length, 46);
    assert.deepEqual(nl.map(d => d.label), nl.map(d => d.label).sort((a, b) => a.localeCompare(b, 'nl')));
    assert.equal(categoryHeadline('herkomstLand', 'nederland'), 'hk_marokko');
    assert.equal(rankKeyForCategory('herkomstLand', 'hk_eritrea', 'nederland'), 'hk_eritrea');
    assert.equal(rankKeyForCategory('herkomstLand', 'hk_eritrea', 'rotterdam'), 'hk_marokko');
    assert.equal(categoryDatasets('herkomstLand', 'rotterdam').length, 10);
  });
  it('the Uitleg has a section on the country layers', () => {
    const s = GENERAL_SECTIONS.find(x => x.id === 'herkomst-land');
    assert.ok(s);
    assert.match(s.paragraphs.join(' '), /Eritrea/);
  });
});
