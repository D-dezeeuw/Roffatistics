// Onderwijsprestatie basisscholen in the app (plan-onderwijsprestatie step 3
// and the panel part of step 5). Three static files, each fetched on first use:
//   - the area layer (eduScore, eduNearScore, … per buurt/wijk/gemeente),
//   - the school list (name, address, lat/lon, buurt, score, …),
//   - the buurt centres (the same points the eduNear… figures were built from).
// The small pure helpers (grade, schools in an area, schools within a distance)
// are shared with the school pins. Browser-safe: schools.js has no node imports.

import { haversineKm, NEAR_BEST_KM, NEAR_RADIUS_KM, SMALL_N, YEARS } from './schools.js';

export const EDU_YEAR = 2024;
export const CENTRES_YEAR = 2025;
export const EDU_AREA_URL = `./data/nl/onderwijs-po-${EDU_YEAR}.json`;
export const EDU_SCHOOLS_URL = `./data/nl/onderwijs-po-scholen-${EDU_YEAR}.json`;
export const BUURT_CENTRES_URL = `./data/nl/buurt-centres-${CENTRES_YEAR}.json`;
export const EDU_SMALL_N = SMALL_N;
export const EDU_NEAR_KM = NEAR_BEST_KM;
export const EDU_RADIUS_KM = NEAR_RADIUS_KM;
export const EDU_YEARS_TEXT = `${YEARS[0]}–${YEARS.at(-1)}`;

/** The map layers (datasets.js); the other columns only show in the panel. */
export const EDU_KEYS = Object.freeze(['eduScore', 'eduNearScore', 'eduStreefPct', 'eduFundPct', 'eduNearBest']);
export const EDU_COLUMNS = Object.freeze([...EDU_KEYS, 'eduSchools', 'eduTested', 'eduNearCount']);
export const isEduKey = key => EDU_KEYS.includes(key);

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const nlNum = (v, d) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = code => String(code ?? '').trim().toUpperCase();

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Schoolscore 0–100 → grade /10 with one decimal (78.8 → 7.9); null without a score. */
export const gradeOf = score => (isNum(score) ? Math.round(score) / 10 : null);
/** Schoolscore → '7,9' (nl-NL), '—' without a score. */
export const formatGrade = score => { const g = gradeOf(score); return g == null ? '—' : nlNum(g, 1); };
/** Distance in km → '0,4 km'. */
export const formatKm = km => (isNum(km) ? `${nlNum(km, 1)} km` : '—');

/** 'buurt' | 'wijk' | 'gemeente' for a BU/WK/GM code, else null. */
export function eduLevelOf(code) {
  const c = norm(code);
  return c.startsWith('BU') ? 'buurt' : c.startsWith('WK') ? 'wijk' : c.startsWith('GM') ? 'gemeente' : null;
}

/** The buurt/wijk/gemeente code a school belongs to (from its buurt; `gemeente` only when it has no buurt). */
export function schoolAreaCode(school, level) {
  const bu = school?.buurt ?? null;
  if (level === 'buurt') return bu;
  if (level === 'wijk') return bu ? `WK${bu.slice(2, 8)}` : null;
  if (level === 'gemeente') return bu ? `GM${bu.slice(2, 6)}` : school?.gemeente ?? null;
  return null;
}

const byName = (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'nl', { sensitivity: 'base' });
/** Best score first, schools without toetsgegevens last, then by name. */
const byScore = (a, b) => (b.score ?? -1) - (a.score ?? -1) || byName(a, b);

/** The schools located in the area `code` (BU/WK/GM), best score first; [] for other codes. */
export function schoolsInArea(schools, code) {
  const c = norm(code), level = eduLevelOf(c);
  if (!level) return [];
  return (schools ?? []).filter(s => schoolAreaCode(s, level) === c).sort(byScore);
}

/**
 * Schools within `km` (straight line) of `centre` [lat, lon], nearest first:
 * copies with `km` (2 decimals). Schools without coordinates are left out.
 */
export function schoolsWithinKm(schools, centre, km = EDU_NEAR_KM) {
  if (!Array.isArray(centre) || !isNum(centre[0]) || !isNum(centre[1])) return [];
  const dLat = km / 110.574, dLon = km / (111.32 * Math.cos((centre[0] * Math.PI) / 180));
  const out = [];
  for (const s of schools ?? []) {
    if (!isNum(s?.lat) || !isNum(s?.lon)) continue;
    if (Math.abs(s.lat - centre[0]) > dLat || Math.abs(s.lon - centre[1]) > dLon) continue;
    const d = haversineKm(centre, [s.lat, s.lon]);
    if (d <= km) out.push({ ...s, km: Math.round(d * 100) / 100 });
  }
  return out.sort((a, b) => a.km - b.km || byName(a, b));
}

/** The column-wise school file → [{ brin, name, …, score, tested, small, estimate }]. */
export function decodeSchools(json) {
  const cols = json?.cols;
  if (json?.format !== 1 || !cols?.brin) throw new Error('onderwijs: onbekend scholenbestand');
  const smallN = json.smallN ?? SMALL_N;
  const keys = Object.keys(cols);
  return cols.brin.map((_, i) => {
    const s = Object.fromEntries(keys.map(k => [k, cols[k][i] ?? null]));
    s.estimate = !!s.estimate;
    s.small = s.score != null && isNum(s.tested) && s.tested < smallN;
    return s;
  });
}

/** The area file → Map(code → { eduScore, …, eduNearCount }) over buurt, wijk and gemeente. */
export function decodeEduAreas(json) {
  if (json?.format !== 1 || !json.levels) throw new Error('onderwijs: onbekend gebiedsbestand');
  const out = new Map();
  for (const lvl of Object.values(json.levels)) {
    const cols = lvl?.cols ?? {};
    (lvl?.codes ?? []).forEach((code, i) => out.set(code, Object.fromEntries(EDU_COLUMNS.map(k => [k, cols[k]?.[i] ?? null]))));
  }
  return out;
}

/** { code: [lat, lon] } → the column-wise centres file body { codes, lat, lon } (sorted by code). */
export function encodeCentres(centres) {
  const codes = Object.keys(centres ?? {}).sort();
  return { codes, lat: codes.map(c => centres[c][0]), lon: codes.map(c => centres[c][1]) };
}
/** The centres file → Map(buurt code → [lat, lon]). */
export function decodeCentres(json) {
  if (!Array.isArray(json?.codes)) throw new Error('onderwijs: onbekend centrabestand');
  return new Map(json.codes.map((c, i) => [c, [json.lat[i], json.lon[i]]]));
}

/** The edu values of one area: every column, null where the area has none. {} without data. */
export function eduValuesFor(code, data) {
  if (!data) return {};
  const e = data.get(norm(code));
  return Object.fromEntries(EDU_COLUMNS.map(k => [k, e?.[k] ?? null]));
}

/**
 * Data of the area panel block: the area's figures, the schools in it and,
 * for a buurt with a known centre, the schools within 1 km. Null for other
 * levels or when nothing is loaded.
 */
export function eduAreaDetail(code, { entry = null, schools = null, centre = null } = {}) {
  const level = eduLevelOf(code);
  if (!level || (!entry && !schools)) return null;
  const e = entry ?? {};
  return {
    code: norm(code), level,
    score: e.eduScore ?? null, schools: e.eduSchools ?? 0, tested: e.eduTested ?? null,
    fundPct: e.eduFundPct ?? null, streefPct: e.eduStreefPct ?? null,
    nearScore: e.eduNearScore ?? null, nearBest: e.eduNearBest ?? null, nearCount: e.eduNearCount ?? null,
    list: schools ? schoolsInArea(schools, code) : null,
    near: level === 'buurt' && schools && centre ? schoolsWithinKm(schools, centre, EDU_NEAR_KM) : null,
  };
}

// ── Panel HTML ───────────────────────────────────────────────────────────────

const IN_AREA = { buurt: 'in deze buurt', wijk: 'in deze wijk', gemeente: 'in deze gemeente' };
const pct = v => (isNum(v) ? `${nlNum(v, 1)}%` : '—');
const count = n => nlNum(n, 0);

/** One school row: name, place, optional distance, grade or "geen toetsgegevens", "klein aantal leerlingen". */
export function schoolRowHtml(s, { km = false } = {}) {
  const val = s.score == null
    ? '<span class="area-badge">geen toetsgegevens</span>'
    : `<strong>${formatGrade(s.score)}</strong>${s.small ? ' <span class="area-badge" title="Minder dan ' + EDU_SMALL_N + ' leerlingen getoetst in ' + EDU_YEARS_TEXT + '">klein aantal leerlingen</span>' : ''}`;
  return `<li><span class="edu-po-name">${esc(s.name)}${s.place ? ` <small>${esc(s.place)}</small>` : ''}</span>${km ? `<span class="edu-po-km">${formatKm(s.km)}</span>` : ''}<span class="edu-po-val">${val}</span></li>`;
}
const listHtml = (list, opts) => `<ul class="edu-po-schools">${list.map(s => schoolRowHtml(s, opts)).join('')}</ul>`;

/** The "Basisscholen" block of the area modal ('' without data). `info` = an (i) button. */
export function eduPanelHtml(d, { info = '' } = {}) {
  if (!d) return '';
  const where = IN_AREA[d.level] ?? 'in dit gebied';
  const parts = [];
  if (d.score != null) {
    parts.push(`<p class="edu-po-head"><strong class="edu-po-grade">${formatGrade(d.score)}</strong><span>/ 10 · ${count(d.schools)} ${d.schools === 1 ? 'school' : 'scholen'} met toetsgegevens · ${d.tested != null ? `${count(d.tested)} leerlingen getoetst (${EDU_YEARS_TEXT})` : EDU_YEARS_TEXT}</span></p>`);
    parts.push(`<p class="edu-po-levels">${pct(d.fundPct)} haalt ten minste 1F · ${pct(d.streefPct)} haalt 2F/1S</p>`);
  } else {
    parts.push(`<p>Geen basisschool met toetsgegevens ${where}.</p>`);
  }
  if (d.list?.length) parts.push(`<details class="edu-po-list"${d.list.length <= 8 ? ' open' : ''}><summary>Basisscholen ${where} (${d.list.length})</summary>${listHtml(d.list)}</details>`);
  if (d.level === 'buurt') {
    if (d.nearScore != null) parts.push(`<p class="edu-po-near-score">Kwaliteit dichtbij (binnen ${nlNum(EDU_RADIUS_KM, 1)} km, dichterbij telt zwaarder): <strong>${formatGrade(d.nearScore)}</strong></p>`);
    if (d.near) {
      parts.push(`<h4 class="edu-po-sub">Basisscholen binnen ${nlNum(EDU_NEAR_KM, 0)} km</h4>`);
      parts.push(d.near.length ? listHtml(d.near, { km: true }) : `<p>Geen basisschool binnen ${nlNum(EDU_NEAR_KM, 0)} km.</p>`);
    }
  }
  parts.push('<p class="area-note">De scholen die in het gebied staan, niet waar de kinderen wonen; de achtergrond van de leerlingen bepaalt een groot deel van de score. Afstanden hemelsbreed vanaf het midden van de buurt. Bron: DUO.</p>');
  return `<div class="area-extra area-extra-wide area-edu-po"><span class="area-extra-label">Basisscholen: onderwijsprestatie${info}</span>${parts.join('')}</div>`;
}

// ── Loaders (browser) ────────────────────────────────────────────────────────

const getJSON = async (url, fetcher) => { const r = await fetcher(url); if (!r?.ok) throw new Error(`${url} ${r?.status}`); return r.json(); };

/** A file fetched and decoded once; a failure is forgotten so the next call retries. */
function onceFile(url, decode, onLoad = null) {
  let value = null, promise = null;
  return {
    get: () => value,
    load({ fetcher = globalThis.fetch?.bind(globalThis) } = {}) {
      if (value) return Promise.resolve(value);
      if (!promise) {
        promise = getJSON(url, fetcher).then(j => { value = decode(j); onLoad?.(value); return value; });
        promise.catch(() => { promise = null; });
      }
      return promise;
    },
    set(json) { value = json ? decode(json) : null; promise = null; },
  };
}

const listeners = [];
/** Runs `fn` once the area file lands, before the load promise resolves (app.js joins the values). */
export const onEduLoaded = fn => { listeners.push(fn); };
const areaFile = onceFile(EDU_AREA_URL, decodeEduAreas, data => {
  for (const fn of listeners) { try { fn(data); } catch (err) { console.warn('onderwijs listener:', err); } }
});
const schoolFile = onceFile(EDU_SCHOOLS_URL, decodeSchools);
const centreFile = onceFile(BUURT_CENTRES_URL, decodeCentres);

export const loadEduAreas = opts => areaFile.load(opts);
export const loadEduSchools = opts => schoolFile.load(opts);
export const loadBuurtCentres = opts => centreFile.load(opts);
export const isEduLoaded = () => areaFile.get() != null;
export const getEduEntry = code => areaFile.get()?.get(norm(code)) ?? null;
export const getEduSchools = () => schoolFile.get();
export const getBuurtCentre = code => centreFile.get()?.get(norm(code)) ?? null;

/** Adds the edu columns to wijken/buurten ({ code, values }) in place; no-op until loaded. */
export function addEduValues(areas, data = areaFile.get()) {
  if (!data) return areas;
  for (const a of areas ?? []) {
    if (!/^(WK|BU|GM)/.test(a?.code ?? '')) continue;
    a.values = Object.assign(a.values ?? {}, eduValuesFor(a.code, data));
  }
  return areas;
}

/** Flat gemeente rows ({ regionCode, … }) → new rows with the edu columns; the same rows until loaded. */
export function withEduRows(rows, data = areaFile.get()) {
  if (!data || !Array.isArray(rows)) return rows;
  return rows.map(r => (/^GM/.test(r?.regionCode ?? '') ? { ...r, ...eduValuesFor(r.regionCode, data) } : r));
}

/** Test hook: sets (or clears) the loaded files from their JSON. */
export function _setEduData({ areas = null, schools = null, centres = null } = {}) {
  areaFile.set(areas); schoolFile.set(schools); centreFile.set(centres);
}
