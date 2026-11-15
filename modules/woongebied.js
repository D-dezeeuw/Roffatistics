// Woongebied: is a wijk or buurt a place where people live, or a business,
// port or recreation area with (almost) no residents? Pure, no DOM.
//
// CBS publishes no list or flag of non-residential buurten. The classification
// uses four columns of Kerncijfers wijken en buurten (86165NED, same table and
// indeling as the rest of the data): AantalInwoners_5, Woningvoorraad_35,
// NietWoningvoorraad_37 (BAG verblijfsobjecten without woonfunctie: offices,
// shops, industry, recreation homes) and BedrijfsvestigingenTotaal_95.
// Thresholds and the research behind them: docs/decisions.md (W7, 15 Nov 2026).
//
// Non-residential areas are left out of the Woonscore peers, the modal ranks
// and the Ranglijst ranking (presets.js, area-detail.js, list.js); areas with
// few residents stay in and keep the shrinkage and "weinig inwoners" badge.

const isNum = v => typeof v === 'number' && Number.isFinite(v);

export const WOON_THRESHOLDS = Object.freeze({
  residentPop: 200,     // ≥ 200 inwoners: always a woongebied
  residentHomes: 100,   // ≥ 100 woningen: always a woongebied
  minNonRes: 20,        // a business area has ≥ 20 niet-woningen …
  nonResRatio: 3,       // … at least 3 × the woningen (farm hamlets with barns stay in) …
  fewHomes: 20,         // … and fewer than 20 woningen,
  strongRatio: 10,      //     or at least 10 × the woningen (Spaanse Polder: 30 woningen, 799 niet-woningen)
  businessShare: 0.2,   // bedrijfsvestigingen ≥ 0.2 × niet-woningen → bedrijven, else recreatie/voorzieningen
  emptyPop: 20,         // < 20 inwoners and
  emptyHomes: 10,       // < 10 woningen without niet-woningen → vrijwel onbewoond
  fewPop: 300,          // < 300 inwoners: "weinig inwoners" (= score.js SHRINK_K), still a woongebied
});

export const WOON_KINDS = Object.freeze(['wonen', 'weinig', 'bedrijven', 'overig', 'onbewoond']);

export const WOON_LABELS = Object.freeze({
  wonen: 'Woongebied',
  weinig: 'Woongebied met weinig inwoners',
  bedrijven: 'Geen woonwijk (bedrijven-/havengebied)',
  overig: 'Geen woonwijk (recreatie, voorzieningen of bedrijven)',
  onbewoond: 'Geen woonwijk (vrijwel onbewoond)',
});

/**
 * Class of one area from its values { population, housingStock,
 * nonResidentialStock, businesses }. Gemeenten and provincies (code GM/PV)
 * are always a woongebied. Missing counts never exclude an area: without
 * inwoners and woningen known it is 'wonen'.
 * Returns { kind, residential, label }.
 */
export function classifyWoongebied(values, code = null, t = WOON_THRESHOLDS) {
  const out = kind => ({ kind, residential: kind === 'wonen' || kind === 'weinig', label: WOON_LABELS[kind] });
  if (code && !/^(WK|BU)/.test(String(code))) return out('wonen');
  const v = values ?? {};
  const pop = v.population, homes = v.housingStock, nonRes = v.nonResidentialStock, firms = v.businesses;
  if (!isNum(pop) && !isNum(homes)) return out('wonen');
  const p = isNum(pop) ? pop : 0, w = isNum(homes) ? homes : 0, nw = isNum(nonRes) ? nonRes : 0;
  const lived = p < t.fewPop ? 'weinig' : 'wonen';
  if ((isNum(pop) && p >= t.residentPop) || w >= t.residentHomes) return out(lived);
  if (nw >= t.minNonRes && nw >= t.nonResRatio * w && (w < t.fewHomes || nw >= t.strongRatio * w)) {
    return out(isNum(firms) && firms >= t.businessShare * nw ? 'bedrijven' : 'overig');
  }
  if (p < t.emptyPop && w < t.emptyHomes) return out('onbewoond');
  return out(lived);
}

/** True when the area ({ code, values }) counts as a woongebied (peers, ranks). */
export function isResidentialArea(area) {
  return classifyWoongebied(area?.values, area?.code).residential;
}

/** "Geen woonwijk (…)" for a non-residential area, else null. */
export function nonResidentialLabel(area) {
  const c = classifyWoongebied(area?.values, area?.code);
  return c.residential ? null : c.label;
}

/** { peers, excluded }: the residential areas and the rest, order kept. */
export function splitResidential(areas) {
  const peers = [], excluded = [];
  for (const a of areas ?? []) (isResidentialArea(a) ? peers : excluded).push(a);
  return { peers, excluded };
}

/** Count per kind: { wonen, weinig, bedrijven, overig, onbewoond }. */
export function countWoongebied(areas) {
  const c = Object.fromEntries(WOON_KINDS.map(k => [k, 0]));
  for (const a of areas ?? []) c[classifyWoongebied(a?.values, a?.code).kind]++;
  return c;
}

/** "5 inwoners · 2 woningen · 206 niet-woningen · 200 bedrijfsvestigingen" (known counts only). */
export function woongebiedFacts(values) {
  const v = values ?? {};
  const nl = n => Math.round(n).toLocaleString('nl-NL');
  return [
    isNum(v.population) ? `${nl(v.population)} inwoners` : null,
    isNum(v.housingStock) ? `${nl(v.housingStock)} woningen` : null,
    isNum(v.nonResidentialStock) ? `${nl(v.nonResidentialStock)} niet-woningen` : null,
    isNum(v.businesses) ? `${nl(v.businesses)} bedrijfsvestigingen` : null,
  ].filter(Boolean).join(' · ');
}
