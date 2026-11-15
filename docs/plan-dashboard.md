# Plan: balanced dashboard (W17, 15 Nov 2026)

Operator: "the Dashboard now shows way too much information. It should be a
balanced dashboard." The old view stacked 9 KPIs, 4 donuts, a 4-card herkomst
section, a scatter and one bar chart per dataset (~45 charts). It becomes a
fixed grid of **6 categories × 3 panels**: 3 columns per row (2 below 1100 px,
1 below 680 px, same order), a small heading per row.

## What data exists per scope

| | Rotterdam (wijken, buurten) | Nederland (wijken-2025.json → gemeenten) |
|---|---|---|
| Woonscore + factor results | yes (`values.woonscore`, `area.woonscore`) | yes per wijk; gemeente = population-weighted mean of its wijken |
| Age bands 15–24 … 65+, hh with kids | yes | yes |
| NL / Europa / buiten Europa | yes | yes |
| Herkomst per wereldregio incl. Nederland | gemeente only (`herkomst-regio-gemeente-2026.json`, GM0599) | every gemeente; NL = sum of all 342 |
| Crime total, 10 categories, trend vs 2024 | yes | yes (counts stored, rates derived) |
| Education low/med/high | yes | yes |
| Income, WOZ, koop/huur, bijstand, nieuwbouw | yes | yes |
| Bouwperiode (voor 1945 / 2005+) | after `loadBouwjaar()` (PC4 2023) | idem |

Lists compare **wijken** (Rotterdam) or **gemeenten** (Nederland, aggregated
from the national wijk file, names from the herkomst-regio file). Lists skip
non-residential areas and wijken under 1,000 inhabitants (port, industry).
A selected area (state `area`: wijk/buurt in Rotterdam; gemeente, wijk or
loaded buurt in Nederland) is compared with the Rotterdam / Nederland figure;
without one each panel shows the city or national overview.

## The 18 panels

1. **Woonscore**
   - *Score en verdeling*: KPI (selected score and rank, or the average) above a 10-class histogram; the single best summary of how areas spread.
   - *Hoogste en laagste 5*: who leads and trails; the question everyone asks first.
   - *Wat drijft de score*: for a selected area its 3 strong and 3 weak factors (score.js `explain`); otherwise the factors that separate the top quarter from the bottom quarter. Explains the number instead of repeating it.
2. **Leeftijd**
   - *Leeftijdsopbouw*: share per band (0–14 derived, 15–24, 25–44, 45–64, 65+), area vs reference marker.
   - *Vergrijzing en jongeren*: top 5 by 65+ next to top 5 by 15–24: the two extremes of the pyramid.
   - *Gezinnen met kinderen*: KPI vs reference plus the top 5.
3. **Herkomst**
   - *Per wereldregio*: Nederland and the largest world regions (CBS 85458NED 2026) for the gemeente, with the national share as marker; the only source with regions.
   - *Nederland, Europa, buiten Europa*: stacked bars area vs reference (kerncijfers, available per wijk/buurt).
   - *Meest en minst divers*: Simpson index over the three parts (chance that two random inhabitants differ in herkomst), top 5 and bottom 5. One number for "mix", not three maps.
4. **Criminaliteit**
   - *Misdrijven per 1.000*: KPI vs reference plus change vs 2024.
   - *Soorten misdrijven*: top 6 of the 8 non-overlapping categories per 1,000 (geweld already holds bedreiging and straatroof).
   - *Veiligst en minst veilig*: 5 lowest and 5 highest rates.
5. **Opleiding**
   - *Opleidingsmix*: low/middle/high stacked, area vs reference.
   - *Hoogst en laagst opgeleid*: top 5 / bottom 5 share hbo/wo.
   - *Opleiding en inkomen*: scatter with Pearson r; shows the strongest relation in the data set in one glance.
6. **Welvaart & wonen**
   - *Inkomen*: KPI vs reference above an income histogram.
   - *WOZ en eigendom*: WOZ KPI, koop/huur stacked bars, bijstand per 1,000.
   - *Bouwperiode*: voor 1945 / 1945–2004 / 2005+ (PC4 estimate) and built in the last 10 years.

A panel whose data is missing for the scope shows "Niet beschikbaar voor dit
niveau" and keeps its grid cell. The crime-mode toggle and per-dataset bar
charts are gone: the map and the Ranglijst already rank every layer.

## Jouw dashboard (W19, 15 Nov 2026)

Operator: after the wizard, offer a customised dashboard in an extra, blue tab.
Tabs "Algemeen" | "Jouw dashboard" (state `dtab`, hash `dtab=jouw`, shareable
under Weergave). Same 6 × 3 grid and panel components; layout from
`personalDashboardSpec(answers, preset)` (`modules/dashboard-personal.js`).

| Row | When | Panels |
|---|---|---|
| Jouw woonplek | always first | Jouw top 10 (match %), Jouw score vs Standaard (rise / fall most), Wat jij belangrijk vindt (weight per theme) |
| Veiligheid · jouw punten | chips, or vervoer fiets/auto | your crime types: top 10 vs average, best 5 + your top 5, Misdrijven totaal |
| Levenstype | levenstype chosen | type metrics (gezin: kids, school, kinderopvang; solo onder de mensen: horeca, density, centre, single; solo rustig: water, quiet; student/stel/50+/senior: age band, care) + an Algemeen age panel |
| Wonen en budget | budget or bouwstijl | koop with ceiling: share of areas within budget + WOZ histogram, your matches within budget, bouwstijl of your top 10 (or WOZ en eigendom); huur: rental share |
| Vervoer en sfeer | vervoer ov/fiets/lopen/auto or sfeer | station, bike theft, shops/GP, horeca/density/centre: top 10 vs average, best 5, distribution |
| Jouw situatie | opt-in opleiding / inkomen | your education level share, income near your band, Opleidingsmix or Inkomen |
| Nabijheid gemeenschap | opt-in only | highest shares of your chosen group (never lowest), your top 10 vs average, per wereldregio |

Rows 2–6 are ordered by the importance given in the wizard; skipped or "Niet
belangrijk" categories fall back to Algemeen rows (Leeftijd, Criminaliteit,
Opleiding, Welvaart & wonen, Voorzieningen). Herkomst is never a fallback.
