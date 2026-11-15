// Colour scale for every choropleth, legend, Ranglijst bar and dashboard bar.
// Pure: no DOM, no Leaflet (localStorage/document only behind guards).
//
// buildScale(values, { method }) → { colorFor, isOutlier, outlierSide, classOf,
//   classes, breaks, median, q1, q3, lo, hi, min, max, count, outliers, method }
//
// 'quantile' (default): 7 stepped classes on the purple→orange ramp, filled by
//   percentile rank within the set, so the median sits in the middle class and an
//   outlier of 500 no longer squeezes 26 and 85 into one colour.
// 'linear': the old continuous min→max ramp, kept for comparison.
// Outliers (both methods): Tukey fences, see `fences` below.

export const NO_DATA_COLOR = '#4b4658';
export const OUTLIER_COLOR = '#ef4444';
export const CLASS_COUNT   = 7;
export const SCALE_METHODS = Object.freeze(['quantile', 'linear']);
export const SCALE_METHOD_LABELS = Object.freeze({ quantile: 'Kwantiel', linear: 'Lineair' });
export const SCALE_STORAGE_KEY = 'roffatistics.scale';
export const SCALE_EVENT = 'scale-method-change';

// Low → #2e1065 (deep purple)  High → #ea580c (orange)
export function interpolateColor(value, min, max) {
  const t = max === min ? 0 : (value - min) / (max - min);
  const r = Math.round(46  + t * (234 - 46));
  const g = Math.round(16  + t * (88  - 16));
  const b = Math.round(101 + t * (12  - 101));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** The 7 stepped class colours, evenly spaced on the ramp. */
export const CLASS_COLORS = Object.freeze(Array.from({ length: CLASS_COUNT }, (_, i) => interpolateColor(i, 0, CLASS_COUNT - 1)));

/** Ramp colour for class `i` of `m` classes (m < 7 spreads them over the ramp; 1 class = middle). */
export function classColor(i, m = CLASS_COUNT) {
  if (m <= 1) return CLASS_COLORS[Math.floor(CLASS_COUNT / 2)];
  return CLASS_COLORS[Math.round(i * (CLASS_COUNT - 1) / (m - 1))];
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v
  : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** Quantile p (0–1) of an ascending array, linear interpolation (R type 7, like Excel). */
export function quantile(sorted, p) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * p;
  const i = Math.floor(pos), f = pos - i;
  return i + 1 < sorted.length ? sorted[i] + f * (sorted[i + 1] - sorted[i]) : sorted[i];
}

/**
 * Outlier fences in value units. Tukey on the raw values (q1 − 1.5·IQR, q3 + 1.5·IQR)
 * and, when no value is negative, Tukey on log1p(values); a value is an outlier only
 * when it is outside both, i.e. the fences are the wider of the two on each side.
 * The log fences stop the long right tail of skewed counts and rates (crime, density)
 * from flagging every merely-high area; the raw fences stop the log view from
 * flagging small values (log stretches the low end). A raw IQR of 0 (most values
 * tied) or ≤ 7 distinct values flags nothing.
 */
export function fences(sorted) {
  const n = sorted.length;
  if (!n) return { lo: null, hi: null, log: false };
  const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75), iqr = q3 - q1;
  const distinct = new Set(sorted).size;
  if (iqr === 0 || distinct <= CLASS_COUNT) return { lo: sorted[0], hi: sorted[n - 1], log: false };
  let lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr, log = false;
  if (sorted[0] >= 0) {
    const ls = sorted.map(Math.log1p);
    const l1 = quantile(ls, 0.25), l3 = quantile(ls, 0.75), li = l3 - l1;
    lo = Math.min(lo, Math.expm1(l1 - 1.5 * li));
    hi = Math.max(hi, Math.expm1(l3 + 1.5 * li));
    log = true;
  }
  return { lo, hi, log };
}

function emptyScale(method) {
  return {
    method, count: 0, classes: [], breaks: [], median: null, q1: null, q3: null, lo: null, hi: null,
    min: null, max: null, outliers: { high: 0, low: 0 }, logFences: false,
    colorFor: () => NO_DATA_COLOR, isOutlier: () => false, outlierSide: () => null, classOf: () => null,
  };
}

/** Stepped classes: `breaks` are the inner thresholds; class i holds breaks[i-1] ≤ v < breaks[i]. */
function quantileClasses(sorted) {
  const distinct = [...new Set(sorted)];
  let breaks;
  if (distinct.length <= CLASS_COUNT) {
    breaks = distinct.slice(1);                      // one class per distinct value
  } else {
    breaks = [];
    for (let i = 1; i < CLASS_COUNT; i++) {
      const q = quantile(sorted, i / CLASS_COUNT);
      if (q > sorted[0] && (!breaks.length || q > breaks[breaks.length - 1])) breaks.push(q);
    }
  }
  const idx = v => { let k = 0; while (k < breaks.length && v >= breaks[k]) k++; return k; };
  const groups = Array.from({ length: breaks.length + 1 }, () => []);
  for (const v of sorted) groups[idx(v)].push(v);
  const kept = groups.filter(g => g.length);         // no empty classes (ties, interpolated thresholds)
  breaks = kept.slice(1).map(g => g[0]);
  const classes = kept.map((g, i) => ({ from: g[0], to: g[g.length - 1], count: g.length, color: classColor(i, kept.length) }));
  return { breaks, classes };
}

/**
 * Builds the scale over `values` (nulls and non-numbers ignored).
 * @param {Array<number|null>} values
 * @param {{ method?: 'quantile'|'linear' }} [opts]
 */
export function buildScale(values, { method = 'quantile' } = {}) {
  if (!SCALE_METHODS.includes(method)) method = 'quantile';
  const sorted = (values ?? []).map(num).filter(v => v != null).sort((a, b) => a - b);
  if (!sorted.length) return emptyScale(method);
  const n = sorted.length, min = sorted[0], max = sorted[n - 1];
  const median = quantile(sorted, 0.5), q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75);
  const f = fences(sorted);
  const outlierSide = v => { const x = num(v); return x == null ? null : x > f.hi ? 'high' : x < f.lo ? 'low' : null; };
  const outliers = { high: sorted.filter(v => v > f.hi).length, low: sorted.filter(v => v < f.lo).length };

  let classes = [], breaks = [], classOf, colorFor;
  if (method === 'linear') {
    classOf = () => null;
    colorFor = v => { const x = num(v); return x == null ? NO_DATA_COLOR : min === max ? classColor(0, 1) : interpolateColor(Math.min(max, Math.max(min, x)), min, max); };
  } else {
    ({ classes, breaks } = quantileClasses(sorted));
    classOf = v => { const x = num(v); if (x == null) return null; let k = 0; while (k < breaks.length && x >= breaks[k]) k++; return k; };
    colorFor = v => { const k = classOf(v); return k == null ? NO_DATA_COLOR : classes[k].color; };
  }
  return {
    method, count: n, classes, breaks, median, q1, q3, lo: f.lo, hi: f.hi, min, max, outliers, logFences: f.log,
    colorFor, classOf, outlierSide, isOutlier: v => outlierSide(v) != null,
  };
}

/** Tooltip/panel wording for an outlier side. */
export function outlierLabel(side) {
  return side === 'high' ? 'uitschieter (ver boven mediaan)' : side === 'low' ? 'uitschieter (ver onder mediaan)' : '';
}

// ── Method choice (Schaal: Kwantiel | Lineair), persisted in localStorage ──────

export function getScaleMethod(storage = globalThis.localStorage) {
  try { const v = storage?.getItem(SCALE_STORAGE_KEY); return SCALE_METHODS.includes(v) ? v : 'quantile'; } catch { return 'quantile'; }
}

/** Stores the method and tells the map, Ranglijst and Dashboard (document event SCALE_EVENT). */
export function setScaleMethod(method, storage = globalThis.localStorage) {
  if (!SCALE_METHODS.includes(method)) return getScaleMethod(storage);
  try { storage?.setItem(SCALE_STORAGE_KEY, method); } catch { /* storage blocked */ }
  globalThis.document?.dispatchEvent?.(new CustomEvent(SCALE_EVENT, { detail: { method } }));
  return method;
}
