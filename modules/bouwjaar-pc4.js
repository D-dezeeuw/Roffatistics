// Woningen naar bouwjaar per wijk and buurt, estimated from CBS postcode data
// (v0.29.0, wizard step Bouwstijl). CBS 86165NED only says "bouwjaar afgelopen
// tien jaar" per buurt; the CBS postcode statistics (kerncijfers per
// viercijferige postcode, 2023) count the dwellings per building-year class.
// scripts/build-pc4-bouwjaar.mjs splits each postcode over its buurten by
// address share (the same crosswalk as herkomst-pc4.js, data/nl/pc4-gwb-2023.json)
// and stores dwellings in total, built before 1945 and built 2005 or later per
// buurt, wijk and gemeente in data/nl/bouwjaar-pc4-2023.json. Loaded on demand
// only: one of the two layers, or a personal preset that uses them.
import { PC4_YEAR } from './postcode.js';

export const BOUW_FORMAT = 1;
export const BOUW_YEAR = PC4_YEAR;
export const BOUW_URL = `./data/nl/bouwjaar-pc4-${PC4_YEAR}.json`;
/** CBS "Gegevens per postcode", PC4 2023 (definitive, published 2026). */
export const BOUW_SOURCE_URL = `https://download.cbs.nl/postcode/2026-cbs_pc4_${PC4_YEAR}_vol.zip`;
/** Below this many (estimated) dwellings a share is too noisy to show: null. */
export const BOUW_MIN_DWELLINGS = 50;
/** "Oude bouw" = built before this year (vooroorlogs). */
export const OLD_BUILD_BEFORE = 1945;
/** "Moderne bouw" = built in this year or later. */
export const MODERN_BUILD_FROM = 2005;

/** The eight CBS building-year classes (gpkg column names, checked 15 Nov 2026). */
export const BOUW_CLASSES = Object.freeze({
  voor1945: 'aantal_woningen_bouwjaar_voor_1945',
  b45tot65: 'aantal_woningen_bouwjaar_45_tot_65',
  b65tot75: 'aantal_woningen_bouwjaar_65_tot_75',
  b75tot85: 'aantal_woningen_bouwjaar_75_tot_85',
  b85tot95: 'aantal_woningen_bouwjaar_85_tot_95',
  b95tot05: 'aantal_woningen_bouwjaar_95_tot_05',
  b05tot15: 'aantal_woningen_bouwjaar_05_tot_15',
  b15plus:  'aantal_woningen_bouwjaar_15_en_later',
});
export const BOUW_TOTAL_COLUMN = 'aantal_woningen';
/** Stored count → the classes it sums. */
export const BOUW_GROUPS = Object.freeze({ old: Object.freeze(['voor1945']), modern: Object.freeze(['b05tot15', 'b15plus']) });
/** Metric key per stored count. */
export const BOUW_METRIC = Object.freeze({ old: 'oldBuildPct', modern: 'modernBuildPct' });
export const BOUW_KEYS = Object.freeze(Object.values(BOUW_METRIC));
export const isBouwKey = k => BOUW_KEYS.includes(k);
export const BOUW_LABEL = `geschat via postcode, ${PC4_YEAR}`;

const num = v => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);

/**
 * Rows of the CBS PC4 file ({ postcode, aantal_woningen, aantal_woningen_bouwjaar_… })
 * → { pc4: { total, old, modern } }. A secret cell (CBS -99997, any negative)
 * counts as 0 inside a class; a postcode without a positive dwelling total is
 * left out. The total is CBS's own dwelling count, so a suppressed class lowers
 * a share rather than raising the others.
 */
export function bouwCountsFromRows(rows) {
  const out = {};
  for (const r of rows ?? []) {
    const pc = String(r?.postcode ?? '').trim();
    const total = num(r?.[BOUW_TOTAL_COLUMN]);
    if (!/^[1-9]\d{3}$/.test(pc) || !(total > 0)) continue;
    const cls = k => Math.max(num(r[BOUW_CLASSES[k]]) ?? 0, 0);
    const o = { total };
    for (const [g, keys] of Object.entries(BOUW_GROUPS)) o[g] = Math.min(total, keys.reduce((s, k) => s + cls(k), 0));
    out[pc] = o;
  }
  return out;
}

/** { code: { total, old, modern } } → column-wise level { codes, total, old, modern } (rounded, codes sorted). */
export function encodeBouwLevel(counts) {
  const codes = Object.keys(counts).sort();
  const col = k => codes.map(c => Math.round(counts[c][k] ?? 0));
  return { codes, total: col('total'), old: col('old'), modern: col('modern') };
}

/** The file object → Map(code → { total, old, modern }) over every level. Throws on another format. */
export function decodeBouwjaar(data) {
  if (data?.format !== BOUW_FORMAT || !data.levels) throw new Error('bouwjaar-pc4: unknown data format');
  const out = new Map();
  for (const lvl of Object.values(data.levels)) {
    lvl.codes.forEach((code, i) => out.set(code, { total: lvl.total[i], old: lvl.old[i], modern: lvl.modern[i] }));
  }
  return out;
}

/** An entry → { oldBuildPct, modernBuildPct } (% of dwellings, 1 decimal); null below BOUW_MIN_DWELLINGS or without an entry. */
export function bouwSharesOf(entry) {
  const ok = entry && entry.total >= BOUW_MIN_DWELLINGS;
  const share = v => (ok && v != null ? Math.min(100, Math.round(v / entry.total * 1000) / 10) : null);
  return { [BOUW_METRIC.old]: share(entry?.old), [BOUW_METRIC.modern]: share(entry?.modern) };
}

let data = null, dataPromise = null;
const listeners = [];
/** Runs `fn` once the data lands, before the load promise resolves (app.js adds the shares and rescores). */
export const onBouwLoaded = fn => { listeners.push(fn); };
export const isBouwLoaded = () => data != null;
/** The entry of a code ('BU…', 'WK…', 'GM…'), or null (not loaded / no 2023 match). */
export const getBouwEntry = code => data?.get(String(code ?? '').trim().toUpperCase()) ?? null;

/** Loads (once) the counts; a failure is forgotten so the next call retries. */
export function loadBouwjaar({ fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
  if (data) return Promise.resolve(data);
  if (!dataPromise) {
    dataPromise = Promise.resolve(fetcher(BOUW_URL)).then(r => { if (!r.ok) throw new Error(`${BOUW_URL} ${r.status}`); return r.json(); }).then(j => {
      data = decodeBouwjaar(j);
      for (const fn of listeners) { try { fn(data); } catch (err) { console.warn('bouwjaar-pc4 listener:', err); } }
      return data;
    });
    dataPromise.catch(() => { dataPromise = null; });
  }
  return dataPromise;
}

/**
 * Adds oldBuildPct / modernBuildPct to the values of wijken and buurten (in
 * place); no-op until loaded. Areas without a 2023 match get null.
 */
export function addBouwShares(areas) {
  if (!data) return areas;
  for (const a of areas ?? []) {
    if (!/^(WK|BU)/.test(a?.code ?? '')) continue;
    a.values = Object.assign(a.values ?? {}, bouwSharesOf(getBouwEntry(a.code)));
  }
  return areas;
}

/** True when a preset uses one of the two keys (the data then has to be loaded). */
export const presetUsesBouw = preset => (preset?.themes ?? []).some(t => (t.metrics ?? []).some(m => isBouwKey(m.key)));

/** Test hook. */
export function _setBouwData(json) { data = json ? decodeBouwjaar(json) : null; dataPromise = null; }
