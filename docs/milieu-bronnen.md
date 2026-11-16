# Milieu-lagen voor roffatistics: open bronnen (verkend 16 nov 2026)

"Verified" means a request on 16 Nov 2026 returned real data (HTTP 200 plus a feature, a raster or JSON).
"Per buurt" means the source already holds one value per CBS buurtcode.
"Buurt 2024" means the source uses the 2024 buurt codes, so it needs the 2024 to 2025 code mapping.

Base URLs:
- RIVM-ALO-WFS = `https://data.rivm.nl/geo/alo/wfs` (GeoServer; `outputFormat=application/json` works)
- RIVM-ALO-WCS = `https://data.rivm.nl/geo/alo/wcs` (WCS 2.0.1; the subset axes are `X`/`Y` in capitals, EPSG:28992)
- KEA-WFS = `https://cas.cloud.sogelink.com/public/data/org/gws/YWFMLMWERURF/kea_public/wfs`

Licence: RIVM Atlas Leefomgeving and Klimaateffectatlas are open government data (CC0 or CC-BY per layer; check the metadata page per layer before release). Amsterdam: CC-BY. Leefbaarometer: CC0.

## 1. Geluid (noise)

| Bron | Uitgever | Endpoint (verified) | Formaat | Eenheid | Dekking | Jaar | Aggregatie naar buurt 2025 |
|---|---|---|---|---|---|---|---|
| **Geluidhinder and slaapverstoring per buurt** (estimate from GGD Gezondheidsmonitor 2024 plus noise model) | RIVM / GGD'en | RIVM-ALO-WFS, typeName `alo:rivm_20251201_geluidhinder_bu_weg_2024`. Each `*_bu_*_2024` layer returns the same full attribute set (14 574 buurten) | WFS / GeoJSON | **per buurt** (buurt 2024) | NL | 2024 | Direct. Fields: `b_gel_weg`, `b_gel_gt50`/`lt50` (roads above/below 50 km/h), `b_gel_trei`, `b_gel_vv` (vliegverkeer), `b_gel_wtn` (windturbines), `b_gel_bu` (buren), `b_sv_*` (slaapverstoring), plus `b_tevr_wo` (tevreden woonomgeving), `b_tevr_gr` (groen), `b_verk_*` (verkoeling). All are % of adults. |
| Geluidhinder per buurt 2016/2020 | RIVM | RIVM-ALO-WFS, `alo:rivm_20230201_geluidhinder_bu_gt50_2020` and others (13 808 features) | WFS | per buurt (older codes) | NL | 2016, 2020 | Only for a trend; the old codes make it harder to match |
| **Geluidbelasting Lden, alle bronnen** | RIVM (Atlas Leefomgeving) | RIVM-ALO-WCS, CoverageId `alo__rivm_20250801_Geluid_lden_allebronnen_2022` (a 1 km tile download returned a 100×100 16-bit GeoTIFF) | WCS / GeoTIFF | 10 m grid | NL | 2022 | Share of addresses (BAG verblijfsobjecten with a woonfunctie) at ≥55 dB Lden; or the mean dB at addresses. The full NL raster is 26 400 × 31 200 px, so download it in tiles of about 5 km. |
| Lden per bron: weg 2022, trein 2023, vlieg 2022, industrie 2024, windturbines 2024; Lnight weg/trein | RIVM | RIVM-ALO-WCS: `alo__rivm_20250101_Geluid_lden_wegverkeer_2022`, `..._treinverkeer_2023`, `alo__rivm_20241201_Geluid_lden_vliegverkeer_2022`, `alo__rivm_20250801_Geluid_lden_industrie_2024`, `alo__rivm_20240301_geluid_Lden_windturbines_2024`, `..._Lnight_wegverkeer_2022`; also `*_actueel` aliases | WCS / GeoTIFF | 10 m | NL | 2022 to 2024 | Same method; Lnight ≥45 dB suits a "rustig slapen" layer |
| Geluidszones (zoning) Amsterdam | Gemeente Amsterdam | `https://api.data.amsterdam.nl/v1/geluidszones` (in the catalogue, not queried) | REST / WFS | polygons | Amsterdam | — | Weak: legal zones, not exposure |
| Rotterdam / Amsterdam strategic noise maps (EU-richtlijn) | gemeenten / EEA | not verified | mostly WMS or PDF | — | city | 2022 | Skip; the RIVM national raster covers the same ground |

## 2. Lucht (air quality)

| Bron | Uitgever | Endpoint | Formaat | Eenheid | Dekking | Jaar | Aggregatie |
|---|---|---|---|---|---|---|---|
| **GCN jaargemiddelde NO2, PM2.5, PM10, EC** | RIVM | RIVM-ALO-WCS: `alo__rivm_jaargemiddeld_NO2_actueel`, `..._PM25_actueel`, `..._PM10_actueel`, `..._EC_actueel`; yearly archive `alo__rivm_nsl_*_gm_NO2<jaar>` (GetCoverage verified 16 Nov 2026: 25 m grid, data year 2024; a whole-NL read is refused above 256 MB, 50 km tiles at scaleFactor 0.25 work) | WCS / GeoTIFF | 1 km GCN (the NSL versions go to 25 m near roads) | NL | "actueel" (check the year in the layer metadata; probably 2023 or 2024) | Address-weighted mean µg/m³. Compare against WHO 2021 (NO2 10, PM2.5 5). Differences between buurten are small at 1 km; road-side peaks drop out. |

## 3. Geur (odour)

| Bron | Uitgever | Endpoint | Formaat | Eenheid | Dekking | Jaar | Aggregatie |
|---|---|---|---|---|---|---|---|
| Geurhinder (industrie, landbouw, rwzi, houtkachel, vuurkorf, weg) | RIVM / GGD | RIVM-ALO-WFS `alo:rivm_20251201_geurhinder_gem_weg_2024` (342 gemeenten; the record also holds geluid fields `g_gel_*` and `g_geur_*`) | WFS | **per gemeente only** | NL | 2024 | Only for the Nederland view at gemeente level; there is no buurt version. Low priority. |

## 4. Hitte (heat stress)

| Bron | Uitgever | Endpoint | Formaat | Eenheid | Dekking | Jaar | Aggregatie |
|---|---|---|---|---|---|---|---|
| **Gevoelstemperatuur (PET) per buurt** | Klimaateffectatlas / TAUW, RIVM class | KEA-WFS `kea_public:GevoelstemperatuurBuurt_2022` (14 574 buurten; `buurtcode`, `PET_gem` °C, `RIVMClass`, `jaar` 2024 = buurt 2024) | WFS | **per buurt** | NL | PET map 2022, buurt 2024 | Direct, `PET_gem` |
| Klimaatdashboard buurt (PET classes, schaduw, groen/steen %, paalrot, grondwater, F18 health fields) | Klimaateffectatlas | KEA-WFS `kea_public:BD_buurtdashboard_20260312` (14 574) and `kea_public:RMK_BuurtAggregaties` (PET29–51+ shares, shade, BKB) | WFS | per buurt | NL | 2026 release | Direct. `P_schaduw_fw` (schaduw on footpaths), `Groen_PercLand` and the `PET51pluspAHN4` share are candidate layers. |
| Stedelijk hitte-eiland (UHI) | RIVM Atlas Natuurlijk Kapitaal | `https://data.rivm.nl/geo/ank/wcs`, `ank__Stedelijk_hitte_eiland_effect_01062022_v2` | WCS / GeoTIFF | 10 m | NL | 2022 | Raster mean; redundant next to PET per buurt |
| Verkoeling (% that can cool down indoors and outdoors) | RIVM / GGD | in every `*_bu_*_2024` WFS record (`b_verk_bi`, `b_verk_bu`) | WFS | per buurt | NL | 2024 | Direct |

## 5. Overstroming / water

| Bron | Uitgever | Endpoint | Formaat | Eenheid | Dekking | Jaar | Aggregatie |
|---|---|---|---|---|---|---|---|
| **Potentieel overstroombaar gebied** | BIJ12 via RIVM ALO | RIVM-ALO-WCS `alo__bij12_2025_potentieel_overstroombaar_gebied` (in capabilities) | WCS / GeoTIFF | grid | NL | 2025 | Share of addresses inside the area. Coarse: most of Rotterdam and Amsterdam is "potentially floodable", so the layer does little to tell buurten apart. |
| **LIWO maximale waterdiepte NL** (kaart 1 to 4 = probability classes) | Rijkswaterstaat (LIWO) | `https://geodata.basisinformatie-overstromingen.nl/geoserver/ows`, layers `LIWO_Basis:MaximaleWaterdiepteNederland_Kaart1..4` (WMS capabilities 9.9 MB; WCS capabilities answer but show 1 coverage, so it is unclear whether these layers can be downloaded) | WMS confirmed; WCS uncertain | 25 to 100 m | NL | 2023+ | Best substance (mean flood depth at addresses, for example the share above 0.5 m). **If it is WMS-only it is weak**: then use RGB GetMap tiles and a legend lookup, which is hacky. Check WCS first. |
| Risicogebieden ROR (EU Overstromingsrichtlijn) | RWS via PDOK | `https://service.pdok.nl/rws/overstromingen-risicogebied/wfs/v1_0`, type `overstromingen-risicogebied:risk_zone` | WFS | polygons | NL | 2019+ | Share of buurt area or of addresses in the zone; coarse |
| Bovenregionale stresstest wateroverlast (rain), waterdiepte | LIWO / KEA | LIWO WMS `LIWO_Basis:Bovenregionale_stresstest_wateroverlast_Waterdiepte` | WMS | grid | NL | — | WMS-only: weak |

## 6. Schoon / afval / overlast (litter, waste, nuisance)

| Bron | Uitgever | Endpoint | Formaat | Eenheid | Dekking | Jaar | Aggregatie |
|---|---|---|---|---|---|---|---|
| **Meldingen openbare ruimte (MORA/Signalen)** | Gemeente Amsterdam | `https://api.data.amsterdam.nl/v1/meldingen/meldingen/` (paged REST, `_count=true` works; `hoofdcategorie=Schoon` since 2025-01-01 = 153 345 records; fields `gbdBuurtCode` (Amsterdam's own code, e.g. MC04), `gbdBuurtId`, point geometry RD, `subcategorie`, `datumMelding`) | REST JSON (also WFS) | point plus Amsterdam buurt | **Amsterdam only** | 2018 to now | Count per 1 000 inhabitants per CBS buurt 2025 (point-in-polygon on the RD point; the Amsterdam code does not map 1:1 to CBS). Categories: Afval, Schoon, Overlast bedrijven en horeca, Overlast openbare ruimte, Overlast personen/groepen, Overlast van boten. Pull one year (about 500k records, 1 000 a page): a heavy build. |
| Overlastgebieden, huishoudelijk afval / containers | Gemeente Amsterdam | `https://api.data.amsterdam.nl/v1/overlastgebieden`, `.../huishoudelijkafval` (in the catalogue) | REST | polygons / points | Amsterdam | current | Optional |
| Rotterdam meldingen openbare ruimte / Wijkprofiel "schoon" | Gemeente Rotterdam | `https://data.rotterdam.nl` (Opendatasoft) answers, but a catalogue search for meldingen/schoon/geluid/afval returned nothing usable; `wijkprofiel.rotterdam.nl` gives **403** to scripts | — | — | Rotterdam | — | **Not found as open data.** Wijkprofiel has a "schoon" score per wijk, but only through the web UI or PDF. Manual export or an e-mail request to Onderzoek010 would be needed. |
| Leefbaarometer 3.x per buurt (dimensions incl. "fysieke omgeving", overlast/veiligheid) | BZK | 2020: `https://data.overheid.nl/sites/default/files/dataset/f37c3649-cc52-4e48-a864-870ae42807a2/resources/Leefbaarometer%203.0%20-%20meting%202020%20-%20scores%20buurt.csv` (listed in the data.overheid API). The 2022 and 2024 measurements: the leefbaarometer.nl "Open data" page is rendered by JavaScript and the guessed URLs return 404; the Zuid-Holland WFS has 2024 for ZH only | CSV | per buurt | NL | 2020 (2024 exists) | Direct. The dimension score "fysieke omgeving" is a composite of noise, flooding, heat and so on, so it overlaps with the layers above. A manual download of 2024 is needed. |

## 7. Licht, windturbines, groen

| Bron | Uitgever | Endpoint | Formaat | Eenheid | Dekking | Jaar | Aggregatie |
|---|---|---|---|---|---|---|---|
| **Lichtemissie (light pollution)** | RIVM | RIVM-ALO-WCS `alo__rivm_20241018_gm_lichtemissie2023` / `alo__rivm_lichtemissie_actueel` | WCS / GeoTIFF | raster (probably VIIRS-derived, about 100 to 500 m) | NL | 2023 | Address-weighted or area mean per buurt. "Donkerte" is relevant for highly sensitive users. |
| **Windturbines (locations)** | RIVM ALO (source RVO/Windstats) | RIVM-ALO-WFS `alo:rivm_20260101_windturbines_vermogen` (5 357 points: `kw`, `ash` ashoogte, `diam`, `land`) | WFS points | point | NL plus border area | Jan 2026 | Distance from the buurt centroid or addresses to the nearest turbine; number of turbines within 1 km. Hinder is already in `b_gel_wtn`. |
| Groen per buurt / Groenkaart 10 m | KEA buurtdashboard / RIVM ANK | KEA fields `Groen_PercLand`, `Groen_PerInwoner_m2`; `ank__rivm_20231221_groenkaart_10m_2022` | WFS / WCS | buurt / 10 m | NL | 2022 to 2026 | Direct from KEA |

## Recommended first set (6 layers)

All six are NL-wide, ready per buurt or easy to compute, and need no runtime API calls. Build with one script `scripts/build-nl-milieu.mjs` that writes `data/nl/milieu-buurt-2025.json` (aggregates to wijk and gemeente, as the other build-nl scripts do).

| # | Laag | Bron | Aanpak | Effort |
|---|---|---|---|---|
| 1 | **Geluidhinder wegverkeer (% ernstig gehinderd)** | RIVM WFS `geluidhinder_bu_weg_2024` | One WFS GET with `propertyName` (without geometry) gives 14 574 rows; map buurt 2024 to 2025; wijk = population-weighted mean | S (½ day) |
| 2 | **Slaapverstoring (weg + trein + vlieg + buren)** or a "stilte-index" = sum of the `b_gel_*` fields | the same record | Derived field; lower is better | S (included in 1) |
| 3 | **% adressen ≥55 dB Lden alle bronnen** | RIVM WCS 10 m 2022 | Download tiles of 5×5 km in RD (about 500 tiles NL, or only the tiles that contain addresses), sample at BAG address points (centroids of the woonfunctie verblijfsobjecten from PDOK BAG or CBS), compute the share ≥55 dB and the mean. Needs a GeoTIFF reader (`geotiff` npm) and a BAG address extract (a few hundred MB, build-time only). | L (2 to 3 days; the BAG extract is the bulk) |
| 4 | **Gevoelstemperatuur (PET) / hittestress** | KEA WFS `GevoelstemperatuurBuurt_2022` (+ `P_schaduw_fw` from the buurtdashboard) | WFS GET without geometry, direct per buurt | S (½ day) |
| 5 | **Luchtkwaliteit NO2 (and PM2.5)** | RIVM WCS GCN actueel | The raster is coarse (1 km): one WCS call per city, or about 4 calls for NL; mean per buurt from the buurt centroid or area-weighted. If layer 3 is built, reuse its address sampling. | M (1 day) |
| 6 | **Meldingen "Schoon/Afval" per 1 000 inwoners** | Amsterdam MORA API | **Amsterdam only**; page through the last 12 months of `hoofdcategorie` Afval+Schoon, point-in-polygon to CBS buurt 2025. Rotterdam has no open equivalent, so this layer is missing for Rotterdam and NL. | M (1 day; slow paging) |

Reserves: Lichtemissie 2023 (M, same raster pipeline as 5), windturbine distance (S), flood (LIWO WCS once checked; otherwise share of addresses in ROR risk_zone, M), Leefbaarometer 2024 "fysieke omgeving" (S once the CSV is in hand).

## Risks

- **Buurt codes 2024 vs 2025:** RIVM and KEA use buurt 2024 (14 574). For changed buurten a 2024 to 2025 mapping is needed (area overlay, or leaving them empty). Check how many 2025 codes have no match.
- **Model estimates, not measurements:** the hinder percentages are small-area estimates from the Gezondheidsmonitor (survey plus model). Say so in the "Uitleg", the same way as other modelled layers.
- **Raster aggregation cost:** the 10 m NL noise raster is about 1.6 GB uncompressed; the WCS can be slow or rate-limited. Cache the tiles under `data/snapshot` or a cache directory that is not committed; the build stays offline after the first run.
- **The flood layer tells buurten apart poorly** in polder cities, because almost everything is "potentially floodable". LIWO depth is meaningful but possibly WMS-only (weak; a legend-colour hack).
- **Coverage asymmetry:** meldingen exist only for Amsterdam; Rotterdam Wijkprofiel blocks scripts (403) and its open data portal has no meldingen. The layer has to be city-scoped (`scope=amsterdam`).
- **Meldingen measure reporting behaviour, not dirt:** more reports can mean more engaged residents. Normalise per inhabitant and explain this in the Uitleg.
- **Licence per layer:** confirm CC0 or CC-BY in the metadata of each RIVM/KEA layer and add source attribution in the UI.
- **Not verified:** WCS GetCoverage for the NO2, lichtemissie and BIJ12 coverages (only the geluid coverage was downloaded); the LIWO WCS coverages; the download URL of Leefbaarometer 2022/2024.
