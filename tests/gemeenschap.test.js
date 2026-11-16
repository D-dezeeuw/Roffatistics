// Epic W4 (docs/plan-woonscore.md §5): the Gemeenschap step is an opt-in,
// positive-only attraction. These tests prove no answers, preset or URL can
// score an origin group down or put a private choice into a shared link.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEP_PARTS, APPLY_ORDER, normalizeAnswers, isEmptyAnswers, answersToPreset, encodeAnswers, decodeAnswers, presetFromScore,
  shareableScore, restoreLocalScore, guardOrigin, describeAnswers, saveAnswers, loadAnswers,
  shareableAnswers, isShareOf, SHARE_NONE, GEMEENSCHAP_DEFAULT_PCT, GEMEENSCHAP_MAX_PCT, GEMEENSCHAP_MIN_PCT,
} from '../modules/wizard-model.js';
import { STANDAARD, GELIJK, PRESETS, ORIGIN_KEYS, resolvePreset, scoreWithPreset, themeBreakdown } from '../modules/presets.js';
import { explain } from '../modules/score.js';
import { serializeHash, resolveInitialState, SCORE_STORAGE_KEY, DEFAULT_STATE, setShareOptions, getShareOptions, shareUrl } from '../modules/state.js';
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
    assert.equal(APPLY_ORDER.at(-1), 'gemeenschap');
    assert.ok(STEP_PARTS.buren.includes('gemeenschap'));
    assert.equal(normalizeAnswers({}).gemeenschap, null);
    assert.equal(originMetrics(answersToPreset({})).length, 0);
    assert.ok(isEmptyAnswers({}));
    assert.ok(!isEmptyAnswers({ gemeenschap: { detail: 'suriname' } }));
  });
  it('the default "Geen specifieke groep" gives no Gemeenschap metric at all; old broad Europa / Buiten Europa neither', () => {
    for (const g of [{ detail: '' }, { detail: null }, {}, { group: 'europa' }, { group: 'buitenEuropa', pct: 30 }]) {
      assert.equal(normalizeAnswers({ gemeenschap: g }).gemeenschap, null, JSON.stringify(g));
      const p = answersToPreset({ sfeer: 30, gemeenschap: g });
      assert.ok(!p.themes.some(t => t.key === 'gemeenschap'), JSON.stringify(g));
      assert.equal(originMetrics(p).length, 0);
    }
  });
  it('no fixed preset uses any origin metric', () => {
    for (const p of [STANDAARD, GELIJK, ...Object.values(PRESETS)]) assert.equal(originMetrics(p).length, 0, p.id);
    assert.equal(presetFromScore(null), STANDAARD);
    assert.equal(presetFromScore('gelijk'), GELIJK);
  });
});

describe('Gemeenschap: one group, higher, user weight', () => {
  it('adds one `higher` factor on the chosen group at the default 10 % of the total', () => {
    for (const [group, g] of Object.entries(DETAIL_GROUPS)) {
      const p = answersToPreset({ gemeenschap: { detail: group } });
      const t = p.themes.find(x => x.key === 'gemeenschap');
      assert.deepEqual(t.metrics.map(m => [m.key, m.pref]), [[g.key, 'higher']]);
      assert.match(t.metrics[0].label, /^Eigen gemeenschap dichtbij/);
      const total = p.themes.reduce((s, x) => s + x.weight, 0);
      assert.ok(Math.abs(t.weight / total - GEMEENSCHAP_DEFAULT_PCT / 100) < 0.002, group);
    }
  });
  it('weight is clamped to 5–30 %; zero, negative or junk turns it off', () => {
    assert.equal(normalizeAnswers({ gemeenschap: { detail: 'nederland', pct: 99 } }).gemeenschap.pct, GEMEENSCHAP_MAX_PCT);
    assert.equal(normalizeAnswers({ gemeenschap: { detail: 'nederland', pct: 1 } }).gemeenschap.pct, GEMEENSCHAP_MIN_PCT);
    for (const pct of [0, -10, -0.5, NaN, 'x', Infinity * -1]) assert.equal(normalizeAnswers({ gemeenschap: { detail: 'nederland', pct } }).gemeenschap, null, String(pct));
    assert.equal(normalizeAnswers({ gemeenschap: { detail: 'iedereen-behalve' } }).gemeenschap, null);
    assert.deepEqual(normalizeAnswers({ gemeenschap: { group: 'nederland', share: true } }).gemeenschap, { detail: 'nederland', pct: GEMEENSCHAP_DEFAULT_PCT }, 'old broad Nederland');
  });
  it('answers carry no direction: lower / avoid / target fields are ignored', () => {
    for (const extra of [{ pref: 'lower' }, { direction: 'lower' }, { avoid: true }, { pref: 'target', ideal: 0 }, { weight: -50 }]) {
      const p = answersToPreset({ gemeenschap: { detail: 'turkije', ...extra } });
      assertPositiveOnly(p, JSON.stringify(extra));
      assert.equal(originMetrics(p)[0].pref, 'higher');
    }
  });
  it('slider weights cannot reach the Gemeenschap theme', () => {
    const a = normalizeAnswers({ gemeenschap: { detail: 'nederland' }, weights: { gemeenschap: 100, veiligheid: 50 } });
    assert.deepEqual(a.weights, { veiligheid: 50 });
    const off = answersToPreset({ weights: { veiligheid: 0, welvaart: 0, voorzieningen: 0, opleiding: 0, woningmarkt: 0 }, gemeenschap: { detail: 'nederland' } });
    assert.equal(originMetrics(off).length, 0, 'no other weight: no community-only score');
  });
  it('Nederland: breakdown shows "Eigen gemeenschap dichtbij" and never as a minus; missing field drops the factor', () => {
    const areas = [area('A', 80), area('B', 50), area('C', 20)];
    const { results, factors } = scoreWithPreset(areas, answersToPreset({ gemeenschap: { detail: 'nederland', pct: 30 } }));
    assert.ok(factors.some(f => f.key === 'originDutchPct' && f.pref === 'higher' && f.theme === 'gemeenschap'));
    const low = results.find(r => r.code === 'C');
    assert.ok(!explain(low).minus.some(r => r.theme === 'gemeenschap'));
    assert.ok(explain(results.find(r => r.code === 'A')).plus.some(r => r.label.startsWith('Eigen gemeenschap dichtbij')));
    assert.ok(themeBreakdown(low).some(r => r.label === 'Eigen gemeenschap dichtbij'));
    const none = scoreWithPreset(areas.map(a => ({ code: a.code, values: { ...a.values, originDutchPct: undefined } })), answersToPreset({ gemeenschap: { detail: 'nederland' } }));
    assert.ok(!none.factors.some(f => f.theme === 'gemeenschap'));
    assert.ok(Math.abs(none.factors.reduce((s, f) => s + f.weight, 0) - 1) < 1e-9, 'renormalised');
    assert.match(describeAnswers({ gemeenschap: { detail: 'nederland' } }), /eigen gemeenschap dichtbij: Nederland \(gemeente, wijk en buurt\)/);
    assertPositiveOnly(answersToPreset({ gemeenschap: { detail: 'nederland', pct: 30, pref: 'lower', avoid: true } }), 'nederland junk');
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
    assert.equal(decodeAnswers('ghnl-10').gemeenschap, null);
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

describe('Sharing: sensitive parts only when ticked in "Deellink maken"', () => {
  const full = { sfeer: 30, situatie: { edu: 'hoog', income: 'm5000' }, gemeenschap: { detail: 'suriname', pct: 15 } };
  it('shareableAnswers strips each part unless ticked, and drops an empty situatie', () => {
    const none = shareableAnswers(full);
    assert.equal(none.gemeenschap, null);
    assert.equal(none.situatie, null);
    assert.equal(none.sfeer, 30);
    assert.deepEqual(shareableAnswers(full, { origin: true }).gemeenschap, full.gemeenschap);
    assert.deepEqual(shareableAnswers(full, { education: true }).situatie, { edu: 'hoog' });
    assert.deepEqual(shareableAnswers(full, { income: true }).situatie, { income: 'm5000' });
    assert.equal(shareableAnswers({ situatie: { bijstand: true } }).situatie, null, 'old bijstand field goes with income');
    assert.deepEqual(shareableAnswers(full, { origin: true, education: true, income: true }), full);
    assert.deepEqual(full.situatie, { edu: 'hoog', income: 'm5000' }, 'input not mutated');
    assert.equal(shareableAnswers({ situatie: { edu: 'laag' } }, { income: true }).situatie, null);
    assert.deepEqual(SHARE_NONE, { origin: false, education: false, income: false });
  });
  it('hash round-trips; shareableScore leaves sensitive parts out by default', () => {
    const a = normalizeAnswers({ sfeer: 30, situatie: { edu: 'hoog' }, gemeenschap: { detail: 'nederland', pct: 15 } });
    const s = encodeAnswers(a);
    assert.equal(s, 's30.jh.ghnl15');
    assert.deepEqual(decodeAnswers(s), a);
    assert.equal(shareableScore(s), 's30');
    assert.equal(shareableScore(s, { origin: true }), 's30.ghnl15');
    assert.equal(shareableScore(s, { education: true }), 's30.jh');
    assert.equal(shareableScore(s, { origin: true, education: true }), s);
    assert.equal(shareableScore('ghnl15'), null);
    assert.equal(shareableScore('gelijk'), 'gelijk');
    assert.ok(isShareOf('s30.ghnl15', s) && isShareOf(null, 'ghnl15') && !isShareOf('lg', s));
  });
  it('old hashes with the share flag x still decode; the flag is ignored', () => {
    assert.deepEqual(decodeAnswers('s30.gd10x').gemeenschap, { detail: 'nederland', pct: 10 });
    assert.equal(decodeAnswers('s30.ge15x').gemeenschap, null, 'old broad Europa: no group');
    assert.equal(decodeAnswers('gb15').gemeenschap, null, 'old broad Buiten Europa: no group');
    assert.deepEqual(decodeAnswers('gbhsr20x').gemeenschap, { detail: 'suriname', pct: 20 }, 'detailed wins');
    assert.deepEqual(decodeAnswers('s40.jlbx').situatie, { edu: 'laag', income: 'bijstand' });
    assert.equal(decodeAnswers('s30.gd10x').sfeer, 30);
    assert.equal(encodeAnswers(decodeAnswers('s30.gd10x')), 's30.ghnl10');
  });
  it('the address-bar hash uses the stripped default unless a link was made with a part', () => {
    try {
      assert.equal(serializeHash({ ...DEFAULT_STATE, score: 's30.ghnl10' }), '#scope=rotterdam&view=map&score=s30');
      assert.equal(serializeHash({ ...DEFAULT_STATE, score: 'ghnl10' }), '#scope=rotterdam&view=map');
      assert.equal(serializeHash({ ...DEFAULT_STATE, score: 's30.gd10x' }), '#scope=rotterdam&view=map&score=s30', 'old x does not share');
      assert.match(serializeHash({ ...DEFAULT_STATE, score: 's30.ghnl10' }, { origin: true }), /score=s30\.ghnl10$/);
      setShareOptions({ origin: true, education: 'yes' });
      assert.deepEqual(getShareOptions(), { origin: true, education: false, income: false });
      assert.match(serializeHash({ ...DEFAULT_STATE, score: 's30.jm.ghnl10' }), /score=s30\.ghnl10$/);
      assert.match(shareUrl(undefined, 'https://x.test/a?b#old'), /^https:\/\/x\.test\/a\?b#scope=/);
    } finally { setShareOptions(SHARE_NONE); }
    assert.equal(serializeHash({ ...DEFAULT_STATE, score: 's30.ghnl10' }), '#scope=rotterdam&view=map&score=s30');
  });
  it('localStorage keeps the private choices and a reload restores them', () => {
    const st = memStorage();
    saveAnswers(st, { sfeer: 30, gemeenschap: { detail: 'nederland' } });
    assert.equal(loadAnswers(st).gemeenschap.detail, 'nederland');
    st.setItem(SCORE_STORAGE_KEY, 's30.ghnl10');
    assert.equal(resolveInitialState({ hash: '#score=s30', storage: st }).score, 's30.ghnl10');
    assert.equal(resolveInitialState({ hash: '', storage: st }).score, 's30.ghnl10');
    assert.equal(resolveInitialState({ hash: '#score=lg', storage: st }).score, 'lg', 'another link wins');
    assert.equal(restoreLocalScore(null, 'ghnl10'), 'ghnl10');
    assert.equal(restoreLocalScore('s30', null), 's30');
    assert.equal(restoreLocalScore('s30', 's30.jh.ghnl10'), 's30.jh.ghnl10');
  });
});

describe('Gemeenschap: Uitleg', () => {
  it('has a paragraph on what it does and does not do', () => {
    const s = GENERAL_SECTIONS.find(x => x.id === 'gemeenschap');
    assert.ok(s);
    assert.match(s.text, /eigen gemeenschap dichtbij/);
    assert.match(s.text, /geen optie om een groep te vermijden/);
    assert.match(s.text, /Deellink maken/);
    assert.ok(!/Deel ook/.test(GENERAL_SECTIONS.map(x => x.text).join(' ')));
  });
});

// v0.25.0: detailed groups per wijk/buurt (postcode estimate) and three new detailed groups.
import { PC4_KEYS, PC4_GROUPS } from '../modules/herkomst-pc4.js';
import { DETAIL_GROUPS } from '../modules/wizard-model.js';

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
    assert.equal(shareableScore('s30.ghpl10x'), 's30');
    assert.equal(shareableScore('s30.ghpl10x', { origin: true }), 's30.ghpl10');
    assert.deepEqual(decodeAnswers('gd10x').gemeenschap, { detail: 'nederland', pct: 10 });
    assert.deepEqual(decodeAnswers('ghsr10x').gemeenschap, { detail: 'suriname', pct: 10 });
    assert.deepEqual(decodeAnswers('gbhtr20').gemeenschap, { detail: 'turkije', pct: 20 });
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
      assertPositiveOnly(presetFromScore(s), s);
    }
  });
});

// v0.28.0: world regions as groups, under the same §5 rules.
import { REGIONS } from '../modules/herkomst-regio.js';
import { PC4_REGION_METRICS } from '../modules/herkomst-pc4.js';
import { gemeenschapOptgroups } from '../modules/wizard-model.js';

describe('Gemeenschap: world regions keep every §5 guard', () => {
  const regionDetails = Object.entries(DETAIL_GROUPS).filter(([, d]) => d.region);
  it('every region metric (also those not offered) is an origin key; a region group is one positive factor', () => {
    for (const r of REGIONS) assert.ok(ORIGIN_KEYS.includes(r.metric), r.metric);
    assert.equal(regionDetails.length, REGIONS.filter(r => !r.same).length);
    for (const [k, d] of regionDetails) {
      const p = answersToPreset({ gemeenschap: { detail: k, pct: 20 } });
      assert.deepEqual(originMetrics(p).map(m => [m.key, m.pref]), [[d.key, 'higher']], k);
      assertPositiveOnly(p, k);
      assert.equal(d.wijk, PC4_REGION_METRICS.includes(d.key), k);
    }
    for (const p of [STANDAARD, GELIJK, ...Object.values(PRESETS)]) assert.equal(originMetrics(p).length, 0);
  });
  it('guards strip lower / target / filter on a region key; a low share never costs points', () => {
    const evil = { themes: [{ key: 'x', weight: 5, metrics: [{ key: 'hr_noordAfrika', pref: 'lower' }, { key: 'hr_westAzie', pref: 'target' }] }],
      targets: { hr_westAzie: { ideal: 0, tolerance: 1 } }, filters: [{ key: 'hr_zuidAmerika', max: 1 }] };
    assert.equal(originMetrics(guardOrigin(evil)).length, 0);
    const f = resolvePreset(evil, new Set([...ALL]));
    assert.ok(!f.some(x => x.key.startsWith('hr_')), JSON.stringify(f));
    const wk = (code, v) => ({ code, values: { hr_noordAfrika: v, crimeRate: 50, avgIncome: 30, highEdu: 30 } });
    const { results } = scoreWithPreset([wk('WK1', 20), wk('WK2', 1)], answersToPreset({ gemeenschap: { detail: 'noordAfrika', pct: 30 } }));
    assert.ok(!explain(results.find(r => r.code === 'WK2')).minus.some(r => r.theme === 'gemeenschap'));
  });
  it('region codes round-trip, stay private by default, old hashes unchanged; default stays "no group"', () => {
    for (const [k] of regionDetails) {
      const a = normalizeAnswers({ gemeenschap: { detail: k, pct: 15 } });
      assert.deepEqual(decodeAnswers(encodeAnswers(a)).gemeenschap, a.gemeenschap, k);
    }
    assert.equal(encodeAnswers({ gemeenschap: { detail: 'noordAfrika', pct: 10 } }), 'ghnf10');
    assert.equal(shareableScore('s30.ghnf10'), 's30');
    assert.equal(shareableScore('s30.ghnf10', { origin: true }), 's30.ghnf10');
    assert.deepEqual(decodeAnswers('ghsr10').gemeenschap, { detail: 'suriname', pct: 10 });
    assert.deepEqual(decodeAnswers('ghao10').gemeenschap, { detail: 'azieOverig', pct: 10 });
    assert.equal(normalizeAnswers({}).gemeenschap, null);
    const sections = gemeenschapOptgroups();
    assert.equal(sections.length, 2);
    assert.ok(sections[1][1].every(([, d]) => d.region));
  });
});

