import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTES, PALETTE_IDS, PALETTE_OPTIONS, MAP_PALETTE_STORAGE_KEY, THEME_PALETTE,
  parsePaletteChoice, resolvePalette, pickInitialPaletteChoice, storePaletteChoice, activePalette,
  metricKind, normalizeKind, rampFor, rampColor, continuousColor, paletteCssVars, applyPaletteVars,
  averageComparison, formatRatio, scopeAverageLabel, mean,
} from '../modules/palette.js';
import { buildScale, scaleAverageText, CLASS_COLORS, NO_DATA_COLOR, OUTLIER_COLOR, interpolateColor } from '../modules/scale.js';
import { schoolColor } from '../modules/school-pins.js';
import { legendScaleHtml } from '../modules/legend.js';
import { DATASETS } from '../modules/datasets.js';
import { THEMES } from '../modules/theme.js';

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
const lum = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const isRedish = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); return r > g + 60 && r > b + 60; };
const isGreenish = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); return g > r + 30 && g > b; };

describe('palettes', () => {
  it('three palettes with 7 distinct classes per kind, a no-data and an outlier colour of their own', () => {
    assert.deepEqual(PALETTE_IDS, ['rotterdam', 'klassiek', 'mokum', 'kleurenblind']);
    for (const p of Object.values(PALETTES)) {
      for (const kind of ['directional', 'neutral', 'origin']) {
        assert.equal(p[kind].length, 7, `${p.id} ${kind}`);
        assert.equal(new Set(p[kind]).size, 7, `${p.id} ${kind} distinct`);
        for (const c of p[kind]) assert.match(c, /^#[0-9a-f]{6}$/);
        assert.ok(!p[kind].includes(p.noData), `${p.id} no-data apart from ${kind}`);
        assert.ok(!p[kind].includes(p.outlier), `${p.id} outlier apart from ${kind}`);
      }
      // origin never shares a colour with the score or neutral ramp
      for (const c of p.origin) assert.ok(!p.directional.includes(c) && !p.neutral.includes(c), `${p.id} origin ${c}`);
    }
  });
  it('Paars-oranje is the original ramp, unchanged', () => {
    assert.deepEqual([...PALETTES.klassiek.directional], [...CLASS_COLORS]);
    assert.equal(PALETTES.klassiek.directional[0], '#2e1065');
    assert.equal(PALETTES.klassiek.directional[6], '#ea580c');
    assert.equal(NO_DATA_COLOR, '#4b4658');
    assert.equal(OUTLIER_COLOR, '#ef4444');
    assert.deepEqual([...rampFor('klassiek', 'down')], [...CLASS_COLORS], 'no flip in Paars-oranje');
    assert.deepEqual([...rampFor('klassiek', 'neutral')], [...CLASS_COLORS]);
    assert.equal(continuousColor('klassiek', 'up', 0.5), interpolateColor(50, 0, 100), 'linear: the old ramp');
  });
  it('Rotterdam: red = bad → green = good, an outlier colour that is neither', () => {
    const p = PALETTES.rotterdam;
    assert.ok(isRedish(p.directional[0]), 'worst class red');
    assert.ok(isGreenish(p.directional[6]), 'best class green');
    assert.ok(!isRedish(p.outlier) && !isGreenish(p.outlier), 'outlier not red, not green');
  });
  it('Kleurenblind-veilig: no red/green, blue = bad → orange = good', () => {
    const p = PALETTES.kleurenblind;
    for (const c of p.directional) assert.ok(!isGreenish(c), c);
    const [r0, , b0] = [1, 3, 5].map(i => parseInt(p.directional[0].slice(i, i + 2), 16));
    const [r6, , b6] = [1, 3, 5].map(i => parseInt(p.directional[6].slice(i, i + 2), 16));
    assert.ok(b0 > r0 && r6 > b6);
  });
  it('neutral and origin ramps run light → dark (single hue), readable: no class near black or white', () => {
    for (const p of Object.values(PALETTES)) for (const kind of ['neutral', 'origin']) {
      if (p.id === 'klassiek' && kind === 'neutral') continue;   // the original ramp
      const l = p[kind].map(lum);
      for (let i = 1; i < 7; i++) assert.ok(l[i] < l[i - 1], `${p.id} ${kind} monotone`);
      assert.ok(l[6] > 25 && l[0] < 250, `${p.id} ${kind} readable on dark and light`);
    }
  });
});

describe('direction', () => {
  it('flips lower-is-better metrics so the good end has the same colour', () => {
    const up = rampFor('rotterdam', 'up'), down = rampFor('rotterdam', 'down');
    assert.deepEqual([...down], [...up].reverse());
    assert.equal(down[0], up[6], 'lowest crime = green');
    const s = buildScale([1, 2, 3, 4, 5, 6, 7], { palette: 'rotterdam', kind: false });
    assert.equal(s.colorFor(1), PALETTES.rotterdam.directional[6]);
    assert.equal(s.colorFor(7), PALETTES.rotterdam.directional[0]);
    assert.equal(buildScale([1, 2, 3, 4, 5, 6, 7], { palette: 'kleurenblind', kind: 'down' }).colorFor(1), PALETTES.kleurenblind.directional[6]);
  });
  it('neutral metrics use the single-hue ramp, never red-green', () => {
    const s = buildScale([1, 2, 3, 4, 5, 6, 7], { palette: 'rotterdam', kind: null });
    assert.deepEqual(s.classes.map(c => c.color), [...PALETTES.rotterdam.neutral]);
    for (const c of s.classes) assert.ok(!isRedish(c.color));
  });
  it('metricKind reads the dataset: herkomst = origin, higherIsBetter = up/down, else neutral', () => {
    assert.equal(metricKind(DATASETS.woonscore), 'up');
    assert.equal(metricKind(DATASETS.eduScore), 'up');
    assert.equal(metricKind(DATASETS.eduNearScore), 'up');
    assert.equal(metricKind(DATASETS.density), 'neutral');
    assert.equal(metricKind(DATASETS.pop25to44), 'neutral');
    for (const k of ['originDutchPct', 'originEuropePct', 'nonWesternPct', 'bornAbroadPct']) assert.equal(metricKind(DATASETS[k]), 'origin', k);
    const down = Object.values(DATASETS).find(d => d.higherIsBetter === false);
    assert.equal(metricKind(down), 'down');
    assert.equal(metricKind(undefined), 'neutral');
    assert.equal(normalizeKind('sideways'), 'neutral');
  });
  it('§5: every herkomst dataset is neutral (no good/bad) and gets the origin ramp', () => {
    const origin = Object.values(DATASETS).filter(d => metricKind(d) === 'origin');
    assert.ok(origin.length >= 4);
    for (const d of origin) assert.equal(d.higherIsBetter, null, d.key);
    const s = buildScale([1, 2, 3, 4, 5, 6, 7], { palette: 'rotterdam', kind: 'origin' });
    assert.deepEqual(s.classes.map(c => c.color), [...PALETTES.rotterdam.origin]);
  });
  it('origin scales never flag outliers', () => {
    const vals = [30, 40, 45, 50, 55, 60, 65, 70, 75, 80, 500];
    assert.equal(buildScale(vals, { kind: 'neutral' }).isOutlier(500), true);
    const s = buildScale(vals, { kind: 'origin' });
    assert.equal(s.isOutlier(500), false);
    assert.deepEqual(s.outliers, { high: 0, low: 0 });
  });
  it('linear method follows the palette too', () => {
    const s = buildScale([0, 10], { method: 'linear', palette: 'rotterdam', kind: 'up' });
    assert.equal(s.colorFor(0), PALETTES.rotterdam.directional[0]);
    assert.equal(s.colorFor(10), PALETTES.rotterdam.directional[6]);
    assert.equal(rampColor(['#000000', '#ffffff'], 0.5), '#808080');
  });
});

describe('choice: Volgt thema, storage', () => {
  it('Volgt thema maps rotterdam → Rotterdam and klassiek → Paars-oranje', () => {
    assert.equal(resolvePalette('auto', 'rotterdam'), PALETTES.rotterdam);
    assert.equal(resolvePalette('auto', 'klassiek'), PALETTES.klassiek);
    assert.equal(resolvePalette('auto', 'neon'), PALETTES.rotterdam, 'unknown theme → default theme');
    for (const t of Object.keys(THEMES)) assert.ok(THEME_PALETTE[t], `every theme has a palette: ${t}`);
    assert.equal(resolvePalette('kleurenblind', 'klassiek'), PALETTES.kleurenblind, 'an explicit choice beats the theme');
    assert.equal(resolvePalette(PALETTES.klassiek), PALETTES.klassiek);
  });
  it('parses stored values; unknown → Volgt thema', () => {
    for (const v of ['auto', 'rotterdam', 'klassiek', 'mokum', 'kleurenblind']) assert.equal(parsePaletteChoice(v), v);
    for (const v of [null, undefined, '', 'Rotterdam', 'toString', 42]) assert.equal(parsePaletteChoice(v), 'auto');
    assert.deepEqual(PALETTE_OPTIONS.map(o => o.label), ['Volgt thema', 'Rotterdam', 'Paars-oranje', 'Mokum', 'Kleurenblind-veilig']);
  });
  it('stores under roffatistics.mapPalette, survives blocked storage', () => {
    const st = memStorage();
    assert.equal(pickInitialPaletteChoice(st), 'auto');
    assert.equal(storePaletteChoice('kleurenblind', st), 'kleurenblind');
    assert.equal(st.m.get(MAP_PALETTE_STORAGE_KEY), 'kleurenblind');
    assert.equal(storePaletteChoice('x', st), 'auto');
    assert.equal(pickInitialPaletteChoice(boom), 'auto');
    assert.doesNotThrow(() => storePaletteChoice('klassiek', boom));
  });
  it('activePalette combines the stored choice with <html data-theme>', () => {
    const doc = { documentElement: { dataset: { theme: 'klassiek' } } };
    assert.equal(activePalette(memStorage(), doc), PALETTES.klassiek);
    assert.equal(activePalette(memStorage({ [MAP_PALETTE_STORAGE_KEY]: 'rotterdam' }), doc), PALETTES.rotterdam);
    assert.equal(activePalette(boom, null), PALETTES.rotterdam);
  });
  it('CSS variables: outlier, good/bad, school swatch; applied on <html>', () => {
    const v = paletteCssVars('kleurenblind');
    assert.equal(v['--map-outlier'], PALETTES.kleurenblind.outlier);
    assert.match(v['--map-school-ramp'], /^linear-gradient\(90deg, #2b4c9b/);
    const props = {};
    const doc = { documentElement: { dataset: {}, style: { setProperty: (k, x) => { props[k] = x; } } } };
    assert.equal(applyPaletteVars('rotterdam', doc), 'rotterdam');
    assert.equal(props['--map-outlier'], '#d946ef');
    assert.equal(doc.documentElement.dataset.mapPalette, 'rotterdam');
    assert.equal(applyPaletteVars('rotterdam', null), null);
  });
  it('school pins: red → green under Rotterdam', () => {
    assert.ok(isRedish(schoolColor(50, PALETTES.rotterdam)));
    assert.ok(isGreenish(schoolColor(99, PALETTES.rotterdam)));
  });
});

describe('herkomst: against the scope average', () => {
  const pct = v => `${Math.round(v)}%`;
  it('phrases the ratio with the scope', () => {
    assert.equal(averageComparison(18, 7.2, { scope: 'rotterdam', format: pct }), '2,5× het Rotterdamse gemiddelde (7%)');
    assert.equal(averageComparison(7, 7, { scope: 'nederland', format: pct }), '1× het landelijke gemiddelde (7%)');
    assert.equal(averageComparison(3, 12, { format: pct }), '0,3× het gemiddelde (12%)');
    assert.equal(averageComparison(0, 7, { scope: 'rotterdam', format: pct }), 'het Rotterdamse gemiddelde is 7%');
  });
  it('null, zero or missing average gives no phrase', () => {
    for (const a of [null, undefined, 0, -1, NaN, '7']) assert.equal(averageComparison(18, a), '', String(a));
    for (const v of [null, undefined, NaN, '18']) assert.equal(averageComparison(v, 7), '', String(v));
  });
  it('formatRatio and scope labels', () => {
    assert.equal(formatRatio(2.46), '2,5×');
    assert.equal(formatRatio(12.3), '12×');
    assert.equal(formatRatio(2), '2×');
    assert.equal(scopeAverageLabel('rotterdam'), 'het Rotterdamse gemiddelde');
    assert.equal(scopeAverageLabel('x'), 'het gemiddelde');
    assert.equal(mean([1, null, 3, 'a']), 2);
    assert.equal(mean([]), null);
  });
  it('scaleAverageText only for origin scales, against the mean of the scale', () => {
    const vals = [2, 4, 6, 8, 10];
    assert.equal(scaleAverageText(12, buildScale(vals, { kind: 'origin', scope: 'rotterdam' }), pct), '2× het Rotterdamse gemiddelde (6%)');
    assert.equal(scaleAverageText(12, buildScale(vals, { kind: 'neutral' }), pct), '');
    assert.equal(scaleAverageText(null, buildScale(vals, { kind: 'origin' }), pct), '');
    assert.equal(scaleAverageText(5, buildScale([0, 0], { kind: 'origin' }), pct), '', 'zero average');
  });
  it('legend: "Gemeenschap: weinig → veel", no outlier line, no good/bad words', () => {
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 80];
    const html = legendScaleHtml(buildScale(vals, { kind: 'origin', palette: 'rotterdam' }), 'nonWesternPct');
    assert.match(html, /Gemeenschap: weinig → veel/);
    assert.match(html, /gemiddelde/);
    assert.doesNotMatch(html, /uitschieter|beter|slechter/);
    for (const c of PALETTES.rotterdam.origin) assert.ok(html.includes(c), c);
    const linear = legendScaleHtml(buildScale(vals, { kind: 'up', palette: 'rotterdam', method: 'linear' }), 'woonscore');
    assert.match(linear, /linear-gradient\(to right, #c62828/);
  });
});

describe('Mokum palette (Mokumistics)', () => {
  const p = PALETTES.mokum;
  const L = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [x, y] = [L(a), L(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  it('good/bad stays red → green as in Rotterdam; herkomst the same indigo', () => {
    assert.deepEqual(p.directional, PALETTES.rotterdam.directional);
    assert.deepEqual(p.origin, PALETTES.rotterdam.origin);
    assert.equal(p.flips, true);
    assert.ok(isRedish(rampFor(p, 'up')[0]) && isGreenish(rampFor(p, 'up')[6]));
    assert.ok(isGreenish(rampFor(p, 'down')[0]), 'lower-is-better: low values green');
  });
  it('neutral ramp runs grey → black: colourless and strictly darker per class', () => {
    for (const h of p.neutral) { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 4, `${h} is grey`); }
    for (let i = 1; i < 7; i++) assert.ok(contrast(p.neutral[i - 1], p.neutral[i]) >= 1.2, `classes ${i - 1}/${i} tell apart`);
    assert.ok(L(p.neutral[6]) < 0.02, 'ends near black');
  });
  it('outliers magenta, distinct from every ramp; no-data off the grey ramp', () => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(p.outlier.slice(i, i + 2), 16));
    assert.ok(r > 200 && b > 150 && g < 80, 'magenta');
    for (const k of ['directional', 'neutral', 'origin']) { assert.ok(!p[k].includes(p.outlier)); assert.ok(!p[k].includes(p.noData)); }
    assert.ok(contrast(p.outlierText, '#1c1c1c') >= 4.5, 'outlier text on the Mokum surface');
    assert.ok(contrast(p.goodText, '#1c1c1c') >= 4.5 && contrast(p.badText, '#1c1c1c') >= 4.5);
  });
  it('"Volgt thema" maps both Mokum themes to it', () => {
    assert.equal(THEME_PALETTE.mokum, 'mokum');
    assert.equal(resolvePalette('auto', 'mokum-licht').id, 'mokum');
    assert.ok(Object.keys(THEMES).every(t => THEME_PALETTE[t]), 'every theme has a palette');
  });
});
