// v0.23.0: the wizard gets a detailed origin group for gemeenten (Gemeenschap,
// CBS 85458NED), the opt-in step "Jouw situatie" (opleiding, income; sliders since W7)
// and a 5-step importance scale per theme. All three keep the W4 rules:
// positive-only, opt-in, never in Standaard, private unless ticked.
import { REGIONS } from '../modules/herkomst-regio.js';
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPS, normalizeAnswers, isEmptyAnswers, answersToPreset, encodeAnswers, decodeAnswers, presetFromScore,
  shareableScore, restoreLocalScore, describeAnswers, themeWeights, themeImportance, importanceFromRatio,
  gemeenschapLevel, guardOrigin, IMPORTANCE, GEMEENSCHAP_LEVEL_PCT, SITUATIE_KEYS, DETAIL_GROUPS,
  EXTRA_THEME_WEIGHTS, SITUATIE_EDU, SITUATIE_INCOME, incomeTarget, monthlyToStandardisedK,
  INCOME_IDEAL_MIN, INCOME_IDEAL_MAX, INCOME_TOLERANCE_LOG,
} from '../modules/wizard-model.js';
import { targetFactor } from '../modules/score.js';
import { STANDAARD, GELIJK, ORIGIN_KEYS, resolvePreset, scoreWithPreset, rowsWithWoonscore, setPersonalPreset } from '../modules/presets.js';
import { explain } from '../modules/score.js';
import {
  DETAIL_KEYS, buildGemeenteGroupUrl, parseGemeenteGroupRows, loadGemeenteGroup, getGemeenteGroup,
  missingDetailGroups, withDetailShares, _setGemeenteGroup,
} from '../modules/herkomst-gemeente.js';
import { HK, ORIGIN_GROUPS } from '../modules/herkomst.js';
import { DATASET_KEYS } from '../modules/datasets.js';
import { GENERAL_SECTIONS } from '../modules/explain.js';

const std = k => STANDAARD.themes.find(t => t.key === k).weight;
const themeOf = (p, k) => p.themes.find(t => t.key === k);
const ALL = new Set([...DATASET_KEYS, 'lowEdu', 'medEdu', ...DETAIL_KEYS]);

afterEach(() => { for (const g of Object.keys(DETAIL_GROUPS)) _setGemeenteGroup(g, null); setPersonalPreset(null); });

describe('Importance scale (5 steps per theme)', () => {
  it('has the five labels and maps to 0, 0.5, 1, 1.5, 2 × the Standaard weight', () => {
    assert.deepEqual(IMPORTANCE.map(l => l.label), ['Niet belangrijk', 'Beetje', 'Gemiddeld', 'Belangrijk', 'Heel belangrijk']);
    for (const [lvl, f] of [[0, 0], [1, 0.5], [2, 1], [3, 1.5], [4, 2]]) {
      const p = answersToPreset({ importance: { veiligheid: lvl, welvaart: lvl } });
      assert.equal(themeOf(p, 'veiligheid').weight, std('veiligheid') * f);
      assert.equal(themeOf(p, 'welvaart').weight, std('welvaart') * f);
    }
  });
  it('"Niet belangrijk" drops the theme from the factors', () => {
    const f = resolvePreset(answersToPreset({ importance: { veiligheid: 0 } }), ALL);
    assert.ok(!f.some(x => x.theme === 'veiligheid'));
    assert.ok(f.some(x => x.theme === 'welvaart'));
  });
  it('applies to the optional themes too, relative to the weight the steps give', () => {
    const p = answersToPreset({ sfeer: 20, situatie: { edu: 'laag' }, importance: { sfeer: 4, situatie: 1 } });
    assert.equal(themeOf(p, 'sfeer').weight, EXTRA_THEME_WEIGHTS.sfeer * 2);
    assert.equal(themeOf(p, 'situatie').weight, EXTRA_THEME_WEIGHTS.situatie * 0.5);
    assert.equal(themeWeights({ sfeer: 20, importance: { sfeer: 4 } }).sfeer, EXTRA_THEME_WEIGHTS.sfeer, 'base ignores the level');
  });
  it('round-trips in the hash as an `i` segment; out-of-range or unknown parts are dropped', () => {
    const a = normalizeAnswers({ importance: { veiligheid: 4, opleiding: 0, situatie: 3 } });
    const s = encodeAnswers(a);
    assert.match(s, /(^|\.)iv4o0t3($|\.)/);
    assert.deepEqual(decodeAnswers(s).importance, a.importance);
    assert.deepEqual(decodeAnswers('iv9q2e1').importance, { welvaart: 1 });
    assert.deepEqual(normalizeAnswers({ importance: { veiligheid: 7, gemeenschap: 4, onzin: 2, welvaart: -3 } }).importance, { veiligheid: 4, welvaart: 0 });
    assert.equal(isEmptyAnswers({ importance: { veiligheid: 2 } }), false);
  });
  it('old hashes with absolute `w` weights still parse and show as the nearest level', () => {
    const old = decodeAnswers('lg.wv70e0');
    assert.equal(old.weights.veiligheid, 70);
    assert.equal(themeOf(answersToPreset(old), 'veiligheid').weight, 70);
    const imp = themeImportance(old);
    assert.equal(imp.veiligheid, 4, '70 / 35 = 2 → Heel belangrijk');
    assert.equal(imp.welvaart, 0);
    assert.equal(imp.voorzieningen, 2);
    assert.equal(importanceFromRatio(0.6), 1);
  });
  it('the level wins over an old weight for the same theme', () => {
    assert.equal(themeOf(answersToPreset({ weights: { veiligheid: 90 }, importance: { veiligheid: 1 } }), 'veiligheid').weight, std('veiligheid') / 2);
  });
  it('Gemeenschap levels are fixed shares of the total; level 1 at least', () => {
    assert.deepEqual([...GEMEENSCHAP_LEVEL_PCT], [0, 5, 10, 20, 30]);
    assert.deepEqual([5, 10, 15, 20, 25, 30].map(gemeenschapLevel), [1, 2, 2, 3, 3, 4]);
  });
});

describe('Jouw situatie (opleidingsniveau, bijstand)', () => {
  it('is an optional step before Gemeenschap, off by default and never in Standaard or Gelijk', () => {
    assert.equal(STEPS.at(-2), 'situatie');
    assert.equal(normalizeAnswers({}).situatie, null);
    for (const p of [STANDAARD, GELIJK, answersToPreset({}), presetFromScore(null)]) assert.ok(!p.themes.some(t => t.key === 'situatie'));
    assert.equal(normalizeAnswers({ situatie: { edu: 'onbekend', bijstand: 'ja', income: 'm999' } }).situatie, null);
  });
  it('an opleidingsniveau attracts to more people of that level and replaces Opleiding', () => {
    for (const [edu, key] of [['basis', 'lowEdu'], ['laag', 'lowEdu'], ['middelbaar', 'medEdu'], ['hoog', 'highEdu']]) {
      const p = answersToPreset({ situatie: { edu } });
      assert.ok(!themeOf(p, 'opleiding'), edu);
      assert.deepEqual(themeOf(p, 'situatie').metrics.map(m => [m.key, m.pref]), [[key, 'higher']]);
      assert.match(themeOf(p, 'situatie').metrics[0].label, /vergelijkbare situatie/);
    }
  });
  it('the Bijstand income stop turns welfarePer1000 from a minus into a plus for that user only', () => {
    const p = answersToPreset({ situatie: { income: 'bijstand' } });
    assert.ok(!themeOf(p, 'welvaart'), 'Welvaart left empty is dropped');
    assert.deepEqual(themeOf(p, 'situatie').metrics.map(m => [m.key, m.pref]), [['avgIncome', 'target'], ['welfarePer1000', 'higher']]);
    assert.ok(themeOf(answersToPreset({}), 'welvaart').metrics.some(m => m.key === 'welfarePer1000' && m.pref === 'lower'));
    const areas = [{ code: 'A', values: { welfarePer1000: 80, avgIncome: 30 } }, { code: 'B', values: { welfarePer1000: 10, avgIncome: 30 } }, { code: 'C', values: { welfarePer1000: 40, avgIncome: 30 } }];
    const r = scoreWithPreset(areas, p).results;
    assert.ok(r.find(x => x.code === 'A').score > r.find(x => x.code === 'B').score);
    assert.ok(!explain(r.find(x => x.code === 'B')).minus.some(f => f.theme === 'situatie'), 'never a minus');
  });
  it('round-trips as a `j` segment and stays out of links unless ticked in "Deellink maken"', () => {
    for (const s of [{ edu: 'laag', income: 'bijstand' }, { edu: 'hoog' }, { income: 'm7500', share: true }, { edu: 'basis', income: 'hoger' }]) {
      const a = normalizeAnswers({ sfeer: 40, situatie: s });
      assert.deepEqual(decodeAnswers(encodeAnswers(a)).situatie, a.situatie);
    }
    const priv = encodeAnswers({ sfeer: 40, situatie: { edu: 'laag', income: 'bijstand' } });
    assert.equal(priv, 's40.jl0');
    assert.equal(shareableScore(priv), 's40');
    assert.equal(shareableScore('s40.jl0x'), 's40', 'old x flag ignored');
    assert.deepEqual(decodeAnswers('s40.jl0x').situatie, { edu: 'laag', income: 'bijstand' });
    assert.equal(shareableScore(priv, { education: true }), 's40.jl');
    assert.equal(shareableScore(priv, { income: true }), 's40.j0');
    assert.equal(shareableScore(priv, { education: true, income: true }), priv);
    assert.equal(restoreLocalScore('s40', priv), priv, 'local choice survives a reload');
    for (const bad of ['j', 'jx', 'jq', 'jbl', 'j-l', 'j9', 'j0b', 'jl12', 'j0l']) assert.equal(decodeAnswers(`s40.${bad}`).situatie, null, bad);
  });
  it('the guard keeps the Situatie theme positive-only, whatever a preset says', () => {
    const forged = guardOrigin({ themes: [
      { key: 'situatie', weight: 10, metrics: [{ key: 'lowEdu', pref: 'lower' }, { key: 'welfarePer1000', pref: 'lower' }, { key: 'avgIncome', pref: 'higher' }, { key: 'medEdu', pref: 'higher' }] },
      { key: 'welvaart', weight: 10, metrics: [{ key: 'welfarePer1000', pref: 'higher' }, { key: 'lowEdu', pref: 'lower' }, { key: 'avgIncome', pref: 'higher' }] },
    ], targets: { lowEdu: { ideal: 1, tolerance: 1 } }, filters: [{ key: 'medEdu', max: 3 }] });
    assert.deepEqual(themeOf(forged, 'situatie').metrics.map(m => m.key), ['medEdu']);
    assert.deepEqual(themeOf(forged, 'welvaart').metrics.map(m => m.key), ['avgIncome']);
    assert.deepEqual(forged.targets, {});
    assert.deepEqual(forged.filters, []);
    const f = resolvePreset({ themes: [{ key: 'situatie', weight: 5, metrics: [{ key: 'lowEdu', pref: 'lower' }] }, { key: 'x', weight: 5, metrics: [{ key: 'avgIncome', pref: 'higher' }] }] }, ALL);
    assert.ok(!f.some(x => x.theme === 'situatie'), 'scoring-time guard');
  });
  it('fuzzed hashes never yield a non-positive Situatie metric', () => {
    const alphabet = 'jlmhbxs0123456789.iwgtv';
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let n = 0; n < 400; n++) {
      const s = Array.from({ length: 2 + Math.floor(rnd() * 14) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
      const p = presetFromScore(s);
      for (const t of p.themes) for (const m of t.metrics) {
        if (t.key === 'situatie') assert.ok((SITUATIE_KEYS.includes(m.key) && m.pref === 'higher') || (m.key === 'avgIncome' && m.pref === 'target' && p.targets.avgIncome?.tolerance > 0), s);
        else assert.ok(!['lowEdu', 'medEdu'].includes(m.key) && (m.key !== 'welfarePer1000' || m.pref === 'lower') && !(m.key === 'avgIncome' && p.targets.avgIncome), s);
      }
    }
  });
  it('is described and explained', () => {
    assert.match(describeAnswers({ situatie: { edu: 'middelbaar', bijstand: true } }), /vergelijkbare situatie: opleiding havo–vwo–mbo-4, inkomen bijstand/);
    assert.match(describeAnswers({ situatie: { income: 'm2500' } }), /inkomen ± €2\.500\/mnd/);
    assert.ok(GENERAL_SECTIONS.some(s => s.id === 'situatie'));
    assert.ok(GENERAL_SECTIONS.some(s => s.id === 'belang'));
  });
});

describe('Jouw situatie sliders (income, education; W7)', () => {
  const income = (code, v) => ({ code, values: { avgIncome: v, welfarePer1000: 20, highEdu: 30, lowEdu: 30, medEdu: 40 } });
  it('income bands map to an avgIncome target by the stated rule, clamped to the area range', () => {
    assert.deepEqual(Object.keys(SITUATIE_INCOME), ['bijstand', 'm500', 'm2500', 'm5000', 'm7500', 'm10000', 'm15000', 'm30000', 'hoger']);
    assert.deepEqual(Object.values(SITUATIE_INCOME).map(b => b.code).join(''), '012345678');
    assert.equal(Math.round(monthlyToStandardisedK(5000) * 10) / 10, 46.2);
    assert.deepEqual(incomeTarget('m5000'), { ideal: 46.2, tolerance: INCOME_TOLERANCE_LOG, log: true });
    assert.equal(incomeTarget('m7500').ideal, 69.2);
    assert.equal(incomeTarget('m10000').ideal, 92.3);
    for (const b of ['bijstand', 'm500']) assert.equal(incomeTarget(b).ideal, INCOME_IDEAL_MIN, b);
    assert.equal(incomeTarget('m2500').ideal, 23.1);
    for (const b of ['m15000', 'm30000', 'hoger']) assert.equal(incomeTarget(b).ideal, INCOME_IDEAL_MAX, b);
    assert.equal(incomeTarget('onzin'), null);
    const ideals = Object.keys(SITUATIE_INCOME).map(b => incomeTarget(b).ideal);
    assert.deepEqual(ideals, [...ideals].sort((x, y) => x - y), 'monotone in the band');
  });
  it('a band puts the target in Situatie and takes avgIncome out of Welvaart', () => {
    const p = answersToPreset({ situatie: { income: 'm7500' } });
    assert.deepEqual(themeOf(p, 'situatie').metrics.map(m => [m.key, m.pref]), [['avgIncome', 'target']]);
    assert.deepEqual(p.targets.avgIncome, incomeTarget('m7500'));
    assert.deepEqual(themeOf(p, 'welvaart').metrics.map(m => [m.key, m.pref]), [['welfarePer1000', 'lower']], 'higher bands keep the Standaard welfare minus');
    const f = resolvePreset(p, ALL).filter(x => x.key === 'avgIncome');
    assert.deepEqual(f.map(x => [x.theme, x.pref, x.ideal, x.log]), [['situatie', 'target', 69.2, true]]);
    assert.ok(themeOf(answersToPreset({ situatie: { income: 'm500' } }), 'situatie').metrics.some(m => m.key === 'welfarePer1000' && m.pref === 'higher'));
  });
  it('low bands prefer low-income areas, high bands high-income areas', () => {
    const areas = [income('LOW', 26), income('MID', 42), income('HIGH', 85)];
    const top = band => { const r = scoreWithPreset(areas, answersToPreset({ situatie: { income: band }, importance: { situatie: 4 } })).results; return [...r].sort((a, b) => b.score - a.score)[0].code; };
    assert.equal(top('bijstand'), 'LOW');
    assert.equal(top('m2500'), 'LOW');
    assert.equal(top('m5000'), 'MID');
    assert.equal(top('hoger'), 'HIGH');
  });
  it('the education slider maps to the share of the same level', () => {
    const keys = Object.fromEntries(Object.entries(SITUATIE_EDU).map(([k, e]) => [k, e.key]));
    assert.deepEqual(keys, { basis: 'lowEdu', laag: 'lowEdu', middelbaar: 'medEdu', hoog: 'highEdu' });
    const areas = [{ code: 'L', values: { lowEdu: 50, medEdu: 30, highEdu: 20, avgIncome: 35 } }, { code: 'H', values: { lowEdu: 10, medEdu: 30, highEdu: 60, avgIncome: 35 } }];
    const best = edu => { const r = scoreWithPreset(areas, answersToPreset({ situatie: { edu } })).results; return [...r].sort((a, b) => b.score - a.score)[0].code; };
    assert.equal(best('basis'), 'L');
    assert.equal(best('hoog'), 'H');
  });
  it('unset (Niet invullen) gives no factor and leaves Standaard alone', () => {
    for (const s of [{}, { edu: null, income: null }, { edu: '', income: '' }]) {
      assert.equal(normalizeAnswers({ situatie: s }).situatie, null);
      const p = answersToPreset({ situatie: s });
      assert.ok(!themeOf(p, 'situatie'));
      assert.deepEqual(p.targets, {});
      assert.deepEqual(themeOf(p, 'welvaart').metrics.map(m => m.key), ['avgIncome', 'welfarePer1000']);
    }
    const eduOnly = answersToPreset({ situatie: { edu: 'laag' } });
    assert.ok(!('avgIncome' in eduOnly.targets) && themeOf(eduOnly, 'welvaart').metrics.some(m => m.key === 'avgIncome' && m.pref === 'higher'));
  });
  it('old hashes and the old bijstand field still decode', () => {
    assert.deepEqual(decodeAnswers('jlb').situatie, { edu: 'laag', income: 'bijstand' });
    assert.deepEqual(decodeAnswers('jb').situatie, { edu: null, income: 'bijstand' });
    assert.deepEqual(decodeAnswers('jhbx').situatie, { edu: 'hoog', income: 'bijstand' });
    assert.deepEqual(decodeAnswers('jm').situatie, { edu: 'middelbaar', income: null });
    assert.deepEqual(decodeAnswers('jmx').situatie, { edu: 'middelbaar', income: null });
    assert.deepEqual(normalizeAnswers({ situatie: { bijstand: true } }).situatie, { edu: null, income: 'bijstand' });
    assert.equal(normalizeAnswers({ situatie: { bijstand: true, income: 'm5000' } }).situatie.income, 'm5000', 'an explicit band wins');
    assert.equal(encodeAnswers(decodeAnswers('jlb')), 'jl0', 're-encodes in the new form');
    assert.ok(!('bijstand' in normalizeAnswers({ situatie: { edu: 'laag' } }).situatie), 'bijstand is gone from the model');
  });
  it('positive-only: no Situatie factor is a minus; only the target falloff shapes income', () => {
    for (const band of Object.keys(SITUATIE_INCOME)) {
      const p = answersToPreset({ situatie: { income: band, edu: 'laag' } });
      for (const m of themeOf(p, 'situatie').metrics) assert.ok(m.pref === 'higher' || (m.key === 'avgIncome' && m.pref === 'target'), band);
      const t = p.targets.avgIncome;
      // Falloff: 1 at the ideal, never negative, non-increasing away from it on both sides.
      assert.equal(targetFactor(t.ideal, t.ideal, t.tolerance, { log: true }), 1);
      let prevUp = 1, prevDown = 1;
      for (let k = 1; k <= 40; k++) {
        const up = targetFactor(t.ideal * (1 + k / 10), t.ideal, t.tolerance, { log: true });
        const down = targetFactor(t.ideal / (1 + k / 10), t.ideal, t.tolerance, { log: true });
        assert.ok(up >= 0 && up <= prevUp && down >= 0 && down <= prevDown, band);
        prevUp = up; prevDown = down;
      }
      const areas = [income('A', 25), income('B', 45), income('C', 95), { code: 'D', values: { avgIncome: 60, welfarePer1000: 90, lowEdu: 5, medEdu: 40, highEdu: 55 } }];
      for (const r of scoreWithPreset(areas, p).results) assert.ok(!explain(r).minus.some(f => f.theme === 'situatie'), `${band} ${r.code}`);
    }
    const forged = guardOrigin({ themes: [{ key: 'situatie', weight: 5, metrics: [{ key: 'avgIncome', pref: 'target' }, { key: 'avgIncome', pref: 'lower' }] }, { key: 'welvaart', weight: 5, metrics: [{ key: 'avgIncome', pref: 'higher' }] }], targets: { avgIncome: { ideal: 1, tolerance: 0 } } });
    assert.ok(!themeOf(forged, 'situatie'), 'no valid target: the income metric is dropped');
    assert.ok(!themeOf(forged, 'welvaart').metrics.length, 'avgIncome cannot become a target outside Situatie');
    assert.ok(!resolvePreset({ themes: [{ key: 'situatie', weight: 5, metrics: [{ key: 'avgIncome', pref: 'target' }] }], targets: {} }, ALL).length, 'scoring-time guard');
  });
});

describe('Gemeenschap: detailed origin group for gemeenten (85458NED)', () => {
  it('offers the herkomst.js groups (Nederland first, v0.26.0), each with a unique two-letter code', () => {
    // + Polen, Duitsland, België (v0.25.0), + the world regions not equal to a group (v0.28.0)
    assert.equal(Object.keys(DETAIL_GROUPS).length, ORIGIN_GROUPS.length + 3 + REGIONS.filter(r => !r.same).length);
    assert.equal(Object.keys(DETAIL_GROUPS)[0], 'nederland');
    assert.deepEqual([DETAIL_GROUPS.nederland.key, DETAIL_GROUPS.nederland.code, DETAIL_GROUPS.nederland.direct], ['originDutchPct', 'nl', true]);
    assert.ok(!DETAIL_KEYS.includes('originDutchPct'), 'nothing to fetch for Nederland');
    assert.equal(buildGemeenteGroupUrl('nederland'), null);
    assert.ok(DETAIL_GROUPS.suriname && DETAIL_GROUPS.turkije && DETAIL_GROUPS.marokko);
    const codes = Object.values(DETAIL_GROUPS).map(d => d.code);
    assert.equal(new Set(codes).size, codes.length);
    for (const c of codes) assert.match(c, /^[a-z]{2}$/);
    for (const k of DETAIL_KEYS) assert.ok(ORIGIN_KEYS.includes(k), 'detailed keys are origin keys');
  });
  it('round-trips in the hash; old g segments parse unchanged; unknown codes are dropped whole', () => {
    for (const g of [{ detail: 'suriname', pct: 10 }, { group: 'buitenEuropa', detail: 'marokko', pct: 20, share: true }, { group: 'nederland', pct: 5 }, { detail: 'nederland', pct: 30 }]) {
      const a = normalizeAnswers({ gemeenschap: g });
      assert.deepEqual(decodeAnswers(encodeAnswers(a)).gemeenschap, a.gemeenschap);
    }
    assert.equal(encodeAnswers({ gemeenschap: { detail: 'suriname', pct: 10, share: true } }), 'ghsr10');
    assert.deepEqual(decodeAnswers('gd10x').gemeenschap, { detail: 'nederland', pct: 10 });
    assert.deepEqual(decodeAnswers('gbhtr20').gemeenschap, { detail: 'turkije', pct: 20 });
    for (const bad of ['ghzz10', 'gqhsr10', 'ghsr0', 'ghsr-10', 'gh10', 'ghsrl10']) assert.equal(decodeAnswers(bad).gemeenschap, null, bad);
    assert.equal(shareableScore('s40.ghsr10'), 's40');
  });
  it('an old broad group next to a detailed one is dropped: one factor, the detailed share', () => {
    const p = answersToPreset({ gemeenschap: { group: 'buitenEuropa', detail: 'suriname', pct: 20 } });
    assert.deepEqual(themeOf(p, 'gemeenschap').metrics.map(m => [m.key, m.pref]), [['hk_suriname', 'higher']]);
    const wk = resolvePreset(p, new Set(['avgIncome', 'nonWesternPct'])).filter(f => f.theme === 'gemeenschap');
    assert.deepEqual(wk, []);
  });
  it('Nederland counts at gemeente, wijk and buurt level and loads nothing', async () => {
    const p = answersToPreset({ gemeenschap: { detail: 'nederland' } });
    assert.deepEqual(resolvePreset(p, new Set(['avgIncome', 'originDutchPct'])).filter(f => f.theme === 'gemeenschap').map(f => [f.key, f.pref]), [['originDutchPct', 'higher']]);
    assert.deepEqual(missingDetailGroups(p), []);
    let calls = 0;
    assert.equal((await loadGemeenteGroup('nederland', { fetcher: () => { calls++; } })).size, 0);
    assert.equal(calls, 0);
  });
  it('a detailed group alone is skipped at wijk/buurt level, not replaced by a broad group', () => {
    const p = answersToPreset({ gemeenschap: { detail: 'suriname' } });
    const wk = resolvePreset(p, new Set(['avgIncome', 'nonWesternPct', 'originDutchPct', 'originEuropePct']));
    assert.ok(!wk.some(f => f.theme === 'gemeenschap' || ORIGIN_KEYS.includes(f.key)));
  });
  it('can never score a detailed group down', () => {
    const forged = { themes: [{ key: 'gemeenschap', weight: 10, metrics: [{ key: 'hk_turkije', pref: 'lower' }] }, { key: 'x', weight: 10, metrics: [{ key: 'hk_marokko', pref: 'higher' }, { key: 'avgIncome', pref: 'higher' }] }], targets: { hk_suriname: { ideal: 0, tolerance: 1 } }, filters: [{ key: 'hk_suriname', max: 1 }] };
    const g = guardOrigin(forged);
    assert.ok(!g.themes.some(t => t.metrics.some(m => DETAIL_KEYS.includes(m.key))));
    assert.deepEqual(g.targets, {});
    assert.deepEqual(g.filters, []);
    assert.ok(!resolvePreset(forged, ALL).some(f => f.key === 'hk_turkije'));
  });
  it('describes both groups with their level', () => {
    assert.match(describeAnswers({ gemeenschap: { group: 'buitenEuropa', detail: 'suriname' } }), /nabijheid gemeenschap: Suriname \(gemeenten; wijk\/buurt geschat via postcode\)$/);
  });
});

describe('herkomst-gemeente: fetching and merging the detailed share', () => {
  const rows = [
    { RegioS: 'GM0599', Herkomstland: HK.total, Bevolking_1: 1000 }, { RegioS: 'GM0599', Herkomstland: HK.suriname, Bevolking_1: 80 },
    { RegioS: 'GM0363', Herkomstland: HK.total, Bevolking_1: 2000 }, { RegioS: 'GM0363', Herkomstland: HK.suriname, Bevolking_1: 40 },
    { RegioS: 'GM0001', Herkomstland: HK.total, Bevolking_1: 500 },
    { RegioS: 'NL01  ', Herkomstland: HK.total, Bevolking_1: 9 },
  ];
  it('builds one query for every gemeente with the group keys and Totaal', () => {
    const u = decodeURIComponent(buildGemeenteGroupUrl('subSahara'));
    assert.match(u, /85458NED\/TypedDataSet/);
    assert.match(u, /startswith\(RegioS,'GM'\)/);
    for (const k of [HK.total, HK.africa, HK.morocco, HK.egypt]) assert.ok(u.includes(`'${k}'`), k);
    assert.equal(buildGemeenteGroupUrl('nl'), null);
  });
  it('parses shares in %, plus-minus groups included; a gemeente with a missing cell is left out', () => {
    const m = parseGemeenteGroupRows(rows, 'suriname');
    assert.deepEqual([...m], [['GM0599', 8], ['GM0363', 2]]);
    const ss = parseGemeenteGroupRows([{ RegioS: 'GM1', Herkomstland: HK.total, Bevolking_1: 100 }, { RegioS: 'GM1', Herkomstland: HK.africa, Bevolking_1: 30 }, { RegioS: 'GM1', Herkomstland: HK.morocco, Bevolking_1: 20 }, { RegioS: 'GM1', Herkomstland: HK.egypt, Bevolking_1: 5 }], 'subSahara');
    assert.equal(ss.get('GM1'), 5);
  });
  it('loads once per group, reports missing groups and adds the share only to gemeente rows', async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return { ok: true, json: async () => ({ value: rows }) }; };
    const preset = answersToPreset({ gemeenschap: { detail: 'suriname' } });
    assert.deepEqual(missingDetailGroups(preset), ['suriname']);
    await Promise.all([loadGemeenteGroup('suriname', { fetcher }), loadGemeenteGroup('suriname', { fetcher })]);
    await loadGemeenteGroup('suriname', { fetcher });
    assert.equal(calls, 1);
    assert.equal(getGemeenteGroup('suriname').get('GM0599'), 8);
    assert.deepEqual(missingDetailGroups(preset), []);
    assert.equal(withDetailShares({ a: 1 }, 'GM0599').hk_suriname, 8);
    assert.deepEqual(withDetailShares({ a: 1 }, 'WK059901'), { a: 1 });
    await assert.rejects(loadGemeenteGroup('turkije', { fetcher: async () => ({ ok: false, status: 500 }) }));
    assert.equal(getGemeenteGroup('turkije'), null, 'a failed load is retried later');
  });
  it('rowsWithWoonscore scores gemeenten on the detailed share without adding it to the rows', () => {
    _setGemeenteGroup('suriname', new Map([['GM0001', 20], ['GM0002', 1], ['GM0003', 5]]));
    setPersonalPreset(answersToPreset({ gemeenschap: { detail: 'suriname', pct: 30 } }));
    const rows2 = ['GM0001', 'GM0002', 'GM0003'].map(c => ({ regionCode: c, avgIncome: 30, highEdu: 30 }));
    const out = rowsWithWoonscore(rows2);
    const by = Object.fromEntries(out.map(r => [r.regionCode, r.woonscore]));
    assert.ok(by.GM0001 > by.GM0003 && by.GM0003 > by.GM0002, JSON.stringify(by));
    assert.ok(!('hk_suriname' in out[0]));
  });
});
