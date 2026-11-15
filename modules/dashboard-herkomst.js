// Dashboard row "Herkomst" (docs/plan-dashboard.md): pure helpers for the
// world-region mix (CBS 85458NED per gemeente, herkomst-regio.js entries) and
// the diversity index over the kerncijfers split. No DOM.
import { REGIONS, REGION_KEYS } from './herkomst-regio.js';
import { originSplit } from './herkomst.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v);

/**
 * Sums herkomst-regio entries ({ total, nederland, onbekend, counts }) into one
 * entry; null without a usable entry. Used for "heel Nederland" (all gemeenten).
 */
export function sumRegioEntries(entries) {
  const list = (entries ?? []).filter(e => e && e.total > 0);
  if (!list.length) return null;
  const out = { total: 0, nederland: 0, onbekend: 0, counts: Object.fromEntries(REGION_KEYS.map(k => [k, 0])) };
  for (const e of list) {
    out.total += e.total;
    out.nederland += e.nederland ?? 0;
    out.onbekend += e.onbekend ?? 0;
    for (const k of REGION_KEYS) out.counts[k] += e.counts?.[k] ?? 0;
  }
  return out;
}

/**
 * Herkomst mix of one (summed) entry: Nederland plus every world region as
 * [{ key, label, color, count, pct }], largest first; the `top` largest are
 * kept and the rest (incl. Onbekend) becomes "Overige regio's". Null without data.
 */
export function regionMix(entry, { top = 6 } = {}) {
  if (!entry || !(entry.total > 0)) return null;
  const pct = v => v / entry.total * 100;
  const rows = [
    { key: 'nederland', label: 'Nederland', color: null, count: entry.nederland ?? 0 },
    ...REGIONS.map(r => ({ key: r.key, label: r.label, color: r.color, count: entry.counts?.[r.key] ?? 0 })),
  ].filter(r => r.count > 0).map(r => ({ ...r, pct: pct(r.count) })).sort((a, b) => b.count - a.count);
  const kept = rows.slice(0, top);
  const rest = rows.slice(top).reduce((s, r) => s + r.count, 0) + (entry.onbekend ?? 0);
  if (rest > 0) kept.push({ key: 'overig', label: "Overige regio's", color: null, count: rest, pct: pct(rest) });
  return kept;
}

/**
 * Simpson diversity over the three CBS parts (Nederland / Europa / buiten
 * Europa): the chance in % that two random inhabitants fall in a different
 * part, 0 (all one part) … 66.7 (equal thirds). Null without the split.
 */
export function diversityIndex(values) {
  const parts = originSplit(values);
  if (!parts) return null;
  const sumSq = parts.reduce((s, p) => s + (p.pct / 100) ** 2, 0);
  return (1 - sumSq) * 100;
}

/** Regio share of one region key in an entry, in % (null without data). */
export function regionShare(entry, key) {
  if (!entry || !(entry.total > 0)) return null;
  const v = key === 'nederland' ? entry.nederland : key === 'overig' ? null : entry.counts?.[key];
  return isNum(v) ? v / entry.total * 100 : null;
}
