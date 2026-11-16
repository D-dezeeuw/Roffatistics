// The committed snapshot (data/snapshot/, scripts/snapshot-sources.mjs) parses,
// carries its header, and its codes exist in the 2025 indeling.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeTable, SNAPSHOT_FORMAT } from '../modules/source.js';
import { REGISTRY } from '../scripts/snapshot-sources.mjs';
import { decodeLevel, NL_DATA_URLS } from '../modules/nl-areas.js';

const root = new URL('../', import.meta.url);
const read = async rel => JSON.parse(await readFile(new URL(rel, root), 'utf8'));
const manifest = await read('data/snapshot/manifest.json');
const keys = Object.keys(manifest.files);
const trim = v => String(v ?? '').trim();

// The NL 2025 indeling from the committed drill-down data.
const nlWijk = decodeLevel(await read(NL_DATA_URLS.wijk.slice(2)));
const nlBuurt = decodeLevel(await read(NL_DATA_URLS.buurt.slice(2)));
const known = new Set([...nlWijk, ...nlBuurt].map(a => a.code));
const gemeenten = new Set([...known].map(c => `GM${c.slice(2, 6)}`));

describe('data/snapshot', () => {
  it('has a file for every registry entry (one per gemeente and level for the geometry)', () => {
    for (const e of REGISTRY) {
      if (e.kind === 'geo-split') {
        const n = keys.filter(k => new RegExp(`^${e.key.replace('{gm}', 'GM\\d{4}')}$`).test(k)).length;
        assert.ok(n >= 340, `${e.key}: ${n} gemeenten`);
      } else assert.ok(manifest.files[e.key], `${e.key} in the snapshot`);
    }
  });

  it('every table parses, has its header and rows', async () => {
    for (const e of REGISTRY.filter(x => x.kind === 'odata')) {
      const t = await read(`data/snapshot/${e.key}.json`);
      assert.equal(t.format, SNAPSHOT_FORMAT, e.key);
      assert.ok(t.built && t.period && t.sources?.length && t.sha256?.length, `${e.key} header`);
      const rows = decodeTable(t);
      assert.ok(rows.length > 0, `${e.key} rows`);
      assert.equal(rows.length, manifest.files[e.key].rows);
    }
  });

  it('Rotterdam wijk/buurt codes of the 2025 tables exist in the 2025 indeling', async () => {
    for (const key of ['cbs/86165NED-rotterdam', 'cbs/86270NED-rotterdam', 'politie/47018NED-rotterdam-wijk', 'politie/47018NED-rotterdam-buurt']) {
      const codes = new Set(decodeTable(await read(`data/snapshot/${key}.json`)).map(r => trim(r.WijkenEnBuurten)).filter(c => /^(WK|BU)/.test(c)));
      assert.ok(codes.size > 10, key);
      const missing = [...codes].filter(c => !known.has(c));
      assert.deepEqual(missing, [], `${key}: codes not in the 2025 indeling`);
    }
  });

  it('gemeente tables carry GM codes; the 2025 names cover every gemeente of the indeling', async () => {
    const names = decodeTable(await read('data/snapshot/cbs/86165NED-gemeenten.json')).map(r => trim(r.Key));
    assert.ok(names.every(c => /^GM\d{4}$/.test(c)));
    assert.deepEqual([...gemeenten].filter(g => !names.includes(g)), []);
    const groups = decodeTable(await read('data/snapshot/cbs/85458NED-gemeenten.json'));
    assert.ok(groups.some(r => trim(r.RegioS) === 'GM0599'));
  });

  it('geometry per gemeente is slim GeoJSON whose codes belong to that gemeente and exist in 2025', async () => {
    for (const gm of ['GM0599', 'GM0363', 'GM0014']) {
      for (const level of ['wijk', 'buurt']) {
        const g = await read(`data/snapshot/geo/2025/${gm}-${level}.json`);
        assert.equal(g.type, 'FeatureCollection');
        assert.ok(g.features.length > 0, `${gm}-${level}`);
        for (const f of g.features) {
          assert.deepEqual(Object.keys(f.properties), ['statcode', 'statnaam']);
          assert.equal(f.properties.statcode.slice(2, 6), gm.slice(2));
          assert.ok(known.has(f.properties.statcode), `${f.properties.statcode} in 2025`);
        }
      }
    }
    const rdam = await read('data/snapshot/geo/2025/GM0599-wijk.json');
    assert.equal(rdam.features.length, nlWijk.filter(a => a.code.startsWith('WK0599')).length);
  });

  it('the 2024 gemeente overlay covers every gemeente once', async () => {
    const g = await read('data/snapshot/geo/2024/gemeenten.json');
    const codes = g.features.map(f => f.properties.statcode);
    assert.ok(codes.length >= 340);
    assert.equal(new Set(codes).size, codes.length);
    assert.ok(codes.includes('GM0599'));
  });
});
