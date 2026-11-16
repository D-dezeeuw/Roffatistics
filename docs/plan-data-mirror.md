# Plan: own data mirror (backup, cache, later per-city bundles)

Goal: every figure and shape the app shows comes from our own server, not live
from CBS, PDOK or the police at page load. A raw archive of every source
download is kept as a backup. Later the mirror is normalised and chunked per
city, so that separate city versions (Rotterdam, Amsterdam, …) can be built
from it.
Status: **phase 1 steps 1–4 built 16 Nov 2026** (branch `w33-data-mirror`; the browser check with live fetch disabled is the batch's); plan from 16 Nov 2026 (operator request). The operator has lifted the
file-size limits for now.

## Today

Already static, in `data/`, built by `scripts/build-*.mjs`:

- the NL kerncijfers per buurt and wijk (`data/nl/*-2025.json`);
- the pc4 files;
- onderwijs;
- OV;
- the Rotterdam geometry;
- `buurt_2024.geojson`.

Still **live in the browser** (each one is a point of failure and adds latency;
cached in sessionStorage only):

| Module | Source | What |
|---|---|---|
| `areas.js` | `opendata.cbs.nl` ODataApi | Rotterdam kerncijfers wijk/buurt, gemeente names, fallbacks |
| `areas.js:556` | `dataderden.cbs.nl` | Politie misdrijven (47018NED) |
| `herkomst.js`, `herkomst-gemeente.js` | `opendata.cbs.nl` | herkomst Rotterdam / per gemeente |
| `nl-areas.js:212` | PDOK WFS gebiedsindelingen 2025 | wijk/buurt shapes per gemeente, on demand |
| `overlays.js` | PDOK WFS 2024 | overlay shapes |
| `p2000.js` | `randstad.hermes.blockworlds.nl` | live P2000; this stays live by nature |
| `map.js` | OpenFreeMap, PDOK luchtfoto | base map tiles; stay live (tiles, not data) |

## Layers

1. **Raw archive (backup)**: `/nebula/data/roffatistics/raw/<source>/<YYYY-MM-DD>/`
   on the host. It is outside git, because the raw files are large (the
   pc6huisnr zip alone is 22 MB, 254 MB unpacked).
   - Each download lands there unchanged.
   - A `manifest.json` per source records the URL, date, bytes and sha256.
   - The existing build caches (`.cache/duo`, `.cache/pc4`, …) read from and
     write to this archive. A rebuild never has to go back to the source
     unless asked (`--refresh`).
   - Backup of the archive itself: the host volume only (operator, 16 Nov);
     the sources can be downloaded again.
2. **Snapshot (what the app reads)**: `data/snapshot/`, normalised JSON in git,
   served by GitHub Pages and the Hermes copy, gzip from `server.js`.
   - Per source, one file per table and level.
   - Codes are in 2025 notation.
   - Files are column-wise, like `data/nl/*.json`, with a header (`sources`,
     `built`, `period`, source sha256).
   - Geometry: per gemeente, `data/snapshot/geo/2025/<GMxxxx>-{wijk,buurt}.json`
     (slimmed as `nl-areas.js` already does). These per-gemeente chunks are
     already the first step towards city bundles.
3. **One fetch layer in the app**: `modules/source.js` with `getSource(key)`.
   It reads the snapshot from our own origin first, and falls back to the live
   URL only when the snapshot file is missing. The modules above call it
   instead of building OData or WFS URLs themselves. The fallback stays
   behind a flag, so that a broken snapshot shows up in the smoke tests rather
   than being hidden.
4. **Refresh**: `npm run snapshot` (`scripts/snapshot-sources.mjs`).
   - It fetches all registered sources into the raw archive, rebuilds the
     snapshot, and prints a diff summary (rows and changed values per table).
   - It commits only when something changed, and the change goes out through
     the normal release.
   - Schedule: monthly on the host (cron, or a check-in), because CBS updates
     mostly yearly and the police monthly. The schedule is set up after the
     first manual run.
5. **City bundles (later, phase 2)**: `data/city/<slug>/`, for example
   `rotterdam` (GM0599) and `amsterdam` (GM0363). Each bundle holds:
   - that gemeente's wijken/buurten with every metric;
   - geometry, schools, OV and P2000 for that city;
   - its region (the surrounding gemeenten) for context;
   - one `manifest.json`.
   A `config/cities.json` (slug, gemeente code, name, centre, zoom, branding)
   drives the app, so a city version is a build or flag (`?city=` or a
   subdomain), not a fork. Roffatistics = the `rotterdam` config. Phase 2 also
   contains the normalisation pass: one area dimension table plus a fact table
   per source, and shared code lists, so that metrics are defined once.
6. **Shared data host (later, optional)**: once several city apps exist, the
   snapshot and city bundles move to their own forge app (for example
   `hermes/data-nl`) with CORS and long-lived cache headers, so that every app
   and city reads the same mirror. This is the operator's infra decision, after
   phase 2.

## Phase 1 steps (now)

1. Write `scripts/snapshot-sources.mjs` with a source registry. Each source
   has its key, URL builder, pagination (`odata.nextLink`), normaliser and
   output path.
   - Register every live CBS/PDOK query listed in the table above. Read the
     exact `$select`/`$filter` from the modules.
   - The raw archive with its manifest and sha256.
   - The Rotterdam CBS/police tables and herkomst, for wijk/buurt and the
     years the app uses.
   - Geometry for all 342 gemeenten (wijk and buurt, 2025).
   - The 2024 overlay.
2. Write `modules/source.js` (pure where possible, unit-tested). Switch
   `areas.js`, `herkomst*.js`, `nl-areas.js` and `overlays.js` over to it. The
   live fallback stays behind a flag.
3. Point the existing build scripts (`build-nl-kwb`, `build-schools`,
   `build-pc4-*`) at the raw archive for their downloads, so that one archive
   holds everything.
4. Tests:
   - the registry covers every runtime URL builder (a test that greps the
     modules for `odata`/`wfs` URL construction outside `source.js` and
     fails);
   - snapshot files parse and the codes exist;
   - with live fetch disabled, the app loads Rotterdam and one other gemeente
     (the browser check in the batch).
5. Add `README.md` (data section) and a `docs/decisions.md` entry.
   Version 0.47.0.

## Open

- ~~Offsite copy~~ Decided 16 Nov 2026 (operator): the host volume is enough;
  the sources (CBS, PDOK, DUO, police) can always be downloaded again.
- Which city comes second (Amsterdam?) and under what name/domain: decide at
  phase 2.
