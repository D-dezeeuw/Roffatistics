import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPanelData } from '../modules/panel.js';

describe('formatPanelData', () => {
  const categories = [
    { label: 'Vermogen',   count: 14000 },
    { label: 'Vernieling', count: 4800  },
    { label: 'Geweld',     count: 3200  },
  ];
  const data = {
    population: 596075, density: 202, avgIncome: 37.5,
    crimeRate: 45.2, totalCrimes: 26973, categories,
  };

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
    assert.equal(result.population,    '—');
    assert.equal(result.density,       '—');
    assert.equal(result.avgIncome,     '—');
    assert.equal(result.crimeRate,     '—');
    assert.equal(result.totalCrimes,   '—');
    assert.equal(result.catVermogen,   '—');
    assert.equal(result.catVernieling, '—');
    assert.equal(result.catGeweld,     '—');
  });

  it('returns dashes for missing individual fields', () => {
    const result = formatPanelData({ population: null, density: null, avgIncome: null });
    assert.equal(result.population, '—');
    assert.equal(result.density,    '—');
    assert.equal(result.avgIncome,  '—');
  });

  it('formats crimeRate with 1 decimal and /1k suffix', () => {
    const result = formatPanelData(data);
    assert.ok(result.crimeRate.includes('45.2'));
    assert.ok(result.crimeRate.includes('/1k'));
  });

  it('formats totalCrimes as locale number', () => {
    const result = formatPanelData(data);
    assert.ok(result.totalCrimes.includes('26'));
  });

  it('extracts category counts from categories array', () => {
    const result = formatPanelData(data);
    assert.ok(result.catVermogen.includes('14'));
    assert.ok(result.catVernieling.includes('4'));
    assert.ok(result.catGeweld.includes('3'));
  });
});
