import { bindDOM, run, setValue } from 'spektrum';
import { initMap, getMap }                from './modules/map.js';
import { initOverlays, setProvinceData, setMunicipalityData, applyDataset, getActiveTier, getActiveGemeente, getActiveGemeenteName, setPinnedGemeente, clearPinnedGemeente } from './modules/overlays.js';
import { fetchCBS, normalizeProvinces, normalizeCrime } from './modules/datasets.js';
import { updateLegend }                   from './modules/legend.js';

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

initMap();
await initOverlays();

const DATASETS = {
  population:       { key: 'population',       title: 'Inwoners' },
  avgIncome:        { key: 'avgIncome',         title: 'Gem. inkomen (×€1k)' },
  crimeRate:        { key: 'crimeRate',         title: 'Misdrijven per 1.000 inw.' },
  highEdu:          { key: 'highEdu',           title: 'Hoog opgeleid (%)' },
  wozValue:         { key: 'wozValue',          title: 'Gem. WOZ waarde (×€1k)' },
  pop65plus:        { key: 'pop65plus',         title: '65+ (%)' },
  nonWesternPct:    { key: 'nonWesternPct',     title: 'Niet-westers (%)' },
};

const CBS_SELECT   = 'RegioS,TotaleBevolking_1,BronInkomenAlsWerknemer_141,TotaleOppervlakte_248,BasisonderwijsVmboMbo1_113,HavoVwoMbo24_114,HboWo_115,GemiddeldeWOZWaardeVanWoningen_98,TotaalBanen_116,k_65Tot80Jaar_20,k_80JaarOfOuder_21,Migratiesaldo_76,TotaalNietWesterseMigratieachtergrond_37';
const CBS_FILTER   = "startswith(RegioS,'PV') and Perioden eq '2023JJ00'";
const CRIME_SELECT = 'RegioS,SoortMisdrijf,TotaalGeregistreerdeMisdrijven_1,GeregistreerdeMisdrijvenPer1000Inw_3';
const CRIME_FILTER = "startswith(RegioS,'PV') and Perioden eq '2023JJ00' and (SoortMisdrijf eq 'T001161' or SoortMisdrijf eq 'CRI1000' or SoortMisdrijf eq 'CRI1100' or SoortMisdrijf eq 'CRI2000' or SoortMisdrijf eq 'CRI3000' or SoortMisdrijf eq 'CRI3100')";

const GM_FILTER       = "startswith(RegioS,'GM') and Perioden eq '2023JJ00'";
const GM_CRIME_FILTER = "startswith(RegioS,'GM') and Perioden eq '2023JJ00' and (SoortMisdrijf eq 'T001161' or SoortMisdrijf eq 'CRI1000' or SoortMisdrijf eq 'CRI1100' or SoortMisdrijf eq 'CRI2000' or SoortMisdrijf eq 'CRI3000' or SoortMisdrijf eq 'CRI3100')";

let provinceRows  = [];
let gemeenteRows  = [];
let activeDataset = 'population';

// ── Province data ─────────────────────────────────────────────────────────────
// Demographics are fetched first and independently so a crime-fetch failure
// can never block map coloring or panel data.

try {
  const raw = await fetchCBS('70072ned', CBS_FILTER, CBS_SELECT);
  provinceRows = normalizeProvinces(raw);
  setProvinceData(provinceRows);
  await activateDataset('population');
} catch {
  // CBS unavailable — map renders with flat fill, no legend
}

// Merge crime data into provinces in the background (best-effort).
fetchCBS('83648NED', CRIME_FILTER, CRIME_SELECT)
  .then(crimeRaw => {
    const crimeLookup = Object.fromEntries(normalizeCrime(crimeRaw).map(r => [r.regionCode, r]));
    provinceRows = provinceRows.map(r => ({ ...r, ...crimeLookup[r.regionCode] }));
    setProvinceData(provinceRows);
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
  activateDataset(activeDataset);
  const code = getActiveGemeente();
  const name = getActiveGemeenteName();
  if (!code) return;
  const panelEl = document.getElementById('panel');
  if (!panelEl.classList.contains('has-region')) return;
  const data = gemeenteRows.find(d => d.regionCode === code) ?? null;
  if (!data) return;
  import('./modules/panel.js').then(({ showPanel }) => showPanel({ name, code, data }));
}

fetchCBS('70072ned', GM_FILTER, CBS_SELECT)
  .then(rawGM => {
    gemeenteRows = normalizeProvinces(rawGM).filter(r => r.regionCode);
    setMunicipalityData(gemeenteRows);
    refreshMunicipalityView();
    // Merge municipality crime in the background.
    return fetchCBS('83648NED', GM_CRIME_FILTER, CRIME_SELECT, undefined, undefined, 2000)
      .then(crimeRawGM => {
        const crimeLookup = Object.fromEntries(normalizeCrime(crimeRawGM).map(r => [r.regionCode, r]));
        gemeenteRows = gemeenteRows.map(r => ({ ...r, ...crimeLookup[r.regionCode] }));
        setMunicipalityData(gemeenteRows);
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
  import('./modules/panel.js').then(({ hidePanel }) => hidePanel());
});

document.querySelector('.panel-pin-btn').addEventListener('click', () => {
  const code = getActiveGemeente();
  const name = getActiveGemeenteName();
  if (!code) return;
  setPinnedGemeente(code, name);
  import('./modules/panel.js').then(({ pinPanel }) => pinPanel());
});

document.querySelector('.panel-compare-close').addEventListener('click', () => {
  clearPinnedGemeente();
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
    if (btn.dataset.dataset === activeDataset) return;
    activeDataset = btn.dataset.dataset;
    document.querySelectorAll('.layer-opt')
      .forEach(b => b.classList.toggle('active', b === btn));
    activateDataset(activeDataset);
  });
});

document.addEventListener('tier-change', async () => {
  await activateDataset(activeDataset);
});

async function activateDataset(key) {
  const tier       = getActiveTier();
  const useGemeente = tier === 'municipality' || tier === 'buurt';
  const rows       = useGemeente ? gemeenteRows : provinceRows;
  if (!rows.length) return;
  const ds    = DATASETS[key];
  const title = useGemeente ? `${ds.title} · gemeente` : ds.title;
  const { min, max } = applyDataset(rows, ds.key);
  await updateLegend({ title, min, max, dataset: key });
}
