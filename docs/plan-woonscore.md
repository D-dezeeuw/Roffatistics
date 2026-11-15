# Plan — Woonscore and "Ideale woonplek"

Status: plan, 15 Nov 2026. Builds on the existing per-area percentiles
(`area-detail.js` `overallRank`, the "Totaalscore" in the Ranglijst).

## Goal

1. **Woonscore** — one 0–100 score per gemeente (Nederland) and per wijk and
   buurt (Rotterdam), built from the plus and minus points we already show.
   The page opens on this layer.
2. **Ideale woonplek** — a short wizard that asks how someone wants to live
   and recolours the map with a personal score, a top 10 and a "waarom" per
   area.

## 1. Score engine (`modules/score.js`, pure, tested)

Per level and scope the peers are the areas on screen: NL gemeenten among
themselves, Rotterdam wijken among wijken, buurten among buurten. A score is
**relative to its peers** and the legend says so. A buurt score is not a
gemeente score.

**Per metric → 0..1 factor**
- *Normalise:* percentile rank within peers. Skewed metrics (crime rates,
  welfare) go through log1p first, the same way `scale.js` does.
- *Preference function*, one of:
  - `higher` / `lower` — the percentile, or 1 − percentile.
  - `target` — closeness to an ideal value with a tolerance (WOZ against a
    budget, density against a "druk ↔ rustig" slider). Gaussian falloff,
    0 at ±2 tolerances.
  - `filter` — optional hard cut ("verberg onbetaalbaar"). Shown greyed out,
    never silently dropped.
- *Small-area shrinkage:* buurten under about 300 inwoners give noisy rates
  (3 bike thefts among 150 people). Rates are shrunk toward the parent wijk
  (empirical Bayes, weight n / (n + k)) before the percentile is taken. The
  modal shows a "weinig inwoners" badge.

- *Geen woonwijk* (W7, 15 Nov 2026): business, port, recreation and empty
  wijken/buurten (`modules/woongebied.js`, from inwoners, woningvoorraad,
  niet-woningvoorraad and bedrijfsvestigingen) are no peers and get no score.

**Combine:** score = 100 × Σ wᵢ·fᵢ / Σ wᵢ over the metrics that have data.
An area needs ≥ 60 % of the weight covered, otherwise "onvoldoende data"
(hatched, as no-data is now).

**Explain:** for each area return the contribution per factor (wᵢ·fᵢ, and
whether it is a plus or a minus). The modal and the wizard result use this
for "Sterk: veilig, voorzieningen dichtbij · Zwak: fietsendiefstal".

A preset is plain data: `{ id, label, weights: {metric: w}, targets: {metric: {ideal, tolerance}}, filters }`.
It lives in `modules/presets.js` and is serialised into the URL hash
(`#score=<preset>` or a compact custom string) so a personal map can be
shared.

## 2. Default preset "Standaard" (no lifestyle metrics)

Average preferable circumstances only. Metrics that depend on taste are left
out: density/drukte, age mix, origin, WOZ as such (expensive is not better).

| Theme (weight) | Metrics | Direction |
|---|---|---|
| Veiligheid (35) | crimeRate, crimeBurglary, crimeViolence, crimeStreetRobbery, crimeVandalism, crimeNearby (omgeving, w 1; W8) | lower |
| Welvaart (20) | avgIncome (higher), welfarePer1000 (lower) | |
| Voorzieningen (25) | distGP, distSupermarket, distSchool, distStation, distKinderopvang (W2) | lower |
| Opleiding (10) | highEdu | higher |
| Woningmarkt (10) | ownerOccupiedPct, mildly (stability proxy) | higher |

NL gemeenten have fewer metrics (crimeRate, avgIncome, highEdu, plus what
70072ned adds). The same preset works with renormalised weights, and the
legend lists what was used. This replaces the current unweighted
"Totaalscore" (kept as "Gelijk gewogen" preset for continuity).

## 3. Data to add (W2)

All from CBS open data, per buurt where available. Table ids are checked when
the epic starts.
- **Age bands** from 86165NED: 15–24, 25–44, 45–64, 65+ (only 65+ is loaded
  now). Households with children.
- **Building age:** share of homes built before 1945 / after 2000 (kwb
  woningvoorraad). Lets "young person, not an old neighbourhood" mean the
  *people* or the *buildings*. The wizard asks which.
- **Nabijheid voorzieningen** (CBS proximity table): train station, primary
  school, kinderopvang, cafés/restaurants (uitgaan), park/green where
  present.
- **Distance to centrum:** computed from the geojson centroid to Rotterdam
  Centraal / Coolsingel. No new source.

## 4. Wizard "Ideale woonplek" (W3)

A small modal, 6 steps, each skippable. "Overslaan" keeps the Standaard
weights. Mobile first. Answers live in localStorage and the URL hash.

1. **Levenstype** (was Levensfase; renamed 15 Nov 2026, see decisions): student/starter, stel, gezin met kinderen, 50+, senior, solo onder de mensen, solo op mezelf →
   age-mix target (share 25–44 or 65+), and for gezin: school and
   kinderopvang weights up.
2. **Budget:** huur or koop, household income or max price → WOZ `target`
   (koop: income × 4.5 as indicative ceiling, stated as a rough rule), with
   an optional "verberg duidelijk te duur" filter. Huur: rentalPct up and
   corporatie WOZ as context.
3. **Vervoer:** fiets / OV / auto / lopen (multi) → fiets: crimeBike weight
   ×3. OV: distStation. Auto: crimeVehicle up, lower density preferred.
4. **Sfeer:** slider "midden in de drukte ↔ rustig wonen" → `target` on
   density and distance to centrum, and uitgaan nearby for the busy end.
5. **Veiligheid:** which crimes weigh most for you (chips: inbraak, geweld,
   straatroof, fietsendiefstal, autodiefstal, vandalisme, drugsoverlast).
6. **Gemeenschap (optional, opt-in):** see §5.

**Result:** the map recoloured by "Jouw score", a top 10 with a match % and
the three biggest pluses and minuses, sliders per theme for fine-tuning, and
"vergelijk met Standaard". Choosing an area opens the existing area modal
with the personal breakdown added.

## 5. Gemeenschap — how the origin preference works (W4)

The request: someone of Surinamese background may want to live near more
people from the Surinamese community. This is supported as a **positive,
opt-in attraction only**:
- Off by default and never part of Standaard. The step explains what the
  CBS herkomst groups are and that the data is aggregate.
- The user picks one group from the CBS origin groups we already show
  (86165NED _17–_24; city-level 85458NED). The factor is the share of *that*
  group, `higher`, with a weight the user sets (default modest).
- There is **no option to score down any group**, no "avoid", and no ranking
  by the absence of a group. Choosing "Nederlands" is allowed under the same
  rule (more of the chosen group = plus). Absence of others is never a factor.
- The personal score is computed in the browser and nothing is sent anywhere.
  A shared URL carries the preference only if the user ticks it in the
  result's "Deellink maken" block (unticked by default; v0.26.0, see
  docs/decisions.md). The broad groups are gone: one dropdown of detailed
  groups, Nederland included, default "Geen specifieke groep".
- The Uitleg panel gets a paragraph on this, and the result shows the factor
  as "nabijheid gemeenschap", not as an ethnic score of the area.

## 6. Map and page integration

- New dataset group "Score" with layers `woonscore` (Standaard) and
  `jouwscore` (wizard). It uses the existing 7-class quantile scale and the
  legend, and the colours read green = good.
- The page opens on Woonscore at gemeente level (Nederland) and wijk/buurt
  (Rotterdam). Deep links with another `dataset=` keep working.
- Ranglijst: "Rangschik op" gets Woonscore / Jouw score, with a breakdown
  column.
- Area modal: score block with plus/minus contributions and a reliability
  badge.
- A "Vind jouw ideale woonplek" button in the top bar opens the wizard.

## 7. Epics

| Epic | Scope | Done when |
|---|---|---|
| W1 | score.js + presets.js (Standaard, Gelijk gewogen), shrinkage, coverage rule, explain; Woonscore layer as default; Ranglijst + modal breakdown | unit tests for engine and presets; page opens on Woonscore for NL and Rotterdam |
| W2 | age bands, households with kids, building age, nabijheid, distance to centrum | datasets in DATASETS with INFO/Uitleg; data tests |
| W3 | wizard steps 1–5, Jouw score layer, top 10, sliders, URL/localStorage | wizard state ↔ preset mapping tested; happy flow — **built 15 Nov 2026 (v0.20.0)**, see decisions.md |
| W4 | Gemeenschap step with the §5 rules; Uitleg text | tests that no preset or URL can produce a negative origin weight — **built 15 Nov 2026 (v0.21.0)**, see decisions.md |
| W5 | NL gemeenten extra metrics, "Jouw vs Standaard" compare, polish | — |
| W6 | Personal wizard: detailed origin group per gemeente (85458NED), step "Jouw situatie" (opleiding, bijstand; v0.26.0: income and education sliders, see decisions.md), 5-step importance per theme | positive-only guards, hash round-trips incl. old hashes — **built 15 Nov 2026 (v0.23.0)**, see decisions.md |

Out of scope for now: all ~14k NL buurten (only Rotterdam buurten are
loaded; that is a separate data/size decision), and house-price data beyond
WOZ.

## Done already (15 Nov 2026)

Hold **Space** to pan: features ignore the pointer while Space is down, so
a drag never opens an area (`modules/space-pan.js`, tests/space-pan.test.js).
