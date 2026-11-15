// World regions (v0.28.0): one country → region table (UN M49, Dutch labels) for
// gemeente (85458NED, 45 named countries) and wijk/buurt (83503NED via postcode,
// eight named countries). Regions sum named countries only; each werelddeel's
// rest is "Overig"; nothing spreads a gemeente mix down.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { HK, COUNTRIES } from '../modules/herkomst.js';
import {
  REGIONS, REGION_KEYS, COUNTRY_REGION, INCLUDED_IN, HK_FORMER, HK_UNKNOWN, CONTINENTS, REGIO_URL, REGIO_FETCH_KEYS,
  regionMembers, regionPlusMinus, regionCounts, regionGap, regionComposition, encodeRegio, decodeRegio, regionSharesOf,
  gemeenteCountsFromRows, _setRegioData, withRegionShares, regionRows, regionHtml, regionShareMap,
} from '../modules/herkomst-regio.js';
import {
  PC4_GROUPS, PC4_REGION_SOURCES, PC4_REGION_METRICS, PC4_VALIDATION, PC4_HERKOMST_URL, MA, pc4CountsFromRows,
  pc4RegionCounts, sharesOf, pc4RegionComposition, regionAtBuurt, isPc4Key, decodePc4Herkomst, pc4RegionRows, validatePc4, GM_EQUIV,
} from '../modules/herkomst-pc4.js';
import { DATASETS, datasetInScope } from '../modules/datasets.js';
import { GENERAL_SECTIONS } from '../modules/explain.js';

const file = u => new URL(`../${u.replace(/^\.\//, '')}`, import.meta.url);
const RG = JSON.parse(readFileSync(file(REGIO_URL), 'utf8'));
const PC = JSON.parse(readFileSync(file(PC4_HERKOMST_URL), 'utf8'));

describe('herkomst-regio: country → region table', () => {
  it('maps every named 85458NED country (and Nederlandse Cariben) to exactly one region; aggregates never', () => {
    for (const k of Object.keys(COUNTRIES)) assert.ok(REGION_KEYS.includes(COUNTRY_REGION[k]), COUNTRIES[k]);
    assert.ok(REGION_KEYS.includes(COUNTRY_REGION[HK.caribbean]));
    for (const k of Object.keys(HK_FORMER)) assert.equal(COUNTRY_REGION[k], undefined, HK_FORMER[k]);
    for (const [k, agg] of Object.entries(INCLUDED_IN)) assert.equal(COUNTRY_REGION[k], COUNTRY_REGION[agg], 'part sits in its aggregate region');
  });
  it('places the operator examples in the right M49 subregion', () => {
    const want = { H008673: 'noordAfrika', H008594: 'noordAfrika', H008751: 'zuidAmerika', H007119: 'caribischGebied', H008766: 'westAzie',
      H008632: 'zuidoostAzie', H008718: 'oostEuropa', H008592: 'westEuropa', H008552: 'westEuropa', H008634: 'zuidelijkAzie', H008778: 'noordAmerika' };
    for (const [k, r] of Object.entries(want)) assert.equal(COUNTRY_REGION[k], r, k);
  });
  it('every werelddeel has a rest (Oceanië whole); members never counted twice', () => {
    for (const c of ['europa', 'afrika', 'amerika', 'azie']) assert.equal(REGIONS.filter(r => r.continent === c && r.rest).length, 1, c);
    assert.deepEqual(regionPlusMinus('oceanie'), { plus: [HK.oceania], minus: [] });
    assert.deepEqual(regionMembers('caribischGebied'), [HK.caribbean], 'Aruba/Curaçao through the aggregate only');
    const rest = regionPlusMinus('overigAfrika');
    assert.deepEqual(rest.plus, [CONTINENTS.afrika.key]);
    assert.equal(rest.minus.length, 9);
    const named = REGIONS.filter(r => !r.rest && !r.whole).flatMap(r => regionMembers(r.key));
    assert.equal(new Set(named).size, named.length);
    assert.ok(REGIO_FETCH_KEYS.includes(HK_UNKNOWN) && !REGIO_FETCH_KEYS.includes('H008544'));
  });
  it('regions + Nederland + Onbekend partition a total exactly; a missing cell gives null', () => {
    const counts = { [HK.total]: 1000, [HK.nederland]: 600, [HK_UNKNOWN]: 10, [HK.europe]: 150, [HK.africa]: 80, [HK.america]: 90, [HK.asia]: 60, [HK.oceania]: 10 };
    for (const k of REGIO_FETCH_KEYS) counts[k] ??= 5;
    const rc = regionCounts(counts);
    assert.equal(regionGap(rc), 0);
    assert.equal(rc.noordAfrika, 10);
    assert.equal(rc.overigAfrika, 80 - 9 * 5);
    assert.equal(regionCounts({ ...counts, [HK.egypt]: null }).noordAfrika, null);
    assert.equal(regionCounts({}), null);
  });
  it('composition texts name only the named countries', () => {
    assert.equal(regionComposition('noordAfrika'), 'Egypte, Marokko');
    assert.match(regionComposition('overigAfrika'), /niet apart levert/);
    assert.equal(pc4RegionComposition('noordAfrika'), 'Marokko');
    assert.equal(pc4RegionComposition('westEuropa'), 'Duitsland, België');
    assert.equal(pc4RegionComposition('oostAfrika'), '');
  });
});

describe('herkomst-regio: per wijk/buurt via the same table', () => {
  it('postcode regions: named countries in their region, rests as Overig, no source → no key', () => {
    assert.deepEqual(PC4_REGION_SOURCES.noordAfrika, ['marokko']);
    assert.deepEqual(PC4_REGION_SOURCES.westAzie, ['turkije'], 'Turkije in West-Azië, not Europa');
    assert.deepEqual(PC4_REGION_SOURCES.overigEuropa, ['europaRest']);
    assert.deepEqual(PC4_REGION_SOURCES.overigAzie, ['azieRest']);
    for (const r of ['noordEuropa', 'zuidEuropa', 'westAfrika', 'oostAfrika', 'zuidelijkAfrika', 'noordAmerika', 'zuidelijkAzie', 'oostelijkAzie']) {
      assert.ok(!regionAtBuurt(r), r);
      assert.equal(DATASETS[`hr_${r}`].scope, 'nederland', r);
    }
    for (const m of PC4_REGION_METRICS) { assert.ok(isPc4Key(m)); assert.ok(datasetInScope(m, 'rotterdam'), m); }
  });
  it('postcode regions partition the five werelddelen; Turkije moves from Europa to West-Azië', () => {
    const r = (k, v) => ({ Postcode: 'PC3011', Migratieachtergrond: k, Bevolking_1: v });
    const c = pc4CountsFromRows([r(MA.total, 1000), r(MA.europa, 300), r(MA.eu, 100), r(MA.turkije, 120), r(MA.polen, 20), r(MA.duitsland, 15), r(MA.belgie, 5),
      r(MA.afrika, 90), r(MA.marokko, 70), r(MA.amerika, 80), r(MA.suriname, 50), r(MA.cariben, 20), r(MA.azie, 40), r(MA.indonesie, 25), r(MA.oceanie, 3),
      r(MA.indonesie, 25)])['3011'];
    const rc = pc4RegionCounts({ total: c.total, counts: c });
    assert.equal(rc.westAzie, 120);
    assert.equal(rc.overigEuropa, 300 - 120 - 20 - 15 - 5);
    assert.equal(rc.westEuropa, 20);
    assert.equal(rc.overigAfrika, 20);
    assert.equal(rc.overigAmerika, 10);
    assert.equal(rc.overigAzie, 15);
    assert.equal(Object.values(rc).reduce((a, b) => a + b, 0), 300 + 90 + 80 + 40 + 3);
    const s = sharesOf({ total: c.total, counts: c });
    assert.equal(s.hr_noordAfrika, 7);
    assert.ok(!('hr_oostAfrika' in s), 'no postcode source: no key, no guess');
  });
  it('the built postcode file has every column and Rotterdam buurten get region shares', () => {
    const m = decodePc4Herkomst(PC);
    const rtm = m.get('GM0599');
    const rc = pc4RegionCounts(rtm);
    assert.ok(rc.noordAfrika > 30e3 && rc.westAzie > 30e3 && rc.overigAzie > 0, JSON.stringify(rc));
    const rows = pc4RegionRows('GM0599', rtm);
    assert.ok(rows.length >= 8 && rows.every(x => regionAtBuurt(x.key)));
  });
});

describe('herkomst-regio: gemeente file', () => {
  it('is small, 2026, ~342 gemeenten, an exact partition everywhere', () => {
    assert.ok(statSync(file(REGIO_URL)).size < 100e3);
    assert.equal(RG.year, 2026);
    assert.ok(RG.codes.length >= 340, String(RG.codes.length));
    assert.equal(RG.sources.check.partitionGaps, 0);
    assert.deepEqual(RG.regions, REGION_KEYS);
    RG.codes.forEach((c, i) => {
      const sum = RG.nederland[i] + RG.onbekend[i] + REGION_KEYS.reduce((s, k) => s + RG.cols[k][i], 0);
      assert.equal(sum, RG.total[i], c);
    });
  });
  it('decodes; Rotterdam has large Noord-Afrika / Zuid-Amerika / West-Azië groups; rows join gemeenten only', () => {
    _setRegioData(RG);
    const shares = regionSharesOf(decodeRegio(RG).get('GM0599'));
    assert.ok(shares.hr_noordAfrika > 5 && shares.hr_zuidAmerika > 5 && shares.hr_westAzie > 5, JSON.stringify(shares));
    const [gm, wk] = withRegionShares([{ regionCode: 'GM0599' }, { regionCode: 'WK059901' }]);
    assert.equal(gm.hr_noordAfrika, shares.hr_noordAfrika);
    assert.equal(wk.hr_noordAfrika, undefined, 'never a gemeente mix on a wijk');
    assert.equal(regionShareMap('noordAfrika').get('GM0599'), shares.hr_noordAfrika);
    assert.ok(regionRows('GM0599').length > 10);
    assert.match(regionHtml('GM0599'), /hele gemeente Rotterdam/i);
    assert.throws(() => decodeRegio({ format: 9 }));
    _setRegioData(null);
  });
  it('encode/rows helpers work on raw CBS rows', () => {
    const rows = [{ RegioS: 'GM0001  ', Herkomstland: HK.total, Bevolking_1: 10 }, { RegioS: 'NL01', Herkomstland: HK.total, Bevolking_1: 5 }];
    const by = gemeenteCountsFromRows(rows);
    assert.deepEqual(Object.keys(by), ['GM0001']);
    const enc = encodeRegio(by);
    assert.deepEqual(enc.codes, ['GM0001']);
    assert.equal(enc.cols.noordAfrika[0], null, 'a missing cell stays null, never 0');
  });
});

describe('herkomst-pc4: validation against 85458NED is in the data file and the Uitleg', () => {
  it('the built file carries the ratios, and PC4_VALIDATION (quoted in the Uitleg) matches them', () => {
    const v = PC.sources.validation;
    assert.equal(v.table, '85458NED');
    assert.equal(v.year, 2023);
    assert.equal(v.gemeenten, PC4_VALIDATION.gemeenten);
    for (const [g, ratio] of Object.entries(PC4_VALIDATION.ratios)) assert.equal(v.groups[g].ratio, ratio, g);
    assert.equal(Math.min(...Object.values(v.groups).map(x => x.corr)), PC4_VALIDATION.minCorr);
    const text = GENERAL_SECTIONS.find(s => s.id === 'herkomst-postcode').paragraphs.join(' ');
    assert.match(text, /Suriname 99,5%/);
    assert.match(text, /België 90%/);
  });
  it('validatePc4 computes ratio and correlation per group', () => {
    const lvl = { codes: ['GM1', 'GM2'], total: [100, 200], cols: { suriname: [10, 30] } };
    const off = { GM1: { T001040: 100, H008751: 10 }, GM2: { T001040: 200, H008751: 30 } };
    const v = validatePc4(lvl, off);
    assert.equal(v.groups.suriname.ratio, 1);
    assert.equal(v.groups.suriname.corr, 1);
    assert.ok(GM_EQUIV.europaRest && GM_EQUIV.azieRest);
  });
  it('the Uitleg lists per level which countries feed each region', () => {
    const text = GENERAL_SECTIONS.find(s => s.id === 'herkomst-regio').paragraphs.join(' ');
    assert.match(text, /Noord-Afrika \(gemeente\): Egypte, Marokko; \(wijk\/buurt\): Marokko/);
    assert.match(text, /Oost-Afrika \(gemeente\): Eritrea, Ethiopië, Somalië; \(wijk\/buurt\): niet beschikbaar/);
    assert.match(text, /nooit naar buurten doorgerekend/);
  });
});
