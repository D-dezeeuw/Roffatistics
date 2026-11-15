// Area search: the magnifier button / "/" / Ctrl+K opens a modal with a live,
// fuzzy-matched list of wijken, buurten, gemeenten and provincies.
// Matching lives in fuzzy.js; this module is the dialog and the state hand-off.
import { getState, setState } from './state.js';
import { createSearcher } from './fuzzy.js';

export const RECENT_KEY   = 'roffatistics.recentSearches';
export const RECENT_MAX   = 5;
export const RESULT_LIMIT = 12;
export const ROTTERDAM_GM = 'GM0599';

export const LEVEL_LABELS = Object.freeze({
  wijk: 'Wijk · Rotterdam', buurt: 'Buurt · Rotterdam', gemeente: 'Gemeente', provincie: 'Provincie',
});

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** Newest first, unique by code, at most RECENT_MAX. */
export function pushRecent(list, item) {
  const entry = { code: item.code, name: item.name, level: item.level, scope: item.scope };
  return [entry, ...(Array.isArray(list) ? list : []).filter(r => r && r.code !== item.code)].slice(0, RECENT_MAX);
}

export function loadRecent(storage) {
  try {
    const list = JSON.parse(storage?.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(r => r && typeof r.code === 'string' && typeof r.name === 'string').slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

export function saveRecent(storage, list) {
  try { storage?.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* storage blocked or full */ }
}

/**
 * What selecting `item` does, given the current state:
 * { patch, wholeCity, toMap, highlight }. Rotterdam areas → Rotterdam scope;
 * gemeenten/provincies → Nederland scope, except GM0599 which is the whole Rotterdam city.
 */
export function resolveSelection(item, state) {
  const wholeCity = item.code === ROTTERDAM_GM;
  const scope = wholeCity || item.scope === 'rotterdam' ? 'rotterdam' : 'nederland';
  const patch = { scope, area: wholeCity ? null : item.code };
  return {
    patch,
    wholeCity,
    toMap: state.view === 'dashboard',
    highlight: state.view === 'list' && !wholeCity,
    scopeChanged: state.scope !== scope,
  };
}

/** Splits `text` into [{ text, hit }] parts for the given [start, end) ranges. */
export function splitHighlight(text, ranges = []) {
  const parts = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s > at) parts.push({ text: text.slice(at, s), hit: false });
    parts.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

// ── Dialog ───────────────────────────────────────────────────────────────────

let els = null;
let search = null;          // createSearcher() result, once the index is loaded
let indexLoad = null;
let nameByCode = new Map();
let rows = [];              // [{ item, ranges, alias }] currently listed
let active = -1;
let returnFocus = null;

function storage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function ensureIndex() {
  if (!indexLoad) {
    indexLoad = import('./areas.js')
      .then(m => m.getAreaIndex())
      .then(items => {
        nameByCode = new Map(items.map(i => [i.code, i.name]));
        search = createSearcher(items);
        if (isOpen()) render();
      })
      .catch(err => {
        indexLoad = null;
        console.warn('Search index unavailable:', err);
        if (isOpen()) setHint('Zoekindex kon niet laden. Probeer het later opnieuw.');
      });
  }
  return indexLoad;
}

const isOpen = () => els && !els.modal.hidden;

function setHint(text) {
  els.hint.textContent = text;
  els.hint.hidden = !text;
}

export function openSearch() {
  if (!els || isOpen()) return;
  returnFocus = document.activeElement;
  els.modal.hidden = false;
  document.body.classList.add('search-open');
  els.input.value = '';
  render();
  ensureIndex();
  els.input.focus();
}

export function closeSearch() {
  if (!isOpen()) return;
  els.modal.hidden = true;
  document.body.classList.remove('search-open');
  els.input.setAttribute('aria-expanded', 'false');
  els.input.removeAttribute('aria-activedescendant');
  if (returnFocus && typeof returnFocus.focus === 'function' && document.contains(returnFocus)) returnFocus.focus();
  returnFocus = null;
}

function render() {
  const query = els.input.value;
  els.list.replaceChildren();
  active = -1;
  if (!query.trim()) {
    const recent = loadRecent(storage());
    rows = recent.map(item => ({ item, ranges: [], alias: null }));
    els.heading.textContent = recent.length ? 'Recent gezocht' : '';
    els.heading.hidden = !recent.length;
    setHint(recent.length ? '' : 'Typ een wijk, buurt, gemeente of provincie.');
  } else if (!search) {
    rows = [];
    els.heading.hidden = true;
    setHint('Zoekindex laden…');
  } else {
    rows = search(query, { scope: getState().scope, limit: RESULT_LIMIT });
    els.heading.hidden = true;
    setHint(rows.length ? '' : `Geen gebied gevonden voor “${query.trim()}”.`);
  }
  rows.forEach((row, i) => els.list.append(renderRow(row, i)));
  els.input.setAttribute('aria-expanded', rows.length ? 'true' : 'false');
  setActive(rows.length ? 0 : -1);
}

function markText(parent, text, ranges) {
  for (const part of splitHighlight(text, ranges)) {
    if (part.hit) {
      const m = document.createElement('mark');
      m.textContent = part.text;
      parent.append(m);
    } else parent.append(document.createTextNode(part.text));
  }
}

function renderRow({ item, ranges, alias }, i) {
  const li = document.createElement('li');
  li.id = `search-opt-${i}`;
  li.className = 'search-result';
  li.setAttribute('role', 'option');
  li.dataset.index = String(i);

  const name = document.createElement('span');
  name.className = 'search-result-name';
  markText(name, item.name, alias ? [] : ranges);
  if (alias) {
    const aka = document.createElement('span');
    aka.className = 'search-result-alias';
    markText(aka, alias, ranges);
    name.append(' (', aka, ')');
  }

  const meta = document.createElement('span');
  meta.className = 'search-result-meta';
  const parentName = item.parent ? nameByCode.get(item.parent) : null;
  meta.textContent = LEVEL_LABELS[item.level] ?? item.level;
  if (parentName && item.level === 'buurt') meta.textContent += ` · ${parentName}`;
  li.dataset.level = item.level;

  li.append(name, meta);
  li.addEventListener('mousedown', e => e.preventDefault());   // keep focus in the input
  li.addEventListener('click', () => choose(i));
  li.addEventListener('mousemove', () => { if (active !== i) setActive(i); });
  return li;
}

function setActive(i) {
  const items = els.list.children;
  if (active >= 0 && items[active]) items[active].setAttribute('aria-selected', 'false');
  active = i;
  if (i < 0 || !items[i]) { els.input.removeAttribute('aria-activedescendant'); return; }
  items[i].setAttribute('aria-selected', 'true');
  els.input.setAttribute('aria-activedescendant', items[i].id);
  items[i].scrollIntoView?.({ block: 'nearest' });
}

function choose(i) {
  const row = rows[i];
  if (!row) return;
  saveRecent(storage(), pushRecent(loadRecent(storage()), row.item));
  closeSearch();
  applySelection(row.item);
}

const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

/** Hands the chosen area to the app through the state bus (see resolveSelection). */
export async function applySelection(item) {
  const before = getState();
  const sel = resolveSelection(item, before);
  if (sel.toMap) {
    setState({ view: 'map' }, { source: 'search' });
    await nextFrame();   // the map container is visible again before it zooms
  }
  // Re-selecting the current area still zooms: clear it first so `area` changes.
  if (sel.patch.area && before.area === sel.patch.area && !sel.scopeChanged) setState({ area: null }, { source: 'search' });
  setState(sel.patch, { source: 'search' });

  const view = getState().view;
  if (sel.wholeCity && !sel.scopeChanged && view === 'map') fitWholeCity();
  if (sel.highlight) {
    // A scope switch re-renders the list first; give it a moment, then highlight.
    const highlight = () => import('./list.js').then(m => m.highlightArea?.(item.code)).catch(() => {});
    if (sel.scopeChanged) setTimeout(highlight, 400);
    else highlight();
  }
}

function fitWholeCity() {
  Promise.all([import('./rotterdam.js'), import('./map.js'), import('./panel.js')])
    .then(([rd, map, panel]) => {
      const bounds = rd.getRotterdamAreas()?.bounds;
      if (bounds) map.getMap().fitBounds(bounds);
      panel.hidePanel?.();
    })
    .catch(() => {});
}

function trapFocus(e) {
  const focusables = [...els.dialog.querySelectorAll('input, button, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function onDialogKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); return; }
  if (e.key === 'Tab') { trapFocus(e); return; }
  if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); setActive((active + 1) % rows.length); return; }
  if (e.key === 'ArrowUp' && rows.length) { e.preventDefault(); setActive((active - 1 + rows.length) % rows.length); return; }
  if (e.key === 'Enter' && e.target === els.input) { e.preventDefault(); if (active >= 0) choose(active); }
}

function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Wires the topnav button, the modal and the "/" and Ctrl/Cmd+K shortcuts. */
export function initSearch() {
  const modal = document.getElementById('search-modal');
  if (!modal) return;
  els = {
    modal,
    dialog: modal.querySelector('.search-dialog'),
    input: modal.querySelector('#search-input'),
    list: modal.querySelector('#search-results'),
    hint: modal.querySelector('.search-hint'),
    heading: modal.querySelector('.search-heading'),
  };
  document.querySelector('.search-btn')?.addEventListener('click', openSearch);
  modal.querySelectorAll('[data-search-close]').forEach(el => el.addEventListener('click', closeSearch));
  els.input.addEventListener('input', render);
  modal.addEventListener('keydown', onDialogKey);
  document.addEventListener('keydown', e => {
    if (isOpen()) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && k === 'k') { e.preventDefault(); openSearch(); return; }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(document.activeElement)) {
      e.preventDefault();
      openSearch();
    }
  });
}
