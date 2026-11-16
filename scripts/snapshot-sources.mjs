// Own data mirror, phase 1 (docs/plan-data-mirror.md): fetches every CBS,
// police and PDOK query the app used to make live in the browser into the raw
// archive (/nebula/data/roffatistics/raw/<key>/<YYYY-MM-DD>/ + manifest.json,
// scripts/lib/raw-archive.mjs) and rebuilds the snapshot the app reads:
//   data/snapshot/<key>.json            column-wise tables (modules/source.js encodeTable)
//   data/snapshot/geo/2025/<GM>-{wijk,buurt}.json   polygons per gemeente (slimGeo)
//   data/snapshot/geo/2024/gemeenten.json           the gemeente overlay
//   data/snapshot/manifest.json         every key with rows/features, period, sha256
// Prints a diff summary (rows and changed values per table); a file whose
// content did not change is left untouched, so git shows only real changes.
//
// Run: npm run snapshot                 (= --refresh: fetch everything anew)
//      node scripts/snapshot-sources.mjs  (rebuild from the newest archived copies; fetch only what is missing)
//      … --only=geo/                     (keys starting with a prefix)
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildWijkUrl, buildNabijUrl, buildCrimeUrl, CRIME_PREV_PERIOD, buildGroenUrl, buildCityWozUrl, buildGemeenteNamesUrl, buildWijkCrimeUrl, buildBuurtCrimeUrl, citySourceKeys,
  WIJK_TABLE, WIJK_SELECT, WIJK_FALLBACK_TABLE, NABIJ_TABLE, NABIJ_FALLBACK_TABLE, GROEN_TABLE, WOZ_TABLE, CRIME_TABLE, CRIME_PERIOD, WOZ_PERIOD,
} from '../modules/areas.js';
import { buildHerkomstUrls, herkomstSourceKeys, HERKOMST_TABLE, HERKOMST_YEAR } from '../modules/herkomst.js';
import { CITIES, cityCodes } from '../modules/city.js';
import { buildGemeenteGroupUrl, GEMEENTE_GROUPS_SOURCE, FETCHED_GROUP_KEYS } from '../modules/herkomst-gemeente.js';
import { NL_REGION_QUERIES, nlRegionUrl, CBS_PERIOD } from '../modules/datasets.js';
import { NL_GEO_TYPES, NL_GEO_YEAR, slimGeo, buildGemeenteGeoUrl, gemeenteGeoKey } from '../modules/nl-areas.js';
import { encodeTable, wfsUrl, SNAPSHOT_FORMAT } from '../modules/source.js';
import { pagedOData, pagedWfs, REFRESH, RAW_ROOT, today } from './lib/raw-archive.mjs';

const ROOT = new URL('../', import.meta.url);
export const SNAPSHOT_ROOT = new URL('data/snapshot/', ROOT);
export const OVERLAY_SOURCE = 'geo/2024/gemeenten';
export const OVERLAY_YEAR = 2024;

const odata = (key, live, meta) => ({ kind: 'odata', key, urls: [live], live, ...meta });

/** The city tables of one city (config/cities.json): kerncijfers, nabijheid, groen, WOZ, police, herkomst. `city` = slug. */
export function cityEntries(city) {
  const k = citySourceKeys(city), hk = herkomstSourceKeys(city), hu = buildHerkomstUrls(city), n = city.name, c = { city: city.slug };
  return [
    odata(k.kwb, buildWijkUrl(WIJK_TABLE, WIJK_SELECT, city), { module: 'areas.js', table: WIJK_TABLE, period: '2025', title: `Kerncijfers wijken en buurten 2025, ${n}`, ...c }),
    odata(k.kwbFallback, buildWijkUrl(WIJK_FALLBACK_TABLE, WIJK_SELECT, city), { module: 'areas.js', table: WIJK_FALLBACK_TABLE, period: '2024', title: `Kerncijfers wijken en buurten 2024, ${n} (fallback)`, ...c }),
    odata(k.nabij, buildNabijUrl(NABIJ_TABLE, city), { module: 'areas.js', table: NABIJ_TABLE, period: '2025', title: `Nabijheid voorzieningen 2025, ${n}`, ...c }),
    odata(k.nabijFallback, buildNabijUrl(NABIJ_FALLBACK_TABLE, city), { module: 'areas.js', table: NABIJ_FALLBACK_TABLE, period: '2024', title: `Nabijheid voorzieningen 2024, ${n} (fallback)`, ...c }),
    odata(k.groen, buildGroenUrl(city), { module: 'areas.js', table: GROEN_TABLE, period: '2017', title: `Afstand tot groen 2017, ${n}`, ...c }),
    odata(k.woz, buildCityWozUrl(city), { module: 'areas.js', table: WOZ_TABLE, period: WOZ_PERIOD, title: `Gemiddelde WOZ-waarde, gemeente ${n}`, ...c }),
    odata(k.crimeWijk, buildWijkCrimeUrl(city), { module: 'areas.js', table: CRIME_TABLE, period: CRIME_PERIOD, title: `Geregistreerde misdrijven, wijken ${n}`, ...c }),
    // CBS answers at most 10,000 rows per query: a city with many buurten (Amsterdam, config `splitBuurtCrime`) asks one year at a time.
    { ...odata(k.crimeBuurt, buildBuurtCrimeUrl(city), { module: 'areas.js', table: CRIME_TABLE, period: CRIME_PERIOD, title: `Geregistreerde misdrijven, buurten ${n}`, ...c }),
      ...(city.splitBuurtCrime ? { urls: [CRIME_PERIOD, CRIME_PREV_PERIOD].map(p => buildCrimeUrl(cityCodes(city).buurtPrefix, [p])) } : {}) },
    odata(hk[0], hu[0], { module: 'herkomst.js', table: HERKOMST_TABLE, period: 'all', title: `Herkomstland, ${n}`, ...c }),
    odata(hk[1], hu[1], { module: 'herkomst.js', table: HERKOMST_TABLE, period: 'all', title: `Geboren buiten Nederland, ${n}`, ...c }),
  ];
}

/**
 * The registry: one entry per runtime query of the app; the city tables once per city. kind 'odata' writes
 * one table; 'geo-split' fetches every polygon of a level once (paged WFS) and
 * writes one file per gemeente (`key` is a template with {gm}); 'geo' writes
 * one FeatureCollection. `module` names the file that reads the key.
 */
export const REGISTRY = Object.freeze([
  ...Object.values(CITIES).flatMap(cityEntries),
  odata('cbs/86165NED-gemeenten', buildGemeenteNamesUrl(), { module: 'areas.js', table: WIJK_TABLE, period: '2025', title: 'Gemeentenamen (indeling 2025)' }),
  {
    kind: 'odata', key: GEMEENTE_GROUPS_SOURCE, module: 'herkomst-gemeente.js', table: HERKOMST_TABLE, period: String(HERKOMST_YEAR),
    title: 'Herkomstgroepen per gemeente (Totaal + de sleutels van elke groep)',
    urls: FETCHED_GROUP_KEYS.map(g => buildGemeenteGroupUrl(g)), live: 'buildGemeenteGroupUrl(group)',
    dedupe: r => `${String(r.RegioS).trim()}|${String(r.Herkomstland).trim()}`,
  },
  ...Object.entries(NL_REGION_QUERIES).map(([key, q]) => odata(key, nlRegionUrl(key), { module: 'datasets.js', table: q.table, period: CBS_PERIOD, title: `${q.table} ${key.split('-').pop()}` })),
  ...Object.keys(NL_GEO_TYPES).map(level => ({
    kind: 'geo-split', key: gemeenteGeoKey(level, 'GM0000').replace('GM0000', '{gm}'), level, module: 'nl-areas.js', period: String(NL_GEO_YEAR),
    title: `PDOK gebiedsindelingen ${NL_GEO_YEAR}, ${NL_GEO_TYPES[level]}, per gemeente`,
    pageUrl: start => wfsUrl(NL_GEO_YEAR, NL_GEO_TYPES[level], { count: 1000, startIndex: start, sortBy: 'statcode' }),
  })),
  {
    kind: 'geo', key: OVERLAY_SOURCE, module: 'overlays.js', period: String(OVERLAY_YEAR), title: `PDOK gebiedsindelingen ${OVERLAY_YEAR}, gemeente_gegeneraliseerd`,
    live: wfsUrl(OVERLAY_YEAR, 'gemeente_gegeneraliseerd'),
    pageUrl: start => wfsUrl(OVERLAY_YEAR, 'gemeente_gegeneraliseerd', { count: 1000, startIndex: start, sortBy: 'statcode' }),
  },
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

const fileOf = key => new URL(`${key}.json`, SNAPSHOT_ROOT);
const hashOf = parts => createHash('sha256').update(parts.join('\n')).digest('hex');
const round = c => (typeof c[0] === 'number' ? [+c[0].toFixed(5), +c[1].toFixed(5)] : c.map(round));

/** Overlay: every polygon with { statcode, statnaam } only and 5-decimal coordinates (as slimGeo). */
export function slimAll(features) {
  return {
    type: 'FeatureCollection',
    features: features.filter(f => f?.geometry && /Polygon$/.test(f.geometry.type)).map(f => ({
      type: 'Feature',
      properties: { statcode: String(f.properties?.statcode ?? '').trim(), statnaam: f.properties?.statnaam ?? '' },
      geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
    })),
  };
}

/** Rows and changed cells between an old and a new table (same `columns`; rows matched by their string cells). */
export function diffTables(oldT, newT) {
  const out = { before: oldT?.rows?.length ?? 0, after: newT.rows.length, changed: 0, added: 0, removed: 0 };
  if (!oldT) { out.added = out.after; return out; }
  const sig = (t, r) => r.map((v, i) => (typeof v === 'string' ? `${t.columns[i]}=${v}` : '')).filter(Boolean).join('|');
  const old = new Map(oldT.rows.map(r => [sig(oldT, r), r]));
  for (const r of newT.rows) {
    const o = old.get(sig(newT, r));
    if (!o) { out.added++; continue; }
    old.delete(sig(newT, r));
    newT.columns.forEach((c, i) => { const j = oldT.columns.indexOf(c); if (typeof r[i] !== 'string' && o[j] !== r[i]) out.changed++; });
  }
  out.removed = old.size;
  return out;
}

async function readJson(url) {
  try { return JSON.parse(await readFile(url, 'utf8')); } catch { return null; }
}

/** Writes `body` unless its content (everything but `built`) is unchanged; returns { written, bytes }. */
async function writeIfChanged(url, body) {
  const old = await readJson(url);
  const strip = o => JSON.stringify({ ...o, built: null });
  if (old && strip(old) === strip(body)) return { written: false, bytes: Buffer.byteLength(JSON.stringify(old)) };
  await mkdir(dirname(fileURLToPath(url)), { recursive: true });
  const text = JSON.stringify(body);
  await writeFile(url, text);
  return { written: true, bytes: Buffer.byteLength(text) };
}

const header = (e, sources, sha256) => ({ key: e.key, title: e.title, period: e.period, built: today(), sources, sha256 });

// ── Builders per kind ────────────────────────────────────────────────────────

async function buildOdata(e) {
  let rows = [];
  const pages = [];
  for (const url of e.urls) {
    const got = await pagedOData(e.key, url);
    rows.push(...got.rows); pages.push(...got.pages);
  }
  if (e.dedupe) { const seen = new Set(); rows = rows.filter(r => { const k = e.dedupe(r); if (seen.has(k)) return false; seen.add(k); return true; }); }
  if (!rows.length) throw new Error(`${e.key}: no rows`);
  const body = encodeTable(rows, header(e, e.urls, [hashOf(pages.map(p => p.sha256))]));
  const old = await readJson(fileOf(e.key));
  const diff = diffTables(old?.format === SNAPSHOT_FORMAT ? old : null, body);
  const w = await writeIfChanged(fileOf(e.key), body);
  return { files: [{ key: e.key, rows: rows.length, ...w }], diff };
}

async function buildGeoSplit(e) {
  const { features, pages } = await pagedWfs(`geo/${NL_GEO_YEAR}/${e.level}`, e.pageUrl);
  const byGm = new Map();
  for (const f of features) {
    const code = String(f.properties?.statcode ?? '').trim().toUpperCase();
    const gm = `GM${code.slice(2, 6)}`;
    if (!/^GM\d{4}$/.test(gm)) continue;
    if (!byGm.has(gm)) byGm.set(gm, []);
    byGm.get(gm).push(f);
  }
  if (byGm.size < 300) throw new Error(`${e.key}: only ${byGm.size} gemeenten`);
  const sha = hashOf(pages.map(p => p.sha256));
  const files = [];
  for (const gm of [...byGm.keys()].sort()) {
    const key = gemeenteGeoKey(e.level, gm);
    const slim = slimGeo({ features: byGm.get(gm) }, gm);
    const body = { type: 'FeatureCollection', format: SNAPSHOT_FORMAT, ...header({ ...e, key }, [buildGemeenteGeoUrl(e.level, gm)], [sha]), features: slim.features };
    files.push({ key, rows: slim.features.length, ...(await writeIfChanged(fileOf(key), body)) });
  }
  // Gemeenten that no longer exist in this indeling: remove their old files.
  const dir = new URL(`geo/${NL_GEO_YEAR}/`, SNAPSHOT_ROOT);
  const keep = new Set(files.map(f => `${f.key.split('/').pop()}.json`));
  let removed = 0;
  if (existsSync(dir)) for (const name of await readdir(dir)) if (name.endsWith(`-${e.level}.json`) && !keep.has(name)) { await rm(new URL(name, dir)); removed++; }
  return { files, diff: { before: null, after: features.length, gemeenten: byGm.size, removedFiles: removed } };
}

async function buildGeo(e) {
  const { features, pages } = await pagedWfs(e.key, e.pageUrl);
  const slim = slimAll(features);
  if (slim.features.length < 300) throw new Error(`${e.key}: only ${slim.features.length} features`);
  const body = { type: 'FeatureCollection', format: SNAPSHOT_FORMAT, ...header(e, [e.live], [hashOf(pages.map(p => p.sha256))]), features: slim.features };
  const w = await writeIfChanged(fileOf(e.key), body);
  return { files: [{ key: e.key, rows: slim.features.length, ...w }], diff: { after: slim.features.length } };
}

const BUILDERS = { odata: buildOdata, 'geo-split': buildGeoSplit, geo: buildGeo };

/** Rebuilds data/snapshot/manifest.json from the files on disk. */
async function writeIndex() {
  const out = {};
  const walk = async dir => {
    for (const d of await readdir(dir, { withFileTypes: true })) {
      const url = new URL(d.name + (d.isDirectory() ? '/' : ''), dir);
      if (d.isDirectory()) { await walk(url); continue; }
      if (!d.name.endsWith('.json') || url.href === new URL('manifest.json', SNAPSHOT_ROOT).href) continue;
      const text = await readFile(url, 'utf8');
      const j = JSON.parse(text);
      const key = url.href.slice(SNAPSHOT_ROOT.href.length, -'.json'.length);
      out[key] = { period: j.period ?? null, built: j.built ?? null, rows: j.rows?.length ?? j.features?.length ?? 0, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') };
    }
  };
  await walk(SNAPSHOT_ROOT);
  const sorted = Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]]));
  await writeIfChanged(new URL('manifest.json', SNAPSHOT_ROOT), { format: SNAPSHOT_FORMAT, built: today(), files: sorted });
  return sorted;
}

async function main() {
  const only = process.argv.find(a => a.startsWith('--only='))?.slice(7) ?? '';
  console.log(`raw archive: ${RAW_ROOT}${REFRESH ? ' (refresh)' : ' (reuse archived copies)'}`);
  let failed = 0, written = 0, unchanged = 0;
  for (const e of REGISTRY.filter(x => x.key.startsWith(only))) {
    try {
      const { files, diff } = await BUILDERS[e.kind](e);
      const w = files.filter(f => f.written).length;
      written += w; unchanged += files.length - w;
      console.log(`${e.key}: ${files.length} file(s), ${w} changed — ${JSON.stringify(diff)}`);
    } catch (err) {
      failed++;
      console.error(`${e.key}: FAILED ${err.message} (old snapshot kept)`);
    }
  }
  const index = await writeIndex();
  const bytes = Object.values(index).reduce((a, f) => a + f.bytes, 0);
  console.log(`snapshot: ${Object.keys(index).length} files, ${(bytes / 1e6).toFixed(1)} MB; ${written} changed, ${unchanged} unchanged, ${failed} failed`);
  if (!written) console.log('nothing changed: no commit needed');
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
