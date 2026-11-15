// ── Colour theme (pure parts unit-tested) ────────────────────────────────────
// Two themes as token sets in style.css on <html data-theme>: "rotterdam"
// (default, flag green and white on dark grey-blue) and "klassiek" (the
// original purple/orange). The inline script in index.html applies the stored
// choice before first paint; keep its key, ids and default in step with these.

export const THEMES = Object.freeze({
  rotterdam: Object.freeze({ id: 'rotterdam', label: 'Rotterdam', themeColor: '#111923' }),
  klassiek:  Object.freeze({ id: 'klassiek',  label: 'Klassiek',  themeColor: '#0d0a14' }),
});

export const DEFAULT_THEME = 'rotterdam';
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

/** Adds a "Thema" switch under the basemap switcher (same look, Leaflet control). */
export function addThemeSwitcher(L, map) {
  let storage = null;
  try { storage = window.localStorage; } catch { /* storage blocked */ }
  let active = applyTheme(pickInitialTheme(storage), document);

  const Switcher = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const el = L.DomUtil.create('div', 'basemap-switcher theme-switcher leaflet-bar');
      el.setAttribute('role', 'radiogroup');
      el.setAttribute('aria-label', 'Kleurthema');
      const label = L.DomUtil.create('span', 'theme-label', el);
      label.textContent = 'Thema';
      label.setAttribute('aria-hidden', 'true');
      for (const t of Object.values(THEMES)) {
        const btn = L.DomUtil.create('button', 'basemap-opt', el);
        btn.type = 'button';
        btn.dataset.theme = t.id;
        btn.textContent = t.label;
        btn.setAttribute('role', 'radio');
        btn.addEventListener('click', () => { active = applyTheme(t.id, document, storage); update(); });
      }
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      return el;
    },
  });
  const el = new Switcher().addTo(map).getContainer();
  function update() {
    for (const btn of el.querySelectorAll('.basemap-opt')) {
      const on = btn.dataset.theme === active;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }
  update();
  return el;
}
