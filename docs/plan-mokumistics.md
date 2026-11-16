# Plan: Mokumistics, one app with a city per domain

Goal: the same app, with Amsterdam as the second city under its own name,
look and subdomain. The URL decides which city and which brand is shown. There
is no fork: one codebase, one test suite, one data mirror.
Status: **plan, 16 Nov 2026 (operator request).** The data mirror phase 1
(0.46.0, `docs/plan-data-mirror.md`) is the base.

## Brand: Mokumistics

- **Name:** Mokumistics. Tab title: "Mokumistics — Amsterdam en Nederland in
  cijfers".
- **Slogan (splash and About):** "Liever in Mokum zonder poen, / dan in Parijs
  met een miljoen." (an old Amsterdam saying; operator, 16 Nov). The Danny de Munk lyric the operator suggested goes in only
  with the rights holder's permission. It is set as a short poem, one line per
  phrase, in italics.
- **Logo:**
  - Three bold black St Andrew's crosses (×), stacked vertically with some space
    between them, as in the city arms.
  - Drawn as our own simple SVG: square stroke ends, no shield.
  - `assets/cities/amsterdam/logo-mark.svg` and `logo.svg` (the mark plus the
    word "Mokumistics").
  - The favicon is a red tile with the white crosses.
  - The OG image comes from `build-og-image.mjs` with a city parameter.
- **Colours: the "Mokum" theme**
  - Red `#e30613`, black `#000000`, white `#ffffff`, as UI accents: header,
    buttons, focus ring and the active chip.
  - A light and a dark variant, as the Rotterdam theme has. The theme sets the
    tokens only; the components stay the same.
- **Map colours, palette "Mokum"**
  - The red in the brand must not make every red read as "bad", so good/bad
    stays red → green, the same as in Rotterdam. That keeps one meaning across
    cities.
  - The neutral ramp is grey → black.
  - Gemeenschappen stays indigo: origin is never coloured as good or bad (§5).
  - The outlier colour is magenta.
  - "Volgt thema": Mokum → the Mokum palette.
- **Disclaimer:** in About and the footer, "Geen website van de gemeente
  Amsterdam". The crosses are a city symbol, not the municipal logo, and we do
  not use the municipal house style or its font.

## How it works: a city config

1. **`config/cities.json`** (read through `modules/city.js`). Each city entry
   holds:
   - `slug`, `gemeente` (GM0599 / GM0363), `name`, `nickname`
     (Roffa / Mokum), `appName`, `slogan`;
   - `centre`, `zoom`, `bounds`;
   - `theme` (default UI theme), `palette`;
   - `logo` paths, `og` image, `canonical` URL;
   - `hosts` (hostnames), and the regional data that exists for the city
     (`ov`, `p2000`, `herkomstLocal`).
2. **Choosing the city** (pure, unit-tested):
   1. `?city=<slug>` (testing, GitHub Pages);
   2. the hostname from `hosts` (`mokumistics.hermes.blockworlds.nl` →
      amsterdam);
   3. otherwise rotterdam.
   The choice is kept in `<html data-city>` and is never stored, so two tabs
   can show two cities. Share links carry `city=` only when it differs from
   the host's default.
3. **Early boot:** an inline `<script>` in `index.html`, like the theme one,
   sets `data-city` and the theme before the first paint. `<title>`, the
   meta/OG tags, the favicon and the manifest are filled in from the config.
   For crawlers on the Hermes host, `server.js` writes the city's title and OG
   tags into `index.html` per host. On GitHub Pages, `?city=amsterdam` only
   changes things at runtime, which is enough for testing.
4. **Removing "Rotterdam" as a constant.** There are 147 mentions in 34
   modules, and 4–16 per module in app, datasets, areas, area-modal,
   rotterdam.js, explain, dashboard, wizard, search and list.
   - `rotterdam.js` → `city-scope.js`, with GM0599 → `city.gemeente`.
   - `MASK`/`ACCENT` come from the theme.
   - `map.js NL_CENTER` → `city.centre`.
   - Texts with "Rotterdam" / "Rotterdamse gemiddelde" → `city.name` /
     `cityAdjective` (`Rotterdamse` / `Amsterdamse`).
   - Storage keys `roffatistics.*` stay, so existing users keep their settings
     on the Rotterdam domain. The Mokumistics host has its own origin and
     therefore its own storage anyway.
   - A test greps the modules for `GM0599`/`Rotterdam` outside
     `config/cities.json` and the data, with an allowlist for comments and
     legal texts.

## Data for Amsterdam

| Part | Rotterdam today | Amsterdam |
|---|---|---|
| Kerncijfers, police, herkomst, Woonscore (NL-wide `data/nl`, snapshot) | ✓ | ✓ already NL-wide; the city tables (now Rotterdam-only in `snapshot/cbs`) get a GM0363 variant through the registry |
| Shapes wijk/buurt | `rotterdam_*.geojson` + snapshot | `snapshot/geo/2025/GM0363-{wijk,buurt}.json` already there; `build-rotterdam-geo` → `build-city-geo --city` |
| Onderwijs, school pins | NL-wide | ✓ works as it is |
| OV lines | RET metro/tram/bus (`data/ov/*-rotterdam.json`) | GVB metro/tram/ferry/bus from the same GTFS (OVapi, NL-wide) via `build-ov-lines --city amsterdam` → `data/ov/amsterdam/` |
| P2000 "Actueel" | Randstad, Rotterdam-Rijnmond only | **not available** for Amsterdam-Amstelland: the layer is hidden through `city.p2000 = false` until there is a source |
| Search | Rotterdam first | the city's own areas first |
| Wizard / Ranglijst | Rotterdam wijken | the city's wijken; the profiles stay the same |
| Stadsdelen | — | optional later: an overlay of the 7 stadsdelen + Weesp (open data from the gemeente Amsterdam) |

City bundles (`data/city/<slug>/`, phase 2 of the data-mirror plan) come in
here naturally: the city config points at its bundle.

## Hosting

- **Hermes:** a second forge app, `hermes/mokumistics`, at
  `mokumistics.hermes.blockworlds.nl`.
  - Same image and same `site/` as roffatistics, synced by the same script
    (`sync-roffatistics.sh` gets a second target, or there is a
    `sync-city.sh <app>`).
  - Its `hostname` is in `cities.json`, so no build flag is needed.
  - **Operator:** create the forge repo/app and the DNS/route the way new
    Hermes apps are made, then `/deploy mokumistics`.
- **GitHub Pages:** stays Roffatistics. `?city=amsterdam` works there for
  testing. A separate Pages site or a custom domain (e.g. mokumistics.nl) is
  for later, if wanted.

## Steps

1. **City config and refactor** (0.47.0). This step makes no visible change
   for Rotterdam.
   - Write `config/cities.json` and `modules/city.js`, with tests.
   - Replace the Rotterdam constants.
   - Rename `rotterdam.js` to `city-scope.js`.
   - The grep test.
   - Rotterdam behaves exactly as now: the full suite plus a browser check
     that the hashes and the output stay the same.
2. **Amsterdam data** (with step 1 or right after it):
   - snapshot registry entries for GM0363;
   - `build-city-geo` and `build-ov-lines --city amsterdam`;
   - P2000 off.
   - A data test: every Amsterdam wijk/buurt has kerncijfers and a shape, and
     the Woonscore is computed.
3. **Mokumistics brand** (0.48.0):
   - the logo SVGs, favicon and OG image;
   - the Mokum theme and palette (with contrast checks in the palette test);
   - the slogan on the splash and About;
   - the disclaimer;
   - per-host meta in `server.js`.
   - A browser check: `?city=amsterdam` shows the Amsterdam outline, the logo,
     red accents and the wizard top 10 from Amsterdam wijken.
4. **Hosting:**
   - the forge app (operator);
   - the sync script with the second target;
   - a forge-check, then `/deploy mokumistics`.
5. Add the README and a `docs/decisions.md` entry (one app, city per host).

## Open

- **Slogan source:** the lines are a song lyric by Danny de Munk (operator, 16
  Nov). A slogan is not a quotation under the citaatrecht, and a credit line
  does not make it allowed, so the lyric goes on the site only with written
  permission from the rights holder (the publisher, via Buma/Stemra). Until
  then the site uses an original slogan of our own. The text is a config
  field, so it can be swapped without code.
- **Domain:** is `mokumistics.hermes.blockworlds.nl` enough for now, or should
  it get its own domain later?
- **Amsterdam P2000:** Randstad only covers Rotterdam-Rijnmond. Hide the layer
  (planned), or look for an Amsterdam-Amstelland source later?
