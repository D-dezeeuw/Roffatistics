// Rotterdam wijken + buurten: CBS "Kerncijfers wijken en buurten 2024"
// (table 85984NED) joined to pre-cached PDOK 2024 geometry in data/.
// Pure helpers are exported for the unit tests; loaders take injectable
// fetcher/storage so they run under node --test as well as in the browser.
import { DATASETS, DATASET_KEYS } from './datasets.js';

export { DATASETS, DATASET_KEYS };

const CBS_BASE = 'https://opendata.cbs.nl/ODataApi/odata';

export const WIJK_TABLE = '85984NED';
// Column keys of 85984NED (re-check https://opendata.cbs.nl/ODataApi/odata/85984NED/DataProperties
// when a query returns 500: CBS renumbers the suffixes between yearly tables).
export const WIJK_COLUMNS = Object.freeze({
  region:              'WijkenEnBuurten',                    // 'WK059901  ' — padded with spaces
  population:          'AantalInwoners_5',                   // aantal
  age65plus:           'k_65JaarOfOuder_12',                 // aantal
  originOutsideEurope: 'BuitenEuropa_19',                    // herkomstland buiten Europa, aantal
  density:             'Bevolkingsdichtheid_34',             // inwoners per km²
  wozValue:            'GemiddeldeWOZWaardeVanWoningen_39',  // ×€1,000
  lowEdu:              'BasisonderwijsVmboMbo1_67',          // aantal, hoogst behaald
  medEdu:              'HavoVwoMbo24_68',                    // aantal
  highEdu:             'HboWo_69',                           // aantal
  avgIncome:           'GemGestandaardiseerdInkomen_83',     // gem. gestandaardiseerd inkomen huishouden, ×€1,000
});
export const WIJK_SELECT = Object.values(WIJK_COLUMNS).join(',');

export const ROTTERDAM = Object.freeze({
  gemeente:    'GM0599',
  name:        'Rotterdam',
  wijkPrefix:  'WK0599',
  buurtPrefix: 'BU0599',
});

export const GEO_URLS = Object.freeze({
  gemeente:  './data/rotterdam_gemeente.geojson',
  wijken:    './data/rotterdam_wijken.geojson',
  buurten:   './data/rotterdam_buurten.geojson',
  provinces: './data/provinces.json',
});

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Trims CBS padding and upper-cases; returns null for empty input. */
export function normalizeAreaCode(code) {
  if (code == null) return null;
  const c = String(code).trim().toUpperCase();
  return c || null;
}

/** 'provincie' | 'gemeente' | 'wijk' | 'buurt' | null, from the CBS code prefix. */
export function areaLevel(code) {
  const c = normalizeAreaCode(code);
  if (!c) return null;
  if (/^PV\d{2}$/.test(c))   return 'provincie';
  if (/^GM\d{4}$/.test(c))   return 'gemeente';
  if (/^WK\d{6}$/.test(c))   return 'wijk';
  if (/^BU\d{8}$/.test(c))   return 'buurt';
  return null;
}

/** Parent code: buurt → wijk, wijk → gemeente, otherwise null. */
export function parentCode(code) {
  const c = normalizeAreaCode(code);
  const level = areaLevel(c);
  if (level === 'buurt') return 'WK' + c.slice(2, 8);
  if (level === 'wijk')  return 'GM' + c.slice(2, 6);
  return null;
}

/** Finite number or null (CBS uses null for suppressed/unknown cells). */
export function toNumber(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function hasValue(v) {
  return toNumber(v) != null;
}

const share = (part, total) => {
  const p = toNumber(part), t = toNumber(total);
  return p != null && t ? +(p / t * 100).toFixed(1) : null;
};

/**
 * Maps one 85984NED row to the app's dataset keys (same keys as the gemeente
 * rows in datasets.js, so panel and legend need no special case).
 * Every DATASETS key is present; datasets the table lacks (crimeRate) are null.
 */
export function extractAreaValues(row) {
  const C = WIJK_COLUMNS;
  const r = row ?? {};
  const population = toNumber(r[C.population]);
  const low = toNumber(r[C.lowEdu]), med = toNumber(r[C.medEdu]), high = toNumber(r[C.highEdu]);
  const eduTotal = low != null && med != null && high != null ? low + med + high : null;
  const values = Object.fromEntries(DATASET_KEYS.map(k => [k, null]));
  return {
    ...values,
    population,
    avgIncome:     toNumber(r[C.avgIncome]),
    crimeRate:     null,                        // not in 85984NED; wijken get it from mergeWijkCrime
    highEdu:       share(high, eduTotal),
    wozValue:      toNumber(r[C.wozValue]),
    pop65plus:     share(r[C.age65plus], population),
    nonWesternPct: share(r[C.originOutsideEurope], population),
    // Panel-only extras (not choropleth datasets)
    density:       toNumber(r[C.density]),
    lowEdu:        share(low, eduTotal),
    medEdu:        share(med, eduTotal),
  };
}

/** All-null values for an area without a CBS row. */
export function emptyAreaValues() {
  return extractAreaValues(null);
}

/** {min, max} over the non-null values of `key`, or null when no area has one. */
export function valueRange(areas, key) {
  const vals = areas.map(a => toNumber(a.values?.[key])).filter(v => v != null);
  if (!vals.length) return null;
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

/** [[south, west], [north, east]] of a GeoJSON geometry/feature/collection, or null. */
export function geoBounds(geo) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  const walk = c => {
    if (typeof c[0] === 'number') {
      const [lng, lat] = c;
      if (lat < s) s = lat; if (lat > n) n = lat;
      if (lng < w) w = lng; if (lng > e) e = lng;
      return;
    }
    c.forEach(walk);
  };
  const visit = g => {
    if (!g) return;
    if (g.type === 'FeatureCollection') g.features.forEach(visit);
    else if (g.type === 'Feature') visit(g.geometry);
    else if (g.coordinates) walk(g.coordinates);
  };
  visit(geo);
  return Number.isFinite(s) ? [[s, w], [n, e]] : null;
}

/** Grows a [[s,w],[n,e]] box by `ratio` of its size on every side. */
export function padBounds(bounds, ratio) {
  const [[s, w], [n, e]] = bounds;
  const dLat = (n - s) * ratio, dLng = (e - w) * ratio;
  return [[s - dLat, w - dLng], [n + dLat, e + dLng]];
}

/**
 * Joins geometry features to CBS rows. Every feature yields an area, with or
 * without a row, so the map can always show all wijken/buurten.
 */
export function joinAreas(features, rows) {
  const byCode = new Map();
  for (const r of rows ?? []) {
    const code = normalizeAreaCode(r?.[WIJK_COLUMNS.region]);
    if (code) byCode.set(code, r);
  }
  return features.map(f => {
    const code = normalizeAreaCode(f.properties?.statcode);
    const row  = byCode.get(code);
    return {
      code,
      name:   f.properties?.statnaam ?? code,
      level:  areaLevel(code),
      parent: parentCode(code),
      values: row ? extractAreaValues(row) : emptyAreaValues(),
      bounds: geoBounds(f),
    };
  });
}

/** Data object for panel.showPanel (same shape as a normalised gemeente row). */
export function areaPanelData(area) {
  return area ? { regionCode: area.code, ...area.values } : null;
}

/** Province name without CBS' " (PV)" suffix. */
export function cleanRegionName(title) {
  return String(title ?? '').replace(/\s*\((PV|CR|LD)\)\s*$/, '').trim();
}

/** Flat search index; see getAreaIndex. */
export function buildAreaIndex({ wijken = [], buurten = [], gemeenten = [], provinces = [] } = {}) {
  const out = [];
  for (const p of provinces) out.push({ code: p.code, name: p.name, level: 'provincie', scope: 'nederland' });
  for (const g of gemeenten) out.push({ code: g.code, name: g.name, level: 'gemeente', scope: 'nederland' });
  for (const a of wijken)    out.push({ code: a.code, name: a.name, level: 'wijk',  scope: 'rotterdam', parent: a.parent });
  for (const a of buurten)   out.push({ code: a.code, name: a.name, level: 'buurt', scope: 'rotterdam', parent: a.parent });
  return out;
}

// ── Loaders ───────────────────────────────────────────────────────────────────

async function getJSON(url, fetcher, storage) {
  const cached = storage?.getItem?.(url);
  if (cached) return JSON.parse(cached);
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  const data = await res.json();
  try { storage?.setItem?.(url, JSON.stringify(data)); } catch { /* quota */ }
  return data;
}

export function buildWijkUrl() {
  const params = new URLSearchParams({
    $filter: `startswith(WijkenEnBuurten,'${ROTTERDAM.wijkPrefix}') or startswith(WijkenEnBuurten,'${ROTTERDAM.buurtPrefix}')`,
    $select: WIJK_SELECT,
  });
  return `${CBS_BASE}/${WIJK_TABLE}/TypedDataSet?${params}`;
}

export function buildGemeenteNamesUrl() {
  const params = new URLSearchParams({ $filter: "startswith(Key,'GM')", $select: 'Key,Title' });
  return `${CBS_BASE}/${WIJK_TABLE}/WijkenEnBuurten?${params}`;
}

// ── Wijk crime: police "Geregistreerde misdrijven; soort misdrijf, wijk, buurt" ──
// CBS dataderden table 47018NED (catalog Politie). Separate fetch: 85984NED has
// no crime columns. Total of all misdrijven per wijk for CRIME_PERIOD, divided by
// the 85984NED inhabitants ×1000. Wijken only; buurten keep crimeRate null.

export const CRIME_BASE   = 'https://dataderden.cbs.nl/ODataApi/odata';
export const CRIME_TABLE  = '47018NED';
export const CRIME_PERIOD = '2025JJ00';          // last full year (table covers 2012–2025)
export const CRIME_TOTAL  = '0.0.0 ';            // SoortMisdrijf "Totaal misdrijven" (CBS pads the key)
export const CRIME_COLUMN = 'GeregistreerdeMisdrijven_1';
// Below this many inhabitants a per-1,000 rate is meaningless (port/industrial
// wijken with a few hundred residents and thousands of incidents): rate = null.
export const CRIME_MIN_POPULATION = 1000;

export function buildWijkCrimeUrl() {
  const params = new URLSearchParams({
    $filter: `startswith(WijkenEnBuurten,'${ROTTERDAM.wijkPrefix}') and Perioden eq '${CRIME_PERIOD}' and SoortMisdrijf eq '${CRIME_TOTAL}'`,
    $select: `WijkenEnBuurten,${CRIME_COLUMN}`,
  });
  return `${CRIME_BASE}/${CRIME_TABLE}/TypedDataSet?${params}`;
}

/** Misdrijven per 1,000 inhabitants (1 decimal), or null when either is unknown or the population is too small. */
export function crimeRatePer1000(total, population) {
  const t = toNumber(total), p = toNumber(population);
  if (t == null || p == null || p < CRIME_MIN_POPULATION) return null;
  return +(t / p * 1000).toFixed(1);
}

/** Returns new areas with values.totalCrimes and values.crimeRate filled from 47018NED rows. */
export function mergeWijkCrime(areas, rows) {
  const totals = new Map();
  for (const r of rows ?? []) {
    const code = normalizeAreaCode(r?.WijkenEnBuurten);
    if (code) totals.set(code, toNumber(r[CRIME_COLUMN]));
  }
  return areas.map(a => {
    if (!totals.has(a.code)) return a;
    const totalCrimes = totals.get(a.code);
    return { ...a, values: { ...a.values, totalCrimes, crimeRate: crimeRatePer1000(totalCrimes, a.values.population) } };
  });
}

const defaultStorage = () => { try { return globalThis.sessionStorage; } catch { return null; } };

let areasPromise = null;
let indexPromise = null;

/**
 * Loads all Rotterdam wijken and buurten with their values (cached).
 * Resolves to { wijken: Area[], buurten: Area[], geo: { gemeente, wijken, buurten }, bounds, dataOk }
 * where Area = { code, name, level, parent, values: { [datasetKey]: number|null }, bounds }.
 * Geometry failures reject; a CBS failure still resolves (all values null, dataOk false).
 * Wijk crimeRate comes from police table 47018NED (best-effort; null when it fails).
 */
export function loadRotterdamAreas({ fetcher = globalThis.fetch?.bind(globalThis), storage = defaultStorage() } = {}) {
  if (areasPromise) return areasPromise;
  areasPromise = (async () => {
    const [gemeente, wijkGeo, buurtGeo] = await Promise.all([
      getJSON(GEO_URLS.gemeente, fetcher, null),
      getJSON(GEO_URLS.wijken,   fetcher, null),
      getJSON(GEO_URLS.buurten,  fetcher, null),
    ]);
    let rows = [], dataOk = true;
    const crimeRows = getJSON(buildWijkCrimeUrl(), fetcher, storage).then(d => d.value ?? []).catch(() => []);
    try {
      rows = (await getJSON(buildWijkUrl(), fetcher, storage)).value ?? [];
    } catch {
      dataOk = false;
    }
    return {
      wijken:  mergeWijkCrime(joinAreas(wijkGeo.features, rows), await crimeRows),
      buurten: joinAreas(buurtGeo.features, rows),
      geo:     { gemeente, wijken: wijkGeo, buurten: buurtGeo },
      bounds:  geoBounds(gemeente),
      dataOk,
    };
  })();
  areasPromise.catch(() => { areasPromise = null; });
  return areasPromise;
}

/**
 * Flat search index (cached): Array<{ code, name, level: 'wijk'|'buurt'|'gemeente'|'provincie',
 * scope: 'rotterdam'|'nederland', parent? }>. Provinces come from data/provinces.json,
 * gemeenten from the CBS 85984NED region list, wijken/buurten from loadRotterdamAreas().
 * Any source that fails is left out rather than failing the whole index.
 */
export function getAreaIndex({ fetcher = globalThis.fetch?.bind(globalThis), storage = defaultStorage() } = {}) {
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    const [areas, provGeo, gmRows] = await Promise.all([
      loadRotterdamAreas({ fetcher, storage }).catch(() => ({ wijken: [], buurten: [] })),
      getJSON(GEO_URLS.provinces, fetcher, null).catch(() => ({ features: [] })),
      getJSON(buildGemeenteNamesUrl(), fetcher, storage).then(d => d.value ?? []).catch(() => []),
    ]);
    return buildAreaIndex({
      wijken:    areas.wijken,
      buurten:   areas.buurten,
      provinces: provGeo.features.map(f => ({ code: normalizeAreaCode(f.properties?.statcode), name: f.properties?.statnaam })),
      gemeenten: gmRows.map(r => ({ code: normalizeAreaCode(r.Key), name: cleanRegionName(r.Title) })),
    });
  })();
  return indexPromise;
}

/** Test hook: forget cached loads. */
export function _resetAreaCache() { areasPromise = null; indexPromise = null; }
