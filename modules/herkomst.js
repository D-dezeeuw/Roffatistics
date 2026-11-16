// Herkomst (origin) helpers. Wijk/buurt level: the NL / Europa / buiten-Europa
// split from the kerncijfers (86165NED). Pure; no DOM.
import { odataUrl, getRows } from './source.js';

const fmtPct = v => `${v.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const escAttr = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The three CBS herkomst parts of an area, in stacking order. */
export const ORIGIN_PARTS = Object.freeze([
  Object.freeze({ key: 'originDutchPct',  label: 'Nederland',         short: 'NL',            color: '#8b5cf6' }),
  Object.freeze({ key: 'originEuropePct', label: 'Europa (excl. NL)', short: 'Europa',        color: '#c084fc' }),
  Object.freeze({ key: 'nonWesternPct',   label: 'Buiten Europa',     short: 'buiten Europa', color: '#f97316' }),
]);

/**
 * [{ key, label, short, color, value, pct }] for an area's values: `value` is the
 * CBS share of inhabitants, `pct` the share of the three parts' sum (so a stacked
 * bar is exactly 100 % although CBS rounds the counts to fives). Null when any
 * part is missing or all are zero.
 */
export function originSplit(values) {
  const vals = ORIGIN_PARTS.map(p => values?.[p.key]);
  if (vals.some(v => v == null || !Number.isFinite(v))) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  return ORIGIN_PARTS.map((p, i) => ({ ...p, value: vals[i], pct: vals[i] / sum * 100 }));
}

/** HTML of the panel's mini stacked bar plus a one-line legend; '' without data. */
export function originBarHtml(values) {
  const parts = originSplit(values);
  if (!parts) return '';
  const label = parts.map(p => `${p.label} ${fmtPct(p.value)}`).join(', ');
  return `<div class="origin-bar" role="img" aria-label="Herkomst: ${escAttr(label)}">${parts.map(p =>
    `<span class="origin-seg" style="width:${p.pct.toFixed(2)}%;background:${p.color}" title="${escAttr(`${p.label}: ${fmtPct(p.value)}`)}"></span>`).join('')}</div>
<p class="origin-legend">${parts.map(p => `<span><i style="background:${p.color}"></i>${escAttr(p.short)} ${fmtPct(p.value)}</span>`).join('')}</p>`;
}

// ── Heel Rotterdam: landengroepen uit CBS 85458NED ────────────────────────────
// "Bevolking; herkomstland, geboorteland, leeftijd, regio, 1 januari" (2022–2026).
// Keys checked against /85458NED/Herkomstland on 15 Nov 2026 (65 keys incl. totals).
// Country groups exist only for the whole gemeente, not per wijk.

export const HERKOMST_TABLE = '85458NED';
export const HERKOMST_FIRST_YEAR = 2022;
export const HERKOMST_YEAR = 2026;
export const HERKOMST_TOTALS = Object.freeze({ Geslacht: 'T001038', Leeftijd: '10000', Geboorteland: 'T001638' });
export const BORN_ABROAD = 'A051736';     // Geboorteland "Persoon geboren buiten Nederland"

/** CBS Herkomstland keys used below: totals, parts and continents. */
export const HK = Object.freeze({
  total: 'T001040', nederland: '1012600', abroad: '2012605',
  europe: 'H007933', outsideEurope: 'H008859',
  eu: 'H007935', gips: 'H007936', moe: 'H007937',
  africa: 'H008519', america: 'H008520', asia: 'H008524', oceania: 'H008531',
  morocco: 'H008673', egypt: 'H008594', turkey: 'H008766', suriname: 'H008751', caribbean: 'H007119',
  indonesia: 'H008632', usa: 'H008778', canada: 'H008571',
  syria: 'H008753', iraq: 'H008633', iran: 'H008634', afghanistan: 'H008533',
  india: 'H008631', pakistan: 'H008710',
  china: 'H008575', vietnam: 'H008780', philippines: 'H008603', thailand: 'H008757',
});

/**
 * Single countries CBS publishes separately (key → name). Aggregates are left
 * out: Nederlandse Cariben, (voormalig) Joegoslavië, Sovjet-Unie and
 * Tsjecho-Slowakije overlap their successor states in this table.
 */
export const COUNTRIES = Object.freeze({
  H008533: 'Afghanistan', H008544: 'Aruba', H008545: 'Australië', H008552: 'België', H008559: 'Bosnië-Herzegovina',
  H008562: 'Brazilië', H008567: 'Bulgarije', H008571: 'Canada', H008575: 'China', H008579: 'Colombia',
  H008586: 'Curaçao', H008592: 'Duitsland', H008594: 'Egypte', H008597: 'Eritrea', H008599: 'Ethiopië',
  H008603: 'Filipijnen', H008605: 'Frankrijk', H008612: 'Ghana', H008615: 'Griekenland', H008627: 'Hongarije',
  H008631: 'India', H008632: 'Indonesië', H008633: 'Irak', H008634: 'Iran', H008636: 'Italië',
  H008644: 'Kaapverdië', H008673: 'Marokko', H008699: 'Nigeria', H008706: 'Oekraïne', H008710: 'Pakistan',
  H008718: 'Polen', H008719: 'Portugal', H008723: 'Roemenië', H008724: 'Rusland', H008736: 'Servië',
  H008747: 'Somalië', H008749: 'Spanje', H008751: 'Suriname', H008753: 'Syrië', H008757: 'Thailand',
  H008766: 'Turkije', H008776: 'Verenigd Koninkrijk', H008778: 'Verenigde Staten', H008780: 'Vietnam', H008787: 'Zuid-Afrika',
});

/** Werelddelen for the summary strip; each origin group below names one. */
export const ORIGIN_REGIONS = Object.freeze([
  Object.freeze({ key: 'nederland',   label: 'Nederland' }),
  Object.freeze({ key: 'europa',      label: 'Europa (excl. NL)' }),
  Object.freeze({ key: 'noordAfrika', label: 'Noord-Afrika' }),
  Object.freeze({ key: 'subSahara',   label: 'Afrika bezuiden de Sahara' }),
  Object.freeze({ key: 'amerika',     label: 'Amerika' }),
  Object.freeze({ key: 'azie',        label: 'Azië (incl. Turkije)' }),
  Object.freeze({ key: 'oceanie',     label: 'Oceanië' }),
]);

const grp = (key, label, region, color, plus, minus, composition) =>
  Object.freeze({ key, label, region, color, plus: Object.freeze(plus), minus: Object.freeze(minus), composition });

/**
 * The origin groups: a partition of the total (tests/herkomst.test.js checks
 * that they add up to Totaal in every year). Each group is the sum of its
 * `plus` keys minus its `minus` keys; "parent minus children" groups take
 * the rest of a continent. Turkije counts as Azië, as at CBS.
 */
export const ORIGIN_GROUPS = Object.freeze([
  grp('nl',          'Nederland',                    'nederland',   '#8b5cf6', [HK.nederland], [], 'herkomst Nederland'),
  grp('euZuid',      'Zuid-Europa (EU)',             'europa',      '#c4b5fd', [HK.gips], [], 'de CBS-groep "GIPS-landen": Griekenland, Italië, Portugal, Spanje'),
  grp('euMoe',       'Midden- en Oost-Europa (EU)',  'europa',      '#a78bfa', [HK.moe], [], 'de CBS-groep MOE-landen in de EU: Polen, Bulgarije, Roemenië, Hongarije, de Baltische staten, Tsjechië, Slowakije, Slovenië, Kroatië'),
  grp('euOverig',    'Overige EU',                   'europa',      '#ddd6fe', [HK.eu], [HK.gips, HK.moe], 'EU (excl. NL) min Zuid-Europa en MOE: onder meer Duitsland, België, Frankrijk, Oostenrijk, Scandinavië, Ierland'),
  grp('euNietEu',    'Europa buiten de EU',          'europa',      '#7c3aed', [HK.europe], [HK.eu], 'Europa (excl. NL) min EU: onder meer Verenigd Koninkrijk, Oekraïne, Rusland, Bosnië-Herzegovina, Servië, Noorwegen, Zwitserland'),
  grp('turkije',     'Turkije',                      'azie',        '#f43f5e', [HK.turkey], [], 'Turkije (bij CBS onder Azië)'),
  grp('marokko',     'Marokko',                      'noordAfrika', '#f97316', [HK.morocco], [], 'Marokko, inclusief Westelijke Sahara'),
  grp('egypte',      'Egypte',                       'noordAfrika', '#fdba74', [HK.egypt], [], 'Egypte, het enige andere Noord-Afrikaanse land dat CBS apart levert'),
  grp('subSahara',   'Afrika bezuiden de Sahara',    'subSahara',   '#facc15', [HK.africa], [HK.morocco, HK.egypt], 'Afrika min Marokko en Egypte: onder meer Kaapverdië, Somalië, Ethiopië, Eritrea, Nigeria, Ghana, Zuid-Afrika; ook Algerije, Tunesië, Libië en Soedan, die CBS niet apart levert'),
  grp('suriname',    'Suriname',                     'amerika',     '#22c55e', [HK.suriname], [], 'Suriname'),
  grp('cariben',     'Nederlandse Cariben',          'amerika',     '#4ade80', [HK.caribbean], [], 'Curaçao, Aruba, Bonaire, Sint-Maarten, Sint-Eustatius en Saba'),
  grp('noordAmerika', 'Noord-Amerika',               'amerika',     '#86efac', [HK.usa, HK.canada], [], 'Verenigde Staten en Canada'),
  grp('latAmerika',  'Zuid- en Midden-Amerika',      'amerika',     '#15803d', [HK.america], [HK.suriname, HK.caribbean, HK.usa, HK.canada], 'Amerika min Suriname, Nederlandse Cariben, VS en Canada: onder meer Brazilië, Colombia, Venezuela, Dominicaanse Republiek, Mexico'),
  grp('indonesie',   'Indonesië',                    'azie',        '#38bdf8', [HK.indonesia], [], 'Indonesië (incl. voormalig Nederlands-Indië)'),
  grp('middenOosten', 'Midden-Oosten en Afghanistan', 'azie',       '#0ea5e9', [HK.syria, HK.iraq, HK.iran, HK.afghanistan], [], 'Syrië, Irak, Iran en Afghanistan'),
  grp('zuidAzie',    'India en Pakistan',            'azie',        '#7dd3fc', [HK.india, HK.pakistan], [], 'India en Pakistan'),
  grp('oostAzie',    'Oost- en Zuidoost-Azië',       'azie',        '#0369a1', [HK.china, HK.vietnam, HK.philippines, HK.thailand], [], 'China, Vietnam, Filipijnen en Thailand'),
  grp('azieOverig',  'Overig Azië',                  'azie',        '#bae6fd', [HK.asia], [HK.turkey, HK.indonesia, HK.syria, HK.iraq, HK.iran, HK.afghanistan, HK.india, HK.pakistan, HK.china, HK.vietnam, HK.philippines, HK.thailand], 'Azië min de groepen hierboven: onder meer Hongkong, Japan, Bangladesh, Sri Lanka, Israël, Libanon, Saoedi-Arabië, de Kaukasus en Centraal-Azië'),
  grp('oceanie',     'Oceanië',                      'oceanie',     '#f472b6', [HK.oceania], [], 'Australië, Nieuw-Zeeland en de eilanden in de Stille Oceaan'),
]);

const trimKey = k => String(k ?? '').trim();
const yearOf = p => { const m = /^(\d{4})/.exec(trimKey(p)); return m ? +m[1] : null; };
const num = v => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);

/**
 * CBS rows → { byYear: Map(year → { [herkomstKey]: count }), bornAbroad: Map(year → count) }.
 * Rows with Geboorteland = total feed byYear; Totaal × geboren buiten NL feeds bornAbroad.
 */
export function parseHerkomstRows(rows) {
  const byYear = new Map(), bornAbroad = new Map();
  for (const r of rows ?? []) {
    const y = yearOf(r.Perioden), v = num(r.Bevolking_1), k = trimKey(r.Herkomstland), g = trimKey(r.Geboorteland ?? HERKOMST_TOTALS.Geboorteland);
    if (y == null) continue;
    if (g === BORN_ABROAD) { if (k === HK.total && v != null) bornAbroad.set(y, v); continue; }
    if (g !== HERKOMST_TOTALS.Geboorteland) continue;
    if (!byYear.has(y)) byYear.set(y, {});
    byYear.get(y)[k] = v;
  }
  return { byYear, bornAbroad };
}

/** Count of one group in one year's counts; null when any of its keys is missing. A missing CBS cell for a known-empty key (null) counts as 0 only when CBS sends 0. */
export function groupValue(group, counts) {
  let sum = 0;
  for (const k of group.plus)  { const v = counts?.[k]; if (v == null) return null; sum += v; }
  for (const k of group.minus) { const v = counts?.[k]; if (v == null) return null; sum -= v; }
  return sum;
}

/** Groups with `value` (and `pct` of the total) for one year's counts. */
export function computeGroups(counts, groups = ORIGIN_GROUPS) {
  const total = counts?.[HK.total] ?? null;
  return groups.map(g => {
    const value = groupValue(g, counts);
    return { ...g, value, pct: value != null && total ? value / total * 100 : null };
  });
}

/** Sum of the group values minus the CBS total (0 = exact partition); null when anything is missing. */
export function partitionGap(counts, groups = ORIGIN_GROUPS) {
  const vals = computeGroups(counts, groups).map(g => g.value);
  if (vals.some(v => v == null) || counts?.[HK.total] == null) return null;
  return vals.reduce((a, b) => a + b, 0) - counts[HK.total];
}

/** The `n` largest single countries in one year's counts (Nederland excluded): [{ key, label, value, pct }]. */
export function topCountries(counts, n = 15) {
  const total = counts?.[HK.total] ?? null;
  return Object.entries(COUNTRIES)
    .map(([key, label]) => ({ key, label, value: counts?.[key] ?? null }))
    .filter(c => c.value != null && c.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'nl'))
    .slice(0, n)
    .map(c => ({ ...c, pct: total ? c.value / total * 100 : null }));
}

/** Change from `a` to `b` in % (1 decimal); null when unknown or a = 0. */
export function changePct(a, b) {
  return a == null || b == null || a === 0 ? null : Math.round((b - a) / a * 1000) / 10;
}

/**
 * Everything the dashboard section shows, from parseHerkomstRows() output:
 * { year, firstYear, years, total, totalFirst, bornAbroad, bornAbroadPct,
 *   groups: [{ …group, value, pct, series: [count per year], change, changeAbs }],
 *   regions: [{ key, label, value, pct }], countries: top 15, gap }.
 * Null when the latest year is missing.
 */
export function herkomstSummary({ byYear, bornAbroad } = {}, { year = HERKOMST_YEAR, firstYear = HERKOMST_FIRST_YEAR } = {}) {
  const latest = byYear?.get(year);
  if (!latest || latest[HK.total] == null) return null;
  const years = [...byYear.keys()].filter(y => y >= firstYear && y <= year).sort((a, b) => a - b);
  const total = latest[HK.total];
  const groups = computeGroups(latest).map(g => {
    const series = years.map(y => groupValue(g, byYear.get(y)));
    const first = series[0] ?? null;
    return { ...g, series, change: changePct(first, g.value), changeAbs: first != null && g.value != null ? g.value - first : null };
  });
  const regions = ORIGIN_REGIONS.map(r => {
    const parts = groups.filter(g => g.region === r.key);
    const value = parts.some(g => g.value == null) ? null : parts.reduce((a, g) => a + g.value, 0);
    return { ...r, value, pct: value != null ? value / total * 100 : null };
  });
  const ba = bornAbroad?.get(year) ?? null;
  return {
    year, firstYear: years[0] ?? firstYear, years, total,
    totalFirst: byYear.get(years[0])?.[HK.total] ?? null,
    bornAbroad: ba, bornAbroadPct: ba != null ? ba / total * 100 : null,
    groups, regions, countries: topCountries(latest, 15), gap: partitionGap(latest),
  };
}

const baseFilter = `RegioS eq 'GM0599' and Geslacht eq '${HERKOMST_TOTALS.Geslacht}' and Leeftijd eq '${HERKOMST_TOTALS.Leeftijd}'`;
const SELECT = 'Herkomstland,Geboorteland,Perioden,Bevolking_1';

/**
 * The two queries: every Herkomstland with Geboorteland = totaal (65 keys × 5
 * years), and Totaal × geboren buiten Nederland. One query with a nested
 * "or" makes CBS answer 500, hence two.
 */
export function buildHerkomstUrls() {
  const url = filter => odataUrl(HERKOMST_TABLE, { filter, select: SELECT });
  return [
    url(`${baseFilter} and Geboorteland eq '${HERKOMST_TOTALS.Geboorteland}'`),
    url(`${baseFilter} and Herkomstland eq '${HK.total}' and Geboorteland eq '${BORN_ABROAD}'`),
  ];
}

/** Snapshot keys of buildHerkomstUrls(), same order (data/snapshot/<key>.json). */
export const HERKOMST_SOURCE_KEYS = Object.freeze(['cbs/85458NED-rotterdam', 'cbs/85458NED-rotterdam-buitenland']);
const getValue = (i, url, fetcher, storage) => getRows(HERKOMST_SOURCE_KEYS[i], { live: url, fetcher, storage });

let cityPromise = null;
/** herkomstSummary() of Rotterdam, fetched once per page (sessionStorage-cached); rejects when CBS fails. */
export function loadCityHerkomst({ fetcher = globalThis.fetch?.bind(globalThis), storage = globalThis.sessionStorage } = {}) {
  if (!cityPromise) {
    cityPromise = Promise.all(buildHerkomstUrls().map((u, i) => getValue(i, u, fetcher, storage).catch(e => { if (i === 0) throw e; return []; })))
      .then(([main, born]) => {
        const s = herkomstSummary(parseHerkomstRows([...main, ...born]));
        if (!s) throw new Error('geen herkomstcijfers');
        return s;
      })
      .catch(e => { cityPromise = null; throw e; });
  }
  return cityPromise;
}
export function _resetHerkomstCache() { cityPromise = null; }

/** Wijken sorted by % buiten Europa (high first), with their origin split; wijken without data last, by name. */
export function wijkOriginRows(wijken) {
  return (wijken ?? []).map(a => ({ code: a.code, name: a.name, parts: originSplit(a.values) }))
    .sort((a, b) => (b.parts?.[2].value ?? -1) - (a.parts?.[2].value ?? -1) || String(a.name).localeCompare(String(b.name), 'nl'));
}
