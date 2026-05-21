import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveZoomTier, interpolateColor } from '../modules/overlays.js';

describe('resolveZoomTier', () => {
  it('returns national at zoom ≤ 6', () => {
    assert.equal(resolveZoomTier(1), 'national');
    assert.equal(resolveZoomTier(5), 'national');
    assert.equal(resolveZoomTier(6), 'national');
  });

  it('returns province at zoom 7–9', () => {
    assert.equal(resolveZoomTier(7), 'province');
    assert.equal(resolveZoomTier(8), 'province');
    assert.equal(resolveZoomTier(9), 'province');
  });

  it('returns municipality at zoom 10–12', () => {
    assert.equal(resolveZoomTier(10), 'municipality');
    assert.equal(resolveZoomTier(11), 'municipality');
    assert.equal(resolveZoomTier(12), 'municipality');
  });

  it('returns buurt at zoom ≥ 13', () => {
    assert.equal(resolveZoomTier(13), 'buurt');
    assert.equal(resolveZoomTier(15), 'buurt');
    assert.equal(resolveZoomTier(17), 'buurt');
  });
});

describe('interpolateColor', () => {
  it('returns low color (#2e1065) at minimum value', () => {
    assert.equal(interpolateColor(0, 0, 100), '#2e1065');
  });

  it('returns high color (#ea580c) at maximum value', () => {
    assert.equal(interpolateColor(100, 0, 100), '#ea580c');
  });

  it('returns midpoint color at 50%', () => {
    // r = 46 + 0.5*(234-46) = 140 = 0x8c
    // g = 16 + 0.5*(88-16)  = 52  = 0x34
    // b = 101 + 0.5*(12-101) = 57 = 0x39
    assert.equal(interpolateColor(50, 0, 100), '#8c3439');
  });

  it('returns low color when min equals max', () => {
    assert.equal(interpolateColor(5, 5, 5), '#2e1065');
  });
});
