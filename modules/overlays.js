import { getMap } from './map.js';

const ZOOM_NATIONAL     = 6;
const ZOOM_MUNICIPALITY = 10;

const GEMEENTE_URL = 'https://cartomap.github.io/nl/wgs84/gemeente_2023.geojson';

const STYLE_DEFAULT = {
  fillColor:   '#7c3aed',
  fillOpacity: 0.15,
  color:       '#7c3aed',
  weight:      1,
  opacity:     0.6,
};

const STYLE_NATIONAL = {
  fillColor:   '#7c3aed',
  fillOpacity: 0.08,
  color:       '#7c3aed',
  weight:      1,
  opacity:     0.35,
};

const STYLE_HOVER = {
  fillOpacity: 0.35,
  color:       '#ea580c',
  weight:      1.5,
  opacity:     1,
};

// Low → #2e1065 (deep purple)  High → #ea580c (orange)
export function interpolateColor(value, min, max) {
  const t = max === min ? 0 : (value - min) / (max - min);
  const r = Math.round(46  + t * (234 - 46));
  const g = Math.round(16  + t * (88  - 16));
  const b = Math.round(101 + t * (12  - 101));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function resolveZoomTier(zoom) {
  if (zoom <= ZOOM_NATIONAL)     return 'national';
  if (zoom >= ZOOM_MUNICIPALITY) return 'municipality';
  return 'province';
}

const layers   = { national: null, province: null, municipality: null };
let activeTier = null;
let provinceData = [];
let activeColorState = null; // { lookup, min, max } — set by applyDataset
const geoCache = {};

export function setProvinceData(data) {
  provinceData = data;
}

export function applyDataset(data, valueKey) {
  const values = data.map(d => d[valueKey]).filter(v => v != null);
  const min    = Math.min(...values);
  const max    = Math.max(...values);
  const lookup = Object.fromEntries(data.map(d => [d.regionCode, d[valueKey]]));

  activeColorState = { lookup, min, max };

  layers.province.eachLayer(fl => {
    const code  = fl.feature?.properties?.statcode;
    const value = lookup[code];
    fl.setStyle(
      value != null
        ? { fillColor: interpolateColor(value, min, max), fillOpacity: 0.7 }
        : { ...STYLE_DEFAULT },
    );
  });

  return { min, max };
}

function restoreStyle(code) {
  if (!activeColorState) return { ...STYLE_DEFAULT };
  const value = activeColorState.lookup[code];
  return value != null
    ? { ...STYLE_DEFAULT, fillColor: interpolateColor(value, activeColorState.min, activeColorState.max), fillOpacity: 0.7 }
    : { ...STYLE_DEFAULT };
}

async function loadGeoJSON(url) {
  if (geoCache[url]) return geoCache[url];
  const res  = await fetch(url);
  const data = await res.json();
  geoCache[url] = data;
  return data;
}

function makeInteractiveLayer(geojson) {
  let geoLayer;
  geoLayer = L.geoJSON(geojson, {
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
            .setContent(`<strong>${name}</strong>`)
            .openOn(getMap());
        },
        mouseout(e) {
          e.target.setStyle(restoreStyle(code));
          getMap().closePopup();
        },
        click() {
          const data = provinceData.find(d => d.regionCode === code) ?? null;
          import('./panel.js').then(({ showPanel }) => showPanel({ name, code, data }));
        },
      });
    },
  });
  return geoLayer;
}

function makeNationalLayer(geojson) {
  return L.geoJSON(geojson, { style: () => ({ ...STYLE_NATIONAL }) });
}

async function swapToTier(tier) {
  if (tier === activeTier) return;
  const map = getMap();

  map.removeLayer(layers[activeTier]);

  if (tier === 'municipality' && !layers.municipality) {
    try {
      const data = await loadGeoJSON(GEMEENTE_URL);
      layers.municipality = makeInteractiveLayer(data);
    } catch {
      layers[activeTier].addTo(map);
      return;
    }
  }

  layers[tier].addTo(map);
  activeTier = tier;
}

export async function initOverlays() {
  const map  = getMap();
  const data = await loadGeoJSON('./data/provinces.json');

  layers.national = makeNationalLayer(data);
  layers.province = makeInteractiveLayer(data);

  activeTier = 'province';
  layers.province.addTo(map);

  map.on('zoomend', () => swapToTier(resolveZoomTier(map.getZoom())));
}
