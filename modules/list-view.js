// Ranglijst "Eenvoudig | Uitgebreid" (15 Nov 2026): which data columns the
// table shows. Pure (no DOM), unit-tested in tests/list-view.test.js; list.js
// renders. The mode itself is state.listView ('simple' default | 'adv', #lv=adv).
import { categoryOf, categoryHeadline, DATASET_GROUPS } from './datasets.js';
import { orderColumns } from './ranking.js';

/** Columns that are always in the table (rank, name, score), so a sort on them is never hidden. */
export const FIXED_COLUMNS = Object.freeze(['rank', 'name', 'overall']);

/**
 * The data columns to show, in order.
 * - 'adv': every dataset, the ranking column first (orderColumns, as before).
 * - 'simple': only the datasets of the ranking's category, the ranked
 *   Onderdeel first. Score rankings (Totaalscore 'overall', Woonscore) show
 *   the score column (+ Opbouw, list.js) and one headline metric per other
 *   category (Misdrijven totaal, inkomen, …) as a compact overview.
 * `category` defaults to the category of `rankKey`.
 */
export function visibleColumns(datasets, { mode = 'simple', category, rankKey = 'overall', stackKeys = [] } = {}) {
  if (mode === 'adv') return orderColumns(datasets, rankKey);
  const rankDs = datasets.find(d => d.key === rankKey);
  // Mijn stapel: the stack column and its own layers, in stack order.
  if (rankDs?.unit === 'stapel') return [rankDs, ...stackKeys.map(k => datasets.find(d => d.key === k)).filter(Boolean)];
  if (rankKey === 'overall' || category === 'overall' || rankDs?.unit === 'score') return headlineColumns(datasets, rankKey);
  const cat = category ?? categoryOf(rankKey);
  let own = datasets.filter(d => categoryOf(d.key) === cat);
  if (rankDs && !own.includes(rankDs)) own = [rankDs, ...own];
  return orderColumns(own, rankKey);
}

/** In simple mode a sort on a hidden column falls back to the ranking order (rank ascending). */
export function visibleSort(sort, columns) {
  const c = sort?.column;
  return FIXED_COLUMNS.includes(c) || columns.some(d => d.key === c) ? sort : { column: 'rank', dir: 'asc' };
}

/** One headline dataset per category (in category order), skipping score datasets and the ranking itself. */
export function headlineColumns(datasets, rankKey = 'overall') {
  const out = [];
  for (const g of DATASET_GROUPS) {
    const d = datasets.find(x => x.key === g.headline);
    if (d && d.unit !== 'score' && d.unit !== 'stapel' && d.key !== rankKey && !out.includes(d)) out.push(d);
  }
  return out;
}
