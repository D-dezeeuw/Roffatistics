// Privacy, disclaimer and colofon (W27): one small dialog with three tabs.
// Opened by any [data-legal="privacy|disclaimer|colofon"] trigger (splash
// footer, the foot of the Uitleg dialog, the ☰ menu) and by a #legal=<tab>
// link on page load. "Wis mijn gegevens" removes this app's keys from the
// browser storage and reloads the page without the hash.
//
// The dialog reuses the search/explain modal classes; the logic sits in
// createLegalDialog() so it runs against a fake DOM in the tests.

/** Kept equal to package.json "version" (tests/legal.test.js checks it). */
export const APP_VERSION = '0.43.0';

export const LEGAL_SECTIONS = Object.freeze(['privacy', 'disclaimer', 'colofon']);
export const LEGAL_TITLES = Object.freeze({ privacy: 'Privacy', disclaimer: 'Disclaimer', colofon: 'Colofon' });

/** Every localStorage key of the app starts with this (see splash, theme, state, map, scale, list, legend, search, wizard-model). */
export const APP_STORAGE_PREFIX = 'roffatistics.';

const REPO_URL = 'https://github.com/D-dezeeuw/Roffatistics';

// Read at import, before state.js rewrites the address bar.
const INITIAL_HASH = typeof location !== 'undefined' ? location.hash : '';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;

/** '#legal=colofon' → 'colofon'; anything else → null. */
export function parseLegalHash(hash) {
  const m = /^#?legal=([a-z]+)$/.exec(String(hash ?? '').trim().toLowerCase());
  return m && LEGAL_SECTIONS.includes(m[1]) ? m[1] : null;
}

/**
 * Removes the app's own keys: localStorage keys with APP_STORAGE_PREFIX (the
 * origin d-dezeeuw.github.io is shared with other projects, so nothing else
 * is touched) and, in sessionStorage, the prefixed keys plus the cached data
 * responses (keyed by their https:// URL). Returns the removed keys.
 */
export function clearAppData({ local = safe(() => globalThis.localStorage), session = safe(() => globalThis.sessionStorage) } = {}) {
  const removed = [];
  const sweep = (storage, match) => {
    if (!storage) return;
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k != null && match(k)) keys.push(k); }
      for (const k of keys) { storage.removeItem(k); removed.push(k); }
    } catch { /* storage blocked */ }
  };
  sweep(local, k => k.startsWith(APP_STORAGE_PREFIX));
  sweep(session, k => k.startsWith(APP_STORAGE_PREFIX) || k.startsWith('https://'));
  return removed;
}
function safe(fn) { try { return fn(); } catch { return null; } }

// ── Texts ────────────────────────────────────────────────────────────────────

const PRIVACY = `
  <p><strong>Alles blijft op je apparaat.</strong> Roffatistics heeft geen accounts, zet geen cookies, gebruikt geen analytics, trackers of advertenties en heeft geen eigen server die iets van je opslaat.</p>
  <h3>Wat er op je apparaat staat</h3>
  <p>Je keuzes bewaren we in de opslag van je eigen browser (localStorage), zodat ze er de volgende keer nog zijn: thema, kaartstijl, OV-lijnen, basisscholen op de kaart, schaal, weergave, ranglijstinstellingen, je recente zoekopdrachten, of het startscherm getoond wordt en je antwoorden uit de wizard. Opgehaalde cijfers staan tijdelijk in sessionStorage en verdwijnen als je het tabblad sluit. Niets hiervan wordt verstuurd.</p>
  <h3>Deellinks</h3>
  <p>Je wizardantwoorden en andere gevoelige keuzes komen alleen in een link als je ze bij Delen zelf aanvinkt. Zonder vinkje bevat de link alleen de kaartweergave.</p>
  <h3>Welke servers de pagina gebruikt</h3>
  <p>Om de kaart en de cijfers te tonen haalt je browser bestanden op bij:</p>
  <ul>
    <li>GitHub Pages: de app zelf;</li>
    <li>unpkg.com: de kaartbibliotheken Leaflet en MapLibre;</li>
    <li>OpenFreeMap (tiles.openfreemap.org): kaarttegels en kaartlettertypen;</li>
    <li>PDOK (service.pdok.nl): gebiedsgrenzen en de luchtfoto (kaart Satelliet);</li>
    <li>CBS (opendata.cbs.nl, dataderden.cbs.nl): de statistieken en de politiecijfers;</li>
    <li>Randstad (randstad.hermes.blockworlds.nl): de actuele meldingen hulpdiensten (P2000), alleen als je de laag Actueel opent. Er gaat niets over jou mee, alleen een gewoon verzoek om de tabel.</li>
  </ul>
  <p>Die verzoeken vragen alleen om kaartdelen en tabellen. Je zoekterm, postcode en antwoorden gaan niet mee: postcodes en zoeken werken met bestanden die bij de app horen. Zoals bij elke website zien deze servers wel technisch je IP-adres en browser; wat zij daarmee doen staat in hun eigen privacybeleid.</p>
  <h3>Gegevens wissen</h3>
  <p>Deze knop haalt alle Roffatistics-gegevens uit deze browser en laadt de pagina opnieuw met de standaardinstellingen. Gegevens van andere sites blijven staan.</p>
  <p><button type="button" class="legal-clear">Wis mijn gegevens</button> <span class="legal-clear-status" role="status"></span></p>`;

const DISCLAIMER = `
  <p>Roffatistics laat openbare, samengevoegde statistieken per gebied zien. De scores zijn een indicatie en zeggen hoe een gebied het doet vergeleken met vergelijkbare gebieden (wijken met wijken, buurten met buurten), niet hoe goed het is in absolute zin.</p>
  <ul>
    <li>De cijfers komen van verschillende bronnen en uit verschillende jaren. Meestal 2023 tot 2025, maar de afstand tot groen en natuur is nog van 2017. In de Uitleg staat per cijfer welk jaar en welke tabel.</li>
    <li>Herkomstcijfers zijn CBS-totalen per gebied. Ze beschrijven geen personen en geen gedrag.</li>
    <li>Dit is geen advies over kopen, huren of verhuizen. Bekijk een buurt ook zelf en gebruik officiële bronnen voor een besluit.</li>
    <li>Aan de cijfers, scores en teksten kunnen geen rechten worden ontleend. Er kunnen fouten in zitten, bij de bron of bij ons.</li>
  </ul>
  <p>Zie je een fout? Meld het via ${link(REPO_URL + '/issues', 'GitHub')}.</p>`;

const COLOFON = `
  <p><strong>Roffatistics</strong> versie ${esc(APP_VERSION)}. Gemaakt door Danny de Zeeuw, Neko Media.</p>
  <h3>Gebouwd met</h3>
  <ul>
    <li>${link('https://www.npmjs.com/package/spektrum', 'Spektrum')}</li>
    <li>${link('https://maplibre.org/', 'MapLibre GL JS')} en ${link('https://leafletjs.com/', 'Leaflet')} (BSD-licentie)</li>
    <li>Kaarttegels van ${link('https://openfreemap.org/', 'OpenFreeMap')}, stijl ${link('https://www.openmaptiles.org/', 'OpenMapTiles')}</li>
  </ul>
  <h3>Bronnen</h3>
  <ul>
    <li>${link('https://opendata.cbs.nl/', 'CBS')}, Centraal Bureau voor de Statistiek (CC BY 4.0)</li>
    <li>${link('https://data.politie.nl/', 'Politie')}, geregistreerde misdrijven (open data, via CBS)</li>
    <li>${link('https://www.pdok.nl/', 'PDOK')}: CBS wijk- en buurtkaart en luchtfoto Beeldmateriaal Nederland (open data)</li>
    <li>Kaartgegevens © ${link('https://www.openstreetmap.org/copyright', 'OpenStreetMap')}-bijdragers (ODbL)</li>
    <li>${link('https://randstad.hermes.blockworlds.nl/', 'Randstad')}: actuele meldingen hulpdiensten (P2000), live per buurt, wijk en gemeente</li>
  </ul>
  <h3>Broncode en contact</h3>
  <p>De broncode staat op ${link(REPO_URL, 'GitHub')} (MIT-licentie). Vragen of fouten: open daar een issue of zie ${link('https://github.com/d-dezeeuw', 'github.com/d-dezeeuw')}.</p>`;

const BODIES = { privacy: PRIVACY, disclaimer: DISCLAIMER, colofon: COLOFON };

/** Dialog markup: tablist + one panel per section. */
export function legalDialogHtml() {
  const tabs = LEGAL_SECTIONS.map(s => `<button type="button" role="tab" class="legal-tab" id="legal-tab-${s}" data-legal-tab="${s}" aria-controls="legal-panel-${s}" aria-selected="false" tabindex="-1">${LEGAL_TITLES[s]}</button>`).join('');
  const panels = LEGAL_SECTIONS.map(s => `<section role="tabpanel" class="legal-panel" id="legal-panel-${s}" data-legal-panel="${s}" aria-labelledby="legal-tab-${s}" tabindex="0" hidden>${BODIES[s]}</section>`).join('');
  return `
    <div class="search-backdrop" data-legal-close></div>
    <div class="search-dialog legal-dialog" role="dialog" aria-modal="true" aria-labelledby="legal-title">
      <header class="explain-head">
        <h2 id="legal-title">Privacy &amp; colofon</h2>
        <button class="search-close" type="button" data-legal-close aria-label="Sluiten">Esc</button>
      </header>
      <div class="legal-tabs" role="tablist" aria-label="Privacy, disclaimer en colofon">${tabs}</div>
      <div class="legal-body">${panels}</div>
    </div>`;
}

/** The links row used in the splash footer and under the Uitleg dialog. */
export function legalLinksHtml(cls = 'legal-links') {
  return `<span class="${esc(cls)}">${LEGAL_SECTIONS.map(s => `<button type="button" class="legal-link" data-legal="${s}">${LEGAL_TITLES[s]}</button>`).join(' &middot; ')}</span>`;
}

// ── Dialog logic ─────────────────────────────────────────────────────────────

/**
 * modal: the overlay; dialog: the role=dialog box; tabs/panels: arrays with
 * data-legal-tab / data-legal-panel. Returns { open(section), close(),
 * select(section), isOpen(), current() }.
 */
export function createLegalDialog({ modal, dialog, tabs, panels, doc = globalThis.document }) {
  let current = LEGAL_SECTIONS[0];
  let returnFocus = null;
  const isOpen = () => !modal.hidden;

  function select(section, { focus = false } = {}) {
    if (!LEGAL_SECTIONS.includes(section)) section = LEGAL_SECTIONS[0];
    current = section;
    for (const t of tabs) {
      const on = t.getAttribute('data-legal-tab') === section;
      t.setAttribute('aria-selected', String(on));
      t.setAttribute('tabindex', on ? '0' : '-1');
      if (on && focus) t.focus();
    }
    for (const p of panels) p.hidden = p.getAttribute('data-legal-panel') !== section;
    return current;
  }

  function open(section = current) {
    if (!isOpen()) returnFocus = doc.activeElement;
    modal.hidden = false;
    doc.body?.classList?.add('legal-open');
    select(section, { focus: true });
  }

  function close() {
    if (!isOpen()) return;
    modal.hidden = true;
    doc.body?.classList?.remove('legal-open');
    if (returnFocus && typeof returnFocus.focus === 'function' && (!doc.contains || doc.contains(returnFocus))) returnFocus.focus();
    returnFocus = null;
  }

  function trapFocus(e) {
    const focusables = [...dialog.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && !el.closest?.('[hidden]'));
    if (!focusables.length) return;
    const first = focusables[0], last = focusables.at(-1);
    if (e.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  modal.addEventListener('click', e => {
    const tab = e.target?.closest?.('[data-legal-tab]');
    if (tab) { select(tab.getAttribute('data-legal-tab'), { focus: true }); return; }
    if (e.target?.closest?.('[data-legal-close]')) close();
  });
  // Escape and Tab stop here, so the splash (document listener) underneath does not react.
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') { e.stopPropagation(); trapFocus(e); return; }
    if (e.target?.closest?.('[data-legal-tab]')) {
      const i = LEGAL_SECTIONS.indexOf(current), n = LEGAL_SECTIONS.length;
      let next = null;
      if (e.key === 'ArrowRight') next = LEGAL_SECTIONS[(i + 1) % n];
      else if (e.key === 'ArrowLeft') next = LEGAL_SECTIONS[(i - 1 + n) % n];
      else if (e.key === 'Home') next = LEGAL_SECTIONS[0];
      else if (e.key === 'End') next = LEGAL_SECTIONS[n - 1];
      if (next) { e.preventDefault(); select(next, { focus: true }); }
    }
  });

  select(current);
  return { open, close, select: s => select(s), isOpen, current: () => current };
}

let api = null;

/** Builds the dialog once, wires every [data-legal] trigger and a #legal=<tab> deep link. */
export function initLegal() {
  if (api || typeof document === 'undefined') return api;
  const modal = document.createElement('div');
  modal.id = 'legal-modal';
  modal.className = 'search-modal legal-modal';
  modal.hidden = true;
  modal.innerHTML = legalDialogHtml();
  document.body.appendChild(modal);
  api = createLegalDialog({
    modal,
    dialog: modal.querySelector('.legal-dialog'),
    tabs: [...modal.querySelectorAll('[data-legal-tab]')],
    panels: [...modal.querySelectorAll('[data-legal-panel]')],
  });
  const status = modal.querySelector('.legal-clear-status');
  modal.querySelector('.legal-clear')?.addEventListener('click', () => {
    const n = clearAppData().length;
    status.textContent = `${n} ${n === 1 ? 'item' : 'items'} gewist. De pagina laadt opnieuw…`;
    setTimeout(() => location.replace(location.pathname + location.search), 600);
  });
  document.addEventListener('click', e => {
    const trigger = e.target.closest?.('[data-legal]');
    if (!trigger) return;
    e.preventDefault();
    api.open(trigger.dataset.legal);
  });
  const deep = parseLegalHash(INITIAL_HASH);
  if (deep) api.open(deep);
  return api;
}
