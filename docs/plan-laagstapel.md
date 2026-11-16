# Plan: Laagstapel — combine layers into one map

Goal: a user who cares about, say, WOZ and crime picks those layers and gets
one map (and Ranglijst column) that averages them. A transparent, hand-built
alternative to the Woonscore: no profile, no shrinkage, only the chosen layers.
Status: **built, v0.50.0 (16 Nov 2026); decisions in docs/decisions.md "Laagstapel".**

## Rule

- **Stapel** = 2–6 layers from `DATASETS` (any scope-available layer, including
  the Woonscore itself and later the milieu layers). Per layer:
  - **direction**: "hoger is beter" / "lager is beter". Default from
    `higherIsBetter`; layers with `higherIsBetter: null` (herkomst, neutral
    layers) must get a direction picked before they count. WOZ defaults to
    "lager is beter" in the stack (affordability), with the toggle visible.
  - **weight**: 1, 2 or 3 (default 1).
- **Value** per area = weighted mean of the direction-aware percentile scores
  (`ranking.js percentileScores`) of the chosen layers, 0–100, computed within
  the set the map shows (city wijken and buurten separately; NL per level,
  like the Ranglijst). An area needs a value on at least half of the weight
  (rounded up) or gets "geen data".
- Crime layers follow the Per 1000 / Absoluut toggle like everywhere.
- Not part of the Woonscore and does not change it.

## Where it shows

1. **Layers dropdown**: a new entry "Mijn stapel" (key `stapel`) at the top
   group, under the Woonscore. Picking it without a stack opens the builder.
2. **Builder** ("Stapel samenstellen"): a dialog/panel listing the layers by
   their dropdown groups with a checkbox, and per checked layer the direction
   toggle and weight 1–3; live count "3 lagen". Opened from the Layers
   dropdown entry, from a "+ Stapel" button in the legend on any layer
   (adds the shown layer), and from the legend while `stapel` is shown
   ("Bewerken").
3. **Map + legend**: the usual 7 quantile classes on the 0–100 value; the
   legend lists the stacked layers with arrows (↑ beter / ↓ beter) and weights.
4. **Tooltip / area modal**: the stack value plus each layer's part (its
   score and raw value), so the user sees why an area scores as it does.
5. **Ranglijst**: `stapel` is a rankable column/"Rangschik op" option like
   any layer.
6. **URL + storage**: `&stack=wozValue.l,crimeRate.l2,distGroen.l` (key, `h`/`l`
   direction, optional weight digit); remembered in localStorage like
   `score`. Invalid or unknown keys are dropped; fewer than 2 valid → no stack.

## Steps

1. **Model** (`modules/stapel.js`, pure): parse/serialize the stack spec,
   default directions, `stackValues(areas, spec, datasets)` → per-area value
   plus parts. Unit tests: directions, weights, coverage rule, crime mode,
   parse round-trip, bad input.
2. **State + layer**: `stack` in state.js (hash, storage, sanitize), the
   `stapel` dataset entry, values assigned where the Woonscore is assigned
   (app.js `assignScore`) and recomputed on stack or crime-mode change.
3. **Builder UI + legend + tooltip/modal + Ranglijst** wiring; happy-flow test.
4. Uitleg entry for "Mijn stapel" (how it is computed, that it is relative to
   the shown set).
