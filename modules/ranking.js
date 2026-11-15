// Pure scoring, ranking and sorting for the Ranglijst view (modules/list.js).
// No DOM, no imports: unit-tested in tests/ranking.test.js.

const isNum = v => typeof v === 'number' && Number.isFinite(v);

/**
 * Percentile rank 0–100 of every value within the list. Ties share the mid-rank,
 * so equal values get an equal score; a list with one value (or all equal) scores 50.
 * higherIsBetter === false inverts the score. Non-numbers map to null.
 */
export function percentileScores(values, higherIsBetter = true) {
  const nums = values.filter(isNum).sort((a, b) => a - b);
  const n = nums.length;
  return values.map(v => {
    if (!isNum(v)) return null;
    if (n === 1) return 50;
    let below = 0, equal = 0;
    for (const x of nums) { if (x < v) below++; else if (x === v) equal++; }
    const pct = ((below + (equal - 1) / 2) / (n - 1)) * 100;
    return higherIsBetter === false ? 100 - pct : pct;
  });
}

/**
 * Scores every area on every dataset.
 * areas:    Array<{ code, name, values: { [key]: number|null } }>
 * datasets: Array<{ key, higherIsBetter: true|false|null }>
 * Returns new objects with
 *   pct:      { [key]: 0–100|null }  percentile of the raw value (direction ignored; for the heat bar)
 *   scores:   { [key]: 0–100|null }  direction-aware score; null for higherIsBetter null or a missing value
 *   overall:  mean of the available scores, or null when there are none
 *   used:     how many scores the overall is based on
 *   possible: how many scored datasets have data for at least one area in this list
 */
export function scoreAreas(areas, datasets) {
  const pct = {}, scores = {};
  const possibleKeys = [];
  for (const ds of datasets) {
    const vals = areas.map(a => a.values?.[ds.key]);
    pct[ds.key] = percentileScores(vals, true);
    if (ds.higherIsBetter === true || ds.higherIsBetter === false) {
      scores[ds.key] = ds.higherIsBetter ? pct[ds.key] : pct[ds.key].map(p => (p == null ? null : 100 - p));
      if (vals.some(isNum) && ds.inOverall !== false) possibleKeys.push(ds.key);
    }
  }
  return areas.map((a, i) => {
    const rowPct = {}, rowScores = {};
    let sum = 0, used = 0;
    for (const ds of datasets) {
      rowPct[ds.key] = pct[ds.key][i];
      const s = scores[ds.key] ? scores[ds.key][i] : null;
      rowScores[ds.key] = s;
      if (s != null && ds.inOverall !== false) { sum += s; used++; }
    }
    return {
      code: a.code, name: a.name, values: a.values ?? {},
      pct: rowPct, scores: rowScores,
      overall: used ? sum / used : null,
      used, possible: possibleKeys.length,
    };
  });
}

/**
 * The number a row is ranked on for `key`: 'overall' → overall score, a scored dataset → its
 * score, a neutral dataset (higherIsBetter null) → its raw value (high first). Null = unranked.
 */
export function rankValue(row, key, datasets) {
  if (key === 'overall') return row.overall;
  const ds = datasets.find(d => d.key === key);
  if (!ds) return null;
  if (ds.higherIsBetter == null) return isNum(row.values?.[key]) ? row.values[key] : null;
  return row.scores?.[key] ?? null;
}

/**
 * The 0–100 score shown in the score column when ranking on `key`:
 * 'overall' → the mean of scores; a scored dataset → its direction-aware
 * percentile; a neutral dataset (higherIsBetter null) → the raw-value
 * percentile (high value = high score, matching its raw-value ranking).
 */
export function scoreFor(row, key, datasets) {
  if (key === 'overall') return row.overall ?? null;
  const ds = datasets.find(d => d.key === key);
  if (!ds) return null;
  return (ds.higherIsBetter == null ? row.pct?.[key] : row.scores?.[key]) ?? null;
}

/**
 * Adds `rank` (1 = best, competition ranking: ties share a rank, 1-2-2-4) on `key`,
 * plus `score` (scoreFor) and `rankKey`. Rows without a rank value get rank null
 * and sort to the bottom by name. Returns a new array in rank order.
 */
export function rankRows(rows, key = 'overall', datasets = []) {
  const withVal = rows.map(r => ({ row: r, v: rankValue(r, key, datasets) }));
  withVal.sort((a, b) => {
    if (a.v == null && b.v == null) return compareNames(a.row.name, b.row.name);
    if (a.v == null) return 1;
    if (b.v == null) return -1;
    return b.v - a.v || compareNames(a.row.name, b.row.name);
  });
  let rank = 0, prev;
  return withVal.map(({ row, v }, i) => {
    const score = scoreFor(row, key, datasets);
    if (v == null) return { ...row, rank: null, score, rankKey: key };
    if (v !== prev) { rank = i + 1; prev = v; }
    return { ...row, rank, score, rankKey: key };
  });
}

/**
 * Dataset columns in display order: the ranking dataset first (right after
 * name and score), the rest in their original order. 'overall' or a key
 * that is not a column keeps the original order.
 */
export function orderColumns(datasets, key) {
  const i = datasets.findIndex(d => d.key === key);
  return i < 0 ? [...datasets] : [datasets[i], ...datasets.slice(0, i), ...datasets.slice(i + 1)];
}

/** Score column header and its tooltip for the ranking key. */
export function scoreHeader(key, datasets) {
  const ds = key === 'overall' ? null : datasets.find(d => d.key === key);
  if (!ds) return { label: 'Score', title: 'Gemiddelde percentielscore over de datasets met een richting' };
  const title = ds.higherIsBetter == null
    ? `Percentiel van ${ds.title} binnen de lijst (hoog = hoge waarde)`
    : `Percentielscore op ${ds.title} — ${ds.higherIsBetter ? 'hoger' : 'lager'} is beter`;
  return { label: `Score · ${ds.label}`, title };
}

function compareNames(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'nl', { sensitivity: 'base' });
}

/** Value used when sorting on a column. Columns: 'rank' | 'name' | 'overall' | dataset key. */
export function columnValue(row, column) {
  if (column === 'rank')    return row.rank ?? null;
  if (column === 'name')    return row.name ?? null;
  if (column === 'overall') return ('score' in row ? row.score : row.overall) ?? null;
  const v = row.values?.[column];
  return isNum(v) ? v : null;
}

/**
 * Stable sort on a column, 'asc' or 'desc'. Missing values always go last,
 * whatever the direction; ties keep their incoming (rank) order.
 */
export function sortRows(rows, column, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, v: columnValue(row, column) }))
    .sort((a, b) => {
      if (a.v == null && b.v == null) return a.i - b.i;
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      const c = typeof a.v === 'string' || typeof b.v === 'string' ? compareNames(a.v, b.v) : a.v - b.v;
      return c * sign || a.i - b.i;
    })
    .map(x => x.row);
}

// ── Rank mode: 'fixed' (Vast) | 'sort' (Volgt sortering) ─────────────────────

export const RANK_MODES = Object.freeze(['fixed', 'sort']);

/** True when, in rank mode 'sort', `column` renumbers the rows ('rank' and 'name' never do). */
export function sortDrivesRank(mode, column) {
  return mode === 'sort' && column !== 'rank' && column !== 'name';
}

/**
 * Rank numbers for rows that are already in display order (sortRows output).
 * mode 'fixed' returns the rows unchanged: rank and score stay those of the
 * "Rangschik op" basis (rankRows). mode 'sort' renumbers them from the sort
 * column: 1 = top row, equal values share a rank (competition ranking 1-2-2-4),
 * rows without a value in that column get rank null (sortRows already put them
 * last). The score becomes that column's percentile score (scoreFor) and
 * rankKey the column. Sorting on 'rank' or 'name' keeps the fixed ranks.
 */
export function applyRankMode(rows, { mode = 'fixed', column = 'rank', datasets = [] } = {}) {
  if (!sortDrivesRank(mode, column)) return rows;
  let rank = 0, prev;
  return rows.map((row, i) => {
    const v = columnValue(row, column);
    const score = column === 'overall' ? (row.score ?? row.overall ?? null) : scoreFor(row, column, datasets);
    const rankKey = column === 'overall' ? (row.rankKey ?? 'overall') : column;
    if (v == null) return { ...row, rank: null, score, rankKey };
    if (v !== prev) { rank = i + 1; prev = v; }
    return { ...row, rank, score, rankKey };
  });
}

/** Default direction when a column header is first clicked. */
export function defaultSortDir(column) {
  return column === 'rank' || column === 'name' ? 'asc' : 'desc';
}

/** nl-NL formatting by dataset unit; missing → "—". */
export function formatValue(value, unit) {
  if (!isNum(value)) return '—';
  const nl = (v, d = 0) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
  switch (unit) {
    case 'aantal':    return nl(Math.round(value));
    case '%':         return `${nl(value, 1)}%`;
    case '×€1.000':   return `€ ${nl(Math.round(value * 1000))}`;
    case 'per 1.000': return nl(value, 1);
    case 'misdrijven': return nl(Math.round(value));
    default:          return nl(value, Number.isInteger(value) ? 0 : 1);
  }
}

/** Overall score as text: "73" or "—". */
export function formatScore(score) {
  return isNum(score) ? String(Math.round(score)) : '—';
}
