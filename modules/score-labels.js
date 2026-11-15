// Score stamps: the rounded Woonscore drawn on every area of the shown level
// (Rotterdam wijk/buurt, NL gemeente/provincie). Non-interactive Leaflet divIcon
// markers in their own pane above the fills. Placement helpers are pure (unit
// tested); createScoreLabels() is the Leaflet part and needs the global `L`.

const isNum = v => typeof v === 'number' && Number.isFinite(v);

// Which level is stamped at which zoom is the plan's (zoom-plan.js); re-exported for older importers.
import { LABEL_MIN_ZOOM, labelsVisibleAt } from './zoom-plan.js';
export { LABEL_MIN_ZOOM, labelsVisibleAt };

/** Label box in screen pixels for declutter (11 px bold digits plus halo). */
export const LABEL_BOX = Object.freeze({ w: 24, h: 14 });

/**
 * Greedy screen-space declutter: indices of `points` ({ x, y } or null) kept,
 * in input order, so that no two kept boxes of w×h px around them overlap.
 * The first valid point is always kept, so a level with stamps never shows zero.
 */
export function declutter(points, { w = LABEL_BOX.w, h = LABEL_BOX.h } = {}) {
  const kept = [];
  const grid = new Map();
  const key = (cx, cy) => `${cx},${cy}`;
  points.forEach((p, i) => {
    if (!p || !isNum(p.x) || !isNum(p.y)) return;
    const cx = Math.floor(p.x / w), cy = Math.floor(p.y / h);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const q of grid.get(key(cx + dx, cy + dy)) ?? []) {
          if (Math.abs(q.x - p.x) < w && Math.abs(q.y - p.y) < h) return;
        }
      }
    }
    const k = key(cx, cy);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
    kept.push(i);
  });
  return kept;
}

/** Total outer-ring area of a Polygon/MultiPolygon (degrees², for ordering only). */
export function geometryArea(geometry) {
  const polys = geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polys.reduce((s, p) => s + (p?.[0]?.length ? Math.abs(ringArea(p[0])) : 0), 0);
}

/** Text of one stamp: the rounded score, or null without a number. */
export function labelText(value) {
  return isNum(value) ? String(Math.round(value)) : null;
}

/** Signed area (shoelace) of a ring of [x, y] points. */
function ringArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  return s / 2;
}

/** Area centroid of a ring ([x, y]); the vertex mean for a degenerate ring. */
function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
    a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-15) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Even-odd point-in-polygon over all rings (outer ring plus holes). */
export function pointInRings(pt, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Midpoint of the widest inside stretch of the horizontal line y across `rings`; null when it misses. */
function scanlinePoint(rings, y) {
  const xs = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
    }
  }
  xs.sort((a, b) => a - b);
  let best = null;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const w = xs[k + 1] - xs[k];
    if (w > 0 && (!best || w > best.w)) best = { w, x: (xs[k] + xs[k + 1]) / 2 };
  }
  return best ? [best.x, y] : null;
}

/**
 * Label point of one GeoJSON geometry (Polygon or MultiPolygon, [lng, lat])
 * as Leaflet [lat, lng]: the area centroid of the largest polygon, or, when
 * that falls outside it (crescent, U shape, hole), the middle of the widest
 * inside stretch on a horizontal line through the centroid (then through the
 * bbox middle). Null for anything without a polygon.
 */
export function labelPoint(geometry) {
  const g = geometry?.type === 'Feature' ? geometry.geometry : geometry;
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  let best = null, bestArea = -1;
  for (const p of polys) {
    if (!p?.[0]?.length) continue;
    const a = Math.abs(ringArea(p[0])) - p.slice(1).reduce((s, h) => s + Math.abs(ringArea(h)), 0);
    if (a > bestArea) { bestArea = a; best = p; }
  }
  if (!best) return null;
  const c = ringCentroid(best[0]);
  if (pointInRings(c, best)) return [c[1], c[0]];
  const ys = best[0].map(p => p[1]);
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  const p = scanlinePoint(best, c[1]) ?? scanlinePoint(best, mid);
  return p ? [p[1], p[0]] : [c[1], c[0]];
}

const PANE = 'scoreLabels';

/**
 * A stamp layer on `map`. set(items, level) draws [{ code, geometry, value }]
 * (label points cached per code); clear() removes them. The group is on the
 * map while labelsVisibleAt(level, zoom); on every zoomend the stamps are
 * decluttered (larger areas first), never down to zero.
 */
export function createScoreLabels(map) {
  if (!map.getPane(PANE)) {
    const pane = map.createPane(PANE);
    pane.style.zIndex = 450;              // above overlayPane (400), below tooltips/popups
    pane.style.pointerEvents = 'none';
  }
  const group = L.layerGroup();
  const points = new Map();   // code → { at, size }
  let entries = [];           // [{ marker, at }], larger areas first
  let level = null;
  const sync = () => {
    const on = level != null && entries.length > 0 && labelsVisibleAt(level, map.getZoom());
    if (!on) { if (map.hasLayer(group)) map.removeLayer(group); return; }
    const keep = new Set(declutter(entries.map(e => map.latLngToLayerPoint(e.at))));
    entries.forEach((e, i) => {
      const has = group.hasLayer(e.marker);
      if (keep.has(i) && !has) group.addLayer(e.marker);
      else if (!keep.has(i) && has) group.removeLayer(e.marker);
    });
    if (!map.hasLayer(group)) group.addTo(map);
  };
  map.on('zoomend', sync);
  return {
    set(items, lvl) {
      group.clearLayers();
      level = lvl;
      entries = [];
      for (const { code, geometry, value } of items ?? []) {
        const text = labelText(value);
        if (text == null) continue;
        if (!points.has(code)) points.set(code, { at: labelPoint(geometry), size: geometryArea(geometry) });
        const { at, size } = points.get(code);
        if (!at) continue;
        const marker = L.marker(at, {
          pane: PANE, interactive: false, keyboard: false,
          icon: L.divIcon({ className: 'score-label', html: `<span>${text}</span>`, iconSize: null }),
        });
        entries.push({ marker, at, size });
      }
      entries.sort((a, b) => b.size - a.size);
      sync();
    },
    clear() { group.clearLayers(); entries = []; level = null; sync(); },
  };
}
