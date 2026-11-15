import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  personalDashboardSpec, personalLayout, personalContext, themeShares, scoreShift, topMatches, goodness, ROWS, PANELS_PER_ROW, PERSONAL_PANELS,
  shortLabel, compactFormat, unitNote,
} from '../modules/dashboard-personal.js';
import { buildContext, boardHtml, PANEL_BUILDERS, NA_TEXT } from '../modules/dashboard-panels.js';
import { answersToPreset, decodeAnswers, encodeAnswers } from '../modules/wizard-model.js';
import { ORIGIN_KEYS } from '../modules/presets.js';
import { parseHash, serializeHash, sanitizePatch, DEFAULT_STATE } from '../modules/state.js';

const spec = a => personalDashboardSpec(a, answersToPreset(a));
const keys = s => s.rows.map(r => r.key);
const allIds = s => s.rows.flatMap(r => r.panels);
const shape = s => {
  assert.equal(s.rows.length, ROWS);
  for (const r of s.rows) {
    assert.equal(r.panels.length, PANELS_PER_ROW, r.key);
    for (const id of r.panels) assert.ok(PERSONAL_PANELS[id] || PANEL_BUILDERS[id], `unknown panel ${id}`);
  }
};
const noOrigin = s => {
  for (const r of s.rows) for (const m of r.focus?.metrics ?? []) assert.ok(!ORIGIN_KEYS.includes(m.key), `${r.key} uses origin ${m.key}`);
  for (const id of ['hk-regions', 'hk-split', 'hk-diversity', 'pg-near']) assert.ok(!allIds(s).includes(id), id);
};

describe('personalDashboardSpec', () => {
  it('always 6 rows × 3 known panels, row 1 Jouw woonplek', () => {
    const cases = [{}, { levensfase: 'gezin' }, { veiligheid: ['inbraak'], levensfase: 'student', budget: { mode: 'koop', income: 80 }, vervoer: ['ov'], sfeer: 20, bouw: 'modern', situatie: { edu: 'hoog', income: 'm5000' }, gemeenschap: { detail: 'nederland', pct: 20 } }];
    for (const a of cases) {
      const s = spec(a);
      shape(s);
      assert.equal(s.rows[0].key, 'jouw');
      assert.deepEqual(s.rows[0].panels, ['jw-top', 'jw-shift', 'jw-weights']);
    }
  });
  it('orders the answered categories by importance, most important first', () => {
    const a = { levensfase: 'gezin', veiligheid: ['geweld'], vervoer: ['ov'], importance: { leeftijd: 4, veiligheid: 1, voorzieningen: 3 } };
    assert.deepEqual(keys(spec(a)).slice(1, 4), ['levenstype', 'bereikbaarheid', 'veiligheid']);
    const b = { ...a, importance: { leeftijd: 1, veiligheid: 4, voorzieningen: 2 } };
    assert.deepEqual(keys(spec(b)).slice(1, 4), ['veiligheid', 'bereikbaarheid', 'levenstype']);
  });
  it('skipped steps fall back to the Algemeen row they replace', () => {
    const s = spec({ veiligheid: ['inbraak'] });
    assert.deepEqual(keys(s), ['jouw', 'veiligheid', 'leeftijd', 'opleiding', 'welvaart', 'bereikbaarheid']);
    assert.ok(!keys(s).includes('criminaliteit'), 'criminaliteit replaced');
    const leeftijd = s.rows.find(r => r.key === 'leeftijd');
    assert.equal(leeftijd.source, 'algemeen');
    assert.deepEqual(leeftijd.panels, ['age-bands', 'age-hotspots', 'age-kids']);
    assert.equal(s.rows.find(r => r.key === 'bereikbaarheid').source, 'algemeen');
  });
  it('"Niet belangrijk" counts as skipped', () => {
    const s = spec({ veiligheid: ['inbraak'], importance: { veiligheid: 0 } });
    assert.ok(!keys(s).includes('veiligheid'));
    assert.ok(keys(s).includes('criminaliteit'));
  });
  it('focus follows the answers', () => {
    const s = spec({ veiligheid: ['inbraak', 'drugs'], levensfase: 'gezin', budget: { mode: 'koop', maxPrice: 400 }, bouw: 'karakter', vervoer: ['ov'] });
    const row = k => s.rows.find(r => r.key === k);
    assert.deepEqual(row('veiligheid').focus.metrics.map(m => m.key), ['crimeBurglary', 'crimeDrugs']);
    assert.deepEqual(row('levenstype').focus.metrics.map(m => m.key), ['hhWithKidsPct', 'distSchool', 'distKinderopvang']);
    assert.equal(row('levenstype').panels[2], 'age-kids');
    assert.deepEqual(row('wonen').panels, ['pb-budget', 'pb-within', 'pw-bouw']);
    assert.equal(row('wonen').focus.ceiling, 400);
    assert.deepEqual(row('bereikbaarheid').focus.metrics.map(m => m.key), ['distOv']);
    const solo = spec({ levensfase: 'soloMensen' }).rows.find(r => r.key === 'levenstype');
    assert.deepEqual(solo.focus.metrics.map(m => m.key), ['horeca1km', 'density', 'distCentrum', 'singleHhPct']);
    const sit = spec({ situatie: { income: 'm2500' } });
    assert.ok(keys(sit).includes('opleiding') && !keys(sit).includes('welvaart'), 'income only replaces Welvaart');
    assert.equal(sit.rows.find(r => r.key === 'situatie').focus.metrics[0].pref, 'target');
  });
  it('no origin anywhere unless opted in', () => {
    for (const a of [{}, { levensfase: 'gezin', veiligheid: ['geweld'], situatie: { edu: 'laag' } }, { budget: { mode: 'huur' }, sfeer: 80 }]) noOrigin(spec(a));
  });
  it('opted in: one positive Nabijheid gemeenschap row, never a lowest list', () => {
    const s = spec({ gemeenschap: { detail: 'nederland', pct: 30 } });
    const g = s.rows.filter(r => r.key === 'gemeenschap');
    assert.equal(g.length, 1);
    assert.deepEqual(g[0].focus.metrics, [{ key: 'originDutchPct', pref: 'higher' }]);
    assert.ok(!allIds(s).includes('hk-diversity') && !allIds(s).includes('hk-split'));
    for (const r of s.rows) if (r.key !== 'gemeenschap') for (const m of r.focus?.metrics ?? []) assert.ok(!ORIGIN_KEYS.includes(m.key));
    shape(s);
  });
  it('theme weights add to 100 and Gemeenschap only with an opt-in', () => {
    const w = themeShares(answersToPreset({ veiligheid: ['inbraak'] }));
    assert.ok(Math.abs(w.reduce((t, x) => t + x.pct, 0) - 100) < 1e-6);
    assert.ok(!w.some(x => x.key === 'gemeenschap'));
    assert.ok(themeShares(answersToPreset({ gemeenschap: { detail: 'nederland', pct: 20 } })).some(x => x.key === 'gemeenschap'));
  });
});

describe('personal panels', () => {
  const area = (code, name, v) => ({ code, name, values: { population: 5000, housingStock: 2500, ...v } });
  const units = [
    area('WK059901', 'Centrum', { woonscore: 80, wozValue: 300, crimeBurglary: 3, hhWithKidsPct: 10, distSchool: 0.4 }),
    area('WK059902', 'Noord', { woonscore: 60, wozValue: 250, crimeBurglary: 1, hhWithKidsPct: 30, distSchool: 0.3 }),
    area('WK059903', 'Zuid', { woonscore: 30, wozValue: 200, crimeBurglary: 2, hhWithKidsPct: 25, distSchool: 0.6 }),
    area('WK059904', 'Kralingen', { woonscore: 90, wozValue: 500, crimeBurglary: 2, hhWithKidsPct: 20, distSchool: 0.5 }),
  ];
  const ctx = buildContext({ scope: 'rotterdam', units, scored: units });
  const answers = { veiligheid: ['inbraak'], levensfase: 'gezin', budget: { mode: 'koop', maxPrice: 320 } };
  const s = spec(answers);
  const std = new Map([['WK059901', 70], ['WK059902', 65], ['WK059903', 40], ['WK059904', 75]]);

  it('top matches by Jouw score and the shift vs Standaard', () => {
    assert.deepEqual(topMatches(ctx).map(t => t.code), ['WK059904', 'WK059901', 'WK059902', 'WK059903']);
    const sh = Object.fromEntries(scoreShift(units, std).map(r => [r.code, r.value]));
    assert.deepEqual(sh, { WK059901: 10, WK059902: -5, WK059903: -10, WK059904: 15 });
  });
  it('lays out 6 × 3 HTML panels in the blue variant; missing data says so', () => {
    const rows = personalLayout(ctx, s, personalContext(ctx, { answers, std, weights: s.weights }));
    assert.equal(rows.length, 6);
    assert.ok(rows.every(r => r.panels.length === 3));
    const html = boardHtml(rows, { personal: true });
    assert.match(html, /class="dash-board is-personal"/);
    assert.match(html, /Jouw top 10/);
    assert.match(html, /Stijgen het meest/);
    assert.match(html, /binnen jouw budget/);
    assert.ok(html.includes(NA_TEXT), 'panels without data show the NA text');
    assert.equal((html.match(/<article /g) ?? []).length, 18);
  });
  it('Veiligheid row: short labels, unit once in the caption (W23)', () => {
    assert.equal(shortLabel('crimeBurglary'), 'Inbraak');
    assert.equal(shortLabel('crimeViolence'), 'Geweld');
    assert.equal(shortLabel('crimeBike'), 'Fietsdiefstal');
    assert.equal(shortLabel('crimeStreetRobbery'), 'Straatroof');
    assert.equal(shortLabel('waterPct'), 'Water');
    assert.equal(compactFormat('crimeBurglary')(2.25), '2,3');
    assert.equal(compactFormat('crimeBurglary')(null), 'geen data');
    assert.match(compactFormat('distSchool')(0.4), /km/);
    assert.equal(unitNote(['crimeBurglary', 'crimeBike', 'distSchool']), 'per 1.000 inwoners');
    assert.equal(unitNote(['distSchool']), '');
    const rows = personalLayout(ctx, s, personalContext(ctx, { answers, std, weights: s.weights }));
    const html = boardHtml(rows, { personal: true });
    const v = rows.find(r => r.key === 'jouw-veiligheid');
    assert.ok(v, 'veiligheid row present');
    assert.doesNotMatch(v.panels.map(p => p.body ?? '').join(''), /per 1\.000 inw/);
    assert.match(v.panels[0].caption, /^per 1\.000 inwoners · /);
    assert.match(html, /Inbraak/);
  });
  it("Veiligheid's third panel compares all crimes of jouw top 10 with the city, not the city alone (W23)", () => {
    assert.equal(spec(answers).rows.find(r => r.key === 'veiligheid').panels[2], 'pv-total');
    const cu = units.map(u => ({ ...u, values: { ...u.values, totalCrimes: 300, crimeTrend: -5 } }));
    for (const scope of ['rotterdam', 'nederland']) {
      const c = buildContext({ scope, units: cu, scored: cu });
      const p = PERSONAL_PANELS['pv-total'](c, {}, personalContext(c, { answers }));
      assert.match(p.body, /Jouw top 10/);
      assert.match(p.body, new RegExp(c.refName));
      assert.match(p.caption, /^per 1\.000 inwoners/);
      assert.equal((p.body.match(/dp-bar-row/g) ?? []).length, 2);
      const sel = buildContext({ scope, units: cu, scored: cu, selected: { ...cu[2], values: { ...cu[2].values, totalCrimes: 900, crimeRate: 180 } } });
      const ps = PERSONAL_PANELS['pv-total'](sel, {}, personalContext(sel, { answers }));
      assert.equal((ps.body.match(/dp-bar-row/g) ?? []).length, 3, 'top 10, selected area, reference');
    }
    assert.equal(PERSONAL_PANELS['pv-total'](ctx, {}, { top: [] }).body, null, 'one row only: no panel');
  });
  it('goodness: lower, target, budget max', () => {
    assert.ok(goodness({ pref: 'lower' }, 1) > goodness({ pref: 'lower' }, 2));
    assert.ok(goodness({ pref: 'target', ideal: 40 }, 41) > goodness({ pref: 'target', ideal: 40 }, 30));
    assert.equal(goodness({ pref: 'max', max: 300 }, 400), null);
  });
});

describe('dtab in the state hash', () => {
  it('round-trips dtab=jouw; Algemeen is the default and not written', () => {
    assert.equal(DEFAULT_STATE.dtab, 'algemeen');
    const s = { ...DEFAULT_STATE, view: 'dashboard', dtab: 'jouw' };
    const h = serializeHash(s);
    assert.match(h, /dtab=jouw/);
    assert.equal(parseHash(h).dtab, 'jouw');
    assert.ok(!serializeHash({ ...s, dtab: 'algemeen' }).includes('dtab'));
    assert.deepEqual(sanitizePatch({ dtab: 'evil' }), {});
  });
  it('a wizard score plus dtab survive together', () => {
    const score = encodeAnswers({ levensfase: 'gezin' });
    const back = parseHash(serializeHash({ ...DEFAULT_STATE, view: 'dashboard', score, dtab: 'jouw' }));
    assert.equal(back.dtab, 'jouw');
    assert.equal(decodeAnswers(back.score).levensfase, 'gezin');
  });
});
