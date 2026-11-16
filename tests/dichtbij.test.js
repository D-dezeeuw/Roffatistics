// "Wat wil je dichtbij?" (v0.35): wizard step, hash form, weights, datasets.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEP_PARTS, BUURT_DICHTBIJ, VERVOER_DICHTBIJ, DICHTBIJ, DICHTBIJ_KEYS, DICHTBIJ_MAX_WEIGHT, normalizeAnswers, normalizeDichtbij, isEmptyAnswers,
  answersToPreset, encodeAnswers, decodeAnswers, describeAnswers, SCORE_RE,
} from '../modules/wizard-model.js';
import { STANDAARD, resolvePreset, scoreWithPreset } from '../modules/presets.js';
import { DATASETS, DATASET_KEYS } from '../modules/datasets.js';
import {
  GROEN_TABLE, GROEN_COLUMNS as G, GROEN_YEAR, NABIJ_COLUMNS as N, buildGroenUrl, extractGroenValues, groenValuesFor,
  joinAreas, describeDataYears,
} from '../modules/areas.js';
import { personalDashboardSpec } from '../modules/dashboard-personal.js';

const ALL = new Set(DATASET_KEYS);
const themeOf = (p, key) => p.themes.find(t => t.key === key);

describe('dichtbij: model', () => {
  it('is shown with Sfeer on the Buurt step (station on Vervoer, metro/tram on the OV chip); default is off', () => {
    assert.deepEqual([...STEP_PARTS.buurt], ['sfeer', 'dichtbij']);
    assert.deepEqual([...BUURT_DICHTBIJ, ...VERVOER_DICHTBIJ, 'ov'].sort(), Object.keys(DICHTBIJ).sort());
    assert.equal(normalizeAnswers({}).dichtbij, null);
    assert.equal(isEmptyAnswers({ dichtbij: { natuur: 0, uitgaan: 0 } }), true);
    assert.equal(isEmptyAnswers({ dichtbij: { natuur: 2 } }), false);
  });
  it('all items on 0 change nothing: same factors and same scores as Standaard', () => {
    const zero = Object.fromEntries(Object.keys(DICHTBIJ).map(k => [k, 0]));
    const p = answersToPreset({ dichtbij: zero });
    assert.deepEqual(resolvePreset(p, ALL), resolvePreset(STANDAARD, ALL));
    assert.equal(encodeAnswers({ dichtbij: zero }), '');
    const areas = [1, 2, 3, 4].map(i => ({ code: `WK05990${i}`, values: { distGP: i, distSupermarket: 5 - i, distStation: i % 3, distBos: 10 - i, crimeRate: 50 + i, avgIncome: 30 + i } }));
    const a = scoreWithPreset(areas, p).results.map(r => r.score), b = scoreWithPreset(areas, STANDAARD).results.map(r => r.score);
    assert.deepEqual(a, b);
  });
  it('normalises: unknown items dropped, levels clamped to 1–4, 0 and negatives removed', () => {
    assert.deepEqual(normalizeDichtbij({ natuur: 9, uitgaan: -2, station: 0, foo: 3, park: 1.4 }), { park: 1, natuur: 4 });
    assert.equal(normalizeDichtbij('x'), null);
  });
  it('weights are positive-only: every metric `lower` with w > 0, theme weight capped', () => {
    const all = Object.fromEntries(Object.keys(DICHTBIJ).map(k => [k, 4]));
    const t = themeOf(answersToPreset({ dichtbij: all }), 'dichtbij');
    assert.equal(t.weight, DICHTBIJ_MAX_WEIGHT);
    assert.deepEqual(new Set(t.metrics.map(m => m.key)), new Set(DICHTBIJ_KEYS));
    for (const m of t.metrics) { assert.equal(m.pref, 'lower'); assert.ok(m.w > 0); assert.match(m.label, /^Nabijheid /); }
    for (const f of resolvePreset(answersToPreset({ dichtbij: all }), ALL).filter(f => f.theme === 'dichtbij')) assert.ok(f.weight > 0 && f.pref === 'lower');
  });
  it('a more important item weighs more; one item on 4 = theme weight 20; Sfeer untouched', () => {
    const p = answersToPreset({ dichtbij: { natuur: 4, uitgaan: 1 }, sfeer: 10 });
    const t = themeOf(p, 'dichtbij');
    assert.equal(t.weight, 25);
    const w = k => t.metrics.find(m => m.key === k).w;
    assert.ok(w('distBos') > w('distCafe'));
    assert.equal(themeOf(answersToPreset({ dichtbij: { station: 4 } }), 'dichtbij').weight, 20);
    assert.deepEqual(themeOf(p, 'sfeer'), themeOf(answersToPreset({ sfeer: 10 }), 'sfeer'));
  });
});

describe('dichtbij: hash', () => {
  it('round-trips with compact keys', () => {
    const a = { dichtbij: { uitgaan: 3, station: 1, winkels: 2, cultuur: 4, park: 2, natuur: 4 }, sfeer: 30 };
    const s = encodeAnswers(a);
    assert.match(s, /(^|\.)dc3t1w2k4p2n4(\.|$)/);
    assert.ok(SCORE_RE.test(s));
    assert.deepEqual(decodeAnswers(s).dichtbij, a.dichtbij);
    assert.equal(decodeAnswers(s).sfeer, 30);
  });
  it('old hashes still decode (no d segment = off); junk is dropped', () => {
    const old = 'lg.s70.cindr.ws10';
    assert.equal(decodeAnswers(old).dichtbij, null);
    assert.equal(encodeAnswers(decodeAnswers(old)), old);
    assert.deepEqual(decodeAnswers('dn9x2c0p3').dichtbij, { park: 3 });
    assert.equal(decodeAnswers('d').dichtbij, null);
  });
  it('the summary names the items, most important first', () => {
    assert.match(describeAnswers({ dichtbij: { uitgaan: 1, natuur: 4 } }), /dichtbij: bos en natuur, cafés en uitgaan/);
  });
});

describe('dichtbij: datasets and data', () => {
  it('every metric is a dataset with Uitleg, a source and a caveat, neutral and out of the Totaalscore', () => {
    for (const k of DICHTBIJ_KEYS) {
      const d = DATASETS[k];
      assert.ok(d, k);
      assert.ok(d.description?.length > 30 && d.formula && d.source?.length && d.caveats?.length, `${k} INFO`);
      assert.equal(d.group, 'voorzieningen');
    }
    for (const k of ['distWarenhuis', 'distPodium', 'distBioscoop', 'distAttractie', 'distGroen', 'distRecreatie', 'distBos', 'distOpenNatuur']) {
      assert.equal(DATASETS[k].higherIsBetter, null); assert.equal(DATASETS[k].inOverall, false);
    }
    for (const k of ['distGroen', 'distBos']) assert.ok(DATASETS[k].source.some(s => s.id === GROEN_TABLE) && DATASETS[k].year === '2017');
  });
  it('green comes from 84334NED (2017), own code first, else the 2017 wijk for a buurt', () => {
    assert.ok(buildGroenUrl().includes(`/${GROEN_TABLE}/`));
    const row = (code, bos) => ({ [G.region]: `${code}  `, [G.distBos]: bos, [G.distGroen]: 0.4, [G.distRecreatie]: null, [G.distOpenNatuur]: 3 });
    assert.deepEqual(extractGroenValues(row('BU05990110', 1.1)), { distGroen: 0.4, distRecreatie: null, distBos: 1.1, distOpenNatuur: 3 });
    const by = new Map([['BU05990110', row('BU05990110', 1.1)], ['WK059902', row('WK059902', 2.5)]]);
    assert.equal(groenValuesFor('BU05990110', by).values.distBos, 1.1);
    const fb = groenValuesFor('BU05990299', by);
    assert.equal(fb.values.distBos, 2.5);
    assert.deepEqual(fb.years, { distGroen: GROEN_YEAR, distBos: GROEN_YEAR, distOpenNatuur: GROEN_YEAR });
    assert.equal(groenValuesFor('BU05990399', by).values.distBos, null);
    const [a] = joinAreas([{ properties: { statcode: 'BU05990110' } }], [], [], { rows: [{ WijkenEnBuurten: 'BU05990110', [N.distBioscoop]: 2.1 }], groenRows: [...by.values()] });
    assert.equal(a.values.distBos, 1.1); assert.equal(a.values.distBioscoop, 2.1); assert.equal(a.years.distBos, 2017);
    assert.match(describeDataYears(a.years), /bos.*: 2017/);
  });
});

describe('dichtbij: Jouw dashboard', () => {
  it('the Vervoer en sfeer row shows the most important dichtbij distance', () => {
    const spec = personalDashboardSpec({ dichtbij: { natuur: 4, uitgaan: 2 } });
    const row = spec.rows.find(r => r.key === 'bereikbaarheid' && r.source === 'jouw');
    assert.ok(row);
    assert.deepEqual(row.focus.metrics.map(m => m.key).slice(0, 2), ['distBos', 'distCafe']);
  });
});
