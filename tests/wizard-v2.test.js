// Wizard v2 (docs/plan-wizard-v2.md, v0.46.0): profile cards, the Buurt
// prefill (local flags, explicit answers win), Nieuwkomer never sets an
// origin group, new levenstype codes and old hashes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVENSTYPEN, LEVENSTYPE_LINES, LEVENSTYPE_HINTS, NIEUWKOMER_HINT, profileDefaults, chooseProfile, markExplicit, isPrefilled,
  reconcilePrefill, normalizePrefill, burenOpen, toggleVervoer, clearStep, loadPrefill, savePrefill, PREFILL_STORAGE_KEY,
  BUURT_DICHTBIJ, gemeenschapReason, normalizeAnswers, encodeAnswers, decodeAnswers, answersToPreset, themeWeights, EXTRA_THEME_WEIGHTS,
} from '../modules/wizard-model.js';
import { PROFILES, profileTopThemes, profileThemes, ORIGIN_KEYS } from '../modules/presets.js';

const memStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const originIn = p => p.themes.some(t => t.key === 'gemeenschap' || t.metrics.some(m => ORIGIN_KEYS.includes(m.key)));

describe('wizard v2: profiles', () => {
  it('nine cards in life-course order, each with a line and a hint', () => {
    assert.deepEqual(Object.keys(LEVENSTYPEN), ['student', 'starter', 'stel', 'gezin', 'nieuwkomer', '50plus', 'senior', 'soloMensen', 'soloRust']);
    for (const k of Object.keys(LEVENSTYPEN)) { assert.ok(LEVENSTYPE_LINES[k], k); assert.ok(LEVENSTYPE_HINTS[k], k); assert.ok(PROFILES[k], k); }
    assert.ok(LEVENSTYPE_HINTS.nieuwkomer.includes(NIEUWKOMER_HINT));
  });
  it('Starter and Nieuwkomer follow the plan numbers', () => {
    assert.deepEqual(PROFILES.starter.weights, { veiligheid: 20, voorzieningen: 30, welvaart: 10, opleiding: 5, woningmarkt: 0, leeftijd: 15, sfeer: 20 });
    assert.equal(PROFILES.starter.sfeer, 'druk');
    assert.deepEqual(PROFILES.starter.voorzieningen, [['distStation', 'lower', 2], ['distOv', 'lower', 2], ['distSupermarket', 'lower', 2], ['distGP', 'lower']]);
    assert.deepEqual(PROFILES.starter.leeftijd, [['pop25to44', 'higher']]);
    const n = PROFILES.nieuwkomer;
    assert.deepEqual(n.weights, { veiligheid: 25, voorzieningen: 35, welvaart: 5, opleiding: 0, woningmarkt: 0, leeftijd: 5, sfeer: 10 });
    assert.equal(n.sfeer, undefined, 'Sfeer without direction');
    assert.deepEqual(n.voorzieningen, [['distSupermarket', 'lower', 2], ['distOv', 'lower', 2], ['distGP', 'lower', 2], ['distSchool', 'lower']]);
    assert.ok(!profileThemes('nieuwkomer').some(t => t.key === 'sfeer'), 'no Sfeer metrics until answered');
    // An answered Sfeer gets the profile's 10, not the generic 20.
    assert.equal(themeWeights({ levensfase: 'nieuwkomer', sfeer: 50 }).sfeer, 10);
    assert.equal(themeWeights({ sfeer: 50 }).sfeer, EXTRA_THEME_WEIGHTS.sfeer);
  });
  it('profileTopThemes: the three heaviest themes, ties in theme order', () => {
    assert.deepEqual(profileTopThemes('student').map(t => [t.label, t.weight]), [['Sfeer', 40], ['Voorzieningen', 30], ['Levenstype', 20]]);
    assert.deepEqual(profileTopThemes('nieuwkomer').map(t => t.key), ['voorzieningen', 'veiligheid', 'sfeer']);
    assert.deepEqual(profileTopThemes('gezin').map(t => t.key), ['veiligheid', 'voorzieningen', 'leeftijd']);
    for (const k of Object.keys(LEVENSTYPEN)) assert.equal(profileTopThemes(k).length, 3, k);
  });
  it('new codes t and n round-trip; old codes decode unchanged', () => {
    assert.equal(encodeAnswers({ levensfase: 'starter' }), 'lt');
    assert.equal(encodeAnswers({ levensfase: 'nieuwkomer' }), 'ln');
    assert.equal(decodeAnswers('lt').levensfase, 'starter');
    assert.equal(decodeAnswers('ln').levensfase, 'nieuwkomer');
    assert.equal(decodeAnswers('ls').levensfase, 'student');
  });
});

describe('wizard v2: profileDefaults', () => {
  it('Student busy + uitgaan, Gezin rustig + park, Senior rustig + winkels; others nothing', () => {
    assert.deepEqual(profileDefaults('student'), { sfeer: 10, dichtbij: { uitgaan: 3 } });
    assert.deepEqual(profileDefaults('gezin'), { sfeer: 85, dichtbij: { park: 3 } });
    assert.deepEqual(profileDefaults('senior'), { sfeer: 85, dichtbij: { winkels: 3 } });
    for (const k of ['starter', 'stel', 'nieuwkomer', '50plus', 'soloMensen', 'soloRust', null, 'onbekend', 'toString']) assert.deepEqual(profileDefaults(k), { sfeer: null, dichtbij: {} }, String(k));
    for (const k of Object.keys(LEVENSTYPEN)) for (const item of Object.keys(profileDefaults(k).dichtbij)) assert.ok(BUURT_DICHTBIJ.includes(item), item);
  });
  it('is pure: a fresh object each call', () => {
    profileDefaults('student').dichtbij.uitgaan = 0;
    assert.equal(profileDefaults('student').dichtbij.uitgaan, 3);
  });
});

describe('wizard v2: prefill vs explicit', () => {
  it('choosing a profile fills the empty Buurt fields and flags them', () => {
    const { answers, prefilled } = chooseProfile({}, null, 'student');
    assert.equal(answers.levensfase, 'student');
    assert.equal(answers.sfeer, 10);
    assert.deepEqual(answers.dichtbij, { uitgaan: 3 });
    assert.deepEqual(prefilled, { sfeer: true, dichtbij: { uitgaan: true } });
    assert.ok(isPrefilled(prefilled, 'sfeer') && isPrefilled(prefilled, 'dichtbij', 'uitgaan'));
  });
  it('prefilled values follow a profile change; a profile without suggestions clears them', () => {
    let r = chooseProfile({}, null, 'student');
    r = chooseProfile(r.answers, r.prefilled, 'gezin');
    assert.equal(r.answers.sfeer, 85);
    assert.deepEqual(r.answers.dichtbij, { park: 3 });
    assert.deepEqual(r.prefilled, { sfeer: true, dichtbij: { park: true } });
    r = chooseProfile(r.answers, r.prefilled, 'stel');
    assert.equal(r.answers.sfeer, null);
    assert.equal(r.answers.dichtbij, null);
    assert.deepEqual(r.prefilled, { sfeer: false, dichtbij: {} });
    r = chooseProfile(chooseProfile({}, null, 'senior').answers, chooseProfile({}, null, 'senior').prefilled, null);
    assert.equal(r.answers.levensfase, null);
    assert.equal(r.answers.sfeer, null, 'deselecting the card drops its suggestions');
  });
  it('an explicit answer wins over the profile', () => {
    let r = chooseProfile({}, null, 'student');
    r = { answers: { ...r.answers, sfeer: 40, dichtbij: { ...r.answers.dichtbij, uitgaan: 1 } }, prefilled: markExplicit(markExplicit(r.prefilled, 'sfeer'), 'dichtbij', 'uitgaan') };
    assert.deepEqual(r.prefilled, { sfeer: false, dichtbij: {} });
    r = chooseProfile(r.answers, r.prefilled, 'gezin');
    assert.equal(r.answers.sfeer, 40, 'explicit sfeer stays');
    assert.deepEqual(r.answers.dichtbij, { uitgaan: 1, park: 3 }, 'explicit uitgaan stays, park is suggested');
    assert.deepEqual(r.prefilled, { sfeer: false, dichtbij: { park: true } });
    // Answers loaded from a hash or storage carry no flags: they are explicit.
    r = chooseProfile(decodeAnswers('ls.s30.dc1'), null, 'senior');
    assert.equal(r.answers.sfeer, 30);
    assert.deepEqual(r.answers.dichtbij, { uitgaan: 1, winkels: 3 });
  });
  it('flags never reach the hash; the hash value is plain and explicit', () => {
    const r = chooseProfile({}, null, 'student');
    const s = encodeAnswers({ ...r.answers, prefilled: r.prefilled });
    assert.equal(s, 'ls.s10.dc3');
    assert.ok(!/prefill/.test(s));
    assert.deepEqual(decodeAnswers(s), r.answers);
  });
  it('reconcilePrefill keeps only flags whose value still equals the suggestion', () => {
    const r = chooseProfile({}, null, 'student');
    assert.deepEqual(reconcilePrefill(r.answers, r.prefilled), r.prefilled);
    assert.deepEqual(reconcilePrefill({ ...r.answers, sfeer: 20 }, r.prefilled), { sfeer: false, dichtbij: { uitgaan: true } });
    assert.deepEqual(reconcilePrefill({ ...r.answers, levensfase: 'stel' }, r.prefilled), { sfeer: false, dichtbij: {} });
    assert.deepEqual(normalizePrefill({ sfeer: 'ja', dichtbij: { ov: true, park: true, x: true } }), { sfeer: false, dichtbij: { park: true } });
  });
  it('flags live in their own localStorage key, reconciled on load', () => {
    const st = memStorage();
    const r = chooseProfile({}, null, 'gezin');
    savePrefill(st, r.prefilled);
    assert.ok(st.getItem(PREFILL_STORAGE_KEY));
    assert.deepEqual(loadPrefill(st, r.answers), r.prefilled);
    assert.deepEqual(loadPrefill(st, { ...r.answers, sfeer: 50 }).sfeer, false);
    savePrefill(st, null);
    assert.equal(st.getItem(PREFILL_STORAGE_KEY), null);
    st.setItem(PREFILL_STORAGE_KEY, '{kapot');
    assert.deepEqual(loadPrefill(st, r.answers), { sfeer: false, dichtbij: {} });
  });
  it('Overslaan on Buurt clears Sfeer, the Buurt items and their flags, nothing else', () => {
    const r0 = chooseProfile({ dichtbij: { station: 2, ov: 1 } }, null, 'student');
    const r = clearStep(r0.answers, r0.prefilled, 'buurt');
    assert.equal(r.answers.sfeer, null);
    assert.deepEqual(r.answers.dichtbij, { station: 2, ov: 1 });
    assert.deepEqual(r.prefilled, { sfeer: false, dichtbij: {} });
    const v = clearStep({ vervoer: ['ov'], dichtbij: { station: 2, ov: 1, park: 2 } }, null, 'vervoer');
    assert.deepEqual(v.answers.vervoer, []);
    assert.deepEqual(v.answers.dichtbij, { park: 2 });
  });
});

describe('wizard v2: Nieuwkomer never sets an origin group (§5)', () => {
  it('opens Buren by default, fills nothing in it, and its preset has no origin metric', () => {
    const { answers } = chooseProfile({}, null, 'nieuwkomer');
    assert.equal(answers.gemeenschap, null);
    assert.equal(answers.situatie, null);
    assert.ok(burenOpen(answers));
    assert.ok(!burenOpen({ levensfase: 'student' }));
    assert.ok(burenOpen({ levensfase: 'student', situatie: { edu: 'hoog' } }));
    assert.ok(!originIn(answersToPreset(answers)));
    for (const k of Object.keys(LEVENSTYPEN)) {
      const r = chooseProfile({}, null, k);
      assert.equal(r.answers.gemeenschap, null, k);
      assert.ok(!originIn(answersToPreset(r.answers)), k);
    }
  });
  it('a group the user chose survives a profile change and is never added by one', () => {
    const own = normalizeAnswers({ gemeenschap: { detail: 'nederland', pct: 20 } });
    assert.deepEqual(chooseProfile(own, null, 'nieuwkomer').answers.gemeenschap, own.gemeenschap);
    assert.equal(chooseProfile(chooseProfile(own, null, 'nieuwkomer').answers, null, null).answers.gemeenschap.detail, 'nederland');
  });
});

describe('wizard v2: Gemeenschap reason line', () => {
  it('names the share and the ratio to the average', () => {
    assert.equal(gemeenschapReason('Suriname', 18, 7.2), 'Grote gemeenschap uit Suriname in de buurt (18%, 2,5× gemiddeld)');
    assert.equal(gemeenschapReason('Turkije', 4.25, null), 'Grote gemeenschap uit Turkije in de buurt (4,3%)');
    assert.equal(gemeenschapReason('Turkije', null, 3), null);
  });
});

describe('wizard v2: OV chip absorbs Dichtbij metro/tram', () => {
  it('an old hash with d o<level> still decodes, re-encodes and scores the same', () => {
    const a = decodeAnswers('lg.dp2o3');
    assert.deepEqual(a.dichtbij, { park: 2, ov: 3 });
    assert.equal(encodeAnswers(a), 'lg.dp2o3');
    const d = answersToPreset(a).themes.find(t => t.key === 'dichtbij');
    assert.ok(d.metrics.some(m => m.key === 'distOvHalte'));
  });
  it('the OV chip shows as on with an old ov level; switching it off drops both', () => {
    let a = toggleVervoer(decodeAnswers('dp2o3'), 'ov');
    assert.deepEqual(a.vervoer, []);
    assert.deepEqual(a.dichtbij, { park: 2 });
    a = toggleVervoer(a, 'ov');
    assert.deepEqual(a.vervoer, ['ov']);
    a = toggleVervoer(a, 'fiets');
    assert.deepEqual(a.vervoer, ['fiets', 'ov']);
  });
  it('old wizard hashes decode to the same answers (old step set)', () => {
    for (const s of ['ls.ak.bki60.vfo.s20.cingw.dc3o2t1.jh3', 'lr.am.bh.s80.dw3', 'lo', 'lm.ob', 'lp.og']) {
      const a = decodeAnswers(s);
      assert.deepEqual(decodeAnswers(encodeAnswers(a)), a, s);
    }
    assert.equal(decodeAnswers('lp.og').bouw, 'modern');
  });
});
