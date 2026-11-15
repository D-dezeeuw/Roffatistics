import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractAreaValues, mergeYearValues, WIJK_COLUMNS as C } from '../modules/areas.js';
import { DATASETS, groupDatasets, normalizeProvinces, CBS_COLUMNS } from '../modules/datasets.js';
import { readFileSync } from 'node:fs';
import {
  originSplit, originBarHtml, ORIGIN_PARTS, ORIGIN_GROUPS, ORIGIN_REGIONS, HK, COUNTRIES,
  parseHerkomstRows, groupValue, computeGroups, partitionGap, topCountries, changePct, herkomstSummary,
  buildHerkomstUrls, loadCityHerkomst, _resetHerkomstCache, wijkOriginRows,
} from '../modules/herkomst.js';
import { herkomstSectionHtml, sparkPoints } from '../modules/dashboard-herkomst.js';
import { GENERAL_SECTIONS } from '../modules/explain.js';
import { formatPanelData } from '../modules/panel.js';

// WK059901 Stadscentrum, 86165NED (2025), fetched 15 Nov 2026.
const centrum = {
  [C.region]: 'WK059901  ', [C.population]: 42090,
  [C.originDutch]: 15390, [C.originEurope]: 7465, [C.originOutsideEurope]: 19240,
  [C.bornAbroadEurope]: 5985, [C.bornAbroadOutside]: 12345,
};

describe('herkomst layers (wijk/buurt, 86165NED)', () => {
  it('maps the CBS columns _17/_18/_19 and _23 + _24 to shares of inhabitants', () => {
    assert.equal(C.originDutch, 'Nederland_17');
    assert.equal(C.originEurope, 'EuropaExclusiefNederland_18');
    assert.equal(C.bornAbroadEurope, 'EuropaExclusiefNederland_23');
    assert.equal(C.bornAbroadOutside, 'BuitenEuropa_24');
    const v = extractAreaValues(centrum);
    assert.equal(v.originDutchPct, 36.6);
    assert.equal(v.originEuropePct, 17.7);
    assert.equal(v.nonWesternPct, 45.7);
    assert.equal(v.bornAbroadPct, 43.5);   // (5985 + 12345) / 42090 = 43.55 → toFixed(1)
  });
  it('born abroad is null when either part is missing', () => {
    assert.equal(extractAreaValues({ ...centrum, [C.bornAbroadOutside]: null }).bornAbroadPct, null);
  });
  it('the herkomst shares fall back to the older year together', () => {
    const now = { ...centrum, [C.originEurope]: null };
    const { values, years } = mergeYearValues(now, centrum, 2024);
    assert.equal(values.originEuropePct, 17.7);
    assert.equal(years.nonWesternPct, 2024);
    assert.equal(years.originDutchPct, 2024);
  });
  it('are neutral, out of the totaalscore, in their own Herkomst group', () => {
    for (const k of ['originDutchPct', 'originEuropePct', 'nonWesternPct', 'bornAbroadPct']) {
      assert.equal(DATASETS[k].higherIsBetter, null, k);
      assert.equal(DATASETS[k].inOverall, false, k);
      assert.equal(DATASETS[k].group, 'herkomst', k);
      assert.ok(DATASETS[k].description.includes('moeder'), `${k} explains the CBS definition`);
    }
    assert.equal(DATASETS.bornAbroadPct.scope, 'rotterdam');
    const g = groupDatasets().find(x => x.key === 'herkomst');
    assert.deepEqual(g.datasets.map(d => d.key), ['originDutchPct', 'originEuropePct', 'nonWesternPct', 'bornAbroadPct']);
    assert.equal(g.scope, 'all');
  });
  it('Nederland view gets NL and Europa shares from 70072ned', () => {
    assert.equal(CBS_COLUMNS.originDutch, 'Nederland_14');
    const [r] = normalizeProvinces([{ RegioS: 'GM0599', TotaleBevolking_1: 1000, Nederland_14: 450, EuropaExclusiefNederland_15: 120, BuitenEuropa_16: 430 }]);
    assert.equal(r.originDutchPct, 45);
    assert.equal(r.originEuropePct, 12);
  });
});

describe('origin split and panel bar', () => {
  it('normalises the three parts to exactly 100 %', () => {
    const parts = originSplit(extractAreaValues(centrum));
    assert.deepEqual(parts.map(p => p.key), ORIGIN_PARTS.map(p => p.key));
    assert.ok(Math.abs(parts.reduce((a, p) => a + p.pct, 0) - 100) < 1e-9);
    assert.equal(parts[2].value, 45.7);
  });
  it('is null when a part is missing or everything is zero', () => {
    assert.equal(originSplit({ originDutchPct: 50, originEuropePct: null, nonWesternPct: 50 }), null);
    assert.equal(originSplit({ originDutchPct: 0, originEuropePct: 0, nonWesternPct: 0 }), null);
    assert.equal(originSplit(null), null);
  });
  it('renders a labelled bar, and nothing without data', () => {
    const html = originBarHtml(extractAreaValues(centrum));
    assert.match(html, /role="img" aria-label="Herkomst: Nederland 36,6%, Europa \(excl\. NL\) 17,7%, Buiten Europa 45,7%"/);
    assert.equal((html.match(/class="origin-seg"/g) || []).length, 3);
    assert.equal(originBarHtml({}), '');
  });
  it('panel formats the new fields', () => {
    const f = formatPanelData({ originDutchPct: 36.6, originEuropePct: 17.7, bornAbroadPct: 43.6 });
    assert.equal(f.originDutchPct, '36.6%');
    assert.equal(f.bornAbroadPct, '43.6%');
    assert.equal(formatPanelData(null).originEuropePct, '—');
  });
});

// CBS 85458NED for GM0599, 2022–2026, fetched 15 Nov 2026.
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/herkomst-85458NED-GM0599.json', import.meta.url))).value;
const parsed = parseHerkomstRows(FIXTURE);

describe('origin groups (heel Rotterdam, 85458NED)', () => {
  it('parses five years and the born-abroad total', () => {
    assert.deepEqual([...parsed.byYear.keys()].sort(), [2022, 2023, 2024, 2025, 2026]);
    assert.equal(parsed.byYear.get(2026)[HK.total], 673804);
    assert.equal(parsed.bornAbroad.get(2026), 231228);
  });
  it('the groups add up to the total in every year: no gaps, no double counting', () => {
    for (const [y, counts] of parsed.byYear) assert.equal(partitionGap(counts), 0, String(y));
  });
  it('no group is negative and every key it uses exists in the table', () => {
    for (const counts of parsed.byYear.values()) {
      for (const g of computeGroups(counts)) assert.ok(g.value >= 0, g.key);
    }
    const known = new Set(Object.keys(parsed.byYear.get(2026)));
    for (const g of ORIGIN_GROUPS) for (const k of [...g.plus, ...g.minus]) assert.ok(known.has(k), `${g.key}: ${k}`);
  });
  it('structurally: every leaf key is counted once, every subtracted key once more than it is added', () => {
    const net = new Map();
    for (const g of ORIGIN_GROUPS) {
      for (const k of g.plus) net.set(k, (net.get(k) ?? 0) + 1);
      for (const k of g.minus) net.set(k, (net.get(k) ?? 0) - 1);
    }
    // Parents taken whole once; a child subtracted from its parent must be added once on its own (net 0 → 1 − 1).
    for (const g of ORIGIN_GROUPS) for (const k of g.minus) assert.equal(net.get(k), 0, `${g.key} subtracts ${k} that is not its own group`);
  });
  it('every group names a known region, a colour and its composition', () => {
    const regions = new Set(ORIGIN_REGIONS.map(r => r.key));
    for (const g of ORIGIN_GROUPS) {
      assert.ok(regions.has(g.region), g.key);
      assert.match(g.color, /^#[0-9a-f]{6}$/);
      assert.ok(g.composition.length > 3, g.key);
    }
    assert.equal(new Set(ORIGIN_GROUPS.map(g => g.key)).size, ORIGIN_GROUPS.length);
  });
  it('groupValue is null when a key is missing', () => {
    assert.equal(groupValue({ plus: ['a'], minus: ['b'] }, { a: 10 }), null);
    assert.equal(groupValue({ plus: ['a'], minus: ['b'] }, { a: 10, b: 4 }), 6);
  });
  it('Rotterdam 2026 per group', () => {
    const s = herkomstSummary(parsed);
    const v = Object.fromEntries(s.groups.map(g => [g.key, g.value]));
    assert.equal(v.nl, 283801);
    assert.equal(v.suriname, 51570);
    assert.equal(v.turkije, 49760);
    assert.equal(v.marokko, 47634);
    assert.equal(v.subSahara, 84758 - 47634 - 1070);
    assert.equal(v.latAmerika, 99568 - 51570 - 30097 - 2867 - 755);
    assert.equal(v.euNietEu, 87316 - 66004);
    const r = Object.fromEntries(s.regions.map(x => [x.key, x.value]));
    assert.equal(r.noordAfrika, 47634 + 1070);
    assert.equal(r.europa, 87316);
    assert.equal(r.azie, 117392);
    assert.equal(Math.round(s.bornAbroadPct * 10) / 10, 34.3);
    assert.equal(s.gap, 0);
  });
  it('trend 2022 → 2026 per group', () => {
    const s = herkomstSummary(parsed);
    const mo = s.groups.find(g => g.key === 'middenOosten');
    assert.deepEqual(s.years, [2022, 2023, 2024, 2025, 2026]);
    assert.equal(mo.series.length, 5);
    assert.equal(mo.series[0], 4658 + 2891 + 3133 + 2671);
    assert.equal(mo.change, changePct(mo.series[0], mo.value));
    assert.equal(s.groups.find(g => g.key === 'nl').change, -5.1);
    assert.equal(changePct(0, 5), null);
  });
  it('top 15 single countries, without Nederland or aggregates', () => {
    const top = topCountries(parsed.byYear.get(2026));
    assert.equal(top.length, 15);
    assert.deepEqual(top.slice(0, 5).map(c => c.label), ['Suriname', 'Turkije', 'Marokko', 'Curaçao', 'Kaapverdië']);
    for (const agg of ['H007119', 'H007069', 'H007172', 'H007204', HK.nederland]) assert.ok(!(agg in COUNTRIES), agg);
  });
  it('herkomstSummary is null without the latest year', () => {
    assert.equal(herkomstSummary({ byYear: new Map() }), null);
  });
  it('builds two CBS queries with the totals fixed', () => {
    const [a, b] = buildHerkomstUrls().map(u => decodeURIComponent(u.replace(/\+/g, ' ')));
    assert.match(a, /85458NED\/TypedDataSet/);
    assert.match(a, /RegioS eq 'GM0599' and Geslacht eq 'T001038' and Leeftijd eq '10000' and Geboorteland eq 'T001638'/);
    assert.match(b, /Herkomstland eq 'T001040' and Geboorteland eq 'A051736'/);
  });
  it('loadCityHerkomst fetches, summarises and resets after a failure', async () => {
    _resetHerkomstCache();
    await assert.rejects(loadCityHerkomst({ fetcher: async () => ({ ok: false, status: 500 }), storage: null }));
    const main = FIXTURE.filter(r => r.Geboorteland === 'T001638'), born = FIXTURE.filter(r => r.Geboorteland !== 'T001638');
    let calls = 0;
    const fetcher = async url => { calls++; return { ok: true, json: async () => ({ value: url.includes('A051736') ? born : main }) }; };
    const s = await loadCityHerkomst({ fetcher, storage: null });
    assert.equal(s.total, 673804);
    await loadCityHerkomst({ fetcher, storage: null });
    assert.equal(calls, 2, 'cached after the first success');
    _resetHerkomstCache();
  });
});

describe('dashboard Herkomst section', () => {
  const wijken = [
    { code: 'WK059901', name: 'Stadscentrum', values: extractAreaValues(centrum) },
    { code: 'WK059906', name: 'Kralingen-Crooswijk', values: { originDutchPct: 64.4, originEuropePct: 10, nonWesternPct: 25.5 } },
    { code: 'WK059999', name: 'Haven', values: {} },
  ];
  const helpers = { donutSvg: () => '<svg class="stub"></svg>', legendHtml: (sl, fmt, extra) => sl.map((x, i) => `<li>${x.label} ${extra(x, i)}</li>`).join('') };
  it('wijk rows are sorted by % buiten Europa, missing data last', () => {
    assert.deepEqual(wijkOriginRows(wijken).map(r => r.code), ['WK059901', 'WK059906', 'WK059999']);
  });
  it('renders donut, top 15, small multiples and clickable wijk bars', () => {
    const html = herkomstSectionHtml(herkomstSummary(parsed), wijken, { ...helpers, selected: 'WK059906' });
    assert.match(html, /Rotterdam naar herkomst, 2026/);
    assert.match(html, /Overige groepen/);
    assert.equal((html.match(/class="hk-bar"/g) || []).length, 15);
    assert.equal((html.match(/class="hk-sm"/g) || []).length, 12);
    assert.match(html, /class="hk-wijk is-link is-selected" data-code="WK059906"/);
    assert.match(html, /34,3%/);
    assert.match(html, /data-explain="herkomst-groepen"/);
  });
  it('still shows the wijk bars while loading or after a CBS error', () => {
    const html = herkomstSectionHtml(null, wijken, { ...helpers, failed: true });
    assert.match(html, /konden niet worden geladen/);
    assert.equal((html.match(/data-code="WK/g) || []).length, 3);
  });
  it('sparkline points span the box on the series own scale', () => {
    assert.equal(sparkPoints([1, 2, 3], 100, 32, 0), '0.0,32.0 50.0,16.0 100.0,0.0');
    assert.equal(sparkPoints([5]), '');
  });
  it('Uitleg lists every group composition', () => {
    const sec = GENERAL_SECTIONS.find(s => s.id === 'herkomst-groepen');
    assert.ok(sec);
    for (const g of ORIGIN_GROUPS) assert.ok(sec.text.includes(g.label), g.label);
    assert.match(sec.text, /moeder/);
  });
});
