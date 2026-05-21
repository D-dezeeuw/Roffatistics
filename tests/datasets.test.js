import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCBSUrl, fetchCBS, normalizeProvinces, normalizeCrime } from '../modules/datasets.js';

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

  it('appends $top when provided', () => {
    const url = buildCBSUrl('70072ned', 'filter', null, 2000);
    assert.ok(url.includes('2000'));
  });

  it('omits $top when not provided', () => {
    const url = buildCBSUrl('70072ned', 'filter');
    assert.ok(!url.includes('$top'));
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
    BasisonderwijsVmboMbo1_113:  28.4,
    HavoVwoMbo24_114:            38.1,
    HboWo_115:                   33.5,
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

  it('maps education fields', () => {
    const [r] = normalizeProvinces([row]);
    assert.equal(r.lowEdu,  28.4);
    assert.equal(r.medEdu,  38.1);
    assert.equal(r.highEdu, 33.5);
  });

  it('sets education fields to null when columns are missing', () => {
    const [r] = normalizeProvinces([{
      RegioS: 'PV20  ', TotaleBevolking_1: 0,
      BronInkomenAlsWerknemer_141: 0, TotaleOppervlakte_248: 1,
    }]);
    assert.equal(r.lowEdu,  null);
    assert.equal(r.medEdu,  null);
    assert.equal(r.highEdu, null);
  });
});

describe('normalizeCrime', () => {
  const baseRow = (soort, rate = null, total = null) => ({
    RegioS:                              'PV20  ',
    SoortMisdrijf:                       soort,
    GeregistreerdeMisdrijvenPer1000Inw_3: rate,
    TotaalGeregistreerdeMisdrijven_1:    total,
  });

  const rows = [
    { ...baseRow('T001161', 45.2, 26973) },
    { ...baseRow('CRI1000', null, 14000) },
    { ...baseRow('CRI1100', null,  9000) },
    { ...baseRow('CRI2000', null,  4800) },
    { ...baseRow('CRI3000', null,  3200) },
    { ...baseRow('CRI3100', null,  2100) },
  ];

  it('returns one entry per province (totals row)', () => {
    const result = normalizeCrime(rows);
    assert.equal(result.length, 1);
  });

  it('maps regionCode, crimeRate, totalCrimes', () => {
    const [r] = normalizeCrime(rows);
    assert.equal(r.regionCode,  'PV20');
    assert.equal(r.crimeRate,   45.2);
    assert.equal(r.totalCrimes, 26973);
  });

  it('builds categories array with label and count', () => {
    const [r] = normalizeCrime(rows);
    assert.equal(r.categories.length, 5);
    const vermogen = r.categories.find(c => c.label === 'Vermogen');
    assert.equal(vermogen.count, 14000);
    const diefstal = r.categories.find(c => c.label === 'Diefstal/inbraak');
    assert.equal(diefstal.count, 9000);
  });

  it('excludes rows where crimeRate is null (e.g. PV99)', () => {
    const withNull = [{ ...baseRow('T001161', null, 0) }];
    const result   = normalizeCrime(withNull);
    assert.equal(result.length, 0);
  });

  it('sets category count to null when category is missing', () => {
    const onlyTotal = [{ ...baseRow('T001161', 45.2, 26973) }];
    const [r]       = normalizeCrime(onlyTotal);
    assert.equal(r.categories.find(c => c.label === 'Vermogen').count, null);
  });
});
