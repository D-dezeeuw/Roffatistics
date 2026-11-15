import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizePatch, parseHash, serializeHash, resolveInitialState, getState, setState, onStateChange,
  initState, DEFAULT_STATE, SCOPE_STORAGE_KEY, CRIME_STORAGE_KEY,
} from '../modules/state.js';

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), map: m };
};

describe('state helpers', () => {
  it('defaults to Rotterdam, map view, Woonscore', () => {
    assert.deepEqual(DEFAULT_STATE, { scope: 'rotterdam', view: 'map', dataset: 'woonscore', area: null, crime: 'rate', score: null, listView: 'simple' });
  });

  it('sanitizePatch drops invalid values', () => {
    assert.deepEqual(sanitizePatch({ scope: 'mars', view: 'list', dataset: 'nope', area: 'wk059901', x: 1 }),
      { view: 'list', area: 'WK059901' });
    assert.deepEqual(sanitizePatch({ area: null }), { area: null });
    assert.deepEqual(sanitizePatch({ area: 'garbage' }), {});
  });

  it('parseHash / serializeHash round-trip', () => {
    const s = { scope: 'nederland', view: 'dashboard', dataset: 'woonscore', area: 'GM0599' };
    assert.equal(serializeHash(s), '#scope=nederland&view=dashboard&area=GM0599');
    assert.deepEqual(parseHash(serializeHash(s)), { scope: 'nederland', view: 'dashboard', area: 'GM0599' });
    assert.equal(serializeHash({ ...s, area: null }), '#scope=nederland&view=dashboard');
    assert.deepEqual(parseHash(''), {});
  });

  it('a non-default dataset round-trips through the hash; the Woonscore is left out', () => {
    const s = { scope: 'rotterdam', view: 'map', dataset: 'crimeRate', area: null };
    assert.equal(serializeHash(s), '#scope=rotterdam&view=map&dataset=crimeRate');
    assert.deepEqual(parseHash('#scope=rotterdam&view=map&dataset=crimeRate'), { scope: 'rotterdam', view: 'map', dataset: 'crimeRate' });
    assert.deepEqual(parseHash('#dataset=nope'), {});
    assert.equal(resolveInitialState({ hash: '#scope=nederland' }).dataset, 'woonscore');
    assert.equal(resolveInitialState({ hash: '#dataset=avgIncome' }).dataset, 'avgIncome');
  });

  it('initial state: hash beats storage beats defaults; broken storage is ignored', () => {
    assert.equal(resolveInitialState({ storage: memStorage({ [SCOPE_STORAGE_KEY]: 'nederland' }) }).scope, 'nederland');
    assert.equal(resolveInitialState({ hash: '#scope=rotterdam', storage: memStorage({ [SCOPE_STORAGE_KEY]: 'nederland' }) }).scope, 'rotterdam');
    const throwing = { getItem() { throw new Error('blocked'); } };
    assert.deepEqual(resolveInitialState({ storage: throwing }), { ...DEFAULT_STATE });
  });
});

describe('crime mode in the state', () => {
  it('accepts rate/abs only', () => {
    assert.deepEqual(sanitizePatch({ crime: 'abs' }), { crime: 'abs' });
    assert.deepEqual(sanitizePatch({ crime: 'rate' }), { crime: 'rate' });
    assert.deepEqual(sanitizePatch({ crime: 'per1000' }), {});
  });

  it('writes &crime=abs to the hash only in absolute mode and reads it back', () => {
    const s = { scope: 'rotterdam', view: 'map', area: null };
    assert.equal(serializeHash({ ...s, crime: 'rate' }), '#scope=rotterdam&view=map');
    assert.equal(serializeHash({ ...s, crime: 'abs' }), '#scope=rotterdam&view=map&crime=abs');
    assert.deepEqual(parseHash('#scope=rotterdam&view=map&crime=abs'), { scope: 'rotterdam', view: 'map', crime: 'abs' });
  });

  it('initial crime mode: hash beats localStorage beats the default', () => {
    assert.equal(resolveInitialState({}).crime, 'rate');
    assert.equal(resolveInitialState({ storage: memStorage({ [CRIME_STORAGE_KEY]: 'abs' }) }).crime, 'abs');
    assert.equal(resolveInitialState({ hash: '#crime=rate', storage: memStorage({ [CRIME_STORAGE_KEY]: 'abs' }) }).crime, 'rate');
  });

  it('persists a crime mode change in storage', () => {
    const storage = memStorage();
    initState({ hash: '', storage });
    setState({ crime: 'abs' });
    assert.equal(storage.map.get(CRIME_STORAGE_KEY), 'abs');
    setState({ crime: 'rate' });
    assert.equal(storage.map.get(CRIME_STORAGE_KEY), 'rate');
  });
});

describe('setState', () => {
  it('emits state-change with the changed keys, persists the scope, and unsubscribes', () => {
    const storage = memStorage();
    initState({ hash: '', storage });
    const events = [];
    const off = onStateChange(d => events.push(d));
    setState({ scope: 'nederland', dataset: 'avgIncome' }, { source: 'test' });
    setState({ scope: 'nederland' });                  // no change → no event
    setState({ view: 'bogus' });                       // invalid → no event
    off();
    setState({ view: 'list' });                        // after unsubscribe
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].changed.sort(), ['dataset', 'scope']);
    assert.equal(events[0].source, 'test');
    assert.equal(events[0].prev.scope, 'rotterdam');
    assert.equal(storage.map.get(SCOPE_STORAGE_KEY), 'nederland');
    assert.equal(getState().view, 'list');
  });

  it('getState returns a copy', () => {
    const s = getState();
    s.scope = 'mars';
    assert.notEqual(getState().scope, 'mars');
  });
});
