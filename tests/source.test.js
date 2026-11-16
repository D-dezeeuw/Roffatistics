import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  odataUrl, wfsUrl, snapshotUrl, isSourceKey, encodeTable, decodeTable, toResponseJson,
  getSource, getRows, fetchLive, setLiveFallback, liveFallbackEnabled, CBS_ODATA, POLITIE_ODATA, SNAPSHOT_FORMAT,
} from '../modules/source.js';

const ok = body => ({ ok: true, json: async () => JSON.parse(JSON.stringify(body)) });
const fail = (status = 404) => ({ ok: false, status, json: async () => ({}) });

describe('source.js URL builders', () => {
  it('odataUrl keeps $filter, $select, $top in order and leaves empty parts out', () => {
    assert.equal(odataUrl('86165NED', { filter: "startswith(Key,'GM')", select: 'Key,Title', entity: 'WijkenEnBuurten' }),
      `${CBS_ODATA}/86165NED/WijkenEnBuurten?%24filter=startswith%28Key%2C%27GM%27%29&%24select=Key%2CTitle`);
    assert.equal(odataUrl('t'), `${CBS_ODATA}/t/TypedDataSet`);
    assert.ok(odataUrl('47018NED', { base: POLITIE_ODATA, filter: 'x', top: 5 }).startsWith(`${POLITIE_ODATA}/47018NED/TypedDataSet?%24filter=x&%24top=5`));
  });

  it('wfsUrl builds a GeoJSON WGS84 GetFeature with extra params last', () => {
    const u = new URL(wfsUrl(2025, 'wijk_gegeneraliseerd', { count: 1000, startIndex: 0 }));
    assert.equal(u.origin + u.pathname, 'https://service.pdok.nl/cbs/gebiedsindelingen/2025/wfs/v1_0');
    assert.equal(u.searchParams.get('typeName'), 'gebiedsindelingen:wijk_gegeneraliseerd');
    assert.equal(u.searchParams.get('srsName'), 'EPSG:4326');
    assert.deepEqual([...u.searchParams.keys()].slice(-2), ['count', 'startIndex']);
  });

  it('snapshot keys are plain relative paths', () => {
    assert.equal(snapshotUrl('geo/2025/GM0599-wijk'), './data/snapshot/geo/2025/GM0599-wijk.json');
    for (const bad of ['../x', '/abs', 'a//b', 'a/../b', '', 'a b']) assert.equal(isSourceKey(bad), false, bad);
    assert.throws(() => snapshotUrl('../etc/passwd'));
  });
});

describe('source.js tables', () => {
  it('encodeTable/decodeTable round-trip rows, padded keys and nulls included', () => {
    const rows = [{ WijkenEnBuurten: 'WK059901  ', A_1: 3, B_2: null }, { WijkenEnBuurten: 'BU05990110', B_2: 7.5 }];
    const t = encodeTable(rows, { key: 'k', period: '2025' });
    assert.equal(t.format, SNAPSHOT_FORMAT);
    assert.deepEqual(t.columns, ['WijkenEnBuurten', 'A_1', 'B_2']);
    assert.deepEqual(t.rows[1], ['BU05990110', null, 7.5]);
    assert.deepEqual(decodeTable(t), [{ WijkenEnBuurten: 'WK059901  ', A_1: 3, B_2: null }, { WijkenEnBuurten: 'BU05990110', A_1: null, B_2: 7.5 }]);
    assert.throws(() => decodeTable({ format: 99, columns: [], rows: [] }));
  });

  it('toResponseJson gives the live shape for tables and passes GeoJSON and OData answers through', () => {
    assert.deepEqual(toResponseJson(encodeTable([{ a: 1 }])), { value: [{ a: 1 }] });
    const fc = { type: 'FeatureCollection', features: [] };
    assert.equal(toResponseJson(fc), fc);
    assert.deepEqual(toResponseJson({ value: [1] }), { value: [1] });
  });
});

describe('getSource', () => {
  afterEach(() => setLiveFallback(null));

  it('reads the own-origin snapshot first and never the live URL when it is there', async () => {
    const calls = [];
    const fetcher = async url => { calls.push(url); return ok(encodeTable([{ RegioS: 'GM0599', v: 1 }])); };
    assert.deepEqual(await getRows('cbs/x', { live: 'https://live/x', fetcher, allowLive: true }), [{ RegioS: 'GM0599', v: 1 }]);
    assert.deepEqual(calls, ['./data/snapshot/cbs/x.json']);
  });

  it('a missing snapshot rejects when the live fallback is off (the default)', async () => {
    setLiveFallback(null);
    assert.equal(liveFallbackEnabled(), false);
    const calls = [];
    const fetcher = async url => { calls.push(url); return url.startsWith('./') ? fail() : ok({ value: [1] }); };
    await assert.rejects(getSource('cbs/x', { live: 'https://live/x', fetcher }));
    assert.equal(calls.length, 1);
  });

  it('with the flag on it falls back to the live URL and follows odata.nextLink', async () => {
    setLiveFallback(true);
    const pages = { 'https://live/x': { value: [1, 2], 'odata.nextLink': 'https://live/x?p=2' }, 'https://live/x?p=2': { value: [3] } };
    const fetcher = async url => (url.startsWith('./') ? fail() : ok(pages[url]));
    assert.deepEqual(await getSource('cbs/x', { live: 'https://live/x', fetcher, storage: null }), { value: [1, 2, 3] });
  });

  it('fetchLive caches by URL and returns GeoJSON unchanged', async () => {
    const store = new Map();
    const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    let n = 0;
    const fetcher = async () => { n++; return ok({ type: 'FeatureCollection', features: [{ id: 1 }] }); };
    const a = await fetchLive('https://pdok/x', { fetcher, storage });
    const b = await fetchLive('https://pdok/x', { fetcher, storage });
    assert.deepEqual(a, b);
    assert.equal(n, 1);
  });
});
