// "Vergelijken" side panel (15 Nov 2026): COMPARE_SIZE columns, one area each
// (name, level, Woonscore and one headline per category, the active map layer
// highlighted, best/worst per row). While the panel is open, a map click fills
// the first empty column, else the oldest (compare.js fillSlot). The columns
// live here; state.cmp mirrors them in the address bar and share link.
import { getState, setState, onStateChange } from './state.js';
import { COMPARE_SIZE, COMPARE_ADD_EVENT, slotsFromCmp, encodeCmp, fillSlot, clearSlot, compareRows, levelLabel } from './compare.js';
import { compareArea, openAreaModal } from './area-modal.js';
import { formatValue } from './dashboard-data.js';
import { scoreKind, scoreLabel } from './wizard-model.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let slots = Array(COMPARE_SIZE).fill(null);   // { code, seq } per column
const cache = new Map();                      // code → area | null | Promise
let lastAdded = -1;                           // column index flashed after a fill
let root = null;

const panelEl = () => globalThis.document?.getElementById('panel') ?? null;

/** True while the Vergelijken panel is open (map clicks then fill a column). */
export function isCompareOpen() {
  return !!panelEl()?.classList.contains('panel-open');
}

function setOpen(open) {
  const el = panelEl();
  if (!el) return;
  el.classList.toggle('panel-open', open);
  el.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) render();
  document.dispatchEvent(new CustomEvent('panel-toggle', { detail: { open } }));
}
export const openCompare  = () => setOpen(true);
export const closeCompare = () => { if (isCompareOpen()) setOpen(false); };
export const toggleCompare = () => setOpen(!isCompareOpen());

/** Puts `code` in a column (first empty, else the oldest) and opens the panel. */
export function addToCompare(code) {
  const r = fillSlot(slots, code);
  if (r.index < 0) return -1;
  slots = r.slots;
  lastAdded = r.added ? r.index : -1;
  commit();
  if (!isCompareOpen()) setOpen(true);
  return r.index;
}

function commit() {
  setState({ cmp: encodeCmp(slots) || null }, { source: 'compare' });
  render();
}

function areaFor(code) {
  const hit = cache.get(code);
  if (hit !== undefined && !(hit instanceof Promise)) return hit;
  if (!hit) {
    const p = compareArea(code).catch(() => null).then(a => {
      if (cache.get(code) === p) { cache.set(code, a); render(); }
      return a;
    });
    cache.set(code, p);
  }
  return undefined;   // loading
}

const show = (v, key, mode) => (v == null ? '—' : formatValue(v, key, mode));

function headHtml(slot, i, area) {
  if (!slot) return `<th scope="col" class="cmp-col is-empty"><span class="cmp-empty">Klik op de kaart</span></th>`;
  const name = area?.name ?? (area === null ? slot.code : 'Laden…');
  return `<th scope="col" class="cmp-col${i === lastAdded ? ' is-new' : ''}">
    <span class="cmp-name">${esc(name)}</span>
    <span class="cmp-level">${esc(levelLabel(slot.code))} · ${esc(slot.code)}</span>
    <span class="cmp-actions">
      <button type="button" class="cmp-details" data-cmp-details="${esc(slot.code)}" aria-label="Details van ${esc(name)}">Details</button>
      <button type="button" class="cmp-clear" data-cmp-clear="${i}" aria-label="${esc(name)} uit de vergelijking halen" title="Kolom leegmaken">&#x2715;</button>
    </span>
  </th>`;
}

const MARK_TEXT = { best: 'beste', worst: 'slechtste' };

function render() {
  const el = panelEl();
  root = root ?? el?.querySelector('[data-compare-root]');
  if (!root || !isCompareOpen()) return;
  const { dataset, crime: mode, score } = getState();
  const areas = slots.map(s => (s ? areaFor(s.code) : null));
  const rows = compareRows(areas.map(a => a ?? null), { dataset, mode });
  const filled = slots.filter(Boolean).length;
  const scoreName = scoreKind(score) === 'standaard' ? 'Woonscore' : scoreLabel(score);
  root.innerHTML = `
    <div class="cmp-head">
      <h2 class="cmp-title">Vergelijken</h2>
      ${filled ? '<button type="button" class="cmp-clear-all">Alles wissen</button>' : ''}
      <button type="button" class="panel-close" aria-label="Sluit Vergelijken">&#x2715;</button>
    </div>
    <p class="cmp-hint">Klik op een gebied op de kaart: het vult de eerste lege kolom, anders de oudste.</p>
    <div class="cmp-scroll">
      <table class="cmp-table">
        <thead><tr><th scope="col" class="cmp-rowhead"><span class="sr-only">Kenmerk</span></th>${slots.map((s, i) => headHtml(s, i, areas[i])).join('')}</tr></thead>
        <tbody>${rows.map(r => `
          <tr class="cmp-row${r.active ? ' is-active' : ''}">
            <th scope="row" class="cmp-rowhead"><span class="cmp-cat">${esc(r.category)}${r.active ? ' · kaartlaag' : ''}</span><span class="cmp-metric">${esc(r.key === 'woonscore' ? scoreName : r.label)}</span></th>
            ${r.values.map((v, i) => `<td class="cmp-cell${r.marks[i] ? ` is-${r.marks[i]}` : ''}">${slots[i] ? esc(show(v, r.key, mode)) : ''}${r.marks[i] ? `<span class="sr-only"> (${MARK_TEXT[r.marks[i]]})</span>` : ''}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function onClick(e) {
  const t = e.target.closest?.('button');
  if (!t || !root?.contains(t)) return;
  if (t.classList.contains('panel-close')) { closeCompare(); return; }
  if (t.classList.contains('cmp-clear-all')) { slots = slots.map(() => null); lastAdded = -1; commit(); return; }
  if (t.dataset.cmpClear != null) { slots = clearSlot(slots, Number(t.dataset.cmpClear)); lastAdded = -1; commit(); return; }
  if (t.dataset.cmpDetails) openAreaModal(t.dataset.cmpDetails, t);
}

/** Wires the panel: columns from state.cmp (a shared link opens the panel), map-click events, re-render on layer/score changes. */
export function initComparePanel() {
  const el = panelEl();
  root = el?.querySelector('[data-compare-root]') ?? null;
  el?.addEventListener('click', onClick);
  const st = getState();
  if (st.cmp) { slots = slotsFromCmp(st.cmp); setOpen(true); }
  document.addEventListener(COMPARE_ADD_EVENT, ({ detail }) => addToCompare(detail?.code));
  onStateChange(({ state, changed, source }) => {
    if (changed.includes('cmp') && source !== 'compare' && (state.cmp ?? '') !== encodeCmp(slots)) {
      slots = slotsFromCmp(state.cmp);   // a pasted link
      lastAdded = -1;
      if (state.cmp) setOpen(true);
    }
    if (changed.includes('score')) cache.clear();   // national rows are rebuilt on a rescore
    if (['cmp', 'dataset', 'crime', 'score'].some(k => changed.includes(k))) render();
  });
}
