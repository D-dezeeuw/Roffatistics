// App state shared by the topnav, the map and the dashboard/list views.
// setState() validates, persists the scope, mirrors scope/view/area into the
// URL hash and emits a 'state-change' event: on `document` in the browser,
// on a private EventTarget under node.
import { DATASET_KEYS, CRIME_MODES, resolveLayerKey } from './datasets.js';
import { shareableScore, restoreLocalScore, isShareOf, SHARE_NONE } from './wizard-model.js';

export const SCOPES = Object.freeze(['rotterdam', 'nederland']);
export const VIEWS  = Object.freeze(['map', 'dashboard', 'list']);
export const SCOPE_STORAGE_KEY = 'roffatistics.scope';
export const CRIME_STORAGE_KEY = 'roffatistics.crime';
/** Active Woonscore preset (#score=…, see wizard-model.js); restored when the hash has none. */
export const SCORE_STORAGE_KEY = 'roffatistics.score';
const SCORE_RE = /^[a-z0-9.]{1,120}$/;
/** Retired layer keys still accepted in links: `jouwscore` is now the Woonscore with the `score` preset (v0.22.0). */
export const LEGACY_DATASETS = Object.freeze({ jouwscore: 'woonscore' });
// crime: 'rate' (per 1.000 inwoners) | 'abs' (registered offences); see datasets.js datasetFor().
export const DEFAULT_STATE = Object.freeze({ scope: 'rotterdam', view: 'map', dataset: 'woonscore', area: null, crime: 'rate', score: null });

const AREA_RE = /^(PV\d{2}|GM\d{4}|WK\d{4}[0-9A-Z]{2}|BU\d{4}[0-9A-Z]{4})$/;   // Amsterdam: WK0363AA, BU0363AA01

/** Keeps only valid fields of `patch` (unknown keys and bad values are dropped). */
export function sanitizePatch(patch = {}) {
  const out = {};
  if (SCOPES.includes(patch.scope))         out.scope   = patch.scope;
  if (VIEWS.includes(patch.view))           out.view    = patch.view;
  // Retired herkomst layers (15 Nov 2026) open their nearest regio layer.
  const dataset = resolveLayerKey(LEGACY_DATASETS[patch.dataset] ?? patch.dataset);
  if (DATASET_KEYS.includes(dataset))       out.dataset = dataset;
  if (CRIME_MODES.includes(patch.crime))    out.crime   = patch.crime;
  if ('score' in patch) {
    const sc = patch.score == null ? '' : String(patch.score).trim().toLowerCase();
    if (sc === '') out.score = null;
    else if (SCORE_RE.test(sc)) out.score = sc;
  }
  if ('area' in patch) {
    const a = patch.area == null ? '' : String(patch.area).trim().toUpperCase();
    if (a === '') out.area = null;
    else if (AREA_RE.test(a)) out.area = a;
  }
  return out;
}

/** '#scope=rotterdam&view=list&area=WK059901' → sanitised partial state. */
export function parseHash(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const raw = {};
  for (const key of ['scope', 'view', 'dataset', 'area', 'crime', 'score']) if (params.has(key)) raw[key] = params.get(key);
  return sanitizePatch(raw);
}

/**
 * State → '#scope=…&view=…[&dataset=…][&area=…][&crime=abs][&score=…]'. The default
 * dataset (Woonscore) and crime mode are left out, so a hash without
 * dataset opens on the Woonscore.
 */
export function serializeHash(state, shareOpts = shareChoice) {
  const params = new URLSearchParams({ scope: state.scope, view: state.view });
  if (state.dataset && state.dataset !== DEFAULT_STATE.dataset && DATASET_KEYS.includes(state.dataset)) params.set('dataset', state.dataset);
  if (state.area) params.set('area', state.area);
  if (state.crime === 'abs') params.set('crime', 'abs');
  // Sensitive parts (gemeenschap, opleiding, inkomen) only when ticked in "Deellink maken" (default: none).
  const shared = state.score && SCORE_RE.test(state.score) ? shareableScore(state.score, shareOpts) : null;
  if (shared) params.set('score', shared);
  return `#${params}`;
}

/** Initial state: defaults < stored scope and crime mode < URL hash. */
export function resolveInitialState({ hash = '', storage = null } = {}) {
  let stored = {};
  try { stored = sanitizePatch({ scope: storage?.getItem(SCOPE_STORAGE_KEY), crime: storage?.getItem(CRIME_STORAGE_KEY), score: storage?.getItem(SCORE_STORAGE_KEY) });
    if (stored.score === null) delete stored.score; } catch { /* storage blocked */ }
  const fromHash = parseHash(hash);
  const out = { ...DEFAULT_STATE, ...stored, ...fromHash };
  if ('score' in stored) out.score = restoreLocalScore(fromHash.score ?? null, stored.score) ?? out.score;
  return out;
}

let state = { ...DEFAULT_STATE };
const bus = typeof document !== 'undefined' ? document : new EventTarget();
let storageRef = null;

export function getState() { return { ...state }; }

/**
 * Merges a patch. Emits 'state-change' with detail { state, prev, changed: string[], source }
 * when something changed. `source` is free text from the caller ('map', 'hash', 'search', …)
 * so listeners can skip echoing their own changes. Returns the new state.
 */
export function setState(patch, { source = 'app' } = {}) {
  const clean = sanitizePatch(patch);
  const changed = Object.keys(clean).filter(k => clean[k] !== state[k]);
  if (!changed.length) return getState();
  const prev = state;
  state = { ...state, ...clean };
  if (changed.includes('scope')) {
    try { storageRef?.setItem(SCOPE_STORAGE_KEY, state.scope); } catch { /* ignore */ }
  }
  if (changed.includes('crime')) {
    try { storageRef?.setItem(CRIME_STORAGE_KEY, state.crime); } catch { /* ignore */ }
  }
  if (changed.includes('score')) {
    try { if (state.score) storageRef?.setItem(SCORE_STORAGE_KEY, state.score); else storageRef?.removeItem(SCORE_STORAGE_KEY); } catch { /* ignore */ }
  }
  writeHash();
  bus.dispatchEvent(new CustomEvent('state-change', { detail: { state: getState(), prev: { ...prev }, changed, source } }));
  return getState();
}

/** Subscribes to state changes; returns an unsubscribe function. */
export function onStateChange(fn) {
  const handler = e => fn(e.detail);
  bus.addEventListener('state-change', handler);
  return () => bus.removeEventListener('state-change', handler);
}

/**
 * The share choices of "Deellink maken" (v0.26.0): which sensitive parts the
 * address bar and the share link carry. Per page load, default none.
 */
let shareChoice = SHARE_NONE;
export function getShareOptions() { return { ...shareChoice }; }
export function setShareOptions(opts = {}) {
  shareChoice = Object.freeze(Object.fromEntries(Object.keys(SHARE_NONE).map(k => [k, opts[k] === true])));
  writeHash();
}
/** The link to share: this page with the current state and the given share choices. */
export function shareUrl(opts = shareChoice, base = globalThis.location?.href ?? '') {
  return `${String(base).split('#')[0]}${serializeHash(state, opts)}`;
}

function writeHash() {
  if (typeof location === 'undefined' || typeof history === 'undefined') return;
  const next = serializeHash(state);
  if (location.hash !== next) history.replaceState(null, '', next);
}

/** Back to the Standaard Woonscore (legend "Reset"): clears `score`; the saved wizard answers stay. */
export function resetScore({ source = 'reset' } = {}) {
  return setState({ score: null }, { source });
}

/** Reads hash + localStorage, writes the canonical hash and follows later hash edits. */
export function initState({ hash = globalThis.location?.hash ?? '', storage } = {}) {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  storageRef = storage;
  state = resolveInitialState({ hash, storage });
  writeHash();
  globalThis.addEventListener?.('hashchange', () => {
    const patch = { area: null, ...parseHash(location.hash) };
    if (state.score && isShareOf(patch.score ?? null, state.score)) delete patch.score;   // same answers, local sensitive parts kept
    setState(patch, { source: 'hash' });
  });
  return getState();
}
