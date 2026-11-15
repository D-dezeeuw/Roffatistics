import { bindDOM, run, setValue } from 'spektrum';
import { initMap, getMap, setMapScope, refreshMapSize } from './modules/map.js';
import { initOverlays, setOverlaysEnabled, setProvinceData, setMunicipalityData, applyDataset, getActiveTier, getActiveGemeente, getActiveGemeenteName, setPinnedGemeente, clearPinnedGemeente, focusNederlandArea } from './modules/overlays.js';
import { fetchCBS, normalizeProvinces, normalizeCrime, CBS_SELECT, CBS_TABLE, CBS_PERIOD, DATASETS, groupDatasets, datasetInScope, datasetFor, crimeValues, isCrimeDataset } from './modules/datasets.js';
import { PANEL_FIELDS }                   from './modules/panel.js';
import { initState, getState, setState, onStateChange } from './modules/state.js';
import { enableRotterdam, disableRotterdam, applyRotterdamDataset, focusArea, pinActiveArea, clearPinnedArea, getActiveArea } from './modules/rotterdam.js';
import { updateLegend, initScaleToggle, initLegendCollapse, SCALE_EVENT } from './modules/legend.js';
import { initSplash }                     from './modules/splash.js';
import { initList, setNationalRows }      from './modules/list.js';   // Ranglijst view
import { initSearch }                     from './modules/search.js';
import { initDashboard }                  from './modules/dashboard.js';
import { initExplain }                    from './modules/explain.js';
import { initCrimeToggles }               from './modules/crime-mode.js';
import { initAreaModal, openAreaModal, COMPARE_EVENT } from './modules/area-modal.js';
import { initSpacePan }                   from './modules/space-pan.js';
import { rowsWithWoonscore, setPersonalPreset, assignScore } from './modules/presets.js';
import { loadGemeenteGroup, missingDetailGroups } from './modules/herkomst-gemeente.js';
import { presetFromScore, scoreTitle }    from './modules/wizard-model.js';
import { initWizard }                     from './modules/wizard.js';
import { peekRotterdamAreas }             from './modules/areas.js';

// ── Slot A (primary) ─────────────────────────────────────────────────────────
setValue('panel.visible',          false);
setValue('panel.pinned',           false);
// Slot A + B fields (panel.js PANEL_FIELDS)
for (const key of PANEL_FIELDS) { setValue(`panel.${key}`, ''); setValue(`panel2.${key}`, ''); }
for (const key of ['name', 'code']) { setValue(`panel.${key}`, ''); setValue(`panel2.${key}`, ''); }
// ── Legend ────────────────────────────────────────────────────────────────────
setValue('legend.title',           '');

bindDOM();
run();

initSplash();
const initialState = initState();
setPersonalPreset(presetFromScore(initialState.score));   // before any area is scored (the Woonscore's active preset)
initMap();
initSpacePan(document.getElementById('map'));   // hold Space: drag the map, never click a feature
await initOverlays({ enabled: initialState.scope === 'nederland' });

const CBS_FILTER   = `startswith(RegioS,'PV') and Perioden eq '${CBS_PERIOD}'`;
const CRIME_SELECT = 'RegioS,SoortMisdrijf,TotaalGeregistreerdeMisdrijven_1,GeregistreerdeMisdrijvenPer1000Inw_3';
const CRIME_FILTER = `startswith(RegioS,'PV') and Perioden eq '${CBS_PERIOD}' and (SoortMisdrijf eq 'T001161' or SoortMisdrijf eq 'CRI1000' or SoortMisdrijf eq 'CRI1100' or SoortMisdrijf eq 'CRI2000' or SoortMisdrijf eq 'CRI3000' or SoortMisdrijf eq 'CRI3100')`;

const GM_FILTER       = `startswith(RegioS,'GM') and Perioden eq '${CBS_PERIOD}'`;
const GM_CRIME_FILTER = `startswith(RegioS,'GM') and Perioden eq '${CBS_PERIOD}' and (SoortMisdrijf eq 'T001161' or SoortMisdrijf eq 'CRI1000' or SoortMisdrijf eq 'CRI1100' or SoortMisdrijf eq 'CRI2000' or SoortMisdrijf eq 'CRI3000' or SoortMisdrijf eq 'CRI3100')`;

let provinceRows  = [];
let gemeenteRows  = [];

// ── Province data ─────────────────────────────────────────────────────────────
// Demographics are fetched first and independently so a crime-fetch failure
// can never block map coloring or panel data.

// Not awaited: the Rotterdam scope must not wait for national CBS data.
const provincesReady = fetchCBS(CBS_TABLE, CBS_FILTER, CBS_SELECT)
  .then(raw => {
    provinceRows = rowsWithWoonscore(normalizeProvinces(raw));
    setProvinceData(provinceRows); setNationalRows('provincie', provinceRows);
    if (getState().scope === 'nederland') return activateDataset(getState().dataset);
  })
  .catch(() => { /* CBS unavailable — map renders with flat fill, no legend */ });

// Merge crime data into provinces in the background (best-effort).
fetchCBS('83648NED', CRIME_FILTER, CRIME_SELECT)
  .then(async crimeRaw => {
    await provincesReady;
    const crimeLookup = Object.fromEntries(normalizeCrime(crimeRaw).map(r => [r.regionCode, r]));
    provinceRows = rowsWithWoonscore(provinceRows.map(r => ({ ...r, ...crimeLookup[r.regionCode] })));
    setProvinceData(provinceRows); setNationalRows('provincie', provinceRows);
    // Re-colour: the Woonscore (and crime layers) change once crime is merged.
    if (getState().scope === 'nederland' && getActiveTier() !== 'municipality' && getActiveTier() !== 'buurt') activateDataset(getState().dataset);
  })
  .catch(() => { /* crime unavailable — panel shows dashes for crime fields */ });

// ── Municipality data — prefetch at startup ───────────────────────────────────
// Start fetching in the background immediately so it is ready by the time the
// user zooms to municipality level. Stored in gemeenteRows + overlays module.

// Called after each setMunicipalityData to re-apply coloring and refresh the
// panel if the user is already at municipality tier.
function refreshMunicipalityView() {
  const tier = getActiveTier();
  if (tier !== 'municipality' && tier !== 'buurt') return;
  if (getState().scope !== 'nederland') return;
  activateDataset(getState().dataset);
  const code = getActiveGemeente();
  const name = getActiveGemeenteName();
  if (!code) return;
  const panelEl = document.getElementById('panel');
  if (!panelEl.classList.contains('has-region')) return;
  const data = gemeenteRows.find(d => d.regionCode === code) ?? null;
  if (!data) return;
  import('./modules/panel.js').then(({ showPanel }) => showPanel({ name, code, data }));
}

fetchCBS(CBS_TABLE, GM_FILTER, CBS_SELECT)
  .then(rawGM => {
    gemeenteRows = rowsWithWoonscore(normalizeProvinces(rawGM).filter(r => r.regionCode));
    setMunicipalityData(gemeenteRows); setNationalRows('gemeente', gemeenteRows);
    refreshMunicipalityView();
    // Merge municipality crime in the background.
    return fetchCBS('83648NED', GM_CRIME_FILTER, CRIME_SELECT, undefined, undefined, 2000)
      .then(crimeRawGM => {
        const crimeLookup = Object.fromEntries(normalizeCrime(crimeRawGM).map(r => [r.regionCode, r]));
        gemeenteRows = rowsWithWoonscore(gemeenteRows.map(r => ({ ...r, ...crimeLookup[r.regionCode] })));
        setMunicipalityData(gemeenteRows); setNationalRows('gemeente', gemeenteRows);
        refreshMunicipalityView();
      })
      .catch(() => { /* crime unavailable at gemeente level */ });
  })
  .catch(() => { /* CBS unavailable — gemeente layer will render with flat fill */ });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDropdown();
    import('./modules/panel.js').then(({ hidePanel }) => hidePanel());
  }
});

document.querySelector('.panel-close').addEventListener('click', () => {
  clearPinnedGemeente();
  clearPinnedArea();
  import('./modules/panel.js').then(({ hidePanel }) => hidePanel());
});

document.querySelector('.panel-pin-btn').addEventListener('click', () => {
  if (getState().scope === 'rotterdam') {
    if (!getActiveArea()) return;
    pinActiveArea();
    import('./modules/panel.js').then(({ pinPanel }) => pinPanel());
    return;
  }
  const code = getActiveGemeente();
  const name = getActiveGemeenteName();
  if (!code) return;
  setPinnedGemeente(code, name);
  import('./modules/panel.js').then(({ pinPanel }) => pinPanel());
});

// Map click keeps the quick panel (and compare); "Details" opens the area modal.
document.querySelector('.panel-details-btn')?.addEventListener('click', e => {
  const code = getActiveArea()?.code;
  if (getState().scope === 'rotterdam' && code) openAreaModal(code, e.currentTarget);
});

// Modal "Vergelijk": show the area on the map, pinned, so the next click fills slot B.
document.addEventListener(COMPARE_EVENT, async ({ detail: { code } }) => {
  if (getState().scope !== 'rotterdam' || !code) return;
  const toMap = getState().view !== 'map';
  setState({ area: code, view: 'map' }, { source: 'map' });   // 'map': the state listener does not focus a second time
  if (toMap) await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));   // map size back first
  clearPinnedArea();
  const panel = await import('./modules/panel.js');
  await panel.clearCompare();
  if (!(await focusArea(code))) return;
  pinActiveArea();
  panel.pinPanel();
});

document.querySelector('.panel-compare-close').addEventListener('click', () => {
  clearPinnedGemeente();
  clearPinnedArea();
  import('./modules/panel.js').then(({ clearCompare }) => clearCompare());
});

// ── Panel toggle ──────────────────────────────────────────────────────────────

const panelEl        = document.getElementById('panel');
const panelToggleBtn = document.querySelector('.panel-toggle-btn');

panelEl.addEventListener('transitionend', e => {
  if (e.propertyName === 'width') getMap().invalidateSize();
});

panelToggleBtn.addEventListener('click', () => {
  const opening = !panelEl.classList.contains('panel-open');
  panelEl.classList.toggle('panel-open', opening);
  panelEl.setAttribute('aria-hidden', opening ? 'false' : 'true');
  panelToggleBtn.setAttribute('aria-pressed', opening);
});

document.addEventListener('panel-toggle', ({ detail: { open } }) => {
  panelToggleBtn.setAttribute('aria-pressed', open);
});

// ── Layers dropdown ───────────────────────────────────────────────────────────

const layersBtn      = document.querySelector('.layers-btn');
const layersDropdown = document.querySelector('.layers-dropdown');

// Built from DATASETS, one section per DATASET_GROUPS entry. Rotterdam-only
// layers carry data-scope="rotterdam" and are hidden in the Nederland view (CSS).
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// A mixed section (Veiligheid) names the layers it hides in the Nederland view,
// so the shorter list there does not read as missing data.
layersDropdown.innerHTML = groupDatasets().map(g => {
  const rtmOnly = g.scope === 'all' ? g.datasets.filter(d => d.scope === 'rotterdam').length : 0;
  return `
  <li class="layer-group" role="group" aria-labelledby="layer-group-${g.key}"${g.scope === 'rotterdam' ? ' data-scope="rotterdam"' : ''}>
    <span class="layer-group-title" id="layer-group-${g.key}">${escHtml(g.label)}</span>
    <ul class="layer-group-list" role="none">${g.datasets.map(d => `
      <li role="none"><button class="layer-opt" type="button" data-dataset="${d.key}" role="option"${d.scope === 'rotterdam' ? ' data-scope="rotterdam"' : ''}>${escHtml(d.label)}</button></li>`).join('')}${rtmOnly ? `
      <li role="none" class="layer-hint" data-scope="nederland">+${rtmOnly} lagen per wijk/buurt in de Rotterdam-weergave</li>` : ''}
    </ul>
  </li>`;
}).join('');

function closeDropdown() {
  layersDropdown.classList.remove('open');
  layersBtn.setAttribute('aria-expanded', 'false');
}

layersBtn.addEventListener('click', e => {
  e.stopPropagation();
  const opening = !layersDropdown.classList.contains('open');
  layersDropdown.classList.toggle('open', opening);
  layersBtn.setAttribute('aria-expanded', opening);
});

document.addEventListener('click', closeDropdown);

document.querySelectorAll('.layer-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    closeDropdown();
    setState({ dataset: btn.dataset.dataset }, { source: 'layers' });
  });
});

document.addEventListener('tier-change', async () => {
  if (getState().scope !== 'nederland') return;
  await activateDataset(getState().dataset);
});

document.addEventListener('rotterdam-level-change', async () => {
  if (getState().scope !== 'rotterdam') return;
  await activateDataset(getState().dataset);
});

// Legend extras: the (i) button explains the visible layer; the crime toggle shows for crime layers,
// the Standaard / Gelijk / Jouw score switcher (and Reset) for the Woonscore.
function syncLegendExtras(key) {
  const legend = document.getElementById('legend');
  legend?.classList.toggle('legend-has-crime', isCrimeDataset(key));
  legend?.classList.toggle('legend-has-score', DATASETS[key]?.unit === 'score');
  const info = legend?.querySelector('.legend-info');
  if (info) {
    info.dataset.explain = key;
    info.setAttribute('aria-label', `Uitleg: ${DATASETS[key]?.title ?? 'deze laag'}`);
  }
}

async function activateDataset(key) {
  const mode = getState().crime;
  const base = datasetFor(key, mode);
  const ds = base.unit === 'score' ? { ...base, title: scoreTitle(getState().score, base.title) } : base;   // "Woonscore · jouw wensen"
  syncLegendExtras(key);
  if (getState().scope === 'rotterdam') {
    const { scale, level, hasData } = applyRotterdamDataset(key, mode);
    const suffix = hasData ? (level === 'buurt' ? 'buurt' : 'wijk') : 'geen wijkdata';
    await updateLegend({ title: `${ds.title} · ${suffix}`, scale, dataset: key, mode, showNoData: true });
    return;
  }
  const tier       = getActiveTier();
  const useGemeente = tier === 'municipality' || tier === 'buurt';
  const rows       = useGemeente ? gemeenteRows : provinceRows;
  if (!rows.length) return;
  const title = !datasetInScope(key, 'nederland') ? `${ds.title} · alleen in Rotterdam-weergave`
    : useGemeente ? `${ds.title} · gemeente` : ds.title;
  const { scale } = applyDataset(rows.map(r => crimeValues(r, mode)), ds.key);
  await updateLegend({ title, scale, dataset: key, mode });
}

// ── Scope (Rotterdam | Nederland) ─────────────────────────────────────────────

const scopeSelect = document.querySelector('.scope-select');
scopeSelect.addEventListener('change', () => setState({ scope: scopeSelect.value }, { source: 'scope' }));

let scopeSeq = 0;
async function applyScope(scope, { initial = false } = {}) {
  const seq = ++scopeSeq;
  scopeSelect.value = scope;
  document.body.classList.toggle('scope-rotterdam', scope === 'rotterdam');
  document.body.classList.toggle('scope-nederland', scope === 'nederland');
  clearPinnedGemeente();
  clearPinnedArea();
  import('./modules/panel.js').then(({ hidePanel }) => hidePanel());

  if (scope === 'rotterdam') {
    await setOverlaysEnabled(false);
    try {
      const areas = await enableRotterdam({ onSelect: a => setState({ area: a.code }, { source: 'map' }) });
      if (seq !== scopeSeq) return;
      setMapScope('rotterdam', { bounds: areas.bounds });
      await activateDataset(getState().dataset);
      const area = getState().area;
      if (area && (area.startsWith('WK') || area.startsWith('BU'))) await focusArea(area);
    } catch (err) {
      console.warn('Rotterdam areas unavailable:', err);
    }
    return;
  }
  disableRotterdam();
  setMapScope('nederland', { fit: !initial });
  if (!initial) await setOverlaysEnabled(true);   // initOverlays already enabled them on a Nederland start
  if (seq === scopeSeq) await activateDataset(getState().dataset);
  if (seq === scopeSeq && /^(PV|GM)/.test(getState().area ?? '')) focusNederlandArea(getState().area);   // search / deep link
}

// ── View switcher (Kaart | Dashboard | Ranglijst) ─────────────────────────────

const viewButtons = document.querySelectorAll('.view-opt');
viewButtons.forEach(btn => btn.addEventListener('click', () => setState({ view: btn.dataset.view }, { source: 'view-switch' })));

function showView(view) {
  for (const v of ['map', 'dashboard', 'list']) {
    document.getElementById(`view-${v}`).hidden = v !== view;
  }
  viewButtons.forEach(b => {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (view === 'map') requestAnimationFrame(refreshMapSize);
}

function syncDatasetButtons(key) {
  document.querySelectorAll('.layer-opt')
    .forEach(b => b.classList.toggle('active', b.dataset.dataset === key));
}

// A new `score` (wizard, switcher, Reset, hash) rescores the Woonscore of every
// loaded area in place. Runs before the list, modal and wizard listeners (subscribed later).
function applyPersonalScore(score) {
  const preset = presetFromScore(score);
  setPersonalPreset(preset);
  // Gemeenschap with a detailed herkomst group (gemeenten only, CBS 85458NED):
  // fetched on demand, then rescored once. On failure the factor is skipped.
  for (const g of missingDetailGroups(preset)) {
    loadGemeenteGroup(g).then(() => {
      if (getState().score !== score) return;
      applyPersonalScore(score);
      if (DATASETS[getState().dataset]?.unit === 'score') activateDataset(getState().dataset);
    }).catch(() => { /* CBS unavailable */ });
  }
  const rd = peekRotterdamAreas();
  if (rd) {
    assignScore(rd.wijken, 'woonscore');
    assignScore(rd.buurten, 'woonscore', { parents: rd.wijken });
  }
  if (provinceRows.length) { provinceRows = rowsWithWoonscore(provinceRows); setProvinceData(provinceRows); setNationalRows('provincie', provinceRows); }
  if (gemeenteRows.length) { gemeenteRows = rowsWithWoonscore(gemeenteRows); setMunicipalityData(gemeenteRows); setNationalRows('gemeente', gemeenteRows); }
}

onStateChange(({ state, changed, source }) => {
  if (changed.includes('score')) {
    applyPersonalScore(state.score);
    if (DATASETS[state.dataset]?.unit === 'score' && !changed.includes('dataset') && !changed.includes('scope')) activateDataset(state.dataset);
  }
  if (changed.includes('view')) showView(state.view);
  if (changed.includes('scope')) { applyScope(state.scope); return; }
  if (changed.includes('dataset')) {
    syncDatasetButtons(state.dataset);
    activateDataset(state.dataset);
  } else if (changed.includes('crime') && isCrimeDataset(state.dataset)) {
    activateDataset(state.dataset);
  }
  if (changed.includes('area') && state.area && source !== 'map' && state.scope === 'rotterdam') {
    // Arriving from another view the map was hidden (size 0): focus after showView's resize frame.
    if (changed.includes('view')) requestAnimationFrame(() => focusArea(state.area));
    else focusArea(state.area);
  }
  if (changed.includes('area') && state.area && source !== 'map' && state.scope === 'nederland') {
    focusNederlandArea(state.area);   // search: gemeente / provincie
  }
});

syncDatasetButtons(initialState.dataset);
showView(initialState.view);
initList();   // after showView so a #view=list start renders visible
initDashboard();
applyScope(initialState.scope, { initial: true });
initSearch();
initCrimeToggles();
initScaleToggle();
initLegendCollapse();
// Schaal: Kwantiel | Lineair — recolour the map and legend from the shown set.
document.addEventListener(SCALE_EVENT, () => activateDataset(getState().dataset));
initExplain();
initAreaModal();
initWizard({ rows: () => (gemeenteRows.length && (getActiveTier() === 'municipality' || getActiveTier() === 'buurt' || !provinceRows.length)
  ? { level: 'gemeente', rows: gemeenteRows } : { level: 'provincie', rows: provinceRows }) });
