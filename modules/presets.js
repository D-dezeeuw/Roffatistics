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
    const metrics = theme.metrics.filter(m => has(m.key));
    if (!metrics.length || !(theme.weight > 0)) continue;
    for (const m of metrics) {
      const target = preset.targets?.[m.key];
      out.push({
        key: m.key, label: DATASETS[m.key]?.label ?? m.key, theme: theme.key,
        weight: theme.weight / metrics.length, pref: target ? 'target' : m.pref,
        ...(target ? { ideal: target.ideal, tolerance: target.tolerance, log: !!target.log } : {}),
      });
    }
  }
  const total = out.reduce((s, f) => s + f.weight, 0);
  return total ? out.map(f => ({ ...f, weight: f.weight / total })) : [];
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
  const p = typeof preset === 'string' ? PRESETS[preset] : preset;
  if (!p || !areas?.length) return { factors: [], results: [] };
  const factors = resolvePreset(p, availableKeys(areas));
  const shrinkKeys = p.shrink && parents ? factors.map(f => f.key).filter(k => RATE_KEYS.includes(k)) : [];
  const results = scoreAreas(areas, factors, { parents, shrinkKeys, filters: p.filters ?? [], minCoverage: p.minCoverage ?? MIN_COVERAGE });
  return { factors, results };
}

/**
 * Rotterdam areas with the Woonscore added: values.woonscore (0–100 or null)
 * and `woonscore` = the score.js result (factors, shrunk, coverage). `parents`
 * = the wijken when scoring buurten (shrinkage toward the parent wijk).
 */
export function withWoonscore(areas, { parents = null } = {}) {
  const parentMap = parents ? new Map(parents.map(p => [p.code, p.values ?? {}])) : null;
  const { results } = scoreWithPreset(areas ?? [], DEFAULT_PRESET, { parents: parentMap });
  const byCode = new Map(results.map(r => [r.code, r]));
  return (areas ?? []).map(a => {
    const r = byCode.get(a.code) ?? null;
    return { ...a, values: { ...a.values, woonscore: r?.score ?? null }, woonscore: r };
  });
}

/** National CBS rows ({ regionCode, ...values }) with a `woonscore` field among their peers. */
export function rowsWithWoonscore(rows) {
  const list = rows ?? [];
  const { results } = scoreWithPreset(list.map(r => ({ code: r.regionCode, values: r })), DEFAULT_PRESET);
  const byCode = new Map(results.map(r => [r.code, r.score]));
  return list.map(r => ({ ...r, woonscore: byCode.get(r.regionCode) ?? null }));
}
