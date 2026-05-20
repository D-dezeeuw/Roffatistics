import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPanelData } from '../modules/panel.js';

describe('formatPanelData', () => {
  const data = { population: 596075, density: 202, avgIncome: 37.5 };

  it('formats income with euro and k suffix', () => {
    assert.equal(formatPanelData(data).avgIncome, '€37.5k');
  });

  it('formats density with /km² suffix', () => {
    const result = formatPanelData(data);
    assert.ok(result.density.endsWith('/km²'));
    assert.ok(result.density.includes('202'));
  });

  it('includes population value', () => {
    const result = formatPanelData(data);
    assert.ok(result.population.includes('596'));
  });

  it('returns dashes for null data', () => {
    const result = formatPanelData(null);
    assert.equal(result.population, '—');
    assert.equal(result.density,    '—');
    assert.equal(result.avgIncome,  '—');
  });

  it('returns dashes for missing individual fields', () => {
    const result = formatPanelData({ population: null, density: null, avgIncome: null });
    assert.equal(result.population, '—');
    assert.equal(result.density,    '—');
    assert.equal(result.avgIncome,  '—');
  });
});
