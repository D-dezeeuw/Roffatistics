// Builds assets/og-image.png (1200×630), the static link preview that WhatsApp,
// LinkedIn, Slack and co. show for every Roffatistics link (index.html og:image).
// No dependencies: glyph outlines are read from a TrueType font on this machine
// (DejaVu Sans, default path below; override with FONT_REGULAR / FONT_BOLD), every
// shape becomes polygons, and a scanline rasteriser (nonzero, 4 sub-rows, exact
// horizontal coverage) fills them. PNG encoding is build-brand-assets.mjs's.
// Run: node scripts/build-og-image.mjs   (writes assets/og-image.png; commit it)
// See docs/decisions.md (15 Nov 2026, link previews).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FIGURE, GREEN, roundRectPoly, encodePng } from './build-brand-assets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1200, H = 630;
const BG = '#111923';
const FONT_DIR = '/usr/share/fonts/truetype/dejavu';

// ── TrueType outlines (glyf/loca/cmap 4/hmtx; simple and offset composites) ──
export function loadFont(path) {
  const b = readFileSync(path);
  const tables = {};
  for (let i = 0, n = b.readUInt16BE(4); i < n; i++) { const o = 12 + 16 * i; tables[b.toString('ascii', o, o + 4)] = b.readUInt32BE(o + 8); }
  const head = tables.head, upem = b.readUInt16BE(head + 18), longLoca = b.readInt16BE(head + 50) === 1;
  const numGlyphs = b.readUInt16BE(tables.maxp + 4), numHM = b.readUInt16BE(tables.hhea + 34);
  const loca = i => longLoca ? b.readUInt32BE(tables.loca + 4 * i) : 2 * b.readUInt16BE(tables.loca + 2 * i);
  // cmap: first format-4 subtable (Unicode BMP).
  let seg = null;
  for (let i = 0, n = b.readUInt16BE(tables.cmap + 2); i < n; i++) {
    const off = tables.cmap + b.readUInt32BE(tables.cmap + 4 + 8 * i + 4);
    if (b.readUInt16BE(off) === 4) { seg = off; break; }
  }
  const segX2 = b.readUInt16BE(seg + 6), ends = seg + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
  const glyphIndex = cp => {
    for (let i = 0; i < segX2; i += 2) {
      if (b.readUInt16BE(ends + i) < cp) continue;
      const start = b.readUInt16BE(starts + i); if (start > cp) return 0;
      const delta = b.readInt16BE(deltas + i), ro = b.readUInt16BE(ranges + i);
      if (!ro) return (cp + delta) & 0xffff;
      const g = b.readUInt16BE(ranges + i + ro + 2 * (cp - start));
      return g ? (g + delta) & 0xffff : 0;
    }
    return 0;
  };
  const advance = g => b.readUInt16BE(tables.hmtx + 4 * Math.min(g, numHM - 1));
  function contours(g, dx = 0, dy = 0) {
    if (g >= numGlyphs) return [];
    const o = tables.glyf + loca(g); if (loca(g + 1) === loca(g)) return [];
    const nc = b.readInt16BE(o);
    if (nc < 0) {   // composite: offsets only (DejaVu's accented letters)
      const out = []; let p = o + 10, flags;
      do {
        flags = b.readUInt16BE(p); const gi = b.readUInt16BE(p + 2); p += 4;
        let ax, ay;
        if (flags & 1) { ax = b.readInt16BE(p); ay = b.readInt16BE(p + 2); p += 4; } else { ax = b.readInt8(p); ay = b.readInt8(p + 1); p += 2; }
        if (flags & 8) p += 2; else if (flags & 0x40) p += 4; else if (flags & 0x80) p += 8;
        out.push(...contours(gi, dx + ax, dy + ay));
      } while (flags & 0x20);
      return out;
    }
    const endPts = Array.from({ length: nc }, (_, i) => b.readUInt16BE(o + 10 + 2 * i));
    const nPts = endPts[nc - 1] + 1;
    let p = o + 10 + 2 * nc; p += 2 + b.readUInt16BE(p);
    const fl = [];
    while (fl.length < nPts) { const f = b[p++]; fl.push(f); if (f & 8) { let r = b[p++]; while (r--) fl.push(f); } }
    const coord = (short, same) => { let v = 0; return fl.map(f => { if (f & short) { const d = b[p++]; v += f & same ? d : -d; } else if (!(f & same)) { v += b.readInt16BE(p); p += 2; } return v; }); };
    const xs = coord(2, 16), ys = coord(4, 32);
    const out = []; let s = 0;
    for (const e of endPts) {
      const pts = []; for (let i = s; i <= e; i++) pts.push({ x: xs[i] + dx, y: ys[i] + dy, on: !!(fl[i] & 1) });
      out.push(pts); s = e + 1;
    }
    return out;
  }
  return { upem, glyphIndex, advance, contours };
}

/** Quadratic contour points → a flat polygon (implied on-points between off-points). */
function flatten(pts, steps = 6) {
  if (!pts.length) return [];
  const n = pts.length;
  let startIdx = pts.findIndex(q => q.on);
  let start;
  if (startIdx < 0) { start = { x: (pts[0].x + pts[1 % n].x) / 2, y: (pts[0].y + pts[1 % n].y) / 2 }; startIdx = 0; }
  else { start = pts[startIdx]; startIdx += 1; }
  const out = [[start.x, start.y]]; let cur = start, ctrl = null;
  for (let k = 0; k < n; k++) {
    const q = pts[(startIdx + k) % n];
    if (q.on) {
      if (ctrl) quad(cur, ctrl, q); else out.push([q.x, q.y]);
      cur = q; ctrl = null;
    } else if (ctrl) {
      const mid = { x: (ctrl.x + q.x) / 2, y: (ctrl.y + q.y) / 2 };
      quad(cur, ctrl, mid); cur = mid; ctrl = q;
    } else ctrl = q;
  }
  if (ctrl) quad(cur, ctrl, start);
  function quad(a, c, e) { for (let i = 1; i <= steps; i++) { const t = i / steps, u = 1 - t; out.push([u * u * a.x + 2 * u * t * c.x + t * t * e.x, u * u * a.y + 2 * u * t * c.y + t * t * e.y]); } }
  return out;
}

/** Text → polygons in pixel space, baseline at (x, y); returns { polys, width }. */
export function textPolys(font, text, size, x, y) {
  const s = size / font.upem, polys = [];
  let pen = x;
  for (const ch of text) {
    const g = font.glyphIndex(ch.codePointAt(0));
    for (const c of font.contours(g)) polys.push(flatten(c).map(([gx, gy]) => [pen + gx * s, y - gy * s]));
    pen += font.advance(g) * s;
  }
  return { polys, width: pen - x };
}

// ── Scanline rasteriser on a W×H RGBA canvas ─────────────────────────────────
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export function makeCanvas(w, h, bg) {
  const px = new Uint8Array(w * h * 4), [r, g, b] = hex(bg);
  for (let i = 0; i < w * h; i++) { px[4 * i] = r; px[4 * i + 1] = g; px[4 * i + 2] = b; px[4 * i + 3] = 255; }
  return { w, h, px };
}
/** Nonzero fill of `polys` with `color` at `alpha`; 4 sub-rows, exact coverage per row. */
export function fill(cv, polys, color, alpha = 1, SS = 4) {
  const [cr, cg, cb] = hex(color);
  const edges = [];
  let minY = Infinity, maxY = -Infinity;
  for (const p of polys) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [x0, y0] = p[j], [x1, y1] = p[i]; if (y0 === y1) continue;
    edges.push(y0 < y1 ? { ya: y0, yb: y1, x0, k: (x1 - x0) / (y1 - y0), d: 1 } : { ya: y1, yb: y0, x0: x1, k: (x0 - x1) / (y0 - y1), d: -1 });
    minY = Math.min(minY, y0, y1); maxY = Math.max(maxY, y0, y1);
  }
  const row = new Float32Array(cv.w + 2);
  for (let py = Math.max(0, Math.floor(minY)); py < Math.min(cv.h, Math.ceil(maxY)); py++) {
    row.fill(0);
    for (let s = 0; s < SS; s++) {
      const y = py + (s + 0.5) / SS, xs = [];
      for (const e of edges) if (y >= e.ya && y < e.yb) xs.push({ x: e.x0 + (y - e.ya) * e.k, d: e.d });
      xs.sort((a, c) => a.x - c.x);
      let w = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        w += xs[i].d; if (!w) continue;
        const a = Math.max(0, xs[i].x), z = Math.min(cv.w, xs[i + 1].x); if (z <= a) continue;
        const ia = Math.floor(a), iz = Math.floor(z);
        if (ia === iz) { row[ia] += (z - a) / SS; continue; }
        row[ia] += (ia + 1 - a) / SS;
        for (let k = ia + 1; k < iz; k++) row[k] += 1 / SS;
        if (iz < cv.w) row[iz] += (z - iz) / SS;
      }
    }
    for (let qx = 0; qx < cv.w; qx++) {
      const cov = Math.min(1, row[qx]) * alpha; if (cov <= 0) continue;
      const o = (py * cv.w + qx) * 4;
      cv.px[o] = Math.round(cr * cov + cv.px[o] * (1 - cov));
      cv.px[o + 1] = Math.round(cg * cov + cv.px[o + 1] * (1 - cov));
      cv.px[o + 2] = Math.round(cb * cov + cv.px[o + 2] * (1 - cov));
    }
  }
}

// ── Composition ──────────────────────────────────────────────────────────────
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const hexagon = (cx, cy, r) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + i * Math.PI / 3; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
// Green choropleth ramp (light → Rotterdam green → deep), as on the Woonscore layer.
const RAMP = ['#cfe9c9', '#9dd39a', '#5fb86c', '#009a3e', '#00733a', '#0b4f2e'];

/** A stylised hex-map silhouette on the right: a deterministic blob of shaded cells. */
function mapSilhouette(cv) {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const r = 30, dx = r * Math.sqrt(3), dy = r * 1.5, cx = 1010, cy = 330;
  for (let row = -8; row <= 8; row++) for (let col = -7; col <= 7; col++) {
    const x = cx + col * dx + (row & 1 ? dx / 2 : 0), y = cy + row * dy;
    // A lumpy outline (roughly the Randstad coast at the left, rounder elsewhere).
    const ang = Math.atan2(y - cy, x - cx), rad = 250 + 40 * Math.sin(3 * ang + 0.6) + 25 * Math.cos(5 * ang);
    const dist = Math.hypot((x - cx) * 0.95, (y - cy) * 1.15);
    if (dist > rad || x < 760 || y < -20 || y > H + 20) continue;
    const t = Math.min(RAMP.length - 1, Math.floor((1 - dist / rad) * 3 + rnd() * 3.2));
    fill(cv, [hexagon(x, y, r - 2.5)], RAMP[t], 0.92);
  }
}

export function buildOgImage({ regular, bold }) {
  const cv = makeCanvas(W, H, BG);
  mapSilhouette(cv);
  // Soft fade from the text side into the map.
  for (let i = 0; i < 24; i++) fill(cv, [rect(740 + i * 8, 0, 8, H)], BG, 0.5 * (1 - i / 24));
  // Logo: green rounded square with the white figure (64-grid → 132 px).
  const LX = 80, LY = 84, LS = 132, sc = LS / 64;
  const to = (p, s = 1) => p.map(([x, y]) => [LX + (32 + (x - 32) * s) * sc, LY + (32 + (y - 32) * s) * sc]);
  fill(cv, [to(roundRectPoly(0, 0, 64, 64, 14))], GREEN);
  fill(cv, FIGURE.map(p => to(p, 0.84)), '#ffffff');
  const title = textPolys(bold, 'Roffatistics', 100, 76, 340);
  fill(cv, title.polys, '#ffffff');
  fill(cv, [rect(80, 372, 120, 8)], GREEN);
  fill(cv, textPolys(regular, 'Rotterdam en Nederland in cijfers —', 38, 80, 440).polys, '#c9d3dd');
  fill(cv, textPolys(regular, 'vind jouw ideale woonplek', 38, 80, 490).polys, '#c9d3dd');
  fill(cv, textPolys(bold, 'd-dezeeuw.github.io/Roffatistics', 26, 80, 566).polys, '#3fbf6a');
  return encodePng(W, cv.px, H);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const regular = loadFont(process.env.FONT_REGULAR ?? join(FONT_DIR, 'DejaVuSans.ttf'));
  const bold = loadFont(process.env.FONT_BOLD ?? join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
  writeFileSync(join(ROOT, 'assets/og-image.png'), buildOgImage({ regular, bold }));
  console.log('assets/og-image.png written (1200×630)');
}
