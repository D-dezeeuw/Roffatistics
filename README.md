# Roffatistics

Interactive map-based data visualization for the Netherlands. Explore CBS public statistics — demographics, crime, and education — on an interactive choropleth map, from province level down to municipality and neighbourhood.

**Live:** [d-dezeeuw.github.io/Roffatistics](https://d-dezeeuw.github.io/Roffatistics)

---

## Features

- **Rotterdam mode (default)** — the map locks onto gemeente Rotterdam, masks everything outside it, and colours all 21 CBS wijken; from zoom 13 the 91 buurten take over. Areas without data share one neutral colour ("geen data" in the legend)
- **Nederland mode** — pick "Nederland" in the topnav dropdown for the national view below
- **Ranglijst** — the list view ranks every wijk or buurt (or province/gemeente in Nederland mode) on a 0–100 percentile score per dataset, sortable per column, with heat bars; click a row to select it, the pin icon opens it on the map
- **Dashboard** — the Dashboard view compares all 21 Rotterdam wijken: city KPIs, a sorted bar chart per data layer with the Rotterdam average, and an X/Y scatter; click a wijk to zoom the map to it
- **Layers in four sections** — Bevolking, Welvaart & wonen, Veiligheid, Voorzieningen; Rotterdam-only layers (housing, bijstand, crime sub-layers, distances) hide in Nederland mode
- **Data years shown** — wijk/buurt figures are 2025 (CBS 86165NED); fields CBS has not filled yet fall back to 2024 and say so in the dashboard subtitle and the panel ("Peiljaar"); the dashboard also shows the newest city WOZ (2026, peildatum 1 januari)
- **Uitleg** — the book button in the topnav opens a filterable explanation of every metric (meaning, unit, calculation, linked CBS/Politie source table, peiljaar, Ranglijst direction, caveats) plus how the score, the crime modes and "geen data" work; the small (i) buttons in the legend, Ranglijst headers and dashboard charts open it at that metric
- **Crime: Per 1000 inwoners | Absoluut** — one toggle (legend, Ranglijst, Dashboard) switches every crime layer between the rate per 1.000 inhabitants and the raw 2025 count; in Absoluut the dashboard shows the Rotterdam total and every area gets a value
- **Rang: Vast | Volgt sortering** — in the Ranglijst, "Vast" keeps the rank numbers of "Rangschik op" while you sort a column; "Volgt sortering" renumbers the rows (and shows the score) of the sorted column; the choice is remembered
- **Robust colour scale** — every choropleth, the legend, the Ranglijst bars and the dashboard bars use 7 stepped quantile classes of the shown set (the median sits in the middle class), so one extreme area no longer flattens the rest; outliers (Tukey fences on raw and log scale) get a red border, a red dot in the Ranglijst and "uitschieter" in the tooltip; the legend lists the class breaks, the median and the outlier count, and "Schaal: Kwantiel | Lineair" switches back to the old min→max ramp (remembered)
- **Deep links** — `#scope=rotterdam|nederland&view=map|dashboard|list&area=<CBS code>&crime=abs`; the scope and crime choice are remembered
- **Province choropleth** — four selectable datasets color all 12 provinces
- **Municipality drill-down** — zoom to level 10+ to see gemeente-level data
- **Neighbourhood outlines** — zoom to level 13+ to see buurt boundaries within the active gemeente
- **Side panel** — click any region for population, income, crime and education stats
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
| Rotterdam wijk + buurt crime 2025 and 2024 (total, woninginbraak, fietsendiefstal, zakkenrollerij, geweld) | CBS dataderden (Politie) — Geregistreerde misdrijven; soort misdrijf, wijk, buurt | 47018NED |
| Rotterdam average WOZ 2026 (gemeente, peildatum 1 januari 2026) | CBS OData — Gemiddelde WOZ-waarde van woningen; eigendom, regio | 85036NED |
| Rotterdam gemeente + wijk geometry | PDOK CBS gebiedsindelingen 2024 (`gemeente_gegeneraliseerd`, `wijk_gegeneraliseerd`), pre-cached in `data/rotterdam_*.geojson` | — |

Wijk/buurt datasets: population, income (standardised household income), higher education, WOZ value, 65+ and origin outside Europe. Wijk crime (misdrijven per 1.000 inwoners) comes from police table 47018NED; buurten and wijken under 1.000 inhabitants show "geen data" for crime. Regenerate the Rotterdam geometry with `node scripts/build-rotterdam-geo.mjs`.

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
