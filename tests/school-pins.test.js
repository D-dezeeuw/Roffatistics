// Basisscholen pins (W31): toggle state, colour, rows from the column file, popup markup, Leaflet layer wiring.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SCHOOL_PINS_STORAGE_KEY, DEFAULT_SCHOOL_PINS, SCHOOL_NO_SCORE_COLOR, SCHOOLS_URL,
  parseSchoolPins, pickInitialSchoolPins, storeSchoolPins, schoolScoreClass, schoolColor, schoolPinRadius,
  schoolsFromFile, schoolGrade, schoolPopupHtml, escapeHtml, addSchoolPinsLayer,
} from '../modules/school-pins.js';
import { CLASS_COLORS } from '../modules/scale.js';
import { PALETTES, activePalette } from '../modules/palette.js';
import { APP_STORAGE_PREFIX } from '../modules/legal.js';
import { _setEduData, loadEduSchools, getEduSchools } from '../modules/onderwijs.js';

const memStorage = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

describe('school pins: toggle state', () => {
  it('default off, own app key', () => {
    assert.equal(DEFAULT_SCHOOL_PINS, false);
    assert.ok(SCHOOL_PINS_STORAGE_KEY.startsWith(APP_STORAGE_PREFIX));
    assert.equal(pickInitialSchoolPins(memStorage()), false);
    assert.equal(pickInitialSchoolPins(boom), false);
    assert.equal(pickInitialSchoolPins(null), false);
  });
  it('round-trips "1"/"0"; junk gives the default', () => {
    const st = memStorage();
    storeSchoolPins(true, st);
    assert.equal(st.m.get(SCHOOL_PINS_STORAGE_KEY), '1');
    assert.equal(pickInitialSchoolPins(st), true);
    storeSchoolPins(false, st);
    assert.equal(pickInitialSchoolPins(st), false);
    assert.equal(parseSchoolPins('xyz'), false);
    assert.doesNotThrow(() => storeSchoolPins(true, boom));
  });
});

describe('school pins: colour', () => {
  it('7 classes on the app ramp over 60..90, clamped; high = orange end', () => {
    assert.equal(schoolScoreClass(10), 0);
    assert.equal(schoolScoreClass(60), 0);
    assert.equal(schoolScoreClass(77), 3);
    assert.equal(schoolScoreClass(90), 6);
    assert.equal(schoolScoreClass(100), 6);
    assert.equal(schoolColor(95, PALETTES.klassiek), CLASS_COLORS[6]);
    assert.equal(schoolColor(50, PALETTES.klassiek), CLASS_COLORS[0]);
    assert.equal(schoolColor(95, PALETTES.rotterdam), PALETTES.rotterdam.directional[6], 'Rotterdam: best schools green');
    assert.equal(schoolColor(50, PALETTES.rotterdam), PALETTES.rotterdam.directional[0], 'Rotterdam: weakest red');
    assert.equal(schoolColor(95), activePalette().directional[6], 'default: the live palette');
    for (let s = 50; s < 100; s += 5) assert.ok(schoolScoreClass(s + 5) >= schoolScoreClass(s), 'monotone');
  });
  it('grey without a score', () => {
    for (const v of [null, undefined, NaN, '70']) assert.equal(schoolColor(v), SCHOOL_NO_SCORE_COLOR);
    assert.ok(!CLASS_COLORS.includes(SCHOOL_NO_SCORE_COLOR));
  });
  it('radius grows with zoom', () => {
    assert.ok(schoolPinRadius(8) < schoolPinRadius(12));
    assert.ok(schoolPinRadius(12) < schoolPinRadius(15));
  });
});

const file = {
  format: 1, smallN: 30,
  cols: {
    brin: ['AA01', 'BB02', 'CC03'], name: ['De <Maasparel> & "Co"', 'Klein', 'Nieuw'], street: ['Kerkenbos 28', 'Dorp 1', 'Laan 2'],
    postcode: ['2716PH', '1234AB', '3000AA'], place: ['Zoetermeer', 'Ergens', 'Rotterdam'],
    lat: [52.06, 51.1, null], lon: [4.47, 5.8, null], buurt: ['BU1', 'BU2', null], gemeente: [null, null, 'GM0599'],
    score: [71.3, 64.96, null], tested: [43, 12, null], estimate: [1, 0, 0], fund: [91.9, 90, null], streef: [50.8, 40, null],
    lezenFund: [100, 95, null], lezenStreef: [72.1, 60, null], taalFund: [90.7, 90, null], taalStreef: [51.2, 40, null],
    rekenenFund: [84.9, 85, null], rekenenStreef: [29.1, 20, null],
  },
};

describe('school pins: rows and popup', () => {
  it('column file → objects; drops schools without coordinates; small = tested < smallN', () => {
    const rows = schoolsFromFile(file);
    assert.deepEqual(rows.map(r => r.brin), ['AA01', 'BB02']);
    assert.deepEqual(rows.map(r => r.small), [false, true]);
    assert.deepEqual(schoolsFromFile(null), []);
  });
  it('grade = score/10, one decimal, Dutch comma', () => {
    assert.equal(schoolGrade(71.3), '7,1');
    assert.equal(schoolGrade(64.96), '6,5');
    assert.equal(schoolGrade(100), '10,0');
    assert.equal(schoolGrade(null), null);
  });
  it('popup: escaped name and address, grade, per-subject 1F and 2F/1S, pupils, flags', () => {
    const [a, b] = schoolsFromFile(file);
    const html = schoolPopupHtml(a);
    assert.match(html, /De &lt;Maasparel&gt; &amp; &quot;Co&quot;/);
    assert.doesNotMatch(html, /<Maasparel>/);
    assert.match(html, /Kerkenbos 28, 2716 PH Zoetermeer/);
    assert.match(html, /<b>7,1<\/b> \/ 10/);
    assert.match(html, /<th scope="row">Lezen<\/th><td>100%<\/td><td>72%<\/td>/);
    assert.match(html, /<th scope="row">Rekenen<\/th><td>85%<\/td><td>29%<\/td>/);
    assert.match(html, /43 getoetste leerlingen/);
    assert.doesNotMatch(html, /Klein aantal/);
    assert.match(html, /Deels geschat/);
    assert.match(schoolPopupHtml(b), /Klein aantal leerlingen/);
    const none = schoolPopupHtml({ ...a, score: null });
    assert.match(none, /Geen toetsgegevens/);
    assert.doesNotMatch(none, /\/ 10/);
    assert.equal(escapeHtml(`<a href='x'>`), '&lt;a href=&#39;x&#39;&gt;');
  });
});

describe('school pins: data file and Leaflet layer', () => {
  it('the school file exists where the layer fetches it and every row yields a valid pin', () => {
    const real = JSON.parse(readFileSync(new URL('../' + SCHOOLS_URL.replace('./', ''), import.meta.url)));
    const rows = schoolsFromFile(real);
    assert.ok(rows.length > 6000);
    for (const r of rows) assert.match(schoolColor(r.score), /^#[0-9a-f]{6}$/);
    assert.ok(rows.some(r => r.score == null) && rows.some(r => r.small));
  });
  it('off by default: creates its pane, fetches nothing; set(true) stores, fetches once and adds the layer', async () => {
    const panes = {}, attributions = [];
    let fetches = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async url => { fetches++; assert.equal(url, SCHOOLS_URL); return { ok: true, json: async () => file }; };
    const marker = () => ({ bindPopup() { return this; }, setRadius() {} });
    const map = {
      layers: new Set(), getPane: n => panes[n], createPane: n => (panes[n] = { style: {} }), getZoom: () => 12, on() {},
      hasLayer: l => map.layers.has(l), attributionControl: { addAttribution: a => attributions.push(a), removeAttribution: a => attributions.splice(attributions.indexOf(a), 1) },
    };
    const group = { layers: [], addTo(m) { m.layers.add(this); return this; }, remove() { map.layers.delete(this); }, eachLayer(fn) { this.layers.forEach(fn); } };
    const L = { svg: () => ({}), circleMarker: () => marker(), layerGroup: ls => Object.assign(group, { layers: ls }) };
    _setEduData();   // nothing loaded yet
    try {
      const st = memStorage();
      const api = addSchoolPinsLayer(L, map, { storage: st });
      assert.equal(api.get(), false);
      assert.equal(panes.schoolPins.style.pointerEvents, 'none');
      assert.equal(fetches, 0);
      await api.set(true);
      assert.equal(st.m.get(SCHOOL_PINS_STORAGE_KEY), '1');
      assert.equal(group.layers.length, 2);
      assert.ok(map.hasLayer(group));
      assert.equal(attributions.length, 1);
      await api.set(false);
      assert.ok(!map.hasLayer(group));
      assert.equal(attributions.length, 0);
      await api.set(true);
      assert.equal(fetches, 1, 'file fetched once');
      assert.equal(getEduSchools().length, 3, 'through the shared onderwijs.js loader');
      await loadEduSchools();
      assert.equal(fetches, 1, 'the area panel reuses the same file');
    } finally { globalThis.fetch = origFetch; _setEduData(); }
  });
  it('the pins reuse a school file the area panel already loaded (no second fetch)', async () => {
    _setEduData({ schools: file });
    let fetches = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { fetches++; return { ok: true, json: async () => file }; };
    const map = { layers: new Set(), getPane: () => ({ style: {} }), createPane: () => ({ style: {} }), getZoom: () => 12, on() {}, hasLayer: l => map.layers.has(l), attributionControl: null };
    let made = 0;
    const L = { svg: () => ({}), circleMarker: () => { made++; return { bindPopup() { return this; } }; }, layerGroup: ls => ({ ls, addTo(m) { m.layers.add(this); return this; } }) };
    try {
      await addSchoolPinsLayer(L, map, { storage: memStorage() }).set(true);
      assert.equal(fetches, 0);
      assert.equal(made, 2, 'only the schools with coordinates');
    } finally { globalThis.fetch = origFetch; _setEduData(); }
  });
});
