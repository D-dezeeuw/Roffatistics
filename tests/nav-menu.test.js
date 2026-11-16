import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNavMenu, initNavMenu, NAV_INLINE_QUERY, NAV_MOBILE_MAX } from '../modules/nav-menu.js';

// Minimal fake DOM: elements with attributes, listeners (capture flag kept),
// focus tracked on the document, contains() through a parent chain.
function fakeDoc() {
  const doc = { activeElement: null, listeners: [], byId: {}, sel: {} };
  doc.addEventListener = (type, fn, capture = false) => doc.listeners.push({ type, fn, capture });
  doc.querySelector = s => doc.sel[s] ?? null;
  doc.getElementById = id => doc.byId[id] ?? null;
  doc.fire = (type, ev) => doc.listeners.filter(l => l.type === type).sort((a, b) => b.capture - a.capture).forEach(l => l.fn(ev));
  return doc;
}
function el(doc, { cls = '', parent = null, attrs = {} } = {}) {
  const e = { cls, parent, attrs: { ...attrs }, hidden: false, listeners: [], children: [], clicks: 0 };
  if (parent) parent.children.push(e);
  e.setAttribute = (k, v) => (e.attrs[k] = String(v));
  e.getAttribute = k => e.attrs[k] ?? null;
  e.addEventListener = (type, fn, capture = false) => e.listeners.push({ type, fn, capture });
  e.focus = () => (doc.activeElement = e);
  e.click = () => e.clicks++;
  e.contains = t => { for (let n = t; n; n = n.parent) if (n === e) return true; return false; };
  e.closest = s => { for (let n = e; n; n = n.parent) if (s.split(',').some(c => n.cls.split(' ').includes(c.trim().slice(1)))) return n; return null; };
  e.querySelectorAll = s => { const out = []; const walk = n => n.children.forEach(c => { if (c.closest(s) === c) out.push(c); walk(c); }); walk(e); return out; };
  return e;
}
// Dispatch a click from target up: capture listeners on ancestors first, then bubble.
function click(doc, target) {
  const chain = []; for (let n = target; n; n = n.parent) chain.push(n);
  const ev = { target, preventDefault() {} };
  doc.listeners.filter(l => l.type === 'click' && l.capture).forEach(l => l.fn(ev));
  [...chain].reverse().forEach(n => n.listeners.filter(l => l.type === 'click' && l.capture).forEach(l => l.fn(ev)));
  chain.forEach(n => n.listeners.filter(l => l.type === 'click' && !l.capture).forEach(l => l.fn(ev)));
  doc.listeners.filter(l => l.type === 'click' && !l.capture).forEach(l => l.fn(ev));
}
function key(doc, target, k) {
  const ev = { key: k, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  for (let n = target; n; n = n.parent) n.listeners.filter(l => l.type === 'keydown').forEach(l => l.fn(ev));
  doc.fire('keydown', ev);
  return ev;
}
function setup() {
  const doc = fakeDoc();
  const btn = el(doc, { cls: 'nav-menu-btn', attrs: { 'aria-controls': 'nav-menu-list' } });
  const list = el(doc, { cls: 'nav-menu-list' });
  const wizard = el(doc, { cls: 'wizard-btn nav-menu-item', parent: list });
  const label = el(doc, { cls: 'nav-menu-label', parent: wizard });
  const share = el(doc, { cls: 'share-btn nav-menu-item', parent: list });
  const searchItem = el(doc, { cls: 'nav-menu-item', parent: list, attrs: { 'data-nav-proxy': '.search-btn' } });
  const searchBtn = el(doc, { cls: 'search-btn' });
  const outside = el(doc, { cls: 'map' });
  doc.sel['.nav-menu-btn'] = btn; doc.sel['.search-btn'] = searchBtn; doc.byId['nav-menu-list'] = list;
  const menu = initNavMenu(doc);
  return { doc, btn, list, wizard, label, share, searchItem, searchBtn, outside, menu };
}

describe('nav menu (hamburger)', () => {
  it('starts closed and toggles on the button', () => {
    const t = setup();
    assert.equal(t.menu.isOpen(), false);
    assert.equal(t.btn.attrs['aria-expanded'], 'false');
    assert.equal(t.list.hidden, true);
    click(t.doc, t.btn);
    assert.equal(t.menu.isOpen(), true);
    assert.equal(t.btn.attrs['aria-expanded'], 'true');
    assert.equal(t.list.hidden, false);
    click(t.doc, t.btn);
    assert.equal(t.menu.isOpen(), false);
  });

  it('Escape closes and returns focus to the button', () => {
    const t = setup();
    t.menu.open({ focus: 'first' });
    assert.equal(t.doc.activeElement, t.wizard);
    const ev = key(t.doc, t.wizard, 'Escape');
    assert.equal(t.menu.isOpen(), false);
    assert.equal(t.doc.activeElement, t.btn);
    assert.ok(ev.defaultPrevented);
    t.doc.activeElement = t.outside;
    key(t.doc, t.outside, 'Escape');   // closed: Escape is left alone
    assert.equal(t.doc.activeElement, t.outside);
  });

  it('a click outside closes; a click inside the list does not', () => {
    const t = setup();
    t.menu.open();
    click(t.doc, t.list);
    assert.equal(t.menu.isOpen(), true);
    click(t.doc, t.outside);
    assert.equal(t.menu.isOpen(), false);
  });

  it('an item click closes the menu before the item handler runs', () => {
    const t = setup();
    let openDuringHandler = null;
    t.wizard.addEventListener('click', () => (openDuringHandler = t.menu.isOpen()));
    t.menu.open();
    click(t.doc, t.label);   // the span inside the button
    assert.equal(openDuringHandler, false);
    assert.equal(t.doc.activeElement, t.btn);
  });

  it('a proxy item clicks its target (Zoeken on phones)', () => {
    const t = setup();
    t.menu.open();
    click(t.doc, t.searchItem);
    assert.equal(t.searchBtn.clicks, 1);
    assert.equal(t.menu.isOpen(), false);
  });

  it('focus on a hidden item goes to the menu button', () => {
    const t = setup();
    t.wizard.focus();   // e.g. a dialog returning focus to its trigger
    assert.equal(t.doc.activeElement, t.btn);
    t.menu.open();
    t.wizard.focus();
    assert.equal(t.doc.activeElement, t.wizard);
  });

  it('arrow keys, Home and End move between visible items', () => {
    const t = setup();
    t.searchItem.hidden = true;   // desktop: Zoeken stays in the bar
    key(t.doc, t.btn, 'ArrowDown');
    assert.equal(t.menu.isOpen(), true);
    assert.equal(t.doc.activeElement, t.wizard);
    key(t.doc, t.wizard, 'ArrowDown');
    assert.equal(t.doc.activeElement, t.share);
    key(t.doc, t.share, 'ArrowDown');
    assert.equal(t.doc.activeElement, t.wizard, 'wraps');
    key(t.doc, t.wizard, 'ArrowUp');
    assert.equal(t.doc.activeElement, t.share);
    key(t.doc, t.share, 'Home');
    assert.equal(t.doc.activeElement, t.wizard);
    key(t.doc, t.wizard, 'End');
    assert.equal(t.doc.activeElement, t.share);
  });

  it('desktop/tablet (inline query matches): list always shown, no redirect, no close-on-click', () => {
    const doc = fakeDoc();
    const btn = el(doc, { cls: 'nav-menu-btn', attrs: { 'aria-controls': 'nav-menu-list' } });
    const list = el(doc, { cls: 'nav-menu-list' });
    const wizard = el(doc, { cls: 'wizard-btn nav-menu-item', parent: list });
    const mql = { matches: true, fns: [], addEventListener(t, fn) { this.fns.push(fn); } };
    const menu = createNavMenu(btn, list, doc, { inlineQuery: mql });
    assert.equal(list.hidden, false, 'items visible in the bar');
    assert.equal(menu.isInline(), true);
    menu.open();
    assert.equal(menu.isOpen(), false, 'there is no menu to open');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    wizard.focus();
    assert.equal(doc.activeElement, wizard, 'focus is not sent to the hidden ☰');
    click(doc, wizard);
    assert.equal(doc.activeElement, wizard, 'a click does not move focus to ☰');
    assert.equal(list.hidden, false);
    mql.matches = false; mql.fns.forEach(fn => fn());   // resized to a phone
    assert.equal(list.hidden, true, 'phone: the list folds back into ☰');
    wizard.focus();
    assert.equal(doc.activeElement, btn);
  });

  it('index.html: every menu item has an accessible name and a tooltip, incl. Instellingen', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const list = html.slice(html.indexOf('id="nav-menu-list"'), html.indexOf('</nav>'));
    const items = [...list.matchAll(/<button[^>]*class="[^"]*nav-menu-item[^"]*"[^>]*>/g)].map(m => m[0]);
    assert.ok(items.length >= 5);
    for (const b of items.filter(b => !b.includes('nav-menu-search'))) {
      assert.match(b, /aria-label="[^"]+"/, b);
      assert.match(b, /title="[^"]+"/, b);
    }
    const cog = items.find(b => b.includes('settings-btn'));
    assert.ok(cog, 'Instellingen item present');
    assert.match(cog, /aria-label="Instellingen"/);
    assert.match(cog, /title="Instellingen"/);
    assert.match(cog, /aria-controls="settings-modal"/);
  });

  it('index.html (v0.56.0): Uitleg, Over, Privacy and Sneltoetsen sit in the footer, not in the header', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const nav = html.slice(html.indexOf('<nav id="topnav"'), html.indexOf('</nav>'));
    const footer = html.slice(html.indexOf('<footer>'), html.indexOf('</footer>'));
    for (const cls of ['explain-btn', 'about-btn', 'legal-menu-btn', 'shortcuts-btn', 'data-legal=']) {
      assert.ok(!nav.includes(cls), `header has no ${cls}`);
    }
    const links = [...footer.matchAll(/<button class="([^"]*\bfooter-link\b[^"]*)"[^>]*>([^<]+)<\/button>/g)].map(m => [m[1].split(' ')[0], m[2]]);
    assert.deepEqual(links, [['explain-btn', 'Uitleg'], ['about-btn', 'Over'], ['legal-link', 'Privacy'], ['shortcuts-btn', 'Sneltoetsen']]);
    assert.match(footer, /data-legal="privacy"/);
  });

  it('index.html (v0.56.0): Layers between the left group and the actions, Zoeken the last control', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const nav = html.slice(html.indexOf('<nav id="topnav"'), html.indexOf('</nav>')).replace(/<!--[\s\S]*?-->/g, '');
    const iLeft = nav.indexOf('class="nav-left"'), iLayers = nav.indexOf('class="nav-layers"'), iActions = nav.indexOf('class="nav-actions"');
    assert.ok(iLeft < iLayers && iLayers < iActions, 'left · layers · actions');
    const buttons = [...nav.matchAll(/<(button|select)\b[^>]*>/g)].map(m => m[0]);
    assert.match(buttons.at(-1), /class="search-btn"/, 'Zoeken is the last control');
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(css, /#topnav \{[^}]*grid-template-columns: 1fr auto 1fr/);
    assert.match(css, /\.nav-layers \{[^}]*justify-self: center/);
  });

  it('index.html (v0.56.0): the house button has the visible label "Ideale woonplaats"', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const m = html.match(/<button class="wizard-btn[^"]*"[^>]*>[\s\S]*?<\/button>/);
    assert.ok(m);
    assert.match(m[0], /aria-label="Ideale woonplaats"/);
    assert.match(m[0], /<span class="nav-menu-label nav-wizard-label">Ideale woonplaats<\/span>/);
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(css, /\.nav-menu-list \.wizard-btn \.nav-wizard-label \{\s*position: static/);
  });

  it('style.css: ☰ only on phones (≤ NAV_MOBILE_MAX), items inline above it', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const block = css.slice(css.indexOf(`@media ${NAV_INLINE_QUERY}`));
    assert.ok(block.length > 0 && css.includes(`@media ${NAV_INLINE_QUERY}`));
    assert.match(block, /\.nav-menu-btn \{ display: none; \}/);
    assert.match(block, /\.nav-menu-list\[hidden\][^{]*\{[^}]*display: flex/);
    assert.equal(NAV_MOBILE_MAX, 640);
  });

  it('initNavMenu returns null without the markup', () => {
    assert.equal(initNavMenu(fakeDoc()), null);
    assert.equal(typeof createNavMenu, 'function');
  });
});
