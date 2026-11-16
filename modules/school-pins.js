// ── Basisscholen: a pin per school, coloured by its schoolscore (W31) ─────────
// Switched in Instellingen (modules/settings.js) like the OV lines; own key
// roffatistics.basisscholen, default off. The school file
// (data/nl/onderwijs-po-scholen-2024.json, built by scripts/build-schools.mjs)
// is fetched only when the layer is first switched on, through the shared
// loader of modules/onderwijs.js (one fetch whether pins or the area panel
// come first); grade formatting is shared with it too. Independent of which
// area metric is shown. Pure parts (state, colour, rows, popup) are unit-tested;
// addSchoolPinsLayer draws the Leaflet layer.
// Data: DUO open onderwijsdata (referentieniveaus 2022-2024).

import { CLASS_COUNT, SCALE_EVENT } from './scale.js';
import { activePalette, rampFor } from './palette.js';
import { EDU_SCHOOLS_URL, decodeSchools, formatGrade, loadEduSchools } from './onderwijs.js';

export const SCHOOLS_URL = EDU_SCHOOLS_URL;
export const SCHOOL_PINS_STORAGE_KEY = 'roffatistics.basisscholen';
export const DEFAULT_SCHOOL_PINS = false;
/** Fixed colour domain (about 4.3 points per class): covers about p3..p97 of the 5,977 scored schools (median 77). */
export const SCHOOL_SCORE_RANGE = Object.freeze([60, 90]);
export const SCHOOL_NO_SCORE_COLOR = '#9ca3af';
export const SCHOOL_PINS_PANE = 'schoolPins';
export const DUO_ATTRIBUTION = 'Basisscholen: <a href="https://duo.nl/open_onderwijsdata/" target="_blank" rel="noopener">DUO</a>';

// ── Toggle state ("1" on, "0" off, missing = default) ─────────────────────────

export function parseSchoolPins(raw) {
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false' || raw === '') return false;
  return DEFAULT_SCHOOL_PINS;
}
export const serializeSchoolPins = on => (on ? '1' : '0');

/** Stored toggle; any storage failure gives the default (off). */
export function pickInitialSchoolPins(storage) {
  try { return parseSchoolPins(storage?.getItem(SCHOOL_PINS_STORAGE_KEY) ?? null); } catch { return DEFAULT_SCHOOL_PINS; }
}
export function storeSchoolPins(on, storage) {
  try { storage?.setItem(SCHOOL_PINS_STORAGE_KEY, serializeSchoolPins(!!on)); } catch { /* storage blocked */ }
}

// ── Colour ────────────────────────────────────────────────────────────────────

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Class 0..6 of a score on the fixed domain (clamped); null for no score. */
export function schoolScoreClass(score, [lo, hi] = SCHOOL_SCORE_RANGE) {
  const s = num(score);
  if (s == null) return null;
  const t = (s - lo) / (hi - lo);
  return Math.max(0, Math.min(CLASS_COUNT - 1, Math.floor(t * CLASS_COUNT)));
}

/** Pin fill: the good/bad ramp of the map palette (high = good, e.g. green under Rotterdam), grey without a score. */
export function schoolColor(score, palette = activePalette()) {
  const c = schoolScoreClass(score);
  return c == null ? SCHOOL_NO_SCORE_COLOR : rampFor(palette, 'up')[c];
}

/** Pin radius (px) for a zoom level. */
export function schoolPinRadius(zoom) {
  return zoom < 10 ? 2 : zoom < 12 ? 3 : zoom < 14 ? 4.5 : 6;
}

// ── Rows ──────────────────────────────────────────────────────────────────────

const hasCoords = s => num(s?.lat) != null && num(s?.lon) != null;

/** Decoded schools (onderwijs.js decodeSchools) → only those with coordinates. */
export const pinnableSchools = schools => (schools ?? []).filter(hasCoords);

/** Column-wise school file → one object per school with coordinates; [] for an unreadable file. */
export function schoolsFromFile(file) {
  try { return pinnableSchools(decodeSchools(file)); } catch { return []; }
}

// ── Popup ─────────────────────────────────────────────────────────────────────

export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 71.3 → '7,1' (onderwijs.js formatGrade, the same grade as the area panel); null → null. */
export const schoolGrade = score => (num(score) == null ? null : formatGrade(score));

const pct = v => (num(v) == null ? '–' : `${Math.round(v)}%`);
const postcode = p => (typeof p === 'string' && /^\d{4}[A-Z]{2}$/.test(p) ? `${p.slice(0, 4)} ${p.slice(4)}` : p ?? '');

/** Popup markup: name, address, grade /10, per-subject 1F and 2F/1S, pupils, flags. Every text is escaped. */
export function schoolPopupHtml(s) {
  const addr = [s?.street, [postcode(s?.postcode), s?.place].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const head = `<strong class="sp-name">${escapeHtml(s?.name || 'Basisschool')}</strong>${addr ? `<div class="sp-addr">${escapeHtml(addr)}</div>` : ''}`;
  const grade = schoolGrade(s?.score);
  if (grade == null) return `<div class="school-popup">${head}<p class="sp-flag">Geen toetsgegevens</p></div>`;
  const row = (label, f, st) => `<tr><th scope="row">${label}</th><td>${pct(f)}</td><td>${pct(st)}</td></tr>`;
  return `<div class="school-popup">${head}
    <div class="sp-grade">Schoolscore <b>${grade}</b> / 10</div>
    <table class="sp-table"><thead><tr><th></th><th scope="col">1F</th><th scope="col">2F/1S</th></tr></thead><tbody>
      ${row('Lezen', s.lezenFund, s.lezenStreef)}${row('Taalverzorging', s.taalFund, s.taalStreef)}${row('Rekenen', s.rekenenFund, s.rekenenStreef)}${row('Totaal', s.fund, s.streef)}
    </tbody></table>
    <div class="sp-meta">${num(s.tested) == null ? 'Aantal getoetste leerlingen onbekend' : `${escapeHtml(s.tested)} getoetste leerlingen (2022–2024)`}</div>
    ${s.small ? '<p class="sp-flag">Klein aantal leerlingen: de score schommelt sterk per jaar.</p>' : ''}
    ${s.estimate ? '<p class="sp-note">Deels geschat (kleine aantallen zijn door DUO afgeschermd).</p>' : ''}
  </div>`;
}

// ── Leaflet layer ─────────────────────────────────────────────────────────────

/**
 * Adds the (initially hidden or stored-on) school pin layer to `map`.
 * SVG renderer in its own pane with pointer-events off: only the pins catch
 * clicks, the area polygons underneath stay clickable (a canvas would cover
 * the whole map and swallow them). Returns { get(), set(on) }.
 */
export function addSchoolPinsLayer(L, map, { storage = null } = {}) {
  let on = pickInitialSchoolPins(storage);
  if (!map.getPane(SCHOOL_PINS_PANE)) {
    const p = map.createPane(SCHOOL_PINS_PANE);
    p.style.zIndex = '460';            // above the OV stops (455), below tooltips and popups
    p.style.pointerEvents = 'none';    // the interactive paths re-enable it for themselves
  }
  const renderer = L.svg({ pane: SCHOOL_PINS_PANE, padding: 0.3 });
  let group = null, loading = null, radius = schoolPinRadius(map.getZoom());

  async function ensure() {
    if (group) return group;
    loading ??= loadEduSchools().catch(err => { console.warn('basisscholen:', err); return null; });
    const schools = await loading;
    if (!schools) { loading = null; return null; }
    group ??= L.layerGroup(pinnableSchools(schools).map(s => L.circleMarker([s.lat, s.lon], {
      renderer, pane: SCHOOL_PINS_PANE, radius, bubblingMouseEvents: false,
      color: '#ffffff', weight: 0.8, opacity: 0.9, fillColor: schoolColor(s.score), fillOpacity: 0.95, schoolScore: s.score,
    }).bindPopup(() => schoolPopupHtml(s), { className: 'school-popup-wrap', maxWidth: 300 })));
    return group;
  }
  // Kaartkleuren changed (scale.js setMapPalette / theme under "Volgt thema"): recolour the pins in place.
  globalThis.document?.addEventListener?.(SCALE_EVENT, () => {
    if (!group) return;
    const pal = activePalette();
    group.eachLayer(l => l.setStyle?.({ fillColor: schoolColor(l.options?.schoolScore, pal) }));
  });
  async function refresh() {
    if (!on) {
      if (group && map.hasLayer(group)) { group.remove(); map.attributionControl?.removeAttribution(DUO_ATTRIBUTION); }
      return;
    }
    const g = await ensure();
    if (g && on && !map.hasLayer(g)) { g.addTo(map); map.attributionControl?.addAttribution(DUO_ATTRIBUTION); }
  }
  map.on('zoomend', () => {
    const r = schoolPinRadius(map.getZoom());
    if (r === radius) return;
    radius = r;
    group?.eachLayer(l => l.setRadius(r));
  });
  if (on) refresh();
  return {
    get: () => on,
    set(next) { on = !!next; storeSchoolPins(on, storage); return refresh(); },
  };
}
