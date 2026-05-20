import { getMap } from './map.js';

const ZOOM_PROVINCE    = 7;
const ZOOM_MUNICIPALITY = 10;

const STYLE_DEFAULT = {
  fillColor:   '#7c3aed',
  fillOpacity: 0.12,
  color:       '#7c3aed',
  weight:      1,
  opacity:     0.6,
};

const STYLE_HOVER = {
  fillOpacity: 0.30,
  color:       '#ea580c',
  weight:      1.5,
  opacity:     1,
};

let activeLayer = null;
let geoCache    = {};

async function loadGeoJSON(url) {
  if (geoCache[url]) return geoCache[url];
  const res  = await fetch(url);
  const data = await res.json();
  geoCache[url] = data;
  return data;
}

function makeLayer(geojson, onEachFeature) {
  return L.geoJSON(geojson, {
    style:          () => ({ ...STYLE_DEFAULT }),
    onEachFeature,
  });
}

function onEachProvince(feature, layer) {
  const name = feature.properties?.statnaam ?? feature.properties?.name ?? '';

  layer.on({
    mouseover(e) {
      e.target.setStyle(STYLE_HOVER);
      e.target.bringToFront();
      L.popup({ closeButton: false, offset: [0, -4] })
        .setLatLng(e.latlng)
        .setContent(`<strong>${name}</strong>`)
        .openOn(getMap());
    },
    mouseout(e) {
      activeLayer?.resetStyle(e.target);
      getMap().closePopup();
    },
    click(e) {
      import('./panel.js').then(({ showPanel }) => showPanel({ name, code: feature.properties?.statcode }));
    },
  });
}

export async function initOverlays() {
  const map  = getMap();
  const data = await loadGeoJSON('./data/provinces.json');
  activeLayer = makeLayer(data, onEachProvince);
  activeLayer.addTo(map);

  map.on('zoomend', () => handleZoom(map.getZoom()));
}

async function handleZoom(zoom) {
  // Municipality layer loaded lazily in Phase 6
  if (zoom < ZOOM_PROVINCE && activeLayer) {
    activeLayer.setStyle({ fillOpacity: 0.06, opacity: 0.3 });
  } else {
    activeLayer?.setStyle(() => ({ ...STYLE_DEFAULT }));
  }
}
