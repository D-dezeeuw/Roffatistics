import { bindDOM, run, setValue } from 'spektrum';
import { initMap, getMap }                from './modules/map.js';
import { initOverlays, setProvinceData, setMunicipalityData, applyDataset, getActiveTier } from './modules/overlays.js';
import { fetchCBS, normalizeProvinces, normalizeCrime } from './modules/datasets.js';
import { updateLegend }                   from './modules/legend.js';

setValue('panel.visible',       false);
setValue('panel.name',          '');
setValue('panel.code',          '');
setValue('panel.population',    '');
setValue('panel.density',       '');
setValue('panel.avgIncome',     '');
setValue('panel.crimeRate',     '');
setValue('panel.totalCrimes',   '');
setValue('panel.catVermogen',   '');
setValue('panel.catVernieling', '');
setValue('panel.catGeweld',     '');
setValue('panel.lowEdu',        '');
setValue('panel.medEdu',        '');
setValue('panel.highEdu',       '');
setValue('legend.title',        '');
setValue('legend.min',          '');
setValue('legend.max',          '');

bindDOM();
run();

initMap();
await initOverlays();

const DATASETS = {
  population: { key: 'population', title: 'Inwoners' },
  avgIncome:  { key: 'avgIncome',  title: 'Gem. inkomen (×€1k)' },
  crimeRate:  { key: 'crimeRate',  title: 'Misdrijven per 1.000 inw.' },
  highEdu:    { key: 'highEdu',    title: 'Hoog opgeleid (%)' },
};

const CBS_FILTER   = "startswith(RegioS,'PV') and Perioden eq '2023JJ00'";
const CBS_SELECT   = 'RegioS,TotaleBevolking_1,BronInkomenAlsWerknemer_141,TotaleOppervlakte_248,BasisonderwijsVmboMbo1_113,HavoVwoMbo24_114,HboWo_115';
const CRIME_FILTER = "startswith(RegioS,'PV') and Perioden eq '2023JJ00' and (SoortMisdrijf eq 'T001161' or SoortMisdrijf eq 'CRI1000' or SoortMisdrijf eq 'CRI2000' or SoortMisdrijf eq 'CRI3000')";
const CRIME_SELECT = 'RegioS,SoortMisdrijf,TotaalGeregistreerdeMisdrijven_1,GeregistreerdeMisdrijvenPer1000Inw_3';

const GM_FILTER       = "startswith(RegioS,'GM') and Perioden eq '2023JJ00'";
const GM_CRIME_FILTER = "startswith(RegioS,'GM') and Perioden eq '2023JJ00' and (SoortMisdrijf eq 'T001161' or SoortMisdrijf eq 'CRI1000' or SoortMisdrijf eq 'CRI2000' or SoortMisdrijf eq 'CRI3000')";

let provinceRows  = [];
let gemeenteRows  = [];
let activeDataset = 'population';

try {
  const [raw, crimeRaw] = await Promise.all([
    fetchCBS('70072ned',   CBS_FILTER,   CBS_SELECT),
    fetchCBS('83648NED',   CRIME_FILTER, CRIME_SELECT),
  ]);
  const crimeRows   = normalizeCrime(crimeRaw);
  const crimeLookup = Object.fromEntries(crimeRows.map(r => [r.regionCode, r]));
  provinceRows = normalizeProvinces(raw).map(r => ({ ...r, ...crimeLookup[r.regionCode] }));
  setProvinceData(provinceRows);
  await activateDataset('population');
} catch {
  // CBS unavailable — map renders with flat fill, no legend
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDropdown();
    import('./modules/panel.js').then(({ hidePanel }) => hidePanel());
  }
});

document.querySelector('.panel-close').addEventListener('click', () => {
  import('./modules/panel.js').then(({ hidePanel }) => hidePanel());
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

document.addEventListener('tier-change', async ({ detail: { tier } }) => {
  if (tier === 'buurt') return; // buurt has no CBS data — legend stays as-is

  if (tier === 'municipality' && !gemeenteRows.length) {
    // Fetch demographic data first — this is what drives map coloring.
    // Crime data is fetched separately so its failure cannot block coloring.
    try {
      const rawGM = await fetchCBS('70072ned', GM_FILTER, CBS_SELECT);
      gemeenteRows = normalizeProvinces(rawGM).filter(r => r.regionCode);
      setMunicipalityData(gemeenteRows);
    } catch {
      // CBS demographic data unavailable — gemeente layer renders with flat fill
      return;
    }

    // Color map immediately with demographic data, then merge crime if available.
    await activateDataset(activeDataset);

    try {
      // 342 municipalities × 4 crime types = 1368 rows — request 2000 to avoid truncation.
      const crimeRawGM   = await fetchCBS('83648NED', GM_CRIME_FILTER, CRIME_SELECT, undefined, undefined, 2000);
      const crimeRowsGM  = normalizeCrime(crimeRawGM);
      const crimeLookup  = Object.fromEntries(crimeRowsGM.map(r => [r.regionCode, r]));
      gemeenteRows       = gemeenteRows.map(r => ({ ...r, ...crimeLookup[r.regionCode] }));
      setMunicipalityData(gemeenteRows);
    } catch {
      // Crime data unavailable — crime fields will show dashes in the panel
    }
    return;
  }

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
