// Builds data/nl/bouwjaar-pc4-2023.json (v0.29.0, modules/bouwjaar-pc4.js):
// dwellings in total, built before 1945 and built 2005 or later per buurt,
// wijk and gemeente, estimated from the CBS postcode statistics.
// Sources:
//   CBS "Gegevens per postcode" PC4 2023 (definitive, published 2026):
//     https://download.cbs.nl/postcode/2026-cbs_pc4_2023_vol.zip → cbs_pc4_2023_vol.gpkg
//     (columns aantal_woningen, aantal_woningen_bouwjaar_voor_1945 … _15_en_later)
//   the PC4 → buurt address crosswalk already in data/nl/pc4-gwb-2023.json
//     (CBS pc6huisnr 2023, built by scripts/build-pc4-herkomst.mjs)
// The zip (~12 MB) is never committed: it goes to .cache/pc4/ (gitignored) and
// is extracted into its own empty directory; or pass an extracted gpkg:
//   node scripts/build-pc4-bouwjaar.mjs [path/to/cbs_pc4_2023_vol.gpkg]
// Needs Node with node:sqlite (22.5+), `unzip` on PATH and network without a path.
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { archivedFile, sourceForUrl, firstPathArg, REFRESH } from './lib/raw-archive.mjs';
import { crosswalkFromJson, allocate, rollUp, PC4_YEAR } from '../modules/postcode.js';
import { BOUW_FORMAT, BOUW_SOURCE_URL, BOUW_CLASSES, BOUW_TOTAL_COLUMN, BOUW_GROUPS, OLD_BUILD_BEFORE, MODERN_BUILD_FROM, bouwCountsFromRows, encodeBouwLevel } from '../modules/bouwjaar-pc4.js';

const OUT = new URL('../data/nl/', import.meta.url);
const CACHE = new URL('../.cache/pc4/', import.meta.url);
const GPKG = `cbs_pc4_${PC4_YEAR}_vol.gpkg`;

async function gpkgPath() {
  if (firstPathArg()) return firstPathArg();
  const dir = new URL(`bouwjaar-${PC4_YEAR}/`, CACHE);
  const file = new URL(GPKG, dir);
  if (existsSync(file) && !REFRESH) return file.pathname;
  await mkdir(CACHE, { recursive: true });
  const zip = await archivedFile(sourceForUrl(BOUW_SOURCE_URL), BOUW_SOURCE_URL);   // the zip lives in the raw archive
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  execFileSync('unzip', ['-o', '-q', zip, GPKG, '-d', dir.pathname]);
  return file.pathname;
}

const readJson = async name => JSON.parse(await readFile(new URL(name, OUT), 'utf8'));
const bare = c => c.slice(2);

const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(await gpkgPath(), { readOnly: true });
const table = db.prepare("select table_name from gpkg_contents where data_type = 'features'").get().table_name;
const rows = db.prepare(`select postcode, ${[BOUW_TOTAL_COLUMN, ...Object.values(BOUW_CLASSES)].join(', ')} from "${table}"`).all();
db.close();
const [xwJson, buurten25, wijken25] = await Promise.all([readJson(`pc4-gwb-${PC4_YEAR}.json`), readJson('buurten-2025.json'), readJson('wijken-2025.json')]);
const cw = crosswalkFromJson(xwJson);
const known = { buurt: new Set(buurten25.codes.map(bare)), wijk: new Set(wijken25.codes.map(bare)) };

const pc4Counts = bouwCountsFromRows(rows);
const { byBuurt, unallocated } = allocate(pc4Counts, cw);
const byWijk = rollUp(byBuurt, 'wijk');
const byGemeente = rollUp(byBuurt, 'gemeente');
const sum = (o, k) => Object.values(o).reduce((s, v) => s + (v[k] ?? 0), 0);
for (const k of ['total', 'old', 'modern']) console.log(`${k.padEnd(6)}: CBS ${sum(pc4Counts, k)} = allocated ${Math.round(sum(byBuurt, k))} + no crosswalk ${Math.round(unallocated[k] ?? 0)}`);

const keep = (counts, prefix, set) => Object.fromEntries(Object.entries(counts).filter(([c]) => !set || set.has(c)).map(([c, v]) => [prefix + c, v]));
const levels = {
  buurt: encodeBouwLevel(keep(byBuurt, 'BU', known.buurt)),
  wijk: encodeBouwLevel(keep(byWijk, 'WK', known.wijk)),
  gemeente: encodeBouwLevel(keep(byGemeente, 'GM', null)),
};
const built = new Date().toISOString().slice(0, 10);
const out = {
  format: BOUW_FORMAT, year: PC4_YEAR, built,
  sources: {
    bouwjaar: `CBS Gegevens per postcode, PC4 ${PC4_YEAR} (definitief; ${BOUW_SOURCE_URL.split('/').pop()})`,
    indeling: `CBS pc6huisnr ${PC4_YEAR} (adressen per postcode en buurt ${PC4_YEAR})`,
    method: 'verdeeld naar adressen per postcode; codes in 2025-notatie, alleen gebieden die ook in de indeling 2025 bestaan',
    classes: { old: `bouwjaar voor ${OLD_BUILD_BEFORE} (${BOUW_GROUPS.old.join(' + ')})`, modern: `bouwjaar ${MODERN_BUILD_FROM} of later (${BOUW_GROUPS.modern.join(' + ')})` },
    national: { total: sum(pc4Counts, 'total'), old: sum(pc4Counts, 'old'), modern: sum(pc4Counts, 'modern') },
  },
  levels,
};
await mkdir(OUT, { recursive: true });
const name = `bouwjaar-pc4-${PC4_YEAR}.json`;
const text = JSON.stringify(out);
await writeFile(new URL(name, OUT), text);
console.log(`${name}: ${(text.length / 1e6).toFixed(2)} MB`);
const cover = (lvl, list) => `${levels[lvl].codes.length} of ${list.length}`;
console.log(`coverage 2025: buurten ${cover('buurt', buurten25.codes)}, wijken ${cover('wijk', wijken25.codes)}; gemeenten ${levels.gemeente.codes.length}`);
console.log(`check: PC1017 old ${pc4Counts['1017']?.old} of ${pc4Counts['1017']?.total}; PC3011 modern ${pc4Counts['3011']?.modern} of ${pc4Counts['3011']?.total}`);
