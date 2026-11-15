// App loader: fades the map and shows #app-loader while heavy work runs
// (first load, scope switch, NL wijk/buurt data). The markup and CSS belong to
// the house style (index.html / style.css); this module only toggles classes,
// the label and the --progress custom property, and no-ops when #app-loader is
// missing. Nested calls are reference-counted: the loader hides when the last
// caller is done.

const LOADER_ID = 'app-loader';
const MAP_ID = 'map';
let depth = 0;
let current = 0;        // fill shown this session; it only moves forward
let trickle = null;     // creeps toward TRICKLE_MAX while work runs, so the ring never sits still or restarts
const TRICKLE_MAX = 0.9;
const TRICKLE_MS = 250;

const doc = () => globalThis.document ?? null;
const loaderEl = () => doc()?.getElementById?.(LOADER_ID) ?? null;

/** p clamped to 0..1; null (or anything not a finite number) = indeterminate. */
export function clampProgress(p) {
  if (typeof p !== 'number' || !Number.isFinite(p)) return null;
  return Math.min(1, Math.max(0, p));
}

/** Number of open showLoader calls (test hook and debugging). */
export function loaderDepth() { return depth; }

/** Shows the loader with `label`; a nested call only updates the label (the ring keeps its fill). */
export function showLoader(label) {
  depth++;
  const el = loaderEl();
  if (!el) return;
  if (depth === 1) { current = 0; paintProgress(el, 0); startTrickle(); }
  el.hidden = false;
  el.classList.add('is-visible');
  el.setAttribute?.('aria-busy', 'true');
  const text = el.querySelector?.('.app-loader__label');
  if (text && label != null) text.textContent = String(label);
  doc()?.getElementById?.(MAP_ID)?.classList.add('map-busy');
}

function paintProgress(el, v) {
  el.classList.remove('is-indeterminate');
  el.style?.setProperty?.('--progress', String(v));
}

function startTrickle() {
  stopTrickle();
  if (typeof setInterval !== 'function') return;
  trickle = setInterval(() => {
    const el = loaderEl();
    if (!el || depth === 0) return stopTrickle();
    current += (TRICKLE_MAX - current) * 0.06;
    paintProgress(el, Math.round(current * 1000) / 1000);
  }, TRICKLE_MS);
  trickle?.unref?.();
}
function stopTrickle() { if (trickle) { clearInterval(trickle); trickle = null; } }

/**
 * Sets the progress 0..1 (clamped) on #app-loader as --progress. While the
 * loader is open the fill never goes back (a lower value is ignored), so
 * steps from different callers cannot make the ring jump. null = indeterminate.
 */
export function setLoaderProgress(p) {
  const el = loaderEl();
  if (!el) return;
  const v = clampProgress(p);
  if (v == null) {
    stopTrickle();
    el.classList.add('is-indeterminate');
    el.style?.removeProperty?.('--progress');
    return;
  }
  if (depth > 0 && v < current) return;
  current = v;
  paintProgress(el, v);
}

/** Closes one showLoader; the loader hides and the map comes back when none is open. */
export function hideLoader() {
  if (depth > 0) depth--;
  if (depth > 0) return;
  stopTrickle();
  const el = loaderEl();
  if (!el) return;
  current = 1;
  paintProgress(el, 1);
  el.classList.remove('is-visible');
  el.hidden = true;
  el.setAttribute?.('aria-busy', 'false');
  doc()?.getElementById?.(MAP_ID)?.classList.remove('map-busy');
}

/**
 * Resolves after two animation frames, so a just-shown overlay is painted
 * before heavy work starts. Falls back to a timer when frames do not come
 * (background tab, node).
 */
export function afterPaint({ raf = globalThis.requestAnimationFrame, fallbackMs = 120 } = {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    const timer = setTimeout(finish, fallbackMs);
    if (typeof raf === 'function') raf(() => raf(finish));
  });
}

/** Shows the loader, waits for it to paint, runs `fn`, hides it again (also on error). */
export async function withLoader(label, fn, { paint = afterPaint } = {}) {
  showLoader(label);
  try {
    await paint();
    return await fn();
  } finally {
    hideLoader();
  }
}

/** Test hook: forget open calls. */
export function _resetLoader() { depth = 0; current = 0; stopTrickle(); }
