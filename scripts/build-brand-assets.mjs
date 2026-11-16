// Builds the logo, favicons and touch icon from one shape definition, without
// dependencies: the SVGs are written as text, the PNG/ICO files are rasterised
// here (nonzero scanline fill, 8×8 supersampling) and encoded with node:zlib.
// Run: node scripts/build-brand-assets.mjs   (writes assets/*, favicon.*, apple-touch-icon.png)
//      node scripts/build-brand-assets.mjs --city amsterdam   (writes assets/cities/amsterdam/*)
//
// The figure is an own abstract drawing after Ossip Zadkine's "De verwoeste stad"
// (Rotterdam, 1951): a twisted standing figure, both arms flung up, head thrown
// back, a hole torn through the torso. See docs/decisions.md (2026-11-15).
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const GREEN = '#009A3E';

// 64×64 design grid. Body subpaths run clockwise on screen, the hole counter-clockwise,
// so a nonzero fill cuts the hole and the overlapping head/neck merge.
const BODY = [
  [9, 1], [12, 4], [15, 0], [25, 17], [30, 19], [37, 16], [52, 4], [53, 0], [56, 3], [60, 2],
  [45, 24], [41, 33], [44, 41], [53, 50], [49, 63], [42, 63], [45, 51], [34, 43],
  [28, 51], [26, 63], [18, 63], [21, 49], [23, 40], [24, 31], [19, 23],
];
const NECK = [[33, 12], [38, 13], [38, 18], [30, 20]];
// Head thrown back: an ellipse tilted towards the raised right arm.
const HEAD = { cx: 37, cy: 8.5, rx: 4.5, ry: 6, rot: -35 };
// The torn hole where the heart was: jagged, counter-clockwise.
const HOLE = [[33, 21], [28.5, 25], [30.5, 28], [29, 32], [32, 37], [35.5, 34], [38, 29], [35.5, 26], [37, 22]];

const circlePoly = ({ cx, cy, rx, ry, rot }, n = 48) => {
  const a = rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return Array.from({ length: n }, (_, i) => { const t = (i / n) * 2 * Math.PI, x = rx * Math.cos(t), y = ry * Math.sin(t); return [cx + x * c - y * s, cy + x * s + y * c]; });
};
export const FIGURE = [BODY, NECK, circlePoly(HEAD), HOLE];

export function roundRectPoly(x, y, w, h, r, n = 12) {
  const pts = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= n; i++) { const t = a0 + (i / n) * (Math.PI / 2); pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } };
  corner(x + w - r, y + r, -Math.PI / 2); corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2); corner(x + r, y + r, Math.PI);
  return pts;
}

// ── SVG ──────────────────────────────────────────────────────────────────────
const f = n => +n.toFixed(2);
const polyD = p => 'M' + p.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
const headD = ({ cx, cy, rx, ry, rot }) => {
  const a = rot * Math.PI / 180, dx = rx * Math.cos(a), dy = rx * Math.sin(a);
  return `M${f(cx + dx)} ${f(cy + dy)}A${rx} ${ry} ${rot} 1 1 ${f(cx - dx)} ${f(cy - dy)}A${rx} ${ry} ${rot} 1 1 ${f(cx + dx)} ${f(cy + dy)}Z`;
};
export const FIGURE_D = polyD(BODY) + polyD(NECK) + headD(HEAD) + polyD(HOLE);

const logoSvg = fill =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><title>Roffatistics</title><path fill="${fill}" d="${FIGURE_D}"/></svg>\n`;
// The mark: white figure on a green rounded square, for tabs and home screens.
const MARK_SCALE = 0.84;
const markSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><title>Roffatistics</title><rect width="64" height="64" rx="14" fill="${GREEN}"/><path fill="#fff" transform="translate(32 32) scale(${MARK_SCALE}) translate(-32 -32)" d="${FIGURE_D}"/></svg>\n`;

// ── Mokumistics (--city amsterdam) ───────────────────────────────────────────
// Three bold St Andrew's crosses (×) stacked vertically, as in the city arms,
// drawn as our own shapes: two straight bars per cross with square (butt) ends,
// no shield, not the municipal logo. 64-grid like the figure above.
export const RED = '#E30613';
const CROSS = { size: 18, stroke: 5.2, gap: 3 };   // each cross 18×18, 3 units clear between the boxes

/** One bar from (x0,y0) to (x1,y1), `t` thick, square ends, clockwise on screen. */
function barPoly(x0, y0, x1, y1, t) {
  const len = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / len * t / 2, ny = (x1 - x0) / len * t / 2;
  const p = [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]];
  const area = p.reduce((a, [x, y], i) => { const [u, v] = p[(i + 1) % 4]; return a + x * v - u * y; }, 0);
  return area < 0 ? p.reverse() : p;
}
/** A × of `size` centred on (cx, cy): two bars whose corners stay inside the box. */
function crossPolys(cx, cy, size, t) {
  const a = size / 2 - t / (2 * Math.SQRT2);
  return [barPoly(cx - a, cy - a, cx + a, cy + a, t), barPoly(cx + a, cy - a, cx - a, cy + a, t)];
}
const step = CROSS.size + CROSS.gap;
export const CROSSES = [-step, 0, step].flatMap(dy => crossPolys(32, 32 + dy, CROSS.size, CROSS.stroke));
const CROSSES_D = CROSSES.map(polyD).join('');
const CROSS_TITLE = 'Mokumistics';
/** logo-mark.svg: the three black crosses on a transparent ground. */
export const crossMarkSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><title>${CROSS_TITLE}</title><path fill="#000" d="${CROSSES_D}"/></svg>\n`;
const TILE_SCALE = 0.84;
/** favicon.svg: a red tile with the white crosses. */
export const crossTileSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><title>${CROSS_TITLE}</title><rect width="64" height="64" rx="12" fill="${RED}"/><path fill="#fff" transform="translate(32 32) scale(${TILE_SCALE}) translate(-32 -32)" d="${CROSSES_D}"/></svg>\n`;
/** logo.svg: the mark plus the word "Mokumistics" (glyph outlines from DejaVu Sans Bold, so no web font is needed). */
export function crossLogoSvg(wordD, wordWidth) {
  const w = Math.ceil(50 + wordWidth + 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 64" width="${w}" height="64"><title>${CROSS_TITLE}</title><path fill="#000" d="${CROSSES_D}"/><path fill="#000" d="${wordD}"/></svg>\n`;
}

// ── Raster ───────────────────────────────────────────────────────────────────
function winding(polys, x, y) {
  let w = 0;
  for (const p of polys) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [x0, y0] = p[j], [x1, y1] = p[i];
    if (y0 <= y) { if (y1 > y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) > 0) w++; }
    else if (y1 <= y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) < 0) w--;
  }
  return w;
}
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

/** layers: [{ polys, color, scale?, opaque? }] in 64-grid; returns RGBA of size×size. */
export function rasterise(size, layers, ss = 8) {
  const px = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) for (let qx = 0; qx < size; qx++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const L of layers) {
      let hit = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        let x = ((qx + (sx + 0.5) / ss) / size) * 64, y = ((py + (sy + 0.5) / ss) / size) * 64;
        const s = L.scale ?? 1; x = 32 + (x - 32) / s; y = 32 + (y - 32) / s;
        if (winding(L.polys, x, y) !== 0) hit++;
      }
      const cov = hit / (ss * ss); if (!cov) continue;
      const [cr, cg, cb] = hex(L.color);
      const na = cov + a * (1 - cov);
      r = (cr * cov + r * a * (1 - cov)) / na; g = (cg * cov + g * a * (1 - cov)) / na; b = (cb * cov + b * a * (1 - cov)) / na; a = na;
    }
    const o = (py * size + qx) * 4;
    px[o] = Math.round(r); px[o + 1] = Math.round(g); px[o + 2] = Math.round(b); px[o + 3] = Math.round(a * 255);
  }
  return px;
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const v of buf) c = CRC[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** RGBA → PNG; `height` defaults to a square (the og-image passes 1200×630). */
export function encodePng(size, rgba, height = size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(height * (size * 4 + 1));
  for (let y = 0; y < height; y++) { raw[y * (size * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/** ICO container with PNG-compressed entries (supported by every current browser). */
export function encodeIco(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...pngs.map(p => p.png)]);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function buildAmsterdam() {
  const dir = join(ROOT, 'assets/cities/amsterdam');
  mkdirSync(dir, { recursive: true });
  const { loadFont, textPolys } = await import('./build-og-image.mjs');
  const bold = loadFont(process.env.FONT_BOLD ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf');
  const word = textPolys(bold, CROSS_TITLE, 30, 50, 43);
  writeFileSync(join(dir, 'logo-mark.svg'), crossMarkSvg());
  writeFileSync(join(dir, 'logo.svg'), crossLogoSvg(word.polys.map(p => polyD(p)).join(''), word.width));
  writeFileSync(join(dir, 'favicon.svg'), crossTileSvg());
  const tile = [{ polys: [roundRectPoly(0, 0, 64, 64, 12)], color: RED }, { polys: CROSSES, color: '#ffffff', scale: TILE_SCALE }];
  writeFileSync(join(dir, 'favicon.ico'), encodeIco([16, 32, 48].map(size => ({ size, png: encodePng(size, rasterise(size, tile)) }))));
  writeFileSync(join(dir, 'apple-touch-icon.png'), encodePng(180, rasterise(180, [{ polys: [[[0, 0], [64, 0], [64, 64], [0, 64]]], color: RED }, { polys: CROSSES, color: '#ffffff', scale: 0.74 }], 4)));
  console.log('amsterdam brand assets written');
}

const cityArg = (() => { const i = process.argv.indexOf('--city'); return i > 0 ? process.argv[i + 1] : 'rotterdam'; })();
if (process.argv[1] === fileURLToPath(import.meta.url) && cityArg === 'amsterdam') buildAmsterdam().catch(e => { console.error(e); process.exitCode = 1; });   // not awaited: build-og-image.mjs imports this module back
else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (cityArg !== 'rotterdam') throw new Error(`unknown --city ${cityArg}`);
  mkdirSync(join(ROOT, 'assets'), { recursive: true });
  writeFileSync(join(ROOT, 'assets/logo.svg'), logoSvg(GREEN));
  writeFileSync(join(ROOT, 'assets/logo-mark.svg'), markSvg());
  writeFileSync(join(ROOT, 'favicon.svg'), markSvg());
  const markLayers = [{ polys: [roundRectPoly(0, 0, 64, 64, 14)], color: GREEN }, { polys: FIGURE, color: '#ffffff', scale: MARK_SCALE }];
  const icoPngs = [16, 32, 48].map(size => ({ size, png: encodePng(size, rasterise(size, markLayers)) }));
  writeFileSync(join(ROOT, 'favicon.ico'), encodeIco(icoPngs));
  // iOS draws its own rounded corners and wants an opaque square.
  writeFileSync(join(ROOT, 'apple-touch-icon.png'), encodePng(180, rasterise(180, [{ polys: [[[0, 0], [64, 0], [64, 64], [0, 64]]], color: GREEN }, { polys: FIGURE, color: '#ffffff', scale: 0.74 }], 4)));
  console.log('brand assets written');
}
