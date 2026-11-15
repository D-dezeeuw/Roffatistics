import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  THEMES, DEFAULT_THEME, THEME_STORAGE_KEY, resolveTheme, pickInitialTheme, applyTheme,
} from '../modules/theme.js';

describe('THEMES', () => {
  it('offers Rotterdam (default) and Klassiek', () => {
    assert.deepEqual(Object.values(THEMES).map(t => t.label), ['Rotterdam', 'Klassiek']);
    assert.equal(DEFAULT_THEME, 'rotterdam');
  });
  it('resolves unknown ids to the default', () => {
    assert.equal(resolveTheme('klassiek').id, 'klassiek');
    assert.equal(resolveTheme('purple').id, 'rotterdam');
    assert.equal(resolveTheme(undefined).id, 'rotterdam');
  });
});

describe('pickInitialTheme', () => {
  it('returns the stored theme', () => {
    assert.equal(pickInitialTheme({ getItem: k => (k === THEME_STORAGE_KEY ? 'klassiek' : null) }), 'klassiek');
  });
  it('falls back to Rotterdam for new visitors, junk and blocked storage', () => {
    assert.equal(pickInitialTheme({ getItem: () => null }), 'rotterdam');
    assert.equal(pickInitialTheme({ getItem: () => 'neon' }), 'rotterdam');
    assert.equal(pickInitialTheme(null), 'rotterdam');
    assert.equal(pickInitialTheme({ getItem: () => { throw new Error('denied'); } }), 'rotterdam');
  });
});

describe('applyTheme', () => {
  it('sets data-theme and theme-color, and stores the choice', () => {
    const meta = { content: null, setAttribute(k, v) { this[k] = v; } };
    const doc = { documentElement: { dataset: {} }, querySelector: () => meta };
    const stored = {};
    assert.equal(applyTheme('klassiek', doc, { setItem: (k, v) => { stored[k] = v; } }), 'klassiek');
    assert.equal(doc.documentElement.dataset.theme, 'klassiek');
    assert.equal(meta.content, '#0d0a14');
    assert.equal(stored[THEME_STORAGE_KEY], 'klassiek');
  });
  it('survives a storage that throws', () => {
    const doc = { documentElement: { dataset: {} }, querySelector: () => null };
    assert.equal(applyTheme('x', doc, { setItem: () => { throw new Error('quota'); } }), 'rotterdam');
    assert.equal(doc.documentElement.dataset.theme, 'rotterdam');
  });
});

describe('index.html theme bootstrap', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const inline = html.match(/<script>(try\{[^<]*)<\/script>/)?.[1] ?? '';

  it('applies the stored theme in <head> before the stylesheets, inside try/catch', () => {
    assert.ok(html.indexOf(inline) < html.indexOf('href="style.css"'));
    assert.match(inline, /^try\{/);
    assert.ok(inline.includes(`'${THEME_STORAGE_KEY}'`));
    for (const id of Object.keys(THEMES)) assert.ok(inline.includes(`'${id}'`), id);
    assert.match(html, new RegExp(`<html lang="nl" data-theme="${DEFAULT_THEME}">`));
  });

  it('behaves like pickInitialTheme', () => {
    const run = storage => {
      const document = { documentElement: { dataset: { theme: DEFAULT_THEME } } };
      new Function('localStorage', 'document', inline)(storage, document);
      return document.documentElement.dataset.theme;
    };
    for (const v of ['klassiek', 'rotterdam', 'neon', null]) {
      const s = { getItem: () => v };
      assert.equal(run(s), pickInitialTheme(s));
    }
    const blocked = { getItem: () => { throw new Error('denied'); } };
    assert.equal(run(blocked), pickInitialTheme(blocked));
  });

  it('links the favicons and touch icon with relative paths', () => {
    for (const f of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) {
      assert.match(html, new RegExp(`href="${f.replace('.', '\\.')}"`));
    }
    assert.match(html, /<meta name="theme-color" content="#111923"/);
  });

  it('ships the loader visible and indeterminate on first paint', () => {
    const m = html.match(/<div id="app-loader" class="([^"]*)"([^>]*)>/);
    assert.ok(m);
    assert.deepEqual(m[1].split(' ').sort(), ['app-loader', 'is-indeterminate', 'is-visible']);
    assert.doesNotMatch(m[2], /hidden/);
    assert.ok(html.indexOf('id="app-loader"') - html.indexOf('<body>') < 20);
  });
});

describe('brand assets', () => {
  const read = f => readFileSync(new URL(`../${f}`, import.meta.url));
  it('has a single-colour green logo with a nonzero path', () => {
    const svg = read('assets/logo.svg').toString();
    assert.deepEqual([...new Set(svg.match(/fill="[^"]+"/g))], ['fill="#009A3E"']);
  });
  it('has a valid ICO with 16, 32 and 48 px PNG entries and a 180 px touch icon', () => {
    const ico = read('favicon.ico');
    assert.equal(ico.readUInt16LE(2), 1);
    assert.deepEqual([0, 1, 2].map(i => ico[6 + 16 * i]), [16, 32, 48]);
    const png = read('apple-touch-icon.png');
    assert.equal(png.readUInt32BE(16), 180);
    assert.equal(png.readUInt32BE(20), 180);
  });
});
