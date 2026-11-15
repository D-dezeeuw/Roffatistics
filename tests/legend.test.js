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

import { legendScaleHtml, scaleToggleHtml } from '../modules/legend.js';
import { buildScale, CLASS_COLORS } from '../modules/scale.js';

const CRIME = [12, 18, 22, 26, 29, 31, 34, 36, 38, 40, 41, 43, 45, 46, 48, 50, 51, 52, 54, 55,
  56, 58, 59, 61, 62, 64, 65, 66, 68, 70, 71, 73, 75, 77, 79, 81, 83, 85, 88, 90, 310, 420, 505, 550];

describe('legendScaleHtml', () => {
  it('lists the 7 stepped classes with nl-NL breaks and marks the median class', () => {
    const html = legendScaleHtml(buildScale(CRIME), 'crimeRate');
    assert.equal((html.match(/<li class="legend-class/g) ?? []).length, 7);
    for (const c of CLASS_COLORS) assert.ok(html.includes(c), c);
    assert.equal((html.match(/is-median/g) ?? []).length, 1);
    assert.match(html, /mediaan 58,5 per 1\.000 inw\./);
    assert.match(html, /12–/);
  });
  it('counts the outliers with the fence', () => {
    const s = buildScale(CRIME);
    const html = legendScaleHtml(s, 'crimeRate');
    assert.match(html, /4 uitschieters &gt; \d+/);
    assert.match(html, /legend-chip is-outlier/);
    assert.doesNotMatch(legendScaleHtml(buildScale([1, 2, 3, 4, 5, 6, 7, 8, 9]), 'crimeRate'), /uitschieter/);
  });
  it('formats with the unit of the crime mode', () => {
    assert.match(legendScaleHtml(buildScale([100, 200, 300, 400, 500, 600, 700, 800]), 'crimeRate', 'abs'), /mediaan 450 misdrijven/);
  });
  it('linear shows the strip with min, max and a median tick', () => {
    const html = legendScaleHtml(buildScale(CRIME, { method: 'linear' }), 'crimeRate');
    assert.match(html, /legend-strip/);
    assert.match(html, /legend-median-tick/);
    assert.doesNotMatch(html, /legend-class/);
  });
  it('an empty scale says so', () => {
    assert.match(legendScaleHtml(buildScale([]), 'crimeRate'), /geen data/);
    assert.match(legendScaleHtml(null, 'crimeRate'), /geen data/);
  });
});

describe('scaleToggleHtml', () => {
  it('presses the current method', () => {
    const html = scaleToggleHtml('linear');
    assert.match(html, /data-scale-method="linear" aria-pressed="true">Lineair/);
    assert.match(html, /data-scale-method="quantile" aria-pressed="false">Kwantiel/);
  });
});
