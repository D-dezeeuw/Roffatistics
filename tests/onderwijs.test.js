// Onderwijsprestatie basisscholen in the app: pure helpers, loaders, panel HTML, datasets.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EDU_KEYS, EDU_COLUMNS, isEduKey, gradeOf, formatGrade, formatKm, eduLevelOf, schoolAreaCode, schoolsInArea,
  schoolsWithinKm, decodeSchools, decodeEduAreas, encodeCentres, decodeCentres, eduValuesFor, eduAreaDetail,
  eduPanelHtml, schoolRowHtml, addEduValues, withEduRows, loadEduAreas, loadEduSchools, loadBuurtCentres,
  isEduLoaded, getEduEntry, getEduSchools, getBuurtCentre, onEduLoaded, _setEduData, EDU_AREA_URL,
  presetUsesEdu, eduAreasWanted,
} from '../modules/onderwijs.js';
import { answersToPreset, normalizeAnswers } from '../modules/wizard-model.js';
import { DATASETS, categoryOf, datasetInScope } from '../modules/datasets.js';
import { formatValue, formatTick } from '../modules/dashboard-data.js';

const readData = name => JSON.parse(readFileSync(new URL(`../data/nl/${name}`, import.meta.url), 'utf8'));

const S = (brin, name, buurt, score, extra = {}) => ({ brin, name, buurt, gemeente: null, score, tested: 40, small: false, lat: 51.92, lon: 4.47, ...extra });
const SCHOOLS = [
  S('AA00', 'De Akker', 'BU05990101', 70),
  S('BB00', 'Bolder', 'BU05990101', 82, { small: true, tested: 12 }),
  S('CC00', 'Clara', 'BU05990102', null),
  S('DD00', 'Duin', 'BU05990201', 60),
  S('EE00', 'Elders', null, 75, { gemeente: 'GM0599' }),
  S('FF00', 'Ver weg', 'BU03630001', 90),
  S('GG00', 'Alleen wijk', null, 66, { wijk: 'WK059902' }),
];

const areaJson = () => ({
  format: 1, levels: {
    buurt: { codes: ['BU05990101'], cols: { eduScore: [76], eduSchools: [2], eduTested: [52], eduFundPct: [95.1], eduStreefPct: [60.2], eduNearScore: [74.3], eduNearBest: [82], eduNearCount: [3] } },
    wijk: { codes: ['WK059901'], cols: { eduScore: [70.7], eduSchools: [2] } },
    gemeente: { codes: ['GM0599'], cols: { eduScore: [71.8] } },
    provincie: { codes: ['PV28'], cols: { eduScore: [76.1], eduSchools: [1200], eduNearScore: [75.9] } },
  },
});
const schoolJson = () => ({
  format: 1, smallN: 30, cols: {
    brin: ['AA00', 'BB00', 'CC00'], name: ['De Akker', 'Bolder', 'Clara'], place: ['Rotterdam', 'Rotterdam', 'Rotterdam'],
    lat: [51.92, 51.925, 51.93], lon: [4.47, 4.47, 4.5], buurt: ['BU05990101', 'BU05990101', 'BU05990102'], gemeente: [null, null, null],
    score: [70, 82, null], tested: [40, 12, null], estimate: [0, 1, null],
  },
});
const fakeFetch = map => { const calls = []; const f = async url => { calls.push(url); return map[url] ? { ok: true, json: async () => map[url] } : { ok: false, status: 404 }; }; f.calls = calls; return f; };

describe('onderwijs: pure helpers', () => {
  it('grades and formats', () => {
    assert.equal(gradeOf(78.8), 7.9);
    assert.equal(gradeOf(null), null);
    assert.equal(formatGrade(78.8), '7,9');
    assert.equal(formatGrade(70), '7,0');
    assert.equal(formatGrade(undefined), '—');
    assert.equal(formatKm(0.42), '0,4 km');
  });
  it('levels and the area of a school', () => {
    assert.equal(eduLevelOf('BU05990101'), 'buurt');
    assert.equal(eduLevelOf('wk059901'), 'wijk');
    assert.equal(eduLevelOf('GM0599'), 'gemeente');
    assert.equal(eduLevelOf('PV28'), 'provincie');
    assert.equal(eduLevelOf('XX1'), null);
    assert.equal(schoolAreaCode(SCHOOLS[0], 'wijk'), 'WK059901');
    assert.equal(schoolAreaCode(SCHOOLS[0], 'gemeente'), 'GM0599');
    assert.equal(schoolAreaCode(SCHOOLS[4], 'gemeente'), 'GM0599', 'no buurt: its gemeente');
    assert.equal(schoolAreaCode(SCHOOLS[4], 'wijk'), null);
    assert.equal(schoolAreaCode(SCHOOLS[6], 'wijk'), 'WK059902', 'wijk but no buurt: its wijk');
    assert.equal(schoolAreaCode(SCHOOLS[6], 'gemeente'), 'GM0599', 'gemeente from the wijk');
    assert.equal(schoolAreaCode(SCHOOLS[6], 'buurt'), null);
    assert.equal(schoolAreaCode(SCHOOLS[0], 'provincie'), null);
  });
  it('schoolsInArea: best first, no toetsgegevens last', () => {
    assert.deepEqual(schoolsInArea(SCHOOLS, 'BU05990101').map(s => s.brin), ['BB00', 'AA00']);
    assert.deepEqual(schoolsInArea(SCHOOLS, 'WK059901').map(s => s.brin), ['BB00', 'AA00', 'CC00']);
    assert.deepEqual(schoolsInArea(SCHOOLS, 'GM0599').map(s => s.brin), ['BB00', 'EE00', 'AA00', 'GG00', 'DD00', 'CC00']);
    assert.deepEqual(schoolsInArea(SCHOOLS, 'WK059902').map(s => s.brin), ['GG00', 'DD00'], 'the wijk-only school is in its wijk list');
    assert.deepEqual(schoolsInArea(SCHOOLS, 'PV28'), []);
    assert.deepEqual(schoolsInArea(null, 'GM0599'), []);
  });
  it('schoolsWithinKm: nearest first, with the distance, edge excluded', () => {
    const list = [
      { name: 'Hier', lat: 52, lon: 5 },
      { name: 'Noord 0,9', lat: 52 + 0.9 / 111.195, lon: 5 },
      { name: 'Noord 1,1', lat: 52 + 1.1 / 111.195, lon: 5 },
      { name: 'Zonder punt', lat: null, lon: null },
    ];
    const r = schoolsWithinKm(list, [52, 5], 1);
    assert.deepEqual(r.map(s => s.name), ['Hier', 'Noord 0,9']);
    assert.equal(r[0].km, 0);
    assert.ok(Math.abs(r[1].km - 0.9) < 0.01);
    assert.equal(list[1].km, undefined, 'copies, input untouched');
    assert.deepEqual(schoolsWithinKm(list, null), []);
    assert.equal(schoolsWithinKm(list, [52, 5], 2).length, 3);
  });
  it('decodes the files', () => {
    const s = decodeSchools(schoolJson());
    assert.equal(s.length, 3);
    assert.equal(s[1].small, true);
    assert.equal(s[0].small, false);
    assert.equal(s[2].small, false, 'no score: not small');
    assert.equal(s[1].estimate, true);
    const a = decodeEduAreas(areaJson());
    assert.equal(a.get('BU05990101').eduNearCount, 3);
    assert.equal(a.get('WK059901').eduTested, null);
    assert.deepEqual(Object.keys(a.get('GM0599')), [...EDU_COLUMNS]);
    assert.throws(() => decodeSchools({}), /scholenbestand/);
    assert.throws(() => decodeEduAreas({ format: 2 }), /gebiedsbestand/);
    const c = decodeCentres({ format: 1, ...encodeCentres({ BU2: [52, 5], BU1: [51, 4] }) });
    assert.deepEqual([...c.keys()], ['BU1', 'BU2']);
    assert.deepEqual(c.get('BU2'), [52, 5]);
  });
  it('eduValuesFor: every column, null where missing', () => {
    const a = decodeEduAreas(areaJson());
    assert.deepEqual(eduValuesFor('X', null), {});
    const v = eduValuesFor('BU00000000', a);
    assert.deepEqual(Object.keys(v), [...EDU_COLUMNS]);
    assert.ok(Object.values(v).every(x => x === null));
    assert.equal(eduValuesFor('gm0599', a).eduScore, 71.8);
  });
});

describe('onderwijs: panel', () => {
  const entry = decodeEduAreas(areaJson()).get('BU05990101');
  it('eduAreaDetail: figures, list and, for a buurt, the schools within 1 km', () => {
    const d = eduAreaDetail('BU05990101', { entry, schools: SCHOOLS, centre: [51.92, 4.47] });
    assert.equal(d.level, 'buurt');
    assert.equal(d.score, 76);
    assert.equal(d.schools, 2);
    assert.deepEqual(d.list.map(s => s.brin), ['BB00', 'AA00']);
    assert.deepEqual(d.near.map(s => s.brin).sort(), ['AA00', 'BB00', 'CC00', 'DD00', 'EE00', 'FF00', 'GG00'], 'same point in the fixture');
    assert.equal(eduAreaDetail('WK059901', { entry: null, schools: SCHOOLS, centre: [51.92, 4.47] }).near, null, 'near list only for a buurt');
    assert.equal(eduAreaDetail('BU05990101', { entry, schools: SCHOOLS }).near, null, 'no centre: no near list');
    const pv = eduAreaDetail('PV28', { entry: decodeEduAreas(areaJson()).get('PV28'), schools: SCHOOLS });
    assert.equal(pv.level, 'provincie');
    assert.equal(pv.score, 76.1);
    assert.equal(pv.list, null, 'a province lists no schools');
    assert.equal(pv.near, null);
    assert.match(eduPanelHtml(pv), /7,6.*1\.200 scholen met toetsgegevens/s);
    assert.equal(eduAreaDetail('XX1', { entry }), null);
    assert.equal(eduAreaDetail('GM0599', {}), null, 'nothing loaded');
  });
  it('eduPanelHtml: grade, counts, badges and the 1 km list', () => {
    const d = eduAreaDetail('BU05990101', { entry, schools: SCHOOLS, centre: [51.92, 4.47] });
    const html = eduPanelHtml(d, { info: '<button>i</button>' });
    assert.match(html, /<strong class="edu-po-grade">7,6<\/strong>/);
    assert.match(html, /2 scholen met toetsgegevens · 52 leerlingen getoetst \(2022–2024\)/);
    assert.match(html, /95,1% haalt ten minste 1F · 60,2% haalt 2F\/1S/);
    assert.match(html, /Basisscholen in deze buurt \(2\)/);
    assert.match(html, /klein aantal leerlingen/);
    assert.match(html, /geen toetsgegevens/);
    assert.match(html, /Basisscholen binnen 1 km/);
    assert.match(html, /Kwaliteit dichtbij .*<strong>7,4<\/strong>/);
    assert.match(html, /<button>i<\/button>/);
    assert.equal(eduPanelHtml(null), '');
  });
  it('eduPanelHtml: an area without a scored school', () => {
    const d = eduAreaDetail('WK059902', { entry: null, schools: SCHOOLS });
    const html = eduPanelHtml(d);
    assert.match(html, /Geen basisschool met toetsgegevens in deze wijk/);
    assert.doesNotMatch(html, /binnen 1 km/);
  });
  it('escapes school names and shows the distance', () => {
    const li = schoolRowHtml({ name: 'A<b>', place: 'X', score: 81, small: false, km: 0.25 }, { km: true });
    assert.match(li, /A&lt;b&gt;/);
    assert.match(li, /0,3 km/);
    assert.match(li, /8,1/);
  });
});

describe('onderwijs: loaders and joins', () => {
  beforeEach(() => _setEduData());
  it('loads each file once, on demand, and joins the values', async () => {
    const f = fakeFetch({ [EDU_AREA_URL]: areaJson(), './data/nl/onderwijs-po-scholen-2024.json': schoolJson(), './data/nl/buurt-centres-2025.json': { format: 1, ...encodeCentres({ BU05990101: [51.92, 4.47] }) } });
    let heard = 0;
    onEduLoaded(() => { heard++; });
    assert.equal(isEduLoaded(), false);
    const areas = [{ code: 'BU05990101', values: { population: 10 } }, { code: 'WK059999', values: {} }];
    addEduValues(areas);
    assert.equal(areas[0].values.eduScore, undefined, 'no-op before the load');
    await Promise.all([loadEduAreas({ fetcher: f }), loadEduAreas({ fetcher: f })]);
    assert.equal(f.calls.length, 1);
    assert.equal(heard, 1);
    assert.equal(isEduLoaded(), true);
    assert.equal(getEduEntry('bu05990101').eduScore, 76);
    addEduValues(areas);
    assert.equal(areas[0].values.eduScore, 76);
    assert.equal(areas[0].values.population, 10);
    assert.equal(areas[1].values.eduScore, null);
    const rows = withEduRows([{ regionCode: 'GM0599', population: 1 }, { regionCode: 'PV28' }]);
    assert.equal(rows[0].eduScore, 71.8);
    assert.equal(rows[1].eduScore, 76.1, 'provincie rows get their value too');
    assert.equal(withEduRows([{ regionCode: 'PV99' }])[0].eduScore, null);
    await loadEduSchools({ fetcher: f });
    await loadBuurtCentres({ fetcher: f });
    assert.equal(getEduSchools().length, 3);
    assert.deepEqual(getBuurtCentre('BU05990101'), [51.92, 4.47]);
  });
  it('a failed load is forgotten and retried', async () => {
    await assert.rejects(loadEduAreas({ fetcher: fakeFetch({}) }), /404/);
    await loadEduAreas({ fetcher: fakeFetch({ [EDU_AREA_URL]: areaJson() }) });
    assert.equal(isEduLoaded(), true);
  });
});

describe('onderwijs: datasets', () => {
  it('five layers in Opleiding, for all of NL, higher is better, not in the overall score', () => {
    assert.deepEqual([...EDU_KEYS].sort(), ['eduFundPct', 'eduNearBest', 'eduNearScore', 'eduScore', 'eduStreefPct']);
    for (const k of EDU_KEYS) {
      const d = DATASETS[k];
      assert.ok(isEduKey(k));
      assert.equal(d.higherIsBetter, true, k);
      assert.equal(d.inOverall, false, k);
      assert.equal(categoryOf(k), 'opleiding', k);
      assert.ok(datasetInScope(k, 'nederland') && datasetInScope(k, 'rotterdam'), k);
      assert.ok(d.source.some(s => s.publisher === 'DUO'), k);
    }
    assert.equal(DATASETS.eduScore.label, 'Onderwijsprestatie basisscholen');
    assert.equal(DATASETS.eduNearScore.label, 'Basisscholen dichtbij (kwaliteit)');
    assert.ok(!isEduKey('eduSchools'));
  });
  it('caveats name the pitfalls', () => {
    const all = EDU_KEYS.flatMap(k => DATASETS[k].caveats).join(' ');
    for (const re of [/niet over de kinderen die er wonen/, /achtergrond van de leerlingen/, /enige maat/, /doorstroomtoets/, /Hemelsbreed/, /1,5 km/]) assert.match(all, re);
  });
  it('a schoolscore shows as a grade', () => {
    assert.equal(formatValue(78.8, 'eduScore'), '7,9 / 10');
    assert.equal(formatTick(65, 'eduNearScore'), '6,5');
    assert.equal(formatValue(64.5, 'eduStreefPct'), '64,5%');
  });
});

describe('onderwijs: built files', () => {
  it('Rotterdam: schools in the gemeente and the centre of a buurt with a 1 km list', () => {
    const schools = decodeSchools(readData('onderwijs-po-scholen-2024.json'));
    const rd = schoolsInArea(schools, 'GM0599');
    assert.ok(rd.length >= 150, `Rotterdam schools ${rd.length}`);
    const centres = decodeCentres(readData('buurt-centres-2025.json'));
    assert.ok(centres.size > 14000, `centres ${centres.size}`);
    const areas = decodeEduAreas(readData('onderwijs-po-2024.json'));
    // The 1 km list matches the built eduNearCount (scored schools within 1 km) for a sample of buurten.
    const sample = [...areas.entries()].filter(([c, v]) => c.startsWith('BU0599') && v.eduNearCount != null).slice(0, 25);
    assert.ok(sample.length > 0);
    for (const [code, v] of sample) {
      const near = schoolsWithinKm(schools, centres.get(code), 1).filter(s => s.score != null);
      assert.equal(near.length, v.eduNearCount, code);
      assert.equal(near.length ? Math.max(...near.map(s => s.score)) : null, v.eduNearBest, code);
    }
  });
});

describe('onderwijs: when the area file is needed', () => {
  const gezin = { themes: [{ key: 'voorzieningen', metrics: [{ key: 'distSchool' }, { key: 'eduNearScore' }] }] };
  const plain = { themes: [{ key: 'veiligheid', metrics: [{ key: 'totalCrimes' }] }] };
  it('presetUsesEdu: only a preset that weighs an edu column', () => {
    assert.equal(presetUsesEdu(gezin), true);
    assert.equal(presetUsesEdu(plain), false);
    assert.equal(presetUsesEdu(null), false);
    assert.equal(presetUsesEdu({ themes: [{ metrics: [{ key: 'eduScore' }] }] }), true);
  });
  it('eduAreasWanted: edu layer, Ranglijst or an edu preset; never once loaded', () => {
    const base = { dataset: 'woonscore', view: 'map', preset: plain, loaded: false };
    assert.equal(eduAreasWanted(base), false);
    assert.equal(eduAreasWanted({ ...base, dataset: 'eduScore' }), true);
    assert.equal(eduAreasWanted({ ...base, view: 'list' }), true, 'Ranglijst shows the edu columns');
    assert.equal(eduAreasWanted({ ...base, view: 'dashboard', preset: gezin }), true, 'Jouw dashboard / wizard / Woonscore (gezin)');
    assert.equal(eduAreasWanted({ ...base, dataset: 'eduScore', view: 'list', preset: gezin, loaded: true }), false);
  });
  it('the real gezin preset of the wizard weighs eduNearScore; the default does not', () => {
    assert.equal(presetUsesEdu(answersToPreset(normalizeAnswers({ levensfase: 'gezin' }))), true);
    assert.equal(presetUsesEdu(answersToPreset(normalizeAnswers({ levensfase: 'senior' }))), false);
  });
});
