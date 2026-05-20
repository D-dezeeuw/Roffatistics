const CBS_BASE = 'https://opendata.cbs.nl/ODataApi/odata';

export function buildCBSUrl(tableId, filter, select) {
  const params = new URLSearchParams({ $filter: filter });
  if (select) params.set('$select', select);
  return `${CBS_BASE}/${tableId}/TypedDataSet?${params}`;
}

export async function fetchCBS(
  tableId,
  filter,
  select  = null,
  fetcher = globalThis.fetch,
  storage = globalThis.sessionStorage,
) {
  const url    = buildCBSUrl(tableId, filter, select);
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
  }));
}
