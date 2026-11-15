// v0.23.0: the wizard gets a detailed origin group for gemeenten (Gemeenschap,
// CBS 85458NED), the opt-in step "Jouw situatie" (opleidingsniveau, bijstand)
// and a 5-step importance scale per theme. All three keep the W4 rules:
// positive-only, opt-in, never in Standaard, private unless ticked.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPS, normalizeAnswers, isEmptyAnswers, answersToPreset, encodeAnswers, decodeAnswers, presetFromScore,
  shareableScore, restoreLocalScore, describeAnswers, themeWeights, themeImportance, importanceFromRatio,
  gemeenschapLevel, guardOrigin, IMPORTANCE, GEMEENSCHAP_LEVEL_PCT, SITUATIE_KEYS, DETAIL_GROUPS,
  EXTRA_THEME_WEIGHTS,
} from '../modules/wizard-model.js';
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
    assert.equal(normalizeAnswers({ situatie: { edu: 'onbekend', bijstand: 'ja' } }).situatie, null);
  });
  it('an opleidingsniveau attracts to more people of that level and replaces Opleiding', () => {
    for (const [edu, key] of [['laag', 'lowEdu'], ['middelbaar', 'medEdu'], ['hoog', 'highEdu']]) {
      const p = answersToPreset({ situatie: { edu } });
      assert.ok(!themeOf(p, 'opleiding'), edu);
      assert.deepEqual(themeOf(p, 'situatie').metrics.map(m => [m.key, m.pref]), [[key, 'higher']]);
      assert.match(themeOf(p, 'situatie').metrics[0].label, /vergelijkbare situatie/);
    }
  });
  it('bijstand turns welfarePer1000 from a minus into a plus for that user only', () => {
    const p = answersToPreset({ situatie: { bijstand: true } });
    assert.ok(!themeOf(p, 'welvaart').metrics.some(m => m.key === 'welfarePer1000'));
    assert.deepEqual(themeOf(p, 'situatie').metrics.map(m => [m.key, m.pref]), [['welfarePer1000', 'higher']]);
    assert.ok(themeOf(answersToPreset({}), 'welvaart').metrics.some(m => m.key === 'welfarePer1000' && m.pref === 'lower'));
    const areas = [{ code: 'A', values: { welfarePer1000: 80, avgIncome: 30 } }, { code: 'B', values: { welfarePer1000: 10, avgIncome: 30 } }, { code: 'C', values: { welfarePer1000: 40, avgIncome: 30 } }];
    const r = scoreWithPreset(areas, p).results;
    assert.ok(r.find(x => x.code === 'A').score > r.find(x => x.code === 'B').score);
    assert.ok(!explain(r.find(x => x.code === 'B')).minus.some(f => f.theme === 'situatie'), 'never a minus');
  });
  it('round-trips as a `j` segment and stays out of shared links unless ticked', () => {
    for (const s of [{ edu: 'laag', bijstand: true }, { edu: 'hoog', bijstand: false }, { edu: null, bijstand: true, share: true }]) {
      const a = normalizeAnswers({ sfeer: 40, situatie: s });
      assert.deepEqual(decodeAnswers(encodeAnswers(a)).situatie, a.situatie);
    }
    const priv = encodeAnswers({ sfeer: 40, situatie: { edu: 'laag', bijstand: true } });
    assert.equal(priv, 's40.jlb');
    assert.equal(shareableScore(priv), 's40');
    assert.equal(shareableScore('s40.jlbx'), 's40.jlbx');
    assert.equal(restoreLocalScore('s40', priv), priv, 'local choice survives a reload');
    for (const bad of ['j', 'jx', 'jq', 'jbl', 'j-l']) assert.equal(decodeAnswers(`s40.${bad}`).situatie, null, bad);
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
        if (t.key === 'situatie') { assert.ok(SITUATIE_KEYS.includes(m.key) && m.pref === 'higher', s); }
        else assert.ok(!['lowEdu', 'medEdu'].includes(m.key) && (m.key !== 'welfarePer1000' || m.pref === 'lower'), s);
      }
    }
  });
  it('is described and explained', () => {
    assert.match(describeAnswers({ situatie: { edu: 'middelbaar', bijstand: true } }), /vergelijkbare situatie: opleiding middelbaar, bijstand/);
    assert.ok(GENERAL_SECTIONS.some(s => s.id === 'situatie'));
    assert.ok(GENERAL_SECTIONS.some(s => s.id === 'belang'));
  });
});

describe('Gemeenschap: detailed origin group for gemeenten (85458NED)', () => {
  it('offers the herkomst.js groups except Nederland, each with a unique two-letter code', () => {
    assert.equal(Object.keys(DETAIL_GROUPS).length, ORIGIN_GROUPS.length - 1 + 3);   // + Polen, Duitsland, België (v0.25.0)
    assert.ok(DETAIL_GROUPS.suriname && DETAIL_GROUPS.turkije && DETAIL_GROUPS.marokko);
    const codes = Object.values(DETAIL_GROUPS).map(d => d.code);
    assert.equal(new Set(codes).size, codes.length);
    for (const c of codes) assert.match(c, /^[a-z]{2}$/);
    for (const k of DETAIL_KEYS) assert.ok(ORIGIN_KEYS.includes(k), 'detailed keys are origin keys');
  });
  it('round-trips in the hash; old g segments parse unchanged; unknown codes are dropped whole', () => {
    for (const g of [{ detail: 'suriname', pct: 10 }, { group: 'buitenEuropa', detail: 'marokko', pct: 20, share: true }, { group: 'nederland', pct: 5 }]) {
      const a = normalizeAnswers({ gemeenschap: g });
      assert.deepEqual(decodeAnswers(encodeAnswers(a)).gemeenschap, a.gemeenschap);
    }
    assert.equal(encodeAnswers({ gemeenschap: { detail: 'suriname', pct: 10, share: true } }), 'ghsr10x');
    assert.deepEqual(decodeAnswers('gd10x').gemeenschap, { group: 'nederland', pct: 10, share: true });
    assert.deepEqual(decodeAnswers('gbhtr20').gemeenschap, { group: 'buitenEuropa', detail: 'turkije', pct: 20, share: false });
    for (const bad of ['ghzz10', 'gqhsr10', 'ghsr0', 'ghsr-10', 'gh10', 'ghsrl10']) assert.equal(decodeAnswers(bad).gemeenschap, null, bad);
    assert.equal(shareableScore('s40.ghsr10'), 's40');
  });
  it('the detailed share counts for gemeenten; the broad group only where it is missing (wijk/buurt)', () => {
    const p = answersToPreset({ gemeenschap: { group: 'buitenEuropa', detail: 'suriname', pct: 20 } });
    const gem = themeOf(p, 'gemeenschap');
    assert.deepEqual(gem.metrics.map(m => [m.key, m.pref]), [['hk_suriname', 'higher'], ['nonWesternPct', 'higher']]);
    const gm = resolvePreset(p, new Set(['avgIncome', 'nonWesternPct', 'hk_suriname'])).filter(f => f.theme === 'gemeenschap');
    assert.deepEqual(gm.map(f => f.key), ['hk_suriname']);
    const wk = resolvePreset(p, new Set(['avgIncome', 'nonWesternPct'])).filter(f => f.theme === 'gemeenschap');
    assert.deepEqual(wk.map(f => f.key), ['nonWesternPct']);
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
    assert.match(describeAnswers({ gemeenschap: { group: 'buitenEuropa', detail: 'suriname' } }), /nabijheid gemeenschap: Suriname \(gemeenten; wijk\/buurt geschat via postcode\) \/ Buiten Europa \(wijk\/buurt\)/);
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
