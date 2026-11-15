import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { showLoader, hideLoader, setLoaderProgress, withLoader, clampProgress, loaderDepth, afterPaint, _resetLoader } from '../modules/loader.js';

function fakeEl() {
  const classes = new Set();
  const props = new Map();
  const attrs = {};
  const label = { textContent: '' };
  return {
    hidden: true, label, props, attrs,
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    style: { setProperty: (k, v) => props.set(k, v), removeProperty: k => props.delete(k) },
    setAttribute: (k, v) => { attrs[k] = v; },
    querySelector: sel => (sel === '.app-loader__label' ? label : null),
  };
}

let saved, loader, map;
beforeEach(() => {
  saved = globalThis.document;
  loader = fakeEl(); map = fakeEl();
  globalThis.document = { getElementById: id => (id === 'app-loader' ? loader : id === 'map' ? map : null) };
  _resetLoader();
});
afterEach(() => { globalThis.document = saved; _resetLoader(); });

const noPaint = () => Promise.resolve();

describe('clampProgress', () => {
  it('clamps to 0..1 and maps non-numbers to null (indeterminate)', () => {
    assert.equal(clampProgress(0.4), 0.4);
    assert.equal(clampProgress(-2), 0);
    assert.equal(clampProgress(7), 1);
    assert.equal(clampProgress(null), null);
    assert.equal(clampProgress(NaN), null);
    assert.equal(clampProgress('0.5'), null);
  });
});

describe('showLoader / hideLoader', () => {
  it('shows the overlay with its label and fades the map, then reverses', () => {
    showLoader('Nederland laden…');
    assert.equal(loader.hidden, false);
    assert.ok(loader.classList.contains('is-visible'));
    assert.equal(loader.props.get('--progress'), '0', 'starts empty, determinate');
    assert.equal(loader.label.textContent, 'Nederland laden…');
    assert.ok(map.classList.contains('map-busy'));
    hideLoader();
    assert.equal(loader.hidden, true);
    assert.ok(!loader.classList.contains('is-visible'));
    assert.ok(!map.classList.contains('map-busy'));
  });

  it('reference-counts nested calls and never goes below zero', () => {
    showLoader('a'); showLoader('b');
    assert.equal(loader.label.textContent, 'b');
    hideLoader();
    assert.ok(loader.classList.contains('is-visible'), 'still one open');
    hideLoader(); hideLoader();
    assert.equal(loaderDepth(), 0);
    assert.ok(!loader.classList.contains('is-visible'));
    showLoader();
    assert.equal(loaderDepth(), 1);
  });

  it('no-ops without #app-loader', () => {
    globalThis.document = { getElementById: () => null };
    showLoader('x'); setLoaderProgress(0.5); hideLoader();
    globalThis.document = undefined;
    showLoader('x'); setLoaderProgress(null); hideLoader();
    assert.equal(loaderDepth(), 0);
  });
});

describe('setLoaderProgress', () => {
  it('sets a clamped --progress, null switches to indeterminate', () => {
    setLoaderProgress(1.5);
    assert.equal(loader.props.get('--progress'), '1');
    assert.ok(!loader.classList.contains('is-indeterminate'));
    setLoaderProgress(0.25);
    assert.equal(loader.props.get('--progress'), '0.25');
    setLoaderProgress(null);
    assert.ok(loader.classList.contains('is-indeterminate'));
    assert.ok(!loader.props.has('--progress'));
  });
  it('never goes back while the loader is open, also across nested calls', () => {
    showLoader('a');
    setLoaderProgress(0.5);
    showLoader('b');                       // nested: keeps the fill
    assert.equal(loader.props.get('--progress'), '0.5');
    setLoaderProgress(0.2);                // a lower step is ignored
    assert.equal(loader.props.get('--progress'), '0.5');
    hideLoader();
    setLoaderProgress(0.7);
    assert.equal(loader.props.get('--progress'), '0.7');
    hideLoader();
    assert.equal(loader.props.get('--progress'), '1', 'ends full');
  });
});

describe('withLoader', () => {
  it('shows during the work, returns its result and hides afterwards', async () => {
    let seen = null;
    const out = await withLoader('Laden', async () => { seen = loader.classList.contains('is-visible'); return 42; }, { paint: noPaint });
    assert.equal(seen, true);
    assert.equal(out, 42);
    assert.equal(loader.hidden, true);
  });

  it('paints before the work starts', async () => {
    const order = [];
    await withLoader('x', () => { order.push('work'); }, { paint: async () => { order.push('paint'); } });
    assert.deepEqual(order, ['paint', 'work']);
  });

  it('hides on error and keeps nested calls open until the outer one ends', async () => {
    await assert.rejects(withLoader('x', async () => { throw new Error('boom'); }, { paint: noPaint }), /boom/);
    assert.equal(loaderDepth(), 0);
    await withLoader('outer', async () => {
      await withLoader('inner', async () => {}, { paint: noPaint });
      assert.ok(loader.classList.contains('is-visible'));
    }, { paint: noPaint });
    assert.ok(!loader.classList.contains('is-visible'));
  });
});

describe('afterPaint', () => {
  it('waits two frames', async () => {
    let frames = 0;
    await afterPaint({ raf: cb => { frames++; setTimeout(cb, 0); }, fallbackMs: 1000 });
    assert.equal(frames, 2);
  });
  it('falls back to a timer without frames', async () => {
    await afterPaint({ raf: null, fallbackMs: 5 });
  });
});
