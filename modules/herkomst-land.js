// Gemeenschappen per land per gemeente (v0.55.0, docs/decisions.md "Gemeenschappen
// per land per gemeente"). CBS 85458NED publishes 45 single countries plus the
// aggregate Nederlandse Cariben per gemeente; scripts/build-gemeente-land.mjs
// stores each one's share of all inhabitants (%, 1 decimal) in
// data/nl/herkomst-land-gemeente-<year>.json, loaded on demand only.
//
// Keys: a country that already has a postcode-estimated layer per wijk/buurt
// (herkomst-pc4.js: Suriname, Turkije, Marokko, Nederlandse Cariben, Indonesië,
// Polen, Duitsland, België) reuses that `hk_<key>`: per gemeente the official
// CBS value, per wijk/buurt the estimate. Every other country gets a new
// `hk_<slug>` that exists per gemeente only (dataset scope 'nederland').
// Left out: the continents, EU/GIPS/MOE and the (voormalig) Joegoslavië,
// Sovjet-Unie and Tsjecho-Slowakije codes, which overlap listed countries.
import { COUNTRIES, HK, HERKOMST_TABLE, HERKOMST_YEAR } from './herkomst.js';

export { HERKOMST_TABLE as LAND_TABLE, HERKOMST_YEAR as LAND_YEAR };
export const LAND_FORMAT = 1;
export const LAND_URL = `./data/nl/herkomst-land-gemeente-${HERKOMST_YEAR}.json`;
/** Postcode-estimated groups (herkomst-pc4.js PC4_GROUPS) that are one 85458NED country: same key. */
export const LAND_PC4_KEYS = Object.freeze({
  H008751: 'suriname', H008766: 'turkije', H008673: 'marokko', H007119: 'cariben',
  H008632: 'indonesie', H008718: 'polen', H008592: 'duitsland', H008552: 'belgie',
});

/** "Bosnië-Herzegovina" → "bosnieHerzegovina". */
export function landSlug(name) {
  const parts = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map(p => p.toLowerCase());
  return parts.map((p, i) => (i ? p[0].toUpperCase() + p.slice(1) : p)).join('');
}

const NAMES = Object.freeze({ ...COUNTRIES, [HK.caribbean]: 'Nederlandse Cariben' });
const ABOUT = Object.freeze({
  [HK.caribbean]: 'Curaçao, Aruba, Bonaire, Sint-Maarten, Sint-Eustatius en Saba samen; Aruba en Curaçao staan ook apart',
  H008673: 'inclusief Westelijke Sahara',
  H008766: 'bij CBS onder Azië',
  H008632: 'inclusief voormalig Nederlands-Indië',
});

/** The countries, sorted by label: [{ code (85458NED key), key, label, metric, pc4, about }]. */
export const LAND_COUNTRIES = Object.freeze(Object.keys(NAMES)
  .map(code => Object.freeze({ code, key: LAND_PC4_KEYS[code] ?? landSlug(NAMES[code]), label: NAMES[code], metric: `hk_${LAND_PC4_KEYS[code] ?? landSlug(NAMES[code])}`, pc4: !!LAND_PC4_KEYS[code], about: ABOUT[code] ?? '' }))
  .sort((a, b) => a.label.localeCompare(b.label, 'nl')));
export const LAND_CODES = Object.freeze(LAND_COUNTRIES.map(c => c.code));
export const LAND_METRICS = Object.freeze(LAND_COUNTRIES.map(c => c.metric));
export const isLandMetric = k => LAND_METRICS.includes(k);
export const landByMetric = k => LAND_COUNTRIES.find(c => c.metric === k) ?? null;

const num = v => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
const pct = (v, total) => (v == null || !(total > 0) ? null : Math.round(v / total * 1000) / 10);

/**
 * CBS rows (RegioS, Herkomstland, Bevolking_1) → the file body
 * { countries: [key], codes: [GM], values: [[share per country] per GM] }.
 * A gemeente without a total is left out; a suppressed (missing) cell is null.
 */
export function encodeLand(rows) {
  const by = {};
  for (const r of rows ?? []) {
    const gm = String(r.RegioS ?? '').trim();
    if (!gm.startsWith('GM')) continue;
    (by[gm] ??= {})[String(r.Herkomstland ?? '').trim()] = num(r.Bevolking_1);
  }
  const codes = Object.keys(by).filter(gm => num(by[gm][HK.total]) > 0).sort();
  return {
    countries: LAND_COUNTRIES.map(c => c.key),
    codes,
    values: codes.map(gm => LAND_COUNTRIES.map(c => pct(by[gm][c.code], by[gm][HK.total]))),
  };
}

/** File object → Map(GM → { hk_<key>: share }). Throws on another format; unknown country keys are skipped. */
export function decodeLand(data) {
  if (data?.format !== LAND_FORMAT || !Array.isArray(data.codes) || !Array.isArray(data.countries) || !Array.isArray(data.values)) throw new Error('herkomst-land: unknown data format');
  const metrics = data.countries.map(k => LAND_COUNTRIES.find(c => c.key === k)?.metric ?? null);
  const out = new Map();
  data.codes.forEach((gm, i) => {
    const row = {};
    metrics.forEach((m, j) => { if (m) row[m] = data.values[i]?.[j] ?? null; });
    for (const m of LAND_METRICS) row[m] ??= null;
    out.set(gm, row);
  });
  return out;
}

// ── Loader (browser) ────────────────────────────────────────────────────────

let data = null, promise = null;
export const isLandLoaded = () => data != null;

/** Loads (once) the country shares; a failure is forgotten so the next call retries. */
export function loadGemeenteLand({ fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
  if (data) return Promise.resolve(data);
  if (!promise) {
    promise = Promise.resolve().then(() => fetcher(LAND_URL))
      .then(r => { if (!r.ok) throw new Error(`${LAND_URL} ${r.status}`); return r.json(); })
      .then(j => (data = decodeLand(j)));
    promise.catch(() => { promise = null; });
  }
  return promise;
}
export function _setLandData(json) { data = json ? decodeLand(json) : null; promise = null; }

/** Gemeente rows ({ regionCode, … }) with the country shares added; unchanged until loaded or for other codes. */
export function withLandShares(rows) {
  if (!data) return rows;
  return (rows ?? []).map(r => (/^GM/.test(r?.regionCode ?? '') && data.has(r.regionCode) ? { ...r, ...data.get(r.regionCode) } : r));
}
