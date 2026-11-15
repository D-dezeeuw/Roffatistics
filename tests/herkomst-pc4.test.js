// Postcode-estimated herkomst per wijk/buurt (v0.25.0): module helpers, the
// built files in data/nl/, and the postcode search item.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  PC4_GROUPS, PC4_KEYS, PC4_MIN_POPULATION, MA, pc4CountsFromRows, encodePc4Level, decodePc4Herkomst, sharesOf,
  addPc4Shares, pc4OriginRows, pc4OriginHtml, crosswalkIndex, resolvePostcode, presetUsesPc4, isPc4Key,
  loadPc4Herkomst, onPc4Loaded, _setPc4Data, getPc4Entry, PC4_HERKOMST_URL, PC4_CROSSWALK_URL,
} from '../modules/herkomst-pc4.js';
import { DETAIL_GROUPS } from '../modules/herkomst-gemeente.js';
import { ORIGIN_KEYS } from '../modules/presets.js';
import { DATASETS } from '../modules/datasets.js';
import { postcodeItem } from '../modules/search.js';
import { GENERAL_SECTIONS } from '../modules/explain.js';

const file = u => new URL(`../${u.replace(/^\.\//, '')}`, import.meta.url);
const HK = JSON.parse(readFileSync(file(PC4_HERKOMST_URL), 'utf8'));
const XW = JSON.parse(readFileSync(file(PC4_CROSSWALK_URL), 'utf8'));
const NL_BUURT = JSON.parse(readFileSync(file('./data/nl/buurten-2025.json'), 'utf8'));
const NL_WIJK = JSON.parse(readFileSync(file('./data/nl/wijken-2025.json'), 'utf8'));

describe('herkomst-pc4: helpers', () => {
  it('turns 83503NED rows into group counts; Europa buiten de EU excludes Turkije; suppressed cells count 0', () => {
    const r = (pc, k, v) => ({ Postcode: `PC${pc}    `, Migratieachtergrond: k, Bevolking_1: v });
    const c = pc4CountsFromRows([
      r(3011, MA.total, 1000), r(3011, MA.suriname, 115), r(3011, MA.europa, 300), r(3011, MA.eu, 100), r(3011, MA.turkije, 150), r(3011, MA.polen, null),
      r(3012, MA.suriname, 5), { Postcode: 'NL01    ', Migratieachtergrond: MA.total, Bevolking_1: 9 },
    ]);
    assert.deepEqual(Object.keys(c), ['3011'], 'no total → left out; NL01 is no postcode');
    assert.equal(c['3011'].suriname, 115);
    assert.equal(c['3011'].euNietEu, 50);
    assert.equal(c['3011'].polen, 0);
  });
  it('encodes column-wise and decodes back; shares are % with 1 decimal, null below the minimum', () => {
    const lvl = encodePc4Level({ BU1: { total: 200.4, suriname: 20.2 }, BU0: { total: 10, suriname: 5 } });
    assert.deepEqual(lvl.codes, ['BU0', 'BU1']);
    assert.deepEqual(lvl.total, [10, 200]);
    const m = decodePc4Herkomst({ format: 1, levels: { buurt: lvl } });
    assert.equal(sharesOf(m.get('BU1')).hk_suriname, 10);
    assert.equal(sharesOf(m.get('BU0')).hk_suriname, null, `below ${PC4_MIN_POPULATION}`);
    assert.equal(sharesOf(null).hk_suriname, null);
    assert.throws(() => decodePc4Herkomst({ format: 2 }));
  });
  it('the metric keys are the detailed Gemeenschap keys and origin keys, as neutral Rotterdam-scope layers', () => {
    for (const g of PC4_GROUPS) {
      assert.ok(DETAIL_GROUPS[g.key]?.wijk, g.key);
      assert.equal(DETAIL_GROUPS[g.key].key, g.metric);
      assert.ok(ORIGIN_KEYS.includes(g.metric), g.metric);
      const d = DATASETS[g.metric];
      assert.equal(d.group, 'herkomst');
      assert.equal(d.higherIsBetter, null);
      assert.equal(d.inOverall, false);
      assert.equal(d.scope, 'rotterdam');
      assert.match(d.title, /geschat via postcode 2023/);
      assert.ok(d.caveats.some(c => /dezelfde mix/.test(c)) && d.caveats.some(c => /afgerond op 5|af op 5/.test(c)) && d.caveats.some(c => /2025/.test(c)));
    }
    assert.ok(isPc4Key('hk_suriname') && !isPc4Key('hk_egypte'));
    assert.ok(presetUsesPc4({ themes: [{ metrics: [{ key: 'hk_turkije' }] }] }));
    assert.ok(!presetUsesPc4({ themes: [{ metrics: [{ key: 'hk_egypte' }] }] }));
    const s = GENERAL_SECTIONS.find(x => x.id === 'herkomst-postcode');
    assert.ok(s && /dezelfde mix/.test(s.paragraphs.join(' ')) && /niets bijgeschat/.test(s.paragraphs.join(' ')));
  });
  it('loads once, runs listeners before resolving, adds shares to wijken/buurten only', async () => {
    _setPc4Data(null);
    const data = { format: 1, levels: { buurt: { codes: ['BU05990110'], total: [400], cols: { suriname: [40] } } } };
    let seen = 0, calls = 0;
    onPc4Loaded(() => { seen = getPc4Entry('BU05990110')?.total; });
    const fetcher = async () => { calls++; return { ok: true, json: async () => data }; };
    await Promise.all([loadPc4Herkomst({ fetcher }), loadPc4Herkomst({ fetcher })]);
    assert.equal(calls, 1);
    assert.equal(seen, 400);
    const areas = [{ code: 'BU05990110', values: { population: 400 } }, { code: 'BU09999999', values: {} }, { code: 'GM0599', values: {} }];
    addPc4Shares(areas);
    assert.equal(areas[0].values.hk_suriname, 10);
    assert.equal(areas[0].values.population, 400);
    assert.equal(areas[1].values.hk_suriname, null, 'no 2023 match: no data, no guess');
    assert.ok(!('hk_suriname' in areas[2].values), 'gemeenten keep their 85458NED shares');
    assert.equal(pc4OriginRows('BU05990110')[0].key, 'suriname');
    assert.match(pc4OriginHtml('BU05990110'), /geschat via postcode, 2023/);
    assert.equal(pc4OriginHtml('BU09999999'), '');
    _setPc4Data(null);
  });
});

describe('herkomst-pc4: built data files', () => {
  it('stay well under 1.5 MB', () => {
    for (const u of [PC4_HERKOMST_URL, PC4_CROSSWALK_URL]) assert.ok(statSync(file(u)).size < 1.2e6, u);
  });
  it('carry sources, 2025-notation codes of existing areas only, and aligned columns', () => {
    assert.equal(HK.year, 2023);
    assert.match(HK.sources.herkomst, /83503NED/);
    assert.match(HK.sources.method, /adressen/);
    const known = { buurt: new Set(NL_BUURT.codes), wijk: new Set(NL_WIJK.codes) };
    for (const [lvl, prefix] of [['buurt', 'BU'], ['wijk', 'WK'], ['gemeente', 'GM']]) {
      const L = HK.levels[lvl];
      assert.ok(L.codes.every(c => c.startsWith(prefix)), lvl);
      if (known[lvl]) assert.ok(L.codes.every(c => known[lvl].has(c)), lvl);
      for (const k of PC4_GROUPS.map(g => g.key)) assert.equal(L.cols[k].length, L.codes.length, `${lvl}.${k}`);
      assert.ok(L.codes.every((_, i) => PC4_GROUPS.every(g => L.cols[g.key][i] <= L.total[i] + 1)), `${lvl}: group ≤ total`);
    }
    assert.ok(HK.levels.buurt.codes.length > 0.9 * NL_BUURT.codes.length, 'most 2025 buurten have data');
    assert.ok(HK.levels.wijk.codes.length > 0.9 * NL_WIJK.codes.length, 'most 2025 wijken have data');
  });
  it('has plausible totals: ~17.8 million inhabitants, Rotterdam ~650k with a large Surinamese group', () => {
    const g = HK.levels.gemeente;
    const total = g.total.reduce((s, v) => s + v, 0);
    assert.ok(total > 17.5e6 && total < 18.1e6, String(total));
    const m = decodePc4Herkomst(HK);
    const rtm = m.get('GM0599');
    assert.ok(rtm.total > 600e3 && rtm.total < 700e3, String(rtm.total));
    const sr = sharesOf(rtm).hk_suriname;
    assert.ok(sr > 5 && sr < 12, String(sr));
    const buurt = HK.levels.buurt.codes.filter(c => c.startsWith('BU0599')).map(c => sharesOf(m.get(c)).hk_suriname).filter(v => v > 0);
    assert.ok(buurt.length > 50, 'many Rotterdam buurten with a non-zero Suriname share');
    // Wijk counts equal the sum of their buurten (both rolled up from the same allocation, rounding aside).
    const wk = m.get('WK059901'), bus = HK.levels.buurt.codes.filter(c => c.startsWith('BU059901'));
    if (wk && bus.length) assert.ok(Math.abs(bus.reduce((s, c) => s + m.get(c).total, 0) - wk.total) <= bus.length);
  });
  it('crosswalk: postcode 3011 lands in a Rotterdam buurt with a name; unknown postcodes give null', () => {
    const ix = crosswalkIndex(XW);
    assert.ok(ix.cw.size > 4000);
    const hit = resolvePostcode('3011 AB', ix);
    assert.equal(hit.level, 'buurt');
    assert.match(hit.code, /^BU0599/);
    assert.ok(NL_BUURT.codes.includes(hit.code));
    assert.ok(hit.name && !hit.name.startsWith('BU'), hit.name);
    assert.equal(resolvePostcode('0000', ix), null);
    assert.equal(resolvePostcode('Delfshaven', ix), null);
  });
  it('falls back to the wijk, then the gemeente, when the dominant buurt has no 2025 counterpart', () => {
    const json = { format: 1, buurten: ['0599AB01', '0599AB02'], names: [null, null], wijkNames: { '0599AB': 'Wijk AB' }, pc: { 3011: [0, 9, 1, 1] }, unmatched: { buurt: ['0599AB01', '0599AB02'], wijk: [] } };
    assert.deepEqual(resolvePostcode('3011', crosswalkIndex(json)), { pc4: '3011', code: 'WK0599AB', level: 'wijk', name: 'Wijk AB' });
    json.unmatched.wijk = ['0599AB'];
    assert.equal(resolvePostcode('3011', crosswalkIndex(json)).code, 'GM0599');
  });
});

describe('search: postcode item', () => {
  it('Rotterdam buurten go to the Rotterdam scope, others to Nederland', () => {
    const r = postcodeItem({ pc4: '3011', code: 'BU05990110', level: 'buurt', name: 'Stadsdriehoek' });
    assert.deepEqual([r.scope, r.code, r.name, r.postcode], ['rotterdam', 'BU05990110', 'Stadsdriehoek', '3011']);
    assert.match(r.meta, /^Postcode 3011 · buurt/);
    const a = postcodeItem({ pc4: '1011', code: 'GM0363', level: 'gemeente', name: 'GM0363' }, c => (c === 'GM0363' ? 'Amsterdam' : null));
    assert.deepEqual([a.scope, a.name], ['nederland', 'Amsterdam']);
    assert.equal(postcodeItem(null), null);
  });
});
