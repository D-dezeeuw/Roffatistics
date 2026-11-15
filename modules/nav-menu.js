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
//
// Only phones get the menu (v0.43.0): above NAV_INLINE_QUERY the same list is
// shown as a row of icon buttons in the header (style.css), ☰ is hidden and
// this module stays out of the way (list never hidden, focus not redirected,
// no close-on-click). Same elements, so every handler and shortcut is shared.

const ITEM = '.nav-menu-item';
/** Mobile breakpoint: the stylesheet's phone layout (modals go full screen at ≤ 640 px). */
export const NAV_MOBILE_MAX = 640;
export const NAV_INLINE_QUERY = `(min-width: ${NAV_MOBILE_MAX + 1}px)`;

const shown = el => !el.hidden && (typeof el.getClientRects !== 'function' || el.getClientRects().length > 0);

/** `inlineQuery`: a MediaQueryList (or { matches }) that is true when the items sit in the header. */
export function createNavMenu(btn, list, doc = globalThis.document, { inlineQuery = null } = {}) {
  let open = false;
  const items = () => [...list.querySelectorAll(ITEM)].filter(shown);
  const inline = () => !!inlineQuery?.matches;

  function setOpen(on, { focus = null } = {}) {
    open = !!on && !inline();
    btn.setAttribute('aria-expanded', String(open));
    list.hidden = !open && !inline();
    if (open && focus === 'first') items()[0]?.focus();
    if (open && focus === 'last') items().at(-1)?.focus();
    if (!open && focus === 'button') btn.focus();
  }

  // A hidden item cannot take focus: send it to the menu button.
  for (const item of list.querySelectorAll(ITEM)) {
    const native = item.focus.bind(item);
    item.focus = opts => (open || inline() ? native(opts) : btn.focus(opts));
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
    if (!item || inline()) return;
    setOpen(false, { focus: 'button' });
    const proxy = item.getAttribute?.('data-nav-proxy');   // e.g. Zoeken → .search-btn
    if (proxy) doc.querySelector(proxy)?.click();
  }, true);

  list.addEventListener('keydown', e => {
    if (!open) return;   // inline row: the browser's own Tab order
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

  inlineQuery?.addEventListener?.('change', () => setOpen(false));
  setOpen(false);
  return {
    open: opts => setOpen(true, opts),
    close: opts => setOpen(false, opts),
    toggle: () => setOpen(!open),
    isOpen: () => open,
    isInline: inline,
  };
}

export function initNavMenu(doc = globalThis.document) {
  const btn = doc.querySelector('.nav-menu-btn');
  const list = btn && doc.getElementById(btn.getAttribute('aria-controls'));
  let inlineQuery = null;
  try { inlineQuery = (doc.defaultView ?? globalThis).matchMedia?.(NAV_INLINE_QUERY) ?? null; } catch { inlineQuery = null; }
  return btn && list ? createNavMenu(btn, list, doc, { inlineQuery }) : null;
}
