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

### CBS OData details
- **Table:** `70072ned` ("Regionale kerncijfers Nederland")
- **Base URL:** `https://opendata.cbs.nl/ODataApi/odata/70072ned/TypedDataSet`
- **Filter:** `startswith(RegioS,'PV') and Perioden eq '2023JJ00'`
- **Columns used:**
  - `RegioS` — province code (e.g. `'PV20  '`, must be `.trim()`'d)
  - `TotaleBevolking_1` — total population (persons)
  - `BronInkomenAlsWerknemer_141` — avg income from employment (×€1,000; range 37.5–44.4 across provinces)
  - `TotaleOppervlakte_248` — total area (km²); density = `TotaleBevolking_1 / TotaleOppervlakte_248`

### Tasks
- [ ] `modules/datasets.js` — `buildCBSUrl(tableId, filter, select)`, `fetchCBS(tableId, filter, select, fetcher, storage)` with injected `fetcher` (defaults `globalThis.fetch`) and `storage` (defaults `globalThis.sessionStorage`) for testability; cache response by URL key
- [ ] Fetch `70072ned` with the filter and select above
- [ ] `normalizeProvinces(rows)` → `[{ regionCode, population, avgIncome, areaSqKm, density }]`
- [ ] `modules/overlays.js` — export `interpolateColor(value, min, max)` (pure, testable): linear RGB between `#2e1065` (low) and `#ea580c` (high); export `applyDataset(data, valueKey)`: eachLayer on province layer, set fill via interpolateColor; export `setProvinceData(data)` so click handler can look up stats by region code
- [ ] `modules/legend.js` — export `formatLegendValue(value, dataset)` (pure, testable); `updateLegend({ title, min, max, dataset })` uses dynamic `import('spektrum')` so the module is importable in Node.js tests
- [ ] `modules/panel.js` — export `formatPanelData(data)` (pure, testable); `showPanel` updated to accept `{ name, code, data }` and display population, density, avgIncome; uses dynamic `import('spektrum')` at function call time so module is importable in Node.js
- [ ] Dataset switcher: two buttons ("Bevolking", "Inkomen") in the panel sidebar; active state toggled via CSS class; click calls `applyDataset` + `updateLegend`
- [ ] `app.js` — `await initOverlays()`, then `await fetchCBS(...)`, then `setProvinceData`, then `applyDataset` + `updateLegend` for initial state

**Done when:** map shows a colored province choropleth, clicking a province populates the panel with name/population/density/income, the legend updates to match the active dataset.

---

## Phase 4 — Crime overlay (CBS 83648NED)

**Goal:** second dataset layer — crime rate per 1,000 residents per province.

### CBS OData details
- **Table:** `83648NED` on `opendata.cbs.nl` (same base as 70072ned — no separate politie endpoint needed)
- **Filter (one request):** `startswith(RegioS,'PV') and Perioden eq '2023JJ00' and (SoortMisdrijf eq 'T001161' or SoortMisdrijf eq 'CRI1000' or SoortMisdrijf eq 'CRI2000' or SoortMisdrijf eq 'CRI3000')`
- **Select:** `RegioS,SoortMisdrijf,TotaalGeregistreerdeMisdrijven_1,GeregistreerdeMisdrijvenPer1000Inw_3`
- **Key columns:** `GeregistreerdeMisdrijvenPer1000Inw_3` (choropleth, range 31.9–57.1), `TotaalGeregistreerdeMisdrijven_1` (panel)
- **Top 3 categories:** CRI1000 Vermogen, CRI2000 Vernieling, CRI3000 Geweld — fetched in the same request and split client-side
- **Note:** PV99 has null crimeRate — filter it out in normalizeCrime

### Tasks
- [ ] `normalizeCrime(rows)` in `datasets.js`: split rows by SoortMisdrijf; return `[{ regionCode, crimeRate, totalCrimes, categories: [{ label, count }] }]`; exclude rows where crimeRate is null
- [ ] Fetch `83648NED` in `app.js` using `fetchCBS` (same function, different tableId); merge crime result into `provinceRows` by regionCode
- [ ] Add `crimeRate` to DATASETS config and a third switcher button ("Criminaliteit")
- [ ] Extend `formatPanelData` in `panel.js`: crimeRate (1 decimal), totalCrimes, catVermogen, catVernieling, catGeweld
- [ ] Add crime stats section to panel HTML and new `setValue` calls in `showPanel`
- [ ] Legend updates automatically (same updateLegend call, new min/max)

**Done when:** selecting "Criminaliteit" re-colors provinces by crime rate; clicking a province shows rate, total, and the 3 category counts in the panel.

---

## Phase 5 — Education overlay (CBS 70072ned)

**Goal:** third dataset — education attainment level per province, using CBS data exclusively.

### Data source decision
DUO open data (`duo.nl/open_onderwijsdata/`) returns an HTML 404 page — not accessible. Education data is sourced entirely from CBS `70072ned` columns already fetched in Phase 3 (extended select).

### CBS columns (added to Phase 3 select, same request)
- `BasisonderwijsVmboMbo1_113` — % low education (vmbo/mbo1 or below), 15+ year olds
- `HavoVwoMbo24_114` — % medium education (havo/vwo/mbo2–4)
- `HboWo_115` — % high education (hbo/wo); used as choropleth metric

### Tasks
- [ ] Extend `CBS_PROV_SELECT` in `app.js` to include the three education columns
- [ ] Extend `normalizeProvinces` in `datasets.js` to map `lowEdu`, `medEdu`, `highEdu` from the new columns (null-safe — rows without these columns return null)
- [ ] Add `highEdu` to DATASETS config and a fourth switcher button ("Opleiding")
- [ ] Extend `formatPanelData` in `panel.js`: lowEdu%, medEdu%, highEdu%
- [ ] Add education stats section to panel HTML and new `setValue` calls in `showPanel`
- [ ] Switcher is now a 2×2 grid (4 buttons: Bevolking, Inkomen, Criminaliteit, Opleiding)

**Done when:** four datasets are selectable, all color the province map, clicking a province shows all four dataset stats in the panel simultaneously.

---

## Phase 6 — Municipality and neighbourhood tier data

**Goal:** zooming into zoom ≥ 10 shows municipality-level data; zooming into zoom ≥ 13 shows neighbourhood (buurt) outlines within the active municipality.

### Data sources
- **Gemeente data:** CBS `70072ned` filtered to `GM*` codes (same OData table as province tier)
- **Buurt geometry:** `https://cartomap.github.io/nl/wgs84/buurt_2023.geojson` — 14,421 features, ~1 MB, lazy-fetched once and cached. `statcode` format: `BU{GM_CODE}{WIJK_IDX}{BUURT_IDX}` (e.g. `BU03630101`). Filter client-side by active gemeente: `statcode.startsWith('BU' + gmCode.replace('GM', ''))`.
- **Note:** no wijk (district) layer exists in cartomap/nl — the hierarchy goes gemeente → buurt directly. Wijk groupings are derivable from the statcode but are not needed for this phase.

### Tasks
- [ ] Extend `fetchCBS` filter to handle `GM*` codes for the same datasets (`70072ned` has municipality rows)
- [ ] On first entry into zoom ≥ 10, fetch municipality data for the active dataset
- [ ] Choropleth and panel work the same way at gemeente tier; only the region granularity changes
- [ ] Municipality click panel: name, population, crime rate, number of schools — same layout as province panel, different data
- [ ] Update legend label to reflect current tier ("per provincie" / "per gemeente" / "per buurt")
- [ ] Track active gemeente: when a gemeente is clicked, store its `statcode` (`GM*`) as `activeGemeente`
- [ ] Add `ZOOM_BUURT = 13` threshold to `overlays.js`
- [ ] On first entry into zoom ≥ 13, lazy-fetch `buurt_2023.geojson`, filter features to those whose `statcode` starts with `BU` + the active gemeente code (stripped of `GM` prefix), build and swap in a buurt layer
- [ ] **GM→PV lookup:** on first zoom ≥ 10, build a runtime lookup `{ gmCode → pvCode }` by iterating gemeente features and checking which province layer's `getBounds()` contains the gemeente feature's bounding box centre (Leaflet `LatLngBounds.contains()`). No extra files or API calls needed — both GeoJSONs are already in memory. Cache result in module state.
- [ ] Use GM→PV lookup to filter gemeente layer to active province when entering zoom ≥ 10
- [ ] If no gemeente is active when zoom ≥ 13 is reached, derive the active gemeente from the map centre using a bounding-box lookup against the cached gemeente layer
- [ ] Buurt hover + tooltip (name only); click logs name + code — no CBS data at buurt level in this phase
- [ ] On zoom-out back below 13, remove buurt layer and restore gemeente layer

**Done when:** zooming past zoom 9 shows municipalities colored by the active dataset; zooming past zoom 12 within a municipality shows its neighbourhood outlines; clicking a gemeente shows its stats.

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
| 6 | Municipality drill-down + neighbourhood outlines within active gemeente |
| 7 | Deployed to GitHub Pages, mobile-ready |
