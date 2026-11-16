import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPS, APPLY, APPLY_ORDER, STEP_PARTS, EMPTY_ANSWERS, normalizeAnswers, isEmptyAnswers, budgetCeiling, answersToPreset, themeWeights,
  encodeAnswers, decodeAnswers, presetFromScore, scoreKind, chosenStoredScore, loadAnswers, saveAnswers, ANSWERS_STORAGE_KEY,
  topAreas, describeAnswers, parseEuroK, SCORE_RE, INCOME_FACTOR, STRESS_W,
} from '../modules/wizard-model.js';
import { STANDAARD, GELIJK, resolvePreset, resolveTargets, quantile, scoreWithPreset, assignScore, themeBreakdown, scoreResult, rowsWithWoonscore, setPersonalPreset, withWoonscore } from '../modules/presets.js';
import { parseHash, serializeHash, sanitizePatch, resolveInitialState, SCORE_STORAGE_KEY, DEFAULT_STATE } from '../modules/state.js';
import { DATASET_KEYS } from '../modules/datasets.js';

const ALL = new Set(DATASET_KEYS);
const FULL = {
  levensfase: 'gezin', bouw: 'modern', budget: { mode: 'koop', income: 80, maxPrice: null, hide: true },
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
    for (const s of APPLY_ORDER) assert.equal(typeof APPLY[s], 'function');
    assert.equal(APPLY_ORDER.at(-1), 'gemeenschap');
    // v0.46.0: five UI steps grouping the appliers; Veiligheid and Bouwstijl are on the result screen.
    assert.deepEqual([...STEPS], ['levensfase', 'budget', 'vervoer', 'buurt', 'buren']);
    for (const s of STEPS) assert.ok(STEP_PARTS[s].length, s);
    const keys = answersToPreset(FULL).themes.flatMap(t => t.metrics.map(m => m.key));
    assert.ok(!keys.some(k => /origin|nonWestern|bornAbroad/.test(k)));
  });
});

describe('wizard: answers → preset', () => {
  it('levensfase gezin: kids share in Leeftijd, school nearby, its quality and kinderopvang stressed', () => {
    const p = answersToPreset({ levensfase: 'gezin' });
    assert.equal(themeOf(p, 'leeftijd').weight, 15);
    assert.equal(metricOf(p, 'leeftijd', 'hhWithKidsPct').pref, 'higher');
    assert.equal(metricOf(p, 'voorzieningen', 'distSchool').w, STRESS_W);
    assert.equal(metricOf(p, 'voorzieningen', 'distKinderopvang').w, STRESS_W);
    assert.deepEqual(metricOf(p, 'voorzieningen', 'eduNearScore'), { key: 'eduNearScore', pref: 'higher', w: STRESS_W });
    assert.equal(metricOf(answersToPreset({ levensfase: 'stel' }), 'voorzieningen', 'eduNearScore'), undefined);
  });
  it('bouwstijl: karakter → more pre-1945 dwellings, modern → more 2005+ (plus newBuildPct); no 65+ rule left', () => {
    const k = answersToPreset({ bouw: 'karakter' });
    assert.deepEqual(themeOf(k, 'nieuwbouw').metrics, [{ key: 'oldBuildPct', pref: 'higher' }]);
    assert.equal(themeOf(k, 'nieuwbouw').label, 'Bouwstijl');
    const m = answersToPreset({ bouw: 'modern' });
    assert.deepEqual(themeOf(m, 'nieuwbouw').metrics, [{ key: 'modernBuildPct', pref: 'higher', w: 2 }, { key: 'newBuildPct', pref: 'higher' }]);
    for (const lf of [null, 'student', 'stel', 'gezin']) {
      for (const bouw of [null, 'karakter', 'modern']) {
        const p = answersToPreset({ levensfase: lf, bouw });
        assert.ok(!metricOf(p, 'leeftijd', 'pop65plus'), `${lf}/${bouw}: never scores 65+ down`);
      }
    }
    // Young families only through levensfase Gezin.
    assert.equal(metricOf(answersToPreset({ levensfase: 'gezin', bouw: 'modern' }), 'leeftijd', 'hhWithKidsPct').pref, 'higher');
    assert.ok(!metricOf(answersToPreset({ levensfase: 'stel', bouw: 'modern' }), 'leeftijd', 'hhWithKidsPct'));
    assert.equal(answersToPreset({ bouw: 'karakter', levensfase: 'student' }).themes.find(t => t.key === 'leeftijd').metrics.length, 2);
  });
  it('bouwstijl: old answers and links keep working', () => {
    assert.equal(normalizeAnswers({ oud: 'gebouwen' }).bouw, 'modern');
    assert.equal(normalizeAnswers({ oud: 'bewoners' }).bouw, null);
    assert.ok(!('oud' in normalizeAnswers({ oud: 'gebouwen' })));
    assert.equal(normalizeAnswers({ bouw: 'karakter', oud: 'gebouwen' }).bouw, 'karakter', 'the new field wins');
    assert.equal(normalizeAnswers({ bouw: 'nieuw' }).bouw, null);
    assert.equal(decodeAnswers('og').bouw, 'modern');
    assert.equal(decodeAnswers('ob').bouw, null);
    assert.equal(isEmptyAnswers(decodeAnswers('ob')), true);
    assert.equal(decodeAnswers('lg.ob').levensfase, 'gezin');
    assert.equal(decodeAnswers('ak').bouw, 'karakter');
    assert.equal(decodeAnswers('am').bouw, 'modern');
    assert.equal(decodeAnswers('ax').bouw, null);
    assert.equal(encodeAnswers({ oud: 'gebouwen' }), 'am');
    assert.equal(encodeAnswers({ bouw: 'karakter' }), 'ak');
    assert.equal(encodeAnswers({ oud: 'bewoners' }), '');
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
  it('vervoer: fiets ×3 on crimeBike, OV on distOv (train/metro/tram), auto on crimeVehicle and lower density', () => {
    const p = answersToPreset({ vervoer: ['fiets', 'ov', 'auto'] });
    assert.equal(metricOf(p, 'veiligheid', 'crimeBike').w, 3);
    assert.equal(metricOf(p, 'voorzieningen', 'distOv').w, STRESS_W);
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
    const p = answersToPreset({ ...FULL, weights: { veiligheid: 0, welvaart: 40, opleiding: 40 } });
    assert.equal(themeOf(p, 'veiligheid').weight, 0);
    assert.equal(themeOf(p, 'welvaart').weight, 40);
    assert.equal(themeOf(p, 'opleiding').weight, 40, 'gezin: Opleiding at base 0, an override still switches it on');
    assert.ok(!resolvePreset(p, ALL).some(f => f.theme === 'veiligheid'));
    assert.equal(themeWeights(FULL).veiligheid, 35, 'themeWeights ignores the overrides');
  });
});

describe('wizard: hash and storage', () => {
  it('round-trips the full answers through the compact string', () => {
    const s = encodeAnswers(FULL);
    assert.match(s, SCORE_RE);
    assert.deepEqual(decodeAnswers(s), normalizeAnswers(FULL));
    assert.equal(s, 'lg.am.bki80x.vfoa.s70.cinfddr.wv50s10');
  });
  it('round-trips every single-step answer', () => {
    for (const a of [{ levensfase: 'senior' }, { levensfase: '50plus' }, { budget: { mode: 'huur' } }, { budget: { mode: 'koop', maxPrice: 425 } },
      { vervoer: ['lopen'] }, { sfeer: 0 }, { sfeer: 100 }, { veiligheid: ['vandalisme', 'straatroof'] }, { weights: { nieuwbouw: 5 } }, { bouw: 'karakter' }, { bouw: 'modern' }]) {
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
  it('a stored score only comes back when the user chose it (v0.54.0)', () => {
    const fresh = memStorage();
    fresh.setItem(SCORE_STORAGE_KEY, 'lg.s30');   // stale: no wizard answers saved here
    assert.equal(resolveInitialState({ hash: '', storage: fresh }).score, null, 'stale custom score: Standaard');
    assert.equal(fresh.getItem(SCORE_STORAGE_KEY), null, 'and removed');
    const std = memStorage(); std.setItem(SCORE_STORAGE_KEY, 'standaard');
    assert.equal(resolveInitialState({ hash: '', storage: std }).score, null);
    const own = memStorage();
    saveAnswers(own, decodeAnswers('lg.s30'));
    own.setItem(SCORE_STORAGE_KEY, encodeAnswers(decodeAnswers('lg.s30')));
    assert.equal(resolveInitialState({ hash: '', storage: own }).score, encodeAnswers(decodeAnswers('lg.s30')), 'own wizard answers win');
    assert.equal(resolveInitialState({ hash: '#score=gelijk', storage: fresh }).score, 'gelijk', 'a link still wins');
    assert.equal(chosenStoredScore('gelijk', null), 'gelijk');
    assert.equal(chosenStoredScore('s30', null), null);
    assert.equal(chosenStoredScore('s30', { sfeer: 70 }), null, 'other answers');
  });
  it('the Milieu importance travels in the hash (letter h)', () => {
    const s = encodeAnswers({ importance: { milieu: 4 } });
    assert.match(s, /h4/);
    assert.equal(decodeAnswers(s).importance.milieu, 4);
    assert.equal(themeOf(answersToPreset({ importance: { milieu: 0 } }), 'milieu').weight, 0);
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

// v0.30: step "Levensfase" renamed "Levenstype", plus two solo options.
import { LEVENSTYPEN, LEVENSFASEN, LEVENSTYPE_HINT, LEVENSTYPE_HINTS } from '../modules/wizard-model.js';
import { GENERAL_SECTIONS } from '../modules/explain.js';
import { DATASETS as DS, } from '../modules/datasets.js';
import { THEME_LABELS, PROFILES } from '../modules/presets.js';
import { extractAreaValues, WIJK_COLUMNS as WC } from '../modules/areas.js';

describe('Levenstype (v0.30)', () => {
  it('keeps the old options and adds two neutrally worded solo options', () => {
    assert.equal(LEVENSFASEN, LEVENSTYPEN, 'old export name still works');
    assert.equal(LEVENSTYPEN.soloMensen, 'Solo, graag onder de mensen');
    assert.equal(LEVENSTYPEN.soloRust, 'Solo, graag op mezelf');
    for (const k of ['student', 'stel', 'gezin', '50plus', 'senior']) assert.ok(LEVENSTYPEN[k], k);
    const text = [...Object.values(LEVENSTYPEN), LEVENSTYPE_HINT].join(' ').toLowerCase();
    for (const bad of ['eenzaam', 'kluizenaar', 'vrijgezel', 'levensfase', 'helaas']) assert.ok(!text.includes(bad), bad);
    assert.match(LEVENSTYPE_HINT, /niet om relaties/);
    assert.equal(THEME_LABELS.leeftijd, 'Levenstype');
  });
  it('old levensfase hashes still decode and re-encode unchanged', () => {
    for (const [code, lf] of [['ls', 'student'], ['lp', 'stel'], ['lg', 'gezin'], ['lv', '50plus'], ['lr', 'senior']]) {
      assert.equal(decodeAnswers(code).levensfase, lf, code);
      assert.equal(encodeAnswers(decodeAnswers(code)), code);
    }
    assert.equal(decodeAnswers('lx').levensfase, null);
  });
  it('round-trips both solo options, alone and with other answers', () => {
    assert.equal(encodeAnswers({ levensfase: 'soloMensen' }), 'lo');
    assert.equal(encodeAnswers({ levensfase: 'soloRust' }), 'lm');
    for (const lf of ['soloMensen', 'soloRust']) {
      for (const a of [{ levensfase: lf }, { levensfase: lf, bouw: 'karakter', sfeer: 30, vervoer: ['fiets'] }]) {
        assert.deepEqual(decodeAnswers(encodeAnswers(a)), normalizeAnswers(a), JSON.stringify(a));
      }
    }
    assert.equal(describeAnswers({ levensfase: 'soloRust' }), 'solo, graag op mezelf');
  });
  it('solo presets are positive-only: every weight above zero, Levenstype metrics only "higher"', () => {
    for (const lf of ['soloMensen', 'soloRust']) {
      const p = answersToPreset({ levensfase: lf });
      for (const t of p.themes) {
        assert.ok(t.weight > 0 || t.key === 'woningmarkt', `${lf} ${t.key}`);
        for (const m of t.metrics) assert.ok((m.w ?? 1) > 0, `${lf} ${t.key}.${m.key}`);
      }
      for (const m of themeOf(p, 'leeftijd')?.metrics ?? []) assert.equal(m.pref, 'higher', `${lf} ${m.key}`);
      assert.equal(themeOf(p, 'sfeer').weight, PROFILES[lf].weights.sfeer);
    }
  });
  it('solo onder de mensen: singles, 25–44, density, horeca, close to centre', () => {
    const p = answersToPreset({ levensfase: 'soloMensen' });
    assert.equal(metricOf(p, 'leeftijd', 'singleHhPct').w, 2);
    assert.ok(metricOf(p, 'leeftijd', 'pop25to44'));
    assert.equal(metricOf(p, 'sfeer', 'density').pref, 'higher');
    assert.equal(metricOf(p, 'sfeer', 'horeca1km').pref, 'higher');
    assert.equal(metricOf(p, 'sfeer', 'distCentrum').pref, 'lower');
  });
  it('solo op mezelf: water, low density, further from centre, no café term', () => {
    const p = answersToPreset({ levensfase: 'soloRust' });
    assert.equal(metricOf(p, 'leeftijd', 'waterPct').pref, 'higher');
    assert.equal(metricOf(p, 'sfeer', 'waterPct').pref, 'higher');
    assert.equal(metricOf(p, 'voorzieningen', 'distGroen').w, 2);
    assert.equal(metricOf(p, 'sfeer', 'density').pref, 'lower');
    assert.equal(metricOf(p, 'sfeer', 'distCentrum').pref, 'higher');
    assert.ok(!p.themes.some(t => t.metrics.some(m => m.key === 'horeca1km' || m.key === 'distCafe')));
  });
  it('an explicit Sfeer answer wins over the solo busy/quiet terms', () => {
    const p = answersToPreset({ levensfase: 'soloRust', sfeer: 10 });
    assert.equal(metricOf(p, 'sfeer', 'density').pref, 'target');
    assert.ok(!metricOf(p, 'sfeer', 'waterPct'), 'the Sfeer targets replace the profile metrics');
    assert.ok(metricOf(p, 'leeftijd', 'waterPct'), 'the Levenstype water term stays');
    assert.equal(themeOf(p, 'sfeer').weight, PROFILES.soloRust.weights.sfeer, 'the profile keeps the theme weight');
  });
  it('new metrics come from 86165NED and are layers with an Uitleg', () => {
    assert.equal(WC.singleHouseholds, 'Eenpersoonshuishoudens_30');
    assert.equal(WC.waterArea, 'OppervlakteWater_117');
    const v = extractAreaValues({ [WC.households]: 200, [WC.singleHouseholds]: 90, [WC.landArea]: 75, [WC.waterArea]: 25 });
    assert.equal(v.singleHhPct, 45);
    assert.equal(v.waterPct, 25);
    assert.equal(extractAreaValues({ [WC.landArea]: 75 }).waterPct, null);
    for (const k of ['singleHhPct', 'waterPct']) { assert.equal(DS[k].scope, 'rotterdam'); assert.equal(DS[k].inOverall, false); assert.ok(DS[k].description); }
  });
  it('Uitleg explains the rename, the solo options and the relative green proxy', () => {
    const s = GENERAL_SECTIONS.find(x => x.id === 'levenstype');
    const text = s.paragraphs.join(' ');
    assert.match(s.title, /levenstype/i);
    assert.match(text, /Solo, graag onder de mensen/);
    assert.match(text, /Solo, graag op mezelf/);
    assert.match(text, /zeldzaam in Rotterdam/);
    assert.match(text, /relatief/);
    assert.ok(!GENERAL_SECTIONS.some(x => x.paragraphs.join(' ').includes('je levensfase')));
    assert.ok(!DS.woonscore.description.includes('levensfase'));
  });
});

// v0.45.0: levenstype profiles (docs/plan-levenstype-gewichten.md).
import { PROFILES as PROF, PROFILE_THEMES, profileThemes, SFEER_METRICS } from '../modules/presets.js';
import { EXTRA_THEME_WEIGHTS as EXTRA, themeImportance as importanceOf, IMPORTANCE as IMP, NOMINAL_BASE, GEMEENSCHAP_DEFAULT_PCT, SITUATIE_HINT, GEMEENSCHAP_HINT } from '../modules/wizard-model.js';

describe('Levenstype profiles (v0.45.0)', () => {
  const weightsOf = p => Object.fromEntries(p.themes.filter(t => t.weight > 0).map(t => [t.key, t.weight]));
  it('one profile per levenstype plus Standaard; each sums to 100 over known themes', () => {
    assert.deepEqual(Object.keys(PROF).sort(), ['standaard', ...Object.keys(LEVENSTYPEN)].sort());
    for (const [k, p] of Object.entries(PROF)) {
      for (const t of Object.keys(p.weights)) assert.ok(PROFILE_THEMES.includes(t), `${k}.${t}`);
      // Standaard (v0.54.0): importance steps, not a 100 split (Gemiddeld 10, Belangrijk 15, Heel belangrijk 20: Veiligheid v0.58.0).
      if (k === 'standaard') {
        assert.ok(Object.values(p.weights).every(w => [0, NOMINAL_BASE, NOMINAL_BASE * 1.5, NOMINAL_BASE * 2].includes(w)), k);
        continue;
      }
      // Nieuwkomer: Sfeer 10 has no direction, so 90 of its 100 has metrics until Sfeer is answered.
      if (k === 'nieuwkomer') {
        assert.equal(Object.values(p.weights).reduce((s, w) => s + w, 0), 100, k);
        assert.equal(profileThemes(k).reduce((s, t) => s + t.weight, 0), 90, k);
        continue;
      }
      assert.equal(Object.values(p.weights).reduce((s, w) => s + w, 0), 100, k);
      assert.equal(profileThemes(k).reduce((s, t) => s + t.weight, 0), 100, `${k}: no weight lost to a theme without metrics`);
    }
  });
  it('every profile metric is a dataset, and directional ones point the right way', () => {
    for (const k of Object.keys(PROF)) for (const t of profileThemes(k)) for (const m of t.metrics) {
      assert.ok(DS[m.key], `${k} ${t.key}.${m.key} is a dataset`);
      if (t.key === 'sfeer' || t.key === 'leeftijd' || m.key === 'ownerOccupiedPct') continue;
      if (DS[m.key].higherIsBetter === true || DS[m.key].higherIsBetter === false) assert.equal(m.pref, DS[m.key].higherIsBetter ? 'higher' : 'lower', `${k} ${m.key}`);
      else assert.equal(m.pref, 'lower', `${k} ${m.key}: a distance`);
    }
    for (const k of ['distOv', 'distGroen', 'distOpenNatuur', 'distPodium', 'waterPct', 'crimePickpocket', 'crimeDrugs', 'eduNearScore']) assert.ok(DS[k], k);
  });
  it('Standaard is neutral (v0.54.0): 15/15/10/15/10, Woningmarkt 0, no Levenstype or Sfeer', () => {
    assert.deepEqual(weightsOf(STANDAARD), { veiligheid: 20, welvaart: 15, voorzieningen: 10, opleiding: 15, milieu: 10 });
    assert.deepEqual(weightsOf(answersToPreset({})), weightsOf(STANDAARD));
    assert.deepEqual(themeWeights({}), { ...weightsOf(STANDAARD), woningmarkt: 0 });
  });
  it('student: no distSchool, distKinderopvang or Woningmarkt; sfeer 40 busy', () => {
    const p = answersToPreset({ levensfase: 'student' });
    assert.deepEqual(weightsOf(p), { veiligheid: 10, voorzieningen: 30, leeftijd: 20, sfeer: 40 });
    const keys = p.themes.flatMap(t => t.metrics.map(m => m.key));
    for (const k of ['distSchool', 'distKinderopvang', 'eduNearScore']) assert.ok(!keys.includes(k), k);
    for (const t of ['woningmarkt', 'welvaart', 'opleiding']) assert.equal(themeOf(p, t).weight, 0, t);
    assert.ok(!resolvePreset(p, ALL).some(f => f.theme === 'woningmarkt'));
    assert.equal(metricOf(p, 'sfeer', 'density').pref, 'higher');
    assert.equal(metricOf(p, 'veiligheid', 'crimeBike').w, 2);
    assert.equal(metricOf(p, 'voorzieningen', 'distOv').w, 2);
  });
  it('gezin: eduNearScore in Voorzieningen, no Opleiding, a quiet Sfeer of 5', () => {
    const p = answersToPreset({ levensfase: 'gezin' });
    assert.deepEqual(metricOf(p, 'voorzieningen', 'eduNearScore'), { key: 'eduNearScore', pref: 'higher', w: 3 });
    assert.equal(themeOf(p, 'opleiding').weight, 0);
    assert.ok(!resolvePreset(p, ALL).some(f => f.theme === 'opleiding'));
    assert.equal(themeOf(p, 'sfeer').weight, 5);
    assert.equal(themeOf(p, 'leeftijd').weight, 15, 'freed Woningmarkt 5 → Levenstype');
    assert.equal(metricOf(p, 'sfeer', 'density').pref, 'lower');
    assert.equal(metricOf(p, 'veiligheid', 'crimeDrugs').w, undefined, 'weight 1');
    assert.ok(!metricOf(p, 'veiligheid', 'crimeRate'));
  });
  it('senior: GP 3, pickpocketing in Veiligheid, no Woningmarkt or Opleiding', () => {
    const p = answersToPreset({ levensfase: 'senior' });
    assert.deepEqual(weightsOf(p), { veiligheid: 35, welvaart: 5, voorzieningen: 40, leeftijd: 10, sfeer: 10 });
    assert.equal(themeOf(p, 'woningmarkt').weight, 0);
    assert.equal(metricOf(p, 'voorzieningen', 'distGP').w, 3);
    assert.ok(metricOf(p, 'veiligheid', 'crimePickpocket'));
  });
  it('an explicit Sfeer answer overrides the profile direction and keeps the profile weight', () => {
    const p = answersToPreset({ levensfase: 'student', sfeer: 90 });
    assert.equal(themeOf(p, 'sfeer').weight, 40);
    assert.deepEqual(themeOf(p, 'sfeer').metrics.map(m => [m.key, m.pref]), [['density', 'target'], ['distCentrum', 'target']]);
    assert.ok(p.targets.density.quantile < 0.5, 'quiet wins over the busy profile');
    assert.equal(themeOf(answersToPreset({ sfeer: 90 }), 'sfeer').weight, EXTRA.sfeer, 'Standaard: the step weight');
    assert.deepEqual(SFEER_METRICS.druk.map(m => m[0]), ['density', 'horeca1km', 'distCentrum', 'distPodium']);
  });
  it('the importance slider scales from the profile weight', () => {
    for (const [lvl, f] of IMP.map((l, i) => [i, l.factor])) {
      const p = answersToPreset({ levensfase: 'student', importance: { sfeer: lvl, veiligheid: lvl } });
      assert.equal(themeOf(p, 'sfeer')?.weight ?? 0, 40 * f);
      assert.equal(themeOf(p, 'veiligheid')?.weight ?? 0, 10 * f);
    }
    assert.equal(themeWeights({ levensfase: 'gezin', importance: { veiligheid: 4 } }).veiligheid, 35);
    assert.equal(importanceOf({ levensfase: 'senior' }).voorzieningen, 2, 'the profile weight is Gemiddeld');
  });
  it('Bouwstijl only when answered, at 5', () => {
    assert.equal(EXTRA.nieuwbouw, 5);
    assert.equal(themeOf(answersToPreset({ bouw: 'karakter' }), 'nieuwbouw').weight, 5);
    assert.ok(!themeOf(answersToPreset({ levensfase: 'stel' }), 'nieuwbouw'));
  });
  it('old hashes still decode; their weights follow the new profiles', () => {
    for (const [code, lf] of [['ls', 'student'], ['lg', 'gezin'], ['lr', 'senior'], ['lo', 'soloMensen'], ['lm', 'soloRust']]) {
      const a = decodeAnswers(code);
      assert.equal(a.levensfase, lf);
      assert.deepEqual(weightsOf(answersToPreset(a)), Object.fromEntries(profileThemes(lf).filter(t => t.weight > 0).map(t => [t.key, t.weight])), code);
    }
    const old = answersToPreset(decodeAnswers('lg.wv70'));
    assert.equal(themeOf(old, 'veiligheid').weight, 70, 'an old absolute weight still applies');
    assert.equal(themeOf(old, 'voorzieningen').weight, 35);
    assert.equal(themeOf(old, 'woningmarkt').weight, 0, 'an old link loses Woningmarkt as intended');
  });
  it('a hint line per levenstype, Stel read as a young couple', () => {
    for (const k of Object.keys(LEVENSTYPEN)) assert.match(LEVENSTYPE_HINTS[k], /Je kunt alles bijstellen\.$/, k);
    assert.match(LEVENSTYPE_HINTS.stel, /jong stel, graag wat te doen/);
    assert.match(LEVENSTYPE_HINTS.student, /veiligheid licht/);
  });
  it('addendum 3: Woningmarkt 0 everywhere; freed points to Levenstype', () => {
    for (const [k, p] of Object.entries(PROF)) assert.equal(p.weights.woningmarkt, 0, k);
    assert.equal(PROF.standaard.weights.voorzieningen, 10, 'v0.54.0: neutral Standaard');
    assert.deepEqual(['stel', 'gezin', '50plus', 'soloRust'].map(k => PROF[k].weights.leeftijd), [15, 15, 10, 5]);
    const huur = answersToPreset({ levensfase: 'student', budget: { mode: 'huur' } });
    assert.equal(themeOf(huur, 'woningmarkt').weight, 0, 'huur only changes the metric, not the weight');
    assert.deepEqual(themeOf(huur, 'woningmarkt').metrics, [{ key: 'rentalPct', pref: 'higher' }]);
  });
  it('addendum 3: a slider on a base-0 theme uses a nominal base of 10', () => {
    assert.equal(NOMINAL_BASE, 10);
    for (const [lvl, f] of IMP.map((l, i) => [i, l.factor])) {
      assert.equal(themeOf(answersToPreset({ importance: { woningmarkt: lvl } }), 'woningmarkt').weight, 10 * f);
      assert.equal(themeOf(answersToPreset({ levensfase: 'student', importance: { welvaart: lvl } }), 'welvaart').weight, 10 * f);
    }
    assert.equal(importanceOf({}).woningmarkt, 0, 'base 0 shows as Niet belangrijk');
    assert.equal(importanceOf({ importance: { woningmarkt: 3 } }).woningmarkt, 3);
    assert.ok(resolvePreset(answersToPreset({ importance: { woningmarkt: 2 } }), ALL).some(f => f.theme === 'woningmarkt'));
  });
  it('addendum 1–2: Situatie 30 when answered, Gemeenschap default 20%, hint lines', () => {
    assert.equal(EXTRA.situatie, 30);
    assert.equal(themeOf(answersToPreset({ situatie: { edu: 'hoog' } }), 'situatie').weight, 30);
    assert.ok(!themeOf(answersToPreset({}), 'situatie'));
    assert.equal(GEMEENSCHAP_DEFAULT_PCT, 20);
    assert.equal(normalizeAnswers({ gemeenschap: { detail: 'nederland' } }).gemeenschap.pct, 20);
    assert.equal(normalizeAnswers({ gemeenschap: { detail: 'nederland', pct: 10 } }).gemeenschap.pct, 10, 'an explicit (old) pct is kept');
    assert.match(SITUATIE_HINT, /dezelfde situatie wonen, scoren hoger/);
    assert.match(GEMEENSCHAP_HINT, /dezelfde achtergrond.*grote gemeenschap.*andere buurten verliezen niets/);
  });
});
