// Snapshot maker (W29): pure helpers for the 1200×630 share image of the
// current view. No DOM, no canvas: text is measured through a `measure(text, px,
// bold)` function (canvas measureText in the browser, an estimate in tests).
// Drawing is snapshot-render.js; the buttons live in share-dialog.js.
// Privacy: the image carries only the layer title, the area name, the legend
// colours/range and the site address — never wizard answers (see decisions.md).
import { CITY } from './city.js';

export const SNAPSHOT_W = 1200;
export const SNAPSHOT_H = 630;
export const SITE_LABEL = 'd-dezeeuw.github.io/Roffatistics';

/** Rough width of `text` at `px` (DejaVu/system-sans average); tests and fallback. */
export const estimateWidth = (text, px, bold = false) => String(text ?? '').length * px * (bold ? 0.6 : 0.54);

/** Lower-case ASCII slug: accents dropped, everything else to '-', at most `max` chars. */
export function slug(text, max = 40) {
  return String(text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, max).replace(/-+$/, '');
}

/** 'roffatistics-<layer>-<area>.png'; empty parts are left out. */
export function snapshotFileName({ layer = '', area = '' } = {}) {
  return ['roffatistics', slug(layer), slug(area)].filter(Boolean).join('-') + '.png';
}

/** The address shown in the image: host + path only (the #state is long and may hold choices). */
export function displayUrl(url) {
  try {
    const u = new URL(String(url));
    return (u.host + u.pathname).replace(/\/(index\.html)?$/, '') || SITE_LABEL;
  } catch { return SITE_LABEL; }
}

/** Web Share API level 2: can this browser share `files` (with a URL)? */
export function canShareFiles(nav, files) {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try { return nav.canShare({ files }) === true; } catch { return false; }
}

/** `text` cut with '…' so that measure(text, px, bold) ≤ maxW. */
export function fitText(text, maxW, px, measure = estimateWidth, bold = false) {
  const s = String(text ?? '');
  if (measure(s, px, bold) <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (measure(s.slice(0, mid).trimEnd() + '…', px, bold) <= maxW) lo = mid; else hi = mid - 1; }
  return lo ? s.slice(0, lo).trimEnd() + '…' : '';
}

/** Largest size from `px` down to `minPx` (step 2) at which `text` fits, else minPx. */
export function fitSize(text, maxW, px, minPx, measure = estimateWidth, bold = false) {
  for (let p = px; p > minPx; p -= 2) if (measure(text, p, bold) <= maxW) return p;
  return minPx;
}

/**
 * Source crop for drawing a srcW×srcH picture "cover" into dstW×dstH (centre kept).
 * Returns { sx, sy, sw, sh }.
 */
export function coverCrop(srcW, srcH, dstW = SNAPSHOT_W, dstH = SNAPSHOT_H) {
  if (!(srcW > 0 && srcH > 0)) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  const wide = srcW / srcH > dstW / dstH;
  const sw = wide ? srcH * dstW / dstH : srcW, sh = wide ? srcH : srcW * dstH / dstW;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

/**
 * What goes on the card. `title` = the active layer (legend title), `area` = the
 * selected area's name, `legend` = { colors: ['#..'], from, to } (range labels),
 * `view` = 'map' | 'dashboard' | 'list'. Deliberately no wizard input.
 */
export function snapshotTexts({ title = '', area = '', view = 'map', legend = null } = {}) {
  const viewLabel = view === 'dashboard' ? 'Dashboard' : view === 'list' ? 'Ranglijst' : '';
  return {
    title: String(title || `${CITY.name} en Nederland in cijfers`).trim(),
    area: String(area || '').trim(),
    viewLabel,
    colors: (legend?.colors ?? []).filter(c => typeof c === 'string' && c).slice(0, 9),
    from: legend?.from ? String(legend.from) : '',
    to: legend?.to ? String(legend.to) : '',
  };
}

/**
 * Layout of the branded card. With a map (`hasMap`) the card is a dark band along
 * the bottom over the map; without one it fills the image (dashboard/ranglijst or
 * a map that could not be read). Every item is in image pixels:
 *   card {x,y,w,h}, logo {x,y,size}, brand {text,x,y,px}, title/area/viewLabel/url
 *   {text,x,y,px,bold}, chips [{x,y,w,h,color}], from/to {text,x,y,px,align}.
 * `y` is the text baseline.
 */
export function snapshotLayout(input, { hasMap = true, measure = estimateWidth, url = '' } = {}) {
  const t = snapshotTexts(input);
  const W = SNAPSHOT_W, H = SNAPSHOT_H, pad = 40;
  const card = hasMap ? { x: 0, y: H - 200, w: W, h: 200 } : { x: 0, y: 0, w: W, h: H };
  const out = { hasMap, card, chips: [] };
  const urlText = displayUrl(url);
  if (hasMap) {
    // Logo top-left on the map, text in the bottom band, legend at the band's right.
    out.logo = { x: pad, y: pad, size: 64 };
    out.brand = { text: 'Roffatistics', x: pad + 80, y: pad + 44, px: 34, bold: true };
    const legendW = t.colors.length ? 340 : 0;
    const textW = W - 2 * pad - (legendW ? legendW + 30 : 0);
    const tpx = fitSize(t.title, textW, 40, 28, measure, true);
    out.title = { text: fitText(t.title, textW, tpx, measure, true), x: pad, y: card.y + 60, px: tpx, bold: true };
    out.area = t.area ? { text: fitText(t.area, textW, 30, measure), x: pad, y: card.y + 108, px: 30, bold: false } : null;
    out.url = { text: urlText, x: pad, y: H - 30, px: 22, bold: true };
    if (legendW) placeChips(out, t, W - pad - legendW, card.y + 52, legendW);
  } else {
    out.logo = { x: pad + 40, y: pad + 40, size: 96 };
    out.brand = { text: 'Roffatistics', x: pad + 156, y: pad + 106, px: 48, bold: true };
    const textW = W - 2 * (pad + 40);
    const tpx = fitSize(t.title, textW, 60, 34, measure, true);
    out.viewLabel = t.viewLabel ? { text: t.viewLabel, x: pad + 40, y: 270, px: 28, bold: false } : null;
    out.title = { text: fitText(t.title, textW, tpx, measure, true), x: pad + 40, y: 340, px: tpx, bold: true };
    out.area = t.area ? { text: fitText(t.area, textW, 40, measure), x: pad + 40, y: 400, px: 40, bold: false } : null;
    out.url = { text: urlText, x: pad + 40, y: H - pad - 30, px: 26, bold: true };
    if (t.colors.length) placeChips(out, t, pad + 40, 450, Math.min(560, textW));
  }
  return out;
}

function placeChips(out, t, x, y, w) {
  const n = t.colors.length, gap = 4, cw = (w - gap * (n - 1)) / n, h = 26;
  out.chips = t.colors.map((color, i) => ({ x: x + i * (cw + gap), y, w: cw, h, color }));
  out.from = t.from ? { text: t.from, x, y: y + h + 30, px: 20, align: 'left' } : null;
  out.to = t.to ? { text: t.to, x: x + w, y: y + h + 30, px: 20, align: 'right' } : null;
}

/**
 * May the image show a personal ("jouw wensen") Woonscore map and legend? Its
 * colours are computed from all wizard answers, so only when the link shares the
 * answers too and every sensitive part the answers hold (`present`: origin,
 * education, income) is ticked in `options`. Other layers: always.
 */
export function personalMapAllowed({ personal = false, options = {}, present = {} } = {}) {
  if (!personal) return true;
  if (!options.answers) return false;
  return Object.entries(present).every(([k, has]) => !has || options[k] === true);
}
