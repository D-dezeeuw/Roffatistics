// Epic W2: extra Woonscore data (age bands, gezinnen, nieuwbouw, nabijheid,
// distance to centrum). Pure helpers only; the live CBS check is in integration.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  WIJK_COLUMNS as C, NABIJ_COLUMNS as N, NABIJ_TABLE, NABIJ_FALLBACK_TABLE, CENTRUM_POINT,
  extractAreaValues, mergeYearValues, extractNabijValues, mergeNabijValues,
  geoCentroid, haversineKm, distanceToCentrum, joinAreas, buildNabijUrl, describeDataYears,
} from '../modules/areas.js';
import { DATASETS } from '../modules/datasets.js';
import { STANDAARD, GELIJK } from '../modules/presets.js';

const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const row = (over = {}) => ({
  [C.region]: 'WK059901  ', [C.population]: 1000, [C.age15to24]: 150, [C.age25to44]: 400, [C.age45to64]: 250,
  [C.age65plus]: 100, [C.households]: 600, [C.householdsWithKids]: 150, [C.builtLast10]: 12,
  [C.distSchool]: 0.7, [C.distKinderopvang]: 0.5, ...over,
});
const nrow = (over = {}) => ({ [N.region]: 'WK059901  ', [N.distStation]: 1.2, [N.distCafe]: 0.3, [N.cafes1km]: 23.1, [N.restaurants1km]: 75.3, ...over });
const square = (lng, lat, d) => ({ type: 'Polygon', coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]] });

describe('W2 kerncijfers fields', () => {
  it('age bands and gezinnen are shares; nieuwbouw and distances are taken as they are', () => {
    const v = extractAreaValues(row());
    assert.equal(v.pop15to24, 15); assert.equal(v.pop25to44, 40); assert.equal(v.pop45to64, 25); assert.equal(v.pop65plus, 10);
    assert.equal(v.hhWithKidsPct, 25);
    assert.equal(v.newBuildPct, 12);
    assert.equal(v.distSchool, 0.7); assert.equal(v.distKinderopvang, 0.5);
  });
  it('unknown cells give null, never 0 or NaN', () => {
    const v = extractAreaValues(row({ [C.households]: null, [C.age25to44]: null, [C.builtLast10]: null, [C.distSchool]: null }));
    for (const k of ['hhWithKidsPct', 'pop25to44', 'newBuildPct', 'distSchool']) assert.equal(v[k], null, k);
    assert.equal(extractAreaValues(row({ [C.households]: 0 })).hhWithKidsPct, null);
  });
  it('falls back per field to the 2024 row and records the year', () => {
    const { values, years } = mergeYearValues(row({ [C.distSchool]: null, [C.householdsWithKids]: null }), row({ [C.distSchool]: 0.9, [C.householdsWithKids]: 300 }));
    assert.equal(values.distSchool, 0.9); assert.equal(values.hhWithKidsPct, 50);
    assert.equal(years.distSchool, 2024); assert.equal(years.hhWithKidsPct, 2024);
    assert.equal(years.pop25to44, undefined);
    assert.match(describeDataYears(years), /gezinnen, school: 2024/);
  });
});

describe('W2 nabijheid (86270NED → 86134NED)', () => {
  it('targets the nabijheid tables with only its own columns', () => {
    const u = new URL(buildNabijUrl());
    assert.ok(u.pathname.includes(`/${NABIJ_TABLE}/`) && NABIJ_TABLE === '86270NED');
    assert.ok(buildNabijUrl(NABIJ_FALLBACK_TABLE).includes('/86134NED/'));
    assert.deepEqual(u.searchParams.get('$select').split(','), Object.values(N));
  });
  it('extracts station, café and horeca within 1 km (cafés + restaurants)', () => {
    const { distStation, distCafe, horeca1km } = extractNabijValues(nrow());
    assert.deepEqual({ distStation, distCafe, horeca1km }, { distStation: 1.2, distCafe: 0.3, horeca1km: 98.4 });
    assert.equal(extractNabijValues(nrow({ [N.restaurants1km]: null })).horeca1km, null);
    assert.ok(Object.values(extractNabijValues(null)).every(v => v === null));
  });
  it('falls back per field to 2024', () => {
    const { values, years } = mergeNabijValues(nrow({ [N.distStation]: null }), nrow({ [N.distStation]: 2.2, [N.distCafe]: 9 }));
    assert.equal(values.distStation, 2.2); assert.equal(values.distCafe, 0.3);
    assert.deepEqual(years, { distStation: 2024 });
    assert.deepEqual(mergeNabijValues(null, null).years, {});
  });
});

describe('W2 distance to centrum', () => {
  it('centroid of a square is its middle; multipolygons weigh by area', () => {
    const [lat, lng] = geoCentroid(square(4.4, 51.9, 0.02));
    near(lat, 51.91, 1e-4); near(lng, 4.41, 1e-4);
    const multi = { type: 'MultiPolygon', coordinates: [square(4.0, 51.9, 0.03).coordinates, square(4.1, 51.9, 0.01).coordinates] };
    const [, mlng] = geoCentroid({ type: 'Feature', geometry: multi });
    near(mlng, (4.015 * 9 + 4.105 * 1) / 10, 2e-4);
    assert.equal(geoCentroid(null), null);
    assert.equal(geoCentroid({ type: 'Point', coordinates: [4, 52] }), null);
  });
  it('haversine: 0 at the same point, ~111.2 km per degree of latitude, symmetric', () => {
    assert.equal(haversineKm(CENTRUM_POINT, CENTRUM_POINT), 0);
    near(haversineKm([51, 4.469], [52, 4.469]), 111.2, 0.1);
    near(haversineKm([51.9244, 4.469], [51.9244, 4.569]), 6.86, 0.02);   // 0.1° lng × cos(51.92°)
    assert.equal(haversineKm([51.9, 4.4], [52, 4.5]), haversineKm([52, 4.5], [51.9, 4.4]));
  });
  it('real geometry: Stadsdriehoek is close, Hoek van Holland is far, every buurt gets a value', async () => {
    const geo = JSON.parse(await readFile(new URL('../data/rotterdam_buurten.geojson', import.meta.url), 'utf8'));
    const d = Object.fromEntries(geo.features.map(f => [f.properties.statnaam, distanceToCentrum(f)]));
    assert.ok(d.Stadsdriehoek > 0 && d.Stadsdriehoek < 2, `Stadsdriehoek ${d.Stadsdriehoek}`);
    const hvh = Object.entries(d).filter(([n]) => /Hoek van Holland/i.test(n)).map(([, v]) => v);
    if (hvh.length) assert.ok(Math.min(...hvh) > 20, `Hoek van Holland ${hvh}`);
    assert.ok(geo.features.every(f => distanceToCentrum(f) >= 0));
  });
  it('joinAreas adds distCentrum and the nabijheid values; areas without geometry get null', () => {
    const f = { properties: { statcode: 'WK059901', statnaam: 'Stadscentrum' }, geometry: square(4.47, 51.91, 0.02) };
    const [a] = joinAreas([f], [row()], [], { rows: [nrow({ [N.distCafe]: null })], fallbackRows: [nrow({ [N.distCafe]: 0.4 })] });
    assert.equal(a.values.distStation, 1.2); assert.equal(a.values.distCafe, 0.4); assert.equal(a.years.distCafe, 2024);
    assert.equal(a.values.distCentrum, distanceToCentrum(f));
    assert.equal(a.values.distSchool, 0.7);
    const [city] = joinAreas([{ properties: { statcode: 'GM0599' } }], [], []);
    assert.equal(city.values.distCentrum, null); assert.equal(city.values.distStation, null);
  });
});

describe('W2 datasets and the Standaard preset', () => {
  const TASTE = ['pop15to24', 'pop25to44', 'pop45to64', 'hhWithKidsPct', 'newBuildPct', 'distCafe', 'horeca1km', 'distCentrum'];
  const UTILITY = ['distSchool', 'distKinderopvang', 'distStation'];
  it('every new dataset is Rotterdam-only with Uitleg text and a source', () => {
    for (const k of [...TASTE, ...UTILITY]) {
      const d = DATASETS[k];
      assert.ok(d, k); assert.equal(d.scope, 'rotterdam', k);
      assert.ok(d.description.length > 40 && d.formula && d.year && d.source.length, k);
    }
  });
  it('taste metrics are neutral and stay out of the Totaalscore; distances to facilities count as lower = better', () => {
    for (const k of TASTE) { assert.equal(DATASETS[k].higherIsBetter, null, k); assert.equal(DATASETS[k].inOverall, false, k); }
    for (const k of UTILITY) { assert.equal(DATASETS[k].higherIsBetter, false, k); assert.equal(DATASETS[k].inOverall, true, k); }
    const gelijk = GELIJK.themes.map(t => t.key);
    for (const k of TASTE) assert.ok(!gelijk.includes(k), k);
  });
  it('Standaard Voorzieningen holds huisarts, supermarkt, school, station and kinderopvang', () => {
    const t = STANDAARD.themes.find(x => x.key === 'voorzieningen');
    assert.equal(t.weight, 40);   // 0.45.0: Standaard 35/40/15/10/0
    assert.deepEqual(t.metrics.map(m => [m.key, m.pref]),
      [['distGP', 'lower'], ['distSupermarket', 'lower'], ['distSchool', 'lower'], ['distStation', 'lower'], ['distKinderopvang', 'lower']]);
  });
});
