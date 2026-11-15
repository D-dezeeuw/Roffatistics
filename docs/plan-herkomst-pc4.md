# Plan: detailed herkomst per wijk and buurt via postcode (v0.25.0)

Goal: detailed origin groups (Suriname, Turkije, Marokko, …) at wijk and buurt
level, estimated from CBS 4-digit postcode data for 2023, plus a postcode
utility. Status: **built 15 Nov 2026**, see `docs/decisions.md`.

## Sources (verified 15 Nov 2026)

- **CBS 83503NED** "Bevolking; geslacht, migratieachtergrond, viercijferige
  postcode, 1 januari; 1998–2023". Dimensions Geslacht (totaal `T001038`),
  Migratieachtergrond, Postcode (`PC3011` padded with spaces; 4,075 PC + `NL01`),
  Perioden `2023JJ00`; measure `Bevolking_1`. Values rounded to 5; small cells
  null. Read through the ODataFeed (`odata.nextLink`; the ODataApi refuses
  >10k rows). Sample: Suriname 2023 PC3011 = 1015.
  Groups used: `T001040` totaal, `H008751` Suriname, `H008766` Turkije,
  `H008673` Marokko, `H007119` (voorm.) Ned. Antillen en Aruba, `H008632`
  Indonesië, `H008718` Polen, `H008592` Duitsland, `H008552` België, `H007933`
  Europa excl. NL, `H007935` EU excl. NL, `H008531` Oceanië. In this (old)
  indeling Turkije sits under Europa (NL totals: continents add up to "met
  migratieachtergrond"; Europa − EU = 838k ≥ Turkije 444k), so "Europa buiten de
  EU" = Europa − EU − Turkije.
- **CBS pc6huisnr 2023**: `https://download.cbs.nl/postcode/2023-cbs_pc6huisnr.zip`
  (22 MB) → `pc6hnr20230801_gwb.csv` (254 MB, 7.9M addresses,
  `PC6;Huisnummer;Buurt2023;Wijk2023;Gemeente2023`). Downloaded to `.cache/pc4/`
  (gitignored) or passed as a path; never committed.
- Our NL data uses 2025 codes (`BU00140000`, `WK001400`). Join by code; 2025
  areas without a 2023 match get no data, never a guess.

## Steps

1. `modules/postcode.js` (pure, unit-tested): `normalizePc4`, crosswalk of
   address counts per (PC4, buurt 2023), `areasForPc4`, `pc4ToArea` (dominant
   by addresses), `pc4sForArea`, `allocate` (conserves totals), `rollUp` to wijk
   (first 6 characters) / gemeente (first 4). Works with and without BU/WK/GM.
2. `scripts/build-pc4-herkomst.mjs` → `data/nl/pc4-gwb-2023.json` (crosswalk,
   names only for search targets, list of 2023 codes without a 2025
   counterpart) and `data/nl/herkomst-pc4-2023.json` (per level, column-wise,
   2025-notation codes, one count array per group plus total). Each file well
   under 1.5 MB.
3. App, loaded on demand only (`modules/herkomst-pc4.js`):
   a. herkomst layers per wijk/buurt (Rotterdam and the NL drill-down) for the
      ten groups as share of inhabitants, "geschat via postcode, 2023", INFO and
      an Uitleg section on method and limits;
   b. wizard Gemeenschap: the detailed groups the postcode data has also count
      per wijk/buurt (same `hk_<group>` keys as the gemeente data), every §5
      guard kept; new detailed groups Polen, Duitsland, België (`pl`/`de`/`be`);
   c. area modal: "Herkomst per land (geschat)" block with the note;
   d. search: a postcode (4 digits, optional letters) jumps to the buurt with
      most addresses (fallback wijk, then gemeente).
4. Tests: `tests/postcode.test.js`, `tests/herkomst-pc4.test.js` (helpers,
   built files, search item), `tests/gemeenschap.test.js` (guards for the new
   keys, hash round-trips, fuzz). README, decisions, version 0.25.0.

## Limits (shown in the Uitleg)

Same mix assumed across a postcode area; addresses are not inhabitants
(offices count); CBS rounding to 5 and suppressed cells (counted as 0); shares
hidden below 50 estimated inhabitants; 2023 indeling and peildatum; old
"migratieachtergrond" indeling, not identical to the newer herkomst figures.

## Validation against 85458NED (v0.28.0)
The estimate summed per gemeente is compared with the official 85458NED counts of the same year (2023) by `scripts/build-pc4-herkomst.mjs`; the result is stored in `herkomst-pc4-2023.json` → `sources.validation` and asserted by `tests/herkomst-regio.test.js` against `PC4_VALIDATION` (quoted in the Uitleg). 342 gemeenten, correlation ≥ 0.997 per column. Ratios estimate/official: total 1.00, Suriname 0.995, Turkije 0.998, Marokko 0.999, Polen 0.997, Nederlandse Cariben 0.957, Indonesië 0.961, Duitsland 0.96, België 0.90, Europa buiten de EU 1.07, Oceanië 0.78; rests Europa 1.016, Afrika 0.969, Amerika 0.911, Azië 0.926 (83503's "migratieachtergrond" and 85458's "herkomstland" differ slightly in definition for small groups). Spot check by the orchestrator: Rotterdam Suriname 51,755 estimated vs 51,838 official.

The file also stores four rest columns (`europaRest`, `afrikaRest`, `amerikaRest`, `azieRest`) so the world regions of `modules/herkomst-regio.js` exist per wijk/buurt with the same country → region table as per gemeente; regions without a named postcode country stay empty below gemeente level.
