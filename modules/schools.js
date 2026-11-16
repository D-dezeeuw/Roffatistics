// Onderwijsprestatie basisscholen (plan-onderwijsprestatie.md, steps 1-2).
// Pure helpers: parse the DUO referentieniveau and eindscores files, fill the
// suppressed (-1) cells, score each school 0-100 and aggregate per area.
// Used by scripts/build-schools.mjs; no DOM, no fetch.

/** Subjects in DUO's REFERENTIENIVEAU prefix → our key. */
export const SUBJECTS = { TAAL_LV: 'lezen', TAAL_TV: 'taal', REKENEN: 'rekenen' };
export const SUBJECT_KEYS = Object.values(SUBJECTS);
/** Level suffix → bucket. 2F (taal and, rarely, rekenen) and 1S both count as the target level. */
const LEVELS = { LAGER_1F: 'below', '1F': 'f1', '2F': 'top', '1S': 'top' };
export const POINTS = { below: 0, f1: 50, top: 100 };
/** Peiljaren pooled for the school score. */
export const YEARS = [2022, 2023, 2024];
/** Fewer pupils than this (pooled over YEARS) → flagged "klein aantal leerlingen". */
export const SMALL_N = 30;
/** A suppressed cell holds 1-4 pupils; with nothing better to go on we assume 2. */
export const SUPPRESSED_GUESS = 2;
export const SUPPRESSED_MIN = 1;
export const SUPPRESSED_MAX = 4;

const round1 = x => Math.round(x * 10) / 10;

/** Small RFC-4180 CSV parser (quoted fields, doubled quotes, CRLF) → array of objects keyed by the header. */
export function parseCsv(text, sep = ',') {
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
      continue;
    }
    if (c === '"') q = true;
    else if (c === sep) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const [head = [], ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((k, i) => [k.trim(), (r[i] ?? '').trim()])));
}

/** BRIN6 from a DUO results row (INSTELLINGSCODE + 2-digit VESTIGINGSCODE). */
export const brin6 = r => `${r.INSTELLINGSCODE}${String(r.VESTIGINGSCODE).padStart(2, '0')}`;

/** Splits "TAAL_LV_LAGER_1F" → { subject: 'lezen', level: 'below' }; null for anything unknown. */
export function splitLevel(code) {
  const m = /^(TAAL_LV|TAAL_TV|REKENEN)_(LAGER_1F|1F|2F|1S)$/.exec(String(code).trim());
  return m ? { subject: SUBJECTS[m[1]], level: LEVELS[m[2]] } : null;
}

const keepRow = (r, years, type) => r.TYPE_PO === type && years.includes(Number(r.PEILJAAR));

/**
 * Referentieniveau rows → Map brin6 → Map year → { lezen: [cells], taal: [...], rekenen: [...] }.
 * A cell is { level, n } with n = -1 when suppressed. Rows of several tests in one
 * year are pooled (the buckets do not overlap, so they simply add up).
 */
export function parseRefLevels(rows, { years = YEARS, type = 'BO' } = {}) {
  const out = new Map();
  for (const r of rows) {
    if (!keepRow(r, years, type)) continue;
    const lv = splitLevel(r.REFERENTIENIVEAU);
    if (!lv) continue;
    const id = brin6(r), y = Number(r.PEILJAAR);
    if (!out.has(id)) out.set(id, new Map());
    const byYear = out.get(id);
    if (!byYear.has(y)) byYear.set(y, Object.fromEntries(SUBJECT_KEYS.map(s => [s, []])));
    byYear.get(y)[lv.subject].push({ level: lv.level, n: Number(r.AANTAL_LEERLINGEN) });
  }
  return out;
}

/**
 * Eindscores rows → Map brin6 → Map year → pupils in leerjaar 8 (summed over tests),
 * or null when one of those rows is itself suppressed.
 */
export function pupilTotals(rows, { years = YEARS, type = 'BO' } = {}) {
  const out = new Map();
  for (const r of rows) {
    if (!keepRow(r, years, type) || Number(r.LEERJAAR) !== 8) continue;
    const id = brin6(r), y = Number(r.PEILJAAR), n = Number(r.AANTAL_LEERLINGEN);
    if (!out.has(id)) out.set(id, new Map());
    const m = out.get(id);
    const prev = m.has(y) ? m.get(y) : 0;
    m.set(y, prev === null || !(n >= 0) ? null : prev + n);
  }
  return out;
}

/**
 * One subject in one year: cells → { below, f1, top, estimate }.
 * - no suppressed cell: the counts as given;
 * - one suppressed cell and a known total: total minus the rest, exact when that is 1-4
 *   (clamped to 1-4 and flagged otherwise);
 * - several suppressed cells and a known total whose remainder fits (k..4k): the
 *   remainder spread evenly, flagged;
 * - otherwise SUPPRESSED_GUESS (2) per cell, flagged.
 */
export function fillSuppressed(cells, total = null) {
  const out = { below: 0, f1: 0, top: 0, estimate: false };
  const known = cells.filter(c => c.n >= 0), hidden = cells.filter(c => !(c.n >= 0));
  for (const c of known) out[c.level] += c.n;
  if (!hidden.length) return out;
  const k = hidden.length;
  const rest = total != null && total > 0 ? total - known.reduce((s, c) => s + c.n, 0) : null;
  let each;
  if (k === 1 && rest != null && rest >= SUPPRESSED_MIN && rest <= SUPPRESSED_MAX) each = rest;
  else if (k === 1 && rest != null) { each = Math.min(SUPPRESSED_MAX, Math.max(SUPPRESSED_MIN, rest)); out.estimate = true; }
  else if (rest != null && rest >= k * SUPPRESSED_MIN && rest <= k * SUPPRESSED_MAX) { each = rest / k; out.estimate = true; }
  else { each = SUPPRESSED_GUESS; out.estimate = true; }
  for (const c of hidden) out[c.level] += each;
  return out;
}

const pct = (part, all) => (all > 0 ? round1((100 * part) / all) : null);
const emptyCounts = () => ({ below: 0, f1: 0, top: 0 });
const addCounts = (a, b) => { a.below += b.below; a.f1 += b.f1; a.top += b.top; return a; };
const nOf = c => c.below + c.f1 + c.top;

/**
 * One school: Map year → subjects (from parseRefLevels) and Map year → total
 * (from pupilTotals) → its score and shares.
 * score  = mean points over all pupil results (below 1F 0, 1F 50, 2F/1S 100), 0-100;
 * fund   = % of results at 1F or higher; streef = % at 2F/1S; both also per subject;
 * tested = pupils over the years (the leerjaar-8 total, or the largest subject count
 *          when that total is suppressed); small = tested < SMALL_N.
 * `counts` (pooled results) and `perYear` are for aggregation and the build log.
 */
export function schoolScore(byYear, totals = new Map()) {
  const counts = emptyCounts(), perSubject = Object.fromEntries(SUBJECT_KEYS.map(s => [s, emptyCounts()]));
  const perYear = {};
  let tested = 0, estimate = false;
  const years = [...(byYear?.keys() ?? [])].sort();
  for (const y of years) {
    const total = totals.get(y) ?? null;
    let maxN = 0;
    perYear[y] = {};
    for (const s of SUBJECT_KEYS) {
      const cells = byYear.get(y)[s];
      if (!cells.length) continue;
      const f = fillSuppressed(cells, total);
      estimate ||= f.estimate;
      const c = { below: f.below, f1: f.f1, top: f.top };
      perYear[y][s] = c;
      addCounts(perSubject[s], c);
      addCounts(counts, c);
      maxN = Math.max(maxN, nOf(c));
    }
    tested += total != null && total > 0 ? total : maxN;
  }
  const n = nOf(counts);
  if (!n) return null;
  tested = Math.round(tested);
  const points = POINTS.below * counts.below + POINTS.f1 * counts.f1 + POINTS.top * counts.top;
  const subjects = Object.fromEntries(SUBJECT_KEYS.map(s => {
    const c = perSubject[s], m = nOf(c);
    return [s, { fund: pct(c.f1 + c.top, m), streef: pct(c.top, m) }];
  }));
  return {
    score: round1(points / n), fund: pct(counts.f1 + counts.top, n), streef: pct(counts.top, n),
    subjects, tested, small: tested < SMALL_N, estimate, years: years.map(Number), counts, perYear,
  };
}

/** Both files → Map brin6 → schoolScore result (BO only; schools without any result are absent). */
export function scoreSchools(refRows, eindRows, opts = {}) {
  const ref = parseRefLevels(refRows, opts), totals = pupilTotals(eindRows, opts);
  const out = new Map();
  for (const [id, byYear] of ref) {
    const s = schoolScore(byYear, totals.get(id));
    if (s) out.set(id, s);
  }
  return out;
}

/**
 * Area layer. schools: [{ score, tested, counts }] (score null = no results, skipped);
 * areaOf(school) → area code or null. Returns Map code → { eduScore, eduSchools,
 * eduTested, eduFundPct, eduStreefPct }:
 * eduScore = unweighted mean of the school scores (each school counts once);
 * the two percentages are pupil-weighted (all results of all schools pooled).
 */
export function aggregate(schools, areaOf) {
  const acc = new Map();
  for (const s of schools) {
    if (s?.score == null) continue;
    const code = areaOf(s);
    if (!code) continue;
    if (!acc.has(code)) acc.set(code, { sum: 0, schools: 0, tested: 0, counts: emptyCounts() });
    const a = acc.get(code);
    a.sum += s.score; a.schools += 1; a.tested += s.tested ?? 0;
    if (s.counts) addCounts(a.counts, s.counts);
  }
  const out = new Map();
  for (const [code, a] of acc) {
    const n = nOf(a.counts);
    out.set(code, {
      eduScore: round1(a.sum / a.schools), eduSchools: a.schools, eduTested: Math.round(a.tested),
      eduFundPct: pct(a.counts.f1 + a.counts.top, n), eduStreefPct: pct(a.counts.top, n),
    });
  }
  return out;
}

/** Shares over many count objects ({below, f1, top}) → { n, fund, streef } (for the national log line). */
export function shares(countsList) {
  const c = countsList.reduce((a, b) => addCounts(a, b), emptyCounts()), n = nOf(c);
  return { n: Math.round(n), fund: pct(c.f1 + c.top, n), streef: pct(c.top, n) };
}

/** "3-A" / "12a" / "7" → 7 etc.: the house number DUO writes in HUISNUMMER-TOEVOEGING. */
export const houseNumber = s => { const m = /^\s*(\d+)/.exec(String(s ?? '')); return m ? Number(m[1]) : null; };

// ── Schoolkwaliteit dichtbij huis (plan step 5) ──────────────────────────────
/** Radius (km) for the distance-weighted mean and for "best / count nearby". */
export const NEAR_RADIUS_KM = 1.5;
export const NEAR_BEST_KM = 1;

/** Great-circle distance in km between [lat, lon] points. */
export function haversineKm([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Scored schools around one point (a buurt centre, [lat, lon]); schools: [{ lat, lon, score }].
 * eduNearScore = mean score weighted by max(0, 1 - d / 1.5 km) over schools within 1.5 km;
 * eduNearBest = best score within 1 km (null when none); eduNearCount = scored schools within 1 km.
 * All three null when no scored school lies within 1.5 km (or the point is unknown).
 */
export function nearSchools(centre, schools, { radius = NEAR_RADIUS_KM, near = NEAR_BEST_KM } = {}) {
  const none = { eduNearScore: null, eduNearBest: null, eduNearCount: null };
  if (!centre) return none;
  const dLat = radius / 110.574, dLon = radius / (111.32 * Math.cos((centre[0] * Math.PI) / 180));
  let wsum = 0, sum = 0, best = null, count = 0, any = false;
  for (const s of schools) {
    if (s.score == null || s.lat == null || s.lon == null) continue;
    if (Math.abs(s.lat - centre[0]) > dLat || Math.abs(s.lon - centre[1]) > dLon) continue;
    const d = haversineKm(centre, [s.lat, s.lon]);
    if (d > radius) continue;
    any = true;
    const w = Math.max(0, 1 - d / radius);
    wsum += w; sum += w * s.score;
    if (d <= near) { count++; best = best == null ? s.score : Math.max(best, s.score); }
  }
  if (!any) return none;
  // A school exactly on the 1.5 km edge has weight 0; fall back to the plain mean then.
  const score = wsum > 0 ? sum / wsum : null;
  return { eduNearScore: score == null ? null : round1(score), eduNearBest: best, eduNearCount: count };
}

/**
 * Inhabitant-weighted roll-up of per-buurt values: rows [{ code, pop, values: {k: v} }],
 * parentOf(code) → parent code. Returns Map parent → { k: weighted mean (1 decimal) }.
 * Null values and buurten without inhabitants are skipped per key; a key with no weight is null.
 */
export function rollUpByPopulation(rows, parentOf, keys) {
  const acc = new Map();
  for (const { code, pop, values } of rows) {
    const p = parentOf(code);
    if (!p) continue;
    if (!acc.has(p)) acc.set(p, Object.fromEntries(keys.map(k => [k, { w: 0, s: 0 }])));
    if (!(pop > 0)) continue;
    const a = acc.get(p);
    for (const k of keys) if (values?.[k] != null) { a[k].w += pop; a[k].s += pop * values[k]; }
  }
  const out = new Map();
  for (const [p, a] of acc) out.set(p, Object.fromEntries(keys.map(k => [k, a[k].w > 0 ? round1(a[k].s / a[k].w) : null])));
  return out;
}
