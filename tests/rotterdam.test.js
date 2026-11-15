import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { areaFillStyle, outlierStroke, buildMaskRings, resolveRotterdamLevel, tooltipHtml, NO_DATA_COLOR, ZOOM_BUURT_RD } from '../modules/rotterdam.js';
import { buildScale, OUTLIER_COLOR } from '../modules/scale.js';

describe('Rotterdam styling', () => {
  it('areas without a value all get the same neutral colour', () => {
    const scale = buildScale([0, 5, 10]);
    assert.equal(areaFillStyle(null, scale).fillColor, NO_DATA_COLOR);
    assert.equal(areaFillStyle(undefined, scale).fillColor, NO_DATA_COLOR);
    assert.equal(areaFillStyle(5, null).fillColor, NO_DATA_COLOR, 'no scale = no data for the whole dataset');
    assert.equal(areaFillStyle(5, buildScale([null])).fillColor, NO_DATA_COLOR, 'empty scale = no data');
  });

  it('areas with a value use the scale colour', () => {
    const scale = buildScale([0, 2, 4, 6, 8, 10, 12, 14, 16]);
    assert.deepEqual(areaFillStyle(10, scale, 0.6), { fillColor: scale.colorFor(10), fillOpacity: 0.6 });
    assert.equal(areaFillStyle(0, scale).fillColor, scale.colorFor(0), 'zero is data, not missing');
  });

  it('outliers get a red border, others none', () => {
    const scale = buildScale([30, 40, 45, 50, 55, 60, 65, 70, 75, 80, 500]);
    assert.deepEqual(outlierStroke(500, scale), { color: OUTLIER_COLOR, weight: 2.5, opacity: 1 });
    assert.equal(outlierStroke(60, scale), null);
    assert.equal(outlierStroke(null, scale), null);
    assert.equal(outlierStroke(500, null), null);
  });

  it('level switches to buurt at ZOOM_BUURT_RD', () => {
    assert.equal(resolveRotterdamLevel(ZOOM_BUURT_RD - 1), 'wijk');
    assert.equal(resolveRotterdamLevel(ZOOM_BUURT_RD), 'buurt');
  });

  it('mask = world ring plus every gemeente ring, as [lat, lng]', () => {
    const geo = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [
      [[[4, 51], [5, 51], [5, 52], [4, 51]], [[4.2, 51.2], [4.3, 51.2], [4.3, 51.3], [4.2, 51.2]]],
      [[[6, 50], [7, 50], [7, 51], [6, 50]]],
    ] } }] };
    const rings = buildMaskRings(geo);
    assert.equal(rings.length, 4);
    assert.equal(rings[0].length, 4, 'world ring first');
    assert.deepEqual(rings[1][1], [51, 5]);
  });

  it('tooltip shows the value or "geen data" and escapes names', () => {
    assert.match(tooltipHtml('Noord', 1234), /Noord.*1\.234/);
    assert.match(tooltipHtml('A<b>', null), /A&lt;b&gt;.*geen data/);
    assert.match(tooltipHtml('Centrum', 500, String, 'high'), /uitschieter \(ver boven mediaan\)/);
    assert.doesNotMatch(tooltipHtml('Noord', 50), /uitschieter/);
    assert.doesNotMatch(tooltipHtml('Leeg', null, String, 'high'), /uitschieter/);
  });
});

