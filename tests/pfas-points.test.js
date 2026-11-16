// PFAS-punten overlay (docs/plan-milieu.md phase 2, item 7): kinds, file format, popup, toggle state, the built file.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PFAS_POINTS_URL, PFAS_PINS_STORAGE_KEY, DEFAULT_PFAS_PINS, pfasKind, isPfasSource, encodePfasPoints, decodePfasPoints,
  pfasPopupHtml, parsePfasPins, pickInitialPfasPins, storePfasPins, pfasPinRadius, loadPfasPoints, _resetPfasPoints,
} from '../modules/pfas-points.js';
import { normalizeSettings, settingsDialogHtml, SETTINGS_KEYS } from '../modules/settings.js';

const json = JSON.parse(await readFile(new URL(`../${PFAS_POINTS_URL.slice(2)}`, import.meta.url), 'utf8'));
const pt = (o) => ({ lat: 51.9, lon: 4.4, name: 'Sampling location', type: 'Sampling location', value: 12.5, count: 3, matrix: 'ground', ...o });
afterEach(() => _resetPfasPoints());

describe('pfas-points', () => {
  it('kinds: NL soil, PDH groundwater, the listed presumptive sources; Flemish incidents and other sets are left out', () => {
    assert.equal(pfasKind(pt({ category: 'Measurement', source: 'Netherlands PFASBodemTotaal (soil)' })), 'bodem');
    assert.equal(pfasKind(pt({ category: 'Measurement', source: 'PDH groundwater matrix' })), 'grondwater');
    assert.equal(pfasKind(pt({ category: 'Measurement', source: 'Flanders DOV (soil/groundwater)' })), null);
    assert.equal(pfasKind(pt({ category: 'Presumptive', source: 'Airports' })), 'bron');
    assert.equal(pfasKind(pt({ category: 'Presumptive', source: 'Flanders incident sites' })), null);
    assert.ok(isPfasSource(pt({ category: 'Presumptive', source: 'WWTP (waste water treatment plants)' })));
  });

  it('encode → decode keeps every field; sources have no value', () => {
    const file = encodePfasPoints([
      pt({ category: 'Measurement', source: 'Netherlands PFASBodemTotaal (soil)' }),
      pt({ category: 'Presumptive', source: 'Airports', type: 'Airport', name: 'Schiphol', value: 99 }),
      pt({ category: 'Measurement', source: 'Flanders DOV (soil/groundwater)' }),
    ]);
    const d = decodePfasPoints(file);
    assert.equal(d.length, 2);
    assert.deepEqual(d[0], { lat: 51.9, lon: 4.4, kind: 'bodem', type: 'Sampling location', source: 'Netherlands PFASBodemTotaal (soil)', name: '', value: 12.5, count: 3 });
    assert.equal(d[1].kind, 'bron'); assert.equal(d[1].value, null); assert.equal(d[1].name, 'Schiphol');
    assert.throws(() => decodePfasPoints({ format: 9 }));
  });

  it('popup: value with unit, or "verdachte bron"; source and PDH attribution; text escaped', () => {
    const soil = pfasPopupHtml({ kind: 'bodem', type: 'Sampling location', source: 'Netherlands PFASBodemTotaal (soil)', name: '', value: 12.5, count: 3 });
    assert.match(soil, /Bodemmeting/); assert.match(soil, /12,5 ng\/g/); assert.match(soil, /3 monsters/); assert.match(soil, /PFAS Data Hub \(CNRS\)/); assert.match(soil, /gezocht/);
    assert.match(pfasPopupHtml({ kind: 'grondwater', value: 4 }), /4 ng\/L/);
    const src = pfasPopupHtml({ kind: 'bron', type: 'Airport', source: 'Airports', name: '<b>Schiphol</b>' });
    assert.match(src, /Verdachte bron/); assert.match(src, /&lt;b&gt;Schiphol/); assert.match(src, /Vliegveld/); assert.doesNotMatch(src, /ng\//);
  });

  it('toggle state and Instellingen: default off, own key, a checkbox in group Milieu', () => {
    assert.equal(DEFAULT_PFAS_PINS, false);
    assert.equal(parsePfasPins('1'), true); assert.equal(parsePfasPins('0'), false); assert.equal(parsePfasPins(null), false);
    const store = new Map(); const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    storePfasPins(true, storage);
    assert.equal(store.get(PFAS_PINS_STORAGE_KEY), '1'); assert.equal(pickInitialPfasPins(storage), true);
    assert.equal(pickInitialPfasPins({ getItem() { throw new Error('blocked'); } }), false);
    assert.equal(SETTINGS_KEYS.pfas, PFAS_PINS_STORAGE_KEY);
    assert.equal(normalizeSettings({}).pfas, false); assert.equal(normalizeSettings({ pfas: true }).pfas, true);
    assert.match(settingsDialogHtml({ pfas: true }), /name="settings-pfas" value="on" checked/);
    assert.ok(pfasPinRadius(15, 'bron') > pfasPinRadius(15, 'bodem'));
  });

  it('the built file: NL points only, soil measurements and sources, Rotterdam has few', async () => {
    const pts = await loadPfasPoints({ fetcher: async () => ({ ok: true, json: async () => json }) });
    assert.ok(pts.length > 1000, `${pts.length}`);
    assert.ok(pts.every(p => p.lat > 50.7 && p.lat < 53.6 && p.lon > 3.3 && p.lon < 7.25));
    assert.ok(pts.filter(p => p.kind === 'bodem').length > 1000);
    assert.ok(pts.filter(p => p.kind === 'bron').length > 100);
    assert.ok(pts.filter(p => p.kind === 'bron').every(p => p.value == null));
  });
});
