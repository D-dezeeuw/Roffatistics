// Ranglijst view (#view-list): every Rotterdam wijk or buurt — or, in scope
// Nederland, every province or gemeente — ranked on the CBS datasets.
// Scoring and sorting live in ranking.js (pure, unit-tested); this file is DOM only.

import { getState, setState, onStateChange } from './state.js';
import { loadRotterdamAreas, getAreaIndex, DATASETS, DATASET_KEYS } from './areas.js';
import { interpolateColor } from './overlays.js';
import { scoreAreas, rankRows, sortRows, defaultSortDir, formatValue, formatScore } from './ranking.js';

const LEVELS = {
  rotterdam: [{ key: 'wijken', label: 'Wijken' }, { key: 'buurten', label: 'Buurten' }],
  nederland: [{ key: 'provincies', label: 'Provincies' }, { key: 'gemeenten', label: 'Gemeenten' }],
};
const HIGHLIGHT_MS = 2200;
const ALL_DATASETS = DATASET_KEYS.map(k => DATASETS[k]);

const ui = {
  root: null,
  level: { rotterdam: 'wijken', nederland: 'provincies' },
  rankKey: 'overall',
  sort: { column: 'rank', dir: 'asc' },
  rendered: null,          // Promise of the last render
};
const national = { provincies: [], gemeenten: [] };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const isVisible = () => ui.root && !ui.root.hidden && getState().view === 'list';

/** Hands the national CBS rows (normalizeProvinces shape: { regionCode, ...values }) to the list. */
export function setNationalRows(level, rows) {
  national[level === 'gemeente' || level === 'gemeenten' ? 'gemeenten' : 'provincies'] = rows ?? [];
  if (isVisible() && getState().scope === 'nederland') render();
}

/** Mounts the view once; renders lazily when the list view is (or becomes) visible. */
export function initList(root = document.getElementById('view-list')) {
  if (!root || ui.root) return;
  ui.root = root;
  root.classList.remove('view-placeholder');
  root.classList.add('view-list');
  root.innerHTML = `
    <div class="list-toolbar">
      <h2 class="list-title">Ranglijst</h2>
      <div class="list-level" role="group" aria-label="Niveau"></div>
      <label class="list-rank-by">Rangschik op
        <select class="list-rank-select">
          <option value="overall">Totaalscore</option>
          ${ALL_DATASETS.map(d => `<option value="${d.key}">${esc(d.label)}</option>`).join('')}
        </select>
      </label>
    </div>
    <p class="list-note" aria-live="polite"></p>
    <div class="list-table-wrap" tabindex="0" aria-label="Ranglijst tabel"></div>`;

  root.querySelector('.list-rank-select').addEventListener('change', e => {
    ui.rankKey = e.target.value;
    ui.sort = { column: 'rank', dir: 'asc' };
    if (ui.rankKey !== 'overall') setState({ dataset: ui.rankKey }, { source: 'list' });
    render();
  });
  root.querySelector('.list-level').addEventListener('click', e => {
    const btn = e.target.closest('button[data-level]');
    if (!btn || btn.disabled) return;
    ui.level[getState().scope] = btn.dataset.level;
    render();
  });
  const wrap = root.querySelector('.list-table-wrap');
  wrap.addEventListener('click', onTableClick);
  wrap.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = e.target.closest?.('tr[data-code]');
    if (tr && e.target === tr) { e.preventDefault(); selectRow(tr.dataset.code); }
  });

  onStateChange(({ state, changed, source }) => {
    if (changed.includes('view') && state.view === 'list') {
      render().then(() => state.area && highlightArea(state.area, { flash: changed.includes('area') }));
      return;
    }
    if (!isVisible()) return;
    if (changed.includes('scope')) { render(); return; }
    if (changed.includes('dataset') && source !== 'list' && ui.rankKey !== 'overall') {
      ui.rankKey = state.dataset;
      ui.sort = { column: 'rank', dir: 'asc' };
      render();
      return;
    }
    if (changed.includes('area')) {
      markSelected(state.area);
      if (state.area && source !== 'list') highlightArea(state.area);
    }
  });

  if (getState().view === 'list') render();
}

function onTableClick(e) {
  const sortBtn = e.target.closest('button[data-sort]');
  if (sortBtn) {
    const column = sortBtn.dataset.sort;
    ui.sort = ui.sort.column === column
      ? { column, dir: ui.sort.dir === 'asc' ? 'desc' : 'asc' }
      : { column, dir: defaultSortDir(column) };
    render();
    return;
  }
  if (e.target.closest('.list-to-rotterdam')) { setState({ scope: 'rotterdam' }, { source: 'list' }); return; }
  const mapBtn = e.target.closest('button.list-map-btn');
  const tr = e.target.closest('tr[data-code]');
  if (!tr) return;
  if (mapBtn) { setState({ area: tr.dataset.code, view: 'map' }, { source: 'list' }); return; }
  selectRow(tr.dataset.code);
}

function selectRow(code) {
  setState({ area: code }, { source: 'list' });
  markSelected(code);
}

function markSelected(code) {
  ui.root?.querySelectorAll('tr.is-selected').forEach(tr => tr.classList.remove('is-selected'));
  if (!code) return;
  const tr = findRow(code);
  tr?.classList.add('is-selected');
}

function findRow(code) {
  return ui.root?.querySelector(`tr[data-code="${CSS.escape(code)}"]`) ?? null;
}

/**
 * Scrolls the row of `code` into view and flashes a highlight (search contract).
 * Switches Wijken/Buurten (or Provincies/Gemeenten) when the code lives on the other level.
 * Resolves true when the row was found.
 */
export async function highlightArea(code, { flash = true } = {}) {
  if (!ui.root || !code) return false;
  await ui.rendered;
  let tr = findRow(code);
  if (!tr) {
    const scope = getState().scope;
    const level = code.startsWith('BU') ? 'buurten' : code.startsWith('WK') ? 'wijken'
      : code.startsWith('GM') ? 'gemeenten' : code.startsWith('PV') ? 'provincies' : null;
    if (level && LEVELS[scope].some(l => l.key === level) && ui.level[scope] !== level) {
      ui.level[scope] = level;
      await render();
      tr = findRow(code);
    }
  }
  if (!tr) return false;
  markSelected(code);
  tr.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  if (flash) {
    tr.classList.remove('is-flash');
    void tr.offsetWidth;                               // restart the animation
    tr.classList.add('is-flash');
    setTimeout(() => tr.classList.remove('is-flash'), HIGHLIGHT_MS);
  }
  return true;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function render() {
  ui.rendered = doRender().catch(err => {
    console.warn('Ranglijst unavailable:', err);
    setNote('De gegevens konden niet worden geladen.');
  });
  return ui.rendered;
}

async function loadRows(scope, level) {
  if (scope === 'rotterdam') {
    const areas = await loadRotterdamAreas();
    return { areas: areas[level] ?? [], dataOk: areas.dataOk };
  }
  const rows = national[level];
  if (!rows.length) return { areas: [], dataOk: true };
  const index = await getAreaIndex().catch(() => []);
  const names = new Map(index.map(e => [e.code, e.name]));
  return {
    areas: rows.map(r => ({ code: r.regionCode, name: names.get(r.regionCode) ?? r.regionCode, values: r })),
    dataOk: true,
  };
}

async function doRender() {
  const scope = getState().scope;
  if (scope === 'nederland' && !national.provincies.length && !national.gemeenten.length) {
    renderLevels(scope);
    setNote('');
    ui.root.querySelector('.list-table-wrap').innerHTML = `
      <div class="list-empty">
        <p>De landelijke cijfers zijn nog niet geladen.</p>
        <button type="button" class="list-to-rotterdam">Toon ranglijst Rotterdam</button>
      </div>`;
    return;
  }
  if (scope === 'nederland' && !national[ui.level.nederland].length) ui.level.nederland = 'provincies';
  const level = ui.level[scope];
  renderLevels(scope);
  ui.root.querySelector('.list-rank-select').value = ui.rankKey;

  const { areas, dataOk } = await loadRows(scope, level);
  if (scope !== getState().scope || level !== ui.level[scope]) return;   // superseded

  const datasets = ALL_DATASETS.filter(d => areas.some(a => typeof a.values?.[d.key] === 'number'));
  const ranked = rankRows(scoreAreas(areas, datasets), ui.rankKey, datasets);
  const rows = sortRows(ranked, ui.sort.column, ui.sort.dir);
  const hidden = ALL_DATASETS.filter(d => !datasets.includes(d)).map(d => d.label);

  const notes = [];
  if (!dataOk) notes.push('CBS-cijfers niet beschikbaar.');
  notes.push('Score = percentiel 0–100 binnen de lijst, gemiddeld over de datasets met een richting.');
  if (hidden.length) notes.push(`Geen data: ${hidden.join(', ')}.`);
  setNote(notes.join(' '));

  ui.root.querySelector('.list-table-wrap').innerHTML = tableHtml(rows, datasets, level);
  markSelected(getState().area);
}

function renderLevels(scope) {
  const box = ui.root.querySelector('.list-level');
  box.innerHTML = LEVELS[scope].map(l => {
    const on = ui.level[scope] === l.key;
    const disabled = scope === 'nederland' && !national[l.key].length;
    return `<button type="button" data-level="${l.key}" class="list-level-opt${on ? ' active' : ''}"
      aria-pressed="${on}"${disabled ? ' disabled title="Nog niet geladen"' : ''}>${l.label}</button>`;
  }).join('');
}

function setNote(text) { ui.root.querySelector('.list-note').textContent = text; }

function headerCell(column, label, cls = '', title = '') {
  const active = ui.sort.column === column;
  const aria = active ? (ui.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const arrow = active ? (ui.sort.dir === 'asc' ? '▲' : '▼') : '';
  return `<th scope="col" class="${cls}" aria-sort="${aria}"${title ? ` title="${esc(title)}"` : ''}>
    <button type="button" data-sort="${column}">${esc(label)}<span class="list-sort-arrow" aria-hidden="true">${arrow}</span></button></th>`;
}

function directionHint(ds) {
  if (ds.higherIsBetter === true)  return `${ds.title} — hoger is beter`;
  if (ds.higherIsBetter === false) return `${ds.title} — lager is beter`;
  return `${ds.title} — telt niet mee in de score`;
}

function tableHtml(rows, datasets, level) {
  const nameLabel = { wijken: 'Wijk', buurten: 'Buurt', provincies: 'Provincie', gemeenten: 'Gemeente' }[level];
  const head = `<tr>
    ${headerCell('rank', '#', 'col-rank', 'Rang')}
    ${headerCell('name', nameLabel, 'col-name')}
    ${headerCell('overall', 'Score', 'col-score', 'Gemiddelde percentielscore')}
    ${datasets.map(d => headerCell(d.key, d.label, `col-data${d.higherIsBetter == null ? ' is-neutral' : ''}${ui.rankKey === d.key ? ' is-rank-key' : ''}`, directionHint(d))).join('')}
  </tr>`;
  const body = rows.map(r => {
    const scoreColor = r.overall != null ? interpolateColor(r.overall, 0, 100) : null;
    const cells = datasets.map(d => {
      const v = r.values[d.key];
      const s = d.higherIsBetter == null ? r.pct[d.key] : r.scores[d.key];
      const bar = s != null
        ? `<span class="list-bar" style="width:${Math.max(4, Math.round(s))}%;background:${interpolateColor(s, 0, 100)}"></span>` : '';
      const tip = s != null && d.higherIsBetter != null ? ` title="Score ${formatScore(s)}"` : '';
      return `<td class="col-data${v == null ? ' is-missing' : ''}"${tip}><span class="list-val">${formatValue(v, d.unit)}</span>${bar}</td>`;
    }).join('');
    return `<tr data-code="${esc(r.code)}" tabindex="0"${r.rank == null ? ' class="is-unranked"' : ''}>
      <td class="col-rank">${r.rank ?? '—'}</td>
      <th scope="row" class="col-name"><span class="list-name">${esc(r.name)}</span>
        <button type="button" class="list-map-btn" title="Toon op kaart" aria-label="Toon ${esc(r.name)} op kaart">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>
        </button></th>
      <td class="col-score">${scoreColor ? `<span class="list-chip" style="background:${scoreColor}"></span>` : ''}<strong>${formatScore(r.overall)}</strong><small>${r.overall != null ? `${r.used}/${r.possible}` : ''}</small></td>
      ${cells}
    </tr>`;
  }).join('');
  return `<table class="list-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}
