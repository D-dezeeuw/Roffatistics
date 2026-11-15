// Header hamburger menu (W24): a disclosure button (☰) with the less-used
// header actions (wizard, Delen, Uitleg, Vergelijken, Over, and Zoeken on
// phones). The items keep their own classes (.wizard-btn, .share-btn, …), so
// the modules that bind them with document.querySelector keep working.
//
// Disclosure, not role="menu": the button has aria-expanded/aria-controls,
// Esc closes and returns focus to it, a click outside closes, arrow keys,
// Home and End move between the items. A click on an item closes the menu
// first (capture phase, focus back on ☰), then the item's own handler runs.
// Dialogs that later return focus to a hidden item land on ☰ instead.

const ITEM = '.nav-menu-item';

const shown = el => !el.hidden && (typeof el.getClientRects !== 'function' || el.getClientRects().length > 0);

export function createNavMenu(btn, list, doc = globalThis.document) {
  let open = false;
  const items = () => [...list.querySelectorAll(ITEM)].filter(shown);

  function setOpen(on, { focus = null } = {}) {
    open = !!on;
    btn.setAttribute('aria-expanded', String(open));
    list.hidden = !open;
    if (open && focus === 'first') items()[0]?.focus();
    if (open && focus === 'last') items().at(-1)?.focus();
    if (!open && focus === 'button') btn.focus();
  }

  // A hidden item cannot take focus: send it to the menu button.
  for (const item of list.querySelectorAll(ITEM)) {
    const native = item.focus.bind(item);
    item.focus = opts => (open ? native(opts) : btn.focus(opts));
  }

  btn.addEventListener('click', () => setOpen(!open));
  btn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true, { focus: e.key === 'ArrowDown' ? 'first' : 'last' });
    }
  });

  list.addEventListener('click', e => {
    const item = e.target?.closest?.(ITEM);
    if (!item) return;
    setOpen(false, { focus: 'button' });
    const proxy = item.getAttribute?.('data-nav-proxy');   // e.g. Zoeken → .search-btn
    if (proxy) doc.querySelector(proxy)?.click();
  }, true);

  list.addEventListener('keydown', e => {
    const all = items();
    if (!all.length) return;
    const i = all.indexOf(doc.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = all[(i + 1) % all.length];
    else if (e.key === 'ArrowUp') next = all[(i - 1 + all.length) % all.length];
    else if (e.key === 'Home') next = all[0];
    else if (e.key === 'End') next = all.at(-1);
    if (next) { e.preventDefault(); next.focus(); }
  });

  doc.addEventListener('keydown', e => {
    if (open && e.key === 'Escape') { e.preventDefault(); setOpen(false, { focus: 'button' }); }
  });
  // Capture, so a control that stops propagation (layers button) still closes the menu.
  doc.addEventListener('click', e => {
    if (open && !btn.contains(e.target) && !list.contains(e.target)) setOpen(false);
  }, true);

  setOpen(false);
  return {
    open: opts => setOpen(true, opts),
    close: opts => setOpen(false, opts),
    toggle: () => setOpen(!open),
    isOpen: () => open,
  };
}

export function initNavMenu(doc = globalThis.document) {
  const btn = doc.querySelector('.nav-menu-btn');
  const list = btn && doc.getElementById(btn.getAttribute('aria-controls'));
  return btn && list ? createNavMenu(btn, list, doc) : null;
}
