// Milieu per buurt → data/nl/milieu-buurt-2025.json (docs/plan-milieu.md, phase 1).
// Sources (WFS GET without geometry, buurt indeling 2024, 14 574 buurten; checked 16 Nov 2026):
//   RIVM Atlas Leefomgeving  alo:rivm_20251201_geluidhinder_bu_weg_2024 — every *_bu_*_2024 layer carries
//     the same record: b_gel_weg, b_gel_bu, b_gel_trei, b_gel_vv, b_gel_wtn (% volwassenen ernstig
//     gehinderd, GGD Gezondheidsmonitor 2024, small-area estimates). Licence: Public Domain Mark 1.0
//     (NGR 64d24969-6abf-4208-b7b4-a8d582382829, cc274128-d00c-4521-a868-261a32bb909f).
//   Klimaateffectatlas  kea_public:GevoelstemperatuurBuurt_2022 (PET_gem / _mean °C) and
//     kea_public:BD_buurtdashboard_20260312 (P_schaduw_fw). Licence: CC BY 4.0, "Klimaateffectatlas, 2026".
// Buurt 2024 → 2025: by code where the 2025 code still exists, else the 2024 buurt with the largest
// area overlap (sampled on a 12×12 grid inside the 2025 polygon, PDOK buurt_gegeneraliseerd 2024/2025).
// Wijk, gemeente and provincie: population-weighted means of the 2025 buurten (CBS 2025 inwoners);
// gemeente → provincie by majority of the buurt centres, as scripts/build-schools.mjs.
// Phase 2 (computed on the 2025 polygons directly, no 2024 mapping):
//   Luchtkwaliteit: RIVM WCS https://data.rivm.nl/geo/alo/wcs, alo__rivm_jaargemiddeld_NO2_actueel and
//     ..._PM25_actueel (GCN/NSL jaargemiddelde 2024, 25 m grid, µg/m³). The server refuses reads over
//     256 MB, so the build fetches 50 × 50 km tiles at scaleFactor 0.25 (100 m, nearest neighbour; 42 tiles
//     per coverage, archived) and averages the values on a 100 m RD grid inside each buurt
//     (area-weighted; a buurt with no grid point takes the value at its centre).
//   Afstand tot verdachte PFAS-bron: km from the buurt centre (data/nl/buurt-centres-2025.json) to the
//     nearest presumptive source of modules/pfas-points.js in the Pfoisened export of the PFAS Data Hub
//     (all countries in the file, so border buurten see sources across the border).
// Usage: node scripts/build-nl-milieu.mjs [--refresh]   (PFOISENED_POINTS overrides the PFAS file)
import { readFile, writeFile } from 'node:fs/promises';
import { pointInRings } from '../modules/score-labels.js';
import { NL_GEO_TYPES, NL_DATA_YEAR } from '../modules/nl-areas.js';
import { pdokGebiedsindelingen } from '../modules/source.js';
import {
  MILIEU_FORMAT, MILIEU_KEYS, MILIEU_URL, HINDER_FIELDS, HINDER_YEAR, PET_YEAR, SHADE_YEAR, AIR_YEAR,
  rasterValueAt, rasterMeanOver, nearestKm, rivmValues, cleanValue, mapBuurten, samplePoints, largestOverlap, bboxOf, weightedMeans, encodeMilieuLevel,
} from '../modules/milieu.js';
import { archived, archivedJson, sourceForUrl, today } from './lib/raw-archive.mjs';
import { readFloatTiff } from './lib/geotiff.mjs';
import { isPfasSource } from '../modules/pfas-points.js';

const RIVM_WFS = 'https://data.rivm.nl/geo/alo/wfs';
const KEA_WFS = 'https://cas.cloud.sogelink.com/public/data/org/gws/YWFMLMWERURF/kea_public/wfs';
const RIVM_TYPE = 'alo:rivm_20251201_geluidhinder_bu_weg_2024';
const PET_TYPE = 'kea_public:GevoelstemperatuurBuurt_2022';
const SHADE_TYPE = 'kea_public:BD_buurtdashboard_20260312';
const RIVM_WCS = 'https://data.rivm.nl/geo/alo/wcs';
const AIR_COVERAGES = { airNo2: 'alo__rivm_jaargemiddeld_NO2_actueel', airPm25: 'alo__rivm_jaargemiddeld_PM25_actueel' };
const AIR_KEYS = Object.keys(AIR_COVERAGES);
const PHASE2_KEYS = [...AIR_KEYS, 'pfasSourceKm'];
const PFOISENED_POINTS = process.env.PFOISENED_POINTS ?? '/nebula/apps/pfoisened/data/points.json';
const TILE = 50000;
const OUT = new URL('../data/nl/', import.meta.url);
const OUT_FILE = new URL(MILIEU_URL.replace('./data/nl/', ''), OUT);
const round1 = v => (v == null ? null : Math.round(v * 10) / 10);

/** Every feature of a WFS type (paged, sorted on `sortBy`); properties only unless `geometry`. */
async function wfsAll(base, typeName, { props = null, sortBy, srsName = null, page = 5000 } = {}) {
  const out = [];
  for (let start = 0; ; start += page) {
    const params = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: typeName, outputFormat: 'application/json', count: String(page), startIndex: String(start), sortBy });
    if (props) params.set('propertyName', props.join(','));
    if (srsName) params.set('srsName', srsName);
    const json = await archivedJson(sourceForUrl(base + '/'), `${base}?${params}`);
    out.push(...(json.features ?? []));
    process.stdout.write(`\r${typeName}: ${out.length}   `);
    if ((json.features ?? []).length < page) break;
  }
  process.stdout.write('\n');
  return out;
}

/** PDOK buurt_gegeneraliseerd of `year` (WGS84) → [{ code, polys, bbox }]. Same query as build-schools (archive hit for 2025). */
async function buurtPolygons(year) {
  const base = pdokGebiedsindelingen(year);
  const feats = [];
  for (let start = 0; ; start += 1000) {
    const params = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: `gebiedsindelingen:${NL_GEO_TYPES.buurt}`, outputFormat: 'application/json', srsName: 'EPSG:4326', count: '1000', startIndex: String(start), sortBy: 'statcode' });
    const page = await archivedJson(sourceForUrl(base + '/'), `${base}?${params}`);
    feats.push(...(page.features ?? []));
    process.stdout.write(`\rPDOK buurten ${year}: ${feats.length}   `);
    if ((page.features ?? []).length < 1000) break;
  }
  process.stdout.write('\n');
  return feats.filter(f => f.geometry).map(f => {
    const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    return { code: String(f.properties?.statcode ?? '').trim(), polys, bbox: bboxOf(polys) };
  });
}

/** Every 50 km tile of a WCS coverage at 100 m (RD extent 0–300 km × 300–650 km). */
async function airTiles(coverageId) {
  const tiles = [];
  for (let x = 0; x < 300000; x += TILE) for (let y = 300000; y < 650000; y += TILE) {
    const params = new URLSearchParams({ service: 'WCS', version: '2.0.1', request: 'GetCoverage', coverageId, format: 'image/tiff', scaleFactor: '0.25' });
    const url = `${RIVM_WCS}?${params}&subset=X(${x},${x + TILE})&subset=Y(${y},${y + TILE})`;
    const { buf } = await archived(sourceForUrl(RIVM_WCS + '/'), url, { name: `${coverageId}_${x}_${y}.tif`, accept: 'image/tiff' });
    tiles.push(readFloatTiff(buf));
    process.stdout.write(`\r${coverageId}: ${tiles.length} tiles   `);
  }
  process.stdout.write('\n');
  return tiles;
}

// ── Read the sources ─────────────────────────────────────────────────────────
const rivm = await wfsAll(RIVM_WFS, RIVM_TYPE, { props: ['buurtcode', ...Object.values(HINDER_FIELDS)], sortBy: 'buurtcode' });
const pet = await wfsAll(KEA_WFS, PET_TYPE, { props: ['buurtcode', 'PET_gem', '_mean'], sortBy: 'buurtcode' });
const shade = await wfsAll(KEA_WFS, SHADE_TYPE, { props: ['buurtcode', 'P_schaduw_fw'], sortBy: 'buurtcode' });

/** buurt 2024 → values */
const v2024 = new Map();
const put = (code, vals) => { const c = String(code ?? '').trim(); if (c) v2024.set(c, { ...v2024.get(c), ...vals }); };
for (const f of rivm) put(f.properties?.buurtcode, rivmValues(f.properties));
for (const f of pet) { const p = f.properties ?? {}; put(p.buurtcode, { heatPet: round1(cleanValue(p._mean) ?? cleanValue(p.PET_gem)) }); }
for (const f of shade) put(f.properties?.buurtcode, { shadePct: round1(cleanValue(f.properties?.P_schaduw_fw)) });
console.log(`buurt 2024: RIVM ${rivm.length}, PET ${pet.length}, schaduw ${shade.length}, codes ${v2024.size}`);

const readJson = async name => JSON.parse(await readFile(new URL(name, OUT), 'utf8'));
const buurten25 = await readJson(`buurten-${NL_DATA_YEAR}.json`);
const codes2025 = buurten25.codes;

// ── Buurt 2024 → 2025 ────────────────────────────────────────────────────────
let overlap = () => null;
const missing = codes2025.filter(c => !v2024.has(c));
const p25 = await buurtPolygons(NL_DATA_YEAR);
if (missing.length) {
  const p24 = await buurtPolygons(2024);
  const cands = p24.filter(p => v2024.has(p.code));
  const poly25 = new Map(p25.map(p => [p.code, p]));
  const intersects = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  overlap = code => {
    const p = poly25.get(code);
    if (!p) return null;
    const near = cands.filter(c => intersects(c.bbox, p.bbox));
    let pts = samplePoints(p.polys, pointInRings, 12);
    if (!pts.length) pts = [[(p.bbox[0] + p.bbox[2]) / 2, (p.bbox[1] + p.bbox[3]) / 2]];
    return largestOverlap(pts, near, pointInRings);
  };
}
const mapping = mapBuurten(codes2025, new Set(v2024.keys()), overlap);
console.log(`buurt 2025: ${codes2025.length}; by code ${mapping.byCode}, by area overlap ${mapping.byOverlap}, unmatched (geen data) ${mapping.unmatched.length}`);
if (mapping.unmatched.length) console.log(`  unmatched: ${mapping.unmatched.slice(0, 20).join(' ')}${mapping.unmatched.length > 20 ? ' …' : ''}`);

// ── Levels ───────────────────────────────────────────────────────────────────
const buurtVals = new Map();
const PHASE1_KEYS = MILIEU_KEYS.filter(k => !PHASE2_KEYS.includes(k));
for (const c25 of codes2025) {
  const c24 = mapping.map.get(c25);
  buurtVals.set(c25, Object.fromEntries(MILIEU_KEYS.map(k => [k, PHASE1_KEYS.includes(k) && c24 ? v2024.get(c24)?.[k] ?? null : null])));
}

// Phase 2: air quality (raster mean over the 2025 polygon) and distance to a presumptive PFAS source.
const centresFile = await readJson(`buurt-centres-${NL_DATA_YEAR}.json`);
const centreOf = new Map(centresFile.codes.map((c, i) => [c, [centresFile.lon[i], centresFile.lat[i]]]));
const polyOf = new Map(p25.map(p => [p.code, p.polys]));
const skipped = [];
for (const [key, cov] of Object.entries(AIR_COVERAGES)) {
  let tiles;
  try { tiles = await airTiles(cov); } catch (err) { skipped.push(`${key}: ${err.message.slice(0, 200)}`); console.warn(`SKIP ${key}: ${err.message.slice(0, 300)}`); continue; }
  const sample = (x, y) => rasterValueAt(tiles, x, y);
  let n = 0;
  for (const code of codes2025) {
    const polys = polyOf.get(code);
    const v = polys ? rasterMeanOver(polys, sample, pointInRings, { step: 100, centre: centreOf.get(code) ?? null }) : null;
    buurtVals.get(code)[key] = v;
    if (++n % 2000 === 0) process.stdout.write(`\r${key}: ${n} buurten   `);
  }
  process.stdout.write('\n');
}
const pfasSources = JSON.parse(await readFile(PFOISENED_POINTS, 'utf8')).filter(isPfasSource).map(p => [p.lon, p.lat]);
console.log(`PFAS: ${pfasSources.length} verdachte bronnen (alle landen in het bestand)`);
for (const code of codes2025) { const c = centreOf.get(code); buurtVals.get(code).pfasSourceKm = c ? nearestKm(c, pfasSources) : null; }
for (const k of MILIEU_KEYS) console.log(`  ${k}: ${codes2025.filter(c => buurtVals.get(c)?.[k] == null).length} buurten 2025 geen data`);
const popCol = buurten25.cols.population;
const rows = codes2025.map((code, i) => ({ code, pop: popCol[i], values: buurtVals.get(code) ?? null }));

// Gemeente → provincie by majority of its buurt centres (point in data/provinces.json).
const provGeo = JSON.parse(await readFile(new URL('../provinces.json', OUT), 'utf8'));
const provPolys = provGeo.features.map(f => ({ code: String(f.properties?.statcode ?? '').trim(), polys: f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates] }));
const votes = new Map();
centresFile.codes.forEach((code, i) => {
  const pv = provPolys.find(p => p.polys.some(r => pointInRings([centresFile.lon[i], centresFile.lat[i]], r)))?.code;
  if (!pv) return;
  const gm = `GM${code.slice(2, 6)}`;
  if (!votes.has(gm)) votes.set(gm, new Map());
  votes.get(gm).set(pv, (votes.get(gm).get(pv) ?? 0) + 1);
});
const provOf = new Map([...votes].map(([gm, v]) => [gm, [...v].sort((a, b) => b[1] - a[1])[0][0]]));

const levels = {
  buurt: encodeMilieuLevel(new Map([...buurtVals].filter(([, v]) => MILIEU_KEYS.some(k => v[k] != null)))),
  wijk: encodeMilieuLevel(weightedMeans(rows, c => `WK${c.slice(2, 8)}`)),
  gemeente: encodeMilieuLevel(weightedMeans(rows, c => `GM${c.slice(2, 6)}`)),
  provincie: encodeMilieuLevel(weightedMeans(rows, c => provOf.get(`GM${c.slice(2, 6)}`) ?? null)),
};

const out = {
  format: MILIEU_FORMAT, year: NL_DATA_YEAR, built: today(), metrics: MILIEU_KEYS,
  sources: {
    hinder: `RIVM Atlas Leefomgeving ${RIVM_TYPE} (GGD Gezondheidsmonitor ${HINDER_YEAR}, modelschatting per buurt 2024); licentie Public Domain Mark 1.0`,
    gevoelstemperatuur: `Klimaateffectatlas ${PET_TYPE} (PET ${PET_YEAR}, buurt 2024); licentie CC BY 4.0 (Klimaateffectatlas, 2026)`,
    schaduw: `Klimaateffectatlas ${SHADE_TYPE} P_schaduw_fw (${SHADE_YEAR}); licentie CC BY 4.0 (Klimaateffectatlas, 2026)`,
    lucht: `RIVM Atlas Leefomgeving WCS ${Object.values(AIR_COVERAGES).join(', ')} (GCN/NSL jaargemiddelde ${AIR_YEAR}, µg/m³), 100 m-steekproef binnen de buurt 2025`,
    pfasBron: 'PFAS Data Hub (CNRS, https://pdh.cnrs.fr) via de Pfoisened-export: vermoedelijke bronnen (vliegvelden, militaire brandoefenterreinen, rwzi, papierfabrieken, E-PRTR, PDH); km vanaf het buurtmiddelpunt',
    indeling: `buurt 2024 → ${NL_DATA_YEAR}: zelfde code, anders grootste overlap (PDOK buurt_gegeneraliseerd 2024/${NL_DATA_YEAR}, 12×12 steekproefpunten)`,
    method: 'noiseAnyPct = 1 − Π(1 − p/100) over wegverkeer, trein, vliegverkeer, windturbines en buren (onafhankelijk verondersteld); wijk/gemeente/provincie = gemiddelde van de buurten gewogen naar inwoners 2025',
  },
  skipped,
  mapping: { byCode: mapping.byCode, byOverlap: mapping.byOverlap, unmatched: mapping.unmatched.length },
  noData: Object.fromEntries(MILIEU_KEYS.map(k => [k, codes2025.filter(c => buurtVals.get(c)?.[k] == null).length])),
  levels,
};
await writeFile(OUT_FILE, JSON.stringify(out));
const size = (await readFile(OUT_FILE)).length;
console.log(`wrote ${OUT_FILE.pathname} (${size} bytes): buurten ${levels.buurt.codes.length}, wijken ${levels.wijk.codes.length}, gemeenten ${levels.gemeente.codes.length}, provincies ${levels.provincie.codes.length}`);
for (const gm of ['GM0599', 'GM0363']) {
  const i = levels.gemeente.codes.indexOf(gm);
  console.log(gm, Object.fromEntries(MILIEU_KEYS.map(k => [k, levels.gemeente.cols[k][i]])));
}
