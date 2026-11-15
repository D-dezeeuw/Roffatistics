import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bouwCountsFromRows, encodeBouwLevel, decodeBouwjaar, bouwSharesOf, addBouwShares, loadBouwjaar, onBouwLoaded, getBouwEntry,
  presetUsesBouw, isBouwKey, _setBouwData, BOUW_CLASSES, BOUW_MIN_DWELLINGS, BOUW_URL, BOUW_KEYS,
} from '../modules/bouwjaar-pc4.js';
import { createCrosswalk, addAddresses, allocate, rollUp } from '../modules/postcode.js';
import { DATASETS } from '../modules/datasets.js';
import { GENERAL_SECTIONS } from '../modules/explain.js';
import { answersToPreset } from '../modules/wizard-model.js';

const row = (postcode, total, cls = {}) => ({ postcode, aantal_woningen: total, ...Object.fromEntries(Object.entries(BOUW_CLASSES).map(([k, col]) => [col, cls[k] ?? 0])) });

describe('bouwjaar-pc4: counts per postcode', () => {
  it('old = before 1945, modern = 2005 and later; secret cells count 0; no total → left out', () => {
    const c = bouwCountsFromRows([
      row(3011, 1000, { voor1945: 100, b45tot65: 300, b05tot15: 200, b15plus: 50 }),
      row(3012, 400, { voor1945: -99997, b15plus: 100 }),
      row(3013, -99997, { voor1945: 10 }),
      row('abc', 100),
    ]);
    assert.deepEqual(c['3011'], { total: 1000, old: 100, modern: 250 });
    assert.deepEqual(c['3012'], { total: 400, old: 0, modern: 100 });
    assert.ok(!('3013' in c) && !('abc' in c));
  });
  it('allocates by address share over buurten and rolls up to wijk and gemeente, nothing lost', () => {
    const cw = createCrosswalk();
    addAddresses(cw, '3011', '05990110', 75); addAddresses(cw, '3011', '05990120', 25); addAddresses(cw, '3012', '05990120', 10);
    const pc4 = bouwCountsFromRows([row(3011, 1000, { voor1945: 400, b15plus: 100 }), row(3012, 200, { b05tot15: 50 }), row(9999, 80, { voor1945: 80 })]);
    const { byBuurt, unallocated } = allocate(pc4, cw);
    assert.deepEqual(byBuurt['05990110'], { total: 750, old: 300, modern: 75 });
    assert.deepEqual(byBuurt['05990120'], { total: 450, old: 100, modern: 75 });
    assert.deepEqual(unallocated, { total: 80, old: 80, modern: 0 });
    assert.deepEqual(rollUp(byBuurt, 'wijk')['059901'], { total: 1200, old: 400, modern: 150 });
    assert.deepEqual(rollUp(byBuurt, 'gemeente')['0599'], { total: 1200, old: 400, modern: 150 });
    const lvl = encodeBouwLevel({ BU05990120: byBuurt['05990120'], BU05990110: byBuurt['05990110'] });
    assert.deepEqual(lvl, { codes: ['BU05990110', 'BU05990120'], total: [750, 450], old: [300, 100], modern: [75, 75] });
  });
  it('shares: 1 decimal, null below the minimum and without an entry', () => {
    assert.deepEqual(bouwSharesOf({ total: 750, old: 300, modern: 75 }), { oldBuildPct: 40, modernBuildPct: 10 });
    assert.deepEqual(bouwSharesOf({ total: BOUW_MIN_DWELLINGS - 1, old: 10, modern: 10 }), { oldBuildPct: null, modernBuildPct: null });
    assert.deepEqual(bouwSharesOf(null), { oldBuildPct: null, modernBuildPct: null });
    assert.throws(() => decodeBouwjaar({ format: 99, levels: {} }));
  });
});

describe('bouwjaar-pc4: loading and joining', () => {
  it('loads once, runs listeners first, adds shares to wijken/buurten only; unmatched → null', async () => {
    _setBouwData(null);
    const data = { format: 1, levels: { buurt: { codes: ['BU05990110'], total: [400], old: [100], modern: [40] } } };
    let seen = 0, calls = 0, url = '';
    onBouwLoaded(() => { seen = getBouwEntry('BU05990110')?.total; });
    const fetcher = async u => { calls++; url = u; return { ok: true, json: async () => data }; };
    await Promise.all([loadBouwjaar({ fetcher }), loadBouwjaar({ fetcher })]);
    assert.equal(calls, 1); assert.equal(seen, 400); assert.equal(url, BOUW_URL);
    const areas = [{ code: 'BU05990110', values: { population: 900 } }, { code: 'BU09999999', values: {} }, { code: 'GM0599', values: {} }];
    addBouwShares(areas);
    assert.equal(areas[0].values.oldBuildPct, 25);
    assert.equal(areas[0].values.modernBuildPct, 10);
    assert.equal(areas[0].values.population, 900);
    assert.equal(areas[1].values.oldBuildPct, null, 'no 2023 match: no data, no guess');
    assert.ok(!('oldBuildPct' in areas[2].values));
    _setBouwData(null);
  });
  it('a preset of the wizard needs the data exactly when a bouwstijl is chosen', () => {
    assert.ok(presetUsesBouw(answersToPreset({ bouw: 'karakter' })));
    assert.ok(presetUsesBouw(answersToPreset({ bouw: 'modern' })));
    assert.ok(!presetUsesBouw(answersToPreset({ levensfase: 'gezin' })));
    assert.ok(isBouwKey('oldBuildPct') && !isBouwKey('newBuildPct'));
  });
  it('layers exist with an Uitleg (estimated, wijk/buurt only, not in the totaalscore)', () => {
    for (const k of BOUW_KEYS) {
      const d = DATASETS[k];
      assert.ok(d && d.estimated && d.scope === 'rotterdam' && d.inOverall === false, k);
      assert.match(d.description, /postcode/);
      assert.ok(d.source.length >= 2 && d.caveats.length >= 3, k);
    }
    assert.match(DATASETS.oldBuildPct.title, /vóór 1945/);
    assert.match(DATASETS.modernBuildPct.title, /2005 of later/);
    assert.ok(GENERAL_SECTIONS.some(s => s.id === 'bouwstijl'));
  });
});

describe('bouwjaar-pc4: built file', () => {
  const j = JSON.parse(readFileSync(new URL('../data/nl/bouwjaar-pc4-2023.json', import.meta.url), 'utf8'));
  it('decodes, covers most 2025 buurten, keeps old/modern ≤ total, sums to the national count', () => {
    const d = decodeBouwjaar(j);
    assert.ok(j.levels.buurt.codes.length > 13000 && j.levels.wijk.codes.length > 3000 && j.levels.gemeente.codes.length > 300);
    for (const lvl of Object.values(j.levels)) lvl.codes.forEach((c, i) => assert.ok(lvl.old[i] <= lvl.total[i] + 1 && lvl.modern[i] <= lvl.total[i] + 1, c));
    const gmTotal = j.levels.gemeente.total.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(gmTotal - j.sources.national.total) < j.levels.gemeente.codes.length, 'every dwelling lands in a gemeente');
    const rtm = bouwSharesOf(d.get('GM0599'));
    assert.ok(rtm.oldBuildPct > 20 && rtm.oldBuildPct < 40, `Rotterdam old ${rtm.oldBuildPct}`);
    const ams = bouwSharesOf(d.get('GM0363'));
    assert.ok(ams.oldBuildPct > rtm.oldBuildPct, 'Amsterdam has more pre-war stock than (bombed) Rotterdam');
  });
});
