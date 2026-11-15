// modules/postcode.js: normalising, the PC4 ↔ buurt crosswalk, allocation and roll-up (v0.25.0).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePc4, isPostcodeQuery, bareCode, codeLevel, parentAt, withPrefix,
  createCrosswalk, addAddresses, crosswalkToJson, crosswalkFromJson,
  areasForPc4, pc4ToArea, pc4sForArea, allocate, rollUp,
} from '../modules/postcode.js';

// 3011: 60 addresses in buurt AB01, 30 in AB02 (same wijk), 10 in CD01 (other wijk).
// 3012: all 50 in CD01. 1011: Amsterdam-style alphanumeric code.
const cw = () => {
  const c = createCrosswalk();
  addAddresses(c, '3011', '0599AB01', 60);
  addAddresses(c, '3011 XY', 'BU0599AB02', 30);
  addAddresses(c, 'PC3011', '0599CD01', 10);
  addAddresses(c, '3012', '0599CD01', 50);
  addAddresses(c, '1011', '0363AF01', 7);
  return c;
};
const sumOf = o => Object.values(o).reduce((s, v) => s + v, 0);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

describe('normalizePc4', () => {
  it('accepts spaces, lower case letters, the CBS PC prefix and numbers', () => {
    for (const s of ['3011 AB', '3011ab', '3011AB', 'PC3011  ', ' 3011 ', 'pc 3011', 3011]) assert.equal(normalizePc4(s), '3011', String(s));
  });
  it('rejects what is not a Dutch postcode', () => {
    for (const s of [null, undefined, '', '0123', '301', '30111', '3011 ABC', '3011-AB', 'NL01', 'abcd']) assert.equal(normalizePc4(s), null, String(s));
  });
  it('isPostcodeQuery allows half-typed letters', () => {
    for (const s of ['3011', '3011 a', '3011AB', ' pc3011 ']) assert.ok(isPostcodeQuery(s), s);
    for (const s of ['Delfshaven', '30', '3011 abc', 'BU0599']) assert.ok(!isPostcodeQuery(s), s);
  });
});

describe('codes with and without prefix', () => {
  it('bareCode / codeLevel / parentAt / withPrefix', () => {
    assert.equal(bareCode('bu0363af01'), '0363AF01');
    assert.equal(codeLevel('BU0599AB01'), 'buurt');
    assert.equal(codeLevel('0599AB'), 'wijk');
    assert.equal(codeLevel('GM0599'), 'gemeente');
    assert.equal(codeLevel('X'), null);
    assert.equal(parentAt('BU0363AF01', 'wijk'), 'WK0363AF');
    assert.equal(parentAt('0363AF01', 'wijk'), '0363AF');
    assert.equal(parentAt('BU0363AF01', 'gemeente'), 'GM0363');
    assert.equal(parentAt('WK0363AF', 'gemeente'), 'GM0363');
    assert.equal(parentAt('GM0363', 'wijk'), null);
    assert.equal(withPrefix('0363AF01'), 'BU0363AF01');
    assert.equal(withPrefix('WK0363AF'), 'WK0363AF');
  });
});

describe('crosswalk', () => {
  it('counts addresses per (PC4, buurt) and ignores invalid input', () => {
    const c = cw();
    addAddresses(c, 'xx', '0599AB01', 5);
    addAddresses(c, '3011', 'short', 5);
    addAddresses(c, '3011', '0599AB01', 0);
    assert.equal(c.size, 3);
    assert.deepEqual([...c.get('3011')], [['0599AB01', 60], ['0599AB02', 30], ['0599CD01', 10]]);
  });
  it('round-trips through the compact JSON', () => {
    const json = crosswalkToJson(cw(), { built: 'x' });
    assert.equal(json.format, 1);
    assert.deepEqual(json.buurten, ['0363AF01', '0599AB01', '0599AB02', '0599CD01']);
    assert.deepEqual(json.pc['3011'], [1, 60, 2, 30, 3, 10]);
    assert.deepEqual(crosswalkFromJson(JSON.parse(JSON.stringify(json))), cw());
    assert.throws(() => crosswalkFromJson({ format: 9 }));
  });
  it('areasForPc4 weights by address count at every level', () => {
    const b = areasForPc4(cw(), '3011 AB');
    assert.deepEqual(b.map(a => [a.code, a.n]), [['0599AB01', 60], ['0599AB02', 30], ['0599CD01', 10]]);
    close(sumOf(Object.fromEntries(b.map(a => [a.code, a.weight]))), 1);
    assert.deepEqual(areasForPc4(cw(), '3011', 'wijk', { prefixed: true }).map(a => [a.code, a.weight]), [['WK0599AB', 0.9], ['WK0599CD', 0.1]]);
    assert.deepEqual(areasForPc4(cw(), '3011', 'gemeente').map(a => a.code), ['0599']);
    assert.deepEqual(areasForPc4(cw(), '9999'), []);
  });
  it('pc4ToArea gives the dominant area; accept() skips areas', () => {
    assert.equal(pc4ToArea(cw(), '3011'), '0599AB01');
    assert.equal(pc4ToArea(cw(), '3011', 'buurt', { prefixed: true }), 'BU0599AB01');
    assert.equal(pc4ToArea(cw(), '3011', 'wijk'), '0599AB');
    assert.equal(pc4ToArea(cw(), '3011', 'buurt', { accept: c => c !== '0599AB01' }), '0599AB02');
    assert.equal(pc4ToArea(cw(), '1011', 'gemeente', { prefixed: true }), 'GM0363');
    assert.equal(pc4ToArea(cw(), '9999'), null);
  });
  it('pc4sForArea lists the postcodes of a buurt, wijk or gemeente (any prefix)', () => {
    assert.deepEqual(pc4sForArea(cw(), 'BU0599CD01').map(p => [p.pc4, p.n]), [['3012', 50], ['3011', 10]]);
    assert.deepEqual(pc4sForArea(cw(), '0599AB').map(p => [p.pc4, p.n]), [['3011', 90]]);
    const gm = pc4sForArea(cw(), 'GM0599');
    assert.deepEqual(gm.map(p => p.pc4), ['3011', '3012']);
    close(gm[0].weight + gm[1].weight, 1);
    assert.deepEqual(pc4sForArea(cw(), 'nonsense'), []);
  });
});

describe('allocate and rollUp conserve totals', () => {
  it('splits plain counts by address share; unknown postcodes are unallocated', () => {
    const { byBuurt, unallocated } = allocate({ 3011: 1000, 'PC3012': 200, 9999: 40 }, cw());
    close(byBuurt['0599AB01'], 600);
    close(byBuurt['0599AB02'], 300);
    close(byBuurt['0599CD01'], 100 + 200);
    assert.equal(unallocated, 40);
    close(sumOf(byBuurt) + unallocated, 1240);
  });
  it('splits group objects; every group is conserved through buurt → wijk → gemeente', () => {
    const input = { 3011: { total: 1000, suriname: 115 }, 3012: { total: 205, suriname: 15 }, 1011: { total: 70, suriname: 0 } };
    const { byBuurt } = allocate(input, cw());
    const wijk = rollUp(byBuurt, 'wijk'), gem = rollUp(byBuurt, 'gemeente');
    for (const g of ['total', 'suriname']) {
      const want = Object.values(input).reduce((s, v) => s + v[g], 0);
      for (const level of [byBuurt, wijk, gem]) close(Object.values(level).reduce((s, v) => s + v[g], 0), want);
    }
    assert.deepEqual(Object.keys(wijk).sort(), ['0363AF', '0599AB', '0599CD']);
    assert.deepEqual(Object.keys(gem).sort(), ['0363', '0599']);
    close(wijk['0599AB'].suriname, 115 * 0.9);
  });
  it('rollUp keeps the prefix style and refuses other levels', () => {
    assert.deepEqual(rollUp({ BU0599AB01: 2, BU0599AB02: 3, BU0363AF01: 1 }, 'wijk'), { WK0599AB: 5, WK0363AF: 1 });
    assert.deepEqual(rollUp({ BU0599AB01: 2, BU0363AF01: 1 }, 'gemeente'), { GM0599: 2, GM0363: 1 });
    assert.throws(() => rollUp({}, 'buurt'));
  });
});
