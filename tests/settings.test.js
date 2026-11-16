// Instellingen (v0.43.0): load/save/defaults, option lists, basemap mapping, dialog markup and logic.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_DEFAULTS, SETTINGS_KEYS, THEME_OPTIONS, BASEMAP_OPTIONS, OV_OPTIONS,
  normalizeSettings, loadSettings, saveSettings, settingsDialogHtml, readSettingsForm, writeSettingsForm, createSettingsDialog,
} from '../modules/settings.js';
import { BASEMAPS, resolveBasemap, createBasemapLayer } from '../modules/map.js';
import { THEME_STORAGE_KEY } from '../modules/theme.js';
import { BASEMAP_STORAGE_KEY } from '../modules/map.js';
import { OV_STORAGE_KEY } from '../modules/ov.js';
import { SCHOOL_PINS_STORAGE_KEY } from '../modules/school-pins.js';

const memStorage = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

describe('settings: defaults, load, save', () => {
  it('defaults: Rotterdam theme, dark map, all OV lines off, no school pins', () => {
    assert.deepEqual(normalizeSettings(SETTINGS_DEFAULTS), { theme: 'rotterdam', basemap: 'dark', palette: 'auto', ov: { metro: false, tram: false, bus: false }, schools: false });
    assert.deepEqual(loadSettings(memStorage()), normalizeSettings(SETTINGS_DEFAULTS));
    assert.deepEqual(loadSettings(null), normalizeSettings(SETTINGS_DEFAULTS));
  });
  it('uses the owners’ storage keys (theme, basemap, ov)', () => {
    assert.deepEqual({ ...SETTINGS_KEYS }, { theme: THEME_STORAGE_KEY, basemap: BASEMAP_STORAGE_KEY, palette: 'roffatistics.mapPalette', ov: OV_STORAGE_KEY, schools: SCHOOL_PINS_STORAGE_KEY });
  });
  it('round-trips through storage', () => {
    const st = memStorage();
    const s = saveSettings({ theme: 'klassiek', basemap: 'aerial', ov: { metro: true, bus: true }, schools: true }, st);
    assert.deepEqual(s, { theme: 'klassiek', basemap: 'aerial', palette: 'auto', ov: { metro: true, tram: false, bus: true }, schools: true });
    assert.equal(st.m.get(OV_STORAGE_KEY), 'metro,bus');
    assert.equal(st.m.get(SCHOOL_PINS_STORAGE_KEY), '1');
    assert.deepEqual(loadSettings(st), s);
    saveSettings({ ov: {} }, st);
    assert.equal(st.m.get(OV_STORAGE_KEY), '', 'all off is stored as ""');
    assert.deepEqual(loadSettings(st).ov, { metro: false, tram: false, bus: false });
    assert.equal(st.m.get(SCHOOL_PINS_STORAGE_KEY), '0');
    assert.equal(loadSettings(st).schools, false);
  });
  it('unknown values fall back to the defaults', () => {
    assert.deepEqual(normalizeSettings({ theme: 'neon', basemap: 'osm', ov: { ferry: true }, schools: 'ja' }),
      { theme: 'rotterdam', basemap: 'dark', palette: 'auto', ov: { metro: false, tram: false, bus: false }, schools: false });
    assert.deepEqual(normalizeSettings(null), normalizeSettings(SETTINGS_DEFAULTS));
  });
  it('works without storage (blocked or missing): never throws, gives the defaults', () => {
    assert.deepEqual(loadSettings(boom), normalizeSettings(SETTINGS_DEFAULTS));
    assert.doesNotThrow(() => saveSettings({ theme: 'klassiek' }, boom));
    assert.doesNotThrow(() => saveSettings({ theme: 'klassiek' }, undefined));
  });
});

describe('settings: options and basemap mapping', () => {
  it('Thema: Rotterdam / Paars-oranje', () => {
    assert.deepEqual(THEME_OPTIONS.map(o => [o.id, o.label]), [['rotterdam', 'Rotterdam'], ['klassiek', 'Paars-oranje']]);
  });
  it('Kaart: Donker / Licht / Satelliet', () => {
    assert.deepEqual(BASEMAP_OPTIONS.map(o => [o.id, o.label]), [['dark', 'Donker'], ['light', 'Licht'], ['aerial', 'Satelliet']]);
    assert.equal(resolveBasemap('dark').style, 'https://tiles.openfreemap.org/styles/dark');
    assert.equal(resolveBasemap('light').style, 'https://tiles.openfreemap.org/styles/positron');
  });
  it('Satelliet is the PDOK Luchtfoto WMTS raster with its attribution', () => {
    const sat = BASEMAPS.aerial;
    assert.equal(sat.type, 'raster');
    assert.equal(sat.url, 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg');
    assert.match(sat.attribution, /^Luchtfoto &copy; <a [^>]*>PDOK<\/a> \/ Beeldmateriaal Nederland$/);
    const fakeL = { tileLayer: (url, opts) => ({ url, opts }) };
    const layer = createBasemapLayer(fakeL, sat);
    assert.equal(layer.url, sat.url);
    assert.match(layer.opts.attribution, /PDOK/);
  });
  it('OV: Metro, Tram, Bus', () => {
    assert.deepEqual(OV_OPTIONS.map(o => o.label), ['Metro', 'Tram', 'Bus']);
  });
});

// Tiny fake DOM built from the real markup: inputs with name/value/checked.
function fakeDialog(html) {
  const inputs = [...html.matchAll(/<input type="(radio|checkbox)" name="([^"]+)" value="([^"]+)"( checked)?>/g)]
    .map(([, type, name, value, checked]) => ({ type, name, value, checked: !!checked, disabled: false, focus() { doc.activeElement = this; } }));
  const close = { type: 'button', disabled: false, focus() { doc.activeElement = this; } };
  const doc = { activeElement: null, body: null };
  const listeners = {};
  const match = (sel, i) => {
    if (sel === 'input:checked') return i.checked;
    if (sel === 'input') return true;
    const m = sel.match(/^input\[name="([^"]+)"\](:checked)?$/);
    return !!m && i.name === m[1] && (!m[2] || i.checked);
  };
  const dialog = {
    querySelectorAll: sel => (sel === 'button, input' ? [close, ...inputs] : inputs.filter(i => match(sel, i))),
    querySelector: sel => inputs.find(i => match(sel, i)) ?? null,
    contains: el => el === close || inputs.includes(el),
    addEventListener: (t, fn) => (listeners['d' + t] = fn),
  };
  const modal = { hidden: true, addEventListener: (t, fn) => (listeners['m' + t] = fn) };
  return { inputs, close, doc, dialog, modal, listeners };
}

describe('settings: dialog', () => {
  it('markup: radios for Thema and Kaart, checkboxes for OV, reuses the modal shell', () => {
    const html = settingsDialogHtml({ theme: 'klassiek', basemap: 'aerial', ov: { tram: true } });
    assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="settings-title"/);
    assert.match(html, /class="search-dialog settings-dialog"/);
    assert.match(html, /<h2 id="settings-title">Instellingen<\/h2>/);
    for (const l of ['Thema', 'Kaart', 'OV-lijnen', 'Onderwijs']) assert.match(html, new RegExp(`<legend>${l}</legend>`));
    assert.match(html, /name="settings-theme" value="klassiek" checked/);
    assert.match(html, /name="settings-basemap" value="aerial" checked/);
    assert.match(html, /type="checkbox" name="settings-ov" value="tram" checked/);
    assert.doesNotMatch(html, /value="metro" checked/);
    assert.match(html, /type="checkbox" name="settings-schools" value="on">/);
    assert.match(html, />Basisscholen</);
    assert.match(settingsDialogHtml({ schools: true }), /name="settings-schools" value="on" checked/);
    assert.match(html, />Satelliet</);
    assert.match(html, />Paars-oranje</);
    assert.match(html, /<legend>Kaartkleuren<\/legend>/);
    assert.match(html, /name="settings-palette" value="auto" checked><span>Volgt thema</);
    for (const l of ['Rotterdam', 'Paars-oranje', 'Kleurenblind-veilig']) assert.match(html, new RegExp(`name="settings-palette" value="[a-z]+"><span>${l}<`));
    assert.match(settingsDialogHtml({ palette: 'kleurenblind' }), /name="settings-palette" value="kleurenblind" checked/);
  });
  it('Kaartkleuren: stored under its own key, unknown → Volgt thema', () => {
    const st = memStorage();
    saveSettings({ palette: 'kleurenblind' }, st);
    assert.equal(st.m.get('roffatistics.mapPalette'), 'kleurenblind');
    assert.equal(loadSettings(st).palette, 'kleurenblind');
    assert.equal(normalizeSettings({ palette: 'regenboog' }).palette, 'auto');
  });
  it('read/write the form', () => {
    const f = fakeDialog(settingsDialogHtml(SETTINGS_DEFAULTS));
    assert.deepEqual(readSettingsForm(f.dialog), normalizeSettings(SETTINGS_DEFAULTS));
    writeSettingsForm(f.dialog, { theme: 'klassiek', basemap: 'light', ov: { metro: true, bus: true }, schools: true });
    assert.deepEqual(readSettingsForm(f.dialog), { theme: 'klassiek', basemap: 'light', palette: 'auto', ov: { metro: true, tram: false, bus: true }, schools: true });
  });
  it('opens with the live state, applies each change to its group, Esc closes and returns focus', () => {
    const f = fakeDialog(settingsDialogHtml(SETTINGS_DEFAULTS));
    const trigger = { focus() { f.doc.activeElement = this; } };
    f.doc.activeElement = trigger;
    const applied = [];
    const api = createSettingsDialog({
      modal: f.modal, dialog: f.dialog, doc: f.doc,
      current: () => ({ theme: 'rotterdam', basemap: 'aerial', ov: { metro: true } }),   // e.g. fallback to Satelliet
      apply: (group, s) => applied.push([group, s]),
    });
    api.open();
    assert.equal(api.isOpen(), true);
    assert.equal(f.inputs.find(i => i.value === 'aerial').checked, true, 'synced on open');
    assert.equal(f.doc.activeElement.checked, true, 'focus on a checked option');
    const bus = f.inputs.find(i => i.value === 'bus');
    bus.checked = true;
    f.listeners.dchange({ target: bus });
    assert.deepEqual(applied.at(-1), ['ov', { theme: 'rotterdam', basemap: 'aerial', palette: 'auto', ov: { metro: true, tram: false, bus: true }, schools: false }]);
    const sch = f.inputs.find(i => i.name === 'settings-schools');
    sch.checked = true;
    f.listeners.dchange({ target: sch });
    assert.deepEqual(applied.at(-1).slice(0, 1), ['schools']);
    assert.equal(applied.at(-1)[1].schools, true);
    const light = f.inputs.find(i => i.value === 'light');
    f.inputs.filter(i => i.name === 'settings-basemap').forEach(i => (i.checked = i === light));
    f.listeners.dchange({ target: light });
    assert.equal(applied.at(-1)[0], 'basemap');
    assert.equal(applied.at(-1)[1].basemap, 'light');
    const cvd = f.inputs.find(i => i.name === 'settings-palette' && i.value === 'kleurenblind');
    f.inputs.filter(i => i.name === 'settings-palette').forEach(i => (i.checked = i === cvd));
    f.listeners.dchange({ target: cvd });
    assert.deepEqual([applied.at(-1)[0], applied.at(-1)[1].palette], ['palette', 'kleurenblind']);
    const ev = { key: 'Escape', preventDefault() {}, stopPropagation() {} };
    f.listeners.mkeydown(ev);
    assert.equal(api.isOpen(), false);
    assert.equal(f.doc.activeElement, trigger);
  });
  it('backdrop and close button close it', () => {
    const f = fakeDialog(settingsDialogHtml(SETTINGS_DEFAULTS));
    const api = createSettingsDialog({ modal: f.modal, dialog: f.dialog, doc: f.doc, current: () => SETTINGS_DEFAULTS, apply() {} });
    api.open();
    f.listeners.mclick({ target: { closest: s => (s === '[data-settings-close]' ? {} : null) } });
    assert.equal(api.isOpen(), false);
  });
});
