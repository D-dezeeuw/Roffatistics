// Rotterdam wijken + buurten: CBS "Kerncijfers wijken en buurten 2025"
// (table 86165NED, per-field fallback to 2024 table 85984NED) joined to
// pre-cached PDOK geometry in data/ (indeling 2024; all 21 wijk and 91 buurt
// codes are identical in the 2025 table).
// Pure helpers are exported for the unit tests; loaders take injectable
// fetcher/storage so they run under node --test as well as in the browser.
import { DATASETS, DATASET_KEYS } from './datasets.js';

export { DATASETS, DATASET_KEYS };

const CBS_BASE = 'https://opendata.cbs.nl/ODataApi/odata';

export const WIJK_TABLE = '86165NED';           // Kerncijfers wijken en buurten 2025
export const WIJK_YEAR  = 2025;
export const WIJK_FALLBACK_TABLE = '85984NED';  // Kerncijfers wijken en buurten 2024
export const WIJK_FALLBACK_YEAR  = 2024;
// Column keys, looked up in the DataProperties of BOTH 86165NED and 85984NED on
// 15 Nov 2026: every key below is identical in the two tables, so one map serves
// base and fallback. Re-check both DataProperties when a query returns 500: CBS
// renumbers suffixes between yearly tables (86358NED, 2026, has new ones).
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
  ownerOccupied:       'Koopwoningen_47',                    // % van de woningvoorraad
  rental:              'HuurwoningenTotaal_48',              // %
  welfare:             'PersonenPerSoortUitkeringBijstand_87', // personen met bijstand, aantal
  distGP:              'AfstandTotHuisartsenpraktijk_110',   // km, gemiddeld over inwoners
  distSupermarket:     'AfstandTotGroteSupermarkt_111',      // km
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

// Below this many inhabitants a "per 1,000 inwoners" figure is meaningless.
export const PER1000_MIN_POPULATION = 200;

/** count per 1,000 inhabitants (1 decimal); null when unknown or population < minPopulation. */
export function per1000(count, population, minPopulation = PER1000_MIN_POPULATION) {
  const c = toNumber(count), p = toNumber(population);
  if (c == null || p == null || p <= 0 || p < minPopulation) return null;
  return +(c / p * 1000).toFixed(1);
}

/**
 * Maps one kerncijfers row (86165NED or 85984NED, same keys) to the app's
 * dataset keys (same keys as the gemeente rows in datasets.js, so panel and
 * legend need no special case). Every DATASETS key is present; datasets the
 * table lacks (crime) are null.
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
    density:       toNumber(r[C.density]),
    ownerOccupiedPct: toNumber(r[C.ownerOccupied]),
    rentalPct:     toNumber(r[C.rental]),
    welfarePer1000: per1000(r[C.welfare], population),
    distGP:        toNumber(r[C.distGP]),
    distSupermarket: toNumber(r[C.distSupermarket]),
    // Panel-only extras (not choropleth datasets)
    lowEdu:        share(low, eduTotal),
    medEdu:        share(med, eduTotal),
  };
}

// Value keys taken over together from the fallback year: the education shares
// come from one triple of counts, so they never mix years.
const FALLBACK_BUNDLES = [['lowEdu', 'medEdu', 'highEdu']];

/**
 * Values from the base-year row, with every field that is null there taken from
 * the fallback-year row when that one has it. Returns { values, years } where
 * years = { [valueKey]: fallbackYear } lists only the fields that fell back.
 */
export function mergeYearValues(row, fallbackRow, fallbackYear = WIJK_FALLBACK_YEAR) {
  const values = extractAreaValues(row);
  const years = {};
  if (!fallbackRow) return { values, years };
  const old = extractAreaValues(fallbackRow);
  const bundled = new Set(FALLBACK_BUNDLES.flat());
  const take = key => { values[key] = old[key]; years[key] = fallbackYear; };
  for (const bundle of FALLBACK_BUNDLES) {
    if (bundle.some(k => values[k] == null) && bundle.every(k => old[k] != null)) bundle.forEach(take);
  }
  for (const key of Object.keys(values)) {
    if (!bundled.has(key) && values[key] == null && old[key] != null) take(key);
  }
  return { values, years };
}

const YEAR_FIELD_LABELS = {
  highEdu: 'opleiding', avgIncome: 'inkomen', wozValue: 'WOZ', population: 'inwoners', density: 'dichtheid',
  pop65plus: '65+', nonWesternPct: 'herkomst', ownerOccupiedPct: 'koopwoningen', rentalPct: 'huurwoningen',
  welfarePer1000: 'bijstand', distGP: 'huisarts', distSupermarket: 'supermarkt',
};

/**
 * Human text for the data years: '2025' or '2025 · opleiding, inkomen: 2024'.
 * Pass one area's years map, or an array of areas ({ values, years }): a field
 * then reads 'WOZ: 2024' when every area that has a value fell back, and
 * 'WOZ: deels 2024' when only some did.
 */
export function describeDataYears(input, baseYear = WIJK_YEAR) {
  const areas = Array.isArray(input) ? input : [{ years: input ?? {}, values: null }];
  const byYear = new Map();                      // year → Map(label → { fell, withValue })
  for (const a of areas) {
    for (const [key, y] of Object.entries(a?.years ?? {})) {
      const label = YEAR_FIELD_LABELS[key];
      if (!label) continue;                       // lowEdu/medEdu travel with highEdu
      if (!byYear.has(y)) byYear.set(y, new Map());
      const m = byYear.get(y);
      if (!m.has(key)) m.set(key, { label, fell: 0 });
      m.get(key).fell++;
    }
  }
  const order = Object.keys(YEAR_FIELD_LABELS);
  const parts = [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([y, m]) => {
    const items = [...m.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    const all = items.filter(([k, i]) => !Array.isArray(input) || i.fell >= areas.filter(a => toNumber(a.values?.[k]) != null).length);
    const some = items.filter(it => !all.includes(it));
    return [
      all.length ? `${all.map(([, i]) => i.label).join(', ')}: ${y}` : '',
      some.length ? `${some.map(([, i]) => i.label).join(', ')}: deels ${y}` : '',
    ].filter(Boolean).join(' · ');
  });
  return [String(baseYear), ...parts].join(' · ');
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

const rowsByCode = rows => {
  const byCode = new Map();
  for (const r of rows ?? []) {
    const code = normalizeAreaCode(r?.[WIJK_COLUMNS.region]);
    if (code) byCode.set(code, r);
  }
  return byCode;
};

/**
 * Joins geometry features to CBS rows (base year, plus optional fallback-year
 * rows for fields the base year leaves null). Every feature yields an area,
 * with or without a row, so the map can always show all wijken/buurten; an
 * area whose code is in neither table keeps all-null values ("geen data").
 */
export function joinAreas(features, rows, fallbackRows = []) {
  const base = rowsByCode(rows), old = rowsByCode(fallbackRows);
  return features.map(f => {
    const code = normalizeAreaCode(f.properties?.statcode);
    const { values, years } = mergeYearValues(base.get(code) ?? null, old.get(code) ?? null);
    return {
      code,
      name:   f.properties?.statnaam ?? code,
      level:  areaLevel(code),
      parent: parentCode(code),
      values,
      years,
      bounds: geoBounds(f),
    };
  });
}

/** Data object for panel.showPanel (same shape as a normalised gemeente row). */
export function areaPanelData(area) {
  return area ? { regionCode: area.code, ...area.values, dataYears: describeDataYears(area.years) } : null;
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

/** Rotterdam gemeente + wijk + buurt rows of a kerncijfers table (default: the 2025 base). */
export function buildWijkUrl(table = WIJK_TABLE) {
  const params = new URLSearchParams({
    $filter: `startswith(WijkenEnBuurten,'${ROTTERDAM.gemeente}') or startswith(WijkenEnBuurten,'${ROTTERDAM.wijkPrefix}') or startswith(WijkenEnBuurten,'${ROTTERDAM.buurtPrefix}')`,
    $select: WIJK_SELECT,
  });
  return `${CBS_BASE}/${table}/TypedDataSet?${params}`;
}

// ── Newest city WOZ: CBS 85036NED "Gemiddelde WOZ-waarde van woningen; eigendom, regio" ──
// The only table with a 2026 figure (peildatum 1 januari); gemeente level only.
// Eigendom T001132 = Totaal (A047048 is "overige verhuurders", not the total).
export const WOZ_TABLE    = '85036NED';
export const WOZ_PERIOD   = '2026JJ00';
export const WOZ_EIGENDOM = 'T001132';

export function buildCityWozUrl() {
  const params = new URLSearchParams({
    $filter: `RegioS eq '${ROTTERDAM.gemeente}' and Eigendom eq '${WOZ_EIGENDOM}' and Perioden eq '${WOZ_PERIOD}'`,
    $select: 'RegioS,Perioden,GemiddeldeWOZWaardeVanWoningen_1',
  });
  return `${CBS_BASE}/${WOZ_TABLE}/TypedDataSet?${params}`;
}

/** { value (×€1,000), year, peildatum, table } from 85036NED rows, or null. */
export function parseCityWoz(rows) {
  const r = (rows ?? []).find(x => toNumber(x?.GemiddeldeWOZWaardeVanWoningen_1) != null);
  if (!r) return null;
  const year = Number(String(r.Perioden ?? WOZ_PERIOD).slice(0, 4));
  return { value: toNumber(r.GemiddeldeWOZWaardeVanWoningen_1), year, peildatum: `1 januari ${year}`, table: WOZ_TABLE };
}

export function buildGemeenteNamesUrl() {
  const params = new URLSearchParams({ $filter: "startswith(Key,'GM')", $select: 'Key,Title' });
  return `${CBS_BASE}/${WIJK_TABLE}/WijkenEnBuurten?${params}`;
}

// ── Crime: police "Geregistreerde misdrijven; soort misdrijf, wijk, buurt" ──
// CBS dataderden table 47018NED (catalog Politie). One batched query per level
// (wijken, buurten): totals and the sub-layer categories for CRIME_PERIOD and
// the year before (trend). Rates divide by the 86165NED (2025) inhabitants.

export const CRIME_BASE   = 'https://dataderden.cbs.nl/ODataApi/odata';
export const CRIME_TABLE  = '47018NED';
export const CRIME_PERIOD = '2025JJ00';          // last full year (table covers 2012–2025)
export const CRIME_PREV_PERIOD = '2024JJ00';     // for the trend
export const CRIME_TOTAL  = '0.0.0 ';            // SoortMisdrijf "Totaal misdrijven" (CBS pads keys to 6 chars)
export const CRIME_COLUMN = 'GeregistreerdeMisdrijven_1';
// Sub-layers: value key → SoortMisdrijf keys summed (padded as CBS returns them).
// Geweld = all of 1.4.x: zeden, moord/doodslag, openlijk geweld, bedreiging,
// mishandeling, straatroof, overval (CBS' own "geweldsmisdrijven" grouping).
export const CRIME_CATEGORIES = Object.freeze({
  crimeBurglary:   Object.freeze(['1.1.1 ']),     // Diefstal/inbraak woning
  crimeBike:       Object.freeze(['1.2.3 ']),     // Diefstal van brom-, snor-, fietsen
  crimePickpocket: Object.freeze(['1.2.4 ']),     // Zakkenrollerij
  crimeViolence:   Object.freeze(['1.4.1 ', '1.4.2 ', '1.4.3 ', '1.4.4 ', '1.4.5 ', '1.4.6 ', '1.4.7 ']),
});
// Below this many inhabitants a per-1,000 rate is meaningless (port/industrial
// areas with a few hundred residents and thousands of incidents): rate = null.
export const CRIME_MIN_POPULATION = 1000;        // wijken
export const CRIME_MIN_POPULATION_BUURT = 200;   // buurten

const crimeKey = k => String(k ?? '').trim();

/** One 47018NED URL for every area under `prefix` (WK0599 / BU0599): total + categories, two years. */
export function buildCrimeUrl(prefix = ROTTERDAM.wijkPrefix) {
  const kinds = [CRIME_TOTAL, ...Object.values(CRIME_CATEGORIES).flat()];
  const params = new URLSearchParams({
    $filter: `startswith(WijkenEnBuurten,'${prefix}') and (Perioden eq '${CRIME_PERIOD}' or Perioden eq '${CRIME_PREV_PERIOD}') and (${kinds.map(k => `SoortMisdrijf eq '${k}'`).join(' or ')})`,
    $select: `WijkenEnBuurten,Perioden,SoortMisdrijf,${CRIME_COLUMN}`,
  });
  return `${CRIME_BASE}/${CRIME_TABLE}/TypedDataSet?${params}`;
}
export const buildWijkCrimeUrl  = () => buildCrimeUrl(ROTTERDAM.wijkPrefix);
export const buildBuurtCrimeUrl = () => buildCrimeUrl(ROTTERDAM.buurtPrefix);

/** Misdrijven per 1,000 inhabitants (1 decimal), or null when either is unknown or the population is too small. */
export function crimeRatePer1000(total, population, minPopulation = CRIME_MIN_POPULATION) {
  return per1000(total, population, minPopulation);
}

/** % change from prev to cur (1 decimal), null when either is unknown or prev is 0. */
export function percentChange(cur, prev) {
  const c = toNumber(cur), p = toNumber(prev);
  if (c == null || p == null || p === 0) return null;
  return +((c - p) / p * 100).toFixed(1);
}

/**
 * 47018NED rows → Map(code → { total, totalPrev, crimeBurglary, crimeBike, crimePickpocket, crimeViolence })
 * with counts for CRIME_PERIOD (totalPrev: CRIME_PREV_PERIOD). A summed category
 * is null only when all its parts are null (police suppress some small cells).
 */
export function aggregateCrime(rows) {
  const out = new Map();
  const catOf = new Map();
  for (const [key, kinds] of Object.entries(CRIME_CATEGORIES)) for (const k of kinds) catOf.set(crimeKey(k), key);
  const total = crimeKey(CRIME_TOTAL);
  for (const r of rows ?? []) {
    const code = normalizeAreaCode(r?.WijkenEnBuurten);
    if (!code) continue;
    if (!out.has(code)) out.set(code, { total: null, totalPrev: null, ...Object.fromEntries(Object.keys(CRIME_CATEGORIES).map(k => [k, null])) });
    const agg = out.get(code);
    const v = toNumber(r[CRIME_COLUMN]);
    const kind = crimeKey(r.SoortMisdrijf);
    const period = String(r.Perioden ?? '').trim();
    if (period === CRIME_PREV_PERIOD) { if (kind === total) agg.totalPrev = v; continue; }
    if (period !== CRIME_PERIOD) continue;
    if (kind === total) { agg.total = v; continue; }
    const key = catOf.get(kind);
    if (key && v != null) agg[key] = (agg[key] ?? 0) + v;
  }
  return out;
}

/**
 * Returns new areas with crime values from 47018NED rows: totalCrimes and
 * <category>Count (counts, for the Absoluut mode),
 * crimeRate and the CRIME_CATEGORIES rates per 1,000 inhabitants, and
 * crimeTrend (% change of the total vs the previous year, panel only).
 * Areas without a crime row are returned unchanged.
 */
export function mergeCrime(areas, rows, { minPopulation = CRIME_MIN_POPULATION } = {}) {
  const agg = aggregateCrime(rows);
  return areas.map(a => {
    const c = agg.get(a.code);
    if (!c) return a;
    const pop = a.values?.population;
    const rates = Object.fromEntries(Object.keys(CRIME_CATEGORIES).map(k => [k, crimeRatePer1000(c[k], pop, minPopulation)]));
    // Raw counts for the "Absoluut" crime mode (DATASETS[key].countKey): no population threshold.
    const counts = Object.fromEntries(Object.keys(CRIME_CATEGORIES).map(k => [`${k}Count`, c[k]]));
    return { ...a, values: { ...a.values, totalCrimes: c.total, crimeRate: crimeRatePer1000(c.total, pop, minPopulation), ...rates, ...counts, crimeTrend: percentChange(c.total, c.totalPrev) } };
  });
}

/** Wijk variant (CRIME_MIN_POPULATION). */
export const mergeWijkCrime = (areas, rows) => mergeCrime(areas, rows, { minPopulation: CRIME_MIN_POPULATION });

const defaultStorage = () => { try { return globalThis.sessionStorage; } catch { return null; } };

let areasPromise = null;
let indexPromise = null;

/**
 * Loads all Rotterdam wijken and buurten with their values (cached).
 * Resolves to { wijken: Area[], buurten: Area[], city: Area & { woz }, geo: { gemeente, wijken, buurten }, bounds, dataOk, dataYears }
 * where Area = { code, name, level, parent, values: { [datasetKey]: number|null }, years: { [key]: fallbackYear }, bounds }.
 * Geometry failures reject; a CBS failure still resolves (all values null, dataOk false).
 * Crime comes from police table 47018NED, the 2024 fallback from 85984NED and
 * city.woz (2026) from 85036NED; each is best-effort (null values when it fails).
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
    const best = url => getJSON(url, fetcher, storage).then(d => d.value ?? []).catch(() => []);
    const wijkCrime  = best(buildWijkCrimeUrl());
    const buurtCrime = best(buildBuurtCrimeUrl());
    const fallback   = best(buildWijkUrl(WIJK_FALLBACK_TABLE));
    const cityWoz    = best(buildCityWozUrl()).then(parseCityWoz);
    try {
      rows = (await getJSON(buildWijkUrl(), fetcher, storage)).value ?? [];
    } catch {
      dataOk = false;
    }
    const oldRows = await fallback;
    const wijken  = mergeCrime(joinAreas(wijkGeo.features, rows, oldRows), await wijkCrime, { minPopulation: CRIME_MIN_POPULATION });
    const buurten = mergeCrime(joinAreas(buurtGeo.features, rows, oldRows), await buurtCrime, { minPopulation: CRIME_MIN_POPULATION_BUURT });
    const [city] = joinAreas([{ properties: { statcode: ROTTERDAM.gemeente, statnaam: ROTTERDAM.name } }], rows, oldRows);
    return {
      wijken,
      buurten,
      city:    { ...city, woz: await cityWoz },
      geo:     { gemeente, wijken: wijkGeo, buurten: buurtGeo },
      bounds:  geoBounds(gemeente),
      dataOk,
      dataYears: describeDataYears([...wijken, ...buurten]),
    };
  })();
  areasPromise.catch(() => { areasPromise = null; });
  return areasPromise;
}

/**
 * Flat search index (cached): Array<{ code, name, level: 'wijk'|'buurt'|'gemeente'|'provincie',
 * scope: 'rotterdam'|'nederland', parent? }>. Provinces come from data/provinces.json,
 * gemeenten from the CBS 86165NED region list, wijken/buurten from loadRotterdamAreas().
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
