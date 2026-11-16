import { getMap } from './map.js';
import { DATASETS } from './datasets.js';
import { createScoreLabels } from './score-labels.js';
import { buildScale, getScaleMethod, outlierLabel, OUTLIER_COLOR } from './scale.js';
import { metricKind } from './palette.js';
import { pointInRings, labelPoint } from './score-labels.js';
import { showDrill, hideDrill, getDrillStatus, focusDrillArea } from './nl-drill.js';
import { gemeenteOf } from './nl-areas.js';
import { nlTier, nlPlan, ZOOM_MUNICIPALITY, ZOOM_WIJK, ZOOM_BUURT } from './zoom-plan.js';
import { drillReadyGemeente } from './nl-drill.js';
import { routeToCompare } from './compare.js';

export { getDrillStatus };

// Tier thresholds live in zoom-plan.js (wijk 12 = drill-down of the gemeente at the map centre, buurt 13).
export const DRILL_ZOOM = Object.freeze({ wijk: ZOOM_WIJK, buurt: ZOOM_BUURT });

const GEMEENTE_URL = 'https://service.pdok.nl/cbs/gebiedsindelingen/2024/wfs/v1_0?request=GetFeature&service=WFS&version=2.0.0&typeName=gebiedsindelingen:gemeente_gegeneraliseerd&outputFormat=json&srsName=EPSG:4326';

const STYLE_DEFAULT = {
  fillColor:   '#7c3aed',
  fillOpacity: 0.15,
  color:       '#7c3aed',
  weight:      1,
  opacity:     0.6,
};

const STYLE_HOVER = {
  fillOpacity: 0.35,
  color:       '#ea580c',
  weight:      1.5,
  opacity:     1,
};

// The ramp lives in scale.js; re-exported for older importers.
export { interpolateColor } from './scale.js';

// Solid red border on top of the class fill marks an outlier (see scale.js).
const STYLE_OUTLIER = { color: OUTLIER_COLOR, weight: 2.5, opacity: 1 };

/** Nederland tier at `zoom` (zoom-plan.js nlTier). The old 'national' tier (zoom ≤ 6, uncoloured) is gone. */
export const resolveZoomTier = nlTier;

const layers   = { province: null, municipality: null };
const isDrillTier = tier => tier === 'wijk' || tier === 'buurt';
let activeTier = null;
let provinceData     = [];
let municipalityData = [];
let scoreLabels = null;      // score stamps (score-labels.js)
let activeColorState = null; // { lookup, scale } — set by applyDataset
let activeGemeente     = null; // GM code of the last clicked gemeente
let activeGemeenteName = null; // display name of the last clicked gemeente
const geoCache = {};


// Nederland scope only: when disabled (Rotterdam scope) no tier layer is shown.
let enabled = true;

// Swap guard — prevents concurrent swaps from leaving the map in an inconsistent state.
let isSwapping  = false;
let pendingTier = null;

export function setProvinceData(data) {
  provinceData = data;
}

export function setMunicipalityData(data) {
  municipalityData = data;
}

export function getActiveTier()         { return activeTier; }
/** Name of gemeente `code` from the loaded outlines, or the code itself. */
export function gemeenteName(code) {
  const f = geoCache[GEMEENTE_URL]?.features?.find(x => String(x.properties?.statcode ?? '').trim() === code);
  return f?.properties?.statnaam ?? code;
}
export function getActiveGemeente()     { return activeGemeente; }
export function getActiveGemeenteName() { return activeGemeenteName; }

// Choropleth fill opacity by tier. At wijk/buurt zoom the gemeenten keep their
// colour (zoom-plan.js): only the drilled gemeente, once its drill layer is
// ready, drops to 0 so its wijken/buurten show.
function choroplethOpacity(code) {
  if (isDrillTier(activeTier)) return code && code === drillReadyGemeente() ? 0 : 0.45;
  if (activeTier === 'municipality') return 0.45;
  return 0.65;
}

export function applyDataset(data, valueKey, method = getScaleMethod()) {
  const lookup = Object.fromEntries(data.map(d => [d.regionCode, d[valueKey]]));
  const scale  = buildScale(data.map(d => d[valueKey]), { method, kind: metricKind(DATASETS[valueKey]), scope: 'nederland' });   // empty for a Rotterdam-only dataset
  activeColorState = { lookup, scale };

  // Color the municipality layer — it is visible at the municipality, wijk and buurt tiers.
  const targetLayer = (activeTier === 'municipality' || isDrillTier(activeTier))
    ? layers.municipality
    : layers.province;

  if (targetLayer) {
    targetLayer.eachLayer(fl => {
      const code = fl.feature?.properties?.statcode;
      fl.setStyle(restoreStyle(code));
      if (scale.isOutlier(lookup[code])) fl.bringToFront();
    });
  }

  stampScores(valueKey, lookup);
  return { min: scale.min, max: scale.max, scale };
}

/**
 * Score stamps for the coarse NL level of the plan (zoom-plan.js nlPlan):
 * provincies at the province tier, gemeenten from the municipality tier on —
 * at wijk/buurt zoom every gemeente but the drilled one (nl-drill.js stamps
 * that one's wijken/buurten once they are ready). None for a non-score layer.
 */
function stampScores(valueKey, lookup) {
  const plan = activeTier ? nlPlan(activeTier, { readyGemeente: drillReadyGemeente(), isScore: DATASETS[valueKey]?.unit === 'score' }) : null;
  const coarse = plan?.draw.find(d => d.level === 'gemeente' || d.level === 'provincie');
  const lvl = coarse && plan.labels.includes(coarse.level) ? coarse.level : null;
  const layer = lvl === 'gemeente' ? layers.municipality : lvl === 'provincie' ? layers.province : null;
  if (!enabled || !layer) { scoreLabels?.clear(); return; }
  scoreLabels ??= createScoreLabels(getMap());
  const items = [];
  layer.eachLayer(fl => {
    const code = fl.feature?.properties?.statcode;
    if (code && code !== coarse.except) items.push({ code: `${lvl}:${code}`, geometry: fl.feature.geometry, value: lookup[code] });
  });
  scoreLabels.set(items, lvl);
}

function restoreStyle(code) {
  const drilled = isDrillTier(activeTier) && code && code === drillReadyGemeente();
  const base = drilled ? { ...STYLE_DEFAULT, fillOpacity: 0 } : { ...STYLE_DEFAULT };
  if (!activeColorState) return base;
  const value = activeColorState.lookup[code];
  if (value == null) return base;
  const { scale } = activeColorState;
  return { ...base, fillColor: scale.colorFor(value), fillOpacity: choroplethOpacity(code), ...(!drilled && scale.isOutlier(value) ? { ...STYLE_OUTLIER, color: scale.outlierColor ?? OUTLIER_COLOR } : {}) };
}

/** Popup HTML: the name, plus the outlier note when the value is one. */
function popupHtml(name, code) {
  const side = activeColorState?.scale.outlierSide(activeColorState.lookup[code]);
  return `<strong>${name}</strong>${side ? `<br><span class="tt-outlier">${outlierLabel(side)}</span>` : ''}`;
}

async function loadGeoJSON(url) {
  if (geoCache[url]) return geoCache[url];
  const res  = await fetch(url);
  const data = await res.json();
  geoCache[url] = data;
  return data;
}

function makeProvinceLayer(geojson) {
  return L.geoJSON(geojson, {
    style: () => ({ ...STYLE_DEFAULT }),
    onEachFeature(feature, featureLayer) {
      const name = feature.properties?.statnaam ?? '';
      const code = feature.properties?.statcode ?? '';

      featureLayer.on({
        mouseover(e) {
          e.target.setStyle(STYLE_HOVER);
          e.target.bringToFront();
          L.popup({ closeButton: false, offset: [0, -4] })
            .setLatLng(e.latlng)
            .setContent(popupHtml(name, code))
            .openOn(getMap());
        },
        mouseout(e) {
          e.target.setStyle(restoreStyle(code));
          getMap().closePopup();
        },
        click() { openOrCompare(code); },
      });
    },
  });
}

function makeGemeenteLayer(geojson) {
  return L.geoJSON(geojson, {
    style: () => ({ ...STYLE_DEFAULT }),
    onEachFeature(feature, featureLayer) {
      const name = feature.properties?.statnaam ?? '';
      const code = feature.properties?.statcode ?? '';

      featureLayer.on({
        mouseover(e) {
          e.target.setStyle(STYLE_HOVER);
          e.target.bringToFront();
          L.popup({ closeButton: false, offset: [0, -4] })
            .setLatLng(e.latlng)
            .setContent(popupHtml(name, code))
            .openOn(getMap());
        },
        mouseout(e) {
          e.target.setStyle(restoreStyle(code));
          getMap().closePopup();
        },
        click() {
          activeGemeente     = code;
          activeGemeenteName = name;
          openOrCompare(code);
        },
      });
    },
  });
}

export function addKeyboardNav(geoLayer) {
  geoLayer.eachLayer(fl => {
    const el = fl.getElement?.();
    if (!el || el.hasAttribute('tabindex')) return;
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', fl.feature?.properties?.statnaam ?? '');
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fl.fire('click');
      }
    });
  });
}

/**
 * statcode of the gemeente whose polygon contains [lat, lng] (even-odd test
 * over every ring), or null (sea, abroad).
 */
export function gemeenteAt(geojson, [lat, lng]) {
  for (const f of geojson?.features ?? []) {
    const g = f.geometry;
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    if (polys.some(rings => pointInRings([lng, lat], rings))) return String(f.properties?.statcode ?? '').trim() || null;
  }
  return null;
}

/** The gemeente to drill into: the one at the map centre, else the last drilled/clicked one. */
function drillGemeente() {
  const geo = geoCache[GEMEENTE_URL];
  const c = getMap().getCenter();
  return (geo && gemeenteAt(geo, [c.lat, c.lng])) ?? getDrillStatus()?.gemeente ?? activeGemeente ?? null;
}

/** A provincie/gemeente click: with Vergelijken open it fills a column (compare.js), else the area modal opens. */
function openOrCompare(code) {
  if (routeToCompare(code)) return;
  const trigger = globalThis.document?.getElementById('map') ?? null;
  import('./area-modal.js').then(({ openAreaModal }) => openAreaModal(code, trigger));
}

// Ensure the gemeente layer is loaded and on the map.
async function ensureGemeenteLayer(map) {
  if (!layers.municipality) {
    const data = await loadGeoJSON(GEMEENTE_URL);
    layers.municipality = makeGemeenteLayer(data);
    addKeyboardNav(layers.municipality);
  }
  if (!map.hasLayer(layers.municipality)) {
    layers.municipality.addTo(map);
  }
}

async function _doSwap(tier) {
  const map = getMap();

  if (tier === 'municipality') {
    // Remove the province layer if that was active; remove the drill-down layer.
    if (activeTier === 'province') {
      if (layers[activeTier]) map.removeLayer(layers[activeTier]);
    }
    hideDrill();
    try {
      await ensureGemeenteLayer(map);
    } catch {
      // Reload previous layer on failure.
      if (layers[activeTier]) layers[activeTier].addTo(map);
      return;
    }
    activeTier = 'municipality';
    document.dispatchEvent(new CustomEvent('tier-change', { detail: { tier: 'municipality' } }));
    return;
  }

  if (isDrillTier(tier)) {
    // Remove the province layer if that was active.
    if (activeTier === 'province') {
      if (layers[activeTier]) map.removeLayer(layers[activeTier]);
    }
    // Keep the gemeente layer on the map: outlines around the drilled gemeente.
    try {
      await ensureGemeenteLayer(map);
    } catch {
      if (layers[activeTier]) layers[activeTier].addTo(map);
      return;
    }
    const gmCode = drillGemeente();
    if (gmCode) await showDrill(gmCode, tier);
    else hideDrill();
    activeTier = tier;
    document.dispatchEvent(new CustomEvent('tier-change', { detail: { tier } }));
    return;
  }

  // province — tear down the municipality and drill-down layers.
  hideDrill();
  if (layers.municipality && map.hasLayer(layers.municipality)) {
    map.removeLayer(layers.municipality);
  }
  layers[tier].addTo(map);
  activeTier = tier;
  document.dispatchEvent(new CustomEvent('tier-change', { detail: { tier } }));
}

function removeAllTierLayers() {
  const map = getMap();
  for (const k of ['province', 'municipality']) {
    if (layers[k] && map.hasLayer(layers[k])) map.removeLayer(layers[k]);
  }
  hideDrill();
  activeTier  = null;
  pendingTier = null;
  scoreLabels?.clear();
}

/** Shows (Nederland scope) or hides (Rotterdam scope) the province/gemeente/buurt tiers. */
export async function setOverlaysEnabled(on) {
  enabled = on;
  if (!on) {
    if (!isSwapping) removeAllTierLayers();   // a running swap cleans up when it finishes
    return;
  }
  if (isSwapping) return;
  activeTier = null;
  await swapToTier(resolveZoomTier(getMap().getZoom()));
}

export function isOverlaysEnabled() { return enabled; }

async function swapToTier(tier) {
  if (!enabled) return;
  if (tier === activeTier) return;
  if (isSwapping) {
    pendingTier = tier; // remember the latest requested tier
    return;
  }
  isSwapping = true;
  // Stamps of the current level stay until the next applyDataset (tier-change) restamps:
  // no empty map while the drill-down geometry or data loads.
  try {
    await _doSwap(tier);
  } finally {
    isSwapping = false;
  }
  if (!enabled) {
    removeAllTierLayers();
    return;
  }
  // Process the latest pending tier change, if any.
  if (pendingTier !== null && pendingTier !== activeTier) {
    const next = pendingTier;
    pendingTier = null;
    swapToTier(next);
  } else {
    pendingTier = null;
  }
}

export async function initOverlays({ enabled: startEnabled = true } = {}) {
  const map  = getMap();
  const data = await loadGeoJSON('./data/provinces.json');

  layers.province = makeProvinceLayer(data);
  enabled = startEnabled;

  if (enabled) {
    activeTier = 'province';
    layers.province.addTo(map);
    addKeyboardNav(layers.province);
  }

  map.on('zoomend', () => swapToTier(resolveZoomTier(map.getZoom())));
  map.on('moveend', followDrillGemeente);
}

// Panning at wijk/buurt zoom: when the centre crosses into another gemeente, drill that one.
let following = false;
async function followDrillGemeente() {
  if (!enabled || isSwapping || following || !isDrillTier(activeTier)) return;
  const gm = drillGemeente();
  const st = getDrillStatus();
  if (!gm || (st?.gemeente === gm && st?.level === activeTier)) return;
  following = true;
  try { await showDrill(gm, activeTier); } finally { following = false; }
  if (enabled && isDrillTier(activeTier)) document.dispatchEvent(new CustomEvent('tier-change', { detail: { tier: activeTier } }));
}

/**
 * "Bekijk wijken en buurten": flies to gemeente `code` at wijk zoom (or deeper
 * when the gemeente is small); the zoom/move handlers then show its wijken.
 */
export async function drillIntoGemeente(code) {
  let geo;
  try { geo = await loadGeoJSON(GEMEENTE_URL); } catch { return false; }
  const feature = geo?.features?.find(f => String(f.properties?.statcode ?? '').trim() === code);
  if (!feature) return false;
  const map = getMap();
  const bounds = L.geoJSON(feature).getBounds();
  const fitZoom = map.getBoundsZoom(bounds, false, L.point(24, 24));
  const at = labelPoint(feature.geometry) ?? bounds.getCenter();   // inside the gemeente, so the centre test finds it
  map.setView(at, Math.min(Math.max(fitZoom, ZOOM_WIJK), ZOOM_BUURT + 1));
  return true;
}

// ── Focus (search, deep links) ───────────────────────────────────────────────

/**
 * Nederland scope: zooms to a provincie (PV..), gemeente (GM..) or a wijk/buurt (WK../BU..,
 * via the drill-down).
 * Gemeenten land at least on the gemeente tier so their outline is on the map.
 */
export async function focusNederlandArea(code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (gemeenteOf(c)) return focusDrillArea(c, { zoomFor: lvl => DRILL_ZOOM[lvl] });   // NL wijk/buurt
  const isProvince = /^PV\d{2}$/.test(c);
  if (!isProvince && !/^GM\d{4}$/.test(c)) return null;
  let geo;
  try { geo = await loadGeoJSON(isProvince ? './data/provinces.json' : GEMEENTE_URL); } catch { return null; }
  const feature = geo?.features?.find(f => String(f.properties?.statcode ?? '').trim().toUpperCase() === c);
  if (!feature) return null;
  const rawCode = feature.properties.statcode;
  const name    = feature.properties?.statnaam ?? c;
  const map     = getMap();
  const bounds  = L.geoJSON(feature).getBounds();
  if (bounds.isValid()) {
    const fitZoom = map.getBoundsZoom(bounds, false, L.point(48, 48));
    const zoom = isProvince
      ? Math.min(fitZoom, ZOOM_MUNICIPALITY - 1)
      : Math.min(Math.max(fitZoom, ZOOM_MUNICIPALITY), ZOOM_WIJK - 1);
    map.setView(bounds.getCenter(), zoom);
  }
  if (!isProvince) { activeGemeente = rawCode; activeGemeenteName = name; }
  return { code: c, name };
}
