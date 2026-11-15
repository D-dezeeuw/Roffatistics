// W10: the Woonscore is coloured and stamped at every zoom of both scopes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { zoomPlan, nlPlan, nlTier, rotterdamLevel, labelsVisibleAt, MAX_ZOOM, LABEL_MIN_ZOOM } from '../modules/zoom-plan.js';
import { declutter, geometryArea } from '../modules/score-labels.js';
import { resolveZoomTier, DRILL_ZOOM } from '../modules/overlays.js';
import { resolveRotterdamLevel, ZOOM_BUURT_RD } from '../modules/rotterdam.js';

const ZOOMS = Array.from({ length: MAX_ZOOM + 1 }, (_, z) => z);   // 0 … 17, covers both minZooms
const READY = [null, 'GM0363'];

describe('zoomPlan: no zoom without a coloured, stamped level', () => {
  for (const scope of ['nederland', 'rotterdam']) {
    it(`${scope}: every zoom 0–17 draws a level and stamps every drawn level`, () => {
      for (const z of ZOOMS) {
        for (const readyGemeente of READY) {
          for (const buurtReady of [true, false]) {
            const p = zoomPlan(z, scope, { readyGemeente, buurtReady });
            assert.ok(p.draw.length > 0, `${scope} z${z} draws nothing`);
            assert.deepEqual(p.labels, p.draw.map(d => d.level), `${scope} z${z} labels`);
            for (const lvl of p.labels) assert.ok(labelsVisibleAt(lvl, z), `${scope} z${z}: ${lvl} stamps hidden by threshold`);
          }
        }
      }
    });
  }

  it('non-score layers: colour but no stamps', () => {
    for (const z of ZOOMS) {
      assert.deepEqual(zoomPlan(z, 'nederland', { isScore: false }).labels, []);
      assert.deepEqual(zoomPlan(z, 'rotterdam', { isScore: false }).labels, []);
      assert.ok(zoomPlan(z, 'nederland', { isScore: false }).draw.length > 0);
    }
  });

  it('nederland levels per zoom', () => {
    const lv = z => zoomPlan(z, 'nederland', { readyGemeente: 'GM0363' }).draw.map(d => d.level).join('+');
    assert.equal(lv(6), 'provincie');
    assert.equal(lv(9), 'provincie');
    assert.equal(lv(10), 'gemeente');
    assert.equal(lv(11), 'gemeente');
    assert.equal(lv(12), 'gemeente+wijk');
    assert.equal(lv(13), 'gemeente+buurt');
    assert.equal(lv(17), 'gemeente+buurt');
  });

  it('drill tiers: the gemeente level stays until the drill is ready, then excludes only the drilled gemeente', () => {
    for (const tier of ['wijk', 'buurt']) {
      assert.deepEqual(nlPlan(tier).draw, [{ level: 'gemeente', except: null }]);
      assert.deepEqual(nlPlan(tier, { readyGemeente: 'GM0599' }).draw,
        [{ level: 'gemeente', except: 'GM0599' }, { level: tier, only: 'GM0599' }]);
    }
  });

  it('rotterdam: wijk below 13, buurt from 13 while buurten have values, else wijk', () => {
    for (const z of ZOOMS) {
      assert.equal(rotterdamLevel(z), z >= ZOOM_BUURT_RD ? 'buurt' : 'wijk');
      assert.equal(rotterdamLevel(z, { buurtReady: false }), 'wijk');
      assert.equal(resolveRotterdamLevel(z), rotterdamLevel(z));
    }
  });

  it('overlays and the plan agree on tiers and drill zooms', () => {
    for (const z of ZOOMS) assert.equal(resolveZoomTier(z), nlTier(z));
    assert.equal(nlTier(DRILL_ZOOM.wijk), 'wijk');
    assert.equal(nlTier(DRILL_ZOOM.buurt), 'buurt');
    assert.equal(LABEL_MIN_ZOOM.buurt, DRILL_ZOOM.buurt);
  });
});

describe('declutter', () => {
  it('keeps the first point and drops overlapping ones', () => {
    assert.deepEqual(declutter([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 100, y: 0 }]), [0, 2]);
  });
  it('never returns zero labels for a non-empty level, however dense', () => {
    const pts = Array.from({ length: 500 }, (_, i) => ({ x: (i % 7) * 2, y: Math.floor(i / 7) }));
    const kept = declutter(pts);
    assert.ok(kept.length >= 1);
    assert.equal(kept[0], 0);
  });
  it('kept boxes never overlap', () => {
    const pts = Array.from({ length: 400 }, (_, i) => ({ x: (i * 37) % 300, y: (i * 53) % 200 }));
    const kept = declutter(pts, { w: 24, h: 14 }).map(i => pts[i]);
    for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) {
      assert.ok(Math.abs(kept[i].x - kept[j].x) >= 24 || Math.abs(kept[i].y - kept[j].y) >= 14);
    }
  });
  it('skips null points; spread points are all kept', () => {
    assert.deepEqual(declutter([null, { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 50 }]), [1, 2, 3]);
  });
  it('geometryArea orders larger areas first', () => {
    const sq = s => ({ type: 'Polygon', coordinates: [[[0, 0], [s, 0], [s, s], [0, s], [0, 0]]] });
    assert.ok(geometryArea(sq(2)) > geometryArea(sq(1)));
    assert.equal(geometryArea(null), 0);
  });
});
