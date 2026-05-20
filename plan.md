# Roffatistics — Project Plan

## What is this project?

Roffatistics is an interactive data-visualization platform for the Netherlands, built as a fully static site hosted on GitHub Pages. It renders Dutch provinces on an OpenStreetMap base layer with interactive overlays, and lets users explore public datasets from DUO (education), CBS (statistics), and Politie (crime) — all linked to geographic regions on the map.

The name is a portmanteau of "Roffe" and "statistics", framing serious open data in a playful but polished presentation.

---

## Goals

- Make Dutch open-government data tangible and explorable through a map-first UI.
- Zero server-side logic — every data call goes directly from the browser to public APIs or pre-fetched JSON.
- Fast, dependency-free runtime: everything loaded from CDN, no bundler, no build step.
- Professional aesthetic: dark, minimal, visually distinctive.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Map engine | [Leaflet.js](https://leafletjs.com/) via CDN | Industry standard, lightweight, composable |
| Map tiles | [CartoDB Dark Matter](https://carto.com/basemaps/) (`basemaps.cartocdn.com/dark_all`) | Free with attribution, CC-BY 4.0, matches dark palette |
| Province overlays | [cartomap/nl](https://cartomap.github.io/nl/) GeoJSON | Maintained Dutch administrative boundaries |
| UI framework | [Spektrum](https://unpkg.com/spektrum@1.0.1/spektrum.min.js) via importmap | Zero-dep reactive templating — `{{expr}}`, `:attr`, `data-each` |
| Data: Education | [DUO Open Onderwijsdata](https://duo.nl/open_onderwijsdata/) — REST/JSON-LD | School counts, pupil numbers by municipality / province |
| Data: Statistics | [CBS StatLine OData API](https://opendata.cbs.nl/) | Demographics, labour, society — OData v4, returns JSON |
| Data: Crime | [data.politie.nl](https://data.politie.nl/) via [CBS StatLine](https://politieopendata.cbs.nl/) | Registered crime by region, CC0 license |
| Local dev | Node.js built-in HTTP server (`node --experimental-http`) | Zero-install dev server for static files |
| Hosting | GitHub Pages | Free static CDN, CI via GitHub Actions |

**Dependency policy:** zero `node_modules` in production. All runtime libs (Leaflet, Spektrum) load from `unpkg.com`. Node.js is only used locally for the dev server.

---

## Design System

### Color palette

```
Background base:    #0d0a14   (near-black, deep purple tint)
Surface / panels:   #141020   (slightly lighter card backgrounds)
Primary accent:     #7c3aed   (violet-purple)
Secondary accent:   #ea580c   (burnt orange)
Border highlight:   gradient  purple → orange (135deg)
Text primary:       #f1f0f5
Text muted:         #8b8a96
```

### Visual principles

- **Slightly gradients everywhere** — backgrounds use a subtle `135deg` linear gradient between two near-identical dark purples, not flat fills.
- **Bordered gradient accents** — cards, panels, and map overlays use a 1px border rendered as a `linear-gradient` (purple → orange) via CSS `border-image` or a pseudo-element wrapper.
- **Minimalism** — no shadows, no heavy chrome. Spacing, typography, and color carry the hierarchy.
- **Typography** — system font stack (`-apple-system, 'Segoe UI', sans-serif`), uppercase tracking for labels, monospace for data values.
- **Map dark theme** — CartoDB Dark Matter tiles (`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`). No CSS filter hacks needed — the tile style is natively dark.

### Component tokens (CSS custom properties)

```css
--bg-base: #0d0a14;
--bg-surface: #141020;
--accent-purple: #7c3aed;
--accent-orange: #ea580c;
--gradient-accent: linear-gradient(135deg, var(--accent-purple), var(--accent-orange));
--border-accent: 1px solid transparent;
--text-primary: #f1f0f5;
--text-muted: #8b8a96;
--radius: 8px;
--font-data: 'JetBrains Mono', 'Fira Mono', monospace;
```

---

## Data Sources

### DUO — Education
- **Portal:** https://duo.nl/open_onderwijsdata/
- **Authentication:** none — all standard open data is freely accessible without API key or registration
- **Format:** CSV downloads; some datasets via REST/JSON-LD at `api.duo.nl`
- **Useful datasets:** number of schools per municipality, pupil counts per level (PO, VO, MBO, HO), dropout rates
- **Linking:** join on `gemeente_code` or `provincie` field → map overlay color intensity
- **Note:** A small subset ("synthetische data") requires a formal request form — the datasets we need do not fall in this category

### CBS — Statistics Netherlands
- **Portal:** https://opendata.cbs.nl/
- **Protocol:** OData v3, returns JSON — no API key required
- **Base URL:** `https://opendata.cbs.nl/ODataApi/odata/`
- **Confirmed datasets:**
  - `70072ned` — Regionale kerncijfers Nederland — **primary source**: 50+ statistics (population, labour, income, health) at province, COROP, and municipality level, with `RegioS` dimension
  - `37230ned` — Bevolkingsontwikkeling per regio per maand — population births/deaths/migration with `RegioS` field; useful for dynamic population change
- **Province code format:** CBS `RegioS` values are prefixed — `PV20` = Groningen, `PV21` = Friesland … `PV31` = Utrecht etc. (12 provinces total)
- **Linking:** filter `RegioS` on `PV*` prefix to get province-level rows

### Politie — Crime data (via CBS StatLine)
- **Portal:** https://data.politie.nl/ → hosted on CBS StatLine at `politieopendata.cbs.nl`
- **License:** Creative Commons Zero (CC0)
- **Key dataset:** `Geregistreerde criminaliteit; soort misdrijf, regio`
  - Columns: crime type, regional unit, year, count, rate per 1,000 residents
- **Linking:** `regio` → province boundary on the map

### Province GeoJSON
- **Source:** https://cartomap.github.io/nl/
- **URL pattern:** `https://cartomap.github.io/nl/wgs84/provincie_{year}.geojson`
- **Example:** `https://cartomap.github.io/nl/wgs84/provincie_2023.geojson`
- **Projection:** WGS84 (EPSG:4326) — compatible with Leaflet out of the box

---

## Architecture

### File structure

```
roffatistics/
├── index.html          # App shell — map + sidebar layout
├── style.css           # Design tokens + global styles
├── app.js              # Map init, overlay logic, data fetch orchestration
├── data/
│   ├── provinces.json  # Pre-cached province GeoJSON (to avoid CORS on gh-pages)
│   └── ...             # Any pre-fetched static snapshots of CBS/DUO data
├── modules/
│   ├── map.js          # Leaflet map setup, tile layer, zoom controls
│   ├── overlays.js     # Province GeoJSON layer, choropleth coloring
│   ├── datasets.js     # Fetch + normalize CBS / DUO / Politie data
│   ├── legend.js       # Dynamic map legend component
│   └── panel.js        # Sidebar / detail panel (powered by Spektrum)
├── server.js           # Minimal Node.js local dev server (no npm deps)
├── plan.md             # This file
└── .github/
    └── workflows/
        └── deploy.yml  # GitHub Actions → GitHub Pages deploy
```

### Data flow

```
Browser
  └─ app.js
       ├─ map.js          → Leaflet + OSM tiles
       ├─ datasets.js     → fetch CBS OData / DUO API / Politie CSV
       │     └─ normalize → { province_code, label, value }
       └─ overlays.js     → GeoJSON layer + choropleth
             └─ on click  → panel.js (Spektrum panel) → detail stats
```

### Zoom-level layer strategy

The map has three distinct zoom tiers, each swapping which GeoJSON layer is active:

| Zoom | Layer shown | GeoJSON source | Choropleth unit |
| --- | --- | --- | --- |
| ≤ 6 | Netherlands outline | `land_2023.geojson` (single polygon) | national aggregate |
| 7 – 9 | Provinces (12) | `provincie_2023.geojson` | province (`PV*`) |
| ≥ 10 | Municipalities | `gemeente_2023.geojson` | municipality (`GM*`) |

Implementation approach:

- Listen to Leaflet's `zoomend` event in `overlays.js`.
- On each zoom change, call `map.removeLayer()` for the current layer and `map.addLayer()` for the new one — no full re-render, just a layer swap.
- Keep all three GeoJSON layers pre-loaded in memory after first fetch (lazy-loaded per tier on first entry).
- Municipality data is the heaviest (~500 KB GeoJSON); only fetch it once the user first crosses zoom 10.
- The active dataset's `{ region_code → value }` map covers all tiers: CBS `RegioS` codes use `NL01` for national, `PV*` for provinces, `GM*` for municipalities — the same normalize function handles all three.
- Tooltip and panel content update to match the active tier (country summary → province stats → municipality detail).

### Choropleth coloring

Each dataset produces a `{ region_code → value }` map keyed to whichever tier is active. The overlay module maps values to the accent gradient:

- Low values → dark purple (`#2e1065`)
- High values → burnt orange (`#ea580c`)
- Interpolated using CSS `color-mix()` or a linear scale function

---

## Phases

### Phase 1 — Foundation
- [ ] `index.html` shell with Spektrum + Leaflet from CDN
- [ ] Dark-themed map (CartoDB Dark Matter — `basemaps.cartocdn.com/dark_all`, attribution: `© OpenStreetMap contributors © CARTO`)
- [ ] Province GeoJSON overlay (cartomap/nl)
- [ ] Hover + click interaction on provinces (tooltip with name)
- [ ] `style.css` with full design token system
- [ ] `server.js` local dev server

### Phase 2 — First dataset: CBS demographics
- [ ] Fetch CBS OData population dataset
- [ ] Normalize to province level
- [ ] Choropleth fill per province
- [ ] Legend panel (Spektrum component)
- [ ] Dataset switcher UI

### Phase 3 — Crime overlay (Politie / CBS)
- [ ] Fetch crime dataset from politieopendata.cbs.nl
- [ ] Crime rate per 1,000 residents per province
- [ ] Choropleth + legend
- [ ] Detail panel: top crime categories on province click

### Phase 4 — Education overlay (DUO)
- [ ] Fetch school / pupil data from DUO API
- [ ] Aggregate per province
- [ ] Overlay + legend
- [ ] Detail panel: education level breakdown

### Phase 5 — Polish + deploy
- [ ] GitHub Actions workflow for gh-pages deployment
- [ ] Responsive layout (mobile: map full-screen, panel slides up)
- [ ] Keyboard navigation + ARIA labels
- [ ] Performance: pre-cache data snapshots in `/data/`
- [ ] `README.md` with live link

---

## Resolved decisions

### 1. Spektrum CDN URL — resolved

Load via importmap (no build step needed):

```html
<script type="importmap">
{
  "imports": {
    "spektrum": "https://unpkg.com/spektrum@1.0.1/spektrum.min.js"
  }
}
</script>
<script type="module">
  import { setValue, bindDOM, run } from 'spektrum';
</script>
```

Spektrum is a reactive templating engine: `{{expr}}` interpolation, `:attr` bindings, `data-action` events, `data-each` lists, `data-model` two-way inputs. ~12 KB minified, zero dependencies, CSP-safe.

### 2. DUO API key — resolved: none required

All standard DUO open data is freely accessible without registration or API key. Datasets are downloadable as CSV or queryable via `api.duo.nl` (REST/JSON-LD). The only gated subset is "synthetische data" (privacy-safe synthetic records) — not relevant for this project.

### 3. CBS dataset IDs — resolved

- **`70072ned`** ("Regionale kerncijfers Nederland") — the primary source. Confirmed via StatLine: covers 50+ statistics at province, COROP, and municipality level. Filter `RegioS` on `PV*` prefix (e.g. `PV20` = Groningen) to isolate province rows.
- **`37230ned`** ("Bevolkingsontwikkeling per regio per maand") — confirmed to have a `RegioS` GeoDimension. Useful for showing population change over time.
- OData v3 endpoint pattern: `https://opendata.cbs.nl/ODataApi/odata/{tableId}/TypedDataSet?$filter=...`

### 4. Tile provider — resolved: CartoDB Dark Matter, free with attribution

- **Tile URL:** `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`
- **Subdomains:** `abcd`
- **Attribution:** `© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>`
- **License:** CC-BY 4.0 — free for public GitHub Pages use with visible attribution on the map. No API key, no account needed.

### 5. Data freshness — decision: live fetch, province GeoJSON pre-cached

- **Province GeoJSON** (`cartomap/nl`) → pre-cache in `/data/provinces.json`. Boundary files change once a year at most; no reason to re-fetch on every page load.
- **CBS OData** (`70072ned`, `37230ned`) → live fetch on page load. The API is CORS-open for browser requests, no auth, and responses are small (~50–200 KB). Data updates annually.
- **Politie / CBS crime** → live fetch. Monthly updates, lightweight JSON, CC0 license.
- **DUO** → live fetch if the endpoint supports CORS; fall back to a pre-cached CSV snapshot in `/data/` if CORS blocks it (CSV downloads from duo.nl are direct and don't need CORS).
- **Caching strategy:** use `sessionStorage` to cache API responses within a browser session — avoids redundant requests when switching between dataset overlays without a full reload.
