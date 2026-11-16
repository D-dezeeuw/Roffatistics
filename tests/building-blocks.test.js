// Zelf samenstellen (plan-gui-header-wizard §C, v0.57.0): building blocks on top of Standaard.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_BLOCKS, EXCLUSIVE_BLOCKS, normalizeBlocks, customProfile, profileThemes, resolvePreset, PROFILES, STANDAARD } from '../modules/presets.js';
import { normalizeAnswers, encodeAnswers, decodeAnswers, answersToPreset, toggleBlock, describeAnswers, levenstypeHelp, levenstypeLabel, CUSTOM_HINT } from '../modules/wizard-model.js';
import { levenstypeStepHtml } from '../modules/wizard.js';

const ALL_KEYS = new Set(profileThemes('custom', Object.keys(BUILDING_BLOCKS).filter(k => k !== 'levendig'))
  .flatMap(t => t.metrics.map(m => m.key)).concat(profileThemes('custom', ['levendig']).flatMap(t => t.metrics.map(m => m.key))));
const preset = blocks => ({ ...STANDAARD, themes: profileThemes('custom', blocks) });
const byKey = factors => Object.fromEntries(factors.map(f => [f.key, f.weight]));
const close = (a, b, msg, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);

describe('building blocks', () => {
  it('no block = Standaard: the same factors and weights', () => {
    const got = byKey(resolvePreset(preset([]), ALL_KEYS)), want = byKey(resolvePreset(STANDAARD, ALL_KEYS));
    assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort());
    for (const k of Object.keys(want)) close(got[k], want[k], k);
  });

  it('every block only changes its own themes, by its own weight', () => {
    const std = customProfile([]);
    for (const [b, def] of Object.entries(BUILDING_BLOCKS)) {
      const p = customProfile([b]);
      for (const t of new Set([...Object.keys(std.weights), ...Object.keys(p.weights)])) {
        const extra = def.themes[t]?.[0] ?? 0;
        assert.equal((p.weights[t] ?? 0) - (std.weights[t] ?? 0), extra, `${b}/${t} weight`);
        if (!extra) assert.deepEqual(p[t], std[t], `${b}: theme ${t} untouched`);
      }
      assert.ok(Object.keys(def.themes).length > 0 && def.code.length === 1, b);
    }
  });

  it('extra weight goes to the block\'s own metrics: W(m) = W_std(m) + Σ θ_b·s_m/Σs', () => {
    const p = customProfile(['groen']);
    const w = Object.fromEntries(p.voorzieningen.map(([k, , x]) => [k, x]));
    close(w.distGroen, 10, 'distGroen 15·2/3');
    close(w.distOpenNatuur, 5, 'distOpenNatuur 15·1/3');
    close(w.distGP, 2, 'distGP keeps Standaard 10/5');
    const both = customProfile(['ouder', 'bereikbaar']);
    const v = Object.fromEntries(both.voorzieningen.map(([k, , x]) => [k, x]));
    close(v.distOv, (20 * 2) / 7 + (15 * 2) / 4, 'distOv from two blocks adds up (4 decimals)', 1e-4);
    close(v.distStation, 2 + 7.5, 'distStation Standaard + Bereikbaar');
  });

  it('a combination normalises like any preset (sum 1, factor = W(m)/ΣW)', () => {
    const blocks = ['kinderen', 'rustig', 'groen', 'ouder', 'veilig', 'bereikbaar'];
    const f = resolvePreset(preset(blocks), ALL_KEYS);
    close(f.reduce((s, x) => s + x.weight, 0), 1, 'sum');
    const p = customProfile(blocks);
    const total = Object.values(p.weights).reduce((s, x) => s + x, 0);
    const kids = f.find(x => x.key === 'hhWithKidsPct');
    close(kids.weight, 10 / total, 'hhWithKidsPct = 10 of the total');
    assert.equal(f.find(x => x.key === 'noiseNeighbourPct').optional, true, 'optional stays optional');
  });

  it('Levendig and Rustig never together', () => {
    assert.deepEqual(EXCLUSIVE_BLOCKS[0], ['levendig', 'rustig']);
    assert.deepEqual(normalizeBlocks(['rustig', 'levendig', 'groen', 'groen', 'x']), ['groen']);
    let a = toggleBlock({}, 'levendig');
    assert.equal(a.levensfase, 'custom');
    assert.deepEqual(a.blocks, ['levendig']);
    a = toggleBlock(a, 'groen');
    a = toggleBlock(a, 'rustig');
    assert.deepEqual(a.blocks, ['rustig', 'groen'], 'Rustig on switches Levendig off');
    a = toggleBlock(a, 'rustig');
    assert.deepEqual(a.blocks, ['groen'], 'second toggle switches it off');
    const sfeer = answersToPreset(toggleBlock({}, 'levendig')).themes.find(t => t.key === 'sfeer');
    assert.equal(sfeer.metrics.find(m => m.key === 'density').pref, 'higher');
  });

  it('hash and storage: lc<letters> round-trips, old links still read', () => {
    const a = normalizeAnswers({ levensfase: 'custom', blocks: ['groen', 'kinderen'] });
    assert.deepEqual(a.blocks, ['kinderen', 'groen']);
    assert.equal(encodeAnswers(a), 'lckg');
    assert.deepEqual(decodeAnswers('lckg.s30'), normalizeAnswers({ ...a, sfeer: 30 }));
    assert.equal(encodeAnswers({ levensfase: 'custom' }), 'lc');
    assert.deepEqual(decodeAnswers('lc').blocks, []);
    assert.equal(decodeAnswers('lc').levensfase, 'custom');
    assert.equal(decodeAnswers('lg').levensfase, 'gezin');
    assert.deepEqual(decodeAnswers('lg').blocks, []);
    assert.deepEqual(decodeAnswers('lclr').blocks, [], 'a crafted druk+rustig link gives neither');
    const codes = Object.values(BUILDING_BLOCKS).map(b => b.code);
    assert.equal(new Set(codes).size, codes.length);
    assert.deepEqual(normalizeAnswers({ levensfase: 'gezin', blocks: ['groen'] }).blocks, [], 'blocks only with custom');
  });

  it('labels, hint and the wizard markup', () => {
    assert.equal(levenstypeLabel('custom'), 'Zelf samengesteld');
    assert.match(describeAnswers({ levensfase: 'custom', blocks: ['kinderen', 'groen'] }), /zelf samengesteld \(kinderen, groen & natuur\)/);
    assert.ok(levenstypeHelp('custom').endsWith(CUSTOM_HINT));
    assert.match(levenstypeStepHtml(null), /data-value="custom"/);
    assert.doesNotMatch(levenstypeStepHtml(null), /data-block=/);
    const html = levenstypeStepHtml('custom', ['kinderen']);
    assert.equal((html.match(/type="checkbox" data-block="/g) ?? []).length, Object.keys(BUILDING_BLOCKS).length);
    assert.match(html, /data-block="kinderen" checked/);
    assert.match(html, /id="wiz-tip-custom">Zwaarst: Voorzieningen 30/);
    assert.ok(PROFILES.standaard && !('custom' in PROFILES));
  });
});
