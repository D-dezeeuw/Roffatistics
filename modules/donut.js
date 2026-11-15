// Pure donut-chart geometry for the dashboard (modules/dashboard.js):
// slice merging, percentages that sum to exactly 100 and SVG arc paths.
// No DOM, no imports; covered by tests/donut.test.js.

export const TAU = Math.PI * 2;
/** Slice colours in the app's purple → orange range, light enough for the dark cards. */
export const DONUT_PALETTE = Object.freeze(['#8b5cf6', '#f97316', '#c084fc', '#fdba74', '#6d28d9', '#ea580c', '#a78bfa', '#fb923c']);
export const OTHER_COLOR = '#6b6578';

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const f = v => +v.toFixed(2) || 0;

/** Point at angle `a` (radians, 0 = 12 o'clock, clockwise) on a circle. */
export function polar(cx, cy, r, a) {
  return [f(cx + r * Math.sin(a)), f(cy - r * Math.cos(a))];
}

/**
 * SVG path of a ring segment from angle a0 to a1 (radians, clockwise from the top).
 * rInner 0 draws a pie wedge. A segment covering the whole circle is drawn as
 * two rings (use fill-rule="evenodd"), since one arc cannot start and end on
 * the same point. Empty or negative spans return ''.
 */
export function arcPath(cx, cy, rOuter, rInner, a0, a1) {
  const span = a1 - a0;
  if (!(span > 0)) return '';
  if (span >= TAU - 1e-6) {
    const ring = r => `M${f(cx)} ${f(cy - r)}A${r} ${r} 0 1 1 ${f(cx)} ${f(cy + r)}A${r} ${r} 0 1 1 ${f(cx)} ${f(cy - r)}Z`;
    return rInner > 0 ? ring(rOuter) + ring(rInner) : ring(rOuter);
  }
  const large = span > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, rOuter, a0), [x1, y1] = polar(cx, cy, rOuter, a1);
  if (!(rInner > 0)) return `M${f(cx)} ${f(cy)}L${x0} ${y0}A${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1}Z`;
  const [x2, y2] = polar(cx, cy, rInner, a1), [x3, y3] = polar(cx, cy, rInner, a0);
  return `M${x0} ${y0}A${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${rInner} ${rInner} 0 ${large} 0 ${x3} ${y3}Z`;
}

/**
 * Percentages of `values` rounded to `decimals` that sum to exactly 100
 * (largest-remainder method). Non-numbers and negatives count as 0; an all-zero
 * input returns zeros.
 */
export function roundPercents(values, decimals = 1) {
  const vals = values.map(v => (isNum(v) && v > 0 ? v : 0));
  const total = vals.reduce((s, v) => s + v, 0);
  if (!total) return vals.map(() => 0);
  const scale = 10 ** decimals, target = 100 * scale;
  const raw = vals.map(v => (v / total) * target);
  const out = raw.map(Math.floor);
  let left = target - out.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).filter(([, i]) => vals[i] > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out.map(v => +(v / scale).toFixed(decimals));
}

/**
 * Drops empty items, optionally sorts high → low, keeps the first `top` items
 * that reach `minPct` of the total and merges the rest into one "Overig" item
 * ({ key: otherKey, other: true, members }). A single leftover item is kept
 * under its own name: an "Overig" of one says less than the name.
 */
export function mergeSlices(items, { top = Infinity, minPct = 0, sort = false, otherLabel = 'Overig', otherKey = 'other' } = {}) {
  let list = (items ?? []).filter(i => isNum(i?.value) && i.value > 0);
  if (sort) list = [...list].sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label), 'nl'));
  const total = list.reduce((s, i) => s + i.value, 0);
  const keep = [], rest = [];
  list.forEach((it, idx) => (idx < top && (it.value / total) * 100 >= minPct ? keep : rest).push(it));
  if (rest.length > 1) {
    keep.push({ key: otherKey, label: otherLabel, value: rest.reduce((s, i) => s + i.value, 0), other: true, members: rest.length });
  } else keep.push(...rest);
  return keep;
}

/**
 * Slices ready to draw: { total, slices: [{ ...item, pct, a0, a1, color }] }.
 * Angles follow the exact values; `pct` is rounded (sums to 100). Colours come
 * from item.color, else OTHER_COLOR for the merged item, else the palette.
 */
export function donutSlices(items, opts = {}) {
  const merged = mergeSlices(items, opts);
  const total = merged.reduce((s, i) => s + i.value, 0);
  const pcts = roundPercents(merged.map(i => i.value), opts.decimals ?? 1);
  let acc = 0, p = 0;
  const slices = merged.map((it, i) => {
    const a0 = total ? (acc / total) * TAU : 0;
    acc += it.value;
    const a1 = total ? (acc / total) * TAU : 0;
    const color = it.color ?? (it.other ? OTHER_COLOR : DONUT_PALETTE[p++ % DONUT_PALETTE.length]);
    return { ...it, pct: pcts[i], a0, a1, color };
  });
  return { total, slices };
}
