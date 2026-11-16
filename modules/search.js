// Area search: the magnifier button / "/" / Ctrl+K opens a modal with a live,
// fuzzy-matched list of wijken, buurten, gemeenten and provincies.
// Matching lives in fuzzy.js; this module is the dialog and the state hand-off.
import { getState, setState } from './state.js';
import { createSearcher } from './fuzzy.js';
import { isPostcodeQuery } from './postcode.js';
import { CITY, isCityAreaCode } from './city.js';

export const RECENT_KEY   = 'roffatistics.recentSearches';
export const RECENT_MAX   = 5;
export const RESULT_LIMIT = 12;
export const CITY_GM = CITY.gemeente;

export const LEVEL_LABELS = Object.freeze({
  wijk: `Wijk · ${CITY.name}`, buurt: `Buurt · ${CITY.name}`, gemeente: 'Gemeente', provincie: 'Provincie',
});

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** Newest first, unique by code, at most RECENT_MAX. */
export function pushRecent(list, item) {
  const entry = { code: item.code, name: item.name, level: item.level, scope: item.scope, ...(item.meta ? { meta: item.meta } : {}) };
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
  const wholeCity = item.code === CITY_GM;
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

const POSTCODE_LEVEL = Object.freeze({ buurt: 'buurt', wijk: 'wijk', gemeente: 'gemeente' });

/**
 * A resolved postcode (herkomst-pc4.resolvePostcode) → a search item:
 * { code, name, level, scope, meta, postcode }. Rotterdam wijken/buurten go to
 * the Rotterdam scope, everything else to Nederland. `nameOf(code)` can supply
 * a better name (the search index knows gemeenten). Null without a hit.
 */
export function postcodeItem(hit, nameOf = () => null) {
  if (!hit?.code) return null;
  const rtm = isCityAreaCode(hit.code);
  return {
    code: hit.code, name: nameOf(hit.code) ?? hit.name, level: hit.level,
    scope: rtm ? 'rotterdam' : 'nederland', postcode: hit.pc4,
    meta: `Postcode ${hit.pc4} · ${POSTCODE_LEVEL[hit.level] ?? hit.level} met de meeste adressen`,
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

// ── Result boxes ─────────────────────────────────────────────────────────────
// One input + listbox pair. The search dialog and the splash "Jouw buurt" card
// each own one; the index, the postcode crosswalk and recent searches are shared.

let search = null;          // createSearcher() result, once the index is loaded
let indexLoad = null;
let nameByCode = new Map();
let pcIndex = null;          // { ix, resolve } once the postcode crosswalk is loaded
let pcLoad = null;
const boxes = new Set();     // every result box; only live ones re-render on load

function storage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

const liveBoxes = () => [...boxes].filter(b => b.isLive());

export function ensureIndex() {
  if (!indexLoad) {
    indexLoad = import('./areas.js')
      .then(m => m.getAreaIndex())
      .then(items => {
        nameByCode = new Map(items.map(i => [i.code, i.name]));
        search = createSearcher(items);
        liveBoxes().forEach(b => b.render());
      })
      .catch(err => {
        indexLoad = null;
        console.warn('Search index unavailable:', err);
        liveBoxes().forEach(b => b.setHint('Zoekindex kon niet laden. Probeer het later opnieuw.'));
      });
  }
  return indexLoad;
}

// Postcode search (v0.25.0): the crosswalk (data/nl/pc4-gwb-2023.json) loads on the first postcode typed.
function ensurePostcodes() {
  if (!pcLoad) {
    pcLoad = import('./herkomst-pc4.js')
      .then(m => m.loadPc4Crosswalk().then(ix => { pcIndex = { ix, resolve: m.resolvePostcode }; liveBoxes().forEach(b => b.render()); }))
      .catch(err => { pcLoad = null; console.warn('Postcodes unavailable:', err); });
  }
  return pcLoad;
}

/** Stores `item` at the top of the recent searches. */
export function rememberSearch(item) {
  saveRecent(storage(), pushRecent(loadRecent(storage()), item));
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

/**
 * Wires live fuzzy + postcode results to `input`/`list` (role=listbox).
 * `onChoose(item)` runs after the pick is saved to the recent searches.
 * Returns { render, setHint, onKey(e) → handled, chooseActive() → bool, clear() }.
 */
export function createResultBox({ input, list, hint = null, heading = null, idPrefix = 'search-opt', onChoose, isLive = () => true, onRender = null }) {
  let rows = [];               // [{ item, ranges, alias }] currently listed
  let active = -1;

  function setHint(text) {
    if (!hint) return;
    hint.textContent = text;
    hint.hidden = !text;
  }

  function setActive(i) {
    const items = list.children;
    if (active >= 0 && items[active]) items[active].setAttribute('aria-selected', 'false');
    active = i;
    if (i < 0 || !items[i]) { input.removeAttribute('aria-activedescendant'); return; }
    items[i].setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', items[i].id);
    items[i].scrollIntoView?.({ block: 'nearest' });
  }

  function renderRow({ item, ranges, alias }, i) {
    const li = document.createElement('li');
    li.id = `${idPrefix}-${i}`;
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
    meta.textContent = item.meta ?? LEVEL_LABELS[item.level] ?? item.level;
    if (parentName && item.level === 'buurt' && !item.meta) meta.textContent += ` · ${parentName}`;
    li.dataset.level = item.level;

    li.append(name, meta);
    li.addEventListener('mousedown', e => e.preventDefault());   // keep focus in the input
    li.addEventListener('click', () => choose(i));
    li.addEventListener('mousemove', () => { if (active !== i) setActive(i); });
    return li;
  }

  function render() {
    const query = input.value;
    list.replaceChildren();
    active = -1;
    if (!query.trim()) {
      const recent = loadRecent(storage());
      rows = recent.map(item => ({ item, ranges: [], alias: null }));
      if (heading) {
        heading.textContent = recent.length ? 'Recent gezocht' : '';
        heading.hidden = !recent.length;
      }
      setHint(recent.length ? '' : 'Typ een wijk, buurt, gemeente, provincie of postcode.');
    } else {
      const pc = isPostcodeQuery(query);
      if (pc) ensurePostcodes();
      const pcItem = pc && pcIndex ? postcodeItem(pcIndex.resolve(query, pcIndex.ix), c => nameByCode.get(c) ?? null) : null;
      if (heading) heading.hidden = true;
      if (!search && !pcItem) {
        rows = [];
        setHint(pc && !pcIndex ? 'Postcodes laden…' : 'Zoekindex laden…');
      } else {
        const found = search ? search(query, { scope: getState().scope, limit: RESULT_LIMIT }) : [];
        rows = [...(pcItem ? [{ item: pcItem, ranges: [], alias: null }] : []), ...found].slice(0, RESULT_LIMIT);
        setHint(rows.length ? '' : pc && pcIndex ? `Postcode ${query.trim()} niet gevonden.` : `Geen gebied gevonden voor “${query.trim()}”.`);
      }
    }
    rows.forEach((row, i) => list.append(renderRow(row, i)));
    input.setAttribute('aria-expanded', rows.length ? 'true' : 'false');
    setActive(rows.length ? 0 : -1);
    onRender?.(rows.length);
  }

  function choose(i) {
    const row = rows[i];
    if (!row) return false;
    rememberSearch(row.item);
    onChoose(row.item);
    return true;
  }

  function onKey(e) {
    if (e.target !== input) return false;
    if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); setActive((active + 1) % rows.length); return true; }
    if (e.key === 'ArrowUp' && rows.length) { e.preventDefault(); setActive((active - 1 + rows.length) % rows.length); return true; }
    if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) choose(active); return true; }
    return false;
  }

  function clear() {
    rows = [];
    active = -1;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  const box = { render, setHint, onKey, clear, isLive, chooseActive: () => (input.value.trim() ? choose(active) : false) };
  boxes.add(box);
  input.addEventListener('input', () => { render(); ensureIndex(); });
  return box;
}

// ── Dialog ───────────────────────────────────────────────────────────────────

let els = null;
let box = null;
let returnFocus = null;

const isOpen = () => els && !els.modal.hidden;

export function openSearch() {
  if (!els || isOpen()) return;
  returnFocus = document.activeElement;
  els.modal.hidden = false;
  document.body.classList.add('search-open');
  els.input.value = '';
  box.render();
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
  Promise.all([import('./city-scope.js'), import('./map.js')])
    .then(([rd, map]) => {
      const bounds = rd.getCityAreas()?.bounds;
      if (bounds) map.getMap().fitBounds(bounds);
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
  box.onKey(e);
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
  box = createResultBox({
    input: els.input, list: els.list, hint: els.hint, heading: els.heading,
    isLive: isOpen,
    onChoose: item => { closeSearch(); applySelection(item); },
  });
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
