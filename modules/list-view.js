// Ranglijst "Eenvoudig | Uitgebreid" (15 Nov 2026): which data columns the
// table shows. Pure (no DOM), unit-tested in tests/list-view.test.js; list.js
// renders. The mode itself is state.listView ('simple' default | 'adv', #lv=adv).
import { categoryOf, categoryHeadline } from './datasets.js';
import { orderColumns } from './ranking.js';

/** Columns that are always in the table (rank, name, score), so a sort on them is never hidden. */
export const FIXED_COLUMNS = Object.freeze(['rank', 'name', 'overall']);

/**
 * The data columns to show, in order.
 * - 'adv': every dataset, the ranking column first (orderColumns, as before).
 * - 'simple': only the datasets of the ranking's category, the ranked
 *   Onderdeel first. Score rankings (Totaalscore 'overall', Woonscore) show
 *   only the score column (+ Opbouw, list.js) plus their category's headline
 *   when that is not the score itself; Totaalscore has no category: none.
 * `category` defaults to the category of `rankKey`.
 */
export function visibleColumns(datasets, { mode = 'simple', category, rankKey = 'overall' } = {}) {
  if (mode === 'adv') return orderColumns(datasets, rankKey);
  if (rankKey === 'overall' || category === 'overall') return [];
  const cat = category ?? categoryOf(rankKey);
  const rankDs = datasets.find(d => d.key === rankKey);
  let own = datasets.filter(d => categoryOf(d.key) === cat);
  if (rankDs?.unit === 'score') {
    const head = categoryHeadline(cat);
    return own.filter(d => d.key === head && d.key !== rankKey);
  }
  if (rankDs && !own.includes(rankDs)) own = [rankDs, ...own];
  return orderColumns(own, rankKey);
}

/** In simple mode a sort on a hidden column falls back to the ranking order (rank ascending). */
export function visibleSort(sort, columns) {
  const c = sort?.column;
  return FIXED_COLUMNS.includes(c) || columns.some(d => d.key === c) ? sort : { column: 'rank', dir: 'asc' };
}
