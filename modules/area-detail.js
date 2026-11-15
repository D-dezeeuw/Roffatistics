// Area detail modal (modules/area-modal.js): the pure part. Ranks one wijk or
// buurt among its peers on every dataset, words the rank in Dutch from the
// nearest end of the range, picks the "Opvallend" extremes and gathers the
// extras (overall score, parent, buurten, facts). No DOM; tests/area-detail.test.js.

import { DATASETS, DATASET_KEYS, datasetFor, datasetValue, crimeAreas, isCrimeDataset } from './datasets.js';
import { scoreAreas, rankRows } from './ranking.js';
import { buildScale } from './scale.js';
import { originSplit } from './herkomst.js';
import { explain, scoreRank } from './score.js';
import { themeBreakdown } from './presets.js';
import { areaEducationMix } from './dashboard-data.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const nl = (v, d = 0) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Share of the peers counted as "top/bottom": 10 %, at least one place. */
export const EXTREME_SHARE = 0.1;
/** Fewer peers than this and nothing is called "opvallend". */
export const MIN_PEERS_FOR_EXTREME = 5;

/**
 * Rank of `value` among `values` (nulls and non-numbers are not peers).
 * fromHigh: 1 + peers with a higher value; fromLow: 1 + peers with a lower
 * value (competition ranking: ties share a place). rank: the Ranglijst rank,
 * 1 = best (higherIsBetter false: lowest first; true or null: highest first).
 * pct: raw percentile 0–100 (ties at the mid-rank, one peer = 50); score: pct
 * turned for direction (100 = best), equal to pct for neutral datasets.
 * Null when `value` is not a number.
 */
export function peerRank(values, value, higherIsBetter = null) {
  if (!isNum(value)) return null;
  const nums = (values ?? []).filter(isNum);
  if (!nums.includes(value)) nums.push(value);
  const of = nums.length;
  let above = 0, below = 0, equal = 0;
  for (const x of nums) { if (x > value) above++; else if (x < value) below++; else equal++; }
  const fromHigh = above + 1, fromLow = below + 1;
  const pct = of === 1 ? 50 : ((below + (equal - 1) / 2) / (of - 1)) * 100;
  return {
    of, fromHigh, fromLow,
    rank: higherIsBetter === false ? fromLow : fromHigh,
    pct, score: higherIsBetter === false ? 100 - pct : pct,
  };
}

// Wording per end of the range. {lvl} = 'wijk' | 'buurt'.
const W = (high, low) => Object.freeze({ high, low });
export const RANK_WORDS = Object.freeze({
  population:       W('meeste inwoners', 'minste inwoners'),
  density:          W('dichtstbevolkte {lvl}', 'minst dichtbevolkte {lvl}'),
  pop65plus:        W('hoogste aandeel 65-plussers', 'laagste aandeel 65-plussers'),
  originDutchPct:   W('meeste inwoners met herkomst Nederland', 'minste inwoners met herkomst Nederland'),
  originEuropePct:  W('meeste inwoners met herkomst elders in Europa', 'minste inwoners met herkomst elders in Europa'),
  nonWesternPct:    W('meeste inwoners met herkomst buiten Europa', 'minste inwoners met herkomst buiten Europa'),
  bornAbroadPct:    W('meeste in het buitenland geboren inwoners', 'minste in het buitenland geboren inwoners'),
  highEdu:          W('hoogste aandeel hoogopgeleiden', 'laagste aandeel hoogopgeleiden'),
  avgIncome:        W('hoogste gemiddelde inkomen', 'laagste gemiddelde inkomen'),
  wozValue:         W('hoogste WOZ-waarde', 'laagste WOZ-waarde'),
  ownerOccupiedPct: W('meeste koopwoningen', 'minste koopwoningen'),
  rentalPct:        W('meeste huurwoningen', 'minste huurwoningen'),
  welfarePer1000:   W('meeste bijstand per inwoner', 'minste bijstand per inwoner'),
  crimeRate:        W('minst veilige {lvl}', 'veiligste {lvl}'),
  distGP:           W('verst van een huisarts', 'dichtst bij een huisarts'),
  distSupermarket:  W('verst van een grote supermarkt', 'dichtst bij een grote supermarkt'),
});

/** The words for `side` ('high' | 'low') of dataset `key`, for `level` and crime `mode`. */
export function rankWords(key, side, { level = 'buurt', mode = 'rate' } = {}) {
  const ds = DATASETS[key];
  let words;
  if (key === 'crimeRate' && mode === 'abs') words = W('meeste misdrijven', 'minste misdrijven')[side];
  else if (RANK_WORDS[key]) words = RANK_WORDS[key][side];
  else if (isCrimeDataset(key)) words = `${side === 'high' ? 'meeste' : 'minste'} ${String(ds.label).toLowerCase()}${mode === 'abs' ? '' : ' per inwoner'}`;
  else words = `${side === 'high' ? 'hoogste' : 'laagste'} ${String(ds?.title ?? key).toLowerCase()}`;
  return words.replace('{lvl}', level === 'wijk' ? 'wijk' : 'buurt');
}

/**
 * Natural Dutch rank line, counted from the nearer end of the range:
 * '#1 veiligste buurt (van 76)', '#25 hoogste WOZ-waarde (van 89)'. On a tie
 * between both ends (the middle) a judged dataset speaks from its good end, a
 * neutral one from the high end. Returns { side, sideRank, text } or null.
 */
export function rankPhrase(key, r, opts = {}) {
  if (!r) return null;
  const hib = DATASETS[key]?.higherIsBetter;
  let side;
  if (r.fromHigh !== r.fromLow) side = r.fromHigh < r.fromLow ? 'high' : 'low';
  else side = hib === false ? 'low' : 'high';
  const sideRank = side === 'high' ? r.fromHigh : r.fromLow;
  return { side, sideRank, text: `#${sideRank} ${rankWords(key, side, opts)} (van ${r.of})` };
}

/** True when the area sits in the top or bottom EXTREME_SHARE of at least MIN_PEERS_FOR_EXTREME peers. */
export function isExtreme(sideRank, of) {
  return of >= MIN_PEERS_FOR_EXTREME && sideRank <= Math.max(1, Math.ceil(of * EXTREME_SHARE));
}

/** Median of the numbers in `values`, null when there are none. */
export function median(values) {
  const s = (values ?? []).filter(isNum).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Difference of `value` from `ref` (the peer median): percentage points for
 * '%' datasets, else a relative % of ref (absolute when ref is 0).
 * Returns { delta, text } or null.
 */
export function formatDiff(value, ref, unit) {
  if (!isNum(value) || !isNum(ref)) return null;
  const sign = d => (d > 0 ? '+' : d < 0 ? '−' : '±');
  if (unit === '%') {
    const d = +(value - ref).toFixed(1);
    return { delta: d, text: `${sign(d)}${nl(Math.abs(d), 1)} pp` };
  }
  if (ref === 0) {
    const d = value - ref;
    return { delta: d, text: `${sign(d)}${nl(Math.abs(d), Number.isInteger(d) ? 0 : 1)}` };
  }
  const d = Math.round(((value - ref) / Math.abs(ref)) * 100);
  return { delta: d, text: `${sign(d)}${nl(Math.abs(d))}%` };
}

/**
 * Overall score (mean percentile over the judged datasets in the totaalscore)
 * and its rank among `peers`, as in the Ranglijst. { score, rank, of, used, possible } or null.
 */
export function overallRank(code, peers, mode = 'rate') {
  const list = crimeAreas(peers ?? [], mode);
  const datasets = DATASET_KEYS.map(k => datasetFor(k, mode)).filter(d => list.some(a => isNum(a.values?.[d.key])));
  const ranked = rankRows(scoreAreas(list, datasets), 'overall', datasets);
  const row = ranked.find(r => r.code === code);
  if (!row || row.rank == null) return null;
  return { score: row.overall, rank: row.rank, of: ranked.filter(r => r.rank != null).length, used: row.used, possible: row.possible };
}

/**
 * The Woonscore block of the modal: { score, rank, of, coverage, shrunk, plus, minus }
 * from the score.js result that areas.js attached (area.woonscore), or null.
 */
export function woonscoreDetail(area, peers, key = 'woonscore') {
  const r = area?.[key];
  if (!r || !isNum(r.score)) return null;
  const rank = scoreRank((peers ?? []).map(p => p[key]).filter(p => p && !p.filtered), area.code);
  const { plus, minus } = explain(r, { top: 3 });
  return { score: r.score, rank: r.filtered ? null : rank?.rank ?? null, of: r.filtered ? null : rank?.of ?? null, coverage: r.coverage, shrunk: !!r.shrunk, filtered: !!r.filtered, plus, minus, themes: themeBreakdown(r) };
}

const levelOf = area => area?.level ?? (String(area?.code).startsWith('BU') ? 'buurt' : 'wijk');
const byName = (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'nl', { sensitivity: 'base' });

/**
 * Everything the modal shows for one area. `areas` = { wijken, buurten } as
 * loaded by areas.js; peers are all areas of the same level. Entries are in
 * DATASETS order; `notable` holds the extremes, most extreme first.
 */
export function buildAreaDetail(area, areas, { mode = 'rate' } = {}) {
  if (!area) return null;
  const level = levelOf(area);
  const peers = (level === 'buurt' ? areas?.buurten : areas?.wijken) ?? [];
  const entries = [];
  for (const key of DATASET_KEYS) {
    if (DATASETS[key].unit === 'score') continue;   // the Woonscore has its own block
    const ds = datasetFor(key, mode);
    const value = datasetValue(area.values, key, mode);
    if (!isNum(value)) continue;
    const peerValues = peers.map(p => datasetValue(p.values, key, mode));
    const r = peerRank(peerValues, value, ds.higherIsBetter);
    const ph = rankPhrase(key, r, { level, mode });
    const med = median(peerValues);
    entries.push({
      key, label: ds.label, title: ds.title, unit: ds.unit, higherIsBetter: ds.higherIsBetter,
      value, ...r, ...ph,
      bar: ds.higherIsBetter == null ? r.pct : r.score,
      extreme: isExtreme(ph.sideRank, r.of),
      median: med, diff: formatDiff(value, med, ds.unit),
      outlier: buildScale(peerValues).outlierSide(value),
    });
  }
  const notable = entries.filter(e => e.extreme)
    .sort((a, b) => a.sideRank / a.of - b.sideRank / b.of || a.sideRank - b.sideRank);
  const v = area.values ?? {};
  const population = isNum(v.population) ? v.population : null;
  const density = isNum(v.density) ? v.density : null;
  return {
    code: area.code, name: area.name, level, mode,
    population, density,
    areaKm2: population && density ? population / density : null,
    parent: level === 'buurt' ? (areas?.wijken ?? []).find(w => w.code === area.parent) ?? null : null,
    children: level === 'wijk' ? (areas?.buurten ?? []).filter(b => b.parent === area.code).sort(byName) : [],
    peers: peers.length,
    entries, notable,
    overall: overallRank(area.code, peers, mode),
    woonscore: woonscoreDetail(area, peers),
    crimeTrend: isNum(v.crimeTrend) ? v.crimeTrend : null,
    origin: originSplit(v),
    education: areaEducationMix(area),
    outliers: entries.filter(e => e.outlier),
  };
}
