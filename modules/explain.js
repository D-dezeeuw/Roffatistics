// "Uitleg" panel: what every metric means, how it is calculated, where it
// comes from and what to watch out for. Generated from the DATASETS metadata
// (description, formula, source, year, caveats), so a new dataset cannot ship
// without an explanation (tests/explain.test.js). The dialog reuses the search
// modal's shell and patterns: role=dialog, Esc closes, Tab is trapped, focus
// returns to the opener. Any element with data-explain="<key>" opens it
// scrolled to that entry ('score', 'crime-mode', 'nodata' for the general parts).
import { DATASETS, groupDatasets, datasetFor } from './datasets.js';
import { ORIGIN_GROUPS, HERKOMST_TABLE, HERKOMST_FIRST_YEAR, HERKOMST_YEAR } from './herkomst.js';
import { PC4_GROUPS, PC4_HERKOMST_TABLE, PC4_YEAR, PC4_MIN_POPULATION } from './herkomst-pc4.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Lower case without diacritics, for the filter. */
export function normalizeText(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** True when every word of `query` occurs in `text` (both normalised); an empty query matches. */
export function matchesQuery(text, query) {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  const hay = normalizeText(text);
  return words.every(w => hay.includes(w));
}

/** Score direction in the Ranglijst, in words. */
export function directionLabel(ds) {
  if (!ds) return '';
  if (ds.higherIsBetter == null) return 'Neutraal: telt niet mee in de totaalscore';
  const dir = ds.higherIsBetter ? 'Hoger = beter' : 'Lager = beter';
  return ds.inOverall === false ? `${dir} · telt niet mee in de totaalscore` : dir;
}

const UNIT_LABELS = {
  'aantal': 'aantal inwoners',
  'per km²': 'inwoners per km²',
  '%': 'procent (%)',
  '×€1.000': 'euro (CBS levert × € 1.000)',
  'per 1.000': 'per 1.000 inwoners',
  'km': 'kilometer',
  'misdrijven': 'aantal misdrijven',
  'score': 'score 0–100, relatief binnen gelijke gebieden',
};
/** Human unit text; crime datasets name both modes. */
export function unitLabel(ds) {
  const base = UNIT_LABELS[ds?.unit] ?? ds?.unit ?? '';
  return ds?.countKey ? `${base} · Absoluut: aantal misdrijven` : base;
}

/** One source as HTML: linked table id, table name, publisher and (when set) the view it serves. */
export function sourceHtml(src) {
  return `<a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.id)}</a> ${esc(src.name)} · ${esc(src.publisher)}${src.scope ? ` <span class="explain-scope">(${esc(src.scope)})</span>` : ''}`;
}

/** All searchable text of a dataset entry. */
export function entryText(ds) {
  return [ds.label, ds.title, ds.absTitle, ds.description, ds.formula, ds.absFormula, ds.year,
    ...(ds.caveats ?? []), ...(ds.source ?? []).flatMap(s => [s.id, s.name, s.publisher])].filter(Boolean).join(' ');
}

/** HTML of one metric entry (id explain-<key>). */
export function entryHtml(ds) {
  const abs = ds.countKey ? datasetFor(ds.key, 'abs') : null;
  const facts = [
    ['Eenheid', esc(unitLabel(ds))],
    ['Berekening', esc(ds.formula) + (abs ? `<br><span class="explain-abs">Absoluut: ${esc(abs.formula)}</span>` : '')],
    ['Bron', (ds.source ?? []).map(sourceHtml).join('<br>')],
    ['Peiljaar', esc(ds.year)],
    ['Ranglijst', esc(directionLabel(ds))],
  ];
  if (ds.scope === 'rotterdam') facts.push(['Gebied', 'Alleen Rotterdam (wijken en buurten)']);
  return `
    <article class="explain-entry" id="explain-${esc(ds.key)}" data-key="${esc(ds.key)}" data-text="${esc(normalizeText(entryText(ds)))}" tabindex="-1">
      <h4>${esc(ds.label)}${ds.title !== ds.label ? ` <small>${esc(ds.title)}</small>` : ''}</h4>
      <p>${esc(ds.description)}</p>
      <dl class="explain-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      ${ds.caveats?.length ? `<ul class="explain-caveats" aria-label="Let op">${ds.caveats.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    </article>`;
}

/** The general parts: score, crime modes, "geen data". [{ id, title, html, text }] */
export const GENERAL_SECTIONS = Object.freeze([
  {
    id: 'score',
    title: 'Hoe werkt de score',
    paragraphs: [
      'Per cijfer krijgt elk gebied een percentielscore van 0 tot 100 binnen de lijst die je bekijkt (alle wijken, of alle buurten): 100 = het beste gebied van de lijst, 0 = het slechtste, 50 = middenin. Gelijke waarden krijgen dezelfde score. Bij "lager = beter" (criminaliteit, bijstand, afstanden) wordt de score omgedraaid.',
      'De totaalscore is het gemiddelde van de scores op alle cijfers met een richting waarvoor het gebied een waarde heeft. Neutrale cijfers (inwoners, dichtheid, 65+, herkomst, koop en huur) en de sublagen van criminaliteit tellen niet mee. "7/8" naast de score betekent: gemiddeld over 7 van de 8 mogelijke cijfers.',
      'Met "Rangschik op" kies je de basis: de totaalscore of één cijfer. Rang "Vast" houdt die rangnummers vast als je op een kolom sorteert; "Volgt sortering" nummert de rijen opnieuw in de sortering (gelijke waarden delen een rang, gebieden zonder waarde staan onderaan zonder rang) en toont de score van die kolom.',
      'De Woonscore (de laag waarop de kaart opent) weegt de cijfers wel: veiligheid 35, welvaart 20, voorzieningen 25, opleiding 10 en koopwoningen 10. De totaalscore hierboven weegt alles gelijk ("Gelijk gewogen"). Bij buurten met weinig inwoners worden criminaliteit en bijstand naar de wijk toe getrokken; een gebied met data voor minder dan 60% van het gewicht krijgt geen Woonscore.',
      'Een score vergelijkt alleen binnen de lijst: een 90 voor een buurt betekent iets anders dan een 90 voor een wijk, en zegt niet hoe groot het verschil in werkelijkheid is.',
    ],
  },
  {
    id: 'crime-mode',
    title: 'Criminaliteit: per 1000 inwoners of absoluut',
    paragraphs: [
      'Per 1000 inwoners (standaard): misdrijven 2025 gedeeld door de inwoners van 2025, maal 1.000. Zo vergelijk je gebieden van verschillende grootte, maar gebieden waar veel mensen komen en weinig mensen wonen (Centrum, haven, winkel- en uitgaansgebieden) komen hoog uit. Wijken onder 1.000 en buurten onder 200 inwoners krijgen geen cijfer.',
      'Absoluut: het aantal door de politie geregistreerde misdrijven in 2025. Grote gebieden komen vanzelf hoger uit, maar elk gebied krijgt een waarde, ook met weinig inwoners. Het dashboard toont dan het Rotterdamse totaal in plaats van een gewogen gemiddelde.',
      'De schakelaar geldt voor alle criminaliteitslagen (totaal en sublagen) op de kaart, in de legenda, het paneel, het dashboard en de Ranglijst, inclusief de scores. Je keuze wordt onthouden en staat in de link (&crime=abs).',
    ],
  },
  {
    id: 'scale',
    title: 'Kleurschaal',
    paragraphs: [
      'Standaard kleurt de kaart in 7 klassen op rangorde (kwantielen): elke klasse bevat ongeveer even veel gebieden van de getoonde set (alle wijken of alle buurten, in de gekozen criminaliteitsweergave). De middelste klasse bevat de mediaan; de legenda toont per klasse van welke tot welke waarde die loopt. Zo krijgen 26 en 85 misdrijven per 1.000 een duidelijk andere kleur, ook als één gebied er 500 heeft.',
      'Uitschieters krijgen een rode rand bovenop hun kleur, en een rood stipje in de Ranglijst en een rode rand in het dashboard. Een uitschieter ligt buiten de Tukey-grenzen (anderhalf keer de afstand tussen het 25e en 75e percentiel, onder of boven die percentielen), gemeten op de gewone én op een logaritmische schaal; alleen wat op beide ver buiten de rest valt telt. Bij criminaliteit zijn dat vooral gebieden waar veel mensen komen en weinig wonen (Centrum, station, winkelcentra).',
      'Met "Schaal: Lineair" in de legenda zie je de oude kleuring van laagste naar hoogste waarde; een enkele uitschieter maakt dan bijna alles dezelfde kleur. Je keuze wordt onthouden.',
    ],
  },
  {
    id: 'herkomst-groepen',
    title: 'Herkomst: landengroepen (heel Rotterdam)',
    paragraphs: [
      'Herkomst volgt de CBS-definitie (sinds 2022): het eigen geboorteland; voor wie in Nederland is geboren het geboorteland van de moeder, of als zij ook in Nederland is geboren dat van de vader. Herkomst zegt dus iets over waar iemand of diens ouders zijn geboren, niet over nationaliteit, taal, religie of hoe iemand zich voelt. Kleinkinderen van migranten met twee in Nederland geboren ouders tellen als herkomst Nederland.',
      `Het Dashboard toont de bevolking van heel Rotterdam op 1 januari ${HERKOMST_YEAR} naar herkomstgroep, de grootste herkomstlanden en de groei sinds ${HERKOMST_FIRST_YEAR} (CBS ${HERKOMST_TABLE}). Per wijk en buurt levert CBS alleen Nederland, Europa (exclusief Nederland) en buiten Europa, plus wie in het buitenland is geboren; landengroepen per wijk bestaan niet als open data; een schatting via de postcode staat hieronder.`,
      'De groepen sluiten elkaar uit en tellen precies op tot het totaal. Samenstelling: ' + ORIGIN_GROUPS.map(g => `${g.label}: ${g.composition}.`).join(' '),
      'Kanttekeningen: CBS rekent Turkije en de Kaukasische en Centraal-Aziatische landen tot Azië. CBS levert van Noord-Afrika alleen Marokko en Egypte apart; Algerije, Tunesië, Libië en Soedan zitten daardoor in "Afrika bezuiden de Sahara" (in Rotterdam een kleine groep naast onder meer Kaapverdië en Somalië). De top 15 noemt alleen landen die CBS apart publiceert (45 landen); verzamelposten als "voormalig Joegoslavië" en "voormalige Sovjet-Unie" overlappen hun opvolgers en blijven buiten de top. De groei is het verschil tussen de aantallen op 1 januari en zegt niets over de oorzaak (migratie, geboorte, verhuizing, sterfte).',
    ],
  },
  {
    id: 'herkomst-postcode',
    title: `Herkomst per wijk en buurt: geschat via postcode (${PC4_YEAR})`,
    paragraphs: [
      `CBS publiceert landengroepen niet per wijk of buurt, wel per viercijferige postcode (CBS ${PC4_HERKOMST_TABLE}, 1 januari ${PC4_YEAR}). De lagen ${PC4_GROUPS.map(g => g.label).join(', ')} in de groep Herkomst schatten het aandeel per wijk en buurt: de inwoners van elk postcodegebied worden verdeeld over de buurten erin naar het aantal adressen per buurt (CBS-bestand postcode en huisnummer met buurt, wijk en gemeente ${PC4_YEAR}), en buurten tellen op tot wijken. Het detailblok in een gebied en de wizardstap Gemeenschap gebruiken dezelfde schatting.`,
      `Grenzen van de methode: binnen één postcodegebied wordt overal dezelfde mix aangenomen, dus verschillen tussen buurten met dezelfde postcode vallen weg. Adressen zijn geen inwoners: kantoren en bedrijfspanden tellen bij de verdeling mee. CBS rondt elk aantal per postcode af op 5 en laat kleine aantallen weg (hier als 0 geteld); onder ${PC4_MIN_POPULATION} geschatte inwoners toont de kaart geen waarde. De indeling is die van ${PC4_YEAR}: wijken en buurten van 2025 zonder dezelfde code in ${PC4_YEAR} (nieuw of opnieuw ingedeeld) krijgen geen gegevens, er wordt niets bijgeschat.`,
      `De tabel gebruikt de oude CBS-indeling "migratieachtergrond", met dezelfde basis als herkomst (eigen geboorteland, anders dat van de ouders). Turkije valt daarin onder Europa; "Europa buiten de EU" is hier daarom Europa min EU min Turkije. De cijfers zijn een schatting en niet één op één gelijk aan de nieuwere herkomstcijfers per gemeente.`,
    ],
  },
  {
    id: 'gemeenschap',
    title: 'Jouw score: nabijheid gemeenschap',
    paragraphs: [
      'In de wizard "Vind jouw ideale woonplek" is de laatste stap (Gemeenschap) optioneel en standaard uit; de Woonscore (Standaard) en "Gelijk gewogen" gebruiken herkomst nooit. Kies je er wel een groep, dan telt het aandeel inwoners van die groep (CBS-kerncijfers per wijk en buurt: Nederland, Europa excl. NL of buiten Europa; een land of landengroep per gemeente, en voor onder meer Suriname, Turkije en Marokko ook per wijk en buurt, geschat via de postcode) als plus mee, met een gewicht dat jij kiest (standaard 10% van het totaal, hoogstens 30%). Waar een niveau dat cijfer niet heeft, valt de factor weg en tellen de andere thema\'s naar verhouding zwaarder.',
      'Wat het niet doet: er is geen optie om een groep te vermijden of lager te laten wegen, ook niet via een aangepaste link, en een gebied staat nooit als zwak punt in de lijst omdat er minder mensen van een groep wonen. Het resultaat heet "nabijheid gemeenschap" en is geen etnische score van een gebied; het zijn totalen per gebied, niets over personen.',
      'Je score wordt in je browser berekend en er wordt niets verstuurd. Je keuze wordt op dit apparaat onthouden; in een gedeelde link staat ze alleen als je "Deel ook gemeenschap" aanvinkt.',
      'Specifieke herkomstgroep (zoals Suriname, Turkije of Marokko): CBS levert die per gemeente (tabel 85458NED, laatste jaar), niet per wijk of buurt. Op de Nederland-kaart telt dan het aandeel van die groep per gemeente. Op wijk- en buurtniveau telt de specifieke groep niet mee en wordt hij niet vervangen door een brede groep; wie dat wil kiest daarnaast zelf een brede groep, die dan alleen voor wijken en buurten telt.',
    ],
  },
  {
    id: 'situatie',
    title: 'Jouw score: mensen in een vergelijkbare situatie',
    paragraphs: [
      'De optionele stap "Jouw situatie" is standaard uit. Kies je een opleidingsniveau (laag, middelbaar of hoog), dan telt een groter aandeel inwoners met dat niveau als plus; het Standaard-thema Opleiding (meer hbo/wo = beter) vervalt dan voor jou. Vink je "ik ontvang bijstand" aan, dan telt bijstand per 1.000 inwoners als plus in plaats van als minpunt; dat cijfer is er alleen voor Rotterdamse wijken en buurten.',
      'Alleen een plus: een gebied krijgt nooit minpunten voor wie er woont. Je score wordt in je browser berekend en er wordt niets verstuurd; in een gedeelde link staat je situatie alleen als je "Deel ook mijn situatie" aanvinkt.',
    ],
  },
  {
    id: 'belang',
    title: 'Jouw score: hoe belangrijk is elk thema',
    paragraphs: [
      'Per thema kies je in vijf stappen hoe zwaar het weegt: niet belangrijk (telt niet mee), beetje (half), gemiddeld (zoals je antwoorden het zetten), belangrijk (anderhalf keer) of heel belangrijk (dubbel). Voor nabijheid gemeenschap zijn de stappen een vast aandeel van het totaal: 5, 10, 20 of 30 %.',
    ],
  },
  {
    id: 'nodata',
    title: 'Geen data en peiljaren',
    paragraphs: [
      'Grijs op de kaart, "geen data" of "—": er is geen cijfer. CBS en politie laten cijfers weg bij kleine aantallen (privacy), sommige cijfers zijn nog niet gepubliceerd, en per-1.000-cijfers vervallen onder een inwonergrens (bijstand en buurtcriminaliteit onder 200, wijkcriminaliteit onder 1.000 inwoners). In de Ranglijst staan zulke gebieden onderaan, zonder rang.',
      'Wijk- en buurtcijfers komen uit de CBS-kerncijfers 2025. Is een cijfer daar leeg, dan nemen we het cijfer uit de tabel 2024; inkomen en opleiding zijn voor 2025 nog niet gepubliceerd en komen daarom overal uit 2024. Het paneel toont per gebied welk jaar is gebruikt. De Nederland-weergave gebruikt CBS-cijfers van 2023.',
    ],
  },
].map(s => Object.freeze({ ...s, text: [s.title, ...s.paragraphs].join(' ') })));

/** Full body of the panel: one section per Layers group, then the general parts. */
export function explainBodyHtml(datasets = DATASETS) {
  const groups = groupDatasets(datasets).map(g => `
    <section class="explain-group" aria-labelledby="explain-g-${esc(g.key)}">
      <h3 id="explain-g-${esc(g.key)}">${esc(g.label)}</h3>
      ${g.datasets.map(entryHtml).join('')}
    </section>`).join('');
  const general = `
    <section class="explain-group" aria-labelledby="explain-g-algemeen">
      <h3 id="explain-g-algemeen">Algemeen</h3>
      ${GENERAL_SECTIONS.map(s => `
      <article class="explain-entry" id="explain-${s.id}" data-key="${s.id}" data-text="${esc(normalizeText(s.text))}" tabindex="-1">
        <h4>${esc(s.title)}</h4>
        ${s.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}
      </article>`).join('')}
    </section>`;
  return groups + general + '<p class="explain-empty" hidden>Geen uitleg gevonden.</p>';
}

/** Small (i) button that opens the panel at `key`. */
export function infoButton(key, label = '') {
  const text = `Uitleg: ${label || DATASETS[key]?.title || key}`;
  return `<button type="button" class="info-btn" data-explain="${esc(key)}" aria-label="${esc(text)}" title="${esc(text)}">i</button>`;
}

// ── Dialog ───────────────────────────────────────────────────────────────────

let els = null;
let returnFocus = null;
const FLASH_MS = 1600;

const isOpen = () => els && !els.modal.hidden;

function applyFilter() {
  const q = els.filter.value;
  let any = false;
  els.body.querySelectorAll('.explain-group').forEach(sec => {
    let shown = 0;
    sec.querySelectorAll('.explain-entry').forEach(en => {
      const hit = matchesQuery(en.dataset.text, q);
      en.hidden = !hit;
      if (hit) shown++;
    });
    sec.hidden = !shown;
    any ||= shown > 0;
  });
  els.body.querySelector('.explain-empty').hidden = any;
}

/** Opens the panel; with `key` (dataset key, 'score', 'crime-mode', 'nodata') scrolled to that entry. */
export function openExplain(key = null) {
  if (!els) return;
  if (!isOpen()) returnFocus = document.activeElement;
  els.modal.hidden = false;
  document.body.classList.add('explain-open');
  els.filter.value = '';
  applyFilter();
  const entry = key ? els.body.querySelector(`#explain-${CSS.escape(key)}`) : null;
  if (!entry) { els.body.scrollTop = 0; els.filter.focus(); return; }
  entry.scrollIntoView({ block: 'start' });
  entry.focus({ preventScroll: true });
  entry.classList.remove('is-flash');
  void entry.offsetWidth;
  entry.classList.add('is-flash');
  setTimeout(() => entry.classList.remove('is-flash'), FLASH_MS);
}

export function closeExplain() {
  if (!isOpen()) return;
  els.modal.hidden = true;
  document.body.classList.remove('explain-open');
  if (returnFocus && typeof returnFocus.focus === 'function' && document.contains(returnFocus)) returnFocus.focus();
  returnFocus = null;
}

function trapFocus(e) {
  const focusables = [...els.dialog.querySelectorAll('input, button, a[href], [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && (document.activeElement === first || !els.dialog.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** Builds the dialog once and wires the topnav button and every [data-explain] trigger. */
export function initExplain() {
  if (els || typeof document === 'undefined') return;
  const modal = document.createElement('div');
  modal.id = 'explain-modal';
  modal.className = 'search-modal explain-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="search-backdrop" data-explain-close></div>
    <div class="search-dialog explain-dialog" role="dialog" aria-modal="true" aria-labelledby="explain-title">
      <header class="explain-head">
        <h2 id="explain-title">Uitleg bij de cijfers</h2>
        <button class="search-close" type="button" data-explain-close aria-label="Sluiten">Esc</button>
      </header>
      <div class="search-field explain-search">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>
        <input type="search" class="explain-filter" placeholder="Filter, bijv. inkomen of 47018NED" aria-label="Filter de uitleg" autocomplete="off" spellcheck="false">
      </div>
      <div class="explain-body" tabindex="0" aria-label="Uitleg per cijfer">${explainBodyHtml()}</div>
    </div>`;
  document.body.appendChild(modal);
  els = {
    modal,
    dialog: modal.querySelector('.explain-dialog'),
    body: modal.querySelector('.explain-body'),
    filter: modal.querySelector('.explain-filter'),
  };
  els.filter.addEventListener('input', applyFilter);
  modal.addEventListener('click', e => { if (e.target.closest('[data-explain-close]')) closeExplain(); });
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeExplain(); return; }
    if (e.key === 'Tab') trapFocus(e);
  });
  document.querySelector('.explain-btn')?.addEventListener('click', () => openExplain());
  document.addEventListener('click', e => {
    const trigger = e.target.closest?.('[data-explain]');
    if (!trigger || modal.contains(trigger)) return;
    e.preventDefault();
    openExplain(trigger.dataset.explain);
  });
}
