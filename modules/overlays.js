import { getMap } from './map.js';

const ZOOM_NATIONAL     = 6;
const ZOOM_MUNICIPALITY = 10;
const ZOOM_BUURT        = 13;

const GEMEENTE_URL = 'https://service.pdok.nl/cbs/gebiedsindelingen/2024/wfs/v1_0?request=GetFeature&service=WFS&version=2.0.0&typeName=gebiedsindelingen:gemeente_gegeneraliseerd&outputFormat=json&srsName=EPSG:4326';
const BUURT_URL    = './data/buurt_2024.geojson';

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

const STYLE_BUURT = {
  fillColor:   'transparent',
  fillOpacity: 0,
  color:       '#ea580c',
  weight:      0.75,
  opacity:     0.5,
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
  if (zoom >= ZOOM_BUURT)        return 'buurt';
  if (zoom >= ZOOM_MUNICIPALITY) return 'municipality';
  return 'province';
}

const layers   = { national: null, province: null, municipality: null, buurt: null };
let activeTier = null;
let provinceData     = [];
let municipalityData = [];
let activeColorState = null; // { lookup, min, max } — set by applyDataset
let activeGemeente     = null; // GM code of the last clicked gemeente
let activeGemeenteName = null; // display name of the last clicked gemeente
const geoCache = {};

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
export function getActiveGemeente()     { return activeGemeente; }
export function getActiveGemeenteName() { return activeGemeenteName; }

// Choropleth fill opacity scales down as the user zooms in so map tiles remain
// visible at city and neighbourhood level.
function choroplethOpacity() {
  if (activeTier === 'buurt')        return 0.25;
  if (activeTier === 'municipality') return 0.45;
  return 0.65;
}

export function applyDataset(data, valueKey) {
  const values = data.map(d => d[valueKey]).filter(v => v != null);
  const min    = Math.min(...values);
  const max    = Math.max(...values);
  const lookup = Object.fromEntries(data.map(d => [d.regionCode, d[valueKey]]));

  activeColorState = { lookup, min, max };

  // Color the municipality layer — it is visible at both municipality and buurt tiers.
  const targetLayer = (activeTier === 'municipality' || activeTier === 'buurt')
    ? layers.municipality
    : layers.province;

  if (targetLayer) {
    const fillOpacity = choroplethOpacity();
    targetLayer.eachLayer(fl => {
      const code  = fl.feature?.properties?.statcode;
      const value = lookup[code];
      fl.setStyle(
        value != null
          ? { fillColor: interpolateColor(value, min, max), fillOpacity }
          : { ...STYLE_DEFAULT },
      );
    });
  }

  return { min, max };
}

function restoreStyle(code) {
  if (!activeColorState) return { ...STYLE_DEFAULT };
  const value = activeColorState.lookup[code];
  return value != null
    ? { ...STYLE_DEFAULT, fillColor: interpolateColor(value, activeColorState.min, activeColorState.max), fillOpacity: choroplethOpacity() }
    : { ...STYLE_DEFAULT };
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
            .setContent(`<strong>${name}</strong>`)
            .openOn(getMap());
        },
        mouseout(e) {
          e.target.setStyle(restoreStyle(code));
          getMap().closePopup();
        },
        click() {
          activeGemeente     = code;
          activeGemeenteName = name;
          const data = municipalityData.find(d => d.regionCode === code) ?? null;
          import('./panel.js').then(({ showPanel }) => showPanel({ name, code, data }));
        },
      });
    },
  });
}

function makeBuurtLayer(geojson, gmCode) {
  const prefix = 'BU' + gmCode.replace('GM', '');
  const filtered = {
    ...geojson,
    features: geojson.features.filter(f =>
      (f.properties?.statcode ?? '').startsWith(prefix),
    ),
  };
  return L.geoJSON(filtered, {
    style: () => ({ ...STYLE_BUURT }),
    onEachFeature(feature, featureLayer) {
      const buurtName = feature.properties?.statnaam ?? '';
      featureLayer.on({
        mouseover(e) {
          e.target.setStyle({ ...STYLE_BUURT, color: '#f97316', weight: 1.5, opacity: 1 });
          e.target.bringToFront();
          L.popup({ closeButton: false, offset: [0, -4] })
            .setLatLng(e.latlng)
            .setContent(`<strong>${buurtName}</strong>`)
            .openOn(getMap());
        },
        mouseout(e) {
          e.target.setStyle({ ...STYLE_BUURT });
          getMap().closePopup();
        },
        // Clicking a buurt shows the parent gemeente data.
        click() {
          const data = municipalityData.find(d => d.regionCode === activeGemeente) ?? null;
          import('./panel.js').then(({ showPanel }) =>
            showPanel({ name: activeGemeenteName, code: activeGemeente, data }));
        },
      });
    },
  });
}

function makeNationalLayer(geojson) {
  return L.geoJSON(geojson, { style: () => ({ ...STYLE_NATIONAL }) });
}

function addKeyboardNav(geoLayer) {
  geoLayer.eachLayer(fl => {
    const el = fl.getElement?.();
    if (!el) return;
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

function deriveGemeenteFromMapCentre() {
  if (!layers.municipality) return null;
  const centre = getMap().getCenter();
  let found = null;
  layers.municipality.eachLayer(fl => {
    if (found) return;
    if (fl.getBounds().contains(centre)) {
      found = fl.feature?.properties?.statcode ?? null;
    }
  });
  return found;
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
    // Remove province/national if that was active; remove buurt overlay if present.
    if (activeTier === 'province' || activeTier === 'national') {
      if (layers[activeTier]) map.removeLayer(layers[activeTier]);
    }
    if (layers.buurt) {
      map.removeLayer(layers.buurt);
      layers.buurt = null;
    }
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

  if (tier === 'buurt') {
    // Remove province/national if that was active.
    if (activeTier === 'province' || activeTier === 'national') {
      if (layers[activeTier]) map.removeLayer(layers[activeTier]);
    }
    // Keep the gemeente layer on the map as the choropleth background.
    try {
      await ensureGemeenteLayer(map);
    } catch {
      if (layers[activeTier]) layers[activeTier].addTo(map);
      return;
    }

    const gmCode = activeGemeente ?? deriveGemeenteFromMapCentre();
    if (!gmCode) {
      // No gemeente context — show municipality tier instead.
      activeTier = 'municipality';
      document.dispatchEvent(new CustomEvent('tier-change', { detail: { tier: 'municipality' } }));
      return;
    }

    activeGemeente = gmCode;
    // Remove stale buurt layer (gemeente may have changed).
    if (layers.buurt) {
      map.removeLayer(layers.buurt);
      layers.buurt = null;
    }
    try {
      const buurtData = await loadGeoJSON(BUURT_URL);
      layers.buurt = makeBuurtLayer(buurtData, gmCode);
    } catch {
      activeTier = 'municipality';
      return;
    }
    layers.buurt.addTo(map);
    activeTier = 'buurt';
    document.dispatchEvent(new CustomEvent('tier-change', { detail: { tier: 'buurt' } }));
    return;
  }

  // province or national — tear down the municipality/buurt layers.
  if (layers.buurt) {
    map.removeLayer(layers.buurt);
    layers.buurt = null;
  }
  if (layers.municipality && map.hasLayer(layers.municipality)) {
    map.removeLayer(layers.municipality);
  }
  layers[tier].addTo(map);
  activeTier = tier;
  document.dispatchEvent(new CustomEvent('tier-change', { detail: { tier } }));
}

async function swapToTier(tier) {
  if (tier === activeTier) return;
  if (isSwapping) {
    pendingTier = tier; // remember the latest requested tier
    return;
  }
  isSwapping = true;
  try {
    await _doSwap(tier);
  } finally {
    isSwapping = false;
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

export async function initOverlays() {
  const map  = getMap();
  const data = await loadGeoJSON('./data/provinces.json');

  layers.national = makeNationalLayer(data);
  layers.province = makeProvinceLayer(data);

  activeTier = 'province';
  layers.province.addTo(map);
  addKeyboardNav(layers.province);

  map.on('zoomend', () => swapToTier(resolveZoomTier(map.getZoom())));
}
