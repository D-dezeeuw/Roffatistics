import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  percentileScores, scoreAreas, rankValue, rankRows, columnValue, sortRows, defaultSortDir, formatValue, formatScore,
  scoreFor, orderColumns, scoreHeader, applyRankMode, sortDrivesRank, RANK_MODES,
} from '../modules/ranking.js';

const DS = [
  { key: 'income', higherIsBetter: true },
  { key: 'crime',  higherIsBetter: false },
  { key: 'pop',    higherIsBetter: null },
];
const area = (code, name, values) => ({ code, name, values });

describe('percentileScores', () => {
  it('spreads distinct values over 0–100', () => {
    assert.deepEqual(percentileScores([10, 30, 20]), [0, 100, 50]);
  });
  it('gives ties the same mid-rank score', () => {
    assert.deepEqual(percentileScores([1, 2, 2, 3]), [0, 50, 50, 100]);
    assert.deepEqual(percentileScores([5, 5, 5]), [50, 50, 50]);
  });
  it('inverts when lower is better', () => {
    assert.deepEqual(percentileScores([10, 30, 20], false), [100, 0, 50]);
  });
  it('keeps nulls null and ranks only the numbers', () => {
    assert.deepEqual(percentileScores([null, 4, undefined, 8, NaN]), [null, 0, null, 100, null]);
  });
  it('a single value scores 50', () => {
    assert.deepEqual(percentileScores([null, 7]), [null, 50]);
  });
});

describe('scoreAreas', () => {
  const rows = scoreAreas([
    area('A', 'Alfa',  { income: 50, crime: 10, pop: 100 }),
    area('B', 'Bravo', { income: 30, crime: 30, pop: 900 }),
    area('C', 'Charlie', { income: 40, crime: null, pop: 500 }),
    area('D', 'Delta', { income: null, crime: null, pop: null }),
  ], DS);

  it('scores direction-aware and excludes neutral datasets', () => {
    assert.equal(rows[0].scores.income, 100);
    assert.equal(rows[0].scores.crime, 100);       // lowest crime = best
    assert.equal(rows[1].scores.crime, 0);
    assert.equal(rows[0].scores.pop, null);        // higherIsBetter null: not scored
    assert.equal(rows[1].pct.pop, 100);            // but has a heat percentile
  });
  it('overall = mean of available scores, with used/possible', () => {
    assert.equal(rows[0].overall, 100);
    assert.equal(rows[1].overall, 0);
    assert.equal(rows[2].overall, 50);             // income only (crime missing)
    assert.equal(rows[2].used, 1);
    assert.equal(rows[2].possible, 2);
    assert.equal(rows[0].used, 2);
  });
  it('no data at all → overall null, used 0', () => {
    assert.equal(rows[3].overall, null);
    assert.equal(rows[3].used, 0);
  });
  it('possible ignores datasets without any value in the list', () => {
    const r = scoreAreas([area('A', 'A', { income: 1, crime: null }), area('B', 'B', { income: 2, crime: null })], DS);
    assert.equal(r[0].possible, 1);
  });
});

describe('rankRows', () => {
  const scored = scoreAreas([
    area('A', 'Alfa',  { income: 30, crime: 20, pop: 5 }),
    area('B', 'Bravo', { income: 50, crime: 20, pop: 9 }),
    area('C', 'Charlie', { income: 50, crime: 20, pop: 1 }),
    area('D', 'Delta', {}),
    area('E', 'Echo',  { pop: 3 }),
  ], DS);

  it('ranks on overall with shared ranks for ties and unranked rows last', () => {
    const r = rankRows(scored, 'overall', DS);
    assert.deepEqual(r.map(x => [x.code, x.rank]), [['B', 1], ['C', 1], ['A', 3], ['D', null], ['E', null]]);
  });
  it('ranks on a neutral dataset by raw value, high first', () => {
    const r = rankRows(scored, 'pop', DS);
    assert.deepEqual(r.map(x => x.code), ['B', 'A', 'E', 'C', 'D']);
    assert.equal(r.at(-1).rank, null);
  });
  it('rankValue reads overall, scores or values', () => {
    const b = scored[1];
    assert.equal(rankValue(b, 'overall', DS), b.overall);
    assert.equal(rankValue(b, 'income', DS), 75);
    assert.equal(rankValue(b, 'pop', DS), 9);
    assert.equal(rankValue(b, 'nope', DS), null);
  });
});

describe('sortRows', () => {
  const rows = [
    { code: 'A', name: 'Zuid',  rank: 2, overall: 40, values: { income: 10 } },
    { code: 'B', name: 'Noord', rank: 1, overall: 80, values: { income: null } },
    { code: 'C', name: 'Oost',  rank: null, overall: null, values: { income: 30 } },
    { code: 'D', name: 'Ålst',  rank: 2, overall: 40, values: { income: 10 } },
  ];
  it('sorts numbers both ways with missing values always last', () => {
    assert.deepEqual(sortRows(rows, 'income', 'asc').map(r => r.code), ['A', 'D', 'C', 'B']);
    assert.deepEqual(sortRows(rows, 'income', 'desc').map(r => r.code), ['C', 'A', 'D', 'B']);
    assert.deepEqual(sortRows(rows, 'rank', 'desc').map(r => r.code), ['A', 'D', 'B', 'C']);
  });
  it('keeps the incoming order for ties (stable)', () => {
    assert.deepEqual(sortRows(rows, 'overall', 'asc').map(r => r.code), ['A', 'D', 'B', 'C']);
  });
  it('sorts names with Dutch collation', () => {
    assert.deepEqual(sortRows(rows, 'name', 'asc').map(r => r.code), ['D', 'B', 'C', 'A']);
  });
  it('columnValue and defaultSortDir', () => {
    assert.equal(columnValue(rows[1], 'income'), null);
    assert.equal(columnValue(rows[0], 'name'), 'Zuid');
    assert.equal(defaultSortDir('rank'), 'asc');
    assert.equal(defaultSortDir('name'), 'asc');
    assert.equal(defaultSortDir('overall'), 'desc');
  });
});

describe('formatting', () => {
  it('formats by unit in nl-NL, missing as a dash', () => {
    assert.equal(formatValue(12345, 'aantal'), '12.345');
    assert.equal(formatValue(41.25, '%'), '41,3%');
    assert.equal(formatValue(45.2, '×€1.000'), '€ 45.200');
    assert.equal(formatValue(3.14, 'per 1.000'), '3,1');
    assert.equal(formatValue(null, '%'), '—');
    assert.equal(formatScore(72.6), '73');
    assert.equal(formatScore(null), '—');
  });
});

describe('single-dataset ranking', () => {
  const DS2 = [
    { key: 'income', label: 'Inkomen', title: 'Gem. inkomen', higherIsBetter: true },
    { key: 'crime',  label: 'Crim.',   title: 'Misdrijven',   higherIsBetter: false },
    { key: 'pop',    label: 'Bevolking', title: 'Inwoners',   higherIsBetter: null },
  ];
  const scored = scoreAreas([
    area('A', 'Alfa',    { income: 10, crime: 1,  pop: 5 }),
    area('B', 'Bravo',   { income: 30, crime: 9,  pop: 9 }),
    area('C', 'Charlie', { income: 20, crime: 5,  pop: null }),
    area('D', 'Delta',   { income: null, crime: 2, pop: 1 }),
  ], DS2);

  it('scores and ranks on that dataset alone, missing values unranked at the bottom', () => {
    const r = rankRows(scored, 'income', DS2);
    assert.deepEqual(r.map(x => [x.code, x.rank, x.score]), [['B', 1, 100], ['C', 2, 50], ['A', 3, 0], ['D', null, null]]);
    assert.ok(r.every(x => x.rankKey === 'income'));
  });
  it('honours higherIsBetter false', () => {
    const r = rankRows(scored, 'crime', DS2);
    assert.deepEqual(r.map(x => x.code), ['A', 'D', 'C', 'B']);
    assert.equal(r[0].score, 100);
    assert.equal(r.at(-1).score, 0);
  });
  it('ranks a neutral dataset by raw value, score = raw percentile', () => {
    const r = rankRows(scored, 'pop', DS2);
    assert.deepEqual(r.map(x => [x.code, x.rank]), [['B', 1], ['A', 2], ['D', 3], ['C', null]]);
    assert.deepEqual(r.map(x => x.score), [100, 50, 0, null]);
  });
  it('overall keeps the mean-of-scores behaviour', () => {
    const r = rankRows(scored, 'overall', DS2);
    for (const x of r) assert.equal(x.score, x.overall);
  });
  it('sorting the score column follows the single-dataset score', () => {
    const r = rankRows(scored, 'crime', DS2);
    assert.deepEqual(sortRows(r, 'overall', 'desc').map(x => x.code), ['A', 'D', 'C', 'B']);
    assert.equal(columnValue({ overall: 40 }, 'overall'), 40);
    assert.equal(columnValue({ overall: 40, score: null }, 'overall'), null);
  });
  it('scoreFor reads overall, scores or pct', () => {
    assert.equal(scoreFor(scored[1], 'overall', DS2), scored[1].overall);
    assert.equal(scoreFor(scored[1], 'crime', DS2), 0);
    assert.equal(scoreFor(scored[1], 'pop', DS2), 100);
    assert.equal(scoreFor(scored[1], 'nope', DS2), null);
  });
});

describe('column order and score header', () => {
  const DS2 = [
    { key: 'income', label: 'Inkomen', title: 'Gem. inkomen', higherIsBetter: true },
    { key: 'crime',  label: 'Crim.',   title: 'Misdrijven',   higherIsBetter: false },
    { key: 'pop',    label: 'Bevolking', title: 'Inwoners',   higherIsBetter: null },
  ];
  it('moves the ranking dataset to the first data column', () => {
    assert.deepEqual(orderColumns(DS2, 'pop').map(d => d.key), ['pop', 'income', 'crime']);
    assert.deepEqual(orderColumns(DS2, 'crime').map(d => d.key), ['crime', 'income', 'pop']);
  });
  it('keeps the original order for overall or an unknown key, without mutating', () => {
    assert.deepEqual(orderColumns(DS2, 'overall').map(d => d.key), ['income', 'crime', 'pop']);
    assert.deepEqual(orderColumns(DS2, 'nope').map(d => d.key), ['income', 'crime', 'pop']);
    assert.notEqual(orderColumns(DS2, 'overall'), DS2);
  });
  it('names the basis of the score in the header', () => {
    assert.equal(scoreHeader('overall', DS2).label, 'Score');
    assert.equal(scoreHeader('income', DS2).label, 'Score · Inkomen');
    assert.match(scoreHeader('crime', DS2).title, /lager is beter/);
    assert.match(scoreHeader('pop', DS2).title, /Percentiel van Inwoners/);
  });
});

describe('rank mode (Vast | Volgt sortering)', () => {
  const DS3 = [
    { key: 'income', label: 'Inkomen', title: 'Gem. inkomen', higherIsBetter: true },
    { key: 'crime',  label: 'Crim.',   title: 'Misdrijven',   higherIsBetter: false },
    { key: 'pop',    label: 'Bevolking', title: 'Inwoners',   higherIsBetter: null },
  ];
  const scored = scoreAreas([
    area('A', 'Alfa',    { income: 10,   crime: 4,    pop: 5 }),
    area('B', 'Bravo',   { income: 30,   crime: 9,    pop: 9 }),
    area('C', 'Charlie', { income: 20,   crime: 4,    pop: null }),
    area('D', 'Delta',   { income: null, crime: null, pop: 1 }),
  ], DS3);
  const ranked = rankRows(scored, 'income', DS3);     // fixed basis: income
  const view = (column, dir, mode) => applyRankMode(sortRows(ranked, column, dir), { mode, column, datasets: DS3 });

  it('fixed: column sorting only reorders, ranks and scores stay with the areas', () => {
    const rows = view('crime', 'asc', 'fixed');
    assert.deepEqual(rows.map(r => [r.code, r.rank, r.score]), [['C', 2, 50], ['A', 3, 0], ['B', 1, 100], ['D', null, null]]);
    assert.ok(rows.every(r => r.rankKey === 'income'));
  });

  it('sort, desc: 1 = top row, score = that column’s score, nulls unranked at the bottom', () => {
    const rows = view('pop', 'desc', 'sort');
    assert.deepEqual(rows.map(r => [r.code, r.rank]), [['B', 1], ['A', 2], ['D', 3], ['C', null]]);
    assert.deepEqual(rows.map(r => r.score), [100, 50, 0, null]);      // neutral → raw-value percentile
    assert.ok(rows.every(r => r.rankKey === 'pop'));
  });

  it('sort, asc with ties: equal values share a rank (1-1-3), direction-aware score', () => {
    const rows = view('crime', 'asc', 'sort');
    assert.deepEqual(rows.map(r => [r.code, r.rank]), [['C', 1], ['A', 1], ['B', 3], ['D', null]]);
    assert.equal(rows[0].score, rows[1].score);
    assert.equal(rows[2].score, 0);                                     // most crime → lowest score
  });

  it('sort on the rank or name column keeps the fixed ranks', () => {
    assert.deepEqual(view('name', 'asc', 'sort').map(r => [r.code, r.rank]), [['A', 3], ['B', 1], ['C', 2], ['D', null]]);
    assert.deepEqual(view('rank', 'asc', 'sort').map(r => r.rank), [1, 2, 3, null]);
    assert.equal(sortDrivesRank('sort', 'name'), false);
    assert.equal(sortDrivesRank('fixed', 'income'), false);
    assert.equal(sortDrivesRank('sort', 'income'), true);
    assert.deepEqual(RANK_MODES, ['fixed', 'sort']);
  });

  it('sort on the score column renumbers by the basis score', () => {
    const rows = view('overall', 'asc', 'sort');
    assert.deepEqual(rows.map(r => [r.code, r.rank, r.score]), [['A', 1, 0], ['C', 2, 50], ['B', 3, 100], ['D', null, null]]);
  });

  it('formats absolute crime counts as whole numbers', () => {
    assert.equal(formatValue(1234, 'misdrijven'), '1.234');
  });
});
