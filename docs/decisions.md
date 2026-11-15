# Decisions

## 2026-11-15 — Rotterdam mode (v0.10.0)

- **Default scope is Rotterdam.** A topnav dropdown switches to "Nederland", which keeps the pre-0.10 province → gemeente → buurt tiers unchanged. The scope is stored in `localStorage` (`roffatistics.scope`) and mirrored in the URL hash (`#scope=…&view=…&area=…`); the hash wins over storage.
- **Wijk/buurt data: CBS 85984NED** (Kerncijfers wijken en buurten 2024). 85618NED (2023) has a few more income cells (Pernis, Nieuw Mathenesse) but older numbers everywhere else; one table keeps the scale consistent. Column keys live in `WIJK_COLUMNS` (`modules/areas.js`).
- **No wijk crime data.** 85984NED has no registered-crime columns, so `crimeRate` is null for every wijk/buurt and the map shows them all in the neutral "geen data" colour. Police wijk crime (table 47018NED) would be a separate fetch; not in scope.
- **Percentages are computed** from counts: `highEdu` = hbo/wo ÷ (three education levels), `pop65plus` and `nonWesternPct` (herkomst buiten Europa) ÷ inwoners. `avgIncome` is the household standardised income (`GemGestandaardiseerdInkomen_83`), not the gemeente table's employee income; both are ×€1,000.
- **Geometry is pre-cached** in `data/rotterdam_{gemeente,wijken,buurten}.geojson` (65 KB together, coordinates rounded to 5 decimals) instead of a runtime PDOK WFS call: GitHub Pages serves it with the app and the mask/fit never wait on PDOK. Regenerate with `node scripts/build-rotterdam-geo.mjs`.
- **Every area is always drawn.** Areas without a value share `NO_DATA_COLOR` (#4b4658); the legend shows a "geen data" swatch in Rotterdam mode. Wijk and buurt levels each get their own min/max scale. Buurten replace the wijk fill from zoom 13; wijk outlines stay on top.
- **Mask** = one Leaflet polygon: world ring plus every ring of GM0599 (evenodd fill makes the city a hole), in its own pane under the overlays at 0.85 opacity. `maxBounds` = city bounds + 15 %, `minZoom` = fit zoom − 1.
- **State bus** (`modules/state.js`): `setState` emits `state-change` on `document` with `{state, prev, changed, source}`; listeners use `source` to avoid echoing their own changes (map clicks set `area` with source `map`, other sources make the map zoom to the area).
- **Compare in Rotterdam mode** pins wijken/buurten instead of gemeenten, using the same panel slots.
