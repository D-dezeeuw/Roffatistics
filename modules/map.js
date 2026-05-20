const TILE_URL   = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_OPTS  = {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains:  'abcd',
  maxZoom:     19,
};

const NL_CENTER  = [52.3, 5.3];
const NL_BOUNDS  = L.latLngBounds([50.5, 3.2], [53.7, 7.3]);

let map;

export function initMap() {
  map = L.map('map', {
    center:    NL_CENTER,
    zoom:      7,
    minZoom:   6,
    maxZoom:   17,
    maxBounds: NL_BOUNDS,
    maxBoundsViscosity: 0.85,
  });

  L.tileLayer(TILE_URL, TILE_OPTS).addTo(map);

  return map;
}

export function getMap() { return map; }
