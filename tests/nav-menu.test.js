import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createNavMenu, initNavMenu } from '../modules/nav-menu.js';

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

  it('initNavMenu returns null without the markup', () => {
    assert.equal(initNavMenu(fakeDoc()), null);
    assert.equal(typeof createNavMenu, 'function');
  });
});
