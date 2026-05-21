# Roffatistics

Interactive map-based data visualization for the Netherlands. Explore CBS public statistics — demographics, crime, and education — on an interactive choropleth map, from province level down to municipality and neighbourhood.

**Live:** [d-dezeeuw.github.io/Roffatistics](https://d-dezeeuw.github.io/Roffatistics)

---

## Features

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
- CartoDB Dark Matter — base map tiles

## License

MIT
