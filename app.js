import { bindDOM, run, setValue } from 'spektrum';
import { initMap }                        from './modules/map.js';
import { initOverlays, setProvinceData, applyDataset } from './modules/overlays.js';
import { fetchCBS, normalizeProvinces }   from './modules/datasets.js';
import { updateLegend }                   from './modules/legend.js';

setValue('panel.visible',    false);
setValue('panel.name',       '');
setValue('panel.code',       '');
setValue('panel.population', '');
setValue('panel.density',    '');
setValue('panel.avgIncome',  '');
setValue('legend.title',     '');
setValue('legend.min',       '');
setValue('legend.max',       '');

bindDOM();
run();

initMap();
await initOverlays();

const DATASETS = {
  population: { key: 'population', title: 'Inwoners' },
  avgIncome:  { key: 'avgIncome',  title: 'Gem. inkomen (×€1k)' },
};

const CBS_FILTER = "startswith(RegioS,'PV') and Perioden eq '2023JJ00'";
const CBS_SELECT = 'RegioS,TotaleBevolking_1,BronInkomenAlsWerknemer_141,TotaleOppervlakte_248';

let provinceRows  = [];
let activeDataset = 'population';

try {
  const raw    = await fetchCBS('70072ned', CBS_FILTER, CBS_SELECT);
  provinceRows = normalizeProvinces(raw);
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
