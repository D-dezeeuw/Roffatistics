import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScale, quantile, fences, classColor, interpolateColor, outlierLabel, getScaleMethod, setScaleMethod,
  CLASS_COLORS, CLASS_COUNT, NO_DATA_COLOR, SCALE_STORAGE_KEY,
} from '../modules/scale.js';

// Crime-like: most buurten 10–90 per 1.000, a few public spaces 300–550 (Centrum, station, Zuidplein).
const CRIME = [
  12, 18, 22, 26, 29, 31, 34, 36, 38, 40, 41, 43, 45, 46, 48, 50, 51, 52, 54, 55,
  56, 58, 59, 61, 62, 64, 65, 66, 68, 70, 71, 73, 75, 77, 79, 81, 83, 85, 88, 90,
  310, 420, 505, 550,
];

const memStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

describe('quantile', () => {
  it('interpolates linearly (type 7)', () => {
    assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
    assert.equal(quantile([1, 2, 3, 4], 0), 1);
    assert.equal(quantile([1, 2, 3, 4], 1), 4);
    assert.equal(quantile([10, 20, 30, 40, 50], 0.25), 20);
    assert.equal(quantile([], 0.5), null);
  });
});

describe('classColor / CLASS_COLORS', () => {
  it('has 7 stepped colours from the ramp ends', () => {
    assert.equal(CLASS_COLORS.length, CLASS_COUNT);
    assert.equal(CLASS_COLORS[0], '#2e1065');
    assert.equal(CLASS_COLORS[6], '#ea580c');
    assert.equal(new Set(CLASS_COLORS).size, 7);
  });
  it('spreads fewer classes over the whole ramp; one class is the middle', () => {
    assert.equal(classColor(0, 3), CLASS_COLORS[0]);
    assert.equal(classColor(1, 3), CLASS_COLORS[3]);
    assert.equal(classColor(2, 3), CLASS_COLORS[6]);
    assert.equal(classColor(0, 1), CLASS_COLORS[3]);
  });
  it('interpolateColor keeps the old behaviour', () => {
    assert.equal(interpolateColor(50, 0, 100), '#8c3439');
    assert.equal(interpolateColor(5, 5, 5), '#2e1065');
  });
});

describe('buildScale — quantile on a crime-like distribution', () => {
  const s = buildScale(CRIME);

  it('defaults to quantile with 7 evenly filled classes', () => {
    assert.equal(s.method, 'quantile');
    assert.equal(s.classes.length, 7);
    assert.equal(s.breaks.length, 6);
    const counts = s.classes.map(c => c.count);
    assert.equal(counts.reduce((a, b) => a + b, 0), CRIME.length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `classes evenly filled: ${counts}`);
    assert.deepEqual(s.classes.map(c => c.color), CLASS_COLORS);
  });

  it('breaks ascend and classes do not overlap', () => {
    for (let i = 1; i < s.breaks.length; i++) assert.ok(s.breaks[i] > s.breaks[i - 1]);
    for (let i = 1; i < s.classes.length; i++) assert.ok(s.classes[i].from > s.classes[i - 1].to);
    assert.equal(s.classes[0].from, 12);
    assert.equal(s.classes[6].to, 550);
  });

  it('puts the median in the middle class', () => {
    assert.equal(s.median, quantile([...CRIME].sort((a, b) => a - b), 0.5));
    assert.equal(s.classOf(s.median), 3);
    assert.equal(s.colorFor(s.median), CLASS_COLORS[3]);
  });

  it('gives 26 and 85 clearly different classes (linear does not)', () => {
    const a = s.classOf(26), b = s.classOf(85);
    assert.ok(b - a >= 4, `26 → class ${a}, 85 → class ${b}`);
    assert.notEqual(s.colorFor(26), s.colorFor(85));
    const lin = buildScale(CRIME, { method: 'linear' });
    const dist = (c1, c2) => Math.abs(parseInt(c1.slice(1, 3), 16) - parseInt(c2.slice(1, 3), 16));
    assert.ok(dist(lin.colorFor(26), lin.colorFor(85)) < 25, 'linear squeezes them together');
  });

  it('flags every 300+ value as a high outlier and nothing in the 10–90 body', () => {
    for (const v of [310, 420, 505, 550]) { assert.ok(s.isOutlier(v), String(v)); assert.equal(s.outlierSide(v), 'high'); }
    for (const v of CRIME.filter(x => x <= 90)) assert.equal(s.isOutlier(v), false, String(v));
    assert.deepEqual(s.outliers, { high: 4, low: 0 });
    assert.ok(s.hi > 90 && s.hi < 310, `upper fence ${s.hi}`);
    assert.equal(s.logFences, true);
  });

  it('exposes the quartiles and fences', () => {
    assert.ok(s.q1 < s.median && s.median < s.q3);
    assert.ok(s.lo < 12, 'low values are not outliers');
    assert.equal(s.min, 12);
    assert.equal(s.max, 550);
    assert.equal(s.count, CRIME.length);
  });

  it('classes values outside the set by the breaks', () => {
    assert.equal(s.classOf(-5), 0);
    assert.equal(s.classOf(10_000), 6);
  });
});

describe('buildScale — nulls and degraded sets', () => {
  it('ignores nulls, undefined, NaN and strings that are not numbers', () => {
    const s = buildScale([null, 1, undefined, 2, NaN, 'x', '3', 4, 5, 6, 7, 8, 9]);
    assert.equal(s.count, 9);
    assert.equal(s.colorFor(null), NO_DATA_COLOR);
    assert.equal(s.colorFor(undefined), NO_DATA_COLOR);
    assert.equal(s.classOf(null), null);
    assert.equal(s.isOutlier(null), false);
  });

  it('an empty or all-null set colours everything as geen data', () => {
    for (const vals of [[], [null, null], undefined]) {
      const s = buildScale(vals);
      assert.equal(s.count, 0);
      assert.equal(s.colorFor(5), NO_DATA_COLOR);
      assert.equal(s.isOutlier(5), false);
      assert.deepEqual(s.classes, []);
      assert.equal(s.median, null);
    }
  });

  it('a constant set is one middle class without outliers', () => {
    const s = buildScale([4, 4, 4, 4]);
    assert.equal(s.classes.length, 1);
    assert.equal(s.colorFor(4), CLASS_COLORS[3]);
    assert.equal(s.isOutlier(4), false);
    assert.equal(buildScale([4, 4], { method: 'linear' }).colorFor(4), CLASS_COLORS[3]);
  });

  it('≤ 7 distinct values: one class per value, spread over the ramp, no outliers', () => {
    const s = buildScale([1, 1, 2, 2, 3, 100]);
    assert.equal(s.classes.length, 4);
    assert.deepEqual(s.classes.map(c => c.from), [1, 2, 3, 100]);
    assert.equal(s.colorFor(1), CLASS_COLORS[0]);
    assert.equal(s.colorFor(100), CLASS_COLORS[6]);
    assert.equal(s.isOutlier(100), false);
  });

  it('a single value works', () => {
    const s = buildScale([42]);
    assert.equal(s.median, 42);
    assert.equal(s.colorFor(42), CLASS_COLORS[3]);
  });

  it('heavy ties never leave an empty class', () => {
    const s = buildScale([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(s.classes.every(c => c.count > 0));
    assert.equal(s.classes[0].from, 0);
    assert.equal(s.classes[0].to, 0);
    assert.equal(s.isOutlier(8), false, 'IQR 0 → no outliers');
  });

  it('an unknown method falls back to quantile', () => {
    assert.equal(buildScale([1, 2, 3], { method: 'bogus' }).method, 'quantile');
  });
});

describe('buildScale — linear', () => {
  const s = buildScale(CRIME, { method: 'linear' });
  it('is the old min→max ramp with no classes', () => {
    assert.equal(s.method, 'linear');
    assert.deepEqual(s.classes, []);
    assert.equal(s.colorFor(12), interpolateColor(12, 12, 550));
    assert.equal(s.colorFor(550), '#ea580c');
    assert.equal(s.colorFor(null), NO_DATA_COLOR);
  });
  it('still flags the same outliers', () => {
    assert.deepEqual(s.outliers, { high: 4, low: 0 });
  });
});

describe('fences', () => {
  it('uses raw Tukey fences when there are negative values', () => {
    const vals = [-40, -10, -5, -2, 0, 1, 3, 4, 6, 8, 9, 12, 60].sort((a, b) => a - b);
    const f = fences(vals);
    assert.equal(f.log, false);
    const q1 = quantile(vals, 0.25), q3 = quantile(vals, 0.75);
    assert.equal(f.hi, q3 + 1.5 * (q3 - q1));
    assert.equal(f.lo, q1 - 1.5 * (q3 - q1));
  });
  it('flags low outliers on symmetric-ish data', () => {
    const s = buildScale([-500, 40, 42, 45, 47, 50, 52, 55, 57, 60, 62]);
    assert.equal(s.outlierSide(-500), 'low');
    assert.deepEqual(s.outliers, { high: 0, low: 1 });
  });
  it('log fences keep a merely-high right tail unflagged that raw Tukey would flag', () => {
    const vals = [40, 45, 50, 52, 55, 58, 60, 62, 65, 68, 70, 72, 75, 80, 85, 90, 130, 150];
    const sorted = [...vals].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75);
    assert.ok(130 > q3 + 1.5 * (q3 - q1), 'raw Tukey alone flags 130');
    assert.equal(buildScale(vals).isOutlier(130), false);
  });
});

describe('outlierLabel', () => {
  it('words the side', () => {
    assert.equal(outlierLabel('high'), 'uitschieter (ver boven mediaan)');
    assert.equal(outlierLabel('low'), 'uitschieter (ver onder mediaan)');
    assert.equal(outlierLabel(null), '');
  });
});

describe('scale method storage', () => {
  it('defaults to quantile and round-trips through storage', () => {
    const st = memStorage();
    assert.equal(getScaleMethod(st), 'quantile');
    assert.equal(setScaleMethod('linear', st), 'linear');
    assert.equal(st.getItem(SCALE_STORAGE_KEY), 'linear');
    assert.equal(getScaleMethod(st), 'linear');
  });
  it('ignores unknown methods and blocked storage', () => {
    const st = memStorage();
    setScaleMethod('bogus', st);
    assert.equal(getScaleMethod(st), 'quantile');
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.equal(getScaleMethod(blocked), 'quantile');
    assert.equal(setScaleMethod('linear', blocked), 'linear');
  });
});
