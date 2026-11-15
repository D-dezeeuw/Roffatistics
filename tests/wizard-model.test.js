import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPS, APPLY, EMPTY_ANSWERS, normalizeAnswers, isEmptyAnswers, budgetCeiling, answersToPreset, themeWeights,
  encodeAnswers, decodeAnswers, presetFromScore, scoreKind, loadAnswers, saveAnswers, ANSWERS_STORAGE_KEY,
  topAreas, describeAnswers, parseEuroK, SCORE_RE, INCOME_FACTOR, STRESS_W,
} from '../modules/wizard-model.js';
import { STANDAARD, GELIJK, resolvePreset, resolveTargets, quantile, scoreWithPreset, assignScore, themeBreakdown, scoreResult, rowsWithWoonscore, setPersonalPreset, withWoonscore } from '../modules/presets.js';
import { parseHash, serializeHash, sanitizePatch, resolveInitialState, SCORE_STORAGE_KEY, DEFAULT_STATE } from '../modules/state.js';
import { DATASET_KEYS } from '../modules/datasets.js';

const ALL = new Set(DATASET_KEYS);
const FULL = {
  levensfase: 'gezin', oud: 'gebouwen', budget: { mode: 'koop', income: 80, maxPrice: null, hide: true },
  vervoer: ['fiets', 'ov', 'auto'], sfeer: 70, veiligheid: ['inbraak', 'fiets', 'drugs'], weights: { veiligheid: 50, sfeer: 10 },
};
const memStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const themeOf = (p, key) => p.themes.find(t => t.key === key);
const metricOf = (p, theme, key) => themeOf(p, theme)?.metrics.find(m => m.key === key);

describe('wizard: skip = Standaard', () => {
  it('empty answers give exactly the Standaard factors, targets and filters', () => {
    const p = answersToPreset(EMPTY_ANSWERS);
    assert.deepEqual(resolvePreset(p, ALL), resolvePreset(STANDAARD, ALL));
    assert.deepEqual(p.targets, {});
    assert.deepEqual(p.filters, []);
    assert.equal(isEmptyAnswers({}), true);
    assert.equal(encodeAnswers({}), '');
  });
  it('skipping every step (all null / empty) scores like Standaard', () => {
    const areas = [1, 2, 3, 4].map(i => ({ code: `WK${i}`, values: { crimeRate: 10 * i, avgIncome: 50 - i, highEdu: 20 + i * 3, distGP: i / 2 } }));
    const a = scoreWithPreset(areas, answersToPreset({ levensfase: null, budget: null, vervoer: [], sfeer: null, veiligheid: [] })).results.map(r => r.score);
    const b = scoreWithPreset(areas, STANDAARD).results.map(r => r.score);
    assert.deepEqual(a, b);
  });
  it('presetFromScore: nothing / standaard → Standaard, gelijk → Gelijk, custom → answers', () => {
    assert.equal(presetFromScore(null), STANDAARD);
    assert.equal(presetFromScore('standaard'), STANDAARD);
    assert.equal(presetFromScore('gelijk'), GELIJK);
    assert.equal(presetFromScore('lg').id, 'jouwscore');
    assert.deepEqual([scoreKind(null), scoreKind('gelijk'), scoreKind('s20')], ['standaard', 'gelijk', 'custom']);
  });
  it('every step has an applier; W4 has room (no origin key anywhere in a preset)', () => {
    for (const s of STEPS) assert.equal(typeof APPLY[s], 'function');
    assert.equal(STEPS.at(-1), 'gemeenschap');
    const keys = answersToPreset(FULL).themes.flatMap(t => t.metrics.map(m => m.key));
    assert.ok(!keys.some(k => /origin|nonWestern|bornAbroad/.test(k)));
  });
});

describe('wizard: answers → preset', () => {
  it('levensfase gezin: kids share in Leeftijd, school and kinderopvang stressed', () => {
    const p = answersToPreset({ levensfase: 'gezin' });
    assert.equal(themeOf(p, 'leeftijd').weight, 15);
    assert.equal(metricOf(p, 'leeftijd', 'hhWithKidsPct').pref, 'higher');
    assert.equal(metricOf(p, 'voorzieningen', 'distSchool').w, STRESS_W);
    assert.equal(metricOf(p, 'voorzieningen', 'distKinderopvang').w, STRESS_W);
  });
  it('"oud": bewoners → fewer 65+, gebouwen → more nieuwbouw; a senior never scores 65+ down', () => {
    assert.equal(metricOf(answersToPreset({ levensfase: 'student', oud: 'bewoners' }), 'leeftijd', 'pop65plus').pref, 'lower');
    assert.equal(metricOf(answersToPreset({ oud: 'gebouwen' }), 'nieuwbouw', 'newBuildPct').pref, 'higher');
    assert.equal(metricOf(answersToPreset({ levensfase: 'senior', oud: 'bewoners' }), 'leeftijd', 'pop65plus').pref, 'higher');
  });
  it('koop budget: income × 4.5 → WOZ target and the optional too-expensive filter', () => {
    assert.equal(budgetCeiling({ mode: 'koop', income: 80 }), 80 * INCOME_FACTOR);
    assert.equal(budgetCeiling({ mode: 'koop', income: 80, maxPrice: 300 }), 300, 'max price wins');
    assert.equal(budgetCeiling({ mode: 'huur', income: 80 }), null);
    const p = answersToPreset({ budget: { mode: 'koop', income: 80, hide: true } });
    assert.equal(metricOf(p, 'budget', 'wozValue').pref, 'target');
    assert.ok(Math.abs(p.targets.wozValue.ideal - 360 * 0.85) < 1e-9);
    assert.deepEqual(p.filters, [{ key: 'wozValue', max: 360 * 1.2 }]);
    assert.deepEqual(answersToPreset({ budget: { mode: 'koop', income: 80 } }).filters, []);
  });
  it('huur: rental share replaces koopwoningen, no WOZ target', () => {
    const p = answersToPreset({ budget: { mode: 'huur' } });
    assert.ok(metricOf(p, 'woningmarkt', 'rentalPct'));
    assert.equal(metricOf(p, 'woningmarkt', 'ownerOccupiedPct'), undefined);
    assert.equal(p.targets.wozValue, undefined);
  });
  it('vervoer: fiets ×3 on crimeBike, OV on distStation, auto on crimeVehicle and lower density', () => {
    const p = answersToPreset({ vervoer: ['fiets', 'ov', 'auto'] });
    assert.equal(metricOf(p, 'veiligheid', 'crimeBike').w, 3);
    assert.equal(metricOf(p, 'voorzieningen', 'distStation').w, STRESS_W);
    assert.ok(metricOf(p, 'veiligheid', 'crimeVehicle'));
    assert.equal(metricOf(p, 'sfeer', 'density').pref, 'lower');
    const f = resolvePreset(p, ALL);
    const bike = f.find(x => x.key === 'crimeBike').weight, rate = f.find(x => x.key === 'crimeRate').weight;
    assert.ok(Math.abs(bike / rate - 3) < 1e-9);
  });
  it('sfeer: quantile targets on density and distCentrum, horeca only at the busy end; auto shifts toward rustig', () => {
    const druk = answersToPreset({ sfeer: 0 });
    assert.deepEqual(druk.targets.density, { quantile: 0.95 });
    assert.deepEqual(druk.targets.distCentrum, { quantile: 0.05 });
    assert.ok(metricOf(druk, 'sfeer', 'horeca1km'));
    const rustig = answersToPreset({ sfeer: 80 });
    assert.ok(Math.abs(rustig.targets.density.quantile - 0.2) < 1e-9);
    assert.equal(metricOf(rustig, 'sfeer', 'horeca1km'), undefined);
    assert.ok(Math.abs(answersToPreset({ sfeer: 50, vervoer: ['auto'] }).targets.density.quantile - 0.35) < 1e-9);
  });
  it('veiligheid chips stress their crime; a chip and fiets do not multiply', () => {
    const p = answersToPreset({ veiligheid: ['inbraak', 'fiets', 'drugs'], vervoer: ['fiets'] });
    assert.equal(metricOf(p, 'veiligheid', 'crimeBurglary').w, 3);
    assert.equal(metricOf(p, 'veiligheid', 'crimeBike').w, 3);
    assert.equal(metricOf(p, 'veiligheid', 'crimeDrugs').w, 3);
  });
  it('slider weights override theme weights; 0 drops a theme', () => {
    const p = answersToPreset({ ...FULL, weights: { veiligheid: 0, opleiding: 40 } });
    assert.equal(themeOf(p, 'veiligheid').weight, 0);
    assert.equal(themeOf(p, 'opleiding').weight, 40);
    assert.ok(!resolvePreset(p, ALL).some(f => f.theme === 'veiligheid'));
    assert.equal(themeWeights(FULL).veiligheid, 35, 'themeWeights ignores the overrides');
  });
});

describe('wizard: hash and storage', () => {
  it('round-trips the full answers through the compact string', () => {
    const s = encodeAnswers(FULL);
    assert.match(s, SCORE_RE);
    assert.deepEqual(decodeAnswers(s), normalizeAnswers(FULL));
    assert.equal(s, 'lg.og.bki80x.vfoa.s70.cinfddr.wv50s10');
  });
  it('round-trips every single-step answer', () => {
    for (const a of [{ levensfase: 'senior' }, { levensfase: '50plus' }, { budget: { mode: 'huur' } }, { budget: { mode: 'koop', maxPrice: 425 } },
      { vervoer: ['lopen'] }, { sfeer: 0 }, { sfeer: 100 }, { veiligheid: ['vandalisme', 'straatroof'] }, { weights: { nieuwbouw: 5 } }]) {
      assert.deepEqual(decodeAnswers(encodeAnswers(a)), normalizeAnswers(a), JSON.stringify(a));
    }
  });
  it('decode ignores junk, unknown segments (W4 room) and fixed preset names', () => {
    assert.deepEqual(decodeAnswers('lz.q12.s999.cxx.gsu'), normalizeAnswers({ sfeer: 100 }));
    assert.deepEqual(decodeAnswers('gelijk'), normalizeAnswers({}));
    assert.deepEqual(decodeAnswers('BAD!'), normalizeAnswers({}));
    assert.deepEqual(decodeAnswers(null), normalizeAnswers({}));
  });
  it('state carries score= in the hash; deep links restore it; bad values are dropped', () => {
    const s = { ...DEFAULT_STATE, score: 'lg.s30' };
    assert.equal(serializeHash(s), '#scope=rotterdam&view=map&score=lg.s30');
    assert.deepEqual(parseHash('#score=lg.s30&dataset=jouwscore'), { dataset: 'woonscore', score: 'lg.s30' }, 'old Jouw score links open the personalised Woonscore');
    assert.deepEqual(sanitizePatch({ score: 'x y<script>' }), {});
    assert.deepEqual(sanitizePatch({ score: null }), { score: null });
  });
  it('initial state: hash score wins over the stored one; stored score restores without a hash', () => {
    const st = memStorage();
    st.setItem(SCORE_STORAGE_KEY, 'gelijk');
    assert.equal(resolveInitialState({ hash: '', storage: st }).score, 'gelijk');
    assert.equal(resolveInitialState({ hash: '#score=s10', storage: st }).score, 's10');
    assert.equal(resolveInitialState({ hash: '', storage: memStorage() }).score, null);
  });
  it('answers in localStorage survive a round trip; a throwing storage is ignored', () => {
    const st = memStorage();
    saveAnswers(st, FULL);
    assert.deepEqual(loadAnswers(st), normalizeAnswers(FULL));
    saveAnswers(st, {});
    assert.equal(st.m.has(ANSWERS_STORAGE_KEY), false);
    const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
    assert.equal(loadAnswers(bad), null);
    assert.doesNotThrow(() => saveAnswers(bad, FULL));
  });
  it('parseEuroK reads typed euros into ×€1.000', () => {
    assert.equal(parseEuroK('60.000'), 60);
    assert.equal(parseEuroK('€ 350 000'), 350);
    assert.equal(parseEuroK('75'), 75);
    assert.equal(parseEuroK('62.500,50'), 63);
    assert.equal(parseEuroK(''), null);
    assert.equal(parseEuroK('abc'), null);
  });
});

describe('wizard: scoring with quantile targets and in-place layers', () => {
  const areas = [100, 2000, 5000, 9000, 15000].map((d, i) => ({ code: `BU${i}`, name: `B${i}`, values: { density: d, distCentrum: 10 - 2 * i, crimeRate: 40, wozValue: 200 + 100 * i } }));
  it('quantile interpolates; resolveTargets turns quantiles into peer values', () => {
    assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
    assert.equal(quantile([1, 2], 0.25), 1.25);
    assert.equal(quantile([], 0.5), null);
    const r = resolveTargets({ targets: { density: { quantile: 0.5 } } }, areas);
    assert.equal(r.targets.density.ideal, 5000);
    assert.equal(r.targets.density.tolerance, (9000 - 2000) / 2);
  });
  it('druk ranks the dense area first, rustig the quiet one', () => {
    const top = s => { const res = scoreWithPreset(areas, answersToPreset({ sfeer: s })).results; return res.reduce((a, b) => (b.score > a.score ? b : a)).code; };
    assert.equal(top(0), 'BU4');
    assert.equal(top(100), 'BU0');
  });
  it('assignScore writes values and results in place; filtered areas get null', () => {
    const list = areas.map(a => ({ ...a, values: { ...a.values } }));
    const obj = list[4];
    assignScore(list, 'woonscore', { preset: answersToPreset({ budget: { mode: 'koop', maxPrice: 400, hide: true } }) });
    assert.equal(list[4], obj, 'same object');
    assert.equal(obj.values.woonscore, null, 'WOZ 600 > 1.2 × 400: hidden');
    assert.equal(obj.woonscore.filtered, true);
    assert.equal(typeof list[1].values.woonscore, 'number');
    assert.equal(scoreResult('woonscore', 'BU1'), list[1].woonscore);
    assert.equal(scoreResult('standaard', 'BU1').filtered, false, 'Standaard comparison recorded alongside');
  });
  it('withWoonscore / rowsWithWoonscore: the Woonscore follows the active preset', () => {
    setPersonalPreset(null);
    const std = withWoonscore(areas);
    setPersonalPreset(answersToPreset({ sfeer: 0 }));
    const w = withWoonscore(areas);
    assert.notDeepEqual(w.map(a => a.values.woonscore), std.map(a => a.values.woonscore));
    assert.ok(w.every(a => !('jouwscore' in a.values)), 'no separate Jouw score layer');
    assert.deepEqual(w.map(a => scoreResult('standaard', a.code)?.score), std.map(a => a.woonscore?.score), 'Std column keeps the Standaard score');
    const rows = rowsWithWoonscore(areas.map(a => ({ regionCode: a.code.replace('BU', 'GM'), ...a.values })));
    assert.equal(rows.length, 5);
    assert.ok(rows.every(r => 'woonscore' in r && !('jouwscore' in r)));
    setPersonalPreset(null);
    const same = withWoonscore(areas);
    assert.deepEqual(same.map(a => a.values.woonscore), std.map(a => a.values.woonscore), 'reset: back to the Standaard values');
  });
  it('themeBreakdown sums to the score, one row per theme', () => {
    const res = scoreWithPreset(areas, answersToPreset({ sfeer: 30 })).results[2];
    const th = themeBreakdown(res);
    assert.ok(Math.abs(th.reduce((s, t) => s + t.points, 0) - res.score) < 1e-9);
    assert.deepEqual(th.map(t => t.theme).sort(), ['sfeer', 'veiligheid']);
    assert.equal(th.find(t => t.theme === 'sfeer').label, 'Sfeer');
  });
});

describe('wizard: result helpers', () => {
  it('topAreas skips filtered and unscored, ranks with ties', () => {
    const t = topAreas([{ code: 'a', name: 'A', score: 50 }, { code: 'b', name: 'B', score: 90, filtered: true }, { code: 'c', name: 'C', score: 50 }, { code: 'd', name: 'D', score: null }, { code: 'e', name: 'E', score: 70 }], 10);
    assert.deepEqual(t.map(i => [i.code, i.rank]), [['e', 1], ['a', 2], ['c', 2]]);
    assert.equal(topAreas(Array.from({ length: 20 }, (_, i) => ({ code: `${i}`, name: `${i}`, score: i })), 10).length, 10);
  });
  it('describeAnswers summarises in Dutch', () => {
    assert.equal(describeAnswers({ levensfase: 'gezin', budget: { mode: 'koop', income: 80 }, sfeer: 80 }), 'gezin met kinderen · koop tot ≈ €360k · rustig');
    assert.equal(describeAnswers({}), '');
  });
});
