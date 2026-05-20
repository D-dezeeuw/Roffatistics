import { bindDOM, run, setValue } from 'spektrum';
import { initMap }                        from './modules/map.js';
import { initOverlays, setProvinceData, applyDataset } from './modules/overlays.js';
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

let provinceRows  = [];
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

document.querySelectorAll('.switcher-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.dataset === activeDataset) return;
    activeDataset = btn.dataset.dataset;
    document.querySelectorAll('.switcher-btn')
      .forEach(b => b.classList.toggle('active', b === btn));
    activateDataset(activeDataset);
  });
});

async function activateDataset(key) {
  if (!provinceRows.length) return;
  const ds       = DATASETS[key];
  const { min, max } = applyDataset(provinceRows, ds.key);
  await updateLegend({ title: ds.title, min, max, dataset: key });
}
