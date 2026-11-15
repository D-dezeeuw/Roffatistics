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
    label:         'Luchtfoto',
    type:          'raster',
    url:           'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
    attribution:   '&copy; <a href="https://www.pdok.nl/" target="_blank" rel="noopener">PDOK</a> / Beeldmateriaal Nederland',
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
  });
}

// ── Map ───────────────────────────────────────────────────────────────────────

const NL_CENTER = [51.9225, 4.4792]; // Rotterdam centre
const MAX_ZOOM  = 17;

let map;
let basemapLayer = null;
let activeBasemap = null;
let switcherEl = null;

export function initMap() {
  const NL_BOUNDS = L.latLngBounds([50.5, 3.2], [53.7, 7.3]);

  map = L.map('map', {
    center:    NL_CENTER,
    zoom:      12,
    minZoom:   6,
    maxZoom:   MAX_ZOOM,
    maxBounds: NL_BOUNDS,
    maxBoundsViscosity: 0.85,
  });

  let storage = null;
  try { storage = window.localStorage; } catch { /* storage blocked */ }
  setBasemap(pickInitialBasemap(storage));
  addBasemapSwitcher();

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
  activeBasemap = config.id;

  try { window.localStorage.setItem(BASEMAP_STORAGE_KEY, config.id); } catch { /* ignore */ }
  updateSwitcher();
}

export function getActiveBasemap() { return activeBasemap; }

function addBasemapSwitcher() {
  const Switcher = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const el = L.DomUtil.create('div', 'basemap-switcher leaflet-bar');
      el.setAttribute('role', 'radiogroup');
      el.setAttribute('aria-label', 'Achtergrondkaart');
      for (const cfg of Object.values(BASEMAPS)) {
        const btn = L.DomUtil.create('button', 'basemap-opt', el);
        btn.type = 'button';
        btn.dataset.basemap = cfg.id;
        btn.textContent = cfg.label;
        btn.setAttribute('role', 'radio');
        btn.addEventListener('click', () => setBasemap(cfg.id));
      }
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      return el;
    },
  });
  switcherEl = new Switcher().addTo(map).getContainer();
  updateSwitcher();
}

function updateSwitcher() {
  if (!switcherEl) return;
  for (const btn of switcherEl.querySelectorAll('.basemap-opt')) {
    const on = btn.dataset.basemap === activeBasemap;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  }
}

export function getMap() { return map; }
