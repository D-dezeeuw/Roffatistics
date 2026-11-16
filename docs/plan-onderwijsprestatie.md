# Plan: Onderwijsprestatie basisscholen per buurt, wijk en gemeente

Goal: a new layer that shows how well primary schools in an area perform,
measured by the reference levels (referentieniveaus) their group-8 pupils reach
on the doorstroomtoets/eindtoets. Each school's result is placed in its buurt by
the school's address and rolled up to wijk and gemeente. A second step adds
"compared with what you would expect from the pupil population" (schoolweging),
so the layer does not just show the area's background again.
Status: **plan, 16 Nov 2026; in uitvoering.** Operator 16 Nov: elke school een eigen score, een gebiedslaag met het gemiddelde van de scholen, en schoolpins als aparte instelling zoals OV.

## What we have today

None of this is in the app yet. The education data we have:

- `distSchool`: distance to the nearest basisschool (CBS nabijheid). This
  measures how close a school is, not how good it is.
- `lowEdu`: the share of adults with a low education level (CBS kerncijfers).
  This is about the residents, not about the schools.
- `.github/docs/roadmap.md:114` records that DUO open data gave a 404 back then.
  It now answers through the new CKAN portal `onderwijsdata.duo.nl`, checked
  16 Nov 2026 below.

## Sources (checked 16 Nov 2026)

All of them are on the DUO CKAN portal; the API is `/api/3/action/package_search`.
Download URLs:

| Dataset | CKAN name | File | Size / years |
|---|---|---|---|
| Referentieniveau per toets en vestiging | `wporeferentieniveau-v1` | `brin6_referentieniveau.csv` | 436k rows; peiljaar 2015–2024 (no 2019, the 2020 test was cancelled) |
| Gemiddelde eindscores per vestiging | `wpo-eindscores` | `brin6_eindscores.csv` | 100k rows; 2010–2024 |
| Adressen vestigingen bo | `adressen_bo` | `vestigingenbo.csv` | 6,086 vestigingen (168 in Rotterdam, 165 of them with 2024 results) |
| Leerlingen po per vestiging naar achtergrond | `poachtergrond` | (optional context) | |

Resource URLs (the dataset and resource ids are stable; get them again through
`package_show` in the build script rather than hard-coding them):

```
https://onderwijsdata.duo.nl/dataset/c62ea867-72d4-41ae-81af-8b4db27c5e52/resource/89920163-8b28-4e1a-b322-c3bb90f74f41/download/brin6_referentieniveau.csv
https://onderwijsdata.duo.nl/dataset/36397882-2746-42f7-8eca-2ae203242b30/resource/be21eafb-63fa-4230-80a8-bbd73b3a79ff/download/brin6_eindscores.csv
https://onderwijsdata.duo.nl/dataset/786f12ea-6224-42fd-ab72-de4d7d879535/resource/dcc9c9a5-6d01-410b-967f-810557588ba4/download/vestigingenbo.csv
```

What we found in the data:

- **Key**: `INSTELLINGSCODE` (BRIN, 4 characters) + `VESTIGINGSCODE` (2 digits)
  = BRIN6. In the addresses file `VESTIGINGSCODE` is already the full BRIN6
  (`32JK00`).
- **Referentieniveau columns**: `PEILJAAR, DOORSTROOMTOETS_PO (toets id 0011–0018),
  REFERENTIENIVEAU, AANTAL_LEERLINGEN`. The levels are
  `TAAL_LV_{LAGER_1F,1F,2F}` (lezen), `TAAL_TV_{LAGER_1F,1F,2F}`
  (taalverzorging) and `REKENEN_{LAGER_1F,1F,1S}`. The **buckets do not
  overlap**: each one counts the pupils whose highest level is that level.
  Example: 00AR 2024 lezen 2F 13 + 1F 8 = 21, which equals the 21 pupils in
  the eindscores file.
- **`-1` = suppressed** (a small cell, 1–4 pupils). 144k of the 436k rows are
  suppressed. Handling: per school, take the total from `eindscores.AANTAL_LEERLINGEN`;
  if exactly one bucket is suppressed, derive it by subtraction; otherwise use
  2 per suppressed cell and mark it as an estimate.
- **Eindscores cannot be compared across tests**: Cito ≈ 540, LIB ≈ 174 and so
  on, each on its own scale. **Do not use them as the metric.** They are only
  useful for the pupil total.
- **Schoolweging** (CBS, per vestiging, the expected score given parents'
  education, origin, income, debt restructuring and the neighbourhood): this is
  not on the DUO portal. CBS publishes it as a separate maatwerk table per year
  (and the Inspectie uses it for its signaleringswaarden). **Verify in step 0**
  where it can be downloaded and with what key. If it is not openly available,
  step 4 falls back to the comparison with CBS area characteristics (see
  there).

Address → buurt: the addresses file has `POSTCODE` + `HUISNUMMER-TOEVOEGING`.
We already use the CBS pc6huisnr file (PC6 + huisnummer → buurt 2023,
`.cache/pc4/`, see `plan-herkomst-pc4.md`); join on that and map to 2025 codes
the way `pc4-gwb-2023.json` does. Fallback for misses (a new address, a
suffix): the PDOK Locatieserver (`/free?q=<postcode> <nr>&fq=type:adres`, which
returns `buurtcode` in the current indeling); about 6k lookups, run only at build
time and cached.

## Metrics

**Schoolscore (every school its own score, 0–100, shown also as a grade /10).**
Per pupil result per subject (lezen, taalverzorging, rekenen): below 1F = 0
points, 1F = 50, 2F/1S = 100. The score is the average over all pupil results
of the school, pooled over **3 peiljaren (2022–2024)** (fewer suppressed cells,
less noise). Alongside it per school: % ≥1F, % 2F/1S per subject, pupils tested,
years used. Every BO school with any results gets a score; with fewer than 30
pupils tested pooled it is flagged "klein aantal leerlingen" (shown, not
hidden). Schools without results (new, no test data) are listed as "geen
toetsgegevens" and get no score, never a guess.

**Area layer `eduScore` (the grading of an area).** The **average of the
schoolscores of the schools in the area** (each school counts once, as the
operator asked), per buurt, wijk and gemeente. With it: `eduSchools` (schools
with a score), `eduTested` (pupils), and the context metrics `eduFundPct` /
`eduStreefPct` (pupil-weighted shares ≥1F and 2F/1S). An area without a scored
school is null ("geen basisschool met toetsgegevens").

- Only `TYPE_PO = BO`; SBO left out (a different population; including it would
  penalise an area for having an SBO school).

**School pins.** A separate map layer, switched in **Instellingen** like the
OV lines (own checkbox "Basisscholen", own localStorage key, default off).
A pin per school, coloured by its schoolscore on the same scale as the area
layer; click → name, address, score/10, the per-subject breakdown, pupils,
"klein aantal" flag. Independent of which area metric is shown.

## Interpretation (caveats in `datasets.js`)

- It measures **the schools in the area**, not the children who live there.
  Children cross buurt boundaries (and school choice is free), so the value is
  most meaningful at wijk level; at buurt level many areas have no school
  (null).
- The results reflect the pupil population heavily (parents' education,
  language at home). A low score does not mean a bad school; that is exactly why
  step 4 exists.
- Test ids and test providers differ per school; reference levels are the only
  measure that is comparable across tests.
- Peiljaar = the calendar year of the test (the school year ends in it). From
  2024 on it is the doorstroomtoets (February), before that the eindtoets
  (April). The cutoff values changed slightly; pooling 2022–2024 deliberately
  spans that transition. Mention it in the caveat.

## Steps

0. **Verify** (no code): the schoolweging source and key (CBS maatwerk /
   Inspectie); test ids 0011–0018 → test name (only for the caveat text); that
   `-1` really means 1–4 (DUO's description of the dataset).
1. `modules/schools.js` (pure, unit-tested): `parseRefLevels(rows)` →
   per BRIN6 per year per subject the buckets; `fillSuppressed(buckets, total)`;
   `schoolScore(buckets)` → {tested, fund, streef}; `aggregate(schools, areaOf)`
   → per area sums and percentages; the minimum of 30. Tests with small fixtures
   (including the 00AR example and a case with two suppressed cells).
2. `scripts/build-schools.mjs` → `data/nl/onderwijs-po-2024.json`: downloads
   through the CKAN API into `.cache/duo/` (gitignored), joins addresses →
   buurt (pc6huisnr, PDOK fallback, misses logged and counted), and writes per
   level (buurt/wijk/gemeente) column-wise `eduStreefPct`, `eduFundPct`,
   `eduTested`, `eduSchools`, `eduScore`, plus a school list (BRIN6, name,
   address, lat/lon, buurt code, score, per-subject shares, tested, small flag)
   for the pins and panels. Header with
   sources and built date like the other `data/nl` files. Target < 1 MB.
3. App: `modules/datasets.js` gets `eduScore` ('Onderwijsprestatie
   basisscholen', the main layer) plus `eduStreefPct` and `eduFundPct`, with description,
   formula and caveats as above, `higherIsBetter: true`, `inOverall: false` at
   first (decided with the operator after the first look; it is partly
   background, so it should not count twice next to income/education). Loaded
   on demand like `herkomst-pc4`. Area panel: the number of schools, pupils
   tested, % 1F / % 2F-1S, and the list of schools in the area with their own
   figures. School pins as an Instellingen toggle like OV (see Metrics).
4. **Expected vs. actual** (the "how much does the school add" part):
   - With schoolweging: per school, the expected 2F/1S% from a simple regression
     on schoolweging across NL (computed in the build, coefficients stored in
     the JSON header); metric `eduVsExpected` = actual − expected in
     percentage points, aggregated weighted by pupils. Positive = the schools
     do better than their population would predict.
   - Without schoolweging (fallback): the same regression at area level on CBS
     metrics we already have (`lowEdu`, income, share with a non-western
     background), clearly labelled as a rough area estimate.
   - Diverging colour scale around 0; caveat that this is a statistical
     residual and not an Inspectie judgement.
5. **Schoolkwaliteit dichtbij huis → gezin (operator, 16 Nov).** A primary
   school has to be close to home (children walk or cycle there), unlike
   secondary/higher education. So for families not only availability
   (`distSchool`) but also the quality of the schools *near home* counts, and
   the schools inside the buurt alone are not enough (many buurten have none,
   and the nearest school is often over the border).
   - Metric `eduNearScore` per buurt (rolled up to wijk/gemeente weighted by
     inhabitants): the distance-weighted mean schoolscore of scored BO schools
     within **1.5 km** (straight line) of the buurt centre, weight
     `max(0, 1 − d/1.5 km)`; plus `eduNearBest` = the best schoolscore within
     **1 km** and `eduNearCount` = scored schools within 1 km. Null when no
     scored school within 1.5 km. Computed in `build-schools.mjs` from school
     lat/lon and the buurt centres we already have. Caveat: straight-line
     distance; school choice, waiting lists and catchment rules are not seen.
   - Woonscore/wizard: levensfase **gezin** gets `eduNearScore` (higher, ×3)
     next to `distSchool` and kinderopvang, i.e. quality and availability
     both count. Also in Voorzieningen? No: it is quality, not a facility;
     own entry in the Leeftijd/gezin mapping. Record in `docs/decisions.md`.
   - Area panel and school-pin popup: for a buurt show "Basisscholen binnen
     1 km" (name, score/10, distance).

## Tests and acceptance

- Unit: `tests/schools.test.js` (parse, suppression, aggregation, minimum,
  SBO filter) and a data test on the built JSON (codes exist in
  `buurten-2025.json`, percentages 0–100, Rotterdam has ≥ 150 schools, at least
  95% of addresses geocoded).
- Sanity: the NL 2024 national 1F and 2F/1S shares that the build computes
  match the national figures in the Inspectie's *Staat van het Onderwijs* to
  within a few points; the build logs them.
- Happy flow + browser smoke: the layer switches on, a Rotterdam wijk shows a
  value and a school list.
- Version: minor bump (0.44.0) for steps 1–3; step 4 its own minor.

## Open questions for the operator

- ~~Pins?~~ Yes, as an Instellingen layer like OV (16 Nov).
- Should `eduVsExpected` (step 4) be the main view once it exists, instead of
  the raw percentage?
- NL or Rotterdam first? Not answered; built for all of NL (the data supports
  it and the file stays small).
