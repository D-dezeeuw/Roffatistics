import { bindDOM, run, setValue } from 'spektrum';
import { initMap, getMap, setMapScope, refreshMapSize } from './modules/map.js';
import { initOverlays, setOverlaysEnabled, setProvinceData, setMunicipalityData, applyDataset, getActiveTier, getActiveGemeente, getActiveGemeenteName, setPinnedGemeente, clearPinnedGemeente, focusNederlandArea } from './modules/overlays.js';
import { fetchCBS, normalizeProvinces, normalizeCrime, CBS_SELECT, CBS_TABLE, CBS_PERIOD, DATASETS } from './modules/datasets.js';
import { initState, getState, setState, onStateChange } from './modules/state.js';
import { enableRotterdam, disableRotterdam, applyRotterdamDataset, focusArea, pinActiveArea, clearPinnedArea, getActiveArea } from './modules/rotterdam.js';
import { updateLegend }                   from './modules/legend.js';
import { initSplash }                     from './modules/splash.js';
import { initList, setNationalRows }      from './modules/list.js';   // Ranglijst view
import { initSearch }                     from './modules/search.js';
import { initDashboard }                  from './modules/dashboard.js';

// ── Slot A (primary) ─────────────────────────────────────────────────────────
setValue('panel.visible',          false);
setValue('panel.pinned',           false);
setValue('panel.name',             '');
setValue('panel.code',             '');
setValue('panel.population',       '');
setValue('panel.density',          '');
setValue('panel.avgIncome',        '');
setValue('panel.crimeRate',        '');
setValue('panel.totalCrimes',      '');
setValue('panel.catVermogen',      '');
setValue('panel.catDiefstalInbraak', '');
setValue('panel.catVernieling',    '');
setValue('panel.catGeweld',        '');
setValue('panel.catMishandeling',  '');
setValue('panel.lowEdu',           '');
setValue('panel.medEdu',           '');
setValue('panel.highEdu',          '');
setValue('panel.wozValue',         '');
setValue('panel.totalJobs',        '');
setValue('panel.pop65plus',        '');
setValue('panel.migrationBalance', '');
setValue('panel.nonWesternPct',    '');
// ── Slot B (compare) ─────────────────────────────────────────────────────────
setValue('panel2.name',             '');
setValue('panel2.code',             '');
setValue('panel2.population',       '');
setValue('panel2.density',          '');
setValue('panel2.avgIncome',        '');
setValue('panel2.crimeRate',        '');
setValue('panel2.totalCrimes',      '');
setValue('panel2.catVermogen',      '');
setValue('panel2.catDiefstalInbraak', '');
setValue('panel2.catVernieling',    '');
setValue('panel2.catGeweld',        '');
setValue('panel2.catMishandeling',  '');
setValue('panel2.lowEdu',           '');
setValue('panel2.medEdu',           '');
setValue('panel2.highEdu',          '');
setValue('panel2.wozValue',         '');
setValue('panel2.totalJobs',        '');
setValue('panel2.pop65plus',        '');
setValue('panel2.migrationBalance', '');
setValue('panel2.nonWesternPct',    '');
// ── Legend ────────────────────────────────────────────────────────────────────
setValue('legend.title',           '');
setValue('legend.min',             '');
setValue('legend.max',             '');

bindDOM();
run();

initSplash();
const initialState = initState();
initMap();
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
    provinceRows = normalizeProvinces(raw);
    setProvinceData(provinceRows); setNationalRows('provincie', provinceRows);
    if (getState().scope === 'nederland') return activateDataset(getState().dataset);
  })
  .catch(() => { /* CBS unavailable — map renders with flat fill, no legend */ });

// Merge crime data into provinces in the background (best-effort).
fetchCBS('83648NED', CRIME_FILTER, CRIME_SELECT)
  .then(async crimeRaw => {
    await provincesReady;
    const crimeLookup = Object.fromEntries(normalizeCrime(crimeRaw).map(r => [r.regionCode, r]));
    provinceRows = provinceRows.map(r => ({ ...r, ...crimeLookup[r.regionCode] }));
    setProvinceData(provinceRows); setNationalRows('provincie', provinceRows);
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
    gemeenteRows = normalizeProvinces(rawGM).filter(r => r.regionCode);
    setMunicipalityData(gemeenteRows); setNationalRows('gemeente', gemeenteRows);
    refreshMunicipalityView();
    // Merge municipality crime in the background.
    return fetchCBS('83648NED', GM_CRIME_FILTER, CRIME_SELECT, undefined, undefined, 2000)
      .then(crimeRawGM => {
        const crimeLookup = Object.fromEntries(normalizeCrime(crimeRawGM).map(r => [r.regionCode, r]));
        gemeenteRows = gemeenteRows.map(r => ({ ...r, ...crimeLookup[r.regionCode] }));
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

async function activateDataset(key) {
  const ds = DATASETS[key];
  if (getState().scope === 'rotterdam') {
    const { min, max, level, hasData } = applyRotterdamDataset(key);
    const suffix = hasData ? (level === 'buurt' ? 'buurt' : 'wijk') : 'geen wijkdata';
    await updateLegend({ title: `${ds.title} · ${suffix}`, min, max, dataset: key, showNoData: true });
    return;
  }
  const tier       = getActiveTier();
  const useGemeente = tier === 'municipality' || tier === 'buurt';
  const rows       = useGemeente ? gemeenteRows : provinceRows;
  if (!rows.length) return;
  const title = useGemeente ? `${ds.title} · gemeente` : ds.title;
  const { min, max } = applyDataset(rows, ds.key);
  await updateLegend({ title, min, max, dataset: key });
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

onStateChange(({ state, changed, source }) => {
  if (changed.includes('view')) showView(state.view);
  if (changed.includes('scope')) { applyScope(state.scope); return; }
  if (changed.includes('dataset')) {
    syncDatasetButtons(state.dataset);
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
