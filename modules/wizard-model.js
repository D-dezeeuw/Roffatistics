// "Vind jouw ideale woonplek" (docs/plan-woonscore.md §4, Epic W3): the
// wizard's answers, the preset they produce and their compact form in the URL
// hash (#score=…) and localStorage. Pure: no DOM. modules/wizard.js is the UI.
//
// Every step is optional; a skipped step leaves the Standaard weights alone,
// so the empty answers give exactly the Standaard preset.
//
// A step is one entry in STEPS plus one entry in APPLY (answers → preset
// changes) and one hash segment. Step 6 "Gemeenschap" (§5, Epic W4) is an
// opt-in, positive-only attraction to one CBS origin group: it can only add
// a `higher` factor on that group's share, never score any group down.
// v0.23.0 adds a detailed origin group for gemeenten (85458NED, see
// herkomst-gemeente.js), the opt-in step "Jouw situatie" (opleiding and, since
// v0.26.0, an income slider → positive "vergelijkbare situatie" factors) and a 5-step
// importance scale per theme (IMPORTANCE, hash segment `i`).
// v0.26.0: Gemeenschap is one detailed group (Nederland included, the broad
// groups are gone); nothing sensitive goes into a link unless the user ticks
// it in "Deellink maken" (shareableAnswers / shareableScore).
import { STANDAARD, GELIJK, THEME_LABELS, ORIGIN_KEYS } from './presets.js';
import { DETAIL_GROUPS } from './herkomst-gemeente.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export const STEPS = Object.freeze(['levensfase', 'budget', 'vervoer', 'sfeer', 'veiligheid', 'situatie', 'gemeenschap']);

/**
 * Old broad groups (hash letter after `g`, before v0.26.0). Only read, never
 * written: Nederland maps to the detailed group Nederland, Europa and Buiten
 * Europa to no group (a broad group is no longer offered).
 */
const OLD_BROAD = Object.freeze({ d: 'nederland', e: null, b: null });
/** Gemeenschap weight as a share (%) of the total weight: default modest, never above the cap. */
export const GEMEENSCHAP_DEFAULT_PCT = 10;
export const GEMEENSCHAP_MIN_PCT = 5;
export const GEMEENSCHAP_MAX_PCT = 30;
export const GEMEENSCHAP_LABEL = 'Nabijheid gemeenschap';
/** The groups of the step (herkomst-gemeente.js; Nederland first); re-exported for the UI. */
export { DETAIL_GROUPS };

/**
 * "Jouw situatie" (v0.23.0, opt-in; two sliders since v0.26.0): opleiding →
 * attraction to areas with more people of that level; huishoudinkomen →
 * closeness of the area's average standardised income to yours (a target),
 * and at the lowest stops bijstand per 1.000 as a plus. Positive-only, like
 * Gemeenschap. Slider order = object order; `code` is the stable hash code.
 * Keys laag/middelbaar/hoog and codes l/m/h are the v0.23.0 ones (old hashes
 * decode to the same metric); basisschool is new and also counts as lowEdu
 * (CBS groups basisonderwijs, vmbo and mbo-1 together).
 */
export const SITUATIE_EDU = Object.freeze({
  basis:      Object.freeze({ label: 'Basisschool',        short: 'basisschool',        key: 'lowEdu',  code: 'p' }),
  laag:       Object.freeze({ label: 'vmbo – mbo-1',       short: 'vmbo–mbo-1',         key: 'lowEdu',  code: 'l' }),
  middelbaar: Object.freeze({ label: 'havo – vwo – mbo-4', short: 'havo–vwo–mbo-4',     key: 'medEdu',  code: 'm' }),
  hoog:       Object.freeze({ label: 'hbo – wo',           short: 'hbo–wo',             key: 'highEdu', code: 'h' }),
});
/**
 * Huishoudinkomen per maand (netto, ongeveer) → a target on avgIncome, the CBS
 * "gemiddeld gestandaardiseerd inkomen" in ×€1.000 per year. Rough rule:
 * yearly standardised ≈ monthly × 12 / INCOME_EQUIV_FACTOR / 1000, where 1.3
 * is about the equivalence factor of an average household (CBS divides
 * household income by it). The ideal is clamped to INCOME_IDEAL_MIN–MAX, the
 * range of area averages (1st–99th percentile of buurten ≈ 25–99), so the
 * low and high stops still rank areas instead of scoring all of them 0.
 * `welfare`: the stop also counts bijstand per 1.000 inwoners as a plus.
 * `code`: the stable hash digit.
 */
export const SITUATIE_INCOME = Object.freeze({
  bijstand: Object.freeze({ label: 'Bijstand',           short: 'bijstand',      monthly: 1400,  code: '0', welfare: true }),
  m500:     Object.freeze({ label: '± € 500',            short: '± €500/mnd',    monthly: 500,   code: '1', welfare: true }),
  m2500:    Object.freeze({ label: '± € 2.500',          short: '± €2.500/mnd',  monthly: 2500,  code: '2' }),
  m5000:    Object.freeze({ label: '± € 5.000',          short: '± €5.000/mnd',  monthly: 5000,  code: '3' }),
  m7500:    Object.freeze({ label: '± € 7.500',          short: '± €7.500/mnd',  monthly: 7500,  code: '4' }),
  m10000:   Object.freeze({ label: '± € 10.000',         short: '± €10.000/mnd', monthly: 10000, code: '5' }),
  m15000:   Object.freeze({ label: '± € 15.000',         short: '± €15.000/mnd', monthly: 15000, code: '6' }),
  m30000:   Object.freeze({ label: '± € 30.000',         short: '± €30.000/mnd', monthly: 30000, code: '7' }),
  hoger:    Object.freeze({ label: 'Meer dan € 30.000',  short: '> €30.000/mnd', monthly: 45000, code: '8' }),
});
export const INCOME_EQUIV_FACTOR = 1.3;
export const INCOME_IDEAL_MIN = 22;
export const INCOME_IDEAL_MAX = 120;
/** Tolerance in log1p units: the factor is 1 at the ideal and 0 beyond ±0.6 (about ×/÷ 1.8). */
export const INCOME_TOLERANCE_LOG = 0.3;
/** Monthly net household income (€) → yearly standardised income (×€1.000), unclamped. */
export const monthlyToStandardisedK = monthly => (monthly * 12) / INCOME_EQUIV_FACTOR / 1000;
/** The avgIncome target of an income band, or null for an unknown band. */
export function incomeTarget(band) {
  const b = SITUATIE_INCOME[band];
  if (!b) return null;
  const ideal = Math.round(clamp(monthlyToStandardisedK(b.monthly), INCOME_IDEAL_MIN, INCOME_IDEAL_MAX) * 10) / 10;
  return { ideal, tolerance: INCOME_TOLERANCE_LOG, log: true };
}
export const SITUATIE_LABEL = 'Mensen in een vergelijkbare situatie';
/** The metrics the Situatie theme may hold as `higher`; avgIncome only as the income target. */
export const SITUATIE_KEYS = Object.freeze(['lowEdu', 'medEdu', 'highEdu', 'welfarePer1000']);
export const SITUATIE_TARGET_KEY = 'avgIncome';

/**
 * The 5-step importance scale per theme: level 0–4 → factor × the theme
 * weight the answers give (Standaard weight for the five base themes).
 * 0 = "Niet belangrijk" drops the theme.
 */
export const IMPORTANCE = Object.freeze([
  Object.freeze({ label: 'Niet belangrijk', factor: 0 }),
  Object.freeze({ label: 'Beetje',          factor: 0.5 }),
  Object.freeze({ label: 'Gemiddeld',       factor: 1 }),
  Object.freeze({ label: 'Belangrijk',      factor: 1.5 }),
  Object.freeze({ label: 'Heel belangrijk', factor: 2 }),
]);
export const IMPORTANCE_DEFAULT = 2;
/** Gemeenschap keeps its weight as % of the total: importance level → pct (0 = off). */
export const GEMEENSCHAP_LEVEL_PCT = Object.freeze([0, 5, 10, 20, 30]);
const nearest = (list, v) => list.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(list[best] - v) ? i : best), 0);
/** Importance level for a weight ratio (weight / base weight). */
export function importanceFromRatio(r) { return isNum(r) ? nearest(IMPORTANCE.map(l => l.factor), r) : IMPORTANCE_DEFAULT; }
/** Importance level (1–4) of a Gemeenschap pct. */
export function gemeenschapLevel(pct) { return Math.max(1, nearest(GEMEENSCHAP_LEVEL_PCT, pct)); }

export const LEVENSFASEN = Object.freeze({
  student: 'Student of starter',
  stel:    'Stel',
  gezin:   'Gezin met kinderen',
  '50plus': '50-plusser',
  senior:  'Senior',
});
export const OUD_OPTIONS = Object.freeze({ bewoners: 'Jonge bewoners', gebouwen: 'Nieuwe woningen' });
export const VERVOER = Object.freeze({ fiets: 'Fiets', ov: 'OV', auto: 'Auto', lopen: 'Lopen' });
/** Veiligheid chips → crime dataset. */
export const CRIMES = Object.freeze({
  inbraak:   { label: 'Inbraak',         key: 'crimeBurglary' },
  geweld:    { label: 'Geweld',          key: 'crimeViolence' },
  straatroof:{ label: 'Straatroof',      key: 'crimeStreetRobbery' },
  fiets:     { label: 'Fietsendiefstal', key: 'crimeBike' },
  auto:      { label: 'Autodiefstal',    key: 'crimeVehicle' },
  vandalisme:{ label: 'Vandalisme',      key: 'crimeVandalism' },
  drugs:     { label: 'Drugsoverlast',   key: 'crimeDrugs' },
});

/** Rough rule shown in the UI: a mortgage of about 4.5 × the gross household income. */
export const INCOME_FACTOR = 4.5;
/** WOZ target around the budget: ideal = 0.85 × ceiling, sd = 0.3 × ceiling (0 below 0.25× and above 1.45×). */
export const WOZ_IDEAL_SHARE = 0.85;
export const WOZ_TOLERANCE_SHARE = 0.3;
/** "Verberg duidelijk te duur": WOZ above 1.2 × the ceiling. */
export const TOO_EXPENSIVE_SHARE = 1.2;

/** Extra themes (weight) the steps can add next to Standaard's five. */
export const EXTRA_THEME_WEIGHTS = Object.freeze({ leeftijd: 15, nieuwbouw: 10, budget: 20, sfeer: 20, situatie: 15 });
/** Sfeer theme weight when only "auto" asks for a quieter area. */
export const AUTO_SFEER_WEIGHT = 8;
/** Share inside a theme for a metric the answers stress (Standaard metrics have 1). */
export const STRESS_W = 3;

export const EMPTY_ANSWERS = Object.freeze({
  levensfase: null, oud: null, budget: null, vervoer: Object.freeze([]), sfeer: null, veiligheid: Object.freeze([]), weights: Object.freeze({}),
  gemeenschap: null, situatie: null, importance: Object.freeze({}),
});

/**
 * { detail, pct } or null. Anything that is not one known group with a
 * positive weight is dropped (null = off, "Geen specifieke groep"); the weight
 * is clamped to GEMEENSCHAP_MIN_PCT–GEMEENSCHAP_MAX_PCT, so a zero, negative or
 * huge weight can never come through. There is no direction field: the factor
 * is `higher`. An old broad `group: 'nederland'` becomes the group Nederland;
 * the old broad Europa / Buiten Europa give no group.
 */
export function normalizeGemeenschap(g) {
  if (!g || typeof g !== 'object') return null;
  const detail = Object.hasOwn(DETAIL_GROUPS, g.detail) ? g.detail : g.group === 'nederland' ? 'nederland' : null;
  if (!detail) return null;
  const raw = g.pct == null ? GEMEENSCHAP_DEFAULT_PCT : g.pct;
  if (!isNum(raw) || raw <= 0) return null;
  return { detail, pct: Math.round(clamp(raw, GEMEENSCHAP_MIN_PCT, GEMEENSCHAP_MAX_PCT)) };
}

/**
 * { edu, income } or null (nothing chosen). Only known level and band
 * keys. The v0.23.0 field `bijstand: true` (no longer in the model) becomes
 * the income band "bijstand" when no band is set.
 */
export function normalizeSituatie(s) {
  if (!s || typeof s !== 'object') return null;
  const edu = Object.hasOwn(SITUATIE_EDU, s.edu) ? s.edu : null;
  const income = Object.hasOwn(SITUATIE_INCOME, s.income) ? s.income : s.bijstand === true ? 'bijstand' : null;
  if (!edu && !income) return null;
  return { edu, income };
}

/** Cleans any answers-like object into the canonical shape (unknown values dropped). */
export function normalizeAnswers(a = {}) {
  const pick = (list, allowed) => [...new Set((Array.isArray(list) ? list : []).filter(v => Object.hasOwn(allowed, v)))].sort((x, y) => Object.keys(allowed).indexOf(x) - Object.keys(allowed).indexOf(y));
  const b = a?.budget;
  let budget = null;
  if (b && (b.mode === 'huur' || b.mode === 'koop')) {
    const income = isNum(b.income) && b.income > 0 ? Math.round(clamp(b.income, 1, 999)) : null;
    const maxPrice = isNum(b.maxPrice) && b.maxPrice > 0 ? Math.round(clamp(b.maxPrice, 1, 9999)) : null;
    budget = { mode: b.mode, income, maxPrice, hide: !!b.hide && b.mode === 'koop' && (income != null || maxPrice != null) };
  }
  const weights = {};
  for (const [k, v] of Object.entries(a?.weights ?? {})) if (Object.hasOwn(THEME_LABELS, k) && k !== 'gemeenschap' && isNum(v)) weights[k] = Math.round(clamp(v, 0, 100));
  const importance = {};
  for (const [k, v] of Object.entries(a?.importance ?? {})) if (Object.hasOwn(THEME_LABELS, k) && k !== 'gemeenschap' && isNum(v)) importance[k] = Math.round(clamp(v, 0, IMPORTANCE.length - 1));
  return {
    levensfase: Object.hasOwn(LEVENSFASEN, a?.levensfase) ? a.levensfase : null,
    oud: Object.hasOwn(OUD_OPTIONS, a?.oud) ? a.oud : null,
    budget,
    vervoer: pick(a?.vervoer, VERVOER),
    sfeer: isNum(a?.sfeer) ? Math.round(clamp(a.sfeer, 0, 100)) : null,
    veiligheid: pick(a?.veiligheid, CRIMES),
    weights,
    gemeenschap: normalizeGemeenschap(a?.gemeenschap),
    situatie: normalizeSituatie(a?.situatie),
    importance,
  };
}

/** True when no step was answered and no theme weight was moved (= Standaard). */
export function isEmptyAnswers(a) {
  const n = normalizeAnswers(a);
  return !n.levensfase && !n.oud && !n.budget && !n.vervoer.length && n.sfeer == null && !n.veiligheid.length && !Object.keys(n.weights).length && !n.gemeenschap && !n.situatie && !Object.keys(n.importance).length;
}

/** Koop budget ceiling in ×€1.000 (the WOZ unit): max price, else income × 4.5; null otherwise. */
export function budgetCeiling(budget) {
  if (!budget || budget.mode !== 'koop') return null;
  if (isNum(budget.maxPrice) && budget.maxPrice > 0) return budget.maxPrice;
  if (isNum(budget.income) && budget.income > 0) return budget.income * INCOME_FACTOR;
  return null;
}

/**
 * A typed amount in euros → ×€1.000 (the WOZ and income unit), or null.
 * Dots, spaces and '€' are ignored ("60.000", "€ 350 000"); a value below
 * 1.000 is read as already in thousands ("60" → 60). A comma ends the number.
 */
export function parseEuroK(text) {
  const digits = String(text ?? '').split(',')[0].replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  if (!(n > 0)) return null;
  return n >= 1000 ? Math.round(n / 1000) : n;
}

// ── answers → preset ─────────────────────────────────────────────────────────

/** Working copy of a preset: themes keyed, metrics keyed, mutable. */
function draft() {
  const themes = new Map(STANDAARD.themes.map(t => [t.key, { key: t.key, label: t.label, weight: t.weight, metrics: new Map(t.metrics.map(m => [m.key, { key: m.key, pref: m.pref }])) }]));
  return { themes, targets: {}, filters: [] };
}
function theme(d, key, weight) {
  if (!d.themes.has(key)) d.themes.set(key, { key, label: THEME_LABELS[key] ?? key, weight, metrics: new Map() });
  return d.themes.get(key);
}
/** Adds or stresses a metric in a theme; `w` only ever goes up (two reasons do not multiply). */
function metric(d, themeKey, key, pref, w = 1, themeWeight = 0) {
  const t = theme(d, themeKey, themeWeight);
  const m = t.metrics.get(key);
  if (m) { m.pref = pref; if (w > (m.w ?? 1)) m.w = w; }
  else t.metrics.set(key, w === 1 ? { key, pref } : { key, pref, w });
}

const LIFE_METRICS = {
  student:  [['pop15to24', 2], ['pop25to44', 1]],
  stel:     [['pop25to44', 1]],
  gezin:    [['hhWithKidsPct', 1]],
  '50plus': [['pop45to64', 1]],
  senior:   [['pop65plus', 1]],
};

/** Step appliers, in STEPS order. Each mutates the draft from normalised answers. */
export const APPLY = Object.freeze({
  levensfase(d, a) {
    const L = EXTRA_THEME_WEIGHTS.leeftijd;
    if (a.levensfase) for (const [key, w] of LIFE_METRICS[a.levensfase]) metric(d, 'leeftijd', key, 'higher', w, L);
    if (a.levensfase === 'gezin') { metric(d, 'voorzieningen', 'distSchool', 'lower', STRESS_W); metric(d, 'voorzieningen', 'distKinderopvang', 'lower', STRESS_W); }
    if (a.levensfase === 'senior') { metric(d, 'voorzieningen', 'distGP', 'lower', STRESS_W); metric(d, 'voorzieningen', 'distSupermarket', 'lower', 2); }
    // "Geen oude buurt": the people (fewer 65+) or the buildings (more nieuwbouw).
    if (a.oud === 'bewoners' && a.levensfase !== 'senior' && a.levensfase !== '50plus') metric(d, 'leeftijd', 'pop65plus', 'lower', 1, L);
    if (a.oud === 'gebouwen') metric(d, 'nieuwbouw', 'newBuildPct', 'higher', 1, EXTRA_THEME_WEIGHTS.nieuwbouw);
  },
  budget(d, a) {
    const b = a.budget;
    if (!b) return;
    const woning = theme(d, 'woningmarkt', 10);
    if (b.mode === 'huur') { woning.metrics.delete('ownerOccupiedPct'); metric(d, 'woningmarkt', 'rentalPct', 'higher'); return; }
    const ceiling = budgetCeiling(b);
    if (ceiling == null) return;
    metric(d, 'budget', 'wozValue', 'target', 1, EXTRA_THEME_WEIGHTS.budget);
    d.targets.wozValue = { ideal: ceiling * WOZ_IDEAL_SHARE, tolerance: ceiling * WOZ_TOLERANCE_SHARE };
    if (b.hide) d.filters.push({ key: 'wozValue', max: ceiling * TOO_EXPENSIVE_SHARE });
  },
  vervoer(d, a) {
    const v = new Set(a.vervoer);
    if (v.has('fiets')) metric(d, 'veiligheid', 'crimeBike', 'lower', STRESS_W);
    if (v.has('ov')) metric(d, 'voorzieningen', 'distStation', 'lower', STRESS_W);
    if (v.has('lopen')) { metric(d, 'voorzieningen', 'distSupermarket', 'lower', 2); metric(d, 'voorzieningen', 'distGP', 'lower', 2); }
    if (v.has('auto')) {
      metric(d, 'veiligheid', 'crimeVehicle', 'lower', 2);
      // Lower density preferred: shifts the Sfeer slider toward rustig, or adds a light "lower" factor.
      if (a.sfeer == null) metric(d, 'sfeer', 'density', 'lower', 1, AUTO_SFEER_WEIGHT);
    }
  },
  sfeer(d, a) {
    if (a.sfeer == null) return;
    const s = clamp(a.sfeer + (a.vervoer.includes('auto') ? 15 : 0), 0, 100) / 100;   // 0 = midden in de drukte, 1 = rustig
    const S = EXTRA_THEME_WEIGHTS.sfeer;
    metric(d, 'sfeer', 'density', 'target', 2, S);
    metric(d, 'sfeer', 'distCentrum', 'target', 1, S);
    d.targets.density = { quantile: clamp(1 - s, 0.05, 0.95) };
    d.targets.distCentrum = { quantile: clamp(s, 0.05, 0.95) };
    if (s <= 0.35) metric(d, 'sfeer', 'horeca1km', 'higher', 1, S);   // uitgaan nearby at the busy end
  },
  veiligheid(d, a) {
    for (const c of a.veiligheid) metric(d, 'veiligheid', CRIMES[c].key, 'lower', STRESS_W);
  },
  // Positive-only "mensen in een vergelijkbare situatie". An opleidingsniveau
  // replaces the Standaard Opleiding theme (more hbo/wo = plus would work
  // against a lower level and double hbo–wo). An income band replaces
  // Welvaart's "more income = plus" with a target around the band (the target
  // key applies to every theme, so avgIncome must leave Welvaart); the lowest
  // stops also move welfarePer1000 out of Welvaart (no minus) into this theme
  // as a plus. A Welvaart theme left without metrics is dropped.
  situatie(d, a) {
    const s = a.situatie;
    if (!s) return;
    const t = theme(d, 'situatie', EXTRA_THEME_WEIGHTS.situatie);
    if (s.edu) {
      const e = SITUATIE_EDU[s.edu];
      d.themes.delete('opleiding');
      t.metrics.set(e.key, { key: e.key, pref: 'higher', label: `${SITUATIE_LABEL} (opleiding ${e.short})` });
    }
    if (s.income) {
      const b = SITUATIE_INCOME[s.income];
      const welvaart = d.themes.get('welvaart');
      welvaart?.metrics.delete('avgIncome');
      t.metrics.set(SITUATIE_TARGET_KEY, { key: SITUATIE_TARGET_KEY, pref: 'target', label: `${SITUATIE_LABEL} (inkomen ${b.short})` });
      d.targets[SITUATIE_TARGET_KEY] = incomeTarget(s.income);
      if (b.welfare) {
        welvaart?.metrics.delete('welfarePer1000');
        t.metrics.set('welfarePer1000', { key: 'welfarePer1000', pref: 'higher', label: `${SITUATIE_LABEL} (${b.short})` });
      }
      if (welvaart && !welvaart.metrics.size) d.themes.delete('welvaart');
    }
  },
  // Runs last (after the slider overrides): its weight is a share of the total.
  // One metric, the chosen group's share, `higher`; nothing else ever touches origin.
  gemeenschap(d, a) {
    const g = a.gemeenschap;
    if (!g) return;
    const others = [...d.themes.values()].reduce((s, t) => s + (t.key !== 'gemeenschap' && t.weight > 0 && t.metrics.size ? t.weight : 0), 0);
    if (!(others > 0)) return;
    const det = DETAIL_GROUPS[g.detail];
    if (!det) return;
    // One metric. Nederland: kerncijfers share per gemeente, wijk and buurt. Other groups: gemeenten
    // (85458NED); per wijk/buurt only the groups herkomst-pc4.js estimates via postcode
    // (DETAIL_GROUPS[…].wijk); for the others the factor has no data there and is skipped.
    const metrics = new Map([[det.key, { key: det.key, pref: 'higher', label: `${GEMEENSCHAP_LABEL} (${det.label})` }]]);
    d.themes.set('gemeenschap', {
      key: 'gemeenschap', label: GEMEENSCHAP_LABEL,
      weight: Math.round((others * g.pct / (100 - g.pct)) * 10) / 10,
      metrics,
    });
  },
});

/** Theme weights the answers produce before any slider override: { theme: weight }. */
export function themeWeights(answers) {
  return Object.fromEntries(answersToPreset({ ...normalizeAnswers(answers), weights: {}, importance: {} }).themes.map(t => [t.key, t.weight]));
}

/**
 * Importance level (0–4) per theme of the answers' preset, Gemeenschap excluded:
 * the chosen level, else the nearest level to (old absolute weight / base weight).
 */
export function themeImportance(answers) {
  const a = normalizeAnswers(answers);
  const base = themeWeights(a);
  const out = {};
  for (const t of answersToPreset(a).themes) {
    if (t.key === 'gemeenschap') continue;
    out[t.key] = a.importance[t.key] ?? (base[t.key] > 0 ? importanceFromRatio(t.weight / base[t.key]) : IMPORTANCE_DEFAULT);
  }
  return out;
}

/**
 * The custom preset for `answers`: Standaard's themes with the steps applied,
 * then the slider overrides (answers.weights, 0–100 per theme). The empty
 * answers give Standaard's themes, targets and filters unchanged.
 */
export function answersToPreset(answers) {
  const a = normalizeAnswers(answers);
  const d = draft();
  for (const step of STEPS) if (step !== 'gemeenschap') APPLY[step]?.(d, a);
  const base = new Map([...d.themes].map(([k, t]) => [k, t.weight]));
  for (const [k, w] of Object.entries(a.weights)) if (d.themes.has(k)) d.themes.get(k).weight = w;
  // The 5-step scale (v0.23.0) wins over an old absolute weight for the same theme.
  for (const [k, lvl] of Object.entries(a.importance)) if (d.themes.has(k)) d.themes.get(k).weight = Math.round(base.get(k) * IMPORTANCE[lvl].factor * 10) / 10;
  APPLY.gemeenschap(d, a);
  return guardOrigin({
    id: 'jouwscore', label: 'Jouw score',
    themes: [...d.themes.values()].map(t => ({ key: t.key, label: t.label, weight: t.weight, metrics: [...t.metrics.values()] })),
    targets: d.targets, filters: d.filters,
    shrink: STANDAARD.shrink, minCoverage: STANDAARD.minCoverage,
  });
}

/**
 * §5 guard: in a preset, an origin metric may only appear as `higher` with a
 * positive weight inside the Gemeenschap theme, and never with a target or
 * filter. Anything else that names an origin metric is removed. Applied to
 * every preset the answers or the hash produce (presets.js resolvePreset
 * enforces the same at scoring time).
 */
export function guardOrigin(preset) {
  // Same for "Jouw situatie": inside that theme only SITUATIE_KEYS as `higher`
  // and avgIncome only as a target with a valid { ideal, tolerance }; outside it
  // no low/middle-education factor, bijstand only as Standaard's minus, and no
  // avgIncome while the income target exists (it would turn that metric into a target).
  const it = preset.targets?.[SITUATIE_TARGET_KEY];
  const incomeTargetOk = isNum(it?.ideal) && isNum(it?.tolerance) && it.tolerance > 0;
  const situatieOk = (t, m) => t.key === 'situatie'
    ? ((SITUATIE_KEYS.includes(m.key) && m.pref === 'higher') || (m.key === SITUATIE_TARGET_KEY && m.pref === 'target' && incomeTargetOk)) && !(m.w <= 0)
    : !['lowEdu', 'medEdu'].includes(m.key) && (m.key !== 'welfarePer1000' || m.pref === 'lower') && !(m.key === SITUATIE_TARGET_KEY && it);
  const themes = (preset.themes ?? []).map(t => ({
    ...t,
    metrics: t.metrics.filter(m => (!ORIGIN_KEYS.includes(m.key) || (t.key === 'gemeenschap' && m.pref === 'higher' && t.weight > 0 && !(m.w <= 0))) && situatieOk(t, m)),
  })).filter(t => (t.key !== 'gemeenschap' && t.key !== 'situatie') || t.metrics.length);
  const guarded = [...ORIGIN_KEYS, 'lowEdu', 'medEdu'];
  const targets = Object.fromEntries(Object.entries(preset.targets ?? {}).filter(([k]) => !guarded.includes(k)));
  const filters = (preset.filters ?? []).filter(f => !guarded.includes(f.key));
  return { ...preset, themes, targets, filters };
}

// ── hash / storage form ──────────────────────────────────────────────────────
// '.'-separated segments, each led by one letter; only [a-z0-9.] so the
// value survives URLSearchParams unescaped. Unknown segments are ignored.
// 'gelijk' / 'standaard' name a fixed preset.
//   l<s|p|g|v|r>        levensfase      o<b|g>          oud = bewoners/gebouwen
//   b<h|k>[i<n>][p<n>][x] budget        v<f|o|a|l>…     vervoer
//   s<0-100>            sfeer           c<in|gw|…>…     veiligheid chips
//   w<theme letter><n>… slider weights
//   gh<cc><5-30>        gemeenschap: two-letter group code (herkomst-gemeente.js,
//                       nl = Nederland), weight in % of the total. No sign, no
//                       direction: the format cannot express scoring a group down.
//                       Old forms still read: g<d|e|b>[h<cc>]<n>[x] (broad d =
//                       Nederland, e/b = no group; a detailed group wins) and the
//                       old share flag x, which is ignored.
//   j[p|l|m|h][0-8]     Jouw situatie: opleiding basisschool/vmbo–mbo-1/havo–vwo–mbo-4/
//                       hbo–wo, then the income band digit (SITUATIE_INCOME code,
//                       0 = bijstand). v0.23.0 segments j[l|m|h][b] still decode:
//                       b = income band bijstand. An old trailing x is ignored.
// What goes into a link is decided by shareableAnswers(): by default no
// Gemeenschap, opleiding or inkomen.
//   i<theme letter><0-4>…  importance level per theme (5-step scale); wins over w.

const LF = { student: 's', stel: 'p', gezin: 'g', '50plus': 'v', senior: 'r' };
const OUD = { bewoners: 'b', gebouwen: 'g' };
const VV = { fiets: 'f', ov: 'o', auto: 'a', lopen: 'l' };
const CR = { inbraak: 'in', geweld: 'gw', straatroof: 'sr', fiets: 'fd', auto: 'ad', vandalisme: 'vd', drugs: 'dr' };
const TH = { veiligheid: 'v', welvaart: 'e', voorzieningen: 'z', opleiding: 'o', woningmarkt: 'm', leeftijd: 'l', nieuwbouw: 'n', budget: 'b', sfeer: 's', situatie: 't' };
const inv = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const ED = Object.fromEntries(Object.entries(SITUATIE_EDU).map(([k, e]) => [k, e.code]));
const INC = Object.fromEntries(Object.entries(SITUATIE_INCOME).map(([k, b]) => [k, b.code]));
const DG = Object.fromEntries(Object.entries(DETAIL_GROUPS).map(([k, d]) => [k, d.code]));
const LF_ = inv(LF), OUD_ = inv(OUD), VV_ = inv(VV), CR_ = inv(CR), TH_ = inv(TH), ED_ = inv(ED), INC_ = inv(INC), DG_ = inv(DG);

export const SCORE_RE = /^[a-z0-9.]{1,200}$/;
export const FIXED_PRESETS = Object.freeze(['standaard', 'gelijk']);

/** Answers → compact string ('' for the empty answers). */
export function encodeAnswers(answers) {
  const a = normalizeAnswers(answers);
  const seg = [];
  if (a.levensfase) seg.push(`l${LF[a.levensfase]}`);
  if (a.oud) seg.push(`o${OUD[a.oud]}`);
  if (a.budget) seg.push(`b${a.budget.mode === 'huur' ? 'h' : 'k'}${a.budget.income != null ? `i${a.budget.income}` : ''}${a.budget.maxPrice != null ? `p${a.budget.maxPrice}` : ''}${a.budget.hide ? 'x' : ''}`);
  if (a.vervoer.length) seg.push(`v${a.vervoer.map(v => VV[v]).join('')}`);
  if (a.sfeer != null) seg.push(`s${a.sfeer}`);
  if (a.veiligheid.length) seg.push(`c${a.veiligheid.map(c => CR[c]).join('')}`);
  const w = Object.keys(TH).filter(k => k in a.weights).map(k => `${TH[k]}${a.weights[k]}`).join('');
  if (w) seg.push(`w${w}`);
  const imp = Object.keys(TH).filter(k => k in a.importance).map(k => `${TH[k]}${a.importance[k]}`).join('');
  if (imp) seg.push(`i${imp}`);
  if (a.situatie) seg.push(`j${a.situatie.edu ? ED[a.situatie.edu] : ''}${a.situatie.income ? INC[a.situatie.income] : ''}`);
  if (a.gemeenschap) seg.push(`gh${DG[a.gemeenschap.detail]}${a.gemeenschap.pct}`);
  return seg.join('.');
}

/** Compact string → normalised answers; anything unreadable is dropped, never throws. */
export function decodeAnswers(str) {
  const out = { ...EMPTY_ANSWERS, vervoer: [], veiligheid: [], weights: {}, importance: {} };
  if (typeof str !== 'string' || !SCORE_RE.test(str) || FIXED_PRESETS.includes(str)) return normalizeAnswers(out);
  for (const s of str.split('.')) {
    const head = s[0], body = s.slice(1);
    if (head === 'l') out.levensfase = LF_[body] ?? null;
    else if (head === 'o') out.oud = OUD_[body] ?? null;
    else if (head === 'b') {
      const m = /^([hk])(?:i(\d{1,3}))?(?:p(\d{1,4}))?(x?)$/.exec(body);
      if (m) out.budget = { mode: m[1] === 'h' ? 'huur' : 'koop', income: m[2] ? +m[2] : null, maxPrice: m[3] ? +m[3] : null, hide: m[4] === 'x' };
    } else if (head === 'v') out.vervoer = [...body].map(c => VV_[c]).filter(Boolean);
    else if (head === 's' && /^\d{1,3}$/.test(body)) out.sfeer = +body;
    else if (head === 'c') out.veiligheid = (body.match(/../g) ?? []).map(c => CR_[c]).filter(Boolean);
    else if (head === 'w') for (const [, t, n] of body.matchAll(/([a-z])(\d{1,3})/g)) { if (TH_[t]) out.weights[TH_[t]] = +n; }
    else if (head === 'i') for (const [, t, n] of body.matchAll(/([a-z])([0-4])/g)) { if (TH_[t]) out.importance[TH_[t]] = +n; }
    else if (head === 'j') {
      // Current form: [edu][income digit]; v0.23.0 form: [l|m|h][b] (b = bijstand). Never both. An old x is ignored.
      const m = /^([plmh])?(?:([0-8])|(b))?(x?)$/.exec(body);
      if (m && (m[1] || m[2] || m[3])) out.situatie = { edu: m[1] ? ED_[m[1]] : null, income: m[2] ? INC_[m[2]] : m[3] ? 'bijstand' : null };
    } else if (head === 'g') {
      // Only "[old broad letter][h code] + positive weight [+ old x]"; any other shape (or an unknown letter
      // or code) is dropped whole. The old broad Nederland becomes the group Nederland; Europa / Buiten
      // Europa alone give no group; a detailed code wins over a broad letter.
      const m = /^([a-z])?(?:h([a-z]{2}))?(\d{1,3})(x?)$/.exec(body);
      const broadOk = m?.[1] ? Object.hasOwn(OLD_BROAD, m[1]) : true, detail = m?.[2] ? DG_[m[2]] : null;
      const pick = detail ?? (m?.[1] ? OLD_BROAD[m[1]] : null);
      if (m && broadOk && (m[2] ? detail : true) && pick && +m[3] > 0) out.gemeenschap = { detail: pick, pct: +m[3] };
    }
  }
  return normalizeAnswers(out);
}

// ── sharing (v0.26.0, "Deellink maken") ──────────────────────────────────────

/** The sensitive parts a link may carry, all left out by default. */
export const SHARE_PARTS = Object.freeze({
  origin:    'Herkomst/gemeenschap',
  education: 'Opleiding',
  income:    'Inkomen',
});
export const SHARE_NONE = Object.freeze({ origin: false, education: false, income: false });
const SHARE_COMBOS = [false, true].flatMap(origin => [false, true].flatMap(education => [false, true].map(income => ({ origin, education, income }))));

/**
 * A copy of `answers` with the sensitive parts the user did not tick removed:
 * `gemeenschap` (origin), `situatie.edu` (education), `situatie.income` and
 * `situatie.bijstand` (income); `situatie` is dropped when nothing is left.
 * Does not normalise, so a situatie field this module does not know survives.
 * localStorage always keeps the full answers; this is only for links.
 */
export function shareableAnswers(answers, { origin = false, education = false, income = false } = {}) {
  const a = { ...(answers ?? {}) };
  if (!origin) a.gemeenschap = null;
  if (a.situatie && typeof a.situatie === 'object') {
    const s = { ...a.situatie };
    delete s.share;
    if (!education) delete s.edu;
    if (!income) { delete s.income; delete s.bijstand; }
    a.situatie = Object.values(s).some(v => v != null && v !== false) ? s : null;
  } else a.situatie = null;
  return a;
}

/**
 * The `score` value as it may go into a URL with the given share choices
 * (default: no sensitive part). 'standaard' / 'gelijk' pass unchanged; null
 * when nothing is left or the value is unreadable.
 */
export function shareableScore(score, opts = SHARE_NONE) {
  if (typeof score !== 'string' || !score) return null;
  if (FIXED_PRESETS.includes(score)) return score;
  if (!SCORE_RE.test(score)) return null;
  return encodeAnswers(shareableAnswers(decodeAnswers(score), opts)) || null;
}

/** True when `urlScore` is what some link of `fullScore` carries (the same answers, sensitive parts left out or not). */
export function isShareOf(urlScore, fullScore) {
  if (!fullScore) return false;
  return SHARE_COMBOS.some(o => shareableScore(fullScore, o) === (urlScore || null));
}

/**
 * The score to use on load: when the URL score is a shared form of the
 * locally stored score (same answers, sensitive parts left out), the stored
 * one wins so the local choices survive a reload.
 */
export function restoreLocalScore(urlScore, storedScore) {
  if (!storedScore || storedScore === urlScore) return urlScore ?? storedScore ?? null;
  return isShareOf(urlScore, storedScore) ? storedScore : urlScore ?? null;
}

/**
 * The `score` hash value → the preset the Jouw score layer uses:
 * null/'' / 'standaard' → Standaard, 'gelijk' → Gelijk gewogen, else the
 * decoded answers' preset.
 */
export function presetFromScore(score) {
  if (!score || score === 'standaard') return STANDAARD;
  if (score === 'gelijk') return GELIJK;
  return answersToPreset(decodeAnswers(score));
}

/** Which switcher option a `score` value means: 'standaard' | 'gelijk' | 'custom'. */
export function scoreKind(score) {
  if (!score || score === 'standaard') return 'standaard';
  return score === 'gelijk' ? 'gelijk' : 'custom';
}

/** Name of the Woonscore for a `score` value: 'Woonscore', 'Woonscore · gelijk gewogen' or 'Woonscore · jouw wensen'. */
export function scoreLabel(score) {
  const kind = scoreKind(score);
  return kind === 'custom' ? 'Woonscore · jouw wensen' : kind === 'gelijk' ? 'Woonscore · gelijk gewogen' : 'Woonscore';
}

/** Legend / Ranglijst title of the Woonscore layer: the Standaard title, or the personalised name with its range. */
export function scoreTitle(score, standaardTitle = 'Woonscore (0–100, t.o.v. gelijke gebieden)') {
  return scoreKind(score) === 'standaard' ? standaardTitle : `${scoreLabel(score)} (0–100)`;
}

// ── localStorage (last custom answers; the active `score` lives in state.js) ──

export const ANSWERS_STORAGE_KEY = 'roffatistics.scoreAnswers';

export function loadAnswers(storage) {
  try { const s = storage?.getItem(ANSWERS_STORAGE_KEY); return s ? decodeAnswers(s) : null; } catch { return null; }
}
export function saveAnswers(storage, answers) {
  try {
    const s = encodeAnswers(answers);
    if (s) storage?.setItem(ANSWERS_STORAGE_KEY, s); else storage?.removeItem(ANSWERS_STORAGE_KEY);
  } catch { /* storage blocked: the hash still carries the answers */ }
}

// ── result helpers ───────────────────────────────────────────────────────────

/**
 * Top `n` of scored items ({ code, name, score, filtered? }) by score, ties by
 * name; filtered and unscored items are left out. Adds `rank` (1-based,
 * competition ranking over every eligible item).
 */
export function topAreas(items, n = 10) {
  const ok = (items ?? []).filter(i => isNum(i.score) && !i.filtered)
    .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name), 'nl'));
  return ok.slice(0, n).map(i => ({ ...i, rank: 1 + ok.filter(o => o.score > i.score).length }));
}

/** Short Dutch summary of the answers for the result header. */
export function describeAnswers(answers) {
  const a = normalizeAnswers(answers);
  const parts = [];
  if (a.levensfase) parts.push(LEVENSFASEN[a.levensfase].toLowerCase());
  if (a.budget) {
    const c = budgetCeiling(a.budget);
    parts.push(a.budget.mode === 'huur' ? 'huur' : c != null ? `koop tot ≈ €${Math.round(c).toLocaleString('nl-NL')}k` : 'koop');
  }
  if (a.vervoer.length) parts.push(a.vervoer.map(v => VERVOER[v].toLowerCase()).join('/'));
  if (a.sfeer != null) parts.push(a.sfeer < 35 ? 'levendig' : a.sfeer > 65 ? 'rustig' : 'tussen druk en rustig');
  if (a.veiligheid.length) parts.push(`let op ${a.veiligheid.map(c => CRIMES[c].label.toLowerCase()).join(', ')}`);
  if (a.situatie) parts.push(`vergelijkbare situatie: ${[a.situatie.edu ? `opleiding ${SITUATIE_EDU[a.situatie.edu].short}` : '', a.situatie.income ? `inkomen ${SITUATIE_INCOME[a.situatie.income].short}` : ''].filter(Boolean).join(', ')}`);
  if (a.gemeenschap) {
    const d = DETAIL_GROUPS[a.gemeenschap.detail];
    parts.push(`${GEMEENSCHAP_LABEL.toLowerCase()}: ${d.label} (${d.direct ? 'gemeente, wijk en buurt' : d.wijk ? 'gemeenten; wijk/buurt geschat via postcode' : 'gemeenten'})`);
  }
  return parts.join(' · ');
}
