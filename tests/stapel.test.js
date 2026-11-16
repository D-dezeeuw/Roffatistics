import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STACK_KEY, parseStack, serializeStack, normalizeStack, defaultDirection, isStackable, stackValues,
  setActiveStack, getActiveStack, assignStack, assignStackRows, stackResult, stackUsesCrime,
  stackNote, stackItemText, stackDraftStatus, stackLegendHtml,
} from '../modules/stapel.js';
import { DATASETS, LAYER_KEYS, crimeAreas } from '../modules/datasets.js';
import { sanitizePatch, parseHash, serializeHash, resolveInitialState, STACK_STORAGE_KEY, DEFAULT_STATE } from '../modules/state.js';

const area = (code, values) => ({ code, name: code, values });

describe('stapel: directions and parsing', () => {
  it('defaults: WOZ lager is beter, crime lager, income hoger, herkomst none', () => {
    assert.equal(defaultDirection('wozValue'), 'l');
    assert.equal(defaultDirection('crimeRate'), 'l');
    assert.equal(defaultDirection('avgIncome'), 'h');
    assert.equal(defaultDirection('originDutchPct'), null);
    assert.equal(defaultDirection('woonscore'), 'h');
  });

  it('stackable: layers incl. the Woonscore, never live layers or the stack itself', () => {
    assert.ok(isStackable('woonscore'));
    assert.ok(isStackable('wozValue'));
    assert.ok(!isStackable(STACK_KEY));
    assert.ok(!isStackable('p2000Totaal'));
    assert.ok(!isStackable('nope'));
  });

  it('round-trips key, direction and weight', () => {
    const spec = 'wozValue.l,crimeRate.l2,distGroen.h3';
    assert.deepEqual(parseStack(spec), [
      { key: 'wozValue', dir: 'l', weight: 1 }, { key: 'crimeRate', dir: 'l', weight: 2 }, { key: 'distGroen', dir: 'h', weight: 3 },
    ]);
    assert.equal(serializeStack(parseStack(spec)), spec);
    assert.equal(normalizeStack('wozValue,avgIncome'), 'wozValue.l,avgIncome.h');
  });

  it('drops unknown, live, duplicate, malformed and undirected neutral items; < 2 valid → null', () => {
    assert.equal(normalizeStack('wozValue.l,bogus.h,p2000Totaal.h,wozValue.h,crime Rate.l,originDutchPct,avgIncome.x9,crimeRate.l'), 'wozValue.l,crimeRate.l');
    assert.equal(parseStack('wozValue.l'), null);
    assert.equal(parseStack('wozValue.l,originDutchPct'), null);
    assert.equal(parseStack(''), null);
    assert.equal(parseStack(null), null);
    assert.equal(serializeStack([{ key: 'wozValue', dir: 'l', weight: 1 }, { key: 'originDutchPct', dir: null, weight: 1 }]), null);
    assert.equal(serializeStack([{ key: 'wozValue', dir: 'l', weight: 7 }, { key: 'originDutchPct', dir: 'h', weight: 2 }]), 'wozValue.l,originDutchPct.h2');
  });

  it('keeps at most 6 layers', () => {
    const keys = LAYER_KEYS.filter(k => DATASETS[k].higherIsBetter != null && isStackable(k)).slice(0, 8);
    assert.equal(parseStack(keys.join(',')).length, 6);
  });
});

describe('stapel: values', () => {
  const areas = [
    area('A', { wozValue: 100, crimeRate: 10, totalCrimes: 500 }),
    area('B', { wozValue: 200, crimeRate: 20, totalCrimes: 100 }),
    area('C', { wozValue: 300, crimeRate: 30, totalCrimes: 300 }),
  ];

  it('direction: lager is beter turns the percentile around', () => {
    const r = stackValues(areas, parseStack('wozValue.l,crimeRate.l'));
    assert.deepEqual(r.map(x => x.value), [100, 50, 0]);
    const h = stackValues(areas, parseStack('wozValue.h,crimeRate.l'));
    assert.deepEqual(h.map(x => x.value), [50, 50, 50]);
  });

  it('weights: weighted mean of the scores', () => {
    const r = stackValues(areas, parseStack('wozValue.h3,crimeRate.l'));
    // A: woz 0 ×3 + crime 100 ×1 → 25; C: 100 ×3 + 0 → 75
    assert.deepEqual(r.map(x => x.value), [25, 50, 75]);
    assert.equal(r[0].weightTotal, 4);
    assert.deepEqual(r[0].parts.map(p => [p.key, p.raw, p.score]), [['wozValue', 100, 0], ['crimeRate', 10, 100]]);
  });

  it('coverage: needs half of the weight (rounded up), else geen data', () => {
    const list = [area('A', { wozValue: 100, avgIncome: 30 }), area('B', { wozValue: 200 }), area('C', { avgIncome: 40 })];
    const even = stackValues(list, parseStack('wozValue.h,avgIncome.h'));       // need 1 of 2
    assert.ok(even.every(x => x.value != null));
    const heavy = stackValues(list, parseStack('wozValue.h,avgIncome.h3'));     // need 2 of 4
    assert.equal(heavy[1].value, null);   // only woz (1)
    assert.notEqual(heavy[2].value, null);   // income (3)
    const odd = stackValues(list, parseStack('wozValue.h,avgIncome.h,crimeRate.l'));   // need 2 of 3, nobody has crime
    assert.deepEqual(odd.map(x => x.value == null), [false, true, true]);
  });

  it('crime mode: Absoluut ranks on the counts', () => {
    const r = stackValues(areas, parseStack('wozValue.h,crimeRate.l'), { mode: 'abs' });
    // abs counts 500/100/300: B safest
    assert.deepEqual(r.map(x => x.parts[1].raw), [500, 100, 300]);
    assert.deepEqual(r.map(x => x.parts[1].score), [0, 100, 50]);
    assert.ok(stackUsesCrime(parseStack('wozValue.h,crimeRate.l')));
    assert.ok(!stackUsesCrime(parseStack('wozValue.h,avgIncome.h')));
  });

  it('flat CBS rows and in-place assignment; no stack → null', () => {
    setActiveStack('wozValue.l,avgIncome.h');
    const rows = [{ regionCode: 'GM0001', wozValue: 100, avgIncome: 40 }, { regionCode: 'GM0002', wozValue: 300, avgIncome: 20 }];
    assignStackRows(rows);
    assert.deepEqual(rows.map(r => r.stapel), [100, 0]);
    assert.equal(stackResult('GM0001').parts.length, 2);
    const list = [area('WK1', { wozValue: 1, avgIncome: 2 }), area('WK2', { wozValue: 2, avgIncome: 1 })];
    assignStack(list);
    assert.deepEqual(list.map(a => a.values.stapel), [100, 0]);
    setActiveStack(null);
    assignStack(list);
    assert.deepEqual(list.map(a => a.values.stapel), [null, null]);
    assert.equal(stackResult('WK1'), null);
    assert.equal(getActiveStack(), null);
  });

  it('the Absoluut copies follow a new stack value', () => {
    setActiveStack('wozValue.l,crimeRate.l');
    const list = [area('WK1', { wozValue: 1, crimeRate: 1, totalCrimes: 2 }), area('WK2', { wozValue: 2, crimeRate: 2, totalCrimes: 1 })];
    assert.equal(crimeAreas(list, 'abs')[0].values.stapel, undefined);
    assignStack(list);
    assert.equal(crimeAreas(list, 'abs')[0].values.stapel, 100);
    setActiveStack(null);
  });
});

describe('stapel: texts', () => {
  it('item text, tooltip note, draft status', () => {
    assert.equal(stackItemText({ key: 'wozValue', dir: 'l', weight: 2 }), '↓ WOZ waarde ×2');
    assert.equal(stackNote({ parts: [{ key: 'wozValue', score: 71.6 }, { key: 'crimeRate', score: null }] }), 'WOZ waarde 72 · Misdrijven totaal –');
    assert.equal(stackDraftStatus([{ key: 'wozValue', dir: 'l' }]).valid, false);
    const s = stackDraftStatus([{ key: 'wozValue', dir: 'l' }, { key: 'originDutchPct', dir: null }, { key: 'crimeRate', dir: 'l' }]);
    assert.equal(s.valid, false);
    assert.match(s.text, /^3 lagen · kies een richting voor Nederland \(%\)/);
    assert.ok(stackDraftStatus([{ key: 'wozValue', dir: 'l' }, { key: 'originDutchPct', dir: 'h' }]).valid);
  });

  it('legend: list + Bewerken on the stack, + Stapel elsewhere, nothing on live layers', () => {
    const items = parseStack('wozValue.l2,avgIncome.h');
    const html = stackLegendHtml(items, STACK_KEY);
    assert.match(html, /↓<\/span> WOZ waarde <small>×2<\/small>/);
    assert.match(html, /data-stack-open/);
    assert.match(stackLegendHtml(null, STACK_KEY), /Stapel samenstellen/);
    assert.match(stackLegendHtml(items, 'crimeRate'), /data-stack-add="crimeRate"/);
    assert.match(stackLegendHtml(items, 'wozValue'), /In je stapel/);
    assert.equal(stackLegendHtml(items, 'p2000Totaal'), '');
  });
});

describe('stapel: state, URL and storage', () => {
  it('sanitizes, parses and serializes &stack= with readable commas', () => {
    assert.equal(DEFAULT_STATE.stack, null);
    assert.deepEqual(sanitizePatch({ stack: 'wozValue,crimeRate.l2' }), { stack: 'wozValue.l,crimeRate.l2' });
    assert.deepEqual(sanitizePatch({ stack: 'wozValue' }), { stack: null });
    assert.deepEqual(sanitizePatch({ stack: '' }), { stack: null });
    assert.equal(parseHash('#scope=rotterdam&view=map&stack=wozValue.l,crimeRate.l2').stack, 'wozValue.l,crimeRate.l2');
    assert.equal(parseHash('#scope=rotterdam&view=map&stack=wozValue.l%2CcrimeRate.l2').stack, 'wozValue.l,crimeRate.l2');
    const hash = serializeHash({ ...DEFAULT_STATE, dataset: STACK_KEY, stack: 'wozValue.l,crimeRate.l2' }, undefined, 'rotterdam');
    assert.equal(hash, '#scope=rotterdam&view=map&dataset=stapel&stack=wozValue.l,crimeRate.l2');
    assert.ok(!serializeHash(DEFAULT_STATE, undefined, 'rotterdam').includes('stack'));
  });

  it('restores the stored stack when the hash has none; the hash wins', () => {
    const store = new Map([[STACK_STORAGE_KEY, 'wozValue.l,avgIncome.h']]);
    const storage = { getItem: k => store.get(k) ?? null };
    assert.equal(resolveInitialState({ hash: '', storage }).stack, 'wozValue.l,avgIncome.h');
    assert.equal(resolveInitialState({ hash: '#stack=crimeRate.l,avgIncome.h2', storage }).stack, 'crimeRate.l,avgIncome.h2');
    assert.equal(resolveInitialState({ hash: '', storage: { getItem: () => 'junk' } }).stack, null);
  });
});

describe('stapel: dataset entry', () => {
  it('is a layer under the Woonscore, outside the Totaalscore', () => {
    const d = DATASETS[STACK_KEY];
    assert.equal(d.group, 'score');
    assert.equal(d.inOverall, false);
    assert.equal(LAYER_KEYS.indexOf(STACK_KEY), LAYER_KEYS.indexOf('woonscore') + 1);
  });
});

beforeEach(() => setActiveStack(null));
