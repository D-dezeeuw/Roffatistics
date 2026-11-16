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
    assert.deepEqual(wk.get('WK059901'), { noiseAnyPct: null, noiseRoadPct: 12.5, noiseNeighbourPct: null, heatPet: 40, shadePct: null, airNo2: null, airPm25: null, pfasSourceKm: null });
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

  it('eight layers in group Milieu, all of NL, out of the Totaalscore, stackable with a direction', () => {
    assert.ok(DATASET_GROUPS.some(g => g.key === 'milieu' && g.headline === 'noiseAnyPct'));
    assert.deepEqual(categoryDatasets('milieu').map(d => d.key).sort(), [...MILIEU_KEYS].sort());
    for (const k of MILIEU_KEYS) {
      const d = DATASETS[k];
      assert.ok(LAYER_KEYS.includes(k) && isStackable(k), k);
      assert.ok(datasetInScope(k, 'rotterdam') && datasetInScope(k, 'nederland'), k);
      assert.equal(d.inOverall, false);
      assert.ok(d.description && d.source.length && d.year, k);
      if (!['airNo2', 'airPm25', 'pfasSourceKm'].includes(k)) assert.match(d.source.map(s => s.publisher).join(' '), /Public Domain|CC BY 4\.0/, k);
    }
    assert.equal(defaultDirection('airNo2'), 'l');
    assert.equal(defaultDirection('pfasSourceKm'), 'h');
    assert.equal(formatValue(19.84, 'airNo2'), '19,8 µg/m³');
    assert.match(DATASETS.pfasSourceKm.caveats.join(' '), /waar iemand gezocht heeft/);
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

// ── Phase 2: air quality and distance to a presumptive PFAS source ──────────
import { wgs84ToRd, rasterValueAt, rasterMeanOver, haversineKm, nearestKm } from '../modules/milieu.js';
import { readFloatTiff } from '../scripts/lib/geotiff.mjs';

/** A tiled big-endian float32 GeoTIFF (tw × th tiles, ModelTransformation, GDAL_NODATA). */
function tiff({ width, height, tw, th, values, ox, oy, s, nodata = '-1' }) {
  const across = Math.ceil(width / tw), down = Math.ceil(height / th), tileBytes = tw * th * 4;
  const tags = [[256, 3, [width]], [257, 3, [height]], [258, 3, [32]], [259, 3, [1]], [277, 3, [1]], [322, 3, [tw]], [323, 3, [th]], [324, 4, null], [325, 4, Array(across * down).fill(tileBytes)], [339, 3, [3]], [34264, 12, [s, 0, 0, ox, 0, -s, 0, oy, 0, 0, 0, 0, 0, 0, 0, 1]], [42113, 2, nodata]];
  const ifd = 8, extra0 = ifd + 2 + tags.length * 12 + 4;
  const chunks = []; let at = extra0;
  const put = b => { const o = at; chunks.push(b); at += b.length; return o; };
  const entries = tags.map(([tag, type, v]) => ({ tag, type, v }));
  const tileStart = () => at;
  // values that do not fit in 4 bytes go after the IFD
  for (const e of entries) {
    if (e.tag === 324) continue;
    if (e.type === 2) { const b = Buffer.from(`${e.v}\0`, 'latin1'); e.cnt = b.length; e.off = b.length <= 4 ? null : put(b); e.raw = b; continue; }
    const size = { 3: 2, 4: 4, 12: 8 }[e.type], b = Buffer.alloc(size * e.v.length);
    e.v.forEach((x, k) => (e.type === 3 ? b.writeUInt16BE(x, k * 2) : e.type === 4 ? b.writeUInt32BE(x, k * 4) : b.writeDoubleBE(x, k * 8)));
    e.cnt = e.v.length; e.raw = b; e.off = b.length <= 4 ? null : put(b);
  }
  const offs = Buffer.alloc(4 * across * down); const offAt = put(offs);
  const t0 = tileStart();
  for (let t = 0; t < across * down; t++) {
    const b = Buffer.alloc(tileBytes), c0 = (t % across) * tw, r0 = Math.floor(t / across) * th;
    for (let r = 0; r < th; r++) for (let c = 0; c < tw; c++) if (r0 + r < height && c0 + c < width) b.writeFloatBE(values[(r0 + r) * width + c0 + c], 4 * (r * tw + c));
    offs.writeUInt32BE(t0 + t * tileBytes, 4 * t); put(b);
  }
  const e324 = entries.find(e => e.tag === 324); e324.cnt = across * down; e324.off = offAt;
  const head = Buffer.alloc(extra0);
  head.write('MM', 0, 'latin1'); head.writeUInt16BE(42, 2); head.writeUInt32BE(ifd, 4); head.writeUInt16BE(entries.length, ifd);
  entries.forEach((e, i) => {
    const p = ifd + 2 + i * 12; head.writeUInt16BE(e.tag, p); head.writeUInt16BE(e.type, p + 2); head.writeUInt32BE(e.cnt, p + 4);
    if (e.off != null) head.writeUInt32BE(e.off, p + 8); else e.raw.copy(head, p + 8);
  });
  return Buffer.concat([head, ...chunks]);
}

describe('milieu phase 2: air raster and PFAS distance', () => {
  it('WGS84 → RD: Amersfoort is the origin, Rotterdam centre lands where RD puts it', () => {
    assert.deepEqual(wgs84ToRd(52.1551744, 5.38720621), [155000, 463000]);
    const [x, y] = wgs84ToRd(51.9225, 4.47917);
    assert.ok(Math.abs(x - 92537) < 50 && Math.abs(y - 437503) < 50, `${x} ${y}`);
  });

  it('reads a tiled float32 GeoTIFF with padded edge tiles; rejects an XML error page', () => {
    const values = Array.from({ length: 5 * 3 }, (_, i) => i + 0.5);
    const t = readFloatTiff(tiff({ width: 5, height: 3, tw: 4, th: 2, values, ox: 1000, oy: 2000, s: 100 }));
    assert.deepEqual([t.width, t.height, t.ox, t.oy, t.sx, t.sy, t.nodata], [5, 3, 1000, 2000, 100, -100, -1]);
    assert.deepEqual([...t.data], values);
    assert.throws(() => readFloatTiff(Buffer.from('<?xml version="1.0"?><ows:ExceptionReport/>')), /not a TIFF/);
  });

  it('raster value at RD points; nodata and outside are null; area mean over a buurt', () => {
    const tile = { ox: 0, oy: 1000, sx: 100, sy: -100, width: 10, height: 10, nodata: 3.4e38, data: Float32Array.from({ length: 100 }, (_, i) => (i % 10 < 5 ? 10 : 20)) };
    tile.data[99] = 3.4e38;
    assert.equal(rasterValueAt([tile], 50, 950), 10);
    assert.equal(rasterValueAt([tile], 950, 950), 20);
    assert.equal(rasterValueAt([tile], 950, 50), null);
    assert.equal(rasterValueAt([tile], -5, 500), null);
    // A fake "polygon" sampler in RD: inside = whole raster; rasterMeanOver converts WGS84 rings, so test via the sample hook.
    const ring = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]].map(([a, b]) => [5.38 + a * 0.01, 52.15 + b * 0.01]);
    let calls = 0;
    const mean = rasterMeanOver([[ring]], () => { calls++; return 12; }, pointInRings, { step: 100 });
    assert.equal(mean, 12);
    assert.ok(calls > 50 && calls < 120, `${calls} samples for ~0,77 km²`);
    const tiny = [[[5.38, 52.15], [5.3801, 52.15], [5.3801, 52.1501], [5.38, 52.15]]];
    assert.equal(rasterMeanOver([tiny], () => 7, pointInRings, { step: 100, centre: [5.38005, 52.15005] }), 7);
    assert.equal(rasterMeanOver([tiny], () => null, pointInRings, { step: 100 }), null);
  });

  it('nearest presumptive source in km', () => {
    assert.ok(Math.abs(haversineKm([4.47917, 51.9225], [4.89, 52.3731]) - 57.2) < 1);
    assert.equal(nearestKm([4.4, 51.9], [[4.4, 51.91], [5, 52]]), 1.1);
    assert.equal(nearestKm([4.4, 51.9], []), null);
  });

  it('the built file holds NO₂, PM2.5 and PFAS distance for (nearly) every buurt', () => {
    const d = decodeMilieu(json);
    assert.deepEqual(json.skipped, []);
    assert.ok(json.noData.airNo2 < 20 && json.noData.airPm25 < 20 && json.noData.pfasSourceKm === 0, JSON.stringify(json.noData));
    for (const gm of ['GM0599', 'GM0363']) {
      const e = d.get(gm);
      assert.ok(e.airNo2 > 10 && e.airNo2 < 40, `${gm} NO2 ${e.airNo2}`);
      assert.ok(e.airPm25 > 4 && e.airPm25 < 20, `${gm} PM2.5 ${e.airPm25}`);
      assert.ok(e.pfasSourceKm > 0 && e.pfasSourceKm < 30, `${gm} PFAS ${e.pfasSourceKm}`);
    }
    assert.ok(d.get('PV28').airNo2 > d.get('PV22').airNo2, 'Zuid-Holland more NO₂ than Friesland');
  });

  it('the area modal lists the new rows with units', () => {
    _setMilieuData(json);
    const html = milieuPanelHtml(getMilieuEntry('GM0599'));
    assert.match(html, /Stikstofdioxide \(NO₂\)[^]*µg\/m³/);
    assert.match(html, /Afstand tot verdachte PFAS-bron[^]*km/);
  });
});

describe('milieu: Standaard Woonscore (v0.54.0)', () => {
  it('Standaard weighs geluidhinder buren, so app.js loads the milieu file for it', async () => {
    const { presetUsesMilieu } = await import('../modules/milieu.js');
    const { STANDAARD, GELIJK } = await import('../modules/presets.js');
    assert.equal(presetUsesMilieu(STANDAARD), true);
    assert.equal(presetUsesMilieu({ themes: [{ metrics: [{ key: 'crimeRate' }] }] }), false);
    assert.equal(presetUsesMilieu(null), false);
    assert.equal(typeof presetUsesMilieu(GELIJK), 'boolean');
  });
});
