// App state shared by the topnav, the map and the dashboard/list views.
// setState() validates, persists the scope, mirrors scope/view/area into the
// URL hash and emits a 'state-change' event: on `document` in the browser,
// on a private EventTarget under node.
import { DATASET_KEYS, CRIME_MODES } from './datasets.js';

export const SCOPES = Object.freeze(['rotterdam', 'nederland']);
export const VIEWS  = Object.freeze(['map', 'dashboard', 'list']);
export const SCOPE_STORAGE_KEY = 'roffatistics.scope';
export const CRIME_STORAGE_KEY = 'roffatistics.crime';
// crime: 'rate' (per 1.000 inwoners) | 'abs' (registered offences); see datasets.js datasetFor().
export const DEFAULT_STATE = Object.freeze({ scope: 'rotterdam', view: 'map', dataset: 'woonscore', area: null, crime: 'rate' });

const AREA_RE = /^(PV\d{2}|GM\d{4}|WK\d{6}|BU\d{8})$/;

/** Keeps only valid fields of `patch` (unknown keys and bad values are dropped). */
export function sanitizePatch(patch = {}) {
  const out = {};
  if (SCOPES.includes(patch.scope))         out.scope   = patch.scope;
  if (VIEWS.includes(patch.view))           out.view    = patch.view;
  if (DATASET_KEYS.includes(patch.dataset)) out.dataset = patch.dataset;
  if (CRIME_MODES.includes(patch.crime))    out.crime   = patch.crime;
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
  for (const key of ['scope', 'view', 'dataset', 'area', 'crime']) if (params.has(key)) raw[key] = params.get(key);
  return sanitizePatch(raw);
}

/**
 * State → '#scope=…&view=…[&dataset=…][&area=…][&crime=abs]'. The default
 * dataset (Woonscore) and crime mode are left out, so a hash without
 * dataset opens on the Woonscore.
 */
export function serializeHash(state) {
  const params = new URLSearchParams({ scope: state.scope, view: state.view });
  if (state.dataset && state.dataset !== DEFAULT_STATE.dataset && DATASET_KEYS.includes(state.dataset)) params.set('dataset', state.dataset);
  if (state.area) params.set('area', state.area);
  if (state.crime === 'abs') params.set('crime', 'abs');
  return `#${params}`;
}

/** Initial state: defaults < stored scope and crime mode < URL hash. */
export function resolveInitialState({ hash = '', storage = null } = {}) {
  let stored = {};
  try { stored = sanitizePatch({ scope: storage?.getItem(SCOPE_STORAGE_KEY), crime: storage?.getItem(CRIME_STORAGE_KEY) }); } catch { /* storage blocked */ }
  return { ...DEFAULT_STATE, ...stored, ...parseHash(hash) };
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

function writeHash() {
  if (typeof location === 'undefined' || typeof history === 'undefined') return;
  const next = serializeHash(state);
  if (location.hash !== next) history.replaceState(null, '', next);
}

/** Reads hash + localStorage, writes the canonical hash and follows later hash edits. */
export function initState({ hash = globalThis.location?.hash ?? '', storage } = {}) {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  storageRef = storage;
  state = resolveInitialState({ hash, storage });
  writeHash();
  globalThis.addEventListener?.('hashchange', () => setState({ area: null, ...parseHash(location.hash) }, { source: 'hash' }));
  return getState();
}
