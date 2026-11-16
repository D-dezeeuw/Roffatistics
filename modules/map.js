import { addOvLayers, pickInitialOv } from './ov.js';
import { addSchoolPinsLayer, pickInitialSchoolPins } from './school-pins.js';
import { CITY } from './city.js';

// ── Basemap configuration (pure data, unit-tested) ───────────────────────────
// Keyless providers only: OpenFreeMap vector styles (rendered by MapLibre GL
// through @maplibre/maplibre-gl-leaflet) and the PDOK aerial photo WMTS.

const OFM_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export const BASEMAPS = Object.freeze({
  dark: Object.freeze({
    id:          'dark',
    label:       'Donker',
    type:        'vector',
    style:       'https://tiles.openfreemap.org/styles/dark',
    attribution: OFM_ATTRIBUTION,
  }),
  light: Object.freeze({
    id:          'light',
    label:       'Licht',
    type:        'vector',
    style:       'https://tiles.openfreemap.org/styles/positron',
    attribution: OFM_ATTRIBUTION,
  }),
  aerial: Object.freeze({
    id:            'aerial',
    label:         'Satelliet',   // id stays 'aerial': stored choices and share links keep working
    type:          'raster',
    url:           'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
    attribution:   'Luchtfoto &copy; <a href="https://www.pdok.nl/" target="_blank" rel="noopener">PDOK</a> / Beeldmateriaal Nederland',
    maxNativeZoom: 19,
  }),
});

export const DEFAULT_BASEMAP = 'dark';
export const BASEMAP_STORAGE_KEY = 'roffatistics.basemap';

/** Returns the config for `id`, or the default basemap for unknown ids. */
export function resolveBasemap(id) {
  return Object.hasOwn(BASEMAPS, id) ? BASEMAPS[id] : BASEMAPS[DEFAULT_BASEMAP];
}

/** Reads the stored basemap choice; any storage failure falls back to the default. */
export function pickInitialBasemap(storage) {
  try {
    return resolveBasemap(storage?.getItem(BASEMAP_STORAGE_KEY)).id;
  } catch {
    return DEFAULT_BASEMAP;
  }
}

/** Builds the Leaflet layer for a basemap config. `Leaflet` is injected for testing. */
export function createBasemapLayer(Leaflet, config) {
  if (config.type === 'vector') {
    // Default pane of the plugin is tilePane (z 200), below overlayPane (z 400).
    return Leaflet.maplibreGL({
      style:       config.style,
      attribution: config.attribution,
      pane:        'tilePane',
    });
  }
  return Leaflet.tileLayer(config.url, {
    attribution:   config.attribution,
    maxNativeZoom: config.maxNativeZoom,
    maxZoom:       MAX_ZOOM,
    crossOrigin:   'anonymous',   // PDOK sends CORS headers; lets the snapshot (snapshot-render.js) read the tiles
  });
}

/**
 * The OpenFreeMap styles ask for sprite images their sprite sheet lacks
 * ('wood-pattern', 'circle-11'); MapLibre then warns once per tile. Answer
 * each missing id with a 1×1 transparent image. Safe on null / a fake map.
 */
export function patchMissingImages(glMap) {
  if (!glMap || typeof glMap.on !== 'function') return false;
  glMap.on('styleimagemissing', e => {
    const id = e?.id;
    if (!id || glMap.hasImage?.(id)) return;
    try { glMap.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) }); } catch { /* style not ready: next request retries */ }
  });
  return true;
}

// ── Map ───────────────────────────────────────────────────────────────────────

const NL_CENTER = CITY.centre;   // the city's centre (config/cities.json; Rotterdam by default)
const MAX_ZOOM  = 17;

const NL_MIN_ZOOM = 6;
const NL_BOUNDS_ARR = [[50.5, 3.2], [53.7, 7.3]];

let map;
let basemapLayer = null;
let activeBasemap = null;
let ovLayers = null;
let schoolPins = null;

export function initMap() {
  const NL_BOUNDS = L.latLngBounds(NL_BOUNDS_ARR);

  map = L.map('map', {
    center:    NL_CENTER,
    zoom:      CITY.zoom,
    minZoom:   NL_MIN_ZOOM,
    maxZoom:   MAX_ZOOM,
    maxBounds: NL_BOUNDS,
    maxBoundsViscosity: 0.85,
  });

  let storage = null;
  try { storage = window.localStorage; } catch { /* storage blocked */ }
  setBasemap(pickInitialBasemap(storage));
  ovLayers = addOvLayers(L, map);   // basemap, theme and OV are chosen in Instellingen (settings.js)
  schoolPins = addSchoolPinsLayer(L, map, { storage });   // Basisscholen, also in Instellingen

  // invalidateSize fires Leaflet 'resize', which the maplibre layer forwards to its GL canvas.
  window.addEventListener('resize', () => map.invalidateSize());

  return map;
}

export function setBasemap(id) {
  const config = resolveBasemap(id);
  if (config.id === activeBasemap) return;

  let layer;
  try {
    if (config.type === 'vector' && typeof L.maplibreGL !== 'function') throw new Error('maplibre-gl-leaflet missing');
    layer = createBasemapLayer(L, config);
  } catch (err) {
    // No WebGL or plugin not loaded: fall back to the raster aerial photo.
    console.warn('Basemap', config.id, 'unavailable, using aerial photo:', err);
    if (config.id === 'aerial') return;
    return setBasemap('aerial');
  }

  if (basemapLayer) map.removeLayer(basemapLayer);
  basemapLayer = layer.addTo(map);
  if (config.type === 'vector') patchMissingImages(layer.getMaplibreMap?.());
  activeBasemap = config.id;

  try { window.localStorage.setItem(BASEMAP_STORAGE_KEY, config.id); } catch { /* ignore */ }
}

export function getActiveBasemap() { return activeBasemap; }
/** The MapLibre map behind a vector basemap (null for the aerial photo); used by the snapshot. */
export function getBasemapGL() { return basemapLayer?.getMaplibreMap?.() ?? null; }

/** OV toggle state ({ metro, tram, bus }) of the drawn lines; before initMap the stored state. */
export function getOvModes() {
  if (ovLayers) return ovLayers.get();
  try { return pickInitialOv(window.localStorage); } catch { return pickInitialOv(null); }
}
/** Switches OV lines on/off; the chosen basemap, area layer and P2000 layer stay as they are. */
export function setOvModes(state) { return ovLayers?.set(state); }

/** Whether the Basisscholen pins are on; before initMap the stored state. */
export function getSchoolPins() {
  if (schoolPins) return schoolPins.get();
  try { return pickInitialSchoolPins(window.localStorage); } catch { return pickInitialSchoolPins(null); }
}
/** Switches the school pins on/off (the school file is fetched on first use). */
export function setSchoolPins(on) { return schoolPins?.set(on); }

export function getMap() { return map; }

/**
 * Locks the map to a scope. 'rotterdam' with `bounds` ([[s,w],[n,e]]): fit to
 * the city, maxBounds = bounds plus padding, minZoom one step below the fit.
 * 'nederland': today's limits (NL bounds, minZoom 6); `fit` flies to the
 * national overview, otherwise the current view is kept.
 */
let pendingScope = null;

export function setMapScope(scope, { bounds = null, fit = true } = {}) {
  if (!map) return;
  if (map.getSize().x === 0) {
    // Map container hidden (Dashboard/Ranglijst view): fit once it is visible.
    pendingScope = [scope, { bounds, fit }];
    return;
  }
  pendingScope = null;
  if (scope === 'rotterdam' && bounds) {
    const b = L.latLngBounds(bounds);
    const fitZoom = map.getBoundsZoom(b);
    map.setMinZoom(Math.max(NL_MIN_ZOOM, fitZoom - 1));
    map.setMaxBounds(b.pad(0.15));
    if (fit) map.fitBounds(b, { animate: false });
    return;
  }
  map.setMinZoom(NL_MIN_ZOOM);
  map.setMaxBounds(L.latLngBounds(NL_BOUNDS_ARR));
  if (fit) map.setView([52.2, 5.3], 7);
}

/** Call when the map view becomes visible: resizes and applies a deferred setMapScope. */
export function refreshMapSize() {
  if (!map) return;
  map.invalidateSize();
  if (pendingScope && map.getSize().x > 0) setMapScope(...pendingScope);
}
