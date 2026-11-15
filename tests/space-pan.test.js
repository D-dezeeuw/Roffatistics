import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldStartPan, initSpacePan } from '../modules/space-pan.js';

const key = (extra = {}) => ({ code: 'Space', key: ' ', target: { tagName: 'DIV', closest: () => null }, ...extra });

describe('shouldStartPan', () => {
  it('starts on Space over the page', () => assert.equal(shouldStartPan(key()), true));
  it('ignores other keys', () => assert.equal(shouldStartPan(key({ code: 'KeyA', key: 'a' })), false));
  it('ignores Space while typing', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']) assert.equal(shouldStartPan(key({ target: { tagName } })), false, tagName);
    assert.equal(shouldStartPan(key({ target: { tagName: 'DIV', isContentEditable: true } })), false);
  });
  it('ignores Space inside an open dialog', () => assert.equal(shouldStartPan(key({ target: { tagName: 'DIV', closest: () => ({}) } })), false));
  it('ignores modified Space and a hidden map', () => {
    assert.equal(shouldStartPan(key({ ctrlKey: true })), false);
    assert.equal(shouldStartPan(key(), false), false);
  });
});

function fakeDom() {
  const handlers = {};
  const target = { addEventListener: (t, f) => (handlers[t] = f), removeEventListener: (t) => delete handlers[t] };
  const classes = new Set();
  const container = { offsetParent: {}, getClientRects: () => [1], classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } };
  return { handlers, target, classes, container };
}

describe('initSpacePan', () => {
  it('toggles space-pan on hold and release, and on blur', () => {
    const { handlers, target, classes, container } = fakeDom();
    initSpacePan(container, target, target);
    let prevented = 0;
    handlers.keydown(key({ preventDefault: () => prevented++ }));
    assert.ok(classes.has('space-pan'));
    handlers.keydown(key({ repeat: true, preventDefault: () => prevented++ }));
    assert.equal(prevented, 2, 'auto-repeat also stops page scroll');
    handlers.keyup(key());
    assert.ok(!classes.has('space-pan'));
    handlers.keydown(key({ preventDefault() {} }));
    handlers.blur();
    assert.ok(!classes.has('space-pan'));
  });
});
