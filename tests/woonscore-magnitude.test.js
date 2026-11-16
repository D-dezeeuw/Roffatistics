// Woonscore v0.58.0 (operator 16 Nov 2026, docs/algoritmes.md §1): Veiligheid
// 20 in Standaard, missing eduScore/noiseNeighbourPct taken from the parent,
// crime metrics scored by a bounded robust z-score instead of the rank.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalCdf, robustZFactors, imputeFromParent, scoreAreas, explain, percentileRanks, ROBUST_Z_CLIP, ROBUST_Z_MIN_N } from '../modules/score.js';
import { PROFILES, STANDAARD, GELIJK, ROBUST_Z_KEYS, IMPUTE_KEYS, resolvePreset, scoreWithPreset } from '../modules/presets.js';
import { factorLabel } from '../modules/area-detail.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const area = (code, values, parent) => ({ code, values, ...(parent ? { parent } : {}) });

describe('normalCdf', () => {
  it('Φ(0) = 0.5 exactly, symmetric, known values', () => {
    assert.equal(normalCdf(0), 0.5);
    near(normalCdf(1.96), 0.9750021);
    near(normalCdf(-1), 1 - normalCdf(1), 1e-12);
    near(normalCdf(3), 0.9986501);
    assert.equal(normalCdf(NaN), null);
  });
});

describe('robustZFactors', () => {
  const rates = [10, 20, 30, 40, 50, 60, 70];
  it('lower is better: the median gets 0.5, smaller values more, larger less', () => {
    const { f, fallback } = robustZFactors(rates, 'lower');
    assert.equal(fallback, false);
    near(f[3], 0.5, 1e-12);
    for (let i = 1; i < f.length; i++) assert.ok(f[i] < f[i - 1]);
  });
  it('higher is better is the mirror image', () => {
    const lo = robustZFactors(rates, 'lower').f, hi = robustZFactors(rates, 'higher').f;
    lo.forEach((v, i) => near(v + hi[i], 1, 1e-12));
  });
  it('magnitude counts: an extreme value scores lower than one just past the rest', () => {
    const a = robustZFactors([50, 55, 60, 63, 65, 70, 80], 'lower').f.at(-1);
    const b = robustZFactors([50, 55, 60, 63, 65, 70, 232], 'lower').f.at(-1);
    assert.ok(b < a, `${b} < ${a}`);
  });
  it('z is clipped at ±3: a far outlier does not go below Φ(−3)', () => {
    const { f } = robustZFactors([60, 61, 62, 63, 64, 65, 1e6], 'lower');
    near(f.at(-1), normalCdf(-ROBUST_Z_CLIP), 1e-12);
    near(f[0], normalCdf(-(Math.log1p(60) - Math.log1p(63)) / (1.4826 * (Math.log1p(65) - Math.log1p(63)))), 1e-9);
  });
  it('ties get the same factor; missing values stay null', () => {
    const { f } = robustZFactors([10, 30, 30, null, 50, 70, 90], 'lower');
    assert.equal(f[1], f[2]);
    assert.equal(f[3], null);
  });
  it('falls back to the percentile rank when n < 5 or MAD = 0', () => {
    const few = robustZFactors([10, 20, 30, 40], 'lower');
    assert.equal(ROBUST_Z_MIN_N, 5);
    assert.equal(few.fallback, true);
    assert.deepEqual(few.f, percentileRanks([10, 20, 30, 40]).map(p => 1 - p));
    const flat = robustZFactors([5, 5, 5, 5, 5, 9], 'higher');   // MAD 0: most values equal
    assert.equal(flat.fallback, true);
    assert.deepEqual(flat.f, percentileRanks([5, 5, 5, 5, 5, 9]));
  });
});

describe('scoreAreas with scale robustZ', () => {
  it('uses the robust factor for that spec and the rank for the others', () => {
    const areas = [10, 20, 30, 40, 200].map((v, i) => area(`a${i}`, { c: v, x: v }));
    const res = scoreAreas(areas, [{ key: 'c', pref: 'lower', weight: 1, scale: 'robustZ' }, { key: 'x', pref: 'lower', weight: 1 }]);
    const fz = robustZFactors([10, 20, 30, 40, 200], 'lower').f;
    res.forEach((r, i) => { near(r.factors[0].f, fz[i], 1e-12); near(r.factors[1].f, 1 - i / 4, 1e-12); });
  });
});

describe('imputation from the parent', () => {
  it('fills a missing key from the parent and marks it; a present value or missing parent stays', () => {
    const parents = { WK1: { e: 7 }, WK2: {} };
    const out = imputeFromParent([area('b1', { e: null }, 'WK1'), area('b2', { e: 3 }, 'WK1'), area('b3', {}, 'WK2'), area('b4', {})], ['e'], c => parents[c]);
    assert.equal(out[0].values.e, 7);
    assert.deepEqual(out[0].imputed, { e: 'WK1' });
    assert.equal(out[1].values.e, 3); assert.equal(out[1].imputed, undefined);
    assert.equal(out[2].values.e, undefined);
    assert.equal(out[3].values.e, undefined);
  });
  it('scoreAreas ranks the imputed value among the peers and flags the factor row', () => {
    const areas = [area('b1', { e: 1 }, 'WK1'), area('b2', { e: 3 }, 'WK1'), area('b3', {}, 'WK1')];
    const res = scoreAreas(areas, [{ key: 'e', pref: 'higher', weight: 1, optional: true }], { parents: new Map([['WK1', { e: 2 }]]), imputeKeys: ['e'] });
    assert.equal(res[2].factors[0].value, 2);
    near(res[2].factors[0].f, 0.5);
    assert.equal(res[2].factors[0].imputed, true);
    assert.equal(res[2].factors[0].imputedFrom, 'WK1');
    assert.equal(res[0].factors[0].imputed, undefined);
    assert.deepEqual(explain(res[0]).plus, []);
    assert.equal(explain(res[1]).plus[0].imputed, undefined);
  });
  it('without a parent value the optional rule still applies', () => {
    const areas = [area('b1', { e: 1, x: 1 }, 'WK1'), area('b2', { e: 3, x: 2 }, 'WK1'), area('b3', { x: 3 }, 'WK1')];
    const res = scoreAreas(areas, [{ key: 'e', pref: 'higher', weight: 1, optional: true }, { key: 'x', pref: 'higher', weight: 1 }], { parents: new Map([['WK1', {}]]), imputeKeys: ['e'] });
    assert.equal(res[2].factors[0].f, null);
    assert.equal(res[2].coverage, 1);
  });
  it('factorLabel names the level the value came from', () => {
    assert.equal(factorLabel({ label: 'Basisschool', imputed: true, imputedFrom: 'WK059901' }), 'Basisschool (waarde van de wijk)');
    assert.equal(factorLabel({ label: 'Basisschool', imputed: true, imputedFrom: 'GM0599' }), 'Basisschool (waarde van de gemeente)');
    assert.equal(factorLabel({ label: 'Basisschool' }), 'Basisschool');
  });
});

describe('presets v0.58.0', () => {
  it('Standaard: Veiligheid 20, the rest unchanged', () => {
    assert.deepEqual(PROFILES.standaard.weights, { veiligheid: 20, voorzieningen: 10, welvaart: 15, opleiding: 15, milieu: 10, woningmarkt: 0 });
  });
  it('crime metrics get scale robustZ in Standaard and levenstypes, not in Gelijk; welfare stays rank', () => {
    for (const k of ['crimeRate', 'crimeViolence', 'crimeStreetRobbery', 'crimeVandalism', 'crimeBurglary', 'crimeNearby', 'crimeBike', 'crimeDrugs', 'crimePickpocket']) assert.ok(ROBUST_Z_KEYS.includes(k), k);
    assert.ok(!ROBUST_Z_KEYS.includes('welfarePer1000'));
    const keys = ['crimeRate', 'welfarePer1000', 'avgIncome'];
    const std = resolvePreset(STANDAARD, keys);
    assert.equal(std.find(f => f.key === 'crimeRate').scale, 'robustZ');
    assert.equal(std.find(f => f.key === 'welfarePer1000').scale, undefined);
    assert.ok(resolvePreset(GELIJK, keys).every(f => f.scale === undefined));
  });
  it('IMPUTE_KEYS: a buurt without eduScore takes its wijk value in Standaard, not in Gelijk', () => {
    assert.deepEqual([...IMPUTE_KEYS], ['eduScore', 'noiseNeighbourPct']);
    const vals = (e, i) => ({ population: 2000, dwellings: 900, eduScore: e, highEdu: 30 + i, avgIncome: 30 + i, crimeRate: 40 + i });
    const buurten = [70, 75, 80, 85, null].map((e, i) => area(`BU00010${i}01`, vals(e, i), 'WK000101'));
    const parents = new Map([['WK000101', { eduScore: 72 }]]);
    const std = scoreWithPreset(buurten, STANDAARD, { parents }).results.at(-1).factors.find(f => f.key === 'eduScore');
    assert.equal(std.value, 72); assert.equal(std.imputed, true);
    const gel = scoreWithPreset(buurten, GELIJK, { parents }).results.at(-1).factors.find(f => f.key === 'eduScore');
    assert.equal(gel?.f ?? null, null);
  });
});
