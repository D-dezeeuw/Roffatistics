// ── Instellingen (header cog): thema, kaart, OV-lijnen ───────────────────────
// One dialog for the look of the app. The owners stay the source of truth:
// theme.js (data-theme, key roffatistics.theme), map.js (basemap, key
// roffatistics.basemap) and ov.js (Metro / Tram / Bus, key roffatistics.ov).
// This module only reads and writes through them. Settings are per device
// (localStorage, every access in try/catch) and are not part of the share
// link, except theme and basemap, which "Delen" already offered.
// Pure parts (load/save/defaults, option lists, markup) are unit-tested.

import { THEMES, DEFAULT_THEME, THEME_STORAGE_KEY, pickInitialTheme, resolveTheme } from './theme.js';
import { BASEMAPS, DEFAULT_BASEMAP, BASEMAP_STORAGE_KEY, pickInitialBasemap, resolveBasemap } from './map.js';
import { OV_MODES, DEFAULT_OV, OV_STORAGE_KEY, pickInitialOv, serializeOvState } from './ov.js';

export const SETTINGS_DEFAULTS = Object.freeze({ theme: DEFAULT_THEME, basemap: DEFAULT_BASEMAP, ov: DEFAULT_OV });
export const SETTINGS_KEYS = Object.freeze({ theme: THEME_STORAGE_KEY, basemap: BASEMAP_STORAGE_KEY, ov: OV_STORAGE_KEY });

export const THEME_OPTIONS = Object.freeze(Object.values(THEMES).map(t => Object.freeze({ id: t.id, label: t.label })));
export const BASEMAP_OPTIONS = Object.freeze(Object.values(BASEMAPS).map(b => Object.freeze({ id: b.id, label: b.label })));
export const OV_OPTIONS = Object.freeze(Object.values(OV_MODES).map(m => Object.freeze({ id: m.id, label: m.label, hint: m.hint ?? '' })));

/** Normalises any input to { theme, basemap, ov:{metro,tram,bus} }; unknown values fall back to the defaults. */
export function normalizeSettings(s = {}) {
  return {
    theme: resolveTheme(s?.theme).id,
    basemap: resolveBasemap(s?.basemap).id,
    ov: Object.fromEntries(Object.keys(OV_MODES).map(k => [k, s?.ov ? !!s.ov[k] : DEFAULT_OV[k]])),
  };
}

/** The stored settings; a missing or blocked storage gives the defaults. */
export function loadSettings(storage) {
  return { theme: pickInitialTheme(storage), basemap: pickInitialBasemap(storage), ov: pickInitialOv(storage) };
}

/** Stores the settings under the owners' keys; returns the normalised settings. Never throws. */
export function saveSettings(settings, storage) {
  const s = normalizeSettings(settings);
  const put = (k, v) => { try { storage?.setItem(k, v); } catch { /* storage blocked */ } };
  put(THEME_STORAGE_KEY, s.theme);
  put(BASEMAP_STORAGE_KEY, s.basemap);
  put(OV_STORAGE_KEY, serializeOvState(s.ov));
  return s;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function radios(name, options, current) {
  return options.map(o => `<label class="settings-opt"><input type="radio" name="${name}" value="${esc(o.id)}"${o.id === current ? ' checked' : ''}><span>${esc(o.label)}</span></label>`).join('');
}

/** The dialog markup (backdrop + role=dialog), with `settings` checked. */
export function settingsDialogHtml(settings = SETTINGS_DEFAULTS) {
  const s = normalizeSettings(settings);
  const ov = OV_OPTIONS.map(o => `<label class="settings-opt settings-check"${o.hint ? ` title="${esc(o.label)} (${esc(o.hint)})"` : ''}><input type="checkbox" name="settings-ov" value="${esc(o.id)}"${s.ov[o.id] ? ' checked' : ''}><span class="ov-swatch ov-swatch-${esc(o.id)}" aria-hidden="true"></span><span>${esc(o.label)}</span></label>`).join('');
  return `
    <div class="search-backdrop" data-settings-close></div>
    <div class="search-dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="explain-head">
        <h2 id="settings-title">Instellingen</h2>
        <button class="search-close" type="button" data-settings-close aria-label="Sluiten">Esc</button>
      </header>
      <div class="settings-body">
        <fieldset class="settings-group"><legend>Thema</legend><div class="settings-opts">${radios('settings-theme', THEME_OPTIONS, s.theme)}</div></fieldset>
        <fieldset class="settings-group"><legend>Kaart</legend><div class="settings-opts">${radios('settings-basemap', BASEMAP_OPTIONS, s.basemap)}</div>
          <p class="settings-note">Satelliet: luchtfoto van PDOK, alleen Nederland.</p></fieldset>
        <fieldset class="settings-group"><legend>OV-lijnen</legend><div class="settings-opts">${ov}</div>
          <p class="settings-note">Bus alleen in de regio Rotterdam. Lijnen &copy; OpenStreetMap-bijdragers.</p></fieldset>
      </div>
    </div>`;
}

/** Reads the dialog's inputs back into settings. */
export function readSettingsForm(root) {
  const val = name => root.querySelector(`input[name="${name}"]:checked`)?.value;
  const on = new Set([...root.querySelectorAll('input[name="settings-ov"]:checked')].map(i => i.value));
  return normalizeSettings({
    theme: val('settings-theme'),
    basemap: val('settings-basemap'),
    ov: Object.fromEntries(Object.keys(OV_MODES).map(k => [k, on.has(k)])),
  });
}

/** Sets the dialog's inputs to `settings`. */
export function writeSettingsForm(root, settings) {
  const s = normalizeSettings(settings);
  for (const i of root.querySelectorAll('input[name="settings-theme"]')) i.checked = i.value === s.theme;
  for (const i of root.querySelectorAll('input[name="settings-basemap"]')) i.checked = i.value === s.basemap;
  for (const i of root.querySelectorAll('input[name="settings-ov"]')) i.checked = !!s.ov[i.value];
}

// ── Dialog logic ──────────────────────────────────────────────────────────────

/**
 * modal: the overlay; dialog: the role=dialog box. current() gives the live
 * settings (synced into the form on open); apply(changed, settings) is called
 * on every change with the changed group ('theme' | 'basemap' | 'ov').
 * Returns { open(), close(), isOpen() }.
 */
export function createSettingsDialog({ modal, dialog, current, apply, doc = globalThis.document }) {
  let returnFocus = null;
  const isOpen = () => !modal.hidden;

  function open() {
    if (isOpen()) return;
    returnFocus = doc.activeElement;
    writeSettingsForm(dialog, current());
    modal.hidden = false;
    doc.body?.classList?.add('settings-open');
    (dialog.querySelector('input:checked') ?? dialog.querySelector('input'))?.focus();
  }

  function close() {
    if (!isOpen()) return;
    modal.hidden = true;
    doc.body?.classList?.remove('settings-open');
    if (returnFocus && typeof returnFocus.focus === 'function' && returnFocus.isConnected !== false) returnFocus.focus();
    returnFocus = null;
  }

  function trapFocus(e) {
    // One stop per radio group (the checked one), like the browser's own tab order.
    const focusables = [...dialog.querySelectorAll('button, input')]
      .filter(el => !el.disabled && !(el.type === 'radio' && !el.checked));
    if (!focusables.length) return;
    const first = focusables[0], last = focusables.at(-1);
    if (e.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  modal.addEventListener('click', e => { if (e.target?.closest?.('[data-settings-close]')) close(); });
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') { e.stopPropagation(); trapFocus(e); }
  });
  dialog.addEventListener('change', e => {
    const name = e.target?.name;
    const group = name === 'settings-theme' ? 'theme' : name === 'settings-basemap' ? 'basemap' : name === 'settings-ov' ? 'ov' : null;
    if (group) apply(group, readSettingsForm(dialog));
  });

  return { open, close, isOpen };
}

/**
 * Builds the dialog and binds every `.settings-btn`. The hooks do the work:
 * setTheme(id), setBasemap(id), setOv({metro,tram,bus}); getBasemap() and
 * getOv() give the live state (the basemap can fall back to Satelliet without WebGL).
 */
export function initSettings({ setTheme, setBasemap, setOv, getBasemap, getOv, doc = globalThis.document } = {}) {
  let storage = null;
  try { storage = globalThis.localStorage ?? null; } catch { storage = null; }
  const live = () => normalizeSettings({
    ...loadSettings(storage),
    theme: doc.documentElement?.dataset?.theme,
    ...(getBasemap?.() ? { basemap: getBasemap() } : {}),
    ...(getOv ? { ov: getOv() } : {}),
  });

  const modal = doc.createElement('div');
  modal.id = 'settings-modal';
  modal.className = 'search-modal settings-modal';
  modal.hidden = true;
  modal.innerHTML = settingsDialogHtml(live());
  doc.body.appendChild(modal);

  const api = createSettingsDialog({
    modal,
    dialog: modal.querySelector('.settings-dialog'),
    current: live,
    apply(group, s) {
      if (group === 'theme') setTheme?.(s.theme);
      else if (group === 'basemap') setBasemap?.(s.basemap);
      else if (group === 'ov') setOv?.(s.ov);
    },
    doc,
  });
  for (const btn of doc.querySelectorAll('.settings-btn')) btn.addEventListener('click', () => api.open());
  return api;
}
