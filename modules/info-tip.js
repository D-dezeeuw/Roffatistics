// (i) toggletips (plan-gui-header-wizard §B, v0.56.0). Not hover-only: the
// text shows on hover (pointer devices), on keyboard focus and after a tap or
// click (aria-expanded="true"); Escape hides it without moving focus, a click
// elsewhere or leaving the button closes it. The text sits in the DOM (hidden),
// so `aria-describedby` reads it to screen readers.
//
// Markup: <span class="info-tip"><button class="tip-btn">i</button><span
// class="info-tip-text" role="tooltip"></span></span>. The text is positioned
// against the nearest positioned ancestor (`.tip-anchor`), so it can span a
// whole card or question instead of hanging off the small icon.

const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const TIP_BTN = '.tip-btn';

/** The (i) button plus its tooltip text. `id` must be unique in the document. */
export function infoTipHtml(id, text, label = 'Meer uitleg') {
  return `<span class="info-tip"><button type="button" class="tip-btn" data-tip aria-expanded="false" aria-describedby="${escHtml(id)}" aria-label="${escHtml(label)}">i</button><span class="info-tip-text" role="tooltip" id="${escHtml(id)}">${escHtml(text)}</span></span>`;
}

const openTips = root => [...(root.querySelectorAll?.(`${TIP_BTN}[aria-expanded="true"]`) ?? [])];
const setOpen = (btn, on) => btn.setAttribute('aria-expanded', String(!!on));

/** Click anywhere in `root`: a tip button toggles, every other open tip closes. Returns true when a tip button was hit. */
export function tipClick(root, target) {
  const btn = target?.closest?.(TIP_BTN) ?? null;
  for (const b of openTips(root)) if (b !== btn) setOpen(b, false);
  if (!btn) return false;
  setOpen(btn, btn.getAttribute('aria-expanded') !== 'true');
  btn.removeAttribute('data-tip-dismissed');
  return true;
}

/** Escape: hides an open tip, or the focus-shown tip of `active`. Returns true when it hid one (the caller then keeps the dialog open). */
export function tipEscape(root, active) {
  const open = openTips(root);
  for (const b of open) setOpen(b, false);
  const focused = active?.matches?.(TIP_BTN) && !active.hasAttribute('data-tip-dismissed');
  if (focused) active.setAttribute('data-tip-dismissed', '');
  return open.length > 0 || !!focused;
}

/** Focus left a tip button: close it and forget a dismissal. */
export function tipBlur(target) {
  if (!target?.matches?.(TIP_BTN)) return;
  setOpen(target, false);
  target.removeAttribute('data-tip-dismissed');
}

/** Wires the three handlers on `root`; call before the root's own Escape handler. */
export function bindInfoTips(root, doc = globalThis.document) {
  root.addEventListener('click', e => { if (tipClick(root, e.target)) e.stopImmediatePropagation(); });
  root.addEventListener('keydown', e => {
    if (e.key === 'Escape' && tipEscape(root, doc?.activeElement)) { e.preventDefault(); e.stopImmediatePropagation(); }
  });
  root.addEventListener('focusout', e => tipBlur(e.target));
}
