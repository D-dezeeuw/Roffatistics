import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowSplash, rememberSplashChoice, SPLASH_STORAGE_KEY } from '../modules/splash.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

describe('shouldShowSplash', () => {
  it('shows on a first visit', () => {
    assert.equal(shouldShowSplash(memStorage()), true);
  });

  it('hides once "Niet meer tonen" was stored', () => {
    const s = memStorage();
    s.setItem(SPLASH_STORAGE_KEY, '1');
    assert.equal(shouldShowSplash(s), false);
  });

  it('shows when storage is missing or throws', () => {
    assert.equal(shouldShowSplash(null), true);
    assert.equal(shouldShowSplash(undefined), true);
    assert.equal(shouldShowSplash({ getItem() { throw new Error('SecurityError'); } }), true);
  });
});

describe('rememberSplashChoice', () => {
  it('round-trips the choice', () => {
    const s = memStorage();
    rememberSplashChoice(s, true);
    assert.equal(shouldShowSplash(s), false);
    rememberSplashChoice(s, false);
    assert.equal(shouldShowSplash(s), true);
  });

  it('swallows storage errors', () => {
    const bad = { setItem() { throw new Error('QuotaExceeded'); }, removeItem() { throw new Error('x'); } };
    assert.doesNotThrow(() => rememberSplashChoice(bad, true));
    assert.doesNotThrow(() => rememberSplashChoice(bad, false));
    assert.doesNotThrow(() => rememberSplashChoice(null, true));
  });
});

import { splashTarget, splashPatches } from '../modules/splash.js';

describe('splashTarget: search result → Ranglijst state', () => {
  it('Rotterdam wijk: Rotterdam scope, Wijken, highlighted and modal', () => {
    assert.deepEqual(splashTarget({ code: 'WK059901', level: 'wijk', scope: 'rotterdam' }),
      { view: 'list', scope: 'rotterdam', level: 'wijken', area: 'WK059901', highlight: 'WK059901', modal: 'WK059901' });
  });
  it('Rotterdam buurt (also from a postcode hit): Buurten', () => {
    const t = splashTarget({ code: 'BU05990110', level: 'buurt', scope: 'rotterdam', postcode: '3011' });
    assert.equal(t.scope, 'rotterdam');
    assert.equal(t.level, 'buurten');
    assert.equal(t.area, 'BU05990110');
    assert.equal(t.modal, 'BU05990110');
  });
  it('gemeente: Nederland scope, Gemeenten, opens its modal (15 Nov 2026)', () => {
    assert.deepEqual(splashTarget({ code: 'GM0363', level: 'gemeente', scope: 'nederland' }),
      { view: 'list', scope: 'nederland', level: 'gemeenten', area: 'GM0363', highlight: 'GM0363', modal: 'GM0363' });
  });
  it('provincie: Nederland scope, Provincies', () => {
    const t = splashTarget({ code: 'PV27', level: 'provincie', scope: 'nederland' });
    assert.equal(t.level, 'provincies');
    assert.equal(t.highlight, 'PV27');
    assert.equal(t.modal, 'PV27');
  });
  it('NL wijk/buurt (postcode): its gemeente row in the list, the modal for the area itself', () => {
    for (const code of ['WK036305', 'BU03630501']) {
      const t = splashTarget({ code, scope: 'nederland' });
      assert.equal(t.scope, 'nederland');
      assert.equal(t.level, 'gemeenten');
      assert.equal(t.area, 'GM0363');
      assert.equal(t.highlight, 'GM0363');
      assert.equal(t.modal, code);
    }
  });
  it('alphanumeric NL codes (Amsterdam WK0363AA) map to their gemeente', () => {
    const t = splashTarget({ code: 'WK0363AA', scope: 'nederland' });
    assert.equal(t.area, 'GM0363');
    assert.equal(t.modal, 'WK0363AA');
  });
  it('GM0599 is the whole city: Rotterdam wijken, nothing selected', () => {
    const t = splashTarget({ code: 'GM0599', level: 'gemeente', scope: 'nederland' });
    assert.equal(t.scope, 'rotterdam');
    assert.equal(t.level, 'wijken');
    assert.equal(t.area, null);
    assert.equal(t.modal, null);
  });
  it('unknown or missing codes give null', () => {
    assert.equal(splashTarget(null), null);
    assert.equal(splashTarget({ code: 'XX12' }), null);
    assert.equal(splashTarget({}), null);
  });
});

describe('splashPatches', () => {
  const t = splashTarget({ code: 'WK059901' });
  it('one patch: scope, view=list, area', () => {
    assert.deepEqual(splashPatches(t, { scope: 'nederland', view: 'map', area: null }),
      [{ scope: 'rotterdam', view: 'list', area: 'WK059901' }]);
  });
  it('re-picking the selected area clears it first so the list still reacts', () => {
    assert.deepEqual(splashPatches(t, { scope: 'rotterdam', view: 'map', area: 'WK059901' }),
      [{ area: null }, { scope: 'rotterdam', view: 'list', area: 'WK059901' }]);
  });
  it('no target, no patches', () => {
    assert.deepEqual(splashPatches(null, {}), []);
  });
});
