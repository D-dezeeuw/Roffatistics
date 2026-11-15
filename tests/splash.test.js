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
