// PFAS-punten → data/nl/pfas-points.json (docs/plan-milieu.md phase 2, item 7).
// Source: the Pfoisened export of the PFAS Data Hub (CNRS, https://pdh.cnrs.fr),
// /nebula/apps/pfoisened/data/points.json (read only; override with the first
// argument or PFOISENED_POINTS). Keeps the points inside NL (data/provinces.json):
// soil measurements (Netherlands PFASBodemTotaal), PDH groundwater measurements and
// the presumptive sources of modules/pfas-points.js. pfas_sum in ng/g (soil) or ng/L (water).
// Usage: node scripts/build-pfas-points.mjs [points.json]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pointInRings } from '../modules/score-labels.js';
import { PFAS_POINTS_URL, PFAS_KINDS, encodePfasPoints, pfasKind } from '../modules/pfas-points.js';
import { firstPathArg, today } from './lib/raw-archive.mjs';

export const PFOISENED_POINTS = firstPathArg() ?? process.env.PFOISENED_POINTS ?? '/nebula/apps/pfoisened/data/points.json';
const OUT_FILE = new URL(`../${PFAS_POINTS_URL.slice(2)}`, import.meta.url);

const points = JSON.parse(await readFile(PFOISENED_POINTS, 'utf8'));
let meta = {};
try { meta = JSON.parse(await readFile(join(dirname(PFOISENED_POINTS), 'meta.json'), 'utf8')); } catch { /* optional */ }
const provGeo = JSON.parse(await readFile(new URL('../data/provinces.json', import.meta.url), 'utf8'));
const nlPolys = provGeo.features.flatMap(f => (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]));
const inNl = p => p.lat > 50.7 && p.lat < 53.7 && p.lon > 3.2 && p.lon < 7.3 && nlPolys.some(r => pointInRings([p.lon, p.lat], r));

const kept = points.filter(p => pfasKind(p) && inNl(p));
const body = encodePfasPoints(kept);
const out = {
  ...body, built: today(), generated: meta.generated_at ?? null,
  source: 'PFAS Data Hub (CNRS), https://pdh.cnrs.fr, via de Pfoisened-export; pfas_sum in ng/g (bodem) of ng/L (water)',
};
await writeFile(OUT_FILE, JSON.stringify(out));
const size = (await readFile(OUT_FILE)).length;
console.log(`wrote ${OUT_FILE.pathname} (${size} bytes): ${body.lat.length} punten;`, Object.fromEntries(PFAS_KINDS.map((k, i) => [k, body.kind.filter(x => x === i).length])));
