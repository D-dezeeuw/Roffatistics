# Roffatistics

Interactive map-based data visualization for the Netherlands. Explore CBS public statistics — demographics, crime, and education — on an interactive choropleth map, from province level down to municipality and neighbourhood.

**Live:** [d-dezeeuw.github.io/Roffatistics](https://d-dezeeuw.github.io/Roffatistics)

---

## Features

- **Rotterdam mode (default)** — the map locks onto gemeente Rotterdam, masks everything outside it, and colours all 21 CBS wijken; from zoom 13 the 91 buurten take over. Areas without data share one neutral colour ("geen data" in the legend)
- **Nederland mode** — pick "Nederland" in the topnav dropdown for the national view below
- **Ranglijst** — the list view ranks every wijk or buurt (or province/gemeente in Nederland mode) on a 0–100 percentile score per dataset, sortable per column, with heat bars; click a row to open its detail modal, the pin icon opens it on the map
- **Dashboard** — the Algemeen tab shows six rows of three panels (Woonscore, Leeftijd, Herkomst, Criminaliteit, Opleiding, Welvaart & wonen) for the city's wijken or, in Nederland mode, all gemeenten; with an area selected, the panels compare it with the city or Nederland. Under Criminaliteit, the misdrijven-per-1.000 panel shows the total plus the 5 buurten (city) or 5 gemeenten (Nederland) with the fewest crimes, next to the crime types and the safest and least safe areas. The Jouw dashboard tab (after the wizard) reworks the panels around your top 10. A click on a list row opens that area's detail modal
- **Layers in sections** — Bevolking, Herkomst, Herkomst per land, Herkomst per regio, Welvaart & wonen, Veiligheid, Voorzieningen, generated from `DATASETS` (two columns on wide screens); Rotterdam-only layers (housing, bijstand, crime sub-layers, distances) hide in Nederland mode, and Veiligheid then says how many it hides
- **Veiligheid per wijk/buurt** — Misdrijven totaal plus ten police categories (47018NED): woninginbraak, fietsendiefstal, zakkenrollerij, geweldsmisdrijven, straatroof, bedreiging, diefstal uit/vanaf auto, winkeldiefstal, vernieling, drugshandel; all follow the Per 1000 / Absoluut toggle and stay out of the totaalscore
- **Area detail modal** — a map click on a wijk/buurt, a Ranglijst row, a dashboard bar or slice, or the panel's "Details" button opens a wijk/buurt in full: inhabitants, density and land area, parent wijk or its buurten, totaalscore and rank, "Opvallend" chips for top/bottom-10 % positions ("#1 veiligste buurt (van 91)"), a table with value, rank, percentile bar and difference from the Rotterdam median for every metric, the crime trend, herkomst bar, education donut, outlier notes and data years; actions Toon op kaart, Vergelijk and Kopieer link (`&area=`); closes with ✕, Esc or a click outside
- **Data years shown** — wijk/buurt figures are 2025 (CBS 86165NED); fields CBS has not filled yet fall back to 2024 and say so in the dashboard subtitle and the panel ("Peiljaar"); the dashboard also shows the newest city WOZ (2026, peildatum 1 januari)
- **Uitleg** — the book button in the topnav opens a filterable explanation of every metric (meaning, unit, calculation, linked CBS/Politie source table, peiljaar, Ranglijst direction, caveats) plus how the score, the crime modes and "geen data" work; the small (i) buttons in the legend, Ranglijst headers and dashboard charts open it at that metric
- **Crime: Per 1000 inwoners | Absoluut** — one toggle (legend, Ranglijst, Dashboard) switches every crime layer between the rate per 1.000 inhabitants and the raw 2025 count; in Absoluut the dashboard shows the Rotterdam total and every area gets a value
- **Rang: Vast | Volgt sortering** — in the Ranglijst, "Vast" keeps the rank numbers of "Rangschik op" while you sort a column; "Volgt sortering" renumbers the rows (and shows the score) of the sorted column; the choice is remembered
- **Robust colour scale** — every choropleth, the legend, the Ranglijst bars and the dashboard bars use 7 stepped quantile classes of the shown set (the median sits in the middle class), so one extreme area no longer flattens the rest; outliers (Tukey fences on raw and log scale) get a red border, a red dot in the Ranglijst and "uitschieter" in the tooltip; the legend lists the class breaks, the median and the outlier count, and "Schaal: Kwantiel | Lineair" switches back to the old min→max ramp (remembered)
- **Herkomst** — layers group with % herkomst Nederland, Europa (excl. NL), buiten Europa and % born abroad per wijk/buurt (neutral, outside the totaalscore), a mini NL/Europa/buiten-Europa bar in the panel, and a dashboard section for the whole city: donut by 19 origin groups (Turkije, Marokko, Suriname, Nederlandse Cariben, Afrika bezuiden de Sahara, Midden-Oosten …), top 15 countries of origin, growth 2022–2026 per group, and a 100 % bar per wijk
- **Herkomst per land, per wijk/buurt (geschat)** — Suriname, Turkije, Marokko, Nederlandse Cariben, Indonesië, Polen, Duitsland, België, Europa buiten de EU and Oceanië as share of inhabitants per wijk and buurt (Rotterdam and the NL drill-down), estimated from CBS 83503NED per postcode (2023) split by address share; also in the area modal and the wizard's Gemeenschap step. Loaded on demand; method and limits in the Uitleg
- **Herkomst per wereldregio** — 20 UN M49 world regions (Noord-Afrika, West-Azië, Zuid-Amerika, Caribisch gebied …; each werelddeel's rest as "Overig") as layers, area-modal blocks and Gemeenschap groups. Per gemeente from CBS 85458NED 2026 (static file `data/nl/herkomst-regio-gemeente-2026.json`, `scripts/build-gemeente-regio.mjs`); per wijk/buurt from the postcode estimate, with the same country → region table, only for regions with a named postcode country. A gemeente mix is never spread into its buurten
- **Postcode search** — type a postcode (`3011`, `3011 AB`) to jump to the buurt with most of its addresses
- **Rangschik op follows the layer** — picking a layer in the topnav also ranks the Ranglijst on it; Totaalscore stays selectable and leaves the map alone
- **Deep links** — `#scope=rotterdam|nederland&view=map|dashboard|list&area=<CBS code>&crime=abs`; the scope and crime choice are remembered
- **Province choropleth** — four selectable datasets color all 12 provinces
- **Municipality drill-down** — zoom to level 10+ to see gemeente-level data; at 12 the wijken and at 13 the buurten of the gemeente in the centre (any gemeente in NL, "Wijken en buurten" on a gemeente panel), scored against all NL wijken / buurten
- **Neighbourhood outlines** — zoom to level 13+ to see buurt boundaries within the active gemeente
- **Side panel** — click a province or gemeente for population, income, crime and education stats; in Rotterdam a map click opens the area modal and the panel serves compare ("Vergelijk" in the modal)
- **Zero build step** — importmap + native ES modules, runs directly in the browser

## Datasets

| Dataset | Source | Table |
|---|---|---|
| Population & income | CBS OData | 70072ned |
| Education levels | CBS OData | 70072ned |
| Crime rate | CBS OData | 83648NED |
| Province / gemeente geometry | cartomap/nl | gemeente_2023, provincie_2023 |
| Neighbourhood geometry | cartomap/nl | buurt_2023 |
| Rotterdam wijk + buurt figures (2025) | CBS OData — Kerncijfers wijken en buurten 2025 | 86165NED |
| Fallback per field when 2025 is empty (income, education; some WOZ/65+/herkomst/bijstand cells) | CBS OData — Kerncijfers wijken en buurten 2024 | 85984NED |
| Rotterdam wijk + buurt crime 2025 and 2024 (total, woninginbraak, fietsendiefstal, zakkenrollerij, geweld, straatroof, bedreiging, diefstal uit/vanaf motorvoertuigen, winkeldiefstal, vernieling, drugshandel) | CBS dataderden (Politie) — Geregistreerde misdrijven; soort misdrijf, wijk, buurt | 47018NED |
| Rotterdam average WOZ 2026 (gemeente, peildatum 1 januari 2026) | CBS OData — Gemiddelde WOZ-waarde van woningen; eigendom, regio | 85036NED |
| Rotterdam wijk + buurt herkomst (Nederland_17, EuropaExclusiefNederland_18, BuitenEuropa_19; born abroad _23 + _24) | CBS OData — Kerncijfers wijken en buurten 2025 | 86165NED |
| Rotterdam population by country of origin 2022–2026 (gemeente only; 19 groups, top 15 countries, trend) | CBS OData — Bevolking; herkomstland, geboorteland, leeftijd, regio, 1 januari | 85458NED |
| Herkomst per postcode 2023 (Suriname, Turkije, Marokko, …), split to buurt/wijk by addresses (`scripts/build-pc4-herkomst.mjs`) | CBS OData — Bevolking; geslacht, migratieachtergrond, viercijferige postcode | 83503NED |
| Herkomst per wereldregio per gemeente 2026 (`scripts/build-gemeente-regio.mjs`); validation of the postcode estimate (2023) | CBS OData — Bevolking; herkomstland, geboorteland, leeftijd, regio, 1 januari | 85458NED |
| Onderwijsprestatie basisscholen: referentieniveaus groep 8 per vestiging, 2022–2024, per school and per buurt/wijk/gemeente (`scripts/build-schools.mjs` → `data/nl/onderwijs-po-2024.json`) | DUO open onderwijsdata (onderwijsdata.duo.nl); adres → buurt via CBS pc6huisnr 2023 and PDOK Locatieserver | wporeferentieniveau-v1, wpo-eindscores, adressen_bo |
| Milieu per buurt: ernstige geluidhinder (wegverkeer, buren, alle bronnen samen als stilte-index; modelschattingen GGD Gezondheidsmonitor 2024), gevoelstemperatuur (PET 2022) en schaduw op fiets- en wandelpaden, per buurt/wijk/gemeente/provincie (`scripts/build-nl-milieu.mjs` → `data/nl/milieu-buurt-2025.json`) | RIVM Atlas Leefomgeving (Public Domain Mark 1.0); Klimaateffectatlas (CC BY 4.0, "Klimaateffectatlas, 2026"); buurt 2024 → 2025 by code, else largest overlap |
| Postcode → buurt/wijk/gemeente crosswalk 2023 (address counts) | CBS — postcode en huisnummer met buurt, wijk en gemeente | pc6huisnr 2023 |
| Rotterdam gemeente + wijk geometry | PDOK CBS gebiedsindelingen 2024 (`gemeente_gegeneraliseerd`, `wijk_gegeneraliseerd`), pre-cached in `data/rotterdam_*.geojson` | — |

Wijk/buurt datasets: population, income (standardised household income), higher education, WOZ value, 65+, herkomst (Nederland / Europa / buiten Europa, born abroad). Wijk crime (misdrijven per 1.000 inwoners) comes from police table 47018NED; buurten and wijken under 1.000 inhabitants show "geen data" for crime. Regenerate the Rotterdam geometry with `node scripts/build-rotterdam-geo.mjs`. Regenerate the national wijk/buurt data (data/nl/, all NL wijken and buurten) with `node scripts/build-nl-kwb.mjs`, then `node scripts/build-ov-lines.mjs` (OV-lijnen in data/ov/ plus the metro/tram distance columns it adds to data/nl/; build-nl-kwb drops them).

## Data mirror (snapshot and raw archive)

The browser no longer queries CBS, the police (CBS dataderden) or the PDOK WFS at page load. Every one of those queries is a snapshot on our own origin, read through `modules/source.js` (`getSource(key)`); see `docs/plan-data-mirror.md`.

- **Snapshot** (`data/snapshot/`, in git): `<key>.json` per query, column-wise (`columns` + `rows`) with a header (`key`, `title`, `period`, `built`, `sources`, `sha256` of the raw pages). Geometry per gemeente in `geo/2025/<GMxxxx>-{wijk,buurt}.json` (statcode/statnaam only, 5 decimals), the gemeente overlay in `geo/2024/gemeenten.json`. `manifest.json` lists every file with rows, bytes and sha256.
- **Raw archive** (host only, outside git): `/nebula/data/roffatistics/raw/<source>/<YYYY-MM-DD>/` with every download unchanged and a `manifest.json` (url, bytes, sha256, fetched). The build scripts (`build-nl-kwb`, `build-schools`, `build-pc4-*`, `build-gemeente-regio`, `build-rotterdam-geo`) download through it too (`scripts/lib/raw-archive.mjs`): they reuse the newest archived copy and only fetch anew with `--refresh`. Override the location with `ROFFA_RAW_DIR`.
- **Refresh**: `npm run snapshot` fetches every registered source anew (one request at a time, a short pause, retries), rewrites only files whose content changed and prints rows/changed values per table. `node scripts/snapshot-sources.mjs` rebuilds from the archive; `--only=<key prefix>` limits it. A new runtime query must be registered in `scripts/snapshot-sources.mjs`: `tests/source-registry.test.js` fails on an OData/WFS URL built outside `modules/source.js`.
- **Live fallback**: off by default, so a missing snapshot shows up as a failure. Turn it on with `?live=1` or `localStorage['roffa.liveFallback'] = '1'`. Base map tiles, the aerial photo and P2000 stay live.

## Run locally

```bash
node server.js     # serves on http://localhost:3000
npm test           # unit tests (Node.js built-in runner, no install needed)
```

Requires Node.js 22+. No `npm install` needed.

## Tech stack

- [Leaflet](https://leafletjs.com/) 1.9.4 — map rendering
- [Spektrum](https://www.npmjs.com/package/spektrum) 1.0.1 — reactive DOM bindings
- [CBS OData API](https://opendata.cbs.nl/) — Dutch public statistics
- [cartomap/nl](https://github.com/cartomap/nl) — Dutch GeoJSON boundaries
- [MapLibre GL JS](https://maplibre.org/) 4.7.1 + [maplibre-gl-leaflet](https://github.com/maplibre/maplibre-gl-leaflet) 0.0.22 — vector basemap under Leaflet
- [OpenStreetMap](https://www.openstreetmap.org/copyright) via the Overpass API — metro, tram and bus lines and stops (data/ov/), © OpenStreetMap contributors, ODbL
- [OpenFreeMap](https://openfreemap.org/) — keyless vector basemap (dark / positron styles), © OpenMapTiles, data © OpenStreetMap
- [PDOK Luchtfoto](https://www.pdok.nl/) — keyless aerial photo basemap (Beeldmateriaal Nederland)

## License

MIT
