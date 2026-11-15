// The balanced dashboard (docs/plan-dashboard.md): 6 categories × 3 panels.
// Pure: data selection, aggregation and HTML strings; dashboard.js loads the
// data, builds the context and puts boardHtml() in the page. No DOM here.
import { weightedMean, formatNumber, formatValue, niceTicks, EDU_LEVELS } from './dashboard-data.js';
import { CRIME_CATEGORIES, CRIME_MIN_POPULATION } from './areas.js';
import { explain } from './score.js';
import { isResidentialArea } from './woongebied.js';
import { ORIGIN_PARTS, originSplit, HERKOMST_TABLE, HERKOMST_YEAR } from './herkomst.js';
import { regionMix, diversityIndex, regionShare } from './dashboard-herkomst.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct1 = v => (isNum(v) ? `${formatNumber(v, 1)}%` : '—');
const signedPct = v => (isNum(v) ? `${v > 0 ? '+' : v < 0 ? '−' : '±'}${formatNumber(Math.abs(v), 1)}%` : '—');

export const NA_TEXT = 'Niet beschikbaar voor dit niveau';
export const KERN = 'CBS kerncijfers 2025';
export const CRIME_SRC = 'Politie via CBS 47018NED, 2025';
export const LIST_MIN_POPULATION = CRIME_MIN_POPULATION;   // wijken below this are port/industry noise

// ── Aggregation ──────────────────────────────────────────────────────────────

const CRIME_KEYS = Object.keys(CRIME_CATEGORIES);
const SUM_KEYS = ['population', 'totalCrimes', ...CRIME_KEYS.map(k => `${k}Count`), 'housingStock', 'nonResidentialStock'];
const POP_KEYS = ['pop15to24', 'pop25to44', 'pop45to64', 'pop65plus', 'hhWithKidsPct', 'highEdu', 'medEdu', 'lowEdu',
  'nonWesternPct', 'originDutchPct', 'originEuropePct', 'bornAbroadPct', 'avgIncome', 'welfarePer1000', 'woonscore'];
// Facilities and setting the Jouw dashboard reads (W19); population-weighted like POP_KEYS.
const PERSONAL_KEYS = ['singleHhPct', 'density', 'waterPct', 'horeca1km', 'distStation', 'distOv', 'distOvHalte', 'distMetro', 'distTram', 'distSchool', 'distKinderopvang', 'distGP', 'distSupermarket',
  'distCafe', 'distWarenhuis', 'distPodium', 'distBioscoop', 'distAttractie', 'distGroen', 'distRecreatie', 'distBos', 'distOpenNatuur'];
const HOUSING_KEYS = ['wozValue', 'ownerOccupiedPct', 'rentalPct', 'oldBuildPct', 'modernBuildPct', 'newBuildPct'];

/**
 * One values object for a set of areas: counts summed, per-person figures
 * weighted by inhabitants, dwelling figures by housing stock (inhabitants when
 * the stock is missing), crime rates from the summed counts and the trend from
 * the summed totals of areas that have one.
 */
export function aggregateAreas(areas) {
  const list = areas ?? [];
  const out = {};
  for (const k of SUM_KEYS) {
    const vals = list.map(a => a.values?.[k]).filter(isNum);
    out[k] = vals.length ? vals.reduce((s, v) => s + v, 0) : null;
  }
  for (const k of POP_KEYS) out[k] = weightedMean(list, k, 'population');
  for (const k of PERSONAL_KEYS) { const v = weightedMean(list, k, 'population'); if (v != null) out[k] = v; }
  const withStock = list.filter(a => isNum(a.values?.housingStock) && a.values.housingStock > 0);
  for (const k of HOUSING_KEYS) out[k] = withStock.length ? weightedMean(withStock, k, 'housingStock') ?? weightedMean(list, k) : weightedMean(list, k);
  const pop = out.population;
  const rate = c => (isNum(c) && pop > 0 ? c / pop * 1000 : null);
  out.crimeRate = rate(out.totalCrimes);
  for (const k of CRIME_KEYS) out[k] = rate(out[`${k}Count`]);
  let cur = 0, prev = 0;
  for (const a of list) {
    const t = a.values?.totalCrimes, tr = a.values?.crimeTrend;
    if (!isNum(t) || !isNum(tr) || tr <= -100) continue;
    cur += t; prev += t / (1 + tr / 100);
  }
  out.crimeTrend = prev > 0 ? (cur - prev) / prev * 100 : null;
  return out;
}

/** Gemeente code of a wijk/buurt code ('WK059901' → 'GM0599'). */
export const gemeenteCodeOf = code => (/^(WK|BU)\d{4}/.test(code ?? '') ? `GM${code.slice(2, 6)}` : /^GM\d{4}$/.test(code ?? '') ? code : null);

/** NL wijken → gemeenten [{ code, name, level: 'gemeente', values }], by name. */
export function aggregateGemeenten(wijken, nameOf = () => null) {
  const groups = new Map();
  for (const w of wijken ?? []) {
    const gm = w.gemeente ?? gemeenteCodeOf(w.code);
    if (!gm) continue;
    if (!groups.has(gm)) groups.set(gm, []);
    groups.get(gm).push(w);
  }
  return [...groups].map(([code, list]) => ({ code, name: nameOf(code) ?? code, level: 'gemeente', values: aggregateAreas(list) }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'nl'));
}

// ── Selections ───────────────────────────────────────────────────────────────

const valueFn = key => (typeof key === 'function' ? key : a => a?.values?.[key]);

/** Areas that may appear in a top/bottom list: residential, enough inhabitants, a value. */
export function listEligible(units, key, { minPopulation = LIST_MIN_POPULATION } = {}) {
  const val = valueFn(key);
  return (units ?? []).filter(a => isNum(val(a)) && (a.values?.population ?? 0) >= minPopulation && isResidentialArea(a));
}

/** The n highest (desc) or lowest areas by key (or value function): [{ code, name, value }]. */
export function rankBy(units, key, { n = 5, desc = true, minPopulation } = {}) {
  const val = valueFn(key);
  return listEligible(units, val, { minPopulation })
    .map(a => ({ code: a.code, name: a.name, value: val(a) }))
    .sort((a, b) => (desc ? b.value - a.value : a.value - b.value) || String(a.name).localeCompare(String(b.name), 'nl'))
    .slice(0, n);
}

/** { top, bottom }: the n highest and the n lowest, never the same area in both. */
export function topBottom(units, key, { n = 5, minPopulation } = {}) {
  const top = rankBy(units, key, { n, minPopulation });
  const used = new Set(top.map(r => r.code));
  const bottom = rankBy(units, key, { n: n + top.length, desc: false, minPopulation }).filter(r => !used.has(r.code)).slice(0, n);
  return { top, bottom };
}

/** Competition rank (1 = highest) of `code` by key among the eligible areas: { rank, of } or null. */
export function rankOf(units, key, code, opts) {
  const list = listEligible(units, key, opts);
  const me = list.find(a => a.code === code);
  if (!me) return null;
  const v = valueFn(key)(me);
  return { rank: 1 + list.filter(a => valueFn(key)(a) > v).length, of: list.length };
}

/** Equal-width histogram: [{ x0, x1, count }]; values outside [min, max] go to the edge bins. */
export function histogram(values, { min, max, bins = 10 } = {}) {
  const vals = (values ?? []).filter(isNum);
  if (!vals.length) return [];
  const lo = min ?? Math.min(...vals), hi = max ?? Math.max(...vals);
  const n = Math.max(1, bins), w = (hi - lo) / n || 1;
  const out = Array.from({ length: n }, (_, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, count: 0 }));
  for (const v of vals) out[Math.min(n - 1, Math.max(0, Math.floor((v - lo) / w)))].count++;
  return out;
}

/** Histogram over round bounds (niceTicks): about `bins` classes. */
export function niceHistogram(values, bins = 8) {
  const vals = (values ?? []).filter(isNum);
  if (!vals.length) return [];
  const t = niceTicks(Math.min(...vals), Math.max(...vals), bins);
  return histogram(vals, { min: t.min, max: t.max, bins: Math.max(1, Math.round((t.max - t.min) / t.step)) });
}

export const AGE_BANDS = Object.freeze([
  { key: 'pop0to14', label: '0–14' }, { key: 'pop15to24', label: '15–24' }, { key: 'pop25to44', label: '25–44' },
  { key: 'pop45to64', label: '45–64' }, { key: 'pop65plus', label: '65+' },
]);

/** Age bands in % of inhabitants; 0–14 is the rest of 100. Null when a band is missing. */
export function ageBands(values) {
  const v = AGE_BANDS.slice(1).map(b => values?.[b.key]);
  if (v.some(x => !isNum(x))) return null;
  const young = Math.max(0, 100 - v.reduce((s, x) => s + x, 0));
  return AGE_BANDS.map((b, i) => ({ ...b, value: i === 0 ? young : v[i - 1] }));
}

/** Crime categories that do not overlap (geweld holds bedreiging and straatroof). */
export const CRIME_TYPES = Object.freeze([
  { key: 'crimeVandalism', label: 'Vernieling' }, { key: 'crimeViolence', label: 'Geweld' },
  { key: 'crimeShoplifting', label: 'Winkeldiefstal' }, { key: 'crimeBike', label: 'Fietsdiefstal' },
  { key: 'crimeVehicle', label: 'Diefstal uit auto' }, { key: 'crimeBurglary', label: 'Woninginbraak' },
  { key: 'crimePickpocket', label: 'Zakkenrollerij' }, { key: 'crimeDrugs', label: 'Drugshandel' },
]);

/** The n largest crime types per 1,000 inhabitants: [{ key, label, value }]; null without any. */
export function crimeBreakdown(values, n = 6) {
  const rows = CRIME_TYPES.map(t => ({ ...t, value: values?.[t.key] })).filter(r => isNum(r.value));
  if (!rows.length) return null;
  return rows.sort((a, b) => b.value - a.value).slice(0, n);
}

/** Pearson correlation of [{ x, y }]; null below 3 points or without spread. */
export function pearson(points) {
  const p = (points ?? []).filter(q => isNum(q.x) && isNum(q.y));
  if (p.length < 3) return null;
  const mx = p.reduce((s, q) => s + q.x, 0) / p.length, my = p.reduce((s, q) => s + q.y, 0) / p.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (const q of p) { sxy += (q.x - mx) * (q.y - my); sxx += (q.x - mx) ** 2; syy += (q.y - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/**
 * What drives the Woonscore. With a scored area: its strong and weak factors
 * ({ mode: 'area', plus, minus }, score.js explain). Otherwise the factors whose
 * peer position differs most between the top and the bottom quarter of the
 * scored areas ({ mode: 'gap', rows: [{ key, label, gap }] }, gap in points of 100).
 * Null with too few scored areas.
 */
export function scoreDrivers(scored, selected = null, { top = 3, rows = 5 } = {}) {
  const own = selected?.woonscore;
  if (own && isNum(own.score)) {
    const { plus, minus } = explain(own, { top });
    if (plus.length || minus.length) return { mode: 'area', plus, minus };
  }
  const results = (scored ?? []).map(a => a.woonscore).filter(r => r && isNum(r.score) && !r.filtered).sort((a, b) => b.score - a.score);
  const q = Math.floor(results.length / 4);
  if (q < 2) return null;
  const mean = (list, key) => {
    const f = list.map(r => r.factors?.find(x => x.key === key)?.f).filter(isNum);
    return f.length ? f.reduce((s, v) => s + v, 0) / f.length : null;
  };
  const hi = results.slice(0, q), lo = results.slice(-q);
  const keys = new Map();
  for (const r of results) for (const f of r.factors ?? []) if (!keys.has(f.key)) keys.set(f.key, f.label ?? f.key);
  const out = [...keys].map(([key, label]) => {
    const a = mean(hi, key), b = mean(lo, key);
    return { key, label, gap: a != null && b != null ? (a - b) * 100 : null };
  }).filter(r => r.gap != null).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, rows);
  return out.length ? { mode: 'gap', rows: out } : null;
}

// ── Context ──────────────────────────────────────────────────────────────────

/**
 * Everything the panels read. `units` = areas in the lists (Rotterdam wijken,
 * NL gemeenten), `scored` = areas with score.js results (wijken), `selected` =
 * the area to compare (or null), `regio` = { area: entry|null, ref: entry|null,
 * areaName, refName } from herkomst-regio.
 */
export function buildContext({ scope = 'rotterdam', units = [], scored = units, selected = null, ref = null, regio = null, bouwLoaded = false } = {}) {
  const nl = scope === 'nederland';
  return {
    scope,
    refName: nl ? 'Nederland' : 'Rotterdam',
    unitWord: nl ? 'gemeenten' : 'wijken',
    unitOne: nl ? 'gemeente' : 'wijk',
    minPopulation: nl ? 0 : LIST_MIN_POPULATION,
    units, scored,
    ref: ref ?? aggregateAreas(nl ? scored : units),
    selected: selected?.values ? selected : null,
    regio: regio ?? { area: null, ref: null },
    bouwLoaded,
  };
}

// ── HTML pieces ──────────────────────────────────────────────────────────────

const subjectName = ctx => ctx.selected?.name ?? ctx.refName;
const subjectValues = ctx => ctx.selected?.values ?? ctx.ref;

export function kpiHtml(value, label, refText = '') {
  return `<div class="dp-kpi"><span class="dp-kpi-value">${esc(value)}</span><span class="dp-kpi-label">${esc(label)}</span>${refText ? `<span class="dp-kpi-ref">${esc(refText)}</span>` : ''}</div>`;
}

export function listItems(rows, fmt, selected) {
  return rows.map((r, i) => `<li class="dp-li${r.code === selected ? ' is-selected' : ''}"${r.code ? ` data-code="${esc(r.code)}" role="button" tabindex="0"` : ''}>
      <span class="dp-li-rank">${i + 1}</span><span class="dp-li-name">${esc(r.name)}</span><span class="dp-li-val">${esc(fmt(r.value))}</span></li>`).join('');
}

/** Two mini lists side by side (top / bottom or two rankings). */
export function pairListHtml(a, b, fmt, selected = null) {
  const col = (l) => `<div class="dp-col"><h4 class="dp-col-title">${esc(l.title)}</h4><ol class="dp-list">${l.rows.length ? listItems(l.rows, fmt, selected) : '<li class="dp-li is-empty">geen data</li>'}</ol></div>`;
  return `<div class="dp-pair">${col(a)}${col(b)}</div>`;
}

/** Horizontal bars, one per row; `ref` draws a marker at the reference value. */
export function barRowsHtml(rows, fmt, { max = null, refLabel = '' } = {}) {
  const top = max ?? Math.max(1e-9, ...rows.flatMap(r => [r.value, r.ref]).filter(isNum));
  const w = v => (Math.max(0, Math.min(100, v / top * 100))).toFixed(1);
  return `<ul class="dp-bars">${rows.map(r => {
    const tip = `${r.label}: ${fmt(r.value)}${isNum(r.ref) ? ` · ${refLabel} ${fmt(r.ref)}` : ''}`;
    return `<li class="dp-bar-row" data-tip="${esc(tip)}"><span class="dp-bar-label">${esc(r.label)}</span>
      <span class="dp-bar-track"><span class="dp-bar-fill${r.hl ? ' is-hl' : ''}" style="width:${isNum(r.value) ? w(r.value) : 0}%"></span>${isNum(r.ref) ? `<span class="dp-bar-ref" style="left:${w(r.ref)}%"></span>` : ''}</span>
      <span class="dp-bar-val">${esc(fmt(r.value))}</span></li>`;
  }).join('')}</ul>${rows.some(r => isNum(r.ref)) && refLabel ? `<p class="dp-legend"><span class="dp-key-fill"></span>${esc(rows.subject ?? '')} <span class="dp-key-ref"></span>${esc(refLabel)}</p>` : ''}`;
}

/** 100 % stacked bars: rows = [{ label, parts: [{ label, value }] }], series colours dp-s1…dp-s3. */
export function stackRowsHtml(rows, legend) {
  const body = rows.map(r => {
    const sum = r.parts.reduce((s, p) => s + (p.value ?? 0), 0) || 1;
    const tip = `${r.label}: ${r.parts.map(p => `${p.label} ${pct1(p.value)}`).join(', ')}`;
    return `<li class="dp-stack-row" data-tip="${esc(tip)}"><span class="dp-bar-label">${esc(r.label)}</span>
      <span class="dp-stack">${r.parts.map((p, i) => `<span class="dp-seg dp-s${i + 1}" style="width:${((p.value ?? 0) / sum * 100).toFixed(1)}%">${(p.value ?? 0) / sum >= 0.14 ? esc(formatNumber(p.value, 0)) : ''}</span>`).join('')}</span></li>`;
  }).join('');
  return `<ul class="dp-stacks">${body}</ul><p class="dp-legend">${legend.map((l, i) => `<span class="dp-key dp-s${i + 1}"></span>${esc(l)}`).join(' ')}</p>`;
}

/** Column histogram; `mark` / `refMark` highlight the class holding that value. */
export function histHtml(bins, { mark = null, refMark = null, fmtX = v => formatNumber(v), unitWord = 'gebieden' } = {}) {
  if (!bins.length) return '';
  const max = Math.max(1, ...bins.map(b => b.count));
  const inBin = (v, b, i) => isNum(v) && v >= b.x0 && (v < b.x1 || i === bins.length - 1);
  return `<div class="dp-hist">${bins.map((b, i) => {
    const cls = `${inBin(mark, b, i) ? ' is-mark' : ''}${inBin(refMark, b, i) ? ' is-ref' : ''}`;
    return `<span class="dp-hist-col${cls}" style="height:${Math.max(2, b.count / max * 100).toFixed(1)}%" data-tip="${esc(`${fmtX(b.x0)} – ${fmtX(b.x1)}: ${b.count} ${unitWord}`)}"></span>`;
  }).join('')}</div><div class="dp-hist-axis"><span>${esc(fmtX(bins[0].x0))}</span><span>${esc(fmtX(bins[bins.length - 1].x1))}</span></div>`;
}

/** Small scatter (viewBox, scales with the panel). */
export function scatterHtml(points, { selected = null, xLabel, yLabel, fmtX, fmtY } = {}) {
  const W = 300, H = 150, m = { l: 8, r: 8, t: 8, b: 8 };
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = v => m.l + (x1 > x0 ? (v - x0) / (x1 - x0) : 0.5) * (W - m.l - m.r);
  const sy = v => H - m.b - (y1 > y0 ? (v - y0) / (y1 - y0) : 0.5) * (H - m.t - m.b);
  const dots = points.map(p => `<circle class="dp-dot${p.code === selected ? ' is-selected' : ''}" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${p.code === selected ? 4.5 : 3}" data-tip="${esc(`${p.name}: ${xLabel} ${fmtX(p.x)}, ${yLabel} ${fmtY(p.y)}`)}"${p.code ? ` data-code="${esc(p.code)}"` : ''}/>`).join('');
  return `<svg class="dp-scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${yLabel} tegen ${xLabel}`)}"><line class="dp-axis" x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}"/><line class="dp-axis" x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H - m.b}"/>${dots}</svg>
    <div class="dp-hist-axis"><span>${esc(xLabel)} ${esc(fmtX(x0))} → ${esc(fmtX(x1))}</span><span>↑ ${esc(yLabel)}</span></div>`;
}

// ── Panels ───────────────────────────────────────────────────────────────────
// Each panel: (ctx) → { title, caption, body } with body null when the data is
// missing for this scope (the grid cell then says NA_TEXT).

const fmtScore = v => (isNum(v) ? formatNumber(Math.round(v)) : '—');
const fmtOf = key => v => formatValue(v, key);
const refLine = (ctx, key, fmt = fmtOf(key)) => (ctx.selected ? `${ctx.refName}: ${fmt(ctx.ref[key])}` : '');

function woonscoreSpread(ctx) {
  const vals = (ctx.units ?? []).map(a => a.values?.woonscore).filter(isNum);
  if (!vals.length) return { title: 'Score en verdeling', caption: '', body: null };
  const sel = ctx.selected, own = sel?.values?.woonscore;
  const rk = sel ? rankOf(ctx.units, 'woonscore', sel.code, { minPopulation: ctx.minPopulation }) : null;
  const kpi = sel
    ? kpiHtml(isNum(own) ? `${fmtScore(own)} / 100` : 'geen score', `Woonscore ${sel.name}${rk ? ` · nr. ${rk.rank} van ${rk.of} ${ctx.unitWord}` : ''}`, refLine(ctx, 'woonscore', v => `gemiddeld ${fmtScore(v)}`))
    : kpiHtml(`${fmtScore(ctx.ref.woonscore)} / 100`, `Gemiddeld in ${ctx.refName} (naar inwoners)`, `${vals.length} ${ctx.unitWord}, van ${fmtScore(Math.min(...vals))} tot ${fmtScore(Math.max(...vals))}`);
  return {
    title: 'Score en verdeling',
    caption: `Aantal ${ctx.unitWord} per scoreklasse · ${KERN}, eigen berekening`,
    body: kpi + histHtml(histogram(vals, { min: 0, max: 100, bins: 10 }), { mark: own, refMark: ctx.ref.woonscore, fmtX: fmtScore, unitWord: ctx.unitWord }),
  };
}

function woonscoreTop(ctx) {
  const { top, bottom } = topBottom(ctx.units, 'woonscore', { minPopulation: ctx.minPopulation });
  return {
    title: 'Hoogste en laagste Woonscore',
    caption: `Woongebieden onder de ${ctx.unitWord} · ${KERN}, eigen berekening`,
    body: top.length ? pairListHtml({ title: 'Hoogste 5', rows: top }, { title: 'Laagste 5', rows: bottom }, fmtScore, ctx.selected?.code) : null,
  };
}

function woonscoreDrivers(ctx) {
  const d = scoreDrivers(ctx.scored, ctx.selected);
  if (!d) return { title: 'Wat drijft de score', caption: '', body: null };
  const sign = v => `${v > 0 ? '+' : '−'}${formatNumber(Math.abs(v), 0)}`;
  if (d.mode === 'area') {
    const rows = r => r.map(x => ({ name: x.label, value: x.impact }));
    return {
      title: 'Wat drijft de score',
      caption: `Sterke en zwakke punten van ${ctx.selected.name}, in punten t.o.v. het midden · eigen berekening`,
      body: pairListHtml({ title: 'Sterk', rows: rows(d.plus) }, { title: 'Zwak', rows: rows(d.minus) }, sign),
    };
  }
  const max = Math.max(...d.rows.map(r => Math.abs(r.gap)));
  return {
    title: 'Wat drijft de score',
    caption: `Verschil tussen het beste en slechtste kwart van de wijken${ctx.scope === 'nederland' ? ' van Nederland' : ''}, in punten van 100 · eigen berekening`,
    body: barRowsHtml(d.rows.map(r => ({ label: r.label, value: Math.abs(r.gap), hl: r.gap < 0 })), v => formatNumber(v, 0), { max }),
  };
}

function ageStructure(ctx) {
  const own = ctx.selected ? ageBands(ctx.selected.values) : null;
  const ref = ageBands(ctx.ref);
  const main = own ?? (ctx.selected ? null : ref);
  if (!main) return { title: 'Leeftijdsopbouw', caption: '', body: null };
  const rows = main.map((b, i) => ({ label: b.label, value: b.value, ref: own ? ref?.[i]?.value : null }));
  rows.subject = subjectName(ctx);
  return { title: 'Leeftijdsopbouw', caption: `Aandeel inwoners per leeftijdsgroep (0–14 = de rest) · ${KERN}`, body: barRowsHtml(rows, pct1, { refLabel: own ? ctx.refName : '' }) };
}

function ageHotspots(ctx) {
  const old = rankBy(ctx.units, 'pop65plus', { minPopulation: ctx.minPopulation });
  const young = rankBy(ctx.units, 'pop15to24', { minPopulation: ctx.minPopulation });
  return {
    title: 'Vergrijzing en jongeren',
    caption: `${ctx.unitWord[0].toUpperCase()}${ctx.unitWord.slice(1)} met het grootste aandeel 65+ en 15–24 jaar · ${KERN}`,
    body: old.length || young.length ? pairListHtml({ title: 'Meeste 65+', rows: old }, { title: 'Meeste 15–24', rows: young }, pct1, ctx.selected?.code) : null,
  };
}

function ageKids(ctx) {
  const v = subjectValues(ctx).hhWithKidsPct;
  const top = rankBy(ctx.units, 'hhWithKidsPct', { minPopulation: ctx.minPopulation });
  if (!isNum(v) && !top.length) return { title: 'Gezinnen met kinderen', caption: '', body: null };
  return {
    title: 'Gezinnen met kinderen',
    caption: `Huishoudens met kinderen, aandeel van alle huishoudens · ${KERN}`,
    body: kpiHtml(pct1(v), subjectName(ctx), refLine(ctx, 'hhWithKidsPct', pct1)) + `<ol class="dp-list">${listItems(top, pct1, ctx.selected?.code)}</ol>`,
  };
}

function herkomstRegions(ctx) {
  const { area, ref, areaName, refName } = ctx.regio ?? {};
  const subject = area ?? ref;
  const rows = regionMix(subject, { top: 6 });
  if (!rows) return { title: 'Herkomst per wereldregio', caption: '', body: null };
  const cmp = area && ref ? ref : null;
  const keptShare = rows.filter(r => r.key !== 'overig').reduce((s, r) => s + (regionShare(cmp, r.key) ?? 0), 0);
  const bars = rows.map(r => ({ label: r.label, value: r.pct, hl: r.key === 'nederland', ref: cmp ? (r.key === 'overig' ? 100 - keptShare : regionShare(cmp, r.key)) : null }));
  bars.subject = area ? areaName : refName;
  return {
    title: 'Herkomst per wereldregio',
    caption: `${area ? `${areaName}, hele gemeente` : refName} · CBS ${HERKOMST_TABLE}, 1 jan. ${HERKOMST_YEAR}`,
    body: barRowsHtml(bars, pct1, { refLabel: cmp ? refName : '' }),
  };
}

const originParts = v => {
  const s = originSplit(v);
  return s ? s.map(p => ({ label: p.short, value: p.value })) : null;
};

function herkomstSplit(ctx) {
  const rows = [];
  if (ctx.selected) { const p = originParts(ctx.selected.values); if (p) rows.push({ label: ctx.selected.name, parts: p }); }
  const r = originParts(ctx.ref);
  if (r) rows.push({ label: ctx.refName, parts: r });
  if (!rows.length || (ctx.selected && rows.length < 2 && !originParts(ctx.selected.values))) return { title: 'Nederland, Europa, buiten Europa', caption: '', body: null };
  return {
    title: 'Nederland, Europa, buiten Europa',
    caption: `Herkomst in % van de inwoners · ${KERN}`,
    body: stackRowsHtml(rows, ORIGIN_PARTS.map(p => p.label)),
  };
}

function herkomstDiversity(ctx) {
  const div = a => diversityIndex(a?.values);
  const { top, bottom } = topBottom(ctx.units, div, { minPopulation: ctx.minPopulation });
  return {
    title: 'Meest en minst divers',
    caption: 'Kans dat twee inwoners een andere herkomst hebben (NL / Europa / buiten Europa) · ' + KERN,
    body: top.length ? pairListHtml({ title: 'Meest divers', rows: top }, { title: 'Minst divers', rows: bottom }, pct1, ctx.selected?.code) : null,
  };
}

function crimeRate(ctx) {
  const v = subjectValues(ctx);
  if (!isNum(v.crimeRate)) return { title: 'Misdrijven per 1.000 inwoners', caption: '', body: null };
  const fmt = x => formatNumber(x, 1);
  const rows = [{ label: subjectName(ctx), value: v.crimeRate, hl: true }];
  if (ctx.selected && isNum(ctx.ref.crimeRate)) rows.push({ label: ctx.refName, value: ctx.ref.crimeRate });
  const trend = `${subjectName(ctx)} ${signedPct(v.crimeTrend)} t.o.v. 2024${ctx.selected ? ` · ${ctx.refName} ${signedPct(ctx.ref.crimeTrend)}` : ''}`;
  return {
    title: 'Misdrijven per 1.000 inwoners',
    caption: `Geregistreerde misdrijven · ${CRIME_SRC}`,
    body: kpiHtml(fmt(v.crimeRate), `per 1.000 inwoners · ${subjectName(ctx)}`, trend) + barRowsHtml(rows, fmt),
  };
}

function crimeTypes(ctx) {
  const rows = crimeBreakdown(subjectValues(ctx));
  if (!rows) return { title: 'Soorten misdrijven', caption: '', body: null };
  const bars = rows.map(r => ({ label: r.label, value: r.value, ref: ctx.selected ? ctx.ref[r.key] : null }));
  bars.subject = subjectName(ctx);
  return {
    title: 'Soorten misdrijven',
    caption: `Grootste soorten per 1.000 inwoners (selectie, samen niet het totaal) · ${CRIME_SRC}`,
    body: barRowsHtml(bars, v => formatNumber(v, 1), { refLabel: ctx.selected ? ctx.refName : '' }),
  };
}

function crimeSafest(ctx) {
  const safe = rankBy(ctx.units, 'crimeRate', { desc: false, minPopulation: ctx.minPopulation });
  const used = new Set(safe.map(r => r.code));
  const unsafe = rankBy(ctx.units, 'crimeRate', { n: 10, minPopulation: ctx.minPopulation }).filter(r => !used.has(r.code)).slice(0, 5);
  return {
    title: 'Veiligst en minst veilig',
    caption: `Misdrijven per 1.000 inwoners, woongebieden · ${CRIME_SRC}`,
    body: safe.length ? pairListHtml({ title: 'Minste misdrijven', rows: safe }, { title: 'Meeste misdrijven', rows: unsafe }, v => formatNumber(v, 1), ctx.selected?.code) : null,
  };
}

const eduParts = v => (EDU_LEVELS.every(l => isNum(v?.[l.key])) ? EDU_LEVELS.map(l => ({ label: l.short, value: v[l.key] })) : null);

function eduMix(ctx) {
  const rows = [];
  const own = ctx.selected ? eduParts(ctx.selected.values) : null;
  if (own) rows.push({ label: ctx.selected.name, parts: own });
  const ref = eduParts(ctx.ref);
  if (ref) rows.push({ label: ctx.refName, parts: ref });
  if (!rows.length || (ctx.selected && !own)) return { title: 'Opleidingsmix', caption: '', body: null };
  return { title: 'Opleidingsmix', caption: `Hoogst behaald niveau, 15–75 jaar · ${KERN}`, body: stackRowsHtml(rows, EDU_LEVELS.map(l => l.label)) };
}

function eduTop(ctx) {
  const { top, bottom } = topBottom(ctx.units, 'highEdu', { minPopulation: ctx.minPopulation });
  return {
    title: 'Hoogst en laagst opgeleid',
    caption: `Aandeel hbo/wo onder de ${ctx.unitWord} · ${KERN}`,
    body: top.length ? pairListHtml({ title: 'Meeste hbo/wo', rows: top }, { title: 'Minste hbo/wo', rows: bottom }, pct1, ctx.selected?.code) : null,
  };
}

function eduIncome(ctx) {
  const pts = listEligible(ctx.units, a => (isNum(a.values?.highEdu) && isNum(a.values?.avgIncome) ? 1 : null), { minPopulation: ctx.minPopulation })
    .map(a => ({ code: a.code, name: a.name, x: a.values.highEdu, y: a.values.avgIncome }));
  const r = pearson(pts);
  if (r == null) return { title: 'Opleiding en inkomen', caption: '', body: null };
  const strength = Math.abs(r) >= 0.7 ? 'sterk' : Math.abs(r) >= 0.4 ? 'matig' : 'zwak';
  return {
    title: 'Opleiding en inkomen',
    caption: `Elke stip is een ${ctx.unitOne}; r = ${formatNumber(r, 2)} (${strength} verband) · ${KERN}`,
    body: scatterHtml(pts, { selected: ctx.selected?.code, xLabel: 'hbo/wo', yLabel: 'inkomen', fmtX: pct1, fmtY: fmtOf('avgIncome') }),
  };
}

function incomeDist(ctx) {
  const vals = listEligible(ctx.units, 'avgIncome', { minPopulation: ctx.minPopulation }).map(a => a.values.avgIncome);
  const v = subjectValues(ctx).avgIncome;
  if (!vals.length && !isNum(v)) return { title: 'Inkomen', caption: '', body: null };
  const fmt = fmtOf('avgIncome');
  return {
    title: 'Inkomen',
    caption: `Gem. gestandaardiseerd huishoudinkomen; verdeling over de ${ctx.unitWord} · ${KERN}`,
    body: kpiHtml(fmt(v), subjectName(ctx), refLine(ctx, 'avgIncome')) + histHtml(niceHistogram(vals, 8), { mark: ctx.selected?.values?.avgIncome, refMark: ctx.ref.avgIncome, fmtX: x => `€${formatNumber(x, 0)}k`, unitWord: ctx.unitWord }),
  };
}

function wozTenure(ctx) {
  const v = subjectValues(ctx);
  if (!isNum(v.wozValue) && !isNum(v.ownerOccupiedPct)) return { title: 'WOZ en eigendom', caption: '', body: null };
  const parts = x => (isNum(x?.ownerOccupiedPct) && isNum(x?.rentalPct) ? [{ label: 'Koop', value: x.ownerOccupiedPct }, { label: 'Huur', value: x.rentalPct }] : null);
  const rows = [];
  if (parts(v)) rows.push({ label: subjectName(ctx), parts: parts(v) });
  if (ctx.selected && parts(ctx.ref)) rows.push({ label: ctx.refName, parts: parts(ctx.ref) });
  const welfare = isNum(v.welfarePer1000) ? `<p class="dp-note">Bijstand: ${esc(formatValue(v.welfarePer1000, 'welfarePer1000'))}${ctx.selected && isNum(ctx.ref.welfarePer1000) ? ` · ${esc(ctx.refName)} ${esc(formatNumber(ctx.ref.welfarePer1000, 1))}` : ''}</p>` : '';
  return {
    title: 'WOZ en eigendom',
    caption: `Gem. WOZ-waarde, koop/huur en bijstand · ${KERN}`,
    body: kpiHtml(formatValue(v.wozValue, 'wozValue'), `gem. WOZ · ${subjectName(ctx)}`, refLine(ctx, 'wozValue'))
      + (rows.length ? stackRowsHtml(rows, ['Koopwoning', 'Huurwoning']) : '') + welfare,
  };
}

export const bouwParts = x => (isNum(x?.oldBuildPct) && isNum(x?.modernBuildPct)
  ? [{ label: 'Voor 1945', value: x.oldBuildPct }, { label: '1945–2004', value: Math.max(0, 100 - x.oldBuildPct - x.modernBuildPct) }, { label: '2005+', value: x.modernBuildPct }]
  : null);

function buildingAge(ctx) {
  const v = subjectValues(ctx);
  const rows = [];
  if (bouwParts(v)) rows.push({ label: subjectName(ctx), parts: bouwParts(v) });
  if (ctx.selected && bouwParts(ctx.ref)) rows.push({ label: ctx.refName, parts: bouwParts(ctx.ref) });
  const recent = isNum(v.newBuildPct) ? `<p class="dp-note">Gebouwd in de laatste 10 jaar: ${esc(pct1(v.newBuildPct))}${ctx.selected && isNum(ctx.ref.newBuildPct) ? ` · ${esc(ctx.refName)} ${esc(pct1(ctx.ref.newBuildPct))}` : ''}</p>` : '';
  if (!rows.length && !recent) return { title: 'Bouwperiode', caption: '', body: null };
  return {
    title: 'Bouwperiode',
    caption: `Woningen naar bouwjaar (geschat via postcode, CBS 2023) en nieuwbouw · ${KERN}`,
    body: (rows.length ? stackRowsHtml(rows, ['Voor 1945', '1945–2004', '2005 en later']) : `<p class="dp-note">${ctx.bouwLoaded ? 'Bouwjaren niet beschikbaar.' : 'Bouwjaren laden…'}</p>`) + recent,
  };
}

/** The six rows, in order, with three panel builders each. */
export const CATEGORIES = Object.freeze([
  { key: 'woonscore', title: 'Woonscore', panels: [['ws-score', woonscoreSpread], ['ws-top', woonscoreTop], ['ws-drivers', woonscoreDrivers]] },
  { key: 'leeftijd', title: 'Leeftijd', panels: [['age-bands', ageStructure], ['age-hotspots', ageHotspots], ['age-kids', ageKids]] },
  { key: 'herkomst', title: 'Herkomst', panels: [['hk-regions', herkomstRegions], ['hk-split', herkomstSplit], ['hk-diversity', herkomstDiversity]] },
  { key: 'criminaliteit', title: 'Criminaliteit', panels: [['crime-rate', crimeRate], ['crime-types', crimeTypes], ['crime-safest', crimeSafest]] },
  { key: 'opleiding', title: 'Opleiding', panels: [['edu-mix', eduMix], ['edu-top', eduTop], ['edu-income', eduIncome]] },
  { key: 'welvaart', title: 'Welvaart & wonen', panels: [['inc-dist', incomeDist], ['woz-tenure', wozTenure], ['bouw', buildingAge]] },
]);

/**
 * 6 rows × 3 panels for a context: [{ key, title, panels: [{ id, title, caption, body }] }].
 * A builder that throws or finds no data yields body null; the grid never shrinks.
 */
export function dashboardLayout(ctx) {
  return CATEGORIES.map(cat => ({
    key: cat.key, title: cat.title,
    panels: cat.panels.map(([id, build]) => {
      let p = null;
      try { p = build(ctx); } catch (err) { globalThis.console?.warn?.(`dashboard panel ${id}:`, err); }
      return { id, title: p?.title ?? id, caption: p?.caption ?? '', body: p?.body ?? null };
    }),
  }));
}

/** Algemeen panel builders by id, for reuse in the Jouw dashboard (dashboard-personal.js). */
export const PANEL_BUILDERS = Object.freeze(Object.fromEntries(CATEGORIES.flatMap(c => c.panels)));

/** The grid HTML for dashboardLayout() rows; `personal` gives the blue Jouw-dashboard variant. */
export function boardHtml(rows, { personal = false } = {}) {
  return `<div class="dash-board${personal ? ' is-personal' : ''}">${rows.map(row => `
    <h3 class="dash-cat" id="dash-cat-${row.key}">${esc(row.title)}</h3>${row.panels.map(p => `
    <article class="dash-panel${p.body == null ? ' is-na' : ''}" data-panel="${p.id}" aria-labelledby="dash-p-${p.id}">
      <header class="dash-panel-head"><h4 id="dash-p-${p.id}">${esc(p.title)}</h4>${p.caption ? `<p class="dash-panel-cap">${esc(p.caption)}</p>` : ''}</header>
      <div class="dash-panel-body">${p.body ?? `<p class="dp-na">${NA_TEXT}</p>`}</div>
    </article>`).join('')}`).join('')}
  </div>`;
}
