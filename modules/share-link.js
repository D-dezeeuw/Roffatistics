// "Delen" (v0.31.0): which parts of the current screen a share link carries.
// Pure, unit-tested (tests/share-link.test.js); the dialog is share-dialog.js.
//
// One hash format: the link is the address-bar hash of state.js (serializeHash /
// parseHash: scope, view, dataset, crime, area, score) plus a few one-shot
// view keys in the same URLSearchParams form, read once on load and then
// dropped from the address bar by state.js (dtab=jouw is address-bar state, W19):
//   map=<lat>,<lng>,<zoom>   map centre and zoom (the zoom sets the map level)
//   modal=1                  the area detail modal was open for `area`
// cmp=<code>.<code>.<code> (Vergelijken columns, compare.js) is address-bar state
// with its own checkbox (15 Nov 2026).
//   lvl=<level>              Ranglijst level (wijken, buurten, provincies, gemeenten)
//   rank=<key>               Ranglijst "Rangschik op" (overall or a dataset key)
//   sort=<column>.<asc|desc> Ranglijst sort column and direction
// The Ranglijst view mode (lv=adv, state.listView) is address-bar state and
// rides on the same "list" checkbox (15 Nov 2026).
//   basemap=<id>             background map (map.js BASEMAPS)
//   theme=<id>               colour theme (theme.js THEMES)
// The sensitive answer parts (herkomst/gemeenschap, opleiding, inkomen) go in
// only when ticked: shareableScore() via serializeHash(state, shareOpts).
import { serializeHash, parseHash, DEFAULT_STATE } from './state.js';
import { SHARE_PARTS, decodeAnswers } from './wizard-model.js';
import { DATASETS, DATASET_KEYS, resolveLayerKey } from './datasets.js';
import { BASEMAPS } from './map.js';
import { THEMES } from './theme.js';
import { MIN_ZOOM, MAX_ZOOM } from './zoom-plan.js';

/** Ranglijst levels per scope (list.js LEVELS; setListOptions checks the scope). */
export const LIST_LEVELS = Object.freeze(['wijken', 'buurten', 'provincies', 'gemeenten']);
// Underscore allowed since 15 Nov 2026 so region columns (hr_*) can be shared; old links still match.
const SORT_RE = /^[A-Za-z0-9_]{1,40}$/;
const VIEW_LABEL = { map: 'Kaart', list: 'Ranglijst', dashboard: 'Dashboard' };

/** The checkboxes of "Deel deze weergave", grouped; `key` is the option name. */
export const SHARE_GROUPS = Object.freeze([
  Object.freeze({ id: 'weergave', label: 'Weergave', sensitive: false, parts: Object.freeze([
    { key: 'view',    label: 'Weergave (kaart, ranglijst of dashboard)' },
    { key: 'scope',   label: 'Gebied (Rotterdam of Nederland)' },
    { key: 'dataset', label: 'Kaartlaag' },
    { key: 'map',     label: 'Kaartpositie en zoom (bepaalt het niveau op de kaart)' },
    { key: 'area',    label: 'Geselecteerd gebied en open detailvenster' },
    { key: 'cmp',     label: 'Vergelijking (de gebieden in Vergelijken)' },
    { key: 'list',    label: 'Ranglijst: niveau, rangschikking, sortering en weergave' },
    { key: 'basemap', label: 'Achtergrondkaart' },
    { key: 'theme',   label: 'Kleurthema' },
    { key: 'dtab',    label: 'Dashboardtabblad (Algemeen of Jouw dashboard)' },
  ].map(Object.freeze)) }),
  Object.freeze({ id: 'wensen', label: 'Jouw wensen', sensitive: false, parts: Object.freeze([
    { key: 'answers', label: 'Je antwoorden: levenstype, budget, vervoer, sfeer, veiligheid, bouwstijl en hoe belangrijk' },
  ].map(Object.freeze)) }),
  Object.freeze({ id: 'gevoelig', label: 'Gevoelig', sensitive: true, parts: Object.freeze(
    Object.entries(SHARE_PARTS).map(([key, label]) => Object.freeze({ key, label: `${label} (gevoelig)` }))) }),
]);
export const SENSITIVE_KEYS = Object.freeze(Object.keys(SHARE_PARTS));
export const SHARE_KEYS = Object.freeze(SHARE_GROUPS.flatMap(g => g.parts.map(p => p.key)));

/** Which sensitive parts the answers in `score` hold (only those can be shared). */
export function sensitivePresent(score) {
  const a = decodeAnswers(score ?? '');
  const s = a.situatie;
  return { origin: !!a.gemeenschap, education: !!s?.edu, income: s?.income != null || !!s?.bijstand };
}

/** Per option: does the snapshot hold something to share for it? */
export function availableParts(snap = {}) {
  const st = snap.state ?? {};
  const sens = st.score ? sensitivePresent(st.score) : { origin: false, education: false, income: false };
  return {
    view: !!st.view, scope: !!st.scope, dataset: !!st.dataset, map: !!snap.map, area: !!st.area, cmp: !!st.cmp,
    list: !!snap.list, basemap: !!snap.basemap, theme: !!snap.theme, dtab: st.dtab === 'jouw', answers: !!st.score, ...sens,
  };
}

/**
 * The default ticks: every Weergave part that has a value, Jouw wensen when a
 * wizard result (score) exists, and never a sensitive part.
 */
export function defaultShareOptions(snap = {}) {
  const av = availableParts(snap);
  const out = Object.fromEntries(SHARE_KEYS.map(k => [k, av[k]]));
  for (const k of SENSITIVE_KEYS) out[k] = false;
  return out;
}

const round = (v, d) => Number(Number(v).toFixed(d));

/**
 * Snapshot + ticks → '#…' with only the ticked parts ('' when nothing is ticked).
 * snap: { state: { scope, view, dataset, crime, area, score }, map: { lat, lng, zoom },
 *         modal: boolean, list: { level, rankKey, sort: { column, dir } }, basemap, theme }
 */
export function buildShareHash(snap = {}, options = {}) {
  const o = options, st = { ...DEFAULT_STATE, ...(snap.state ?? {}) };
  const sens = Object.fromEntries(SENSITIVE_KEYS.map(k => [k, o.answers === true && o[k] === true]));
  const core = new URLSearchParams(serializeHash({ ...st, score: o.answers ? st.score : null }, sens).slice(1));
  const p = new URLSearchParams();
  if (o.scope) p.set('scope', core.get('scope'));
  if (o.view) p.set('view', core.get('view'));
  if (o.dataset) for (const k of ['dataset', 'crime']) if (core.has(k)) p.set(k, core.get(k));
  if (o.area && core.has('area')) {
    p.set('area', core.get('area'));
    if (snap.modal) p.set('modal', '1');
  }
  if (o.cmp && core.has('cmp')) p.set('cmp', core.get('cmp'));
  if (core.has('score')) p.set('score', core.get('score'));
  const m = snap.map;
  if (o.map && m && [m.lat, m.lng, m.zoom].every(Number.isFinite)) p.set('map', `${round(m.lat, 5)},${round(m.lng, 5)},${round(m.zoom, 2)}`);
  const l = snap.list;
  if (o.list && l) {
    if (LIST_LEVELS.includes(l.level)) p.set('lvl', l.level);
    if (l.rankKey === 'overall' || DATASET_KEYS.includes(l.rankKey)) p.set('rank', l.rankKey);
    if (l.sort && SORT_RE.test(l.sort.column ?? '') && ['asc', 'desc'].includes(l.sort.dir)) p.set('sort', `${l.sort.column}.${l.sort.dir}`);
    if (core.has('lv')) p.set('lv', core.get('lv'));
  }
  if (o.basemap && Object.hasOwn(BASEMAPS, snap.basemap ?? '')) p.set('basemap', snap.basemap);
  if (o.theme && Object.hasOwn(THEMES, snap.theme ?? '')) p.set('theme', snap.theme);
  if (o.dtab && core.has('dtab')) p.set('dtab', core.get('dtab'));
  const s = String(p);
  return s ? `#${s}` : '';
}

/** The full link: `base` without its hash + buildShareHash(). */
export function buildShareUrl(snap, options, base = globalThis.location?.href ?? '') {
  return `${String(base).split('#')[0]}${buildShareHash(snap, options)}`;
}

/**
 * '#…' → { state, map, modal, list, basemap, theme }: `state` is parseHash()
 * (so every old link decodes as before), the view keys are validated and null
 * when absent or unreadable.
 */
export function parseShareHash(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const state = parseHash(hash);
  let map = null;
  const mm = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?),(\d{1,2}(?:\.\d+)?)$/.exec(params.get('map') ?? '');
  if (mm) {
    const [lat, lng, zoom] = mm.slice(1).map(Number);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && zoom >= MIN_ZOOM && zoom <= MAX_ZOOM) map = { lat, lng, zoom };
  }
  const list = {};
  const lvl = params.get('lvl'), rank = params.get('rank');
  const sm = /^([A-Za-z0-9_]{1,40})\.(asc|desc)$/.exec(params.get('sort') ?? '');
  if (LIST_LEVELS.includes(lvl)) list.level = lvl;
  // Retired layer ids (15 Nov 2026) map to their successor; the format itself is unchanged.
  if (rank === 'overall' || DATASET_KEYS.includes(rank)) list.rankKey = resolveLayerKey(rank);
  if (sm) list.sort = { column: resolveLayerKey(sm[1]), dir: sm[2] };
  const basemap = params.get('basemap'), theme = params.get('theme');
  return {
    state,
    map,
    modal: params.get('modal') === '1' && !!state.area,
    list: Object.keys(list).length ? list : null,
    basemap: Object.hasOwn(BASEMAPS, basemap ?? '') ? basemap : null,
    theme: Object.hasOwn(THEMES, theme ?? '') ? theme : null,
  };
}

/** True when a parsed hash carries any view key beyond the address-bar state. */
export function hasShareExtras(parsed) {
  return !!(parsed && (parsed.map || parsed.modal || parsed.list || parsed.basemap || parsed.theme));
}

/** Short Dutch value shown next to each checkbox ('' when there is nothing to share). */
export function partSummary(snap = {}, key) {
  const st = snap.state ?? {};
  switch (key) {
    case 'view':    return VIEW_LABEL[st.view] ?? '';
    case 'scope':   return st.scope === 'nederland' ? 'Nederland' : st.scope ? 'Rotterdam' : '';
    case 'dataset': return DATASETS[st.dataset] ? `${DATASETS[st.dataset].label}${st.crime === 'abs' ? ' · aantallen' : ''}` : '';
    case 'map':     return snap.map ? `zoom ${round(snap.map.zoom, 1).toLocaleString('nl-NL')}` : '';
    case 'area':    return st.area ? `${st.area}${snap.modal ? ' · detailvenster open' : ''}` : 'geen gebied geselecteerd';
    case 'list':    return snap.list ? [snap.list.level, st.listView === 'adv' ? 'uitgebreid' : 'eenvoudig', snap.list.sort ? `sortering ${snap.list.sort.column} ${snap.list.sort.dir === 'desc' ? '↓' : '↑'}` : ''].filter(Boolean).join(', ') : '';
    case 'cmp':     return st.cmp ? st.cmp.split('.').filter(Boolean).join(', ') : 'geen gebieden in Vergelijken';
    case 'basemap': return BASEMAPS[snap.basemap]?.label ?? '';
    case 'theme':   return THEMES[snap.theme]?.label ?? '';
    case 'dtab':    return st.dtab === 'jouw' ? 'Jouw dashboard' : 'Algemeen';
    case 'answers': return st.score ? '' : 'nog niet ingevuld';
    default:        return st.score && sensitivePresent(st.score)[key] ? '' : 'niet ingevuld';
  }
}
