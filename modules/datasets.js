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

export function normalizeProvinces(rows) {
  return rows.map(r => ({
    regionCode: r.RegioS.trim(),
    population: r.TotaleBevolking_1,
    avgIncome:  r.BronInkomenAlsWerknemer_141,  // ×€1,000
    areaSqKm:   r.TotaleOppervlakte_248,
    density:    r.TotaleOppervlakte_248
      ? Math.round(r.TotaleBevolking_1 / r.TotaleOppervlakte_248)
      : null,
    lowEdu:  r.BasisonderwijsVmboMbo1_113 ?? null,  // % vmbo/mbo1 or below
    medEdu:  r.HavoVwoMbo24_114           ?? null,  // % havo/vwo/mbo2-4
    highEdu: r.HboWo_115                  ?? null,  // % hbo/wo
  }));
}

const CRIME_CATEGORY_LABELS = {
  CRI1000: 'Vermogen',
  CRI2000: 'Vernieling',
  CRI3000: 'Geweld',
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
