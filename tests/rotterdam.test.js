import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { areaFillStyle, buildMaskRings, resolveRotterdamLevel, tooltipHtml, NO_DATA_COLOR, ZOOM_BUURT_RD } from '../modules/rotterdam.js';
import { interpolateColor } from '../modules/overlays.js';

describe('Rotterdam styling', () => {
  it('areas without a value all get the same neutral colour', () => {
    const range = { min: 0, max: 10 };
    assert.equal(areaFillStyle(null, range).fillColor, NO_DATA_COLOR);
    assert.equal(areaFillStyle(undefined, range).fillColor, NO_DATA_COLOR);
    assert.equal(areaFillStyle(5, null).fillColor, NO_DATA_COLOR, 'no range = no data for the whole dataset');
  });

  it('areas with a value use the existing colour scale', () => {
    const range = { min: 0, max: 10 };
    assert.deepEqual(areaFillStyle(10, range, 0.6), { fillColor: interpolateColor(10, 0, 10), fillOpacity: 0.6 });
    assert.equal(areaFillStyle(0, range).fillColor, interpolateColor(0, 0, 10), 'zero is data, not missing');
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
  });
});
