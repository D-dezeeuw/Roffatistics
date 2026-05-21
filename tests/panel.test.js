import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPanelData } from '../modules/panel.js';

describe('formatPanelData', () => {
  const categories = [
    { label: 'Vermogen',         count: 14000 },
    { label: 'Diefstal/inbraak', count: 9000  },
    { label: 'Vernieling',       count: 4800  },
    { label: 'Geweld',           count: 3200  },
    { label: 'Mishandeling',     count: 2100  },
  ];
  const data = {
    population: 596075, density: 202, avgIncome: 37.5,
    crimeRate: 45.2, totalCrimes: 26973, categories,
    wozValue: 350, totalJobs: 280000, pop65plus: 18.3,
    migrationBalance: -420, nonWesternPct: 12.5,
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
    assert.equal(result.population,         '—');
    assert.equal(result.density,            '—');
    assert.equal(result.avgIncome,          '—');
    assert.equal(result.crimeRate,          '—');
    assert.equal(result.totalCrimes,        '—');
    assert.equal(result.catVermogen,        '—');
    assert.equal(result.catDiefstalInbraak, '—');
    assert.equal(result.catVernieling,      '—');
    assert.equal(result.catGeweld,          '—');
    assert.equal(result.catMishandeling,    '—');
    assert.equal(result.wozValue,           '—');
    assert.equal(result.totalJobs,          '—');
    assert.equal(result.pop65plus,          '—');
    assert.equal(result.migrationBalance,   '—');
    assert.equal(result.nonWesternPct,      '—');
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
    assert.ok(result.catDiefstalInbraak.includes('9'));
    assert.ok(result.catVernieling.includes('4'));
    assert.ok(result.catGeweld.includes('3'));
    assert.ok(result.catMishandeling.includes('2'));
  });

  it('formats WOZ value with euro and k suffix', () => {
    const result = formatPanelData(data);
    assert.ok(result.wozValue.startsWith('€'));
    assert.ok(result.wozValue.includes('350'));
  });

  it('formats pop65plus as percentage', () => {
    const result = formatPanelData(data);
    assert.equal(result.pop65plus, '18.3%');
  });

  it('formats negative migrationBalance with minus sign', () => {
    const result = formatPanelData(data);
    assert.ok(result.migrationBalance.includes('-'));
    assert.ok(result.migrationBalance.includes('420'));
  });

  it('formats positive migrationBalance with plus sign', () => {
    const result = formatPanelData({ migrationBalance: 512 });
    assert.ok(result.migrationBalance.startsWith('+'));
  });

  it('formats nonWesternPct as percentage', () => {
    const result = formatPanelData(data);
    assert.equal(result.nonWesternPct, '12.5%');
  });

  it('formats education percentages with 1 decimal and % suffix', () => {
    const result = formatPanelData({ lowEdu: 28.4, medEdu: 38.1, highEdu: 33.5 });
    assert.equal(result.lowEdu,  '28.4%');
    assert.equal(result.medEdu,  '38.1%');
    assert.equal(result.highEdu, '33.5%');
  });

  it('returns dashes for null education fields', () => {
    const result = formatPanelData({ lowEdu: null, medEdu: null, highEdu: null });
    assert.equal(result.lowEdu,  '—');
    assert.equal(result.medEdu,  '—');
    assert.equal(result.highEdu, '—');
  });
});
