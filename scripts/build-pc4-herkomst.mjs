// Builds the postcode-estimated herkomst data in data/nl/ (v0.25.0, docs/plan-herkomst-pc4.md):
//   pc4-gwb-2023.json        — crosswalk: per PC4 its buurten (2023) with address counts
//   herkomst-pc4-2023.json   — migration background per buurt / wijk / gemeente,
//                              83503NED per postcode split by address share
// Sources:
//   CBS 83503NED "Bevolking; geslacht, migratieachtergrond, viercijferige postcode, 1 januari"
//     (ODataFeed, paged with odata.nextLink; 2023JJ00, Geslacht totaal)
//   CBS "pc6huisnr" 2023 (https://download.cbs.nl/postcode/2023-cbs_pc6huisnr.zip,
//     pc6hnr20230801_gwb.csv: PC6;Huisnummer;Buurt2023;Wijk2023;Gemeente2023)
// The zip (22 MB) and CSV (254 MB) are never committed: they go to .cache/pc4/
// (gitignored), or pass an extracted CSV:
//   node scripts/build-pc4-herkomst.mjs [path/to/pc6hnr20230801_gwb.csv]
//   PC6_CSV=path node scripts/build-pc4-herkomst.mjs
// Needs network for 83503NED (and the zip without a CSV path); `unzip` on PATH.
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { archivedJson, archivedFile, sourceForUrl, firstPathArg, REFRESH } from './lib/raw-archive.mjs';
import { createCrosswalk, addAddresses, crosswalkToJson, allocate, rollUp, pc4ToArea, PC4_YEAR } from '../modules/postcode.js';
import { MA, PC4_HERKOMST_TABLE, PC4_HERKOMST_FORMAT, PC4_COLUMN_KEYS, pc4CountsFromRows, encodePc4Level, validatePc4, GM_EQUIV_KEYS } from '../modules/herkomst-pc4.js';

const FEED = 'https://opendata.cbs.nl/ODataFeed/odata';
const ZIP_URL = `https://download.cbs.nl/postcode/${PC4_YEAR}-cbs_pc6huisnr.zip`;
const CSV_NAME = 'pc6hnr20230801_gwb.csv';
const OUT = new URL('../data/nl/', import.meta.url);
const CACHE = new URL('../.cache/pc4/', import.meta.url);

// Every download goes through the raw archive (scripts/lib/raw-archive.mjs): the newest
// archived copy is reused, --refresh fetches anew.
const getWithRetry = url => archivedJson(sourceForUrl(url), url);

async function cbsRows() {
  const keys = Object.values(MA);
  const filter = `Perioden eq '${PC4_YEAR}JJ00' and Geslacht eq 'T001038' and startswith(Postcode,'PC') and (${keys.map(k => `Migratieachtergrond eq '${k}'`).join(' or ')})`;
  let url = `${FEED}/${PC4_HERKOMST_TABLE}/TypedDataSet?${new URLSearchParams({ $filter: filter, $select: 'Postcode,Migratieachtergrond,Bevolking_1', $format: 'json' })}`;
  const rows = [];
  while (url) {
    const page = await getWithRetry(url);
    rows.push(...(page.value ?? []));
    url = page['odata.nextLink'] ?? null;
    process.stdout.write(`\r${PC4_HERKOMST_TABLE}: ${rows.length} rows   `);
  }
  process.stdout.write('\n');
  return rows;
}

async function csvPath() {
  const given = firstPathArg() ?? process.env.PC6_CSV;
  if (given) return given;
  const csv = new URL(CSV_NAME, CACHE);
  if (existsSync(csv) && !REFRESH) return csv.pathname;
  await mkdir(CACHE, { recursive: true });
  const zip = await archivedFile(sourceForUrl(ZIP_URL), ZIP_URL);   // the zip lives in the raw archive; only the CSV is unpacked here
  execFileSync('unzip', ['-o', zip, CSV_NAME, '-d', CACHE.pathname], { stdio: 'inherit' });
  return csv.pathname;
}

/** Streams the CSV: one address per line → crosswalk of address counts per (PC4, buurt). */
async function readCrosswalk(path) {
  const cw = createCrosswalk();
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let n = 0, col = null;
  for await (const line of rl) {
    const f = line.split(';').map(s => s.replace(/^"|"$/g, '').trim());
    if (!col) { col = { pc6: f.indexOf('PC6'), bu: f.indexOf(`Buurt${PC4_YEAR}`) }; continue; }
    addAddresses(cw, f[col.pc6].slice(0, 4), f[col.bu], 1);
    if (++n % 1e6 === 0) process.stdout.write(`\rcrosswalk: ${n / 1e6}M addresses   `);
  }
  process.stdout.write(`\rcrosswalk: ${n} addresses, ${cw.size} postcodes\n`);
  return cw;
}

const readJson = async name => JSON.parse(await readFile(new URL(name, OUT), 'utf8'));
const bare = c => c.slice(2);

const [rows, cw, buurten25, wijken25] = await Promise.all([
  cbsRows(), csvPath().then(readCrosswalk), readJson('buurten-2025.json'), readJson('wijken-2025.json'),
]);
const known = { buurt: new Set(buurten25.codes.map(bare)), wijk: new Set(wijken25.codes.map(bare)) };
const names25 = { buurt: new Map(buurten25.codes.map((c, i) => [bare(c), buurten25.names[i]])), wijk: new Map(wijken25.codes.map((c, i) => [bare(c), wijken25.names[i]])) };

// ── Allocation ───────────────────────────────────────────────────────────────
const pc4Counts = pc4CountsFromRows(rows);
const { byBuurt, unallocated } = allocate(pc4Counts, cw);
const byWijk = rollUp(byBuurt, 'wijk');
const byGemeente = rollUp(byBuurt, 'gemeente');
const sum = o => Object.values(o).reduce((s, v) => s + (v.total ?? 0), 0);
console.log(`inhabitants: CBS ${sum(pc4Counts)} = allocated ${Math.round(sum(byBuurt))} + no crosswalk ${Math.round(unallocated.total ?? 0)}`);

const keep = (counts, prefix, set) => Object.fromEntries(Object.entries(counts).filter(([c]) => !set || set.has(c)).map(([c, v]) => [prefix + c, v]));
const levels = {
  buurt: encodePc4Level(keep(byBuurt, 'BU', known.buurt)),
  wijk: encodePc4Level(keep(byWijk, 'WK', known.wijk)),
  gemeente: encodePc4Level(keep(byGemeente, 'GM', null)),
};
const sources = {
  herkomst: `CBS ${PC4_HERKOMST_TABLE} (${PC4_YEAR}, 1 januari, per viercijferige postcode)`,
  indeling: `CBS pc6huisnr ${PC4_YEAR} (adressen per postcode en buurt ${PC4_YEAR})`,
  method: 'verdeeld naar adressen per postcode; codes in 2025-notatie, alleen gebieden die ook in de indeling 2025 bestaan',
};
// Validation (v0.28.0): the estimate summed per gemeente vs the official 85458NED counts of the same year.
async function officialGemeente() {
  const f = `startswith(RegioS,'GM') and Geslacht eq 'T001038' and Leeftijd eq '10000' and Geboorteland eq 'T001638' and Perioden eq '${PC4_YEAR}JJ00'`;
  let url = `${FEED}/85458NED/TypedDataSet?${new URLSearchParams({ $filter: f, $select: 'RegioS,Herkomstland,Bevolking_1', $format: 'json' })}`;
  const by = {};
  while (url) {
    const page = await getWithRetry(url);
    for (const r of page.value ?? []) { const k = String(r.Herkomstland).trim(); if (GM_EQUIV_KEYS.includes(k)) (by[String(r.RegioS).trim()] ??= {})[k] = r.Bevolking_1; }
    url = page['odata.nextLink'] ?? null;
  }
  return by;
}
sources.validation = validatePc4(levels.gemeente, await officialGemeente());
for (const [g, v] of Object.entries(sources.validation.groups)) console.log(`validation ${g.padEnd(12)} est ${v.est} / CBS 85458NED ${v.cbs} = ${v.ratio}, corr ${v.corr}`);
const built = new Date().toISOString().slice(0, 10);
const herkomst = { format: PC4_HERKOMST_FORMAT, year: PC4_YEAR, built, sources, groups: PC4_COLUMN_KEYS, levels };

// ── Crosswalk file: names only for the areas a postcode search lands on ──────
const xw = crosswalkToJson(cw, { built, sources: { indeling: sources.indeling } });
const usedBuurt = new Set(), usedWijk = new Set();
for (const pc of cw.keys()) {
  const bu = pc4ToArea(cw, pc, 'buurt', { accept: c => known.buurt.has(c) });
  if (bu) { usedBuurt.add(bu); continue; }
  const wk = pc4ToArea(cw, pc, 'wijk', { accept: c => known.wijk.has(c) });
  if (wk) usedWijk.add(wk);
}
xw.names = xw.buurten.map(c => (usedBuurt.has(c) ? names25.buurt.get(c) ?? null : null));
xw.wijkNames = Object.fromEntries([...usedWijk].sort().map(c => [c, names25.wijk.get(c) ?? null]));
xw.unmatched = { buurt: xw.buurten.filter(c => !known.buurt.has(c)), wijk: [...new Set(xw.buurten.map(c => c.slice(0, 6)))].filter(c => !known.wijk.has(c)).sort() };

await mkdir(OUT, { recursive: true });
for (const [name, obj] of [[`herkomst-pc4-${PC4_YEAR}.json`, herkomst], [`pc4-gwb-${PC4_YEAR}.json`, xw]]) {
  const text = JSON.stringify(obj);
  await writeFile(new URL(name, OUT), text);
  console.log(`${name}: ${(text.length / 1e6).toFixed(2)} MB`);
}
const cover = (lvl, list) => `${levels[lvl].codes.length} of ${list.length}`;
console.log(`coverage 2025: buurten ${cover('buurt', buurten25.codes)}, wijken ${cover('wijk', wijken25.codes)}; gemeenten ${levels.gemeente.codes.length}`);
console.log(`check: Suriname PC3011 = ${pc4Counts['3011']?.suriname}`);
