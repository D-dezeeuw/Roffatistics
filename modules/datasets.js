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
const ds = (key, label, title, unit, higherIsBetter, group, extra = {}) =>
  Object.freeze({ key, label, title, unit, higherIsBetter, group, scope: 'all', inOverall: true, ...extra });
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
