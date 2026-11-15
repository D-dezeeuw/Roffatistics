import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SNAPSHOT_W, SNAPSHOT_H, slug, snapshotFileName, displayUrl, canShareFiles,
  fitText, fitSize, coverCrop, snapshotTexts, snapshotLayout, estimateWidth, personalMapAllowed,
} from '../modules/snapshot.js';

describe('snapshot file name', () => {
  it('slugs layer and area, drops accents and empty parts', () => {
    assert.equal(slug('Woonscore · jouw wensen (0–100)'), 'woonscore-jouw-wensen-0-100');
    assert.equal(slug('Kralingen-Crooswijk'), 'kralingen-crooswijk');
    assert.equal(slug('Café Één'), 'cafe-een');
    assert.equal(snapshotFileName({ layer: 'Woonscore', area: 'Delfshaven' }), 'roffatistics-woonscore-delfshaven.png');
    assert.equal(snapshotFileName({ layer: 'Inwoners' }), 'roffatistics-inwoners.png');
    assert.equal(snapshotFileName(), 'roffatistics.png');
  });
  it('caps the slug length without a trailing dash', () => {
    const s = slug('a'.repeat(39) + ' b c d');
    assert.ok(s.length <= 40);
    assert.ok(!s.endsWith('-'));
  });
});

describe('displayUrl', () => {
  it('keeps host and path, never the #state', () => {
    assert.equal(displayUrl('https://d-dezeeuw.github.io/Roffatistics/#scope=rotterdam&score=custom.abc'), 'd-dezeeuw.github.io/Roffatistics');
    assert.equal(displayUrl('http://localhost:3000/index.html#x'), 'localhost:3000');
    assert.equal(displayUrl('not a url'), 'd-dezeeuw.github.io/Roffatistics');
  });
});

describe('canShareFiles', () => {
  const file = { name: 'x.png' };
  it('needs share and canShare, and canShare to say yes', () => {
    assert.equal(canShareFiles(null, [file]), false);
    assert.equal(canShareFiles({ share() {} }, [file]), false);
    assert.equal(canShareFiles({ share() {}, canShare: () => false }, [file]), false);
    assert.equal(canShareFiles({ share() {}, canShare: d => d.files.length === 1 }, [file]), true);
    assert.equal(canShareFiles({ share() {}, canShare: () => { throw new TypeError('x'); } }, [file]), false);
  });
});

describe('text fitting', () => {
  const m = (t, px) => t.length * px * 0.5;
  it('fitText leaves short text alone and ellipsises long text within the width', () => {
    assert.equal(fitText('Delfshaven', 500, 20, m), 'Delfshaven');
    const cut = fitText('Een heel erg lange naam van een buurt in Rotterdam', 200, 20, m);
    assert.ok(cut.endsWith('…'));
    assert.ok(m(cut, 20) <= 200);
    assert.equal(fitText('abc', 1, 20, m), '');
  });
  it('fitSize shrinks in steps of 2 down to the minimum', () => {
    assert.equal(fitSize('abcd', 1000, 40, 20, m), 40);
    assert.equal(fitSize('abcdefghij', 150, 40, 20, m), 30);
    assert.equal(fitSize('a'.repeat(100), 10, 40, 20, m), 20);
  });
});

describe('coverCrop', () => {
  it('crops a wide map to 1200:630 around the centre', () => {
    const c = coverCrop(2400, 900);
    assert.ok(Math.abs(c.sw / c.sh - SNAPSHOT_W / SNAPSHOT_H) < 1e-9);
    assert.equal(c.sh, 900);
    assert.equal(c.sx, (2400 - c.sw) / 2);
    assert.equal(c.sy, 0);
  });
  it('crops a tall (phone) map vertically', () => {
    const c = coverCrop(400, 800);
    assert.equal(c.sw, 400);
    assert.ok(c.sy > 0 && c.sh < 800);
  });
  it('returns an empty crop for an unsized map', () => assert.deepEqual(coverCrop(0, 0), { sx: 0, sy: 0, sw: 0, sh: 0 }));
});

describe('snapshotTexts', () => {
  it('only passes layer, area, legend and view through', () => {
    const t = snapshotTexts({ title: 'Woonscore · jouw wensen (0–100)', area: 'Kop van Zuid', view: 'list', legend: { colors: ['#000', '', 5, '#fff'], from: '0', to: '100' }, answers: { herkomst: 'x' } });
    assert.deepEqual(Object.keys(t).sort(), ['area', 'colors', 'from', 'title', 'to', 'viewLabel']);
    assert.deepEqual(t.colors, ['#000', '#fff']);
    assert.equal(t.viewLabel, 'Ranglijst');
  });
  it('has a default title', () => assert.equal(snapshotTexts().title, 'Rotterdam en Nederland in cijfers'));
});

describe('snapshotLayout', () => {
  const input = { title: 'Inwoners · per km²', area: 'Delfshaven', legend: { colors: ['#a', '#b', '#c', '#d', '#e'], from: '10', to: '900' } };
  const inside = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= SNAPSHOT_W + 1e-9 && r.y + r.h <= SNAPSHOT_H + 1e-9;

  it('map view: a bottom band, chips at the right, nothing off the image', () => {
    const L = snapshotLayout(input, { hasMap: true, url: 'https://d-dezeeuw.github.io/Roffatistics/#a=1' });
    assert.equal(L.card.y + L.card.h, SNAPSHOT_H);
    assert.equal(L.chips.length, 5);
    for (const c of L.chips) assert.ok(inside(c) && c.y >= L.card.y);
    for (let i = 1; i < L.chips.length; i++) assert.ok(L.chips[i].x >= L.chips[i - 1].x + L.chips[i - 1].w);
    assert.ok(L.title.x + estimateWidth(L.title.text, L.title.px, true) <= L.chips[0].x);
    assert.equal(L.url.text, 'd-dezeeuw.github.io/Roffatistics');
    assert.equal(L.area.text, 'Delfshaven');
    assert.ok(L.from.text === '10' && L.to.align === 'right');
  });
  it('no map (dashboard/ranglijst): a full card with the view label', () => {
    const L = snapshotLayout({ ...input, view: 'dashboard' }, { hasMap: false });
    assert.deepEqual(L.card, { x: 0, y: 0, w: SNAPSHOT_W, h: SNAPSHOT_H });
    assert.equal(L.viewLabel.text, 'Dashboard');
    for (const c of L.chips) assert.ok(inside(c));
    assert.ok(L.url.y < SNAPSHOT_H);
  });
  it('long titles shrink and are cut, an empty legend uses the full width', () => {
    const L = snapshotLayout({ title: 'X'.repeat(200) }, { hasMap: true });
    assert.equal(L.chips.length, 0);
    assert.equal(L.title.px, 28);
    assert.ok(L.title.text.endsWith('…'));
    assert.ok(L.title.x + estimateWidth(L.title.text, 28, true) <= SNAPSHOT_W - 40);
    assert.equal(L.area, null);
  });
});

describe('personalMapAllowed', () => {
  it('always for non-personal layers', () => assert.equal(personalMapAllowed({ personal: false }), true));
  it('needs the answers ticked', () => assert.equal(personalMapAllowed({ personal: true, options: { answers: false } }), false));
  it('needs every present sensitive part ticked', () => {
    const present = { origin: true, education: false, income: true };
    assert.equal(personalMapAllowed({ personal: true, options: { answers: true, origin: true }, present }), false);
    assert.equal(personalMapAllowed({ personal: true, options: { answers: true, origin: true, income: true }, present }), true);
    assert.equal(personalMapAllowed({ personal: true, options: { answers: true }, present: { origin: false } }), true);
  });
});
