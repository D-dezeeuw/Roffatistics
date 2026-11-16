// The city this page shows (docs/plan-mokumistics.md, step 1). One codebase,
// a city per domain: config/cities.json holds every city; the choice is made
// once per page load and kept in <html data-city> (never stored, so two tabs
// can show two cities). Order: ?city=<slug> → the hostname from `hosts` →
// the default city (rotterdam). The early inline script in index.html makes
// the same choice before the first paint; tests/city.test.js keeps them equal.
import CITIES_JSON from '../config/cities.json' with { type: 'json' };

const deepFreeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };

/** Every city by slug (config/cities.json). */
export const CITIES = deepFreeze(structuredClone(CITIES_JSON.cities));
export const DEFAULT_CITY = CITIES_JSON.default;
export const CITY_SLUGS = Object.freeze(Object.keys(CITIES));

/** Slug of the city for a page URL: ?city= (a known slug) → hostname → default. Pure. */
export function resolveCitySlug({ search = '', hostname = '' } = {}, cities = CITIES, fallback = DEFAULT_CITY) {
  let q = null;
  try { q = new URLSearchParams(String(search ?? '')).get('city'); } catch { /* bad query */ }
  q = q?.trim().toLowerCase() ?? null;
  if (q && Object.hasOwn(cities, q)) return q;
  const host = String(hostname ?? '').toLowerCase();
  const hit = Object.values(cities).find(c => (c.hosts ?? []).includes(host));
  return hit?.slug ?? fallback;
}

/** The city config of `slug`, else the default city. */
export const cityBySlug = slug => CITIES[slug] ?? CITIES[DEFAULT_CITY];

/** The slug of this page: <html data-city> (set by the early script) when valid, else resolved from location. */
export function currentCitySlug(g = globalThis) {
  const set = g.document?.documentElement?.dataset?.city;
  if (set && Object.hasOwn(CITIES, set)) return set;
  return resolveCitySlug({ search: g.location?.search ?? '', hostname: g.location?.hostname ?? '' });
}

/** The city of this page (fixed for the page's lifetime). */
export const CITY = cityBySlug(currentCitySlug());

/** "Rotterdamse" / "Amsterdamse". */
export const cityAdjective = (city = CITY) => city.adjective;

/** CBS codes of a city: GM0599 → { gemeente: 'GM0599', wijkPrefix: 'WK0599', buurtPrefix: 'BU0599' }. */
export function cityCodes(city = CITY) {
  const n = city.gemeente.slice(2);
  return Object.freeze({ gemeente: city.gemeente, wijkPrefix: `WK${n}`, buurtPrefix: `BU${n}` });
}

/** True for a wijk/buurt code of the city (WK0599…/BU0599… for Rotterdam). */
export function isCityAreaCode(code, city = CITY) {
  const n = city.gemeente.slice(2);
  const c = String(code ?? '').trim().toUpperCase();
  return (c.startsWith('WK') || c.startsWith('BU')) && c.slice(2, 6) === n;
}

/** '51.9244' → '51,9244' (4 decimals, Dutch comma). */
const coord = v => v.toFixed(4).replace('.', ',');
/** The centrum reference point as text: "51,9244 N, 4,4690 O". */
export const centrumCoords = (city = CITY) => `${coord(city.centrum.point[0])} N, ${coord(city.centrum.point[1])} O`;

/** Tab title of the city: "Roffatistics — Rotterdam en Nederland in cijfers". */
export const cityTitle = (city = CITY) => `${city.appName} — ${city.name} en Nederland in cijfers`;

/**
 * Fills the head and the scope picker from the city config. For the default
 * city every value equals the static index.html, so nothing changes there.
 */
export function applyCityToDocument(doc = globalThis.document, city = CITY) {
  if (!doc?.documentElement) return;
  doc.documentElement.dataset.city = city.slug;
  if (city.slug === DEFAULT_CITY) return;
  const title = cityTitle(city);
  doc.title = title;
  const set = (sel, attr, v) => doc.querySelectorAll(sel).forEach(el => el.setAttribute(attr, v));
  set('meta[property="og:title"], meta[name="twitter:title"]', 'content', title);
  if (city.canonical) { set('meta[property="og:url"]', 'content', city.canonical); set('link[rel="canonical"]', 'href', city.canonical); }
  doc.querySelectorAll('.scope-select option[value="rotterdam"]').forEach(el => { el.textContent = city.name; });
}

/** Neighbouring gemeenten as text: "Schiedam, Capelle, Barendrecht", or with `conj` "Schiedam, Capelle of Barendrecht". */
export function cityNeighbours(conj = null, city = CITY) {
  const n = city.neighbours ?? [];
  return conj && n.length > 1 ? `${n.slice(0, -1).join(', ')} ${conj} ${n[n.length - 1]}` : n.join(', ');
}
