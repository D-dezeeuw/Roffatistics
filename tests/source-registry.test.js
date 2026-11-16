// The data mirror covers every runtime query (docs/plan-data-mirror.md, phase 1 step 4):
// no module builds an OData or WFS URL outside modules/source.js, every snapshot
// key a module reads is in the registry of scripts/snapshot-sources.mjs, and
// every registry entry is read by the module it names.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { REGISTRY } from '../scripts/snapshot-sources.mjs';
import { isSourceKey } from '../modules/source.js';
import { CITIES } from '../modules/city.js';
import { citySourceKeys } from '../modules/areas.js';
import { herkomstSourceKeys } from '../modules/herkomst.js';

const root = new URL('../', import.meta.url);
const files = [...(await readdir(new URL('modules/', root))).filter(f => f.endsWith('.js')).map(f => `modules/${f}`), 'app.js'];
const sources = Object.fromEntries(await Promise.all(files.map(async f => [f, await readFile(new URL(f, root), 'utf8')])));

/** Code without // line comments and block comments (URLs in comments are documentation). */
const code = text => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/\s.*$/, ''))).join('\n');

// Live data endpoints (tiles, P2000 and links to StatLine pages are not data queries of the mirror).
const QUERY_PATTERNS = [/ODataApi|ODataFeed/, /\/TypedDataSet/, /\bGetFeature\b/, /\/wfs\//i, /service\.pdok\.nl\/cbs\//];

describe('source registry coverage', () => {
  it('no module builds an OData or WFS URL outside source.js', () => {
    const offenders = [];
    for (const [f, text] of Object.entries(sources)) {
      if (f === 'modules/source.js') continue;
      code(text).split('\n').forEach((line, i) => { if (QUERY_PATTERNS.some(re => re.test(line))) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`); });
    }
    assert.deepEqual(offenders, [], 'build the URL with odataUrl()/wfsUrl() from modules/source.js and register the query');
  });

  const keyLiterals = new Map();   // key → modules that name it
  for (const [f, text] of Object.entries(sources)) {
    for (const m of code(text).matchAll(/['`]((?:cbs|politie|geo)\/[A-Za-z0-9_./${}-]+)['`]/g)) {
      const key = m[1];
      if (!keyLiterals.has(key)) keyLiterals.set(key, new Set());
      keyLiterals.get(key).add(f.replace(/^modules\//, ''));
    }
  }
  const registered = new Set(REGISTRY.map(e => e.key));
  const matches = (template, key) => new RegExp(`^${template.replace(/[.*+?^()|[\]\\]/g, '\\$&').replace('\\{gm\\}', 'GM\\d{4}').replace('{gm}', 'GM\\d{4}')}$`).test(key);

  it('every snapshot key a module reads is registered', () => {
    const plain = [...keyLiterals.keys()].filter(k => !k.includes('${'));
    assert.ok(plain.length >= 5, `found ${plain.length} keys`);
    // City tables are templated by slug (citySourceKeys / herkomstSourceKeys): check each city's keys.
    const cityKeys = Object.values(CITIES).flatMap(c => [...Object.values(citySourceKeys(c)), ...herkomstSourceKeys(c)]);
    assert.ok(cityKeys.length >= 20, `found ${cityKeys.length} city keys`);
    for (const k of cityKeys) assert.ok(registered.has(k), `${k} (city table) is not in scripts/snapshot-sources.mjs`);
    for (const k of plain) assert.ok(registered.has(k) || REGISTRY.some(e => matches(e.key, k)), `${k} (${[...keyLiterals.get(k)]}) is not in scripts/snapshot-sources.mjs`);
  });

  it('every registry entry is a valid key read by the module it names, with a live URL', () => {
    for (const e of REGISTRY) {
      assert.ok(isSourceKey(e.key.replace('{gm}', 'GM0599')), e.key);
      assert.ok(['odata', 'geo', 'geo-split'].includes(e.kind), e.key);
      assert.ok(e.period, `${e.key} has a period`);
      if (e.kind === 'odata') assert.ok(e.urls.length && e.urls.every(u => /^https:\/\/(opendata|dataderden)\.cbs\.nl\/ODataApi\/odata\//.test(u)), e.key);
      else assert.match(e.pageUrl(0), /^https:\/\/service\.pdok\.nl\/cbs\/gebiedsindelingen\/\d{4}\/wfs\/v1_0\?/);
      const text = sources[`modules/${e.module}`] ?? sources[e.module];
      assert.ok(text, `${e.key}: module ${e.module} exists`);
      if (e.kind === 'geo-split') assert.match(text, /gemeenteGeoKey\(level, gm\)/, `${e.key} read per gemeente`);
      else if (e.city) {   // a city table: the key comes from the module's own key function for that city
        const keys = e.module === 'areas.js' ? Object.values(citySourceKeys(CITIES[e.city])) : herkomstSourceKeys(CITIES[e.city]);
        assert.ok(keys.includes(e.key), `${e.key} is read by ${e.module} for ${e.city}`);
      }
      else assert.ok(keyLiterals.get(e.key)?.has(e.module) || text.includes(`'${e.key}'`) || new RegExp(`getRows\\(GEMEENTE_GROUPS_SOURCE|HERKOMST_SOURCE_KEYS|GEMEENTE_SOURCE`).test(text), `${e.key} is read by ${e.module}`);
    }
  });

  it('registers the queries named in the plan', () => {
    for (const k of ['cbs/86165NED-amsterdam', 'politie/47018NED-amsterdam-buurt', 'cbs/85458NED-amsterdam', 'cbs/86165NED-rotterdam', 'politie/47018NED-rotterdam-wijk', 'politie/47018NED-rotterdam-buurt', 'cbs/85458NED-rotterdam', 'cbs/85458NED-gemeenten', 'geo/2025/{gm}-wijk', 'geo/2025/{gm}-buurt', 'geo/2024/gemeenten', 'cbs/70072ned-provincies', 'cbs/83648NED-gemeenten']) {
      assert.ok(registered.has(k), k);
    }
    assert.equal(registered.size, REGISTRY.length, 'keys are unique');
  });
});
