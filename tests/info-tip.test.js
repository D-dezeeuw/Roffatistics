// (i) toggletips (plan-gui-header-wizard §B, v0.56.0): tap, keyboard and hover, Escape-dismissable.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { infoTipHtml, tipClick, tipEscape, tipBlur } from '../modules/info-tip.js';

function fakeBtn() {
  const attrs = new Map([['aria-expanded', 'false']]);
  const b = {
    getAttribute: k => attrs.get(k) ?? null,
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: k => attrs.delete(k),
    hasAttribute: k => attrs.has(k),
    matches: sel => sel === '.tip-btn',
    closest: sel => (sel === '.tip-btn' ? b : null),
  };
  return b;
}
const fakeRoot = btns => ({ querySelectorAll: () => btns.filter(b => b.getAttribute('aria-expanded') === 'true') });
const other = { closest: () => null, matches: () => false };

describe('info-tip', () => {
  it('markup: button described by the tooltip text, text escaped', () => {
    const html = infoTipHtml('tip-x', 'Veiligheid 30 · <b>', 'Thema\'s van Gezin');
    assert.match(html, /<button type="button" class="tip-btn" data-tip aria-expanded="false" aria-describedby="tip-x" aria-label="Thema&#39;s van Gezin">i<\/button>/);
    assert.match(html, /<span class="info-tip-text" role="tooltip" id="tip-x">Veiligheid 30 · &lt;b&gt;<\/span>/);
  });
  it('tap toggles; tapping another tip or elsewhere closes the open one', () => {
    const a = fakeBtn(), b = fakeBtn(), root = fakeRoot([a, b]);
    assert.equal(tipClick(root, a), true);
    assert.equal(a.getAttribute('aria-expanded'), 'true');
    tipClick(root, b);
    assert.equal(a.getAttribute('aria-expanded'), 'false');
    assert.equal(b.getAttribute('aria-expanded'), 'true');
    assert.equal(tipClick(root, other), false);
    assert.equal(b.getAttribute('aria-expanded'), 'false');
    tipClick(root, a); tipClick(root, a);
    assert.equal(a.getAttribute('aria-expanded'), 'false', 'second tap closes');
  });
  it('Escape hides an open tip, then the focus-shown one; a third Escape is not consumed', () => {
    const a = fakeBtn(), root = fakeRoot([a]);
    tipClick(root, a);
    assert.equal(tipEscape(root, a), true);
    assert.equal(a.getAttribute('aria-expanded'), 'false');
    assert.equal(a.hasAttribute('data-tip-dismissed'), true, 'focus no longer shows it');
    assert.equal(tipEscape(root, a), false, 'nothing left: the dialog may close');
    tipBlur(a);
    assert.equal(a.hasAttribute('data-tip-dismissed'), false, 'next focus shows it again');
    assert.equal(tipEscape(root, other), false);
  });
  it('style.css: shown on tap, keyboard focus and pointer hover, not hover alone', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(css, /\.tip-btn\[aria-expanded="true"\] \+ \.info-tip-text,\n\.tip-btn:focus-visible:not\(\[data-tip-dismissed\]\) \+ \.info-tip-text \{ display: block; \}/);
    assert.match(css, /@media \(hover: hover\) \{ \.info-tip:hover > \.info-tip-text \{ display: block; \} \}/);
  });
});

describe('wizard initial focus', () => {
  it('never lands on an (i) button, so no tip opens when a step renders', () => {
    const js = readFileSync(new URL('../modules/wizard.js', import.meta.url), 'utf8');
    assert.match(js, /\.wiz-body button:not\(\.tip-btn\)/);
  });
});
