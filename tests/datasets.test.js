import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCBSUrl, fetchCBS, normalizeProvinces } from '../modules/datasets.js';

describe('buildCBSUrl', () => {
  it('includes tableId and TypedDataSet', () => {
    const url = buildCBSUrl('70072ned', "startswith(RegioS,'PV')");
    assert.ok(url.includes('70072ned'));
    assert.ok(url.includes('TypedDataSet'));
  });

  it('encodes the filter as $filter param', () => {
    const url = buildCBSUrl('70072ned', "startswith(RegioS,'PV')");
    assert.ok(url.includes('%24filter=') || url.includes('$filter='));
  });

  it('appends $select when provided', () => {
    const url = buildCBSUrl('70072ned', 'filter', 'RegioS,TotaleBevolking_1');
    assert.ok(url.includes('RegioS'));
    assert.ok(url.includes('TotaleBevolking_1'));
  });

  it('omits $select when not provided', () => {
    const url = buildCBSUrl('70072ned', 'filter');
    assert.ok(!url.includes('$select'));
  });
});

describe('fetchCBS', () => {
  it('returns cached value without fetching', async () => {
    const cached  = [{ RegioS: 'PV20  ' }];
    const storage = { getItem: () => JSON.stringify(cached), setItem: () => {} };
    const fetcher = async () => { throw new Error('should not fetch'); };
    const result  = await fetchCBS('t', 'f', null, fetcher, storage);
    assert.deepEqual(result, cached);
  });

  it('fetches, returns, and caches on miss', async () => {
    let stored    = null;
    const payload = [{ RegioS: 'PV20  ' }];
    const storage = {
      getItem:  () => null,
      setItem:  (_, v) => { stored = JSON.parse(v); },
    };
    const fetcher = async () => ({ ok: true, json: async () => ({ value: payload }) });
    const result  = await fetchCBS('t', 'f', null, fetcher, storage);
    assert.deepEqual(result, payload);
    assert.deepEqual(stored, payload);
  });

  it('throws on non-200 response', async () => {
    const storage = { getItem: () => null, setItem: () => {} };
    const fetcher = async () => ({ ok: false, status: 503 });
    await assert.rejects(
      () => fetchCBS('t', 'f', null, fetcher, storage),
      /CBS 503/,
    );
  });

  it('works without storage (no sessionStorage in Node)', async () => {
    const payload = [{ RegioS: 'PV20  ' }];
    const fetcher = async () => ({ ok: true, json: async () => ({ value: payload }) });
    const result  = await fetchCBS('t', 'f', null, fetcher, undefined);
    assert.deepEqual(result, payload);
  });
});

describe('normalizeProvinces', () => {
  const row = {
    RegioS:                      'PV20  ',
    TotaleBevolking_1:           596075,
    BronInkomenAlsWerknemer_141: 37.5,
    TotaleOppervlakte_248:       2955.18,
  };

  it('trims region code', () => {
    const [r] = normalizeProvinces([row]);
    assert.equal(r.regionCode, 'PV20');
  });

  it('maps population and income', () => {
    const [r] = normalizeProvinces([row]);
    assert.equal(r.population, 596075);
    assert.equal(r.avgIncome, 37.5);
    assert.equal(r.areaSqKm, 2955.18);
  });

  it('computes density as rounded pop / area', () => {
    const [r] = normalizeProvinces([row]);
    assert.equal(r.density, Math.round(596075 / 2955.18));
  });

  it('sets density to null when area is null', () => {
    const [r] = normalizeProvinces([{ ...row, TotaleOppervlakte_248: null }]);
    assert.equal(r.density, null);
  });
});
