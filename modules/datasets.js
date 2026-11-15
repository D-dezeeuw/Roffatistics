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
  crimeNl: Object.freeze({ id: '83648NED', name: 'Geregistreerde criminaliteit; soort misdrijf, regio', publisher: 'CBS', url: statline('83648NED'), scope: 'Nederland' }),
});

const FALLBACK_NOTE = 'Ontbreekt het 2025-cijfer voor een gebied, dan wordt het 2024-cijfer (85984NED) getoond; het paneel noemt dat onder Peiljaar.';
const CRIME_PLACE_NOTE = 'Per inwoner telt de plek van het misdrijf, niet waar daders of slachtoffers wonen: drukke gebieden met weinig bewoners (Centrum, Stadsdriehoek, haven-, winkel- en uitgaansgebieden) komen daardoor hoog uit. De stand Absoluut laat de aantallen zelf zien.';
const CRIME_MIN_NOTE = 'Geen per-1.000-cijfer voor wijken onder 1.000 en buurten onder 200 inwoners ("geen data"); in de stand Absoluut krijgen ze wel een waarde.';
const CRIME_SUB_NOTE = 'Telt niet mee in de totaalscore van de Ranglijst (anders weegt criminaliteit vijf keer).';
const CRIME_CELL_NOTE = 'De politie laat sommige kleine aantallen weg; een opgetelde categorie is pas "geen data" als alle delen ontbreken.';

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
  pop65plus: {
    description: 'Het aandeel inwoners van 65 jaar of ouder. Hoog = een vergrijsd gebied. Beschrijvend: er zit geen oordeel in.',
    formula: 'inwoners van 65 jaar of ouder / inwoners × 100',
    source: [SRC.kwb2025, SRC.regio],
    year: '2025 (wijk/buurt) · 2023 (Nederland)',
    caveats: [FALLBACK_NOTE],
  },
  nonWesternPct: {
    description: 'Het aandeel inwoners met een herkomstland buiten Europa: het eigen geboorteland, of bij in Nederland geborenen dat van de ouders. Beschrijvend: er zit geen oordeel in.',
    formula: 'inwoners met herkomst buiten Europa / inwoners × 100',
    source: [SRC.kwb2025, SRC.regio],
    year: '2025 (wijk/buurt) · 2023 (Nederland)',
    caveats: ['Vervangt de oude CBS-indeling "niet-westerse migratieachtergrond"; niet één op één vergelijkbaar met oudere cijfers.', FALLBACK_NOTE],
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
};

const freezeInfo = info => info ? { ...info, source: Object.freeze([...(info.source ?? [])]), caveats: Object.freeze([...(info.caveats ?? [])]) } : {};
const ds = (key, label, title, unit, higherIsBetter, group, extra = {}) =>
  Object.freeze({ key, label, title, unit, higherIsBetter, group, scope: 'all', inOverall: true, ...freezeInfo(INFO[key]), ...extra });
const RTM = { scope: 'rotterdam' };

export const DATASETS = Object.freeze({
  population:       ds('population',       'Bevolking',            'Inwoners',                        'aantal',    null,  'bevolking'),
  density:          ds('density',          'Bevolkingsdichtheid',  'Inwoners per km²',                'per km²',   null,  'bevolking'),
  pop65plus:        ds('pop65plus',        '65+ (%)',              '65+ (%)',                         '%',         null,  'bevolking'),
  nonWesternPct:    ds('nonWesternPct',    'Buiten Europa (%)',    'Herkomst buiten Europa (%)',      '%',         null,  'bevolking'),
  highEdu:          ds('highEdu',          'Opleiding',            'Hoog opgeleid (%)',               '%',         true,  'bevolking'),
  avgIncome:        ds('avgIncome',        'Inkomen',              'Gem. inkomen (×€1k)',             '×€1.000',   true,  'welvaart'),
  wozValue:         ds('wozValue',         'WOZ waarde',           'Gem. WOZ waarde (×€1k)',          '×€1.000',   true,  'welvaart'),
  ownerOccupiedPct: ds('ownerOccupiedPct', 'Koopwoningen (%)',     'Koopwoningen (%)',                '%',         null,  'welvaart', RTM),
  rentalPct:        ds('rentalPct',        'Huurwoningen (%)',     'Huurwoningen (%)',                '%',         null,  'welvaart', RTM),
  welfarePer1000:   ds('welfarePer1000',   'Bijstand',             'Bijstand per 1.000 inw.',         'per 1.000', false, 'welvaart', RTM),
  crimeRate:        ds('crimeRate',        'Criminaliteit',        'Misdrijven per 1.000 inw.',       'per 1.000', false, 'veiligheid'),
  crimeBurglary:    ds('crimeBurglary',    'Woninginbraak',        'Woninginbraak per 1.000 inw.',    'per 1.000', false, 'veiligheid', { ...RTM, inOverall: false }),
  crimeBike:        ds('crimeBike',        'Fietsendiefstal',      'Fietsendiefstal per 1.000 inw.',  'per 1.000', false, 'veiligheid', { ...RTM, inOverall: false }),
  crimePickpocket:  ds('crimePickpocket',  'Zakkenrollerij',       'Zakkenrollerij per 1.000 inw.',   'per 1.000', false, 'veiligheid', { ...RTM, inOverall: false }),
  crimeViolence:    ds('crimeViolence',    'Geweldsmisdrijven',    'Geweld per 1.000 inw.',           'per 1.000', false, 'veiligheid', { ...RTM, inOverall: false }),
  distGP:           ds('distGP',           'Afstand huisarts',     'Afstand tot huisarts (km)',       'km',        false, 'voorzieningen', RTM),
  distSupermarket:  ds('distSupermarket',  'Afstand supermarkt',   'Afstand tot grote supermarkt (km)', 'km',      false, 'voorzieningen', RTM),
});

export const DATASET_KEYS = Object.freeze(Object.keys(DATASETS));

export const DATASET_GROUPS = Object.freeze([
  Object.freeze({ key: 'bevolking',     label: 'Bevolking' }),
  Object.freeze({ key: 'welvaart',      label: 'Welvaart & wonen' }),
  Object.freeze({ key: 'veiligheid',    label: 'Veiligheid' }),
  Object.freeze({ key: 'voorzieningen', label: 'Voorzieningen' }),
]);

/**
 * Datasets per dropdown section, in DATASET_GROUPS order, each section in
 * DATASET_KEYS order: [{ key, label, scope, datasets: [dataset…] }]. Empty
 * sections are dropped; a dataset with an unknown group lands in the last one.
 * `scope` is 'rotterdam' when every dataset in the section is Rotterdam-only.
 */
export function groupDatasets(datasets = DATASETS, groups = DATASET_GROUPS) {
  const known = new Set(groups.map(g => g.key));
  const last = groups[groups.length - 1]?.key;
  return groups.map(g => {
    const list = Object.values(datasets).filter(d => (known.has(d.group) ? d.group : last) === g.key);
    return { key: g.key, label: g.label, scope: list.length && list.every(d => d.scope === 'rotterdam') ? 'rotterdam' : 'all', datasets: list };
  }).filter(g => g.datasets.length);
}

/** True when `key` has data in the given scope ('rotterdam' | 'nederland'). */
export function datasetInScope(key, scope) {
  const d = DATASETS[key];
  return !!d && (scope === 'rotterdam' || d.scope !== 'rotterdam');
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
