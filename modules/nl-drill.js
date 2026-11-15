// Nederland scope, zoomed past the gemeente tier: the wijken (tier 'wijk') or
// buurten (tier 'buurt') of ONE gemeente, coloured by the active layer on a
// scale built from all NL areas of that level, so a colour means the same in
// every gemeente. Geometry and values load lazily (nl-areas.js).
import { getMap } from './map.js';
import { addKeyboardNav } from './overlays.js';
import { areaPanelData, areaLevel } from './areas.js';
import { buildScale, getScaleMethod } from './scale.js';
import { datasetValue, DATASETS } from './datasets.js';
import { createScoreLabels } from './score-labels.js';
import { formatValue } from './dashboard-data.js';
import { areaFillStyle, outlierStroke, tooltipHtml } from './rotterdam.js';
import { nonResidentialLabel } from './woongebied.js';
import { loadNlLevel, loadGemeenteGeo, gemeenteOf, findNlArea } from './nl-areas.js';

const PANE = 'nlDrill';
const STROKE = { wijk: { color: '#7c3aed', weight: 1.2, opacity: 0.8 }, buurt: { color: '#ea580c', weight: 0.6, opacity: 0.75 } };

let layer = null;         // L.geoJSON of the shown areas
let shown = null;         // { gemeente, level }
let status = null;        // { gemeente, level, error: null | 'geo' | 'data', count }
let areas = [];           // all NL areas of the shown level (peers + lookup)
let lookup = new Map();
let dataset = 'woonscore';
let crimeMode = 'rate';
let scale = buildScale([]);
let labels = null;
let seq = 0;

const valueOf = a => datasetValue(a?.values, dataset, crimeMode);
const strokeFor = (lvl, a) => outlierStroke(valueOf(a), scale) ?? STROKE[lvl];

function ensurePane(map) {
  if (map.getPane(PANE)) return;
  const pane = map.createPane(PANE);
  pane.style.zIndex = 410;   // above the gemeente layer (overlayPane 400), below the score stamps (450)
}

function onClick(code) {
  const trigger = globalThis.document?.getElementById('map') ?? null;
  import('./area-modal.js').then(({ openAreaModal }) => openAreaModal(code, trigger));
}

function makeLayer(geo, lvl) {
  return L.geoJSON(geo, {
    pane: PANE,
    style: () => ({ ...STROKE[lvl], fillOpacity: 0.45 }),
    onEachFeature(feature, fl) {
      const code = feature.properties.statcode;
      const name = feature.properties.statnaam;
      fl.bindTooltip(() => {
        const a = lookup.get(code);
        return tooltipHtml(a?.name ?? name, valueOf(a), v => formatValue(v, dataset, crimeMode), scale.outlierSide(valueOf(a)), a ? nonResidentialLabel(a) : null);
      }, { sticky: true, direction: 'top', className: 'area-tooltip', pane: 'tooltipPane' });
      fl.on({
        mouseover(e) { e.target.setStyle({ weight: 2.5, color: '#ea580c', opacity: 1 }); e.target.bringToFront(); },
        mouseout(e)  { e.target.setStyle(strokeFor(lvl, lookup.get(code))); },
        click()      { onClick(code); },
      });
    },
  });
}

/**
 * Shows the `level` areas of gemeente `gm` (replacing what is shown). Resolves
 * to the status { gemeente, level, error, count }; a newer call wins, an older
 * one resolves without touching the map. Geometry failure: nothing drawn,
 * error 'geo'. Value failure: polygons drawn grey, error 'data'.
 */
export async function showDrill(gm, level) {
  const my = ++seq;
  if (shown?.gemeente === gm && shown?.level === level && layer) return status;
  const [geoR, dataR] = await Promise.allSettled([loadGemeenteGeo(level, gm), loadNlLevel(level)]);
  if (my !== seq) return status;
  const map = getMap();
  hideDrill({ keepSeq: true });
  if (geoR.status === 'rejected' || !geoR.value.features.length) {
    status = { gemeente: gm, level, error: 'geo', count: 0 };
    return status;
  }
  areas = dataR.status === 'fulfilled' ? dataR.value : [];
  lookup = new Map(areas.filter(a => a.gemeente === gm).map(a => [a.code, a]));
  ensurePane(map);
  layer = makeLayer(geoR.value, level).addTo(map);
  addKeyboardNav(layer);
  shown = { gemeente: gm, level };
  status = { gemeente: gm, level, error: dataR.status === 'fulfilled' ? null : 'data', count: geoR.value.features.length };
  recolor();
  return status;
}

/** Removes the drill layer and its stamps. */
export function hideDrill({ keepSeq = false } = {}) {
  if (!keepSeq) seq++;
  const map = getMap();
  if (layer && map?.hasLayer(layer)) map.removeLayer(layer);
  layer = null;
  shown = null;
  if (!keepSeq) status = null;
  labels?.clear();
}

/**
 * GM code of the shown drill layer when it is ready to replace the gemeente
 * colour (zoom-plan.js): geometry drawn, values loaded and at least one area of
 * the gemeente with a value for the active layer. Null otherwise; the gemeente
 * layer (overlays.js) then keeps colouring and stamping that gemeente.
 */
export function drillReadyGemeente() {
  if (!layer || !shown || status?.error) return null;
  for (const a of lookup.values()) if (Number.isFinite(valueOf(a))) return shown.gemeente;
  return null;
}

function recolor() {
  scale = buildScale(areas.map(valueOf), { method: getScaleMethod() });   // national peers of the level
  if (!layer) return;
  const lvl = shown.level;
  const ready = drillReadyGemeente() != null;
  const outliers = [];
  layer.eachLayer(fl => {
    const a = lookup.get(fl.feature.properties.statcode);
    // Not ready: outlines only, so the gemeente colour underneath stays visible.
    fl.setStyle({ ...strokeFor(lvl, a), ...(ready ? { fill: true, ...areaFillStyle(valueOf(a), scale, 0.65) } : { fill: true, fillOpacity: 0 }) });
    if (ready && scale.isOutlier(valueOf(a))) outliers.push(fl);
  });
  outliers.forEach(fl => fl.bringToFront());
  if (!ready || DATASETS[dataset]?.unit !== 'score') { labels?.clear(); return; }
  labels ??= createScoreLabels(getMap());
  const items = [];
  layer.eachLayer(fl => {
    const code = fl.feature.properties.statcode;
    items.push({ code: `nl:${code}`, geometry: fl.feature.geometry, value: valueOf(lookup.get(code)) });
  });
  labels.set(items, lvl);
}

/** Colours the shown areas for `key`; returns { scale, level, hasData, status } for the legend. */
export function applyDrillDataset(key, mode = crimeMode) {
  dataset = key;
  crimeMode = mode;
  recolor();
  return { scale, level: shown?.level ?? status?.level ?? null, hasData: scale.count > 0, status };
}

export function getDrillStatus() { return status; }

/** Feature of `code` in the shown layer, or null. */
function featureLayer(code) {
  let found = null;
  layer?.eachLayer(fl => { if (fl.feature.properties.statcode === code) found = fl; });
  return found;
}

/**
 * Deep link / search for a NL wijk or buurt: shows its gemeente at the right
 * level, fits the map to it and opens the panel. `zoomFor(level)` gives the
 * lowest zoom of the tier so the tier follows. Resolves to the area or null.
 */
export async function focusDrillArea(code, { zoomFor }) {
  const level = areaLevel(code);
  const gm = gemeenteOf(code);
  if (!gm) return null;
  const st = await showDrill(gm, level);
  if (st?.error === 'geo') return null;
  const fl = featureLayer(code);
  const map = getMap();
  if (fl) {
    const b = fl.getBounds();
    const z = Math.min(Math.max(map.getBoundsZoom(b, false, L.point(48, 48)), zoomFor(level)), zoomFor(level) + 3);
    map.setView(b.getCenter(), z);
  }
  const area = findNlArea(code);
  const name = area?.name ?? fl?.feature.properties.statnaam ?? code;
  import('./panel.js').then(({ showPanel }) => showPanel({ name, code, data: areaPanelData(area) }));
  return area ?? { code, name };
}
