// "Vind jouw ideale woonplek" (docs/plan-woonscore.md §4, Epic W3): the
// wizard's answers, the preset they produce and their compact form in the URL
// hash (#score=…) and localStorage. Pure: no DOM. modules/wizard.js is the UI.
//
// Every step is optional; a skipped step leaves the Standaard weights alone,
// so the empty answers give exactly the Standaard preset.
//
// A step is one entry in STEPS plus one entry in APPLY (answers → preset
// changes) and one hash segment. Step 6 "Gemeenschap" (§5, Epic W4) is an
// opt-in, positive-only attraction to one CBS origin group: it can only add
// a `higher` factor on that group's share, never score any group down.
// v0.23.0 adds a detailed origin group for gemeenten (85458NED, see
// herkomst-gemeente.js), the opt-in step "Jouw situatie" (opleiding and, since
// v0.26.0, an income slider → positive "vergelijkbare situatie" factors) and a 5-step
// importance scale per theme (IMPORTANCE, hash segment `i`).
// v0.26.0: Gemeenschap is one detailed group (Nederland included, the broad
// groups are gone); nothing sensitive goes into a link unless the user ticks
// it in "Deellink maken" (shareableAnswers / shareableScore).
import { STANDAARD, GELIJK, THEME_LABELS, ORIGIN_KEYS, PROFILES, PROFILE_THEMES, profileThemes } from './presets.js';
import { DETAIL_GROUPS } from './herkomst-gemeente.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * Wizard v2 (docs/plan-wizard-v2.md, v0.46.0): five UI steps, only the first
 * required. STEP_PARTS names the answer parts each step shows; Veiligheid
 * (crime chips) and Bouwstijl moved to the result screen ("Bijstellen").
 * The step appliers keep their own order (APPLY_ORDER): the answers and the
 * hash did not change, only where the UI asks them.
 */
export const STEPS = Object.freeze(['levensfase', 'budget', 'vervoer', 'buurt', 'buren']);
export const STEP_PARTS = Object.freeze({
  levensfase: Object.freeze(['levensfase']),
  budget: Object.freeze(['budget']),
  vervoer: Object.freeze(['vervoer', 'dichtbij']),     // the OV chip (with old Dichtbij `ov`) and Treinstation
  buurt: Object.freeze(['sfeer', 'dichtbij']),         // Sfeer plus BUURT_DICHTBIJ, prefilled from the profile
  buren: Object.freeze(['situatie', 'gemeenschap']),   // "Waar voel je je thuis?"
});
/** Answer parts on the result screen ("Bijstellen"): crime chips under Veiligheid, Bouwstijl under Extra wensen. */
export const RESULT_PARTS = Object.freeze(['veiligheid', 'bouw']);
/** The step appliers (APPLY) in the order they run; Gemeenschap runs last, after the slider overrides. */
export const APPLY_ORDER = Object.freeze(['levensfase', 'budget', 'vervoer', 'sfeer', 'dichtbij', 'veiligheid', 'situatie', 'gemeenschap']);

/**
 * "Wat wil je dichtbij?" (v0.35): per item an importance level 0–4
 * (DICHTBIJ_LEVELS; 0 = maakt niet uit = not used). Each item adds its CBS
 * distances to the theme Dichtbij as `lower` (closer = better), never a
 * minus weight. Complements Sfeer (drukte ↔ rustig), which it leaves alone.
 * `code`: stable hash letter; `metrics`: [key, share inside the item, factor name].
 * Green and nature are the 2017 CBS distances (areas.js GROEN_TABLE).
 */
export const DICHTBIJ = Object.freeze({
  uitgaan: Object.freeze({ label: 'Cafés en uitgaan',  hint: 'café, kroeg', code: 'c', metrics: Object.freeze([['distCafe', 1, 'Nabijheid cafés']]) }),
  station: Object.freeze({ label: 'Treinstation',      hint: 'alle treinstations', code: 't', metrics: Object.freeze([['distStation', 1, 'Nabijheid treinstation']]) }),
  winkels: Object.freeze({ label: 'Winkels',           hint: 'grote supermarkt, warenhuis', code: 'w', metrics: Object.freeze([['distSupermarket', 1, 'Nabijheid supermarkt'], ['distWarenhuis', 1, 'Nabijheid warenhuis']]) }),
  cultuur: Object.freeze({ label: 'Cultuur en uitjes', hint: 'bioscoop, theater of podium, attractie', code: 'k', metrics: Object.freeze([['distBioscoop', 1, 'Nabijheid bioscoop'], ['distPodium', 1, 'Nabijheid theater/podium'], ['distAttractie', 1, 'Nabijheid attractie']]) }),
  park:    Object.freeze({ label: 'Park of groen om de hoek', hint: 'park, plantsoen, recreatiegebied', code: 'p', metrics: Object.freeze([['distGroen', 2, 'Nabijheid park/groen'], ['distRecreatie', 1, 'Nabijheid recreatiegebied']]) }),
  ov:      Object.freeze({ label: 'Metro of tram',     hint: 'dichtstbijzijnde metro- of tramhalte', code: 'o', metrics: Object.freeze([['distOvHalte', 1, 'Nabijheid metro/tram']]) }),
  natuur:  Object.freeze({ label: 'Bos en natuur',     hint: 'bos, heide, duinen (zoals het Kralingse Bos)', code: 'n', metrics: Object.freeze([['distBos', 2, 'Nabijheid bos'], ['distOpenNatuur', 1, 'Nabijheid open natuur']]) }),
});
export const DICHTBIJ_LEVELS = Object.freeze(['Maakt niet uit', 'Beetje', 'Gemiddeld', 'Belangrijk', 'Heel belangrijk']);
/** Theme weight per importance step, summed over the items and capped (one item on "Heel belangrijk" = 20, as Sfeer). */
export const DICHTBIJ_PER_LEVEL = 5;
export const DICHTBIJ_MAX_WEIGHT = 40;
export const DICHTBIJ_KEYS = Object.freeze([...new Set(Object.values(DICHTBIJ).flatMap(i => i.metrics.map(([k]) => k)))]);

/** { item: 1–4 } with only known items and levels above 0, or null when nothing is chosen. */
export function normalizeDichtbij(d) {
  if (!d || typeof d !== 'object') return null;
  const out = {};
  for (const k of Object.keys(DICHTBIJ)) {
    const v = d[k];
    if (isNum(v) && Math.round(v) > 0) out[k] = Math.min(Math.round(v), DICHTBIJ_LEVELS.length - 1);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Old broad groups (hash letter after `g`, before v0.26.0). Only read, never
 * written: Nederland maps to the detailed group Nederland, Europa and Buiten
 * Europa to no group (a broad group is no longer offered).
 */
const OLD_BROAD = Object.freeze({ d: 'nederland', e: null, b: null });
/** Gemeenschap weight as a share (%) of the total weight: default modest, never above the cap. */
export const GEMEENSCHAP_DEFAULT_PCT = 20;   // 10 → 20 (addendum 16 Nov 2026)
export const GEMEENSCHAP_MIN_PCT = 5;
export const GEMEENSCHAP_MAX_PCT = 30;
export const GEMEENSCHAP_LABEL = 'Eigen gemeenschap dichtbij';   // v0.46.0 (was Nabijheid gemeenschap)
/** The groups of the step (herkomst-gemeente.js; Nederland first); re-exported for the UI. */
export { DETAIL_GROUPS };

/**
 * The Gemeenschap dropdown in sections (v0.28.0): [[title, [[key, group]…]]…].
 * Countries and groups first, then the world regions (gemeente only). Every
 * entry is still one opt-in, positive-only group; the default stays "Geen specifieke groep".
 */
export function gemeenschapOptgroups(groups = DETAIL_GROUPS) {
  const all = Object.entries(groups);
  return [
    ['Landen en groepen', all.filter(([, d]) => !d.region)],
    ['Wereldregio’s', all.filter(([, d]) => d.region)],
  ].filter(([, l]) => l.length);
}

/**
 * "Jouw situatie" (v0.23.0, opt-in; two sliders since v0.26.0): opleiding →
 * attraction to areas with more people of that level; huishoudinkomen →
 * closeness of the area's average standardised income to yours (a target),
 * and at the lowest stops bijstand per 1.000 as a plus. Positive-only, like
 * Gemeenschap. Slider order = object order; `code` is the stable hash code.
 * Keys laag/middelbaar/hoog and codes l/m/h are the v0.23.0 ones (old hashes
 * decode to the same metric); basisschool is new and also counts as lowEdu
 * (CBS groups basisonderwijs, vmbo and mbo-1 together).
 */
export const SITUATIE_EDU = Object.freeze({
  basis:      Object.freeze({ label: 'Basisschool',        short: 'basisschool',        key: 'lowEdu',  code: 'p' }),
  laag:       Object.freeze({ label: 'vmbo – mbo-1',       short: 'vmbo–mbo-1',         key: 'lowEdu',  code: 'l' }),
  middelbaar: Object.freeze({ label: 'havo – vwo – mbo-4', short: 'havo–vwo–mbo-4',     key: 'medEdu',  code: 'm' }),
  hoog:       Object.freeze({ label: 'hbo – wo',           short: 'hbo–wo',             key: 'highEdu', code: 'h' }),
});
/**
 * Huishoudinkomen per maand (netto, ongeveer) → a target on avgIncome, the CBS
 * "gemiddeld gestandaardiseerd inkomen" in ×€1.000 per year. Rough rule:
 * yearly standardised ≈ monthly × 12 / INCOME_EQUIV_FACTOR / 1000, where 1.3
 * is about the equivalence factor of an average household (CBS divides
 * household income by it). The ideal is clamped to INCOME_IDEAL_MIN–MAX, the
 * range of area averages (1st–99th percentile of buurten ≈ 25–99), so the
 * low and high stops still rank areas instead of scoring all of them 0.
 * `welfare`: the stop also counts bijstand per 1.000 inwoners as a plus.
 * `code`: the stable hash digit.
 */
export const SITUATIE_INCOME = Object.freeze({
  bijstand: Object.freeze({ label: 'Bijstand',           short: 'bijstand',      monthly: 1400,  code: '0', welfare: true }),
  m500:     Object.freeze({ label: '± € 500',            short: '± €500/mnd',    monthly: 500,   code: '1', welfare: true }),
  m2500:    Object.freeze({ label: '± € 2.500',          short: '± €2.500/mnd',  monthly: 2500,  code: '2' }),
  m5000:    Object.freeze({ label: '± € 5.000',          short: '± €5.000/mnd',  monthly: 5000,  code: '3' }),
  m7500:    Object.freeze({ label: '± € 7.500',          short: '± €7.500/mnd',  monthly: 7500,  code: '4' }),
  m10000:   Object.freeze({ label: '± € 10.000',         short: '± €10.000/mnd', monthly: 10000, code: '5' }),
  m15000:   Object.freeze({ label: '± € 15.000',         short: '± €15.000/mnd', monthly: 15000, code: '6' }),
  m30000:   Object.freeze({ label: '± € 30.000',         short: '± €30.000/mnd', monthly: 30000, code: '7' }),
  hoger:    Object.freeze({ label: 'Meer dan € 30.000',  short: '> €30.000/mnd', monthly: 45000, code: '8' }),
});
export const INCOME_EQUIV_FACTOR = 1.3;
export const INCOME_IDEAL_MIN = 22;
export const INCOME_IDEAL_MAX = 120;
/** Tolerance in log1p units: the factor is 1 at the ideal and 0 beyond ±0.6 (about ×/÷ 1.8). */
export const INCOME_TOLERANCE_LOG = 0.3;
/** Monthly net household income (€) → yearly standardised income (×€1.000), unclamped. */
export const monthlyToStandardisedK = monthly => (monthly * 12) / INCOME_EQUIV_FACTOR / 1000;
/** The avgIncome target of an income band, or null for an unknown band. */
export function incomeTarget(band) {
  const b = SITUATIE_INCOME[band];
  if (!b) return null;
  const ideal = Math.round(clamp(monthlyToStandardisedK(b.monthly), INCOME_IDEAL_MIN, INCOME_IDEAL_MAX) * 10) / 10;
  return { ideal, tolerance: INCOME_TOLERANCE_LOG, log: true };
}
export const SITUATIE_LABEL = 'Vergelijkbare buren';   // v0.46.0 (was Mensen in een vergelijkbare situatie)
/** The metrics the Situatie theme may hold as `higher`; avgIncome only as the income target. */
export const SITUATIE_KEYS = Object.freeze(['lowEdu', 'medEdu', 'highEdu', 'welfarePer1000']);
export const SITUATIE_TARGET_KEY = 'avgIncome';

/**
 * The 5-step importance scale per theme: level 0–4 → factor × the theme
 * weight the answers give (Standaard weight for the five base themes).
 * 0 = "Niet belangrijk" drops the theme.
 */
export const IMPORTANCE = Object.freeze([
  Object.freeze({ label: 'Niet belangrijk', factor: 0 }),
  Object.freeze({ label: 'Beetje',          factor: 0.5 }),
  Object.freeze({ label: 'Gemiddeld',       factor: 1 }),
  Object.freeze({ label: 'Belangrijk',      factor: 1.5 }),
  Object.freeze({ label: 'Heel belangrijk', factor: 2 }),
]);
export const IMPORTANCE_DEFAULT = 2;
/** Gemeenschap keeps its weight as % of the total: importance level → pct (0 = off). */
export const GEMEENSCHAP_LEVEL_PCT = Object.freeze([0, 5, 10, 20, 30]);
const nearest = (list, v) => list.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(list[best] - v) ? i : best), 0);
/** Importance level for a weight ratio (weight / base weight). */
export function importanceFromRatio(r) { return isNum(r) ? nearest(IMPORTANCE.map(l => l.factor), r) : IMPORTANCE_DEFAULT; }
/** Importance level (1–4) of a Gemeenschap pct. */
export function gemeenschapLevel(pct) { return Math.max(1, nearest(GEMEENSCHAP_LEVEL_PCT, pct)); }

/**
 * Levenstype (v0.30; was "Levensfase"): how you like to live, not a life stage.
 * The answer field, step key and hash letter stay `levensfase` / `l` so stored
 * answers and old links keep working. Solo options are worded as equal choices.
 */
// v0.46.0: Student and Starter are separate; Nieuwkomer is new. Order = the cards, by life course.
export const LEVENSTYPEN = Object.freeze({
  student: 'Student',
  starter: 'Starter (werkt, eerste huis)',
  stel:    'Stel',
  gezin:   'Gezin met kinderen',
  nieuwkomer: 'Nieuwkomer in Nederland',
  '50plus': '50-plusser',
  senior:  'Senior',
  soloMensen: 'Solo, graag onder de mensen',
  soloRust:   'Solo, graag op mezelf',
});
/** Helper line under the Levenstype options. */
export const LEVENSTYPE_HINT = 'Het gaat om hoe je graag woont, niet om relaties of plannen. Solo onder de mensen: levendig, dichter bij het centrum, horeca om de hoek. Solo op jezelf: rustig, ruimte en water in de buurt. Elke keuze geeft alleen pluspunten.';
/** One line per profile card (wizard v2), under the label. */
export const LEVENSTYPE_LINES = Object.freeze({
  student:    'Studeert, graag midden in de drukte.',
  starter:    'Werkt, zoekt een eerste huis met OV dichtbij.',
  stel:       'Samen, graag wat te doen in de buurt.',
  gezin:      'Kinderen, met school en groen dichtbij.',
  nieuwkomer: 'Net in Nederland: winkels, OV en huisarts dichtbij.',
  '50plus':   'Huisarts en winkels dichtbij, wat rustiger.',
  senior:     'Voorzieningen om de hoek, veilig op straat.',
  soloMensen: 'Alleen, graag levendig en dicht bij het centrum.',
  soloRust:   'Alleen, graag rustig met groen en water.',
});
/** Plan-wizard-v2 hint for Nieuwkomer (also part of its LEVENSTYPE_HINTS line and the Buren step). */
export const NIEUWKOMER_HINT = 'Net in Nederland? Een gemeenschap van mensen met dezelfde achtergrond dichtbij kan veel steun geven; kies bij ‘Waar voel je je thuis?’ eventueel je herkomst.';
/** One line per levenstype naming its starting weights (presets.js PROFILES), shown once one is chosen. */
export const LEVENSTYPE_HINTS = Object.freeze({
  student:    'Student: sfeer en uitgaan zwaar, veiligheid licht; welvaart, opleiding en woningmarkt tellen niet mee. Je kunt alles bijstellen.',
  starter:    'Starter (werkt, eerste huis): voorzieningen het zwaarst (station, OV en supermarkt dichtbij), dan een levendige buurt en veiligheid. Je kunt alles bijstellen.',
  stel:       'Stel (jong stel, graag wat te doen): veiligheid, voorzieningen en een levendige buurt wegen het zwaarst. Je kunt alles bijstellen.',
  gezin:      'Gezin: veiligheid en voorzieningen zwaar, met goede basisscholen en kinderopvang dichtbij; een rustige buurt telt licht. Je kunt alles bijstellen.',
  nieuwkomer: `Nieuwkomer in Nederland: voorzieningen het zwaarst (supermarkt, OV en huisarts dichtbij), dan veiligheid. ${NIEUWKOMER_HINT} Je kunt alles bijstellen.`,
  '50plus':   '50-plusser: veiligheid en voorzieningen zwaar, huisarts en supermarkt dichtbij, een rustige buurt telt mee. Je kunt alles bijstellen.',
  senior:     'Senior: voorzieningen het zwaarst (huisarts, supermarkt, OV), dan veiligheid op straat; woningmarkt telt niet mee. Je kunt alles bijstellen.',
  soloMensen: 'Solo onder de mensen: sfeer zwaar (druk, horeca, centrum dichtbij), veiligheid wat lichter. Je kunt alles bijstellen.',
  soloRust:   'Solo op mezelf: veiligheid zwaar, een rustige buurt met groen en water in de buurt. Je kunt alles bijstellen.',
});
/** Hint lines of the opt-in steps (addendum 16 Nov 2026). */
// v0.46.0 wording (operator): step 5 "Waar voel je je thuis?", no pressure, easy to skip.
export const BUREN_TITLE = 'Waar voel je je thuis? (optioneel)';
export const BUREN_INTRO = 'Sommige mensen wonen graag tussen buren met een vergelijkbaar leven, of dicht bij hun eigen gemeenschap. Sla dit over als het voor jou niet uitmaakt.';
export const SITUATIE_HEADING = 'Buren met een vergelijkbaar inkomen of opleiding';
export const SITUATIE_HINT = 'Kies je eigen inkomen of opleiding; buurten waar veel mensen in dezelfde situatie wonen, scoren hoger.';
export const GEMEENSCHAP_HEADING = 'Dicht bij je eigen gemeenschap';
export const GEMEENSCHAP_HINT = 'Woon je graag dicht bij mensen met dezelfde achtergrond, bijvoorbeeld voor je taal, winkels, een gebedshuis of familie? Buurten met een grote gemeenschap van jouw achtergrond krijgen extra punten; andere buurten verliezen niets.';
/** @deprecated name before v0.30; same object. */
export const LEVENSFASEN = LEVENSTYPEN;
/** Bouwstijl (v0.29.0): older buildings with character or modern dwellings. Replaces the v0.21 "oud" question. */
export const BOUW_OPTIONS = Object.freeze({ karakter: 'Oudere bouw met karakter', modern: 'Moderne woningen' });
export const VERVOER = Object.freeze({ fiets: 'Fiets', ov: 'OV', auto: 'Auto', lopen: 'Lopen' });
/** Veiligheid chips → crime dataset. */
export const CRIMES = Object.freeze({
  inbraak:   { label: 'Inbraak',         key: 'crimeBurglary' },
  geweld:    { label: 'Geweld',          key: 'crimeViolence' },
  straatroof:{ label: 'Straatroof',      key: 'crimeStreetRobbery' },
  fiets:     { label: 'Fietsendiefstal', key: 'crimeBike' },
  auto:      { label: 'Autodiefstal',    key: 'crimeVehicle' },
  vandalisme:{ label: 'Vandalisme',      key: 'crimeVandalism' },
  drugs:     { label: 'Drugsoverlast',   key: 'crimeDrugs' },
  omgeving:  { label: 'Criminaliteit in de omgeving', key: 'crimeNearby' },
});

/** Rough rule shown in the UI: a mortgage of about 4.5 × the gross household income. */
export const INCOME_FACTOR = 4.5;
/** WOZ target around the budget: ideal = 0.85 × ceiling, sd = 0.3 × ceiling (0 below 0.25× and above 1.45×). */
export const WOZ_IDEAL_SHARE = 0.85;
export const WOZ_TOLERANCE_SHARE = 0.3;
/** "Verberg duidelijk te duur": WOZ above 1.2 × the ceiling. */
export const TOO_EXPENSIVE_SHARE = 1.2;

/**
 * Extra themes (weight) the steps can add next to the levenstype profile
 * (v0.45.0: Levenstype and the profile's Sfeer come from presets.js PROFILES;
 * `sfeer` is the weight of an answered Sfeer step when the profile has none).
 */
export const EXTRA_THEME_WEIGHTS = Object.freeze({ nieuwbouw: 5, budget: 20, sfeer: 20, situatie: 30 });
/** Importance base of a theme whose profile weight is 0 (Woningmarkt, a student's Welvaart): Gemiddeld = 10. */
export const NOMINAL_BASE = 10;
/** Sfeer theme weight when only "auto" asks for a quieter area. */
export const AUTO_SFEER_WEIGHT = 8;
/** Share inside a theme for a metric the answers stress (Standaard metrics have 1). */
export const STRESS_W = 3;

export const EMPTY_ANSWERS = Object.freeze({
  levensfase: null, bouw: null, budget: null, vervoer: Object.freeze([]), sfeer: null, veiligheid: Object.freeze([]), weights: Object.freeze({}),
  gemeenschap: null, situatie: null, importance: Object.freeze({}), dichtbij: null,
});

/**
 * { detail, pct } or null. Anything that is not one known group with a
 * positive weight is dropped (null = off, "Geen specifieke groep"); the weight
 * is clamped to GEMEENSCHAP_MIN_PCT–GEMEENSCHAP_MAX_PCT, so a zero, negative or
 * huge weight can never come through. There is no direction field: the factor
 * is `higher`. An old broad `group: 'nederland'` becomes the group Nederland;
 * the old broad Europa / Buiten Europa give no group.
 */
export function normalizeGemeenschap(g) {
  if (!g || typeof g !== 'object') return null;
  const detail = Object.hasOwn(DETAIL_GROUPS, g.detail) ? g.detail : g.group === 'nederland' ? 'nederland' : null;
  if (!detail) return null;
  const raw = g.pct == null ? GEMEENSCHAP_DEFAULT_PCT : g.pct;
  if (!isNum(raw) || raw <= 0) return null;
  return { detail, pct: Math.round(clamp(raw, GEMEENSCHAP_MIN_PCT, GEMEENSCHAP_MAX_PCT)) };
}

/**
 * { edu, income } or null (nothing chosen). Only known level and band
 * keys. The v0.23.0 field `bijstand: true` (no longer in the model) becomes
 * the income band "bijstand" when no band is set.
 */
export function normalizeSituatie(s) {
  if (!s || typeof s !== 'object') return null;
  const edu = Object.hasOwn(SITUATIE_EDU, s.edu) ? s.edu : null;
  const income = Object.hasOwn(SITUATIE_INCOME, s.income) ? s.income : s.bijstand === true ? 'bijstand' : null;
  if (!edu && !income) return null;
  return { edu, income };
}

/** Cleans any answers-like object into the canonical shape (unknown values dropped). */
export function normalizeAnswers(a = {}) {
  const pick = (list, allowed) => [...new Set((Array.isArray(list) ? list : []).filter(v => Object.hasOwn(allowed, v)))].sort((x, y) => Object.keys(allowed).indexOf(x) - Object.keys(allowed).indexOf(y));
  const b = a?.budget;
  let budget = null;
  if (b && (b.mode === 'huur' || b.mode === 'koop')) {
    const income = isNum(b.income) && b.income > 0 ? Math.round(clamp(b.income, 1, 999)) : null;
    const maxPrice = isNum(b.maxPrice) && b.maxPrice > 0 ? Math.round(clamp(b.maxPrice, 1, 9999)) : null;
    budget = { mode: b.mode, income, maxPrice, hide: !!b.hide && b.mode === 'koop' && (income != null || maxPrice != null) };
  }
  const weights = {};
  for (const [k, v] of Object.entries(a?.weights ?? {})) if (Object.hasOwn(THEME_LABELS, k) && k !== 'gemeenschap' && isNum(v)) weights[k] = Math.round(clamp(v, 0, 100));
  const importance = {};
  for (const [k, v] of Object.entries(a?.importance ?? {})) if (Object.hasOwn(THEME_LABELS, k) && k !== 'gemeenschap' && isNum(v)) importance[k] = Math.round(clamp(v, 0, IMPORTANCE.length - 1));
  return {
    levensfase: Object.hasOwn(LEVENSTYPEN, a?.levensfase) ? a.levensfase : null,
    // v0.21–0.28 stored `oud`: 'gebouwen' (nieuwe woningen) becomes modern; 'bewoners' (jonge bewoners) is gone.
    bouw: Object.hasOwn(BOUW_OPTIONS, a?.bouw) ? a.bouw : a?.oud === 'gebouwen' ? 'modern' : null,
    budget,
    vervoer: pick(a?.vervoer, VERVOER),
    sfeer: isNum(a?.sfeer) ? Math.round(clamp(a.sfeer, 0, 100)) : null,
    veiligheid: pick(a?.veiligheid, CRIMES),
    weights,
    gemeenschap: normalizeGemeenschap(a?.gemeenschap),
    situatie: normalizeSituatie(a?.situatie),
    importance,
    dichtbij: normalizeDichtbij(a?.dichtbij),
  };
}

/** True when no step was answered and no theme weight was moved (= Standaard). */
export function isEmptyAnswers(a) {
  const n = normalizeAnswers(a);
  return !n.levensfase && !n.bouw && !n.budget && !n.vervoer.length && n.sfeer == null && !n.veiligheid.length && !Object.keys(n.weights).length && !n.gemeenschap && !n.situatie && !Object.keys(n.importance).length && !n.dichtbij;
}

/** Koop budget ceiling in ×€1.000 (the WOZ unit): max price, else income × 4.5; null otherwise. */
export function budgetCeiling(budget) {
  if (!budget || budget.mode !== 'koop') return null;
  if (isNum(budget.maxPrice) && budget.maxPrice > 0) return budget.maxPrice;
  if (isNum(budget.income) && budget.income > 0) return budget.income * INCOME_FACTOR;
  return null;
}

/**
 * A typed amount in euros → ×€1.000 (the WOZ and income unit), or null.
 * Dots, spaces and '€' are ignored ("60.000", "€ 350 000"); a value below
 * 1.000 is read as already in thousands ("60" → 60). A comma ends the number.
 */
export function parseEuroK(text) {
  const digits = String(text ?? '').split(',')[0].replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  if (!(n > 0)) return null;
  return n >= 1000 ? Math.round(n / 1000) : n;
}

// ── answers → preset ─────────────────────────────────────────────────────────

/** Working copy of a preset: themes keyed, metrics keyed, mutable. */
function draft() {
  const themes = new Map(profileDraft('standaard'));
  return { themes, targets: {}, filters: [] };
}
function theme(d, key, weight) {
  if (!d.themes.has(key)) d.themes.set(key, { key, label: THEME_LABELS[key] ?? key, weight, metrics: new Map() });
  return d.themes.get(key);
}
/** Adds or stresses a metric in a theme; `w` only ever goes up (two reasons do not multiply). */
function metric(d, themeKey, key, pref, w = 1, themeWeight = 0) {
  const t = theme(d, themeKey, themeWeight);
  const m = t.metrics.get(key);
  if (m) { m.pref = pref; if (w > (m.w ?? 1)) m.w = w; }
  else t.metrics.set(key, w === 1 ? { key, pref } : { key, pref, w });
}

/** Draft themes of a profile (presets.js PROFILES), mutable. */
const profileDraft = key => profileThemes(key).map(t => [t.key, { key: t.key, label: t.label, weight: t.weight, metrics: new Map(t.metrics.map(m => [m.key, { ...m }])) }]);

/** Step appliers, in STEPS order. Each mutates the draft from normalised answers. */
export const APPLY = Object.freeze({
  // v0.45.0: the levenstype profile (presets.js PROFILES) sets the base of every
  // theme and the metrics of Veiligheid, Voorzieningen, Levenstype and Sfeer; it
  // replaces Standaard's themes (this step runs first). No levenstype = Standaard.
  levensfase(d, a) {
    if (a.levensfase) {
      const own = new Set(PROFILE_THEMES);
      d.themes = new Map([...profileDraft(a.levensfase), ...[...d.themes].filter(([k]) => !own.has(k))]);
    }
    // Bouwstijl (v0.29.0): buildings only, never the people. Living among young
    // families comes from levenstype Gezin (hhWithKidsPct), busy vs quiet from Sfeer.
    // Shares estimated via postcode (bouwjaar-pc4.js); modern also keeps the CBS
    // "afgelopen tien jaar" share, which covers 2025 buurten without a 2023 code.
    const N = EXTRA_THEME_WEIGHTS.nieuwbouw;
    if (a.bouw === 'karakter') metric(d, 'nieuwbouw', 'oldBuildPct', 'higher', 1, N);
    if (a.bouw === 'modern') { metric(d, 'nieuwbouw', 'modernBuildPct', 'higher', 2, N); metric(d, 'nieuwbouw', 'newBuildPct', 'higher', 1, N); }
  },
  budget(d, a) {
    const b = a.budget;
    if (!b) return;
    const woning = theme(d, 'woningmarkt', 0);   // base 0 in every profile: only the slider switches it on
    if (b.mode === 'huur') { woning.metrics.delete('ownerOccupiedPct'); metric(d, 'woningmarkt', 'rentalPct', 'higher'); return; }
    const ceiling = budgetCeiling(b);
    if (ceiling == null) return;
    metric(d, 'budget', 'wozValue', 'target', 1, EXTRA_THEME_WEIGHTS.budget);
    d.targets.wozValue = { ideal: ceiling * WOZ_IDEAL_SHARE, tolerance: ceiling * WOZ_TOLERANCE_SHARE };
    if (b.hide) d.filters.push({ key: 'wozValue', max: ceiling * TOO_EXPENSIVE_SHARE });
  },
  vervoer(d, a) {
    const v = new Set(a.vervoer);
    if (v.has('fiets')) metric(d, 'veiligheid', 'crimeBike', 'lower', STRESS_W);
    if (v.has('ov')) metric(d, 'voorzieningen', 'distOv', 'lower', STRESS_W);   // nearest of train station, metro and tram stop
    if (v.has('lopen')) { metric(d, 'voorzieningen', 'distSupermarket', 'lower', 2); metric(d, 'voorzieningen', 'distGP', 'lower', 2); }
    if (v.has('auto')) {
      metric(d, 'veiligheid', 'crimeVehicle', 'lower', 2);
      // Lower density preferred: shifts the Sfeer slider toward rustig, or adds a light "lower" factor.
      if (a.sfeer == null) metric(d, 'sfeer', 'density', 'lower', 1, AUTO_SFEER_WEIGHT);
    }
  },
  // An answered Sfeer wins the direction: its targets replace the profile's
  // busy/quiet metrics; the theme weight stays the profile's (else 20).
  sfeer(d, a) {
    if (a.sfeer == null) return;
    const s = clamp(a.sfeer + (a.vervoer.includes('auto') ? 15 : 0), 0, 100) / 100;   // 0 = midden in de drukte, 1 = rustig
    // A profile with a Sfeer weight but no direction (Nieuwkomer, v0.46.0) gives that weight; else 20.
    const S = PROFILES[a.levensfase]?.weights.sfeer > 0 ? PROFILES[a.levensfase].weights.sfeer : EXTRA_THEME_WEIGHTS.sfeer;
    theme(d, 'sfeer', S).metrics.clear();
    metric(d, 'sfeer', 'density', 'target', 2, S);
    metric(d, 'sfeer', 'distCentrum', 'target', 1, S);
    d.targets.density = { quantile: clamp(1 - s, 0.05, 0.95) };
    d.targets.distCentrum = { quantile: clamp(s, 0.05, 0.95) };
    if (s <= 0.35) metric(d, 'sfeer', 'horeca1km', 'higher', 1, S);   // uitgaan nearby at the busy end
  },
  // Positive-only: every metric is `lower` with a share > 0; a level 0 item is absent.
  dichtbij(d, a) {
    const items = Object.entries(a.dichtbij ?? {});
    if (!items.length) return;
    const total = items.reduce((s, [, lvl]) => s + lvl, 0);
    const t = theme(d, 'dichtbij', Math.min(total * DICHTBIJ_PER_LEVEL, DICHTBIJ_MAX_WEIGHT));
    for (const [item, lvl] of items) {
      const ms = DICHTBIJ[item].metrics, sum = ms.reduce((s, [, w]) => s + w, 0);
      for (const [key, w, label] of ms) {
        const share = Math.round((lvl * w / sum) * 100) / 100;
        const m = t.metrics.get(key);
        if (m) m.w += share;
        else t.metrics.set(key, { key, pref: 'lower', w: share, label });
      }
    }
  },
  veiligheid(d, a) {
    for (const c of a.veiligheid) metric(d, 'veiligheid', CRIMES[c].key, 'lower', STRESS_W);
  },
  // Positive-only "mensen in een vergelijkbare situatie". An opleidingsniveau
  // replaces the Standaard Opleiding theme (more hbo/wo = plus would work
  // against a lower level and double hbo–wo). An income band replaces
  // Welvaart's "more income = plus" with a target around the band (the target
  // key applies to every theme, so avgIncome must leave Welvaart); the lowest
  // stops also move welfarePer1000 out of Welvaart (no minus) into this theme
  // as a plus. A Welvaart theme left without metrics is dropped.
  situatie(d, a) {
    const s = a.situatie;
    if (!s) return;
    const t = theme(d, 'situatie', EXTRA_THEME_WEIGHTS.situatie);
    if (s.edu) {
      const e = SITUATIE_EDU[s.edu];
      d.themes.delete('opleiding');
      t.metrics.set(e.key, { key: e.key, pref: 'higher', label: `${SITUATIE_LABEL} (opleiding ${e.short})` });
    }
    if (s.income) {
      const b = SITUATIE_INCOME[s.income];
      const welvaart = d.themes.get('welvaart');
      welvaart?.metrics.delete('avgIncome');
      t.metrics.set(SITUATIE_TARGET_KEY, { key: SITUATIE_TARGET_KEY, pref: 'target', label: `${SITUATIE_LABEL} (inkomen ${b.short})` });
      d.targets[SITUATIE_TARGET_KEY] = incomeTarget(s.income);
      if (b.welfare) {
        welvaart?.metrics.delete('welfarePer1000');
        t.metrics.set('welfarePer1000', { key: 'welfarePer1000', pref: 'higher', label: `${SITUATIE_LABEL} (${b.short})` });
      }
      if (welvaart && !welvaart.metrics.size) d.themes.delete('welvaart');
    }
  },
  // Runs last (after the slider overrides): its weight is a share of the total.
  // One metric, the chosen group's share, `higher`; nothing else ever touches origin.
  gemeenschap(d, a) {
    const g = a.gemeenschap;
    if (!g) return;
    const others = [...d.themes.values()].reduce((s, t) => s + (t.key !== 'gemeenschap' && t.weight > 0 && t.metrics.size ? t.weight : 0), 0);
    if (!(others > 0)) return;
    const det = DETAIL_GROUPS[g.detail];
    if (!det) return;
    // One metric. Nederland: kerncijfers share per gemeente, wijk and buurt. Other groups: gemeenten
    // (85458NED); per wijk/buurt only the groups herkomst-pc4.js estimates via postcode
    // (DETAIL_GROUPS[…].wijk); for the others the factor has no data there and is skipped.
    const metrics = new Map([[det.key, { key: det.key, pref: 'higher', label: `${GEMEENSCHAP_LABEL} (${det.label})` }]]);
    d.themes.set('gemeenschap', {
      key: 'gemeenschap', label: GEMEENSCHAP_LABEL,
      weight: Math.round((others * g.pct / (100 - g.pct)) * 10) / 10,
      metrics,
    });
  },
});

/** Theme weights the answers produce before any slider override: { theme: weight }. */
export function themeWeights(answers) {
  return Object.fromEntries(answersToPreset({ ...normalizeAnswers(answers), weights: {}, importance: {} }).themes.map(t => [t.key, t.weight]));
}

/**
 * Importance level (0–4) per theme of the answers' preset, Gemeenschap excluded:
 * the chosen level, else the nearest level to (old absolute weight / base weight).
 */
export function themeImportance(answers) {
  const a = normalizeAnswers(answers);
  const base = themeWeights(a);
  const out = {};
  for (const t of answersToPreset(a).themes) {
    if (t.key === 'gemeenschap') continue;
    out[t.key] = a.importance[t.key] ?? importanceFromRatio(t.weight / (base[t.key] > 0 ? base[t.key] : NOMINAL_BASE));   // base 0 and weight 0 → Niet belangrijk
  }
  return out;
}

/**
 * The custom preset for `answers`: Standaard's themes with the steps applied,
 * then the slider overrides (answers.weights, 0–100 per theme). The empty
 * answers give Standaard's themes, targets and filters unchanged.
 */
export function answersToPreset(answers) {
  const a = normalizeAnswers(answers);
  const d = draft();
  for (const step of APPLY_ORDER) if (step !== 'gemeenschap') APPLY[step]?.(d, a);
  const base = new Map([...d.themes].map(([k, t]) => [k, t.weight]));
  for (const [k, w] of Object.entries(a.weights)) if (d.themes.has(k)) d.themes.get(k).weight = w;
  // The 5-step scale (v0.23.0) wins over an old absolute weight for the same theme.
  for (const [k, lvl] of Object.entries(a.importance)) if (d.themes.has(k)) d.themes.get(k).weight = Math.round((base.get(k) > 0 ? base.get(k) : NOMINAL_BASE) * IMPORTANCE[lvl].factor * 10) / 10;
  APPLY.gemeenschap(d, a);
  return guardOrigin({
    id: 'jouwscore', label: 'Jouw score',
    themes: [...d.themes.values()].map(t => ({ key: t.key, label: t.label, weight: t.weight, metrics: [...t.metrics.values()] })),
    targets: d.targets, filters: d.filters,
    shrink: STANDAARD.shrink, minCoverage: STANDAARD.minCoverage,
  });
}

/**
 * §5 guard: in a preset, an origin metric may only appear as `higher` with a
 * positive weight inside the Gemeenschap theme, and never with a target or
 * filter. Anything else that names an origin metric is removed. Applied to
 * every preset the answers or the hash produce (presets.js resolvePreset
 * enforces the same at scoring time).
 */
export function guardOrigin(preset) {
  // Same for "Jouw situatie": inside that theme only SITUATIE_KEYS as `higher`
  // and avgIncome only as a target with a valid { ideal, tolerance }; outside it
  // no low/middle-education factor, bijstand only as Standaard's minus, and no
  // avgIncome while the income target exists (it would turn that metric into a target).
  const it = preset.targets?.[SITUATIE_TARGET_KEY];
  const incomeTargetOk = isNum(it?.ideal) && isNum(it?.tolerance) && it.tolerance > 0;
  const situatieOk = (t, m) => t.key === 'situatie'
    ? ((SITUATIE_KEYS.includes(m.key) && m.pref === 'higher') || (m.key === SITUATIE_TARGET_KEY && m.pref === 'target' && incomeTargetOk)) && !(m.w <= 0)
    : !['lowEdu', 'medEdu'].includes(m.key) && (m.key !== 'welfarePer1000' || m.pref === 'lower') && !(m.key === SITUATIE_TARGET_KEY && it);
  const themes = (preset.themes ?? []).map(t => ({
    ...t,
    metrics: t.metrics.filter(m => (!ORIGIN_KEYS.includes(m.key) || (t.key === 'gemeenschap' && m.pref === 'higher' && t.weight > 0 && !(m.w <= 0))) && situatieOk(t, m)),
  })).filter(t => (t.key !== 'gemeenschap' && t.key !== 'situatie') || t.metrics.length);
  const guarded = [...ORIGIN_KEYS, 'lowEdu', 'medEdu'];
  const targets = Object.fromEntries(Object.entries(preset.targets ?? {}).filter(([k]) => !guarded.includes(k)));
  const filters = (preset.filters ?? []).filter(f => !guarded.includes(f.key));
  return { ...preset, themes, targets, filters };
}

// ── hash / storage form ──────────────────────────────────────────────────────
// '.'-separated segments, each led by one letter; only [a-z0-9.] so the
// value survives URLSearchParams unescaped. Unknown segments are ignored.
// 'gelijk' / 'standaard' name a fixed preset.
//   l<s|t|p|g|n|v|r|o|m> levenstype (field levensfase; o/m = solo onder de mensen / op mezelf, v0.30;
//                       t = starter, n = nieuwkomer, v0.46.0)
//                           a<k|m>          bouwstijl = karakter/modern
//                       (old o<b|g> still read: og = modern, ob = nothing)
//   b<h|k>[i<n>][p<n>][x] budget        v<f|o|a|l>…     vervoer
//   s<0-100>            sfeer           c<in|gw|…>…     veiligheid chips
//   w<theme letter><n>… slider weights
//   gh<cc><5-30>        gemeenschap: two-letter group code (herkomst-gemeente.js,
//                       nl = Nederland), weight in % of the total. No sign, no
//                       direction: the format cannot express scoring a group down.
//                       Old forms still read: g<d|e|b>[h<cc>]<n>[x] (broad d =
//                       Nederland, e/b = no group; a detailed group wins) and the
//                       old share flag x, which is ignored.
//   j[p|l|m|h][0-8]     Jouw situatie: opleiding basisschool/vmbo–mbo-1/havo–vwo–mbo-4/
//                       hbo–wo, then the income band digit (SITUATIE_INCOME code,
//                       0 = bijstand). v0.23.0 segments j[l|m|h][b] still decode:
//                       b = income band bijstand. An old trailing x is ignored.
// What goes into a link is decided by shareableAnswers(): by default no
// Gemeenschap, opleiding or inkomen.
//   i<theme letter><0-4>…  importance level per theme (5-step scale); wins over w.
//   d<item letter><1-4>…   Wat wil je dichtbij? (v0.35): DICHTBIJ code + level; 0 is left out.
//                       `o` (metro/tram) has no slider since v0.46.0 but is still read and kept:
//                       the UI shows it on the Vervoer OV chip.
// The wizard's prefill flags (v0.46.0) never go into this form: a value in it is always explicit.

const LF = { student: 's', starter: 't', nieuwkomer: 'n', stel: 'p', gezin: 'g', '50plus': 'v', senior: 'r', soloMensen: 'o', soloRust: 'm' };
const BOUW = { karakter: 'k', modern: 'm' };
const VV = { fiets: 'f', ov: 'o', auto: 'a', lopen: 'l' };
const CR = { inbraak: 'in', geweld: 'gw', straatroof: 'sr', fiets: 'fd', auto: 'ad', vandalisme: 'vd', drugs: 'dr', omgeving: 'om' };
const TH = { veiligheid: 'v', welvaart: 'e', voorzieningen: 'z', opleiding: 'o', woningmarkt: 'm', leeftijd: 'l', nieuwbouw: 'n', budget: 'b', sfeer: 's', situatie: 't', dichtbij: 'd' };
const inv = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const ED = Object.fromEntries(Object.entries(SITUATIE_EDU).map(([k, e]) => [k, e.code]));
const INC = Object.fromEntries(Object.entries(SITUATIE_INCOME).map(([k, b]) => [k, b.code]));
const DG = Object.fromEntries(Object.entries(DETAIL_GROUPS).map(([k, d]) => [k, d.code]));
const DB = Object.fromEntries(Object.entries(DICHTBIJ).map(([k, d]) => [k, d.code]));
const DB_ = inv(DB);
const LF_ = inv(LF), BOUW_ = inv(BOUW), VV_ = inv(VV), CR_ = inv(CR), TH_ = inv(TH), ED_ = inv(ED), INC_ = inv(INC), DG_ = inv(DG);

export const SCORE_RE = /^[a-z0-9.]{1,200}$/;
export const FIXED_PRESETS = Object.freeze(['standaard', 'gelijk']);

/** Answers → compact string ('' for the empty answers). */
export function encodeAnswers(answers) {
  const a = normalizeAnswers(answers);
  const seg = [];
  if (a.levensfase) seg.push(`l${LF[a.levensfase]}`);
  if (a.bouw) seg.push(`a${BOUW[a.bouw]}`);
  if (a.budget) seg.push(`b${a.budget.mode === 'huur' ? 'h' : 'k'}${a.budget.income != null ? `i${a.budget.income}` : ''}${a.budget.maxPrice != null ? `p${a.budget.maxPrice}` : ''}${a.budget.hide ? 'x' : ''}`);
  if (a.vervoer.length) seg.push(`v${a.vervoer.map(v => VV[v]).join('')}`);
  if (a.sfeer != null) seg.push(`s${a.sfeer}`);
  if (a.veiligheid.length) seg.push(`c${a.veiligheid.map(c => CR[c]).join('')}`);
  if (a.dichtbij) seg.push(`d${Object.keys(DICHTBIJ).filter(k => a.dichtbij[k]).map(k => `${DB[k]}${a.dichtbij[k]}`).join('')}`);
  const w = Object.keys(TH).filter(k => k in a.weights).map(k => `${TH[k]}${a.weights[k]}`).join('');
  if (w) seg.push(`w${w}`);
  const imp = Object.keys(TH).filter(k => k in a.importance).map(k => `${TH[k]}${a.importance[k]}`).join('');
  if (imp) seg.push(`i${imp}`);
  if (a.situatie) seg.push(`j${a.situatie.edu ? ED[a.situatie.edu] : ''}${a.situatie.income ? INC[a.situatie.income] : ''}`);
  if (a.gemeenschap) seg.push(`gh${DG[a.gemeenschap.detail]}${a.gemeenschap.pct}`);
  return seg.join('.');
}

/** Compact string → normalised answers; anything unreadable is dropped, never throws. */
export function decodeAnswers(str) {
  const out = { ...EMPTY_ANSWERS, vervoer: [], veiligheid: [], weights: {}, importance: {} };
  if (typeof str !== 'string' || !SCORE_RE.test(str) || FIXED_PRESETS.includes(str)) return normalizeAnswers(out);
  for (const s of str.split('.')) {
    const head = s[0], body = s.slice(1);
    if (head === 'l') out.levensfase = LF_[body] ?? null;
    else if (head === 'a') out.bouw = BOUW_[body] ?? null;
    else if (head === 'o') out.bouw = body === 'g' ? 'modern' : out.bouw;   // pre-0.29 "oud": gebouwen → modern, bewoners → nothing
    else if (head === 'b') {
      const m = /^([hk])(?:i(\d{1,3}))?(?:p(\d{1,4}))?(x?)$/.exec(body);
      if (m) out.budget = { mode: m[1] === 'h' ? 'huur' : 'koop', income: m[2] ? +m[2] : null, maxPrice: m[3] ? +m[3] : null, hide: m[4] === 'x' };
    } else if (head === 'v') out.vervoer = [...body].map(c => VV_[c]).filter(Boolean);
    else if (head === 's' && /^\d{1,3}$/.test(body)) out.sfeer = +body;
    else if (head === 'd') { const d = {}; for (const [, c, n] of body.matchAll(/([a-z])([1-4])/g)) if (DB_[c]) d[DB_[c]] = +n; out.dichtbij = d; }
    else if (head === 'c') out.veiligheid = (body.match(/../g) ?? []).map(c => CR_[c]).filter(Boolean);
    else if (head === 'w') for (const [, t, n] of body.matchAll(/([a-z])(\d{1,3})/g)) { if (TH_[t]) out.weights[TH_[t]] = +n; }
    else if (head === 'i') for (const [, t, n] of body.matchAll(/([a-z])([0-4])/g)) { if (TH_[t]) out.importance[TH_[t]] = +n; }
    else if (head === 'j') {
      // Current form: [edu][income digit]; v0.23.0 form: [l|m|h][b] (b = bijstand). Never both. An old x is ignored.
      const m = /^([plmh])?(?:([0-8])|(b))?(x?)$/.exec(body);
      if (m && (m[1] || m[2] || m[3])) out.situatie = { edu: m[1] ? ED_[m[1]] : null, income: m[2] ? INC_[m[2]] : m[3] ? 'bijstand' : null };
    } else if (head === 'g') {
      // Only "[old broad letter][h code] + positive weight [+ old x]"; any other shape (or an unknown letter
      // or code) is dropped whole. The old broad Nederland becomes the group Nederland; Europa / Buiten
      // Europa alone give no group; a detailed code wins over a broad letter.
      const m = /^([a-z])?(?:h([a-z]{2}))?(\d{1,3})(x?)$/.exec(body);
      const broadOk = m?.[1] ? Object.hasOwn(OLD_BROAD, m[1]) : true, detail = m?.[2] ? DG_[m[2]] : null;
      const pick = detail ?? (m?.[1] ? OLD_BROAD[m[1]] : null);
      if (m && broadOk && (m[2] ? detail : true) && pick && +m[3] > 0) out.gemeenschap = { detail: pick, pct: +m[3] };
    }
  }
  return normalizeAnswers(out);
}

// ── sharing (v0.26.0, "Deellink maken") ──────────────────────────────────────

/** The sensitive parts a link may carry, all left out by default. */
export const SHARE_PARTS = Object.freeze({
  origin:    'Herkomst/gemeenschap',
  education: 'Opleiding',
  income:    'Inkomen',
});
export const SHARE_NONE = Object.freeze({ origin: false, education: false, income: false });
const SHARE_COMBOS = [false, true].flatMap(origin => [false, true].flatMap(education => [false, true].map(income => ({ origin, education, income }))));

/**
 * A copy of `answers` with the sensitive parts the user did not tick removed:
 * `gemeenschap` (origin), `situatie.edu` (education), `situatie.income` and
 * `situatie.bijstand` (income); `situatie` is dropped when nothing is left.
 * Does not normalise, so a situatie field this module does not know survives.
 * localStorage always keeps the full answers; this is only for links.
 */
export function shareableAnswers(answers, { origin = false, education = false, income = false } = {}) {
  const a = { ...(answers ?? {}) };
  if (!origin) a.gemeenschap = null;
  if (a.situatie && typeof a.situatie === 'object') {
    const s = { ...a.situatie };
    delete s.share;
    if (!education) delete s.edu;
    if (!income) { delete s.income; delete s.bijstand; }
    a.situatie = Object.values(s).some(v => v != null && v !== false) ? s : null;
  } else a.situatie = null;
  return a;
}

/**
 * The `score` value as it may go into a URL with the given share choices
 * (default: no sensitive part). 'standaard' / 'gelijk' pass unchanged; null
 * when nothing is left or the value is unreadable.
 */
export function shareableScore(score, opts = SHARE_NONE) {
  if (typeof score !== 'string' || !score) return null;
  if (FIXED_PRESETS.includes(score)) return score;
  if (!SCORE_RE.test(score)) return null;
  return encodeAnswers(shareableAnswers(decodeAnswers(score), opts)) || null;
}

/** True when `urlScore` is what some link of `fullScore` carries (the same answers, sensitive parts left out or not). */
export function isShareOf(urlScore, fullScore) {
  if (!fullScore) return false;
  return SHARE_COMBOS.some(o => shareableScore(fullScore, o) === (urlScore || null));
}

/**
 * The score to use on load: when the URL score is a shared form of the
 * locally stored score (same answers, sensitive parts left out), the stored
 * one wins so the local choices survive a reload.
 */
export function restoreLocalScore(urlScore, storedScore) {
  if (!storedScore || storedScore === urlScore) return urlScore ?? storedScore ?? null;
  return isShareOf(urlScore, storedScore) ? storedScore : urlScore ?? null;
}

/**
 * The `score` hash value → the preset the Jouw score layer uses:
 * null/'' / 'standaard' → Standaard, 'gelijk' → Gelijk gewogen, else the
 * decoded answers' preset.
 */
export function presetFromScore(score) {
  if (!score || score === 'standaard') return STANDAARD;
  if (score === 'gelijk') return GELIJK;
  return answersToPreset(decodeAnswers(score));
}

/** Which switcher option a `score` value means: 'standaard' | 'gelijk' | 'custom'. */
export function scoreKind(score) {
  if (!score || score === 'standaard') return 'standaard';
  return score === 'gelijk' ? 'gelijk' : 'custom';
}

/** Name of the Woonscore for a `score` value: 'Woonscore', 'Woonscore · gelijk gewogen' or 'Woonscore · jouw wensen'. */
export function scoreLabel(score) {
  const kind = scoreKind(score);
  return kind === 'custom' ? 'Woonscore · jouw wensen' : kind === 'gelijk' ? 'Woonscore · gelijk gewogen' : 'Woonscore';
}

/** Legend / Ranglijst title of the Woonscore layer: the Standaard title, or the personalised name with its range. */
export function scoreTitle(score, standaardTitle = 'Woonscore (0–100, t.o.v. gelijke gebieden)') {
  return scoreKind(score) === 'standaard' ? standaardTitle : `${scoreLabel(score)} (0–100)`;
}

// ── localStorage (last custom answers; the active `score` lives in state.js) ──

export const ANSWERS_STORAGE_KEY = 'roffatistics.scoreAnswers';

export function loadAnswers(storage) {
  try { const s = storage?.getItem(ANSWERS_STORAGE_KEY); return s ? decodeAnswers(s) : null; } catch { return null; }
}
export function saveAnswers(storage, answers) {
  try {
    const s = encodeAnswers(answers);
    if (s) storage?.setItem(ANSWERS_STORAGE_KEY, s); else storage?.removeItem(ANSWERS_STORAGE_KEY);
  } catch { /* storage blocked: the hash still carries the answers */ }
}

// ── result helpers ───────────────────────────────────────────────────────────

/**
 * Top `n` of scored items ({ code, name, score, filtered? }) by score, ties by
 * name; filtered and unscored items are left out. Adds `rank` (1-based,
 * competition ranking over every eligible item).
 */
export function topAreas(items, n = 10) {
  const ok = (items ?? []).filter(i => isNum(i.score) && !i.filtered)
    .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name), 'nl'));
  return ok.slice(0, n).map(i => ({ ...i, rank: 1 + ok.filter(o => o.score > i.score).length }));
}

/** Short Dutch summary of the answers for the result header. */
export function describeAnswers(answers) {
  const a = normalizeAnswers(answers);
  const parts = [];
  if (a.levensfase) parts.push(LEVENSTYPEN[a.levensfase].toLowerCase());
  if (a.budget) {
    const c = budgetCeiling(a.budget);
    parts.push(a.budget.mode === 'huur' ? 'huur' : c != null ? `koop tot ≈ €${Math.round(c).toLocaleString('nl-NL')}k` : 'koop');
  }
  if (a.vervoer.length) parts.push(a.vervoer.map(v => VERVOER[v].toLowerCase()).join('/'));
  if (a.sfeer != null) parts.push(a.sfeer < 35 ? 'levendig' : a.sfeer > 65 ? 'rustig' : 'tussen druk en rustig');
  if (a.dichtbij) parts.push(`dichtbij: ${Object.keys(DICHTBIJ).filter(k => a.dichtbij[k]).sort((x, y) => a.dichtbij[y] - a.dichtbij[x]).map(k => DICHTBIJ[k].label.toLowerCase()).join(', ')}`);
  if (a.veiligheid.length) parts.push(`let op ${a.veiligheid.map(c => CRIMES[c].label.toLowerCase()).join(', ')}`);
  if (a.situatie) parts.push(`${SITUATIE_LABEL.toLowerCase()}: ${[a.situatie.edu ? `opleiding ${SITUATIE_EDU[a.situatie.edu].short}` : '', a.situatie.income ? `inkomen ${SITUATIE_INCOME[a.situatie.income].short}` : ''].filter(Boolean).join(', ')}`);
  if (a.gemeenschap) {
    const d = DETAIL_GROUPS[a.gemeenschap.detail];
    parts.push(`${GEMEENSCHAP_LABEL.toLowerCase()}: ${d.label} (${d.direct ? 'gemeente, wijk en buurt' : d.wijk ? 'gemeenten; wijk/buurt geschat via postcode' : 'gemeenten'})`);
  }
  return parts.join(' · ');
}

// ── wizard v2: profile prefill (docs/plan-wizard-v2.md, v0.46.0) ─────────────
// Choosing a profile fills in the Buurt step (Sfeer + BUURT_DICHTBIJ) with its
// suggestion. A per-field `prefilled` flag (local only: memory and its own
// localStorage key, never the hash) says the value is the profile's: it
// follows a profile change. Any value the user set is explicit and wins.
// Nothing here ever touches Gemeenschap or Situatie (§5 guard).

/** Dichtbij items on the Buurt step; `station` is shown on the Vervoer step, `ov` on the OV chip. */
export const BUURT_DICHTBIJ = Object.freeze(['uitgaan', 'winkels', 'cultuur', 'park', 'natuur']);
export const VERVOER_DICHTBIJ = Object.freeze(['station']);
/** Old Dichtbij item the OV chip absorbed: still read from a hash, shown on the chip, cleared with it. */
export const OV_DICHTBIJ = 'ov';
const PROFILE_DEFAULTS = Object.freeze({
  student: Object.freeze({ sfeer: 10, dichtbij: Object.freeze({ uitgaan: 3 }) }),   // busy end, uitgaan Belangrijk
  gezin:   Object.freeze({ sfeer: 85, dichtbij: Object.freeze({ park: 3 }) }),      // rustig, park Belangrijk
  senior:  Object.freeze({ sfeer: 85, dichtbij: Object.freeze({ winkels: 3 }) }),   // rustig, winkels Belangrijk
});
/**
 * "Waarom" line of a Gemeenschap plus (v0.46.0 wording): "Grote gemeenschap uit
 * <groep> in de buurt (18%, 2,5× gemiddeld)". `value` = the area's share (%),
 * `mean` = the average among the compared areas (ratio left out without one).
 * The group data has country/region names, no adjectives, hence "uit <groep>".
 */
export function gemeenschapReason(groupLabel, value, mean) {
  if (!isNum(value) || !groupLabel) return null;
  const pct = `${value.toLocaleString('nl-NL', { maximumFractionDigits: value < 10 ? 1 : 0 })}%`;
  const ratio = isNum(mean) && mean > 0 ? `, ${(value / mean).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}× gemiddeld` : '';
  return `Grote gemeenschap uit ${groupLabel} in de buurt (${pct}${ratio})`;
}

/** Profiles whose Buren step ("Waar voel je je thuis?") opens by default; it is never filled in for them. */
export const BUREN_OPEN_PROFILES = Object.freeze(['nieuwkomer']);

/** The suggested Sfeer (0–100 or null) and Dichtbij levels ({ item: 1–4 }) of a profile; pure, fresh objects. */
export function profileDefaults(levensfase) {
  const d = Object.hasOwn(PROFILE_DEFAULTS, levensfase ?? '') ? PROFILE_DEFAULTS[levensfase] : null;
  return { sfeer: d?.sfeer ?? null, dichtbij: { ...(d?.dichtbij ?? {}) } };
}

export const EMPTY_PREFILL = Object.freeze({ sfeer: false, dichtbij: Object.freeze({}) });
/** Canonical flags: { sfeer: bool, dichtbij: { item: true } } (Buurt items only). */
export function normalizePrefill(p) {
  return { sfeer: p?.sfeer === true, dichtbij: Object.fromEntries(BUURT_DICHTBIJ.filter(k => p?.dichtbij?.[k] === true).map(k => [k, true])) };
}

/**
 * Sets the levenstype (null = none) and lets the prefilled fields follow it:
 * a field that is empty or flagged takes the new profile's suggestion (or is
 * cleared when it has none); an explicit value stays. → { answers, prefilled }.
 */
export function chooseProfile(answers, prefilled, levensfase) {
  const a = normalizeAnswers({ ...answers, levensfase });
  const p = normalizePrefill(prefilled);
  const def = profileDefaults(a.levensfase);
  const out = { sfeer: false, dichtbij: {} };
  let sfeer = a.sfeer;
  if (sfeer == null || p.sfeer) { sfeer = def.sfeer; out.sfeer = def.sfeer != null; }
  const dichtbij = { ...(a.dichtbij ?? {}) };
  for (const k of BUURT_DICHTBIJ) {
    if (dichtbij[k] && !p.dichtbij[k]) continue;   // explicit wins
    if (def.dichtbij[k]) { dichtbij[k] = def.dichtbij[k]; out.dichtbij[k] = true; } else delete dichtbij[k];
  }
  return { answers: normalizeAnswers({ ...a, sfeer, dichtbij }), prefilled: out };
}

/** The flags without `field` (and `item` for dichtbij): the user changed it, so it is explicit now. */
export function markExplicit(prefilled, field, item = null) {
  const p = normalizePrefill(prefilled);
  if (field === 'sfeer') p.sfeer = false;
  else if (field === 'dichtbij') { if (item) delete p.dichtbij[item]; else p.dichtbij = {}; }
  return p;
}

/** True when the value shown for `field` (`item`) is the profile's suggestion. */
export function isPrefilled(prefilled, field, item = null) {
  return field === 'sfeer' ? prefilled?.sfeer === true : prefilled?.dichtbij?.[item] === true;
}

/** Keeps only the flags whose value still equals the profile's suggestion (stored flags vs. answers from a link). */
export function reconcilePrefill(answers, prefilled) {
  const a = normalizeAnswers(answers), p = normalizePrefill(prefilled), def = profileDefaults(a.levensfase);
  return {
    sfeer: p.sfeer && def.sfeer != null && a.sfeer === def.sfeer,
    dichtbij: Object.fromEntries(Object.keys(p.dichtbij).filter(k => def.dichtbij[k] && a.dichtbij?.[k] === def.dichtbij[k]).map(k => [k, true])),
  };
}

/** True when the Buren step opens by default: a Nieuwkomer profile, or Situatie/Gemeenschap already answered. */
export function burenOpen(answers) {
  const a = normalizeAnswers(answers);
  return BUREN_OPEN_PROFILES.includes(a.levensfase) || !!a.situatie || !!a.gemeenschap;
}

/** Toggles a Vervoer chip; switching OV off also drops the old Dichtbij `ov` level it carries. */
export function toggleVervoer(answers, v) {
  const a = normalizeAnswers(answers);
  // An old hash's Dichtbij `ov` shows the OV chip as on, so a click switches both off.
  const on = !(a.vervoer.includes(v) || (v === 'ov' && !!a.dichtbij?.[OV_DICHTBIJ]));
  const vervoer = on ? [...a.vervoer, v] : a.vervoer.filter(x => x !== v);
  const dichtbij = { ...(a.dichtbij ?? {}) };
  if (v === 'ov' && !on) delete dichtbij[OV_DICHTBIJ];
  return normalizeAnswers({ ...a, vervoer, dichtbij });
}

/** "Overslaan" on a wizard v2 step: clears what that step asks → { answers, prefilled }. */
export function clearStep(answers, prefilled, key) {
  const a = normalizeAnswers(answers);
  const p = normalizePrefill(prefilled);
  const without = items => Object.fromEntries(Object.entries(a.dichtbij ?? {}).filter(([k]) => !items.includes(k)));
  if (key === 'levensfase') return chooseProfile(a, p, null);
  if (key === 'budget') return { answers: { ...a, budget: null }, prefilled: p };
  if (key === 'vervoer') return { answers: normalizeAnswers({ ...a, vervoer: [], dichtbij: without([...VERVOER_DICHTBIJ, OV_DICHTBIJ]) }), prefilled: p };
  if (key === 'buurt') return { answers: normalizeAnswers({ ...a, sfeer: null, dichtbij: without(BUURT_DICHTBIJ) }), prefilled: { ...EMPTY_PREFILL, dichtbij: {} } };
  if (key === 'buren') return { answers: { ...a, situatie: null, gemeenschap: null }, prefilled: p };
  return { answers: a, prefilled: p };
}

export const PREFILL_STORAGE_KEY = 'roffatistics.scorePrefill';
/** Stored flags, reconciled with `answers` (a flag whose value no longer matches is dropped). */
export function loadPrefill(storage, answers) {
  try { const s = storage?.getItem(PREFILL_STORAGE_KEY); return reconcilePrefill(answers, s ? JSON.parse(s) : null); } catch { return normalizePrefill(null); }
}
export function savePrefill(storage, prefilled) {
  try {
    const p = normalizePrefill(prefilled);
    if (p.sfeer || Object.keys(p.dichtbij).length) storage?.setItem(PREFILL_STORAGE_KEY, JSON.stringify(p)); else storage?.removeItem(PREFILL_STORAGE_KEY);
  } catch { /* storage blocked: the flags live for this session only */ }
}
