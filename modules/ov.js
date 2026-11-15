// ── OV lines: metro, tram and (optional) bus from OpenStreetMap ─────────────
// Prebuilt by scripts/build-ov-lines.mjs into data/ov/. Pure parts (state,
// distances, values) are unit-tested; addOvSwitcher draws the Leaflet layers.
// Data © OpenStreetMap contributors (ODbL).

export const OV_MODES = Object.freeze({
  metro: Object.freeze({ id: 'metro', label: 'Metro', color: '#2662cc', weight: 1.4, stopRadius: 3.5 }),
  tram:  Object.freeze({ id: 'tram',  label: 'Tram',  color: '#b72824', weight: 1, stopRadius: 2.5 }),
  bus:   Object.freeze({ id: 'bus',   label: 'Bus',   color: '#907b55', weight: 0.5, stopRadius: 2,   hint: 'alleen regio Rotterdam' }),
});
/** Draw order, bottom to top. */
export const OV_DRAW_ORDER = Object.freeze(['bus', 'tram', 'metro']);

export const OV_URLS = Object.freeze({
  lines:   './data/ov/metro-tram.json',
  bus:     './data/ov/bus-rotterdam.json',
  afstand: './data/ov/afstand.json',
});
export const OV_STORAGE_KEY = 'roffatistics.ov';
export const DEFAULT_OV = Object.freeze({ metro: true, tram: true, bus: false });
export const OV_STOP_MIN_ZOOM = 14;
export const OSM_ATTRIBUTION = 'OV-lijnen &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-bijdragers (ODbL)';

// ── Toggle state (stored as "metro,tram"; "" = all off; missing = default) ──

export function parseOvState(raw) {
  if (typeof raw !== 'string') return { ...DEFAULT_OV };
  const on = new Set(raw.split(',').map(s => s.trim()));
  return Object.fromEntries(Object.keys(OV_MODES).map(k => [k, on.has(k)]));
}

export const serializeOvState = state => Object.keys(OV_MODES).filter(k => state?.[k]).join(',');

/** Stored toggle state; any storage failure gives the default (metro + tram on, bus off). */
export function pickInitialOv(storage) {
  try { return parseOvState(storage?.getItem(OV_STORAGE_KEY) ?? null); } catch { return { ...DEFAULT_OV }; }
}

export function storeOv(state, storage) {
  try { storage?.setItem(OV_STORAGE_KEY, serializeOvState(state)); } catch { /* storage blocked */ }
}

/** New state with `mode` flipped; unknown modes leave it unchanged. */
export function toggleOv(state, mode) {
  return Object.hasOwn(OV_MODES, mode) ? { ...state, [mode]: !state?.[mode] } : { ...state };
}

// ── Distances ─────────────────────────────────────────────────────────────────

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const minKnown = (...vs) => { const k = vs.filter(v => v != null); return k.length ? Math.min(...k) : null; };

/** Great-circle km between two [lat, lng] points. */
function haversine([lat1, lng1], [lat2, lng2]) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Straight-line km (1 decimal) from `point` [lat, lng] to the nearest stop.
 * Stops are [lng, lat, ...] as stored in data/ov. Null without point or stops.
 */
export function nearestStopKm(point, stops) {
  if (!point || !stops?.length) return null;
  let best = Infinity;
  for (const s of stops) {
    const d = haversine(point, [s[1], s[0]]);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? +best.toFixed(1) : null;
}

/**
 * The four OV values of an area. `pair` = [distMetro, distTram] from the
 * prebuilt table (else the values already present are used).
 * distOvHalte = nearest metro or tram stop; distOv = nearest of that and the
 * CBS train station distance (null when the train distance is unknown, so a
 * level without CBS nabijheid keeps its old behaviour).
 */
export function ovValues(values = {}, pair = null) {
  const metro = num(pair ? pair[0] : values?.distMetro);
  const tram  = num(pair ? pair[1] : values?.distTram);
  const halte = minKnown(metro, tram);
  const station = num(values?.distStation);
  return { distMetro: metro, distTram: tram, distOvHalte: halte, distOv: station == null ? null : minKnown(station, halte) };
}

/** Values with the OV keys added from `table` ({ CODE: [metro, tram] }). */
export function withOvValues(values, code, table) {
  return { ...values, ...ovValues(values, table?.[code] ?? [null, null]) };
}

let afstandPromise = null;
/** Prebuilt { CODE: [distMetro, distTram] } for gemeenten and Rotterdam wijken/buurten; {} when it fails. */
export function loadOvAfstand({ fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
  if (afstandPromise) return afstandPromise;
  afstandPromise = (async () => {
    try {
      const res = await fetcher(OV_URLS.afstand);
      if (!res.ok) return {};
      return (await res.json())?.codes ?? {};
    } catch { return {}; }
  })();
  return afstandPromise;
}
export function _resetOvCache() { afstandPromise = null; }

// ── Leaflet layers + switcher ─────────────────────────────────────────────────

/** [[lng, lat], …] lines → Leaflet [[lat, lng], …]. */
export const toLatLngs = lines => (lines ?? []).map(l => l.map(([x, y]) => [y, x]));

/** Adds the "OV-lijnen" switch (Metro / Tram / Bus) under the theme switcher. */
export function addOvSwitcher(L, map) {
  let storage = null;
  try { storage = window.localStorage; } catch { /* storage blocked */ }
  let state = pickInitialOv(storage);
  for (const [name, z] of [['ovLines', 450], ['ovStops', 455]]) {
    if (map.getPane(name)) continue;
    const p = map.createPane(name);
    p.style.zIndex = String(z);        // above the area fills (overlayPane 400), below score stamps and tooltips
    p.style.pointerEvents = 'none';    // never steals hover/click from the areas
  }
  const lineRenderer = L.canvas({ pane: 'ovLines', padding: 0.3 });
  const stopRenderer = L.canvas({ pane: 'ovStops', padding: 0.3 });
  const data = {};       // mode → { lines, stops }
  const loads = {};      // url → promise
  const drawn = {};      // mode → { line, stops }
  let attributed = false;

  const fetchJSON = url => (loads[url] ??= fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null));
  async function ensure(mode) {
    if (data[mode]) return data[mode];
    const file = await fetchJSON(mode === 'bus' ? OV_URLS.bus : OV_URLS.lines);
    if (file?.modes) for (const [k, v] of Object.entries(file.modes)) data[k] ??= v;
    return data[mode] ?? null;
  }
  function layerFor(mode) {
    if (drawn[mode] || !data[mode]) return drawn[mode] ?? null;
    const cfg = OV_MODES[mode];
    const line = L.polyline(toLatLngs(data[mode].lines), {
      renderer: lineRenderer, pane: 'ovLines', interactive: false,
      color: cfg.color, weight: cfg.weight, opacity: 0.9, lineCap: 'round', lineJoin: 'round', smoothFactor: 1,
    });
    const stops = L.layerGroup((data[mode].stops ?? []).map(([x, y]) => L.circleMarker([y, x], {
      renderer: stopRenderer, pane: 'ovStops', interactive: false,
      radius: cfg.stopRadius, color: '#ffffff', weight: 1, fillColor: cfg.color, fillOpacity: 1,
    })));
    return (drawn[mode] = { line, stops });
  }
  function redraw() {
    for (const d of Object.values(drawn)) { d.line.remove(); d.stops.remove(); }
    const showStops = map.getZoom() >= OV_STOP_MIN_ZOOM;
    for (const mode of OV_DRAW_ORDER) {
      if (!state[mode]) continue;
      const d = layerFor(mode);
      if (!d) continue;
      d.line.addTo(map);
      if (showStops) d.stops.addTo(map);
    }
    const any = OV_DRAW_ORDER.some(m => state[m] && drawn[m]);
    if (any !== attributed && map.attributionControl) {
      if (any) map.attributionControl.addAttribution(OSM_ATTRIBUTION);
      else map.attributionControl.removeAttribution(OSM_ATTRIBUTION);
      attributed = any;
    }
  }
  async function refresh() {
    await Promise.all(OV_DRAW_ORDER.filter(m => state[m]).map(ensure));
    redraw();
  }

  const Switcher = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const el = L.DomUtil.create('div', 'basemap-switcher ov-switcher leaflet-bar');
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', 'OV-lijnen');
      const label = L.DomUtil.create('span', 'theme-label', el);
      label.textContent = 'OV';
      label.title = 'OV-lijnen (OpenStreetMap)';
      label.setAttribute('aria-hidden', 'true');
      for (const m of Object.values(OV_MODES)) {
        const btn = L.DomUtil.create('button', 'basemap-opt ov-opt', el);
        btn.type = 'button';
        btn.dataset.ov = m.id;
        btn.setAttribute('role', 'checkbox');
        btn.title = m.hint ? `${m.label} (${m.hint})` : m.label;
        const sw = L.DomUtil.create('span', `ov-swatch ov-swatch-${m.id}`, btn);
        sw.setAttribute('aria-hidden', 'true');
        btn.append(m.label);
        btn.addEventListener('click', () => { state = toggleOv(state, m.id); storeOv(state, storage); update(); refresh(); });
      }
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      return el;
    },
  });
  const el = new Switcher().addTo(map).getContainer();
  function update() {
    for (const btn of el.querySelectorAll('.ov-opt')) {
      const on = !!state[btn.dataset.ov];
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }
  update();
  map.on('zoomend', redraw);
  refresh();
  return el;
}
