// Ranglijst view (#view-list): every Rotterdam wijk or buurt — or, in scope
// Nederland, every province or gemeente — ranked on the CBS datasets.
// Scoring and sorting live in ranking.js (pure, unit-tested); this file is DOM only.

import { getState, setState, onStateChange } from './state.js';
import { loadRotterdamAreas, getAreaIndex, DATASETS, DATASET_KEYS } from './areas.js';
import { datasetFor, crimeAreas, crimeValues, isCrimeDataset, LAYER_KEYS, LAYER_CATEGORIES, categoryOf, categoryDatasets, categoryHeadline, rankKeyForCategory, resolveLayerKey } from './datasets.js';
import { crimeToggleHtml } from './crime-mode.js';
import { infoButton } from './explain.js';
import { openAreaModal, themeBarHtml } from './area-modal.js';
import { scoreResult, themeBreakdown } from './presets.js';
import { splitResidential, nonResidentialLabel } from './woongebied.js';
import { scoreKind, scoreTitle } from './wizard-model.js';

/** The Woonscore follows the active preset: personalised title and a `personal` flag (header tooltip, note). */
function withScorePreset(ds) {
  const score = getState().score;
  return ds?.unit === 'score' && scoreKind(score) !== 'standaard' ? { ...ds, title: scoreTitle(score, ds.title), personal: scoreKind(score) } : ds;
}
import { buildScale, getScaleMethod, outlierLabel, SCALE_EVENT } from './scale.js';
import { scoreAreas, rankRows, sortRows, defaultSortDir, formatValue, formatScore, orderColumns, scoreHeader, applyRankMode, sortDrivesRank, RANK_MODES, rankKeyAfterDatasetChange } from './ranking.js';

const LEVELS = {
  rotterdam: [{ key: 'wijken', label: 'Wijken' }, { key: 'buurten', label: 'Buurten' }],
  nederland: [{ key: 'provincies', label: 'Provincies' }, { key: 'gemeenten', label: 'Gemeenten' }],
};
const HIGHLIGHT_MS = 2200;
// Layer datasets only (15 Nov 2026): the retired herkomst indelingen are no columns or rank keys.
const ALL_DATASETS = LAYER_KEYS.map(k => DATASETS[k]);
export const RANK_MODE_STORAGE_KEY = 'roffatistics.rankMode';

function storedRankMode() {
  try { const v = globalThis.localStorage?.getItem(RANK_MODE_STORAGE_KEY); return RANK_MODES.includes(v) ? v : 'fixed'; } catch { return 'fixed'; }
}
function storeRankMode(mode) {
  try { globalThis.localStorage?.setItem(RANK_MODE_STORAGE_KEY, mode); } catch { /* storage blocked */ }
}

const ui = {
  root: null,
  level: { rotterdam: 'wijken', nederland: 'provincies' },
  rankKey: 'woonscore',     // follows the default map layer
  sort: { column: 'rank', dir: 'asc' },
  rankMode: 'fixed',       // 'fixed' (Vast) | 'sort' (Volgt sortering); persisted in localStorage
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

/** The Ranglijst choices a share link can carry (share-link.js): level of the current scope, rank key, sort. */
export function getListOptions() {
  return { level: ui.level[getState().scope], rankKey: ui.rankKey, sort: { ...ui.sort } };
}

/** Applies shared Ranglijst choices; unknown values are ignored. Re-renders when the list is visible. */
export function setListOptions({ level, rankKey, sort } = {}) {
  const scope = getState().scope;
  if (level && LEVELS[scope].some(l => l.key === level)) ui.level[scope] = level;
  if (rankKey === 'overall' || DATASET_KEYS.includes(rankKey)) ui.rankKey = resolveLayerKey(rankKey);
  if (sort && /^[A-Za-z0-9_]{1,40}$/.test(sort.column ?? '') && (sort.dir === 'asc' || sort.dir === 'desc')) ui.sort = { column: resolveLayerKey(sort.column), dir: sort.dir };
  if (isVisible()) render();
}

/**
 * Fills the Categorie and Onderdeel pickers for \`scope\` from the shared
 * category list (datasets.js DATASET_GROUPS) and selects the current rank key.
 */
function renderRankPickers(scope) {
  const catSel = ui.root.querySelector('.list-cat-select'), subSel = ui.root.querySelector('.list-rank-select');
  const cat = ui.rankKey === 'overall' ? 'overall' : (categoryOf(ui.rankKey) ?? 'overall');
  const cats = LAYER_CATEGORIES.filter(c => categoryDatasets(c.key, scope).length);
  catSel.innerHTML = `<option value="overall">Totaalscore (gelijk gewogen)</option>${cats.map(c => `<option value="${c.key}">${esc(c.label)}</option>`).join('')}`;
  catSel.value = cat;
  if (cat === 'overall') {
    subSel.innerHTML = '<option value="">—</option>';
    subSel.disabled = true;
    return;
  }
  const head = categoryHeadline(cat, scope);
  const list = categoryDatasets(cat, scope);
  const extra = list.some(d => d.key === ui.rankKey) ? [] : [DATASETS[ui.rankKey]];
  subSel.disabled = false;
  subSel.innerHTML = [...list, ...extra].map(d => `<option value="${d.key}">${esc(d.label)}${d.key === head ? ' (totaal)' : ''}${extra.includes(d) ? ' (niet in deze weergave)' : ''}</option>`).join('');
  subSel.value = ui.rankKey;
}

/** Mounts the view once; renders lazily when the list view is (or becomes) visible. */
export function initList(root = document.getElementById('view-list')) {
  if (!root || ui.root) return;
  ui.root = root;
  ui.rankMode = storedRankMode();
  root.classList.remove('view-placeholder');
  root.classList.add('view-list');
  root.innerHTML = `
    <div class="list-toolbar">
      <h2 class="list-title">Ranglijst</h2>
      <div class="list-level" role="group" aria-label="Niveau"></div>
      <div class="list-rank-by" role="group" aria-label="Rangschik op">
        <span class="list-rank-by-title" aria-hidden="true">Rangschik op</span>
        <label class="list-rank-field">Categorie
          <select class="list-cat-select" aria-label="Rangschik op: categorie"></select>
        </label>
        <label class="list-rank-field">Onderdeel
          <select class="list-rank-select" aria-label="Rangschik op: onderdeel"></select>
        </label>
      </div>
      <div class="seg list-rankmode" role="group" aria-label="Rangnummer">
        <span class="seg-label" aria-hidden="true">Rang:</span>
        <button type="button" class="seg-opt" data-rankmode="fixed" title="Rang en score volgen 'Rangschik op'; kolommen sorteren alleen de rijen">Vast</button>
        <button type="button" class="seg-opt" data-rankmode="sort" title="Rang en score volgen de kolom waarop gesorteerd is">Volgt sortering</button>
      </div>
      <div class="list-crime" hidden></div>
    </div>
    <p class="list-note" aria-live="polite"></p>
    <div class="list-table-wrap" tabindex="0" aria-label="Ranglijst tabel"></div>`;

  // Categorie picks the category's headline metric (no Onderdeel chosen yet); Onderdeel picks one metric.
  root.querySelector('.list-cat-select').addEventListener('change', e => {
    applyRankKey(rankKeyForCategory(e.target.value, null, getState().scope));
  });
  root.querySelector('.list-rank-select').addEventListener('change', e => {
    const cat = root.querySelector('.list-cat-select').value;
    applyRankKey(rankKeyForCategory(cat, e.target.value || null, getState().scope));
  });
  function applyRankKey(key) {
    if (!key) return;
    ui.rankKey = key;
    ui.sort = { column: 'rank', dir: 'asc' };
    if (ui.rankKey !== 'overall') setState({ dataset: ui.rankKey }, { source: 'list' });
    render();
  }
  root.querySelector('.list-rankmode').addEventListener('click', e => {
    const btn = e.target.closest('button[data-rankmode]');
    if (!btn || btn.dataset.rankmode === ui.rankMode) return;
    ui.rankMode = btn.dataset.rankmode;
    storeRankMode(ui.rankMode);
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
    if (tr && e.target === tr) { e.preventDefault(); activateRow(tr.dataset.code, tr); }
  });

  onStateChange(({ state, changed, source }) => {
    // Keep "Rangschik op" in step with the map layer, also while the list is
    // hidden, so opening it later shows the layer picked in the topnav.
    let rankChanged = false;
    if (changed.includes('dataset')) {
      const next = rankKeyAfterDatasetChange(ui.rankKey, state.dataset, source);
      if (next !== ui.rankKey) {
        ui.rankKey = next;
        ui.sort = { column: 'rank', dir: 'asc' };
        rankChanged = true;
      }
    }
    if (changed.includes('view') && state.view === 'list') {
      render().then(() => state.area && highlightArea(state.area, { flash: changed.includes('area') }));
      return;
    }
    if (!isVisible()) return;
    if (changed.includes('scope') || changed.includes('crime') || changed.includes('score')) { render(); return; }
    if (rankChanged) { render(); return; }
    if (changed.includes('area')) {
      markSelected(state.area);
      if (state.area && source !== 'list') highlightArea(state.area);
    }
  });

  document.addEventListener(SCALE_EVENT, () => { if (isVisible()) render(); });
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
  activateRow(tr.dataset.code, tr);
}

// A wijk/buurt row opens the area modal (focus returns to the row); Nederland rows only select.
function activateRow(code, tr) {
  selectRow(code);
  if (getState().scope === 'rotterdam') openAreaModal(code, tr);
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

async function loadRows(scope, level, mode) {
  if (scope === 'rotterdam') {
    const areas = await loadRotterdamAreas();
    return { areas: crimeAreas(areas[level] ?? [], mode), dataOk: areas.dataOk };
  }
  const rows = national[level];
  if (!rows.length) return { areas: [], dataOk: true };
  const index = await getAreaIndex().catch(() => []);
  const names = new Map(index.map(e => [e.code, e.name]));
  return {
    areas: rows.map(r => ({ code: r.regionCode, name: names.get(r.regionCode) ?? r.regionCode, values: crimeValues(r, mode) })),
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
  renderRankPickers(scope);

  const mode = getState().crime;
  renderRankMode();
  const { areas, dataOk } = await loadRows(scope, level, mode);
  if (scope !== getState().scope || level !== ui.level[scope] || mode !== getState().crime) return;   // superseded

  // Crime datasets carry the title/unit of the current crime mode (datasetFor).
  const datasets = ALL_DATASETS.filter(d => areas.some(a => typeof a.values?.[d.key] === 'number')).map(d => withScorePreset(datasetFor(d.key, mode)));
  const has = key => datasets.some(d => d.key === key);
  // A dataset without data on this level cannot rank anything: fall back to the total score.
  const wanted = ui.rankKey === 'overall' ? null : DATASETS[ui.rankKey];
  const rankKey = wanted && has(wanted.key) ? wanted.key : 'overall';
  // Business/port areas (woongebied.js) are no peers: ranked and scored among
  // the woongebieden only, listed below them without rank or score.
  const { peers, excluded } = splitResidential(areas);
  const ranked = rankRows(scoreAreas(peers, datasets), rankKey, datasets);
  const unranked = scoreAreas(excluded, datasets).map(r => ({
    ...r, pct: {}, scores: {}, overall: null, rank: null, score: null, rankKey, nonResidential: nonResidentialLabel(r),
  }));
  const rows = [
    ...applyRankMode(sortRows(ranked, ui.sort.column, ui.sort.dir), { mode: ui.rankMode, column: ui.sort.column, datasets }),
    ...sortRows(unranked, ui.sort.column, ui.sort.dir),
  ];
  const hidden = ALL_DATASETS.filter(d => !has(d.key)).map(d => d.label);
  const rankDs = rankKey === 'overall' ? null : withScorePreset(datasetFor(rankKey, mode));
  const follows = sortDrivesRank(ui.rankMode, ui.sort.column);
  const sortDs = follows && ui.sort.column !== 'overall' ? datasets.find(d => d.key === ui.sort.column) : null;

  const crimeBox = ui.root.querySelector('.list-crime');
  const showCrime = datasets.some(d => isCrimeDataset(d.key));
  crimeBox.hidden = !showCrime;
  if (showCrime) crimeBox.innerHTML = crimeToggleHtml(mode);

  const notes = [];
  if (!dataOk) notes.push('CBS-cijfers niet beschikbaar.');
  if (excluded.length) notes.push(`${excluded.length} ${excluded.length === 1 ? 'gebied' : 'gebieden'} zonder woonfunctie (bedrijven-, haven- of recreatiegebied) onderaan, zonder rang.`);
  if (wanted && !rankDs) notes.push(`${wanted.label} heeft geen data op dit niveau; gerangschikt op totaalscore.`);
  if (sortDs) notes.push(`Rang volgt de sortering: ${sortDs.title}, ${ui.sort.dir === 'desc' ? 'hoogste' : 'laagste'} waarde eerst; score = percentiel 0–100 op die kolom${sortDs.higherIsBetter == null ? ' (hoog = hoge waarde)' : ` (${sortDs.higherIsBetter ? 'hoger' : 'lager'} is beter)`}.`);
  else if (follows) notes.push(`Rang volgt de sortering op de score, ${ui.sort.dir === 'desc' ? 'hoogste' : 'laagste'} eerst.`);
  if (sortDs) { /* the score note above replaces the basis note */ }
  else if (!rankDs) notes.push('Score = percentiel 0–100 binnen de lijst, gemiddeld over de datasets met een richting.');
  else if (rankDs.personal === 'gelijk') notes.push('Gerangschikt op de Woonscore · gelijk gewogen: 0–100 binnen de lijst, alle cijfers met een richting even zwaar. Reset in de legenda van de kaart zet hem terug op Standaard.');
  else if (rankDs.personal) notes.push(`Gerangschikt op de ${rankDs.title.replace(/ \(0–100\)$/, '')}: 0–100 binnen de lijst, gewogen met je antwoorden uit "Vind jouw ideale woonplek". Gebieden boven je budget (als je die verbergt) staan zonder rang onderaan. De kolom Opbouw toont de punten per thema. Reset in de legenda van de kaart zet hem terug op Standaard.`);
  else if (rankDs.unit === 'score') notes.push('Gerangschikt op de Woonscore: 0–100 binnen de lijst, gewogen over veiligheid (35), welvaart (20), voorzieningen (25), opleiding (10) en koopwoningen (10). De kolom Opbouw toont de punten per thema.');
  else if (rankDs.higherIsBetter == null) notes.push(`Gerangschikt op ${rankDs.title}, hoogste waarde eerst; score = percentiel 0–100 van die waarde.`);
  else notes.push(`Score = percentiel 0–100 op ${rankDs.title} alleen (${rankDs.higherIsBetter ? 'hoger' : 'lager'} is beter).`);
  if ((rankDs || follows) && rows.some(r => r.rank == null)) notes.push('Gebieden zonder waarde staan onderaan, zonder rang.');
  if (mode === 'abs' && showCrime) notes.push('Criminaliteit absoluut: geregistreerde misdrijven 2025, ook voor gebieden met weinig inwoners.');
  if (hidden.length) notes.push(`Geen data: ${hidden.join(', ')}.`);
  setNote(notes.join(' '));

  ui.root.querySelector('.list-table-wrap').innerHTML = tableHtml(rows, orderColumns(datasets, rankKey), level, rankKey, sortDs);
  markSelected(getState().area);
}

function renderRankMode() {
  ui.root.querySelectorAll('.list-rankmode [data-rankmode]').forEach(b => {
    const on = b.dataset.rankmode === ui.rankMode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
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

function headerCell(column, label, cls = '', title = '', explain = null) {
  const active = ui.sort.column === column;
  const aria = active ? (ui.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const arrow = active ? (ui.sort.dir === 'asc' ? '▲' : '▼') : '';
  return `<th scope="col" class="${cls}" aria-sort="${aria}"${title ? ` title="${esc(title)}"` : ''}>
    <button type="button" data-sort="${column}">${esc(label)}<span class="list-sort-arrow" aria-hidden="true">${arrow}</span></button>${explain ? infoButton(explain, label) : ''}</th>`;
}

/** Theme order of the breakdown column: first appearance over the listed rows (same colour per theme in every row). */
function breakdownLegend(rows, key) {
  const seen = new Map();
  for (const r of rows) for (const t of themeBreakdown(scoreResult(key, r.code))) if (!seen.has(t.theme)) seen.set(t.theme, { theme: t.theme, label: t.label });
  return [...seen.values()];
}
/** A row's themes in legend order, with zero-point placeholders, so colours line up across rows. */
function alignThemes(themes, legend) {
  const by = new Map(themes.map(t => [t.theme, t]));
  return themes.length ? legend.map(l => by.get(l.theme) ?? { ...l, points: 0, weight: 0 }) : [];
}

function directionHint(ds) {
  if (ds.higherIsBetter === true)  return `${ds.title} — hoger is beter`;
  if (ds.higherIsBetter === false) return `${ds.title} — lager is beter`;
  return `${ds.title} — telt niet mee in de score`;
}

function tableHtml(rows, datasets, level, rankKey, sortDs = null) {
  const nameLabel = { wijken: 'Wijk', buurten: 'Buurt', provincies: 'Provincie', gemeenten: 'Gemeente' }[level];
  // Rank mode 'sort' on a dataset column: the score column shows that column's score and says so.
  const scoreKey = sortDs ? sortDs.key : rankKey;
  const base = scoreHeader(scoreKey, datasets);
  const sh = sortDs ? { label: base.label, title: `${base.title} · volgt de sortering` } : base;
  const single = scoreKey !== 'overall';
  // Breakdown column (points per theme) while a score layer ranks the list.
  const scoreLayer = !sortDs && datasets.find(d => d.key === rankKey)?.unit === 'score' ? rankKey : null;
  const legendThemes = scoreLayer ? breakdownLegend(rows, scoreLayer) : [];
  const head = `<tr>
    ${headerCell('rank', '#', 'col-rank', ui.rankMode === 'sort' ? 'Rang (volgt de sortering)' : 'Rang')}
    ${headerCell('name', nameLabel, 'col-name')}
    ${headerCell('overall', sh.label, `col-score${single ? ' is-single' : ''}`, sh.title, 'score')}
    ${scoreLayer ? `<th scope="col" class="col-breakdown" title="Punten per thema: ${esc(legendThemes.map(t => t.label).join(', '))}">Opbouw</th>` : ''}
    ${datasets.map(d => headerCell(d.key, d.label, `col-data${d.higherIsBetter == null ? ' is-neutral' : ''}${rankKey === d.key ? ' is-rank-key' : ''}`, rankKey === d.key ? `${directionHint(d)} · rangschikt de lijst` : directionHint(d), d.key)).join('')}
  </tr>`;
  // Same colour scale as the map (scale.js), built per column from the listed rows:
  // bar width = score/percentile, bar colour = the value's map class, red mark = outlier.
  const method = getScaleMethod();
  const scales = Object.fromEntries(datasets.map(d => [d.key, buildScale(rows.map(r => r.values[d.key]), { method })]));
  const scoreScale = buildScale(rows.map(r => r.score), { method });
  const body = rows.map(r => {
    const scoreColor = r.score != null ? scoreScale.colorFor(r.score) : null;
    const cells = datasets.map(d => {
      const v = r.values[d.key];
      const s = d.higherIsBetter == null ? r.pct[d.key] : r.scores[d.key];
      const bar = s != null
        ? `<span class="list-bar" style="width:${Math.max(4, Math.round(s))}%;background:${scales[d.key].colorFor(v)}"></span>` : '';
      const side = scales[d.key].outlierSide(v);
      const mark = side ? `<span class="list-outlier" title="${outlierLabel(side)}" aria-label="${outlierLabel(side)}"></span>` : '';
      const tip = s != null && d.higherIsBetter != null ? ` title="Score ${formatScore(s)}${side ? ` · ${outlierLabel(side)}` : ''}"` : side ? ` title="${outlierLabel(side)}"` : '';
      return `<td class="col-data${v == null ? ' is-missing' : ''}${side ? ' is-outlier' : ''}${rankKey === d.key ? ' is-rank-key' : ''}"${tip}><span class="list-val">${formatValue(v, d.unit)}${mark}</span>${bar}</td>`;
    }).join('');
    return `<tr data-code="${esc(r.code)}" tabindex="0"${r.rank == null ? ' class="is-unranked"' : ''}>
      <td class="col-rank">${r.rank ?? '—'}</td>
      <th scope="row" class="col-name"><span class="list-name">${esc(r.name)}</span>${r.nonResidential ? `<small class="list-nonres" title="${esc(r.nonResidential)}: telt niet mee in de ranglijst">${esc(r.nonResidential)}</small>` : ''}
        <button type="button" class="list-map-btn" title="Toon op kaart" aria-label="Toon ${esc(r.name)} op kaart">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>
        </button></th>
      <td class="col-score">${scoreColor ? `<span class="list-chip" style="background:${scoreColor}"></span>` : ''}<strong>${formatScore(r.score)}</strong><small>${!single && r.score != null ? `${r.used}/${r.possible}` : ''}</small></td>
      ${scoreLayer ? `<td class="col-breakdown">${themeBarHtml(alignThemes(themeBreakdown(scoreResult(scoreLayer, r.code)), legendThemes), { cls: 'score-themes list-themes' })}</td>` : ''}
      ${cells}
    </tr>`;
  }).join('');
  return `<table class="list-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}
