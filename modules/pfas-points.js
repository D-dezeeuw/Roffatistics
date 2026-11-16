// ── PFAS-punten: an overlay of measurement points and presumptive sources ─────
// (docs/plan-milieu.md phase 2, item 7.) Switched in Instellingen like the
// Basisscholen pins; own key roffatistics.pfaspunten, default off. The file
// data/nl/pfas-points.json (scripts/build-pfas-points.mjs, from the Pfoisened
// export of the PFAS Data Hub, CNRS) is fetched only when the layer is first
// switched on. The pins are coloured by kind, never by the measured value:
// measurements are taken where contamination is suspected, so the density of
// points shows where someone looked, not where PFAS is. The same presumptive
// sources feed the layer "Afstand tot verdachte PFAS-bron" (modules/milieu.js).
// Pure parts (kind, file format, popup, state) are unit-tested.

export const PFAS_POINTS_FORMAT = 1;
export const PFAS_POINTS_URL = './data/nl/pfas-points.json';
export const PFAS_PINS_STORAGE_KEY = 'roffatistics.pfaspunten';
export const DEFAULT_PFAS_PINS = false;
export const PFAS_PINS_PANE = 'pfasPins';
export const PDH_URL = 'https://pdh.cnrs.fr';
export const PDH_ATTRIBUTION = `PFAS: <a href="${PDH_URL}" target="_blank" rel="noopener">PFAS Data Hub (CNRS)</a>`;

/** Pfoisened `source` names → kind. Presumptive sources: the plan's list (no Flemish incident sites: NL has no such register). */
export const PFAS_SOIL_SOURCE = 'Netherlands PFASBodemTotaal (soil)';
export const PFAS_WATER_SOURCE = 'PDH groundwater matrix';
export const PFAS_PRESUMPTIVE_SOURCES = Object.freeze([
  'Airports',
  'Military firefighting training areas',
  'WWTP (waste water treatment plants)',
  'Paper producing plants',
  'EPRTR (European Pollutant Release and Transfer Register)',
  'PDH presumptive sources',
]);
export const PFAS_KINDS = Object.freeze(['bodem', 'grondwater', 'bron']);
export const PFAS_KIND_LABEL = Object.freeze({ bodem: 'Bodemmeting', grondwater: 'Grondwatermeting', bron: 'Verdachte bron' });
export const PFAS_KIND_COLOR = Object.freeze({ bodem: '#b45309', grondwater: '#0284c7', bron: '#7c3aed' });
export const PFAS_KIND_UNIT = Object.freeze({ bodem: 'ng/g', grondwater: 'ng/L' });
const TYPE_NL = Object.freeze({
  'Sampling location': 'Meetpunt',
  Airport: 'Vliegveld',
  'Military site': 'Militair terrein',
  'Waste management site': 'Afvalverwerking of rioolwaterzuivering',
  'Industrial site': 'Industrie',
  'Firefighting incident / training': 'Brand of blusoefening',
});
const SOURCE_NL = Object.freeze({
  [PFAS_SOIL_SOURCE]: 'Bodemmetingen Nederland (PFASBodemTotaal)',
  [PFAS_WATER_SOURCE]: 'PFAS Data Hub, grondwater',
  Airports: 'Vliegvelden',
  'Military firefighting training areas': 'Militaire brandoefenterreinen',
  'WWTP (waste water treatment plants)': 'Rioolwaterzuiveringen (UWWTD)',
  'Paper producing plants': 'Papierfabrieken',
  'EPRTR (European Pollutant Release and Transfer Register)': 'E-PRTR (Europees emissieregister)',
  'PDH presumptive sources': 'PFAS Data Hub, vermoedelijke bronnen',
});

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A Pfoisened point → 'bodem' | 'grondwater' | 'bron' | null (not used). */
export function pfasKind(p) {
  if (p?.category === 'Presumptive') return PFAS_PRESUMPTIVE_SOURCES.includes(p.source) ? 'bron' : null;
  if (p?.category === 'Measurement') return p.source === PFAS_SOIL_SOURCE ? 'bodem' : p.source === PFAS_WATER_SOURCE ? 'grondwater' : null;
  return null;
}
export const isPfasSource = p => pfasKind(p) === 'bron';

// ── File format (columns; strings by index) ───────────────────────────────────

const r5 = v => Math.round(v * 1e5) / 1e5;
/** Pfoisened points (already filtered) → the columnar file body (without meta). */
export function encodePfasPoints(points) {
  const types = [], sources = [];
  const idx = (list, v) => { let i = list.indexOf(v); if (i < 0) { i = list.length; list.push(v); } return i; };
  const out = { format: PFAS_POINTS_FORMAT, kinds: PFAS_KINDS, types, sources, lat: [], lon: [], kind: [], type: [], src: [], name: [], value: [], count: [] };
  for (const p of points) {
    const k = pfasKind(p);
    if (!k || num(p.lat) == null || num(p.lon) == null) continue;
    out.lat.push(r5(p.lat)); out.lon.push(r5(p.lon)); out.kind.push(PFAS_KINDS.indexOf(k));
    out.type.push(idx(types, p.type ?? '')); out.src.push(idx(sources, p.source ?? ''));
    out.name.push(p.name && p.name !== 'Sampling location' ? String(p.name) : '');
    out.value.push(k === 'bron' ? null : num(p.value)); out.count.push(num(p.count));
  }
  return out;
}

/** The file → [{ lat, lon, kind, type, source, name, value, count }]. Throws on another format. */
export function decodePfasPoints(json) {
  if (json?.format !== PFAS_POINTS_FORMAT || !Array.isArray(json.lat)) throw new Error('pfas-points: onbekend bestand');
  return json.lat.map((lat, i) => ({
    lat, lon: json.lon[i], kind: json.kinds[json.kind[i]] ?? null, type: json.types[json.type[i]] ?? '',
    source: json.sources[json.src[i]] ?? '', name: json.name[i] ?? '', value: json.value[i] ?? null, count: json.count[i] ?? null,
  }));
}

// ── Popup ─────────────────────────────────────────────────────────────────────

export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = v => v.toLocaleString('nl-NL', { maximumFractionDigits: v < 10 ? 2 : 1 });

/** Popup markup: name, type, value with unit (pfas_sum) or "verdachte bron", source and the PDH attribution. */
export function pfasPopupHtml(p) {
  const kind = PFAS_KIND_LABEL[p?.kind] ?? 'PFAS-punt';
  const type = TYPE_NL[p?.type] ?? p?.type ?? '';
  const title = p?.name || (p?.kind === 'bron' ? type || kind : kind);
  const value = p?.kind === 'bron'
    ? '<div class="pf-value">Verdachte bron: hier is PFAS gebruikt of mogelijk vrijgekomen; geen meting.</div>'
    : num(p?.value) == null
      ? '<div class="pf-value">Geen waarde</div>'
      : `<div class="pf-value">Som PFAS <b>${fmt(p.value)} ${PFAS_KIND_UNIT[p.kind] ?? ''}</b>${num(p.count) > 1 ? ` <span class="pf-count">(${p.count} monsters)</span>` : ''}</div>`;
  return `<div class="pfas-popup"><strong class="pf-name">${escapeHtml(title)}</strong>
    <div class="pf-kind">${escapeHtml(kind)}${type && type !== title ? ` · ${escapeHtml(type)}` : ''}</div>${value}
    <div class="pf-src">Bron: ${escapeHtml(SOURCE_NL[p?.source] ?? p?.source ?? '')}, via de <a href="${PDH_URL}" target="_blank" rel="noopener">PFAS Data Hub (CNRS)</a>.</div>
    ${p?.kind === 'bron' ? '' : '<p class="pf-note">Er wordt gemeten waar men vervuiling vermoedt: veel punten betekent dat er gezocht is, niet dat het er erger is.</p>'}
  </div>`;
}

// ── Toggle state ("1" on, "0" off, missing = default) ─────────────────────────

export function parsePfasPins(raw) {
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false' || raw === '') return false;
  return DEFAULT_PFAS_PINS;
}
export const serializePfasPins = on => (on ? '1' : '0');
export function pickInitialPfasPins(storage) {
  try { return parsePfasPins(storage?.getItem(PFAS_PINS_STORAGE_KEY) ?? null); } catch { return DEFAULT_PFAS_PINS; }
}
export function storePfasPins(on, storage) {
  try { storage?.setItem(PFAS_PINS_STORAGE_KEY, serializePfasPins(!!on)); } catch { /* storage blocked */ }
}

/** Pin radius (px) for a zoom level; sources one step larger than measurements. */
export const pfasPinRadius = (zoom, kind) => (zoom < 10 ? 2 : zoom < 12 ? 3 : zoom < 14 ? 4 : 5.5) + (kind === 'bron' ? 1 : 0);

// ── Loader and Leaflet layer ──────────────────────────────────────────────────

let pointsPromise = null;
/** Loads (once) the points; a failure is forgotten so the next call retries. */
export function loadPfasPoints({ fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
  if (!pointsPromise) {
    pointsPromise = Promise.resolve(fetcher(PFAS_POINTS_URL)).then(r => { if (!r?.ok) throw new Error(`${PFAS_POINTS_URL} ${r?.status}`); return r.json(); }).then(decodePfasPoints);
    pointsPromise.catch(() => { pointsPromise = null; });
  }
  return pointsPromise;
}

/**
 * Adds the (initially hidden or stored-on) PFAS layer to `map`, the way
 * school-pins.js does: SVG renderer in its own pane, only the pins catch clicks.
 * Sources are drawn last (on top). Returns { get(), set(on) }.
 */
export function addPfasPointsLayer(L, map, { storage = null } = {}) {
  let on = pickInitialPfasPins(storage);
  if (!map.getPane(PFAS_PINS_PANE)) {
    const p = map.createPane(PFAS_PINS_PANE);
    p.style.zIndex = '458';            // above the OV stops (455), below the school pins (460)
    p.style.pointerEvents = 'none';
  }
  const renderer = L.svg({ pane: PFAS_PINS_PANE, padding: 0.3 });
  let group = null, loading = null, zoom = map.getZoom();

  async function ensure() {
    if (group) return group;
    loading ??= loadPfasPoints().catch(err => { console.warn('pfas-punten:', err); return null; });
    const points = await loading;
    if (!points) { loading = null; return null; }
    const ordered = [...points.filter(p => p.kind !== 'bron'), ...points.filter(p => p.kind === 'bron')];
    group ??= L.layerGroup(ordered.map(p => L.circleMarker([p.lat, p.lon], {
      renderer, pane: PFAS_PINS_PANE, radius: pfasPinRadius(zoom, p.kind), bubblingMouseEvents: false,
      color: p.kind === 'bron' ? '#1f2937' : '#ffffff', weight: p.kind === 'bron' ? 1.2 : 0.8, opacity: 0.9,
      fillColor: PFAS_KIND_COLOR[p.kind] ?? '#6b7280', fillOpacity: 0.9, pfasKind: p.kind,
    }).bindPopup(() => pfasPopupHtml(p), { className: 'pfas-popup-wrap', maxWidth: 300 })));
    return group;
  }
  async function refresh() {
    if (!on) {
      if (group && map.hasLayer(group)) { group.remove(); map.attributionControl?.removeAttribution(PDH_ATTRIBUTION); }
      return;
    }
    const g = await ensure();
    if (g && on && !map.hasLayer(g)) { g.addTo(map); map.attributionControl?.addAttribution(PDH_ATTRIBUTION); }
  }
  map.on('zoomend', () => {
    zoom = map.getZoom();
    group?.eachLayer(l => l.setRadius(pfasPinRadius(zoom, l.options?.pfasKind)));
  });
  if (on) refresh();
  return {
    get: () => on,
    set(next) { on = !!next; storePfasPins(on, storage); return refresh(); },
  };
}

/** Test hook: forgets the loaded points. */
export function _resetPfasPoints() { pointsPromise = null; }
