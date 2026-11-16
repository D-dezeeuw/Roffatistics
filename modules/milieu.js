// Milieu per buurt (docs/plan-milieu.md, phase 1): geluidhinder wegverkeer,
// geluidhinder buren, stilte-index (geluidhinder van alle bronnen samen),
// gevoelstemperatuur and schaduw. scripts/build-nl-milieu.mjs reads the RIVM
// Atlas Leefomgeving (GGD Gezondheidsmonitor 2024, small-area estimates) and
// the Klimaateffectatlas per buurt 2024, maps them to the buurt indeling 2025
// and writes data/nl/milieu-buurt-2025.json with wijk, gemeente and provincie
// values as population-weighted means. Loaded on demand only (a Milieu layer,
// a stack with one, or the area modal), like modules/onderwijs.js.
export const MILIEU_FORMAT = 1;
export const MILIEU_YEAR = 2025;   // buurt indeling of the file
export const MILIEU_URL = `./data/nl/milieu-buurt-${MILIEU_YEAR}.json`;
/** Peiljaren of the sources (shown in the Uitleg and the area modal). */
export const HINDER_YEAR = 2024;
export const PET_YEAR = 2022;
export const SHADE_YEAR = 2024;
export const AIR_YEAR = 2024;      // GCN/NSL jaargemiddelde behind the RIVM *_actueel coverages (keyword rivm_nsl_20260401_gm_*2024)

/** Metric keys, in the order of the Layers dropdown and the area modal. */
export const MILIEU_KEYS = Object.freeze(['noiseAnyPct', 'noiseRoadPct', 'noiseNeighbourPct', 'heatPet', 'shadePct', 'airNo2', 'airPm25', 'pfasSourceKm']);
export const isMilieuKey = key => MILIEU_KEYS.includes(key);

/** RIVM fields (% volwassenen ernstig gehinderd, the same full record in every *_bu_*_2024 layer). */
export const HINDER_FIELDS = Object.freeze({ weg: 'b_gel_weg', trein: 'b_gel_trei', vlieg: 'b_gel_vv', wind: 'b_gel_wtn', buren: 'b_gel_bu' });

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num = v => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
const round1 = v => (v == null ? null : Math.round(v * 10) / 10);
/** A source value: numbers only; RIVM writes -9999 where it has no estimate (small buurten), so negatives are null. */
export const cleanValue = v => { const n = num(v); return n == null || n < 0 ? null : n; };
const norm = code => String(code ?? '').trim().toUpperCase();

/**
 * Stilte-index: the share of adults seriously bothered by at least one of the
 * five sources, assuming the sources bother people independently:
 * 1 − Π(1 − p/100). RIVM publishes no combined figure; null when a source is missing.
 */
export function combinedHinder(rec) {
  let none = 1;
  for (const f of Object.values(HINDER_FIELDS)) {
    const p = cleanValue(rec?.[f]);
    if (p == null) return null;
    none *= 1 - Math.min(100, p) / 100;
  }
  return round1((1 - none) * 100);
}

/** One RIVM record → { noiseRoadPct, noiseNeighbourPct, noiseAnyPct }. */
export const rivmValues = rec => ({
  noiseRoadPct: round1(cleanValue(rec?.[HINDER_FIELDS.weg])),
  noiseNeighbourPct: round1(cleanValue(rec?.[HINDER_FIELDS.buren])),
  noiseAnyPct: combinedHinder(rec),
});

// ── Air quality raster → buurt (build, phase 2) ────────────────────────────────

/**
 * WGS84 (lat, lon) → RD New (EPSG:28992) [x, y], the RD/NAP approximation
 * series (Schreutelaar; about 1 m off inside NL, plenty for a 100 m raster).
 */
const RD_R = [[0, 1, 190094.945], [1, 1, -11832.228], [2, 1, -114.221], [0, 3, -32.391], [1, 0, -0.705], [3, 1, -2.34], [1, 3, -0.608], [0, 2, -0.008], [2, 3, 0.148]];
const RD_S = [[1, 0, 309056.544], [0, 2, 3638.893], [2, 0, 73.077], [1, 2, -157.984], [3, 0, 59.788], [0, 1, 0.433], [2, 2, -6.439], [1, 1, -0.032], [0, 4, 0.092], [1, 4, -0.054]];
export function wgs84ToRd(lat, lon) {
  const dp = 0.36 * (lat - 52.1551744), dl = 0.36 * (lon - 5.38720621);
  let x = 155000, y = 463000;
  for (const [p, q, r] of RD_R) x += r * dp ** p * dl ** q;
  for (const [p, q, r] of RD_S) y += r * dp ** p * dl ** q;
  return [x, y];
}

/**
 * Raster tiles [{ ox, oy, sx, sy, width, height, data, nodata }] (origin = top-left
 * corner, sy negative) → value at RD (x, y); null outside every tile, on nodata or a negative value.
 */
export function rasterValueAt(tiles, x, y) {
  for (const t of tiles) {
    const i = Math.floor((x - t.ox) / t.sx), j = Math.floor((y - t.oy) / t.sy);
    if (i < 0 || j < 0 || i >= t.width || j >= t.height) continue;
    const v = t.data[j * t.width + i];
    if (!Number.isFinite(v) || v < 0 || (t.nodata != null && Math.abs(v - t.nodata) <= Math.abs(t.nodata) * 1e-6)) return null;
    return v;
  }
  return null;
}

/**
 * Area-weighted mean of a raster over a buurt: the mean of the values at a
 * regular `step` m grid of RD points inside the polygons (WGS84 rings, converted
 * to RD); a buurt too small to hold a grid point takes the value at `centre`
 * ([lon, lat]). null without any value.
 */
export function rasterMeanOver(polys, sample, inside, { step = 100, centre = null } = {}) {
  const rd = polys.map(rings => rings.map(ring => ring.map(([lon, lat]) => wgs84ToRd(lat, lon))));
  const [x0, y0, x1, y1] = bboxOf(rd);
  let s = 0, n = 0;
  for (let x = Math.ceil(x0 / step) * step + step / 2; x < x1; x += step) {
    for (let y = Math.ceil(y0 / step) * step + step / 2; y < y1; y += step) {
      if (!rd.some(rings => inside([x, y], rings))) continue;
      const v = sample(x, y);
      if (v != null) { s += v; n++; }
    }
  }
  if (!n && centre) { const v = sample(...wgs84ToRd(centre[1], centre[0])); if (v != null) return round1(v); }
  return n ? round1(s / n) : null;
}

// ── Afstand tot verdachte PFAS-bron (build, phase 2) ─────────────────────────

/** Great-circle distance in km between [lon, lat] points. */
export function haversineKm([lon1, lat1], [lon2, lat2]) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** km (0.1) from `point` ([lon, lat]) to the nearest of `sources` ([[lon, lat]]); null without sources. */
export function nearestKm(point, sources) {
  let best = Infinity;
  for (const s of sources) {
    if (Math.abs(s[1] - point[1]) * 111 > best) continue;   // cheap latitude cut
    const d = haversineKm(point, s);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? round1(best) : null;
}

// ── Buurt 2024 → 2025 (build) ───────────────────────────────────────────────

/** Bounding box [minX, minY, maxX, maxY] of polygons (arrays of rings). */
export function bboxOf(polys) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const rings of polys) for (const [x, y] of rings[0] ?? []) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
  return b;
}

/** A regular grid of up to n×n points of the bbox that fall inside the polygons (area samples). */
export function samplePoints(polys, inside, n = 12) {
  const [x0, y0, x1, y1] = bboxOf(polys);
  const pts = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const p = [x0 + (x1 - x0) * (i + 0.5) / n, y0 + (y1 - y0) * (j + 0.5) / n];
    if (polys.some(rings => inside(p, rings))) pts.push(p);
  }
  return pts;
}

/**
 * The candidate that holds most of the sample points (largest area overlap,
 * estimated by sampling); null when none holds any. candidates: [{ code, polys, bbox }].
 */
export function largestOverlap(points, candidates, inside) {
  const hits = new Map();
  for (const p of points) {
    const c = candidates.find(k => p[0] >= k.bbox[0] && p[0] <= k.bbox[2] && p[1] >= k.bbox[1] && p[1] <= k.bbox[3] && k.polys.some(rings => inside(p, rings)));
    if (c) hits.set(c.code, (hits.get(c.code) ?? 0) + 1);
  }
  let best = null;
  for (const [code, n] of hits) if (!best || n > best[1] || (n === best[1] && code < best[0])) best = [code, n];
  return best?.[0] ?? null;
}

/**
 * Maps every 2025 buurt to a 2024 buurt: by code where the code still exists,
 * else `overlap(code)` (largest area overlap; may return null).
 * → { map: Map(2025 → 2024), byCode, byOverlap, unmatched: [2025 codes] }.
 */
export function mapBuurten(codes2025, codes2024, overlap = () => null) {
  const known = codes2024 instanceof Set ? codes2024 : new Set(codes2024);
  const map = new Map(), unmatched = [];
  let byCode = 0, byOverlap = 0;
  for (const code of codes2025) {
    if (known.has(code)) { map.set(code, code); byCode++; continue; }
    const old = overlap(code);
    if (old && known.has(old)) { map.set(code, old); byOverlap++; } else unmatched.push(code);
  }
  return { map, byCode, byOverlap, unmatched };
}

// ── Aggregation (build) ─────────────────────────────────────────────────────

/** Population-weighted mean per parent of each key; buurten without inhabitants or a value do not count. */
export function weightedMeans(rows, parentOf, keys = MILIEU_KEYS) {
  const acc = new Map();
  for (const { code, pop, values } of rows) {
    const p = parentOf(code);
    if (!p || !(pop > 0)) continue;
    if (!acc.has(p)) acc.set(p, Object.fromEntries(keys.map(k => [k, { w: 0, s: 0 }])));
    const a = acc.get(p);
    for (const k of keys) if (isNum(values?.[k])) { a[k].w += pop; a[k].s += pop * values[k]; }
  }
  const out = new Map();
  for (const [p, a] of acc) if (keys.some(k => a[k].w > 0)) out.set(p, Object.fromEntries(keys.map(k => [k, a[k].w > 0 ? round1(a[k].s / a[k].w) : null])));
  return out;
}

/** Map(code → values) → column-wise level { codes, cols } (codes sorted). */
export function encodeMilieuLevel(byCode, keys = MILIEU_KEYS) {
  const codes = [...byCode.keys()].sort();
  return { codes, cols: Object.fromEntries(keys.map(k => [k, codes.map(c => byCode.get(c)?.[k] ?? null)])) };
}

/** The file → Map(code → values) over every level. Throws on another format. */
export function decodeMilieu(json) {
  if (json?.format !== MILIEU_FORMAT || !json.levels) throw new Error('milieu: onbekend bestand');
  const out = new Map();
  for (const lvl of Object.values(json.levels)) {
    const cols = lvl?.cols ?? {};
    (lvl?.codes ?? []).forEach((code, i) => out.set(code, Object.fromEntries(MILIEU_KEYS.map(k => [k, cols[k]?.[i] ?? null]))));
  }
  return out;
}

/** The milieu values of a code: every key, null where it has none; {} without data. */
export function milieuValuesFor(code, data) {
  if (!data) return {};
  const e = data.get(norm(code));
  return Object.fromEntries(MILIEU_KEYS.map(k => [k, e?.[k] ?? null]));
}

// ── Loader (browser) ────────────────────────────────────────────────────────

let data = null, dataPromise = null;
const listeners = [];
/** Runs `fn` once the file lands, before the load promise resolves (app.js joins the values). */
export const onMilieuLoaded = fn => { listeners.push(fn); };
export const isMilieuLoaded = () => data != null;
/** True when a Woonscore preset weighs a milieu metric (Standaard: noiseNeighbourPct, v0.54.0): app.js loads the file and rescores. */
export const presetUsesMilieu = preset => (preset?.themes ?? []).some(t => (t.metrics ?? []).some(m => MILIEU_KEYS.includes(m?.key)));
export const getMilieuEntry = code => data?.get(norm(code)) ?? null;

/** Loads (once) the file; a failure is forgotten so the next call retries. */
export function loadMilieu({ fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
  if (data) return Promise.resolve(data);
  if (!dataPromise) {
    dataPromise = Promise.resolve(fetcher(MILIEU_URL)).then(r => { if (!r?.ok) throw new Error(`${MILIEU_URL} ${r?.status}`); return r.json(); }).then(j => {
      data = decodeMilieu(j);
      for (const fn of listeners) { try { fn(data); } catch (err) { console.warn('milieu listener:', err); } }
      return data;
    });
    dataPromise.catch(() => { dataPromise = null; });
  }
  return dataPromise;
}

/** Adds the milieu values to wijken/buurten ({ code, values }) in place; no-op until loaded. */
export function addMilieuValues(areas, d = data) {
  if (!d) return areas;
  for (const a of areas ?? []) {
    if (!/^(WK|BU|GM)/.test(a?.code ?? '')) continue;
    a.values = Object.assign(a.values ?? {}, milieuValuesFor(a.code, d));
  }
  return areas;
}

/** Flat gemeente/provincie rows ({ regionCode, … }) → new rows with the milieu values; the same rows until loaded. */
export function withMilieuRows(rows, d = data) {
  if (!d || !Array.isArray(rows)) return rows;
  return rows.map(r => (/^(GM|PV)/.test(r?.regionCode ?? '') ? { ...r, ...milieuValuesFor(r.regionCode, d) } : r));
}

// ── Area modal block ────────────────────────────────────────────────────────

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nl1 = v => v.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ROWS = Object.freeze([
  ['noiseAnyPct', 'Ernstige geluidhinder, alle bronnen (stilte-index)', v => `${nl1(v)}%`],
  ['noiseRoadPct', 'Ernstige geluidhinder door wegverkeer', v => `${nl1(v)}%`],
  ['noiseNeighbourPct', 'Ernstige geluidhinder door buren', v => `${nl1(v)}%`],
  ['heatPet', 'Gevoelstemperatuur op een hete dag', v => `${nl1(v)} °C`],
  ['shadePct', 'Schaduw op fiets- en wandelpaden', v => `${nl1(v)}%`],
  ['airNo2', 'Stikstofdioxide (NO₂), jaargemiddelde', v => `${nl1(v)} µg/m³`],
  ['airPm25', 'Fijnstof (PM2,5), jaargemiddelde', v => `${nl1(v)} µg/m³`],
  ['pfasSourceKm', 'Afstand tot verdachte PFAS-bron', v => `${nl1(v)} km`],
]);
export const MILIEU_NOTE = `Geluidhinder: modelschattingen per buurt (GGD Gezondheidsmonitor ${HINDER_YEAR}, RIVM), geen metingen; % volwassenen. Lucht: RIVM-kaart ${AIR_YEAR} (WHO-advies: NO₂ 10, PM2,5 5 µg/m³). PFAS-bron: vermoedelijke bron volgens de PFAS Data Hub (CNRS), geen meting. Bron: RIVM (publiek domein), Klimaateffectatlas (CC BY 4.0), PFAS Data Hub.`;

/** The "Milieu" block of the area modal ('' without an entry). `info` = an (i) button. */
export function milieuPanelHtml(entry, { info = '' } = {}) {
  if (!entry || !MILIEU_KEYS.some(k => isNum(entry[k]))) return '';
  const rows = ROWS.map(([k, label, fmt]) => `<li><span>${esc(label)}</span><strong>${isNum(entry[k]) ? fmt(entry[k]) : 'geen data'}</strong></li>`).join('');
  return `<div class="area-extra area-extra-wide area-milieu"><span class="area-extra-label">Milieu${info}</span><ul class="area-milieu-list">${rows}</ul><p class="area-note">${esc(MILIEU_NOTE)}</p></div>`;
}

/** Test hook: sets (or clears) the loaded file from its JSON. */
export function _setMilieuData(json) { data = json ? decodeMilieu(json) : null; dataPromise = null; }
