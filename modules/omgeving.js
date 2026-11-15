// Omgeving: crime around an area, not only in it (W8, 15 Nov 2026). Pure, no DOM.
//
// A buurt next to a port, an industrial estate or a station area lives with
// the crime registered there, even though that neighbour is no woonwijk and
// gets no Woonscore itself (woongebied.js). "Criminaliteit in de omgeving"
// (crimeNearby) is the pooled crime density of the area and its neighbours:
//
//   crimeNearby = Σ misdrijven / Σ km² land   over the area + its adjacent areas
//
// Neighbours share a stretch of boundary (rook adjacency: at least two shared
// boundary vertices; a corner touch does not count), same level only (buurt
// with buurt, wijk with wijk), non-residential areas included. Pooling by land
// area needs no distance parameter: a large port area with many crimes spread
// over many km² weighs in with its density, a small busy station area with its
// own. Areas without a crime count or land area are left out of both sums.
// Method and alternatives: docs/decisions.md (W8).

import { classifyWoongebied } from './woongebied.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** A neighbour "dominates" the omgeving when it holds at least this share of its misdrijven … */
export const DOMINANT_SHARE = 0.4;
/** … and at least this many times the misdrijven of the next-largest neighbour. */
export const DOMINANT_LEAD = 1.5;

function* rings(geometry) {
  if (!geometry) return;
  if (geometry.type === 'Polygon') yield* geometry.coordinates;
  else if (geometry.type === 'MultiPolygon') for (const poly of geometry.coordinates) yield* poly;
}

/**
 * Shared-boundary neighbours from polygon features (GeoJSON, any CRS).
 * Two areas are neighbours when they share at least `minShared` boundary
 * vertices (CBS wijk/buurt boundaries are topologically consistent, also in
 * the generalised sets: a common border has its end nodes in both polygons).
 * `decimals` rounds coordinates before matching (null = exact).
 * Returns Map(code → sorted neighbour codes); every feature code is a key.
 */
export function adjacencyFromFeatures(features, { codeOf = f => f?.properties?.statcode, decimals = null, minShared = 2 } = {}) {
  const codes = [];
  const byVertex = new Map();
  const key = decimals == null ? (x, y) => `${x},${y}` : (x, y) => `${x.toFixed(decimals)},${y.toFixed(decimals)}`;
  (features ?? []).forEach(f => {
    const code = codeOf(f);
    if (!code) return;
    const i = codes.push(String(code).trim()) - 1;
    const seen = new Set();
    for (const ring of rings(f.geometry)) for (const [x, y] of ring) {
      const k = key(x, y);
      if (seen.has(k)) continue;
      seen.add(k);
      const list = byVertex.get(k);
      if (list) list.push(i); else byVertex.set(k, [i]);
    }
  });
  const pairs = new Map();
  for (const list of byVertex.values()) {
    if (list.length < 2) continue;
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const p = list[a] < list[b] ? list[a] * 1e6 + list[b] : list[b] * 1e6 + list[a];
      pairs.set(p, (pairs.get(p) ?? 0) + 1);
    }
  }
  const out = new Map(codes.map(c => [c, new Set()]));
  for (const [p, n] of pairs) {
    if (n < minShared) continue;
    const a = codes[Math.floor(p / 1e6)], b = codes[p % 1e6];
    if (a === b) continue;
    out.get(a).add(b); out.get(b).add(a);
  }
  return new Map([...out].map(([c, s]) => [c, [...s].sort()]));
}

/**
 * Compact neighbour lists for data/nl/*.json: per area (in `codes` order) the
 * indexes of its neighbours that come later in the list, as base-36 gaps
 * (first gap from the area itself), joined by ','; areas joined by ';'.
 * Each pair is stored once; decodeNeighbours restores both directions.
 */
export function encodeNeighbours(codes, adjacency) {
  const index = new Map(codes.map((c, i) => [c, i]));
  return codes.map((c, i) => {
    const later = (adjacency.get(c) ?? []).map(n => index.get(n)).filter(j => j != null && j > i).sort((a, b) => a - b);
    let prev = i;
    return later.map(j => { const gap = (j - prev).toString(36); prev = j; return gap; }).join(',');
  }).join(';');
}

/** Inverse of encodeNeighbours: Map(code → sorted neighbour codes). */
export function decodeNeighbours(codes, text) {
  const sets = codes.map(() => new Set());
  String(text ?? '').split(';').forEach((row, i) => {
    if (!row || i >= codes.length) return;
    let j = i;
    for (const gap of row.split(',')) {
      j += parseInt(gap, 36);
      if (!(j < codes.length)) break;
      sets[i].add(j); sets[j].add(i);
    }
  });
  return new Map(codes.map((c, i) => [c, [...sets[i]].map(j => codes[j]).sort()]));
}

/** Misdrijven per km² land (1 decimal), or null without a count or a land area. */
export function crimePerKm2(crimes, landKm2) {
  return isNum(crimes) && isNum(landKm2) && landKm2 > 0 ? +(crimes / landKm2).toFixed(1) : null;
}

/**
 * New areas with `neighbours` (codes, same list only) and two values:
 * crimeDensity (own misdrijven per km² land) and crimeNearby (pooled over the
 * area and its neighbours). crimeNearby is null when the area itself has no
 * land area or `adjacency` is missing (no neighbour data: no omgeving rather
 * than the own density under another name); neighbours without data drop out
 * of both sums.
 */
export function addOmgeving(areas, adjacency) {
  const list = areas ?? [];
  const byCode = new Map(list.map(a => [a.code, a]));
  return list.map(a => {
    const neighbours = (adjacency?.get(a.code) ?? []).filter(c => byCode.has(c) && c !== a.code);
    const v = a.values ?? {};
    let crimes = 0, land = 0, n = 0;
    for (const m of [a, ...neighbours.map(c => byCode.get(c))]) {
      const mv = m.values ?? {};
      if (isNum(mv.totalCrimes) && isNum(mv.landArea) && mv.landArea > 0) { crimes += mv.totalCrimes; land += mv.landArea; n++; }
    }
    const own = isNum(v.landArea) && v.landArea > 0;
    return {
      ...a, neighbours,
      values: { ...v, crimeDensity: crimePerKm2(v.totalCrimes, v.landArea), crimeNearby: adjacency && own && n ? crimePerKm2(crimes, land) : null },
    };
  });
}

/**
 * What the modal says about the omgeving of `area` among `list` (same level):
 * { value, own, crimes, land, members: [{ code, name, crimes, land, share, self }],
 *   neighbours: n, dominant: member|null }, or null without crimeNearby.
 * `dominant` is the neighbour with the most misdrijven when it holds at least
 * DOMINANT_SHARE of the pooled total, DOMINANT_LEAD × the next neighbour, and
 * its density is above the area's own (it pulls the omgeving up).
 */
export function omgevingDetail(area, list) {
  const v = area?.values ?? {};
  if (!isNum(v.crimeNearby)) return null;
  const byCode = new Map((list ?? []).map(a => [a.code, a]));
  const members = [];
  for (const m of [area, ...(area.neighbours ?? []).map(c => byCode.get(c)).filter(Boolean)]) {
    const mv = m.values ?? {};
    if (!isNum(mv.totalCrimes) || !isNum(mv.landArea) || !(mv.landArea > 0)) continue;
    members.push({ code: m.code, name: m.name ?? m.code, crimes: mv.totalCrimes, land: mv.landArea, density: crimePerKm2(mv.totalCrimes, mv.landArea), self: m === area, values: mv });
  }
  const crimes = members.reduce((s, m) => s + m.crimes, 0);
  const land = members.reduce((s, m) => s + m.land, 0);
  for (const m of members) m.share = crimes > 0 ? m.crimes / crimes : 0;
  const others = members.filter(m => !m.self).sort((a, b) => b.crimes - a.crimes);
  const top = others[0], next = others[1];
  const ownDensity = isNum(v.crimeDensity) ? v.crimeDensity : 0;
  const dominant = top && top.share >= DOMINANT_SHARE && (!next || top.crimes >= DOMINANT_LEAD * next.crimes) && top.density > ownDensity ? top : null;
  return { value: v.crimeNearby, own: isNum(v.crimeDensity) ? v.crimeDensity : null, crimes, land, members, neighbours: (area.neighbours ?? []).length, dominant };
}

const nlNum = (v, d = 0) => v.toLocaleString('nl-NL', { minimumFractionDigits: d, maximumFractionDigits: d });
const km2 = v => nlNum(v, v < 10 ? 2 : 1);

/** "het naastgelegen bedrijven-/havengebied" / "de naastgelegen buurt" for a member of omgevingDetail. */
export function neighbourPhrase(member, level = 'buurt') {
  const kind = classifyWoongebied(member?.values, member?.code).kind;
  if (kind === 'bedrijven') return 'het naastgelegen bedrijven-/havengebied';
  if (kind === 'overig') return 'het naastgelegen recreatie- of voorzieningengebied';
  if (kind === 'onbewoond') return 'het naastgelegen vrijwel onbewoonde gebied';
  return `de naastgelegen ${level === 'wijk' ? 'wijk' : 'buurt'}`;
}

/**
 * The modal's sentences about an omgevingDetail(): { text, why } (plain text;
 * `why` names the dominant neighbour, else null). `name` = the area's name.
 */
export function omgevingText(detail, { level = 'buurt', name = 'dit gebied' } = {}) {
  if (!detail) return null;
  const plural = level === 'wijk' ? 'wijken' : 'buurten';
  const n = detail.members.length - (detail.members.some(m => m.self) ? 1 : 0);
  const around = n ? `${name} en ${n === 1 ? `de aangrenzende ${level === 'wijk' ? 'wijk' : 'buurt'}` : `de ${n} aangrenzende ${plural}`} samen` : `${name} (geen aangrenzende ${plural} met cijfers)`;
  const own = detail.own != null ? `; in ${name} zelf ${nlNum(detail.own)} per km²` : '';
  const text = `${nlNum(detail.value)} misdrijven per km² land in ${around} (${nlNum(detail.crimes)} misdrijven op ${km2(detail.land)} km²)${own}.`;
  const d = detail.dominant;
  const why = d ? `Hoger dan in ${name} zelf, o.a. door ${neighbourPhrase(d, level)} ${d.name} (${nlNum(d.crimes)} misdrijven, ${nlNum(Math.round(d.share * 100))}% van het totaal).` : null;
  return { text, why };
}

/**
 * Why a crime count has no per-1.000 rate (port, business or empty areas, or
 * just too few inwoners): the count, the density and the reason, as one plain
 * sentence; null when the rate exists or there is no count. `min` = the
 * inwoners threshold of the rate (areas.js CRIME_MIN_POPULATION[_BUURT]).
 */
export function crimeNoRateNote(values, level = 'buurt', min = level === 'wijk' ? 1000 : 200) {
  const v = values ?? {};
  if (!isNum(v.totalCrimes) || isNum(v.crimeRate)) return null;
  const dens = isNum(v.crimeDensity) ? ` (${nlNum(v.crimeDensity)} per km² land)` : '';
  const pop = isNum(v.population) ? `met ${nlNum(v.population)} inwoners` : 'zonder bekend aantal inwoners';
  return `${nlNum(v.totalCrimes)} misdrijven in 2025${dens}. Geen cijfer per 1.000 inwoners: ${pop} zegt dat niets (pas vanaf ${nlNum(min)} inwoners per ${level === 'wijk' ? 'wijk' : 'buurt'}), daarom het aantal en per km².`;
}
