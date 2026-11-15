// "Jouw dashboard" (W19, docs/plan-dashboard.md): the same 6 × 3 grid as the
// Algemeen dashboard, personalised by the wizard answers. Pure: the spec
// (which rows, in which order, which panels) and the panel HTML; dashboard.js
// loads the data and paints. No DOM here.
//
// personalDashboardSpec(answers, preset) decides the layout: row 1 is always
// "Jouw woonplek"; rows 2–6 are the categories the user answered, most
// important first, then Algemeen categories as fallback. Gemeenschap only
// appears when opted in and only as a positive "nabijheid" (plan-woonscore §5).
import { weightedMean, formatNumber, formatValue } from './dashboard-data.js';
import { DATASETS } from './datasets.js';
import { THEME_LABELS, ORIGIN_KEYS, scoreWithPreset } from './presets.js';
import {
  normalizeAnswers, answersToPreset, themeImportance, gemeenschapLevel, budgetCeiling, describeAnswers,
  CRIMES, SITUATIE_EDU, SITUATIE_INCOME, incomeTarget, DETAIL_GROUPS, GEMEENSCHAP_LABEL, IMPORTANCE_DEFAULT, DICHTBIJ,
} from './wizard-model.js';
import {
  CATEGORIES, PANEL_BUILDERS, listEligible, histogram, niceHistogram, aggregateAreas, bouwParts, gemeenteCodeOf,
  kpiHtml, pairListHtml, barRowsHtml, stackRowsHtml, histHtml, KERN, CRIME_SRC,
} from './dashboard-panels.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const ROWS = 6;
export const PANELS_PER_ROW = 3;
export const TOP_MATCHES = 10;
const ALGEMEEN = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));

// ── Spec ─────────────────────────────────────────────────────────────────────

/** Personal categories: the preset themes that set their importance, the Algemeen row they replace. */
export const PERSONAL_CATEGORIES = Object.freeze({
  veiligheid:     { title: 'Veiligheid · jouw punten', themes: ['veiligheid'], replaces: 'criminaliteit' },
  levenstype:     { title: 'Levenstype', themes: ['leeftijd'], replaces: 'leeftijd' },
  wonen:          { title: 'Wonen en budget', themes: ['budget', 'woningmarkt', 'nieuwbouw'], replaces: 'welvaart' },
  bereikbaarheid: { title: 'Vervoer en sfeer', themes: ['voorzieningen', 'sfeer', 'dichtbij'], replaces: null },
  situatie:       { title: 'Jouw situatie', themes: ['situatie'], replaces: 'opleiding' },
  gemeenschap:    { title: GEMEENSCHAP_LABEL, themes: ['gemeenschap'], replaces: 'herkomst' },
});
const POOL_ORDER = Object.keys(PERSONAL_CATEGORIES);
/** Fallback rows after the answered ones. Herkomst is left out: origin only via an opted-in Gemeenschap. */
const FALLBACK_ORDER = ['leeftijd', 'criminaliteit', 'opleiding', 'welvaart', 'bereikbaarheid'];

const m = (key, pref, extra = {}) => ({ key, pref, ...extra });
const LIFE_FOCUS = {
  student:    { metrics: [m('pop15to24', 'higher'), m('pop25to44', 'higher')], third: 'age-hotspots' },
  stel:       { metrics: [m('pop25to44', 'higher')], third: 'age-bands' },
  gezin:      { metrics: [m('hhWithKidsPct', 'higher'), m('distSchool', 'lower'), m('distKinderopvang', 'lower')], third: 'age-kids' },
  '50plus':   { metrics: [m('pop45to64', 'higher'), m('distGP', 'lower')], third: 'age-hotspots' },
  senior:     { metrics: [m('pop65plus', 'higher'), m('distGP', 'lower'), m('distSupermarket', 'lower')], third: 'age-hotspots' },
  soloMensen: { metrics: [m('horeca1km', 'higher'), m('density', 'higher'), m('distCentrum', 'lower'), m('singleHhPct', 'higher')], third: 'age-bands' },
  soloRust:   { metrics: [m('waterPct', 'higher'), m('density', 'lower'), m('distCentrum', 'higher')], third: 'age-bands' },
};
/** Standaard Voorzieningen, for the Vervoer en sfeer row when neither step was answered. */
const DEFAULT_REACH = [m('distSupermarket', 'lower'), m('distGP', 'lower'), m('distSchool', 'lower'), m('distStation', 'lower')];

const uniqMetrics = list => { const seen = new Set(); return list.filter(x => !seen.has(x.key) && seen.add(x.key)); };

/** The personal rows the answers fill: { key → { panels, focus } } (only categories with an answer). */
function personalRows(a) {
  const out = {};
  const vv = new Set(a.vervoer);
  const crimes = [...a.veiligheid.map(c => CRIMES[c].key), ...(vv.has('fiets') ? ['crimeBike'] : []), ...(vv.has('auto') ? ['crimeVehicle'] : [])];
  if (crimes.length) out.veiligheid = { panels: ['pf-match', 'pf-rank', 'pv-total'], focus: { metrics: uniqMetrics(crimes.map(k => m(k, 'lower'))) } };
  if (a.levensfase) {
    const f = LIFE_FOCUS[a.levensfase];
    out.levenstype = { panels: ['pf-match', 'pf-rank', f.third], focus: { metrics: f.metrics, levenstype: a.levensfase } };
  }
  const ceiling = budgetCeiling(a.budget);
  if (a.budget || a.bouw) {
    const bouw = a.bouw === 'karakter' ? [m('oldBuildPct', 'higher')] : a.bouw === 'modern' ? [m('modernBuildPct', 'higher'), m('newBuildPct', 'higher')] : [];
    let panels, metrics;
    if (ceiling != null) { panels = ['pb-budget', 'pb-within', a.bouw ? 'pw-bouw' : 'woz-tenure']; metrics = [m('wozValue', 'max', { max: ceiling }), ...bouw]; }
    else if (a.budget) { panels = ['pf-match', 'pf-rank', a.bouw ? 'pw-bouw' : 'woz-tenure']; metrics = [m(a.budget.mode === 'huur' ? 'rentalPct' : 'ownerOccupiedPct', 'higher'), ...bouw]; }
    else { panels = ['pw-bouw', 'pf-rank', 'woz-tenure']; metrics = bouw; }
    out.wonen = { panels, focus: { metrics, ceiling, bouw: a.bouw, mode: a.budget?.mode ?? null } };
  }
  const reach = [];
  if (vv.has('ov')) reach.push(m('distOv', 'lower'));
  if (vv.has('fiets')) reach.push(m('crimeBike', 'lower'));
  if (vv.has('lopen')) reach.push(m('distSupermarket', 'lower'), m('distGP', 'lower'));
  if (a.sfeer != null && a.sfeer < 35) reach.push(m('horeca1km', 'higher'), m('density', 'higher'), m('distCentrum', 'lower'));
  else if (a.sfeer != null && a.sfeer > 65) reach.push(m('density', 'lower'), m('distCentrum', 'higher'));
  else if (a.sfeer != null) reach.push(m('density', 'target', { quantile: 0.5 }));
  if (vv.has('auto') && a.sfeer == null) reach.push(m('density', 'lower'));
  // "Wat wil je dichtbij?": most important item first, its main distance (closer = better).
  for (const [item] of Object.entries(a.dichtbij ?? {}).sort((x, y) => y[1] - x[1])) reach.push(m(DICHTBIJ[item].metrics[0][0], 'lower'));
  if (reach.length) out.bereikbaarheid = { panels: ['pf-match', 'pf-rank', 'pf-hist'], focus: { metrics: uniqMetrics(reach) } };
  const s = a.situatie;
  if (s) {
    const metrics = [];
    if (s.edu) metrics.push(m(SITUATIE_EDU[s.edu].key, 'higher'));
    if (s.income) metrics.push(m('avgIncome', 'target', { ideal: incomeTarget(s.income)?.ideal }));
    if (s.income && SITUATIE_INCOME[s.income].welfare) metrics.push(m('welfarePer1000', 'higher'));
    out.situatie = { panels: ['pf-match', 'pf-rank', s.edu ? 'edu-mix' : 'inc-dist'], focus: { metrics, edu: s.edu, income: s.income } };
  }
  const g = a.gemeenschap;
  const det = g ? DETAIL_GROUPS[g.detail] : null;
  // Positive only: one `higher` metric, the chosen group's share. Never a lowest list, never another group.
  if (det) out.gemeenschap = { panels: ['pg-near', 'pf-match', 'hk-regions'], focus: { metrics: [m(det.key, 'higher')], group: g.detail, groupLabel: det.label } };
  return out;
}

/** Importance level 0–4 of a personal category: the highest of its themes (Gemeenschap: from its pct). */
function categoryLevel(key, a, levels) {
  if (key === 'gemeenschap') return a.gemeenschap ? gemeenschapLevel(a.gemeenschap.pct) : 0;
  const lv = PERSONAL_CATEGORIES[key].themes.map(t => levels[t]).filter(isNum);
  return lv.length ? Math.max(...lv) : IMPORTANCE_DEFAULT;
}

/** Weight share (%) per theme of the preset, largest first: [{ key, label, pct }]. */
export function themeShares(preset) {
  const themes = (preset?.themes ?? []).filter(t => t.weight > 0 && t.metrics?.length);
  const total = themes.reduce((s, t) => s + t.weight, 0);
  if (!(total > 0)) return [];
  return themes.map(t => ({ key: t.key, label: THEME_LABELS[t.key] ?? t.label ?? t.key, pct: t.weight / total * 100 }))
    .sort((x, y) => y.pct - x.pct || POOL_ORDER.indexOf(x.key) - POOL_ORDER.indexOf(y.key));
}

/**
 * The Jouw dashboard layout for wizard answers and their preset:
 * { rows: [{ key, title, source: 'jouw' | 'algemeen', level, panels: [id×3], focus }], weights }.
 * Always 6 rows × 3 panel ids. Row 1 "Jouw woonplek"; then the answered
 * categories by importance (ties: veiligheid, levenstype, wonen, vervoer/sfeer,
 * situatie, gemeenschap); a category rated "Niet belangrijk" counts as
 * skipped; skipped ones fall back to the Algemeen row they would replace.
 */
export function personalDashboardSpec(answers, preset = null) {
  const a = normalizeAnswers(answers);
  const p = preset ?? answersToPreset(a);
  const levels = themeImportance(a);
  const shares = themeShares(p);
  const shareOf = key => PERSONAL_CATEGORIES[key].themes.reduce((s, t) => s + (shares.find(x => x.key === t)?.pct ?? 0), 0);
  const filled = personalRows(a);
  const answered = POOL_ORDER.filter(k => filled[k])
    .map(k => ({ key: k, level: categoryLevel(k, a, levels) }))
    .filter(r => r.level > 0)
    .sort((x, y) => y.level - x.level || shareOf(y.key) - shareOf(x.key) || POOL_ORDER.indexOf(x.key) - POOL_ORDER.indexOf(y.key))
    .slice(0, ROWS - 1);
  const rows = [{ key: 'jouw', title: 'Jouw woonplek', source: 'jouw', level: null, panels: ['jw-top', 'jw-shift', 'jw-weights'], focus: {} }];
  for (const r of answered) rows.push({ key: r.key, title: PERSONAL_CATEGORIES[r.key].title, source: 'jouw', level: r.level, ...filled[r.key] });
  const replaced = new Set(answered.map(r => PERSONAL_CATEGORIES[r.key].replaces).filter(Boolean));
  if (filled.situatie && a.situatie?.income && !a.situatie.edu) { replaced.delete('opleiding'); replaced.add('welvaart'); }
  for (const key of FALLBACK_ORDER) {
    if (rows.length >= ROWS) break;
    if (key === 'bereikbaarheid') {
      if (!answered.some(r => r.key === key)) rows.push({ key, title: 'Voorzieningen', source: 'algemeen', level: null, panels: ['pf-match', 'pf-rank', 'pf-hist'], focus: { metrics: DEFAULT_REACH } });
    } else if (!replaced.has(key)) {
      rows.push({ key, title: ALGEMEEN[key].title, source: 'algemeen', level: null, panels: ALGEMEEN[key].panels.map(([id]) => id), focus: {} });
    }
  }
  return { rows: rows.slice(0, ROWS), weights: shares };
}

// ── Personal context ─────────────────────────────────────────────────────────

/**
 * Standaard Woonscore per unit code (Map), for "Jouw score vs Standaard".
 * Rotterdam: the wijken scored with Standaard. Nederland: the wijken scored,
 * then per gemeente the population-weighted mean (as the Jouw score is).
 */
export function standardScores(scored, { gemeenten = false } = {}) {
  const list = scored ?? [];
  const { results } = scoreWithPreset(list, 'standaard');
  const byCode = new Map();
  results.forEach((r, i) => { if (isNum(r?.score) && !r.filtered) byCode.set(list[i].code, r.score); });
  if (!gemeenten) return byCode;
  const sum = new Map();
  list.forEach(w => {
    const v = byCode.get(w.code), pop = w.values?.population;
    const gm = w.gemeente ?? gemeenteCodeOf(w.code);
    if (!gm || !isNum(v) || !(pop > 0)) return;
    const s = sum.get(gm) ?? { v: 0, w: 0 };
    s.v += v * pop; s.w += pop; sum.set(gm, s);
  });
  return new Map([...sum].map(([gm, s]) => [gm, s.v / s.w]));
}

/** Jouw score top n of the listable units: [{ code, name, value }] (value = Jouw score). */
export function topMatches(ctx, n = TOP_MATCHES) {
  return listEligible(ctx.units, 'woonscore', { minPopulation: ctx.minPopulation })
    .map(a => ({ code: a.code, name: a.name, value: a.values.woonscore, area: a }))
    .sort((x, y) => y.value - x.value || String(x.name).localeCompare(String(y.name), 'nl'))
    .slice(0, n);
}

/** How good a value is for a focus metric (higher = better), or null. */
export function goodness(metric, v, ref = null) {
  if (!isNum(v)) return null;
  if (metric.pref === 'lower') return -v;
  if (metric.pref === 'target') {
    const ideal = isNum(metric.ideal) ? metric.ideal : ref;
    return isNum(ideal) ? -Math.abs(v - ideal) : null;
  }
  if (metric.pref === 'max') return v <= metric.max ? -Math.abs(v - metric.max * 0.85) : null;
  return v;
}

// ── Panels ───────────────────────────────────────────────────────────────────
// (ctx, focus, pc) → { title, caption, body }; pc = { top, std, answers }.

// W23: rows state the unit once (caption), not after every value, so they fit.
/** Units dropped from each value and named once in the caption. */
const CAPTION_UNITS = Object.freeze({ 'per 1.000': 'per 1.000 inwoners', 'per km²': 'per km²' });
/** Shorter row labels where the dataset label is long. */
const SHORT_LABELS = Object.freeze({ crimeBurglary: 'Inbraak', crimeViolence: 'Geweld', crimeBike: 'Fietsdiefstal' });
/** Short row label for a metric: no unit suffix ("per 1.000 inw.", "per km²", "(%)"). */
export function shortLabel(key) {
  const l = SHORT_LABELS[key] ?? DATASETS[key]?.label ?? key;
  return l.replace(/\s*(per 1\.?000 inw(oners|\.)?|per km²|\(%\))\s*$/i, '').trim() || l;
}
/** Value formatter for a metric in a personal panel: units in CAPTION_UNITS give the bare number. */
export function compactFormat(key) {
  const unit = DATASETS[key]?.unit;
  if (!CAPTION_UNITS[unit]) return v => formatValue(v, key);
  return v => (isNum(v) ? formatNumber(v, unit === 'per 1.000' ? 1 : 0) : 'geen data');
}
/** The caption note for the bare-number units among these metrics ('' when none): "per 1.000 inwoners". */
export function unitNote(keys) {
  return [...new Set((keys ?? []).map(k => CAPTION_UNITS[DATASETS[k]?.unit]).filter(Boolean))].join(' · ');
}
const withUnit = (keys, text) => { const u = unitNote(keys); return u ? `${u} · ${text}` : text; };
const labelOf = shortLabel;
const fmtOf = compactFormat;
const fmtPct = v => (isNum(v) ? `${formatNumber(Math.round(v))}%` : '—');
const signed = v => (isNum(v) ? `${v > 0 ? '+' : v < 0 ? '−' : '±'}${formatNumber(Math.abs(v), 0)}` : '—');
const mean = (areas, key) => weightedMean(areas, key, 'population');

function rankList(rows, fmt, start = 1, selected = null) {
  return `<ol class="dp-list" start="${start}">${rows.map((r, i) => `<li class="dp-li${r.code === selected ? ' is-selected' : ''}"${r.code ? ` data-code="${esc(r.code)}" role="button" tabindex="0"` : ''}>
      <span class="dp-li-rank">${start + i}</span><span class="dp-li-name">${esc(r.name)}</span><span class="dp-li-val">${esc(fmt(r.value))}</span></li>`).join('')}</ol>`;
}

function jwTop(ctx, _f, pc) {
  const top = pc.top;
  if (!top.length) return { title: 'Jouw top 10', caption: '', body: null };
  const half = Math.ceil(top.length / 2);
  return {
    title: 'Jouw top 10',
    caption: `Beste match onder de ${ctx.unitWord}: Jouw score als matchpercentage · ${KERN}, eigen berekening`,
    body: `<div class="dp-pair"><div class="dp-col">${rankList(top.slice(0, half), fmtPct, 1, ctx.selected?.code)}</div><div class="dp-col">${rankList(top.slice(half), fmtPct, half + 1, ctx.selected?.code)}</div></div>`,
  };
}

/** Units with both scores: [{ code, name, value: jouw − standaard }]. */
export function scoreShift(units, std, { minPopulation } = {}) {
  return listEligible(units, a => (std?.has(a.code) && isNum(a.values?.woonscore) ? a.values.woonscore - std.get(a.code) : null), { minPopulation })
    .map(a => ({ code: a.code, name: a.name, value: a.values.woonscore - std.get(a.code) }));
}

function jwShift(ctx, _f, pc) {
  const rows = scoreShift(ctx.units, pc.std, { minPopulation: ctx.minPopulation });
  if (rows.length < 2) return { title: 'Jouw score vs Standaard', caption: '', body: null };
  const byName = (x, y) => String(x.name).localeCompare(String(y.name), 'nl');
  const up = [...rows].sort((x, y) => y.value - x.value || byName(x, y)).slice(0, 5).filter(r => r.value > 0);
  const used = new Set(up.map(r => r.code));
  const down = [...rows].sort((x, y) => x.value - y.value || byName(x, y)).filter(r => r.value < 0 && !used.has(r.code)).slice(0, 5);
  return {
    title: 'Jouw score vs Standaard',
    caption: `Verschil in punten (van 100) tussen Jouw score en de Standaard Woonscore · eigen berekening`,
    body: pairListHtml({ title: 'Stijgen het meest', rows: up }, { title: 'Dalen het meest', rows: down }, signed, ctx.selected?.code),
  };
}

function jwWeights(_ctx, _f, pc) {
  const w = pc.weights ?? [];
  if (!w.length) return { title: 'Wat jij belangrijk vindt', caption: '', body: null };
  return {
    title: 'Wat jij belangrijk vindt',
    caption: `Gewicht per thema in Jouw score (samen 100%) · ${describeAnswers(pc.answers) || 'jouw antwoorden'}`,
    body: barRowsHtml(w.map((t, i) => ({ label: t.label, value: t.pct, hl: i === 0 })), fmtPct),
  };
}

function pfMatch(ctx, f, pc) {
  const title = f.groupLabel ? `Jouw top 10: aandeel ${f.groupLabel}` : 'Jouw top 10 vs gemiddeld';
  const eligible = listEligible(ctx.units, () => 1, { minPopulation: ctx.minPopulation });
  const top = pc.top.map(t => t.area);
  const parts = (f.metrics ?? []).slice(0, 5).map(mt => ({ mt, value: mean(top, mt.key), ref: mean(eligible, mt.key) }))
    .filter(r => isNum(r.value) && isNum(r.ref));
  if (!parts.length) return { title, caption: '', body: null };
  const body = parts.map(r => barRowsHtml([{ label: labelOf(r.mt.key), value: r.value, ref: r.ref }], fmtOf(r.mt.key), { max: Math.max(r.value, r.ref) * 1.15 || 1 })).join('');
  return {
    title,
    caption: withUnit(parts.map(r => r.mt.key), `Gemiddelde van jouw 10 beste ${ctx.unitWord} (balk) tegen heel ${ctx.refName} (streep) · ${KERN}`),
    body: `${body}<p class="dp-legend"><span class="dp-key-fill"></span>Jouw top 10 <span class="dp-key-ref"></span>${esc(ctx.refName)}</p>`,
  };
}

function pfRank(ctx, f, pc) {
  const mt = (f.metrics ?? []).find(x => x.pref !== 'max') ?? f.metrics?.[0];
  if (!mt) return { title: 'Beste op jouw punt', caption: '', body: null };
  const eligible = listEligible(ctx.units, mt.key, { minPopulation: ctx.minPopulation });
  const ref = mean(eligible, mt.key);
  const best = eligible.map(a => ({ code: a.code, name: a.name, value: a.values[mt.key], g: goodness(mt, a.values[mt.key], ref) }))
    .filter(r => r.g != null).sort((x, y) => y.g - x.g || String(x.name).localeCompare(String(y.name), 'nl')).slice(0, 5);
  const mine = pc.top.slice(0, 5).map(t => ({ code: t.code, name: t.name, value: t.area.values?.[mt.key] })).filter(r => isNum(r.value));
  const title = `${labelOf(mt.key)}: beste en jouw top 5`;
  if (!best.length) return { title, caption: '', body: null };
  const how = mt.pref === 'lower' ? 'laagste' : mt.pref === 'target' ? 'dichtst bij jouw wens' : 'hoogste';
  return {
    title,
    caption: withUnit([mt.key], `Links de ${ctx.unitWord} met de ${how} waarde, rechts jouw 5 beste matches · gemiddeld ${fmtOf(mt.key)(ref)} · ${KERN}`),
    body: pairListHtml({ title: 'Beste 5', rows: best }, { title: 'Jouw top 5', rows: mine }, fmtOf(mt.key), ctx.selected?.code),
  };
}

function pfHist(ctx, f, pc) {
  const mt = f.metrics?.[0];
  const title = mt ? `${labelOf(mt.key)}: verdeling` : 'Verdeling';
  if (!mt) return { title, caption: '', body: null };
  const eligible = listEligible(ctx.units, mt.key, { minPopulation: ctx.minPopulation });
  const vals = eligible.map(a => a.values[mt.key]);
  if (vals.length < 2) return { title, caption: '', body: null };
  const mine = mean(pc.top.map(t => t.area), mt.key), ref = mean(eligible, mt.key);
  const fmt = fmtOf(mt.key);
  return {
    title,
    caption: withUnit([mt.key], `Aantal ${ctx.unitWord} per klasse; licht = jouw top 10, donker = gemiddeld · ${KERN}`),
    body: kpiHtml(fmt(mine), 'gemiddeld in jouw top 10', `${ctx.refName}: ${fmt(ref)}`) + histHtml(niceHistogram(vals, 8), { mark: mine, refMark: ref, fmtX: v => formatNumber(v, v < 10 ? 1 : 0), unitWord: ctx.unitWord }),
  };
}

const fmtK = v => (isNum(v) ? `€${formatNumber(Math.round(v))}k` : '—');

function pbBudget(ctx, f) {
  const c = f.ceiling;
  const eligible = listEligible(ctx.units, 'wozValue', { minPopulation: ctx.minPopulation });
  if (!isNum(c) || !eligible.length) return { title: 'WOZ en jouw budget', caption: '', body: null };
  const vals = eligible.map(a => a.values.wozValue);
  const within = vals.filter(v => v <= c).length;
  const hi = Math.max(c * 1.6, ...vals);
  return {
    title: 'WOZ en jouw budget',
    caption: `Gem. WOZ-waarde per ${ctx.unitOne}; gemarkeerd = de klasse van jouw budget (≈ €${formatNumber(Math.round(c))}k) · ${KERN}`,
    body: kpiHtml(`${formatNumber(within / vals.length * 100, 0)}%`, `van de ${ctx.unitWord} heeft een gem. WOZ binnen jouw budget`, `${within} van ${vals.length} · budget ≈ ${fmtK(c)}`)
      + histHtml(histogram(vals, { min: 0, max: hi, bins: 10 }), { mark: c, refMark: mean(eligible, 'wozValue'), fmtX: fmtK, unitWord: ctx.unitWord }),
  };
}

function pbWithin(ctx, f, pc) {
  const c = f.ceiling;
  if (!isNum(c)) return { title: 'Jouw matches binnen budget', caption: '', body: null };
  const all = listEligible(ctx.units, 'woonscore', { minPopulation: ctx.minPopulation })
    .sort((x, y) => y.values.woonscore - x.values.woonscore || String(x.name).localeCompare(String(y.name), 'nl'));
  const inBudget = all.filter(a => isNum(a.values.wozValue) && a.values.wozValue <= c).slice(0, 5).map(a => ({ code: a.code, name: a.name, value: a.values.wozValue }));
  const mine = pc.top.slice(0, 5).map(t => ({ code: t.code, name: t.name, value: t.area.values?.wozValue })).filter(r => isNum(r.value));
  if (!inBudget.length && !mine.length) return { title: 'Jouw matches binnen budget', caption: '', body: null };
  return {
    title: 'Jouw matches binnen budget',
    caption: `Links jouw beste ${ctx.unitWord} met een gem. WOZ tot ${fmtK(c)}, rechts jouw top 5 met hun WOZ · ${KERN}`,
    body: pairListHtml({ title: 'Binnen budget', rows: inBudget }, { title: 'Jouw top 5', rows: mine }, fmtOf('wozValue'), ctx.selected?.code),
  };
}

function pwBouw(ctx, f, pc) {
  const mineV = aggregateAreas(pc.top.map(t => t.area));
  const rows = [];
  if (bouwParts(mineV)) rows.push({ label: 'Jouw top 10', parts: bouwParts(mineV) });
  if (bouwParts(ctx.ref)) rows.push({ label: ctx.refName, parts: bouwParts(ctx.ref) });
  const want = f.bouw === 'karakter' ? 'oudere bouw met karakter' : f.bouw === 'modern' ? 'moderne woningen' : '';
  if (!rows.length) return { title: 'Bouwstijl van jouw matches', caption: '', body: ctx.bouwLoaded ? null : '<p class="dp-note">Bouwjaren laden…</p>' };
  return {
    title: 'Bouwstijl van jouw matches',
    caption: `Woningen naar bouwjaar${want ? `; jij koos ${want}` : ''} (geschat via postcode, CBS 2023)`,
    body: stackRowsHtml(rows, ['Voor 1945', '1945–2004', '2005 en later']),
  };
}

function pgNear(ctx, f, pc) {
  const key = f.metrics?.[0]?.key;
  const title = `${GEMEENSCHAP_LABEL}: ${f.groupLabel ?? ''}`.trim();
  if (!key || !ORIGIN_KEYS.includes(key)) return { title, caption: '', body: null };
  // Highest shares only: no lowest list, no ranking on absence (plan-woonscore §5).
  const top = listEligible(ctx.units, key, { minPopulation: ctx.minPopulation })
    .map(a => ({ code: a.code, name: a.name, value: a.values[key] }))
    .sort((x, y) => y.value - x.value || String(x.name).localeCompare(String(y.name), 'nl')).slice(0, 5);
  if (!top.length) return { title, caption: '', body: null };
  const mine = mean(pc.top.map(t => t.area), key);
  return {
    title,
    caption: `Waar jouw gekozen gemeenschap het sterkst aanwezig is (aandeel inwoners) · alleen als pluspunt, nooit op afwezigheid · CBS`,
    body: (isNum(mine) ? kpiHtml(fmtOf(key)(mine), 'gemiddeld in jouw top 10') : '') + rankList(top, fmtOf(key), 1, ctx.selected?.code),
  };
}

const signedPct = v => (isNum(v) ? `${v > 0 ? '+' : v < 0 ? '−' : '±'}${formatNumber(Math.abs(v), 1)}%` : '—');

/**
 * W23, replaces the Algemeen 'crime-rate' in the Veiligheid row (it showed only
 * the city without a selection): all registered crimes per 1.000 inwoners for
 * jouw top 10, the selected area and the city or Nederland, with the trend.
 * Works in both scopes (totalCrimes exists per wijk, buurt and gemeente).
 */
function pvTotal(ctx, _f, pc) {
  const title = 'Alle misdrijven';
  const rows = [];
  const top = (pc.top ?? []).map(t => t.area);
  const mineV = top.length ? aggregateAreas(top) : null;
  if (isNum(mineV?.crimeRate)) rows.push({ label: 'Jouw top 10', value: mineV.crimeRate, trend: mineV.crimeTrend, hl: true });
  const sel = ctx.selected;
  if (sel && isNum(sel.values?.crimeRate)) rows.push({ label: sel.name, value: sel.values.crimeRate, trend: sel.values.crimeTrend });
  if (isNum(ctx.ref?.crimeRate)) rows.push({ label: ctx.refName, value: ctx.ref.crimeRate, trend: ctx.ref.crimeTrend });
  if (rows.length < 2) return { title, caption: '', body: null };
  const fmt = v => formatNumber(v, 1);
  const lead = rows[0], ref = rows.at(-1);
  const trend = rows.filter(r => isNum(r.trend)).map(r => `${r.label} ${signedPct(r.trend)}`).join(' · ');
  return {
    title,
    caption: `per 1.000 inwoners · alle geregistreerde misdrijven, trend t.o.v. 2024 · ${CRIME_SRC}`,
    body: kpiHtml(fmt(lead.value), lead.label, `${ref.label}: ${fmt(ref.value)}`) + barRowsHtml(rows, fmt)
      + (trend ? `<p class="dp-note">Trend: ${esc(trend)}</p>` : ''),
  };
}

export const PERSONAL_PANELS = Object.freeze({
  'jw-top': jwTop, 'jw-shift': jwShift, 'jw-weights': jwWeights,
  'pf-match': pfMatch, 'pf-rank': pfRank, 'pf-hist': pfHist,
  'pb-budget': pbBudget, 'pb-within': pbWithin, 'pw-bouw': pwBouw, 'pg-near': pgNear,
  'pv-total': pvTotal,
});

/**
 * Spec + context → dashboardLayout()-shaped rows for boardHtml(). Personal
 * panels get (ctx, row.focus, pc); Algemeen ids reuse their builder. A panel
 * that throws or has no data gives body null (NA text); the grid never shrinks.
 * Panel ids are made unique per row (a row key prefix) for the DOM.
 */
export function personalLayout(ctx, spec, pc) {
  return spec.rows.map(row => ({
    key: `jouw-${row.key}`, title: row.title,
    panels: row.panels.map(id => {
      const build = PERSONAL_PANELS[id] ?? PANEL_BUILDERS[id];
      let p = null;
      try { p = PERSONAL_PANELS[id] ? build(ctx, row.focus ?? {}, pc) : build(ctx); } catch (err) { globalThis.console?.warn?.(`jouw dashboard panel ${id}:`, err); }
      return { id: `${row.key}-${id}`, title: p?.title ?? id, caption: p?.caption ?? '', body: p?.body ?? null };
    }),
  }));
}

/** The personal context for personalLayout(): top matches, Standaard scores, weights, answers. */
export function personalContext(ctx, { answers, std = new Map(), weights = [] } = {}) {
  return { top: topMatches(ctx), std, weights, answers };
}
