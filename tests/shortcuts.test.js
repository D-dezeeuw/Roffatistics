import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutFor, isTypingTarget, adjacentLayer, runShortcut, shortcutsHelpHtml, SHORTCUTS, isDialogOpen } from '../modules/shortcuts.js';
import { GENERAL_SECTIONS } from '../modules/explain.js';

const ev = (key, extra = {}) => ({ key, target: { tagName: 'BODY' }, ...extra });
const ctx = { dialogOpen: false, mapFocused: false, view: 'map' };

describe('shortcutFor', () => {
  it('maps the documented keys', () => {
    const want = { 1: 'view-map', 2: 'view-dashboard', 3: 'view-list', s: 'search', w: 'wizard', d: 'share', u: 'explain',
      m: 'menu', l: 'layers', n: 'scope', t: 'theme', v: 'compare', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out',
      '[': 'layer-prev', ']': 'layer-next', '?': 'help' };
    for (const [k, id] of Object.entries(want)) assert.equal(shortcutFor(ev(k), ctx), id, k);
  });
  it('accepts Caps Lock letters and `?` with Shift, but no Shift+letter', () => {
    assert.equal(shortcutFor(ev('W'), ctx), 'wizard');
    assert.equal(shortcutFor(ev('?', { shiftKey: true }), ctx), 'help');
    assert.equal(shortcutFor(ev('+', { shiftKey: true }), ctx), 'zoom-in');
    assert.equal(shortcutFor(ev('W', { shiftKey: true }), ctx), null);
  });
  it('ignores unknown keys, Esc, `/` (search.js) and modifier combos', () => {
    for (const k of ['x', 'Escape', 'Enter', ' ', '/', 'ArrowUp']) assert.equal(shortcutFor(ev(k), ctx), null, k);
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
      assert.equal(shortcutFor(ev('k', { [mod]: true }), ctx), null, mod);
      assert.equal(shortcutFor(ev('?', { [mod]: true }), ctx), null, mod);
    }
    assert.equal(shortcutFor(ev('s', { repeat: true }), ctx), null);
    assert.equal(shortcutFor(ev('s', { defaultPrevented: true }), ctx), null);
  });
  it('ignores keys while typing', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
      assert.equal(shortcutFor(ev('s', { target: { tagName } }), ctx), null, tagName);
      assert.equal(shortcutFor(ev('?', { target: { tagName } }), ctx), null, tagName);
    }
    assert.equal(shortcutFor(ev('1', { target: { tagName: 'DIV', isContentEditable: true } }), ctx), null);
    assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
    assert.equal(shortcutFor(ev('1', { target: { tagName: 'BUTTON' } }), ctx), 'view-map');
  });
  it('only `?` works while a dialog is open', () => {
    const open = { ...ctx, dialogOpen: true };
    for (const k of ['1', 's', 'w', 'd', 'm', '+', ']', 'n']) assert.equal(shortcutFor(ev(k), open), null, k);
    assert.equal(shortcutFor(ev('?'), open), 'help');
    assert.equal(shortcutFor(ev('Escape'), open), null);
  });
  it('`?` works in every view and on the focused map', () => {
    for (const view of ['map', 'dashboard', 'list']) assert.equal(shortcutFor(ev('?'), { ...ctx, view }), 'help', view);
    assert.equal(shortcutFor(ev('?'), { ...ctx, mapFocused: true }), 'help');
  });
  it('leaves +/- to Leaflet on the focused map and off the map view', () => {
    assert.equal(shortcutFor(ev('+'), { ...ctx, mapFocused: true }), null);
    assert.equal(shortcutFor(ev('-'), { ...ctx, view: 'list' }), null);
    assert.equal(shortcutFor(ev('2'), { ...ctx, mapFocused: true }), 'view-dashboard');
  });
  it('has one id per key', () => {
    const keys = SHORTCUTS.flatMap(s => s.keys);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe('adjacentLayer', () => {
  const groups = [['a', 'b', 'c'], ['x'], ['p', 'q']];
  it('steps within the category and wraps', () => {
    assert.equal(adjacentLayer(groups, 'b', 1), 'c');
    assert.equal(adjacentLayer(groups, 'c', 1), 'a');
    assert.equal(adjacentLayer(groups, 'a', -1), 'c');
    assert.equal(adjacentLayer(groups, 'q', -1), 'p');
  });
  it('null for a lone layer or an unknown one', () => {
    assert.equal(adjacentLayer(groups, 'x', 1), null);
    assert.equal(adjacentLayer(groups, 'zz', 1), null);
  });
});

function fakeDoc(els) {
  return {
    querySelector: sel => els[sel] ?? null,
    querySelectorAll: sel => (els[sel] ? [].concat(els[sel]) : []),
  };
}

describe('runShortcut', () => {
  it('clicks the button that owns the action', () => {
    const clicked = [];
    const btn = name => ({ click: () => clicked.push(name) });
    const doc = fakeDoc({ '.share-btn': btn('share'), '.panel-toggle-btn': btn('compare'), '.view-opt[data-view="list"]': btn('list') });
    assert.equal(runShortcut('share', doc), true);
    assert.equal(runShortcut('compare', doc), true);
    assert.equal(runShortcut('view-list', doc), true);
    assert.equal(runShortcut('wizard', doc), false);   // no button: key not consumed
    assert.deepEqual(clicked, ['share', 'compare', 'list']);
  });
});

describe('isDialogOpen', () => {
  it('counts only visible aria-modal dialogs', () => {
    const shown = { hidden: false, getClientRects: () => [1] };
    const gone = { hidden: false, getClientRects: () => [] };
    assert.equal(isDialogOpen(fakeDoc({ '[aria-modal="true"]': [gone] })), false);
    assert.equal(isDialogOpen(fakeDoc({ '[aria-modal="true"]': [gone, shown] })), true);
  });
});

describe('help text', () => {
  it('lists every shortcut and is mentioned in Uitleg', () => {
    const html = shortcutsHelpHtml();
    for (const s of SHORTCUTS) assert.ok(html.includes(s.label), s.id);
    assert.ok(html.includes('<kbd>?</kbd>'));
    assert.ok(GENERAL_SECTIONS.some(s => s.id === 'sneltoetsen'));
  });
});
