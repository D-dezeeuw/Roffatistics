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

/** Two-letter hash code per detailed group (Nederland is a broad group already). */
const CODES = Object.freeze({
  euZuid: 'ez', euMoe: 'em', euOverig: 'eo', euNietEu: 'en', turkije: 'tr', marokko: 'ma', egypte: 'eg',
  subSahara: 'ss', suriname: 'sr', cariben: 'ca', noordAmerika: 'na', latAmerika: 'la', indonesie: 'id',
  middenOosten: 'mo', zuidAzie: 'za', oostAzie: 'oa', azieOverig: 'ao', oceanie: 'oc',
});

/** Detailed groups: key → { label, code, key: metric key, group: the herkomst.js group }. */
export const DETAIL_GROUPS = Object.freeze(Object.fromEntries(ORIGIN_GROUPS.filter(g => CODES[g.key]).map(g =>
  [g.key, Object.freeze({ label: g.label, code: CODES[g.key], key: `hk_${g.key}`, group: g })])));
/** Every detailed metric key: origin metrics, under the same positive-only guard as the broad ones. */
export const DETAIL_KEYS = Object.freeze(Object.values(DETAIL_GROUPS).map(d => d.key));

const ODATA = 'https://opendata.cbs.nl/ODataApi/odata';

/** One query: every gemeente, the latest year, Totaal plus the group's keys. */
export function buildGemeenteGroupUrl(groupKey, year = HERKOMST_YEAR) {
  const d = DETAIL_GROUPS[groupKey];
  if (!d) return null;
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
  if (!d) return out;
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
  if (pending.has(groupKey)) return pending.get(groupKey);
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
