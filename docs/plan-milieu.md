# Plan: Milieu — noise, heat, air and nuisance per buurt

Goal: layers for people who want a quiet place or are hoogsensitief. They show
how much noise, heat, air pollution and nuisance a buurt has, and work in the
map, Ranglijst, area modal, Uitleg and Mijn stapel (plan-laagstapel).
Status: **phase 1 built 16 Nov 2026** (decisions.md "Milieu phase 1"); phases 2–3 plan. Operator request. Sources: docs/milieu-bronnen.md.

## Rule

- New Layers group **Milieu**. All layers are "lager is beter", inside the
  Woonscore only as an opt-in later (not in this plan).
- Build-time only: one script `scripts/build-nl-milieu.mjs` writes
  `data/nl/milieu-buurt-2025.json`; wijk and gemeente values are
  population-weighted means, the way the other build-nl scripts aggregate.
  No runtime calls to RIVM or the Klimaateffectatlas.
- RIVM and KEA publish on buurt 2024 codes. Map 2024 → 2025 by code where it
  is unchanged and by largest area overlap otherwise; buurten with no match
  get "geen data". The build prints how many 2025 buurten stay empty.
- The hinder figures are model estimates (Gezondheidsmonitor small-area
  estimates), not measurements. The Uitleg says so, with the source and year.
- Attribution per layer in the source line (RIVM / Klimaateffectatlas,
  CC-BY or CC0 as the metadata says; check it in step 1).

## Phase 1 — per-buurt records (small)

From the RIVM WFS `https://data.rivm.nl/geo/alo/wfs`, layers
`rivm_20251201_*_bu_2024` (one GET without geometry each):

1. **Geluidhinder wegverkeer** — % adults seriously bothered by road noise.
2. **Geluidhinder buren** — % seriously bothered by neighbour noise.
3. **Stilte-index** — % seriously bothered by any noise source (road, rail,
   aircraft, wind turbines, neighbours) combined, or sleep disturbance if
   the record has it; the build picks the field and the Uitleg names it.

From the Klimaateffectatlas WFS:

4. **Gevoelstemperatuur** — `GevoelstemperatuurBuurt_2022`, felt temperature
   on a hot day (PET).
5. **Schaduw** — share of shade from `BD_buurtdashboard_20260312`
   (`P_schaduw_fw`); higher is better.

Steps: build script + data file + tests on the code mapping and the
aggregation → `DATASETS` entries in group Milieu with Uitleg texts → area
modal block "Milieu" → happy-flow test.

## Phase 2 — rasters (medium)

6. **Luchtkwaliteit NO₂ and PM2.5** — RIVM WCS (GCN, 1 km), mean per buurt
   (area-weighted). First verify that GetCoverage works for these coverages.

## Phase 3 — later, each its own decision

- **% adressen ≥ 55 dB Lden** (RIVM 10 m raster sampled at BAG addresses; 2–3
  days, needs a BAG extract and ~1.6 GB of cached tiles).
- **Meldingen afval/schoon per 1.000 inwoners** — Amsterdam only (MORA API);
  Rotterdam has no open equivalent. Meldingen measure reporting, not dirt.
- **Overstroming** — LIWO water depth if a downloadable coverage exists; the
  open risk zones barely separate polder buurten, so not worth a layer alone.
- **Lichtemissie**, distance to the nearest wind turbine, Leefbaarometer
  "fysieke omgeving" (CSV must be fetched by hand).

## Rustig wonen

After phase 1 and the stapel exist: a ready-made stack "Rustig wonen"
(stilte-index, geluidhinder buren, geluidhinder wegverkeer, gevoelstemperatuur,
crime) offered in the stack builder, and the wizard Sfeer "rustig" answer
weighs the stilte-index.
