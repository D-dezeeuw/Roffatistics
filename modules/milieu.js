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

/** Metric keys, in the order of the Layers dropdown and the area modal. */
export const MILIEU_KEYS = Object.freeze(['noiseAnyPct', 'noiseRoadPct', 'noiseNeighbourPct', 'heatPet', 'shadePct']);
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
]);
export const MILIEU_NOTE = `Geluidhinder: modelschattingen per buurt (GGD Gezondheidsmonitor ${HINDER_YEAR}, RIVM), geen metingen; % volwassenen. Bron: RIVM (publiek domein), Klimaateffectatlas (CC BY 4.0).`;

/** The "Milieu" block of the area modal ('' without an entry). `info` = an (i) button. */
export function milieuPanelHtml(entry, { info = '' } = {}) {
  if (!entry || !MILIEU_KEYS.some(k => isNum(entry[k]))) return '';
  const rows = ROWS.map(([k, label, fmt]) => `<li><span>${esc(label)}</span><strong>${isNum(entry[k]) ? fmt(entry[k]) : 'geen data'}</strong></li>`).join('');
  return `<div class="area-extra area-extra-wide area-milieu"><span class="area-extra-label">Milieu${info}</span><ul class="area-milieu-list">${rows}</ul><p class="area-note">${esc(MILIEU_NOTE)}</p></div>`;
}

/** Test hook: sets (or clears) the loaded file from its JSON. */
export function _setMilieuData(json) { data = json ? decodeMilieu(json) : null; dataPromise = null; }
