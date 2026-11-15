import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APP_VERSION, LEGAL_SECTIONS, APP_STORAGE_PREFIX, parseLegalHash, clearAppData,
  createLegalDialog, legalDialogHtml, legalLinksHtml,
} from '../modules/legal.js';
import { SPLASH_STORAGE_KEY } from '../modules/splash.js';
import { THEME_STORAGE_KEY } from '../modules/theme.js';
import { SCOPE_STORAGE_KEY, CRIME_STORAGE_KEY, LIST_VIEW_STORAGE_KEY, SCORE_STORAGE_KEY } from '../modules/state.js';
import { BASEMAP_STORAGE_KEY } from '../modules/map.js';
import { SCALE_STORAGE_KEY } from '../modules/scale.js';
import { RANK_MODE_STORAGE_KEY } from '../modules/list.js';
import { LEGEND_COLLAPSED_KEY } from '../modules/legend.js';
import { RECENT_KEY } from '../modules/search.js';
import { ANSWERS_STORAGE_KEY } from '../modules/wizard-model.js';

function fakeStorage(entries) {
  const m = new Map(Object.entries(entries));
  return {
    get length() { return m.size; },
    key: i => [...m.keys()][i] ?? null,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    keys: () => [...m.keys()],
  };
}

function fakeEl(doc, attrs = {}) {
  const e = { attrs: { ...attrs }, hidden: false, listeners: {} };
  e.getAttribute = k => e.attrs[k] ?? null;
  e.setAttribute = (k, v) => (e.attrs[k] = String(v));
  e.addEventListener = (t, fn) => ((e.listeners[t] ||= []).push(fn));
  e.fire = (t, ev) => (e.listeners[t] || []).forEach(fn => fn(ev));
  e.focus = () => (doc.activeElement = e);
  e.closest = sel => {
    const m = /^\[([a-z-]+)\]$/.exec(sel);
    return m && m[1] in e.attrs ? e : null;
  };
  return e;
}

function setup() {
  const classes = new Set();
  const doc = { activeElement: null, body: { classList: { add: c => classes.add(c), remove: c => classes.delete(c) } }, contains: () => true };
  const opener = fakeEl(doc);
  const modal = fakeEl(doc); modal.hidden = true;
  const tabs = LEGAL_SECTIONS.map(s => fakeEl(doc, { 'data-legal-tab': s }));
  const panels = LEGAL_SECTIONS.map(s => fakeEl(doc, { 'data-legal-panel': s }));
  const close = fakeEl(doc, { 'data-legal-close': '' });
  const dialog = { querySelectorAll: () => [...tabs, close], contains: () => true };
  const api = createLegalDialog({ modal, dialog, tabs, panels, doc });
  return { doc, opener, modal, tabs, panels, close, api, classes };
}
const visible = panels => panels.filter(p => !p.hidden).map(p => p.getAttribute('data-legal-panel'));

describe('legal dialog', () => {
  it('opens at the asked section, shows one panel and focuses its tab', () => {
    const { doc, opener, modal, tabs, panels, api, classes } = setup();
    opener.focus();
    api.open('colofon');
    assert.equal(modal.hidden, false);
    assert.ok(classes.has('legal-open'));
    assert.deepEqual(visible(panels), ['colofon']);
    assert.equal(doc.activeElement, tabs[2]);
    assert.deepEqual(tabs.map(t => t.getAttribute('aria-selected')), ['false', 'false', 'true']);
    assert.deepEqual(tabs.map(t => t.getAttribute('tabindex')), ['-1', '-1', '0']);
  });

  it('switches section by tab click and arrow keys; unknown section falls back to privacy', () => {
    const { modal, tabs, panels, api } = setup();
    api.open('nonsense');
    assert.equal(api.current(), 'privacy');
    modal.fire('click', { target: tabs[1] });
    assert.deepEqual(visible(panels), ['disclaimer']);
    const key = k => modal.fire('keydown', { key: k, target: tabs[0], preventDefault() {}, stopPropagation() {} });
    key('ArrowRight'); assert.equal(api.current(), 'colofon');
    key('ArrowRight'); assert.equal(api.current(), 'privacy');
    key('ArrowLeft');  assert.equal(api.current(), 'colofon');
    key('Home');       assert.equal(api.current(), 'privacy');
    assert.deepEqual(visible(panels), ['privacy']);
  });

  it('Escape and the close button close it, stop propagation and return focus', () => {
    const { doc, opener, modal, close, api, classes } = setup();
    opener.focus();
    api.open('privacy');
    let stopped = false;
    modal.fire('keydown', { key: 'Escape', target: modal, preventDefault() {}, stopPropagation() { stopped = true; } });
    assert.equal(modal.hidden, true);
    assert.ok(stopped, 'the splash underneath must not see the Escape');
    assert.equal(doc.activeElement, opener);
    assert.ok(!classes.has('legal-open'));
    api.open('disclaimer');
    modal.fire('click', { target: close });
    assert.equal(api.isOpen(), false);
  });

  it('markup has three tabs and panels; the links row has three triggers', () => {
    const html = legalDialogHtml();
    for (const s of LEGAL_SECTIONS) {
      assert.match(html, new RegExp(`data-legal-tab="${s}"`));
      assert.match(html, new RegExp(`data-legal-panel="${s}"`));
      assert.match(legalLinksHtml(), new RegExp(`data-legal="${s}"`));
    }
    assert.match(html, /class="legal-clear"/);
    assert.match(html, new RegExp(`versie ${APP_VERSION.replace(/\./g, '\\.')}`));
  });

  it('parses #legal=<section> deep links only', () => {
    assert.equal(parseLegalHash('#legal=colofon'), 'colofon');
    assert.equal(parseLegalHash('#legal=Privacy'), 'privacy');
    assert.equal(parseLegalHash('#legal=x'), null);
    assert.equal(parseLegalHash('#scope=nl'), null);
    assert.equal(parseLegalHash(''), null);
  });

  it('APP_VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(APP_VERSION, pkg.version);
  });
});

describe('clearAppData', () => {
  it('every app storage key carries the prefix', () => {
    const keys = [SPLASH_STORAGE_KEY, THEME_STORAGE_KEY, SCOPE_STORAGE_KEY, CRIME_STORAGE_KEY, LIST_VIEW_STORAGE_KEY, SCORE_STORAGE_KEY,
      BASEMAP_STORAGE_KEY, SCALE_STORAGE_KEY, RANK_MODE_STORAGE_KEY, LEGEND_COLLAPSED_KEY, RECENT_KEY, ANSWERS_STORAGE_KEY];
    for (const k of keys) assert.ok(k.startsWith(APP_STORAGE_PREFIX), k);
  });

  it('removes only the app keys and cached data responses', () => {
    const local = fakeStorage({
      [THEME_STORAGE_KEY]: 'klassiek', [ANSWERS_STORAGE_KEY]: 'abc', [RECENT_KEY]: '[]', [SPLASH_STORAGE_KEY]: '1',
      'other-app.setting': 'keep', 'roffatisticsX': 'keep', 'theme': 'keep',
    });
    const session = fakeStorage({ 'https://opendata.cbs.nl/ODataApi/odata/x': '{}', 'other.cache': 'keep' });
    const removed = clearAppData({ local, session });
    assert.equal(removed.length, 5);
    assert.deepEqual(local.keys().sort(), ['other-app.setting', 'roffatisticsX', 'theme']);
    assert.deepEqual(session.keys(), ['other.cache']);
  });

  it('survives missing or blocked storage', () => {
    const blocked = { get length() { throw new Error('SecurityError'); } };
    assert.deepEqual(clearAppData({ local: null, session: blocked }), []);
  });
});
