// Ranglijst Eenvoudig | Uitgebreid (15 Nov 2026): modules/list-view.js + the lv hash key.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { visibleColumns, visibleSort } from '../modules/list-view.js';
import { LAYER_KEYS, categoryOf, categoryDatasets, DATASETS } from '../modules/datasets.js';
import { parseHash, serializeHash, resolveInitialState, sanitizePatch, DEFAULT_STATE, LIST_VIEW_STORAGE_KEY } from '../modules/state.js';
import { buildShareHash, parseShareHash, SHARE_KEYS, partSummary } from '../modules/share-link.js';

const all = LAYER_KEYS.map(k => DATASETS[k]);
const keys = cols => cols.map(d => d.key);

describe('visibleColumns', () => {
  it('advanced returns every column, the ranking column first', () => {
    const cols = visibleColumns(all, { mode: 'adv', rankKey: 'avgIncome' });
    assert.equal(cols.length, all.length);
    assert.equal(cols[0].key, 'avgIncome');
    assert.deepEqual(keys(visibleColumns(all, { mode: 'adv', rankKey: 'overall' })), LAYER_KEYS);
  });
  it('simple shows only the category of the onderdeel, the onderdeel first', () => {
    const cat = categoryOf('avgIncome');
    const own = keys(categoryDatasets(cat));
    assert.ok(own.length > 1);
    const sub = own[own.length - 1];
    const cols = keys(visibleColumns(all, { mode: 'simple', rankKey: sub }));
    assert.equal(cols[0], sub);
    assert.deepEqual([...cols].sort(), [...own].sort());
    assert.ok(cols.every(k => categoryOf(k) === cat));
  });
  it('simple is the default mode and hides other categories', () => {
    const cols = keys(visibleColumns(all, { rankKey: 'crimeRate' }));
    assert.equal(cols[0], 'crimeRate');
    assert.ok(!cols.includes('avgIncome'));
    assert.ok(cols.length < all.length);
  });
  it('an explicit category keeps the ranking column first', () => {
    const cols = keys(visibleColumns(all, { mode: 'simple', category: 'opleiding', rankKey: 'avgIncome' }));
    assert.equal(cols[0], 'avgIncome');
    assert.ok(cols.slice(1).every(k => categoryOf(k) === 'opleiding'));
  });
  it('Totaalscore and Woonscore show one headline metric per category, no scores', () => {
    for (const rankKey of ['overall', 'woonscore']) {
      const cols = keys(visibleColumns(all, { mode: 'simple', rankKey }));
      assert.ok(cols.includes('crimeRate') && cols.includes('avgIncome') && cols.includes('highEdu'));
      assert.ok(cols.every(k => DATASETS[k].unit !== 'score'));
      assert.equal(new Set(cols.map(categoryOf)).size, cols.length);
    }
    assert.equal(visibleColumns(all, { mode: 'adv', rankKey: 'woonscore' })[0].key, 'woonscore');
  });
  it('only columns with data are shown', () => {
    const own = keys(categoryDatasets('opleiding'));
    const some = all.filter(d => d.key !== own[1]);
    assert.ok(!keys(visibleColumns(some, { rankKey: own[0] })).includes(own[1]));
  });
});

describe('visibleSort', () => {
  const cols = visibleColumns(all, { rankKey: 'crimeRate' });
  it('keeps a sort on a shown or fixed column', () => {
    for (const column of ['rank', 'name', 'overall', 'crimeRate']) assert.deepEqual(visibleSort({ column, dir: 'desc' }, cols), { column, dir: 'desc' });
  });
  it('falls back to the ranking order when the sort column is hidden', () => {
    assert.deepEqual(visibleSort({ column: 'avgIncome', dir: 'desc' }, cols), { column: 'rank', dir: 'asc' });
    assert.deepEqual(visibleSort({ column: 'avgIncome', dir: 'desc' }, []), { column: 'rank', dir: 'asc' });
  });
});

describe('lv in the state hash', () => {
  it('advanced round-trips as lv=adv; simple is the default and omitted', () => {
    const adv = serializeHash({ ...DEFAULT_STATE, listView: 'adv' });
    assert.match(adv, /(^#|&)lv=adv(&|$)/);
    assert.equal(parseHash(adv).listView, 'adv');
    assert.doesNotMatch(serializeHash({ ...DEFAULT_STATE }), /lv=/);
    assert.equal(DEFAULT_STATE.listView, 'simple');
  });
  it('old links and junk values decode as simple', () => {
    assert.equal(parseHash('#scope=rotterdam&view=list').listView, undefined);
    assert.equal(parseHash('#lv=foo').listView, undefined);
    assert.equal(resolveInitialState({ hash: '#scope=rotterdam&view=list' }).listView, 'simple');
    assert.deepEqual(sanitizePatch({ listView: 'x' }), {});
  });
  it('localStorage restores the choice; the hash wins', () => {
    const storage = { getItem: k => (k === LIST_VIEW_STORAGE_KEY ? 'adv' : null) };
    assert.equal(resolveInitialState({ storage }).listView, 'adv');
    const throwing = { getItem() { throw new Error('blocked'); } };
    assert.equal(resolveInitialState({ storage: throwing }).listView, 'simple');
  });
  it('the share link carries lv with the Ranglijst part only', () => {
    const snap = { state: { scope: 'rotterdam', view: 'list', listView: 'adv' }, list: { level: 'wijken', rankKey: 'overall', sort: { column: 'rank', dir: 'asc' } } };
    const on = Object.fromEntries(SHARE_KEYS.map(k => [k, true]));
    const h = buildShareHash(snap, on);
    assert.equal(parseShareHash(h).state.listView, 'adv');
    assert.doesNotMatch(buildShareHash(snap, { ...on, list: false }), /lv=/);
    assert.doesNotMatch(buildShareHash({ ...snap, state: { ...snap.state, listView: 'simple' } }, on), /lv=/);
    assert.match(partSummary(snap, 'list'), /uitgebreid/);
  });
});
