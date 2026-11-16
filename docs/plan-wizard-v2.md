# Plan: wizard v2, a shorter flow built on the levenstype profiles

Goal: the wizard has grown to 8 steps plus the importance sliders, and since
0.45.0 the levenstype profile already decides most of the weighting. Make the
profile the heart of the wizard: pick who you are, see what it fills in, adjust
only what differs, and get a result in 1 to 5 steps.
Status: **built in v0.46.0 (16 Nov 2026); see docs/decisions.md.**

## Problems in the current flow (0.45.0)

The current steps: Levenstype + Bouwstijl → Budget → Vervoer → Sfeer →
Dichtbij → Veiligheid → Situatie → Gemeenschap → result with importance sliders.

- **Step 1 mixes two questions.** It asks for the levenstype and the building
  style together, and building style is a luxury theme (0.45 addendum).
- **Overlap.** Sfeer (busy/quiet) and Dichtbij "Cafés en uitgaan" pull the
  same way, and so does the profile's busy/quiet direction. Vervoer "OV" and
  Dichtbij "Metro of tram" both mean OV. The profile already sets the crime mix
  that the Veiligheid chips set.
- **Optional steps come last.** Situatie and Gemeenschap now weigh heavily
  (30 and 20%), but they sit at the end as optional steps 7 and 8.
- **The defaults are invisible.** The profile fills things in, but the user
  does not see that until the importance screen.

## New flow (5 steps; only step 1 required)

1. **Wie ben je?** Profile cards instead of buttons. Each card shows the
   label, one line, and its 3 heaviest themes (from `PROFILES`). Under the
   cards: **[Direct naar resultaat]**, plus Volgende for the rest.
2. **Budget**: koop/huur and the amount, as it is now. Skippable.
3. **Hoe kom je ergens?** The Vervoer chips (fiets/OV/auto/lopen). Dichtbij
   "Metro of tram" moves here: the OV chip already means station plus
   metro/tram stop. The step also shows the "Treinstation" importance from
   Dichtbij.
4. **Je buurt**: the Sfeer slider plus the remaining Dichtbij items (uitgaan,
   winkels, cultuur, park, natuur) on one screen. Both are **pre-filled from
   the profile** and visibly marked "voorgesteld bij <profiel>":
   - Student: the slider at the busy end and uitgaan Belangrijk.
   - Gezin: rustig and park Belangrijk.
   - Senior: rustig and winkels Belangrijk.
   Changing a value removes the mark.
5. **Waar voel je je thuis? (optioneel)**: Situatie (inkomen, opleiding) and
   Gemeenschap (herkomst) on one step. Wording (operator, 16 Nov 2026; never
   "Mensen zoals jij", it sounds like pressure):
   - Intro: "Sommige mensen wonen graag tussen buren met een vergelijkbaar
     leven, of dicht bij hun eigen gemeenschap. Sla dit over als het voor jou
     niet uitmaakt."
   - Situatie heading "Buren met een vergelijkbaar inkomen of opleiding", hint
     "Kies je eigen inkomen of opleiding; buurten waar veel mensen in dezelfde
     situatie wonen, scoren hoger."
   - Gemeenschap heading "Dicht bij je eigen gemeenschap", hint "Woon je graag
     dicht bij mensen met dezelfde achtergrond, bijvoorbeeld voor je taal,
     winkels, een gebedshuis of familie? Buurten met een grote gemeenschap van
     jouw achtergrond krijgen extra punten; andere buurten verliezen niets."
   - "Waarom" line where it applies: "Grote gemeenschap uit <groep> in de
     buurt (18%, 2,5× gemiddeld)"
   - Result and breakdown labels: "Vergelijkbare buren" and "Eigen
     gemeenschap dichtbij".

   For the Nieuwkomer profile this step is suggested more
   strongly (opened by default), but **never filled in by the profile**: the
   origin group is always the user's own choice (the §5 guard).

**Result screen: "Bijstellen"** (instead of more steps):

- The theme importance sliders, as now, starting from the profile.
- Under Veiligheid, a "Specifieke zorgen" expander with the crime chips (×3, as
  now).
- "Extra wensen": the Bouwstijl choice (karakter/modern, at 5).
- Show every theme at 0 in the profile (Woningmarkt, Bouwstijl) as
  "Niet belangrijk", ready to switch on.

## Profiles (8 → 9)

- **Student/starter splits in two:**
  - **Student**: the current student column.
  - **Starter (werkt, eerste huis)**:
    - Themes: Veiligheid 20, Voorzieningen 30 (station 2, OV 2, supermarkt 2,
      GP 1), Welvaart 10, Opleiding 5, Levenstype 15 (25–44), Sfeer 20 druk.
- **New: Nieuwkomer in Nederland**:
  - Themes: Veiligheid 30, Voorzieningen 50 (supermarkt 2, OV 2, GP 2,
    school 1), Welvaart 5, Levenstype 5, Sfeer 10 (neutral, no direction).
  - Opens the "Waar voel je je thuis?" step (see step 5).
  - Hint: "Net in Nederland? Een gemeenschap van mensen met dezelfde
    achtergrond dichtbij kan veel steun geven; kies bij 'Waar voel je je thuis?' eventueel je herkomst."
- **The other profiles stay as in 0.45.0.** Keep the order of the cards by
  life course: Student, Starter, Stel, Gezin, Nieuwkomer, 50-plus, Senior, Solo
  onder de mensen, Solo op mezelf.

## Answers and links

- The answer fields and hash segments stay. Old links decode to the same
  answers. A new `prefilled` flag per field is local only and never goes into
  the hash; a hash value is always explicit.
- New levenstype codes: starter `t`, nieuwkomer `n`. Student stays `s`.
- Bouw and the crime chips keep their codes, only their place in the UI
  moves.
- The Vervoer OV chip takes over the Dichtbij `ov` item. An old hash with
  Dichtbij `o<level>` is still honoured. The UI shows it on the OV chip with
  that importance.

## Steps

1. Model (`wizard-model.js`, `presets.js`):
   - the new profiles and their codes;
   - `profileDefaults(levensfase)` → the suggested sfeer and dichtbij levels
     (pure);
   - the prefill/override logic: an explicit answer wins, a prefilled one
     follows the profile when the profile changes;
   - STEPS reordered to `['levensfase','budget','vervoer','buurt','buren']`,
     with the old step appliers kept and the new UI steps grouping them.
   - Tests: old hashes, prefill vs explicit, Nieuwkomer never sets an origin.
2. UI (`wizard.js`, `style.css`):
   - the cards with their top-3 themes;
   - "Direct naar resultaat";
   - the merged Buurt and Buren steps with the "voorgesteld" marks;
   - "Bijstellen" on the result screen with the Veiligheid expander and
     Extra wensen.
   - Must work at phone width (360 px) and with the keyboard (the existing
     wizard shortcuts).
3. Add an entry to `docs/decisions.md`; version 0.46.0.
