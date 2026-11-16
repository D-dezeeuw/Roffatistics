// ── Colour theme (pure parts unit-tested) ────────────────────────────────────
// Two themes as token sets in style.css on <html data-theme>: "rotterdam"
// (default, flag green and white on dark grey-blue) and "klassiek" (the
// original purple/orange, labelled "Paars-oranje"). The switch lives in the
// Instellingen dialog (modules/settings.js). The inline script in index.html applies the stored
// choice before first paint; keep its key, ids and default in step with these.

export const THEMES = Object.freeze({
  rotterdam: Object.freeze({ id: 'rotterdam', label: 'Rotterdam', themeColor: '#111923' }),
  klassiek:  Object.freeze({ id: 'klassiek',  label: 'Paars-oranje', themeColor: '#0d0a14' }),
});

export const DEFAULT_THEME = 'rotterdam';

/** Map colours per theme: the city outline and wijk strokes (accent) and the mask outside the gemeente. */
export const MAP_COLORS = Object.freeze({
  rotterdam: Object.freeze({ accent: '#7c3aed', mask: '#0d0a14', maskOpacity: 0.85 }),
  klassiek:  Object.freeze({ accent: '#7c3aed', mask: '#0d0a14', maskOpacity: 0.85 }),
});
/** MAP_COLORS of theme `id`, else of the default theme. */
export const mapColors = id => MAP_COLORS[id] ?? MAP_COLORS[DEFAULT_THEME];
export const THEME_STORAGE_KEY = 'roffatistics.theme';

/** Returns the config for `id`, or the default theme for unknown ids. */
export function resolveTheme(id) {
  return Object.hasOwn(THEMES, id) ? THEMES[id] : THEMES[DEFAULT_THEME];
}

/** Reads the stored theme; any storage failure falls back to the default. */
export function pickInitialTheme(storage) {
  try {
    return resolveTheme(storage?.getItem(THEME_STORAGE_KEY)).id;
  } catch {
    return DEFAULT_THEME;
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
