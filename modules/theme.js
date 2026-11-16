// ── Colour theme (pure parts unit-tested) ────────────────────────────────────
// Token sets in style.css on <html data-theme>: "rotterdam" (flag green and
// white on dark grey-blue), "klassiek" (the original purple/orange, labelled
// "Paars-oranje") and the Mokumistics pair "mokum" (red #e30613, black and
// white, dark) and "mokum-licht" (its light variant). Every theme can be picked
// in every city; without a stored choice the city's theme applies
// (config/cities.json "theme"). The switch lives in the
// Instellingen dialog (modules/settings.js). The inline script in index.html applies the stored
// choice before first paint; keep its key, ids and city defaults in step with
// these (tests/brand.test.js).
import { CITY } from './city.js';

export const THEMES = Object.freeze({
  rotterdam: Object.freeze({ id: 'rotterdam', label: 'Rotterdam', themeColor: '#111923' }),
  klassiek:  Object.freeze({ id: 'klassiek',  label: 'Paars-oranje', themeColor: '#0d0a14' }),
  mokum:     Object.freeze({ id: 'mokum',     label: 'Mokum', themeColor: '#000000' }),
  'mokum-licht': Object.freeze({ id: 'mokum-licht', label: 'Mokum licht', themeColor: '#ffffff' }),
});

export const DEFAULT_THEME = 'rotterdam';
/** The theme of a city when nothing is stored (Amsterdam → mokum). */
export const cityDefaultTheme = (city = CITY) => (Object.hasOwn(THEMES, city?.theme ?? '') ? city.theme : DEFAULT_THEME);

/** Map colours per theme: the city outline and wijk strokes (accent) and the mask outside the gemeente. */
export const MAP_COLORS = Object.freeze({
  rotterdam: Object.freeze({ accent: '#7c3aed', mask: '#0d0a14', maskOpacity: 0.85 }),
  klassiek:  Object.freeze({ accent: '#7c3aed', mask: '#0d0a14', maskOpacity: 0.85 }),
  mokum:     Object.freeze({ accent: '#e30613', mask: '#0a0a0a', maskOpacity: 0.85 }),
  'mokum-licht': Object.freeze({ accent: '#e30613', mask: '#0a0a0a', maskOpacity: 0.8 }),
});
/** MAP_COLORS of theme `id`, else of the default theme. */
export const mapColors = id => MAP_COLORS[id] ?? MAP_COLORS[DEFAULT_THEME];
export const THEME_STORAGE_KEY = 'roffatistics.theme';

/** Returns the config for `id`, or the default theme for unknown ids. */
export function resolveTheme(id) {
  return Object.hasOwn(THEMES, id) ? THEMES[id] : THEMES[DEFAULT_THEME];
}

/** Reads the stored theme; nothing stored, an unknown id or a storage failure → the city's theme. */
export function pickInitialTheme(storage, fallback = cityDefaultTheme()) {
  try {
    const id = storage?.getItem(THEME_STORAGE_KEY);
    return Object.hasOwn(THEMES, id ?? '') ? id : fallback;
  } catch {
    return fallback;
  }
}

/** Sets data-theme and the theme-color meta, stores the choice; returns the applied id. */
export function applyTheme(id, doc = globalThis.document, storage = null) {
  const theme = resolveTheme(id);
  if (doc?.documentElement) doc.documentElement.dataset.theme = theme.id;
  doc?.querySelector?.('meta[name="theme-color"]')?.setAttribute('content', theme.themeColor);
  try { storage?.setItem(THEME_STORAGE_KEY, theme.id); } catch { /* storage blocked */ }
  return theme.id;
}
