// Pure helpers for the dashboard view: sorting, Rotterdam averages, scales,
// ticks and nl-NL formatting. No DOM; covered by tests/dashboard-data.test.js.
import { DATASETS } from './datasets.js';

const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Areas sorted by values[key], highest first (or lowest first with desc=false).
 * Areas without a value are never dropped: they follow at the end, by name.
 */
export function sortByValue(areas, key, { desc = true } = {}) {
  const withVal = [], without = [];
  for (const a of areas ?? []) (num(a.values?.[key]) == null ? without : withVal).push(a);
  withVal.sort((a, b) => (desc ? b.values[key] - a.values[key] : a.values[key] - b.values[key]) || String(a.name).localeCompare(String(b.name), 'nl'));
  without.sort((a, b) => String(a.name).localeCompare(String(b.name), 'nl'));
  return [...withVal, ...without];
}

export function sumOf(areas, key) {
  const vals = (areas ?? []).map(a => num(a.values?.[key])).filter(v => v != null);
  return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
}

/**
 * Mean of values[key] weighted by values[weightKey], over areas that have both
 * (and a positive weight). Null when none qualify.
 */
export function weightedMean(areas, key, weightKey = 'population') {
  let s = 0, w = 0;
  for (const a of areas ?? []) {
    const v = num(a.values?.[key]), wt = num(a.values?.[weightKey]);
    if (v == null || wt == null || wt <= 0) continue;
    s += v * wt; w += wt;
  }
  return w > 0 ? s / w : null;
}

/**
 * The Rotterdam figure for one dataset: the population total for 'population',
 * otherwise the population-weighted mean (every other dataset is a per-person
 * share, rate or average, so a plain mean over wijken would over-weight the
 * almost empty port wijken).
 */
export function cityValue(areas, key) {
  return key === 'population' ? sumOf(areas, key) : weightedMean(areas, key);
}

export const KPI_KEYS = Object.freeze(['population', 'avgIncome', 'highEdu', 'wozValue', 'pop65plus', 'nonWesternPct']);
const KPI_LABELS = {
  population: 'Inwoners', avgIncome: 'Gem. inkomen', highEdu: 'Hbo/wo', wozValue: 'Gem. WOZ',
  pop65plus: '65+', nonWesternPct: 'Herkomst buiten Europa',
};

/** [{ key, label, value, text }] for the KPI row. */
export function cityKpis(areas) {
  return KPI_KEYS.map(key => {
    const value = cityValue(areas, key);
    return { key, label: KPI_LABELS[key], value, text: formatValue(value, key) };
  });
}

// ── Number formatting (nl-NL) ────────────────────────────────────────────────

const nfCache = new Map();
function nf(decimals) {
  if (!nfCache.has(decimals)) {
    nfCache.set(decimals, new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: decimals }));
  }
  return nfCache.get(decimals);
}

/** nl-NL number with at most `decimals` decimals; '—' for null. */
export function formatNumber(v, decimals = 0) {
  const n = num(v);
  return n == null ? '—' : nf(decimals).format(n);
}

/** Value with its unit, by dataset key: '€ 38.400', '45,3%', '62,1 per 1.000 inw.', '12.345'. */
export function formatValue(v, key) {
  const n = num(v);
  if (n == null) return 'geen data';
  const unit = DATASETS[key]?.unit;
  if (unit === '×€1.000')   return `€ ${formatNumber(Math.round(n * 1000 / 100) * 100)}`;
  if (unit === '%')         return `${formatNumber(n, 1)}%`;
  if (unit === 'per 1.000') return `${formatNumber(n, 1)} per 1.000 inw.`;
  if (key === 'population') return `${formatNumber(n)} inw.`;
  return formatNumber(n, 1);
}

/** Short axis label: thousands become 'k' for euro datasets, '%' kept. */
export function formatTick(v, key) {
  const unit = DATASETS[key]?.unit;
  if (unit === '×€1.000') return `€${formatNumber(v, 1)}k`;
  if (unit === '%')       return `${formatNumber(v, 1)}%`;
  if (Math.abs(v) >= 10000) return `${formatNumber(v / 1000, 1)}k`;
  return formatNumber(v, 1);
}

// ── Scales and ticks ─────────────────────────────────────────────────────────

function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

/**
 * Round axis bounds and evenly spaced ticks covering [min, max]:
 * { min, max, step, ticks }. A zero-width range is widened so it still draws.
 */
export function niceTicks(min, max, count = 5) {
  let lo = num(min), hi = num(max);
  if (lo == null || hi == null) return { min: 0, max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) { const d = Math.abs(lo) || 1; lo -= d / 2; hi += d / 2; }
  const step = niceStep(hi - lo, count);
  const nMin = Math.floor(lo / step + 1e-9) * step;
  const nMax = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let t = nMin; t <= nMax + step / 2; t += step) ticks.push(+t.toFixed(10));
  return { min: +nMin.toFixed(10), max: +nMax.toFixed(10), step, ticks };
}

/** Linear map from [d0, d1] to [r0, r1]; a zero-width domain maps to the middle. */
export function linearScale([d0, d1], [r0, r1]) {
  const span = d1 - d0;
  return v => (span === 0 ? (r0 + r1) / 2 : r0 + (v - d0) / span * (r1 - r0));
}

/** Domain for a bar chart: always includes 0 so bar lengths compare honestly. */
export function barDomain(values) {
  const vals = values.map(num).filter(v => v != null);
  if (!vals.length) return niceTicks(0, 1);
  return niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
}

/** Scatter points for areas with both values: [{ code, name, x, y, population }]; `missing` counts the rest. */
export function scatterPoints(areas, xKey, yKey) {
  const points = [];
  let missing = 0;
  for (const a of areas ?? []) {
    const x = num(a.values?.[xKey]), y = num(a.values?.[yKey]);
    if (x == null || y == null) { missing++; continue; }
    points.push({ code: a.code, name: a.name, x, y, population: num(a.values?.population) });
  }
  return { points, missing };
}

/** Compact value for bar ends: like formatValue without the long unit suffixes. */
export function formatShort(v, key) {
  const n = num(v);
  if (n == null) return '—';
  const unit = DATASETS[key]?.unit;
  if (unit === 'per 1.000' || key === 'population') return formatNumber(n, unit === 'per 1.000' ? 1 : 0);
  return formatValue(n, key);
}
