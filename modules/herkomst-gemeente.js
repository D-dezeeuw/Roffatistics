// Detailed herkomst groups per gemeente for the wizard's Gemeenschap step
// (v0.23.0). CBS 85458NED gives the country groups of modules/herkomst.js
// for every gemeente (RegioS 'GM…', checked 15 Nov 2026: 2026JJ00, 347 GM
// codes), never per wijk or buurt. The share of one group is fetched on
// demand, only once the user picks that group, and kept in memory.
//
// The share lands in a metric key `hk_<group>` that only exists for gemeenten,
// so at wijk/buurt level the factor has no data and is skipped (score.js /
// presets.js drop factors without data); nothing substitutes a broad group.
import { ORIGIN_GROUPS, HK, HERKOMST_TABLE, HERKOMST_YEAR, HERKOMST_TOTALS } from './herkomst.js';
import { PC4_GROUP_KEYS, regionAtBuurt } from './herkomst-pc4.js';
import { REGIONS, regionPlusMinus, regionComposition, loadGemeenteRegio, regionShareMap, REGION_METRICS } from './herkomst-regio.js';

/** Two-letter hash code per detailed group (Nederland: see NEDERLAND below). */
const CODES = Object.freeze({
  euZuid: 'ez', euMoe: 'em', euOverig: 'eo', euNietEu: 'en', turkije: 'tr', marokko: 'ma', egypte: 'eg',
  subSahara: 'ss', suriname: 'sr', cariben: 'ca', noordAmerika: 'na', latAmerika: 'la', indonesie: 'id',
  middenOosten: 'mo', zuidAzie: 'za', oostAzie: 'oa', azieOverig: 'ao', oceanie: 'oc',
  polen: 'pl', duitsland: 'de', belgie: 'be',
  // v0.28.0: werelddeel rests that also exist per postcode, and the world regions (gemeente only).
  noordEuropa: 'ne', westEuropa: 'we', zuidEuropa: 'ze', oostEuropa: 'oe', overigEuropa: 'ue',
  noordAfrika: 'nf', westAfrika: 'wf', oostAfrika: 'of', zuidelijkAfrika: 'zf', overigAfrika: 'uf',
  zuidAmerika: 'zm', overigAmerika: 'um',
  westAzie: 'wz', zuidelijkAzie: 'zs', oostelijkAzie: 'os', zuidoostAzie: 'zo', overigAzie: 'ua',
});

// v0.25.0: three single countries 83503NED has per postcode, also published
// per gemeente in 85458NED (same keys). Not part of the ORIGIN_GROUPS partition.
const EXTRA_GROUPS = Object.freeze([
  Object.freeze({ key: 'polen', label: 'Polen', plus: Object.freeze(['H008718']), minus: Object.freeze([]) }),
  Object.freeze({ key: 'duitsland', label: 'Duitsland', plus: Object.freeze(['H008592']), minus: Object.freeze([]) }),
  Object.freeze({ key: 'belgie', label: 'België', plus: Object.freeze(['H008552']), minus: Object.freeze([]) }),
]);

// v0.28.0: world regions (herkomst-regio.js) as detailed groups: per gemeente from the static region
// file, per wijk/buurt (where the region has a postcode source) estimated via postcode. A region with exactly the definition of an existing group (`same`) is not offered twice.
const REGION_GROUPS = Object.freeze(REGIONS.filter(r => !r.same).map(r => Object.freeze({
  key: r.key, label: r.label, region: r.key, ...regionPlusMinus(r.key), composition: regionComposition(r.key),
})));

/**
 * Detailed groups: key → { label, code, key: metric key, group: the herkomst.js group,
 * wijk: true when the share also exists per wijk/buurt (estimated via postcode, herkomst-pc4.js) }.
 */
export const DETAIL_GROUPS = Object.freeze(Object.fromEntries([
  // v0.26.0: Nederland (Nederlandse achtergrond) uses the kerncijfers share `originDutchPct`,
  // which CBS publishes per gemeente, wijk and buurt (direct): nothing to fetch or estimate.
  ['nederland', Object.freeze({ label: 'Nederland', long: 'Nederland (Nederlandse achtergrond)', code: 'nl', key: 'originDutchPct', group: null, wijk: true, direct: true })],
  ...[...ORIGIN_GROUPS, ...EXTRA_GROUPS].filter(g => CODES[g.key]).map(g =>
    [g.key, Object.freeze({ label: g.label, code: CODES[g.key], key: `hk_${g.key}`, group: g, wijk: PC4_GROUP_KEYS.includes(g.key) })]),
  ...REGION_GROUPS.map(g =>
    [g.key, Object.freeze({ label: g.label, long: `${g.label} (regio)`, code: CODES[g.key], key: `hr_${g.key}`, group: g, wijk: regionAtBuurt(g.region), region: g.region })]),
]));
/** Every fetched/estimated detailed metric key (`hk_<group>`): origin metrics, under the same positive-only guard. */
export const DETAIL_KEYS = Object.freeze(Object.values(DETAIL_GROUPS).filter(d => !d.direct).map(d => d.key));
/** Every origin metric of this module and the region layers: `hk_*` groups plus all `hr_*` regions (also those not offered as a group). */
export const ALL_DETAIL_KEYS = Object.freeze([...new Set([...DETAIL_KEYS, ...REGION_METRICS])]);

const ODATA = 'https://opendata.cbs.nl/ODataApi/odata';

/** One query: every gemeente, the latest year, Totaal plus the group's keys. */
export function buildGemeenteGroupUrl(groupKey, year = HERKOMST_YEAR) {
  const d = DETAIL_GROUPS[groupKey];
  if (!d?.group) return null;
  const keys = [HK.total, ...d.group.plus, ...d.group.minus];
  const filter = `startswith(RegioS,'GM') and Geslacht eq '${HERKOMST_TOTALS.Geslacht}' and Leeftijd eq '${HERKOMST_TOTALS.Leeftijd}'`
    + ` and Geboorteland eq '${HERKOMST_TOTALS.Geboorteland}' and Perioden eq '${year}JJ00'`
    + ` and (${keys.map(k => `Herkomstland eq '${k}'`).join(' or ')})`;
  return `${ODATA}/${HERKOMST_TABLE}/TypedDataSet?${new URLSearchParams({ $filter: filter, $select: 'RegioS,Herkomstland,Bevolking_1' })}`;
}

const num = v => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);

/** CBS rows → Map(GM code → share of inhabitants in %, 1 decimal); gemeenten with a missing cell are left out. */
export function parseGemeenteGroupRows(rows, groupKey) {
  const d = DETAIL_GROUPS[groupKey];
  const by = new Map();
  for (const r of rows ?? []) {
    const code = String(r.RegioS ?? '').trim(), k = String(r.Herkomstland ?? '').trim();
    if (!code.startsWith('GM')) continue;
    if (!by.has(code)) by.set(code, {});
    by.get(code)[k] = num(r.Bevolking_1);
  }
  const out = new Map();
  if (!d?.group) return out;
  for (const [code, counts] of by) {
    const total = counts[HK.total];
    let v = 0, ok = total > 0;
    for (const k of d.group.plus) { if (counts[k] == null) ok = false; else v += counts[k]; }
    for (const k of d.group.minus) { if (counts[k] == null) ok = false; else v -= counts[k]; }
    if (ok) out.set(code, Math.round(Math.max(v, 0) / total * 1000) / 10);
  }
  return out;
}

const loaded = new Map();     // group → Map(code → pct)
const pending = new Map();    // group → Promise

/** Shares of a group already in memory (Map), or null. */
export function getGemeenteGroup(groupKey) { return loaded.get(groupKey) ?? null; }

/** Fetches (once per page) the share of `groupKey` per gemeente; rejects when CBS fails (retried on the next call). */
export function loadGemeenteGroup(groupKey, { fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
  if (loaded.has(groupKey)) return Promise.resolve(loaded.get(groupKey));
  if (DETAIL_GROUPS[groupKey]?.direct) return Promise.resolve(new Map());   // Nederland: already in the area values
  if (pending.has(groupKey)) return pending.get(groupKey);
  const region = DETAIL_GROUPS[groupKey]?.region;
  if (region) {   // world region: the static file (herkomst-regio.js), no CBS call
    const p = loadGemeenteRegio({ fetcher }).then(() => { const m = regionShareMap(region); loaded.set(groupKey, m); return m; })
      .finally(() => pending.delete(groupKey));
    pending.set(groupKey, p);
    return p;
  }
  const url = buildGemeenteGroupUrl(groupKey);
  if (!url) return Promise.reject(new Error(`onbekende groep ${groupKey}`));
  const p = Promise.resolve().then(() => fetcher(url))
    .then(res => { if (!res.ok) throw new Error(`CBS ${res.status}`); return res.json(); })
    .then(json => { const m = parseGemeenteGroupRows(json.value, groupKey); loaded.set(groupKey, m); return m; })
    .finally(() => pending.delete(groupKey));
  pending.set(groupKey, p);
  return p;
}
export function _setGemeenteGroup(groupKey, map) { if (map) loaded.set(groupKey, map); else loaded.delete(groupKey); }

/** Detailed groups a preset uses that are not in memory yet. */
export function missingDetailGroups(preset) {
  const out = [];
  for (const t of preset?.themes ?? []) for (const m of t.metrics ?? []) {
    const g = DETAIL_KEYS.includes(m.key) ? m.key.slice(3) : null;
    if (g && !loaded.has(g) && !out.includes(g)) out.push(g);
  }
  return out;
}

/** A gemeente row's values with the loaded detailed shares added (`hk_<group>`); other rows unchanged. */
export function withDetailShares(values, code) {
  if (!loaded.size || !/^GM/.test(String(code ?? ''))) return values;
  const extra = {};
  for (const [g, m] of loaded) if (m.has(code)) extra[DETAIL_GROUPS[g].key] = m.get(code);
  return { ...values, ...extra };
}
