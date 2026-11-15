// Builds data/nl/herkomst-regio-gemeente-<year>.json (v0.28.0, modules/herkomst-regio.js):
// inhabitants per world region per gemeente from CBS 85458NED (latest year),
// a region = the sum of its named countries, each werelddeel's rest as "Overig".
//   node scripts/build-gemeente-regio.mjs
// Needs network (CBS ODataFeed, paged with odata.nextLink).
import { mkdir, writeFile } from 'node:fs/promises';
import { HK, HERKOMST_TABLE, HERKOMST_YEAR, HERKOMST_TOTALS } from '../modules/herkomst.js';
import { REGIO_FORMAT, REGIONS, REGIO_FETCH_KEYS, gemeenteCountsFromRows, encodeRegio, regionCounts, regionGap, regionComposition } from '../modules/herkomst-regio.js';

const FEED = 'https://opendata.cbs.nl/ODataFeed/odata';
const OUT = new URL('../data/nl/', import.meta.url);

async function getJson(url, tries = 4) {
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
async function paged(url) {
  const rows = [];
  while (url) { const p = await getJson(url); rows.push(...(p.value ?? [])); url = p['odata.nextLink'] ?? null; process.stdout.write(`\r${rows.length} rows   `); }
  process.stdout.write('\n');
  return rows;
}

const filter = `startswith(RegioS,'GM') and Geslacht eq '${HERKOMST_TOTALS.Geslacht}' and Leeftijd eq '${HERKOMST_TOTALS.Leeftijd}' and Geboorteland eq '${HERKOMST_TOTALS.Geboorteland}' and Perioden eq '${HERKOMST_YEAR}JJ00'`;
const rows = await paged(`${FEED}/${HERKOMST_TABLE}/TypedDataSet?${new URLSearchParams({ $filter: filter, $select: 'RegioS,Herkomstland,Bevolking_1', $format: 'json' })}`);
const regios = await paged(`${FEED}/${HERKOMST_TABLE}/RegioS?$format=json`);
const names = new Map(regios.map(r => [String(r.Key).trim(), String(r.Title).trim()]));

const by = gemeenteCountsFromRows(rows.filter(r => REGIO_FETCH_KEYS.includes(String(r.Herkomstland).trim())));
const body = encodeRegio(by);

// Checks: every gemeente an exact partition; no missing cells.
let gaps = 0, missing = 0;
for (const [code, counts] of Object.entries(by)) {
  const rc = regionCounts(counts);
  if (!rc) { missing++; continue; }
  if (REGIONS.some(r => rc[r.key] == null)) missing++;
  else if (regionGap(rc) !== 0) { gaps++; console.warn(`gap ${code}: ${regionGap(rc)}`); }
}
const nl = body.total.reduce((a, b) => a + b, 0);
const regionTotals = Object.fromEntries(REGIONS.map(r => [r.key, body.cols[r.key].reduce((a, b) => a + (b ?? 0), 0)]));
console.log(`gemeenten ${body.codes.length}, inhabitants ${nl}, partition gaps ${gaps}, gemeenten with a missing cell ${missing}`);
for (const r of REGIONS) console.log(`  ${r.label.padEnd(28)} ${String(regionTotals[r.key]).padStart(9)}  ${(regionTotals[r.key] / nl * 100).toFixed(2)}%`);
if (gaps) throw new Error('regions do not partition the total');

const built = new Date().toISOString().slice(0, 10);
const file = {
  format: REGIO_FORMAT, table: HERKOMST_TABLE, year: HERKOMST_YEAR, built,
  sources: {
    herkomst: `CBS ${HERKOMST_TABLE} (${HERKOMST_YEAR}, 1 januari, per gemeente, herkomstland)`,
    method: 'regio = som van de landen die CBS apart levert (VN-indeling M49); rest van een werelddeel = werelddeel min die landen ("Overig"); Nederland + regio\'s + onbekend = totaal',
    check: { gemeenten: body.codes.length, partitionGaps: gaps, missingCells: missing, inhabitants: nl },
    composition: Object.fromEntries(REGIONS.map(r => [r.key, regionComposition(r.key)])),
  },
  regions: REGIONS.map(r => r.key),
  names: body.codes.map(c => names.get(c) ?? c),
  ...body,
};
await mkdir(OUT, { recursive: true });
const name = `herkomst-regio-gemeente-${HERKOMST_YEAR}.json`;
const text = JSON.stringify(file);
await writeFile(new URL(name, OUT), text);
console.log(`${name}: ${(text.length / 1e3).toFixed(1)} kB; check Rotterdam total ${by.GM0599?.[HK.total]}`);
