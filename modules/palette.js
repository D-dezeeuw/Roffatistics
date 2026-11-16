// Map colour palettes ("Kaartkleuren" in Instellingen, W34). Pure: no DOM
// except applyPaletteVars, which only sets CSS custom properties.
//
// Every palette has 7 stepped classes per metric kind, ordered low value →
// high value once rampFor() has applied the direction:
//   up / down  metrics with a good/bad direction (datasets higherIsBetter
//              true/false, Woonscore, eduScore, school pins). Palettes with
//              `flips` run bad → good, so for lower-is-better metrics the ramp
//              is reversed and good always gets the same colour.
//   neutral    no direction (density, age shares, households …).
//   origin     herkomst (§5): "how many", never good/bad; its own single hue
//              that matches neither the score ramp nor the neutral ramp, and
//              never an outlier mark.
// The choice is stored per device under roffatistics.mapPalette ('auto' =
// "Volgt thema"); it is not part of the share link.
import { CITY } from './city.js';

export const MAP_PALETTE_STORAGE_KEY = 'roffatistics.mapPalette';
export const PALETTE_AUTO = 'auto';
export const DEFAULT_PALETTE_CHOICE = PALETTE_AUTO;
export const PALETTE_CLASS_COUNT = 7;

const hex = n => Math.round(n).toString(16).padStart(2, '0');
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// Low → #2e1065 (deep purple)  High → #ea580c (orange): the original ramp.
export function interpolateColor(value, min, max) {
  const t = max === min ? 0 : (value - min) / (max - min);
  const r = Math.round(46  + t * (234 - 46));
  const g = Math.round(16  + t * (88  - 16));
  const b = Math.round(101 + t * (12  - 101));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

const KLASSIEK_RAMP = Object.freeze(Array.from({ length: PALETTE_CLASS_COUNT }, (_, i) => interpolateColor(i, 0, PALETTE_CLASS_COUNT - 1)));

/** Continuous colour at t (0–1) along `stops` (piecewise linear in RGB). */
export function rampColor(stops, t) {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const a = rgb(stops[i]), b = rgb(stops[i + 1]);
  return `#${a.map((c, k) => hex(c + f * (b[k] - c))).join('')}`;
}

const freeze = p => Object.freeze({ ...p, directional: Object.freeze(p.directional), neutral: Object.freeze(p.neutral), origin: Object.freeze(p.origin) });

export const PALETTES = Object.freeze({
  // Rotterdam: red = bad → green = good; neutral metrics a green single hue; herkomst indigo.
  rotterdam: freeze({
    id: 'rotterdam', label: 'Rotterdam', flips: true,
    directional: ['#c62828', '#e4572e', '#f29e4c', '#e9c46a', '#a7c957', '#5fa85a', '#1f7a3f'],
    neutral:     ['#d9f2d0', '#b0dfa3', '#86c97c', '#5daf5b', '#3b9447', '#237a3b', '#0f5f30'],
    origin:      ['#e0e3f7', '#bcc2ee', '#969fe2', '#737dd4', '#5459c0', '#3d3ea6', '#2c2a85'],
    noData: '#6b7280', outlier: '#d946ef', outlierMark: '#d946ef', outlierText: '#f0abfc',
    good: '#22c55e', bad: '#ef4444', goodText: '#4ade80', badText: '#f87171',
  }),
  // Paars-oranje: the original purple → orange ramp for every non-origin metric, low → high, unchanged.
  klassiek: freeze({
    id: 'klassiek', label: 'Paars-oranje', flips: false,
    directional: KLASSIEK_RAMP, neutral: KLASSIEK_RAMP,
    origin:      ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8'],
    noData: '#4b4658', outlier: '#ef4444', outlierMark: '#ef4444', outlierText: '#fca5a5',
    good: '#22c55e', bad: '#ef4444', goodText: '#4ade80', badText: '#f87171',
    lerp: t => interpolateColor(t, 0, 1),
  }),
  // Mokum: good/bad stays red → green as in Rotterdam (one meaning in every city,
  // so the brand red never reads as "bad" on its own); neutral metrics a grey →
  // black ramp; herkomst the same indigo; outliers magenta.
  mokum: freeze({
    id: 'mokum', label: 'Mokum', flips: true,
    directional: ['#c62828', '#e4572e', '#f29e4c', '#e9c46a', '#a7c957', '#5fa85a', '#1f7a3f'],
    neutral:     ['#ececec', '#c8c8c8', '#a3a3a3', '#7f7f7f', '#5c5c5c', '#3a3a3a', '#1a1a1a'],
    origin:      ['#e0e3f7', '#bcc2ee', '#969fe2', '#737dd4', '#5459c0', '#3d3ea6', '#2c2a85'],
    noData: '#4b5a78', outlier: '#ff1fce', outlierMark: '#ff1fce', outlierText: '#ff9ce8',
    good: '#22c55e', bad: '#ef4444', goodText: '#4ade80', badText: '#f87171',
  }),
  // Kleurenblind-veilig: blue = bad → orange = good (no red/green), neutral grey, herkomst pink-purple.
  kleurenblind: freeze({
    id: 'kleurenblind', label: 'Kleurenblind-veilig', flips: true,
    directional: ['#2b4c9b', '#3f74c4', '#7aa7d9', '#c9c3b4', '#f2c14e', '#f08c2a', '#d9630b'],
    neutral:     ['#f0f0f0', '#d4d4d4', '#b5b5b5', '#979797', '#7a7a7a', '#5f5f5f', '#474747'],
    origin:      ['#fde0ef', '#f7bfd9', '#ee95c0', '#dc66a6', '#c03d8f', '#97207b', '#6a0f66'],
    noData: '#3f3f46', outlier: '#000000', outlierMark: '#ffffff', outlierText: '#e5e5e5',
    good: '#f08c2a', bad: '#3f74c4', goodText: '#fbbf6a', badText: '#93b8e8',
  }),
});

export const PALETTE_IDS = Object.freeze(Object.keys(PALETTES));
/** "Volgt thema": UI theme id → palette id. */
export const THEME_PALETTE = Object.freeze({ rotterdam: 'rotterdam', klassiek: 'klassiek', mokum: 'mokum', 'mokum-licht': 'mokum' });
const FALLBACK_THEME = 'rotterdam';

export const PALETTE_OPTIONS = Object.freeze([
  Object.freeze({ id: PALETTE_AUTO, label: 'Volgt thema' }),
  ...PALETTE_IDS.map(id => Object.freeze({ id, label: PALETTES[id].label })),
]);

/** A stored or chosen value → a valid choice ('auto' or a palette id); anything else → 'auto'. */
export function parsePaletteChoice(raw) {
  return raw === PALETTE_AUTO || Object.hasOwn(PALETTES, raw ?? '') ? raw : DEFAULT_PALETTE_CHOICE;
}

/** The palette for a choice under a UI theme ('auto' follows the theme; unknown theme → Rotterdam). */
export function resolvePalette(choice, themeId) {
  if (choice && typeof choice === 'object' && choice.directional) return choice;
  const c = parsePaletteChoice(choice);
  if (c !== PALETTE_AUTO) return PALETTES[c];
  return PALETTES[THEME_PALETTE[themeId] ?? THEME_PALETTE[FALLBACK_THEME]];
}

export function pickInitialPaletteChoice(storage) {
  try { return parsePaletteChoice(storage?.getItem(MAP_PALETTE_STORAGE_KEY)); } catch { return DEFAULT_PALETTE_CHOICE; }
}

export function storePaletteChoice(choice, storage) {
  const c = parsePaletteChoice(choice);
  try { storage?.setItem(MAP_PALETTE_STORAGE_KEY, c); } catch { /* storage blocked */ }
  return c;
}

/** The live palette: the stored choice under the theme on <html data-theme>. Never throws. */
export function activePalette(storage, doc = globalThis.document) {
  let st = storage;
  if (st === undefined) { try { st = globalThis.localStorage; } catch { st = null; } }
  return resolvePalette(pickInitialPaletteChoice(st), doc?.documentElement?.dataset?.theme);
}

/** Herkomst datasets (groups herkomst / herkomstDetail, §5). */
export const ORIGIN_GROUPS = Object.freeze(['herkomst', 'herkomstDetail']);

/** Kind of a dataset definition: 'origin' | 'up' | 'down' | 'neutral'. */
export function metricKind(ds) {
  if (ds && ORIGIN_GROUPS.includes(ds.group)) return 'origin';
  if (ds?.higherIsBetter === true) return 'up';
  if (ds?.higherIsBetter === false) return 'down';
  return 'neutral';
}

/** Normalises a kind or a higherIsBetter flag (true/false/null) to a kind. */
export function normalizeKind(kind) {
  if (kind === true) return 'up';
  if (kind === false) return 'down';
  return ['up', 'down', 'neutral', 'origin'].includes(kind) ? kind : 'neutral';
}

/** The 7 class colours for `kind`, ordered from the lowest value to the highest. */
export function rampFor(palette, kind) {
  const p = resolvePalette(palette);
  const k = normalizeKind(kind);
  if (k === 'origin') return p.origin;
  if (k === 'neutral') return p.neutral;
  return k === 'down' && p.flips ? Object.freeze([...p.directional].reverse()) : p.directional;
}

/** Continuous colour at t (0 = lowest value) for the linear method. */
export function continuousColor(palette, kind, t) {
  const p = resolvePalette(palette);
  const k = normalizeKind(kind);
  if (p.lerp && k !== 'origin') return p.lerp(Math.min(1, Math.max(0, t)));
  return rampColor(rampFor(p, k), t);
}

/** CSS custom properties for the palette (outlier marks, good/bad chips, school swatch). */
export function paletteCssVars(palette) {
  const p = resolvePalette(palette);
  return {
    '--map-outlier': p.outlier,
    '--map-outlier-mark': p.outlierMark,
    '--map-outlier-text': p.outlierText,
    '--map-nodata': p.noData,
    '--map-good': p.good,
    '--map-bad': p.bad,
    '--map-good-text': p.goodText,
    '--map-bad-text': p.badText,
    '--map-school-ramp': `linear-gradient(90deg, ${rampFor(p, 'up').join(', ')})`,
  };
}

/** Writes the palette's CSS variables on <html data-map-palette>. */
export function applyPaletteVars(palette, doc = globalThis.document) {
  const el = doc?.documentElement;
  if (!el) return null;
  const p = resolvePalette(palette);
  for (const [k, v] of Object.entries(paletteCssVars(p))) el.style?.setProperty?.(k, v);
  if (el.dataset) el.dataset.mapPalette = p.id;
  return p.id;
}

// ── Herkomst: value against the average of the scope ─────────────────────────

const SCOPE_AVERAGE = Object.freeze({ rotterdam: `het ${CITY.adjective} gemiddelde`, nederland: 'het landelijke gemiddelde' });

/** "het Rotterdamse gemiddelde" / "het landelijke gemiddelde"; anything else "het gemiddelde". */
export function scopeAverageLabel(scope) {
  return SCOPE_AVERAGE[scope] ?? 'het gemiddelde';
}

/** Ratio as Dutch text: 2.46 → "2,5×", 12.3 → "12×", 1 → "1×". */
export function formatRatio(r) {
  const s = r >= 10 ? String(Math.round(r)) : (Math.round(r * 10) / 10).toFixed(1).replace(/\.0$/, '').replace('.', ',');
  return `${s}×`;
}

/**
 * "2,5× het Rotterdamse gemiddelde (7%)" for an origin value against the scope
 * average; '' when the value or the average is missing, the average is not
 * above 0, or either is not a finite number. A value of 0 gives
 * "het Rotterdamse gemiddelde is 7%".
 */
export function averageComparison(value, average, { scope = null, format = v => String(v) } = {}) {
  const v = typeof value === 'number' ? value : null, a = typeof average === 'number' ? average : null;
  if (v == null || a == null || !Number.isFinite(v) || !Number.isFinite(a) || a <= 0) return '';
  const label = scopeAverageLabel(scope);
  if (v === 0) return `${label} is ${format(a)}`;
  return `${formatRatio(v / a)} ${label} (${format(a)})`;
}

/** Plain mean of the finite numbers in `values`; null when there are none. */
export function mean(values) {
  const xs = (values ?? []).filter(v => typeof v === 'number' && Number.isFinite(v));
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
}
