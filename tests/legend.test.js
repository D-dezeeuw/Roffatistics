import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatLegendValue } from '../modules/legend.js';

describe('formatLegendValue', () => {
  it('formats millions with one decimal', () => {
    assert.equal(formatLegendValue(3_800_000, 'population'), '3.8M');
  });

  it('formats thousands as rounded k', () => {
    assert.equal(formatLegendValue(596075, 'population'), '596k');
  });

  it('formats small numbers as plain string', () => {
    assert.equal(formatLegendValue(42, 'population'), '42');
  });

  it('formats avgIncome with euro and k suffix', () => {
    assert.equal(formatLegendValue(37.5, 'avgIncome'), '€37.5k');
  });

  it('returns dash for null', () => {
    assert.equal(formatLegendValue(null, 'population'), '—');
  });
});
