import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPARE_SIZE, levelLabel, decodeCmp, encodeCmp, sanitizeCmp, slotsFromCmp,
  fillSlot, clearSlot, compareKeys, markRow, compareRows, routeToCompare, COMPARE_ADD_EVENT,
} from '../modules/compare.js';
import { parseHash, serializeHash, sanitizePatch, DEFAULT_STATE } from '../modules/state.js';
import { buildShareHash, parseShareHash, availableParts, SHARE_KEYS } from '../modules/share-link.js';

const empty = () => Array(COMPARE_SIZE).fill(null);

describe('compare: slot filling (FIFO)', () => {
  it('fills the first empty column', () => {
    let s = empty();
    ({ slots: s } = fillSlot(s, 'WK059901'));
    const r = fillSlot(s, 'bu05990110');
    assert.equal(r.index, 1);
    assert.equal(r.added, true);
    assert.deepEqual(r.slots.map(x => x?.code ?? null), ['WK059901', 'BU05990110', null]);
  });

  it('refills an emptied column before replacing anything', () => {
    let s = empty();
    for (const c of ['GM0599', 'GM0363', 'GM0518']) s = fillSlot(s, c).slots;
    s = clearSlot(s, 1);
    const r = fillSlot(s, 'PV28');
    assert.equal(r.index, 1);
    assert.deepEqual(r.slots.map(x => x.code), ['GM0599', 'PV28', 'GM0518']);
  });

  it('replaces the column filled longest ago when full, in place', () => {
    let s = empty();
    for (const c of ['GM0599', 'GM0363', 'GM0518']) s = fillSlot(s, c).slots;
    let r = fillSlot(s, 'GM0344');
    assert.equal(r.index, 0);
    r = fillSlot(r.slots, 'GM0014');
    assert.equal(r.index, 1);
    assert.deepEqual(r.slots.map(x => x.code), ['GM0344', 'GM0014', 'GM0518']);
  });

  it('leaves the set alone for a code already shown or an invalid code', () => {
    const s = fillSlot(empty(), 'WK059901').slots;
    assert.deepEqual(fillSlot(s, 'WK059901'), { slots: s, index: 0, added: false });
    assert.equal(fillSlot(s, 'nope').added, false);
  });
});

describe('compare: hash form', () => {
  it('encodes per column with empties and drops trailing empties', () => {
    assert.equal(encodeCmp(['WK059901', null, 'BU05990110']), 'WK059901..BU05990110');
    assert.equal(encodeCmp([{ code: 'GM0599', seq: 0 }, null, null]), 'GM0599');
    assert.equal(encodeCmp(empty()), '');
  });

  it('decodes positions, accepts commas, drops invalid and repeated codes', () => {
    assert.deepEqual(decodeCmp('WK059901..BU05990110'), ['WK059901', null, 'BU05990110']);
    assert.deepEqual(decodeCmp('gm0599,xx,GM0599,PV28'), ['GM0599', null, null]);
    assert.deepEqual(decodeCmp(''), [null, null, null]);
    assert.equal(sanitizeCmp('foo'), null);
    assert.equal(sanitizeCmp('pv28.gm0599'), 'PV28.GM0599');
  });

  it('rebuilds slots with the left column as the oldest', () => {
    const s = slotsFromCmp('GM0599.GM0363.GM0518');
    assert.equal(fillSlot(s, 'PV28').index, 0);
  });

  it('rides in the address-bar hash (state.js)', () => {
    assert.equal(parseHash('#scope=nederland&cmp=GM0599..WK059901').cmp, 'GM0599..WK059901');
    assert.equal(parseHash('#cmp=garbage').cmp, null);
    assert.equal(sanitizePatch({ cmp: '' }).cmp, null);
    assert.match(serializeHash({ ...DEFAULT_STATE, cmp: 'GM0599.PV28' }), /cmp=GM0599\.PV28/);
    assert.doesNotMatch(serializeHash({ ...DEFAULT_STATE }), /cmp=/);
  });

  it('is an optional part of the share link', () => {
    assert.ok(SHARE_KEYS.includes('cmp'));
    const snap = { state: { ...DEFAULT_STATE, cmp: 'GM0599.PV28' } };
    assert.equal(availableParts(snap).cmp, true);
    assert.match(buildShareHash(snap, { scope: true, cmp: true }), /cmp=GM0599\.PV28/);
    assert.doesNotMatch(buildShareHash(snap, { scope: true }), /cmp=/);
    assert.equal(parseShareHash('#cmp=GM0599.PV28').state.cmp, 'GM0599.PV28');
  });
});

describe('compare: rows and marking', () => {
  it('level label from the code', () => {
    assert.deepEqual(['PV28', 'GM0599', 'WK059901', 'BU05990110', 'X'].map(levelLabel), ['Provincie', 'Gemeente', 'Wijk', 'Buurt', '']);
  });

  it('marks best and worst by direction; none without a direction or a spread', () => {
    assert.deepEqual(markRow([10, 30, 20], true), ['worst', 'best', null]);
    assert.deepEqual(markRow([10, 30, null], false), ['best', 'worst', null]);
    assert.deepEqual(markRow([10, 30], null), [null, null]);
    assert.deepEqual(markRow([5, 5, 5], true), [null, null, null]);
    assert.deepEqual(markRow([5, null, null], true), [null, null, null]);
  });

  it('one headline row per category, Woonscore first; the active layer is marked or added', () => {
    const keys = compareKeys('woonscore');
    assert.equal(keys[0].key, 'woonscore');
    assert.equal(keys[0].active, true);
    assert.ok(keys.some(k => k.key === 'crimeRate'));
    assert.equal(new Set(keys.map(k => k.key)).size, keys.length);
    const extra = compareKeys('density');
    assert.equal(extra[0].key, 'density');
    assert.equal(extra[0].active, true);
    assert.equal(extra.length, keys.length + 1);
  });

  it('builds values and marks per column, empty columns stay null', () => {
    const areas = [{ values: { woonscore: 70, crimeRate: 40 } }, null, { values: { woonscore: 50, crimeRate: 20 } }];
    const rows = compareRows(areas, { dataset: 'woonscore' });
    const ws = rows.find(r => r.key === 'woonscore');
    assert.deepEqual(ws.values, [70, null, 50]);
    assert.deepEqual(ws.marks, ['best', null, 'worst']);
    const cr = rows.find(r => r.key === 'crimeRate');
    assert.deepEqual(cr.marks, ['worst', null, 'best']);
  });
});

describe('compare: map click routing', () => {
  const fakeDoc = open => {
    const sent = [];
    return { sent, getElementById: () => ({ classList: { contains: c => open && c === 'panel-open' } }), dispatchEvent: e => sent.push(e) };
  };
  it('panel open: the click becomes a compare-add event', () => {
    const doc = fakeDoc(true);
    assert.equal(routeToCompare('GM0599', doc), true);
    assert.equal(doc.sent[0].type, COMPARE_ADD_EVENT);
    assert.deepEqual(doc.sent[0].detail, { code: 'GM0599' });
  });
  it('panel closed: the caller keeps its own behaviour (modal)', () => {
    const doc = fakeDoc(false);
    assert.equal(routeToCompare('GM0599', doc), false);
    assert.equal(doc.sent.length, 0);
  });
});
