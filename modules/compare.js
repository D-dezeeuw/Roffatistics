// "Vergelijken" (15 Nov 2026): the side panel shows up to COMPARE_SIZE areas
// side by side. While it is open, a map click fills the first empty column,
// otherwise the column filled longest ago (FIFO). Pure, unit-tested
// (tests/compare.test.js); the DOM is compare-panel.js.
//
// Address-bar form (state.cmp): the codes per column, '.'-separated, an empty
// column as an empty entry, trailing empties dropped: `cmp=WK059901..BU05990110`.
// '.' is not escaped by URLSearchParams, so the link stays readable; ',' is
// read too (hand-typed links).
import { LAYER_CATEGORIES, DATASETS, categoryHeadline, datasetFor, datasetValue } from './datasets.js';

export const COMPARE_SIZE = 3;
/** Event a map click sends while the panel is open: detail { code }. */
export const COMPARE_ADD_EVENT = 'compare-add';

const CODE_RE = /^(PV\d{2}|GM\d{4}|WK\d{4}[0-9A-Z]{2}|BU\d{4}[0-9A-Z]{4})$/;
export const LEVEL_LABELS = Object.freeze({ PV: 'Provincie', GM: 'Gemeente', WK: 'Wijk', BU: 'Buurt' });

/** 'Provincie' | 'Gemeente' | 'Wijk' | 'Buurt' from the code prefix ('' when unknown). */
export const levelLabel = code => LEVEL_LABELS[String(code ?? '').slice(0, 2).toUpperCase()] ?? '';

/** cmp string → codes per column (null = empty); invalid and repeated codes become empty. */
export function decodeCmp(raw, size = COMPARE_SIZE) {
  const out = Array(size).fill(null);
  const parts = String(raw ?? '').split(/[.,]/).slice(0, size);
  const seen = new Set();
  parts.forEach((p, i) => {
    const c = p.trim().toUpperCase();
    if (CODE_RE.test(c) && !seen.has(c)) { out[i] = c; seen.add(c); }
  });
  return out;
}

/** Codes per column (or slots { code }) → cmp string; '' when every column is empty. */
export function encodeCmp(cols) {
  const codes = (cols ?? []).map(c => (typeof c === 'string' ? c : c?.code) ?? '');
  while (codes.length && !codes[codes.length - 1]) codes.pop();
  return codes.join('.');
}

/** state.js: the cleaned cmp string, or null when nothing valid is left. */
export function sanitizeCmp(raw) {
  return encodeCmp(decodeCmp(raw)) || null;
}

/** Slots from a cmp string: { code, seq } per filled column; the left column counts as the oldest. */
export function slotsFromCmp(raw, size = COMPARE_SIZE) {
  return decodeCmp(raw, size).map((code, i) => (code ? { code, seq: i } : null));
}

/**
 * Puts `code` in a column: unchanged when it is already shown, else the first
 * empty column, else the one filled longest ago. Returns { slots, index, added }.
 */
export function fillSlot(slots, code) {
  const c = String(code ?? '').trim().toUpperCase();
  const list = [...(slots ?? [])];
  if (!CODE_RE.test(c) || !list.length) return { slots: list, index: -1, added: false };
  const have = list.findIndex(s => s?.code === c);
  if (have >= 0) return { slots: list, index: have, added: false };
  const seq = Math.max(-1, ...list.map(s => s?.seq ?? -1)) + 1;
  let index = list.findIndex(s => !s);
  if (index < 0) index = list.reduce((best, s, i) => (s.seq < list[best].seq ? i : best), 0);
  list[index] = { code: c, seq };
  return { slots: list, index, added: true };
}

/** The slots with column `i` emptied. */
export function clearSlot(slots, i) {
  return (slots ?? []).map((s, j) => (j === i ? null : s));
}

/** The rows: one headline per layer category, plus the active map layer (marked active) when it is none of them. */
export function compareKeys(dataset) {
  const rows = LAYER_CATEGORIES.filter(g => !g.live).map(g => {   // live P2000 (W30): only as the active layer
    const key = categoryHeadline(g.key);
    return key ? { key, category: g.label, active: key === dataset } : null;
  }).filter(Boolean);
  if (DATASETS[dataset] && !rows.some(r => r.key === dataset)) {
    const cat = LAYER_CATEGORIES.find(g => g.key === DATASETS[dataset].group)?.label ?? 'Kaartlaag';
    rows.unshift({ key: dataset, category: cat, active: true });
  }
  return rows;
}

const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Better / worse per column for one row: 'best' and 'worst' for the extreme
 * values when at least two columns have a value, they differ and the metric
 * has a direction (higherIsBetter true/false); null otherwise (and in between).
 */
export function markRow(values, higherIsBetter) {
  const v = (values ?? []).map(num);
  const marks = v.map(() => null);
  const have = v.filter(x => x != null);
  if (higherIsBetter == null || have.length < 2) return marks;
  const max = Math.max(...have), min = Math.min(...have);
  if (max === min) return marks;
  const best = higherIsBetter ? max : min, worst = higherIsBetter ? min : max;
  return v.map(x => (x == null ? null : x === best ? 'best' : x === worst ? 'worst' : null));
}

/**
 * The table: areas per column ({ values } or null) → rows
 * [{ key, label, category, active, unit, values, marks }]. Crime rows follow `mode`.
 */
export function compareRows(areas, { dataset = null, mode = 'rate' } = {}) {
  return compareKeys(dataset).map(r => {
    const d = datasetFor(r.key, mode);
    const values = (areas ?? []).map(a => (a ? num(datasetValue(a.values, r.key, mode)) : null));
    return { ...r, label: d.label, unit: d.unit, values, marks: markRow(values, d.higherIsBetter) };
  });
}

/**
 * A map click on `code`: with the panel open it goes into a column
 * (COMPARE_ADD_EVENT) and the caller does nothing else; returns true then.
 */
export function routeToCompare(code, doc = globalThis.document) {
  if (!doc?.getElementById('panel')?.classList.contains('panel-open')) return false;
  doc.dispatchEvent(new CustomEvent(COMPARE_ADD_EVENT, { detail: { code } }));
  return true;
}
