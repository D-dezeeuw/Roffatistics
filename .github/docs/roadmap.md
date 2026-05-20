# Roffatistics — Roadmap

Phases are sequential. Each has a clear "done when" definition so there's no ambiguity about when to move on.

---

## Phase 0 — Project skeleton

**Goal:** repo is runnable locally, nothing more.

### Tasks
- [ ] `index.html` — bare shell: `<head>` with importmap (Spektrum + Leaflet), one `<div id="map">`, one `<aside id="panel">`
- [ ] `style.css` — CSS custom properties only (design tokens, no component styles yet), `box-sizing: border-box` reset, dark background applied to `body`
- [ ] `app.js` — empty module entry point, imported in `index.html` as `type="module"`
- [ ] `server.js` — Node.js static file server using only `node:http` and `node:fs`, serves from project root on `localhost:3000`
- [ ] `data/provinces.json` — download and commit `provincie_2023.geojson` from cartomap/nl (pre-cache, never fetched at runtime)

**Done when:** `node server.js` serves `index.html` at localhost:3000 with no console errors.

---

## Phase 1 — Map foundation

**Goal:** dark interactive map fills the screen. No data yet.

### Tasks
- [ ] `modules/map.js` — initialise Leaflet map, set view to Netherlands centre (`[52.3, 5.3]`, zoom `7`)
- [ ] Add CartoDB Dark Matter tile layer with correct attribution (`© OpenStreetMap contributors © CARTO`)
- [ ] Constrain map bounds to roughly the Netherlands (`maxBounds`) so users can't pan too far
- [ ] `style.css` — full layout: map takes remaining viewport after header, panel sits on the right as a fixed-width sidebar (collapsed by default on mobile)
- [ ] Apply design token styles to `body`, `#map`, `#panel`: gradient backgrounds, bordered gradient accent on the panel using a `::before` pseudo-element

**Done when:** map renders dark, centered on NL, is pannable/zoomable, panel is visible as a styled empty sidebar.

---

## Phase 2 — Zoom-tier layer system

**Goal:** three GeoJSON layers swap in/out based on zoom level. No data coloring yet — just outlines.

### Tasks
- [ ] `modules/overlays.js` — define three layer slots: `national`, `province`, `municipality`
- [ ] Load `data/provinces.json` (pre-cached) as the province layer on app init
- [ ] Define zoom thresholds as constants: `ZOOM_NATIONAL = 6`, `ZOOM_PROVINCE = 9`
- [ ] Listen to Leaflet `zoomend`; swap the active layer:
  - ≤ 6 → show NL outline only (single `L.geoJSON` feature, derive from province union or use a separate outline GeoJSON)
  - 7–9 → show province layer
  - ≥ 10 → lazy-fetch `gemeente_2023.geojson` from cartomap/nl on first entry, cache in memory, swap in
- [ ] Style each layer: semi-transparent fill (`rgba` of `--accent-purple` at 15%), 1px stroke in purple, no fill on hover yet
- [ ] Hover interaction: highlight hovered feature (fill opacity → 35%, stroke → orange), show a basic tooltip with the region name only
- [ ] Click interaction: log region name + code to console (panel wiring comes in Phase 3)

**Done when:** zooming in/out swaps layers smoothly, hovering a province/gemeente highlights it and shows its name in a tooltip.

---

## Phase 3 — CBS demographics overlay (province tier)

**Goal:** province choropleth showing population and average income from CBS `70072ned`. First working data overlay.

### Tasks
- [ ] `modules/datasets.js` — generic `fetchCBS(tableId, filter)` function: constructs OData URL, fetches JSON, returns parsed rows. Use `sessionStorage` to cache by URL key.
- [ ] Fetch `70072ned` filtered to province codes (`RegioS eq 'PV20'` … `PV31`, or `startswith(RegioS,'PV')`)
- [ ] Normalize response to `{ regionCode, label, population, avgIncome }` — extract the relevant columns from `TypedDataSet`
- [ ] `modules/overlays.js` — `applyDataset(data, valueKey)`: compute min/max, map each feature's `RegioS` code to a fill color interpolated between `#2e1065` (low) and `#ea580c` (high) using a linear scale
- [ ] `modules/legend.js` — render a gradient legend strip (purple → orange) with min/max labels using Spektrum `setValue` + `bindDOM`
- [ ] `modules/panel.js` — on province click, populate the Spektrum-bound panel with: province name, population, avg income, and population density (pop / km², km² derived from GeoJSON area)
- [ ] Dataset switcher: two buttons ("Population", "Income") that call `applyDataset` with a different value key and re-color the map

**Done when:** map shows a colored province choropleth, clicking a province populates the panel, the legend updates to match the active dataset.

---

## Phase 4 — Crime overlay (Politie via CBS)

**Goal:** second dataset layer — crime rate per 1,000 residents per province.

### Tasks
- [ ] Research exact OData table ID on `politieopendata.cbs.nl` for geregistreerde criminaliteit per regio (verify endpoint works from browser)
- [ ] Add `fetchPolitie(tableId, filter)` to `datasets.js` — same pattern as `fetchCBS` but different base URL (`opendata.cbs.nl/ODataApi/odata/` pointing at the Politie table)
- [ ] Normalize to `{ regionCode, crimeRate, totalCrimes, topCategories[] }`
- [ ] Wire into `applyDataset` — add "Crime rate" to the dataset switcher
- [ ] Extend the click panel: show crime rate/1,000, total crimes, and a short list of the top 3 crime categories for the province using a Spektrum `data-each` list
- [ ] Legend updates automatically (same component, new min/max)

**Done when:** selecting "Crime rate" re-colors the provinces by crime intensity, clicking a province shows crime breakdown in the panel.

---

## Phase 5 — Education overlay (DUO)

**Goal:** third dataset — school density or dropout rate per province.

### Tasks
- [ ] Verify DUO data endpoint CORS behaviour from a browser (fetch `api.duo.nl` or direct CSV URL from `duo.nl/open_onderwijsdata/`)
- [ ] If CORS is blocked: download the relevant DUO CSV (e.g. VSV dropout by province, school counts by municipality) and commit to `data/duo_vsv.json` as a pre-processed JSON snapshot
- [ ] Normalize to `{ regionCode, dropoutRate, schoolCount, studentCount }`
- [ ] Aggregate municipality-level DUO data up to province using the CBS gemeente→provincie lookup (available in `70072ned` or a separate reference table)
- [ ] Add "Dropout rate" and "Schools / 10k residents" to the dataset switcher
- [ ] Extend click panel: education breakdown — % low / medium / high education attainment (from CBS `70072ned`) + DUO dropout rate side by side

**Done when:** three datasets are selectable, all color the province map, all populate the panel on click.

---

## Phase 6 — Municipality tier data

**Goal:** zooming into zoom ≥ 10 shows municipality-level data, not just outlines.

### Tasks
- [ ] Extend `fetchCBS` filter to handle `GM*` codes for the same datasets (`70072ned` has municipality rows)
- [ ] On first entry into zoom ≥ 10, fetch municipality data for the active dataset (or for the visible province's municipalities only — filter by bounding box if response size is a concern)
- [ ] Choropleth and panel work the same way; only the region granularity changes
- [ ] Municipality click panel: name, population, crime rate, number of schools — same layout as province panel, different data
- [ ] Update legend label to reflect current tier ("per provincie" / "per gemeente")

**Done when:** zooming past zoom 9 into a province shows its municipalities colored by the active dataset; clicking a gemeente shows its stats.

---

## Phase 7 — Polish and deploy

**Goal:** production-ready, publicly accessible on GitHub Pages.

### Tasks
- [ ] `.github/workflows/deploy.yml` — GitHub Actions workflow: on push to `main`, copy project files to `gh-pages` branch (no build step needed — all files are static)
- [ ] `README.md` — project description, live link, screenshot, data source credits
- [ ] Responsive layout: below 768px the panel collapses to a bottom drawer that slides up on province click; map fills the full screen
- [ ] Keyboard navigation: `Tab` focuses province features, `Enter` opens the panel, `Escape` closes it
- [ ] ARIA labels on map controls, panel, and legend
- [ ] Verify CartoDB attribution is visible at all zoom levels
- [ ] Verify all three data sources load correctly on the deployed GitHub Pages domain (check CORS headers from that origin)
- [ ] Performance pass: confirm `sessionStorage` caching prevents duplicate API calls when switching datasets

**Done when:** site is live at `https://<username>.github.io/roffatistics`, all three overlays work, panel opens on click, layout is usable on mobile.

---

## Milestone summary

| Phase | Milestone |
| --- | --- |
| 0 | Repo runs locally |
| 1 | Dark map renders |
| 2 | Three zoom tiers swap GeoJSON layers |
| 3 | CBS choropleth + panel live |
| 4 | Crime overlay added |
| 5 | Education overlay added — all three datasets selectable |
| 6 | Municipality drill-down works |
| 7 | Deployed to GitHub Pages, mobile-ready |
