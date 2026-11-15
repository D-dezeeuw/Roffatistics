// Actuele meldingen hulpdiensten (P2000), live from the sister app Randstad (W30).
// One GET per window (30d / 7d) to Randstad's area summary, only when the
// "Actueel" layer is chosen; kept in memory for the session. Counts per
// buurt / wijk / gemeente become values on the loaded areas: a rate per 1.000
// inwoners (null under P2000_MIN_POPULATION) plus the raw count. Gemeenten
// that are not in the response's `gemeenten` map are outside the covered
// safety regions: their areas get null ("geen gegevens"), not zero.
// Not part of any score, the wizard, the Ranglijst or share-link extras.
// Pure apart from the fetch; no DOM.

export const P2000_ORIGIN = 'https://randstad.hermes.blockworlds.nl';
export const P2000_SOURCE_URL = `${P2000_ORIGIN}/`;
export const P2000_URL = window => `${P2000_ORIGIN}/api/areas/summary?window=${encodeURIComponent(window)}`;
export const P2000_WINDOWS = Object.freeze(['30d', '7d']);
export const P2000_DEFAULT_WINDOW = '30d';
export const P2000_TIMEOUT_MS = 8000;
/** Areas with fewer inwoners get the count only, no rate (same threshold as crime per buurt). */
export const P2000_MIN_POPULATION = 200;
export const P2000_COVERAGE = 'Rotterdam-Rijnmond en Zuid-Holland-Zuid';

/** Response group → dataset key (rate). The count sits in `${key}Count`. */
export const P2000_GROUPS = Object.freeze({
  totaal:   'p2000Totaal',
  verkeer:  'p2000Verkeer',
  brand:    'p2000Brand',
  explosie: 'p2000Explosie',
  geweld:   'p2000Geweld',
  spoed:    'p2000Spoed',
});
export const P2000_KEYS = Object.freeze(Object.values(P2000_GROUPS));
export const P2000_COVERED_KEY = 'p2000Covered';
export const isP2000Key = key => P2000_KEYS.includes(key);
export const countKeyOf = key => `${key}Count`;

/** Short names for counts in tooltips and the area modal. */
export const P2000_GROUP_LABELS = Object.freeze({
  totaal: 'meldingen', verkeer: 'verkeersongevallen', brand: 'branden', explosie: 'explosies', geweld: 'geweld en diefstal', spoed: 'spoedritten ambulance',
});

/** '30d' → 30; anything unreadable → null. */
export function windowDays(window) {
  const m = /^(\d{1,3})d$/.exec(String(window ?? ''));
  return m ? +m[1] : null;
}

const count = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const normCode = c => String(c ?? '').trim().toUpperCase();

function readLevel(obj, prefix, into) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const [code, row] of Object.entries(obj)) {
    const c = normCode(code);
    if (!c.startsWith(prefix) || !row || typeof row !== 'object') continue;
    into.set(c, Object.fromEntries(Object.keys(P2000_GROUPS).map(g => [g, count(row[g])])));
  }
}

/**
 * Validates and normalises the Randstad response. Throws on a shape it cannot
 * use. → { window, days, from, to, generatedAt, covered: Set<GM…>, counts: Map<code, {group: n}>, unlocated }
 */
export function parseP2000Summary(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('p2000: geen object');
  if (!json.gemeenten || typeof json.gemeenten !== 'object' || Array.isArray(json.gemeenten)) throw new Error('p2000: gemeenten ontbreekt');
  const counts = new Map();
  readLevel(json.gemeenten, 'GM', counts);
  readLevel(json.wijken, 'WK', counts);
  readLevel(json.buurten, 'BU', counts);
  const covered = new Set([...counts.keys()].filter(c => c.startsWith('GM')));
  const window = typeof json.window === 'string' ? json.window : null;
  return {
    window, days: windowDays(window),
    from: json.from ?? null, to: json.to ?? null, generatedAt: json.generatedAt ?? null,
    covered, counts,
    unlocated: typeof json.unlocated === 'number' ? json.unlocated : (json.unlocated && typeof json.unlocated === 'object' ? count(json.unlocated.totaal) : null),
  };
}

/** The gemeente code of a BU/WK/GM code ('BU05990110' → 'GM0599'), else null. */
export function gemeenteOfCode(code) {
  const c = normCode(code);
  if (/^GM\d{4}$/.test(c)) return c;
  const m = /^(?:BU|WK)(\d{4})/.exec(c);
  return m ? `GM${m[1]}` : null;
}

/** Count per 1.000 inwoners (2 decimals); null without a count or under the population threshold. */
export function p2000Rate(n, population, minPopulation = P2000_MIN_POPULATION) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (typeof population !== 'number' || !Number.isFinite(population) || population < minPopulation) return null;
  return Math.round(n / population * 100000) / 100;
}

/** True when `code` lies in a gemeente the summary covers. */
export const isCovered = (code, summary) => !!summary && summary.covered.has(gemeenteOfCode(code));

/**
 * The P2000 values of one area: every rate key, its `…Count` and
 * `p2000Covered`. Outside the covered gemeenten everything is null; inside,
 * a missing row means zero meldingen. {} without a summary.
 */
export function p2000ValuesFor(code, population, summary) {
  if (!summary) return {};
  const covered = isCovered(code, summary);
  const row = covered ? summary.counts.get(normCode(code)) ?? null : null;
  const out = { [P2000_COVERED_KEY]: covered };
  for (const [g, key] of Object.entries(P2000_GROUPS)) {
    const n = covered ? row?.[g] ?? 0 : null;
    out[countKeyOf(key)] = n;
    out[key] = covered ? p2000Rate(n, population) : null;
  }
  return out;
}

// ── Session cache and fetch ──────────────────────────────────────────────────

const summaries = new Map();   // window → parsed summary
const pending = new Map();     // window → promise
let currentWindow = P2000_DEFAULT_WINDOW;

export const getP2000Window = () => currentWindow;
/** Sets the shown window ('30d' | '7d'); anything else is ignored. Returns the window in use. */
export function setP2000Window(w) {
  if (P2000_WINDOWS.includes(w)) currentWindow = w;
  return currentWindow;
}
/** The summary of the current window, or null (not loaded). */
export const activeP2000 = () => summaries.get(currentWindow) ?? null;
export const isP2000Loaded = (w = currentWindow) => summaries.has(w);

/**
 * Loads (once per window) the summary. Rejects on HTTP errors, a bad shape or
 * after `timeoutMs`; a failure is forgotten so the next call retries.
 */
export function loadP2000(w = currentWindow, { fetcher = globalThis.fetch?.bind(globalThis), timeoutMs = P2000_TIMEOUT_MS } = {}) {
  if (!P2000_WINDOWS.includes(w)) return Promise.reject(new Error(`p2000: onbekend venster ${w}`));
  if (summaries.has(w)) return Promise.resolve(summaries.get(w));
  if (pending.has(w)) return pending.get(w);
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { ctrl?.abort(); reject(new Error('p2000: time-out')); }, timeoutMs);
  });
  const run = Promise.resolve()
    .then(() => fetcher(P2000_URL(w), { signal: ctrl?.signal, credentials: 'omit' }))
    .then(r => { if (!r?.ok) throw new Error(`p2000: HTTP ${r?.status}`); return r.json(); })
    .then(parseP2000Summary);
  const p = Promise.race([run, timeout])
    .then(s => { summaries.set(w, s); return s; })
    .finally(() => { clearTimeout(timer); pending.delete(w); });
  run.catch(() => { /* raced; reported through p */ });
  pending.set(w, p);
  return p;
}

/** Adds the current window's values to areas ({ code, values }) in place; no-op until loaded. */
export function addP2000Values(areas, summary = activeP2000()) {
  if (!summary) return areas;
  for (const a of areas ?? []) {
    if (!a?.code) continue;
    a.values = Object.assign(a.values ?? {}, p2000ValuesFor(a.code, a.values?.population, summary));
  }
  return areas;
}

/** Flat gemeente rows (regionCode, population) → new rows with the values; the same rows until loaded. */
export function withP2000Rows(rows, summary = activeP2000()) {
  if (!summary || !Array.isArray(rows)) return rows;
  return rows.map(r => (r?.regionCode ? { ...r, ...p2000ValuesFor(r.regionCode, r.population, summary) } : r));
}

// ── Texts ────────────────────────────────────────────────────────────────────

const nf = n => Number(n).toLocaleString('nl-NL');
const periodText = summary => (summary?.days ? `${summary.days} dagen` : 'de gekozen periode');

/** Tooltip line for `key` from area values: the count, or why there is no figure. Null for other layers. */
export function p2000Note(values, key, summary = activeP2000()) {
  if (!isP2000Key(key) || !summary) return null;
  if (values?.[P2000_COVERED_KEY] !== true) return `geen gegevens: alleen ${P2000_COVERAGE}`;
  const g = Object.keys(P2000_GROUPS).find(k => P2000_GROUPS[k] === key);
  const n = values[countKeyOf(key)] ?? 0;
  const base = `${nf(n)} ${n === 1 && g === 'totaal' ? 'melding' : P2000_GROUP_LABELS[g]} in ${periodText(summary)}`;
  return values[key] == null ? `${base} · te weinig inwoners voor een cijfer per 1.000` : base;
}

/** Area modal block data: null when not loaded; { covered:false } outside; else the counts and rates. */
export function p2000Detail(values, summary = activeP2000()) {
  if (!summary || !values || values[P2000_COVERED_KEY] == null) return null;
  if (!values[P2000_COVERED_KEY]) return { covered: false, days: summary.days };
  return {
    covered: true, days: summary.days,
    rows: Object.entries(P2000_GROUPS).map(([g, key]) => ({ group: g, key, label: P2000_GROUP_LABELS[g], count: values[countKeyOf(key)] ?? 0, rate: values[key] ?? null })),
  };
}

/** Test hook. */
export function _resetP2000() { summaries.clear(); pending.clear(); currentWindow = P2000_DEFAULT_WINDOW; }

/** Error notice shown in the legend when the fetch fails or times out. */
export const P2000_ERROR_TEXT = 'Actuele meldingen zijn nu niet te laden. Probeer het later opnieuw; de rest van de kaart werkt gewoon.';
export const P2000_LOADING_TEXT = 'Actuele meldingen laden…';

/** Legend block: 30/7-dagen toggle, the P2000 note with the source link, and a status line. */
export function p2000LegendHtml(window = currentWindow, status = '') {
  const opt = w => `<button type="button" class="seg-opt${w === window ? ' active' : ''}" data-p2000-window="${w}" aria-pressed="${w === window}">${windowDays(w)} dagen</button>`;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<div class="seg p2000-window" role="group" aria-label="Periode van de meldingen">${P2000_WINDOWS.map(opt).join('')}</div>`
    + `<p class="legend-live-note">Meldingen hulpdiensten (P2000), ${P2000_COVERAGE}, vanaf okt. 2026. P2000 toont maar een deel van het politiewerk (het meeste politieverkeer is versleuteld); locaties zijn bij benadering. Grijs = geen gegevens. Bron: <a href="${P2000_SOURCE_URL}" target="_blank" rel="noopener">Randstad</a>.</p>`
    + `<p class="legend-live-status" role="status">${esc(status)}</p>`;
}
