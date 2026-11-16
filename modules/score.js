// Score engine for the Woonscore (docs/plan-woonscore.md §1). Pure: no DOM,
// no imports. A score is relative to its peers (the areas of one level that
// are scored together), 0–100, built from per-metric factors 0..1.
//
// factor spec: { key, weight, pref: 'higher'|'lower'|'target', ideal?, tolerance?,
//                log?, label?, min?, max?, optional?, scale?: 'rank'|'robustZ' }
//   (filters: { key, min?, max? })

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
    const below = countBelow(nums, v);
    const equal = countBelow(nums, v, true) - below;
    return (below + (equal - 1) / 2) / (n - 1);
  });
}

/**
 * Binary search in an ascending array: how many entries are < v (or <= v with
 * `orEqual`). Replaces a linear scan per value (O(n²): 13 s for 14,700 NL
 * buurten, docs/decisions.md 15 Nov 2026).
 */
export function countBelow(sorted, v, orEqual = false) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < v || (orEqual && sorted[mid] === v)) lo = mid + 1; else hi = mid;
  }
  return lo;
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

/** |z| beyond which a robust z-score is clipped (so f stays in [Φ(−3), Φ(3)]). */
export const ROBUST_Z_CLIP = 3;
/** Fewer peers with a value than this: robustZ falls back to the percentile rank. */
export const ROBUST_Z_MIN_N = 5;
/** 1.4826 · MAD estimates the standard deviation of a normal distribution. */
const MAD_SCALE = 1.4826;

/**
 * Standard normal CDF Φ(x) via erf (Abramowitz & Stegun 7.1.26, |error| <
 * 1.5·10⁻⁷), mirrored around 0 so Φ(0) = 0.5 exactly and Φ(−x) = 1 − Φ(x).
 */
export function normalCdf(x) {
  if (!isNum(x)) return null;
  const t = Math.abs(x) / Math.SQRT2;
  const k = 1 / (1 + 0.3275911 * t);
  const erf = 1 - (((((1.061405429 * k - 1.453152027) * k) + 1.421413741) * k - 0.284496736) * k + 0.254829592) * k * Math.exp(-t * t);
  return 0.5 * (1 + Math.sign(x) * erf);
}

const medianOf = sorted => {
  const n = sorted.length, h = n >> 1;
  return n % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
};

/**
 * Magnitude-aware factor 0..1 (v0.58.0) for skewed rates such as misdrijven
 * per 1.000: a bounded robust z-score. y = log(1 + x), z = (y − median y) /
 * (1.4826 · MAD y), clipped to ±ROBUST_Z_CLIP, f = Φ(z) for 'higher' and
 * Φ(−z) for 'lower'. Equal values get equal factors. With fewer than
 * ROBUST_Z_MIN_N values or MAD = 0 it falls back to the percentile rank
 * (1 − p for 'lower'). Non-numbers → null. Returns { f: [], fallback }.
 */
export function robustZFactors(values, pref = 'lower') {
  const y = v => Math.log1p(Math.max(v, 0));
  const ys = values.filter(isNum).map(y).sort((a, b) => a - b);
  const sign = pref === 'higher' ? 1 : -1;
  const med = ys.length ? medianOf(ys) : 0;
  const mad = ys.length ? medianOf(ys.map(v => Math.abs(v - med)).sort((a, b) => a - b)) : 0;
  if (ys.length < ROBUST_Z_MIN_N || !(mad > 0)) {
    const p = percentileRanks(values);
    return { f: p.map(v => (v == null ? null : sign > 0 ? v : 1 - v)), fallback: true };
  }
  const s = MAD_SCALE * mad;
  return {
    f: values.map(v => {
      if (!isNum(v)) return null;
      const z = Math.max(-ROBUST_Z_CLIP, Math.min(ROBUST_Z_CLIP, (y(v) - med) / s));
      return normalCdf(sign * z);
    }),
    fallback: false,
  };
}

/**
 * Missing values of `keys` taken from the parent (v0.58.0): an area without a
 * value gets its parent's (buurt → wijk, wijk → gemeente), ranked among the
 * peers like a real value. `parentOf(code)` → values object or null. Returns
 * new objects with `imputed` = { key: parentCode } for the keys filled in.
 */
export function imputeFromParent(areas, keys, parentOf) {
  return areas.map(a => {
    if (!keys.length || a.parent == null) return a;
    let values = null, imputed = null;
    for (const key of keys) {
      if (isNum(a.values?.[key])) continue;
      const pv = parentOf(a.parent)?.[key];
      if (!isNum(pv)) continue;
      values = values ?? { ...a.values };
      values[key] = pv;
      (imputed = imputed ?? {})[key] = a.parent;
    }
    return values ? { ...a, values, imputed } : a;
  });
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
 * weight > 0 (`optional: true` = a missing value does not lower the coverage;
 * `scale: 'robustZ'` = robustZFactors instead of the percentile rank). Options:
 * parents + shrinkKeys (small-area shrinkage), imputeKeys + imputeParent
 * (code → values; default the parents) for missing values taken from the
 * parent, filters [{ key, min?, max? }], minCoverage (default MIN_COVERAGE), k.
 * Returns [{ code, score: 0–100|null, coverage: 0..1, shrunk, filtered, factors }]
 * where factors = [{ key, label, weight, value, f, contribution, impact, imputed?, imputedFrom? }]
 * (imputed: the value is the parent's, imputedFrom its code):
 * contribution = 100·w·f/Σw (points of the score), impact = 100·w·(f − 0.5)/Σw
 * (plus above the middle, minus below). Σw runs over the factors with data.
 */
export function scoreAreas(areas, factors, { parents = null, shrinkKeys = [], imputeKeys = [], imputeParent = null, filters = [], minCoverage = MIN_COVERAGE, k = SHRINK_K } = {}) {
  const get = code => (parents instanceof Map ? parents.get(code) : parents?.[code]);
  const filled = imputeKeys.length ? imputeFromParent(areas, imputeKeys, imputeParent ?? get) : areas;
  const list = parents && shrinkKeys.length ? shrinkAreas(filled, parents, shrinkKeys, { k }) : filled.map(a => ({ ...a, shrunk: false }));
  const specs = factors.filter(f => isNum(f.weight) && f.weight > 0 && PREFS.includes(f.pref));
  const totalWeight = specs.reduce((s, f) => s + f.weight, 0);
  const column = f => list.map(a => a.values?.[f.key]);
  const pcts = Object.fromEntries(specs.map(f => [f.key, percentileRanks(column(f), { log: !!f.log })]));
  // robustZ (v0.58.0): the factor itself, per key, for 'higher'/'lower' specs that ask for it.
  const robust = Object.fromEntries(specs.filter(f => f.scale === 'robustZ' && f.pref !== 'target').map(f => [f.key, robustZFactors(column(f), f.pref).f]));
  return list.map((a, i) => {
    const rows = specs.map(f => {
      const value = a.values?.[f.key];
      const imp = filled[i].imputed?.[f.key];
      const fac = robust[f.key] && f.pref !== 'target' ? robust[f.key][i] : preferenceFactor(f, pcts[f.key][i], value);
      return { key: f.key, label: f.label ?? f.key, ...(f.theme ? { theme: f.theme } : {}), weight: f.weight, value: isNum(value) ? value : null, f: fac,
        ...(imp != null ? { imputed: true, imputedFrom: imp } : {}) };
    });
    const used = rows.filter(r => r.f != null);
    const w = used.reduce((s, r) => s + r.weight, 0);
    // An `optional` factor without a value here leaves the coverage base (v0.54.0).
    const base = totalWeight - specs.reduce((s, f, j) => s + (f.optional && rows[j].f == null ? f.weight : 0), 0);
    const coverage = base > 0 ? w / base : 0;
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

/** Themes whose factors are only ever listed as a plus (positive-only opt-ins). */
export const PLUS_ONLY_THEMES = Object.freeze(['gemeenschap', 'situatie']);

/**
 * Strong and weak points of one scored area: factors with data sorted by
 * |impact|, plus = above the peer middle, minus = below. { plus, minus } of
 * [{ key, label, impact, f, value }], at most `top` each. A Gemeenschap
 * factor (theme 'gemeenschap', §5) or a "Jouw situatie" factor (v0.23.0) is
 * only ever a plus: an area is never
 * listed as weak for having fewer people of a group.
 */
export function explain(result, { top = 3 } = {}) {
  const rows = (result?.factors ?? []).filter(r => r.f != null && r.impact != null)
    .map(({ key, label, impact, f, value, weight, theme, imputed, imputedFrom }) => ({ key, label, impact, f, value, weight, theme, ...(imputed ? { imputed, imputedFrom } : {}) }));
  const plus = rows.filter(r => r.impact > 0).sort((a, b) => b.impact - a.impact).slice(0, top);
  const minus = rows.filter(r => r.impact < 0 && !PLUS_ONLY_THEMES.includes(r.theme)).sort((a, b) => a.impact - b.impact).slice(0, top);
  return { plus, minus };
}

/** Competition rank (1 = highest score) of `code` among results; { rank, of } or null. */
export function scoreRank(results, code) {
  const scored = results.filter(r => isNum(r.score));
  const me = scored.find(r => r.code === code);
  if (!me) return null;
  return { rank: 1 + scored.filter(r => r.score > me.score).length, of: scored.length };
}
