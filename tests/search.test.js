import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pushRecent, loadRecent, saveRecent, resolveSelection, splitHighlight, RECENT_KEY, RECENT_MAX } from '../modules/search.js';

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), map: m };
};
const wijk = { code: 'WK059910', name: 'Kralingen-Crooswijk', level: 'wijk', scope: 'rotterdam', parent: 'GM0599' };
const gm   = { code: 'GM0344', name: 'Utrecht', level: 'gemeente', scope: 'nederland' };
const rdam = { code: 'GM0599', name: 'Rotterdam', level: 'gemeente', scope: 'nederland' };

describe('recent searches', () => {
  it('keeps the last five, newest first, unique by code', () => {
    let list = [];
    for (let i = 0; i < 7; i++) list = pushRecent(list, { code: `GM000${i}`, name: `G${i}`, level: 'gemeente', scope: 'nederland' });
    assert.equal(list.length, RECENT_MAX);
    assert.equal(list[0].code, 'GM0006');
    list = pushRecent(list, { code: 'GM0004', name: 'G4', level: 'gemeente', scope: 'nederland' });
    assert.equal(list[0].code, 'GM0004');
    assert.equal(list.filter(r => r.code === 'GM0004').length, 1);
  });
  it('round-trips through storage and survives junk or blocked storage', () => {
    const s = memStorage();
    saveRecent(s, pushRecent([], wijk));
    assert.deepEqual(loadRecent(s), [{ code: wijk.code, name: wijk.name, level: 'wijk', scope: 'rotterdam' }]);
    assert.deepEqual(loadRecent(memStorage({ [RECENT_KEY]: '{not json' })), []);
    assert.deepEqual(loadRecent(memStorage({ [RECENT_KEY]: '{"a":1}' })), []);
    const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    assert.deepEqual(loadRecent(blocked), []);
    assert.doesNotThrow(() => saveRecent(blocked, []));
    assert.deepEqual(loadRecent(null), []);
  });
});

describe('resolveSelection', () => {
  it('Rotterdam area → Rotterdam scope with the area', () => {
    const s = resolveSelection(wijk, { scope: 'nederland', view: 'map' });
    assert.deepEqual(s.patch, { scope: 'rotterdam', area: 'WK059910' });
    assert.equal(s.scopeChanged, true);
    assert.equal(s.toMap, false);
  });
  it('gemeente → Nederland scope', () => {
    assert.deepEqual(resolveSelection(gm, { scope: 'rotterdam', view: 'map' }).patch, { scope: 'nederland', area: 'GM0344' });
  });
  it('GM0599 → whole Rotterdam city', () => {
    const s = resolveSelection(rdam, { scope: 'nederland', view: 'list' });
    assert.deepEqual(s.patch, { scope: 'rotterdam', area: null });
    assert.equal(s.wholeCity, true);
    assert.equal(s.highlight, false);
  });
  it('dashboard switches to the map; list highlights', () => {
    assert.equal(resolveSelection(gm, { scope: 'nederland', view: 'dashboard' }).toMap, true);
    const l = resolveSelection(wijk, { scope: 'rotterdam', view: 'list' });
    assert.equal(l.highlight, true);
    assert.equal(l.scopeChanged, false);
  });
});

describe('splitHighlight', () => {
  it('splits text around ranges', () => {
    assert.deepEqual(splitHighlight('Zuid-Holland', [[0, 4], [5, 12]]),
      [{ text: 'Zuid', hit: true }, { text: '-', hit: false }, { text: 'Holland', hit: true }]);
    assert.deepEqual(splitHighlight('Delft', []), [{ text: 'Delft', hit: false }]);
  });
});
