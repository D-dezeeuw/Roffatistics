# Plan: header opruimen, wizard compacter, eigen levenstype

Operator, 16 Nov 2026. Status: plan.

## A. Header en footer

- **Footer** krijgt alle informatieve knoppen: Uitleg, Over, Privacy en
  Sneltoetsen. Ze verdwijnen uit de header en uit het mobiele nav-menu (daar
  blijven ze bereikbaar via de footer; de sneltoets `?` blijft werken).
- **Header**, van links naar rechts: logo/scope … **Layers gecentreerd** … de
  overige actieknoppen … **Zoeken helemaal rechts**.
- Het **huis-icoon** (wizard) krijgt een zichtbaar label "Ideale woonplaats"
  (op smalle schermen mag het label wegvallen; aria-label blijft).
- Tests: de header bevat geen Uitleg/Over/Privacy/Sneltoetsen meer, de footer
  wel; zoeken is het laatste element; de huisknop heeft het label.

## B. Wizard stap 1 (levenstype)

- `.wiz-card-themes` niet meer zichtbaar; elke kaart krijgt een (i)-icoon met
  een tooltip (ook bij focus/tik, `aria-describedby`) met die inhoud
  (bijv. "Veiligheid 30 · Voorzieningen 25 · Sfeer 20").
- `LEVENSTYPE_HINT` en de per-levenstype regel (`wizard-model.js` ~202–230)
  staan niet meer als tekst onder de kaarten maar achter één (i)-icoon naast
  de vraag "Welk levenstype past het best bij jou?".
- Meer ruimte onder de titel "Vind jouw ideale woonplek · stap 1 van 5".

## C. Eigen levenstype ("Zelf samenstellen")

- Extra kaart naast de vaste levenstypes: **Zelf samenstellen**. Kiezen opent
  een lijst bouwstenen (checkboxes, meerdere tegelijk), elk een stukje van de
  bestaande profielen in `presets.js PROFILES`:
  Kinderen (basisscholen, kinderopvang, gezinnen), Levendig (horeca, centrum,
  dichtheid), Rustig (lage dichtheid, water, stilte), Groen & natuur,
  Ouder worden (huisarts, OV, supermarkt dichtbij), Veilig (zwaarder),
  Bereikbaar (station, OV).
- Het profiel = Standaard + per gekozen bouwsteen extra gewicht op zijn
  thema's en metrics (één gegevenstabel `BUILDING_BLOCKS` in presets.js; zelfde
  normalisatie als `resolvePreset`). Druk en rustig sluiten elkaar uit.
- Opslag en deellink zoals het levenstype nu (`wizard-model.js` hash-code
  `l…`): een nieuwe code `lc<bouwsteenletters>`; oude links blijven werken.
- Uitleg en `docs/algoritmes.md` beschrijven de bouwstenen en de formule.
- Tests: elke bouwsteen verandert alleen zijn eigen thema's, combinatie
  normaliseert, hash round-trip, druk+rustig niet tegelijk.

## D. Documentatie gelijktrekken

`plan-woonscore.md` §1–2 en de W1-beslissing als achterhaald markeren met
verwijzing naar `docs/algoritmes.md` en de v0.54.0-beslissing; Gemeenschap
standaard 20 % vastleggen; README zonder "herkomst Nederland"-laag.
