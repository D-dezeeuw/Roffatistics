// Regenerates the pre-cached geometry of one city (config/cities.json `geo`):
//   <city>_gemeente.geojson  — outline of the gemeente (mask hole, maxBounds)
//   <city>_wijken.geojson    — all CBS wijken WK<nnnn>xx (PDOK wijk_gegeneraliseerd 2024)
//   <city>_buurten.geojson   — all CBS buurten BU<nnnn>xxxx (from data/buurt_2024.geojson)
// Run: node scripts/build-city-geo.mjs --city amsterdam   (default rotterdam; needs
// network for the PDOK WFS unless the raw archive has the answers; --refresh fetches anew)
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { archivedJson, sourceForUrl } from './lib/raw-archive.mjs';
import { CITIES, DEFAULT_CITY, cityCodes } from '../modules/city.js';

const WFS = 'https://service.pdok.nl/cbs/gebiedsindelingen/2024/wfs/v1_0';
const ROOT = new URL('../', import.meta.url);
const DATA = new URL('data/', ROOT);

/** The --city value (or `--city=slug`), else the default city. */
export function cityArg(argv = process.argv) {
  const i = argv.indexOf('--city');
  const v = i >= 0 ? argv[i + 1] : argv.find(a => a.startsWith('--city='))?.slice(7);
  return v ?? DEFAULT_CITY;
}

async function wfs(typeName, filter) {
  const params = new URLSearchParams({
    request: 'GetFeature', service: 'WFS', version: '2.0.0',
    typeName: `gebiedsindelingen:${typeName}`, outputFormat: 'json', srsName: 'EPSG:4326',
    FILTER: filter,
  });
  return archivedJson(sourceForUrl(`${WFS}/`), `${WFS}?${params}`);   // via the raw archive; --refresh fetches anew
}

const round = c => typeof c[0] === 'number' ? [+c[0].toFixed(5), +c[1].toFixed(5)] : c.map(round);

export function slim(features) {
  return {
    type: 'FeatureCollection',
    features: features
      .map(f => ({
        type: 'Feature',
        properties: { statcode: f.properties.statcode.trim(), statnaam: f.properties.statnaam },
        geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
      }))
      .sort((a, b) => a.properties.statcode.localeCompare(b.properties.statcode)),
  };
}

const like = prefix => `<Filter><PropertyIsLike wildCard="*" singleChar="." escapeChar="!"><PropertyName>statcode</PropertyName><Literal>${prefix}*</Literal></PropertyIsLike></Filter>`;

async function main() {
  const slug = cityArg();
  const city = CITIES[slug];
  if (!city) throw new Error(`unknown city ${slug} (config/cities.json: ${Object.keys(CITIES).join(', ')})`);
  const c = cityCodes(city);
  const gemeente = await wfs('gemeente_gegeneraliseerd', like(c.gemeente));
  const wijken   = await wfs('wijk_gegeneraliseerd', like(c.wijkPrefix));
  const buurtAll = JSON.parse(await readFile(new URL('buurt_2024.geojson', DATA), 'utf8'));
  const buurten  = buurtAll.features.filter(f => f.properties.statcode.startsWith(c.buurtPrefix));
  const out = path => new URL(path.replace(/^\.\//, ''), ROOT);
  await writeFile(out(city.geo.gemeente), JSON.stringify(slim(gemeente.features)));
  await writeFile(out(city.geo.wijken),   JSON.stringify(slim(wijken.features)));
  await writeFile(out(city.geo.buurten),  JSON.stringify(slim(buurten)));
  console.log(`${slug}: gemeente ${gemeente.features.length}, wijken ${wijken.features.length}, buurten ${buurten.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
