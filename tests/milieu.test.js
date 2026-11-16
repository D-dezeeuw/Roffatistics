// Milieu per buurt (docs/plan-milieu.md, phase 1): build helpers (code mapping,
// aggregation), the data file, the layers in DATASETS and Mijn stapel, the area modal block.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MILIEU_KEYS, MILIEU_URL, cleanValue, combinedHinder, rivmValues, mapBuurten, samplePoints, largestOverlap, bboxOf,
  weightedMeans, encodeMilieuLevel, decodeMilieu, milieuValuesFor, addMilieuValues, withMilieuRows,
  loadMilieu, isMilieuLoaded, getMilieuEntry, milieuPanelHtml, _setMilieuData,
} from '../modules/milieu.js';
import { DATASETS, DATASET_GROUPS, LAYER_KEYS, categoryDatasets, datasetInScope } from '../modules/datasets.js';
import { isStackable, defaultDirection, parseStack, assignStack, stackResult, setActiveStack } from '../modules/stapel.js';
import { pointInRings } from '../modules/score-labels.js';
import { formatValue } from '../modules/dashboard-data.js';

const FILE = new URL(`../${MILIEU_URL.slice(2)}`, import.meta.url);
const json = JSON.parse(await readFile(FILE, 'utf8'));
const square = (x0, y0, x1, y1) => [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]];
const cand = (code, polys) => ({ code, polys, bbox: bboxOf(polys) });

afterEach(() => _setMilieuData(null));

describe('milieu: source values', () => {
  it('RIVM -9999 (no estimate) and negatives are null', () => {
    assert.equal(cleanValue(-9999), null);
    assert.equal(cleanValue('7.3'), 7.3);
    assert.equal(cleanValue(null), null);
  });

  it('stilte-index combines the five sources as independent', () => {
    const rec = { b_gel_weg: 10, b_gel_trei: 0, b_gel_vv: 0, b_gel_wtn: 0, b_gel_bu: 10 };
    assert.equal(combinedHinder(rec), 19);   // 1 − 0.9 × 0.9
    assert.equal(combinedHinder({ ...rec, b_gel_vv: -9999 }), null);
    assert.deepEqual(rivmValues({ ...rec, b_gel_weg: 7.33 }), { noiseRoadPct: 7.3, noiseNeighbourPct: 10, noiseAnyPct: 16.6 });
  });
});

describe('milieu: buurt 2024 → 2025', () => {
  it('same code first, else the overlap, else unmatched', () => {
    const m = mapBuurten(['BU1', 'BU2', 'BU3'], ['BU1', 'BU9'], c => (c === 'BU2' ? 'BU9' : c === 'BU3' ? 'BUX' : null));
    assert.deepEqual([...m.map], [['BU1', 'BU1'], ['BU2', 'BU9']]);
    assert.equal(m.byCode, 1);
    assert.equal(m.byOverlap, 1);
    assert.deepEqual(m.unmatched, ['BU3']);   // an overlap with a code that has no data does not count
  });

  it('largest area overlap by sampling', () => {
    const p25 = square(0, 0, 10, 10);
    const pts = samplePoints(p25, pointInRings, 10);
    assert.equal(pts.length, 100);
    const a = cand('BU_A', square(0, 0, 3, 10)), b = cand('BU_B', square(3, 0, 10, 10)), far = cand('BU_C', square(50, 50, 60, 60));
    assert.equal(largestOverlap(pts, [a, b, far], pointInRings), 'BU_B');
    assert.equal(largestOverlap(pts, [far], pointInRings), null);
  });
});

describe('milieu: aggregation and file format', () => {
  it('population-weighted means; no inhabitants or no value does not count', () => {
    const rows = [
      { code: 'BU05990101', pop: 300, values: { noiseRoadPct: 10, heatPet: 40 } },
      { code: 'BU05990102', pop: 100, values: { noiseRoadPct: 20, heatPet: null } },
      { code: 'BU05990103', pop: 0, values: { noiseRoadPct: 90, heatPet: 90 } },
    ];
    const wk = weightedMeans(rows, c => `WK${c.slice(2, 8)}`);
    assert.deepEqual(wk.get('WK059901'), { noiseAnyPct: null, noiseRoadPct: 12.5, noiseNeighbourPct: null, heatPet: 40, shadePct: null });
  });

  it('encode → decode round-trips every level', () => {
    const lvl = encodeMilieuLevel(new Map([['GM0599', { noiseRoadPct: 11.7 }], ['BU1', { heatPet: 44 }]]));
    assert.deepEqual(lvl.codes, ['BU1', 'GM0599']);
    const d = decodeMilieu({ format: 1, levels: { x: lvl } });
    assert.equal(d.get('GM0599').noiseRoadPct, 11.7);
    assert.equal(d.get('BU1').shadePct, null);
    assert.throws(() => decodeMilieu({ format: 2 }));
  });

  it('the built file covers every 2025 buurt, Rotterdam and Amsterdam, with sane ranges', () => {
    assert.equal(json.format, 1);
    assert.equal(json.year, 2025);
    assert.equal(json.mapping.unmatched, 0);
    const d = decodeMilieu(json);
    for (const code of ['GM0599', 'GM0363', 'PV28', 'BU05990110']) assert.ok(d.get(code)?.heatPet > 30, code);
    for (const gm of ['GM0599', 'GM0363']) {
      const e = d.get(gm);
      assert.ok(e.noiseRoadPct > 0 && e.noiseRoadPct < 40, `${gm} road ${e.noiseRoadPct}`);
      assert.ok(e.noiseAnyPct >= e.noiseRoadPct, `${gm} any ≥ road`);
      assert.ok(e.shadePct > 0 && e.shadePct < 100);
    }
    for (const [, cols] of Object.entries(json.levels).map(([k, l]) => [k, l.cols])) {
      for (const k of MILIEU_KEYS) assert.ok(cols[k].every(v => v == null || (v >= 0 && v <= 100)), k);
    }
  });
});

describe('milieu: joined values, layers and stack', () => {
  it('adds values to areas and rows once loaded, a no-op before', async () => {
    const areas = [{ code: 'BU05990110', values: { population: 1 } }, { code: 'XX', values: {} }];
    addMilieuValues(areas);
    assert.equal(areas[0].values.heatPet, undefined);
    assert.ok(!isMilieuLoaded());
    await loadMilieu({ fetcher: async () => ({ ok: true, json: async () => json }) });
    addMilieuValues(areas);
    assert.ok(areas[0].values.heatPet > 30);
    assert.equal(areas[0].values.population, 1);
    assert.deepEqual(areas[1].values, {});
    const rows = withMilieuRows([{ regionCode: 'GM0599', population: 5 }, { regionCode: 'PV28' }]);
    assert.equal(rows[0].population, 5);
    assert.ok(rows[0].noiseRoadPct > 0 && rows[1].heatPet > 30);
    assert.deepEqual(Object.keys(milieuValuesFor('BU_NONE', decodeMilieu(json))), MILIEU_KEYS);
  });

  it('five layers in group Milieu, all of NL, out of the Totaalscore, stackable with a direction', () => {
    assert.ok(DATASET_GROUPS.some(g => g.key === 'milieu' && g.headline === 'noiseAnyPct'));
    assert.deepEqual(categoryDatasets('milieu').map(d => d.key).sort(), [...MILIEU_KEYS].sort());
    for (const k of MILIEU_KEYS) {
      const d = DATASETS[k];
      assert.ok(LAYER_KEYS.includes(k) && isStackable(k), k);
      assert.ok(datasetInScope(k, 'rotterdam') && datasetInScope(k, 'nederland'), k);
      assert.equal(d.inOverall, false);
      assert.ok(d.description && d.source.length && d.year, k);
      assert.match(d.source.map(s => s.publisher).join(' '), /Public Domain|CC BY 4\.0/, k);
    }
    assert.equal(defaultDirection('noiseAnyPct'), 'l');
    assert.equal(defaultDirection('shadePct'), 'h');
    for (const k of ['noiseAnyPct', 'noiseRoadPct', 'noiseNeighbourPct']) assert.match(DATASETS[k].caveats.join(' '), /Modelschatting, geen meting/);
    assert.equal(formatValue(44.44, 'heatPet'), '44,4 °C');
  });

  it('happy flow: a Rotterdam stack of milieu layers scores every buurt with data', async () => {
    await loadMilieu({ fetcher: async () => ({ ok: true, json: async () => json }) });
    const d = decodeMilieu(json);
    const buurten = json.levels.buurt.codes.filter(c => c.startsWith('BU0599')).map(code => ({ code, values: {} }));
    addMilieuValues(buurten);
    const items = parseStack('noiseAnyPct,heatPet,shadePct');
    assert.equal(items.length, 3);
    setActiveStack('noiseAnyPct,heatPet,shadePct');
    assignStack(buurten);
    const scored = buurten.filter(b => b.values.stapel != null);
    assert.ok(scored.length > 50, `${scored.length} scored`);
    assert.ok(stackResult(scored[0].code));
    const html = milieuPanelHtml(getMilieuEntry('GM0599'));
    assert.match(html, /Milieu/);
    assert.match(html, /modelschattingen/);
    assert.match(html, /°C/);
    assert.equal(milieuPanelHtml(null), '');
    assert.equal(d.get('GM0599').heatPet, getMilieuEntry('GM0599').heatPet);
  });
});
