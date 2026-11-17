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

/** "Geen website van de gemeente Amsterdam." (About, footer, Disclaimer). */
export const cityDisclaimer = (city = CITY) => `Geen website van de gemeente ${city.name}.`;

/** The slogan as lines (config: null, one string or an array of lines). */
export const sloganLines = (city = CITY) => (city.slogan == null ? [] : [].concat(city.slogan).map(String));

const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The slogan as a short poem (one line per phrase, italics); '' without a slogan. */
export function sloganHtml(city = CITY) {
  const lines = sloganLines(city);
  return lines.length ? `<em class="city-slogan">${lines.map(escHtml).join('<br>')}</em>` : '';
}

/**
 * Head values of a city: tab title, descriptions, the absolute OG image and the
 * icons. For the default city they equal the static index.html (tested), so
 * server.js can write them per host without changing the Rotterdam page.
 */
export function cityMeta(city = CITY) {
  const lead = 'Kaarten, ranglijsten en een persoonlijke Woonscore per buurt, wijk en gemeente.';
  const slogan = sloganLines(city).join(' ');
  const pre = slogan ? `${slogan} ` : '';
  return Object.freeze({
    title: cityTitle(city),
    description: `${city.name} en Nederland in cijfers: kaarten, ranglijsten en een persoonlijke Woonscore per buurt, wijk en gemeente. Vind jouw ideale woonplek.`,
    ogDescription: `${pre}${lead} Vind jouw ideale woonplek.`,
    twitterDescription: `${pre}${lead}`,
    siteName: city.appName,
    canonical: city.canonical,
    ogImage: new URL(city.og, city.canonical).href,
    ogImageAlt: city.ogImageAlt,
    icons: city.icons,
    logo: city.logo,
    aboutTitle: `Over ${city.appName} (titelscherm)`,
    disclaimer: cityDisclaimer(city),
  });
}

/**
 * Fills the head, the brand (logo, name, slogan, disclaimer) and the scope
 * picker from the city config. For the default city every value equals the
 * static index.html, so nothing changes there.
 */
export function applyCityToDocument(doc = globalThis.document, city = CITY) {
  if (!doc?.documentElement) return;
  doc.documentElement.dataset.city = city.slug;
  if (city.slug === DEFAULT_CITY) return;
  const m = cityMeta(city);
  doc.title = m.title;
  const all = sel => doc.querySelectorAll?.(sel) ?? [];
  const set = (sel, attr, v) => { if (v != null) all(sel).forEach(el => el.setAttribute(attr, v)); };
  set('meta[property="og:title"], meta[name="twitter:title"]', 'content', m.title);
  set('meta[name="description"]', 'content', m.description);
  set('meta[property="og:description"]', 'content', m.ogDescription);
  set('meta[name="twitter:description"]', 'content', m.twitterDescription);
  set('meta[property="og:site_name"]', 'content', m.siteName);
  set('meta[property="og:image"], meta[name="twitter:image"]', 'content', m.ogImage);
  set('meta[property="og:image:alt"]', 'content', m.ogImageAlt);
  if (city.canonical) { set('meta[property="og:url"]', 'content', city.canonical); set('link[rel="canonical"]', 'href', city.canonical); }
  set('link[rel="icon"][sizes]', 'href', m.icons?.ico);
  set('link[rel="icon"][type="image/svg+xml"]', 'href', m.icons?.svg);
  set('link[rel="apple-touch-icon"]', 'href', m.icons?.apple);
  set('.nav-logo, .splash-logo', 'src', m.logo?.ui);
  set('.app-loader__logo', 'src', m.logo?.loader);
  set('.nav-title', 'title', m.aboutTitle);
  set('.about-btn', 'aria-label', `Over ${city.appName}`);
  set('.about-btn', 'title', `Over ${city.appName}`);
  all('.nav-title-text, #splash-title').forEach(el => { el.textContent = city.appName; });
  all('.city-disclaimer').forEach(el => { el.textContent = m.disclaimer; });
  if (sloganLines(city).length) all('#splash-tagline').forEach(el => { el.innerHTML = sloganHtml(city); });
  all('.scope-select option[value="rotterdam"]').forEach(el => { el.textContent = city.name; });
  all('.city-name').forEach(el => { el.textContent = city.name; });
  all('.city-app-name').forEach(el => { el.textContent = city.appName; });
  // P2000 (Randstad) covers only Rotterdam-Rijnmond: no link on the splash of another city.
  if (city.p2000 === false) all('.splash-p2000-item').forEach(el => { el.hidden = true; el.setAttribute('hidden', ''); });
  if (city.tour?.id) {
    set('.splash-tour-link', 'href', cityTourUrl(city));
    all('.splash-tour-title').forEach(el => { el.textContent = city.tour.title; });
    all('.splash-tour-text').forEach(el => { el.textContent = city.tour.text; });
  }
}

/** The flightroutes time-travel tour of this city ("Meer van ons" on the splash). */
export const cityTourUrl = (city = CITY) => (city.tour?.id ? `https://flightroutes.hermes.blockworlds.nl/#/tour/${city.tour.id}` : null);

/** Neighbouring gemeenten as text: "Schiedam, Capelle, Barendrecht", or with `conj` "Schiedam, Capelle of Barendrecht". */
export function cityNeighbours(conj = null, city = CITY) {
  const n = city.neighbours ?? [];
  return conj && n.length > 1 ? `${n.slice(0, -1).join(', ')} ${conj} ${n[n.length - 1]}` : n.join(', ');
}
