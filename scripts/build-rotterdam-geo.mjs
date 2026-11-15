// Regenerates the pre-cached Rotterdam geometry in data/:
//   rotterdam_gemeente.geojson  — outline of GM0599 (mask hole, maxBounds)
//   rotterdam_wijken.geojson    — all CBS wijken WK0599xx (PDOK wijk_gegeneraliseerd 2024)
//   rotterdam_buurten.geojson   — all CBS buurten BU0599xxxx (from data/buurt_2024.geojson)
// Run: node scripts/build-rotterdam-geo.mjs   (needs network for the PDOK WFS)
import { readFile, writeFile } from 'node:fs/promises';

const WFS = 'https://service.pdok.nl/cbs/gebiedsindelingen/2024/wfs/v1_0';
const DATA = new URL('../data/', import.meta.url);

async function wfs(typeName, filter) {
  const params = new URLSearchParams({
    request: 'GetFeature', service: 'WFS', version: '2.0.0',
    typeName: `gebiedsindelingen:${typeName}`, outputFormat: 'json', srsName: 'EPSG:4326',
    FILTER: filter,
  });
  const res = await fetch(`${WFS}?${params}`);
  if (!res.ok) throw new Error(`PDOK ${typeName} ${res.status}`);
  return res.json();
}

const round = c => typeof c[0] === 'number' ? [+c[0].toFixed(5), +c[1].toFixed(5)] : c.map(round);

function slim(features) {
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

const gemeente = await wfs('gemeente_gegeneraliseerd', like('GM0599'));
const wijken   = await wfs('wijk_gegeneraliseerd', like('WK0599'));
const buurtAll = JSON.parse(await readFile(new URL('buurt_2024.geojson', DATA), 'utf8'));
const buurten  = buurtAll.features.filter(f => f.properties.statcode.startsWith('BU0599'));

await writeFile(new URL('rotterdam_gemeente.geojson', DATA), JSON.stringify(slim(gemeente.features)));
await writeFile(new URL('rotterdam_wijken.geojson', DATA),   JSON.stringify(slim(wijken.features)));
await writeFile(new URL('rotterdam_buurten.geojson', DATA),  JSON.stringify(slim(buurten)));
console.log(`gemeente ${gemeente.features.length}, wijken ${wijken.features.length}, buurten ${buurten.length}`);
