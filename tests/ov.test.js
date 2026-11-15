// OV-lijnen (W26): toggle state, distances, values, wizard mapping, build helpers, data files.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  OV_MODES, OV_URLS, DEFAULT_OV, OV_STORAGE_KEY, OV_DRAW_ORDER, parseOvState, serializeOvState, pickInitialOv, storeOv, toggleOv,
  nearestStopKm, ovValues, withOvValues, toLatLngs, loadOvAfstand, _resetOvCache,
} from '../modules/ov.js';
import { simplifyLine, mergeLines, clusterStops, routeMode, buildModes } from '../scripts/build-ov-lines.mjs';
import { answersToPreset, encodeAnswers, decodeAnswers, DICHTBIJ, STRESS_W } from '../modules/wizard-model.js';
import { DATASETS } from '../modules/datasets.js';
import { decodeLevel } from '../modules/nl-areas.js';
import { joinAreas } from '../modules/areas.js';

const memStorage = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const file = rel => new URL(`../${rel.replace(/^\.\//, '')}`, import.meta.url);

describe('ov: toggle state', () => {
  it('defaults to all off (metro, tram and bus)', () => {
    assert.deepEqual(DEFAULT_OV, { metro: false, tram: false, bus: false });
    assert.deepEqual(pickInitialOv(memStorage()), DEFAULT_OV);
    assert.deepEqual(pickInitialOv(null), DEFAULT_OV);
  });
  it('round-trips through storage, "" means all off, unknown names are ignored', () => {
    const s = memStorage();
    storeOv({ metro: false, tram: true, bus: true }, s);
    assert.equal(s.m.get(OV_STORAGE_KEY), 'tram,bus');
    assert.deepEqual(pickInitialOv(s), { metro: false, tram: true, bus: true });
    assert.deepEqual(parseOvState(''), { metro: false, tram: false, bus: false });
    assert.deepEqual(parseOvState('metro, ferry'), { metro: true, tram: false, bus: false });
    assert.equal(serializeOvState({ bus: true, metro: true }), 'metro,bus');
  });
  it('survives blocked storage', () => {
    const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.deepEqual(pickInitialOv(boom), DEFAULT_OV);
    assert.doesNotThrow(() => storeOv(DEFAULT_OV, boom));
  });
  it('toggles one mode, ignores unknown ones', () => {
    assert.deepEqual(toggleOv(DEFAULT_OV, 'bus'), { metro: false, tram: false, bus: true });
    assert.deepEqual(toggleOv(DEFAULT_OV, 'metro'), { metro: true, tram: false, bus: false });
    assert.deepEqual(toggleOv(DEFAULT_OV, 'ferry'), DEFAULT_OV);
  });
  it('colours: metro blue, tram red, bus muted and thinnest; bus drawn at the bottom', () => {
    assert.equal(OV_MODES.metro.color, '#2662cc');
    assert.equal(OV_MODES.tram.color, '#b72824');
    assert.ok(OV_MODES.bus.weight < OV_MODES.tram.weight && OV_MODES.tram.weight < OV_MODES.metro.weight);
    assert.deepEqual(OV_DRAW_ORDER, ['bus', 'tram', 'metro']);
    assert.deepEqual(toLatLngs([[[4.1, 51.9], [4.2, 52]]]), [[[51.9, 4.1], [52, 4.2]]]);
  });
});

describe('ov: distances and values', () => {
  it('nearestStopKm: haversine to the nearest [lng, lat] stop, 1 decimal', () => {
    const stops = [[4.469, 51.9244, 'Centraal'], [4.469, 52.0244, 'Noord']];
    assert.equal(nearestStopKm([51.9244, 4.469], stops), 0);
    assert.equal(nearestStopKm([52.0, 4.469], stops), 2.7);       // 0.0244° lat ≈ 2.71 km to Noord
    assert.equal(nearestStopKm([51.8244, 4.469], stops), 11.1);   // 0.1° lat ≈ 11.12 km
    assert.equal(nearestStopKm([51.9, 4.4], []), null);
    assert.equal(nearestStopKm(null, stops), null);
  });
  it('ovValues: halte = nearest of metro and tram; OV = nearest of that and the train station', () => {
    assert.deepEqual(ovValues({ distStation: 1.8 }, [2.5, 0.4]), { distMetro: 2.5, distTram: 0.4, distOvHalte: 0.4, distOv: 0.4 });
    assert.deepEqual(ovValues({ distStation: 0.3 }, [2.5, 0.4]), { distMetro: 2.5, distTram: 0.4, distOvHalte: 0.4, distOv: 0.3 });
    assert.deepEqual(ovValues({ distStation: 1.2 }, [null, null]), { distMetro: null, distTram: null, distOvHalte: null, distOv: 1.2 });
    assert.equal(ovValues({}, [2, 3]).distOv, null, 'no train distance (gemeente level): no OV value');
    assert.deepEqual(ovValues({ distMetro: 5, distTram: 7, distStation: 9 }), { distMetro: 5, distTram: 7, distOvHalte: 5, distOv: 5 });
  });
  it('withOvValues reads the table by code; NL decodeLevel derives halte/OV from the columns', () => {
    assert.equal(withOvValues({ distStation: 2 }, 'WK059901', { WK059901: [1, 0.5] }).distOv, 0.5);
    assert.equal(withOvValues({ a: 1 }, 'X', null).distMetro, null);
    const nl = decodeLevel({ format: 1, codes: ['BU05990110'], names: ['Stadsdriehoek'], cols: { distStation: [1.1], distMetro: [0.3], distTram: [0.2] } });
    assert.equal(nl[0].values.distOvHalte, 0.2);
    assert.equal(nl[0].values.distOv, 0.2);
  });
  it('joinAreas (Rotterdam) takes the prebuilt pair from nabij.ov', () => {
    const f = { properties: { statcode: 'WK059901', statnaam: 'Stadscentrum' }, geometry: { type: 'Polygon', coordinates: [[[4.47, 51.92], [4.49, 51.92], [4.49, 51.93], [4.47, 51.92]]] } };
    const [a] = joinAreas([f], [], [], { ov: { WK059901: [0.4, 0.2] } });
    assert.equal(a.values.distMetro, 0.4);
    assert.equal(a.values.distOvHalte, 0.2);
  });
  it('loadOvAfstand returns the codes map, {} on failure', async () => {
    _resetOvCache();
    assert.deepEqual(await loadOvAfstand({ fetcher: async () => ({ ok: true, json: async () => ({ codes: { GM0599: [1, 2] } }) }) }), { GM0599: [1, 2] });
    _resetOvCache();
    assert.deepEqual(await loadOvAfstand({ fetcher: async () => { throw new Error('offline'); } }), {});
    _resetOvCache();
  });
  it('datasets: four OV layers in Voorzieningen, outside the totals', () => {
    for (const k of ['distMetro', 'distTram', 'distOvHalte', 'distOv']) {
      assert.equal(DATASETS[k].group, 'voorzieningen', k);
      assert.equal(DATASETS[k].inOverall, false, k);
      assert.match(DATASETS[k].description, /halte|station/, k);
    }
    assert.ok(DATASETS.distMetro.source.some(s => s.id === 'OSM'));
  });
});

describe('ov: wizard', () => {
  it('Vervoer OV weighs distOv (train, metro or tram), no longer distStation alone', () => {
    const p = answersToPreset({ vervoer: ['ov'] });
    const vz = p.themes.find(t => t.key === 'voorzieningen');
    assert.equal(vz.metrics.find(m => m.key === 'distOv').w, STRESS_W);
    assert.equal(vz.metrics.find(m => m.key === 'distStation')?.w, undefined, 'distStation keeps only its standard weight');
  });
  it('Wat wil je dichtbij?: new item "Metro of tram" (code o), hash round-trip; old hashes decode as before', () => {
    assert.equal(DICHTBIJ.ov.code, 'o');
    assert.deepEqual(DICHTBIJ.ov.metrics.map(([k]) => k), ['distOvHalte']);
    const codes = Object.values(DICHTBIJ).map(d => d.code);
    assert.equal(new Set(codes).size, codes.length, 'unique letters');
    const enc = encodeAnswers({ dichtbij: { ov: 3, station: 1 } });
    assert.match(enc, /o3/);
    assert.deepEqual(decodeAnswers(enc).dichtbij, { ov: 3, station: 1 });
    assert.deepEqual(decodeAnswers(encodeAnswers({ dichtbij: { park: 2 } })).dichtbij, { park: 2 });
  });
});

describe('ov: build helpers (scripts/build-ov-lines.mjs)', () => {
  it('simplifyLine drops collinear points, keeps corners', () => {
    const line = [[4, 52], [4.0001, 52], [4.0002, 52], [4.0003, 52.001]];
    assert.deepEqual(simplifyLine(line, 2), [[4, 52], [4.0002, 52], [4.0003, 52.001]]);
    assert.deepEqual(simplifyLine([[4, 52], [4.1, 52]]), [[4, 52], [4.1, 52]]);
  });
  it('mergeLines chains ways that share end points, either direction', () => {
    const out = mergeLines([[[0, 0], [1, 0]], [[2, 0], [1, 0]], [[5, 5], [6, 6]]]);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], [[0, 0], [1, 0], [2, 0]]);
  });
  it('clusterStops merges both platforms of a stop by name, keeps distinct stops apart', () => {
    const s = clusterStops([[4.4690, 51.9244, 'Rotterdam Centraal'], [4.4692, 51.9246, 'Centraal'], [4.4800, 51.9300, 'Stadhuis']]);
    assert.equal(s.length, 2);
    assert.equal(s[0][2], 'Rotterdam Centraal');
  });
  it('routeMode: subway = metro, RET/GVB light rail = metro, other light rail = tram, museum lines skipped', () => {
    assert.equal(routeMode({ route: 'subway' }), 'metro');
    assert.equal(routeMode({ route: 'light_rail', network: 'RET' }), 'metro');
    assert.equal(routeMode({ route: 'light_rail', operator: 'U-OV' }), 'tram');
    assert.equal(routeMode({ route: 'tram', operator: 'RET' }), 'tram');
    assert.equal(routeMode({ route: 'tram', operator: 'Rotterdams Openbaar Vervoer Museum' }), null);
    assert.equal(routeMode({ route: 'train' }), null);
  });
  it('buildModes: track ways (no platforms) and stop nodes per mode, clipped to a bbox', () => {
    const osm = { elements: [
      { type: 'relation', id: 1, tags: { route: 'subway', ref: 'A' }, members: [{ type: 'way', ref: 10, role: '' }, { type: 'way', ref: 11, role: 'platform' }, { type: 'node', ref: 100, role: 'stop' }] },
      { type: 'way', id: 10, geometry: [{ lon: 4.4, lat: 51.9 }, { lon: 4.5, lat: 51.9 }] },
      { type: 'way', id: 11, geometry: [{ lon: 4.4, lat: 51.91 }, { lon: 4.41, lat: 51.91 }] },
      { type: 'node', id: 100, lon: 4.4, lat: 51.9, tags: { name: 'Halte' } },
    ] };
    const m = buildModes(osm, ['metro', 'tram']);
    assert.equal(m.metro.lines.length, 1);
    assert.deepEqual(m.metro.stops, [[4.4, 51.9, 'Halte']]);
    assert.equal(m.tram.lines.length, 0);
    assert.equal(buildModes(osm, ['metro'], [52.5, 5, 53, 6]).metro.lines.length, 0);
  });
});

describe('ov: committed data files', () => {
  const caps = { [OV_URLS.lines]: 900e3, [OV_URLS.bus]: 600e3, [OV_URLS.afstand]: 60e3 };
  for (const [url, cap] of Object.entries(caps)) {
    it(`${url} exists, carries the OSM attribution, under ${cap / 1e3} kB`, () => {
      const size = statSync(file(url)).size;
      assert.ok(size < cap, `${url} is ${size} bytes`);
      const data = JSON.parse(readFileSync(file(url), 'utf8'));
      assert.match(data.source, /OpenStreetMap/);
      assert.equal(data.license, url === OV_URLS.afstand ? undefined : 'ODbL 1.0');
    });
  }
  it('metro-tram covers the RET metro (incl. Den Haag and Hoek van Holland) and trams in Rotterdam, Den Haag, Amsterdam, Utrecht', () => {
    const { modes } = JSON.parse(readFileSync(file(OV_URLS.lines), 'utf8'));
    const near = (stops, lat, lng, km = 1.5) => nearestStopKm([lat, lng], stops) <= km;
    assert.ok(near(modes.metro.stops, 51.9244, 4.4690), 'Rotterdam Centraal metro');
    assert.ok(near(modes.metro.stops, 51.9810, 4.1220, 2), 'Hoek van Holland metro');
    assert.ok(near(modes.metro.stops, 52.0800, 4.3240), 'Den Haag Centraal (lijn E)');
    assert.ok(near(modes.metro.stops, 52.3780, 4.9000), 'Amsterdam Centraal metro');
    assert.ok(near(modes.tram.stops, 51.9220, 4.4770), 'Rotterdam tram');
    assert.ok(near(modes.tram.stops, 52.0800, 4.3100), 'Den Haag tram');
    assert.ok(near(modes.tram.stops, 52.3700, 4.8900), 'Amsterdam tram');
    assert.ok(near(modes.tram.stops, 52.0890, 5.1100, 2), 'Utrecht tram');
  });
  it('afstand.json has every Rotterdam wijk and Rotterdam itself', () => {
    const { codes } = JSON.parse(readFileSync(file(OV_URLS.afstand), 'utf8'));
    assert.ok(codes.GM0599 && codes.WK059901 && codes.BU05990110);
    assert.ok(codes.WK059901[0] < 1.5 && codes.WK059901[1] < 1, 'Stadscentrum: metro and tram close by');
  });
});
