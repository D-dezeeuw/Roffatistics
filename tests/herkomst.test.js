import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractAreaValues, mergeYearValues, WIJK_COLUMNS as C } from '../modules/areas.js';
import { DATASETS, groupDatasets, normalizeProvinces, CBS_COLUMNS } from '../modules/datasets.js';
import { originSplit, originBarHtml, ORIGIN_PARTS } from '../modules/herkomst.js';
import { formatPanelData } from '../modules/panel.js';

// WK059901 Stadscentrum, 86165NED (2025), fetched 15 Nov 2026.
const centrum = {
  [C.region]: 'WK059901  ', [C.population]: 42090,
  [C.originDutch]: 15390, [C.originEurope]: 7465, [C.originOutsideEurope]: 19240,
  [C.bornAbroadEurope]: 5985, [C.bornAbroadOutside]: 12345,
};

describe('herkomst layers (wijk/buurt, 86165NED)', () => {
  it('maps the CBS columns _17/_18/_19 and _23 + _24 to shares of inhabitants', () => {
    assert.equal(C.originDutch, 'Nederland_17');
    assert.equal(C.originEurope, 'EuropaExclusiefNederland_18');
    assert.equal(C.bornAbroadEurope, 'EuropaExclusiefNederland_23');
    assert.equal(C.bornAbroadOutside, 'BuitenEuropa_24');
    const v = extractAreaValues(centrum);
    assert.equal(v.originDutchPct, 36.6);
    assert.equal(v.originEuropePct, 17.7);
    assert.equal(v.nonWesternPct, 45.7);
    assert.equal(v.bornAbroadPct, 43.5);   // (5985 + 12345) / 42090 = 43.55 → toFixed(1)
  });
  it('born abroad is null when either part is missing', () => {
    assert.equal(extractAreaValues({ ...centrum, [C.bornAbroadOutside]: null }).bornAbroadPct, null);
  });
  it('the herkomst shares fall back to the older year together', () => {
    const now = { ...centrum, [C.originEurope]: null };
    const { values, years } = mergeYearValues(now, centrum, 2024);
    assert.equal(values.originEuropePct, 17.7);
    assert.equal(years.nonWesternPct, 2024);
    assert.equal(years.originDutchPct, 2024);
  });
  it('are neutral, out of the totaalscore, in their own Herkomst group', () => {
    for (const k of ['originDutchPct', 'originEuropePct', 'nonWesternPct', 'bornAbroadPct']) {
      assert.equal(DATASETS[k].higherIsBetter, null, k);
      assert.equal(DATASETS[k].inOverall, false, k);
      assert.equal(DATASETS[k].group, 'herkomst', k);
      assert.ok(DATASETS[k].description.includes('moeder'), `${k} explains the CBS definition`);
    }
    assert.equal(DATASETS.bornAbroadPct.scope, 'rotterdam');
    const g = groupDatasets().find(x => x.key === 'herkomst');
    assert.deepEqual(g.datasets.map(d => d.key), ['originDutchPct', 'originEuropePct', 'nonWesternPct', 'bornAbroadPct']);
    assert.equal(g.scope, 'all');
  });
  it('Nederland view gets NL and Europa shares from 70072ned', () => {
    assert.equal(CBS_COLUMNS.originDutch, 'Nederland_14');
    const [r] = normalizeProvinces([{ RegioS: 'GM0599', TotaleBevolking_1: 1000, Nederland_14: 450, EuropaExclusiefNederland_15: 120, BuitenEuropa_16: 430 }]);
    assert.equal(r.originDutchPct, 45);
    assert.equal(r.originEuropePct, 12);
  });
});

describe('origin split and panel bar', () => {
  it('normalises the three parts to exactly 100 %', () => {
    const parts = originSplit(extractAreaValues(centrum));
    assert.deepEqual(parts.map(p => p.key), ORIGIN_PARTS.map(p => p.key));
    assert.ok(Math.abs(parts.reduce((a, p) => a + p.pct, 0) - 100) < 1e-9);
    assert.equal(parts[2].value, 45.7);
  });
  it('is null when a part is missing or everything is zero', () => {
    assert.equal(originSplit({ originDutchPct: 50, originEuropePct: null, nonWesternPct: 50 }), null);
    assert.equal(originSplit({ originDutchPct: 0, originEuropePct: 0, nonWesternPct: 0 }), null);
    assert.equal(originSplit(null), null);
  });
  it('renders a labelled bar, and nothing without data', () => {
    const html = originBarHtml(extractAreaValues(centrum));
    assert.match(html, /role="img" aria-label="Herkomst: Nederland 36,6%, Europa \(excl\. NL\) 17,7%, Buiten Europa 45,7%"/);
    assert.equal((html.match(/class="origin-seg"/g) || []).length, 3);
    assert.equal(originBarHtml({}), '');
  });
  it('panel formats the new fields', () => {
    const f = formatPanelData({ originDutchPct: 36.6, originEuropePct: 17.7, bornAbroadPct: 43.6 });
    assert.equal(f.originDutchPct, '36.6%');
    assert.equal(f.bornAbroadPct, '43.6%');
    assert.equal(formatPanelData(null).originEuropePct, '—');
  });
});
