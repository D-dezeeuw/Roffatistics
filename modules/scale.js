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
// Colours come from the active map palette (palette.js, "Kaartkleuren"): the
// `kind` option picks the ramp (up/down = good/bad direction, neutral, origin);
// origin (herkomst, §5) scales never flag outliers. CLASS_COLORS, NO_DATA_COLOR
// and OUTLIER_COLOR stay the Paars-oranje values.

import { interpolateColor, PALETTES, activePalette, resolvePalette, rampFor, continuousColor, normalizeKind, storePaletteChoice, applyPaletteVars, mean, averageComparison } from './palette.js';

export { interpolateColor };
export const NO_DATA_COLOR = PALETTES.klassiek.noData;
export const OUTLIER_COLOR = PALETTES.klassiek.outlier;
export const CLASS_COUNT   = 7;
export const SCALE_METHODS = Object.freeze(['quantile', 'linear']);
export const SCALE_METHOD_LABELS = Object.freeze({ quantile: 'Kwantiel', linear: 'Lineair' });
export const SCALE_STORAGE_KEY = 'roffatistics.scale';
export const SCALE_EVENT = 'scale-method-change';

/** The 7 stepped Paars-oranje class colours, evenly spaced on the ramp. */
export const CLASS_COLORS = PALETTES.klassiek.directional;

/** Ramp colour for class `i` of `m` classes (m < 7 spreads them over the ramp; 1 class = middle). */
export function classColor(i, m = CLASS_COUNT, ramp = CLASS_COLORS) {
  if (m <= 1) return ramp[Math.floor(CLASS_COUNT / 2)];
  return ramp[Math.round(i * (CLASS_COUNT - 1) / (m - 1))];
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

function emptyScale(method, extra) {
  return {
    ...extra, method, count: 0, mean: null, classes: [], breaks: [], median: null, q1: null, q3: null, lo: null, hi: null,
    min: null, max: null, outliers: { high: 0, low: 0 }, logFences: false,
    colorFor: () => extra.noDataColor, isOutlier: () => false, outlierSide: () => null, classOf: () => null,
  };
}

/** Stepped classes: `breaks` are the inner thresholds; class i holds breaks[i-1] ≤ v < breaks[i]. */
function quantileClasses(sorted, ramp) {
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
  const classes = kept.map((g, i) => ({ from: g[0], to: g[g.length - 1], count: g.length, color: classColor(i, kept.length, ramp) }));
  return { breaks, classes };
}

/**
 * Builds the scale over `values` (nulls and non-numbers ignored).
 * @param {Array<number|null>} values
 * kind: 'up' | 'down' | 'neutral' | 'origin' or a higherIsBetter flag (palette.js metricKind);
 * palette: a palette or palette id (default: the live "Kaartkleuren" choice);
 * scope: 'rotterdam' | 'nederland', carried for the herkomst average text.
 * @param {{ method?: 'quantile'|'linear', kind?: string|boolean|null, palette?: object|string, scope?: string }} [opts]
 */
export function buildScale(values, { method = 'quantile', kind = 'neutral', palette, scope = null } = {}) {
  if (!SCALE_METHODS.includes(method)) method = 'quantile';
  const pal = palette == null ? activePalette() : resolvePalette(palette);
  kind = normalizeKind(kind);
  const ramp = rampFor(pal, kind);
  const extra = { kind, scope, palette: pal.id, ramp, noDataColor: pal.noData, outlierColor: pal.outlier };
  const sorted = (values ?? []).map(num).filter(v => v != null).sort((a, b) => a - b);
  if (!sorted.length) return emptyScale(method, extra);
  const n = sorted.length, min = sorted[0], max = sorted[n - 1];
  const median = quantile(sorted, 0.5), q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75);
  // Herkomst counts "how many", never good/bad: no outlier marks (§5).
  const f = kind === 'origin' ? { lo: -Infinity, hi: Infinity, log: false } : fences(sorted);
  const outlierSide = v => { const x = num(v); return x == null ? null : x > f.hi ? 'high' : x < f.lo ? 'low' : null; };
  const outliers = { high: sorted.filter(v => v > f.hi).length, low: sorted.filter(v => v < f.lo).length };
  const NO = pal.noData;

  let classes = [], breaks = [], classOf, colorFor;
  if (method === 'linear') {
    classOf = () => null;
    colorFor = v => { const x = num(v); return x == null ? NO : min === max ? classColor(0, 1, ramp) : continuousColor(pal, kind, (Math.min(max, Math.max(min, x)) - min) / (max - min)); };
  } else {
    ({ classes, breaks } = quantileClasses(sorted, ramp));
    classOf = v => { const x = num(v); if (x == null) return null; let k = 0; while (k < breaks.length && x >= breaks[k]) k++; return k; };
    colorFor = v => { const k = classOf(v); return k == null ? NO : classes[k].color; };
  }
  return {
    ...extra, mean: mean(sorted),
    lo: kind === 'origin' ? null : f.lo, hi: kind === 'origin' ? null : f.hi,
    method, count: n, classes, breaks, median, q1, q3, min, max, outliers, logFences: f.log,
    colorFor, classOf, outlierSide, isOutlier: v => outlierSide(v) != null,
  };
}

/**
 * Herkomst only: "2,5× het Rotterdamse gemiddelde (7%)" for `value` against the
 * mean of the scale's values (the areas in view); '' for other kinds.
 */
export function scaleAverageText(value, scale, format = v => String(v)) {
  return scale?.kind === 'origin' ? averageComparison(num(value), scale.mean, { scope: scale.scope, format }) : '';
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

// ── Map palette (Kaartkleuren), persisted in localStorage ───────────────────────

/** Stores the palette choice, updates the CSS variables and recolours every view (SCALE_EVENT). */
export function setMapPalette(choice, storage = globalThis.localStorage) {
  const c = storePaletteChoice(choice, storage);
  refreshMapPalette();
  return c;
}

/** Re-applies the live palette (after a theme change under "Volgt thema") and recolours the views. */
export function refreshMapPalette({ notify = true } = {}) {
  const id = applyPaletteVars(activePalette());
  if (notify) globalThis.document?.dispatchEvent?.(new CustomEvent(SCALE_EVENT, { detail: { method: getScaleMethod(), palette: id } }));
  return id;
}
