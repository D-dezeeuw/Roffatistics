// Laagstapel (docs/plan-laagstapel.md): the user's own map from 2–6 layers.
// Per layer a direction (h = hoger is beter, l = lager is beter) and a weight
// 1–3; the value per area is the weighted mean of the direction-aware
// percentile scores (ranking.js percentileScores) within the list it is
// computed on (city wijken and buurten separately, NL per level). Not part of
// the Woonscore. Pure (no DOM): unit-tested in tests/stapel.test.js.
import { DATASETS, LAYER_KEYS, datasetValue, isCrimeDataset, resolveLayerKey, resetCrimeAreas } from './datasets.js';
import { percentileScores } from './ranking.js';

export const STACK_KEY = 'stapel';
export const STACK_MIN = 2;
export const STACK_MAX = 6;
export const STACK_WEIGHTS = Object.freeze([1, 2, 3]);
export const STACK_DIRS = Object.freeze({ h: 'Hoger is beter', l: 'Lager is beter' });
const ARROW = Object.freeze({ h: '↑', l: '↓' });

/** True for a layer that can go into a stack: a dropdown layer, not live (P2000), not the stack itself. */
export function isStackable(key) {
  const d = DATASETS[key];
  return !!d && key !== STACK_KEY && !d.live && LAYER_KEYS.includes(key);
}

/**
 * Default direction of `key` in a stack: from higherIsBetter; WOZ is
 * "lager is beter" (affordability); neutral layers (herkomst, distances
 * without a direction) get null: the user picks one before they count.
 */
export function defaultDirection(key) {
  if (key === 'wozValue') return 'l';
  const h = DATASETS[key]?.higherIsBetter;
  return h === true ? 'h' : h === false ? 'l' : null;
}

const ITEM_RE = /^([A-Za-z0-9_]+)(?:\.([hl])([1-3])?)?$/;
const fmt = items => items.map(i => `${i.key}.${i.dir}${i.weight > 1 ? i.weight : ''}`).join(',');

/**
 * 'wozValue.l,crimeRate.l2,distGroen.h' → [{ key, dir, weight }]. Unknown,
 * live, duplicate or malformed items are dropped, an item without direction
 * takes the default (dropped when the layer has none), at most 6 are kept.
 * Fewer than 2 valid items → null (no stack).
 */
export function parseStack(spec) {
  if (spec == null || spec === '') return null;
  const items = [];
  const seen = new Set();
  for (const part of String(spec).split(',')) {
    const m = ITEM_RE.exec(part.trim());
    if (!m) continue;
    const key = resolveLayerKey(m[1]);
    if (!isStackable(key) || seen.has(key)) continue;
    const dir = m[2] ?? defaultDirection(key);
    if (!dir) continue;
    seen.add(key);
    items.push({ key, dir, weight: m[3] ? Number(m[3]) : 1 });
    if (items.length === STACK_MAX) break;
  }
  return items.length >= STACK_MIN ? items : null;
}

/** [{ key, dir, weight }] → the canonical spec string, or null when it is no valid stack. */
export function serializeStack(items) {
  if (!Array.isArray(items)) return null;
  const parsed = parseStack(fmt(items.filter(i => i && (i.dir === 'h' || i.dir === 'l')).map(i => ({ ...i, weight: STACK_WEIGHTS.includes(Number(i.weight)) ? Number(i.weight) : 1 }))));
  return parsed ? fmt(parsed) : null;
}

/** A spec string (URL, storage) → its canonical form, or null. */
export const normalizeStack = spec => serializeStack(parseStack(spec));

/** True when the stack holds a crime layer (it then follows Per 1000 / Absoluut). */
export const stackUsesCrime = items => !!items?.some(i => isCrimeDataset(i.key));

/**
 * The stack value of every area in `areas` (one list = one comparison set).
 * Returns, aligned with `areas`, { code, value, parts, weightUsed, weightTotal }:
 * parts = [{ key, dir, weight, raw, score }] with the raw value (in `mode`)
 * and its direction-aware percentile score. value = Σ weight × score / Σ weight
 * over the parts with a score, or null when those cover less than half of the
 * total weight (rounded up). `valuesOf` reads an area's values (flat CBS rows: r => r).
 */
export function stackValues(areas, items, { mode = 'rate', valuesOf = a => a.values } = {}) {
  const list = areas ?? [];
  if (!items?.length) return list.map(() => null);
  const cols = items.map(it => {
    const raw = list.map(a => { const v = datasetValue(valuesOf(a), it.key, mode); return typeof v === 'number' && Number.isFinite(v) ? v : null; });
    return { ...it, raw, score: percentileScores(raw, it.dir === 'h') };
  });
  const total = items.reduce((s, i) => s + i.weight, 0);
  const need = Math.ceil(total / 2);
  return list.map((a, i) => {
    let used = 0, sum = 0;
    const parts = cols.map(c => {
      const score = c.score[i];
      if (score != null) { used += c.weight; sum += c.weight * score; }
      return { key: c.key, dir: c.dir, weight: c.weight, raw: c.raw[i], score };
    });
    return { code: a.code ?? a.regionCode, value: used > 0 && used >= need ? sum / used : null, parts, weightUsed: used, weightTotal: total };
  });
}

// ── Active stack (state.stack + state.crime, set by app.js) ──────────────────

let active = { items: null, mode: 'rate' };
/** Last stack result per area code (codes are unique across levels), for tooltip, modal and Ranglijst. */
export const STACK_RESULTS = new Map();

export function setActiveStack(spec, mode = 'rate') {
  active = { items: Array.isArray(spec) ? spec : parseStack(spec), mode: mode === 'abs' ? 'abs' : 'rate' };
  if (!active.items) STACK_RESULTS.clear();
}
export const getActiveStack = () => active.items;
export const stackResult = code => (active.items ? STACK_RESULTS.get(code) ?? null : null);

function record(res, code) {
  if (res) STACK_RESULTS.set(code, res); else STACK_RESULTS.delete(code);
}

/** Writes values.stapel (null without a stack) on every area of `list` IN PLACE; returns the results. */
export function assignStack(list, { items = active.items, mode = active.mode } = {}) {
  if (!list?.length) return [];
  const res = stackValues(list, items, { mode });
  list.forEach((a, i) => { a.values = a.values ?? {}; a.values[STACK_KEY] = res[i]?.value ?? null; record(res[i], a.code); });
  resetCrimeAreas();   // the Absoluut copies (crimeAreas) are rebuilt with the new values
  return res;
}

/** The same for flat CBS rows ({ regionCode, ...values }): writes row.stapel in place. */
export function assignStackRows(rows, { items = active.items, mode = active.mode } = {}) {
  if (!rows?.length) return [];
  const res = stackValues(rows, items, { mode, valuesOf: r => r });
  rows.forEach((r, i) => { r[STACK_KEY] = res[i]?.value ?? null; record(res[i], r.regionCode); });
  return res;
}

// ── Texts (legend, tooltip, builder) ─────────────────────────────────────────

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const stackLayerLabel = key => DATASETS[key]?.label ?? key;

/** "↓ WOZ waarde ×2" */
export function stackItemText(item) {
  return `${ARROW[item.dir] ?? ''} ${stackLayerLabel(item.key)}${item.weight > 1 ? ` ×${item.weight}` : ''}`.trim();
}

/** Tooltip line: "WOZ waarde 72 · Misdrijven totaal 40" (– = no value). */
export function stackNote(result) {
  if (!result?.parts?.length) return null;
  return result.parts.map(p => `${stackLayerLabel(p.key)} ${p.score == null ? '–' : Math.round(p.score)}`).join(' · ');
}

/** "3 lagen" */
export const stackCountText = n => `${n} ${n === 1 ? 'laag' : 'lagen'}`;

/**
 * Status of a builder draft [{ key, dir|null, weight }]: valid when 2–6
 * layers each have a direction. `text` says what is missing.
 */
export function stackDraftStatus(draft = []) {
  const count = draft.length;
  const missing = draft.filter(d => d.dir !== 'h' && d.dir !== 'l').map(d => stackLayerLabel(d.key));
  let text = stackCountText(count);
  if (count < STACK_MIN) text += ` · kies er minstens ${STACK_MIN}`;
  else if (count > STACK_MAX) text += ` · hoogstens ${STACK_MAX}`;
  else if (missing.length) text += ` · kies een richting voor ${missing.join(', ')}`;
  return { count, missing, valid: count >= STACK_MIN && count <= STACK_MAX && !missing.length, text };
}

/**
 * Legend block for layer `key`: the stack's layers with arrows and weights and
 * "Bewerken" while the stack is shown; "+ Stapel" on any other stackable layer
 * ("In je stapel" when it is in already). Empty for layers that cannot stack.
 */
export function stackLegendHtml(items, key) {
  if (key === STACK_KEY) {
    if (!items?.length) return '<button type="button" class="legend-stack-btn" data-stack-open>Stapel samenstellen</button>';
    return `<ul class="legend-stack-list">${items.map(i => `<li><span class="stack-arrow">${ARROW[i.dir]}</span> ${esc(stackLayerLabel(i.key))}${i.weight > 1 ? ` <small>×${i.weight}</small>` : ''}</li>`).join('')}</ul>
      <p class="legend-stack-hint">↑ / ↓ = hoger / lager is beter · 0–100 binnen de getoonde gebieden</p>
      <button type="button" class="legend-stack-btn" data-stack-open>Bewerken</button>`;
  }
  if (!isStackable(key)) return '';
  if (items?.some(i => i.key === key)) return '<span class="legend-stack-in">In je stapel</span> <button type="button" class="legend-stack-btn" data-stack-open>Bewerken</button>';
  return `<button type="button" class="legend-stack-btn" data-stack-add="${esc(key)}" title="Voeg deze laag toe aan Mijn stapel">+ Stapel</button>`;
}
