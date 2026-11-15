import { bindDOM, run, setValue } from 'spektrum';
import { initMap, getMap, setMapScope, refreshMapSize, setBasemap, BASEMAP_STORAGE_KEY } from './modules/map.js';
import { initOverlays, setOverlaysEnabled, setProvinceData, setMunicipalityData, applyDataset, getActiveTier, focusNederlandArea, drillIntoGemeente, gemeenteName } from './modules/overlays.js';
import { applyDrillDataset }            from './modules/nl-drill.js';
import { rescoreNlAreas }               from './modules/nl-areas.js';
import { loadOvAfstand, withOvValues }   from './modules/ov.js';
import { fetchCBS, normalizeProvinces, normalizeCrime, CBS_SELECT, CBS_TABLE, CBS_PERIOD, DATASETS, groupDatasets, datasetInScope, datasetFor, crimeValues, isCrimeDataset } from './modules/datasets.js';
import { initComparePanel, toggleCompare, closeCompare, addToCompare } from './modules/compare-panel.js';
import { initState, getState, setState, onStateChange } from './modules/state.js';
import { enableRotterdam, disableRotterdam, applyRotterdamDataset, focusArea } from './modules/rotterdam.js';
import { updateLegend, initScaleToggle, initLegendCollapse, SCALE_EVENT } from './modules/legend.js';
import { initSplash }                     from './modules/splash.js';
import { initNavMenu }                    from './modules/nav-menu.js';
import { initList, setNationalRows, setListOptions } from './modules/list.js';   // Ranglijst view
import { initSearch }                     from './modules/search.js';
import { initDashboard }                  from './modules/dashboard.js';
import { initExplain }                    from './modules/explain.js';
import { initLegal }                      from './modules/legal.js';
import { initCrimeToggles }               from './modules/crime-mode.js';
import { initAreaModal, openAreaModal, isAreaModalOpen, COMPARE_EVENT, DRILL_EVENT, setNationalAreas } from './modules/area-modal.js';
import { initSpacePan }                   from './modules/space-pan.js';
import { rowsWithWoonscore, setPersonalPreset, assignScore } from './modules/presets.js';
import { loadGemeenteGroup, missingDetailGroups } from './modules/herkomst-gemeente.js';
import { presetFromScore, scoreTitle }    from './modules/wizard-model.js';
import { initWizard }                     from './modules/wizard.js';
import { initShare }                      from './modules/share-dialog.js';
import { parseShareHash, hasShareExtras } from './modules/share-link.js';
import { applyTheme }                     from './modules/theme.js';
import { initShortcuts }                  from './modules/shortcuts.js';
import { peekRotterdamAreas }             from './modules/areas.js';
import { peekNlAreas }                    from './modules/nl-areas.js';
import { loadBouwjaar, onBouwLoaded, addBouwShares, isBouwKey, isBouwLoaded, presetUsesBouw } from './modules/bouwjaar-pc4.js';
import { loadPc4Herkomst, onPc4Loaded, addPc4Shares, isPc4Key, isPc4Loaded, presetUsesPc4 } from './modules/herkomst-pc4.js';
import { loadGemeenteRegio, isRegioLoaded, isRegionMetric, withRegionShares } from './modules/herkomst-regio.js';
import { showLoader, hideLoader, setLoaderProgress, withLoader } from './modules/loader.js';

// ── Legend ────────────────────────────────────────────────────────────────────
setValue('legend.title',           '');

bindDOM();
run();

initNavMenu();   // header ☰ menu (wizard, Delen, Uitleg, Vergelijken, Over; Zoeken on phones)
initSplash();
// ── Shared link ("Delen", share-link.js) ─────────────────────────────────────
// The one-shot view keys (map, modal, lvl/rank/sort, basemap, theme) are read
// here, before initState() rewrites the address bar without them.
let scopeRun = Promise.resolve();   // the last scope switch; map position and modal wait for it
const sharedView = parseShareHash(globalThis.location?.hash ?? '');
let shareStorage = null;
try { shareStorage = globalThis.localStorage; } catch { /* storage blocked */ }
function applySharedLook(ex, { live = false } = {}) {
  if (ex.theme) applyTheme(ex.theme, document, shareStorage);   // stored: the theme switch picks it up
  if (ex.basemap) {
    if (live) setBasemap(ex.basemap);
    else try { shareStorage?.setItem(BASEMAP_STORAGE_KEY, ex.basemap); } catch { /* storage blocked */ }   // initMap reads it
  }
}
async function applySharedView(ex) {
  if (ex.list) setListOptions(ex.list);
  await scopeRun.catch(() => {});
  if (ex.map) getMap()?.setView([ex.map.lat, ex.map.lng], ex.map.zoom, { animate: false });
  const area = getState().area;
  if (ex.modal && area) openAreaModal(area);
}
applySharedLook(sharedView);
// A shared link pasted into this tab: state.js applies the address-bar parts
// (its listener runs after this one), then the view keys follow.
globalThis.addEventListener?.('hashchange', () => {
  const ex = parseShareHash(location.hash);
  if (!hasShareExtras(ex)) return;
  applySharedLook(ex, { live: true });
  setTimeout(() => applySharedView(ex), 0);
});
const initialState = initState();
showLoader('Kaart laden…');   // until the first map data is drawn (end of this file)
setPersonalPreset(presetFromScore(initialState.score));   // before any area is scored (the Woonscore's active preset)
initMap();
setLoaderProgress(0.2);
initSpacePan(document.getElementById('map'));   // hold Space: drag the map, never click a feature
await initOverlays({ enabled: initialState.scope === 'nederland' });
setLoaderProgress(0.5);

const CBS_FILTER   = `startswith(RegioS,'PV') and Perioden eq '${CBS_PERIOD}'`;
const CRIME_SELECT = 'RegioS,SoortMisdrijf,TotaalGeregistreerdeMisdrijven_1,GeregistreerdeMisdrijvenPer1000Inw_3';
const CRIME_FILTER = `startswith(RegioS,'PV') and Perioden eq '${CBS_PERIOD}' and (SoortMisdrijf eq 'T001161' or SoortMisdrijf eq 'CRI1000' or SoortMisdrijf eq 'CRI1100' or SoortMisdrijf eq 'CRI2000' or SoortMisdrijf eq 'CRI3000' or SoortMisdrijf eq 'CRI3100')`;

const GM_FILTER       = `startswith(RegioS,'GM') and Perioden eq '${CBS_PERIOD}'`;
const GM_CRIME_FILTER = `startswith(RegioS,'GM') and Perioden eq '${CBS_PERIOD}' and (SoortMisdrijf eq 'T001161' or SoortMisdrijf eq 'CRI1000' or SoortMisdrijf eq 'CRI1100' or SoortMisdrijf eq 'CRI2000' or SoortMisdrijf eq 'CRI3000' or SoortMisdrijf eq 'CRI3100')`;

let provinceRows  = [];
let gemeenteRows  = [];
// Nederland tiers that show gemeente rows: the gemeente tier and the wijk/buurt drill-down under it.
const atGemeenteTier = (tier = getActiveTier()) => tier === 'municipality' || tier === 'wijk' || tier === 'buurt';
const atDrillTier = (tier = getActiveTier()) => tier === 'wijk' || tier === 'buurt';

// ── Province data ─────────────────────────────────────────────────────────────
// Demographics are fetched first and independently so a crime-fetch failure
// can never block map coloring or panel data.

// Not awaited: the Rotterdam scope must not wait for national CBS data.
const provincesReady = fetchCBS(CBS_TABLE, CBS_FILTER, CBS_SELECT)
  .then(raw => {
    provinceRows = rowsWithWoonscore(normalizeProvinces(raw));
    setProvinceData(provinceRows); setNationalRows('provincie', provinceRows); setNationalAreas('provincie', provinceRows);
    if (getState().scope === 'nederland') return activateDataset(getState().dataset);
  })
  .catch(() => { /* CBS unavailable — map renders with flat fill, no legend */ });

// Merge crime data into provinces in the background (best-effort).
fetchCBS('83648NED', CRIME_FILTER, CRIME_SELECT)
  .then(async crimeRaw => {
    await provincesReady;
    const crimeLookup = Object.fromEntries(normalizeCrime(crimeRaw).map(r => [r.regionCode, r]));
    provinceRows = rowsWithWoonscore(provinceRows.map(r => ({ ...r, ...crimeLookup[r.regionCode] })));
    setProvinceData(provinceRows); setNationalRows('provincie', provinceRows); setNationalAreas('provincie', provinceRows);
    // Re-colour: the Woonscore (and crime layers) change once crime is merged.
    if (getState().scope === 'nederland' && !atGemeenteTier()) activateDataset(getState().dataset);
  })
  .catch(() => { /* crime unavailable — panel shows dashes for crime fields */ });

// ── Municipality data — prefetch at startup ───────────────────────────────────
// Start fetching in the background immediately so it is ready by the time the
// user zooms to municipality level. Stored in gemeenteRows + overlays module.

// Called after each setMunicipalityData to re-apply coloring if the user is
// already at municipality tier (Vergelijken re-reads the rows itself).
function refreshMunicipalityView() {
  if (!atGemeenteTier()) return;
  if (getState().scope !== 'nederland') return;
  activateDataset(getState().dataset);
}

fetchCBS(CBS_TABLE, GM_FILTER, CBS_SELECT)
  .then(async rawGM => {
    const ov = await loadOvAfstand();   // prebuilt metro/tram distances per gemeente ({} when it fails)
    gemeenteRows = rowsWithWoonscore(withRegionShares(normalizeProvinces(rawGM).filter(r => r.regionCode).map(r => withOvValues(r, r.regionCode, ov))));   // regions: once loaded
    setMunicipalityData(gemeenteRows); setNationalRows('gemeente', gemeenteRows); setNationalAreas('gemeente', gemeenteRows);
    refreshMunicipalityView();
    // Merge municipality crime in the background.
    return fetchCBS('83648NED', GM_CRIME_FILTER, CRIME_SELECT, undefined, undefined, 2000)
      .then(crimeRawGM => {
        const crimeLookup = Object.fromEntries(normalizeCrime(crimeRawGM).map(r => [r.regionCode, r]));
        gemeenteRows = rowsWithWoonscore(gemeenteRows.map(r => ({ ...r, ...crimeLookup[r.regionCode] })));
        setMunicipalityData(gemeenteRows); setNationalRows('gemeente', gemeenteRows); setNationalAreas('gemeente', gemeenteRows);
        refreshMunicipalityView();
      })
      .catch(() => { /* crime unavailable at gemeente level */ });
  })
  .catch(() => { /* CBS unavailable — gemeente layer will render with flat fill */ });

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDropdown();
    if (!isAreaModalOpen()) closeCompare();   // the modal's own Escape closes the modal first
  }
});

// Modal "Wijken en buurten" on a gemeente: show the map, then zoom into its wijken.
document.addEventListener(DRILL_EVENT, async ({ detail: { code } }) => {
  if (!code) return;
  const toMap = getState().view !== 'map';
  setState({ area: code, view: 'map', scope: 'nederland' }, { source: 'map' });   // 'map': no focus before the drill
  if (toMap) await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));   // map size back first
  drillIntoGemeente(code);
});

// Modal "Vergelijk": the area goes into a Vergelijken column, the panel opens on the map.
document.addEventListener(COMPARE_EVENT, ({ detail: { code } }) => {
  if (!code) return;
  if (getState().view !== 'map') setState({ view: 'map' }, { source: 'modal' });
  addToCompare(code);
});

// ── Vergelijken panel (compare-panel.js) ──────────────────────────────────────

const panelEl        = document.getElementById('panel');
const panelToggleBtn = document.querySelector('.panel-toggle-btn');

panelEl.addEventListener('transitionend', e => {
  if (e.propertyName === 'width') getMap().invalidateSize();
});

// The header button keeps its class; its wording follows the new role here so the markup stays untouched.
panelToggleBtn.setAttribute('aria-label', 'Vergelijken');
panelToggleBtn.title = 'Vergelijken: gebieden naast elkaar';
const toggleLabel = panelToggleBtn.querySelector('.btn-label');
if (toggleLabel) toggleLabel.textContent = 'Vergelijk';
panelToggleBtn.addEventListener('click', () => toggleCompare());

document.addEventListener('panel-toggle', ({ detail: { open } }) => {
  panelToggleBtn.setAttribute('aria-pressed', open);
});

// ── Layers dropdown ───────────────────────────────────────────────────────────

const layersBtn      = document.querySelector('.layers-btn');
const layersDropdown = document.querySelector('.layers-dropdown');

// Built from DATASETS, one section per DATASET_GROUPS entry. Rotterdam-only
// layers carry data-scope="rotterdam" and are hidden in the Nederland view (CSS).
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// A mixed section (Criminaliteit) names the layers it hides in the Nederland view,
// so the shorter list there does not read as missing data.
layersDropdown.innerHTML = '<li class="layers-cols" role="none"><ul role="none">' + groupDatasets().map(g => {
  const rtmOnly = g.scope === 'all' ? g.datasets.filter(d => d.scope === 'rotterdam').length : 0;
  return `
  <li class="layer-group" role="group" aria-labelledby="layer-group-${g.key}"${g.scope !== 'all' ? ` data-scope="${g.scope}"` : ''}>
    <span class="layer-group-title" id="layer-group-${g.key}">${escHtml(g.label)}</span>
    <ul class="layer-group-list" role="none">${g.datasets.map(d => `
      <li role="none"><button class="layer-opt" type="button" data-dataset="${d.key}" role="option"${d.scope ? ` data-scope="${d.scope}"` : ''}>${escHtml(d.label)}</button></li>`).join('')}${rtmOnly ? `
      <li role="none" class="layer-hint" data-scope="nederland">+${rtmOnly} lagen per wijk/buurt in de Rotterdam-weergave</li>` : ''}
    </ul>
  </li>`;
}).join('') + '</ul></li>';

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
  // Postcode-estimated herkomst (v0.25.0): the file loads on first use only.
  if (isPc4Key(key) && !isPc4Loaded()) {
    await loadPc4Herkomst().catch(err => console.warn('herkomst per postcode:', err));
    if (getState().dataset !== key) return;
  }
  // Bouwstijl per wijk/buurt (v0.29.0): the postcode estimate loads on first use only.
  if (isBouwKey(key) && !isBouwLoaded()) {
    await loadBouwjaar().catch(err => console.warn('bouwjaar per postcode:', err));
    if (getState().dataset !== key) return;
  }
  // World regions per gemeente (v0.28.0): the static file loads on first use, then joins the gemeente rows.
  if (isRegionMetric(key) && !isRegioLoaded()) {
    await loadGemeenteRegio().catch(err => console.warn('herkomst per regio:', err));
    if (isRegioLoaded() && gemeenteRows.length) { gemeenteRows = withRegionShares(gemeenteRows); setMunicipalityData(gemeenteRows); setNationalRows('gemeente', gemeenteRows); setNationalAreas('gemeente', gemeenteRows); }
    if (getState().dataset !== key) return;
  }
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
  const useGemeente = atGemeenteTier(tier);
  const rows       = useGemeente ? gemeenteRows : provinceRows;
  document.body.classList.toggle('nl-drill', atDrillTier(tier));   // every layer has wijk/buurt figures
  if (atDrillTier(tier)) {
    // Drill first: the gemeente layer asks nl-drill whether the drilled gemeente is ready (zoom-plan.js).
    const { scale, level, hasData, status } = applyDrillDataset(key, mode);
    if (gemeenteRows.length) applyDataset(gemeenteRows.map(r => crimeValues(r, mode)), ds.key);   // other gemeenten keep colour + stamps
    const suffix = !status ? 'geen gemeente in beeld'
      : status.error === 'geo' ? `wijk- en buurtgrenzen niet beschikbaar (PDOK) · ${gemeenteName(status.gemeente)}`
      : status.error === 'data' || !hasData ? `geen ${level}data · ${gemeenteName(status.gemeente)}`
      : `${level} · ${gemeenteName(status.gemeente)} · t.o.v. heel NL`;
    await updateLegend({ title: `${ds.title} · ${suffix}`, scale, dataset: key, mode, showNoData: true });
    return;
  }
  if (!rows.length) return;
  const title = !datasetInScope(key, 'nederland') ? `${ds.title} · alleen per wijk/buurt: zoom in op een gemeente`
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
  if (seq === scopeSeq && /^(PV|GM|WK|BU)/.test(getState().area ?? '')) focusNederlandArea(getState().area);   // search / deep link
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
  // A detailed group also counts per wijk/buurt via the postcode estimate: load it; onPc4Loaded rescores.
  if (presetUsesPc4(preset) && !isPc4Loaded()) loadPc4Herkomst().catch(() => { /* file missing: the factor is skipped there */ });
  if (presetUsesBouw(preset) && !isBouwLoaded()) loadBouwjaar().catch(() => { /* file missing: the factor is skipped there */ });
  const rd = peekRotterdamAreas();
  if (rd) {
    assignScore(rd.wijken, 'woonscore');
    assignScore(rd.buurten, 'woonscore', { parents: rd.wijken });
  }
  if (provinceRows.length) { provinceRows = rowsWithWoonscore(provinceRows); setProvinceData(provinceRows); setNationalRows('provincie', provinceRows); setNationalAreas('provincie', provinceRows); }
  if (gemeenteRows.length) { gemeenteRows = rowsWithWoonscore(gemeenteRows); setMunicipalityData(gemeenteRows); setNationalRows('gemeente', gemeenteRows); setNationalAreas('gemeente', gemeenteRows); }
  rescoreNlAreas();   // NL wijken/buurten of the drill-down, when loaded
}

// Bouwstijl landed: add the shares to every loaded wijk/buurt, then rescore if the personal preset uses them.
onBouwLoaded(() => {
  const rd = peekRotterdamAreas();
  if (rd) { addBouwShares(rd.wijken); addBouwShares(rd.buurten); }
  const nl = peekNlAreas();
  addBouwShares(nl.wijken); addBouwShares(nl.buurten);
  if (presetUsesBouw(presetFromScore(getState().score))) {
    applyPersonalScore(getState().score);
    if (DATASETS[getState().dataset]?.unit === 'score') activateDataset(getState().dataset);
  }
});

// Postcode herkomst landed: add the shares to every loaded wijk/buurt, then rescore if the personal preset uses them.
onPc4Loaded(() => {
  const rd = peekRotterdamAreas();
  if (rd) { addPc4Shares(rd.wijken); addPc4Shares(rd.buurten); }
  const nl = peekNlAreas();
  addPc4Shares(nl.wijken); addPc4Shares(nl.buurten);
  if (presetUsesPc4(presetFromScore(getState().score))) {
    applyPersonalScore(getState().score);
    if (DATASETS[getState().dataset]?.unit === 'score') activateDataset(getState().dataset);
  }
});

onStateChange(({ state, changed, source }) => {
  if (changed.includes('score')) {
    applyPersonalScore(state.score);
    if (DATASETS[state.dataset]?.unit === 'score' && !changed.includes('dataset') && !changed.includes('scope')) activateDataset(state.dataset);
  }
  if (changed.includes('view')) showView(state.view);
  if (changed.includes('scope')) {
    // Fade the map and show the loader before the switch; it hides once the new scope is drawn.
    scopeRun = withLoader(state.scope === 'nederland' ? 'Nederland laden…' : 'Rotterdam laden…', () => applyScope(state.scope))
      .catch(err => console.warn('scope switch:', err));
    return;
  }
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
    focusNederlandArea(state.area);   // search: gemeente / provincie; modal "Toon op kaart": NL wijk/buurt
  }
});

syncDatasetButtons(initialState.dataset);
showView(initialState.view);
initList();   // after showView so a #view=list start renders visible
initDashboard();
// Boot loader: hides when the first scope is drawn (Nederland: once the provinces are coloured), at most BOOT_LOADER_MAX_MS.
const BOOT_LOADER_MAX_MS = 20000;
scopeRun = applyScope(initialState.scope, { initial: true });
const firstDraw = scopeRun
  .then(() => (initialState.scope === 'nederland' ? provincesReady : null));
Promise.race([firstDraw, new Promise(r => setTimeout(r, BOOT_LOADER_MAX_MS))])
  .catch(err => console.warn('first draw:', err))
  .finally(() => { setLoaderProgress(1); hideLoader(); });
initSearch();
initCrimeToggles();
initScaleToggle();
initLegendCollapse();
// Schaal: Kwantiel | Lineair — recolour the map and legend from the shown set.
document.addEventListener(SCALE_EVENT, () => activateDataset(getState().dataset));
initExplain();
initLegal();   // Privacy · Disclaimer · Colofon (splash footer, Uitleg foot, ☰ menu, #legal=…)
initAreaModal();
initComparePanel();   // after initState: a cmp in the link opens the panel
initShare();
initShortcuts();   // W28: keyboard shortcuts, ? = Sneltoetsen, skip link, aria-keyshortcuts
if (hasShareExtras(sharedView)) applySharedView(sharedView);
initWizard({ rows: () => (gemeenteRows.length && (atGemeenteTier() || !provinceRows.length)
  ? { level: 'gemeente', rows: gemeenteRows } : { level: 'provincie', rows: provinceRows }) });
