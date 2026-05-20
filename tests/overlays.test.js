import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveZoomTier } from '../modules/overlays.js';

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

  it('returns municipality at zoom ≥ 10', () => {
    assert.equal(resolveZoomTier(10), 'municipality');
    assert.equal(resolveZoomTier(15), 'municipality');
    assert.equal(resolveZoomTier(17), 'municipality');
  });
});
