// Builds the OV-lijnen data from OpenStreetMap (Overpass API, © OpenStreetMap
// contributors, ODbL) and the distance-to-stop values:
//   data/ov/metro-tram.json     metro + tram lines and stops, all of NL
//   data/ov/bus-rotterdam.json  bus lines and stops, Rotterdam region only
//   data/ov/afstand.json        { CODE: [distMetro, distTram] } for gemeenten
//                               (PDOK 2024 + 2025) and Rotterdam wijken/buurten
//   data/nl/wijken-2025.json, buurten-2025.json: cols distMetro / distTram
//                               (run this AFTER scripts/build-nl-kwb.mjs, which
//                               rewrites those files without them)
// Distances: straight line in km from the area centroid to the nearest stop.
//
// Usage: node scripts/build-ov-lines.mjs   (OV_CACHE=/tmp/dir keeps the raw
// Overpass/PDOK responses for a re-run without fetching again)
//
// Another city: node scripts/build-ov-lines.mjs --city amsterdam writes only
// that city's files (config/cities.json `ov`): its bus lines and stops in
// `ov.busBbox` (e.g. data/ov/amsterdam/bus.json, GVB and the regional
// operators) and its afstand.json: the gemeente codes of data/ov/afstand.json
// plus its own wijken/buurten, measured to the stops of metro-tram.json (all
// of NL, so GVB metro and tram are in it already). Run build-city-geo first.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { geoCentroid, normalizeAreaCode } from '../modules/areas.js';
import { nearestStopKm } from '../modules/ov.js';
import { NL_GEO_WFS, NL_GEO_TYPES, NL_DATA_YEAR } from '../modules/nl-areas.js';
import { CITIES, DEFAULT_CITY } from '../modules/city.js';
import { cityArg } from './build-city-geo.mjs';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'roffatistics-build';
const OUT = new URL('../data/ov/', import.meta.url);
const NL_OUT = new URL('../data/nl/', import.meta.url);
const ROOT = new URL('../data/', import.meta.url);
const CACHE = process.env.OV_CACHE || null;
const TODAY = new Date().toISOString().slice(0, 10);
export const OSM_SOURCE = '© OpenStreetMap-bijdragers (ODbL), via Overpass API';
/** Rotterdam region for the bus layer: [south, west, north, east] (config/cities.json ov.busBbox). */
export const BUS_BBOX = Object.freeze([...CITIES.rotterdam.ov.busBbox]);
const SIMPLIFY_M = 6;          // Douglas-Peucker tolerance in metres
const DECIMALS = 5;            // ~1 m

// ── Pure geometry helpers (exported for the tests) ───────────────────────────

const round = (v, d = DECIMALS) => +v.toFixed(d);

/** Douglas-Peucker on [lng, lat] points with a tolerance in metres. */
export function simplifyLine(pts, tolM = SIMPLIFY_M) {
  if (pts.length < 3) return pts.slice();
  const k = Math.cos(pts[0][1] * Math.PI / 180) * 111320, m = 110540;
  const xy = pts.map(([x, y]) => [x * k, y * m]);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let worst = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > worst) { worst = d; idx = i; }
    }
    if (worst > tolM) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Joins lines that share an end point into longer chains (fewer, longer polylines). */
export function mergeLines(lines) {
  const key = p => `${p[0]},${p[1]}`;
  const pool = lines.filter(l => l.length >= 2).map(l => l.slice());
  const used = new Uint8Array(pool.length);
  const ends = new Map();
  pool.forEach((l, i) => { for (const p of [l[0], l[l.length - 1]]) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } });
  const take = (k, self) => (ends.get(k) ?? []).find(j => !used[j] && j !== self);
  const out = [];
  for (let i = 0; i < pool.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain = pool[i];
    for (let grow = true; grow;) {
      grow = false;
      const j = take(key(chain[chain.length - 1]), i);
      if (j != null) { used[j] = 1; const l = pool[j]; chain = chain.concat(key(l[0]) === key(chain[chain.length - 1]) ? l.slice(1) : l.slice().reverse().slice(1)); grow = true; continue; }
      const h = take(key(chain[0]), i);
      if (h != null) { used[h] = 1; const l = pool[h]; chain = (key(l[l.length - 1]) === key(chain[0]) ? l.slice(0, -1) : l.slice().reverse().slice(0, -1)).concat(chain); grow = true; }
    }
    out.push(chain);
  }
  return out;
}

const metres = (a, b) => {
  const k = Math.cos(a[1] * Math.PI / 180) * 111320;
  return Math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * 110540);
};
const normName = n => String(n ?? '').toLowerCase().replace(/^(rotterdam|den haag|amsterdam|utrecht|schiedam|delft|zoetermeer)[ ,]+/, '').trim();

/** Stop positions → one point per stop: same name within 400 m, or any within 60 m. Points [lng, lat, name]. */
export function clusterStops(points) {
  const clusters = [];
  for (const [x, y, name] of points) {
    const n = normName(name);
    const c = clusters.find(c => { const d = metres([c.x, c.y], [x, y]); return (n && c.n === n && d < 400) || d < 60; });
    if (c) { c.sx += x; c.sy += y; c.k++; c.x = c.sx / c.k; c.y = c.sy / c.k; if (!c.name && name) { c.name = name; c.n = n; } }
    else clusters.push({ x, y, sx: x, sy: y, k: 1, name: name ?? '', n });
  }
  return clusters.map(c => [round(c.x), round(c.y), c.name]);
}

/** Mode of a route relation: 'metro', 'tram', 'bus' or null (museum/tourist/disused lines are skipped). */
export function routeMode(tags = {}) {
  const text = `${tags.name ?? ''} ${tags.operator ?? ''} ${tags.network ?? ''}`;
  if (/museum|toeris|tourist|historic|nostalgi/i.test(text) || tags.disused || tags['disused:route']) return null;
  if (tags.route === 'subway') return 'metro';
  if (tags.route === 'light_rail') return /\b(RET|GVB)\b/.test(text) ? 'metro' : 'tram';
  if (tags.route === 'tram') return 'tram';
  if (tags.route === 'bus') return 'bus';
  return null;
}

// ── Fetching ──────────────────────────────────────────────────────────────────

async function cached(name, fn) {
  const file = CACHE ? `${CACHE}/${name}` : null;
  if (file && existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const data = await fn();
  if (file) { await mkdir(CACHE, { recursive: true }); await writeFile(file, JSON.stringify(data)); }
  return data;
}

async function getJSON(url, init = {}, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...init.headers } });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await new Promise(r => setTimeout(r, 5000 * i));
    }
  }
}

const overpass = query => getJSON(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

async function pdok(base, type, year) {
  const features = [];
  for (let start = 0; ; start += 1000) {
    const params = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: `gebiedsindelingen:${type}`, outputFormat: 'application/json', srsName: 'EPSG:4326', count: '1000', startIndex: String(start), sortBy: 'statcode' });
    const page = await getJSON(`${base}?${params}`);
    features.push(...(page.features ?? []));
    process.stdout.write(`\rPDOK ${year} ${type} ${features.length}   `);
    if ((page.features ?? []).length < 1000) break;
  }
  process.stdout.write('\n');
  return features;
}

// ── Building ──────────────────────────────────────────────────────────────────

/** Overpass result → { mode: { lines, stops } } for the wanted modes. */
export function buildModes(osm, wanted, bbox = null) {
  const byId = { node: new Map(), way: new Map() };
  const rels = [];
  for (const e of osm.elements ?? []) {
    if (e.type === 'relation') rels.push(e);
    else byId[e.type]?.set(e.id, e);
  }
  const inBox = pts => !bbox || pts.some(([x, y]) => y >= bbox[0] && y <= bbox[2] && x >= bbox[1] && x <= bbox[3]);
  const out = {};
  for (const mode of wanted) {
    const wayIds = new Set(), stopPts = [], names = new Set();
    for (const r of rels) {
      if (routeMode(r.tags) !== mode) continue;
      names.add(r.tags.ref ? `${r.tags.network ?? r.tags.operator ?? ''} ${r.tags.ref}`.trim() : r.tags.name);
      for (const m of r.members ?? []) {
        if (m.type === 'way' && !/platform/.test(m.role)) wayIds.add(m.ref);
        if (m.type === 'node' && /^stop/.test(m.role)) {
          const n = byId.node.get(m.ref);
          if (n && inBox([[n.lon, n.lat]])) stopPts.push([n.lon, n.lat, n.tags?.name ?? '']);
        }
      }
    }
    const raw = [...wayIds].map(id => byId.way.get(id)?.geometry).filter(Boolean)
      .map(g => g.map(p => [round(p.lon), round(p.lat)])).filter(inBox);
    const lines = mergeLines(raw).map(l => simplifyLine(l)).filter(l => l.length >= 2);
    out[mode] = { routes: names.size, lines, stops: clusterStops(stopPts) };
  }
  return out;
}

const dist = (pt, stops) => nearestStopKm(pt, stops);

async function main() {
  await mkdir(OUT, { recursive: true });
  const nl = await cached('osm-metro-tram.json', () => overpass(
    '[out:json][timeout:600];area["ISO3166-1"="NL"]["admin_level"="2"]->.nl;' +
    'rel["type"="route"]["route"~"^(subway|light_rail|tram)$"](area.nl)->.r;.r out body;way(r.r);out geom;node(r.r);out;'));
  const [s, w, n, e] = BUS_BBOX;
  const bus = await cached('osm-bus.json', () => overpass(
    `[out:json][timeout:600];rel["type"="route"]["route"="bus"](${s},${w},${n},${e})->.r;.r out body;way(r.r);out geom;node(r.r);out;`));

  const mt = buildModes(nl, ['metro', 'tram']);
  const bm = buildModes(bus, ['bus'], BUS_BBOX);
  const meta = { format: 1, built: TODAY, source: OSM_SOURCE, license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors' };
  const strip = m => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { lines: v.lines, stops: v.stops }]));
  const files = {
    'metro-tram.json': { ...meta, coverage: 'Nederland', modes: strip(mt) },
    'bus-rotterdam.json': { ...meta, coverage: `regio Rotterdam ${BUS_BBOX.join(',')}`, modes: strip(bm) },
  };
  for (const [name, data] of Object.entries(files)) {
    const text = JSON.stringify(data);
    await writeFile(new URL(name, OUT), text);
    console.log(`${name}: ${(text.length / 1e3).toFixed(0)} kB`);
  }
  for (const [k, v] of Object.entries({ ...mt, ...bm })) console.log(`${k}: ${v.routes} routes, ${v.lines.length} lines, ${v.lines.reduce((a, l) => a + l.length, 0)} points, ${v.stops.length} stops`);

  const metroStops = mt.metro.stops, tramStops = mt.tram.stops;
  const pair = f => { const c = geoCentroid(f); return c ? [dist(c, metroStops), dist(c, tramStops)] : null; };

  // Gemeenten (2024 + 2025 indeling) and Rotterdam wijken/buurten → afstand.json.
  const codes = {};
  for (const year of [2024, NL_DATA_YEAR]) {
    const base = `https://service.pdok.nl/cbs/gebiedsindelingen/${year}/wfs/v1_0`;
    for (const f of await cached(`pdok-gemeente-${year}.json`, () => pdok(base, 'gemeente_gegeneraliseerd', year))) {
      const code = normalizeAreaCode(f.properties?.statcode);
      const p = code && pair(f);
      if (p) codes[code] = p;
    }
  }
  for (const name of ['rotterdam_wijken.geojson', 'rotterdam_buurten.geojson']) {
    const geo = JSON.parse(await readFile(new URL(name, ROOT), 'utf8'));
    for (const f of geo.features) {
      const code = normalizeAreaCode(f.properties?.statcode);
      const p = code && pair(f);
      if (p) codes[code] = p;
    }
  }
  const afstand = { format: 1, built: TODAY, source: `${OSM_SOURCE}; gebieden: PDOK CBS gebiedsindelingen`, keys: ['distMetro', 'distTram'], codes };
  const atext = JSON.stringify(afstand);
  await writeFile(new URL('afstand.json', OUT), atext);
  console.log(`afstand.json: ${Object.keys(codes).length} codes, ${(atext.length / 1e3).toFixed(0)} kB`);

  // NL wijken/buurten: two columns in the existing tables, aligned by code.
  for (const level of ['wijk', 'buurt']) {
    const file = new URL(`${level === 'wijk' ? 'wijken' : 'buurten'}-${NL_DATA_YEAR}.json`, NL_OUT);
    const table = JSON.parse(await readFile(file, 'utf8'));
    const geo = await cached(`pdok-${level}-${NL_DATA_YEAR}.json`, () => pdok(NL_GEO_WFS, NL_GEO_TYPES[level], NL_DATA_YEAR));
    const byCode = new Map(geo.map(f => [normalizeAreaCode(f.properties?.statcode), f]));
    const pairs = table.codes.map(c => (byCode.has(c) ? pair(byCode.get(c)) : null));
    table.cols.distMetro = pairs.map(p => p?.[0] ?? null);
    table.cols.distTram  = pairs.map(p => p?.[1] ?? null);
    table.sources = { ...table.sources, ov: `${OSM_SOURCE} (${TODAY}); afstand hemelsbreed vanaf het midden van het gebied` };
    const text = JSON.stringify(table);
    await writeFile(file, text);
    console.log(`${level}: ${pairs.filter(Boolean).length} of ${pairs.length} with a distance, ${(text.length / 1e6).toFixed(2)} MB`);
  }
}

/** { CODE: [distMetro, distTram] } for every feature of the given FeatureCollections. */
export function afstandCodes(collections, metroStops, tramStops) {
  const codes = {};
  for (const geo of collections) for (const f of geo.features ?? []) {
    const code = normalizeAreaCode(f.properties?.statcode);
    const c = code && geoCentroid(f);
    if (c) codes[code] = [dist(c, metroStops), dist(c, tramStops)];
  }
  return codes;
}

/** --city <slug> (not the default city): bus and afstand of that city only; the NL files stay as they are. */
async function cityMain(city) {
  const file = p => new URL(p.replace(/^\.\//, ''), new URL('../', import.meta.url));
  const [s, w, n, e] = city.ov.busBbox;
  const bus = await cached(`osm-bus-${city.slug}.json`, () => overpass(
    `[out:json][timeout:600];rel["type"="route"]["route"="bus"](${s},${w},${n},${e})->.r;.r out body;way(r.r);out geom;node(r.r);out;`));
  const bm = buildModes(bus, ['bus'], city.ov.busBbox);
  const meta = { format: 1, built: TODAY, source: OSM_SOURCE, license: 'ODbL 1.0', attribution: '© OpenStreetMap contributors' };
  await mkdir(new URL('./', file(city.ov.bus)), { recursive: true });
  const btext = JSON.stringify({ ...meta, coverage: `${city.ov.busRegion} ${city.ov.busBbox.join(',')}`, modes: { bus: { lines: bm.bus.lines, stops: bm.bus.stops } } });
  await writeFile(file(city.ov.bus), btext);
  console.log(`${city.ov.bus}: ${bm.bus.routes} routes, ${bm.bus.lines.length} lines, ${bm.bus.stops.length} stops, ${(btext.length / 1e3).toFixed(0)} kB`);

  const { modes } = JSON.parse(await readFile(new URL('metro-tram.json', OUT), 'utf8'));
  const nl = JSON.parse(await readFile(new URL('afstand.json', OUT), 'utf8'));
  const gemeenten = Object.fromEntries(Object.entries(nl.codes).filter(([k]) => k.startsWith('GM')));
  const geos = await Promise.all([city.geo.wijken, city.geo.buurten].map(async p => JSON.parse(await readFile(file(p), 'utf8'))));
  const codes = { ...gemeenten, ...afstandCodes(geos, modes.metro.stops, modes.tram.stops) };
  const atext = JSON.stringify({ format: 1, built: TODAY, source: `${OSM_SOURCE}; gebieden: PDOK CBS gebiedsindelingen`, keys: ['distMetro', 'distTram'], codes });
  await writeFile(file(city.ov.afstand), atext);
  console.log(`${city.ov.afstand}: ${Object.keys(codes).length} codes, ${(atext.length / 1e3).toFixed(0)} kB`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const slug = cityArg();
  if (!CITIES[slug]) throw new Error(`unknown city ${slug}`);
  await (slug === DEFAULT_CITY ? main() : cityMain(CITIES[slug]));
}
