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
import { STANDAARD, GELIJK, THEME_LABELS, ORIGIN_KEYS } from './presets.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export const STEPS = Object.freeze(['levensfase', 'budget', 'vervoer', 'sfeer', 'veiligheid', 'gemeenschap']);

/**
 * Gemeenschap (§5): the CBS origin groups the kerncijfers (86165NED) give per
 * wijk and buurt. The factor is the chosen group's share, always `higher`.
 */
export const GEMEENSCHAP_GROUPS = Object.freeze({
  nederland:    Object.freeze({ label: 'Nederland',         key: 'originDutchPct' }),
  europa:       Object.freeze({ label: 'Europa (excl. NL)', key: 'originEuropePct' }),
  buitenEuropa: Object.freeze({ label: 'Buiten Europa',     key: 'nonWesternPct' }),
});
/** Gemeenschap weight as a share (%) of the total weight: default modest, never above the cap. */
export const GEMEENSCHAP_DEFAULT_PCT = 10;
export const GEMEENSCHAP_MIN_PCT = 5;
export const GEMEENSCHAP_MAX_PCT = 30;
export const GEMEENSCHAP_LABEL = 'Nabijheid gemeenschap';

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
export const EXTRA_THEME_WEIGHTS = Object.freeze({ leeftijd: 15, nieuwbouw: 10, budget: 20, sfeer: 20 });
/** Sfeer theme weight when only "auto" asks for a quieter area. */
export const AUTO_SFEER_WEIGHT = 8;
/** Share inside a theme for a metric the answers stress (Standaard metrics have 1). */
export const STRESS_W = 3;

export const EMPTY_ANSWERS = Object.freeze({
  levensfase: null, oud: null, budget: null, vervoer: Object.freeze([]), sfeer: null, veiligheid: Object.freeze([]), weights: Object.freeze({}),
  gemeenschap: null,
});

/**
 * { group, pct, share } or null. Anything that is not one known group with a
 * positive weight is dropped (null = off); the weight is clamped to
 * GEMEENSCHAP_MIN_PCT–GEMEENSCHAP_MAX_PCT, so a zero, negative or huge weight
 * can never come through. There is no direction field: the factor is `higher`.
 */
export function normalizeGemeenschap(g) {
  if (!g || typeof g !== 'object' || !Object.hasOwn(GEMEENSCHAP_GROUPS, g.group)) return null;
  const raw = g.pct == null ? GEMEENSCHAP_DEFAULT_PCT : g.pct;
  if (!isNum(raw) || raw <= 0) return null;
  return { group: g.group, pct: Math.round(clamp(raw, GEMEENSCHAP_MIN_PCT, GEMEENSCHAP_MAX_PCT)), share: g.share === true };
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
  return {
    levensfase: Object.hasOwn(LEVENSFASEN, a?.levensfase) ? a.levensfase : null,
    oud: Object.hasOwn(OUD_OPTIONS, a?.oud) ? a.oud : null,
    budget,
    vervoer: pick(a?.vervoer, VERVOER),
    sfeer: isNum(a?.sfeer) ? Math.round(clamp(a.sfeer, 0, 100)) : null,
    veiligheid: pick(a?.veiligheid, CRIMES),
    weights,
    gemeenschap: normalizeGemeenschap(a?.gemeenschap),
  };
}

/** True when no step was answered and no theme weight was moved (= Standaard). */
export function isEmptyAnswers(a) {
  const n = normalizeAnswers(a);
  return !n.levensfase && !n.oud && !n.budget && !n.vervoer.length && n.sfeer == null && !n.veiligheid.length && !Object.keys(n.weights).length && !n.gemeenschap;
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
  // Runs last (after the slider overrides): its weight is a share of the total.
  // One metric, the chosen group's share, `higher`; nothing else ever touches origin.
  gemeenschap(d, a) {
    const g = a.gemeenschap;
    if (!g) return;
    const others = [...d.themes.values()].reduce((s, t) => s + (t.key !== 'gemeenschap' && t.weight > 0 && t.metrics.size ? t.weight : 0), 0);
    if (!(others > 0)) return;
    const grp = GEMEENSCHAP_GROUPS[g.group];
    d.themes.set('gemeenschap', {
      key: 'gemeenschap', label: GEMEENSCHAP_LABEL,
      weight: Math.round((others * g.pct / (100 - g.pct)) * 10) / 10,
      metrics: new Map([[grp.key, { key: grp.key, pref: 'higher', label: `${GEMEENSCHAP_LABEL} (${grp.label})` }]]),
    });
  },
});

/** Theme weights the answers produce before any slider override: { theme: weight }. */
export function themeWeights(answers) {
  return Object.fromEntries(answersToPreset({ ...normalizeAnswers(answers), weights: {} }).themes.map(t => [t.key, t.weight]));
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
  for (const [k, w] of Object.entries(a.weights)) if (d.themes.has(k)) d.themes.get(k).weight = w;
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
  const themes = (preset.themes ?? []).map(t => ({
    ...t,
    metrics: t.metrics.filter(m => !ORIGIN_KEYS.includes(m.key) || (t.key === 'gemeenschap' && m.pref === 'higher' && t.weight > 0 && !(m.w <= 0))),
  })).filter(t => t.key !== 'gemeenschap' || t.metrics.length);
  const targets = Object.fromEntries(Object.entries(preset.targets ?? {}).filter(([k]) => !ORIGIN_KEYS.includes(k)));
  const filters = (preset.filters ?? []).filter(f => !ORIGIN_KEYS.includes(f.key));
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
//   g<d|e|b><5-30>[x]   gemeenschap: group, weight in % of the total, x = "deel ook
//                       gemeenschap" ticked. No sign, no direction: the format
//                       cannot express scoring a group down. A 'g' segment
//                       without x stays local (shareableScore drops it).

const LF = { student: 's', stel: 'p', gezin: 'g', '50plus': 'v', senior: 'r' };
const OUD = { bewoners: 'b', gebouwen: 'g' };
const VV = { fiets: 'f', ov: 'o', auto: 'a', lopen: 'l' };
const CR = { inbraak: 'in', geweld: 'gw', straatroof: 'sr', fiets: 'fd', auto: 'ad', vandalisme: 'vd', drugs: 'dr' };
const TH = { veiligheid: 'v', welvaart: 'e', voorzieningen: 'z', opleiding: 'o', woningmarkt: 'm', leeftijd: 'l', nieuwbouw: 'n', budget: 'b', sfeer: 's' };
const GM = { nederland: 'd', europa: 'e', buitenEuropa: 'b' };
const inv = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const LF_ = inv(LF), OUD_ = inv(OUD), VV_ = inv(VV), CR_ = inv(CR), TH_ = inv(TH), GM_ = inv(GM);

export const SCORE_RE = /^[a-z0-9.]{1,120}$/;
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
  if (a.gemeenschap) seg.push(`g${GM[a.gemeenschap.group]}${a.gemeenschap.pct}${a.gemeenschap.share ? 'x' : ''}`);
  return seg.join('.');
}

/** Compact string → normalised answers; anything unreadable is dropped, never throws. */
export function decodeAnswers(str) {
  const out = { ...EMPTY_ANSWERS, vervoer: [], veiligheid: [], weights: {} };
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
    else if (head === 'g') {
      // Only "group + positive weight [+ x]"; any other shape is dropped whole.
      const m = /^([a-z])(\d{1,3})(x?)$/.exec(body);
      if (m && GM_[m[1]] && +m[2] > 0) out.gemeenschap = { group: GM_[m[1]], pct: +m[2], share: m[3] === 'x' };
    }
  }
  return normalizeAnswers(out);
}

/**
 * The `score` value as it may go into the URL: a Gemeenschap segment without
 * the "deel ook gemeenschap" flag is dropped (it stays in localStorage only).
 * Null when nothing is left.
 */
export function shareableScore(score) {
  if (typeof score !== 'string' || !score) return null;
  const out = score.split('.').filter(s => s[0] !== 'g' || s.endsWith('x') || FIXED_PRESETS.includes(score)).join('.');
  return out || null;
}

/**
 * The score to use on load: when the URL score is the shared form of the
 * locally stored score (same answers, private Gemeenschap left out), the
 * stored one wins so the local Gemeenschap choice survives a reload.
 */
export function restoreLocalScore(urlScore, storedScore) {
  if (!storedScore || storedScore === urlScore) return urlScore ?? storedScore ?? null;
  return shareableScore(storedScore) === (urlScore || null) ? storedScore : urlScore ?? null;
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
  if (a.gemeenschap) parts.push(`${GEMEENSCHAP_LABEL.toLowerCase()}: ${GEMEENSCHAP_GROUPS[a.gemeenschap.group].label}`);
  return parts.join(' · ');
}
