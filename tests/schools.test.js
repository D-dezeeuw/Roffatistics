// Onderwijsprestatie basisscholen: parsing, suppression, school score, area aggregation.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv, brin6, splitLevel, parseRefLevels, pupilTotals, fillSuppressed, schoolScore,
  scoreSchools, aggregate, shares, houseNumber, SMALL_N,
} from '../modules/schools.js';

const HEAD_REF = '"INSTELLINGSCODE","VESTIGINGSCODE","TYPE_PO","PEILJAAR","DOORSTROOMTOETS_PO","REFERENTIENIVEAU","AANTAL_LEERLINGEN"';
const HEAD_EIND = '"INSTELLINGSCODE","VESTIGINGSCODE","TYPE_PO","PEILJAAR","LEERJAAR","DOORSTROOMTOETS_PO","GEMIDDELDE_UITSLAG","AANTAL_LEERLINGEN","AANTAL_ONTHEFFINGEN"';
// 00AR 2024 as published by DUO (lezen 2F 13 + 1F 8 = 21 = the eindscores total).
const REF_00AR = `${HEAD_REF}
"00AR","00","BO",2024,"0018","TAAL_LV_2F",13
"00AR","00","BO",2024,"0018","TAAL_LV_1F",8
"00AR","00","BO",2024,"0018","TAAL_TV_2F",9
"00AR","00","BO",2024,"0018","TAAL_TV_1F",12
"00AR","00","BO",2024,"0018","REKENEN_1F",13
"00AR","00","BO",2024,"0018","REKENEN_LAGER_1F",-1
"00AR","00","BO",2024,"0018","REKENEN_1S",7
"00AR","00","BO",2018,"0013","REKENEN_1S",30
"99SB","00","SBO",2024,"0013","REKENEN_1F",12
`;
const EIND_00AR = `${HEAD_EIND}\r
"00AR","00","BO",2024,8,"LIB",172.67,21,\r
"00AR","00","BO",2024,7,"LIB",,-1,\r
"99SB","00","SBO",2024,8,"IEP",70,12,\r
`;

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, empty fields and CRLF', () => {
    const rows = parseCsv('"A","B","C"\r\n"x ""y""",2,\r\n"a,b",,3\n');
    assert.deepEqual(rows, [{ A: 'x "y"', B: '2', C: '' }, { A: 'a,b', B: '', C: '3' }]);
  });
  it('builds BRIN6 and splits level codes', () => {
    assert.equal(brin6({ INSTELLINGSCODE: '00AR', VESTIGINGSCODE: '1' }), '00AR01');
    assert.deepEqual(splitLevel('TAAL_LV_LAGER_1F'), { subject: 'lezen', level: 'below' });
    assert.deepEqual(splitLevel('REKENEN_1S'), { subject: 'rekenen', level: 'top' });
    assert.deepEqual(splitLevel('REKENEN_2F'), { subject: 'rekenen', level: 'top' });
    assert.equal(splitLevel('ENGELS_A1'), null);
    assert.equal(houseNumber('3-A'), 3);
    assert.equal(houseNumber('12a'), 12);
    assert.equal(houseNumber(''), null);
  });
});

describe('parseRefLevels / pupilTotals', () => {
  const ref = parseRefLevels(parseCsv(REF_00AR));
  const totals = pupilTotals(parseCsv(EIND_00AR));
  it('keeps BO rows of the pooled years only', () => {
    assert.deepEqual([...ref.keys()], ['00AR00']);
    assert.deepEqual([...ref.get('00AR00').keys()], [2024]);
    assert.deepEqual(ref.get('00AR00').get(2024).lezen, [{ level: 'top', n: 13 }, { level: 'f1', n: 8 }]);
  });
  it('takes the leerjaar-8 total and ignores leerjaar 7', () => {
    assert.equal(totals.get('00AR00').get(2024), 21);
    assert.equal(totals.has('99SB00'), false);
  });
  it('a suppressed leerjaar-8 total makes the year total unknown', () => {
    const t = pupilTotals(parseCsv(`${HEAD_EIND}\n"00ZZ","00","BO",2023,8,"IEP",80,12,\n"00ZZ","00","BO",2023,8,"CET",530,-1,\n`));
    assert.equal(t.get('00ZZ00').get(2023), null);
  });
});

describe('fillSuppressed', () => {
  it('no suppression: the counts as given (00AR lezen 13 + 8 = 21)', () => {
    assert.deepEqual(fillSuppressed([{ level: 'top', n: 13 }, { level: 'f1', n: 8 }], 21), { below: 0, f1: 8, top: 13, estimate: false });
  });
  it('one suppressed cell: derived from the total, exact', () => {
    const f = fillSuppressed([{ level: 'f1', n: 13 }, { level: 'below', n: -1 }, { level: 'top', n: 7 }], 21);
    assert.deepEqual(f, { below: 1, f1: 13, top: 7, estimate: false });
  });
  it('one suppressed cell with an inconsistent total: clamped to 1-4 and flagged', () => {
    assert.deepEqual(fillSuppressed([{ level: 'f1', n: 10 }, { level: 'below', n: -1 }], 30), { below: 4, f1: 10, top: 0, estimate: true });
    assert.deepEqual(fillSuppressed([{ level: 'f1', n: 10 }, { level: 'below', n: -1 }], 9), { below: 1, f1: 10, top: 0, estimate: true });
  });
  it('two suppressed cells: the remainder spread when it fits, else 2 each; always flagged', () => {
    const cells = [{ level: 'top', n: 10 }, { level: 'f1', n: -1 }, { level: 'below', n: -1 }];
    assert.deepEqual(fillSuppressed(cells, 16), { below: 3, f1: 3, top: 10, estimate: true });
    assert.deepEqual(fillSuppressed(cells, null), { below: 2, f1: 2, top: 10, estimate: true });
    assert.deepEqual(fillSuppressed(cells, 40), { below: 2, f1: 2, top: 10, estimate: true });
  });
  it('a suppressed cell without a total: 2 and flagged', () => {
    assert.deepEqual(fillSuppressed([{ level: 'f1', n: -1 }], null), { below: 0, f1: 2, top: 0, estimate: true });
  });
});

describe('schoolScore / scoreSchools', () => {
  const s = scoreSchools(parseCsv(REF_00AR), parseCsv(EIND_00AR));
  it('scores 00AR 2024: below 1F 0, 1F 50, 2F/1S 100 over all results', () => {
    const a = s.get('00AR00');
    // lezen 13*100 + 8*50, taal 9*100 + 12*50, rekenen 7*100 + 13*50 + 1*0 = 4550 over 63 results
    assert.equal(a.score, 72.2);
    assert.equal(a.tested, 21);
    assert.equal(a.small, true);
    assert.equal(a.estimate, false);
    assert.deepEqual(a.subjects.lezen, { fund: 100, streef: 61.9 });
    assert.deepEqual(a.subjects.rekenen, { fund: 95.2, streef: 33.3 });
    assert.equal(a.fund, 98.4);
    assert.equal(a.streef, 46);
    assert.deepEqual(a.years, [2024]);
    assert.equal(s.has('99SB00'), false, 'SBO left out');
  });
  it('pools years; the tested count falls back to the largest subject when the total is unknown', () => {
    const rows = [2022, 2023].flatMap(y => [
      { INSTELLINGSCODE: '11AA', VESTIGINGSCODE: '00', TYPE_PO: 'BO', PEILJAAR: String(y), REFERENTIENIVEAU: 'TAAL_LV_2F', AANTAL_LEERLINGEN: '10' },
      { INSTELLINGSCODE: '11AA', VESTIGINGSCODE: '00', TYPE_PO: 'BO', PEILJAAR: String(y), REFERENTIENIVEAU: 'REKENEN_LAGER_1F', AANTAL_LEERLINGEN: '10' },
      { INSTELLINGSCODE: '11AA', VESTIGINGSCODE: '00', TYPE_PO: 'BO', PEILJAAR: String(y), REFERENTIENIVEAU: 'REKENEN_1F', AANTAL_LEERLINGEN: '10' },
    ]);
    const a = scoreSchools(rows, []).get('11AA00');
    assert.equal(a.tested, 40);
    assert.equal(a.small, false);
    assert.equal(a.score, 50); // (20*100 + 20*0 + 20*50) / 60
    assert.equal(a.subjects.taal.fund, null);
    assert.equal(SMALL_N, 30);
  });
  it('a school without results scores null', () => {
    assert.equal(schoolScore(new Map()), null);
  });
});

describe('aggregate', () => {
  const schools = [
    { area: 'A', score: 80, tested: 10, counts: { below: 0, f1: 10, top: 20 } },
    { area: 'A', score: 40, tested: 90, counts: { below: 90, f1: 90, top: 90 } },
    { area: 'A', score: null, tested: 0 },
    { area: 'B', score: 60, tested: 30, counts: { below: 30, f1: 30, top: 30 } },
    { area: null, score: 99, tested: 5, counts: { below: 0, f1: 0, top: 15 } },
  ];
  const by = aggregate(schools, s => s.area);
  it('eduScore is the unweighted mean of the school scores; shares are pupil-weighted', () => {
    assert.deepEqual(by.get('A'), { eduScore: 60, eduSchools: 2, eduTested: 100, eduFundPct: 70, eduStreefPct: 36.7 });
    assert.deepEqual(by.get('B'), { eduScore: 60, eduSchools: 1, eduTested: 30, eduFundPct: 66.7, eduStreefPct: 33.3 });
    assert.equal(by.size, 2);
  });
  it('shares over many count objects', () => {
    assert.deepEqual(shares([{ below: 1, f1: 1, top: 2 }, { below: 0, f1: 0, top: 0 }]), { n: 4, fund: 75, streef: 50 });
  });
});

describe('nearSchools / rollUpByPopulation', async () => {
  const { nearSchools, rollUpByPopulation, haversineKm } = await import('../modules/schools.js');
  const centre = [51.92, 4.48];
  const north = km => [centre[0] + km / 111.195, centre[1]];
  const at = (km, score) => { const [lat, lon] = north(km); return { lat, lon, score }; };
  it('measures distance in km', () => {
    assert.ok(Math.abs(haversineKm(centre, north(1)) - 1) < 0.001);
  });
  it('weights schools within 1.5 km by 1 - d/1.5; best and count within 1 km', () => {
    const r = nearSchools(centre, [at(0, 80), at(0.75, 40), at(1.2, 100), at(2, 10), { lat: null, lon: null, score: 99 }, { ...at(0.1, 0), score: null }]);
    // weights 1, 0.5, 0.2 → (80 + 20 + 20) / 1.7
    assert.deepEqual(r, { eduNearScore: 70.6, eduNearBest: 80, eduNearCount: 2 });
  });
  it('a school between 1 and 1.5 km only: count 0, no best', () => {
    assert.deepEqual(nearSchools(centre, [at(1.2, 60)]), { eduNearScore: 60, eduNearBest: null, eduNearCount: 0 });
  });
  it('null when nothing within 1.5 km or no centre', () => {
    const none = { eduNearScore: null, eduNearBest: null, eduNearCount: null };
    assert.deepEqual(nearSchools(centre, [at(1.6, 90)]), none);
    assert.deepEqual(nearSchools(null, [at(0, 90)]), none);
  });
  it('rolls up weighted by inhabitants, skipping nulls and empty buurten', () => {
    const rows = [
      { code: 'BU05990101', pop: 1000, values: { a: 60, b: 1 } },
      { code: 'BU05990102', pop: 3000, values: { a: 80, b: null } },
      { code: 'BU05990103', pop: 0, values: { a: 10, b: 5 } },
      { code: 'BU05990201', pop: 500, values: { a: null, b: null } },
    ];
    const by = rollUpByPopulation(rows, c => `WK${c.slice(2, 8)}`, ['a', 'b']);
    assert.deepEqual(by.get('WK059901'), { a: 75, b: 1 });
    assert.deepEqual(by.get('WK059902'), { a: null, b: null });
  });
});
