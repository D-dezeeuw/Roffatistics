# Plan: theme weights per levenstype (wooncomfort pre-weights)

Goal: the Woonscore starts from a sensible weighting of the themes before any
slider is touched. Almost everyone wants safety and amenities nearby; few care
much about building style, lifestyle or community metrics, or the current
housing market. And the weighting depends on how you live: a student wants
bars and bustle and hardly weighs safety or housing type, while a family weighs
safety and good schools close by heavily.
Status: **plan, 16 Nov 2026 (operator request).**

## Today

- `STANDAARD` (presets.js): Veiligheid 35, Welvaart 20, Voorzieningen 25,
  Opleiding 10, Woningmarkt 10. Every levenstype uses these same five base
  weights.
- A levenstype only *adds* to them: Levenstype (age mix, 15), metric boosts
  (gezin: school, eduNearScore and kinderopvang ×3; senior: huisarts ×3,
  supermarkt ×2), and Sfeer only for the solo types.
- Voorzieningen always holds school and kinderopvang, also for a student or a
  senior.
- The importance slider (0–4) multiplies the base weight that the answers give.

## Rule

A **levenstype profile** sets the starting weight of every theme, and the
metric weights inside Veiligheid, Voorzieningen and Sfeer. The rest stays as it
is:

- The importance sliders scale from the profile weight (factor × profile).
- An explicit Sfeer answer still sets the direction (its targets) and wins over
  the profile's busy/quiet direction, but the theme weight comes from the
  profile.
- Budget, Vervoer, Veiligheid chips (×3), Dichtbij, Situatie and Gemeenschap
  add on top as they do now.
- Without a levenstype, the new Standaard below applies. It is also the
  Ranglijst Totaalscore.
- Bouwstijl applies only when it is answered, at 5 (was 10).
- Gemeenschap is unchanged: opt-in only.
- A theme set to 0 is left out; the remaining weights renormalise (score.js
  already does this).

## Theme weights (sum 100 per column)

| Thema | Standaard | Student/starter | Stel | Gezin | 50-plus | Senior | Solo, onder de mensen | Solo, op mezelf |
|---|---|---|---|---|---|---|---|---|
| Veiligheid | 35 | 10 | 25 | 35 | 30 | 35 | 20 | 30 |
| Voorzieningen | 35 | 30 | 25 | 35 | 30 | 40 | 25 | 25 |
| Welvaart | 15 | 0 | 10 | 10 | 15 | 5 | 10 | 15 |
| Opleiding | 10 | 0 | 5 | 0 | 5 | 0 | 5 | 5 |
| Woningmarkt | 5 | 0 | 5 | 5 | 5 | 0 | 0 | 5 |
| Levenstype (buurtgenoten) | – | 20 | 10 | 10 | 5 | 10 | 10 | 0 |
| Sfeer | – | 40 druk | 20 druk | 5 rustig | 10 rustig | 10 rustig | 30 druk | 20 rustig |

Notes:

- **Gezin, Opleiding 0:** for a family the quality of the schools nearby
  (`eduNearScore`, in Voorzieningen) replaces "many highly educated adults".
- **Stel** is read as a young, outgoing couple, as the operator described it.
  The current option label stays "Stel"; the hint text says "jong stel, graag
  wat te doen".
- **Senior:** low Welvaart and no Woningmarkt; this group stays put more often,
  and amenities and safety on the street count more.

## Metric weights inside the themes

Only the metrics listed get a weight. A metric that has no data drops out, as
it does now.

**Voorzieningen**

| Profile | Metrics (weight) |
|---|---|
| Standaard | distGP 1, distSupermarket 1, distSchool 1, distStation 1, distKinderopvang 1 |
| Student | distSupermarket 2, distStation 2, distOv 2, distGP 1 |
| Stel | distSupermarket 2, distStation 2, distOv 1, distGP 1 |
| Gezin | distSchool 3, eduNearScore 3 (higher), distKinderopvang 3, distGroen 2, distGP 1, distSupermarket 1 |
| 50-plus | distGP 2, distSupermarket 2, distStation 1, distGroen 1 |
| Senior | distGP 3, distSupermarket 2, distOv 2 |
| Solo, onder de mensen | distSupermarket 2, distStation 1, distOv 1, distGP 1 |
| Solo, op mezelf | distSupermarket 1, distGP 1, distGroen 2, distOpenNatuur 1 |

**Veiligheid**

| Profile | Metrics (weight) |
|---|---|
| Standaard, Stel, 50-plus, Solo | as today: crimeRate, crimeBurglary, crimeViolence, crimeStreetRobbery, crimeVandalism 1 each; crimeNearby `NEARBY_W` |
| Student | crimeBike 2, crimeStreetRobbery 1, crimeViolence 1 |
| Gezin | crimeBurglary 2, crimeViolence 2, crimeStreetRobbery 1, crimeDrugs 1, crimeVandalism 1, crimeNearby `NEARBY_W` |
| Senior | crimeBurglary 2, crimeStreetRobbery 2, crimePickpocket 1, crimeViolence 1, crimeNearby `NEARBY_W` |

**Sfeer**

| Direction | Metrics (weight) | Used by |
|---|---|---|
| druk (busy) | density higher 2, horeca1km higher 2, distCentrum lower 1, distPodium lower 1 | student, stel, solo onder de mensen |
| rustig (quiet) | density lower 2, distCentrum higher 1, waterPct higher 1 | gezin, 50-plus, senior, solo op mezelf |

When the Sfeer step is answered, its target logic (density and distCentrum
targets, plus horeca at the busy end) replaces these metrics, and the profile
keeps only the theme weight.

**Levenstype** keeps its existing metrics (`LIFE_METRICS`), with the theme
weight from the table.

## Steps

1. Put the profiles in `modules/presets.js` (or a new `modules/profiles.js`) as
   one data table (theme weights and metric lists), so tweaking a number means
   one edit. `STANDAARD` takes the Standaard column.
2. In `wizard-model.js`, have `APPLY.levensfase` take its base from the
   profile; remove the old ad-hoc boosts (gezin and senior boosts,
   `SOLO_SFEER`) now that the table covers them. Set `EXTRA_THEME_WEIGHTS.nieuwbouw`
   to 5. Have `themeWeights()` and the importance step use the profile as base.
3. UI:
   - Under the Levenstype options, the hint names the starting weights in one
     line, e.g. "Student: sfeer en uitgaan zwaar, veiligheid licht. Je kunt
     alles bijstellen."
   - The importance step shows the profile weights as its starting point.
   - The Ranglijst breakdown and the "waarom" reasons follow automatically.
4. Tests:
   - Each profile sums to 100.
   - Student has no distSchool, distKinderopvang or Woningmarkt.
   - Gezin holds eduNearScore and has no Opleiding.
   - An explicit Sfeer answer overrides the profile's direction.
   - The importance slider scales from the profile.
   - Old hashes still decode, and their weights change as intended.
   - Standaard is the new column.
5. Add an entry in `docs/decisions.md` saying that the Standaard and
   Totaalscore weights changed: Voorzieningen 25→35, Welvaart 20→15,
   Woningmarkt 10→5.

## Addendum (operator, 16 Nov 2026): background weighs heavily, luxury themes off

Operator: people strongly look for neighbours like themselves.
- Well-off people live among other well-off people because of status and social
  expectation.
- People on a low income often prefer a volkswijk with like-minded neighbours,
  where they feel at home even if it is not the safest.
- Newcomers and people with a specific cultural background find support among
  people with the same background; settling in takes years.
- The type of home and the state of the housing market are luxury issues.

Changes on top of the table above:

1. **Vergelijkbare situatie** (income band and/or education level, opt-in in
   the wizard): theme weight 15 → **30** when answered. The income band already
   works as a *target* around your own band in both directions (high → among
   high incomes, low → among lower incomes); keep that. Add one hint line to
   the step: "Mensen kiezen vaak een buurt met mensen in een vergelijkbare
   situatie; daar voel je je thuis."
2. **Nabijheid gemeenschap** (opt-in, origin): default level when chosen 10% →
   **20%** of the total (`GEMEENSCHAP_DEFAULT_PCT`; level scale unchanged). Hint
   line: "Net in Nederland of graag dicht bij mensen met dezelfde achtergrond?
   Een eigen gemeenschap in de buurt kan veel steun geven." The §5 guard stays
   as it is: origin counts only as a plus, never as a minus, a target or a
   filter.
3. **Woningmarkt → 0 in every column, Standaard included.** Bouwstijl only
   when answered (5). The importance slider must still be able to switch a
   theme back on when its base is 0: a slider on a base-0 theme uses a nominal
   base of 10 (so "Gemiddeld" = 10).
   Re-balance: the Standaard column's freed 5 goes to Voorzieningen (40).
   Every other column adds its freed Woningmarkt points to Levenstype
   (buurtgenoten).
4. **No automatic safety discount by income.** We do not infer that a lower
   income wants less safety. Safety's share drops only through renormalisation
   when Situatie or Gemeenschap weigh in, and the user can lower it on the
   slider. Record this in decisions.md.
