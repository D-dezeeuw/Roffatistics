import { BOUW_SOURCE_URL, BOUW_MIN_DWELLINGS, OLD_BUILD_BEFORE, MODERN_BUILD_FROM } from './bouwjaar-pc4.js';
import { PC4_GROUPS, PC4_HERKOMST_TABLE, PC4_YEAR, PC4_MIN_POPULATION, pc4RegionComposition, regionAtBuurt } from './herkomst-pc4.js';
import { REGIONS, REGIO_TABLE, REGIO_YEAR, regionComposition } from './herkomst-regio.js';
import { LAND_COUNTRIES } from './herkomst-land.js';
import { P2000_SOURCE_URL, P2000_COVERAGE, P2000_MIN_POPULATION } from './p2000.js';
import { HINDER_YEAR, PET_YEAR, SHADE_YEAR, AIR_YEAR } from './milieu.js';
import { SMALL_N as EDU_SMALL_N, NEAR_RADIUS_KM, NEAR_BEST_KM, YEARS as EDU_YEARS } from './schools.js';

import { odataUrl, getRows } from './source.js';
import { CITY, centrumCoords, cityNeighbours } from './city.js';

export function buildCBSUrl(tableId, filter, select, top = null) {
  return odataUrl(tableId, { filter, select, top });
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

// ── National rows of the Nederland scope (app.js): provinces and gemeenten from
// 70072ned (kerncijfers) and 83648NED (misdrijven), read as snapshots
// (data/snapshot/<key>.json, scripts/snapshot-sources.mjs); the URL is the live fallback.
export const CRIME_REGION_TABLE  = '83648NED';
export const CRIME_REGION_SELECT = 'RegioS,SoortMisdrijf,TotaalGeregistreerdeMisdrijven_1,GeregistreerdeMisdrijvenPer1000Inw_3';
const CRIME_REGION_KINDS = "(SoortMisdrijf eq 'T001161' or SoortMisdrijf eq 'CRI1000' or SoortMisdrijf eq 'CRI1100' or SoortMisdrijf eq 'CRI2000' or SoortMisdrijf eq 'CRI3000' or SoortMisdrijf eq 'CRI3100')";
export const NL_REGION_QUERIES = Object.freeze({
  'cbs/70072ned-provincies':  Object.freeze({ table: CBS_TABLE, filter: `startswith(RegioS,'PV') and Perioden eq '${CBS_PERIOD}'`, select: CBS_SELECT }),
  'cbs/83648NED-provincies':  Object.freeze({ table: CRIME_REGION_TABLE, filter: `startswith(RegioS,'PV') and Perioden eq '${CBS_PERIOD}' and ${CRIME_REGION_KINDS}`, select: CRIME_REGION_SELECT }),
  'cbs/70072ned-gemeenten':   Object.freeze({ table: CBS_TABLE, filter: `startswith(RegioS,'GM') and Perioden eq '${CBS_PERIOD}'`, select: CBS_SELECT }),
  'cbs/83648NED-gemeenten':   Object.freeze({ table: CRIME_REGION_TABLE, filter: `startswith(RegioS,'GM') and Perioden eq '${CBS_PERIOD}' and ${CRIME_REGION_KINDS}`, select: CRIME_REGION_SELECT }),   // no $top: 2000 cut off ~half of the rows (decisions.md 16 Nov 2026)
});

/** Live URL of a NL_REGION_QUERIES key. */
export function nlRegionUrl(key) {
  const q = NL_REGION_QUERIES[key];
  if (!q) throw new Error(`datasets: unknown region query ${key}`);
  return buildCBSUrl(q.table, q.filter, q.select, q.top ?? null);
}

/** Rows of a NL_REGION_QUERIES key: the own snapshot, the live URL as (flagged) fallback. */
export function loadRegionRows(key, opts = {}) {
  return getRows(key, { live: nlRegionUrl(key), ...opts });
}

/**
 * Diversiteit (16 Nov 2026): 100 minus the share with herkomst Nederland, one
 * decimal; null when that share is missing. Derived wherever originDutchPct is
 * computed (gemeente/provincie rows, city wijk/buurt, NL wijk/buurt, fallback year).
 */
export function diversityFrom(originDutchPct) {
  const o = typeof originDutchPct === 'number' && Number.isFinite(originDutchPct) ? originDutchPct : null;
  return o == null ? null : +(100 - o).toFixed(1);
}

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
      diversityPct:     diversityFrom(pct(r[C.originDutch], population)),
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
  kwb2025: Object.freeze({ id: '86165NED', name: 'Kerncijfers wijken en buurten 2025', publisher: 'CBS', url: statline('86165NED'), scope: CITY.name }),
  kwb2024: Object.freeze({ id: '85984NED', name: 'Kerncijfers wijken en buurten 2024', publisher: 'CBS', url: statline('85984NED'), scope: CITY.name }),
  regio:   Object.freeze({ id: '70072ned', name: 'Regionale kerncijfers Nederland', publisher: 'CBS', url: statline('70072ned'), scope: 'Nederland' }),
  crime:   Object.freeze({ id: '47018NED', name: 'Geregistreerde misdrijven; soort misdrijf, wijk, buurt', publisher: 'Politie (via CBS dataderden)', url: 'https://data.politie.nl/#/Politie/nl/dataset/47018NED/table', scope: CITY.name }),
  nabij2025: Object.freeze({ id: '86270NED', name: 'Nabijheid voorzieningen; afstand locatie, wijk- en buurtcijfers 2025', publisher: 'CBS', url: statline('86270NED'), scope: CITY.name }),
  nabij2017: Object.freeze({ id: '84334NED', name: 'Nabijheid voorzieningen; afstand locatie, wijk- en buurtcijfers 2017', publisher: 'CBS', url: statline('84334NED'), scope: 'Nederland' }),
  nabij2024: Object.freeze({ id: '86134NED', name: 'Nabijheid voorzieningen; afstand locatie, wijk- en buurtcijfers 2024', publisher: 'CBS', url: statline('86134NED'), scope: CITY.name }),
  geo:     Object.freeze({ id: 'PDOK', name: 'CBS wijk- en buurtkaart (gebiedsgrenzen, via PDOK)', publisher: 'CBS / PDOK', url: 'https://www.pdok.nl/introductie/-/article/cbs-wijken-en-buurten', scope: CITY.name }),
  pc4:     Object.freeze({ id: PC4_HERKOMST_TABLE, name: 'Bevolking; geslacht, migratieachtergrond, viercijferige postcode, 1 januari', publisher: 'CBS', url: statline(PC4_HERKOMST_TABLE), scope: 'postcode' }),
  pc4bouw: Object.freeze({ id: 'PC4-2023', name: `Gegevens per postcode (PC4) ${PC4_YEAR}, woningen naar bouwjaar`, publisher: 'CBS', url: BOUW_SOURCE_URL, scope: 'postcode' }),
  pc6:     Object.freeze({ id: 'pc6huisnr', name: `Buurt, wijk en gemeente per postcode en huisnummer ${PC4_YEAR}`, publisher: 'CBS', url: `https://download.cbs.nl/postcode/${PC4_YEAR}-cbs_pc6huisnr.zip`, scope: 'postcode' }),
  herkomst: Object.freeze({ id: REGIO_TABLE, name: 'Bevolking; herkomstland, geboorteland, leeftijd, regio, 1 januari', publisher: 'CBS', url: statline(REGIO_TABLE), scope: 'Nederland (gemeenten)' }),
  osm:     Object.freeze({ id: 'OSM', name: 'OpenStreetMap: metro- en tramlijnen en haltes (ODbL), via Overpass API', publisher: '© OpenStreetMap-bijdragers', url: 'https://www.openstreetmap.org/copyright', scope: 'Nederland' }),
  p2000:   Object.freeze({ id: 'P2000', name: 'Randstad P2000: meldingen hulpdiensten per buurt, wijk en gemeente (live)', publisher: 'Randstad, uit het openbare P2000-net', url: P2000_SOURCE_URL, scope: P2000_COVERAGE }),
  crimeNl: Object.freeze({ id: '83648NED', name: 'Geregistreerde criminaliteit; soort misdrijf, regio', publisher: 'CBS', url: statline('83648NED'), scope: 'Nederland' }),
  duoRef:  Object.freeze({ id: 'wporeferentieniveau-v1', name: 'Referentieniveaus per toets en vestiging (basisonderwijs, groep 8)', publisher: 'DUO', url: 'https://onderwijsdata.duo.nl/dataset/wporeferentieniveau-v1', scope: 'Nederland (schoolvestigingen)' }),
  duoEind: Object.freeze({ id: 'wpo-eindscores', name: 'Gemiddelde eindscores per vestiging (aantal getoetste leerlingen)', publisher: 'DUO', url: 'https://onderwijsdata.duo.nl/dataset/wpo-eindscores', scope: 'Nederland (schoolvestigingen)' }),
  // Milieu (plan-milieu phase 1): licence from the metadata (Nationaal Georegister / Klimaateffectatlas), checked 16 Nov 2026.
  rivmHinder: Object.freeze({ id: 'RIVM ALO', name: `Ernstig ervaren geluidhinder per buurt ${HINDER_YEAR} (GGD Gezondheidsmonitor, modelschatting), Atlas Leefomgeving`, publisher: 'RIVM / GGD\'en, publiek domein (Public Domain Mark 1.0)', url: 'https://www.nationaalgeoregister.nl/geonetwork/srv/dut/catalog.search#/metadata/64d24969-6abf-4208-b7b4-a8d582382829', scope: 'Nederland (buurten 2024)' }),
  keaPet:  Object.freeze({ id: 'KEA', name: `Gevoelstemperatuur per buurt (hittekaart ${PET_YEAR}), Klimaateffectatlas`, publisher: 'Klimaateffectatlas, 2026 (CC BY 4.0)', url: 'https://www.klimaateffectatlas.nl/nl/data-opvragen', scope: 'Nederland (buurten 2024)' }),
  keaShade: Object.freeze({ id: 'KEA', name: `Schaduw op fiets- en wandelpaden per buurt (${SHADE_YEAR}), Klimaateffectatlas buurtdashboard`, publisher: 'Klimaateffectatlas, 2026 (CC BY 4.0)', url: 'https://www.klimaateffectatlas.nl/nl/data-opvragen', scope: 'Nederland (buurten 2024)' }),
  // Milieu phase 2: the WMS/WCS capabilities carry no licence for the GCN layers (checked 16 Nov 2026).
  rivmAir: Object.freeze({ id: 'RIVM GCN', name: `Grootschalige concentratiekaarten Nederland: jaargemiddelde NO₂ en PM2,5 ${AIR_YEAR} (25 m-raster), Atlas Leefomgeving`, publisher: 'RIVM, open data via de Atlas Leefomgeving (licentie niet vermeld in de servicemetadata)', url: 'https://www.atlasleefomgeving.nl/kaarten', scope: 'Nederland (raster)' }),
  pdh: Object.freeze({ id: 'PDH', name: 'PFAS Data Hub: vermoedelijke PFAS-bronnen en metingen (via de Pfoisened-export)', publisher: 'PFAS Data Hub, CNRS', url: 'https://pdh.cnrs.fr', scope: 'Europa (punten)' }),
  duoAdres: Object.freeze({ id: 'adressen_bo', name: 'Adressen vestigingen basisonderwijs', publisher: 'DUO', url: 'https://onderwijsdata.duo.nl/dataset/adressen_bo', scope: 'Nederland (schoolvestigingen)' }),
});

const OV_YEAR = 'november 2026 (OpenStreetMap)';

// Actuele meldingen hulpdiensten (P2000, W30): live from Randstad (modules/p2000.js).
const P2000_YEAR = 'live: laatste 30 of 7 dagen (gegevens vanaf oktober 2026)';
const P2000_FORMULA = what => `aantal ${what} in de gekozen periode (30 of 7 dagen) ÷ inwoners × 1.000; onder ${P2000_MIN_POPULATION} inwoners alleen het aantal`;
export const P2000_NOTES = Object.freeze([
  'Meldingen hulpdiensten (P2000), geen criminaliteitscijfer: P2000 toont maar een deel van het politiewerk, want het meeste politieverkeer is versleuteld. Brandweer en ambulance staan er vollediger in.',
  'Locaties zijn bij benadering: een melding noemt meestal een straat of postcode, die Randstad aan een buurt koppelt. Meldingen zonder herkenbare plek tellen niet mee.',
  `Alleen de veiligheidsregio's ${P2000_COVERAGE}, en pas vanaf oktober 2026. Gebieden daarbuiten zijn grijs (geen gegevens), niet nul.`,
  'Live opgehaald bij Randstad wanneer je deze laag kiest; telt niet mee in de Woonscore, de totaalscore, de wizard of de ranglijst.',
]);
const OV_FORMULA = what => `afstand in km over het aardoppervlak van het zwaartepunt van de gebiedsgrens tot de dichtstbijzijnde ${what} (haltes uit OpenStreetMap-routes, beide richtingen samengevoegd)`;
const OV_CAVEATS = Object.freeze([
  'Berekend door deze app uit de kaart en OpenStreetMap, geen CBS-cijfer. Het zwaartepunt van een groot gebied kan ver van de woningen liggen.',
  'Hemelsbreed: water, spoor of snelwegen kunnen de looproute langer maken. Bus telt niet mee.',
  'Bron: © OpenStreetMap-bijdragers (ODbL). Lijnen en haltes zoals in OpenStreetMap op de bouwdatum; nieuwe of tijdelijk gesloten haltes kunnen afwijken.',
]);
const FALLBACK_NOTE = 'Ontbreekt het 2025-cijfer voor een gebied, dan wordt het 2024-cijfer (85984NED) getoond; het paneel noemt dat onder Peiljaar.';
const CRIME_PLACE_NOTE = 'Per inwoner telt de plek van het misdrijf, niet waar daders of slachtoffers wonen: drukke gebieden met weinig bewoners (Centrum, Stadsdriehoek, haven-, winkel- en uitgaansgebieden) komen daardoor hoog uit. De stand Absoluut laat de aantallen zelf zien.';
const CRIME_MIN_NOTE = 'Geen per-1.000-cijfer voor wijken onder 1.000 en buurten onder 200 inwoners ("geen data"); in de stand Absoluut krijgen ze wel een waarde.';
const CRIME_SUB_NOTE = 'Telt niet mee in de totaalscore van de Ranglijst (anders weegt criminaliteit meerdere keren).';
const HERKOMST_DEF = 'Herkomst volgt de CBS-definitie (sinds 2022): het eigen geboorteland; voor wie in Nederland is geboren het geboorteland van de moeder, of als zij ook in Nederland is geboren dat van de vader. Wie in Nederland is geboren uit twee in Nederland geboren ouders heeft herkomst Nederland.';
const HERKOMST_NOTES = [
  'CBS rondt de wijk- en buurtaantallen af op vijftallen; Nederland, Europa en buiten Europa tellen daardoor niet altijd precies op tot 100 %.',
  'CBS rekent Turkije en de Kaukasische en Centraal-Aziatische landen van de voormalige Sovjet-Unie tot Azië, dus tot "buiten Europa".',
  `Landen en landengroepen (Turkije, Marokko, Suriname, Afrika bezuiden de Sahara …) zijn alleen voor heel ${CITY.name} beschikbaar (Dashboard, CBS 85458NED), niet per wijk of buurt.`,
  'Beschrijvend: telt niet mee in de totaalscore van de Ranglijst.',
];
const TASTE_NOTE = 'Beschrijvend en een kwestie van smaak: telt niet mee in de totaalscore van de Ranglijst of de Woonscore Standaard.';
const NABIJ_NOTE = 'Ontbreekt het 2025-cijfer voor een gebied, dan wordt het 2024-cijfer (86134NED) getoond; het paneel noemt dat onder Peiljaar.';
const DICHTBIJ_NOTE = 'Telt niet mee in de totaalscore van de Ranglijst of de Woonscore Standaard; alleen in je eigen Woonscore als je het in de wizard bij “Wat wil je dichtbij?” belangrijk vindt (dichterbij = beter).';
const GROEN_NOTE = 'Oudere peiling: CBS vult de afstanden tot groen en natuur sinds 2018 niet meer in. Dit is het cijfer van 2017 (indeling 2017, bodemgebruik 2015). Een buurt die sindsdien een nieuwe code kreeg, krijgt het cijfer van haar wijk; zonder oude code is er geen data.';
// Onderwijsprestatie basisscholen (plan-onderwijsprestatie, 16 Nov 2026): texts shared by the eduScore family.
const kmText = km => String(km).replace('.', ',');
const EDU_PERIOD = `${EDU_YEARS[0]}–${EDU_YEARS.at(-1)}`;
const EDU_SCORE_DEF = `per leerlingresultaat (lezen, taalverzorging, rekenen): onder 1F = 0 punten, 1F = 50, 2F/1S = 100; schoolscore = het gemiddelde over alle resultaten van de school in ${EDU_PERIOD} (0–100, getoond als cijfer /10); alleen gewone basisscholen (BO), geen speciaal basisonderwijs`;
const EDU_SOURCES = () => [SRC.duoRef, SRC.duoEind, SRC.duoAdres];
const EDU_IN_AREA_NOTE = 'Het cijfer gaat over de scholen die in het gebied staan, niet over de kinderen die er wonen: kinderen gaan ook naar school in een andere buurt, en schoolkeuze is vrij. Per wijk zegt het meer dan per buurt; veel buurten hebben geen eigen school (geen data).';
const EDU_NOTES = Object.freeze([
  'De achtergrond van de leerlingen (opleiding van de ouders, de taal thuis) bepaalt een groot deel van de score. Een lage score betekent niet dat het een slechte school is.',
  'Scholen gebruiken verschillende toetsen met elk een eigen schaal; de referentieniveaus (1F, 2F/1S) zijn de enige maat die over alle toetsen vergelijkbaar is.',
  `Drie peiljaren samen (${EDU_PERIOD}): tot en met 2023 de eindtoets (april), vanaf 2024 de doorstroomtoets (februari). De grenzen van de niveaus verschoven daarbij iets.`,
  `Een school met minder dan ${EDU_SMALL_N} getoetste leerlingen telt mee en heet in het paneel "klein aantal leerlingen"; een school zonder toetsgegevens krijgt geen score. DUO laat cellen van 1–4 leerlingen weg; die zijn uit het totaal afgeleid of geschat.`,
  'Telt niet mee in de totaalscore van de Ranglijst of de Woonscore Standaard.',
]);
const EDU_NEAR_NOTE = `Hemelsbreed gemeten vanaf het midden van de buurt (binnen ${kmText(NEAR_RADIUS_KM)} km), niet over de weg. Schoolkeuze, wachtlijsten en toelatingsregels ziet het cijfer niet.`;
const EDU_ROLLUP = 'wijk, gemeente en provincie: het gemiddelde van hun buurten, gewogen naar inwoners (een gemeente telt bij de provincie waarin de meeste van haar buurten liggen)';

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

// Milieu (plan-milieu phase 1, modules/milieu.js): texts shared by the five layers.
const MILIEU_MODEL_NOTE = `Modelschatting, geen meting: RIVM en de GGD'en schatten het cijfer per buurt uit de GGD Gezondheidsmonitor Volwassenen en Ouderen ${HINDER_YEAR} (een vragenlijst) met een statistisch model dat onder meer leeftijd, inkomen en de berekende geluidbelasting gebruikt. Voor één buurt kan het werkelijke aandeel afwijken.`;
const MILIEU_SMALL_NOTE = 'Voor kleine buurten publiceert het RIVM geen schatting ("geen data").';
const MILIEU_MAP_NOTE = 'De bronnen gebruiken de buurtindeling 2024. Buurten met dezelfde code in 2025 nemen het cijfer over; een nieuwe of gewijzigde buurt krijgt het cijfer van de buurt uit 2024 waarmee hij het meest overlapt.';
const MILIEU_AGG_NOTE = 'Wijken, gemeenten en provincies: het gemiddelde van hun buurten, gewogen naar het aantal inwoners.';
const AIR_NOTE = 'Een modelkaart (metingen plus verspreidingsberekening), geen meting in de buurt zelf. De RIVM-kaart rekent met een raster van 25 m; vlak langs drukke wegen kan het hoger zijn.';
const AIR_SAMPLE_NOTE = 'Berekend op de buurtindeling 2025: het gemiddelde van de kaart op punten om de 100 m binnen de buurt; een buurt te klein voor een punt krijgt de waarde in zijn middelpunt.';
const MILIEU_SCORE_NOTE = 'Telt niet mee in de totaalscore van de Ranglijst of de Woonscore; wel te gebruiken in Mijn stapel.';
const HINDER_DEF = '"Ernstig gehinderd" betekent dat iemand op een schaal van 0 tot 10 een 8, 9 of 10 geeft op de vraag hoeveel hinder hij of zij thuis het afgelopen jaar ondervond.';

const INFO = {
  // Milieu (plan-milieu phase 1).
  noiseAnyPct: {
    description: `Stilte-index: het geschatte aandeel volwassenen dat ernstige geluidhinder ondervindt van ten minste één bron (wegverkeer, treinen, vliegverkeer, windturbines of buren). Lager is rustiger. ${HINDER_DEF}`,
    formula: '1 − (1 − weg) × (1 − trein) × (1 − vliegverkeer) × (1 − windturbines) × (1 − buren), met elk aandeel als fractie; de bronnen worden als onafhankelijk beschouwd (het RIVM publiceert geen gecombineerd cijfer)',
    source: [SRC.rivmHinder],
    year: `${HINDER_YEAR} (modelschatting)`,
    caveats: [MILIEU_MODEL_NOTE, 'Eigen berekening: wie last heeft van meer bronnen tegelijk telt één keer, maar hoe vaak dat samen voorkomt is per buurt niet bekend.', MILIEU_SMALL_NOTE, MILIEU_MAP_NOTE, MILIEU_AGG_NOTE, MILIEU_SCORE_NOTE],
  },
  noiseRoadPct: {
    description: `Het geschatte aandeel volwassenen dat ernstige geluidhinder ondervindt van wegverkeer (alle wegen, binnen en buiten de bebouwde kom). Lager is beter. ${HINDER_DEF}`,
    formula: '% volwassenen (18+) ernstig gehinderd door geluid van wegverkeer, schatting per buurt',
    source: [SRC.rivmHinder],
    year: `${HINDER_YEAR} (modelschatting)`,
    caveats: [MILIEU_MODEL_NOTE, MILIEU_SMALL_NOTE, MILIEU_MAP_NOTE, MILIEU_AGG_NOTE, MILIEU_SCORE_NOTE],
  },
  noiseNeighbourPct: {
    description: `Het geschatte aandeel volwassenen dat ernstige geluidhinder ondervindt van buren (stemmen, muziek, lopen, klussen). Lager is beter. ${HINDER_DEF}`,
    formula: '% volwassenen (18+) ernstig gehinderd door geluid van buren, schatting per buurt',
    source: [SRC.rivmHinder],
    year: `${HINDER_YEAR} (modelschatting)`,
    caveats: [MILIEU_MODEL_NOTE, 'Burenhinder hangt vooral af van het type woning (gestapeld of vrijstaand) en de geluidsisolatie; de schatting kent de woning zelf niet.', MILIEU_SMALL_NOTE, MILIEU_MAP_NOTE, MILIEU_AGG_NOTE, MILIEU_SCORE_NOTE],
  },
  heatPet: {
    description: 'Gevoelstemperatuur (PET, physiological equivalent temperature) in de buitenruimte op een hete zomerdag, gemiddeld over de buurt. Hoe warm het voelt hangt af van luchttemperatuur, zon of schaduw, wind en vocht. Lager is beter: boven 41 °C spreekt men van extreme hittestress.',
    formula: `gemiddelde PET in °C over de buurt op een hete dag, uit de hittekaart gevoelstemperatuur ${PET_YEAR} (10 m-raster)`,
    source: [SRC.keaPet],
    year: `${PET_YEAR} (kaart), buurtindeling 2024`,
    caveats: ['Een modelkaart van één hete middag, geen meting; binnen in huis kan het anders zijn.', MILIEU_MAP_NOTE, MILIEU_AGG_NOTE, MILIEU_SCORE_NOTE],
  },
  shadePct: {
    description: 'Het aandeel van de fiets- en wandelpaden in de buurt dat in de zomer in de schaduw ligt (van bomen en gebouwen). Hoger is beter: schaduw maakt hitte draaglijker.',
    formula: `oppervlak fiets- en wandelpad in de schaduw / oppervlak fiets- en wandelpad × 100 (Klimaateffectatlas buurtdashboard, schaduwkaart ${SHADE_YEAR})`,
    source: [SRC.keaShade],
    year: `${SHADE_YEAR}, buurtindeling 2024`,
    caveats: ['Buurten zonder fiets- of wandelpaden hebben geen waarde ("geen data").', MILIEU_MAP_NOTE, MILIEU_AGG_NOTE, MILIEU_SCORE_NOTE],
  },
  // Milieu phase 2: air quality and PFAS (computed on the buurt indeling 2025 itself).
  airNo2: {
    description: `De jaargemiddelde concentratie stikstofdioxide (NO₂) in de buitenlucht, gemiddeld over de buurt. NO₂ komt vooral van verkeer en verbranding. Lager is beter; de WHO adviseert sinds 2021 een jaargemiddelde van hoogstens 10 µg/m³.`,
    formula: `gemiddelde van de RIVM-concentratiekaart NO₂ ${AIR_YEAR} (µg/m³) over een raster van 100 m binnen de buurt (gewogen naar oppervlakte)`,
    source: [SRC.rivmAir],
    year: `${AIR_YEAR} (modelkaart)`,
    caveats: [AIR_NOTE, AIR_SAMPLE_NOTE, MILIEU_AGG_NOTE, MILIEU_SCORE_NOTE],
  },
  airPm25: {
    description: `De jaargemiddelde concentratie fijnstof kleiner dan 2,5 micrometer (PM2,5), gemiddeld over de buurt. Fijnstof komt voor een groot deel van ver (industrie, landbouw, het buitenland) en verschilt daarom weinig tussen buurten. Lager is beter; de WHO adviseert hoogstens 5 µg/m³.`,
    formula: `gemiddelde van de RIVM-concentratiekaart PM2,5 ${AIR_YEAR} (µg/m³) over een raster van 100 m binnen de buurt (gewogen naar oppervlakte)`,
    source: [SRC.rivmAir],
    year: `${AIR_YEAR} (modelkaart)`,
    caveats: [AIR_NOTE, AIR_SAMPLE_NOTE, MILIEU_AGG_NOTE, MILIEU_SCORE_NOTE],
  },
  pfasSourceKm: {
    description: 'Hoe ver het dichtstbijzijnde vermoedelijke PFAS-bron ligt: een plek waar PFAS gebruikt is of vrij kan zijn gekomen (vliegveld, militair brandoefenterrein, rioolwaterzuivering, papierfabriek, bedrijf in het Europese emissieregister). Hoger is beter. Het zegt niet dat er PFAS in de bodem of het water van de buurt zit.',
    formula: 'afstand in km in rechte lijn van het middelpunt van de buurt tot de dichtstbijzijnde vermoedelijke bron in de PFAS Data Hub (ook bronnen over de grens)',
    source: [SRC.pdh],
    year: 'PFAS Data Hub, export september 2026',
    caveats: [
      'Een verdachte bron is geen gemeten vervuiling. De lijst is niet volledig: kleinere bedrijven en oude brandoefenplaatsen ontbreken vaak.',
      'Waarom geen kaart met gemeten PFAS per buurt? Er wordt gemeten waar men vervuiling vermoedt (in de ene grote stad honderden bodemmonsters, in de andere een handvol). Een gemiddelde per buurt laat dan vooral zien waar iemand gezocht heeft. De metingen staan wel als punten op de kaart: zet "PFAS-punten" aan bij Instellingen.',
      'De afstand geldt voor het middelpunt van de buurt; in een grote buurt kan een deel dichter bij de bron liggen.',
      MILIEU_AGG_NOTE, MILIEU_SCORE_NOTE,
    ],
  },
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
  diversityPct: {
    description: 'Het aandeel inwoners met een niet-Nederlandse herkomst: simpelweg 100 min het aandeel inwoners met herkomst Nederland (CBS). Een grove maat, geen diversiteitsindex: het zegt niet uit hoeveel verschillende gemeenschappen een gebied bestaat. ' + HERKOMST_DEF,
    formula: '100 − (inwoners met herkomst Nederland / inwoners × 100)',
    source: [SRC.kwb2025, SRC.regio],
    year: '2025 (wijk/buurt) · 2023 (Nederland)',
    caveats: ['Geen diversiteitsindex: een buurt met één grote gemeenschap en een buurt met twintig kleine kunnen hetzelfde percentage hebben. Per land of regio: zie de lagen onder Gemeenschappen en Gemeenschappen per land.', ...HERKOMST_NOTES, FALLBACK_NOTE],
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
  eduScore: {
    description: `Hoe goed de basisscholen in het gebied hun leerlingen in groep 8 laten presteren: het gemiddelde van de schoolscores van de scholen die in het gebied staan (elke school telt één keer), als cijfer /10. Hoger telt als beter. In het gebiedspaneel staan de scholen met hun eigen cijfer.`,
    formula: `${EDU_SCORE_DEF}; gebied = ongewogen gemiddelde van de schoolscores`,
    source: EDU_SOURCES(),
    year: `${EDU_PERIOD} (peiljaren samen)`,
    caveats: [EDU_IN_AREA_NOTE, ...EDU_NOTES],
  },
  eduNearScore: {
    description: `De kwaliteit van de basisscholen dichtbij huis: het gemiddelde van de schoolscores van de scholen binnen ${kmText(NEAR_RADIUS_KM)} km hemelsbreed van het midden van de buurt, waarbij een school dichterbij zwaarder telt. Een basisschool moet dichtbij zijn; daarom tellen ook scholen net over de buurtgrens mee. Hoger telt als beter.`,
    formula: `Σ gewicht × schoolscore / Σ gewicht, gewicht = max(0, 1 − afstand / ${kmText(NEAR_RADIUS_KM)} km); geen waarde zonder school met een score binnen ${kmText(NEAR_RADIUS_KM)} km; ${EDU_ROLLUP}. Schoolscore: ${EDU_SCORE_DEF}`,
    source: EDU_SOURCES(),
    year: `${EDU_PERIOD} (peiljaren samen)`,
    caveats: [EDU_NEAR_NOTE, ...EDU_NOTES],
  },
  eduNearBest: {
    description: `De best presterende basisschool binnen ${kmText(NEAR_BEST_KM)} km hemelsbreed van het midden van de buurt, als cijfer /10. Zegt of er een sterke school in de buurt is, ook als het gemiddelde lager ligt. Hoger telt als beter.`,
    formula: `hoogste schoolscore binnen ${kmText(NEAR_BEST_KM)} km; ${EDU_ROLLUP}. Schoolscore: ${EDU_SCORE_DEF}`,
    source: EDU_SOURCES(),
    year: `${EDU_PERIOD} (peiljaren samen)`,
    caveats: [EDU_NEAR_NOTE, ...EDU_NOTES],
  },
  eduStreefPct: {
    description: 'Het aandeel leerlingresultaten (lezen, taalverzorging, rekenen) op het streefniveau 2F (taal) of 1S (rekenen), van de basisscholen in het gebied samen. Hoger telt als beter.',
    formula: `resultaten op 2F/1S / alle resultaten × 100, over de scholen in het gebied en ${EDU_PERIOD} (gewogen naar leerlingen)`,
    source: EDU_SOURCES(),
    year: `${EDU_PERIOD} (peiljaren samen)`,
    caveats: [EDU_IN_AREA_NOTE, ...EDU_NOTES],
  },
  eduFundPct: {
    description: 'Het aandeel leerlingresultaten (lezen, taalverzorging, rekenen) dat ten minste het fundamentele niveau 1F haalt, van de basisscholen in het gebied samen. Hoger telt als beter.',
    formula: `resultaten op 1F of hoger / alle resultaten × 100, over de scholen in het gebied en ${EDU_PERIOD} (gewogen naar leerlingen)`,
    source: EDU_SOURCES(),
    year: `${EDU_PERIOD} (peiljaren samen)`,
    caveats: [EDU_IN_AREA_NOTE, ...EDU_NOTES],
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
    caveats: [`De dashboard-KPI "WOZ 2026" komt uit CBS 85036NED (peildatum 1 januari 2026) en geldt alleen voor heel ${CITY.name}.`, FALLBACK_NOTE],
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
    year: `2025 (misdrijven, oppervlakte) · indeling 2024 (${CITY.name}-kaart) / 2025 (Nederland)`,
    caveats: [
      'Een groot buurgebied telt mee met zijn eigen dichtheid: 800 misdrijven op 30 km² haven wegen minder dan 300 op 1 km² rond een station.',
      `${CITY.name}-weergave: buren buiten de gemeentegrens (${cityNeighbours()} …) tellen niet mee, want alleen de ${CITY.adjective} kaart is geladen. In de Nederland-weergave tellen buren in andere gemeenten wel mee.`,
      'Buurten aan weerszijden van de Maas of een havenbekken grenzen in het water aan elkaar en tellen dus als buren.',
      'Gebieden zonder misdrijvencijfer of oppervlakte tellen niet mee in de som.',
    ],
  },
  woonscore: {
    description: 'Eén cijfer van 0 tot 100 voor hoe prettig je er gemiddeld woont, vergeleken met gelijke gebieden: gemeenten met gemeenten, wijken met wijken, buurten met buurten. 100 = het beste gebied van de lijst, 0 = het slechtste. Standaard is neutraal: elk thema telt even zwaar (Gemiddeld), maar veiligheid, inkomen, de kwaliteit van de basisscholen (onderwijsprestatie) en geluidhinder door buren wegen iets zwaarder. Gewichten: veiligheid 15 (waarvan een zesde de criminaliteit in de omgeving: het gebied plus de aangrenzende gebieden), welvaart 15 (inkomen 10, bijstand 5), opleiding 15 (onderwijsprestatie basisscholen 10, hbo/wo 5), voorzieningen 10 en milieu 10 (geluidhinder door buren). Smaakkwesties zoals drukte, leeftijd, herkomst, koop of huur en de WOZ-waarde tellen niet mee. Met "Vind jouw ideale woonplek" pas je de gewichten aan je eigen wensen aan (levenstype, budget, vervoer, drukte, misdrijven); de kaart toont dan "Woonscore · jouw wensen". Reset in de legenda zet hem terug op Standaard.',
    formula: 'per cijfer de percentielscore binnen de lijst (omgedraaid bij lager = beter); Woonscore = 100 × Σ gewicht × score / Σ gewicht over de cijfers met data. Een themagewicht wordt verdeeld over de cijfers van dat thema die er zijn.',
    source: [SRC.kwb2025, SRC.crime, SRC.regio, SRC.crimeNl],
    year: '2023–2025 (zie de onderliggende cijfers)',
    caveats: [
      'Een score is relatief: een 80 voor een buurt is iets anders dan een 80 voor een gemeente, en zegt niet hoe groot het verschil in werkelijkheid is.',
      'In de Nederland-weergave zijn er minder cijfers (misdrijven totaal, inkomen, opleiding); de gewichten worden dan herverdeeld. Hetzelfde geldt waar een cijfer ontbreekt, zoals de onderwijsprestatie in een gebied zonder basisschool: de score gebruikt dan de andere cijfers.',
      'Weinig inwoners: bij buurten worden criminaliteit en bijstand naar de wijk toe getrokken (gewicht inwoners / (inwoners + 300)), zodat een paar incidenten in een kleine buurt de score niet domineren.',
      'Een gebied met data voor minder dan 60% van het gewicht krijgt geen score (onvoldoende data).',
      'Geen woonwijk: bedrijven-, haven- en recreatiegebieden en vrijwel onbewoonde wijken en buurten (weinig inwoners en woningen, veel niet-woningen) krijgen geen score en tellen niet mee als vergelijkingsgebied.',
      'Jouw wensen: budget en drukte zijn een doelwaarde (hoe dichter erbij, hoe hoger; 0 op twee toleranties afstand) en relatief binnen de lijst. Het budget is een ruwe vuistregel (ongeveer 4,5 × het bruto huishoudinkomen, vergeleken met de gemiddelde WOZ-waarde); "Verberg duidelijk te duur" maakt gebieden met een WOZ boven 1,2 × je budget grijs.',
      'Wat wil je dichtbij: per onderdeel (cafés, station, winkels, cultuur, park, bos en natuur) telt een kortere afstand als plus, zwaarder naarmate je het belangrijker vindt; “Maakt niet uit” telt niet mee. De afstanden tot groen en natuur zijn CBS-cijfers uit 2017, de nieuwste die er zijn.',
      'Je antwoorden blijven in je browser (localStorage) en in de link; er wordt niets verstuurd.',
    ],
  },
  stapel: {
    description: 'Je eigen kaart: kies 2 tot 6 lagen (bijvoorbeeld WOZ waarde en criminaliteit), per laag of hoger of lager beter is en hoe zwaar hij telt (1, 2 of 3). Mijn stapel is het gewogen gemiddelde van die lagen als score van 0 tot 100: 100 = het best op jouw lagen, 0 = het slechtst. Geen profiel, geen correcties: alleen de lagen die je kiest. Hij staat los van de Woonscore en verandert die niet.',
    formula: 'per gekozen laag de percentielscore 0–100 binnen de getoonde gebieden (omgedraaid bij "lager is beter"); Mijn stapel = Σ gewicht × score / Σ gewicht over de lagen met een waarde. Minder dan de helft van het gewicht (naar boven afgerond) met een waarde = geen data.',
    source: [SRC.kwb2025, SRC.crime],
    year: 'zie de gekozen lagen',
    caveats: [
      'Relatief: de score vergelijkt binnen wat de kaart toont: in de stadsweergave wijken met wijken en buurten met buurten, in de Nederland-weergave provincies, gemeenten, wijken en buurten elk apart. Een 80 zegt niet hoe groot het verschil in werkelijkheid is.',
      'Lagen zonder vaste richting (zoals gemeenschappen of afstanden tot cafés) tellen pas mee als je zelf kiest of hoger of lager beter is; geen van beide is goed of slecht.',
      'WOZ waarde staat in de stapel standaard op "lager is beter" (betaalbaarheid); je kunt hem omzetten.',
      'Criminaliteitslagen volgen de keuze Per 1000 inwoners / Absoluut.',
      'Je stapel blijft in je browser (localStorage) en staat in de link (&stack=…); er wordt niets verstuurd.',
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
    caveats: [ROAD_NOTE, 'Alleen treinstations: metro en tram staan apart in Afstand metro, Afstand tram en Afstand OV (trein, metro of tram).', NABIJ_NOTE],
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
  distWarenhuis: {
    description: 'De gemiddelde afstand over de weg van de inwoners tot het dichtstbijzijnde warenhuis (een grote winkel met een breed assortiment, zoals HEMA of de Bijenkorf). Een maat voor “winkels in de buurt” naast de supermarkt.',
    formula: 'gemiddelde wegafstand in km tot een warenhuis, gemiddeld over de inwoners (CBS nabijheid voorzieningen)',
    source: [SRC.nabij2025, SRC.nabij2024],
    year: '2025',
    caveats: [ROAD_NOTE, 'Gewone winkelstraten en kleine winkels tellen niet mee: CBS meet alleen warenhuizen.', DICHTBIJ_NOTE, NABIJ_NOTE],
  },
  distPodium: {
    description: 'De gemiddelde afstand over de weg van de inwoners tot het dichtstbijzijnde podium: theater, concertzaal of poppodium.',
    formula: 'gemiddelde wegafstand in km tot podiumkunsten totaal, gemiddeld over de inwoners (CBS nabijheid voorzieningen)',
    source: [SRC.nabij2025, SRC.nabij2024],
    year: '2025',
    caveats: [ROAD_NOTE, DICHTBIJ_NOTE, NABIJ_NOTE],
  },
  distBioscoop: {
    description: 'De gemiddelde afstand over de weg van de inwoners tot de dichtstbijzijnde bioscoop.',
    formula: 'gemiddelde wegafstand in km tot een bioscoop, gemiddeld over de inwoners (CBS nabijheid voorzieningen)',
    source: [SRC.nabij2025, SRC.nabij2024],
    year: '2025',
    caveats: [ROAD_NOTE, DICHTBIJ_NOTE, NABIJ_NOTE],
  },
  distAttractie: {
    description: 'De gemiddelde afstand over de weg van de inwoners tot de dichtstbijzijnde attractie, zoals een dierentuin, pretpark of andere publiekstrekker.',
    formula: 'gemiddelde wegafstand in km tot een attractie, gemiddeld over de inwoners (CBS nabijheid voorzieningen)',
    source: [SRC.nabij2025, SRC.nabij2024],
    year: '2025',
    caveats: [ROAD_NOTE, DICHTBIJ_NOTE, NABIJ_NOTE],
  },
  distGroen: {
    description: 'De gemiddelde afstand over de weg van de inwoners tot het dichtstbijzijnde openbaar groen: park, plantsoen, recreatiegebied, bos of open natuur. Zegt hoe dichtbij het groen begint, niet hoeveel groen er is.',
    formula: 'gemiddelde wegafstand in km tot openbaar groen totaal, gemiddeld over de inwoners (CBS nabijheid voorzieningen 2017, Bestand Bodemgebruik 2015)',
    source: [SRC.nabij2017],
    year: '2017',
    caveats: [GROEN_NOTE, ROAD_NOTE, 'Klein groen (perkjes, bermen, binnentuinen) telt niet mee; CBS rekent vanaf een minimale oppervlakte.', DICHTBIJ_NOTE],
  },
  distRecreatie: {
    description: 'De gemiddelde afstand over de weg van de inwoners tot het dichtstbijzijnde dagrecreatieve terrein: een recreatiegebied, speeltuin, strandbad, kinderboerderij of volkstuincomplex.',
    formula: 'gemiddelde wegafstand in km tot een dagrecreatief terrein, gemiddeld over de inwoners (CBS nabijheid voorzieningen 2017)',
    source: [SRC.nabij2017],
    year: '2017',
    caveats: [GROEN_NOTE, ROAD_NOTE, DICHTBIJ_NOTE],
  },
  distBos: {
    description: 'De gemiddelde afstand over de weg van de inwoners tot het dichtstbijzijnde bos, zoals het Kralingse Bos, het Zuiderpark-bos of de Veluwe. Echte nabijheid van bos, niet het aandeel groen in het gebied zelf.',
    formula: 'gemiddelde wegafstand in km tot bos, gemiddeld over de inwoners (CBS nabijheid voorzieningen 2017, Bestand Bodemgebruik 2015)',
    source: [SRC.nabij2017],
    year: '2017',
    caveats: [GROEN_NOTE, ROAD_NOTE, 'Bos volgens het Bestand Bodemgebruik: ook kleinere stadsbossen tellen, een grote bomenrij of park zonder bosfunctie niet.', DICHTBIJ_NOTE],
  },
  distOpenNatuur: {
    description: 'De gemiddelde afstand over de weg van de inwoners tot het dichtstbijzijnde open natuurgebied: heide, duinen, kwelders, moeras of rietland.',
    formula: 'gemiddelde wegafstand in km tot open droog of nat natuurlijk terrein, gemiddeld over de inwoners (CBS nabijheid voorzieningen 2017)',
    source: [SRC.nabij2017],
    year: '2017',
    caveats: [GROEN_NOTE, ROAD_NOTE, DICHTBIJ_NOTE],
  },
  distMetro: {
    description: 'Hemelsbrede afstand van het midden van het gebied tot de dichtstbijzijnde metrohalte (RET-metro inclusief de lijnen naar Den Haag en Hoek van Holland, en de Amsterdamse metro). Lager is dichterbij.',
    formula: OV_FORMULA('metrohalte'),
    source: [SRC.osm, SRC.geo],
    year: OV_YEAR,
    caveats: OV_CAVEATS,
  },
  distTram: {
    description: 'Hemelsbrede afstand van het midden van het gebied tot de dichtstbijzijnde tramhalte (RET, HTM, GVB, Utrecht en andere trams in Nederland). Lager is dichterbij.',
    formula: OV_FORMULA('tramhalte'),
    source: [SRC.osm, SRC.geo],
    year: OV_YEAR,
    caveats: OV_CAVEATS,
  },
  distOvHalte: {
    description: 'Hemelsbrede afstand van het midden van het gebied tot de dichtstbijzijnde metro- of tramhalte: de kleinste van Afstand metro en Afstand tram.',
    formula: 'kleinste van Afstand metro en Afstand tram, in km',
    source: [SRC.osm, SRC.geo],
    year: OV_YEAR,
    caveats: [...OV_CAVEATS, DICHTBIJ_NOTE],
  },
  distOv: {
    description: 'Afstand tot het dichtstbijzijnde OV-station: treinstation, metro- of tramhalte, wat het dichtstbij is. Dit cijfer gebruikt de wizard als je bij Vervoer OV kiest.',
    formula: 'kleinste van Afstand treinstation (CBS, over de weg) en Afstand metro/tram (hemelsbreed), in km',
    source: [SRC.nabij2025, SRC.osm, SRC.geo],
    year: OV_YEAR,
    caveats: ['Mengt twee maten: de treinafstand is de CBS-wegafstand gemiddeld over de inwoners, de metro- en tramafstand is hemelsbreed vanaf het midden van het gebied.', 'Zonder CBS-treinafstand (gemeenten, provincies) is er geen waarde.', ...OV_CAVEATS.slice(1)],
  },
  distCentrum: {
    description: `Hemelsbrede afstand van het midden van het gebied tot ${CITY.centrum.name}. Klein = midden in de stad; groot = aan de rand. Beschrijvend: of dat goed is, hangt af van wat je zoekt.`,
    formula: `afstand in km over het aardoppervlak van het zwaartepunt van de gebiedsgrens tot ${CITY.centrum.name} (${centrumCoords()})`,
    source: [SRC.geo],
    year: 'indeling 2024',
    caveats: ['Berekend door deze app uit de kaart, geen CBS-cijfer. Het zwaartepunt van een groot of langgerekt gebied (havens, Hoek van Holland) kan ver van de woningen liggen.', 'Hemelsbreed: de Maas en de havens kunnen de werkelijke reisafstand veel groter maken.', TASTE_NOTE],
  },
  p2000Totaal:   { description: 'Alle meldingen hulpdiensten (P2000) in het gebied: politie, brandweer en ambulance samen, per 1.000 inwoners. Een drukke winkelstraat, uitgaansgebied of snelweg trekt veel meldingen zonder dat er veel mensen wonen.', formula: P2000_FORMULA('meldingen'), source: [SRC.p2000], year: P2000_YEAR, caveats: P2000_NOTES },
  p2000Verkeer:  { description: 'Meldingen hulpdiensten (P2000) over verkeersongevallen, per 1.000 inwoners.', formula: P2000_FORMULA('meldingen van verkeersongevallen'), source: [SRC.p2000], year: P2000_YEAR, caveats: P2000_NOTES },
  p2000Brand:    { description: 'Meldingen hulpdiensten (P2000) over branden, per 1.000 inwoners. Ook kleine meldingen (container, buitenbrand) en automatische brandmeldingen tellen mee.', formula: P2000_FORMULA('brandmeldingen'), source: [SRC.p2000], year: P2000_YEAR, caveats: P2000_NOTES },
  p2000Explosie: { description: 'Meldingen hulpdiensten (P2000) over explosies, per 1.000 inwoners. Kleine aantallen: één melding maakt al verschil.', formula: P2000_FORMULA('meldingen van explosies'), source: [SRC.p2000], year: P2000_YEAR, caveats: P2000_NOTES },
  p2000Geweld:   { description: 'Meldingen hulpdiensten (P2000) over geweld en diefstal, per 1.000 inwoners. Omdat het meeste politieverkeer versleuteld is, is dit maar een klein deel van wat er gebeurt.', formula: P2000_FORMULA('meldingen van geweld en diefstal'), source: [SRC.p2000], year: P2000_YEAR, caveats: P2000_NOTES },
  p2000Spoed:    { description: 'Spoedritten van de ambulance (A1/A2) naar het gebied, per 1.000 inwoners. Hangt sterk samen met de leeftijd van de inwoners en met zorginstellingen in de buurt.', formula: P2000_FORMULA('spoedritten ambulance'), source: [SRC.p2000], year: P2000_YEAR, caveats: P2000_NOTES },
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

// Gemeenschappen per land per gemeente (v0.55.0, herkomst-land.js): CBS 85458NED, all
// single countries. The eight that also have a postcode estimate keep their `hk_*` key
// for every level: per gemeente the CBS figure, per wijk/buurt the estimate.
export const LAND_NOTES = Object.freeze([
  `Per gemeente: de officiële CBS-cijfers (${REGIO_TABLE}, 1 januari ${REGIO_YEAR}), aandeel van alle inwoners, geen schatting.`,
  'Herkomst volgt de CBS-definitie: het eigen geboorteland, of bij geboorte in Nederland dat van de moeder (anders de vader).',
  'Verzamelposten als "voormalig Joegoslavië", "voormalige Sovjet-Unie" en "voormalig Tsjecho-Slowakije" overlappen hun opvolgers en zijn geen eigen laag.',
]);
/** Per-level source of the shared `hk_*` country layers (legend suffix, Uitleg). */
export const LAND_LEVEL_SOURCES = Object.freeze({ gemeente: `CBS ${REGIO_YEAR}`, wijk: `geschat via postcode ${PC4_YEAR}` });
for (const c of LAND_COUNTRIES) {
  const about = c.about ? ` (${c.about})` : '';
  INFO[c.metric] = c.pc4 ? {
    description: `Aandeel inwoners met herkomst ${c.label}${about}. Per gemeente het CBS-cijfer van 1 januari ${REGIO_YEAR}; per wijk en buurt geschat via postcode (${PC4_YEAR}). ${PC4_DEF} Beschrijvend: er zit geen oordeel in.`,
    formula: `inwoners met herkomst ${c.label} / inwoners × 100; per wijk/buurt per postcode verdeeld naar adressen`,
    source: [SRC.herkomst, SRC.pc4, SRC.pc6],
    year: `gemeente ${REGIO_YEAR} (CBS ${REGIO_TABLE}), wijk/buurt ${PC4_YEAR} (geschat via postcode)`,
    caveats: [...LAND_NOTES, ...PC4_NOTES],
  } : {
    description: `Aandeel inwoners met herkomst ${c.label}${about}, per gemeente. CBS publiceert dit land niet per wijk, buurt of postcode, dus per wijk en buurt is er geen waarde. Beschrijvend: er zit geen oordeel in.`,
    formula: `inwoners met herkomst ${c.label} / inwoners × 100`,
    source: [SRC.herkomst],
    year: `gemeente ${REGIO_YEAR} (CBS ${REGIO_TABLE})`,
    caveats: [...LAND_NOTES],
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
  // Laagstapel (docs/plan-laagstapel.md): the user's own combination of layers, modules/stapel.js.
  stapel:           ds('stapel',           'Mijn stapel',          'Mijn stapel (0–100, jouw gekozen lagen)', 'stapel', true, 'score', { inOverall: false }),
  population:       ds('population',       'Bevolking',            'Inwoners',                        'aantal',    null,  'bevolking'),
  density:          ds('density',          'Bevolkingsdichtheid',  'Inwoners per km²',                'per km²',   null,  'bevolking'),
  pop15to24:        ds('pop15to24',        '15–24 jaar (%)',       '15 tot 25 jaar (%)',              '%',         null,  'leeftijd', { ...RTM, inOverall: false }),
  pop25to44:        ds('pop25to44',        '25–44 jaar (%)',       '25 tot 45 jaar (%)',              '%',         null,  'leeftijd', { ...RTM, inOverall: false }),
  pop45to64:        ds('pop45to64',        '45–64 jaar (%)',       '45 tot 65 jaar (%)',              '%',         null,  'leeftijd', { ...RTM, inOverall: false }),
  pop65plus:        ds('pop65plus',        '65+ (%)',              '65+ (%)',                         '%',         null,  'leeftijd'),
  hhWithKidsPct:    ds('hhWithKidsPct',    'Gezinnen (%)',         'Huishoudens met kinderen (%)',    '%',         null,  'bevolking', { ...RTM, inOverall: false }),
  singleHhPct:      ds('singleHhPct',      'Alleenwonenden (%)',   'Eenpersoonshuishoudens (%)',      '%',         null,  'bevolking', { ...RTM, inOverall: false }),
  diversityPct:     ds('diversityPct',     'Diversiteit (%)',      'Diversiteit: inwoners met een niet-Nederlandse herkomst (%)', '%', null, 'herkomst', { inOverall: false }),
  originDutchPct:   ds('originDutchPct',   'Nederland (%)',         'Herkomst Nederland (%)',          '%',         null,  'herkomstDetail', { inOverall: false }),
  originEuropePct:  ds('originEuropePct',  'Europa excl. NL (%)',  'Herkomst Europa excl. NL (%)',    '%',         null,  'herkomstDetail', { inOverall: false }),
  nonWesternPct:    ds('nonWesternPct',    'Buiten Europa (%)',    'Herkomst buiten Europa (%)',      '%',         null,  'herkomstDetail', { inOverall: false }),
  bornAbroadPct:    ds('bornAbroadPct',    'Buitenland geboren (%)', 'In het buitenland geboren (%)', '%',         null,  'herkomstDetail', { ...RTM, inOverall: false }),
  ...Object.fromEntries(REGIONS.map(r => [r.metric, ds(r.metric, `${r.label} (%)`, `Herkomst ${r.label} (%${regionAtBuurt(r.key) ? '' : ', alleen per gemeente'})`, '%', null, 'herkomst', regionAtBuurt(r.key) ? { inOverall: false } : { scope: 'nederland', inOverall: false })])),
  // Gemeenschappen per land, sorted by label (v0.55.0): the CBS countries per gemeente (`hk_*` shared with
  // the postcode estimate per wijk/buurt where there is one) and the two postcode-only groups.
  ...Object.fromEntries([
    ...LAND_COUNTRIES.map(c => [c.metric, c.label, c.pc4
      ? ds(c.metric, `${c.label} (%)`, `Herkomst ${c.label} (%)`, '%', null, 'herkomstLand', { inOverall: false, levelSources: LAND_LEVEL_SOURCES })
      : ds(c.metric, `${c.label} (%)`, `Herkomst ${c.label} (%, alleen per gemeente)`, '%', null, 'herkomstLand', { scope: 'nederland', inOverall: false, levelSources: Object.freeze({ gemeente: LAND_LEVEL_SOURCES.gemeente }) })]),
    ...PC4_GROUPS.filter(g => !LAND_COUNTRIES.some(c => c.metric === g.metric)).map(g => [g.metric, g.label,
      ds(g.metric, `${g.label} (%)`, `Herkomst ${g.label} (%, geschat via postcode ${PC4_YEAR})`, '%', null, 'herkomstLand', { ...RTM, inOverall: false, estimated: true })]),
  ].sort((a, b) => a[1].localeCompare(b[1], 'nl')).map(([k, , d]) => [k, d])),
  highEdu:          ds('highEdu',          'Opleiding',            'Hoog opgeleid (%)',               '%',         true,  'opleiding'),
  eduScore:         ds('eduScore',         'Onderwijsprestatie basisscholen', 'Onderwijsprestatie basisscholen (cijfer, scholen in het gebied)', 'cijfer', true, 'opleiding', { inOverall: false }),
  eduNearScore:     ds('eduNearScore',     'Basisscholen dichtbij (kwaliteit)', `Kwaliteit basisscholen binnen ${kmText(NEAR_RADIUS_KM)} km (cijfer)`, 'cijfer', true, 'opleiding', { inOverall: false }),
  eduNearBest:      ds('eduNearBest',      'Beste basisschool dichtbij', `Beste basisschool binnen ${kmText(NEAR_BEST_KM)} km (cijfer)`, 'cijfer', true, 'opleiding', { inOverall: false }),
  eduStreefPct:     ds('eduStreefPct',     'Basisschool streefniveau (%)', 'Basisschoolresultaten op streefniveau 2F/1S (%)', '%', true, 'opleiding', { inOverall: false }),
  eduFundPct:       ds('eduFundPct',       'Basisschool 1F (%)',   'Basisschoolresultaten ten minste 1F (%)', '%', true, 'opleiding', { inOverall: false }),
  avgIncome:        ds('avgIncome',        'Inkomen',              'Gem. inkomen (×€1k)',             '×€1.000',   true,  'welvaart'),
  wozValue:         ds('wozValue',         'WOZ waarde',           'Gem. WOZ waarde (×€1k)',          '×€1.000',   true,  'welvaart'),
  ownerOccupiedPct: ds('ownerOccupiedPct', 'Koopwoningen (%)',     'Koopwoningen (%)',                '%',         null,  'welvaart', RTM),
  rentalPct:        ds('rentalPct',        'Huurwoningen (%)',     'Huurwoningen (%)',                '%',         null,  'welvaart', RTM),
  newBuildPct:      ds('newBuildPct',      'Nieuwbouw (%)',        'Woningen jonger dan 10 jaar (%)', '%',         null,  'welvaart', { ...RTM, inOverall: false }),
  oldBuildPct:      ds('oldBuildPct',      'Oude bouw (%)',        `Woningen van vóór ${OLD_BUILD_BEFORE} (%, geschat via postcode ${PC4_YEAR})`, '%', null, 'welvaart', { ...RTM, inOverall: false, estimated: true }),
  modernBuildPct:   ds('modernBuildPct',   'Moderne bouw (%)',     `Woningen van ${MODERN_BUILD_FROM} of later (%, geschat via postcode ${PC4_YEAR})`, '%', null, 'welvaart', { ...RTM, inOverall: false, estimated: true }),
  welfarePer1000:   ds('welfarePer1000',   'Bijstand',             'Bijstand per 1.000 inw.',         'per 1.000', false, 'welvaart', RTM),
  crimeRate:        ds('crimeRate',        'Misdrijven totaal',        'Misdrijven per 1.000 inw.',       'per 1.000', false, 'criminaliteit'),
  crimeBurglary:    ds('crimeBurglary',    'Woninginbraak',        'Woninginbraak per 1.000 inw.',    'per 1.000', false, 'criminaliteit', { ...RTM, inOverall: false }),
  crimeBike:        ds('crimeBike',        'Fietsendiefstal',      'Fietsendiefstal per 1.000 inw.',  'per 1.000', false, 'criminaliteit', { ...RTM, inOverall: false }),
  crimePickpocket:  ds('crimePickpocket',  'Zakkenrollerij',       'Zakkenrollerij per 1.000 inw.',   'per 1.000', false, 'criminaliteit', { ...RTM, inOverall: false }),
  crimeViolence:    ds('crimeViolence',    'Geweldsmisdrijven',    'Geweld per 1.000 inw.',           'per 1.000', false, 'criminaliteit', { ...RTM, inOverall: false }),
  crimeStreetRobbery: ds('crimeStreetRobbery', 'Straatroof',       'Straatroof per 1.000 inw.',       'per 1.000', false, 'criminaliteit', { ...RTM, inOverall: false }),
  crimeThreat:      ds('crimeThreat',      'Bedreiging',           'Bedreiging per 1.000 inw.',       'per 1.000', false, 'criminaliteit', { ...RTM, inOverall: false }),
  crimeVehicle:     ds('crimeVehicle',     'Diefstal uit auto',    'Diefstal uit/vanaf auto per 1.000 inw.', 'per 1.000', false, 'criminaliteit', { ...RTM, inOverall: false }),
  crimeShoplifting: ds('crimeShoplifting', 'Winkeldiefstal',       'Winkeldiefstal per 1.000 inw.',   'per 1.000', false, 'criminaliteit', { ...RTM, inOverall: false }),
  crimeVandalism:   ds('crimeVandalism',   'Vernieling',           'Vernieling per 1.000 inw.',       'per 1.000', false, 'criminaliteit', { ...RTM, inOverall: false }),
  crimeDrugs:       ds('crimeDrugs',       'Drugshandel',          'Drugshandel per 1.000 inw.',      'per 1.000', false, 'criminaliteit', { ...RTM, inOverall: false }),
  crimeDensity:     ds('crimeDensity',     'Misdrijven per km²',   'Misdrijven per km² land',         'per km²',   false, 'criminaliteit', { ...RTM, inOverall: false }),
  crimeNearby:      ds('crimeNearby',      'Criminaliteit omgeving', 'Misdrijven per km² in en rond het gebied', 'per km²', false, 'criminaliteit', { ...RTM, inOverall: false }),
  distGP:           ds('distGP',           'Afstand huisarts',     'Afstand tot huisarts (km)',       'km',        false, 'voorzieningen', RTM),
  distSupermarket:  ds('distSupermarket',  'Afstand supermarkt',   'Afstand tot grote supermarkt (km)', 'km',      false, 'voorzieningen', RTM),
  distSchool:       ds('distSchool',       'Afstand basisschool',  'Afstand tot basisschool (km)',    'km',        false, 'voorzieningen', RTM),
  distKinderopvang: ds('distKinderopvang', 'Afstand kinderopvang', 'Afstand tot kinderdagverblijf (km)', 'km',     false, 'voorzieningen', RTM),
  distStation:      ds('distStation',      'Afstand treinstation', 'Afstand tot treinstation (km)',   'km',        false, 'voorzieningen', RTM),
  distCafe:         ds('distCafe',         'Afstand café',         'Afstand tot café (km)',           'km',        null,  'voorzieningen', { ...RTM, inOverall: false }),
  horeca1km:        ds('horeca1km',        'Horeca binnen 1 km',   'Cafés en restaurants binnen 1 km', 'aantal',   null,  'voorzieningen', { ...RTM, inOverall: false }),
  distWarenhuis:    ds('distWarenhuis',    'Afstand warenhuis',    'Afstand tot warenhuis (km)',      'km',        null,  'voorzieningen', { ...RTM, inOverall: false }),
  distPodium:       ds('distPodium',       'Afstand podium',       'Afstand tot theater of podium (km)', 'km',     null,  'voorzieningen', { ...RTM, inOverall: false }),
  distBioscoop:     ds('distBioscoop',     'Afstand bioscoop',     'Afstand tot bioscoop (km)',       'km',        null,  'voorzieningen', { ...RTM, inOverall: false }),
  distAttractie:    ds('distAttractie',    'Afstand attractie',    'Afstand tot attractie (km)',      'km',        null,  'voorzieningen', { ...RTM, inOverall: false }),
  distGroen:        ds('distGroen',        'Afstand groen',        'Afstand tot openbaar groen (km, 2017)', 'km',  null,  'voorzieningen', { ...RTM, inOverall: false }),
  distRecreatie:    ds('distRecreatie',    'Afstand recreatiegebied', 'Afstand tot recreatiegebied (km, 2017)', 'km', null, 'voorzieningen', { ...RTM, inOverall: false }),
  distBos:          ds('distBos',          'Afstand bos',          'Afstand tot bos (km, 2017)',      'km',        null,  'voorzieningen', { ...RTM, inOverall: false }),
  distOpenNatuur:   ds('distOpenNatuur',   'Afstand open natuur',  'Afstand tot open natuur (km, 2017)', 'km',     null,  'voorzieningen', { ...RTM, inOverall: false }),
  waterPct:         ds('waterPct',         'Water (%)',            'Water in de oppervlakte (%)',     '%',         null,  'voorzieningen', { ...RTM, inOverall: false }),
  distMetro:        ds('distMetro',        'Afstand metro',        'Hemelsbreed tot metrohalte (km)', 'km',         null,  'voorzieningen', { inOverall: false }),
  distTram:         ds('distTram',         'Afstand tram',         'Hemelsbreed tot tramhalte (km)',  'km',         null,  'voorzieningen', { inOverall: false }),
  distOvHalte:      ds('distOvHalte',      'Afstand metro/tram',   'Hemelsbreed tot metro- of tramhalte (km)', 'km', null, 'voorzieningen', { inOverall: false }),
  distOv:           ds('distOv',           'Afstand OV',           'Tot trein-, metro- of tramstation (km)', 'km',  null,  'voorzieningen', { inOverall: false }),
  distCentrum:      ds('distCentrum',      'Afstand centrum',      `Hemelsbreed tot ${CITY.centrum.name} (km)`, 'km', null, 'voorzieningen', { ...RTM, inOverall: false }),
  // Live (W30): values only exist once modules/p2000.js loaded them; `live` keeps them out of Ranglijst and Vergelijken.
  // Milieu (plan-milieu phase 1): per buurt, all of NL (modules/milieu.js loads them on first use).
  noiseAnyPct:      ds('noiseAnyPct',      'Stilte-index (geluidhinder totaal)', `Ernstige geluidhinder, alle bronnen (% volwassenen, schatting ${HINDER_YEAR})`, '%', false, 'milieu', { inOverall: false, estimated: true }),
  noiseRoadPct:     ds('noiseRoadPct',     'Geluidhinder wegverkeer', `Ernstige geluidhinder door wegverkeer (% volwassenen, schatting ${HINDER_YEAR})`, '%', false, 'milieu', { inOverall: false, estimated: true }),
  noiseNeighbourPct: ds('noiseNeighbourPct', 'Geluidhinder buren',    `Ernstige geluidhinder door buren (% volwassenen, schatting ${HINDER_YEAR})`, '%', false, 'milieu', { inOverall: false, estimated: true }),
  heatPet:          ds('heatPet',          'Gevoelstemperatuur',   `Gevoelstemperatuur op een hete dag (°C, PET ${PET_YEAR})`, '°C', false, 'milieu', { inOverall: false }),
  shadePct:         ds('shadePct',         'Schaduw',              `Schaduw op fiets- en wandelpaden (%, ${SHADE_YEAR})`, '%', true, 'milieu', { inOverall: false }),
  airNo2:           ds('airNo2',           'Stikstofdioxide (NO₂)', `Stikstofdioxide NO₂, jaargemiddelde (µg/m³, ${AIR_YEAR})`, 'µg/m³', false, 'milieu', { inOverall: false }),
  airPm25:          ds('airPm25',          'Fijnstof (PM2,5)',      `Fijnstof PM2,5, jaargemiddelde (µg/m³, ${AIR_YEAR})`, 'µg/m³', false, 'milieu', { inOverall: false }),
  pfasSourceKm:     ds('pfasSourceKm',     'Afstand tot verdachte PFAS-bron', 'Afstand tot de dichtstbijzijnde verdachte PFAS-bron (km)', 'km', true, 'milieu', { inOverall: false }),
  p2000Totaal:      ds('p2000Totaal',      'Alle meldingen',       'Meldingen hulpdiensten (P2000) per 1.000 inw.', 'per 1.000', null, 'actueel', { inOverall: false, live: true }),
  p2000Verkeer:     ds('p2000Verkeer',     'Verkeersongevallen',   'Verkeersongevallen (P2000) per 1.000 inw.', 'per 1.000', null, 'actueel', { inOverall: false, live: true }),
  p2000Brand:       ds('p2000Brand',       'Branden',              'Branden (P2000) per 1.000 inw.',   'per 1.000', null, 'actueel', { inOverall: false, live: true }),
  p2000Explosie:    ds('p2000Explosie',    'Explosies',            'Explosies (P2000) per 1.000 inw.', 'per 1.000', null, 'actueel', { inOverall: false, live: true }),
  p2000Geweld:      ds('p2000Geweld',      'Geweld en diefstal',   'Geweld en diefstal (P2000) per 1.000 inw.', 'per 1.000', null, 'actueel', { inOverall: false, live: true }),
  p2000Spoed:       ds('p2000Spoed',       'Spoedritten ambulance', 'Spoedritten ambulance (P2000) per 1.000 inw.', 'per 1.000', null, 'actueel', { inOverall: false, live: true }),
});

export const DATASET_KEYS = Object.freeze(Object.keys(DATASETS));

// ── Categories (v0.32.0) ─────────────────────────────────────────────────────
// One category list for the Layers dropdown, the Uitleg panel and the
// Ranglijst "Categorie" / "Onderdeel" pickers. `headline` is the metric a
// category ranks on when no Onderdeel is chosen (and the first layer in it).
// `layer: false` = data kept for wizard, modal and Uitleg, but no layer and no
// Ranglijst column: the separate herkomst indelingen (Nederland / Europa /
// buiten Europa / buitenland geboren) gave way to the per-regio layers on
// 15 Nov 2026; links with those ids land on RETIRED_LAYERS. 16 Nov 2026:
// Diversiteit (100 − Nederland) heads Gemeenschappen and the ten postcode
// country groups are layers again under Gemeenschappen per land.
const ALL_DATASET_GROUPS = Object.freeze([
  Object.freeze({ key: 'score',          label: 'Woonscore',                     headline: 'woonscore' }),
  Object.freeze({ key: 'bevolking',      label: 'Bevolking & huishoudens',       headline: 'population' }),
  Object.freeze({ key: 'leeftijd',       label: 'Leeftijd',                      headline: 'pop65plus' }),
  Object.freeze({ key: 'herkomst',       label: 'Gemeenschappen',                headline: 'diversityPct' }),
  Object.freeze({ key: 'herkomstLand',   label: 'Gemeenschappen per land',       headline: 'hk_marokko' }),
  Object.freeze({ key: 'criminaliteit',  label: 'Criminaliteit',                 headline: 'crimeRate' }),
  Object.freeze({ key: 'opleiding',      label: 'Opleiding',                     headline: 'highEdu' }),
  Object.freeze({ key: 'welvaart',       label: 'Welvaart & wonen',              headline: 'avgIncome' }),
  Object.freeze({ key: 'milieu',         label: 'Milieu',                        headline: 'noiseAnyPct' }),
  Object.freeze({ key: 'voorzieningen',  label: 'Voorzieningen',                 headline: 'distSupermarket' }),
  Object.freeze({ key: 'actueel',        label: 'Actueel: meldingen hulpdiensten', headline: 'p2000Totaal', live: true }),
  Object.freeze({ key: 'herkomstDetail', label: 'Gemeenschappen (overige indelingen)', headline: null, layer: false }),
]);
/** Groups of `city`: without Actueel when the city has no P2000 source (config/cities.json `p2000`). */
export const cityDatasetGroups = (city = CITY) => Object.freeze(ALL_DATASET_GROUPS.filter(g => g.key !== 'actueel' || city.p2000 !== false));
export const DATASET_GROUPS = cityDatasetGroups(CITY);
/** Group keys that exist in the app but not in this city: their datasets are left out of every section. */
const HIDDEN_GROUPS = new Set(ALL_DATASET_GROUPS.filter(g => !DATASET_GROUPS.includes(g)).map(g => g.key));

/**
 * Old layer ids → the nearest layer that still exists (deep links, share
 * links, Ranglijst rank/sort). Europa excl. NL to West-Europa (Duitsland,
 * België), buiten Europa to Zuid-Amerika (Suriname, Rotterdam's largest
 * group), Nederland and buitenland geboren to Diversiteit (16 Nov 2026). The
 * postcode country groups (hk_*) are layers again and no longer redirect.
 */
export const RETIRED_LAYERS = Object.freeze({
  originEuropePct: 'hr_westEuropa',
  nonWesternPct:   'hr_zuidAmerika',
  originDutchPct:  'diversityPct',
  bornAbroadPct:   'diversityPct',
});

/** A layer key for `key`: a retired id maps to its successor; anything else is returned as is. */
export const resolveLayerKey = key => RETIRED_LAYERS[key] ?? key;

const LAYER_GROUPS = DATASET_GROUPS.filter(g => g.layer !== false);
/** True for live layers (P2000, W30): on the map and in Uitleg, never in Ranglijst, Vergelijken or a score. */
export const isLiveDataset = key => !!DATASETS[key]?.live;
/** The categories that have layers (Layers dropdown, Ranglijst). */
export const LAYER_CATEGORIES = Object.freeze(LAYER_GROUPS);

/**
 * Datasets per dropdown section, in DATASET_GROUPS order, each section in
 * DATASETS order: [{ key, label, headline, scope, datasets }]. Empty
 * sections are dropped; a dataset with an unknown group lands in the last
 * layer section. Sections with `layer: false` only show with `includeHidden` (Uitleg).
 * `scope` is 'rotterdam' ('nederland') when every dataset in the section is Rotterdam-only (gemeente-only).
 */
export function groupDatasets(datasets = DATASETS, groups = DATASET_GROUPS, { includeHidden = false } = {}) {
  const known = new Set(groups.map(g => g.key));
  const last = [...groups].reverse().find(g => g.layer !== false && !g.live)?.key;   // never the live Actueel section
  return groups.filter(g => includeHidden || g.layer !== false).map(g => {
    const list = Object.values(datasets).filter(d => !HIDDEN_GROUPS.has(d.group) && (known.has(d.group) ? d.group : last) === g.key);
    const only = ['rotterdam', 'nederland'].find(sc => list.length && list.every(d => d.scope === sc));
    return { key: g.key, label: g.label, headline: g.headline ?? null, scope: only ?? 'all', datasets: list };
  }).filter(g => g.datasets.length);
}

/** Every layer dataset key (Layers dropdown and Ranglijst columns), in category order. */
export const LAYER_KEYS = Object.freeze(groupDatasets().flatMap(g => g.datasets.map(d => d.key)));

/** The layer category key of dataset `key` (after resolveLayerKey), or null. */
export function categoryOf(key) {
  const k = resolveLayerKey(key);
  if (!LAYER_KEYS.includes(k)) return null;
  return LAYER_GROUPS.find(g => g.key === DATASETS[k].group)?.key ?? LAYER_GROUPS[LAYER_GROUPS.length - 1].key;
}

/** Layer datasets of category `cat` with data in `scope` (all scopes when omitted). */
export function categoryDatasets(cat, scope = null) {
  return LAYER_KEYS.filter(k => categoryOf(k) === cat && (!scope || datasetInScope(k, scope))).map(k => DATASETS[k]);
}

/** The metric a category ranks on in `scope` when no Onderdeel is chosen: its headline, else its first layer there; null when it has none. */
export function categoryHeadline(cat, scope = null) {
  const list = categoryDatasets(cat, scope);
  const h = LAYER_GROUPS.find(g => g.key === cat)?.headline;
  return list.find(d => d.key === h)?.key ?? list[0]?.key ?? null;
}

/** Ranglijst rank key from the two pickers: `sub` when it is a layer of `cat` in scope, else the category headline. */
export function rankKeyForCategory(cat, sub = null, scope = null) {
  if (cat === 'overall') return 'overall';
  return sub && categoryDatasets(cat, scope).some(d => d.key === sub) ? sub : categoryHeadline(cat, scope);
}

/** Per-level source note of `key` for the legend ('' when the dataset has none): level 'gemeente' or 'wijk'/'buurt'. */
export function levelSourceText(key, level) {
  const s = DATASETS[key]?.levelSources;
  if (!s) return '';
  return (level === 'gemeente' ? s.gemeente : level === 'wijk' || level === 'buurt' ? s.wijk : null) ?? '';
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

let absAreaCache = new WeakMap();
/** Forgets the cached Absoluut copies (after values were written in place, e.g. Mijn stapel). */
export function resetCrimeAreas() { absAreaCache = new WeakMap(); }
/**
 * Areas ({ values }) as seen in `mode`; 'rate' returns the same array. The
 * 'abs' copy is cached per input array, so repeated calls return the same objects.
 */
export function crimeAreas(areas, mode = 'rate') {
  if (mode !== 'abs' || !Array.isArray(areas)) return areas;
  if (!absAreaCache.has(areas)) absAreaCache.set(areas, areas.map(a => ({ ...a, values: crimeValues(a.values ?? {}, 'abs') })));
  return absAreaCache.get(areas);
}
