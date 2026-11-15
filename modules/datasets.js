import { BOUW_SOURCE_URL, BOUW_MIN_DWELLINGS, OLD_BUILD_BEFORE, MODERN_BUILD_FROM } from './bouwjaar-pc4.js';
import { PC4_GROUPS, PC4_HERKOMST_TABLE, PC4_YEAR, PC4_MIN_POPULATION, pc4RegionComposition, regionAtBuurt } from './herkomst-pc4.js';
import { REGIONS, REGIO_TABLE, REGIO_YEAR, regionComposition } from './herkomst-regio.js';

const CBS_BASE = 'https://opendata.cbs.nl/ODataApi/odata';

export function buildCBSUrl(tableId, filter, select, top = null) {
  const params = new URLSearchParams({ $filter: filter });
  if (select) params.set('$select', select);
  if (top)    params.set('$top', top);
  return `${CBS_BASE}/${tableId}/TypedDataSet?${params}`;
}

export async function fetchCBS(
  tableId,
  filter,
  select  = null,
  fetcher = globalThis.fetch,
  storage = globalThis.sessionStorage,
  top     = null,
) {
  const url    = buildCBSUrl(tableId, filter, select, top);
  const cached = storage?.getItem(url);
  if (cached) return JSON.parse(cached);

  const res = await fetcher(url);
  if (!res.ok) throw new Error(`CBS ${res.status}`);
  const { value } = await res.json();
  storage?.setItem(url, JSON.stringify(value));
  return value;
}

// CBS table 70072ned (Regionale kerncijfers Nederland): the single source of
// truth for column keys. CBS renumbers keys when the table is restructured,
// so every select, normaliser and test reads from here. Re-check against
// https://opendata.cbs.nl/ODataApi/odata/70072ned/DataProperties when queries 500.
export const CBS_TABLE   = '70072ned';
export const CBS_PERIOD  = '2023JJ00';
export const CBS_COLUMNS = Object.freeze({
  region:           'RegioS',
  population:       'TotaleBevolking_1',                  // aantal
  avgIncome:        'BronInkomenAlsWerknemer_110',        // gem. gestandaardiseerd inkomen, bron werknemer, ×€1,000
  areaSqKm:         'TotaleOppervlakte_217',              // km²
  lowEdu:           'BasisonderwijsVmboMbo1_82',          // %
  medEdu:           'HavoVwoMbo24_83',                    // %
  highEdu:          'HboWo_84',                           // %
  wozValue:         'GemiddeldeWOZWaardeVanWoningen_63',  // ×€1,000
  totalJobs:        'TotaalBanen_85',                     // ×1,000
  age65to80:        'k_65Tot80Jaar_8',                    // aantal (was % before the 2024 restructure)
  age80plus:        'k_80JaarOfOuder_9',                  // aantal
  migrationBalance: 'Migratiesaldo_46',                   // aantal (immigratie − emigratie)
  originDutch:      'Nederland_14',                       // herkomstland Nederland, aantal
  originEurope:     'EuropaExclusiefNederland_15',        // herkomstland Europa excl. NL, aantal
  originOutsideEurope: 'BuitenEuropa_16',                 // herkomstland buiten Europa, aantal; replaces "niet-westerse migratieachtergrond"
});

export const CBS_SELECT = Object.values(CBS_COLUMNS).join(',');

const pct = (part, total) =>
  part != null && total ? +(part / total * 100).toFixed(1) : null;

export function normalizeProvinces(rows) {
  const C = CBS_COLUMNS;
  return rows.map(r => {
    const population = r[C.population];
    const area       = r[C.areaSqKm];
    const a65 = r[C.age65to80], a80 = r[C.age80plus];
    return {
      regionCode:       r[C.region].trim(),
      population,
      avgIncome:        r[C.avgIncome] ?? null,          // ×€1,000
      areaSqKm:         area,
      density:          area ? Math.round(population / area) : null,
      lowEdu:           r[C.lowEdu]  ?? null,            // % vmbo/mbo1 or below
      medEdu:           r[C.medEdu]  ?? null,            // % havo/vwo/mbo2-4
      highEdu:          r[C.highEdu] ?? null,            // % hbo/wo
      // Housing
      wozValue:         r[C.wozValue] ?? null,           // ×€1,000
      // Employment — column is ×1,000 so multiply back to actual jobs
      totalJobs:        r[C.totalJobs] != null ? Math.round(r[C.totalJobs] * 1000) : null,
      // Demographics — age bands are counts, convert the two 65+ bands to %
      pop65plus:        a65 != null && a80 != null ? pct(a65 + a80, population) : null,
      // Migration
      migrationBalance: r[C.migrationBalance] ?? null,
      // Herkomst buiten Europa (%) — key kept as nonWesternPct for the UI wiring
      nonWesternPct:    pct(r[C.originOutsideEurope], population),
      originDutchPct:   pct(r[C.originDutch], population),
      originEuropePct:  pct(r[C.originEurope], population),
    };
  });
}

const CRIME_CATEGORY_LABELS = {
  CRI1000: 'Vermogen',
  CRI1100: 'Diefstal/inbraak',
  CRI2000: 'Vernieling',
  CRI3000: 'Geweld',
  CRI3100: 'Mishandeling',
};

export function normalizeCrime(rows) {
  const totals = rows.filter(r => r.SoortMisdrijf === 'T001161');
  const cats   = rows.filter(r => r.SoortMisdrijf !== 'T001161');

  return totals
    .filter(r => r.GeregistreerdeMisdrijvenPer1000Inw_3 != null)
    .map(r => {
      const code = r.RegioS.trim();
      return {
        regionCode:  code,
        crimeRate:   r.GeregistreerdeMisdrijvenPer1000Inw_3,
        totalCrimes: r.TotaalGeregistreerdeMisdrijven_1,
        categories:  Object.entries(CRIME_CATEGORY_LABELS).map(([key, label]) => ({
          label,
          count: cats.find(c => c.RegioS.trim() === code && c.SoortMisdrijf === key)
            ?.TotaalGeregistreerdeMisdrijven_1 ?? null,
        })),
      };
    });
}

// ── Dataset metadata ──────────────────────────────────────────────────────────
// One entry per choropleth dataset in the Layers dropdown. `higherIsBetter`
// drives ranking direction: true = high values rank first as "good",
// false = low values are good (crime), null = neutral (no judgement).
// `group` places it under a heading in the Layers dropdown (DATASET_GROUPS).
// `scope: 'rotterdam'` = only the wijk/buurt tables have it; the Nederland
// view hides those layers. `inOverall: false` keeps a dataset out of the
// Ranglijst Totaalscore (the crime sub-layers would otherwise weigh crime 5×).
//
// Every dataset also carries the texts of the Uitleg panel (modules/explain.js):
// `description` (plain Dutch, what it measures and how to read it), `formula`,
// `source` (array of { id, name, publisher, url, scope }), `year` (peiljaar)
// and `caveats` (array). Crime datasets add `countKey` (the value key holding
// the raw count for the "Absoluut" mode), `absTitle` and `absFormula`.
// tests/explain.test.js fails when a dataset lacks a description or source.

const statline = id => `https://opendata.cbs.nl/statline/#/CBS/nl/dataset/${id}/table`;
const SRC = Object.freeze({
  kwb2025: Object.freeze({ id: '86165NED', name: 'Kerncijfers wijken en buurten 2025', publisher: 'CBS', url: statline('86165NED'), scope: 'Rotterdam' }),
  kwb2024: Object.freeze({ id: '85984NED', name: 'Kerncijfers wijken en buurten 2024', publisher: 'CBS', url: statline('85984NED'), scope: 'Rotterdam' }),
  regio:   Object.freeze({ id: '70072ned', name: 'Regionale kerncijfers Nederland', publisher: 'CBS', url: statline('70072ned'), scope: 'Nederland' }),
  crime:   Object.freeze({ id: '47018NED', name: 'Geregistreerde misdrijven; soort misdrijf, wijk, buurt', publisher: 'Politie (via CBS dataderden)', url: 'https://data.politie.nl/#/Politie/nl/dataset/47018NED/table', scope: 'Rotterdam' }),
  nabij2025: Object.freeze({ id: '86270NED', name: 'Nabijheid voorzieningen; afstand locatie, wijk- en buurtcijfers 2025', publisher: 'CBS', url: statline('86270NED'), scope: 'Rotterdam' }),
  nabij2024: Object.freeze({ id: '86134NED', name: 'Nabijheid voorzieningen; afstand locatie, wijk- en buurtcijfers 2024', publisher: 'CBS', url: statline('86134NED'), scope: 'Rotterdam' }),
  geo:     Object.freeze({ id: 'PDOK', name: 'CBS wijk- en buurtkaart (gebiedsgrenzen, via PDOK)', publisher: 'CBS / PDOK', url: 'https://www.pdok.nl/introductie/-/article/cbs-wijken-en-buurten', scope: 'Rotterdam' }),
  pc4:     Object.freeze({ id: PC4_HERKOMST_TABLE, name: 'Bevolking; geslacht, migratieachtergrond, viercijferige postcode, 1 januari', publisher: 'CBS', url: statline(PC4_HERKOMST_TABLE), scope: 'postcode' }),
  pc4bouw: Object.freeze({ id: 'PC4-2023', name: `Gegevens per postcode (PC4) ${PC4_YEAR}, woningen naar bouwjaar`, publisher: 'CBS', url: BOUW_SOURCE_URL, scope: 'postcode' }),
  pc6:     Object.freeze({ id: 'pc6huisnr', name: `Buurt, wijk en gemeente per postcode en huisnummer ${PC4_YEAR}`, publisher: 'CBS', url: `https://download.cbs.nl/postcode/${PC4_YEAR}-cbs_pc6huisnr.zip`, scope: 'postcode' }),
  herkomst: Object.freeze({ id: REGIO_TABLE, name: 'Bevolking; herkomstland, geboorteland, leeftijd, regio, 1 januari', publisher: 'CBS', url: statline(REGIO_TABLE), scope: 'Nederland (gemeenten)' }),
  crimeNl: Object.freeze({ id: '83648NED', name: 'Geregistreerde criminaliteit; soort misdrijf, regio', publisher: 'CBS', url: statline('83648NED'), scope: 'Nederland' }),
});

const FALLBACK_NOTE = 'Ontbreekt het 2025-cijfer voor een gebied, dan wordt het 2024-cijfer (85984NED) getoond; het paneel noemt dat onder Peiljaar.';
const CRIME_PLACE_NOTE = 'Per inwoner telt de plek van het misdrijf, niet waar daders of slachtoffers wonen: drukke gebieden met weinig bewoners (Centrum, Stadsdriehoek, haven-, winkel- en uitgaansgebieden) komen daardoor hoog uit. De stand Absoluut laat de aantallen zelf zien.';
const CRIME_MIN_NOTE = 'Geen per-1.000-cijfer voor wijken onder 1.000 en buurten onder 200 inwoners ("geen data"); in de stand Absoluut krijgen ze wel een waarde.';
const CRIME_SUB_NOTE = 'Telt niet mee in de totaalscore van de Ranglijst (anders weegt criminaliteit meerdere keren).';
const HERKOMST_DEF = 'Herkomst volgt de CBS-definitie (sinds 2022): het eigen geboorteland; voor wie in Nederland is geboren het geboorteland van de moeder, of als zij ook in Nederland is geboren dat van de vader. Wie in Nederland is geboren uit twee in Nederland geboren ouders heeft herkomst Nederland.';
const HERKOMST_NOTES = [
  'CBS rondt de wijk- en buurtaantallen af op vijftallen; Nederland, Europa en buiten Europa tellen daardoor niet altijd precies op tot 100 %.',
  'CBS rekent Turkije en de Kaukasische en Centraal-Aziatische landen van de voormalige Sovjet-Unie tot Azië, dus tot "buiten Europa".',
  'Landen en landengroepen (Turkije, Marokko, Suriname, Afrika bezuiden de Sahara …) zijn alleen voor heel Rotterdam beschikbaar (Dashboard, CBS 85458NED), niet per wijk of buurt.',
  'Beschrijvend: telt niet mee in de totaalscore van de Ranglijst.',
];
const TASTE_NOTE = 'Beschrijvend en een kwestie van smaak: telt niet mee in de totaalscore van de Ranglijst of de Woonscore Standaard.';
const NABIJ_NOTE = 'Ontbreekt het 2025-cijfer voor een gebied, dan wordt het 2024-cijfer (86134NED) getoond; het paneel noemt dat onder Peiljaar.';
const ROAD_NOTE = 'Gemeten over de weg, niet hemelsbreed; de dichtstbijzijnde voorziening kan buiten het gebied liggen.';
const ageInfo = (from, to) => ({
  description: `Het aandeel inwoners van ${from} tot en met ${to} jaar. Beschrijvend: er zit geen oordeel in. Samen met de andere leeftijdsgroepen laat het zien of een gebied jong, gemengd of vergrijsd is.`,
  formula: `inwoners van ${from} tot ${to + 1} jaar / inwoners × 100`,
  source: [SRC.kwb2025],
  year: '2025',
  caveats: [TASTE_NOTE, FALLBACK_NOTE],
});
const CRIME_CELL_NOTE = 'De politie laat sommige kleine aantallen weg; een opgetelde categorie is pas "geen data" als alle delen ontbreken.';

// Bouwstijl estimate (v0.29.0): texts shared by oldBuildPct and modernBuildPct.
const BOUW_DEF = 'CBS publiceert per wijk en buurt alleen of woningen in de laatste tien jaar zijn gebouwd; per viercijferige postcode telt CBS de woningen per bouwjaarklasse (vóór 1945, 1945–1965, …, 2015 en later). Deze app verdeelt de woningen van elk postcodegebied over de buurten erin naar het aantal adressen per buurt, en telt buurten op tot wijken.';
export const BOUW_NOTES = Object.freeze([
  'Schatting: binnen één postcodegebied wordt overal dezelfde bouwjaarmix aangenomen; een nieuwbouwbuurt naast een oude kern in dezelfde postcode krijgt een gemengd cijfer.',
  'Bouwjaar is geen bouwstijl: een gerenoveerd vooroorlogs blok telt als oud, een nieuw gebouw in oude stijl als modern. Wijken die in de oorlog verwoest zijn (zoals het centrum van Rotterdam) hebben weinig vooroorlogse woningen.',
  `CBS rondt de aantallen per postcode af op 5 en laat kleine aantallen weg (hier als 0 geteld). Onder ${BOUW_MIN_DWELLINGS} geschatte woningen: geen waarde.`,
  'Indeling 2023 en peiljaar 2023; buurten en wijken van 2025 zonder dezelfde code in 2023 hebben geen gegevens (er wordt niets bijgeschat).',
]);

const INFO = {
  population: {
    description: 'Het aantal inwoners dat op 1 januari in het gebied staat ingeschreven. Een groot getal betekent alleen een groot of dichtbevolkt gebied; het zegt niets over hoe goed het er is.',
    formula: 'Aantal inwoners (CBS)',
    source: [SRC.kwb2025, SRC.regio],
    year: '2025 (wijk/buurt) · 2023 (Nederland)',
    caveats: [FALLBACK_NOTE],
  },
  density: {
    description: 'Hoeveel mensen er per vierkante kilometer wonen. Hoog = dicht bebouwd en stedelijk; laag = ruim, groen of haven en industrie.',
    formula: 'inwoners / landoppervlakte in km² (CBS); Nederland-weergave: inwoners / totale oppervlakte',
    source: [SRC.kwb2025, SRC.regio],
    year: '2025 (wijk/buurt) · 2023 (Nederland)',
    caveats: ['De Nederland-weergave rekent met de totale oppervlakte inclusief water en komt daardoor lager uit dan de CBS-dichtheid.'],
  },
  pop15to24: ageInfo(15, 24),
  pop25to44: ageInfo(25, 44),
  pop45to64: ageInfo(45, 64),
  hhWithKidsPct: {
    description: 'Het aandeel huishoudens met thuiswonende kinderen (paren en eenoudergezinnen). Hoog = een gezinsbuurt. Beschrijvend: er zit geen oordeel in.',
    formula: 'huishoudens met kinderen / huishoudens totaal × 100',
    source: [SRC.kwb2025],
    year: '2025',
    caveats: ['Kinderen van elke leeftijd die nog thuis wonen tellen mee, ook volwassen kinderen.', TASTE_NOTE, FALLBACK_NOTE],
  },
  singleHhPct: {
    description: 'Het aandeel huishoudens van één persoon: wie alleen woont, van student tot weduwnaar. Hoog = veel mensen die solo wonen, vaak in de stad en dichter bij het centrum. Beschrijvend: er zit geen oordeel in.',
    formula: 'eenpersoonshuishoudens / huishoudens totaal × 100',
    source: [SRC.kwb2025],
    year: '2025',
    caveats: ['Studenten op kamers en mensen in een verzorgingshuis tellen ook als eenpersoonshuishouden.', TASTE_NOTE, FALLBACK_NOTE],
  },
  waterPct: {
    description: 'Het aandeel water in de totale oppervlakte van het gebied (plassen, singels, rivier, havens). Een ruwe maat voor ruimte en water om je heen. Beschrijvend: er zit geen oordeel in.',
    formula: 'oppervlakte water / (oppervlakte land + oppervlakte water) × 100',
    source: [SRC.kwb2025],
    year: '2025',
    caveats: ['Havens en de Maas tellen mee als water: een gebied aan de rivier komt hoog uit, ook als er zelf weinig groen is.', 'Parken en ander groen staan niet in deze cijfers; CBS publiceert bodemgebruik per buurt niet meer met de huidige indeling.', TASTE_NOTE, FALLBACK_NOTE],
  },
  newBuildPct: {
    description: 'Het aandeel woningen dat in de laatste tien jaar is gebouwd. Hoog = veel nieuwbouw; laag = een gebied met (vooral) oudere woningen. Beschrijvend: er zit geen oordeel in.',
    formula: 'woningen met een bouwjaar in de afgelopen tien jaar in % van de woningvoorraad (CBS)',
    source: [SRC.kwb2025],
    year: '2025',
    caveats: ['CBS publiceert per wijk en buurt alleen "afgelopen tien jaar" en "meer dan tien jaar geleden". Vooroorlogse en moderne bouw (vanaf 2005) staan in de lagen Oude bouw en Moderne bouw, geschat via postcode.', 'CBS laat het cijfer weg in gebieden met weinig woningen ("geen data").', TASTE_NOTE, FALLBACK_NOTE],
  },
  // Bouwstijl (v0.29.0, bouwjaar-pc4.js): building-year classes per postcode, split over buurten by addresses.
  oldBuildPct: {
    description: `Geschat aandeel woningen gebouwd vóór ${OLD_BUILD_BEFORE} (vooroorlogs): een maat voor "oudere bouw met karakter". ${BOUW_DEF} Beschrijvend: er zit geen oordeel in.`,
    formula: `woningen met bouwjaar vóór ${OLD_BUILD_BEFORE} / woningen totaal × 100, per postcode verdeeld naar adressen per buurt`,
    source: [SRC.pc4bouw, SRC.pc6],
    year: `${PC4_YEAR} (geschat via postcode)`,
    caveats: [...BOUW_NOTES, TASTE_NOTE],
  },
  modernBuildPct: {
    description: `Geschat aandeel woningen gebouwd in ${MODERN_BUILD_FROM} of later: een maat voor "moderne woningen". ${BOUW_DEF} Beschrijvend: er zit geen oordeel in.`,
    formula: `woningen met bouwjaar ${MODERN_BUILD_FROM} of later / woningen totaal × 100, per postcode verdeeld naar adressen per buurt`,
    source: [SRC.pc4bouw, SRC.pc6],
    year: `${PC4_YEAR} (geschat via postcode)`,
    caveats: [...BOUW_NOTES, TASTE_NOTE],
  },
  pop65plus: {
    description: 'Het aandeel inwoners van 65 jaar of ouder. Hoog = een vergrijsd gebied. Beschrijvend: er zit geen oordeel in.',
    formula: 'inwoners van 65 jaar of ouder / inwoners × 100',
    source: [SRC.kwb2025, SRC.regio],
    year: '2025 (wijk/buurt) · 2023 (Nederland)',
    caveats: [FALLBACK_NOTE],
  },
  originDutchPct: {
    description: 'Het aandeel inwoners met herkomst Nederland: in Nederland geboren, net als beide ouders. ' + HERKOMST_DEF,
    formula: 'inwoners met herkomst Nederland / inwoners × 100',
    source: [SRC.kwb2025, SRC.regio],
    year: '2025 (wijk/buurt) · 2023 (Nederland)',
    caveats: [...HERKOMST_NOTES, FALLBACK_NOTE],
  },
  originEuropePct: {
    description: 'Het aandeel inwoners met een herkomstland in Europa buiten Nederland (bijvoorbeeld Polen, Duitsland, Bulgarije, Portugal, Oekraïne). ' + HERKOMST_DEF,
    formula: 'inwoners met herkomst Europa (exclusief Nederland) / inwoners × 100',
    source: [SRC.kwb2025, SRC.regio],
    year: '2025 (wijk/buurt) · 2023 (Nederland)',
    caveats: [...HERKOMST_NOTES, FALLBACK_NOTE],
  },
  nonWesternPct: {
    description: 'Het aandeel inwoners met een herkomstland buiten Europa (onder meer Turkije, Marokko, Suriname, de Nederlandse Cariben, Kaapverdië, Indonesië, Syrië). ' + HERKOMST_DEF,
    formula: 'inwoners met herkomst buiten Europa / inwoners × 100',
    source: [SRC.kwb2025, SRC.regio],
    year: '2025 (wijk/buurt) · 2023 (Nederland)',
    caveats: ['Vervangt de oude CBS-indeling "niet-westerse migratieachtergrond"; niet één op één vergelijkbaar met oudere cijfers.', ...HERKOMST_NOTES, FALLBACK_NOTE],
  },
  bornAbroadPct: {
    description: 'Het aandeel inwoners dat zelf in het buitenland is geboren (de "eerste generatie"), ongeacht waar vandaan. De rest is in Nederland geboren: met herkomst Nederland of als kind van een in het buitenland geboren ouder. ' + HERKOMST_DEF,
    formula: '(geboren buiten Nederland met herkomst Europa + geboren buiten Nederland met herkomst buiten Europa) / inwoners × 100',
    source: [SRC.kwb2025],
    year: '2025',
    caveats: ['Iemand met herkomst Nederland is per definitie in Nederland geboren, dus deze twee CBS-kolommen dekken iedereen die in het buitenland is geboren.', ...HERKOMST_NOTES, FALLBACK_NOTE],
  },
  highEdu: {
    description: 'Het aandeel inwoners met hbo of wo als hoogst behaalde opleiding. Hoger telt in de Ranglijst als beter.',
    formula: 'hbo/wo / (laag + middelbaar + hoog) × 100; Nederland-weergave: CBS-percentage hbo/wo',
    source: [SRC.kwb2024, SRC.regio],
    year: '2024 (wijk/buurt) · 2023 (Nederland)',
    caveats: [
      'Wijk/buurt: CBS heeft opleiding voor 2025 nog niet gepubliceerd, daarom het cijfer uit de tabel 2024.',
      'CBS telt opleiding voor 15- tot 75-jarigen; het dashboard weegt de wijken naar alle inwoners.',
    ],
  },
  avgIncome: {
    description: 'Het gemiddelde gestandaardiseerde inkomen van huishoudens: het besteedbaar inkomen gecorrigeerd voor de grootte en samenstelling van het huishouden, zodat alleenstaanden en gezinnen vergelijkbaar zijn. Hoger = welvarender.',
    formula: 'Gemiddeld gestandaardiseerd inkomen van particuliere huishoudens (CBS), × € 1.000',
    source: [SRC.kwb2024, SRC.regio],
    year: '2024 (wijk/buurt) · 2023 (Nederland)',
    caveats: [
      'Wijk/buurt: CBS heeft het inkomen voor 2025 nog niet gepubliceerd, daarom het cijfer uit de tabel 2024.',
      'De Nederland-weergave gebruikt een ander CBS-cijfer (inkomen als werknemer, 70072ned); niet vergelijkbaar met de wijkcijfers.',
      'CBS laat het cijfer weg in gebieden met weinig huishoudens ("geen data").',
    ],
  },
  wozValue: {
    description: 'De gemiddelde WOZ-waarde van woningen: de waarde die de gemeente voor de belastingen vaststelt, een benadering van de huizenprijs. Hoger telt als beter (welvaart), maar betekent ook duurder wonen.',
    formula: 'Gemiddelde WOZ-waarde van woningen (CBS), × € 1.000',
    source: [SRC.kwb2025, SRC.regio],
    year: '2025 (wijk/buurt) · 2023 (Nederland)',
    caveats: ['De dashboard-KPI "WOZ 2026" komt uit CBS 85036NED (peildatum 1 januari 2026) en geldt alleen voor heel Rotterdam.', FALLBACK_NOTE],
  },
  ownerOccupiedPct: {
    description: 'Het aandeel koopwoningen in de woningvoorraad. Beschrijvend: er zit geen oordeel in.',
    formula: 'koopwoningen in % van alle woningen (CBS)',
    source: [SRC.kwb2025],
    year: '2025',
    caveats: ['Koop en huur tellen niet altijd op tot 100 %: woningen met onbekend eigendom vallen in geen van beide.'],
  },
  rentalPct: {
    description: 'Het aandeel huurwoningen (corporatie en particulier) in de woningvoorraad. Beschrijvend: er zit geen oordeel in.',
    formula: 'huurwoningen in % van alle woningen (CBS)',
    source: [SRC.kwb2025],
    year: '2025',
    caveats: ['Koop en huur tellen niet altijd op tot 100 %: woningen met onbekend eigendom vallen in geen van beide.'],
  },
  welfarePer1000: {
    description: 'Het aantal inwoners met een bijstandsuitkering per 1.000 inwoners. Lager telt als beter.',
    formula: 'personen met bijstand / inwoners × 1.000',
    source: [SRC.kwb2025],
    year: '2025',
    caveats: ['Geen cijfer voor gebieden onder 200 inwoners ("geen data").', FALLBACK_NOTE],
  },
  crimeRate: {
    description: 'Alle door de politie geregistreerde misdrijven in 2025 in het gebied, per 1.000 inwoners. Lager telt als beter. In de stand Absoluut: het aantal misdrijven zelf.',
    formula: 'misdrijven 2025 / inwoners 2025 × 1.000',
    absTitle: 'Misdrijven (aantal)',
    absFormula: 'aantal geregistreerde misdrijven in 2025',
    countKey: 'totalCrimes',
    source: [SRC.crime, SRC.crimeNl],
    year: '2025 (wijk/buurt) · 2023 (Nederland)',
    caveats: [
      CRIME_PLACE_NOTE, CRIME_MIN_NOTE,
      'Alleen geregistreerde misdrijven: wat niet wordt aangegeven, telt niet mee.',
      'De trend in het paneel is de verandering van het totaal ten opzichte van 2024.',
    ],
  },
  crimeBurglary: {
    description: 'Diefstal en inbraak uit woningen (politiecategorie 1.1.1) per 1.000 inwoners. Lager telt als beter.',
    formula: 'woninginbraken 2025 / inwoners 2025 × 1.000',
    absTitle: 'Woninginbraak (aantal)',
    absFormula: 'aantal woninginbraken in 2025',
    countKey: 'crimeBurglaryCount',
    source: [SRC.crime],
    year: '2025',
    caveats: [CRIME_SUB_NOTE, CRIME_MIN_NOTE],
  },
  crimeBike: {
    description: 'Diefstal van fietsen, brommers en snorfietsen (politiecategorie 1.2.3) per 1.000 inwoners. Lager telt als beter.',
    formula: 'fietsendiefstallen 2025 / inwoners 2025 × 1.000',
    absTitle: 'Fietsendiefstal (aantal)',
    absFormula: 'aantal diefstallen van (brom-, snor)fietsen in 2025',
    countKey: 'crimeBikeCount',
    source: [SRC.crime],
    year: '2025',
    caveats: [CRIME_SUB_NOTE, 'Stations, winkelstraten en uitgaansgebieden met weinig bewoners komen per inwoner hoog uit.', CRIME_MIN_NOTE],
  },
  crimePickpocket: {
    description: 'Zakkenrollerij (politiecategorie 1.2.4) per 1.000 inwoners. Lager telt als beter.',
    formula: 'zakkenrollerijen 2025 / inwoners 2025 × 1.000',
    absTitle: 'Zakkenrollerij (aantal)',
    absFormula: 'aantal zakkenrollerijen in 2025',
    countKey: 'crimePickpocketCount',
    source: [SRC.crime],
    year: '2025',
    caveats: [CRIME_SUB_NOTE, 'Gebeurt vooral waar het druk is (Centrum, stations, markten), niet waar mensen wonen; per inwoner overdreven hoog in die gebieden.', CRIME_MIN_NOTE, CRIME_CELL_NOTE],
  },
  crimeViolence: {
    description: 'Alle geweldsmisdrijven per 1.000 inwoners: zeden, moord en doodslag, openlijk geweld, bedreiging, mishandeling, straatroof en overval (politiecategorieën 1.4.1 tot en met 1.4.7). Lager telt als beter.',
    formula: 'geweldsmisdrijven 2025 / inwoners 2025 × 1.000',
    absTitle: 'Geweldsmisdrijven (aantal)',
    absFormula: 'aantal geweldsmisdrijven in 2025 (som van 1.4.1–1.4.7)',
    countKey: 'crimeViolenceCount',
    source: [SRC.crime],
    year: '2025',
    caveats: [CRIME_SUB_NOTE, CRIME_PLACE_NOTE, CRIME_MIN_NOTE, CRIME_CELL_NOTE],
  },
  crimeStreetRobbery: {
    description: 'Straatroof: beroving op straat met geweld of bedreiging (politiecategorie 1.4.6) per 1.000 inwoners. Lager telt als beter. In de stand Absoluut: het aantal zelf.',
    formula: 'straatroven 2025 / inwoners 2025 × 1.000',
    absTitle: 'Straatroof (aantal)',
    absFormula: 'aantal straatroven in 2025',
    countKey: 'crimeStreetRobberyCount',
    source: [SRC.crime],
    year: '2025',
    caveats: [CRIME_SUB_NOTE, 'Telt ook mee in Geweldsmisdrijven.', 'Kleine aantallen: in veel buurten 0 of enkele per jaar, dus een paar incidenten verschuiven de rang sterk.', CRIME_MIN_NOTE, CRIME_CELL_NOTE],
  },
  crimeThreat: {
    description: 'Bedreiging van personen (politiecategorie 1.4.4) per 1.000 inwoners. Lager telt als beter. In de stand Absoluut: het aantal zelf.',
    formula: 'bedreigingen 2025 / inwoners 2025 × 1.000',
    absTitle: 'Bedreiging (aantal)',
    absFormula: 'aantal bedreigingen in 2025',
    countKey: 'crimeThreatCount',
    source: [SRC.crime],
    year: '2025',
    caveats: [CRIME_SUB_NOTE, 'Telt ook mee in Geweldsmisdrijven.', CRIME_MIN_NOTE, CRIME_CELL_NOTE],
  },
  crimeVehicle: {
    description: 'Diefstal uit of vanaf auto’s en andere motorvoertuigen (bijvoorbeeld inbraak in een auto, diefstal van onderdelen of kentekenplaten) (politiecategorie 1.2.1) per 1.000 inwoners. Lager telt als beter. In de stand Absoluut: het aantal zelf.',
    formula: 'diefstallen uit/vanaf motorvoertuigen 2025 / inwoners 2025 × 1.000',
    absTitle: 'Diefstal uit auto (aantal)',
    absFormula: 'aantal diefstallen uit/vanaf motorvoertuigen in 2025',
    countKey: 'crimeVehicleCount',
    source: [SRC.crime],
    year: '2025',
    caveats: [CRIME_SUB_NOTE, 'Telt waar de auto stond: parkeergebieden en drukke straten komen hoog uit.', CRIME_MIN_NOTE, CRIME_CELL_NOTE],
  },
  crimeShoplifting: {
    description: 'Winkeldiefstal (politiecategorie 2.5.2) per 1.000 inwoners. Lager telt als beter. In de stand Absoluut: het aantal zelf.',
    formula: 'winkeldiefstallen 2025 / inwoners 2025 × 1.000',
    absTitle: 'Winkeldiefstal (aantal)',
    absFormula: 'aantal winkeldiefstallen in 2025',
    countKey: 'crimeShopliftingCount',
    source: [SRC.crime],
    year: '2025',
    caveats: [CRIME_SUB_NOTE, 'Hangt vooral af van het aantal winkels: winkelgebieden komen hoog uit, woonbuurten zonder winkels laag.', 'Hangt ook af van hoe vaak winkels aangifte doen.', CRIME_MIN_NOTE, CRIME_CELL_NOTE],
  },
  crimeVandalism: {
    description: 'Vernieling en zaakbeschadiging (bijvoorbeeld van auto’s, bushokjes, ruiten) (politiecategorie 2.2.1) per 1.000 inwoners. Lager telt als beter. In de stand Absoluut: het aantal zelf.',
    formula: 'vernielingen 2025 / inwoners 2025 × 1.000',
    absTitle: 'Vernieling (aantal)',
    absFormula: 'aantal vernielingen in 2025',
    countKey: 'crimeVandalismCount',
    source: [SRC.crime],
    year: '2025',
    caveats: [CRIME_SUB_NOTE, CRIME_MIN_NOTE, CRIME_CELL_NOTE],
  },
  crimeDrugs: {
    description: 'Drugshandel (politiecategorie 3.1.1) per 1.000 inwoners. Lager telt als beter. In de stand Absoluut: het aantal zelf.',
    formula: 'drugshandelzaken 2025 / inwoners 2025 × 1.000',
    absTitle: 'Drugshandel (aantal)',
    absFormula: 'aantal drugshandelzaken in 2025',
    countKey: 'crimeDrugsCount',
    source: [SRC.crime],
    year: '2025',
    caveats: [CRIME_SUB_NOTE, 'Gaat om door de politie ontdekte handel: het cijfer volgt ook waar de politie actief zoekt, niet alleen hoeveel er wordt gehandeld.', CRIME_MIN_NOTE, CRIME_CELL_NOTE],
  },
  crimeDensity: {
    description: 'Alle geregistreerde misdrijven in 2025 per vierkante kilometer land van het gebied. Lager telt als beter. Anders dan het cijfer per 1.000 inwoners werkt dit ook voor haven-, bedrijven- en stationsgebieden waar bijna niemand woont: daar zegt een cijfer per inwoner niets.',
    formula: 'misdrijven 2025 / landoppervlakte in km² (CBS, hectare / 100)',
    source: [SRC.crime, SRC.kwb2025],
    year: '2025',
    caveats: [
      'Water telt niet mee, alleen land. Een groot gebied met veel open terrein (haven, polder, park) komt laag uit, ook als de misdrijven op één plek gebeuren.',
      'Beschrijvend naast het cijfer per 1.000 inwoners; telt niet mee in de totaalscore van de Ranglijst en niet in de Woonscore.',
      FALLBACK_NOTE,
    ],
  },
  crimeNearby: {
    description: 'Hoeveel misdrijven er gebeuren in het gebied samen met de aangrenzende gebieden, per km² land. Lager telt als beter. Zo telt mee dat een woonbuurt naast een druk station, een uitgaansgebied of een haven- of bedrijventerrein de criminaliteit van daar dichtbij heeft, ook al woont er in dat buurgebied bijna niemand. Telt mee in de Woonscore (thema Veiligheid, bescheiden gewicht naast de eigen cijfers).',
    formula: '(misdrijven gebied + misdrijven aangrenzende gebieden) / (km² land gebied + km² land aangrenzende gebieden). Aangrenzend = een stuk gemeenschappelijke grens (een hoekpunt is niet genoeg), zelfde niveau: buurten met buurten, wijken met wijken, ook als dat buurgebied geen woonwijk is.',
    source: [SRC.crime, SRC.kwb2025, SRC.geo],
    year: '2025 (misdrijven, oppervlakte) · indeling 2024 (Rotterdam-kaart) / 2025 (Nederland)',
    caveats: [
      'Een groot buurgebied telt mee met zijn eigen dichtheid: 800 misdrijven op 30 km² haven wegen minder dan 300 op 1 km² rond een station.',
      'Rotterdam-weergave: buren buiten de gemeentegrens (Schiedam, Capelle, Barendrecht …) tellen niet mee, want alleen de Rotterdamse kaart is geladen. In de Nederland-weergave tellen buren in andere gemeenten wel mee.',
      'Buurten aan weerszijden van de Maas of een havenbekken grenzen in het water aan elkaar en tellen dus als buren.',
      'Gebieden zonder misdrijvencijfer of oppervlakte tellen niet mee in de som.',
    ],
  },
  woonscore: {
    description: 'Eén cijfer van 0 tot 100 voor hoe prettig je er gemiddeld woont, vergeleken met gelijke gebieden: gemeenten met gemeenten, wijken met wijken, buurten met buurten. 100 = het beste gebied van de lijst, 0 = het slechtste. Opgebouwd uit veiligheid (35, waarvan een zesde de criminaliteit in de omgeving: het gebied plus de aangrenzende gebieden), welvaart (20), voorzieningen (25), opleiding (10) en koopwoningen (10). Smaakkwesties zoals drukte, leeftijd, herkomst en de WOZ-waarde tellen niet mee. Met "Vind jouw ideale woonplek" pas je de gewichten aan je eigen wensen aan (levenstype, budget, vervoer, drukte, misdrijven); de kaart toont dan "Woonscore · jouw wensen". Reset in de legenda zet hem terug op Standaard.',
    formula: 'per cijfer de percentielscore binnen de lijst (omgedraaid bij lager = beter); Woonscore = 100 × Σ gewicht × score / Σ gewicht over de cijfers met data. Een themagewicht wordt verdeeld over de cijfers van dat thema die er zijn.',
    source: [SRC.kwb2025, SRC.crime, SRC.regio, SRC.crimeNl],
    year: '2023–2025 (zie de onderliggende cijfers)',
    caveats: [
      'Een score is relatief: een 80 voor een buurt is iets anders dan een 80 voor een gemeente, en zegt niet hoe groot het verschil in werkelijkheid is.',
      'In de Nederland-weergave zijn er minder cijfers (misdrijven totaal, inkomen, opleiding); de gewichten worden dan herverdeeld.',
      'Weinig inwoners: bij buurten worden criminaliteit en bijstand naar de wijk toe getrokken (gewicht inwoners / (inwoners + 300)), zodat een paar incidenten in een kleine buurt de score niet domineren.',
      'Een gebied met data voor minder dan 60% van het gewicht krijgt geen score (onvoldoende data).',
      'Geen woonwijk: bedrijven-, haven- en recreatiegebieden en vrijwel onbewoonde wijken en buurten (weinig inwoners en woningen, veel niet-woningen) krijgen geen score en tellen niet mee als vergelijkingsgebied.',
      'Jouw wensen: budget en drukte zijn een doelwaarde (hoe dichter erbij, hoe hoger; 0 op twee toleranties afstand) en relatief binnen de lijst. Het budget is een ruwe vuistregel (ongeveer 4,5 × het bruto huishoudinkomen, vergeleken met de gemiddelde WOZ-waarde); "Verberg duidelijk te duur" maakt gebieden met een WOZ boven 1,2 × je budget grijs.',
      'Je antwoorden blijven in je browser (localStorage) en in de link; er wordt niets verstuurd.',
    ],
  },
  distGP: {
    description: 'De gemiddelde afstand over de weg van de inwoners tot de dichtstbijzijnde huisartsenpraktijk. Lager telt als beter.',
    formula: 'gemiddelde wegafstand in km, gemiddeld over de inwoners (CBS nabijheidsstatistiek)',
    source: [SRC.kwb2025],
    year: '2025 (kerncijfers-tabel)',
    caveats: ['Gemeten over de weg, niet hemelsbreed; de dichtstbijzijnde praktijk kan buiten het gebied liggen.'],
  },
  distSupermarket: {
    description: 'De gemiddelde afstand over de weg van de inwoners tot de dichtstbijzijnde grote supermarkt. Lager telt als beter.',
    formula: 'gemiddelde wegafstand in km, gemiddeld over de inwoners (CBS nabijheidsstatistiek)',
    source: [SRC.kwb2025],
    year: '2025 (kerncijfers-tabel)',
    caveats: ['Alleen grote supermarkten volgens de CBS-definitie: een winkel met meerdere soorten dagelijkse artikelen en minimaal 150 m² oppervlakte. Kleinere buurtwinkels tellen niet mee.'],
  },
  distSchool: {
    description: 'De gemiddelde afstand over de weg van de inwoners tot de dichtstbijzijnde basisschool. Lager telt als beter.',
    formula: 'gemiddelde wegafstand in km, gemiddeld over de inwoners (CBS nabijheidsstatistiek, basisonderwijs)',
    source: [SRC.kwb2025, SRC.nabij2025],
    year: '2025 (kerncijfers-tabel)',
    caveats: [ROAD_NOTE, 'Elke basisschool telt, ook een school met een bijzondere grondslag of een speciale school; of er plek is, zegt het cijfer niet.', FALLBACK_NOTE],
  },
  distKinderopvang: {
    description: 'De gemiddelde afstand over de weg van de inwoners tot het dichtstbijzijnde kinderdagverblijf. Lager telt als beter.',
    formula: 'gemiddelde wegafstand in km, gemiddeld over de inwoners (CBS nabijheidsstatistiek, kinderdagverblijf)',
    source: [SRC.kwb2025, SRC.nabij2025],
    year: '2025 (kerncijfers-tabel)',
    caveats: [ROAD_NOTE, 'Alleen kinderdagverblijven (0–4 jaar); buitenschoolse opvang en gastouders tellen niet mee. Wachtlijsten ziet het cijfer niet.', FALLBACK_NOTE],
  },
  distStation: {
    description: 'De gemiddelde afstand over de weg van de inwoners tot het dichtstbijzijnde treinstation (alle stations, ook kleine). Lager telt als beter.',
    formula: 'gemiddelde wegafstand in km tot een treinstation, gemiddeld over de inwoners (CBS nabijheid voorzieningen)',
    source: [SRC.nabij2025, SRC.nabij2024],
    year: '2025',
    caveats: [ROAD_NOTE, 'Alleen treinstations: metro, tram en bus tellen niet mee, terwijl die in Rotterdam vaak dichterbij zijn.', NABIJ_NOTE],
  },
  distCafe: {
    description: 'De gemiddelde afstand over de weg van de inwoners tot het dichtstbijzijnde café, bar of kroeg. Klein = uitgaan om de hoek; groot = rustig. Beschrijvend: of dat goed is, hangt af van wat je zoekt.',
    formula: 'gemiddelde wegafstand in km tot een café e.d., gemiddeld over de inwoners (CBS nabijheid voorzieningen)',
    source: [SRC.nabij2025, SRC.nabij2024],
    year: '2025',
    caveats: [ROAD_NOTE, TASTE_NOTE, NABIJ_NOTE],
  },
  horeca1km: {
    description: 'Hoeveel cafés en restaurants er binnen 1 km over de weg liggen, gemiddeld over de inwoners. Hoog = levendig, veel uitgaan en eten in de buurt; laag = rustig wonen. Beschrijvend: er zit geen oordeel in.',
    formula: 'gemiddeld aantal cafés e.d. binnen 1 km + gemiddeld aantal restaurants binnen 1 km (CBS nabijheid voorzieningen)',
    source: [SRC.nabij2025, SRC.nabij2024],
    year: '2025',
    caveats: ['Cafetaria’s, snackbars en hotels tellen niet mee.', TASTE_NOTE, NABIJ_NOTE],
  },
  distCentrum: {
    description: 'Hemelsbrede afstand van het midden van het gebied tot Rotterdam Centraal. Klein = midden in de stad; groot = aan de rand. Beschrijvend: of dat goed is, hangt af van wat je zoekt.',
    formula: 'afstand in km over het aardoppervlak van het zwaartepunt van de gebiedsgrens tot Rotterdam Centraal (51,9244 N, 4,4690 O)',
    source: [SRC.geo],
    year: 'indeling 2024',
    caveats: ['Berekend door deze app uit de kaart, geen CBS-cijfer. Het zwaartepunt van een groot of langgerekt gebied (havens, Hoek van Holland) kan ver van de woningen liggen.', 'Hemelsbreed: de Maas en de havens kunnen de werkelijke reisafstand veel groter maken.', TASTE_NOTE],
  },
};

// Detailed herkomst per wijk/buurt, estimated from postcode data (v0.25.0, herkomst-pc4.js).
const PC4_DEF = 'CBS publiceert landengroepen niet per wijk of buurt, wel per viercijferige postcode. Deze app verdeelt de inwoners van elk postcodegebied over de buurten erin naar het aantal adressen per buurt, en telt buurten op tot wijken.';
export const PC4_NOTES = Object.freeze([
  'Schatting: binnen één postcodegebied wordt overal dezelfde mix aangenomen; een buurt die anders is dan de rest van haar postcode valt weg tegen het gemiddelde.',
  'Adressen zijn geen inwoners: kantoren en bedrijfspanden tellen ook mee bij de verdeling.',
  `CBS rondt de aantallen per postcode af op 5 en laat kleine aantallen weg (hier als 0 geteld). Onder ${PC4_MIN_POPULATION} geschatte inwoners: geen waarde.`,
  'Indeling 2023 en peildatum 1 januari 2023; buurten en wijken van 2025 zonder dezelfde code in 2023 hebben geen gegevens (er wordt niets bijgeschat).',
  'Oude CBS-indeling "migratieachtergrond" (zelfde basis als herkomst: eigen geboorteland, anders dat van de ouders); niet één op één gelijk aan de nieuwe herkomstcijfers per gemeente.',
]);
for (const g of PC4_GROUPS) {
  INFO[g.metric] = {
    description: `Geschat aandeel inwoners met herkomst ${g.label}${g.about ? ` (${g.about})` : ''}. ${PC4_DEF} Beschrijvend: er zit geen oordeel in.`,
    formula: `inwoners met herkomst ${g.label} / inwoners × 100, per postcode verdeeld naar adressen per buurt`,
    source: [SRC.pc4, SRC.pc6],
    year: `${PC4_YEAR} (geschat via postcode)`,
    caveats: [...PC4_NOTES],
  };
}

// World regions (v0.28.0, herkomst-regio.js): one country → region table for every level.
// Per gemeente CBS 85458NED (45 named countries); per wijk/buurt the postcode estimate
// (eight named countries), so a region holds fewer countries there.
export const REGIO_NOTES = Object.freeze([
  'Een regio telt alleen landen die CBS apart levert; de rest van een werelddeel staat onder "Overig" en wordt nooit over de regio\'s verdeeld.',
  'Per wijk en buurt kent CBS alleen werelddelen en acht landen (Suriname, Turkije, Marokko, Nederlandse Cariben, Indonesië, Polen, Duitsland, België), geschat via postcode. Een regio bevat daar dus minder landen dan per gemeente, en "Overig" meer. Regio\'s zonder een van die acht landen hebben per wijk en buurt geen waarde; er wordt geen gemeentemix naar buurten doorgerekend.',
  'Verzamelposten als "voormalig Joegoslavië" en "voormalige Sovjet-Unie" overlappen hun opvolgers en tellen niet mee in een regio.',
  'Turkije hoort volgens CBS en de VN bij Azië (West-Azië); ook per wijk/buurt telt Turkije bij West-Azië en niet bij Europa.',
]);
for (const r of REGIONS) {
  const buurt = pc4RegionComposition(r.key);
  INFO[r.metric] = {
    description: `Aandeel inwoners met herkomst ${r.label}. Per gemeente telt: ${regionComposition(r.key)}. ${buurt ? `Per wijk en buurt (geschat via postcode ${PC4_YEAR}) telt: ${buurt}.` : 'Per wijk en buurt niet beschikbaar: geen van de landen in deze regio staat apart in de postcodecijfers.'} Herkomst volgt de CBS-definitie: het eigen geboorteland, of bij geboorte in Nederland dat van de moeder (anders de vader). Beschrijvend: er zit geen oordeel in.`,
    formula: `inwoners met herkomst in ${r.label} / inwoners × 100; per wijk/buurt per postcode verdeeld naar adressen`,
    source: buurt ? [SRC.herkomst, SRC.pc4, SRC.pc6] : [SRC.herkomst],
    year: `gemeente ${REGIO_YEAR}${buurt ? `, wijk/buurt ${PC4_YEAR} (geschat via postcode)` : ''}`,
    caveats: [...REGIO_NOTES, ...(buurt ? PC4_NOTES : [])],
  };
}

const freezeInfo = info => info ? { ...info, source: Object.freeze([...(info.source ?? [])]), caveats: Object.freeze([...(info.caveats ?? [])]) } : {};
const ds = (key, label, title, unit, higherIsBetter, group, extra = {}) =>
  Object.freeze({ key, label, title, unit, higherIsBetter, group, scope: 'all', inOverall: true, ...freezeInfo(INFO[key]), ...extra });
const RTM = { scope: 'rotterdam' };

export const DATASETS = Object.freeze({
  woonscore:        ds('woonscore',        'Woonscore',            'Woonscore (0–100, t.o.v. gelijke gebieden)', 'score', true, 'score', { inOverall: false }),
  population:       ds('population',       'Bevolking',            'Inwoners',                        'aantal',    null,  'bevolking'),
  density:          ds('density',          'Bevolkingsdichtheid',  'Inwoners per km²',                'per km²',   null,  'bevolking'),
  pop15to24:        ds('pop15to24',        '15–24 jaar (%)',       '15 tot 25 jaar (%)',              '%',         null,  'bevolking', { ...RTM, inOverall: false }),
  pop25to44:        ds('pop25to44',        '25–44 jaar (%)',       '25 tot 45 jaar (%)',              '%',         null,  'bevolking', { ...RTM, inOverall: false }),
  pop45to64:        ds('pop45to64',        '45–64 jaar (%)',       '45 tot 65 jaar (%)',              '%',         null,  'bevolking', { ...RTM, inOverall: false }),
  pop65plus:        ds('pop65plus',        '65+ (%)',              '65+ (%)',                         '%',         null,  'bevolking'),
  hhWithKidsPct:    ds('hhWithKidsPct',    'Gezinnen (%)',         'Huishoudens met kinderen (%)',    '%',         null,  'bevolking', { ...RTM, inOverall: false }),
  singleHhPct:      ds('singleHhPct',      'Alleenwonenden (%)',   'Eenpersoonshuishoudens (%)',      '%',         null,  'bevolking', { ...RTM, inOverall: false }),
  originDutchPct:   ds('originDutchPct',   'Nederlands (%)',       'Herkomst Nederland (%)',          '%',         null,  'herkomst', { inOverall: false }),
  originEuropePct:  ds('originEuropePct',  'Europa excl. NL (%)',  'Herkomst Europa excl. NL (%)',    '%',         null,  'herkomst', { inOverall: false }),
  nonWesternPct:    ds('nonWesternPct',    'Buiten Europa (%)',    'Herkomst buiten Europa (%)',      '%',         null,  'herkomst', { inOverall: false }),
  bornAbroadPct:    ds('bornAbroadPct',    'Buitenland geboren (%)', 'In het buitenland geboren (%)', '%',         null,  'herkomst', { ...RTM, inOverall: false }),
  ...Object.fromEntries(REGIONS.map(r => [r.metric, ds(r.metric, `${r.label} (%)`, `Herkomst ${r.label} (%${regionAtBuurt(r.key) ? '' : ', alleen per gemeente'})`, '%', null, 'herkomstRegio', regionAtBuurt(r.key) ? { inOverall: false } : { scope: 'nederland', inOverall: false })])),
  ...Object.fromEntries(PC4_GROUPS.map(g => [g.metric, ds(g.metric, `${g.label} (%)`, `Herkomst ${g.label} (%, geschat via postcode ${PC4_YEAR})`, '%', null, 'herkomst', { ...RTM, inOverall: false, estimated: true })])),
  highEdu:          ds('highEdu',          'Opleiding',            'Hoog opgeleid (%)',               '%',         true,  'bevolking'),
  avgIncome:        ds('avgIncome',        'Inkomen',              'Gem. inkomen (×€1k)',             '×€1.000',   true,  'welvaart'),
  wozValue:         ds('wozValue',         'WOZ waarde',           'Gem. WOZ waarde (×€1k)',          '×€1.000',   true,  'welvaart'),
  ownerOccupiedPct: ds('ownerOccupiedPct', 'Koopwoningen (%)',     'Koopwoningen (%)',                '%',         null,  'welvaart', RTM),
  rentalPct:        ds('rentalPct',        'Huurwoningen (%)',     'Huurwoningen (%)',                '%',         null,  'welvaart', RTM),
  newBuildPct:      ds('newBuildPct',      'Nieuwbouw (%)',        'Woningen jonger dan 10 jaar (%)', '%',         null,  'welvaart', { ...RTM, inOverall: false }),
  oldBuildPct:      ds('oldBuildPct',      'Oude bouw (%)',        `Woningen van vóór ${OLD_BUILD_BEFORE} (%, geschat via postcode ${PC4_YEAR})`, '%', null, 'welvaart', { ...RTM, inOverall: false, estimated: true }),
  modernBuildPct:   ds('modernBuildPct',   'Moderne bouw (%)',     `Woningen van ${MODERN_BUILD_FROM} of later (%, geschat via postcode ${PC4_YEAR})`, '%', null, 'welvaart', { ...RTM, inOverall: false, estimated: true }),
  welfarePer1000:   ds('welfarePer1000',   'Bijstand',             'Bijstand per 1.000 inw.',         'per 1.000', false, 'welvaart', RTM),
  crimeRate:        ds('crimeRate',        'Misdrijven totaal',        'Misdrijven per 1.000 inw.',       'per 1.000', false, 'veiligheid'),
  crimeBurglary:    ds('crimeBurglary',    'Woninginbraak',        'Woninginbraak per 1.000 inw.',    'per 1.000', false, 'veiligheid', { ...RTM, inOverall: false }),
  crimeBike:        ds('crimeBike',        'Fietsendiefstal',      'Fietsendiefstal per 1.000 inw.',  'per 1.000', false, 'veiligheid', { ...RTM, inOverall: false }),
  crimePickpocket:  ds('crimePickpocket',  'Zakkenrollerij',       'Zakkenrollerij per 1.000 inw.',   'per 1.000', false, 'veiligheid', { ...RTM, inOverall: false }),
  crimeViolence:    ds('crimeViolence',    'Geweldsmisdrijven',    'Geweld per 1.000 inw.',           'per 1.000', false, 'veiligheid', { ...RTM, inOverall: false }),
  crimeStreetRobbery: ds('crimeStreetRobbery', 'Straatroof',       'Straatroof per 1.000 inw.',       'per 1.000', false, 'veiligheid', { ...RTM, inOverall: false }),
  crimeThreat:      ds('crimeThreat',      'Bedreiging',           'Bedreiging per 1.000 inw.',       'per 1.000', false, 'veiligheid', { ...RTM, inOverall: false }),
  crimeVehicle:     ds('crimeVehicle',     'Diefstal uit auto',    'Diefstal uit/vanaf auto per 1.000 inw.', 'per 1.000', false, 'veiligheid', { ...RTM, inOverall: false }),
  crimeShoplifting: ds('crimeShoplifting', 'Winkeldiefstal',       'Winkeldiefstal per 1.000 inw.',   'per 1.000', false, 'veiligheid', { ...RTM, inOverall: false }),
  crimeVandalism:   ds('crimeVandalism',   'Vernieling',           'Vernieling per 1.000 inw.',       'per 1.000', false, 'veiligheid', { ...RTM, inOverall: false }),
  crimeDrugs:       ds('crimeDrugs',       'Drugshandel',          'Drugshandel per 1.000 inw.',      'per 1.000', false, 'veiligheid', { ...RTM, inOverall: false }),
  crimeDensity:     ds('crimeDensity',     'Misdrijven per km²',   'Misdrijven per km² land',         'per km²',   false, 'veiligheid', { ...RTM, inOverall: false }),
  crimeNearby:      ds('crimeNearby',      'Criminaliteit omgeving', 'Misdrijven per km² in en rond het gebied', 'per km²', false, 'veiligheid', { ...RTM, inOverall: false }),
  distGP:           ds('distGP',           'Afstand huisarts',     'Afstand tot huisarts (km)',       'km',        false, 'voorzieningen', RTM),
  distSupermarket:  ds('distSupermarket',  'Afstand supermarkt',   'Afstand tot grote supermarkt (km)', 'km',      false, 'voorzieningen', RTM),
  distSchool:       ds('distSchool',       'Afstand basisschool',  'Afstand tot basisschool (km)',    'km',        false, 'voorzieningen', RTM),
  distKinderopvang: ds('distKinderopvang', 'Afstand kinderopvang', 'Afstand tot kinderdagverblijf (km)', 'km',     false, 'voorzieningen', RTM),
  distStation:      ds('distStation',      'Afstand treinstation', 'Afstand tot treinstation (km)',   'km',        false, 'voorzieningen', RTM),
  distCafe:         ds('distCafe',         'Afstand café',         'Afstand tot café (km)',           'km',        null,  'voorzieningen', { ...RTM, inOverall: false }),
  horeca1km:        ds('horeca1km',        'Horeca binnen 1 km',   'Cafés en restaurants binnen 1 km', 'aantal',   null,  'voorzieningen', { ...RTM, inOverall: false }),
  waterPct:         ds('waterPct',         'Water (%)',            'Water in de oppervlakte (%)',     '%',         null,  'voorzieningen', { ...RTM, inOverall: false }),
  distCentrum:      ds('distCentrum',      'Afstand centrum',      'Hemelsbreed tot Rotterdam Centraal (km)', 'km', null, 'voorzieningen', { ...RTM, inOverall: false }),
});

export const DATASET_KEYS = Object.freeze(Object.keys(DATASETS));

export const DATASET_GROUPS = Object.freeze([
  Object.freeze({ key: 'score',         label: 'Score' }),
  Object.freeze({ key: 'bevolking',     label: 'Bevolking' }),
  Object.freeze({ key: 'herkomst',      label: 'Herkomst' }),
  Object.freeze({ key: 'herkomstRegio', label: 'Herkomst per regio' }),
  Object.freeze({ key: 'welvaart',      label: 'Welvaart & wonen' }),
  Object.freeze({ key: 'veiligheid',    label: 'Veiligheid' }),
  Object.freeze({ key: 'voorzieningen', label: 'Voorzieningen' }),
]);

/**
 * Datasets per dropdown section, in DATASET_GROUPS order, each section in
 * DATASET_KEYS order: [{ key, label, scope, datasets: [dataset…] }]. Empty
 * sections are dropped; a dataset with an unknown group lands in the last one.
 * `scope` is 'rotterdam' ('nederland') when every dataset in the section is Rotterdam-only (gemeente-only).
 */
export function groupDatasets(datasets = DATASETS, groups = DATASET_GROUPS) {
  const known = new Set(groups.map(g => g.key));
  const last = groups[groups.length - 1]?.key;
  return groups.map(g => {
    const list = Object.values(datasets).filter(d => (known.has(d.group) ? d.group : last) === g.key);
    const only = ['rotterdam', 'nederland'].find(sc => list.length && list.every(d => d.scope === sc));
    return { key: g.key, label: g.label, scope: only ?? 'all', datasets: list };
  }).filter(g => g.datasets.length);
}

/** True when `key` has data in the given scope ('rotterdam' | 'nederland'). */
export function datasetInScope(key, scope) {
  const d = DATASETS[key];
  // 'rotterdam' = wijk/buurt only (hidden in the Nederland view); 'nederland' = gemeente only (v0.28.0 regions).
  return !!d && (scope === 'rotterdam' ? d.scope !== 'nederland' : d.scope !== 'rotterdam');
}

// ── Crime normalisation: "Per 1000 inwoners" (rate) | "Absoluut" (abs) ────────

export const CRIME_MODES = Object.freeze(['rate', 'abs']);
export const ABS_UNIT = 'misdrijven';

/** True for datasets that switch with the crime mode (they carry a countKey). */
export function isCrimeDataset(key) {
  return !!DATASETS[key]?.countKey;
}

export const CRIME_KEYS = Object.freeze(Object.keys(DATASETS).filter(isCrimeDataset));

/**
 * Dataset metadata as shown in `mode`: in 'abs' a crime dataset gets its
 * absTitle, unit 'misdrijven' and absFormula; everything else is unchanged.
 */
export function datasetFor(key, mode = 'rate') {
  const d = DATASETS[key];
  if (!d || mode !== 'abs' || !d.countKey) return d;
  return Object.freeze({ ...d, title: d.absTitle, unit: ABS_UNIT, formula: d.absFormula, mode: 'abs' });
}

/** The value of `key` in `mode`: the raw count for a crime dataset in 'abs', else values[key]. */
export function datasetValue(values, key, mode = 'rate') {
  const d = DATASETS[key];
  const k = mode === 'abs' && d?.countKey ? d.countKey : key;
  return values?.[k] ?? null;
}

/** A values object (area values or a flat CBS row) with every crime key replaced by its count in 'abs'. */
export function crimeValues(values, mode = 'rate') {
  if (mode !== 'abs' || !values) return values;
  const out = { ...values };
  for (const k of CRIME_KEYS) out[k] = values[DATASETS[k].countKey] ?? null;
  return out;
}

const absAreaCache = new WeakMap();
/**
 * Areas ({ values }) as seen in `mode`; 'rate' returns the same array. The
 * 'abs' copy is cached per input array, so repeated calls return the same objects.
 */
export function crimeAreas(areas, mode = 'rate') {
  if (mode !== 'abs' || !Array.isArray(areas)) return areas;
  if (!absAreaCache.has(areas)) absAreaCache.set(areas, areas.map(a => ({ ...a, values: crimeValues(a.values ?? {}, 'abs') })));
  return absAreaCache.get(areas);
}
