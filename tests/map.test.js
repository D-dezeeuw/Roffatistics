import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASEMAPS, DEFAULT_BASEMAP, BASEMAP_STORAGE_KEY,
  resolveBasemap, pickInitialBasemap, createBasemapLayer,
} from '../modules/map.js';

describe('BASEMAPS', () => {
  it('offers Donker, Licht and Luchtfoto', () => {
    assert.deepEqual(Object.values(BASEMAPS).map(b => b.label), ['Donker', 'Licht', 'Luchtfoto']);
  });

  it('uses only keyless providers (no CARTO, no API keys)', () => {
    for (const b of Object.values(BASEMAPS)) {
      const url = b.style ?? b.url;
      assert.match(url, /^https:\/\/(tiles\.openfreemap\.org|service\.pdok\.nl)\//);
      assert.doesNotMatch(url, /carto|key=|token=/i);
    }
  });

  it('defaults to the OpenFreeMap dark style', () => {
    assert.equal(DEFAULT_BASEMAP, 'dark');
    assert.equal(BASEMAPS.dark.style, 'https://tiles.openfreemap.org/styles/dark');
    assert.equal(BASEMAPS.light.style, 'https://tiles.openfreemap.org/styles/positron');
  });

  it('carries the required attributions', () => {
    assert.match(BASEMAPS.dark.attribution, /OpenFreeMap.*OpenMapTiles.*OpenStreetMap/);
    assert.match(BASEMAPS.aerial.attribution, /PDOK.*Beeldmateriaal Nederland/);
  });

  it('aerial is an XYZ raster with a native zoom cap', () => {
    assert.equal(BASEMAPS.aerial.type, 'raster');
    assert.match(BASEMAPS.aerial.url, /\{z\}\/\{x\}\/\{y\}\.jpeg$/);
    assert.equal(BASEMAPS.aerial.maxNativeZoom, 19);
  });
});

describe('resolveBasemap', () => {
  it('returns the requested config', () => {
    assert.equal(resolveBasemap('aerial'), BASEMAPS.aerial);
  });

  it('falls back to default for unknown or prototype keys', () => {
    for (const id of [undefined, null, '', 'carto', 'toString', '__proto__']) {
      assert.equal(resolveBasemap(id), BASEMAPS.dark);
    }
  });
});

describe('pickInitialBasemap', () => {
  it('uses a stored valid choice', () => {
    assert.equal(pickInitialBasemap({ getItem: k => (k === BASEMAP_STORAGE_KEY ? 'light' : null) }), 'light');
  });

  it('ignores stored garbage, missing storage and throwing storage', () => {
    assert.equal(pickInitialBasemap({ getItem: () => 'satellite' }), 'dark');
    assert.equal(pickInitialBasemap(null), 'dark');
    assert.equal(pickInitialBasemap({ getItem: () => { throw new Error('denied'); } }), 'dark');
  });
});

describe('createBasemapLayer', () => {
  const fakeL = {
    maplibreGL: opts => ({ kind: 'gl', opts }),
    tileLayer:  (url, opts) => ({ kind: 'tile', url, opts }),
  };

  it('builds a maplibre layer in the tile pane for vector styles', () => {
    const layer = createBasemapLayer(fakeL, BASEMAPS.dark);
    assert.equal(layer.kind, 'gl');
    assert.equal(layer.opts.style, BASEMAPS.dark.style);
    assert.equal(layer.opts.pane, 'tilePane');
    assert.equal(layer.opts.attribution, BASEMAPS.dark.attribution);
  });

  it('builds a tile layer for the aerial raster', () => {
    const layer = createBasemapLayer(fakeL, BASEMAPS.aerial);
    assert.equal(layer.kind, 'tile');
    assert.equal(layer.url, BASEMAPS.aerial.url);
    assert.equal(layer.opts.maxNativeZoom, 19);
    assert.equal(layer.opts.maxZoom, 17);
  });
});
