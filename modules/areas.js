// City wijken + buurten (config/cities.json; Rotterdam is the default): CBS "Kerncijfers wijken en buurten 2025"
// (table 86165NED, per-field fallback to 2024 table 85984NED) joined to
// pre-cached PDOK geometry in data/ (indeling 2024; all 21 wijk and 91 buurt
// codes are identical in the 2025 table).
// Pure helpers are exported for the unit tests; loaders take injectable
// fetcher/storage so they run under node --test as well as in the browser.
import { DATASETS, DATASET_KEYS } from './datasets.js';
import { addPc4Shares } from './herkomst-pc4.js';
import { addBouwShares } from './bouwjaar-pc4.js';
import { addP2000Values } from './p2000.js';
import { addEduValues } from './onderwijs.js';
import { addMilieuValues } from './milieu.js';
import { withWoonscore } from './presets.js';
import { adjacencyFromFeatures, addOmgeving } from './omgeving.js';
import { loadOvAfstand, withOvValues } from './ov.js';
import { odataUrl, getRows, POLITIE_ODATA } from './source.js';
import { CITY, cityCodes } from './city.js';

export { DATASETS, DATASET_KEYS };


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
  age15to24:           'k_15Tot25Jaar_9',                    // aantal
  age25to44:           'k_25Tot45Jaar_10',                   // aantal
  age45to64:           'k_45Tot65Jaar_11',                   // aantal
  age65plus:           'k_65JaarOfOuder_12',                 // aantal
  originDutch:         'Nederland_17',                       // herkomstland Nederland, aantal
  originEurope:        'EuropaExclusiefNederland_18',        // herkomstland Europa excl. NL, aantal
  originOutsideEurope: 'BuitenEuropa_19',                    // herkomstland buiten Europa, aantal
  bornAbroadEurope:    'EuropaExclusiefNederland_23',        // geboren buiten NL, herkomst Europa excl. NL, aantal
  bornAbroadOutside:   'BuitenEuropa_24',                    // geboren buiten NL, herkomst buiten Europa, aantal
  households:          'HuishoudensTotaal_29',               // aantal
  singleHouseholds:    'Eenpersoonshuishoudens_30',          // aantal (v0.30, wizard Levenstype solo)
  householdsWithKids:  'HuishoudensMetKinderen_32',          // aantal
  density:             'Bevolkingsdichtheid_34',             // inwoners per km²
  wozValue:            'GemiddeldeWOZWaardeVanWoningen_39',  // ×€1,000
  housingStock:        'Woningvoorraad_35',                  // aantal woningen (woongebied.js)
  nonResidentialStock: 'NietWoningvoorraad_37',              // aantal verblijfsobjecten zonder woonfunctie
  businesses:          'BedrijfsvestigingenTotaal_95',       // aantal bedrijfsvestigingen
  landArea:            'OppervlakteLand_116',                // ha land (stored as km²: omgeving.js, crime per km²)
  waterArea:           'OppervlakteWater_117',               // ha water (waterPct, wizard Levenstype solo)
  lowEdu:              'BasisonderwijsVmboMbo1_67',          // aantal, hoogst behaald
  medEdu:              'HavoVwoMbo24_68',                    // aantal
  highEdu:             'HboWo_69',                           // aantal
  avgIncome:           'GemGestandaardiseerdInkomen_83',     // gem. gestandaardiseerd inkomen huishouden, ×€1,000
  ownerOccupied:       'Koopwoningen_47',                    // % van de woningvoorraad
  rental:              'HuurwoningenTotaal_48',              // %
  builtLast10:         'BouwjaarAfgelopenTienJaar_52',       // % van de woningvoorraad, bouwjaar in de laatste tien jaar
  welfare:             'PersonenPerSoortUitkeringBijstand_87', // personen met bijstand, aantal
  distGP:              'AfstandTotHuisartsenpraktijk_110',   // km, gemiddeld over inwoners
  distSupermarket:     'AfstandTotGroteSupermarkt_111',      // km
  distKinderopvang:    'AfstandTotKinderdagverblijf_112',    // km (= 86270NED AfstandTotKinderdagverblijf_52)
  distSchool:          'AfstandTotSchool_113',               // km, basisonderwijs (= 86270NED AfstandTotSchool_60)
});
export const WIJK_SELECT = Object.values(WIJK_COLUMNS).join(',');

// CBS "Nabijheid voorzieningen; afstand locatie, wijk- en buurtcijfers 2025"
// (86270NED), per-field fallback to the 2024 table 86134NED. The kerncijfers
// table carries only a few of its distances (huisarts, supermarkt, school,
// kinderdagverblijf); station and horeca come from here. Keys checked in the
// DataProperties of both tables on 15 Nov 2026: identical.
export const NABIJ_TABLE = '86270NED';
export const NABIJ_YEAR  = 2025;
export const NABIJ_FALLBACK_TABLE = '86134NED';
export const NABIJ_FALLBACK_YEAR  = 2024;
export const NABIJ_COLUMNS = Object.freeze({
  region:         'WijkenEnBuurten',
  distStation:    'AfstandTotTreinstationsTotaal_90',   // km over de weg, gemiddeld over inwoners
  distCafe:       'AfstandTotCafeED_36',                // km
  cafes1km:       'Binnen1Km_37',                       // gem. aantal cafés e.d. binnen 1 km
  restaurants1km: 'Binnen1Km_45',                       // gem. aantal restaurants binnen 1 km
  // v0.35 wizard step "Wat wil je dichtbij?" (same keys in 86134NED, checked 15 Nov 2026)
  distWarenhuis:  'AfstandTotWarenhuis_32',             // km
  distPodium:     'AfstandTotPodiumkunstenTotaal_99',   // km, theater/concertzaal/poppodium
  distBioscoop:   'AfstandTotBioscoop_104',             // km
  distAttractie:  'AfstandTotAttractie_110',            // km, attractie/pretpark/dierentuin
});
export const NABIJ_SELECT = Object.values(NABIJ_COLUMNS).join(',');

// Distance to green and nature (v0.35, wizard "Wat wil je dichtbij?"). CBS
// leaves the green columns of every nabijheid table from 2018 to 2025 empty
// (checked 15 Nov 2026: 84463NED … 86270NED all null); the newest filled one
// is the 2017 table 84334NED (Bestand Bodemgebruik 2015, indeling 2017). Joined
// by code; a buurt whose 2017 code is gone takes its wijk's 2017 figure, an
// area with neither stays null. Always marked as year 2017 (Peiljaar).
export const GROEN_TABLE = '84334NED';
export const GROEN_YEAR  = 2017;
export const GROEN_COLUMNS = Object.freeze({
  region:         'WijkenEnBuurten',
  distGroen:      'AfstandTotOpenbaarGroenTotaal_91',   // km: park, plantsoen, dagrecreatie, bos, open natuur
  distRecreatie:  'AfstandTotDagrecreatiefTerrein_93',  // km: recreatiegebied, speeltuin, strandbad …
  distBos:        'AfstandTotBos_94',                   // km
  distOpenNatuur: 'AfstandTotOpenNatTerreinTotaal_95',  // km: heide, duin, moeras, open droog/nat natuurlijk terrein
});
export const GROEN_SELECT = Object.values(GROEN_COLUMNS).join(',');

// The city's main station (config/cities.json `centrum`, Rotterdam Centraal
// station entrance for Rotterdam), reference point of distCentrum.
export const CENTRUM_POINT = Object.freeze([...CITY.centrum.point]);   // [lat, lng]

/** CBS codes of the city on this page: { gemeente, wijkPrefix, buurtPrefix } (city.js cityCodes). */
export const CITY_CODES = cityCodes(CITY);

/** Geometry files of a city (config/cities.json `geo`) plus the province shapes. */
export const geoUrlsFor = city => Object.freeze({ ...city.geo, provinces: './data/provinces.json' });
export const GEO_URLS = geoUrlsFor(CITY);

/**
 * Snapshot keys of the city tables (data/snapshot/<key>.json; registered per
 * city in scripts/snapshot-sources.mjs): 'cbs/86165NED-rotterdam' and so on.
 */
export function citySourceKeys(city = CITY) {
  const s = city.slug;
  return Object.freeze({
    kwb: `cbs/86165NED-${s}`, kwbFallback: `cbs/85984NED-${s}`,
    nabij: `cbs/86270NED-${s}`, nabijFallback: `cbs/86134NED-${s}`, groen: `cbs/84334NED-${s}`,
    woz: `cbs/85036NED-${s}-woz`, crimeWijk: `politie/47018NED-${s}-wijk`, crimeBuurt: `politie/47018NED-${s}-buurt`,
  });
}

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
  if (/^WK\d{4}[0-9A-Z]{2}$/.test(c)) return 'wijk';    // Amsterdam: WK0363AA
  if (/^BU\d{4}[0-9A-Z]{4}$/.test(c)) return 'buurt';   // Amsterdam: BU0363AA01
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
  const abroadE = toNumber(r[C.bornAbroadEurope]), abroadO = toNumber(r[C.bornAbroadOutside]);
  return {
    ...values,
    population,
    avgIncome:     toNumber(r[C.avgIncome]),
    crimeRate:     null,                        // not in 85984NED; wijken get it from mergeWijkCrime
    highEdu:       share(high, eduTotal),
    wozValue:      toNumber(r[C.wozValue]),
    pop15to24:     share(r[C.age15to24], population),
    pop25to44:     share(r[C.age25to44], population),
    pop45to64:     share(r[C.age45to64], population),
    pop65plus:     share(r[C.age65plus], population),
    hhWithKidsPct: share(r[C.householdsWithKids], r[C.households]),
    singleHhPct:   share(r[C.singleHouseholds], r[C.households]),
    // Water share of the total area: the honest "ruimte/water" proxy (CBS has no land use per buurt since 2015).
    waterPct:      (() => { const l = toNumber(r[C.landArea]), w = toNumber(r[C.waterArea]); return l != null && w != null ? share(w, l + w) : null; })(),
    newBuildPct:   toNumber(r[C.builtLast10]),
    nonWesternPct: share(r[C.originOutsideEurope], population),
    originDutchPct:  share(r[C.originDutch], population),
    originEuropePct: share(r[C.originEurope], population),
    // Herkomst Nederland is by definition born in NL, so _23 + _24 is everyone born abroad.
    bornAbroadPct: abroadE != null && abroadO != null ? share(abroadE + abroadO, population) : null,
    density:       toNumber(r[C.density]),
    ownerOccupiedPct: toNumber(r[C.ownerOccupied]),
    rentalPct:     toNumber(r[C.rental]),
    welfarePer1000: per1000(r[C.welfare], population),
    distGP:        toNumber(r[C.distGP]),
    distSupermarket: toNumber(r[C.distSupermarket]),
    distSchool:    toNumber(r[C.distSchool]),
    distKinderopvang: toNumber(r[C.distKinderopvang]),
    // Panel-only extras (not choropleth datasets)
    lowEdu:        share(low, eduTotal),
    medEdu:        share(med, eduTotal),
    // Woongebied classification (woongebied.js): counts, panel/modal only
    housingStock:  toNumber(r[C.housingStock]),
    nonResidentialStock: toNumber(r[C.nonResidentialStock]),
    businesses:    toNumber(r[C.businesses]),
    // Land area in km² (CBS gives ha): crime per km² and the omgeving (omgeving.js)
    landArea:      toNumber(r[C.landArea]) != null ? toNumber(r[C.landArea]) / 100 : null,
  };
}

// Value keys taken over together from the fallback year: the education shares
// come from one triple of counts, so they never mix years.
// The herkomst shares travel together too, so the NL/Europa/buiten-Europa split is one year.
const FALLBACK_BUNDLES = [['lowEdu', 'medEdu', 'highEdu'], ['nonWesternPct', 'originDutchPct', 'originEuropePct', 'bornAbroadPct']];

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

/**
 * Maps one nabijheid row (86270NED or 86134NED, same keys) to value keys.
 * horeca1km = cafés + restaurants within 1 km (both averages over the
 * inhabitants, so the sum is exact); null unless both are known.
 */
export function extractNabijValues(row) {
  const N = NABIJ_COLUMNS, r = row ?? {};
  const cafes = toNumber(r[N.cafes1km]), rest = toNumber(r[N.restaurants1km]);
  return {
    distStation: toNumber(r[N.distStation]),
    distCafe:    toNumber(r[N.distCafe]),
    horeca1km:   cafes != null && rest != null ? +(cafes + rest).toFixed(1) : null,
    distWarenhuis: toNumber(r[N.distWarenhuis]),
    distPodium:    toNumber(r[N.distPodium]),
    distBioscoop:  toNumber(r[N.distBioscoop]),
    distAttractie: toNumber(r[N.distAttractie]),
  };
}

/** Green/nature distances of one 84334NED row (null row → all null). */
export function extractGroenValues(row) {
  const G = GROEN_COLUMNS, r = row ?? {};
  return {
    distGroen: toNumber(r[G.distGroen]), distRecreatie: toNumber(r[G.distRecreatie]),
    distBos: toNumber(r[G.distBos]), distOpenNatuur: toNumber(r[G.distOpenNatuur]),
  };
}

/**
 * Green values for `code` from 2017 rows by code: the own row, else (buurt)
 * the parent wijk's row. { values, years } with every known value marked GROEN_YEAR.
 */
export function groenValuesFor(code, byCode) {
  const row = byCode.get(code) ?? (areaLevel(code) === 'buurt' ? byCode.get(parentCode(code)) : null) ?? null;
  const values = extractGroenValues(row);
  const years = {};
  for (const [k, v] of Object.entries(values)) if (v != null) years[k] = GROEN_YEAR;
  return { values, years };
}

/** Nabijheid values with a per-field fallback to the older table: { values, years }. */
export function mergeNabijValues(row, fallbackRow, fallbackYear = NABIJ_FALLBACK_YEAR) {
  const values = extractNabijValues(row);
  const years = {};
  if (!fallbackRow) return { values, years };
  const old = extractNabijValues(fallbackRow);
  for (const key of Object.keys(values)) {
    if (values[key] == null && old[key] != null) { values[key] = old[key]; years[key] = fallbackYear; }
  }
  return { values, years };
}

/**
 * [lat, lng] centroid of a (Multi)Polygon geometry/feature: area-weighted over
 * the outer rings (holes ignored), in lng scaled by cos(lat) so the weights are
 * near-true areas. Falls back to the mean vertex for degenerate rings. Null
 * without polygon coordinates.
 */
export function geoCentroid(geo) {
  const g = geo?.type === 'Feature' ? geo.geometry : geo;
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : null;
  if (!polys?.length) return null;
  let A = 0, cx = 0, cy = 0, n = 0, sx = 0, sy = 0;
  for (const poly of polys) {
    const ring = poly?.[0];
    if (!ring?.length) continue;
    const k = Math.cos(ring[0][1] * Math.PI / 180);
    let a = 0, x = 0, y = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
      const f = x0 * k * y1 - x1 * k * y0;
      a += f; x += (x0 * k + x1 * k) * f; y += (y0 + y1) * f;
      sx += x0; sy += y0; n++;
    }
    a /= 2;
    if (Math.abs(a) < 1e-12) continue;
    A += Math.abs(a); cx += (x / (6 * a)) / k * Math.abs(a); cy += (y / (6 * a)) * Math.abs(a);
  }
  if (A > 0) return [cy / A, cx / A];
  return n ? [sy / n, sx / n] : null;
}

/** Great-circle distance in km between two [lat, lng] points. */
export function haversineKm([lat1, lng1], [lat2, lng2]) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Straight-line km (1 decimal) from a feature's centroid to the city's centrum point (Rotterdam Centraal), or null. */
export function distanceToCentrum(feature, point = CENTRUM_POINT) {
  const c = geoCentroid(feature);
  return c ? +haversineKm(c, point).toFixed(1) : null;
}

const YEAR_FIELD_LABELS = {
  highEdu: 'opleiding', avgIncome: 'inkomen', wozValue: 'WOZ', population: 'inwoners', density: 'dichtheid',
  pop65plus: '65+', nonWesternPct: 'herkomst', ownerOccupiedPct: 'koopwoningen', rentalPct: 'huurwoningen',
  welfarePer1000: 'bijstand', distGP: 'huisarts', distSupermarket: 'supermarkt',
  pop15to24: '15–24', pop25to44: '25–44', pop45to64: '45–64', hhWithKidsPct: 'gezinnen', singleHhPct: 'eenpersoonshuishoudens', waterPct: 'water', newBuildPct: 'nieuwbouw', oldBuildPct: 'oude bouw', modernBuildPct: 'moderne bouw',
  distSchool: 'school', distKinderopvang: 'kinderopvang', distStation: 'station', distCafe: 'café', horeca1km: 'horeca',
  distWarenhuis: 'warenhuis', distPodium: 'podium', distBioscoop: 'bioscoop', distAttractie: 'attractie',
  distGroen: 'openbaar groen', distRecreatie: 'recreatiegebied', distBos: 'bos', distOpenNatuur: 'open natuur',
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
export function joinAreas(features, rows, fallbackRows = [], nabij = {}) {
  const centrum = nabij.centrum ?? CENTRUM_POINT;
  const base = rowsByCode(rows), old = rowsByCode(fallbackRows);
  const nBase = rowsByCode(nabij.rows), nOld = rowsByCode(nabij.fallbackRows), green = rowsByCode(nabij.groenRows);
  return features.map(f => {
    const code = normalizeAreaCode(f.properties?.statcode);
    const { values, years } = mergeYearValues(base.get(code) ?? null, old.get(code) ?? null);
    const nb = mergeNabijValues(nBase.get(code) ?? null, nOld.get(code) ?? null);
    const g = groenValuesFor(code, green);
    const near = { values: { ...nb.values, ...g.values }, years: { ...nb.years, ...g.years } };
    return {
      code,
      name:   f.properties?.statnaam ?? code,
      level:  areaLevel(code),
      parent: parentCode(code),
      values: withOvValues({ ...values, ...near.values, distCentrum: distanceToCentrum(f, centrum) }, code, nabij.ov),
      years:  { ...years, ...near.years },
      bounds: geoBounds(f),
    };
  });
}

// Keys the NL-wide fallback never fills: crime comes from the police table
// (mergeCrime, after this step) and the rest is derived later in the load.
const NL_FALLBACK_SKIP = new Set(['crimeRate', 'totalCrimes', 'crimeTrend', 'crimeDensity', 'crimeNearby', 'woonscore', 'stapel', 'distCentrum']);
const nlFallbackKey = k => !NL_FALLBACK_SKIP.has(k) && !k.startsWith('crime');

/**
 * Third per-field fallback (after 86165NED and 85984NED): every value that is
 * still null takes the NL-wide file's value for the same code (nl-areas.js
 * loadNlFallback), with that file's year (e.g. income 2023 from 85618NED) in
 * `years`; a value of the base year gets no year mark. Only keys the city area
 * already carries; never overwrites a non-null value. Bundles move together.
 */
export function mergeNlFallback(areas, nlByCode) {
  if (!nlByCode?.size) return areas;
  const bundled = new Set(FALLBACK_BUNDLES.flat());
  return areas.map(a => {
    const nl = nlByCode.get(a.code);
    if (!nl) return a;
    const values = { ...a.values }, years = { ...a.years };
    const ok = k => k in values && nlFallbackKey(k) && toNumber(nl.values?.[k]) != null;
    const take = k => {
      values[k] = toNumber(nl.values[k]);
      if (nl.years?.[k] != null) years[k] = nl.years[k]; else delete years[k];
    };
    let changed = false;
    for (const bundle of FALLBACK_BUNDLES) {
      if (bundle.some(k => values[k] == null) && bundle.every(ok)) { bundle.forEach(take); changed = true; }
    }
    for (const k of Object.keys(values)) {
      if (!bundled.has(k) && values[k] == null && ok(k)) { take(k); changed = true; }
    }
    return changed ? { ...a, values, years } : a;
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

/** City gemeente + wijk + buurt rows of a kerncijfers table (default: the 2025 base, the page's city). */
export function buildWijkUrl(table = WIJK_TABLE, select = WIJK_SELECT, city = CITY) {
  const c = cityCodes(city);
  return odataUrl(table, {
    filter: `startswith(WijkenEnBuurten,'${c.gemeente}') or startswith(WijkenEnBuurten,'${c.wijkPrefix}') or startswith(WijkenEnBuurten,'${c.buurtPrefix}')`,
    select,
  });
}

/** City rows of a nabijheid table (default: the 2025 base, 86270NED). */
export function buildNabijUrl(table = NABIJ_TABLE, city = CITY) {
  return buildWijkUrl(table, NABIJ_SELECT, city);
}

/** City rows of the 2017 green-distance table (84334NED). */
export function buildGroenUrl(city = CITY) {
  return buildWijkUrl(GROEN_TABLE, GROEN_SELECT, city);
}

// ── Newest city WOZ: CBS 85036NED "Gemiddelde WOZ-waarde van woningen; eigendom, regio" ──
// The only table with a 2026 figure (peildatum 1 januari); gemeente level only.
// Eigendom T001132 = Totaal (A047048 is "overige verhuurders", not the total).
export const WOZ_TABLE    = '85036NED';
export const WOZ_PERIOD   = '2026JJ00';
export const WOZ_EIGENDOM = 'T001132';

export function buildCityWozUrl(city = CITY) {
  return odataUrl(WOZ_TABLE, {
    filter: `RegioS eq '${city.gemeente}' and Eigendom eq '${WOZ_EIGENDOM}' and Perioden eq '${WOZ_PERIOD}'`,
    select: 'RegioS,Perioden,GemiddeldeWOZWaardeVanWoningen_1',
  });
}

/** { value (×€1,000), year, peildatum, table } from 85036NED rows, or null. */
export function parseCityWoz(rows) {
  const r = (rows ?? []).find(x => toNumber(x?.GemiddeldeWOZWaardeVanWoningen_1) != null);
  if (!r) return null;
  const year = Number(String(r.Perioden ?? WOZ_PERIOD).slice(0, 4));
  return { value: toNumber(r.GemiddeldeWOZWaardeVanWoningen_1), year, peildatum: `1 januari ${year}`, table: WOZ_TABLE };
}

export function buildGemeenteNamesUrl() {
  return odataUrl(WIJK_TABLE, { entity: 'WijkenEnBuurten', filter: "startswith(Key,'GM')", select: 'Key,Title' });
}

// ── Crime: police "Geregistreerde misdrijven; soort misdrijf, wijk, buurt" ──
// CBS dataderden table 47018NED (catalog Politie). One batched query per level
// (wijken, buurten): totals and the sub-layer categories for CRIME_PERIOD and
// the year before (trend). Rates divide by the 86165NED (2025) inhabitants.

export const CRIME_BASE   = POLITIE_ODATA;
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
  // v0.17.0 — keys checked against /47018NED/SoortMisdrijf on 15 Nov 2026. 1.4.4 and
  // 1.4.6 also count in crimeViolence: a kind may feed several layers.
  crimeStreetRobbery: Object.freeze(['1.4.6 ']),  // Straatroof
  crimeThreat:     Object.freeze(['1.4.4 ']),     // Bedreiging
  crimeVehicle:    Object.freeze(['1.2.1 ']),     // Diefstal uit/vanaf motorvoertuigen
  crimeShoplifting: Object.freeze(['2.5.2 ']),    // Winkeldiefstal
  crimeVandalism:  Object.freeze(['2.2.1 ']),     // Vernieling cq. zaakbeschadiging
  crimeDrugs:      Object.freeze(['3.1.1 ']),     // Drugshandel
});
// Below this many inhabitants a per-1,000 rate is meaningless (port/industrial
// areas with a few hundred residents and thousands of incidents): rate = null.
export const CRIME_MIN_POPULATION = 1000;        // wijken
export const CRIME_MIN_POPULATION_BUURT = 200;   // buurten

const crimeKey = k => String(k ?? '').trim();

/** One 47018NED URL for every area under `prefix` (WK0599 / BU0599): total + categories, two years. */
export function buildCrimeUrl(prefix = CITY_CODES.wijkPrefix, periods = [CRIME_PERIOD, CRIME_PREV_PERIOD]) {
  const kinds = [...new Set([CRIME_TOTAL, ...Object.values(CRIME_CATEGORIES).flat()])];
  return odataUrl(CRIME_TABLE, {
    base: CRIME_BASE,
    filter: `startswith(WijkenEnBuurten,'${prefix}') and (${periods.map(p => `Perioden eq '${p}'`).join(' or ')}) and (${kinds.map(k => `SoortMisdrijf eq '${k}'`).join(' or ')})`,
    select: `WijkenEnBuurten,Perioden,SoortMisdrijf,${CRIME_COLUMN}`,
  });
}
export const buildWijkCrimeUrl  = (city = CITY) => buildCrimeUrl(cityCodes(city).wijkPrefix);
export const buildBuurtCrimeUrl = (city = CITY) => buildCrimeUrl(cityCodes(city).buurtPrefix);

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
 * 47018NED rows → Map(code → { total, totalPrev, [CRIME_CATEGORIES key]: count })
 * with counts for CRIME_PERIOD (totalPrev: CRIME_PREV_PERIOD). A summed category
 * is null only when all its parts are null (police suppress some small cells).
 */
export function aggregateCrime(rows) {
  const out = new Map();
  const catOf = new Map();
  for (const [key, kinds] of Object.entries(CRIME_CATEGORIES)) for (const k of kinds) {
    const id = crimeKey(k);
    catOf.set(id, [...(catOf.get(id) ?? []), key]);
  }
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
    if (v != null) for (const key of catOf.get(kind) ?? []) agg[key] = (agg[key] ?? 0) + v;
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
let loadedAreas = null;   // resolved value of areasPromise (peekCityAreas)

/**
 * Loads all wijken and buurten of the city (default: the page's city) with their values (cached).
 * Resolves to { wijken: Area[], buurten: Area[], city: Area & { woz }, geo: { gemeente, wijken, buurten }, bounds, dataOk, dataYears }
 * where Area = { code, name, level, parent, values: { [datasetKey]: number|null }, years: { [key]: fallbackYear }, bounds }.
 * Geometry failures reject; a CBS failure still resolves (all values null, dataOk false).
 * Crime comes from police table 47018NED, the 2024 fallback from 85984NED and
 * city.woz (2026) from 85036NED; each is best-effort (null values when it fails).
 */
export function loadCityAreas({ fetcher = globalThis.fetch?.bind(globalThis), storage = defaultStorage(), city = CITY } = {}) {
  if (areasPromise) return areasPromise;
  areasPromise = (async () => {
    const geoUrls = geoUrlsFor(city);
    const keys = citySourceKeys(city);
    const codes = cityCodes(city);
    const [gemeente, wijkGeo, buurtGeo] = await Promise.all([
      getJSON(geoUrls.gemeente, fetcher, null),
      getJSON(geoUrls.wijken,   fetcher, null),
      getJSON(geoUrls.buurten,  fetcher, null),
    ]);
    let rows = [], dataOk = true;
    // Snapshot keys (data/snapshot/<key>.json, scripts/snapshot-sources.mjs); the URL is the live fallback.
    const src = (key, live) => getRows(key, { live, fetcher, storage });
    const best = (key, live) => src(key, live).catch(() => []);
    const wijkCrime  = best(keys.crimeWijk, buildWijkCrimeUrl(city));
    const buurtCrime = best(keys.crimeBuurt, buildBuurtCrimeUrl(city));
    const fallback   = best(keys.kwbFallback, buildWijkUrl(WIJK_FALLBACK_TABLE, WIJK_SELECT, city));
    const cityWoz    = best(keys.woz, buildCityWozUrl(city)).then(parseCityWoz);
    // NL-wide files (data/nl, nl-areas.js), third per-field fallback; lazy import: nl-areas imports this module.
    const nlP = import('./nl-areas.js')
      .then(m => Promise.all(['wijk', 'buurt'].map(l => m.loadNlFallback(l, codes.gemeente, { fetcher }).catch(() => new Map()))))
      .catch(() => [new Map(), new Map()]);
    const nabijP     = Promise.all([best(keys.nabij, buildNabijUrl(NABIJ_TABLE, city)), best(keys.nabijFallback, buildNabijUrl(NABIJ_FALLBACK_TABLE, city)), best(keys.groen, buildGroenUrl(city)), loadOvAfstand({ fetcher, url: city.ov.afstand })]);
    try {
      rows = await src(keys.kwb, buildWijkUrl(WIJK_TABLE, WIJK_SELECT, city));
    } catch {
      dataOk = false;
    }
    const oldRows = await fallback;
    const [nabijRows, nabijOld, groenRows, ov] = await nabijP;
    const nabij = { rows: nabijRows, fallbackRows: nabijOld, groenRows, ov, centrum: city.centrum.point };
    const [nlWijken, nlBuurten] = await nlP;
    const wijkenCrime = mergeCrime(mergeNlFallback(joinAreas(wijkGeo.features, rows, oldRows, nabij), nlWijken), await wijkCrime, { minPopulation: CRIME_MIN_POPULATION });
    const buurtenCrime = mergeCrime(mergeNlFallback(joinAreas(buurtGeo.features, rows, oldRows, nabij), nlBuurten), await buurtCrime, { minPopulation: CRIME_MIN_POPULATION_BUURT });
    // Shared-boundary neighbours from the loaded geometry (once per load; the
    // promise is cached): crime per km² and "criminaliteit in de omgeving".
    const wijkenRaw = addOmgeving(wijkenCrime, adjacencyFromFeatures(wijkGeo.features, { decimals: 5 }));
    const buurtenRaw = addOmgeving(buurtenCrime, adjacencyFromFeatures(buurtGeo.features, { decimals: 5 }));
    // Woonscore per level among its peers; buurt rates shrink toward the parent wijk.
    addBouwShares(wijkenRaw); addBouwShares(buurtenRaw);   // bouwstijl via postcode (v0.29.0), once loaded
    addPc4Shares(wijkenRaw); addPc4Shares(buurtenRaw);   // postcode herkomst (v0.25.0), once loaded
    addP2000Values(wijkenRaw); addP2000Values(buurtenRaw);   // P2000 meldingen (W30), once loaded; no score uses them
    addEduValues(wijkenRaw); addEduValues(buurtenRaw);
    addMilieuValues(wijkenRaw); addMilieuValues(buurtenRaw);   // milieu (plan-milieu), once loaded   // onderwijsprestatie basisscholen, once loaded
    const wijken  = withWoonscore(wijkenRaw);
    const buurten = withWoonscore(buurtenRaw, { parents: wijkenRaw });
    const [whole] = joinAreas([{ properties: { statcode: codes.gemeente, statnaam: city.name } }], rows, oldRows, { centrum: city.centrum.point });
    return {
      wijken,
      buurten,
      city:    { ...whole, woz: await cityWoz },
      geo:     { gemeente, wijken: wijkGeo, buurten: buurtGeo },
      bounds:  geoBounds(gemeente),
      dataOk,
      dataYears: describeDataYears([...wijken, ...buurten]),
    };
  })();
  areasPromise.then(a => { loadedAreas = a; }, () => { areasPromise = null; });
  return areasPromise;
}

/**
 * Flat search index (cached): Array<{ code, name, level: 'wijk'|'buurt'|'gemeente'|'provincie',
 * scope: 'rotterdam'|'nederland', parent? }>. Provinces come from data/provinces.json,
 * gemeenten from the CBS 86165NED region list, wijken/buurten of the city from loadCityAreas().
 * Any source that fails is left out rather than failing the whole index.
 */
export function getAreaIndex({ fetcher = globalThis.fetch?.bind(globalThis), storage = defaultStorage() } = {}) {
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    const [areas, provGeo, gmRows] = await Promise.all([
      loadCityAreas({ fetcher, storage }).catch(() => ({ wijken: [], buurten: [] })),
      getJSON(GEO_URLS.provinces, fetcher, null).catch(() => ({ features: [] })),
      getRows('cbs/86165NED-gemeenten', { live: buildGemeenteNamesUrl(), fetcher, storage }).catch(() => []),
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

/** The city areas once loadCityAreas() has resolved, else null (never starts a load). */
export function peekCityAreas() { return loadedAreas; }

/** Test hook: forget cached loads. */
export function _resetAreaCache() { areasPromise = null; indexPromise = null; loadedAreas = null; }
