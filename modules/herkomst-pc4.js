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
import { REGIONS, COUNTRY_REGION, CONTINENTS, countryName, regionByKey } from './herkomst-regio.js';

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
  afrika: 'H008519', amerika: 'H008520', azie: 'H008524',
});

const colorOf = k => ORIGIN_GROUPS.find(g => g.key === k)?.color;
const pg = (key, label, plus, minus = [], color = colorOf(key), about = '') => Object.freeze({ key, label, plus: Object.freeze(plus), minus: Object.freeze(minus), color, metric: `hk_${key}`, about });

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
  pg('euNietEu',  'Europa buiten de EU',      [MA.europa], [MA.eu, MA.turkije], undefined, 'Europa zonder Nederland, de EU en Turkije: onder meer Verenigd Koninkrijk, Oekraïne, Rusland, voormalig Joegoslavië buiten de EU'),
  pg('oceanie',   'Oceanië',                  [MA.oceanie]),
]);
export const PC4_GROUP_KEYS = Object.freeze(PC4_GROUPS.map(g => g.key));

/**
 * Werelddeel rests, stored as columns but not layers of their own (v0.28.0):
 * they feed the "Overig <werelddeel>" regions per wijk/buurt (PC4_REGION_SOURCES).
 */
export const PC4_REST_GROUPS = Object.freeze([
  // The rest of each werelddeel next to its named countries. Turkije is not
  // in Azië in this table (it sits under Europa), so Azië − Indonesië matches the
  // 85458NED group "Azië (exclusief Indonesië en Turkije)". Not split further: the
  // postcode table has no countries to build subregions from.
  pg('afrikaRest',  'Afrika excl. Marokko',              [MA.afrika], [MA.marokko], '#facc15', 'heel Afrika zonder Marokko: onder meer Egypte, Somalië, Eritrea, Ethiopië, Kaapverdië, Ghana, Nigeria, Zuid-Afrika. Niet verder te splitsen per wijk of buurt'),
  pg('amerikaRest', 'Amerika excl. Suriname en Cariben', [MA.amerika], [MA.suriname, MA.cariben], '#15803d', 'heel Amerika zonder Suriname en de Nederlandse Cariben: onder meer Verenigde Staten, Canada, Brazilië, Colombia, Venezuela, Dominicaanse Republiek. Niet verder te splitsen per wijk of buurt'),
  pg('europaRest',  'Europa excl. Turkije, Polen, Duitsland en België', [MA.europa], [MA.turkije, MA.polen, MA.duitsland, MA.belgie], '#ede9fe', 'heel Europa (zonder Nederland) min Turkije, Polen, Duitsland en België'),
  pg('azieRest',    'Azië excl. Indonesië en Turkije',   [MA.azie], [MA.indonesie], '#0ea5e9', 'heel Azië zonder Indonesië en Turkije: onder meer Syrië, Irak, Iran, Afghanistan, India, Pakistan, China, Vietnam, Filipijnen. Niet verder te splitsen per wijk of buurt'),
]);
/** Every stored count column: the layer groups plus the rests. */
export const PC4_COLUMNS = Object.freeze([...PC4_GROUPS, ...PC4_REST_GROUPS]);
export const PC4_COLUMN_KEYS = Object.freeze(PC4_COLUMNS.map(g => g.key));

/**
 * Region (herkomst-regio.js) → the postcode columns it sums per wijk/buurt, through
 * the SAME country → region table as per gemeente: a named country lands in its
 * region (Marokko → Noord-Afrika, Turkije → West-Azië, …); "Overig <werelddeel>" =
 * the werelddeel minus the countries this table names; Oceanië whole. A region
 * none of the eight named countries belongs to (Noord-Europa, Oost-Afrika, …)
 * has no postcode source: no value per wijk/buurt, never a gemeente mix.
 */
const REST_OF = Object.freeze({ europa: 'europaRest', afrika: 'afrikaRest', amerika: 'amerikaRest', azie: 'azieRest' });
export const PC4_REGION_SOURCES = Object.freeze(Object.fromEntries(REGIONS.map(r => {
  if (r.whole) return [r.key, Object.freeze(['oceanie'])];
  if (r.rest) return [r.key, Object.freeze([REST_OF[r.continent]])];
  return [r.key, Object.freeze(PC4_GROUPS.filter(g => g.plus.length === 1 && !g.minus.length && COUNTRY_REGION[g.plus[0]] === r.key).map(g => g.key))];
}).filter(([, src]) => src.length)));
/** Region metrics (`hr_<region>`) that also exist per wijk/buurt (estimated via postcode). */
export const PC4_REGION_METRICS = Object.freeze(Object.keys(PC4_REGION_SOURCES).map(k => `hr_${k}`));
export const regionAtBuurt = k => Object.hasOwn(PC4_REGION_SOURCES, k);

/** Plain-Dutch membership of a region per wijk/buurt (postcode table); '' when the region has no source there. */
export function pc4RegionComposition(key) {
  const r = regionByKey(key), src = PC4_REGION_SOURCES[key];
  if (!r || !src) return '';
  if (r.whole) return `heel ${CONTINENTS[r.continent].label}`;
  if (r.rest) return PC4_REST_GROUPS.find(g => g.key === src[0]).label.replace(/ excl\. /, ' min ');
  return src.map(k => (k === 'cariben' ? 'Nederlandse Cariben' : countryName(PC4_GROUPS.find(g => g.key === k).plus[0]))).join(', ');
}
/** Metric keys (`hk_<group>`) this data fills at wijk and buurt level. */
export const PC4_KEYS = Object.freeze(PC4_GROUPS.map(g => g.metric));
export const isPc4Key = k => PC4_KEYS.includes(k) || PC4_REGION_METRICS.includes(k);

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
    for (const g of PC4_COLUMNS) {
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
  const cols = Object.fromEntries(PC4_COLUMN_KEYS.map(k => [k, codes.map(c => Math.round(counts[c][k] ?? 0))]));
  return { codes, total: codes.map(c => Math.round(counts[c].total ?? 0)), cols };
}

/** The file object → Map(code → { total, counts: { group: n } }) over every level. Throws on another format. */
export function decodePc4Herkomst(data) {
  if (data?.format !== PC4_HERKOMST_FORMAT || !data.levels) throw new Error('herkomst-pc4: unknown data format');
  const out = new Map();
  for (const lvl of Object.values(data.levels)) {
    lvl.codes.forEach((code, i) => {
      const counts = {};
      for (const k of PC4_COLUMN_KEYS) if (lvl.cols[k]) counts[k] = lvl.cols[k][i];
      out.set(code, { total: lvl.total[i], counts });
    });
  }
  return out;
}

/** An entry → { <region>: count } for the regions with a postcode source; a region with a missing column is left out. */
export function pc4RegionCounts(entry) {
  const out = {};
  if (!entry) return out;
  for (const [k, src] of Object.entries(PC4_REGION_SOURCES)) {
    if (src.some(c => entry.counts[c] == null)) continue;
    out[k] = src.reduce((s, c) => s + entry.counts[c], 0);
  }
  return out;
}

/**
 * An entry → { hk_<group>: %, hr_<region>: % } of inhabitants (1 decimal); every key
 * null below PC4_MIN_POPULATION. Regions without a postcode source get no key at all.
 */
export function sharesOf(entry) {
  const ok = entry && entry.total >= PC4_MIN_POPULATION;
  const share = v => (v == null ? null : Math.min(100, Math.round(v / entry.total * 1000) / 10));
  const rc = ok ? pc4RegionCounts(entry) : {};
  return Object.fromEntries([
    ...PC4_GROUPS.map(g => [g.metric, ok ? share(entry.counts[g.key]) : null]),
    ...PC4_REGION_METRICS.map(m => [m, ok ? share(rc[m.slice(3)]) : null]),
  ]);
}

// ── Validation against 85458NED per gemeente (build time) ──────────────────

/** 85458NED keys (herkomstland, per gemeente) of the same groups; Turkije sits under Azië there. */
export const GM_EQUIV = Object.freeze({
  total: { plus: ['T001040'], minus: [] },
  suriname: { plus: ['H008751'], minus: [] }, turkije: { plus: ['H008766'], minus: [] }, marokko: { plus: ['H008673'], minus: [] },
  cariben: { plus: ['H007119'], minus: [] }, indonesie: { plus: ['H008632'], minus: [] }, polen: { plus: ['H008718'], minus: [] },
  duitsland: { plus: ['H008592'], minus: [] }, belgie: { plus: ['H008552'], minus: [] },
  euNietEu: { plus: ['H007933'], minus: ['H007935'] }, oceanie: { plus: ['H008531'], minus: [] },
  europaRest: { plus: ['H007933'], minus: ['H008718', 'H008592', 'H008552'] },
  afrikaRest: { plus: ['H008860'], minus: [] }, amerikaRest: { plus: ['H008520'], minus: ['H008751', 'H007119'] },
  azieRest: { plus: ['H008862'], minus: [] },
});
export const GM_EQUIV_KEYS = Object.freeze([...new Set(Object.values(GM_EQUIV).flatMap(g => [...g.plus, ...g.minus]))]);

const corr = (a, b) => {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let c = 0, da = 0, db = 0;
  a.forEach((x, i) => { c += (x - ma) * (b[i] - mb); da += (x - ma) ** 2; db += (b[i] - mb) ** 2; });
  return da && db ? c / Math.sqrt(da * db) : null;
};

/**
 * The postcode estimate summed per gemeente vs the official 85458NED counts of
 * the same year: per group { est, cbs, ratio (est / cbs, 3 decimals), corr
 * (Pearson over gemeenten, 4 decimals) }. `gemeenteLevel` is the encoded
 * gemeente level; `official` is { GM code: { herkomstland key: count } }.
 */
export function validatePc4(gemeenteLevel, official, table = '85458NED', year = PC4_YEAR) {
  const codes = gemeenteLevel.codes.filter(c => official[c]?.T001040 > 0);
  const offOf = (c, g) => GM_EQUIV[g].plus.reduce((s, k) => s + (official[c][k] ?? 0), 0) - GM_EQUIV[g].minus.reduce((s, k) => s + (official[c][k] ?? 0), 0);
  const groups = {};
  for (const g of ['total', ...PC4_COLUMN_KEYS]) {
    if (!GM_EQUIV[g]) continue;
    const col = g === 'total' ? gemeenteLevel.total : gemeenteLevel.cols[g];
    if (!col) continue;
    const idx = new Map(gemeenteLevel.codes.map((c, i) => [c, i]));
    const a = codes.map(c => col[idx.get(c)] ?? 0), b = codes.map(c => offOf(c, g));
    const est = a.reduce((x, y) => x + y, 0), cbs = b.reduce((x, y) => x + y, 0);
    const r = corr(a, b);
    groups[g] = { est, cbs, ratio: cbs ? Math.round(est / cbs * 1000) / 1000 : null, corr: r == null ? null : Math.round(r * 10000) / 10000 };
  }
  return { table, year, gemeenten: codes.length, groups };
}

/**
 * The validation as quoted in the Uitleg (explain.js); tests/herkomst-pc4.test.js
 * checks it against `sources.validation` of the built file, so a rebuild that
 * moves a ratio fails until this is updated.
 */
export const PC4_VALIDATION = Object.freeze({
  gemeenten: 342, minCorr: 0.9972,
  ratios: Object.freeze({ total: 1, suriname: 0.995, turkije: 0.998, marokko: 0.999, polen: 0.997, cariben: 0.957, indonesie: 0.961, duitsland: 0.96, belgie: 0.9, euNietEu: 1.07, oceanie: 0.781, europaRest: 1.016, afrikaRest: 0.969, amerikaRest: 0.911, azieRest: 0.926 }),
});

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

/** Region rows per wijk/buurt for the modal: [{ key, label, color, pct, count, rest }] by share, 0 left out; null without data. */
export function pc4RegionRows(code, entry = getPc4Entry(code)) {
  if (!entry || !(entry.total >= PC4_MIN_POPULATION)) return null;
  const rc = pc4RegionCounts(entry);
  return REGIONS.filter(r => rc[r.key] > 0).map(r => ({ key: r.key, label: r.label, color: r.color, count: rc[r.key], rest: !!r.rest, pct: Math.min(100, Math.round(rc[r.key] / entry.total * 1000) / 10) }))
    .sort((a, b) => b.pct - a.pct);
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

/** HTML of the "herkomst per regio (geschat)" block ('' without data). */
export function pc4RegionHtml(code, entry) {
  const rows = pc4RegionRows(code, entry);
  if (!rows?.length) return '';
  const max = Math.max(...rows.map(r => r.pct), 1);
  return `<ul class="pc4-origin">${rows.map(r => `<li><span class="pc4-origin-label">${esc(r.label)}</span><span class="pc4-origin-bar"><i style="width:${(r.pct / max * 100).toFixed(1)}%;background:${r.color}"></i></span><span class="pc4-origin-val">${fmt(r.pct)}</span></li>`).join('')}</ul>
<p class="pc4-origin-note">${esc(PC4_LABEL)}. Per wijk en buurt telt een regio alleen de acht landen uit de postcodecijfers (bijvoorbeeld Noord-Afrika = Marokko); de rest van een werelddeel staat onder "Overig". Regio's zonder zo'n land (zoals Oost-Afrika) staan hier niet. Zie Uitleg.</p>`;
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
