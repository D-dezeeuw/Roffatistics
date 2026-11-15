// Detailed herkomst per wijk and buurt, estimated from CBS postcode data
// (v0.25.0, docs/plan-herkomst-pc4.md). CBS 83503NED gives migration
// background per 4-digit postcode (1 jan 2023); scripts/build-pc4-herkomst.mjs
// splits each postcode over its buurten by address count (CBS pc6huisnr 2023)
// and stores the counts per buurt, wijk and gemeente in
// data/nl/herkomst-pc4-2023.json. Loaded on demand only: a herkomst layer, the
// wizard's Gemeenschap step with a detailed group, the area modal or a
// postcode search. The shares land in the same `hk_<group>` keys as the
// gemeente-level 85458NED groups (herkomst-gemeente.js), so the §5 guards
// (positive-only, opt-in) apply unchanged.
import { ORIGIN_GROUPS } from './herkomst.js';
import { normalizePc4, crosswalkFromJson, pc4ToArea, PC4_YEAR } from './postcode.js';

export { PC4_YEAR };
export const PC4_HERKOMST_FORMAT = 1;
export const PC4_HERKOMST_TABLE = '83503NED';
export const PC4_HERKOMST_YEAR = PC4_YEAR;
export const PC4_HERKOMST_URL = `./data/nl/herkomst-pc4-${PC4_YEAR}.json`;
export const PC4_CROSSWALK_URL = `./data/nl/pc4-gwb-${PC4_YEAR}.json`;
/** Below this many (estimated) inhabitants a share is too noisy to show: null. */
export const PC4_MIN_POPULATION = 50;
export const PC4_LABEL = `geschat via postcode, ${PC4_YEAR}`;

/** 83503NED Migratieachtergrond keys (checked 15 Nov 2026). */
export const MA = Object.freeze({
  total: 'T001040', europa: 'H007933', eu: 'H007935', oceanie: 'H008531',
  belgie: 'H008552', duitsland: 'H008592', indonesie: 'H008632', marokko: 'H008673',
  cariben: 'H007119', polen: 'H008718', suriname: 'H008751', turkije: 'H008766',
});

const colorOf = k => ORIGIN_GROUPS.find(g => g.key === k)?.color;
const pg = (key, label, plus, minus = [], color = colorOf(key)) => Object.freeze({ key, label, plus: Object.freeze(plus), minus: Object.freeze(minus), color, metric: `hk_${key}` });

/**
 * The groups 83503NED has per postcode. Turkije sits under Europa in this
 * table (old CBS indeling), so "Europa buiten de EU" = Europa − EU − Turkije,
 * which matches the 85458NED group of the same name.
 */
export const PC4_GROUPS = Object.freeze([
  pg('suriname',  'Suriname',                 [MA.suriname]),
  pg('turkije',   'Turkije',                  [MA.turkije]),
  pg('marokko',   'Marokko',                  [MA.marokko]),
  pg('cariben',   'Nederlandse Cariben',      [MA.cariben]),
  pg('indonesie', 'Indonesië',                [MA.indonesie]),
  pg('polen',     'Polen',                    [MA.polen], [], '#a78bfa'),
  pg('duitsland', 'Duitsland',                [MA.duitsland], [], '#ddd6fe'),
  pg('belgie',    'België',                   [MA.belgie], [], '#c4b5fd'),
  pg('euNietEu',  'Europa buiten de EU',      [MA.europa], [MA.eu, MA.turkije]),
  pg('oceanie',   'Oceanië',                  [MA.oceanie]),
]);
export const PC4_GROUP_KEYS = Object.freeze(PC4_GROUPS.map(g => g.key));
/** Metric keys (`hk_<group>`) this data fills at wijk and buurt level. */
export const PC4_KEYS = Object.freeze(PC4_GROUPS.map(g => g.metric));
export const isPc4Key = k => PC4_KEYS.includes(k);

const num = v => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);

/**
 * Counts per postcode from 83503NED rows: { pc4: { total, <group>: n } }.
 * A suppressed group cell counts as 0; a postcode without a total is left out.
 */
export function pc4CountsFromRows(rows) {
  const raw = new Map();
  for (const r of rows ?? []) {
    const pc = normalizePc4(r.Postcode);
    if (!pc) continue;
    if (!raw.has(pc)) raw.set(pc, {});
    raw.get(pc)[String(r.Migratieachtergrond ?? '').trim()] = num(r.Bevolking_1);
  }
  const out = {};
  for (const [pc, c] of raw) {
    if (!(c[MA.total] > 0)) continue;
    const o = { total: c[MA.total] };
    for (const g of PC4_GROUPS) {
      const v = g.plus.reduce((s, k) => s + (c[k] ?? 0), 0) - g.minus.reduce((s, k) => s + (c[k] ?? 0), 0);
      o[g.key] = Math.max(v, 0);
    }
    out[pc] = o;
  }
  return out;
}

/** { code: { total, <group> } } → column-wise level { codes, total, cols } (rounded counts, codes sorted). */
export function encodePc4Level(counts) {
  const codes = Object.keys(counts).sort();
  const cols = Object.fromEntries(PC4_GROUP_KEYS.map(k => [k, codes.map(c => Math.round(counts[c][k] ?? 0))]));
  return { codes, total: codes.map(c => Math.round(counts[c].total ?? 0)), cols };
}

/** The file object → Map(code → { total, counts: { group: n } }) over every level. Throws on another format. */
export function decodePc4Herkomst(data) {
  if (data?.format !== PC4_HERKOMST_FORMAT || !data.levels) throw new Error('herkomst-pc4: unknown data format');
  const out = new Map();
  for (const lvl of Object.values(data.levels)) {
    lvl.codes.forEach((code, i) => {
      const counts = {};
      for (const k of PC4_GROUP_KEYS) if (lvl.cols[k]) counts[k] = lvl.cols[k][i];
      out.set(code, { total: lvl.total[i], counts });
    });
  }
  return out;
}

/** An entry → { hk_<group>: % of inhabitants (1 decimal) }; every key null below PC4_MIN_POPULATION. */
export function sharesOf(entry) {
  const ok = entry && entry.total >= PC4_MIN_POPULATION;
  return Object.fromEntries(PC4_GROUPS.map(g => {
    const v = ok ? entry.counts[g.key] : null;
    return [g.metric, v == null ? null : Math.min(100, Math.round(v / entry.total * 1000) / 10)];
  }));
}

// ── Loaders (browser) ───────────────────────────────────────────────────────

let data = null, dataPromise = null, xw = null, xwPromise = null;
const listeners = [];
/** Runs `fn` once the herkomst data lands, before the load promise resolves (app.js adds the shares and rescores). */
export const onPc4Loaded = fn => { listeners.push(fn); };
const getJSON = async (url, fetcher) => { const r = await fetcher(url); if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); };

export const isPc4Loaded = () => data != null;
/** The entry of a code ('BU…', 'WK…', 'GM…'), or null (not loaded / no 2023 match). */
export const getPc4Entry = code => data?.get(String(code ?? '').trim().toUpperCase()) ?? null;

/** Loads (once) the herkomst counts; a failure is forgotten so the next call retries. */
export function loadPc4Herkomst({ fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
  if (data) return Promise.resolve(data);
  if (!dataPromise) {
    dataPromise = getJSON(PC4_HERKOMST_URL, fetcher).then(j => {
      data = decodePc4Herkomst(j);
      for (const fn of listeners) { try { fn(data); } catch (err) { console.warn('herkomst-pc4 listener:', err); } }
      return data;
    });
    dataPromise.catch(() => { dataPromise = null; });
  }
  return dataPromise;
}

/**
 * Adds the `hk_<group>` shares to the values of wijken and buurten (in place);
 * no-op until the data is loaded. Areas without a 2023 match get null.
 */
export function addPc4Shares(areas) {
  if (!data) return areas;
  for (const a of areas ?? []) {
    if (!/^(WK|BU)/.test(a?.code ?? '')) continue;
    a.values = Object.assign(a.values ?? {}, sharesOf(getPc4Entry(a.code)));
  }
  return areas;
}

/** True when a preset uses a postcode-estimated key (the data then has to be loaded). */
export const presetUsesPc4 = preset => (preset?.themes ?? []).some(t => (t.metrics ?? []).some(m => isPc4Key(m.key)));

/** Rows for the area modal: [{ key, label, color, pct, count }] sorted by share; null without data. */
export function pc4OriginRows(code, entry = getPc4Entry(code)) {
  if (!entry || !(entry.total >= PC4_MIN_POPULATION)) return null;
  const s = sharesOf(entry);
  return PC4_GROUPS.map(g => ({ key: g.key, label: g.label, color: g.color, pct: s[g.metric], count: entry.counts[g.key] }))
    .filter(r => r.pct != null).sort((a, b) => b.pct - a.pct);
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = v => `${v.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/** HTML block of the area modal ('' without data). */
export function pc4OriginHtml(code, entry) {
  const rows = pc4OriginRows(code, entry);
  if (!rows) return '';
  const max = Math.max(...rows.map(r => r.pct), 1);
  return `<ul class="pc4-origin">${rows.map(r => `<li><span class="pc4-origin-label">${esc(r.label)}</span><span class="pc4-origin-bar"><i style="width:${(r.pct / max * 100).toFixed(1)}%;background:${r.color}"></i></span><span class="pc4-origin-val">${fmt(r.pct)}</span></li>`).join('')}</ul>
<p class="pc4-origin-note">${esc(PC4_LABEL)}: CBS ${PC4_HERKOMST_TABLE} per postcode, verdeeld naar adressen. Zelfde mix aangenomen in heel het postcodegebied; afgerond op 5. Zie Uitleg.</p>`;
}

// ── Postcode → area (search) ────────────────────────────────────────────────

/** Loads (once) the crosswalk: { cw, names: Map(bare buurt → 2025 name), unmatched: { buurt: Set, wijk: Set } }. */
export function loadPc4Crosswalk({ fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
  if (xw) return Promise.resolve(xw);
  if (!xwPromise) {
    xwPromise = getJSON(PC4_CROSSWALK_URL, fetcher).then(j => (xw = crosswalkIndex(j)));
    xwPromise.catch(() => { xwPromise = null; });
  }
  return xwPromise;
}

/** The crosswalk file object → { cw, names, unmatched }. */
export function crosswalkIndex(json) {
  return {
    cw: crosswalkFromJson(json),
    names: new Map((json.buurten ?? []).map((c, i) => [c, json.names?.[i] ?? null]).filter(([, n]) => n)),
    wijkNames: new Map(Object.entries(json.wijkNames ?? {})),
    unmatched: { buurt: new Set(json.unmatched?.buurt ?? []), wijk: new Set(json.unmatched?.wijk ?? []) },
  };
}

/**
 * A postcode → the area to jump to: the buurt with most of its addresses, or
 * its wijk / gemeente when that buurt has no 2025 counterpart.
 * { pc4, code (2025 notation), level, name } or null for an unknown postcode.
 */
export function resolvePostcode(query, index) {
  const pc4 = normalizePc4(query);
  if (!pc4 || !index?.cw?.has(pc4)) return null;
  const bu = pc4ToArea(index.cw, pc4, 'buurt', { accept: c => !index.unmatched.buurt.has(c) });
  if (bu) return { pc4, code: `BU${bu}`, level: 'buurt', name: index.names.get(bu) ?? `BU${bu}` };
  const wk = pc4ToArea(index.cw, pc4, 'wijk', { accept: c => !index.unmatched.wijk.has(c) });
  if (wk) return { pc4, code: `WK${wk}`, level: 'wijk', name: index.wijkNames.get(wk) ?? `WK${wk}` };
  const gm = pc4ToArea(index.cw, pc4, 'gemeente');
  return gm ? { pc4, code: `GM${gm}`, level: 'gemeente', name: `GM${gm}` } : null;
}

/** Test hook. */
export function _setPc4Data(json) { data = json ? decodePc4Herkomst(json) : null; dataPromise = null; }
export function _resetPc4Crosswalk() { xw = null; xwPromise = null; }
