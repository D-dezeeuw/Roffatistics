// Actueel: meldingen hulpdiensten (P2000, W30): parser, rates, coverage, cache/fetch, hash, score exclusion, splash links.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseP2000Summary, p2000Rate, p2000ValuesFor, gemeenteOfCode, isCovered, addP2000Values, withP2000Rows, loadP2000,
  setP2000Window, getP2000Window, activeP2000, isP2000Loaded, p2000Note, p2000Detail, p2000LegendHtml, windowDays,
  P2000_KEYS, P2000_GROUPS, P2000_URL, P2000_MIN_POPULATION, countKeyOf, isP2000Key, _resetP2000,
} from '../modules/p2000.js';
import { DATASETS, DATASET_KEYS, LAYER_KEYS, LAYER_CATEGORIES, categoryOf, isLiveDataset, P2000_NOTES } from '../modules/datasets.js';
import { parseHash, serializeHash, DEFAULT_STATE } from '../modules/state.js';
import { scoreAreas } from '../modules/ranking.js';
import { withWoonscore, STANDAARD, GELIJK } from '../modules/presets.js';
import { compareKeys } from '../modules/compare.js';

const file = rel => new URL(`../${rel}`, import.meta.url);
const fixture = () => JSON.parse(readFileSync(file('tests/fixtures/p2000-summary-30d.json'), 'utf8'));
const okFetcher = (json, calls = []) => async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => json }; };

beforeEach(() => _resetP2000());

describe('p2000: parser', () => {
  it('normalises codes and counts, ignores unknown groups and levels', () => {
    const s = parseP2000Summary(fixture());
    assert.equal(s.window, '30d');
    assert.equal(s.days, 30);
    assert.equal(s.unlocated, 17);
    assert.deepEqual([...s.covered].sort(), ['GM0505', 'GM0599']);
    assert.deepEqual(s.counts.get('BU05990111'), { totaal: 5, verkeer: 0, brand: 0, explosie: 0, geweld: 0, spoed: 5 });
    assert.deepEqual(s.counts.get('BU05990112'), { totaal: 3, verkeer: 0, brand: 0, explosie: 0, geweld: 0, spoed: 3 }, 'negative and non-numeric → 0');
    assert.equal(s.counts.has('XX123'), false);
    assert.equal(s.counts.get('GM0599').totaal, 900);
  });
  it('throws on a shape it cannot use', () => {
    for (const bad of [null, [], 'x', {}, { gemeenten: [] }]) assert.throws(() => parseP2000Summary(bad));
    assert.equal(parseP2000Summary({ gemeenten: {} }).covered.size, 0);
  });
  it('reads the window length', () => {
    assert.equal(windowDays('7d'), 7);
    assert.equal(windowDays('week'), null);
    assert.match(P2000_URL('7d'), /^https:\/\/randstad\.hermes\.blockworlds\.nl\/api\/areas\/summary\?window=7d$/);
  });
});

describe('p2000: rate and coverage', () => {
  const s = parseP2000Summary(fixture());
  it('computes per 1.000 inwoners and skips small populations', () => {
    assert.equal(p2000Rate(12, 4000), 3);
    assert.equal(p2000Rate(1, 3000), 0.33);
    assert.equal(p2000Rate(5, P2000_MIN_POPULATION - 1), null);
    assert.equal(p2000Rate(5, P2000_MIN_POPULATION), 25);
    assert.equal(p2000Rate(null, 1000), null);
    assert.equal(p2000Rate(3, null), null);
  });
  it('maps area codes to their gemeente', () => {
    assert.equal(gemeenteOfCode('BU05990110'), 'GM0599');
    assert.equal(gemeenteOfCode('wk050501'), 'GM0505');
    assert.equal(gemeenteOfCode('GM0363'), 'GM0363');
    assert.equal(gemeenteOfCode('PV28'), null);
    assert.ok(isCovered('BU05990999', s));
    assert.ok(!isCovered('BU03630000', s));
  });
  it('covered area with a row: counts and rates', () => {
    const v = p2000ValuesFor('BU05990110', 4000, s);
    assert.equal(v.p2000Covered, true);
    assert.equal(v.p2000Totaal, 3);
    assert.equal(v.p2000TotaalCount, 12);
    assert.equal(v.p2000Spoed, 1);
    assert.equal(v[countKeyOf('p2000Explosie')], 1);
  });
  it('covered area without a row means zero meldingen', () => {
    const v = p2000ValuesFor('BU05990199', 1000, s);
    assert.equal(v.p2000Covered, true);
    for (const k of P2000_KEYS) { assert.equal(v[k], 0); assert.equal(v[countKeyOf(k)], 0); }
  });
  it('small buurt: count only, no rate', () => {
    const v = p2000ValuesFor('BU05990111', 80, s);
    assert.equal(v.p2000TotaalCount, 5);
    assert.equal(v.p2000Totaal, null);
    assert.match(p2000Note(v, 'p2000Totaal', s), /5 meldingen in 30 dagen · te weinig inwoners/);
  });
  it('outside the covered gemeenten: null ("geen gegevens"), not zero', () => {
    const v = p2000ValuesFor('BU03630000', 5000, s);
    assert.equal(v.p2000Covered, false);
    for (const k of P2000_KEYS) { assert.equal(v[k], null); assert.equal(v[countKeyOf(k)], null); }
    assert.match(p2000Note(v, 'p2000Brand', s), /^geen gegevens/);
    assert.deepEqual(p2000Detail(v, s), { covered: false, days: 30 });
    assert.deepEqual(p2000ValuesFor('BU05990110', 4000, null), {});
  });
  it('adds values to areas in place and to gemeente rows as new rows', () => {
    const areas = [{ code: 'WK059901', values: { population: 10000 } }, { code: 'WK036301', values: { population: 9000 } }];
    addP2000Values(areas, s);
    assert.equal(areas[0].values.p2000Totaal, 2);
    assert.equal(areas[0].values.population, 10000);
    assert.equal(areas[1].values.p2000Totaal, null);
    const rows = [{ regionCode: 'GM0599', population: 600000 }, { regionCode: 'GM0363', population: 900000 }];
    const out = withP2000Rows(rows, s);
    assert.notEqual(out, rows);
    assert.equal(out[0].p2000Totaal, 1.5);
    assert.equal(out[0].p2000SpoedCount, 500);
    assert.equal(out[1].p2000Covered, false);
    assert.equal(rows[0].p2000Totaal, undefined);
    assert.equal(withP2000Rows(rows, null), rows);
    const d = p2000Detail(out[0], s);
    assert.equal(d.rows.find(r => r.group === 'geweld').count, 80);
  });
  it('notes are for P2000 layers only', () => {
    assert.equal(p2000Note({ p2000Covered: true }, 'crimeRate', s), null);
    assert.equal(p2000Note({}, 'p2000Totaal', null), null);
  });
});

describe('p2000: fetch and session cache', () => {
  it('fetches lazily once per window and caches', async () => {
    const calls = [];
    assert.equal(isP2000Loaded(), false);
    assert.equal(activeP2000(), null);
    const f = okFetcher(fixture(), calls);
    await Promise.all([loadP2000('30d', { fetcher: f }), loadP2000('30d', { fetcher: f })]);
    await loadP2000('30d', { fetcher: f });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /window=30d/);
    assert.equal(calls[0].opts.credentials, 'omit');
    assert.equal(activeP2000().days, 30);
    setP2000Window('7d');
    assert.equal(activeP2000(), null, 'the 7-day window is not loaded yet');
    await loadP2000('7d', { fetcher: okFetcher({ ...fixture(), window: '7d' }, calls) });
    assert.equal(calls.length, 2);
    assert.equal(activeP2000().days, 7);
    assert.equal(setP2000Window('1y'), '7d', 'unknown windows are ignored');
    assert.equal(getP2000Window(), '7d');
  });
  it('rejects on HTTP errors and bad data, then retries', async () => {
    await assert.rejects(loadP2000('30d', { fetcher: async () => ({ ok: false, status: 503 }) }), /503/);
    await assert.rejects(loadP2000('30d', { fetcher: okFetcher({ nope: 1 }) }), /gemeenten/);
    await assert.rejects(loadP2000('30d', { fetcher: async () => { throw new TypeError('CORS'); } }), /CORS/);
    assert.equal(isP2000Loaded(), false);
    await loadP2000('30d', { fetcher: okFetcher(fixture()) });
    assert.equal(isP2000Loaded(), true);
  });
  it('times out and aborts', async () => {
    let signal = null;
    const hang = (url, opts) => { signal = opts.signal; return new Promise(() => {}); };
    await assert.rejects(loadP2000('30d', { fetcher: hang, timeoutMs: 20 }), /time-out/);
    assert.equal(signal?.aborted, true);
    assert.equal(isP2000Loaded(), false);
  });
});

describe('p2000: datasets, hash and scores', () => {
  it('six layers in their own Actueel category', () => {
    assert.deepEqual(P2000_KEYS, ['p2000Totaal', 'p2000Verkeer', 'p2000Brand', 'p2000Explosie', 'p2000Geweld', 'p2000Spoed']);
    assert.deepEqual(P2000_KEYS.map(k => DATASETS[k].label), ['Alle meldingen', 'Verkeersongevallen', 'Branden', 'Explosies', 'Geweld en diefstal', 'Spoedritten ambulance']);
    for (const k of P2000_KEYS) {
      assert.ok(LAYER_KEYS.includes(k));
      assert.equal(categoryOf(k), 'actueel');
      assert.equal(DATASETS[k].inOverall, false);
      assert.ok(isLiveDataset(k) && isP2000Key(k));
      assert.equal(DATASETS[k].scope, 'all');
    }
    assert.ok(LAYER_CATEGORIES.find(c => c.key === 'actueel').live);
    assert.deepEqual(Object.keys(P2000_GROUPS), ['totaal', 'verkeer', 'brand', 'explosie', 'geweld', 'spoed']);
  });
  it('the selected layer round-trips through the hash', () => {
    for (const k of P2000_KEYS) {
      const hash = serializeHash({ ...DEFAULT_STATE, dataset: k });
      assert.match(hash, new RegExp(`dataset=${k}`));
      assert.equal(parseHash(hash).dataset, k);
    }
  });
  it('wording: meldingen hulpdiensten, never criminaliteit', () => {
    const texts = [p2000LegendHtml('30d', ''), ...P2000_NOTES, ...P2000_KEYS.flatMap(k => [DATASETS[k].title, DATASETS[k].description, DATASETS[k].label])].join(' ');
    assert.doesNotMatch(texts, /criminaliteit(?!scijfer)/i);
    assert.match(p2000LegendHtml('30d', ''), /Meldingen hulpdiensten \(P2000\)/);
    assert.match(p2000LegendHtml('30d', ''), /deel van het politiewerk/);
    assert.match(p2000LegendHtml('30d', ''), /href="https:\/\/randstad\.hermes\.blockworlds\.nl\/"/);
    assert.match(p2000LegendHtml('7d', 'fout'), /data-p2000-window="7d" aria-pressed="true"/);
  });
  it('Totaalscore ignores the P2000 values', () => {
    const base = [
      { code: 'BU05990110', values: { population: 4000, avgIncome: 30, crimeRate: 50 } },
      { code: 'BU05990111', values: { population: 3000, avgIncome: 40, crimeRate: 20 } },
      { code: 'BU05990112', values: { population: 2000, avgIncome: 35, crimeRate: 80 } },
    ];
    const s = parseP2000Summary(fixture());
    const withP = structuredClone(base); addP2000Values(withP, s);
    const ds = DATASET_KEYS.map(k => DATASETS[k]);
    const overall = list => scoreAreas(list, ds).map(r => [r.overall, r.used, r.possible]);
    assert.deepEqual(overall(withP), overall(base));
  });
  it('Woonscore, presets and wizard themes never use a P2000 key', () => {
    const s = parseP2000Summary(fixture());
    const base = [
      { code: 'BU05990110', values: { population: 4000, avgIncome: 30, crimeRate: 50, highEdu: 30 } },
      { code: 'BU05990111', values: { population: 3000, avgIncome: 40, crimeRate: 20, highEdu: 50 } },
      { code: 'BU05990112', values: { population: 2000, avgIncome: 35, crimeRate: 80, highEdu: 20 } },
    ];
    const withP = structuredClone(base); addP2000Values(withP, s);
    assert.deepEqual(withWoonscore(withP).map(a => a.values.woonscore), withWoonscore(base).map(a => a.values.woonscore));
    for (const p of [STANDAARD, GELIJK]) {
      const keys = (p.themes ?? []).flatMap(t => (t.metrics ?? []).map(m => m.key));
      assert.ok(keys.length && !keys.some(isP2000Key));
    }
  });
  it('Vergelijken only shows a P2000 row when it is the active layer', () => {
    assert.ok(!compareKeys('woonscore').some(r => isP2000Key(r.key)));
    assert.deepEqual(compareKeys('p2000Brand').filter(r => isP2000Key(r.key)).map(r => r.key), ['p2000Brand']);
  });
});

describe('p2000: splash and privacy texts', () => {
  const html = readFileSync(file('index.html'), 'utf8');
  it('links the two sister projects in a new tab', () => {
    for (const url of ['https://flightroutes.hermes.blockworlds.nl/#/tour/tijdreis-rotterdam', 'https://flightroutes.hermes.blockworlds.nl/#/tours', 'https://randstad.hermes.blockworlds.nl/']) {
      const re = new RegExp(`<a [^>]*href="${url.replace(/[.?/#]/g, '\\$&')}"[^>]*>`);
      const tag = html.match(re)?.[0];
      assert.ok(tag, url);
      assert.match(tag, /target="_blank"/);
      assert.match(tag, /rel="noopener"/);
    }
    assert.match(html, /Meer van ons/);
    assert.match(html, /data-live-slot/);
  });
  it('the privacy text names Randstad as a contacted host', async () => {
    const legal = readFileSync(file('modules/legal.js'), 'utf8');
    assert.match(legal, /randstad\.hermes\.blockworlds\.nl\): de actuele meldingen hulpdiensten/);
  });
});

describe('p2000: area modal block', () => {
  it('lists counts with rates, or says there is no data', async () => {
    const { p2000Html } = await import('../modules/area-modal.js');
    const s = parseP2000Summary(fixture());
    const html = p2000Html(p2000Detail(p2000ValuesFor('BU05990110', 4000, s), s));
    assert.match(html, /<strong>12<\/strong> meldingen <small>\(3,0 per 1\.000 inw\.\)<\/small>/);
    assert.match(html, /spoedritten ambulance/);
    assert.match(p2000Html(p2000Detail(p2000ValuesFor('BU05990111', 50, s), s)), /Te weinig inwoners/);
    assert.match(p2000Html({ covered: false, days: 30 }), /Geen gegevens/);
    assert.equal(p2000Html(null), '');
  });
});
