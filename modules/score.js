// Score engine for the Woonscore (docs/plan-woonscore.md §1). Pure: no DOM,
// no imports. A score is relative to its peers (the areas of one level that
// are scored together), 0–100, built from per-metric factors 0..1.
//
// factor spec: { key, weight, pref: 'higher'|'lower'|'target', ideal?, tolerance?,
//                log?, label?, min?, max? }  (filters: { key, min?, max? })

const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** Inwoners at which a small area's own rate and the parent rate weigh the same. */
export const SHRINK_K = 300;
/** Share of the preset weight an area needs data for; below it the score is null. */
export const MIN_COVERAGE = 0.6;
export const PREFS = Object.freeze(['higher', 'lower', 'target']);

/**
 * Percentile rank 0..1 of every value within the list (mid-rank for ties; one
 * value or all equal → 0.5). Non-numbers → null. `log` applies log1p first, as
 * scale.js does for skewed rates; a rank is unchanged by a monotone transform,
 * so this only matters for callers that also use the transformed values.
 */
export function percentileRanks(values, { log = false } = {}) {
  const tf = v => (log && v > -1 ? Math.log1p(v) : v);
  const nums = values.filter(isNum).map(tf).sort((a, b) => a - b);
  const n = nums.length;
  return values.map(raw => {
    if (!isNum(raw)) return null;
    if (n === 1) return 0.5;
    const v = tf(raw);
    let below = 0, equal = 0;
    for (const x of nums) { if (x < v) below++; else if (x === v) equal++; }
    return (below + (equal - 1) / 2) / (n - 1);
  });
}

/**
 * Closeness to `ideal`: Gaussian falloff with sd = tolerance, shifted so it is
 * exactly 0 at ±2 tolerances and beyond, 1 at the ideal. With `log` the
 * distance is taken between log1p values (tolerance in log units).
 */
export function targetFactor(value, ideal, tolerance, { log = false } = {}) {
  if (!isNum(value) || !isNum(ideal) || !isNum(tolerance) || tolerance <= 0) return null;
  const d = log ? Math.log1p(Math.max(value, 0)) - Math.log1p(Math.max(ideal, 0)) : value - ideal;
  const z = d / tolerance;
  if (Math.abs(z) >= 2) return 0;
  const floor = Math.exp(-2);
  return (Math.exp(-0.5 * z * z) - floor) / (1 - floor);
}

/** Factor 0..1 for one area: `pct` is its percentile among peers, `value` its raw value. */
export function preferenceFactor(spec, pct, value) {
  switch (spec?.pref) {
    case 'higher': return pct == null ? null : pct;
    case 'lower':  return pct == null ? null : 1 - pct;
    case 'target': return targetFactor(value, spec.ideal, spec.tolerance, { log: !!spec.log });
    default:       return null;
  }
}

/** True when `value` passes a filter { min?, max? }; a missing value never passes. */
export function passesFilter(value, filter) {
  if (!filter) return true;
  if (!isNum(value)) return false;
  if (isNum(filter.min) && value < filter.min) return false;
  if (isNum(filter.max) && value > filter.max) return false;
  return true;
}

/** Shrink weight n / (n + k) of an area's own rate (0 without inwoners). */
export function shrinkWeight(population, k = SHRINK_K) {
  return isNum(population) && population > 0 ? population / (population + k) : 0;
}

/**
 * Empirical-Bayes shrinkage of a rate toward the parent rate:
 * w·rate + (1 − w)·parent with w = n / (n + k). A missing parent keeps the rate.
 */
export function shrinkRate(rate, population, parentRate, k = SHRINK_K) {
  if (!isNum(rate)) return null;
  if (!isNum(parentRate)) return rate;
  const w = shrinkWeight(population, k);
  return w * rate + (1 - w) * parentRate;
}

/**
 * Areas with `keys` shrunk toward their parent (parents: Map|object code → values).
 * Returns new objects; `shrunk` is true when an area had a rate that moved and
 * fewer than k inwoners (the parent counted for more than the area itself).
 */
export function shrinkAreas(areas, parents, keys, { k = SHRINK_K } = {}) {
  const get = code => (parents instanceof Map ? parents.get(code) : parents?.[code]);
  return areas.map(a => {
    const p = a.parent != null ? get(a.parent) : null;
    if (!p || !keys.length) return { ...a, shrunk: false };
    const pop = a.values?.population;
    const values = { ...a.values };
    let moved = false;
    for (const key of keys) {
      const next = shrinkRate(values[key], pop, p[key], k);
      if (isNum(next) && next !== values[key]) { moved = true; values[key] = next; }
    }
    return { ...a, values, shrunk: moved && isNum(pop) && pop < k };
  });
}

/**
 * Scores every area. areas: [{ code, values, parent? }], factors: specs with
 * weight > 0. Options: parents + shrinkKeys (small-area shrinkage), filters
 * [{ key, min?, max? }], minCoverage (default MIN_COVERAGE), k.
 * Returns [{ code, score: 0–100|null, coverage: 0..1, shrunk, filtered, factors }]
 * where factors = [{ key, label, weight, value, f, contribution, impact }]:
 * contribution = 100·w·f/Σw (points of the score), impact = 100·w·(f − 0.5)/Σw
 * (plus above the middle, minus below). Σw runs over the factors with data.
 */
export function scoreAreas(areas, factors, { parents = null, shrinkKeys = [], filters = [], minCoverage = MIN_COVERAGE, k = SHRINK_K } = {}) {
  const list = parents && shrinkKeys.length ? shrinkAreas(areas, parents, shrinkKeys, { k }) : areas.map(a => ({ ...a, shrunk: false }));
  const specs = factors.filter(f => isNum(f.weight) && f.weight > 0 && PREFS.includes(f.pref));
  const totalWeight = specs.reduce((s, f) => s + f.weight, 0);
  const pcts = Object.fromEntries(specs.map(f => [f.key, percentileRanks(list.map(a => a.values?.[f.key]), { log: !!f.log })]));
  return list.map((a, i) => {
    const rows = specs.map(f => {
      const value = a.values?.[f.key];
      return { key: f.key, label: f.label ?? f.key, weight: f.weight, value: isNum(value) ? value : null, f: preferenceFactor(f, pcts[f.key][i], value) };
    });
    const used = rows.filter(r => r.f != null);
    const w = used.reduce((s, r) => s + r.weight, 0);
    const coverage = totalWeight ? w / totalWeight : 0;
    for (const r of rows) {
      r.contribution = r.f != null && w ? (100 * r.weight * r.f) / w : null;
      r.impact = r.f != null && w ? (100 * r.weight * (r.f - 0.5)) / w : null;
    }
    const ok = used.length > 0 && coverage >= minCoverage - 1e-9;
    const filtered = filters.some(flt => !passesFilter(a.values?.[flt.key], flt));
    return {
      code: a.code,
      score: ok ? rows.reduce((s, r) => s + (r.contribution ?? 0), 0) : null,
      coverage, shrunk: !!a.shrunk, filtered, factors: rows,
    };
  });
}

/**
 * Strong and weak points of one scored area: factors with data sorted by
 * |impact|, plus = above the peer middle, minus = below. { plus, minus } of
 * [{ key, label, impact, f, value }], at most `top` each.
 */
export function explain(result, { top = 3 } = {}) {
  const rows = (result?.factors ?? []).filter(r => r.f != null && r.impact != null)
    .map(({ key, label, impact, f, value, weight }) => ({ key, label, impact, f, value, weight }));
  const plus = rows.filter(r => r.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, top);
  const minus = rows.filter(r => r.impact < 0).sort((a, b) => a.impact - b.impact).slice(0, top);
  return { plus, minus };
}

/** Competition rank (1 = highest score) of `code` among results; { rank, of } or null. */
export function scoreRank(results, code) {
  const scored = results.filter(r => isNum(r.score));
  const me = scored.find(r => r.code === code);
  if (!me) return null;
  return { rank: 1 + scored.filter(r => r.score > me.score).length, of: scored.length };
}
