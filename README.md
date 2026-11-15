# Roffatistics

Interactive map-based data visualization for the Netherlands. Explore CBS public statistics — demographics, crime, and education — on an interactive choropleth map, from province level down to municipality and neighbourhood.

**Live:** [d-dezeeuw.github.io/Roffatistics](https://d-dezeeuw.github.io/Roffatistics)

---

## Features

- **Rotterdam mode (default)** — the map locks onto gemeente Rotterdam, masks everything outside it, and colours all 21 CBS wijken; from zoom 13 the 91 buurten take over. Areas without data share one neutral colour ("geen data" in the legend)
- **Nederland mode** — pick "Nederland" in the topnav dropdown for the national view below
- **Ranglijst** — the list view ranks every wijk or buurt (or province/gemeente in Nederland mode) on a 0–100 percentile score per dataset, sortable per column, with heat bars; click a row to open its detail modal, the pin icon opens it on the map
- **Dashboard** — the Dashboard view compares all 21 Rotterdam wijken: city KPIs, a sorted bar chart per data layer with the Rotterdam average, and an X/Y scatter; click a wijk to open its detail modal
- **Layers in five sections** — Bevolking, Herkomst, Welvaart & wonen, Veiligheid, Voorzieningen, generated from `DATASETS` (two columns on wide screens); Rotterdam-only layers (housing, bijstand, crime sub-layers, distances) hide in Nederland mode, and Veiligheid then says how many it hides
- **Veiligheid per wijk/buurt** — Misdrijven totaal plus ten police categories (47018NED): woninginbraak, fietsendiefstal, zakkenrollerij, geweldsmisdrijven, straatroof, bedreiging, diefstal uit/vanaf auto, winkeldiefstal, vernieling, drugshandel; all follow the Per 1000 / Absoluut toggle and stay out of the totaalscore
- **Area detail modal** — a map click on a wijk/buurt, a Ranglijst row, a dashboard bar or slice, or the panel's "Details" button opens a wijk/buurt in full: inhabitants, density and land area, parent wijk or its buurten, totaalscore and rank, "Opvallend" chips for top/bottom-10 % positions ("#1 veiligste buurt (van 91)"), a table with value, rank, percentile bar and difference from the Rotterdam median for every metric, the crime trend, herkomst bar, education donut, outlier notes and data years; actions Toon op kaart, Vergelijk and Kopieer link (`&area=`); closes with ✕, Esc or a click outside
- **Data years shown** — wijk/buurt figures are 2025 (CBS 86165NED); fields CBS has not filled yet fall back to 2024 and say so in the dashboard subtitle and the panel ("Peiljaar"); the dashboard also shows the newest city WOZ (2026, peildatum 1 januari)
- **Uitleg** — the book button in the topnav opens a filterable explanation of every metric (meaning, unit, calculation, linked CBS/Politie source table, peiljaar, Ranglijst direction, caveats) plus how the score, the crime modes and "geen data" work; the small (i) buttons in the legend, Ranglijst headers and dashboard charts open it at that metric
- **Crime: Per 1000 inwoners | Absoluut** — one toggle (legend, Ranglijst, Dashboard) switches every crime layer between the rate per 1.000 inhabitants and the raw 2025 count; in Absoluut the dashboard shows the Rotterdam total and every area gets a value
- **Rang: Vast | Volgt sortering** — in the Ranglijst, "Vast" keeps the rank numbers of "Rangschik op" while you sort a column; "Volgt sortering" renumbers the rows (and shows the score) of the sorted column; the choice is remembered
- **Robust colour scale** — every choropleth, the legend, the Ranglijst bars and the dashboard bars use 7 stepped quantile classes of the shown set (the median sits in the middle class), so one extreme area no longer flattens the rest; outliers (Tukey fences on raw and log scale) get a red border, a red dot in the Ranglijst and "uitschieter" in the tooltip; the legend lists the class breaks, the median and the outlier count, and "Schaal: Kwantiel | Lineair" switches back to the old min→max ramp (remembered)
- **Herkomst** — layers group with % herkomst Nederland, Europa (excl. NL), buiten Europa and % born abroad per wijk/buurt (neutral, outside the totaalscore), a mini NL/Europa/buiten-Europa bar in the panel, and a dashboard section for the whole city: donut by 19 origin groups (Turkije, Marokko, Suriname, Nederlandse Cariben, Afrika bezuiden de Sahara, Midden-Oosten …), top 15 countries of origin, growth 2022–2026 per group, and a 100 % bar per wijk
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
| Rotterdam gemeente + wijk geometry | PDOK CBS gebiedsindelingen 2024 (`gemeente_gegeneraliseerd`, `wijk_gegeneraliseerd`), pre-cached in `data/rotterdam_*.geojson` | — |

Wijk/buurt datasets: population, income (standardised household income), higher education, WOZ value, 65+, herkomst (Nederland / Europa / buiten Europa, born abroad). Wijk crime (misdrijven per 1.000 inwoners) comes from police table 47018NED; buurten and wijken under 1.000 inhabitants show "geen data" for crime. Regenerate the Rotterdam geometry with `node scripts/build-rotterdam-geo.mjs`. Regenerate the national wijk/buurt data (data/nl/, all NL wijken and buurten) with `node scripts/build-nl-kwb.mjs`.

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
- [OpenFreeMap](https://openfreemap.org/) — keyless vector basemap (dark / positron styles), © OpenMapTiles, data © OpenStreetMap
- [PDOK Luchtfoto](https://www.pdok.nl/) — keyless aerial photo basemap (Beeldmateriaal Nederland)

## License

MIT
