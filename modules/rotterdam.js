// Rotterdam scope: mask outside GM0599, wijk choropleth, buurt choropleth at
// higher zoom. Every wijk/buurt is always drawn; areas without a value share
// NO_DATA_COLOR. Pure styling helpers are exported for the unit tests.
import { getMap } from './map.js';
import { addKeyboardNav } from './overlays.js';
import { loadRotterdamAreas, toNumber } from './areas.js';
import { routeToCompare } from './compare.js';
import { buildScale, getScaleMethod, outlierLabel, NO_DATA_COLOR, OUTLIER_COLOR } from './scale.js';
import { datasetValue, DATASETS } from './datasets.js';
import { createScoreLabels } from './score-labels.js';
import { formatValue } from './dashboard-data.js';
import { p2000Note } from './p2000.js';
import { nonResidentialLabel } from './woongebied.js';
import { rotterdamLevel, ZOOM_BUURT_RD } from './zoom-plan.js';

export { NO_DATA_COLOR };
export const MASK_COLOR      = '#0d0a14';
export const MASK_OPACITY    = 0.85;
export { ZOOM_BUURT_RD };
const ACCENT = '#7c3aed';

// Leaflet's Web Mercator stops at ±85.05°.
const WORLD_RING = [[-85, -180], [-85, 180], [85, 180], [85, -180]];

/** 'wijk' below ZOOM_BUURT_RD, 'buurt' from there on while the buurten have values (zoom-plan.js). */
export function resolveRotterdamLevel(zoom, opts) {
  return rotterdamLevel(zoom, opts);
}

/** Fill style for one area; null/undefined values (or an empty scale) get the neutral colour. */
export function areaFillStyle(value, scale, fillOpacity = 0.6) {
  const v = toNumber(value);
  if (v == null || !scale?.count) return { fillColor: NO_DATA_COLOR, fillOpacity: Math.min(fillOpacity, 0.45) };
  return { fillColor: scale.colorFor(v), fillOpacity };
}

/** Red border on top of the class fill for an outlier; null otherwise. */
export function outlierStroke(value, scale) {
  return scale?.isOutlier(toNumber(value)) ? { color: OUTLIER_COLOR, weight: 2.5, opacity: 1 } : null;
}

/**
 * Leaflet polygon rings ([lat, lng]) for the inverse mask: the world ring
 * followed by every ring of the gemeente. Leaflet SVG fills with evenodd, so
 * the gemeente becomes a hole and any enclave inside it is masked again.
 */
export function buildMaskRings(geojson) {
  const rings = [WORLD_RING];
  const addPolygon = poly => poly.forEach(ring => rings.push(ring.map(([lng, lat]) => [lat, lng])));
  const visit = g => {
    if (!g) return;
    if (g.type === 'FeatureCollection') g.features.forEach(visit);
    else if (g.type === 'Feature') visit(g.geometry);
    else if (g.type === 'Polygon') addPolygon(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(addPolygon);
  };
  visit(geojson);
  return rings;
}

/** Tooltip HTML: name plus the formatted value or "geen data", and the outlier note for `side` ('high'|'low'). */
export function tooltipHtml(name, value, format = v => v.toLocaleString('nl-NL'), side = null, note = null) {
  const v = toNumber(value);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mark = v != null && side ? `<br><span class="tt-outlier">${outlierLabel(side)}</span>` : '';
  const extra = note ? `<br><span class="tt-note">${esc(note)}</span>` : '';
  return `<strong>${esc(name)}</strong><br><span class="tt-value">${v == null ? 'geen data' : esc(format(v))}</span>${mark}${extra}`;
}

// ── Leaflet layers ────────────────────────────────────────────────────────────

let areas = null;
let enabled = false;
let level = null;
let dataset = 'population';
let crimeMode = 'rate';   // state.crime: crime datasets read their raw counts in 'abs'
const valueOf = area => datasetValue(area?.values, dataset, crimeMode);
let scales = { wijk: buildScale([]), buurt: buildScale([]) };   // rebuilt from the shown set on every recolor
let activeArea = null;   // area object last shown in slot A
const layers = { mask: null, outline: null, wijk: null, buurt: null };
let zoomHandlerBound = false;
let labels = null;       // score stamps (score-labels.js), made on first use

const byCode = code => areas && (areas.wijken.find(a => a.code === code) ?? areas.buurten.find(a => a.code === code));

/** Tooltip note: non-residential label and, on a P2000 layer, the count (or why there is none). */
export const areaNote = (area, key) => [nonResidentialLabel(area), p2000Note(area?.values, key)].filter(Boolean).join(' · ') || null;

function makeAreaLayer(geojson, list, kind, onSelect) {
  const lookup = new Map(list.map(a => [a.code, a]));
  return L.geoJSON(geojson, {
    style: () => ({ color: kind === 'wijk' ? ACCENT : '#ea580c', weight: kind === 'wijk' ? 1.2 : 0.6, opacity: 0.7, fillColor: NO_DATA_COLOR, fillOpacity: 0.45 }),
    onEachFeature(feature, fl) {
      const area = lookup.get(feature.properties.statcode);
      fl.bindTooltip(() => tooltipHtml(area.name, valueOf(area), v => formatValue(v, dataset, crimeMode), scales[kind].outlierSide(valueOf(area)), areaNote(area, dataset)), { sticky: true, direction: 'top', className: 'area-tooltip' });
      fl.on({
        mouseover(e) { e.target.setStyle({ weight: 2.5, color: '#ea580c', opacity: 1 }); e.target.bringToFront(); },
        mouseout(e)  { e.target.setStyle(strokeFor(kind, area)); },
        click()      { onSelect(area); },
      });
    },
  });
}

const baseStroke = kind => kind === 'wijk'
  ? { color: ACCENT, weight: 1.2, opacity: level === 'buurt' ? 0.9 : 0.7 }
  : { color: '#ea580c', weight: 0.6, opacity: 0.7 };

// Outlier border only on the level whose fill is shown (wijk fill is off at buurt zoom).
const strokeFor = (kind, area) => (kind === 'wijk' && level === 'buurt' ? null : outlierStroke(valueOf(area), scales[kind])) ?? baseStroke(kind);

// A map click on a wijk/buurt: with Vergelijken open it fills a column (compare.js), else the area modal opens.
function selectArea(area, onSelect) {
  activeArea = area;
  if (!routeToCompare(area.code)) {
    const trigger = globalThis.document?.getElementById('map') ?? null;
    import('./area-modal.js').then(({ openAreaModal }) => openAreaModal(area.code, trigger));
  }
  onSelect?.(area);
}

let selectCallback = null;

async function ensureLayers() {
  if (layers.wijk) return;
  areas = await loadRotterdamAreas();
  const map = getMap();
  if (!map.getPane('rdMask')) {
    const pane = map.createPane('rdMask');
    pane.style.zIndex = 390;            // below overlayPane (400), above the basemap
    pane.style.pointerEvents = 'none';
  }
  layers.mask = L.polygon(buildMaskRings(areas.geo.gemeente), {
    pane: 'rdMask', interactive: false, stroke: false, fillColor: MASK_COLOR, fillOpacity: MASK_OPACITY,
  });
  layers.outline = L.geoJSON(areas.geo.gemeente, {
    pane: 'rdMask', interactive: false, style: () => ({ color: ACCENT, weight: 2, opacity: 0.8, fill: false }),
  });
  const onSelect = a => selectArea(a, selectCallback);
  layers.wijk  = makeAreaLayer(areas.geo.wijken,  areas.wijken,  'wijk',  onSelect);
  layers.buurt = makeAreaLayer(areas.geo.buurten, areas.buurten, 'buurt', onSelect);
}

/** Level the plan wants now: buurt only when some buurt has a value for the active layer. */
function targetLevel() {
  const buurtReady = areas.buurten.some(a => toNumber(valueOf(a)) != null);
  return resolveRotterdamLevel(getMap().getZoom(), { buurtReady });
}

function placeLevel(next) {
  const map = getMap();
  level = next;
  if (level === 'buurt') {
    layers.buurt.addTo(map);
    addKeyboardNav(layers.buurt);
    layers.wijk.bringToFront();            // wijk outlines stay on top, fill off
  } else if (map.hasLayer(layers.buurt)) {
    map.removeLayer(layers.buurt);
  }
}

function syncLevel() {
  if (!enabled) return;
  const next = targetLevel();
  if (next === level) return;
  placeLevel(next);
  recolor();
  document.dispatchEvent(new CustomEvent('rotterdam-level-change', { detail: { level } }));
}

function recolor() {
  if (!layers.wijk) return;
  const method = getScaleMethod();
  const values = list => list.map(valueOf);   // the very values the fills and tooltips show
  scales = { wijk: buildScale(values(areas.wijken), { method }), buurt: buildScale(values(areas.buurten), { method }) };
  const wijkLookup = new Map(areas.wijken.map(a => [a.code, a]));
  const buurtLookup = new Map(areas.buurten.map(a => [a.code, a]));
  const outliers = [];
  layers.wijk.eachLayer(fl => {
    const a = wijkLookup.get(fl.feature.properties.statcode);
    const fill = level === 'buurt' ? { fill: false } : { fill: true, ...areaFillStyle(valueOf(a), scales.wijk) };
    fl.setStyle({ ...strokeFor('wijk', a), ...fill });
    if (level !== 'buurt' && scales.wijk.isOutlier(valueOf(a))) outliers.push(fl);
  });
  layers.buurt.eachLayer(fl => {
    const a = buurtLookup.get(fl.feature.properties.statcode);
    fl.setStyle({ ...strokeFor('buurt', a), ...areaFillStyle(valueOf(a), scales.buurt, 0.65) });
    if (level === 'buurt' && scales.buurt.isOutlier(valueOf(a))) outliers.push(fl);
  });
  outliers.forEach(fl => fl.bringToFront());   // red borders not hidden under neighbouring strokes
  stampScores(level === 'buurt' ? 'buurt' : 'wijk', level === 'buurt' ? buurtLookup : wijkLookup);
}

/** Score layers: the rounded score on every area of the level whose fill is shown; other layers: none. */
function stampScores(lvl, lookup) {
  if (DATASETS[dataset]?.unit !== 'score' || !enabled) { labels?.clear(); return; }
  labels ??= createScoreLabels(getMap());
  const items = [];
  layers[lvl].eachLayer(fl => {
    const code = fl.feature.properties.statcode;
    items.push({ code, geometry: fl.feature.geometry, value: valueOf(lookup.get(code)) });
  });
  labels.set(items, lvl);
}

/**
 * Turns Rotterdam mode on: adds mask, outline and wijk layer, follows zoom.
 * Resolves to the loaded areas (see areas.loadRotterdamAreas).
 */
export async function enableRotterdam({ onSelect } = {}) {
  selectCallback = onSelect ?? null;
  await ensureLayers();
  enabled = true;
  const map = getMap();
  layers.mask.addTo(map);
  layers.outline.addTo(map);
  layers.wijk.addTo(map);
  addKeyboardNav(layers.wijk);
  if (!zoomHandlerBound) { map.on('zoomend', syncLevel); zoomHandlerBound = true; }
  level = null;
  syncLevel();
  return areas;
}

export function disableRotterdam() {
  enabled = false;
  level = null;
  const map = getMap();
  for (const l of Object.values(layers)) if (l && map.hasLayer(l)) map.removeLayer(l);
  labels?.clear();
}

/** Colours the layers for `key` in crime mode `mode`; returns { scale, min, max, level, hasData } for the legend. */
export function applyRotterdamDataset(key, mode = crimeMode) {
  dataset = key;
  crimeMode = mode;
  if (enabled && layers.wijk) {
    const next = targetLevel();   // a layer without buurt values stays on the wijken
    if (next !== level) placeLevel(next);
  }
  recolor();
  const lvl = level ?? 'wijk';
  const scale = scales[lvl];
  return { scale, min: scale.min, max: scale.max, level: lvl, hasData: scale.count > 0 };
}

export function getRotterdamLevel() { return level; }
export function getRotterdamAreas() { return areas; }
export function getActiveArea()     { return activeArea; }

/** Zooms to `code` (deep links, search, ranking) and makes it the active area. */
export async function focusArea(code) {
  await ensureLayers();
  const area = byCode(code);
  if (!area) return null;
  if (area.bounds) getMap().fitBounds(area.bounds, { maxZoom: area.level === 'buurt' ? 15 : 13, padding: [24, 24] });
  activeArea = area;
  return area;
}
