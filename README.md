# Roffatistics

Interactive map-based data visualization for the Netherlands. Explore CBS public statistics — demographics, crime, and education — on an interactive choropleth map, from province level down to municipality and neighbourhood.

**Live:** [d-dezeeuw.github.io/Roffatistics](https://d-dezeeuw.github.io/Roffatistics)

---

## Features

- **Rotterdam mode (default)** — the map locks onto gemeente Rotterdam, masks everything outside it, and colours all 21 CBS wijken; from zoom 13 the 91 buurten take over. Areas without data share one neutral colour ("geen data" in the legend)
- **Nederland mode** — pick "Nederland" in the topnav dropdown for the national view below
- **Ranglijst** — the list view ranks every wijk or buurt (or province/gemeente in Nederland mode) on a 0–100 percentile score per dataset, sortable per column, with heat bars; click a row to select it, the pin icon opens it on the map
- **Dashboard** — the Dashboard view compares all 21 Rotterdam wijken: city KPIs, a sorted bar chart per data layer with the Rotterdam average, and an X/Y scatter; click a wijk to zoom the map to it
- **Deep links** — `#scope=rotterdam|nederland&view=map|dashboard|list&area=<CBS code>`; the scope choice is remembered
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
| Rotterdam wijk + buurt figures | CBS OData — Kerncijfers wijken en buurten 2024 | 85984NED |
| Rotterdam wijk crime (misdrijven 2025) | CBS dataderden (Politie) | 47018NED |
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
