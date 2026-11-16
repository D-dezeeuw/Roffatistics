// Herkomst per wereldregio per gemeente (v0.28.0, docs/decisions.md W9).
// CBS 85458NED publishes ~45 single countries plus the continent totals per
// gemeente. Each named country belongs to one UN M49 subregion (Dutch labels);
// a region's count is the sum of its NAMED countries only. What a continent
// holds beyond its named countries is shown as "Overig <werelddeel>", never
// guessed into a subregion. Together with Nederland and Onbekend the regions
// partition the CBS total exactly (tests/herkomst-regio.test.js).
//
// The same country → region table also serves wijk/buurt (herkomst-pc4.js):
// there the postcode table names only eight countries, so a region holds fewer
// countries (Noord-Afrika = Marokko) and regions without one of those eight have
// no value; nothing spreads a gemeente mix down. The gemeente counts live in a
// small static file built by scripts/build-gemeente-regio.mjs, loaded on demand.
import { HK, COUNTRIES, HERKOMST_TABLE, HERKOMST_YEAR } from './herkomst.js';

export { HERKOMST_TABLE as REGIO_TABLE, HERKOMST_YEAR as REGIO_YEAR };
export const REGIO_FORMAT = 1;
export const REGIO_URL = `./data/nl/herkomst-regio-gemeente-${HERKOMST_YEAR}.json`;
export const HK_UNKNOWN = '2012659';
/** CBS aggregates that overlap named countries: never summed into a region. */
export const HK_FORMER = Object.freeze({ H007069: '(voormalig) Joegoslavië', H007204: '(voormalig) Tsjecho-Slowakije', H007172: '(voormalige) Sovjet-Unie' });

/** Werelddelen with their 85458NED total key. Turkije counts under Azië in 85458NED. */
export const CONTINENTS = Object.freeze({
  europa:  Object.freeze({ label: 'Europa', key: HK.europe }),
  afrika:  Object.freeze({ label: 'Afrika', key: HK.africa }),
  amerika: Object.freeze({ label: 'Amerika', key: HK.america }),
  azie:    Object.freeze({ label: 'Azië', key: HK.asia }),
  oceanie: Object.freeze({ label: 'Oceanië', key: HK.oceania }),
});

/**
 * Named country (85458NED key) → region key (UN M49 subregion). Nederlandse
 * Cariben (H007119) is a CBS aggregate that already holds Aruba and Curaçao,
 * so those two map to the same region but are counted through H007119 only.
 */
export const COUNTRY_REGION = Object.freeze({
  // Europa
  H008776: 'noordEuropa',
  H008552: 'westEuropa', H008592: 'westEuropa', H008605: 'westEuropa',
  H008559: 'zuidEuropa', H008615: 'zuidEuropa', H008636: 'zuidEuropa', H008719: 'zuidEuropa', H008736: 'zuidEuropa', H008749: 'zuidEuropa',
  H008567: 'oostEuropa', H008627: 'oostEuropa', H008706: 'oostEuropa', H008718: 'oostEuropa', H008723: 'oostEuropa', H008724: 'oostEuropa',
  // Afrika
  H008594: 'noordAfrika', H008673: 'noordAfrika',
  H008612: 'westAfrika', H008644: 'westAfrika', H008699: 'westAfrika',
  H008597: 'oostAfrika', H008599: 'oostAfrika', H008747: 'oostAfrika',
  H008787: 'zuidelijkAfrika',
  // Amerika
  H008571: 'noordAmerika', H008778: 'noordAmerika',
  H007119: 'caribischGebied', H008544: 'caribischGebied', H008586: 'caribischGebied',
  H008562: 'zuidAmerika', H008579: 'zuidAmerika', H008751: 'zuidAmerika',
  // Azië
  H008766: 'westAzie', H008753: 'westAzie', H008633: 'westAzie',
  H008533: 'zuidelijkAzie', H008631: 'zuidelijkAzie', H008634: 'zuidelijkAzie', H008710: 'zuidelijkAzie',
  H008575: 'oostelijkAzie',
  H008603: 'zuidoostAzie', H008632: 'zuidoostAzie', H008757: 'zuidoostAzie', H008780: 'zuidoostAzie',
  // Oceanië
  H008545: 'oceanie',
});
/** Countries counted inside an aggregate (key → aggregate key), never on their own. */
export const INCLUDED_IN = Object.freeze({ H008544: HK.caribbean, H008586: HK.caribbean });

const NAMES = { ...COUNTRIES, [HK.caribbean]: 'Nederlandse Cariben' };
export const countryName = k => NAMES[k] ?? k;

const reg = (key, label, continent, color, extra = {}) => Object.freeze({ key, label, continent, color, metric: `hr_${key}`, ...extra });

/**
 * The regions, per werelddeel in M49 order, each werelddeel closed by its rest.
 * `same`: the detailed Gemeenschap group (herkomst-gemeente.js) with exactly
 * the same definition, so the wizard does not offer it twice.
 * `whole`: the region is the entire werelddeel (Oceanië: only Australië is named).
 */
export const REGIONS = Object.freeze([
  reg('noordEuropa',     'Noord-Europa',     'europa',  '#ddd6fe'),
  reg('westEuropa',      'West-Europa',      'europa',  '#c4b5fd'),
  reg('zuidEuropa',      'Zuid-Europa',      'europa',  '#a78bfa'),
  reg('oostEuropa',      'Oost-Europa',      'europa',  '#7c3aed'),
  reg('overigEuropa',    'Overig Europa',    'europa',  '#ede9fe', { rest: true }),
  reg('noordAfrika',     'Noord-Afrika',     'afrika',  '#f97316'),
  reg('westAfrika',      'West-Afrika',      'afrika',  '#facc15'),
  reg('oostAfrika',      'Oost-Afrika',      'afrika',  '#fb923c'),
  reg('zuidelijkAfrika', 'Zuidelijk Afrika', 'afrika',  '#fde68a'),
  reg('overigAfrika',    'Overig Afrika',    'afrika',  '#fef3c7', { rest: true }),
  reg('noordAmerika',    'Noord-Amerika',    'amerika', '#86efac', { same: 'noordAmerika' }),
  reg('caribischGebied', 'Caribisch gebied', 'amerika', '#4ade80', { same: 'cariben' }),
  reg('zuidAmerika',     'Zuid-Amerika',     'amerika', '#22c55e'),
  reg('overigAmerika',   'Overig Amerika',   'amerika', '#dcfce7', { rest: true }),
  reg('westAzie',        'West-Azië (Midden-Oosten)', 'azie', '#f43f5e'),
  reg('zuidelijkAzie',   'Zuid-Azië',        'azie',    '#7dd3fc'),
  reg('oostelijkAzie',   'Oost-Azië',        'azie',    '#0369a1'),
  reg('zuidoostAzie',    'Zuidoost-Azië',    'azie',    '#38bdf8'),
  reg('overigAzie',      'Overig Azië',      'azie',    '#e0f2fe', { rest: true }),
  reg('oceanie',         'Oceanië',          'oceanie', '#f472b6', { whole: true, same: 'oceanie' }),
]);
export const REGION_KEYS = Object.freeze(REGIONS.map(r => r.key));
/**
 * Nederland as a region of the "Herkomst" layers (15 Nov 2026): the CBS
 * Nederlandse achtergrond, metric originDutchPct, which exists at every level
 * (gemeente, wijk, buurt). Not part of REGIONS: those partition the
 * migration background, and the file and regionGap keep Nederland apart.
 */
export const NEDERLAND_REGION = Object.freeze({ key: 'nederland', label: 'Nederland', continent: 'europa', color: '#e5e7eb', metric: 'originDutchPct', native: true });
/**
 * The regions offered as layers in the Gemeenschappen category. Since 16 Nov
 * 2026 Nederland is no layer (it read as racist): the category's headline is
 * Diversiteit (diversityPct = 100 − originDutchPct, datasets.js); NEDERLAND_REGION
 * stays for the dashboard, wizard and nederlandShareOf.
 */
export const LAYER_REGIONS = Object.freeze([...REGIONS]);
/** Metric keys (`hr_<region>`) of the gemeente layers. */
export const REGION_METRICS = Object.freeze(REGIONS.map(r => r.metric));
export const isRegionMetric = k => REGION_METRICS.includes(k);
export const regionByKey = k => REGIONS.find(r => r.key === k) ?? null;

/** The named countries (85458NED keys) a region sums: aggregates instead of their parts. */
export function regionMembers(key) {
  return Object.keys(COUNTRY_REGION).filter(k => COUNTRY_REGION[k] === key && !INCLUDED_IN[k]);
}

/** Named countries of a werelddeel (keys counted on their own). */
const continentMembers = c => REGIONS.filter(r => r.continent === c && !r.rest && !r.whole).flatMap(r => regionMembers(r.key));

/** A region as CBS keys: { plus, minus } (a rest = werelddeel − its named countries). */
export function regionPlusMinus(key) {
  const r = regionByKey(key);
  if (!r) return null;
  if (r.whole) return { plus: [CONTINENTS[r.continent].key], minus: [] };
  if (r.rest) return { plus: [CONTINENTS[r.continent].key], minus: continentMembers(r.continent) };
  return { plus: regionMembers(key), minus: [] };
}

/** Plain-Dutch membership of a region for the Uitleg and INFO. */
export function regionComposition(key) {
  const r = regionByKey(key);
  if (!r) return '';
  const names = ks => ks.map(k => (k === HK.caribbean ? 'Nederlandse Cariben (Curaçao, Aruba, Bonaire, Sint-Maarten, Sint-Eustatius, Saba)' : countryName(k))).join(', ');
  if (r.whole) return `heel ${CONTINENTS[r.continent].label} (CBS levert alleen Australië apart)`;
  if (r.rest) return `${CONTINENTS[r.continent].label} min de landen hierboven: alle landen van ${CONTINENTS[r.continent].label} die CBS niet apart levert${REST_NOTES[r.continent] ?? ''}`;
  return names(regionMembers(key));
}
const REST_NOTES = Object.freeze({
  europa: ', onder meer Oostenrijk, Zwitserland, Scandinavië, Ierland, Tsjechië, Kroatië en de Baltische staten',
  afrika: ', onder meer Algerije, Tunesië, Libië en Soedan (in de VN-indeling Noord-Afrika) en Centraal-Afrika',
  amerika: ', onder meer Mexico en Midden-Amerika, Venezuela, Argentinië en de Dominicaanse Republiek',
  azie: ', onder meer Japan, Hongkong, Bangladesh, Sri Lanka, Israël, Libanon, de Golfstaten, de Kaukasus en Centraal-Azië',
});

const num = v => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
/** Every 85458NED key the build fetches. */
export const REGIO_FETCH_KEYS = Object.freeze([...new Set([HK.total, HK.nederland, HK_UNKNOWN, ...Object.values(CONTINENTS).map(c => c.key), ...Object.keys(COUNTRY_REGION).filter(k => !INCLUDED_IN[k])])]);

/** One gemeente's CBS counts → { total, <region>: n } or null when the total or a needed cell is missing. */
export function regionCounts(counts) {
  const total = num(counts?.[HK.total]);
  if (!(total > 0)) return null;
  const out = { total, nederland: num(counts[HK.nederland]), onbekend: num(counts[HK_UNKNOWN]) };
  for (const r of REGIONS) {
    const pm = regionPlusMinus(r.key);
    let v = 0, ok = true;
    for (const k of pm.plus) { const x = num(counts[k]); if (x == null) ok = false; else v += x; }
    for (const k of pm.minus) { const x = num(counts[k]); if (x == null) ok = false; else v -= x; }
    out[r.key] = ok ? Math.max(v, 0) : null;
  }
  return out;
}

/** Sum of Nederland + regions + Onbekend minus the total (0 = exact partition); null when anything is missing. */
export function regionGap(rc) {
  if (!rc) return null;
  const parts = [rc.nederland, rc.onbekend, ...REGION_KEYS.map(k => rc[k])];
  return parts.some(v => v == null) ? null : parts.reduce((a, b) => a + b, 0) - rc.total;
}

/** CBS rows (RegioS, Herkomstland, Bevolking_1) → { GM code: CBS counts }. */
export function gemeenteCountsFromRows(rows) {
  const by = {};
  for (const r of rows ?? []) {
    const code = String(r.RegioS ?? '').trim();
    if (!code.startsWith('GM')) continue;
    (by[code] ??= {})[String(r.Herkomstland ?? '').trim()] = num(r.Bevolking_1);
  }
  return by;
}

/** { GM: CBS counts } → the column-wise file body { codes, total, nederland, onbekend, cols }. */
export function encodeRegio(byGemeente) {
  const rows = Object.entries(byGemeente).map(([c, v]) => [c, regionCounts(v)]).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b));
  return {
    codes: rows.map(([c]) => c), total: rows.map(([, v]) => v.total),
    nederland: rows.map(([, v]) => v.nederland), onbekend: rows.map(([, v]) => v.onbekend),
    cols: Object.fromEntries(REGION_KEYS.map(k => [k, rows.map(([, v]) => v[k])])),
  };
}

/** File object → Map(GM code → { name, total, nederland, onbekend, counts: { region: n } }). Throws on another format. */
export function decodeRegio(data) {
  if (data?.format !== REGIO_FORMAT || !Array.isArray(data.codes)) throw new Error('herkomst-regio: unknown data format');
  const out = new Map();
  data.codes.forEach((code, i) => {
    const counts = {};
    for (const k of REGION_KEYS) counts[k] = data.cols?.[k]?.[i] ?? null;
    out.set(code, { name: data.names?.[i] ?? code, total: data.total[i], nederland: data.nederland?.[i] ?? null, onbekend: data.onbekend?.[i] ?? null, counts });
  });
  return out;
}

const pct = (v, total) => (v == null || !(total > 0) ? null : Math.round(v / total * 1000) / 10);

/** An entry → { hr_<region>: % of inhabitants (1 decimal) }. */
/** Share Nederlandse achtergrond (%, 1 decimal) of an entry; null without total. With regionSharesOf and Onbekend it sums to ~100. */
export function nederlandShareOf(entry) {
  return entry ? pct(entry.nederland, entry.total) : null;
}

/** Share Onbekend (%, 1 decimal) of an entry; null without total. */
export function onbekendShareOf(entry) {
  return entry ? pct(entry.onbekend, entry.total) : null;
}

export function regionSharesOf(entry) {
  return Object.fromEntries(REGIONS.map(r => [r.metric, entry ? pct(entry.counts[r.key], entry.total) : null]));
}

// ── Loader (browser) ────────────────────────────────────────────────────────

let data = null, promise = null;
export const isRegioLoaded = () => data != null;
export const getRegioEntry = code => data?.get(String(code ?? '').trim().toUpperCase()) ?? null;

/** Loads (once) the region counts; a failure is forgotten so the next call retries. */
export function loadGemeenteRegio({ fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
  if (data) return Promise.resolve(data);
  if (!promise) {
    promise = Promise.resolve().then(() => fetcher(REGIO_URL))
      .then(r => { if (!r.ok) throw new Error(`${REGIO_URL} ${r.status}`); return r.json(); })
      .then(j => (data = decodeRegio(j)));
    promise.catch(() => { promise = null; });
  }
  return promise;
}
export function _setRegioData(json) { data = json ? decodeRegio(json) : null; promise = null; }

/** Map(GM code → % of inhabitants) of one region from the loaded file (empty until loaded). */
export function regionShareMap(regionKey) {
  const out = new Map();
  for (const [code, e] of data ?? []) { const p = pct(e.counts[regionKey], e.total); if (p != null) out.set(code, p); }
  return out;
}

/** Gemeente rows ({ regionCode, … }) with the region shares added; unchanged until loaded or for other codes. */
export function withRegionShares(rows) {
  if (!data) return rows;
  return (rows ?? []).map(r => (/^GM/.test(r?.regionCode ?? '') && data.has(r.regionCode) ? { ...r, ...regionSharesOf(data.get(r.regionCode)) } : r));
}

/** Rows for a modal block: [{ key, label, color, pct, count, rest }] by share, regions with 0 left out; null without data. */
export function regionRows(code, entry = getRegioEntry(code)) {
  if (!entry) return null;
  const s = regionSharesOf(entry);
  return REGIONS.map(r => ({ key: r.key, label: r.label, color: r.color, pct: s[r.metric], count: entry.counts[r.key], rest: !!r.rest }))
    .filter(r => r.pct != null && r.count > 0).sort((a, b) => b.pct - a.pct);
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = v => `${v.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** HTML of the "herkomst per regio" block for gemeente `gm` ('' without data). */
export function regionHtml(gm, entry = getRegioEntry(gm)) {
  const rows = regionRows(gm, entry);
  if (!rows?.length) return '';
  const max = Math.max(...rows.map(r => r.pct), 1);
  return `<ul class="pc4-origin">${rows.map(r => `<li><span class="pc4-origin-label">${esc(r.label)}</span><span class="pc4-origin-bar"><i style="width:${(r.pct / max * 100).toFixed(1)}%;background:${r.color}"></i></span><span class="pc4-origin-val">${fmt(r.pct)}</span></li>`).join('')}</ul>
<p class="pc4-origin-note">Hele gemeente ${esc(entry.name)}, CBS ${HERKOMST_TABLE}, 1 januari ${HERKOMST_YEAR}. Een regio telt alleen de landen die CBS apart levert; de rest van een werelddeel staat onder "Overig". Dit zijn de cijfers van de hele gemeente, geen schatting voor dit gebied. Zie Uitleg.</p>`;
}
