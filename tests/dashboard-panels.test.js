import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aggregateAreas, aggregateGemeenten, gemeenteCodeOf, rankBy, topBottom, rankOf, histogram, niceHistogram,
  ageBands, crimeBreakdown, lowestCrime, pearson, scoreDrivers, buildContext, dashboardLayout, boardHtml, CATEGORIES, NA_TEXT,
} from '../modules/dashboard-panels.js';
import { regionMix, sumRegioEntries, diversityIndex, regionShare } from '../modules/dashboard-herkomst.js';
import { decodeLevel } from '../modules/nl-areas.js';
import { withWoonscore } from '../modules/presets.js';
import { decodeRegio } from '../modules/herkomst-regio.js';

const area = (code, name, values) => ({ code, name, values: { population: 5000, housingStock: 2500, nonResidentialStock: 100, ...values } });

const wijken = [
  area('WK059901', 'Centrum', { woonscore: 80, highEdu: 50, lowEdu: 20, medEdu: 30, avgIncome: 40, crimeRate: 90, pop65plus: 10, pop15to24: 20, pop25to44: 40, pop45to64: 20, totalCrimes: 450, crimeTrend: 10, originDutchPct: 50, originEuropePct: 20, nonWesternPct: 30 }),
  area('WK059902', 'Noord', { woonscore: 60, highEdu: 40, lowEdu: 25, medEdu: 35, avgIncome: 35, crimeRate: 50, pop65plus: 15, pop15to24: 12, pop25to44: 33, pop45to64: 25, totalCrimes: 250, crimeTrend: -10, originDutchPct: 70, originEuropePct: 10, nonWesternPct: 20 }),
  area('WK059903', 'Zuid', { woonscore: 30, highEdu: 15, lowEdu: 50, medEdu: 35, avgIncome: 25, crimeRate: 70, pop65plus: 12, pop15to24: 15, pop25to44: 30, pop45to64: 25, totalCrimes: 350, crimeTrend: 0, originDutchPct: 34, originEuropePct: 33, nonWesternPct: 33 }),
  area('WK059904', 'Hillegersberg', { woonscore: 90, highEdu: 60, lowEdu: 10, medEdu: 30, avgIncome: 55, crimeRate: 20, pop65plus: 25, pop15to24: 10, pop25to44: 20, pop45to64: 30, totalCrimes: 100, crimeTrend: 5, originDutchPct: 90, originEuropePct: 5, nonWesternPct: 5 }),
  area('WK059905', 'Haven', { woonscore: 10, population: 300, avgIncome: 99, crimeRate: null }),
  area('WK059906', 'Leeg', {}),
];

describe('dashboard aggregation', () => {
  it('sums counts, weights shares and derives crime rate and trend', () => {
    const v = aggregateAreas(wijken.slice(0, 2));
    assert.equal(v.population, 10000);
    assert.equal(v.totalCrimes, 700);
    assert.equal(v.crimeRate, 70);
    assert.equal(v.highEdu, 45);
    // 450 = +10 % of 409.09, 250 = −10 % of 277.78 → 700 / 686.87
    assert.ok(Math.abs(v.crimeTrend - (700 / (450 / 1.1 + 250 / 0.9) - 1) * 100) < 1e-9);
  });
  it('groups NL wijken by gemeente with names', () => {
    const list = [area('WK036300', 'A', { avgIncome: 30 }), area('WK036301', 'B', { avgIncome: 40, population: 15000 }), area('WK059901', 'C', { avgIncome: 20 })];
    const g = aggregateGemeenten(list, c => ({ GM0363: 'Amsterdam', GM0599: 'Rotterdam' })[c]);
    assert.deepEqual(g.map(x => x.code), ['GM0363', 'GM0599']);
    assert.equal(g[0].values.population, 20000);
    assert.equal(g[0].values.avgIncome, 37.5);
    assert.equal(gemeenteCodeOf('BU05990101'), 'GM0599');
    assert.equal(gemeenteCodeOf('PV28'), null);
  });
});

describe('dashboard selections', () => {
  it('top and bottom skip small, empty and non-residential areas and never overlap', () => {
    const { top, bottom } = topBottom(wijken, 'woonscore', { n: 3 });
    assert.deepEqual(top.map(r => r.name), ['Hillegersberg', 'Centrum', 'Noord']);
    assert.deepEqual(bottom.map(r => r.name), ['Zuid']);   // Haven: 300 inhabitants
    assert.deepEqual(rankBy(wijken, 'crimeRate', { desc: false, n: 2 }).map(r => r.name), ['Hillegersberg', 'Noord']);
    assert.deepEqual(rankOf(wijken, 'woonscore', 'WK059902'), { rank: 3, of: 4 });
    assert.equal(rankOf(wijken, 'woonscore', 'WK059905'), null);
  });
  it('histogram counts every value, edges inclusive', () => {
    const h = histogram([0, 9.9, 10, 55, 100, 120, null], { min: 0, max: 100, bins: 10 });
    assert.equal(h.length, 10);
    assert.equal(h.reduce((s, b) => s + b.count, 0), 6);
    assert.equal(h[0].count, 2);
    assert.equal(h[9].count, 2);
    const n = niceHistogram([21.3, 30, 48.7]);
    assert.equal(n.reduce((s, b) => s + b.count, 0), 3);
    assert.deepEqual(histogram([]), []);
  });
  it('age bands derive 0–14 and need every band', () => {
    const b = ageBands(wijken[0].values);
    assert.deepEqual(b.map(x => x.value), [10, 20, 40, 20, 10]);
    assert.equal(ageBands({ pop15to24: 10 }), null);
  });
  it('crime breakdown leaves out overlapping categories', () => {
    const r = crimeBreakdown({ crimeViolence: 9, crimeThreat: 50, crimeStreetRobbery: 40, crimeBike: 3, crimeDrugs: 12 }, 2);
    assert.deepEqual(r.map(x => x.key), ['crimeDrugs', 'crimeViolence']);
    assert.equal(crimeBreakdown({}), null);
  });
  it('pearson r', () => {
    assert.equal(pearson([{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }]), 1);
    assert.ok(Math.abs(pearson([{ x: 1, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 1 }]) + 1) < 1e-12);
    assert.equal(pearson([{ x: 1, y: 1 }, { x: 2, y: 2 }]), null);
  });
  it('score drivers: own factors for an area, else top-vs-bottom gap', () => {
    const res = (code, score, f) => ({ code, score, factors: [{ key: 'a', label: 'A', f, impact: (f - 0.5) * 20 }, { key: 'b', label: 'B', f: 0.5, impact: 0 }] });
    const scored = Array.from({ length: 12 }, (_, i) => ({ code: `WK${i}`, woonscore: res(`WK${i}`, i * 8, i / 11) }));
    const gap = scoreDrivers(scored);
    assert.equal(gap.mode, 'gap');
    assert.equal(gap.rows[0].key, 'a');
    assert.ok(gap.rows[0].gap > 50);
    const own = scoreDrivers(scored, scored[11]);
    assert.equal(own.mode, 'area');
    assert.equal(own.plus[0].key, 'a');
    assert.equal(scoreDrivers(scored.slice(0, 5)), null);
  });
});

describe('dashboard herkomst helpers', () => {
  const entry = (total, nederland, counts) => ({ total, nederland, onbekend: 0, counts });
  it('region mix keeps the largest, sums the rest, and adds entries', () => {
    const e = entry(1000, 600, { noordAfrika: 150, westAzie: 100, westEuropa: 80, caribischGebied: 40, oceanie: 30 });
    const rows = regionMix(e, { top: 3 });
    assert.deepEqual(rows.map(r => r.key), ['nederland', 'noordAfrika', 'westAzie', 'overig']);
    assert.equal(rows.at(-1).count, 150);
    assert.equal(Math.round(rows.reduce((s, r) => s + r.pct, 0)), 100);
    const sum = sumRegioEntries([e, e, null]);
    assert.equal(sum.total, 2000);
    assert.equal(sum.counts.noordAfrika, 300);
    assert.equal(regionShare(sum, 'nederland'), 60);
    assert.equal(regionMix(null), null);
  });
  it('diversity is 0 for one group and 66.7 for equal thirds', () => {
    assert.equal(diversityIndex({ originDutchPct: 100, originEuropePct: 0, nonWesternPct: 0 }), 0);
    assert.ok(Math.abs(diversityIndex({ originDutchPct: 1, originEuropePct: 1, nonWesternPct: 1 }) - 200 / 3) < 1e-9);
    assert.equal(diversityIndex({}), null);
  });
});

describe('dashboard layout', () => {
  const shape = rows => rows.map(r => r.panels.length);
  it('always 6 categories × 3 panels in the fixed order, even without data', () => {
    assert.deepEqual(CATEGORIES.map(c => c.title), ['Woonscore', 'Leeftijd', 'Herkomst', 'Criminaliteit', 'Opleiding', 'Welvaart & wonen']);
    for (const ctx of [buildContext({}), buildContext({ scope: 'nederland' }), buildContext({ units: wijken, selected: wijken[5] })]) {
      const rows = dashboardLayout(ctx);
      assert.deepEqual(shape(rows), [3, 3, 3, 3, 3, 3]);
    }
    const empty = boardHtml(dashboardLayout(buildContext({})));
    assert.equal((empty.match(/<article class="dash-panel/g) ?? []).length, 18);
    assert.equal((empty.match(/class="dash-cat"/g) ?? []).length, 6);
    assert.equal((empty.match(new RegExp(NA_TEXT, 'g')) ?? []).length, 18);
  });
  it('Rotterdam overview and a selected wijk fill the panels', () => {
    const over = dashboardLayout(buildContext({ units: wijken }));
    const sel = dashboardLayout(buildContext({ units: wijken, selected: wijken[2] }));
    const na = rows => rows.flatMap(r => r.panels).filter(p => p.body == null).map(p => p.id);
    // No herkomst-regio entry, no score results, no bouwjaren, no crime types or kids in the fixture.
    assert.deepEqual(na(over), ['ws-drivers', 'age-kids', 'hk-regions', 'crime-types', 'woz-tenure', 'bouw']);
    assert.match(sel.find(r => r.key === 'leeftijd').panels[0].body, /dp-bar-ref/);
    assert.match(boardHtml(sel), /Zuid/);
  });
  it('crime-rate lists the 5 lowest buurten in a city and the 5 lowest gemeenten in Nederland', () => {
    const buurten = Array.from({ length: 8 }, (_, i) => area(`BU0599000${i}`, `Buurt ${i}`, { crimeRate: 80 - i * 10, population: i === 7 ? 500 : 2000 }));
    const city = lowestCrime(buildContext({ units: wijken, buurten }));
    assert.equal(city.word, 'buurten');
    assert.deepEqual(city.rows.map(r => r.name), ['Buurt 6', 'Buurt 5', 'Buurt 4', 'Buurt 3', 'Buurt 2']);   // Buurt 7: too few inhabitants
    const panel = dashboardLayout(buildContext({ units: wijken, buurten })).find(r => r.key === 'criminaliteit').panels[0];
    assert.match(panel.body, /Minste misdrijven \(buurten\)/);
    assert.match(panel.body, /Buurt 6/);
    assert.equal(lowestCrime(buildContext({ units: wijken })).word, 'wijken');   // no buurten loaded: wijken
    const nl = lowestCrime(buildContext({ scope: 'nederland', units: wijken }));
    assert.equal(nl.word, 'gemeenten');
    assert.equal(nl.rows[0].name, 'Hillegersberg');
  });
  it('real NL wijk file: every panel has data for gemeenten and for a selected gemeente', () => {
    const nlWijken = withWoonscore(decodeLevel(JSON.parse(readFileSync(new URL('../data/nl/wijken-2025.json', import.meta.url)))));
    const regio = decodeRegio(JSON.parse(readFileSync(new URL('../data/nl/herkomst-regio-gemeente-2026.json', import.meta.url))));
    const gemeenten = aggregateGemeenten(nlWijken, gm => regio.get(gm)?.name ?? null);
    assert.ok(gemeenten.length > 300);
    assert.equal(gemeenten.find(g => g.code === 'GM0599').name, 'Rotterdam');
    const all = sumRegioEntries([...regio.values()]);
    for (const selected of [null, gemeenten.find(g => g.code === 'GM0599')]) {
      const ctx = buildContext({ scope: 'nederland', units: gemeenten, scored: nlWijken, selected,
        regio: { area: selected ? regio.get('GM0599') : null, ref: all, areaName: 'Rotterdam', refName: 'Nederland' } });
      const rows = dashboardLayout(ctx);
      assert.deepEqual(shape(rows), [3, 3, 3, 3, 3, 3]);
      const missing = rows.flatMap(r => r.panels).filter(p => p.body == null).map(p => p.id);
      assert.deepEqual(missing, [], `missing: ${missing}`);
      assert.ok(rows.flatMap(r => r.panels).every(p => p.caption.length > 0));
    }
  });
});
