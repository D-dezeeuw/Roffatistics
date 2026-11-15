// v0.22.0: the Woonscore stamped on the map, the wizard personalising the
// Woonscore itself (old dataset=jouwscore links) and the legend Reset.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { labelPoint, pointInRings, labelText, labelsVisibleAt, LABEL_MIN_ZOOM } from '../modules/score-labels.js';
import { parseHash, serializeHash, sanitizePatch, resolveInitialState, getState, setState, resetScore, DEFAULT_STATE } from '../modules/state.js';
import { presetFromScore, scoreKind, scoreLabel, scoreTitle } from '../modules/wizard-model.js';
import { DATASET_KEYS } from '../modules/datasets.js';
import { SCORE_KEYS } from '../modules/presets.js';

const square = [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]];
// A U shape: its area centroid (x = 3) lies in the open notch between the arms.
const u = [[[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6], [0, 0]]];

describe('score stamps: label placement (pure)', () => {
  it('a convex polygon gets its centroid, as Leaflet [lat, lng]', () => {
    assert.deepEqual(labelPoint({ type: 'Polygon', coordinates: square }), [2, 2]);
    assert.deepEqual(labelPoint({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[10, 50], [12, 50], [12, 54], [10, 54], [10, 50]]] } }), [52, 11]);
  });
  it('a centroid outside the polygon falls back to a point inside it', () => {
    const [lat, lng] = labelPoint({ type: 'Polygon', coordinates: u });
    assert.equal(pointInRings([3, 3.4], u), false, 'centroid is in the notch');
    assert.ok(pointInRings([lng, lat], u), `label ${lng},${lat} inside the U`);
  });
  it('a hole under the centroid is avoided', () => {
    const ring = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]]];
    const [lat, lng] = labelPoint({ type: 'Polygon', coordinates: ring });
    assert.ok(pointInRings([lng, lat], ring));
  });
  it('a MultiPolygon is labelled on its largest part; no polygon = null', () => {
    const multi = { type: 'MultiPolygon', coordinates: [[[[100, 0], [101, 0], [101, 1], [100, 1], [100, 0]]], square] };
    assert.deepEqual(labelPoint(multi), [2, 2]);
    assert.equal(labelPoint(null), null);
    assert.equal(labelPoint({ type: 'Point', coordinates: [1, 2] }), null);
  });
  it('text is the rounded score; zoom thresholds hide dense levels', () => {
    assert.equal(labelText(67.5), '68');
    assert.equal(labelText(0), '0');
    assert.equal(labelText(null), null);
    assert.equal(labelText(NaN), null);
    assert.deepEqual({ ...LABEL_MIN_ZOOM }, { provincie: 0, gemeente: 9, wijk: 12, buurt: 14 });
    assert.equal(labelsVisibleAt('buurt', 13), false);
    assert.equal(labelsVisibleAt('buurt', 14), true);
    assert.equal(labelsVisibleAt('wijk', 11), false);
    assert.equal(labelsVisibleAt('wijk', 12), true);
    assert.equal(labelsVisibleAt('gemeente', 9), true);
    assert.equal(labelsVisibleAt('onbekend', 18), false);
  });
});

describe('one Woonscore: dataset=jouwscore links', () => {
  it('there is no separate Jouw score layer', () => {
    assert.ok(!DATASET_KEYS.includes('jouwscore'));
    assert.deepEqual([...SCORE_KEYS], ['woonscore']);
  });
  it('dataset=jouwscore maps to the Woonscore and keeps the score= preset', () => {
    assert.deepEqual(parseHash('#dataset=jouwscore&score=lg.s30'), { dataset: 'woonscore', score: 'lg.s30' });
    assert.deepEqual(sanitizePatch({ dataset: 'jouwscore' }), { dataset: 'woonscore' });
    const s = resolveInitialState({ hash: '#scope=rotterdam&dataset=jouwscore&score=gelijk' });
    assert.equal(s.dataset, 'woonscore');
    assert.equal(s.score, 'gelijk');
    assert.equal(serializeHash(s), '#scope=rotterdam&view=map&score=gelijk', 'canonical hash: Woonscore is the default layer');
  });
  it('legend and Ranglijst titles name the preset', () => {
    assert.equal(scoreLabel(null), 'Woonscore');
    assert.equal(scoreLabel('gelijk'), 'Woonscore · gelijk gewogen');
    assert.equal(scoreLabel('lg.s30'), 'Woonscore · jouw wensen');
    assert.equal(scoreTitle(null, 'Woonscore (0–100, t.o.v. gelijke gebieden)'), 'Woonscore (0–100, t.o.v. gelijke gebieden)');
    assert.equal(scoreTitle('lg.s30'), 'Woonscore · jouw wensen (0–100)');
  });
});

describe('legend Reset → Standaard', () => {
  it('clears score from the state and the hash; the preset is Standaard again', () => {
    setState({ ...DEFAULT_STATE, dataset: 'woonscore', score: 'lg.s30' });
    assert.equal(scoreKind(getState().score), 'custom');
    const after = resetScore();
    assert.equal(after.score, null);
    assert.equal(after.dataset, 'woonscore', 'stays on the Woonscore');
    assert.equal(presetFromScore(after.score).id, 'standaard');
    assert.doesNotMatch(serializeHash(after), /score=/);
    setState({ score: 'gelijk' });
    assert.equal(resetScore().score, null, 'Gelijk resets too');
  });
});
