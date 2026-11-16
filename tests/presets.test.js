import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, STANDAARD, GELIJK, DEFAULT_PRESET, RATE_KEYS, resolvePreset, availableKeys, scoreWithPreset, withWoonscore, rowsWithWoonscore } from '../modules/presets.js';
import { DATASETS } from '../modules/datasets.js';
import { scoreAreas as rankingScores } from '../modules/ranking.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const sum = list => list.reduce((s, f) => s + f.weight, 0);
const ROTTERDAM_KEYS = ['crimeRate', 'crimeBurglary', 'crimeViolence', 'crimeStreetRobbery', 'crimeVandalism',
  'avgIncome', 'welfarePer1000', 'distGP', 'distSupermarket', 'highEdu', 'ownerOccupiedPct', 'population', 'density'];

describe('Standaard preset', () => {
  it('is neutral (v0.54.0): every theme Gemiddeld 10, Welvaart/Opleiding one step up (15), Veiligheid 20 (v0.58.0), no taste metrics', () => {
    assert.equal(DEFAULT_PRESET, 'standaard');
    assert.equal(PRESETS.standaard, STANDAARD);
    assert.deepEqual(STANDAARD.themes.map(t => [t.key, t.weight]),
      [['veiligheid', 20], ['welvaart', 15], ['voorzieningen', 10], ['opleiding', 15], ['milieu', 10], ['woningmarkt', 0]]);
    const metric = (theme, key) => STANDAARD.themes.find(t => t.key === theme).metrics.find(m => m.key === key);
    assert.deepEqual(metric('welvaart', 'avgIncome'), { key: 'avgIncome', pref: 'higher', w: 2 });
    assert.deepEqual(metric('opleiding', 'eduScore'), { key: 'eduScore', pref: 'higher', w: 2, optional: true }, 'the general basisschool layer');
    assert.deepEqual(metric('milieu', 'noiseNeighbourPct'), { key: 'noiseNeighbourPct', pref: 'lower', optional: true });
    assert.ok(!STANDAARD.themes.some(t => t.metrics.some(m => m.key === 'eduNearScore')), 'not the gezin layer');
    const keys = STANDAARD.themes.flatMap(t => t.metrics.map(m => m.key));
    for (const k of keys) assert.ok(DATASETS[k], `${k} is a dataset`);
    for (const taste of ['density', 'pop65plus', 'originDutchPct', 'nonWesternPct', 'wozValue']) assert.ok(!keys.includes(taste));
    for (const m of STANDAARD.themes.flatMap(t => t.metrics)) {
      if (m.key === 'ownerOccupiedPct') continue;   // neutral as a layer, a mild plus here
      assert.equal(m.pref, DATASETS[m.key].higherIsBetter ? 'higher' : 'lower', m.key);
    }
  });
  it('Rotterdam: every metric, theme weight split within the theme, sums to 1', () => {
    const f = resolvePreset(STANDAARD, ROTTERDAM_KEYS);
    assert.equal(f.length, 10, 'ownerOccupiedPct out: Woningmarkt 0');
    near(sum(f), 1);
    near(sum(f.filter(x => x.theme === 'veiligheid')), 20 / 60);
    near(f.find(x => x.key === 'crimeBurglary').weight, 4 / 60);
    near(f.find(x => x.key === 'distGP').weight, 5 / 60);
    near(f.find(x => x.key === 'highEdu').weight, 15 / 60);   // no eduScore: highEdu carries Opleiding
  });
  it('with eduScore and geluidhinder buren: each emphasised metric weighs as much as a neutral theme', () => {
    const f = resolvePreset(STANDAARD, [...ROTTERDAM_KEYS, 'distSchool', 'distStation', 'distKinderopvang', 'crimeNearby', 'eduScore', 'noiseNeighbourPct']);
    near(sum(f), 1);
    const w = k => f.find(x => x.key === k).weight;
    near(sum(f.filter(x => x.theme === 'veiligheid')), 20 / 70);
    for (const k of ['avgIncome', 'eduScore', 'noiseNeighbourPct']) near(w(k), 10 / 70);
    near(sum(f.filter(x => x.theme === 'voorzieningen')), 10 / 70);
    near(w('welfarePer1000'), 5 / 70);
    near(w('highEdu'), 5 / 70);
    assert.equal(f.find(x => x.key === 'noiseNeighbourPct').pref, 'lower');
  });
  it('NL gemeenten: missing metrics dropped, themes renormalised', () => {
    const f = resolvePreset(STANDAARD, new Set(['crimeRate', 'avgIncome', 'highEdu', 'population']));
    assert.deepEqual(f.map(x => x.key), ['crimeRate', 'avgIncome', 'highEdu']);
    near(sum(f), 1);
    near(f[0].weight, 20 / 50);   // Veiligheid 20, Welvaart 15, Opleiding 15 (v0.58.0)
    near(f[1].weight, 15 / 50);
    assert.deepEqual(resolvePreset(STANDAARD, []), []);
  });
  it('a target in the preset switches that metric to the target preference', () => {
    const p = { ...STANDAARD, targets: { avgIncome: { ideal: 40, tolerance: 5 } } };
    const f = resolvePreset(p, ['avgIncome']);
    assert.deepEqual([f[0].pref, f[0].ideal, f[0].tolerance], ['target', 40, 5]);
  });
  it('shrinks only per-1.000 rates', () => {
    assert.ok(RATE_KEYS.includes('crimeRate') && RATE_KEYS.includes('welfarePer1000'));
    assert.ok(!RATE_KEYS.includes('avgIncome') && !RATE_KEYS.includes('distGP'));
  });
});

describe('Gelijk gewogen preset', () => {
  it('equal weights over the directional Totaalscore datasets', () => {
    const keys = GELIJK.themes.map(t => t.key);
    assert.ok(keys.includes('crimeRate') && keys.includes('distGP') && keys.includes('wozValue'));
    assert.ok(!keys.includes('woonscore') && !keys.includes('crimeBike') && !keys.includes('population'));
    assert.ok(GELIJK.themes.every(t => t.weight === 1));
  });
  it('reproduces the Ranglijst Totaalscore', () => {
    const areas = [
      { code: 'A', values: { crimeRate: 50, avgIncome: 30, highEdu: 20, distGP: 1.2, population: 900 } },
      { code: 'B', values: { crimeRate: 20, avgIncome: 45, highEdu: 50, distGP: null, population: 4000 } },
      { code: 'C', values: { crimeRate: 80, avgIncome: null, highEdu: 35, distGP: 0.4, population: 3000 } },
      { code: 'D', values: { crimeRate: 35, avgIncome: 38, highEdu: 35, distGP: 0.8, population: 2000 } },
    ];
    const { results } = scoreWithPreset(areas, 'gelijk');
    const ranked = rankingScores(areas, Object.values(DATASETS));
    for (const r of ranked) near(results.find(x => x.code === r.code).score, r.overall);
  });
});

describe('scoring areas with a preset', () => {
  const wijken = [
    { code: 'WK1', values: { crimeRate: 10, avgIncome: 40, highEdu: 50, population: 9000 } },
    { code: 'WK2', values: { crimeRate: 60, avgIncome: 25, highEdu: 20, population: 9000 } },
  ];
  const buurten = [
    { code: 'BU1', parent: 'WK1', values: { crimeRate: 90, avgIncome: 41, highEdu: 52, population: 120 } },
    { code: 'BU2', parent: 'WK2', values: { crimeRate: 55, avgIncome: 24, highEdu: 18, population: 3000 } },
    { code: 'BU3', parent: 'WK1', values: { crimeRate: 12, avgIncome: 39, highEdu: 49, population: 3000 } },
  ];
  it('availableKeys lists keys with numbers', () => {
    assert.deepEqual([...availableKeys(wijken)].sort(), ['avgIncome', 'crimeRate', 'highEdu', 'population']);
  });
  it('withWoonscore adds values.woonscore and the result; buurten shrink toward the wijk', () => {
    const w = withWoonscore(wijken);
    assert.ok(w[0].values.woonscore > w[1].values.woonscore);
    assert.equal(w[0].woonscore.code, 'WK1');
    assert.equal(wijken[0].values.woonscore, undefined, 'input untouched');
    const b = withWoonscore(buurten, { parents: wijken });
    const tiny = b.find(x => x.code === 'BU1');
    assert.equal(tiny.woonscore.shrunk, true);
    assert.ok(tiny.woonscore.factors.find(f => f.key === 'crimeRate').value < 90);
    assert.equal(tiny.values.crimeRate, 90, 'the shown value stays the raw rate');
    const noShrink = withWoonscore(buurten);
    assert.equal(noShrink.find(x => x.code === 'BU1').woonscore.shrunk, false);
  });
  it('rowsWithWoonscore scores national rows among themselves', () => {
    const rows = rowsWithWoonscore([
      { regionCode: 'GM0001', crimeRate: 30, avgIncome: 35, highEdu: 45 },
      { regionCode: 'GM0002', crimeRate: 60, avgIncome: 28, highEdu: 25 },
      { regionCode: 'GM0003', crimeRate: null, avgIncome: null, highEdu: 40 },
    ]);
    near(rows[0].woonscore, 100);
    near(rows[1].woonscore, 0);
    assert.equal(rows[2].woonscore, null, 'only opleiding: under 60% coverage');
    assert.deepEqual(rowsWithWoonscore([]), []);
    assert.deepEqual(scoreWithPreset([], 'standaard'), { factors: [], results: [] });
  });
});
