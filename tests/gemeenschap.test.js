// Epic W4 (docs/plan-woonscore.md §5): the Gemeenschap step is an opt-in,
// positive-only attraction. These tests prove no answers, preset or URL can
// score an origin group down or put a private choice into a shared link.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPS, normalizeAnswers, isEmptyAnswers, answersToPreset, encodeAnswers, decodeAnswers, presetFromScore,
  shareableScore, restoreLocalScore, guardOrigin, describeAnswers, saveAnswers, loadAnswers,
  GEMEENSCHAP_GROUPS, GEMEENSCHAP_DEFAULT_PCT, GEMEENSCHAP_MAX_PCT, GEMEENSCHAP_MIN_PCT,
} from '../modules/wizard-model.js';
import { STANDAARD, GELIJK, PRESETS, ORIGIN_KEYS, resolvePreset, scoreWithPreset, themeBreakdown } from '../modules/presets.js';
import { explain } from '../modules/score.js';
import { serializeHash, resolveInitialState, SCORE_STORAGE_KEY, DEFAULT_STATE } from '../modules/state.js';
import { GENERAL_SECTIONS } from '../modules/explain.js';
import { DATASET_KEYS } from '../modules/datasets.js';

const ALL = new Set(DATASET_KEYS);
const originMetrics = p => p.themes.flatMap(t => t.metrics.filter(m => ORIGIN_KEYS.includes(m.key)).map(m => ({ ...m, theme: t.key, themeWeight: t.weight })));
const assertPositiveOnly = (p, msg) => {
  for (const m of originMetrics(p)) {
    assert.equal(m.theme, 'gemeenschap', msg);
    assert.equal(m.pref, 'higher', msg);
    assert.ok(m.themeWeight > 0, msg);
    assert.ok(!(m.w <= 0), msg);
  }
  for (const k of ORIGIN_KEYS) assert.ok(!(k in (p.targets ?? {})), msg);
  assert.ok(!(p.filters ?? []).some(f => ORIGIN_KEYS.includes(f.key)), msg);
  assert.ok(originMetrics(p).length <= 1, msg);
};
const memStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const area = (code, o) => ({ code, values: { originDutchPct: o, crimeRate: 50, avgIncome: 30, highEdu: 30 } });

describe('Gemeenschap: off by default, never in Standaard or Gelijk', () => {
  it('is the optional sixth step and absent from the empty answers', () => {
    assert.equal(STEPS.at(-1), 'gemeenschap');
    assert.equal(normalizeAnswers({}).gemeenschap, null);
    assert.equal(originMetrics(answersToPreset({})).length, 0);
    assert.ok(isEmptyAnswers({}));
    assert.ok(!isEmptyAnswers({ gemeenschap: { group: 'europa' } }));
  });
  it('no fixed preset uses any origin metric', () => {
    for (const p of [STANDAARD, GELIJK, ...Object.values(PRESETS)]) assert.equal(originMetrics(p).length, 0, p.id);
    assert.equal(presetFromScore(null), STANDAARD);
    assert.equal(presetFromScore('gelijk'), GELIJK);
  });
});

describe('Gemeenschap: one group, higher, user weight', () => {
  it('adds one `higher` factor on the chosen group at the default 10 % of the total', () => {
    for (const [group, g] of Object.entries(GEMEENSCHAP_GROUPS)) {
      const p = answersToPreset({ gemeenschap: { group } });
      const t = p.themes.find(x => x.key === 'gemeenschap');
      assert.deepEqual(t.metrics.map(m => [m.key, m.pref]), [[g.key, 'higher']]);
      assert.match(t.metrics[0].label, /^Nabijheid gemeenschap/);
      const total = p.themes.reduce((s, x) => s + x.weight, 0);
      assert.ok(Math.abs(t.weight / total - GEMEENSCHAP_DEFAULT_PCT / 100) < 0.002, group);
    }
  });
  it('weight is clamped to 5–30 %; zero, negative or junk turns it off', () => {
    assert.equal(normalizeAnswers({ gemeenschap: { group: 'nederland', pct: 99 } }).gemeenschap.pct, GEMEENSCHAP_MAX_PCT);
    assert.equal(normalizeAnswers({ gemeenschap: { group: 'nederland', pct: 1 } }).gemeenschap.pct, GEMEENSCHAP_MIN_PCT);
    for (const pct of [0, -10, -0.5, NaN, 'x', Infinity * -1]) assert.equal(normalizeAnswers({ gemeenschap: { group: 'nederland', pct } }).gemeenschap, null, String(pct));
    assert.equal(normalizeAnswers({ gemeenschap: { group: 'iedereen-behalve' } }).gemeenschap, null);
  });
  it('answers carry no direction: lower / avoid / target fields are ignored', () => {
    for (const extra of [{ pref: 'lower' }, { direction: 'lower' }, { avoid: true }, { pref: 'target', ideal: 0 }, { weight: -50 }]) {
      const p = answersToPreset({ gemeenschap: { group: 'buitenEuropa', ...extra } });
      assertPositiveOnly(p, JSON.stringify(extra));
      assert.equal(originMetrics(p)[0].pref, 'higher');
    }
  });
  it('slider weights cannot reach the Gemeenschap theme', () => {
    const a = normalizeAnswers({ gemeenschap: { group: 'europa' }, weights: { gemeenschap: 100, veiligheid: 50 } });
    assert.deepEqual(a.weights, { veiligheid: 50 });
    const off = answersToPreset({ weights: { veiligheid: 0, welvaart: 0, voorzieningen: 0, opleiding: 0, woningmarkt: 0 }, gemeenschap: { group: 'europa' } });
    assert.equal(originMetrics(off).length, 0, 'no other weight: no community-only score');
  });
  it('breakdown shows "Nabijheid gemeenschap" and never as a minus; missing field drops the factor', () => {
    const areas = [area('A', 80), area('B', 50), area('C', 20)];
    const { results, factors } = scoreWithPreset(areas, answersToPreset({ gemeenschap: { group: 'nederland', pct: 30 } }));
    assert.ok(factors.some(f => f.key === 'originDutchPct' && f.pref === 'higher' && f.theme === 'gemeenschap'));
    const low = results.find(r => r.code === 'C');
    assert.ok(!explain(low).minus.some(r => r.theme === 'gemeenschap'));
    assert.ok(explain(results.find(r => r.code === 'A')).plus.some(r => r.label.startsWith('Nabijheid gemeenschap')));
    assert.ok(themeBreakdown(low).some(r => r.label === 'Nabijheid gemeenschap'));
    const none = scoreWithPreset(areas.map(a => ({ code: a.code, values: { ...a.values, originDutchPct: undefined } })), answersToPreset({ gemeenschap: { group: 'nederland' } }));
    assert.ok(!none.factors.some(f => f.theme === 'gemeenschap'));
    assert.ok(Math.abs(none.factors.reduce((s, f) => s + f.weight, 0) - 1) < 1e-9, 'renormalised');
    assert.match(describeAnswers({ gemeenschap: { group: 'nederland' } }), /nabijheid gemeenschap: Nederland/);
  });
});

describe('Gemeenschap: guards against scoring a group down', () => {
  const evil = {
    id: 'x', label: 'x', shrink: false, minCoverage: 0,
    themes: [
      { key: 'veiligheid', label: 'V', weight: 10, metrics: [{ key: 'crimeRate', pref: 'lower' }, { key: 'nonWesternPct', pref: 'lower' }] },
      { key: 'gemeenschap', label: 'G', weight: 10, metrics: [{ key: 'originDutchPct', pref: 'lower' }, { key: 'originEuropePct', pref: 'higher', w: -1 }] },
      { key: 'x', label: 'X', weight: 10, metrics: [{ key: 'originEuropePct', pref: 'target' }] },
    ],
    targets: { originEuropePct: { ideal: 0, tolerance: 1 } },
    filters: [{ key: 'nonWesternPct', max: 5 }],
  };
  it('guardOrigin strips every non-positive origin use', () => {
    const g = guardOrigin(evil);
    assertPositiveOnly(g, 'guard');
    assert.equal(originMetrics(g).length, 0);
    assert.ok(g.themes.some(t => t.metrics.some(m => m.key === 'crimeRate')));
  });
  it('resolvePreset / scoreWithPreset refuse lower, target and filter on origin', () => {
    const f = resolvePreset(evil, ALL);
    assert.ok(!f.some(x => ORIGIN_KEYS.includes(x.key)), JSON.stringify(f));
    const areas = [area('A', 80), { code: 'B', values: { ...area('B', 50).values, nonWesternPct: 90 } }];
    const { results } = scoreWithPreset(areas, evil);
    assert.ok(results.every(r => !r.filtered));
  });
  it('a crafted score= with a sign, direction or junk in the g segment is rejected', () => {
    for (const s of ['gd-10', 'gdl10', 'gdlower', 'gd0', 'gd00', 'gq10', 'g', 'gdx', 'gd10y', 'gd10.gd-5', 's50.gb-30x']) {
      const a = decodeAnswers(s);
      const p = presetFromScore(s);
      assertPositiveOnly(p, s);
      if (a.gemeenschap) assert.ok(a.gemeenschap.pct > 0, s);
    }
    assert.equal(decodeAnswers('gd-10').gemeenschap, null);
    assert.equal(decodeAnswers('gdl10').gemeenschap, null);
    assert.equal(decodeAnswers('gd0').gemeenschap, null);
    assert.equal(decodeAnswers('gd999').gemeenschap.pct, GEMEENSCHAP_MAX_PCT, 'clamped');
    // Slider letters cannot address origin: w-segment for an unknown theme is ignored.
    assertPositiveOnly(presetFromScore('wg100.wv0'), 'w');
  });
  it('no score string of the codec alphabet can produce a negative origin weight (fuzz)', () => {
    const alpha = 'abcdefghijklmnopqrstuvwxyz0123456789.';
    let seed = 7;
    const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let i = 0; i < 3000; i++) {
      const len = 1 + rnd(16);
      let s = 'g';
      for (let j = 1; j < len; j++) s += alpha[rnd(alpha.length)];
      if (rnd(2)) s = `lg.bk.s${rnd(101)}.${s}`;
      assertPositiveOnly(presetFromScore(s), s);
    }
  });
});

describe('Gemeenschap: shared link only with "deel ook gemeenschap"', () => {
  it('encodes the choice; the share flag defaults to off', () => {
    const a = normalizeAnswers({ sfeer: 30, gemeenschap: { group: 'buitenEuropa', pct: 15 } });
    assert.equal(a.gemeenschap.share, false);
    assert.equal(encodeAnswers(a), 's30.gb15');
    assert.deepEqual(decodeAnswers('s30.gb15'), a);
    assert.equal(encodeAnswers({ ...a, gemeenschap: { ...a.gemeenschap, share: true } }), 's30.gb15x');
  });
  it('shareableScore drops an unticked choice; ticked stays', () => {
    assert.equal(shareableScore('s30.gb15'), 's30');
    assert.equal(shareableScore('gb15'), null);
    assert.equal(shareableScore('s30.gb15x'), 's30.gb15x');
    assert.equal(shareableScore('gelijk'), 'gelijk');
    assert.equal(serializeHash({ ...DEFAULT_STATE, score: 's30.gd10' }), '#scope=rotterdam&view=map&score=s30');
    assert.equal(serializeHash({ ...DEFAULT_STATE, score: 'gd10' }), '#scope=rotterdam&view=map');
    assert.match(serializeHash({ ...DEFAULT_STATE, score: 's30.gd10x' }), /score=s30\.gd10x$/);
  });
  it('localStorage keeps the private choice and a reload restores it', () => {
    const st = memStorage();
    saveAnswers(st, { sfeer: 30, gemeenschap: { group: 'nederland' } });
    assert.equal(loadAnswers(st).gemeenschap.group, 'nederland');
    st.setItem(SCORE_STORAGE_KEY, 's30.gd10');
    assert.equal(resolveInitialState({ hash: '#score=s30', storage: st }).score, 's30.gd10');
    assert.equal(resolveInitialState({ hash: '', storage: st }).score, 's30.gd10');
    assert.equal(resolveInitialState({ hash: '#score=lg', storage: st }).score, 'lg', 'another link wins');
    assert.equal(restoreLocalScore(null, 'gd10'), 'gd10');
    assert.equal(restoreLocalScore('s30', null), 's30');
  });
});

describe('Gemeenschap: Uitleg', () => {
  it('has a paragraph on what it does and does not do', () => {
    const s = GENERAL_SECTIONS.find(x => x.id === 'gemeenschap');
    assert.ok(s);
    assert.match(s.text, /nabijheid gemeenschap/);
    assert.match(s.text, /geen optie om een groep te vermijden/);
    assert.match(s.text, /Deel ook gemeenschap/);
  });
});

// v0.25.0: detailed groups per wijk/buurt (postcode estimate) and three new detailed groups.
import { PC4_KEYS, PC4_GROUPS } from '../modules/herkomst-pc4.js';
import { DETAIL_GROUPS } from '../modules/wizard-model.js';
// A detailed group next to a broad one gives two `higher` metrics; the broad one only where the detailed share is missing.
const assertPositivePair = (p, msg) => {
  const ms = originMetrics(p);
  assert.ok(ms.length <= 2, msg);
  if (ms.length === 2) assert.ok(ms[1].unless === ms[0].key, msg);
  assertPositiveOnly({ ...p, themes: p.themes.map(t => ({ ...t, metrics: t.metrics.filter(m => !m.unless) })) }, msg);
};

describe('Gemeenschap: postcode-estimated groups keep every §5 guard', () => {
  it('every postcode key is an origin key; no fixed preset uses one', () => {
    for (const k of PC4_KEYS) assert.ok(ORIGIN_KEYS.includes(k), k);
    for (const p of [STANDAARD, GELIJK, ...Object.values(PRESETS)]) assert.ok(!p.themes.some(t => t.metrics.some(m => PC4_KEYS.includes(m.key))), p.id);
  });
  it('each detailed group alone gives one `higher` factor in Gemeenschap, whatever junk is added', () => {
    for (const detail of Object.keys(DETAIL_GROUPS)) {
      for (const extra of [{}, { pref: 'lower' }, { weight: -50 }, { avoid: true }]) {
        const p = answersToPreset({ gemeenschap: { detail, ...extra } });
        assertPositiveOnly(p, `${detail} ${JSON.stringify(extra)}`);
        assert.deepEqual(originMetrics(p).map(m => [m.key, m.pref]), [[DETAIL_GROUPS[detail].key, 'higher']]);
      }
    }
  });
  it('guardOrigin and resolvePreset strip lower / target / filter on a postcode key', () => {
    const evil = {
      id: 'x', label: 'x', shrink: false, minCoverage: 0,
      themes: [{ key: 'veiligheid', label: 'V', weight: 10, metrics: [{ key: 'crimeRate', pref: 'lower' }, { key: 'hk_polen', pref: 'lower' }] },
        { key: 'gemeenschap', label: 'G', weight: 10, metrics: [{ key: 'hk_suriname', pref: 'target' }, { key: 'hk_turkije', pref: 'higher', w: -1 }] }],
      targets: { hk_suriname: { ideal: 0, tolerance: 1 } },
      filters: [{ key: 'hk_marokko', max: 1 }],
    };
    assertPositiveOnly(guardOrigin(evil), 'guard');
    assert.equal(originMetrics(guardOrigin(evil)).length, 0);
    const f = resolvePreset(evil, new Set([...ALL, ...PC4_KEYS]));
    assert.ok(!f.some(x => PC4_KEYS.includes(x.key)), JSON.stringify(f));
    const areas = [{ code: 'BU1', values: { crimeRate: 10, hk_marokko: 30 } }, { code: 'BU2', values: { crimeRate: 20, hk_marokko: 0 } }];
    assert.ok(scoreWithPreset(areas, evil).results.every(r => !r.filtered));
  });
  it('at wijk/buurt the estimated share is a plus only, never a minus, and replaces the broad group', () => {
    const wk = (code, sr) => ({ code, values: { hk_suriname: sr, nonWesternPct: 40, crimeRate: 50, avgIncome: 30, highEdu: 30 } });
    const { results, factors } = scoreWithPreset([wk('WK1', 20), wk('WK2', 8), wk('WK3', 1)], answersToPreset({ gemeenschap: { group: 'buitenEuropa', detail: 'suriname', pct: 30 } }));
    assert.deepEqual(factors.filter(f => f.theme === 'gemeenschap').map(f => [f.key, f.pref]), [['hk_suriname', 'higher']]);
    assert.ok(!explain(results.find(r => r.code === 'WK3')).minus.some(r => r.theme === 'gemeenschap'));
    assert.ok(explain(results.find(r => r.code === 'WK1')).plus.some(r => r.theme === 'gemeenschap'));
  });
  it('new codes round-trip; old hashes decode unchanged; the private choice stays out of the link', () => {
    for (const detail of ['polen', 'duitsland', 'belgie', ...PC4_GROUPS.map(g => g.key)]) {
      const a = normalizeAnswers({ gemeenschap: { detail, pct: 15 } });
      assert.deepEqual(decodeAnswers(encodeAnswers(a)).gemeenschap, a.gemeenschap, detail);
    }
    assert.equal(encodeAnswers({ gemeenschap: { detail: 'polen', pct: 10 } }), 'ghpl10');
    assert.equal(shareableScore('s30.ghpl10'), 's30');
    assert.equal(shareableScore('s30.ghpl10x'), 's30.ghpl10x');
    assert.deepEqual(decodeAnswers('gd10x').gemeenschap, { group: 'nederland', pct: 10, share: true });
    assert.deepEqual(decodeAnswers('ghsr10x').gemeenschap, { group: null, detail: 'suriname', pct: 10, share: true });
    assert.deepEqual(decodeAnswers('gbhtr20').gemeenschap, { group: 'buitenEuropa', detail: 'turkije', pct: 20, share: false });
    for (const bad of ['ghpl-10', 'ghpl0', 'ghplx10', 'ghpll10']) assert.equal(decodeAnswers(bad).gemeenschap, null, bad);
  });
  it('fuzz: no gh… string can produce a negative weight on any detailed key', () => {
    const codes = Object.values(DETAIL_GROUPS).map(d => d.code);
    const junk = 'abcdefghijklmnopqrstuvwxyz0123456789.-';
    let seed = 11;
    const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let i = 0; i < 3000; i++) {
      let s = `g${rnd(2) ? 'bdeh'[rnd(4)] : ''}h${codes[rnd(codes.length)]}`;
      for (let j = rnd(5); j > 0; j--) s += junk[rnd(junk.length)];
      assertPositivePair(presetFromScore(s), s);
    }
  });
});
