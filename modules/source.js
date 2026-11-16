// One fetch layer for every CBS, police and PDOK source (docs/plan-data-mirror.md,
// phase 1). The app reads a snapshot from its own origin (data/snapshot/<key>.json,
// built by scripts/snapshot-sources.mjs); the live CBS/PDOK URL is only a fallback,
// and only behind a flag, so a missing or broken snapshot shows up in the smoke
// tests instead of being hidden by a silent live request.
//
// Every live URL is built here (odataUrl, wfsUrl): tests/source-registry.test.js
// fails when a module builds an OData or WFS URL of its own.

export const CBS_ODATA = 'https://opendata.cbs.nl/ODataApi/odata';
export const CBS_ODATA_FEED = 'https://opendata.cbs.nl/ODataFeed/odata';
export const POLITIE_ODATA = 'https://dataderden.cbs.nl/ODataApi/odata';
export const POLITIE_ODATA_FEED = 'https://dataderden.cbs.nl/ODataFeed/odata';
/** PDOK "CBS gebiedsindelingen" WFS of one year. */
export const pdokGebiedsindelingen = year => `https://service.pdok.nl/cbs/gebiedsindelingen/${year}/wfs/v1_0`;

export const SNAPSHOT_DIR = './data/snapshot';
export const SNAPSHOT_FORMAT = 1;

/** OData URL: `<base>/<table>/<entity>?$filter&$select&$top` (empty parts left out). */
export function odataUrl(table, { filter = null, select = null, top = null, entity = 'TypedDataSet', base = CBS_ODATA, format = null } = {}) {
  const params = new URLSearchParams();
  if (filter) params.set('$filter', filter);
  if (select) params.set('$select', select);
  if (top) params.set('$top', String(top));
  if (format) params.set('$format', format);
  const q = params.toString();
  return `${base}/${table}/${entity}${q ? `?${q}` : ''}`;
}

/** PDOK gebiedsindelingen WFS GetFeature URL (GeoJSON, WGS84); `extra` params are appended in order. */
export function wfsUrl(year, typeName, extra = {}) {
  const params = new URLSearchParams({
    request: 'GetFeature', service: 'WFS', version: '2.0.0',
    typeName: `gebiedsindelingen:${typeName}`,
    outputFormat: 'json', srsName: 'EPSG:4326',
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])),
  });
  return `${pdokGebiedsindelingen(year)}?${params}`;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/;
/** True for a snapshot key such as 'cbs/86165NED-rotterdam' or 'geo/2025/GM0599-wijk'. */
export const isSourceKey = key => typeof key === 'string' && KEY_RE.test(key) && !key.includes('..');

/** Own-origin URL of a snapshot key. */
export function snapshotUrl(key, dir = SNAPSHOT_DIR) {
  if (!isSourceKey(key)) throw new Error(`source: bad key ${key}`);
  return `${dir}/${key}.json`;
}

/**
 * OData rows → the column-wise snapshot table: { format, ...header, columns, rows }
 * where rows are arrays in `columns` order. Values are kept as CBS sends them
 * (padded keys included), so the modules parse a snapshot like a live answer.
 */
export function encodeTable(rows, header = {}) {
  const columns = [];
  const seen = new Set();
  for (const r of rows ?? []) for (const k of Object.keys(r ?? {})) if (!seen.has(k)) { seen.add(k); columns.push(k); }
  return { format: SNAPSHOT_FORMAT, ...header, columns, rows: (rows ?? []).map(r => columns.map(c => r?.[c] ?? null)) };
}

/** Column-wise snapshot table → row objects. Throws on another format. */
export function decodeTable(data) {
  if (data?.format !== SNAPSHOT_FORMAT || !Array.isArray(data.columns) || !Array.isArray(data.rows)) throw new Error('source: unknown snapshot format');
  const { columns } = data;
  return data.rows.map(r => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? null])));
}

/** A snapshot file (table or GeoJSON) or a live answer → the live answer's shape ({ value } or a FeatureCollection). */
export function toResponseJson(data) {
  if (data && Array.isArray(data.columns) && Array.isArray(data.rows)) return { value: decodeTable(data) };
  return data;
}

// ── Live fallback flag ────────────────────────────────────────────────────────
// Off by default. On with ?live=1 in the page URL, localStorage
// 'roffa.liveFallback' = '1', or setLiveFallback(true) (tests).
let liveOverride = null;
export function setLiveFallback(on) { liveOverride = on == null ? null : !!on; }
export function liveFallbackEnabled() {
  if (liveOverride != null) return liveOverride;
  try { if (new URLSearchParams(globalThis.location?.search ?? '').get('live') === '1') return true; } catch { /* no location */ }
  try { return globalThis.localStorage?.getItem?.('roffa.liveFallback') === '1'; } catch { return false; }
}

/** Every page of a live OData answer (follows odata.nextLink) or a WFS answer as is; cached in `storage` by URL. */
export async function fetchLive(url, { fetcher = globalThis.fetch?.bind(globalThis), storage = null } = {}) {
  const hit = storage?.getItem?.(url);
  if (hit) return JSON.parse(hit);
  let next = url, out = null;
  while (next) {
    const res = await fetcher(next);
    if (!res.ok) throw new Error(`${next} ${res.status}`);
    const page = await res.json();
    if (!Array.isArray(page?.value)) { out = page; break; }
    out = out ? { ...out, value: [...out.value, ...page.value] } : { ...page };
    next = page['odata.nextLink'] ?? null;
  }
  if (out && 'odata.nextLink' in out) delete out['odata.nextLink'];
  try { storage?.setItem?.(url, JSON.stringify(out)); } catch { /* quota */ }
  return out;
}

const defaultFetcher = () => globalThis.fetch?.bind(globalThis);
const defaultStorage = () => { try { return globalThis.sessionStorage ?? null; } catch { return null; } };

/**
 * The data of source `key` in the live answer's shape: { value: rows } for an
 * OData table, a FeatureCollection for geometry. Reads the own-origin snapshot
 * (the browser's HTTP cache keeps it); when that fails and the live fallback is
 * on, fetches `live` (all pages, sessionStorage-cached). Callers cache the result.
 */
export async function getSource(key, { live = null, fetcher = defaultFetcher(), storage = defaultStorage(), allowLive = liveFallbackEnabled(), dir = SNAPSHOT_DIR } = {}) {
  let err;
  try {
    const res = await fetcher(snapshotUrl(key, dir));
    if (res.ok) return toResponseJson(await res.json());
    err = new Error(`snapshot ${key} ${res.status}`);
  } catch (e) { err = e; }
  if (!allowLive || !live) throw err;
  return fetchLive(live, { fetcher, storage });
}

/** Rows ({ value }) of an OData source; see getSource. */
export const getRows = (key, opts) => getSource(key, opts).then(d => d?.value ?? []);
