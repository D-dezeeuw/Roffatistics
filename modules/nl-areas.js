// Nederland drill-down data: every wijk and buurt of the Netherlands.
// Values: data/nl/{wijken,buurten}-2025.json, built by scripts/build-nl-kwb.mjs
// from CBS 86165NED (+85984NED fallback), 86270NED (+86134NED) and police
// 47018NED, stored column-wise. Only raw metrics are stored; crime rates and the
// Woonscore are computed here in the browser, so the wizard's presets apply to
// these areas as well. Peers: all NL wijken, all NL buurten (comparable everywhere).
// Geometry: one gemeente at a time from the PDOK gebiedsindelingen WFS.
// Pure helpers are exported for the unit tests; loaders take an injectable fetcher.
import { areaLevel, parentCode, per1000, toNumber, CRIME_CATEGORIES, CRIME_MIN_POPULATION, CRIME_MIN_POPULATION_BUURT, WIJK_YEAR } from './areas.js';
import { withWoonscore, assignScore } from './presets.js';
import { addPc4Shares } from './herkomst-pc4.js';
import { addBouwShares } from './bouwjaar-pc4.js';
import { addP2000Values } from './p2000.js';
import { addOmgeving, decodeNeighbours, encodeNeighbours } from './omgeving.js';
import { ovValues } from './ov.js';

export const NL_DATA_FORMAT = 1;
export const NL_DATA_YEAR = WIJK_YEAR;
export const NL_DATA_URLS = Object.freeze({
  wijk:  `./data/nl/wijken-${NL_DATA_YEAR}.json`,
  buurt: `./data/nl/buurten-${NL_DATA_YEAR}.json`,
});

// PDOK "CBS gebiedsindelingen" 2025 (same indeling as 86165NED). Checked on
// 15 Nov 2026: wijk_gegeneraliseerd / buurt_gegeneraliseerd carry statcode,
// statnaam and gmCode; Access-Control-Allow-Origin: *.
export const NL_GEO_WFS = 'https://service.pdok.nl/cbs/gebiedsindelingen/2025/wfs/v1_0';
export const NL_GEO_TYPES = Object.freeze({ wijk: 'wijk_gegeneraliseerd', buurt: 'buurt_gegeneraliseerd' });

const CRIME_KEYS = Object.keys(CRIME_CATEGORIES);
/** Value keys derived in the browser (never stored): the crime rates. */
export const DERIVED_KEYS = Object.freeze(['crimeRate', ...CRIME_KEYS]);
/** Keys never stored: derived, scored, or Rotterdam-only. */
const SKIP_KEYS = new Set([...DERIVED_KEYS, 'woonscore', 'distCentrum', 'crimeDensity', 'crimeNearby', 'distOvHalte', 'distOv']);

export const minPopulationFor = level => (level === 'buurt' ? CRIME_MIN_POPULATION_BUURT : CRIME_MIN_POPULATION);

/** True for a CBS gemeente code 'GM0599'. */
export const isGemeenteCode = code => /^GM\d{4}$/.test(String(code ?? ''));

/** The gemeente a wijk/buurt code lies in: 'BU05990110' → 'GM0599'; null otherwise. */
export function gemeenteOf(code) {
  const lvl = areaLevel(code);
  return lvl === 'wijk' || lvl === 'buurt' ? 'GM' + String(code).trim().toUpperCase().slice(2, 6) : null;
}

/**
 * Crime rates per 1,000 inhabitants from the stored counts (same rule as
 * areas.mergeCrime: null below `minPopulation` inhabitants). Mutates and returns `values`.
 */
export function addCrimeRates(values, minPopulation = CRIME_MIN_POPULATION) {
  const pop = values.population;
  values.crimeRate = per1000(values.totalCrimes, pop, minPopulation);
  for (const k of CRIME_KEYS) values[k] = per1000(values[`${k}Count`], pop, minPopulation);
  return values;
}

// CBS leaves gestandaardiseerd huishoudinkomen empty for most buurten in the
// 2025 and 2024 tables; the 2023 table (income year 2021) covers ~70 %.
export const INCOME_FALLBACK_TABLE  = '85618NED';
export const INCOME_FALLBACK_COLUMN = 'GemGestandaardiseerdInkomenVanHuish_84';
export const INCOME_FALLBACK_YEAR   = 2023;

/** Fills avgIncome from the 2023 table where the newer tables have none; marks the year. Mutates and returns `areas`. */
export function addIncomeFallback(areas, rows = []) {
  const byCode = new Map(rows.map(r => [String(r.WijkenEnBuurten ?? '').trim(), toNumber(r[INCOME_FALLBACK_COLUMN])]));
  for (const a of areas) {
    if (toNumber(a.values?.avgIncome) != null) continue;
    const v = byCode.get(a.code);
    if (v == null) continue;
    a.values = { ...a.values, avgIncome: v };
    a.years = { ...a.years, avgIncome: INCOME_FALLBACK_YEAR };
  }
  return areas;
}

/**
 * Areas ({ code, name, values, years }) → the compact file object: codes and
 * names as arrays, one array per value key (keys that are null everywhere are
 * dropped), and per key the indexes whose value came from the fallback year
 * ('all' when every non-null value did).
 */
export function encodeLevel(areas, { level, year = NL_DATA_YEAR, built = null, sources = {}, neighbours = null } = {}) {
  const keys = new Set();
  for (const a of areas) for (const [k, v] of Object.entries(a.values ?? {})) if (!SKIP_KEYS.has(k) && toNumber(v) != null) keys.add(k);
  const cols = {}, fallback = {};
  for (const k of [...keys].sort()) {
    cols[k] = areas.map(a => toNumber(a.values?.[k]));
    const fell = [], yearOf = {};
    areas.forEach((a, i) => { const y = a.years?.[k]; if (y) { fell.push(i); yearOf[y] = true; } });
    if (!fell.length) continue;
    const withValue = cols[k].filter(v => v != null).length;
    fallback[k] = { year: Number(Object.keys(yearOf)[0]), idx: fell.length >= withValue ? 'all' : fell };
  }
  const codes = areas.map(a => a.code);
  // nb: shared-boundary neighbours (omgeving.js encodeNeighbours), built from PDOK geometry.
  return { format: NL_DATA_FORMAT, level, year, built, sources, codes, names: areas.map(a => a.name), cols, fallback, ...(neighbours ? { nb: encodeNeighbours(codes, neighbours) } : {}) };
}

/**
 * The compact file object → areas { code, name, level, parent, gemeente,
 * values, years, bounds: null } with the crime rates added. Throws on a file
 * of another format.
 */
export function decodeLevel(data) {
  if (data?.format !== NL_DATA_FORMAT || !Array.isArray(data.codes)) throw new Error('nl-areas: unknown data format');
  const { codes, names = [], cols = {}, fallback = {} } = data;
  const keys = Object.keys(cols);
  const fellAt = {};
  for (const [k, f] of Object.entries(fallback)) fellAt[k] = f.idx === 'all' ? null : new Set(f.idx);
  const list = codes.map((code, i) => {
    const level = areaLevel(code);
    const values = {};
    for (const k of keys) values[k] = cols[k][i] ?? null;
    Object.assign(values, ovValues(values));   // distOvHalte, distOv (null without the OV columns)
    const years = {};
    for (const [k, f] of Object.entries(fallback)) {
      if (values[k] != null && (fellAt[k] == null || fellAt[k].has(i))) years[k] = f.year;
    }
    addCrimeRates(values, minPopulationFor(level));
    return { code, name: names[i] ?? code, level, parent: parentCode(code), gemeente: gemeenteOf(code), values, years, bounds: null };
  });
  // Crime per km² and the omgeving (neighbours from the stored `nb` lists; none in an older file).
  return addOmgeving(list, typeof data.nb === 'string' ? decodeNeighbours(codes, data.nb) : null);
}

/** Areas of `level`-list that lie in gemeente `gm` (by code prefix). */
export function areasInGemeente(areas, gm) {
  if (!isGemeenteCode(gm)) return [];
  const digits = gm.slice(2);
  return (areas ?? []).filter(a => a.code.slice(2, 6) === digits);
}

/** PDOK WFS GetFeature URL for the wijken or buurten of one gemeente (GeoJSON, WGS84). */
export function buildGemeenteGeoUrl(level, gm) {
  if (!NL_GEO_TYPES[level]) throw new Error(`nl-areas: unknown level ${level}`);
  if (!isGemeenteCode(gm)) throw new Error(`nl-areas: not a gemeente code ${gm}`);
  const params = new URLSearchParams({
    request: 'GetFeature', service: 'WFS', version: '2.0.0',
    typeName: `gebiedsindelingen:${NL_GEO_TYPES[level]}`,
    outputFormat: 'json', srsName: 'EPSG:4326', count: '5000',
    FILTER: `<Filter><PropertyIsEqualTo><PropertyName>gmCode</PropertyName><Literal>${gm}</Literal></PropertyIsEqualTo></Filter>`,
  });
  return `${NL_GEO_WFS}?${params}`;
}

const round = c => (typeof c[0] === 'number' ? [+c[0].toFixed(5), +c[1].toFixed(5)] : c.map(round));

/** Keeps the polygons of gemeente `gm` with { statcode, statnaam } only and 5-decimal coordinates. */
export function slimGeo(geojson, gm) {
  const digits = String(gm ?? '').slice(2);
  return {
    type: 'FeatureCollection',
    features: (geojson?.features ?? [])
      .filter(f => f?.geometry && /Polygon$/.test(f.geometry.type))
      .map(f => ({ code: String(f.properties?.statcode ?? '').trim().toUpperCase(), f }))
      .filter(({ code }) => code.slice(2, 6) === digits)
      .map(({ code, f }) => ({
        type: 'Feature',
        properties: { statcode: code, statnaam: f.properties?.statnaam ?? code },
        geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
      })),
  };
}

// ── Loaders ───────────────────────────────────────────────────────────────────

const defaultFetcher = () => globalThis.fetch?.bind(globalThis);
const yieldToMain = () => new Promise(r => setTimeout(r, 0));
const levelPromises = new Map();   // 'wijk' | 'buurt' → Promise<Area[]>
const loaded = { wijk: null, buurt: null };
const geoPromises = new Map();     // 'wijk:GM0599' → Promise<FeatureCollection>

async function getJSON(url, fetcher) {
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

/**
 * All NL areas of `level` with values and the Woonscore among their national
 * peers (cached; a failed load is forgotten so the next call retries).
 * Buurten load the wijken first: buurt crime rates shrink toward the parent wijk.
 */
export function loadNlLevel(level, { fetcher = defaultFetcher() } = {}) {
  if (!NL_DATA_URLS[level]) return Promise.reject(new Error(`nl-areas: unknown level ${level}`));
  if (levelPromises.has(level)) return levelPromises.get(level);
  const p = (async () => {
    const parents = level === 'buurt' ? await loadNlLevel('wijk', { fetcher }) : null;
    const raw = addP2000Values(addBouwShares(addPc4Shares(decodeLevel(await getJSON(NL_DATA_URLS[level], fetcher)))));   // postcode herkomst, once loaded
    await yieldToMain();   // decode and scoring in separate tasks: no single long block (docs/decisions.md 15 Nov 2026)
    const scored = withWoonscore(raw, { parents });
    loaded[level] = scored;
    return scored;
  })();
  levelPromises.set(level, p);
  p.catch(() => levelPromises.delete(level));
  return p;
}

/** { wijken, buurten } — both levels (the area modal needs parents and children). */
export async function loadNlAreas(opts) {
  const [wijken, buurten] = await Promise.all([loadNlLevel('wijk', opts), loadNlLevel('buurt', opts)]);
  return { wijken, buurten };
}

/** Wijk or buurt polygons of one gemeente (cached per level + gemeente; failures are not cached). */
export function loadGemeenteGeo(level, gm, { fetcher = defaultFetcher() } = {}) {
  const key = `${level}:${gm}`;
  if (geoPromises.has(key)) return geoPromises.get(key);
  const p = (async () => slimGeo(await getJSON(buildGemeenteGeoUrl(level, gm), fetcher), gm))();
  geoPromises.set(key, p);
  p.catch(() => geoPromises.delete(key));
  return p;
}

/** True once the areas of `level` are loaded and scored (no load is started). */
export function isNlLevelLoaded(level) { return loaded[level] != null; }

/** The loaded NL areas ({ wijken, buurten }, [] for a level not loaded); never starts a load. */
export function peekNlAreas() { return { wijken: loaded.wijk ?? [], buurten: loaded.buurt ?? [] }; }

/** The area with `code` among the loaded NL areas, or null. */
export function findNlArea(code) {
  const lvl = areaLevel(code);
  return (lvl === 'wijk' ? loaded.wijk : lvl === 'buurt' ? loaded.buurt : null)?.find(a => a.code === code) ?? null;
}

/** Rescores the loaded NL areas in place with the active preset (wizard, switcher). */
export function rescoreNlAreas() {
  if (loaded.wijk) assignScore(loaded.wijk, 'woonscore');
  if (loaded.buurt) assignScore(loaded.buurt, 'woonscore', { parents: loaded.wijk });
}

/** Test hook: forget every cached load. */
export function _resetNlCache() { levelPromises.clear(); geoPromises.clear(); loaded.wijk = null; loaded.buurt = null; }
