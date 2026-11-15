// Postcode (PC4) utility: normalising postcodes and mapping 4-digit postcode
// areas to CBS buurten, wijken and gemeenten through a crosswalk of address
// counts per (PC4, buurt). Built from CBS "pc6huisnr" 2023 by
// scripts/build-pc4-herkomst.mjs (data/nl/pc4-gwb-2023.json). Pure; no DOM.
//
// Codes: a buurt is 8 characters ('0363AF01'), its wijk the first 6
// ('0363AF'), its gemeente the first 4 ('0363'). Every helper accepts codes
// with or without the CBS prefix (BU/WK/GM); outputs keep the input's style.

export const PC4_CROSSWALK_FORMAT = 1;
export const PC4_YEAR = 2023;
export const LEVEL_PREFIX = Object.freeze({ buurt: 'BU', wijk: 'WK', gemeente: 'GM' });
const LEVEL_LEN = Object.freeze({ buurt: 8, wijk: 6, gemeente: 4 });

/**
 * '3011 AB', '3011ab', 'PC3011  ', 3011 → '3011'; null for anything that is not
 * a Dutch postcode (four digits, first not 0, optionally two letters).
 */
export function normalizePc4(input) {
  if (input == null) return null;
  const s = String(input).trim().toUpperCase().replace(/^PC\s*/, '');
  const m = /^([1-9]\d{3})\s*([A-Z]{2})?$/.exec(s);
  return m ? m[1] : null;
}

/** True when a search query looks like a postcode ('3011', '3011 AB', '3011a' while typing). */
export const isPostcodeQuery = q => /^\s*(?:pc\s*)?[1-9]\d{3}\s*[a-z]{0,2}\s*$/i.test(String(q ?? ''));

/** 'BU0363AF01' / '0363AF01' → '0363AF01' (upper case, no prefix). */
export const bareCode = code => String(code ?? '').trim().toUpperCase().replace(/^(BU|WK|GM)/, '');

/** Level of a code by its bare length: 8 buurt, 6 wijk, 4 gemeente; null otherwise. */
export function codeLevel(code) {
  const n = bareCode(code).length;
  return n === 8 ? 'buurt' : n === 6 ? 'wijk' : n === 4 ? 'gemeente' : null;
}

/** The wijk ('wijk') or gemeente ('gemeente') a code lies in; prefixed when the input was. */
export function parentAt(code, level) {
  const bare = bareCode(code);
  const len = LEVEL_LEN[level];
  if (!len || bare.length < len) return null;
  const prefixed = /^(BU|WK|GM)/i.test(String(code ?? '').trim());
  return (prefixed ? LEVEL_PREFIX[level] : '') + bare.slice(0, len);
}

/** Bare code → prefixed 2025-notation code of its level ('0363AF01' → 'BU0363AF01'). */
export function withPrefix(code) {
  const lvl = codeLevel(code);
  return lvl ? LEVEL_PREFIX[lvl] + bareCode(code) : null;
}

// ── Crosswalk ────────────────────────────────────────────────────────────────
// In memory: Map(pc4 → Map(bare buurt code → address count)).

/** An empty crosswalk. */
export const createCrosswalk = () => new Map();

/** Adds `n` addresses of `pc4` in `buurt`. Mutates and returns `cw`. Invalid input is ignored. */
export function addAddresses(cw, pc4, buurt, n = 1) {
  const pc = normalizePc4(pc4);
  const bu = bareCode(buurt);
  if (!pc || bu.length !== 8 || !(n > 0)) return cw;
  if (!cw.has(pc)) cw.set(pc, new Map());
  const m = cw.get(pc);
  m.set(bu, (m.get(bu) ?? 0) + n);
  return cw;
}

/** Crosswalk → compact JSON object { format, year, buurten: [bare codes], pc: { pc4: [idx, n, idx, n…] } }. */
export function crosswalkToJson(cw, extra = {}) {
  const codes = [...new Set([...cw.values()].flatMap(m => [...m.keys()]))].sort();
  const idx = new Map(codes.map((c, i) => [c, i]));
  const pc = {};
  for (const p of [...cw.keys()].sort()) {
    pc[p] = [...cw.get(p)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).flatMap(([c, n]) => [idx.get(c), n]);
  }
  return { format: PC4_CROSSWALK_FORMAT, year: PC4_YEAR, ...extra, buurten: codes, pc };
}

/** Compact JSON object → crosswalk Map. Throws on another format. */
export function crosswalkFromJson(data) {
  if (data?.format !== PC4_CROSSWALK_FORMAT || !Array.isArray(data.buurten)) throw new Error('postcode: unknown crosswalk format');
  const cw = createCrosswalk();
  for (const [p, arr] of Object.entries(data.pc ?? {})) {
    for (let i = 0; i + 1 < arr.length; i += 2) addAddresses(cw, p, data.buurten[arr[i]], arr[i + 1]);
  }
  return cw;
}

/**
 * The areas of `level` a postcode area covers: [{ code, n, weight }] sorted by
 * address count (weight = share of the PC4's addresses). Codes are bare unless
 * `prefixed`. [] for an unknown postcode.
 */
export function areasForPc4(cw, pc4, level = 'buurt', { prefixed = false } = {}) {
  const m = cw?.get(normalizePc4(pc4));
  if (!m || !LEVEL_LEN[level]) return [];
  const by = new Map();
  let total = 0;
  for (const [bu, n] of m) {
    const c = bu.slice(0, LEVEL_LEN[level]);
    by.set(c, (by.get(c) ?? 0) + n);
    total += n;
  }
  return [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c, n]) => ({ code: prefixed ? LEVEL_PREFIX[level] + c : c, n, weight: n / total }));
}

/**
 * The dominant area (most addresses) of `level` for a postcode, or null.
 * `accept(code)` (bare code) can rule areas out, e.g. ones without 2025 data.
 */
export function pc4ToArea(cw, pc4, level = 'buurt', { accept = null, prefixed = false } = {}) {
  const hit = areasForPc4(cw, pc4, level).find(a => !accept || accept(a.code));
  return hit ? (prefixed ? LEVEL_PREFIX[level] + hit.code : hit.code) : null;
}

/**
 * The postcodes of an area (buurt, wijk or gemeente code, any prefix style):
 * [{ pc4, n, weight }] sorted by address count; weight = share of the area's addresses.
 */
export function pc4sForArea(cw, code) {
  const bare = bareCode(code);
  if (!codeLevel(bare)) return [];
  const out = [];
  let total = 0;
  for (const [pc, m] of cw ?? []) {
    let n = 0;
    for (const [bu, k] of m) if (bu.startsWith(bare)) n += k;
    if (n > 0) { out.push({ pc4: pc, n }); total += n; }
  }
  return out.sort((a, b) => b.n - a.n || a.pc4.localeCompare(b.pc4)).map(o => ({ ...o, weight: o.n / total }));
}

const isObj = v => v != null && typeof v === 'object';
function addInto(target, key, v, f = 1) {
  if (isObj(v)) {
    const t = target[key] ??= {};
    for (const [g, x] of Object.entries(v)) if (Number.isFinite(x)) t[g] = (t[g] ?? 0) + x * f;
  } else if (Number.isFinite(v)) target[key] = (target[key] ?? 0) + v * f;
}

/**
 * Splits counts per postcode over its buurten by address share. `pc4Counts`:
 * { pc4: number } or { pc4: { group: number } }. Returns { byBuurt, unallocated }
 * (same shapes; bare buurt codes; unallocated = postcodes the crosswalk does
 * not know, summed). sum(byBuurt) + unallocated = sum(input) for every group.
 */
export function allocate(pc4Counts, cw) {
  const byBuurt = {}, rest = {};
  for (const [raw, v] of Object.entries(pc4Counts ?? {})) {
    const pc = normalizePc4(raw);
    const m = pc ? cw?.get(pc) : null;
    if (!m) { addInto(rest, 'x', v); continue; }
    let total = 0;
    for (const n of m.values()) total += n;
    for (const [bu, n] of m) addInto(byBuurt, bu, v, n / total);
  }
  return { byBuurt, unallocated: rest.x ?? (Object.values(pc4Counts ?? {}).some(isObj) ? {} : 0) };
}

/** Buurt counts → wijk or gemeente counts by code prefix (same value shapes; keys keep their prefix style). */
export function rollUp(buurtCounts, level) {
  if (level !== 'wijk' && level !== 'gemeente') throw new Error(`postcode: cannot roll up to ${level}`);
  const out = {};
  for (const [code, v] of Object.entries(buurtCounts ?? {})) {
    const p = parentAt(code, level);
    if (p) addInto(out, p, v);
  }
  return out;
}
