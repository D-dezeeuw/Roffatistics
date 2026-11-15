// Builds the Nederland drill-down data in data/nl/:
//   wijken-2025.json   — every NL wijk  (raw metrics, column-wise)
//   buurten-2025.json  — every NL buurt (raw metrics, column-wise)
// Sources (CBS ODataFeed, paged with odata.nextLink; the ODataApi refuses > 10,000 rows):
//   86165NED Kerncijfers wijken en buurten 2025, per-field fallback 85984NED (2024)
//   86270NED Nabijheid voorzieningen 2025,       per-field fallback 86134NED (2024)
//   85618NED (2023) — avgIncome only, where 2025 and 2024 have none
//   47018NED (dataderden, politie) geregistreerde misdrijven 2025 + total 2024 (trend)
//   86165NED/WijkenEnBuurten — names of the 2025 indeling
// The rows are mapped with the same pure helpers as the Rotterdam loader
// (areas.js), so a NL area carries the same value keys. Nothing preset-specific
// is stored: crime rates and the Woonscore are computed in the browser.
// Woningvoorraad, niet-woningvoorraad and bedrijfsvestigingen (86165NED) are
// stored as counts for the woongebied classification (modules/woongebied.js).
// Run: node scripts/build-nl-kwb.mjs   (needs network; ~2–4 minutes)
import { mkdir, writeFile } from 'node:fs/promises';
import {
  WIJK_TABLE, WIJK_FALLBACK_TABLE, WIJK_SELECT, NABIJ_TABLE, NABIJ_FALLBACK_TABLE, NABIJ_SELECT,
  CRIME_TABLE, CRIME_PERIOD, CRIME_PREV_PERIOD, CRIME_TOTAL, CRIME_COLUMN, CRIME_CATEGORIES,
  joinAreas, mergeCrime, normalizeAreaCode,
} from '../modules/areas.js';
import { encodeLevel, minPopulationFor, NL_DATA_YEAR, addIncomeFallback, INCOME_FALLBACK_TABLE, INCOME_FALLBACK_COLUMN } from '../modules/nl-areas.js';

const FEED  = 'https://opendata.cbs.nl/ODataFeed/odata';
const CRIME_FEED = 'https://dataderden.cbs.nl/ODataFeed/odata';
const OUT = new URL('../data/nl/', import.meta.url);
const PREFIX = { wijk: 'WK', buurt: 'BU' };

async function getWithRetry(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}

/** Every row of a feed query, following odata.nextLink. */
async function feed(base, table, entity, params) {
  let url = `${base}/${table}/${entity}?${new URLSearchParams({ ...params, $format: 'json' })}`;
  const rows = [];
  while (url) {
    const page = await getWithRetry(url);
    rows.push(...(page.value ?? []));
    url = page['odata.nextLink'] ?? null;
    process.stdout.write(`\r${table} ${entity} ${params.$filter?.slice(0, 40)}… ${rows.length} rows   `);
  }
  process.stdout.write('\n');
  return rows;
}

const kerncijfers = (table, prefix) => feed(FEED, table, 'TypedDataSet', { $filter: `startswith(WijkenEnBuurten,'${prefix}')`, $select: WIJK_SELECT });
const nabijheid   = (table, prefix) => feed(FEED, table, 'TypedDataSet', { $filter: `startswith(WijkenEnBuurten,'${prefix}')`, $select: NABIJ_SELECT });
const best = p => p.catch(err => { console.warn('\nskipped:', err.message); return []; });

// One query per (period, kind): 47018NED answers a combined or-filter over the
// national set with HTTP 500 ("Object reference not set…", 15 Nov 2026).
async function crime(prefix) {
  const kinds = [...new Set([CRIME_TOTAL, ...Object.values(CRIME_CATEGORIES).flat()])];
  const jobs = [...kinds.map(k => [CRIME_PERIOD, k]), [CRIME_PREV_PERIOD, CRIME_TOTAL]];
  const rows = [];
  for (const [period, kind] of jobs) {
    rows.push(...await feed(CRIME_FEED, CRIME_TABLE, 'TypedDataSet', {
      $filter: `startswith(WijkenEnBuurten,'${prefix}') and Perioden eq '${period}' and SoortMisdrijf eq '${kind}'`,
      $select: `WijkenEnBuurten,Perioden,SoortMisdrijf,${CRIME_COLUMN}`,
    }));
  }
  return rows;
}

async function buildLevel(level) {
  const prefix = PREFIX[level];
  const names = await feed(FEED, WIJK_TABLE, 'WijkenEnBuurten', { $filter: `startswith(Key,'${prefix}')`, $select: 'Key,Title' });
  const rows      = await kerncijfers(WIJK_TABLE, prefix);
  const oldRows   = await best(kerncijfers(WIJK_FALLBACK_TABLE, prefix));
  const nabijRows = await best(nabijheid(NABIJ_TABLE, prefix));
  const nabijOld  = await best(nabijheid(NABIJ_FALLBACK_TABLE, prefix));
  const crimeRows = await best(crime(prefix));
  const incomeRows = await best(feed(FEED, INCOME_FALLBACK_TABLE, 'TypedDataSet', { $filter: `startswith(WijkenEnBuurten,'${prefix}')`, $select: `WijkenEnBuurten,${INCOME_FALLBACK_COLUMN}` }));
  const features = names
    .map(n => ({ properties: { statcode: normalizeAreaCode(n.Key), statnaam: String(n.Title ?? '').trim() } }))
    .sort((a, b) => a.properties.statcode.localeCompare(b.properties.statcode));
  const areas = mergeCrime(addIncomeFallback(joinAreas(features, rows, oldRows, { rows: nabijRows, fallbackRows: nabijOld }), incomeRows), crimeRows, { minPopulation: minPopulationFor(level) });
  const data = encodeLevel(areas, {
    level, year: NL_DATA_YEAR, built: new Date().toISOString().slice(0, 10),
    sources: { kerncijfers: `${WIJK_TABLE} (fallback ${WIJK_FALLBACK_TABLE})`, nabijheid: `${NABIJ_TABLE} (fallback ${NABIJ_FALLBACK_TABLE})`, inkomen: `fallback ${INCOME_FALLBACK_TABLE}`, misdrijven: `${CRIME_TABLE} ${CRIME_PERIOD}` },
  });
  const file = new URL(`${level === 'wijk' ? 'wijken' : 'buurten'}-${NL_DATA_YEAR}.json`, OUT);
  const text = JSON.stringify(data);
  await writeFile(file, text);
  console.log(`${level}: ${areas.length} areas, ${Object.keys(data.cols).length} columns, ${(text.length / 1e6).toFixed(2)} MB → ${file.pathname}`);
}

await mkdir(OUT, { recursive: true });
for (const level of ['wijk', 'buurt']) await buildLevel(level);
