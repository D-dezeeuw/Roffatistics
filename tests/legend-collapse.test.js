import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyLegendCollapsed, initLegendCollapse, LEGEND_COLLAPSED_KEY } from '../modules/legend.js';

function fakeLegend() {
  const classes = new Set();
  const attrs = {};
  let onClick = null;
  const btn = { textContent: '', title: '', setAttribute: (k, v) => (attrs[k] = v), addEventListener: (t, f) => (onClick = f) };
  const el = { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) }, querySelector: () => btn };
  return { el, btn, classes, attrs, click: () => onClick() };
}

const memory = (init = {}) => { const m = { ...init }; return { getItem: k => m[k] ?? null, setItem: (k, v) => (m[k] = v), m }; };

describe('legend minimise', () => {
  it('collapsed state sets class, symbol and aria', () => {
    const f = fakeLegend();
    applyLegendCollapsed(f.el, true);
    assert.ok(f.classes.has('legend-collapsed'));
    assert.equal(f.btn.textContent, '+');
    assert.equal(f.attrs['aria-expanded'], 'false');
    applyLegendCollapsed(f.el, false);
    assert.ok(!f.classes.has('legend-collapsed'));
    assert.equal(f.attrs['aria-label'], 'Legenda minimaliseren');
  });

  it('toggles on click and remembers the choice', () => {
    const f = fakeLegend();
    const store = memory();
    initLegendCollapse(f.el, store);
    assert.ok(!f.classes.has('legend-collapsed'));
    f.click();
    assert.ok(f.classes.has('legend-collapsed'));
    assert.equal(store.m[LEGEND_COLLAPSED_KEY], '1');
    const g = fakeLegend();
    initLegendCollapse(g.el, store);
    assert.ok(g.classes.has('legend-collapsed'), 'restored after reload');
  });
});
