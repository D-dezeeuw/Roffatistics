// Snapshot maker (W29), browser side: paints the current view into a 1200×630
// PNG. The map is composited by hand from what Leaflet shows:
//   1. the basemap: the MapLibre GL canvas of the vector styles, copied inside
//      its own 'render' event (the drawing buffer is only valid then, so no
//      preserveDrawingBuffer and no cost on every frame), or the aerial-photo
//      <img> tiles (crossOrigin 'anonymous', map.js);
//   2. the overlay pane: Leaflet's SVG (choropleth, outlines) serialised to an
//      image, plus any <canvas> there;
// then the branded card from snapshot.js's layout. A canvas the browser marks
// as tainted (a tile without CORS) cannot be exported: we then fall back to the
// card without the map. Layout and texts: snapshot.js (pure, tested).
import { getMap, getBasemapGL } from './map.js';
import { SNAPSHOT_W, SNAPSHOT_H, coverCrop, snapshotLayout } from './snapshot.js';

const BG = '#111923';
const GREEN = '#009a3e';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "DejaVu Sans", sans-serif';
const font = (px, bold) => `${bold ? '700' : '400'} ${px}px ${FONT}`;

const loadImage = src => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('image failed: ' + String(src).slice(0, 60)));
  img.src = src;
});

/** Copies the GL canvas during its next render (or null after `ms`). */
function grabGL(glMap, ms = 1500) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish(null), ms);
    glMap.once('render', () => {
      clearTimeout(timer);
      try {
        const src = glMap.getCanvas(), copy = document.createElement('canvas');
        copy.width = src.width; copy.height = src.height;
        copy.getContext('2d').drawImage(src, 0, 0);
        finish({ canvas: copy, rect: src.getBoundingClientRect() });
      } catch { finish(null); }
    });
    glMap.triggerRepaint();
  });
}

async function svgImage(svg) {
  const clone = svg.cloneNode(true);
  const r = svg.getBoundingClientRect();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(r.width));
  clone.setAttribute('height', String(r.height));
  clone.removeAttribute('style');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try { return { img: await loadImage(url), rect: r }; } finally { URL.revokeObjectURL(url); }
}

/** The map as a canvas in CSS pixels × dpr, or null when there is no visible map. */
async function captureMap() {
  const map = getMap(), el = map?.getContainer?.();
  if (!el || !el.offsetWidth || !el.offsetHeight) return null;
  const box = el.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = document.createElement('canvas');
  cv.width = Math.round(box.width * dpr); cv.height = Math.round(box.height * dpr);
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = BG; ctx.fillRect(0, 0, box.width, box.height);
  const at = (img, r) => ctx.drawImage(img, r.left - box.left, r.top - box.top, r.width, r.height);

  const gl = getBasemapGL();
  if (gl) { const g = await grabGL(gl); if (g) at(g.canvas, g.rect); }
  for (const img of el.querySelectorAll('.leaflet-tile-pane img.leaflet-tile-loaded')) {
    try { at(img, img.getBoundingClientRect()); } catch { /* not decoded */ }
  }
  for (const node of el.querySelectorAll('.leaflet-overlay-pane > svg, .leaflet-overlay-pane > canvas')) {
    try {
      if (node.tagName.toLowerCase() === 'canvas') at(node, node.getBoundingClientRect());
      else { const s = await svgImage(node); at(s.img, s.rect); }
    } catch { /* skip this overlay */ }
  }
  return cv;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

async function paint(ctx, input, mapCanvas, url) {
  const measure = (t, px, bold) => { ctx.font = font(px, bold); return ctx.measureText(t).width; };
  const L = snapshotLayout(input, { hasMap: !!mapCanvas, measure, url });
  ctx.fillStyle = BG; ctx.fillRect(0, 0, SNAPSHOT_W, SNAPSHOT_H);
  if (mapCanvas) {
    const c = coverCrop(mapCanvas.width, mapCanvas.height);
    ctx.drawImage(mapCanvas, c.sx, c.sy, c.sw, c.sh, 0, 0, SNAPSHOT_W, SNAPSHOT_H);
    // Legible corners: a soft shade behind the logo, a dark band for the card.
    const top = ctx.createLinearGradient(0, 0, 0, 160);
    top.addColorStop(0, 'rgba(17,25,35,0.75)'); top.addColorStop(1, 'rgba(17,25,35,0)');
    ctx.fillStyle = top; ctx.fillRect(0, 0, SNAPSHOT_W, 160);
    ctx.fillStyle = 'rgba(17,25,35,0.9)'; ctx.fillRect(L.card.x, L.card.y, L.card.w, L.card.h);
  }
  ctx.fillStyle = GREEN; ctx.fillRect(L.card.x, L.card.y, L.card.w, 6);
  // Logo: green rounded square with the white figure.
  roundRect(ctx, L.logo.x, L.logo.y, L.logo.size, L.logo.size, L.logo.size * 0.22);
  ctx.fillStyle = GREEN; ctx.fill();
  try {
    const logo = await loadImage(new URL('../assets/logo-mark.svg', import.meta.url).href);
    ctx.drawImage(logo, L.logo.x, L.logo.y, L.logo.size, L.logo.size);
  } catch { /* the green square stays */ }
  ctx.textBaseline = 'alphabetic';
  const text = (item, color) => {
    if (!item) return;
    ctx.font = font(item.px, item.bold); ctx.fillStyle = color; ctx.textAlign = item.align ?? 'left';
    ctx.fillText(item.text, item.x, item.y);
  };
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = mapCanvas ? 8 : 0;
  text(L.brand, '#ffffff');
  ctx.shadowBlur = 0;
  text(L.viewLabel, '#3fbf6a');
  text(L.title, '#ffffff');
  text(L.area, '#c9d3dd');
  for (const c of L.chips) { ctx.fillStyle = c.color; ctx.fillRect(c.x, c.y, c.w, c.h); }
  text(L.from, '#c9d3dd');
  text(L.to, '#c9d3dd');
  text(L.url, '#3fbf6a');
  ctx.textAlign = 'left';
}

const toBlob = cv => new Promise((resolve, reject) => {
  try { cv.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob gave nothing'))), 'image/png'); } catch (e) { reject(e); }
});

/**
 * Renders the snapshot. `input` = { title, area, view, legend } (snapshot.js),
 * `url` = the share link (only host + path is printed). Resolves to
 * { blob, withMap } — withMap false when the map was hidden, not allowed
 * (`withMap: false`, the personal-score rule) or not exportable.
 */
export async function renderSnapshot(input, url, { withMap = true } = {}) {
  const cv = document.createElement('canvas');
  cv.width = SNAPSHOT_W; cv.height = SNAPSHOT_H;
  const ctx = cv.getContext('2d');
  let mapCanvas = null;
  if (withMap && (input.view === 'map' || !input.view)) { try { mapCanvas = await captureMap(); } catch { mapCanvas = null; } }
  await paint(ctx, input, mapCanvas, url);
  try { return { blob: await toBlob(cv), withMap: !!mapCanvas }; }
  catch (err) {
    if (!mapCanvas) throw err;
    // Tainted by a tile without CORS: the card alone.
    await paint(ctx, input, null, url);
    return { blob: await toBlob(cv), withMap: false };
  }
}

/** Title, legend colours/range and view from the page (legend DOM), for renderSnapshot. */
export function readViewForSnapshot(state, areaName = '') {
  const legend = document.getElementById('legend');
  const visible = legend && !legend.hidden && legend.offsetParent !== null;
  const title = visible ? legend.querySelector('.legend-title')?.textContent?.trim() : '';
  const colors = visible ? [...legend.querySelectorAll('.legend-chip:not(.is-outlier)')].map(c => c.style.background || getComputedStyle(c).backgroundColor) : [];
  const ranges = visible ? [...legend.querySelectorAll('.legend-range')].map(r => r.textContent.trim()) : [];
  const labels = visible ? [...legend.querySelectorAll('.legend-labels span')].map(s => s.textContent.trim()) : [];
  const from = (ranges[0] ?? labels[0] ?? '').split('–')[0];
  const lastRange = ranges[ranges.length - 1] ?? labels[labels.length - 1] ?? '';
  const to = lastRange.split('–').pop();
  return { title, area: areaName, view: state?.view ?? 'map', legend: { colors, from, to } };
}
