// Woongebied classification (modules/woongebied.js) and its effect on the
// Woonscore peers, the modal ranks and the map tooltip (W7, 15 Nov 2026).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  classifyWoongebied, isResidentialArea, nonResidentialLabel, splitResidential, countWoongebied,
  woongebiedFacts, WOON_THRESHOLDS, WOON_LABELS,
} from '../modules/woongebied.js';
import { decodeLevel } from '../modules/nl-areas.js';
import { scoreWithPreset, STANDAARD } from '../modules/presets.js';
import { buildAreaDetail } from '../modules/area-detail.js';
import { tooltipHtml } from '../modules/rotterdam.js';
import { WIJK_COLUMNS, extractAreaValues } from '../modules/areas.js';
import { SHRINK_K } from '../modules/score.js';

const v = (population, housingStock, nonResidentialStock, businesses) => ({ population, housingStock, nonResidentialStock, businesses });
const kind = (vals, code = 'BU00000001') => classifyWoongebied(vals, code).kind;

describe('classifyWoongebied', () => {
  it('a normal buurt is a woongebied; under 300 inwoners it is "weinig"', () => {
    assert.equal(kind(v(4200, 1900, 120, 210)), 'wonen');
    assert.equal(kind(v(250, 110, 10, 20)), 'weinig');
    assert.equal(WOON_THRESHOLDS.fewPop, SHRINK_K);
  });
  it('200+ inwoners or 100+ woningen is always a woongebied, however many offices', () => {
    assert.equal(kind(v(200, 1, 900, 800)), 'weinig');
    assert.equal(kind(v(150, 100, 5000, 4000)), 'weinig');
  });
  it('few woningen and many niet-woningen: bedrijven (enough firms) or overig', () => {
    assert.equal(kind(v(5, 2, 206, 200)), 'bedrijven');          // Botlek
    assert.equal(kind(v(65, 30, 799, 995)), 'bedrijven');        // Spaanse Polder: 30 woningen but ≥ 10×
    assert.equal(kind(v(95, 0, 581, 10)), 'overig');             // recreatiepark
    assert.equal(kind(v(0, 0, 20, 4)), 'bedrijven');             // edge: 20 niet-woningen, firms = 0.2×
    assert.equal(kind(v(0, 0, 19, 19)), 'onbewoond');            // under minNonRes
  });
  it('a rural hamlet with farm buildings stays a woongebied', () => {
    assert.equal(kind(v(45, 16, 32, 5)), 'weinig');              // 32 niet-woningen < 3 × 16 woningen
  });
  it('almost nobody and almost no homes: onbewoond; a small hamlet is not', () => {
    assert.equal(kind(v(0, 0, 5, 0)), 'onbewoond');              // Noordzeeweg
    assert.equal(kind(v(15, 9, 3, 0)), 'onbewoond');
    assert.equal(kind(v(40, 17, 1, 10)), 'weinig');
  });
  it('missing counts never exclude; gemeenten and provincies are always residential', () => {
    assert.equal(kind({}), 'wonen');
    assert.equal(kind(null), 'wonen');
    assert.equal(kind(v(null, null, 500, 500)), 'wonen');
    assert.equal(kind(v(0, 0, 900, 900), 'GM0599'), 'wonen');
    assert.equal(kind(v(0, 0, 900, 900), 'PV28'), 'wonen');
  });
  it('labels, residential flag and helpers', () => {
    const c = classifyWoongebied(v(5, 2, 206, 200), 'BU05992306');
    assert.deepEqual(c, { kind: 'bedrijven', residential: false, label: 'Geen woonwijk (bedrijven-/havengebied)' });
    assert.equal(WOON_LABELS.onbewoond, 'Geen woonwijk (vrijwel onbewoond)');
    const a = { code: 'BU1', values: v(5, 2, 206, 200) }, b = { code: 'BU2', values: v(3000, 1400, 50, 90) };
    assert.equal(isResidentialArea(a), false);
    assert.equal(nonResidentialLabel(b), null);
    assert.deepEqual(splitResidential([a, b]), { peers: [b], excluded: [a] });
    assert.deepEqual(countWoongebied([a, b]), { wonen: 1, weinig: 0, bedrijven: 1, overig: 0, onbewoond: 0 });
    assert.equal(woongebiedFacts(v(5, 2, 1206, null)), '5 inwoners · 2 woningen · 1.206 niet-woningen');
  });
});

describe('woongebied data (86165NED columns)', () => {
  it('the loader selects and maps woningvoorraad, niet-woningvoorraad and bedrijfsvestigingen', () => {
    assert.equal(WIJK_COLUMNS.housingStock, 'Woningvoorraad_35');
    assert.equal(WIJK_COLUMNS.nonResidentialStock, 'NietWoningvoorraad_37');
    assert.equal(WIJK_COLUMNS.businesses, 'BedrijfsvestigingenTotaal_95');
    const vals = extractAreaValues({ AantalInwoners_5: 5, Woningvoorraad_35: 2, NietWoningvoorraad_37: 206, BedrijfsvestigingenTotaal_95: 200 });
    assert.deepEqual([vals.housingStock, vals.nonResidentialStock, vals.businesses], [2, 206, 200]);
  });

  it('Rotterdam sanity cases in the NL build: port and business buurten are no woonwijk, real buurten are', async () => {
    const buurten = decodeLevel(JSON.parse(await readFile(new URL('../data/nl/buurten-2025.json', import.meta.url), 'utf8')));
    const by = new Map(buurten.map(a => [a.name + '|' + a.code.slice(0, 6), a]));
    const get = name => by.get(`${name}|BU0599`);
    for (const name of ['Botlek', 'Europoort', 'Maasvlakte', 'Waalhaven', 'Waalhaven Zuid', 'Eemhaven', 'Spaanse Polder', 'Vondelingenplaat']) {
      assert.ok(get(name), name);
      assert.equal(isResidentialArea(get(name)), false, name);
    }
    for (const name of ['Cool', 'Oude Westen', 'Kralingen Oost', 'Hillegersberg Zuid']) {
      if (get(name)) assert.equal(isResidentialArea(get(name)), true, name);
    }
    const c = countWoongebied(buurten);
    const excluded = c.bedrijven + c.overig + c.onbewoond;
    assert.ok(excluded > 500 && excluded < 2500, `NL buurten excluded ${excluded}`);
  });
});

describe('effect on peers', () => {
  const area = (code, values) => ({ code, values });
  const res = [
    area('BU01', { population: 3000, housingStock: 1400, avgIncome: 30, crimeRate: 40 }),
    area('BU02', { population: 3000, housingStock: 1400, avgIncome: 40, crimeRate: 60 }),
    area('BU03', { population: 3000, housingStock: 1400, avgIncome: 50, crimeRate: 80 }),
  ];
  const port = area('BU99', { population: 5, housingStock: 2, nonResidentialStock: 206, businesses: 200, avgIncome: 5, crimeRate: 9000 });

  it('a business area gets no Woonscore and does not move the others', () => {
    const without = scoreWithPreset(res, STANDAARD).results;
    const withPort = scoreWithPreset([res[0], port, res[1], res[2]], STANDAARD).results;
    assert.deepEqual(withPort.map(r => r.code), ['BU01', 'BU99', 'BU02', 'BU03']);
    const p = withPort[1];
    assert.equal(p.score, null);
    assert.equal(p.nonResidential, 'bedrijven');
    assert.equal(p.filtered, false);
    const scores = withPort.filter(r => r.code !== 'BU99').map(r => r.score);
    assert.deepEqual(scores, without.map(r => r.score));
  });

  it('only business areas: every result is null, no crash', () => {
    const { results } = scoreWithPreset([port], STANDAARD);
    assert.equal(results.length, 1);
    assert.equal(results[0].score, null);
  });

  it('the modal ranks among woongebieden only; a business area has no overall rank', () => {
    const areas = { wijken: [], buurten: [...res, port].map(a => ({ ...a, level: 'buurt', name: a.code })) };
    const d = buildAreaDetail(areas.buurten[0], areas);
    assert.equal(d.peers, 3);
    assert.equal(d.woongebied.residential, true);
    const crime = d.entries.find(e => e.key === 'crimeRate');
    if (crime) assert.equal(crime.of, 3);
    const dp = buildAreaDetail(areas.buurten[3], areas);
    assert.equal(dp.woongebied.kind, 'bedrijven');
    assert.equal(dp.overall, null);
    assert.deepEqual(dp.notable, []);
    assert.match(dp.woongebied.facts, /206 niet-woningen/);
  });

  it('the map tooltip carries the "Geen woonwijk" note', () => {
    const html = tooltipHtml('Botlek', null, String, null, 'Geen woonwijk (bedrijven-/havengebied)');
    assert.match(html, /geen data/);
    assert.match(html, /tt-note">Geen woonwijk \(bedrijven-\/havengebied\)/);
    assert.doesNotMatch(tooltipHtml('Cool', 5, String), /tt-note/);
  });
});
