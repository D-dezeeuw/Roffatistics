// v0.14.0: Uitleg panel metadata, crime mode (Per 1000 inwoners | Absoluut).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATASETS, DATASET_KEYS, datasetFor, datasetValue, crimeValues, crimeAreas, isCrimeDataset, CRIME_KEYS,
} from '../modules/datasets.js';
import {
  directionLabel, matchesQuery, normalizeText, entryHtml, explainBodyHtml, infoButton, GENERAL_SECTIONS, unitLabel,
} from '../modules/explain.js';
import { crimeToggleHtml, CRIME_MODE_LABELS } from '../modules/crime-mode.js';
import { cityValue, cityKpis, formatValue } from '../modules/dashboard-data.js';

describe('explanation metadata', () => {
  for (const key of DATASET_KEYS) {
    it(`${key} has description, formula, year and a linked source`, () => {
      const ds = DATASETS[key];
      assert.ok(ds.description?.length > 20, 'description');
      assert.ok(ds.formula?.length > 5, 'formula');
      assert.ok(String(ds.year ?? '').length >= 4, 'year');
      assert.ok(Array.isArray(ds.source) && ds.source.length > 0, 'source');
      for (const s of ds.source) {
        assert.ok(s.id && s.name && s.publisher, 'source fields');
        assert.match(s.url, /^https:\/\//);
      }
      assert.ok(Array.isArray(ds.caveats ?? []));
    });
  }
  it('every crime dataset names its count field and absolute title', () => {
    for (const key of CRIME_KEYS) {
      assert.ok(isCrimeDataset(key));
      assert.ok(DATASETS[key].countKey && DATASETS[key].absTitle && DATASETS[key].absFormula, key);
    }
    assert.equal(isCrimeDataset('avgIncome'), false);
  });
});

describe('explain helpers', () => {
  it('directionLabel', () => {
    assert.equal(directionLabel({ higherIsBetter: true }), 'Hoger = beter');
    assert.equal(directionLabel({ higherIsBetter: false }), 'Lager = beter');
    assert.match(directionLabel({ higherIsBetter: null }), /^Neutraal/);
    assert.match(directionLabel({ higherIsBetter: false, inOverall: false }), /Lager = beter · telt niet mee/);
  });
  it('filter matches normalised words', () => {
    assert.equal(normalizeText('Één Café'), 'een cafe');
    assert.ok(matchesQuery('Gemiddeld inkomen per inwoner', 'INKOMEN inw'));
    assert.ok(matchesQuery('anything', '  '));
    assert.equal(matchesQuery('Gemiddeld inkomen', 'woz'), false);
  });
  it('entryHtml links the source and shows the absolute formula for crime', () => {
    const html = entryHtml(DATASETS.crimeRate);
    assert.match(html, /id="explain-crimeRate"/);
    assert.match(html, /href="https:\/\/data\.politie\.nl/);
    assert.match(html, /Absoluut:/);
    assert.match(unitLabel(DATASETS.crimeRate), /aantal misdrijven/);
    assert.doesNotMatch(entryHtml(DATASETS.avgIncome), /Absoluut:/);
  });
  it('body has one entry per dataset plus the general sections', () => {
    const html = explainBodyHtml();
    for (const key of DATASET_KEYS) assert.ok(html.includes(`id="explain-${key}"`), key);
    for (const s of GENERAL_SECTIONS) assert.ok(html.includes(`id="explain-${s.id}"`), s.id);
    assert.ok(GENERAL_SECTIONS.some(s => s.id === 'score'));
  });
  it('infoButton escapes and targets the key', () => {
    const b = infoButton('score', 'Score <x>');
    assert.match(b, /data-explain="score"/);
    assert.match(b, /Uitleg: Score &lt;x&gt;/);
  });
});

describe('crime mode', () => {
  it('crimeToggleHtml marks the pressed option', () => {
    const html = crimeToggleHtml('abs');
    assert.match(html, /data-crime-mode="abs" aria-pressed="true"/);
    assert.match(html, /data-crime-mode="rate" aria-pressed="false"/);
    assert.ok(html.includes(CRIME_MODE_LABELS.rate) && html.includes('Absoluut'));
  });
  it('datasetFor swaps title and unit only for crime in abs', () => {
    assert.equal(datasetFor('crimeRate', 'abs').unit, 'misdrijven');
    assert.equal(datasetFor('crimeRate', 'rate').unit, DATASETS.crimeRate.unit);
    assert.equal(datasetFor('avgIncome', 'abs').unit, DATASETS.avgIncome.unit);
  });
  it('datasetValue / crimeValues read the counts in abs', () => {
    const values = { crimeRate: 50, totalCrimes: 400, crimeBike: 5, crimeBikeCount: 40, avgIncome: 30 };
    assert.equal(datasetValue(values, 'crimeRate', 'abs'), 400);
    assert.equal(datasetValue(values, 'crimeRate', 'rate'), 50);
    assert.equal(datasetValue(values, 'avgIncome', 'abs'), 30);
    const abs = crimeValues(values, 'abs');
    assert.equal(abs.crimeRate, 400);
    assert.equal(abs.crimeBike, 40);
    assert.equal(abs.avgIncome, 30);
    assert.equal(crimeValues(values, 'rate'), values);
  });
  it('crimeAreas maps every area and keeps rate areas as they are', () => {
    const areas = [{ code: 'A', values: { crimeRate: null, totalCrimes: 12, population: 150 } }];
    assert.equal(crimeAreas(areas, 'rate'), areas);
    assert.equal(crimeAreas(areas, 'abs')[0].values.crimeRate, 12);
  });
  it('city value is a sum in abs and a weighted mean in rate', () => {
    const areas = [
      { values: { crimeRate: 10, population: 1000 } },
      { values: { crimeRate: 30, population: 3000 } },
    ];
    assert.equal(cityValue(areas, 'crimeRate', 'rate'), 25);
    assert.equal(cityValue(areas, 'crimeRate', 'abs'), 40);
    const kpi = cityKpis(areas, null, 2025, 'abs').find(k => k.key === 'crimeRate');
    assert.match(kpi.label, /\(totaal\)/);
    assert.equal(formatValue(1234, 'crimeRate', 'abs'), '1.234 misdrijven');
  });
});
