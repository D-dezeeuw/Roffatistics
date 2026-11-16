// Keyboard shortcuts (W28): one central map from a key to an action.
//
// `shortcutFor(event, context)` is pure: it returns the id of the shortcut a
// keydown means, or null. It ignores keys while the user types (input,
// select, textarea, contenteditable), every Ctrl/Alt/Meta combo (Ctrl/Cmd+K
// belongs to search.js), and, while a modal dialog is open, everything but
// `?`. Esc is never ours: each dialog closes itself. `/` stays in search.js.
// `+`/`-` and the arrow keys are Leaflet's own when the map has focus.
//
// `initShortcuts()` wires the document keydown, the "Sneltoetsen" help
// dialog (`?`, ☰ menu item), the skip link and the aria-keyshortcuts
// attributes. Actions only click the existing buttons, so the modules that
// own them (wizard, share-dialog, explain, nav-menu, panel, …) stay in charge.
import { CITY } from './city.js';

/** The registry, in help-dialog order. `aria` = aria-keyshortcuts value, `selector` = the button it describes. */
export const SHORTCUTS = Object.freeze([
  { id: 'view-map',       keys: ['1'],      label: 'Kaart',                         group: 'Weergave',  selector: '.view-opt[data-view="map"]',       aria: '1' },
  { id: 'view-dashboard', keys: ['2'],      label: 'Dashboard',                     group: 'Weergave',  selector: '.view-opt[data-view="dashboard"]', aria: '2' },
  { id: 'view-list',      keys: ['3'],      label: 'Ranglijst',                     group: 'Weergave',  selector: '.view-opt[data-view="list"]',      aria: '3' },
  { id: 'scope',          keys: ['n'],      label: `Wissel ${CITY.name} / Nederland`,  group: 'Weergave',  selector: '.scope-select',                    aria: 'N' },
  { id: 'layers',         keys: ['l'],      label: 'Lagen kiezen',                  group: 'Lagen',     selector: '.layers-btn',                      aria: 'L' },
  { id: 'layer-prev',     keys: ['['],      label: 'Vorige laag in deze categorie', group: 'Lagen' },
  { id: 'layer-next',     keys: [']'],      label: 'Volgende laag in deze categorie', group: 'Lagen' },
  { id: 'search',         keys: ['s', '/'], label: 'Zoeken (ook Ctrl+K)',           group: 'Openen',    selector: '.search-btn',                      aria: 'S / Control+K Meta+K' },
  { id: 'wizard',         keys: ['w'],      label: 'Vind jouw ideale woonplek',     group: 'Openen',    selector: '.wizard-btn',                      aria: 'W' },
  { id: 'share',          keys: ['d'],      label: 'Delen',                         group: 'Openen',    selector: '.share-btn',                       aria: 'D' },
  { id: 'explain',        keys: ['u'],      label: 'Uitleg',                        group: 'Openen',    selector: '.explain-btn',                     aria: 'U' },
  { id: 'compare',        keys: ['v'],      label: 'Vergelijken',                   group: 'Openen',    selector: '.panel-toggle-btn',                aria: 'V' },
  { id: 'menu',           keys: ['m'],      label: 'Menu (☰)',                      group: 'Openen',    selector: '.nav-menu-btn',                    aria: 'M' },
  { id: 'theme',          keys: ['t'],      label: 'Kleurthema wisselen',           group: 'Openen' },
  { id: 'help',           keys: ['?'],      label: 'Deze lijst met sneltoetsen',    group: 'Openen',    selector: '.shortcuts-btn',                   aria: 'Shift+?' },
  { id: 'zoom-in',        keys: ['+'],      label: 'Inzoomen',                      group: 'Kaart' },
  { id: 'zoom-out',       keys: ['-'],      label: 'Uitzoomen',                     group: 'Kaart' },
]);

/** Keys handled elsewhere, listed in the help dialog only. */
export const OTHER_KEYS = Object.freeze([
  { keys: ['←', '↑', '→', '↓'], label: 'Kaart verschuiven (als de kaart focus heeft)', group: 'Kaart' },
  { keys: ['Spatie'],           label: 'Ingedrukt houden: kaart slepen zonder te klikken', group: 'Kaart' },
  { keys: ['Esc'],              label: 'Venster of menu sluiten', group: 'Openen' },
  { keys: ['Tab'],              label: 'Naar het volgende element; eerst "Naar de inhoud"', group: 'Openen' },
]);

const BY_KEY = new Map(SHORTCUTS.flatMap(s => s.keys.map(k => [k, s.id])));
const ALIASES = { '=': '+', '_': '-', '−': '-', 'Add': '+', 'Subtract': '-' };
const MAP_ONLY = new Set(['zoom-in', 'zoom-out']);

/** True when the key goes into a form field or editable text. */
export function isTypingTarget(t) {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * The shortcut id for a keydown, or null.
 * context: { dialogOpen, mapFocused, view } — view is 'map' | 'dashboard' | 'list'.
 */
export function shortcutFor(e, context = {}) {
  if (!e || e.defaultPrevented || e.isComposing || e.repeat) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isTypingTarget(e.target)) return null;
  let key = ALIASES[e.key] ?? e.key;
  if (typeof key !== 'string') return null;
  if (key.length === 1 && /[a-z]/i.test(key)) {
    if (e.shiftKey) return null;            // Shift+letter is not ours
    key = key.toLowerCase();               // Caps Lock
  }
  const id = BY_KEY.get(key) ?? null;
  if (!id) return null;
  if (id === 'help') return id;             // `?` works in every view and over dialogs
  if (context.dialogOpen) return null;
  if (key === '/') return null;             // search.js owns `/`
  if (MAP_ONLY.has(id) && (context.mapFocused || (context.view && context.view !== 'map'))) return null;
  return id;
}

/** The neighbouring layer key in the same category (wraps), or null. */
export function adjacentLayer(groups, current, dir) {
  for (const list of groups) {
    const i = list.indexOf(current);
    if (i < 0) continue;
    if (list.length < 2) return null;
    return list[(i + dir + list.length) % list.length];
  }
  return null;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kbd = keys => keys.map(k => `<kbd>${esc(k)}</kbd>`).join(' ');

/** The help dialog body: one table per group. */
export function shortcutsHelpHtml() {
  const rows = [...SHORTCUTS, ...OTHER_KEYS];
  const groups = [...new Set(rows.map(r => r.group))];
  return groups.map(g => `
    <section class="shortcuts-group" aria-labelledby="shortcuts-g-${esc(g)}">
      <h3 id="shortcuts-g-${esc(g)}">${esc(g)}</h3>
      <table class="shortcuts-table"><tbody>${rows.filter(r => r.group === g).map(r => `
        <tr><th scope="row">${kbd(r.keys)}</th><td>${esc(r.label)}</td></tr>`).join('')}
      </tbody></table>
    </section>`).join('');
}

// ── DOM wiring ───────────────────────────────────────────────────────────────

const visible = el => !!el && !el.hidden && (typeof el.getClientRects !== 'function' || el.getClientRects().length > 0);

/** True when a modal dialog (aria-modal) is on screen. */
export function isDialogOpen(doc = globalThis.document) {
  return [...doc.querySelectorAll('[aria-modal="true"]')].some(visible);
}

function currentView(doc) {
  return doc.querySelector('.view-opt[aria-selected="true"]')?.dataset.view ?? 'map';
}

let help = null;   // { modal, dialog, returnFocus }

function trapFocus(e, doc) {
  const focusables = [...help.dialog.querySelectorAll('button, [tabindex]:not([tabindex="-1"])')].filter(visible);
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && (doc.activeElement === first || !help.dialog.contains(doc.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
}

function buildHelp(doc) {
  const modal = doc.createElement('div');
  modal.id = 'shortcuts-modal';
  modal.className = 'search-modal shortcuts-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="search-backdrop" data-shortcuts-close></div>
    <div class="search-dialog shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <header class="explain-head">
        <h2 id="shortcuts-title">Sneltoetsen</h2>
        <button class="search-close" type="button" data-shortcuts-close aria-label="Sluiten">Esc</button>
      </header>
      <div class="shortcuts-body" tabindex="0" aria-label="Lijst met sneltoetsen">${shortcutsHelpHtml()}
        <p class="wiz-hint">Sneltoetsen werken niet terwijl je in een tekstveld typt, en in een open venster werkt alleen <kbd>?</kbd> en <kbd>Esc</kbd>.</p>
      </div>
    </div>`;
  doc.body.appendChild(modal);
  help = { modal, dialog: modal.querySelector('.shortcuts-dialog'), returnFocus: null };
  modal.addEventListener('click', e => { if (e.target.closest?.('[data-shortcuts-close]')) closeShortcutsHelp(); });
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); closeShortcutsHelp(); return; }
    if (e.key === 'Tab') trapFocus(e, doc);
  });
}

export function openShortcutsHelp({ trigger = null, doc = globalThis.document } = {}) {
  if (!help) buildHelp(doc);
  if (!help.modal.hidden) return;
  help.returnFocus = trigger ?? doc.activeElement;
  help.modal.hidden = false;
  help.dialog.querySelector('.search-close')?.focus();
}

export function closeShortcutsHelp() {
  if (!help || help.modal.hidden) return;
  help.modal.hidden = true;
  const back = help.returnFocus;
  help.returnFocus = null;
  if (back && typeof back.focus === 'function' && back.isConnected !== false) back.focus();
}

function click(doc, sel) {
  const el = doc.querySelector(sel);
  if (!el || el.disabled) return false;
  el.click();
  return true;
}

function stepLayer(doc, dir) {
  const scope = doc.querySelector('.scope-select')?.value;
  const inScope = b => !b.dataset.scope || b.dataset.scope === scope;
  const groups = [...doc.querySelectorAll('.layer-group')]
    .filter(g => !g.dataset.scope || g.dataset.scope === scope)
    .map(g => [...g.querySelectorAll('.layer-opt')].filter(inScope).map(b => b.dataset.dataset));
  const current = doc.querySelector('.layer-opt.active')?.dataset.dataset;
  const next = adjacentLayer(groups, current, dir);
  if (!next) return false;
  doc.querySelector(`.layer-opt[data-dataset="${next}"]`)?.click();
  return true;
}

/** Runs a shortcut; returns true when it did something (the key is then consumed). */
export function runShortcut(id, doc = globalThis.document) {
  switch (id) {
    case 'view-map':       return click(doc, '.view-opt[data-view="map"]');
    case 'view-dashboard': return click(doc, '.view-opt[data-view="dashboard"]');
    case 'view-list':      return click(doc, '.view-opt[data-view="list"]');
    case 'search':         return click(doc, '.search-btn');
    case 'wizard':         return click(doc, '.wizard-btn');
    case 'share':          return click(doc, '.share-btn');
    case 'explain':        return click(doc, '.explain-btn');
    case 'compare':        return click(doc, '.panel-toggle-btn');
    case 'theme':          return click(doc, 'input[name="settings-theme"]:not(:checked)');   // Instellingen radio (settings.js)
    case 'zoom-in':        return click(doc, '.leaflet-control-zoom-in');
    case 'zoom-out':       return click(doc, '.leaflet-control-zoom-out');
    case 'layer-prev':     return stepLayer(doc, -1);
    case 'layer-next':     return stepLayer(doc, 1);
    case 'help':           help && !help.modal.hidden ? closeShortcutsHelp() : openShortcutsHelp({ doc }); return true;
    case 'menu': {
      const btn = doc.querySelector('.nav-menu-btn');
      if (!btn) return false;
      btn.click();
      if (btn.getAttribute('aria-expanded') === 'true') [...doc.querySelectorAll('#nav-menu-list .nav-menu-item')].find(visible)?.focus();
      return true;
    }
    case 'layers': {
      const btn = doc.querySelector('.layers-btn');
      if (!btn) return false;
      btn.click();
      if (btn.getAttribute('aria-expanded') === 'true') {
        (doc.querySelector('.layer-opt.active') ?? [...doc.querySelectorAll('.layer-opt')].find(visible))?.focus();
      }
      return true;
    }
    case 'scope': {
      const sel = doc.querySelector('.scope-select');
      if (!sel) return false;
      sel.value = sel.value === 'rotterdam' ? 'nederland' : 'rotterdam';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    default: return false;
  }
}

/** "Naar de inhoud": focus the map, or the open dashboard / ranglijst. */
function skipToContent(doc) {
  const view = currentView(doc);
  const target = view === 'map' ? doc.getElementById('map') : doc.getElementById(`view-${view}`);
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus();
}

export function initShortcuts(doc = globalThis.document) {
  for (const s of SHORTCUTS) {
    if (!s.selector || !s.aria) continue;
    for (const el of doc.querySelectorAll(s.selector)) el.setAttribute('aria-keyshortcuts', s.aria);
  }
  doc.querySelector('.shortcuts-btn')?.addEventListener('click', e => openShortcutsHelp({ trigger: e.currentTarget, doc }));
  doc.querySelector('.skip-link')?.addEventListener('click', e => { e.preventDefault(); skipToContent(doc); });
  doc.addEventListener('keydown', e => {
    const map = doc.getElementById('map');
    const id = shortcutFor(e, {
      dialogOpen: isDialogOpen(doc),
      mapFocused: !!map && map.contains(e.target),
      view: currentView(doc),
    });
    if (id && runShortcut(id, doc)) e.preventDefault();
  });
}
