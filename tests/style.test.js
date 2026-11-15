// Guards style.css against the two ways the 0.11 views lost their colours:
// an unclosed block (everything after it silently nests inside an @media rule)
// and custom properties that are used but never defined.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"\n]*"|'[^'\n]*'/g, '""');

/** Selectors of the rules that sit at the top level (depth 0) of the sheet. */
function topLevelSelectors(src) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { if (depth === 0) out.push(src.slice(start, i).trim()); depth++; }
    else if (c === '}') { depth--; if (depth === 0) start = i + 1; }
    else if (c === ';' && depth === 0) start = i + 1;
  }
  return out;
}

describe('style.css', () => {
  it('has balanced braces (no block left open)', () => {
    let depth = 0, line = 1;
    for (const c of stripped) {
      if (c === '\n') line++;
      if (c === '{') depth++;
      if (c === '}') { depth--; assert.ok(depth >= 0, `stray } on line ${line}`); }
    }
    assert.equal(depth, 0, 'a { is never closed');
  });

  it('keeps the view blocks at the top level, outside any @media rule', () => {
    const top = topLevelSelectors(stripped);
    for (const sel of ['.view-list', '.list-table', '.dash', '.dash-tip', '.dash-svg', '.search-modal', '.dash-donuts', '.dash-slice']) {
      assert.ok(top.some(s => s.split(',').map(x => x.trim()).includes(sel)), `${sel} is not a top-level rule`);
    }
  });

  it('defines every custom property it uses', () => {
    const defined = new Set([...stripped.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
    const sources = { 'style.css': stripped };
    for (const f of readdirSync(new URL('../modules/', import.meta.url))) {
      if (f.endsWith('.js')) sources[`modules/${f}`] = readFileSync(new URL(`../modules/${f}`, import.meta.url), 'utf8');
    }
    const missing = [];
    for (const [file, src] of Object.entries(sources)) {
      for (const m of src.matchAll(/var\(\s*(--[\w-]+)/g)) if (!defined.has(m[1])) missing.push(`${m[1]} (${file})`);
    }
    assert.deepEqual([...new Set(missing)], []);
  });

  it('keeps the Ranglijst sticky cells opaque and layered', () => {
    const rules = [...stripped.matchAll(/([^{}]*\.list-table[^{}]*)\{([^}]*)\}/g)].filter(m => /background/.test(m[2]));
    for (const [, sel, body] of rules) assert.doesNotMatch(body, /background:\s*rgba\(/, `translucent row background in ${sel.trim()}`);
    assert.match(stripped, /\.list-table \.col-rank, \.list-table \.col-name, \.list-table \.col-score \{ position: sticky; z-index: 2; \}/);
    assert.match(stripped, /\.list-table thead \.col-rank, \.list-table thead \.col-name, \.list-table thead \.col-score \{ z-index: 4;/);
    assert.match(stripped, /\.list-table td\.col-data \{ z-index: 0; \}/);
  });

  it('gives SVG text, options and the views an explicit light colour', () => {
    assert.match(stripped, /\.dash svg text\s*\{[^}]*fill:\s*var\(--text-muted\)/);
    assert.match(stripped, /(^|\n)option, optgroup\s*\{[^}]*background:\s*var\(--bg-surface\)/);
    assert.match(stripped, /\n\.view\s*\{\s*color:\s*var\(--text-primary\)/);
    assert.match(stripped, /color-scheme:\s*dark/);
  });
});

describe('contrast (WCAG AA, 4.5:1 for small text)', () => {
  const hex = name => stripped.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))[1];
  const lum = h => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // #22202c ≈ the 'geen data' bar: NO_DATA_COLOR (#4b4658) at 35 % over the card surface.
  const surfaces = { base: hex('--bg-base'), surface: hex('--bg-surface'), alt: hex('--bg-surface-alt'), selected: '#241a3a', nodataBar: '#22202c' };

  for (const [name, bg] of Object.entries(surfaces)) {
    it(`muted and primary text pass on ${name}`, () => {
      assert.ok(ratio(hex('--text-muted'), bg) >= 4.5, `muted on ${name}: ${ratio(hex('--text-muted'), bg).toFixed(2)}`);
      assert.ok(ratio(hex('--text-primary'), bg) >= 4.5);
    });
  }
});
