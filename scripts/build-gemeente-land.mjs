// Builds data/nl/herkomst-land-gemeente-<year>.json (v0.55.0, modules/herkomst-land.js):
// the share of inhabitants per single country (85458NED, 45 countries plus
// Nederlandse Cariben) per gemeente, latest year, one decimal, null when CBS
// leaves the cell empty.
//   node scripts/build-gemeente-land.mjs [--refresh]
// Reads the same 85458NED download as scripts/build-gemeente-regio.mjs from the
// raw archive (scripts/lib/raw-archive.mjs); --refresh fetches anew.
import { mkdir, writeFile } from 'node:fs/promises';
import { archivedJson, sourceForUrl } from './lib/raw-archive.mjs';
import { HERKOMST_TABLE, HERKOMST_YEAR, HERKOMST_TOTALS } from '../modules/herkomst.js';
import { LAND_FORMAT, LAND_COUNTRIES, encodeLand } from '../modules/herkomst-land.js';

const FEED = 'https://opendata.cbs.nl/ODataFeed/odata';
const OUT = new URL('../data/nl/', import.meta.url);

const getJson = url => archivedJson(sourceForUrl(url), url);
async function paged(url) {
  const rows = [];
  while (url) { const p = await getJson(url); rows.push(...(p.value ?? [])); url = p['odata.nextLink'] ?? null; }
  return rows;
}

const filter = `startswith(RegioS,'GM') and Geslacht eq '${HERKOMST_TOTALS.Geslacht}' and Leeftijd eq '${HERKOMST_TOTALS.Leeftijd}' and Geboorteland eq '${HERKOMST_TOTALS.Geboorteland}' and Perioden eq '${HERKOMST_YEAR}JJ00'`;
const rows = await paged(`${FEED}/${HERKOMST_TABLE}/TypedDataSet?${new URLSearchParams({ $filter: filter, $select: 'RegioS,Herkomstland,Bevolking_1', $format: 'json' })}`);
const regios = await paged(`${FEED}/${HERKOMST_TABLE}/RegioS?$format=json`);
const names = new Map(regios.map(r => [String(r.Key).trim(), String(r.Title).trim()]));

const body = encodeLand(rows);
const present = new Set(rows.map(r => String(r.Herkomstland).trim()));
const absent = LAND_COUNTRIES.filter(c => !present.has(c.code));
if (absent.length) throw new Error(`85458NED lacks ${absent.map(c => c.label).join(', ')}`);
const nulls = body.values.flat().filter(v => v == null).length;
const gm = body.codes.indexOf('GM0599');
console.log(`gemeenten ${body.codes.length}, countries ${body.countries.length}, empty cells ${nulls}`);
console.log(`Rotterdam: ${LAND_COUNTRIES.map((c, j) => `${c.label} ${body.values[gm]?.[j]}`).join(', ')}`);

const file = {
  format: LAND_FORMAT, table: HERKOMST_TABLE, year: HERKOMST_YEAR, built: new Date().toISOString().slice(0, 10),
  source: `CBS ${HERKOMST_TABLE} (${HERKOMST_YEAR}, 1 januari, per gemeente, herkomstland; aandeel van alle inwoners, % met 1 decimaal)`,
  labels: LAND_COUNTRIES.map(c => c.label),
  names: body.codes.map(c => names.get(c) ?? c),
  ...body,
};
await mkdir(OUT, { recursive: true });
const name = `herkomst-land-gemeente-${HERKOMST_YEAR}.json`;
const text = JSON.stringify(file);
await writeFile(new URL(name, OUT), text);
console.log(`${name}: ${(text.length / 1e3).toFixed(1)} kB`);
