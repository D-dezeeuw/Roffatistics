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
