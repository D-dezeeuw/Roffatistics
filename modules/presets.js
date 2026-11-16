// Score presets (docs/plan-woonscore.md §1–2) and the glue that scores a set
// of areas with one. A preset is plain data; resolvePreset() turns it into
// weighted factors for the metrics that have data among the peers.
import { DATASETS, DATASET_KEYS } from './datasets.js';
import { scoreAreas, MIN_COVERAGE } from './score.js';
import { ALL_DETAIL_KEYS, withDetailShares } from './herkomst-gemeente.js';
import { LAND_METRICS } from './herkomst-land.js';
import { classifyWoongebied } from './woongebied.js';
import { assignStack, assignStackRows } from './stapel.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v);

/**
 * Share of "criminaliteit in de omgeving" inside Veiligheid (the own crime
 * metrics have 1 each): modest, so the area's own figures lead. Rotterdam
 * buurt with all six: 1/6 of 35 = ≈ 5,8 of 100 points.
 */
export const NEARBY_W = 1;

/**
 * Levenstype profiles (docs/plan-levenstype-gewichten.md, v0.45.0): the
 * starting weight of every theme (each profile sums to 100; a theme at 0
 * stays in the preset at weight 0, so its importance slider can switch it on,
 * but counts for nothing) and the metrics of Veiligheid, Voorzieningen, Levenstype
 * (buurtgenoten) and Sfeer. Welvaart, Opleiding and Woningmarkt always use
 * THEME_METRICS. One data table: tweaking a number is one edit here.
 * Metric tuples: [key, pref, w?] (w omitted = 1). A metric without data among
 * the peers drops out (resolvePreset), as does a theme without any.
 * Addendum (16 Nov 2026): Woningmarkt is 0 everywhere (a luxury issue);
 * Standaard's freed 5 went to Voorzieningen, the others' to Levenstype.
 */
/** Metric tuple flag: a missing value does not count against the coverage (score.js). */
const OPTIONAL = Object.freeze({ optional: true });
const VEILIG_STD = [['crimeRate', 'lower'], ['crimeBurglary', 'lower'], ['crimeViolence', 'lower'], ['crimeStreetRobbery', 'lower'], ['crimeVandalism', 'lower'], ['crimeNearby', 'lower', NEARBY_W]];
/** Sfeer metrics per profile direction; an explicit Sfeer answer replaces them with its targets. */
export const SFEER_METRICS = Object.freeze({
  druk:   [['density', 'higher', 2], ['horeca1km', 'higher', 2], ['distCentrum', 'lower', 1], ['distPodium', 'lower', 1]],
  rustig: [['density', 'lower', 2], ['distCentrum', 'higher', 1], ['waterPct', 'higher', 1]],
});
const THEME_METRICS = {
  welvaart:    [['avgIncome', 'higher'], ['welfarePer1000', 'lower']],
  opleiding:   [['highEdu', 'higher']],
  woningmarkt: [['ownerOccupiedPct', 'higher']],
};
/** Theme order of a profile preset. */
export const PROFILE_THEMES = Object.freeze(['veiligheid', 'welvaart', 'voorzieningen', 'opleiding', 'milieu', 'woningmarkt', 'leeftijd', 'sfeer']);
/**
 * Standaard (v0.54.0, operator 16 Nov 2026): neutral. Every theme at
 * Gemiddeld (NOMINAL_BASE 10) except a slight emphasis, one importance step up
 * (Belangrijk, ×1.5 = 15) on Veiligheid, Welvaart and Opleiding; inside the last
 * two, inkomen (avgIncome) and the basisschoolscore (eduScore) count double, and
 * geluidhinder door buren (noiseNeighbourPct) is the theme Milieu on its own.
 * So each emphasised metric weighs 10, as much as a whole neutral theme; the
 * other metric of its theme 5. Woningmarkt stays 0 (addendum below).
 * Not summed to 100: resolvePreset normalises.
 */
export const PROFILES = Object.freeze({
  standaard: {
    weights: { veiligheid: 15, voorzieningen: 10, welvaart: 15, opleiding: 15, milieu: 10, woningmarkt: 0 },
    veiligheid: VEILIG_STD,
    voorzieningen: [['distGP', 'lower'], ['distSupermarket', 'lower'], ['distSchool', 'lower'], ['distStation', 'lower'], ['distKinderopvang', 'lower']],
    welvaart: [['avgIncome', 'higher', 2], ['welfarePer1000', 'lower']],
    // Optional (4th element): where an area has no value (no basisschool inside, no milieu
    // estimate) the factor drops out of the coverage too, so it never costs a buurt its score.
    opleiding: [['eduScore', 'higher', 2, OPTIONAL], ['highEdu', 'higher']],
    milieu: [['noiseNeighbourPct', 'lower', 1, OPTIONAL]],
  },
  student: {
    weights: { veiligheid: 10, voorzieningen: 30, welvaart: 0, opleiding: 0, woningmarkt: 0, leeftijd: 20, sfeer: 40 }, sfeer: 'druk',
    veiligheid: [['crimeBike', 'lower', 2], ['crimeStreetRobbery', 'lower'], ['crimeViolence', 'lower']],
    voorzieningen: [['distSupermarket', 'lower', 2], ['distStation', 'lower', 2], ['distOv', 'lower', 2], ['distGP', 'lower']],
    leeftijd: [['pop15to24', 'higher', 2], ['pop25to44', 'higher']],
  },
  // Wizard v2 (docs/plan-wizard-v2.md, v0.46.0): Starter split off Student.
  starter: {
    weights: { veiligheid: 20, voorzieningen: 30, welvaart: 10, opleiding: 5, woningmarkt: 0, leeftijd: 15, sfeer: 20 }, sfeer: 'druk',
    veiligheid: VEILIG_STD,
    voorzieningen: [['distStation', 'lower', 2], ['distOv', 'lower', 2], ['distSupermarket', 'lower', 2], ['distGP', 'lower']],
    leeftijd: [['pop25to44', 'higher']],
  },
  stel: {
    weights: { veiligheid: 25, voorzieningen: 25, welvaart: 10, opleiding: 5, woningmarkt: 0, leeftijd: 15, sfeer: 20 }, sfeer: 'druk',
    veiligheid: VEILIG_STD,
    voorzieningen: [['distSupermarket', 'lower', 2], ['distStation', 'lower', 2], ['distOv', 'lower'], ['distGP', 'lower']],
    leeftijd: [['pop25to44', 'higher']],
  },
  gezin: {
    weights: { veiligheid: 35, voorzieningen: 35, welvaart: 10, opleiding: 0, woningmarkt: 0, leeftijd: 15, sfeer: 5 }, sfeer: 'rustig',
    veiligheid: [['crimeBurglary', 'lower', 2], ['crimeViolence', 'lower', 2], ['crimeStreetRobbery', 'lower'], ['crimeDrugs', 'lower'], ['crimeVandalism', 'lower'], ['crimeNearby', 'lower', NEARBY_W]],
    // School close by and good (eduNearScore, W31) replaces Opleiding for a family.
    voorzieningen: [['distSchool', 'lower', 3], ['eduNearScore', 'higher', 3], ['distKinderopvang', 'lower', 3], ['distGroen', 'lower', 2], ['distGP', 'lower'], ['distSupermarket', 'lower']],
    leeftijd: [['hhWithKidsPct', 'higher']],
  },
  // Nieuwkomer (v0.46.0): rebalanced to 100 (the plan's 25/35 summed to 80).
  // Sfeer 10 has no direction, so it has no metrics until the Sfeer slider is
  // answered (then it is that theme's base); without it the other 90 renormalise. Never any
  // origin metric: the group is the user's own choice (§5 guard).
  nieuwkomer: {
    weights: { veiligheid: 30, voorzieningen: 50, welvaart: 5, opleiding: 0, woningmarkt: 0, leeftijd: 5, sfeer: 10 },
    veiligheid: VEILIG_STD,
    voorzieningen: [['distSupermarket', 'lower', 2], ['distOv', 'lower', 2], ['distGP', 'lower', 2], ['distSchool', 'lower']],
    leeftijd: [['pop25to44', 'higher']],
  },
  '50plus': {
    weights: { veiligheid: 30, voorzieningen: 30, welvaart: 15, opleiding: 5, woningmarkt: 0, leeftijd: 10, sfeer: 10 }, sfeer: 'rustig',
    veiligheid: VEILIG_STD,
    voorzieningen: [['distGP', 'lower', 2], ['distSupermarket', 'lower', 2], ['distStation', 'lower'], ['distGroen', 'lower']],
    leeftijd: [['pop45to64', 'higher']],
  },
  senior: {
    weights: { veiligheid: 35, voorzieningen: 40, welvaart: 5, opleiding: 0, woningmarkt: 0, leeftijd: 10, sfeer: 10 }, sfeer: 'rustig',
    veiligheid: [['crimeBurglary', 'lower', 2], ['crimeStreetRobbery', 'lower', 2], ['crimePickpocket', 'lower'], ['crimeViolence', 'lower'], ['crimeNearby', 'lower', NEARBY_W]],
    voorzieningen: [['distGP', 'lower', 3], ['distSupermarket', 'lower', 2], ['distOv', 'lower', 2]],
    leeftijd: [['pop65plus', 'higher']],
  },
  soloMensen: {
    weights: { veiligheid: 20, voorzieningen: 25, welvaart: 10, opleiding: 5, woningmarkt: 0, leeftijd: 10, sfeer: 30 }, sfeer: 'druk',
    veiligheid: VEILIG_STD,
    voorzieningen: [['distSupermarket', 'lower', 2], ['distStation', 'lower'], ['distOv', 'lower'], ['distGP', 'lower']],
    leeftijd: [['singleHhPct', 'higher', 2], ['pop25to44', 'higher']],
  },
  soloRust: {
    weights: { veiligheid: 30, voorzieningen: 25, welvaart: 15, opleiding: 5, woningmarkt: 0, leeftijd: 5, sfeer: 20 }, sfeer: 'rustig',
    veiligheid: VEILIG_STD,
    voorzieningen: [['distSupermarket', 'lower'], ['distGP', 'lower'], ['distGroen', 'lower', 2], ['distOpenNatuur', 'lower']],
    leeftijd: [['waterPct', 'higher']],
  },
});
/**
 * "Zelf samenstellen" (plan-gui-header-wizard §C, v0.57.0): building blocks cut
 * from the PROFILES above. Each block adds, per theme, [extra weight, metric
 * tuples] on top of Standaard; the tuples' third element is the share inside
 * the block's part of that theme (as in PROFILES). One data table: tweaking a
 * number is one edit here. `code` is the block's letter in the hash (`lc…`),
 * `from` the profile it was cut from. Levendig and Rustig exclude each other
 * (EXCLUSIVE_BLOCKS). Formula: docs/algoritmes.md §2.
 */
export const BUILDING_BLOCKS = Object.freeze({
  kinderen:   Object.freeze({ code: 'k', label: 'Kinderen', hint: 'basisscholen (en hun kwaliteit), kinderopvang, gezinnen in de buurt', from: 'gezin',
    themes: Object.freeze({ voorzieningen: [20, [['distSchool', 'lower', 3], ['eduNearScore', 'higher', 3], ['distKinderopvang', 'lower', 3]]], leeftijd: [10, [['hhWithKidsPct', 'higher']]] }) }),
  levendig:   Object.freeze({ code: 'l', label: 'Levendig', hint: 'drukker, horeca, centrum en podium dichtbij', from: 'soloMensen',
    themes: Object.freeze({ sfeer: [20, SFEER_METRICS.druk] }) }),
  rustig:     Object.freeze({ code: 'r', label: 'Rustig', hint: 'lage dichtheid, water, verder van het centrum, weinig geluidhinder', from: 'soloRust',
    themes: Object.freeze({ sfeer: [20, SFEER_METRICS.rustig], milieu: [5, [['noiseNeighbourPct', 'lower', 1, OPTIONAL]]] }) }),
  groen:      Object.freeze({ code: 'g', label: 'Groen & natuur', hint: 'park en open natuur dichtbij', from: 'soloRust',
    themes: Object.freeze({ voorzieningen: [15, [['distGroen', 'lower', 2], ['distOpenNatuur', 'lower']]] }) }),
  ouder:      Object.freeze({ code: 'o', label: 'Ouder worden', hint: 'huisarts, OV en supermarkt dichtbij', from: 'senior',
    themes: Object.freeze({ voorzieningen: [20, [['distGP', 'lower', 3], ['distSupermarket', 'lower', 2], ['distOv', 'lower', 2]]] }) }),
  veilig:     Object.freeze({ code: 'v', label: 'Veilig', hint: 'veiligheid telt zwaarder', from: 'standaard',
    themes: Object.freeze({ veiligheid: [15, VEILIG_STD] }) }),
  bereikbaar: Object.freeze({ code: 'b', label: 'Bereikbaar', hint: 'treinstation en OV dichtbij', from: 'starter',
    themes: Object.freeze({ voorzieningen: [15, [['distStation', 'lower', 2], ['distOv', 'lower', 2]]] }) }),
});
/** Pairs of blocks that cannot be on together. */
export const EXCLUSIVE_BLOCKS = Object.freeze([Object.freeze(['levendig', 'rustig'])]);

/** Known block keys, once each, in BUILDING_BLOCKS order; a pair from EXCLUSIVE_BLOCKS drops out entirely (ambiguous). */
export function normalizeBlocks(list) {
  const set = new Set((Array.isArray(list) ? list : []).filter(k => Object.hasOwn(BUILDING_BLOCKS, k)));
  for (const pair of EXCLUSIVE_BLOCKS) if (pair.every(k => set.has(k))) pair.forEach(k => set.delete(k));
  return Object.keys(BUILDING_BLOCKS).filter(k => set.has(k));
}

const round4 = x => Math.round(x * 1e4) / 1e4;
/**
 * The profile of "Zelf samenstellen" with `blocks`, in the PROFILES shape:
 * Standaard plus every block, metric by metric. Within theme t a part with
 * weight θ and tuples (m, s_m) gives metric m the absolute weight θ·s_m/Σs;
 * the parts add up: W(m) = W_std(m) + Σ_b W_b(m), and θ(t) = Σ_m W(m). The
 * tuples carry W(m) as their share, so resolvePreset gives every metric with
 * data exactly W(m) before its usual normalisation. A theme at weight 0 in
 * Standaard (Woningmarkt) keeps its metrics and shares at 0, for its slider.
 */
export function customProfile(blocks) {
  const std = PROFILES.standaard;
  const parts = new Map();   // theme → Map(key → { pref, W, optional })
  const add = (t, weight, tuples) => {
    const sum = tuples.reduce((s, [, , w]) => s + (w ?? 1), 0);
    const m = parts.get(t) ?? new Map();
    parts.set(t, m);
    for (const [key, pref, w, opt] of tuples) {
      const W = (weight * (w ?? 1)) / sum;
      const cur = m.get(key);
      if (cur) { cur.W += W; cur.optional = cur.optional && !!opt?.optional; }
      else m.set(key, { pref, W, optional: !!opt?.optional });
    }
  };
  const weights = {};
  for (const t of PROFILE_THEMES) {
    const tuples = t === 'sfeer' ? null : std[t] ?? THEME_METRICS[t];
    const w = std.weights[t] ?? 0;
    if (tuples && w > 0) add(t, w, tuples);
    if (tuples) weights[t] = w;
  }
  for (const b of normalizeBlocks(blocks)) {
    for (const [t, [w, tuples]] of Object.entries(BUILDING_BLOCKS[b].themes)) { add(t, w, tuples); weights[t] = (weights[t] ?? 0) + w; }
  }
  const out = { weights };
  for (const t of PROFILE_THEMES) {
    const m = parts.get(t);
    if (m?.size) out[t] = [...m].map(([key, x]) => [key, x.pref, round4(x.W), ...(x.optional ? [OPTIONAL] : [])]);
    else if (t !== 'sfeer' && (std[t] ?? THEME_METRICS[t])) out[t] = std[t] ?? THEME_METRICS[t];   // weight 0: Standaard's own shares
  }
  return out;
}

/** PROFILES[key], or the custom profile for key 'custom' with `blocks`; unknown key = Standaard. */
export function profileOf(key, blocks = []) {
  return key === 'custom' ? customProfile(blocks) : PROFILES[key] ?? PROFILES.standaard;
}

const LABELS = { veiligheid: 'Veiligheid', welvaart: 'Welvaart', voorzieningen: 'Voorzieningen', opleiding: 'Opleiding', milieu: 'Milieu', woningmarkt: 'Woningmarkt', leeftijd: 'Levenstype', sfeer: 'Sfeer' };
const toMetric = ([key, pref, w, opt]) => Object.freeze({ key, pref, ...(w == null || (w === 1 && opt) ? {} : { w }), ...(opt?.optional ? { optional: true } : {}) });

/**
 * Themes of a levenstype profile (unknown key = Standaard): frozen
 * [{ key, label, weight, metrics: [{ key, pref, w? }] }] in PROFILE_THEMES
 * order. A theme without metrics in the profile (Standaard: Levenstype,
 * Sfeer) is left out; a theme at weight 0 stays at 0.
 */
export function profileThemes(key, blocks = []) {
  const p = profileOf(key, blocks);
  // Sfeer: a direction ('druk'/'rustig') in PROFILES, the metric tuples themselves in the custom profile.
  const metricsOf = k => (k === 'sfeer' ? (Array.isArray(p.sfeer) ? p.sfeer : SFEER_METRICS[p.sfeer]) : p[k] ?? THEME_METRICS[k]) ?? [];
  return Object.freeze(PROFILE_THEMES
    .filter(k => metricsOf(k).length)
    .map(k => Object.freeze({ key: k, label: LABELS[k], weight: p.weights[k] ?? 0, metrics: Object.freeze(metricsOf(k).map(toMetric)) })));
}

/**
 * The `n` heaviest themes of a profile by its weight table (ties in
 * PROFILE_THEMES order), for the wizard's profile cards: [{ key, label, weight }].
 */
export function profileTopThemes(key, n = 3, blocks = []) {
  const p = profileOf(key, blocks);
  return PROFILE_THEMES.filter(k => (p.weights[k] ?? 0) > 0)
    .map(k => ({ key: k, label: LABELS[k], weight: p.weights[k] }))
    .sort((a, b) => b.weight - a.weight || PROFILE_THEMES.indexOf(a.key) - PROFILE_THEMES.indexOf(b.key))
    .slice(0, n);
}

/**
 * "Standaard": the neutral Standaard profile (see PROFILES), no lifestyle metrics. A theme weight is
 * shared by the metrics of that theme that have data; a theme with none is
 * dropped and the rest renormalise, so NL gemeenten (few metrics) and
 * Rotterdam buurten use the same preset. crimeNearby (omgeving.js): the area
 * plus its neighbours, one sixth of Veiligheid next to the own five.
 */
export const STANDAARD = Object.freeze({
  id: 'standaard',
  label: 'Standaard',
  themes: profileThemes('standaard'),
  targets: Object.freeze({}),
  filters: Object.freeze([]),
  shrink: true,
  minCoverage: MIN_COVERAGE,
});

/**
 * "Gelijk gewogen": every directional dataset that counts in the Totaalscore
 * (inOverall, higherIsBetter true/false) with weight 1, no shrinkage and no
 * coverage threshold: the same numbers as the Ranglijst Totaalscore.
 */
export const GELIJK = Object.freeze({
  id: 'gelijk',
  label: 'Gelijk gewogen',
  themes: Object.freeze(DATASET_KEYS
    .map(k => DATASETS[k])
    .filter(d => d.inOverall !== false && (d.higherIsBetter === true || d.higherIsBetter === false))
    .map(d => Object.freeze({ key: d.key, label: d.label, weight: 1, metrics: Object.freeze([Object.freeze({ key: d.key, pref: d.higherIsBetter ? 'higher' : 'lower' })]) }))),
  targets: Object.freeze({}),
  filters: Object.freeze([]),
  shrink: false,
  minCoverage: 0,
});

export const PRESETS = Object.freeze({ standaard: STANDAARD, gelijk: GELIJK });
export const DEFAULT_PRESET = 'standaard';

/** Metric keys that are rates per 1.000 inwoners: these get small-area shrinkage. */
export const RATE_KEYS = Object.freeze(DATASET_KEYS.filter(k => DATASETS[k].unit === 'per 1.000'));

/**
 * Factors of `preset` for the metrics in `available` (a Set or array of keys
 * with data among the peers): [{ key, label, theme, weight, pref, ideal?, tolerance? }].
 * Each theme's weight is split evenly over its available metrics; weights are
 * then normalised to sum to 1.
 */
/**
 * Origin (herkomst) metrics. §5: they may only ever count as `higher` (more of
 * a chosen group = plus), never lower, as a target or as a filter, so no
 * preset can rank an area by the absence of a group.
 */
export const ORIGIN_KEYS = Object.freeze(['originDutchPct', 'diversityPct', 'originEuropePct', 'nonWesternPct', ...new Set([...ALL_DETAIL_KEYS, ...LAND_METRICS])]);
const originAllowed = (m, target) => !ORIGIN_KEYS.includes(m.key) || (m.pref === 'higher' && !target);
/**
 * "Jouw situatie" (v0.23.0) is positive-only: in that theme a metric counts only
 * as `higher`, never as a target, except avgIncome (SITUATIE_TARGET_KEY in
 * wizard-model.js, v0.26.0), which counts only as the income-band target.
 */
const situatieAllowed = (theme, m, target) => theme.key !== 'situatie' || (m.pref === 'higher' && !target)
  || (m.key === 'avgIncome' && m.pref === 'target' && isNum(target?.ideal) && isNum(target?.tolerance) && target.tolerance > 0);

export function resolvePreset(preset, available) {
  const has = available instanceof Set ? k => available.has(k) : k => (available ?? []).includes(k);
  const out = [];
  for (const theme of preset?.themes ?? []) {
    // `unless`: the metric only counts where that other key has no data (the broad
    // Gemeenschap group next to a detailed group: wijk/buurt only, not for gemeenten).
    const metrics = theme.metrics.filter(m => has(m.key) && !(m.w <= 0) && !(m.unless && has(m.unless))
      && originAllowed(m, preset.targets?.[m.key]) && situatieAllowed(theme, m, preset.targets?.[m.key]));
    if (!metrics.length || !(theme.weight > 0)) continue;
    // A metric's optional `w` is its share inside the theme (default 1 = an even split).
    const wSum = metrics.reduce((s, m) => s + (isNum(m.w) ? m.w : 1), 0);
    for (const m of metrics) {
      const target = preset.targets?.[m.key];
      if (target && !(isNum(target.ideal) && isNum(target.tolerance))) continue;   // unresolved quantile target: no peers
      out.push({
        key: m.key, label: m.label ?? DATASETS[m.key]?.label ?? m.key, theme: theme.key,
        weight: (theme.weight * (isNum(m.w) ? m.w : 1)) / wSum, pref: target ? 'target' : m.pref,
        ...(m.optional ? { optional: true } : {}),
        ...(target ? { ideal: target.ideal, tolerance: target.tolerance, log: !!target.log } : {}),
      });
    }
  }
  const total = out.reduce((s, f) => s + f.weight, 0);
  return total ? out.map(f => ({ ...f, weight: f.weight / total })) : [];
}

/** Value at quantile q (0..1, linear interpolation) of the numbers in `values`; null without numbers. */
export function quantile(values, q) {
  const nums = (values ?? []).filter(isNum).sort((a, b) => a - b);
  if (!nums.length) return null;
  const pos = Math.min(Math.max(q, 0), 1) * (nums.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return nums[lo] + (nums[hi] - nums[lo]) * (pos - lo);
}

/**
 * Targets given as a peer quantile ({ quantile, spread? }) become absolute
 * { ideal, tolerance } among `areas`: ideal = the value at that quantile,
 * tolerance = spread × half the interquartile range (spread default 1), so a
 * "druk ↔ rustig" slider means the same for gemeenten, wijken and buurten.
 * Absolute targets pass unchanged; a key without peer data is left unresolved.
 */
export function resolveTargets(preset, areas) {
  const targets = preset?.targets ?? {};
  if (!Object.values(targets).some(t => isNum(t?.quantile))) return preset;
  const out = {};
  for (const [key, t] of Object.entries(targets)) {
    if (!isNum(t?.quantile)) { out[key] = t; continue; }
    const vals = areas.map(a => a.values?.[key]);
    const ideal = quantile(vals, t.quantile);
    if (ideal == null) { out[key] = { quantile: t.quantile }; continue; }
    const iqr = quantile(vals, 0.75) - quantile(vals, 0.25);
    const half = iqr > 0 ? iqr / 2 : Math.max(Math.abs(ideal) * 0.1, 1e-6);
    out[key] = { ideal, tolerance: half * (isNum(t.spread) && t.spread > 0 ? t.spread : 1), ...(t.log ? { log: true } : {}) };
  }
  return { ...preset, targets: out };
}

/** Keys that have a numeric value in at least one area. */
export function availableKeys(areas) {
  const set = new Set();
  for (const a of areas) for (const [k, v] of Object.entries(a.values ?? {})) if (isNum(v)) set.add(k);
  return set;
}

/**
 * Scores `areas` ([{ code, values, parent? }], one level) with a preset (id or
 * object). `parents` (code → values) enables shrinkage of RATE_KEYS for
 * presets with shrink: true. Returns { factors, results } (score.js shape).
 */
export function scoreWithPreset(areas, preset = DEFAULT_PRESET, { parents = null } = {}) {
  const raw = typeof preset === 'string' ? PRESETS[preset] : preset;
  if (!raw || !areas?.length) return { factors: [], results: [] };
  // Non-residential wijken/buurten (woongebied.js) are no peers: they get no
  // score and do not move the percentiles or quantile targets of the others.
  const kinds = areas.map(a => classifyWoongebied(a.values, a.code));
  const peers = areas.filter((_, i) => kinds[i].residential);
  const p = resolveTargets(raw, peers);
  const factors = resolvePreset(p, availableKeys(peers));
  const shrinkKeys = p.shrink && parents ? factors.map(f => f.key).filter(k => RATE_KEYS.includes(k)) : [];
  const scored = peers.length ? scoreAreas(peers, factors, { parents, shrinkKeys, filters: (p.filters ?? []).filter(f => !ORIGIN_KEYS.includes(f.key)), minCoverage: p.minCoverage ?? MIN_COVERAGE }) : [];
  if (peers.length === areas.length) return { factors, results: scored };
  let j = 0;
  const results = areas.map((a, i) => (kinds[i].residential ? scored[j++]
    : { code: a.code, score: null, coverage: 0, shrunk: false, filtered: false, factors: [], nonResidential: kinds[i].kind }));
  return { factors, results };
}

// ── The Woonscore layer: one score, scored with the active preset ─────────────
// Standaard by default; the wizard (`score` in the state, #score=…) or the
// Gelijk switch replaces the preset and every area is rescored in place.

/** Labels of every theme a preset can use (Standaard plus the wizard's themes). */
export const THEME_LABELS = Object.freeze({
  veiligheid: 'Veiligheid', welvaart: 'Welvaart', voorzieningen: 'Voorzieningen', opleiding: 'Opleiding', milieu: 'Milieu',
  woningmarkt: 'Woningmarkt', leeftijd: 'Levenstype', nieuwbouw: 'Bouwstijl', budget: 'Budget', sfeer: 'Sfeer',
  situatie: 'Vergelijkbare buren', gemeenschap: 'Eigen gemeenschap dichtbij', dichtbij: 'Dichtbij',
});

/** The active preset of the Woonscore (setPersonalPreset(null) = Standaard). */
let personalPreset = STANDAARD;
export function setPersonalPreset(preset) { personalPreset = preset ?? STANDAARD; }
export function getPersonalPreset() { return personalPreset; }
const presetFor = key => (key === 'woonscore' ? personalPreset : PRESETS[DEFAULT_PRESET]);
/** The score layer keys (one since v0.22.0: the Woonscore follows the active preset). */
export const SCORE_KEYS = Object.freeze(['woonscore']);

/**
 * Last score.js result per area code (codes are unique across levels:
 * PV/GM/WK/BU): `woonscore` with the active preset (Ranglijst breakdown,
 * wizard top 10) and `standaard` with the Standaard preset (the wizard's
 * "Std" comparison column).
 */
export const SCORE_RESULTS = Object.freeze({ woonscore: new Map(), standaard: new Map() });
export function scoreResult(key, code) { return SCORE_RESULTS[key]?.get(code) ?? null; }

/** Records the Standaard results of `areas` ({ code, values }) for the comparison column. */
function recordStandaard(areas, results, preset, parents) {
  const std = preset === STANDAARD ? results : scoreWithPreset(areas, STANDAARD, { parents }).results;
  for (const r of std) SCORE_RESULTS.standaard.set(r.code, r);
}

/**
 * Scores `list` with the preset of layer `key` and writes it IN PLACE:
 * a.values[key] (0–100, or null when filtered out or without data) and
 * a[key] (the score.js result). In place so the map layers, which hold the
 * area objects, recolour without a reload. Returns the results.
 */
export function assignScore(list, key, { parents = null, preset = presetFor(key) } = {}) {
  const parentMap = parents ? new Map(parents.map(p => [p.code, p.values ?? {}])) : null;
  const { results } = scoreWithPreset(list ?? [], preset, { parents: parentMap });
  const byCode = new Map(results.map(r => [r.code, r]));
  for (const a of list ?? []) {
    const r = byCode.get(a.code) ?? null;
    a.values = a.values ?? {};
    a.values[key] = r && !r.filtered ? r.score : null;
    a[key] = r;
    if (r) SCORE_RESULTS[key]?.set(a.code, r);
  }
  if (key === 'woonscore' && list?.length) recordStandaard(list, results, preset, parentMap);
  if (key === 'woonscore') assignStack(list);   // Mijn stapel may hold the Woonscore: computed after it, on the same list
  return results;
}

/**
 * Rotterdam areas with the Woonscore added (new objects; the input is
 * untouched): values.woonscore and the score.js result `woonscore`.
 * `parents` = the wijken when scoring buurten (shrinkage toward the parent wijk).
 */
export function withWoonscore(areas, { parents = null } = {}) {
  const list = (areas ?? []).map(a => ({ ...a, values: { ...a.values } }));
  for (const key of SCORE_KEYS) assignScore(list, key, { parents });
  return list;
}

/** National CBS rows ({ regionCode, ...values }) with a `woonscore` field among their peers. */
export function rowsWithWoonscore(rows) {
  const list = rows ?? [];
  const out = list.map(r => ({ ...r }));
  // Detailed herkomst shares (Gemeenschap, gemeenten only) are added for scoring, not to the rows.
  const areas = list.map(r => ({ code: r.regionCode, values: withDetailShares(r, r.regionCode) }));
  for (const key of SCORE_KEYS) {
    const preset = presetFor(key);
    const { results } = scoreWithPreset(areas, preset);
    const byCode = new Map(results.map(r => [r.code, r]));
    for (const row of out) {
      const r = byCode.get(row.regionCode) ?? null;
      row[key] = r && !r.filtered ? r.score : null;
      if (r) SCORE_RESULTS[key].set(row.regionCode, r);
    }
    if (areas.length) recordStandaard(areas, results, preset, null);
  }
  assignStackRows(out);   // Mijn stapel (row.stapel), after the Woonscore it may hold
  return out;
}

/**
 * Points per theme of one score.js result: [{ theme, label, points, weight }]
 * in the order the themes first appear; points sum to the score.
 */
export function themeBreakdown(result) {
  const by = new Map();
  for (const f of result?.factors ?? []) {
    if (f.contribution == null) continue;
    const t = f.theme ?? f.key;
    const row = by.get(t) ?? { theme: t, label: THEME_LABELS[t] ?? f.label ?? t, points: 0, weight: 0 };
    row.points += f.contribution;
    row.weight += f.weight;
    by.set(t, row);
  }
  return [...by.values()];
}
