// Score presets (docs/plan-woonscore.md §1–2) and the glue that scores a set
// of areas with one. A preset is plain data; resolvePreset() turns it into
// weighted factors for the metrics that have data among the peers.
import { DATASETS, DATASET_KEYS } from './datasets.js';
import { scoreAreas, MIN_COVERAGE } from './score.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v);

/**
 * "Standaard": average preferable circumstances, no lifestyle metrics. A theme
 * weight is shared by the metrics of that theme that have data; a theme with
 * none is dropped and the rest renormalise, so NL gemeenten (few metrics) and
 * Rotterdam buurten use the same preset.
 */
export const STANDAARD = Object.freeze({
  id: 'standaard',
  label: 'Standaard',
  themes: Object.freeze([
    { key: 'veiligheid',    label: 'Veiligheid',    weight: 35, metrics: [['crimeRate', 'lower'], ['crimeBurglary', 'lower'], ['crimeViolence', 'lower'], ['crimeStreetRobbery', 'lower'], ['crimeVandalism', 'lower']] },
    { key: 'welvaart',      label: 'Welvaart',      weight: 20, metrics: [['avgIncome', 'higher'], ['welfarePer1000', 'lower']] },
    { key: 'voorzieningen', label: 'Voorzieningen', weight: 25, metrics: [['distGP', 'lower'], ['distSupermarket', 'lower'], ['distSchool', 'lower'], ['distStation', 'lower'], ['distKinderopvang', 'lower']] },
    { key: 'opleiding',     label: 'Opleiding',     weight: 10, metrics: [['highEdu', 'higher']] },
    { key: 'woningmarkt',   label: 'Woningmarkt',   weight: 10, metrics: [['ownerOccupiedPct', 'higher']] },
  ].map(t => Object.freeze({ ...t, metrics: Object.freeze(t.metrics.map(([key, pref]) => Object.freeze({ key, pref }))) }))),
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
export function resolvePreset(preset, available) {
  const has = available instanceof Set ? k => available.has(k) : k => (available ?? []).includes(k);
  const out = [];
  for (const theme of preset?.themes ?? []) {
    const metrics = theme.metrics.filter(m => has(m.key) && !(m.w <= 0));
    if (!metrics.length || !(theme.weight > 0)) continue;
    // A metric's optional `w` is its share inside the theme (default 1 = an even split).
    const wSum = metrics.reduce((s, m) => s + (isNum(m.w) ? m.w : 1), 0);
    for (const m of metrics) {
      const target = preset.targets?.[m.key];
      if (target && !(isNum(target.ideal) && isNum(target.tolerance))) continue;   // unresolved quantile target: no peers
      out.push({
        key: m.key, label: DATASETS[m.key]?.label ?? m.key, theme: theme.key,
        weight: (theme.weight * (isNum(m.w) ? m.w : 1)) / wSum, pref: target ? 'target' : m.pref,
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
  const p = resolveTargets(raw, areas);
  const factors = resolvePreset(p, availableKeys(areas));
  const shrinkKeys = p.shrink && parents ? factors.map(f => f.key).filter(k => RATE_KEYS.includes(k)) : [];
  const results = scoreAreas(areas, factors, { parents, shrinkKeys, filters: p.filters ?? [], minCoverage: p.minCoverage ?? MIN_COVERAGE });
  return { factors, results };
}

// ── Score layers: Woonscore (Standaard) and Jouw score (wizard preset) ─────────

/** Labels of every theme a preset can use (Standaard plus the wizard's themes). */
export const THEME_LABELS = Object.freeze({
  veiligheid: 'Veiligheid', welvaart: 'Welvaart', voorzieningen: 'Voorzieningen', opleiding: 'Opleiding',
  woningmarkt: 'Woningmarkt', leeftijd: 'Leeftijd', nieuwbouw: 'Nieuwbouw', budget: 'Budget', sfeer: 'Sfeer',
});

/** Score layer key → the preset it uses; `jouwscore` follows setPersonalPreset(). */
let personalPreset = STANDAARD;
export function setPersonalPreset(preset) { personalPreset = preset ?? STANDAARD; }
export function getPersonalPreset() { return personalPreset; }
const presetFor = key => (key === 'jouwscore' ? personalPreset : PRESETS[DEFAULT_PRESET]);
export const SCORE_KEYS = Object.freeze(['woonscore', 'jouwscore']);

/**
 * Last score.js result per layer and area code (codes are unique across
 * levels: PV/GM/WK/BU), for the Ranglijst breakdown column and the wizard.
 */
export const SCORE_RESULTS = Object.freeze({ woonscore: new Map(), jouwscore: new Map() });
export function scoreResult(key, code) { return SCORE_RESULTS[key]?.get(code) ?? null; }

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
  return results;
}

/**
 * Rotterdam areas with both score layers added (new objects; the input is
 * untouched): values.woonscore / values.jouwscore and the score.js results
 * `woonscore` / `jouwscore`. `parents` = the wijken when scoring buurten
 * (shrinkage toward the parent wijk).
 */
export function withWoonscore(areas, { parents = null } = {}) {
  const list = (areas ?? []).map(a => ({ ...a, values: { ...a.values } }));
  for (const key of SCORE_KEYS) assignScore(list, key, { parents });
  return list;
}

/** National CBS rows ({ regionCode, ...values }) with `woonscore` and `jouwscore` fields among their peers. */
export function rowsWithWoonscore(rows) {
  const list = rows ?? [];
  const out = list.map(r => ({ ...r }));
  for (const key of SCORE_KEYS) {
    const { results } = scoreWithPreset(list.map(r => ({ code: r.regionCode, values: r })), presetFor(key));
    const byCode = new Map(results.map(r => [r.code, r]));
    for (const row of out) {
      const r = byCode.get(row.regionCode) ?? null;
      row[key] = r && !r.filtered ? r.score : null;
      if (r) SCORE_RESULTS[key].set(row.regionCode, r);
    }
  }
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
