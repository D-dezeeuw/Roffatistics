// Hold Space to pan: while the spacebar is down, map features stop taking
// pointer events (CSS class `space-pan` on the map container), so a press and
// drag anywhere moves the map and never opens a wijk/buurt/gemeente.
// Released on keyup, on window blur and when the tab is hidden.

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'OPTION']);

/** True when a Space keydown should start pan mode (not while typing or in a dialog). */
export function shouldStartPan(event, mapVisible = true) {
  if (!mapVisible || event.code !== 'Space' && event.key !== ' ') return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const t = event.target;
  if (t && (TYPING.has(t.tagName) || t.isContentEditable)) return false;
  if (t?.closest?.('dialog[open], [role="dialog"], [aria-modal="true"]')) return false;
  return true;
}

export function initSpacePan(container, doc = globalThis.document, win = globalThis.window) {
  if (!container || !doc) return () => {};
  const visible = () => container.offsetParent !== null || container.getClientRects().length > 0;
  let active = false;
  const set = on => {
    if (active === on) return;
    active = on;
    container.classList.toggle('space-pan', on);
  };
  const down = e => {
    if (active) { if (e.code === 'Space' || e.key === ' ') e.preventDefault(); return; }
    if (!shouldStartPan(e, visible())) return;
    e.preventDefault();               // no page scroll, no button activation
    set(true);
  };
  const up = e => { if (e.code === 'Space' || e.key === ' ') set(false); };
  const off = () => set(false);
  doc.addEventListener('keydown', down);
  doc.addEventListener('keyup', up);
  win?.addEventListener('blur', off);
  doc.addEventListener('visibilitychange', off);
  return () => {
    off();
    doc.removeEventListener('keydown', down);
    doc.removeEventListener('keyup', up);
    win?.removeEventListener('blur', off);
    doc.removeEventListener('visibilitychange', off);
  };
}
