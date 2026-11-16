#!/usr/bin/env node
// Onderwijsprestatie basisscholen → data/nl/onderwijs-po-2024.json (plan-onderwijsprestatie.md, step 2).
//
// Sources (DUO CKAN portal onderwijsdata.duo.nl; resource URLs looked up through package_show):
//   wporeferentieniveau-v1  brin6_referentieniveau.csv  pupils per reference level, per test and vestiging
//   wpo-eindscores          brin6_eindscores.csv        pupils per vestiging (for the suppressed cells)
//   adressen_bo             vestigingenbo.csv           address of every BO vestiging
// Address → buurt: CBS pc6huisnr 2023 (.cache/pc4/, shared with build-pc4-herkomst.mjs), kept when the
// code also exists in the 2025 indeling; else the PDOK Locatieserver's buurtcode. Coordinates: PDOK
// (centroide_ll of the address, else of the postcode). PDOK answers are cached in .cache/duo/.
//
// Usage: node scripts/build-schools.mjs   (downloads into .cache/, gitignored; reruns are offline)
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import {
  parseCsv, scoreSchools, aggregate, shares, houseNumber, nearSchools, rollUpByPopulation,
  SUBJECT_KEYS, YEARS, SMALL_N, NEAR_RADIUS_KM, NEAR_BEST_KM,
} from '../modules/schools.js';
import { geoCentroid } from '../modules/areas.js';
import { pointInRings } from '../modules/score-labels.js';
import { encodeCentres } from '../modules/onderwijs.js';
import { NL_GEO_WFS, NL_GEO_TYPES, NL_DATA_YEAR } from '../modules/nl-areas.js';
import { archived, archivedJson, archivedFile, sourceForUrl, REFRESH } from './lib/raw-archive.mjs';

const CKAN = 'https://onderwijsdata.duo.nl/api/3/action/package_show';
const PDOK = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free';
const PC6_ZIP = 'https://download.cbs.nl/postcode/2023-cbs_pc6huisnr.zip';
const PC6_CSV = 'pc6hnr20230801_gwb.csv';
const FILES = [
  ['wporeferentieniveau-v1', 'brin6_referentieniveau.csv'],
  ['wpo-eindscores', 'brin6_eindscores.csv'],
  ['adressen_bo', 'vestigingenbo.csv'],
];
const OUT = new URL('../data/nl/', import.meta.url);
const DUO = new URL('../.cache/duo/', import.meta.url);
const PC4 = new URL('../.cache/pc4/', import.meta.url);
const GEOCACHE = new URL('pdok-geocode.json', DUO);
const OUT_NAME = 'onderwijs-po-2024.json';
const SCHOOLS_NAME = 'onderwijs-po-scholen-2024.json';
const CENTRES_NAME = `buurt-centres-${NL_DATA_YEAR}.json`;
const r5 = x => (x == null ? null : Math.round(x * 1e5) / 1e5);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'roffatistics-build' } });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await sleep(2000 * i);
    }
  }
}

/** Downloads a DUO file (URL from CKAN package_show) unless it is cached. */
async function duoFile(dataset, name) {
  // CKAN package_show and the CSV both go through the raw archive (raw/duo/<date>/); --refresh fetches anew.
  const pkg = await archivedJson('duo', `${CKAN}?id=${encodeURIComponent(dataset)}`, { name: `package-${dataset}.json` });
  const res = pkg.result?.resources?.find(r => String(r.url).endsWith(`/${name}`));
  if (!res) throw new Error(`${dataset}: no resource ${name}`);
  const got = await archived('duo', res.url, { name, accept: '*/*' });
  if (got.fresh) console.log(`downloaded ${res.url}`);
  return parseCsv(got.buf.toString('utf8'));
}

async function pc6Path() {
  const csv = new URL(PC6_CSV, PC4);
  if (existsSync(csv) && !REFRESH) return csv.pathname;
  await mkdir(PC4, { recursive: true });
  const zip = await archivedFile(sourceForUrl(PC6_ZIP), PC6_ZIP);   // the zip lives in the raw archive
  execFileSync('unzip', ['-o', zip, PC6_CSV, '-d', PC4.pathname], { stdio: 'inherit' });
  return csv.pathname;
}

/** Streams pc6huisnr: "PC6|nr" → buurt 2023 (8 chars), for the wanted keys only. */
async function pc6Buurten(wanted) {
  const out = new Map();
  const rl = createInterface({ input: createReadStream(await pc6Path()), crlfDelay: Infinity });
  let col = null;
  for await (const line of rl) {
    const f = line.split(';').map(s => s.replace(/^"|"$/g, '').trim());
    if (!col) { col = { pc6: f.indexOf('PC6'), nr: f.indexOf('Huisnummer'), bu: f.indexOf('Buurt2023') }; continue; }
    const key = `${f[col.pc6]}|${Number(f[col.nr])}`;
    if (wanted.has(key)) out.set(key, f[col.bu]);
  }
  return out;
}

/** PDOK Locatieserver: the address, else the postcode → { ll: [lat, lon], buurt, wijk, gemeente, via }. */
async function pdokLookup(pc6, nr) {
  const fl = 'centroide_ll,buurtcode,wijkcode,gemeentecode';
  const tries = nr != null ? [['adres', `postcode:${pc6} and huisnummer:${nr}`], ['postcode', `postcode:${pc6}`]] : [['postcode', `postcode:${pc6}`]];
  for (const [type, q] of tries) {
    const j = await getJson(`${PDOK}?${new URLSearchParams({ q, fq: `type:${type}`, rows: '1', fl })}`);
    const d = j.response?.docs?.[0];
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(d?.centroide_ll ?? '');
    if (m) return { ll: [Number(m[2]), Number(m[1])], buurt: d.buurtcode ?? null, wijk: d.wijkcode ?? null, gemeente: d.gemeentecode ?? null, via: type };
  }
  return null;
}

async function geocodeAll(keys) {
  const cache = existsSync(GEOCACHE) ? JSON.parse(await readFile(GEOCACHE, 'utf8')) : {};
  const todo = keys.filter(k => !(k in cache));
  if (todo.length) console.log(`PDOK: ${todo.length} lookups (${keys.length - todo.length} cached)`);
  let done = 0;
  const worker = async () => {
    while (todo.length) {
      const key = todo.shift();
      const [pc6, nr] = key.split('|');
      try { cache[key] = await pdokLookup(pc6, nr === '' ? null : Number(nr)); } catch (err) { console.warn(`\nPDOK ${key}: ${err.message}`); }
      if (++done % 200 === 0) { process.stdout.write(`\rPDOK: ${done}   `); await writeFile(GEOCACHE, JSON.stringify(cache)); }
      await sleep(150); // polite: three workers, at most ~15 requests a second
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await mkdir(DUO, { recursive: true });
  await writeFile(GEOCACHE, JSON.stringify(cache));
  if (done) process.stdout.write(`\rPDOK: ${done} done\n`);
  return cache;
}

/** Buurt centres [lat, lon] of the 2025 indeling (PDOK gegeneraliseerd, geoCentroid as the OV distances); cached. */
async function buurtCentres() {
  const file = new URL(`pdok-buurt-centres-${NL_DATA_YEAR}.json`, DUO);
  if (existsSync(file) && !REFRESH) return JSON.parse(await readFile(file, 'utf8'));
  const centres = {};
  for (let start = 0; ; start += 1000) {
    const params = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: `gebiedsindelingen:${NL_GEO_TYPES.buurt}`, outputFormat: 'application/json', srsName: 'EPSG:4326', count: '1000', startIndex: String(start), sortBy: 'statcode' });
    const page = await archivedJson(sourceForUrl(NL_GEO_WFS + '/'), `${NL_GEO_WFS}?${params}`);
    for (const f of page.features ?? []) {
      const c = geoCentroid(f), code = String(f.properties?.statcode ?? '').trim();
      if (c && code) centres[code] = [r5(c[0]), r5(c[1])];
    }
    process.stdout.write(`\rPDOK buurt centres: ${Object.keys(centres).length}   `);
    if ((page.features ?? []).length < 1000) break;
  }
  process.stdout.write('\n');
  await writeFile(file, JSON.stringify(centres));
  return centres;
}

const titleCase = s => s.toLowerCase().replace(/(^|[\s\-'(/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// ── Read ─────────────────────────────────────────────────────────────────────
await mkdir(DUO, { recursive: true });
const [ref, eind, addr] = await Promise.all(FILES.map(([d, f]) => duoFile(d, f)));
const readJson = async name => JSON.parse(await readFile(new URL(name, OUT), 'utf8'));
const [buurten25, wijken25] = await Promise.all([readJson('buurten-2025.json'), readJson('wijken-2025.json')]);
const known = {
  buurt: new Set(buurten25.codes), wijk: new Set(wijken25.codes),
  gemeente: new Set(wijken25.codes.map(c => `GM${c.slice(2, 6)}`)),
};

// Provinces: data/provinces.json (the map's own CBS provincie_gegeneraliseerd). No gemeente → provincie
// table is in the repo, so each gemeente goes to the province that holds most of its buurt centres
// (point in polygon); the coarse outlines only matter at a border, the majority settles it.
const provGeo = JSON.parse(await readFile(new URL('../provinces.json', OUT), 'utf8'));
const provPolys = provGeo.features.map(f => ({
  code: String(f.properties?.statcode ?? '').trim(),
  polys: f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates],
}));
const provinceOfPoint = ([lat, lon]) => provPolys.find(p => p.polys.some(rings => pointInRings([lon, lat], rings)))?.code ?? null;

const scores = scoreSchools(ref, eind);
const sboIds = new Set([...ref, ...eind].filter(r => r.TYPE_PO === 'SBO').map(r => `${r.INSTELLINGSCODE}${r.VESTIGINGSCODE.padStart(2, '0')}`));
const vest = addr.filter(r => !(sboIds.has(r.VESTIGINGSCODE) && !scores.has(r.VESTIGINGSCODE)));
console.log(`vestigingen: ${addr.length} in adressen_bo, ${addr.length - vest.length} SBO-only left out; scored BO schools in the results: ${scores.size}`);

// ── Geocode ─────────────────────────────────────────────────────────────────
const keyOf = r => `${r.POSTCODE.replace(/\s/g, '').toUpperCase()}|${houseNumber(r['HUISNUMMER-TOEVOEGING']) ?? ''}`;
const keys = [...new Set(vest.map(keyOf))];
const [pc6, geo] = await Promise.all([pc6Buurten(new Set(keys)), geocodeAll(keys)]);

const stats = { pc6: 0, pdok: 0, wijkOnly: 0, none: 0, coords: 0, coordsPostcode: 0 };
const schools = vest.map(r => {
  const key = keyOf(r), g = geo[key] ?? null, cbs = pc6.get(key);
  let buurt = null, wijk = null;
  if (cbs && known.buurt.has(`BU${cbs}`)) { buurt = `BU${cbs}`; stats.pc6++; }
  else if (g?.buurt && known.buurt.has(g.buurt)) { buurt = g.buurt; stats.pdok++; }
  if (buurt) wijk = `WK${buurt.slice(2, 8)}`;
  else if (g?.wijk && known.wijk.has(g.wijk)) { wijk = g.wijk; stats.wijkOnly++; }
  else stats.none++;
  const gm = [buurt && `GM${buurt.slice(2, 6)}`, g?.gemeente && `GM${g.gemeente}`, `GM${String(r.GEMEENTENUMMER).padStart(4, '0')}`]
    .find(c => c && known.gemeente.has(c)) ?? null;
  if (g?.ll) { stats.coords++; if (g.via === 'postcode') stats.coordsPostcode++; }
  const s = scores.get(r.VESTIGINGSCODE) ?? null;
  return {
    brin: r.VESTIGINGSCODE, name: r.VESTIGINGSNAAM, street: `${r.STRAATNAAM} ${r['HUISNUMMER-TOEVOEGING']}`.trim(),
    postcode: r.POSTCODE, place: titleCase(r.PLAATSNAAM), lat: r5(g?.ll?.[0]), lon: r5(g?.ll?.[1]),
    buurt, wijk, gemeente: gm, ...(s ?? { score: null, tested: 0 }),
  };
}).sort((a, b) => a.brin.localeCompare(b.brin));

// ── Areas ────────────────────────────────────────────────────────────────────
// Schools in the area (eduScore …) and schools near home (eduNear…, plan step 5).
const METRICS = ['eduScore', 'eduSchools', 'eduTested', 'eduFundPct', 'eduStreefPct', 'eduNearScore', 'eduNearBest', 'eduNearCount'];
const NEAR = ['eduNearScore', 'eduNearBest', 'eduNearCount'];
const centres = await buurtCentres();
const popCol = buurten25.cols.population;
const nearRows = buurten25.codes.map((code, i) => ({ code, pop: popCol[i], values: nearSchools(centres[code] ?? null, schools) }));
// Gemeente → provincie by majority of its buurt centres (see above).
const votes = new Map();
for (const code of buurten25.codes) {
  const pv = centres[code] ? provinceOfPoint(centres[code]) : null;
  if (!pv) continue;
  const gm = `GM${code.slice(2, 6)}`;
  if (!votes.has(gm)) votes.set(gm, new Map());
  votes.get(gm).set(pv, (votes.get(gm).get(pv) ?? 0) + 1);
}
const provOf = new Map([...votes].map(([gm, v]) => [gm, [...v].sort((a, b) => b[1] - a[1])[0][0]]));
const split = [...votes.values()].filter(v => v.size > 1).length;
known.provincie = new Set(provPolys.map(p => p.code));
const nearBy = {
  buurt: new Map(nearRows.filter(r => r.values.eduNearScore != null).map(r => [r.code, r.values])),
  wijk: rollUpByPopulation(nearRows, c => `WK${c.slice(2, 8)}`, NEAR),
  gemeente: rollUpByPopulation(nearRows, c => `GM${c.slice(2, 6)}`, NEAR),
  provincie: rollUpByPopulation(nearRows, c => provOf.get(`GM${c.slice(2, 6)}`) ?? null, NEAR),
};
const inArea = {
  buurt: aggregate(schools, s => s.buurt), wijk: aggregate(schools, s => s.wijk), gemeente: aggregate(schools, s => s.gemeente),
  provincie: aggregate(schools, s => provOf.get(s.gemeente) ?? null),
};
const level = lvl => {
  const by = new Map();
  for (const [c, v] of inArea[lvl]) by.set(c, { ...v });
  for (const [c, v] of nearBy[lvl]) if (NEAR.some(k => v[k] != null) && (lvl === 'buurt' || known[lvl].has(c))) by.set(c, { ...by.get(c), ...v });
  const codes = [...by.keys()].sort();
  return { codes, cols: Object.fromEntries(METRICS.map(m => [m, codes.map(c => by.get(c)[m] ?? null)])) };
};
const levels = { buurt: level('buurt'), wijk: level('wijk'), gemeente: level('gemeente'), provincie: level('provincie') };
const centred = buurten25.codes.filter(c => centres[c]).length;

// ── School list, column-wise ─────────────────────────────────────────────────
const b = v => (v ? 1 : 0);
const SCHOOL_COLS = {
  brin: s => s.brin, name: s => s.name, street: s => s.street, postcode: s => s.postcode, place: s => s.place,
  lat: s => s.lat, lon: s => s.lon, buurt: s => s.buurt, wijk: s => (s.buurt ? null : s.wijk), gemeente: s => (s.buurt ? null : s.gemeente),
  score: s => s.score, tested: s => s.tested,
  estimate: s => (s.score == null ? null : b(s.estimate)), fund: s => s.fund ?? null, streef: s => s.streef ?? null,
  ...Object.fromEntries(SUBJECT_KEYS.flatMap(k => [[`${k}Fund`, s => s.subjects?.[k].fund ?? null], [`${k}Streef`, s => s.subjects?.[k].streef ?? null]])),
};
const schoolCols = Object.fromEntries(Object.entries(SCHOOL_COLS).map(([k, f]) => [k, schools.map(f)]));

const built = new Date().toISOString().slice(0, 10);
const sources = {
  referentieniveau: 'DUO wporeferentieniveau-v1 (brin6_referentieniveau.csv), peiljaren 2022-2024, alleen BO',
  eindscores: 'DUO wpo-eindscores (brin6_eindscores.csv), aantal leerlingen leerjaar 8 (voor de afgeschermde cellen)',
  adressen: 'DUO adressen_bo (vestigingenbo.csv)',
  indeling: 'CBS pc6huisnr 2023 (codes die ook in de indeling 2025 bestaan), anders PDOK Locatieserver; coördinaten PDOK Locatieserver',
  method: `schoolscore 0-100: per leerlingresultaat (lezen, taalverzorging, rekenen) onder 1F = 0, 1F = 50, 2F/1S = 100, gemiddeld over ${YEARS[0]}-${YEARS.at(-1)}; afgeschermde cel (1-4 leerlingen) uit het totaal afgeleid, anders geschat (estimate = 1); klein aantal leerlingen = tested < ${SMALL_N}; eduScore = ongewogen gemiddelde van de schoolscores in het gebied, eduFundPct/eduStreefPct gewogen naar leerlingresultaten`,
  dichtbij: `eduNearScore = gemiddelde schoolscore van scholen binnen ${NEAR_RADIUS_KM} km hemelsbreed van het midden van de buurt (PDOK ${NL_DATA_YEAR} buurt_gegeneraliseerd), gewicht max(0, 1 - d/${NEAR_RADIUS_KM} km); eduNearBest/eduNearCount = beste score / aantal scholen binnen ${NEAR_BEST_KM} km; wijk, gemeente en provincie gewogen naar inwoners (buurten-${NL_DATA_YEAR}.json)`,
  provincie: 'gemeente → provincie: de provincie (data/provinces.json) waarin de meeste buurtmiddens van de gemeente liggen; eduScore ongewogen over de scholen, eduFundPct/eduStreefPct naar leerlingresultaten, eduNear… naar inwoners',
};
const head = { format: 1, year: 2024, years: YEARS, built, sources, smallN: SMALL_N };
// Two files: the area layer, and the school list (pins and panels), loaded on demand apart.
const out = { ...head, metrics: METRICS, levels, schoolsFile: SCHOOLS_NAME };
const schoolsOut = { ...head, note: 'wijk and gemeente only where buurt is null (else they are BU code chars 3-8 / 3-6); small = tested < smallN', count: schools.length, cols: schoolCols };
const text = JSON.stringify(out), schoolsText = JSON.stringify(schoolsOut);
await writeFile(new URL(OUT_NAME, OUT), text);
await writeFile(new URL(SCHOOLS_NAME, OUT), schoolsText);
// Buurt centres for the panel's "Basisscholen binnen 1 km" (the same points as eduNear…).
const centresText = JSON.stringify({ format: 1, year: NL_DATA_YEAR, built, source: `PDOK gebiedsindelingen ${NL_DATA_YEAR}, ${NL_GEO_TYPES.buurt}; zwaartepunt (areas.geoCentroid), hetzelfde midden als eduNearScore/eduNearBest/eduNearCount in ${OUT_NAME}`, ...encodeCentres(centres) });
await writeFile(new URL(CENTRES_NAME, OUT), centresText);

// ── Log ──────────────────────────────────────────────────────────────────────
const pctOf = (a, n) => `${((100 * a) / n).toFixed(1)}%`;
const n = schools.length, located = n - stats.none;
console.log(`${OUT_NAME}: ${(text.length / 1e6).toFixed(2)} MB; ${SCHOOLS_NAME}: ${(schoolsText.length / 1e6).toFixed(2)} MB; ${CENTRES_NAME}: ${(centresText.length / 1e6).toFixed(2)} MB`);
console.log(`geocode: buurt ${stats.pc6 + stats.pdok}/${n} = ${pctOf(stats.pc6 + stats.pdok, n)} (pc6huisnr ${stats.pc6}, PDOK ${stats.pdok}), wijk only ${stats.wijkOnly}, none ${stats.none}; area ${pctOf(located, n)}; coordinates ${stats.coords}/${n} (${stats.coordsPostcode} postcode centroid)`);
const scored = schools.filter(s => s.score != null);
console.log(`schools: ${n} listed, ${scored.length} scored, ${scored.filter(s => s.small).length} small, ${scored.filter(s => s.estimate).length} with an estimated cell; scored schools without an address: ${scores.size - scored.length}`);
const rdam = schools.filter(s => s.gemeente === 'GM0599');
console.log(`Rotterdam: ${rdam.length} schools, ${rdam.filter(s => s.score != null).length} scored, ${rdam.filter(s => s.buurt).length} in a buurt; eduScore ${levels.gemeente.cols.eduScore[levels.gemeente.codes.indexOf('GM0599')]}`);
const y24 = [...scores.values()].map(s => s.perYear[2024]).filter(Boolean);
for (const k of SUBJECT_KEYS) { const sh = shares(y24.map(p => p[k]).filter(Boolean)); console.log(`NL 2024 ${k.padEnd(8)} n ${sh.n}: >=1F ${sh.fund}%, 2F/1S ${sh.streef}%`); }
const nb = levels.buurt.cols.eduNearScore.filter(v => v != null).length;
console.log(`near: buurt centres ${centred}/${buurten25.codes.length}, buurten with eduNearScore ${nb}; Rotterdam eduNearScore ${levels.gemeente.cols.eduNearScore[levels.gemeente.codes.indexOf('GM0599')]}`);
console.log(`levels: buurten ${levels.buurt.codes.length}, wijken ${levels.wijk.codes.length}, gemeenten ${levels.gemeente.codes.length}, provincies ${levels.provincie.codes.length}`);
console.log(`provinces: ${provOf.size}/${known.gemeente.size} gemeenten placed, ${split} with buurt centres in more than one province, schools without a province ${schools.filter(s => !provOf.get(s.gemeente)).length}`);
console.log(`provincie eduScore: ${levels.provincie.codes.map((c, i) => `${c} ${levels.provincie.cols.eduScore[i]}/${levels.provincie.cols.eduNearScore[i]}`).join(', ')}`);
