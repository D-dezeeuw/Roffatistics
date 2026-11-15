import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TAU, polar, arcPath, roundPercents, mergeSlices, donutSlices, OTHER_COLOR, DONUT_PALETTE } from '../modules/donut.js';
import { educationMix, areaEducationMix, shareSplit, populationItems } from '../modules/dashboard-data.js';

const sum = a => +a.reduce((s, v) => s + v, 0).toFixed(6);

describe('roundPercents', () => {
  it('sums to exactly 100 at one decimal', () => {
    for (const vals of [[1, 1, 1], [2, 3, 5, 7, 11], [0.1, 0.1, 99.8], [5, 5, 5, 5, 5, 5, 5]]) {
      assert.equal(sum(roundPercents(vals)), 100, vals.join(','));
    }
    assert.deepEqual(roundPercents([1, 1, 1]), [33.4, 33.3, 33.3]);
    assert.deepEqual(roundPercents([1, 1, 1], 0), [34, 33, 33]);
  });
  it('treats missing and negative values as 0 and gives zeros for an empty total', () => {
    assert.deepEqual(roundPercents([null, 2, -1, 2]), [0, 50, 0, 50]);
    assert.deepEqual(roundPercents([0, 0]), [0, 0]);
    assert.deepEqual(roundPercents([]), []);
  });
});

describe('mergeSlices', () => {
  const items = Array.from({ length: 11 }, (_, i) => ({ key: `k${i}`, label: `L${i}`, value: i + 1 }));
  it('keeps the top N by value and merges the rest into Overig', () => {
    const m = mergeSlices(items, { top: 8, sort: true });
    assert.equal(m.length, 9);
    assert.deepEqual(m.slice(0, 3).map(i => i.value), [11, 10, 9]);
    assert.deepEqual(m.at(-1), { key: 'other', label: 'Overig', value: 1 + 2 + 3, other: true, members: 3 });
  });
  it('keeps a single leftover under its own name', () => {
    const m = mergeSlices(items.slice(0, 9), { top: 8, sort: true });
    assert.equal(m.length, 9);
    assert.equal(m.at(-1).key, 'k0');
  });
  it('merges slices under minPct, drops empty items, keeps order without sort', () => {
    const m = mergeSlices([{ key: 'a', value: 50 }, { key: 'b', value: 1 }, { key: 'c', value: 0 }, { key: 'd', value: null }, { key: 'e', value: 47 }, { key: 'f', value: 2 }], { minPct: 3 });
    assert.deepEqual(m.map(i => i.key), ['a', 'e', 'other']);
    assert.equal(m[2].value, 3);
  });
});

describe('donutSlices', () => {
  it('angles cover the full circle in order and percentages sum to 100', () => {
    const { total, slices } = donutSlices([{ key: 'a', value: 1 }, { key: 'b', value: 2 }, { key: 'c', value: 1 }]);
    assert.equal(total, 4);
    assert.equal(slices[0].a0, 0);
    assert.ok(Math.abs(slices.at(-1).a1 - TAU) < 1e-9);
    assert.ok(Math.abs(slices[1].a1 - slices[1].a0 - Math.PI) < 1e-9);
    assert.deepEqual(slices.map(s => s.pct), [25, 50, 25]);
    for (let i = 1; i < slices.length; i++) assert.equal(slices[i].a0, slices[i - 1].a1);
  });
  it('colours from the item, grey for Overig, else the palette', () => {
    const { slices } = donutSlices([{ key: 'a', value: 5, color: '#123456' }, { key: 'b', value: 4 }, { key: 'c', value: 1 }, { key: 'd', value: 1 }], { top: 2 });
    assert.deepEqual(slices.map(s => s.color), ['#123456', DONUT_PALETTE[0], OTHER_COLOR]);
  });
  it('an empty input yields no slices', () => {
    assert.deepEqual(donutSlices([{ key: 'a', value: 0 }]), { total: 0, slices: [] });
  });
});

describe('arcPath', () => {
  it('starts at 12 o\'clock and runs clockwise', () => {
    assert.deepEqual(polar(50, 50, 10, 0), [50, 40]);
    assert.deepEqual(polar(50, 50, 10, Math.PI / 2), [60, 50]);
  });
  it('draws a ring segment with the large-arc flag past half a circle', () => {
    assert.equal(arcPath(50, 50, 40, 20, 0, Math.PI / 2), 'M50 10A40 40 0 0 1 90 50L70 50A20 20 0 0 0 50 30Z');
    assert.match(arcPath(50, 50, 40, 20, 0, 1.5 * Math.PI), /A40 40 0 1 1 /);
  });
  it('draws a pie wedge without an inner radius, two rings for a full circle, nothing for an empty span', () => {
    assert.match(arcPath(50, 50, 40, 0, 0, 1), /^M50 50L50 10A40 40 0 0 1 /);
    const full = arcPath(50, 50, 40, 20, 0, TAU);
    assert.equal((full.match(/M/g) ?? []).length, 2);
    assert.equal(arcPath(50, 50, 40, 20, 1, 1), '');
    assert.equal(arcPath(50, 50, 40, 20, 2, 1), '');
  });
});

describe('donut compositions', () => {
  const wk = (code, name, v) => ({ code, name, values: v });
  const areas = [
    wk('WK1', 'Noord', { population: 300, lowEdu: 20, medEdu: 30, highEdu: 50, pop65plus: 10 }),
    wk('WK2', 'Zuid',  { population: 100, lowEdu: 60, medEdu: 30, highEdu: 10, pop65plus: 30 }),
    wk('WK3', 'Haven', { population: 0,   lowEdu: null, medEdu: null, highEdu: null, pop65plus: null }),
  ];
  it('educationMix is population-weighted and sums to 100', () => {
    const m = educationMix(areas);
    assert.deepEqual(m.map(i => i.key), ['lowEdu', 'medEdu', 'highEdu']);
    assert.deepEqual(m.map(i => i.value), [30, 30, 40]);
    assert.equal(educationMix([areas[2]]), null);
  });
  it('areaEducationMix needs all three levels', () => {
    assert.deepEqual(areaEducationMix(areas[1]).map(i => i.value), [60, 30, 10]);
    assert.equal(areaEducationMix(areas[2]), null);
  });
  it('shareSplit gives the weighted share and the rest', () => {
    assert.deepEqual(shareSplit(areas, 'pop65plus', '65+', 'Jonger').map(i => [i.key, i.value]), [['pop65plus', 15], ['rest', 85]]);
    assert.equal(shareSplit([areas[2]], 'pop65plus', '65+', 'Jonger'), null);
  });
  it('populationItems drops empty areas and keeps the code for clicks', () => {
    assert.deepEqual(populationItems(areas), [
      { key: 'WK1', code: 'WK1', label: 'Noord', value: 300 },
      { key: 'WK2', code: 'WK2', label: 'Zuid', value: 100 },
    ]);
  });
});
