// Amsterdam (GM0363) data, plan-mokumistics step 2: the snapshot tables, the
// city geometry and the OV files are on disk, every wijk and buurt joins its
// kerncijfers and shape, and the Woonscore computes. Reads only local files.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CITIES } from '../modules/city.js';
import { loadCityAreas, _resetAreaCache, citySourceKeys } from '../modules/areas.js';
import { _resetOvCache } from '../modules/ov.js';
import { herkomstSourceKeys } from '../modules/herkomst.js';

const root = new URL('../', import.meta.url);
const AMS = CITIES.amsterdam;
const readJson = async p => JSON.parse(await readFile(new URL(p.replace(/^\.\//, ''), root), 'utf8'));
const fetcher = async url => {
  try { const body = await readFile(new URL(url.replace(/^\.\//, ''), root), 'utf8'); return { ok: true, json: async () => JSON.parse(body) }; }
  catch { return { ok: false, status: 404 }; }
};

let res;
before(async () => {
  _resetAreaCache(); _resetOvCache();
  res = await loadCityAreas({ city: AMS, fetcher, storage: null });
  _resetAreaCache(); _resetOvCache();
});

describe('Amsterdam data (GM0363)', () => {
  it('every city snapshot table is on disk', async () => {
    for (const key of [...Object.values(citySourceKeys(AMS)), ...herkomstSourceKeys(AMS)]) {
      const t = await readJson(`data/snapshot/${key}.json`);
      assert.ok(t.rows.length > 0, key);
    }
  });
  it('110 wijken and 517 buurten, each with a shape and a kerncijfers row', async () => {
    const [wg, bg, gm] = await Promise.all([readJson(AMS.geo.wijken), readJson(AMS.geo.buurten), readJson(AMS.geo.gemeente)]);
    assert.equal(gm.features.length, 1);
    assert.equal(gm.features[0].properties.statcode, 'GM0363');
    assert.equal(res.wijken.length, wg.features.length);
    assert.equal(res.buurten.length, bg.features.length);
    assert.ok(res.wijken.length >= 100 && res.buurten.length >= 500, `${res.wijken.length} wijken, ${res.buurten.length} buurten`);
    const kwb = await readJson(`data/snapshot/${citySourceKeys(AMS).kwb}.json`);
    const region = kwb.columns.indexOf('WijkenEnBuurten');
    const codes = new Set(kwb.rows.map(r => String(r[region]).trim()));
    for (const a of [...res.wijken, ...res.buurten]) {
      assert.ok(codes.has(a.code), `${a.code} in 86165NED`);
      assert.ok(a.values.population != null, `${a.code} inwoners`);
      assert.ok(a.bounds, `${a.code} shape`);
    }
    assert.ok(res.buurten.every(b => b.parent && b.parent.startsWith('WK0363')));
    assert.equal(res.dataOk, true);
    const [[s, w], [n, e]] = res.bounds;
    assert.ok(s > 52.2 && n < 52.5 && w > 4.6 && e < 5.2, 'bounds around Amsterdam');
  });
  it('the Woonscore computes for every inhabited wijk and almost every buurt', () => {
    const scored = l => l.filter(a => Number.isFinite(a.values.woonscore)).length;
    const big = l => l.filter(a => a.values.population >= 1000);
    assert.ok(scored(big(res.wijken)) >= big(res.wijken).length - 1, `wijken ${scored(res.wijken)}/${res.wijken.length}`);
    assert.ok(scored(res.buurten) / res.buurten.length > 0.8, `buurten ${scored(res.buurten)}/${res.buurten.length}`);
  });
  it('crime, OV distance, centrum distance and the city totals are joined', () => {
    const all = [...res.wijken, ...res.buurten];
    assert.ok(all.every(a => a.values.totalCrimes != null), 'police counts for every area');
    assert.ok(all.every(a => a.values.distMetro != null && a.values.distTram != null), 'distance to metro and tram');
    const centrum = res.wijken.find(a => a.code === 'WK0363AA');   // Haarlemmerbuurt, next to Amsterdam Centraal
    assert.ok(centrum.values.distCentrum < 1.5, `distCentrum ${centrum.values.distCentrum}`);
    assert.equal(res.city.code, 'GM0363');
    assert.ok(res.city.values.population > 900000);
    assert.equal(res.city.woz?.year, 2026);
  });
  it('OV files: GVB area bus lines with the OSM attribution, afstand for every area', async () => {
    const bus = await readJson(AMS.ov.bus);
    assert.match(bus.source, /OpenStreetMap/);
    assert.equal(bus.license, 'ODbL 1.0');
    assert.ok(bus.modes.bus.lines.length > 100 && bus.modes.bus.stops.length > 300);
    const { codes } = await readJson(AMS.ov.afstand);
    for (const a of [...res.wijken, ...res.buurten]) assert.ok(codes[a.code], a.code);
    assert.ok(codes.GM0363 && codes.GM0599, 'gemeenten too');
  });
});
