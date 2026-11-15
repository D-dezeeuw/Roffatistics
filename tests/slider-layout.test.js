// W23: one slider layout for the wizard: name + value on top, the range full
// width, the end labels under its left and right end (wizard.js sliderHtml,
// style.css .wiz-slider).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sliderHtml } from '../modules/wizard.js';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const rule = sel => css.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[2] ?? '';

describe('shared slider markup', () => {
  const html = sliderHtml({
    cls: 'wiz-imp', id: 'wiz-imp-x', label: 'Veiligheid', value: 'Belangrijk', ends: ['Niet belangrijk', 'Heel belangrijk'],
    input: '<input type="range" min="0" max="4" value="3" aria-labelledby="wiz-imp-x" aria-valuetext="Belangrijk">',
  });
  it('name, value, range, then both end labels in that order', () => {
    const order = ['wiz-slider-name', '<output>', 'type="range"', 'wiz-range-ends', 'Niet belangrijk', 'Heel belangrijk'].map(s => html.indexOf(s));
    assert.ok(order.every(i => i >= 0), 'all parts present');
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.match(html, /<label class="wiz-slider wiz-imp">/);
    assert.match(html, /id="wiz-imp-x"/);
    assert.match(html, /aria-valuetext="Belangrijk"/);
  });
  it('escapes labels', () => {
    assert.match(sliderHtml({ id: 'a', label: 'A & B', input: '', value: '<x>', ends: ['l', 'r'] }), /A &amp; B.*&lt;x&gt;/s);
  });
});

describe('slider CSS', () => {
  it('range spans the full width with the ends on the row under it', () => {
    assert.match(rule('.wiz-slider > input[type="range"]'), /grid-column:\s*1 \/ -1;\s*grid-row:\s*2/);
    assert.match(rule('.wiz-slider > .wiz-range-ends'), /grid-column:\s*1 \/ -1;\s*grid-row:\s*3/);
    assert.match(rule('.wiz-range-ends'), /justify-content:\s*space-between/);
  });
  it('no fixed label column left that squeezes the end labels', () => {
    assert.doesNotMatch(css, /\.wiz-slider\s*\{[^}]*7\.5rem/);
    assert.doesNotMatch(css, /\.wiz-slider\s*\{[^}]*6rem 1fr 2rem/);
  });
});
