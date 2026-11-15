import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  percentileRanks, targetFactor, preferenceFactor, passesFilter, shrinkWeight, shrinkRate, shrinkAreas,
  scoreAreas, explain, scoreRank, SHRINK_K, MIN_COVERAGE,
} from '../modules/score.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const area = (code, values, parent) => ({ code, values, ...(parent ? { parent } : {}) });

describe('percentileRanks', () => {
  it('mid-rank for ties, 0..1, null for missing', () => {
    assert.deepEqual(percentileRanks([10, 20, 20, 40, null]), [0, 0.5, 0.5, 1, null]);
    assert.deepEqual(percentileRanks([5]), [0.5]);
    assert.deepEqual(percentileRanks([3, 3]), [0.5, 0.5]);
  });
  it('log1p does not change ranks of skewed rates', () => {
    const v = [0.2, 1, 3, 80, 400];
    assert.deepEqual(percentileRanks(v, { log: true }), percentileRanks(v));
  });
});

describe('preference functions', () => {
  it('higher / lower use the percentile', () => {
    assert.equal(preferenceFactor({ pref: 'higher' }, 0.8, 1), 0.8);
    near(preferenceFactor({ pref: 'lower' }, 0.8, 1), 0.2);
    assert.equal(preferenceFactor({ pref: 'lower' }, null, null), null);
    assert.equal(preferenceFactor({ pref: 'nope' }, 0.5, 1), null);
  });
  it('target: 1 at the ideal, falling to 0 at ±2 tolerances', () => {
    assert.equal(targetFactor(300, 300, 50), 1);
    assert.equal(targetFactor(400, 300, 50), 0);
    assert.equal(targetFactor(150, 300, 50), 0);
    const half = targetFactor(350, 300, 50);
    assert.ok(half > 0.4 && half < 0.8);
    near(targetFactor(250, 300, 50), half);
    assert.equal(targetFactor(null, 300, 50), null);
    assert.equal(targetFactor(1, 1, 0), null);
    assert.equal(preferenceFactor({ pref: 'target', ideal: 300, tolerance: 50 }, 0.1, 300), 1);
    assert.equal(targetFactor(Math.E - 1, 0, 1, { log: true }), targetFactor(1, 0, 1));
  });
  it('filter: min/max, missing never passes', () => {
    assert.equal(passesFilter(5, { max: 10 }), true);
    assert.equal(passesFilter(15, { max: 10 }), false);
    assert.equal(passesFilter(2, { min: 3 }), false);
    assert.equal(passesFilter(null, { max: 10 }), false);
    assert.equal(passesFilter(null, null), true);
  });
});

describe('small-area shrinkage', () => {
  it('weight n / (n + k)', () => {
    assert.equal(SHRINK_K, 300);
    assert.equal(shrinkWeight(300), 0.5);
    assert.equal(shrinkWeight(0), 0);
    assert.equal(shrinkWeight(null), 0);
    near(shrinkRate(20, 150, 5), (150 * 20 + 300 * 5) / 450);
    assert.equal(shrinkRate(20, 150, null), 20);
    assert.equal(shrinkRate(null, 150, 5), null);
  });
  it('moves rates toward the parent and flags areas under k inwoners', () => {
    const parents = new Map([['WK1', { crimeRate: 10 }]]);
    const [small, big, orphan] = shrinkAreas([
      area('BU1', { population: 100, crimeRate: 50 }, 'WK1'),
      area('BU2', { population: 5000, crimeRate: 50 }, 'WK1'),
      area('BU3', { population: 100, crimeRate: 50 }),
    ], parents, ['crimeRate']);
    near(small.values.crimeRate, 20);
    assert.equal(small.shrunk, true);
    assert.ok(big.values.crimeRate < 50 && big.values.crimeRate > 47);
    assert.equal(big.shrunk, false);
    assert.equal(orphan.values.crimeRate, 50);
    assert.equal(orphan.shrunk, false);
  });
  it('a shrunk tiny buurt with an extreme rate no longer ranks worst', () => {
    const parents = { WK1: { crimeRate: 5 }, WK2: { crimeRate: 40 } };
    const areas = [
      area('tiny', { population: 60, crimeRate: 100 }, 'WK1'),
      area('busy', { population: 4000, crimeRate: 45 }, 'WK2'),
      area('calm', { population: 4000, crimeRate: 4 }, 'WK1'),
    ];
    const factors = [{ key: 'crimeRate', weight: 1, pref: 'lower' }];
    const raw = scoreAreas(areas, factors);
    const shr = scoreAreas(areas, factors, { parents, shrinkKeys: ['crimeRate'] });
    assert.equal(raw[0].score, 0);
    assert.equal(shr[0].score, 50);
    assert.equal(shr[0].shrunk, true);
  });
});

describe('scoreAreas', () => {
  const factors = [
    { key: 'a', label: 'A', weight: 3, pref: 'higher' },
    { key: 'b', label: 'B', weight: 1, pref: 'lower' },
  ];
  it('100 × Σ w·f / Σ w over the factors with data', () => {
    const res = scoreAreas([area('x', { a: 1, b: 1 }), area('y', { a: 2, b: 2 }), area('z', { a: 3, b: 3 })], factors);
    near(res[0].score, 100 * (3 * 0 + 1 * 1) / 4);
    near(res[2].score, 100 * (3 * 1 + 1 * 0) / 4);
    near(res[1].score, 50);
    assert.equal(res[0].coverage, 1);
    near(res[0].factors.reduce((s, f) => s + f.contribution, 0), res[0].score);
  });
  it('needs ≥ 60% of the weight covered, otherwise null', () => {
    assert.equal(MIN_COVERAGE, 0.6);
    const res = scoreAreas([area('x', { a: null, b: 1 }), area('y', { a: 2, b: null }), area('z', { a: 3, b: 3 })], factors);
    assert.equal(res[0].score, null);         // 25% covered
    near(res[0].coverage, 0.25);
    near(res[1].score, 0);                    // 75% covered, renormalised over a only
    near(res[1].coverage, 0.75);
    const loose = scoreAreas([area('x', { a: null, b: 1 }), area('z', { a: 3, b: 3 })], factors, { minCoverage: 0 });
    assert.equal(loose[0].score, 100);   // lowest b among the two
  });
  it('an area without any data, or no factors, scores null', () => {
    assert.equal(scoreAreas([area('x', {})], factors)[0].score, null);
    assert.equal(scoreAreas([area('x', { a: 1 })], [])[0].score, null);
  });
  it('filters flag areas, they are never dropped', () => {
    const res = scoreAreas([area('x', { a: 1, b: 1 }), area('y', { a: 5, b: 1 })], factors, { filters: [{ key: 'a', max: 2 }] });
    assert.equal(res.length, 2);
    assert.deepEqual(res.map(r => r.filtered), [false, true]);
    assert.ok(res[1].score != null);
  });
});

describe('explain and scoreRank', () => {
  it('plus and minus contributions, largest impact first', () => {
    const factors = [
      { key: 'safe', label: 'Veilig', weight: 3, pref: 'lower' },
      { key: 'shop', label: 'Supermarkt', weight: 1, pref: 'lower' },
      { key: 'inc', label: 'Inkomen', weight: 2, pref: 'higher' },
    ];
    const res = scoreAreas([
      area('x', { safe: 1, shop: 9, inc: 1 }),
      area('y', { safe: 9, shop: 1, inc: 9 }),
    ], factors);
    const { plus, minus } = explain(res[0]);
    assert.deepEqual(plus.map(p => p.label), ['Veilig']);
    assert.deepEqual(minus.map(p => p.label), ['Inkomen', 'Supermarkt']);
    near(plus[0].impact, 100 * 3 * 0.5 / 6);
    assert.deepEqual(explain(res[0], { top: 1 }).minus.map(p => p.key), ['inc']);
    assert.deepEqual(explain(null), { plus: [], minus: [] });
  });
  it('competition rank among scored results', () => {
    const results = [{ code: 'a', score: 80 }, { code: 'b', score: 90 }, { code: 'c', score: 80 }, { code: 'd', score: null }];
    assert.deepEqual(scoreRank(results, 'b'), { rank: 1, of: 3 });
    assert.deepEqual(scoreRank(results, 'c'), { rank: 2, of: 3 });
    assert.equal(scoreRank(results, 'd'), null);
  });
});
