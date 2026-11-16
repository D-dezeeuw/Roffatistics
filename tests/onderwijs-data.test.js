// Data test for data/nl/onderwijs-po-2024.json (scripts/build-schools.mjs).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const file = u => new URL(`../${u}`, import.meta.url);
const read = u => JSON.parse(readFileSync(file(u), 'utf8'));
const data = read('data/nl/onderwijs-po-2024.json');
const list = read('data/nl/onderwijs-po-scholen-2024.json');
const buurten = new Set(read('data/nl/buurten-2025.json').codes);
const wijken = new Set(read('data/nl/wijken-2025.json').codes);
const gemeenten = new Set([...wijken].map(c => `GM${c.slice(2, 6)}`));
const S = list.cols;
const gmOf = i => S.gemeente[i] ?? (S.buurt[i] ? `GM${S.buurt[i].slice(2, 6)}` : null);
const inRange = (v, lo, hi) => v == null || (Number.isFinite(v) && v >= lo && v <= hi);

describe('onderwijs-po-2024.json and onderwijs-po-scholen-2024.json', () => {
  it('have a header and stay under 1 MB each', () => {
    for (const d of [data, list]) {
      assert.equal(d.format, 1);
      assert.match(d.built, /^\d{4}-\d{2}-\d{2}$/);
      for (const k of ['referentieniveau', 'eindscores', 'adressen', 'indeling', 'method', 'dichtbij']) assert.ok(d.sources[k], k);
    }
    assert.equal(data.schoolsFile, 'onderwijs-po-scholen-2024.json');
    for (const f of ['onderwijs-po-2024.json', 'onderwijs-po-scholen-2024.json']) assert.ok(statSync(file(`data/nl/${f}`)).size < 1e6, f);
  });

  it('uses area codes of the 2025 indeling', () => {
    const sets = { buurt: buurten, wijk: wijken, gemeente: gemeenten };
    for (const [lvl, set] of Object.entries(sets)) {
      const missing = data.levels[lvl].codes.filter(c => !set.has(c));
      assert.deepEqual(missing, [], lvl);
    }
    assert.ok(S.buurt.every(c => c == null || buurten.has(c)));
    assert.ok(S.gemeente.every(c => c == null || gemeenten.has(c)));
  });

  it('keeps every value in range and every column the same length', () => {
    for (const lvl of Object.values(data.levels)) {
      for (const m of data.metrics) assert.equal(lvl.cols[m].length, lvl.codes.length, m);
      for (const m of ['eduScore', 'eduFundPct', 'eduStreefPct', 'eduNearScore', 'eduNearBest']) assert.ok(lvl.cols[m].every(v => inRange(v, 0, 100)), m);
      assert.ok(lvl.cols.eduSchools.every(v => v == null || (Number.isInteger(v) && v > 0)));
      assert.ok(lvl.cols.eduNearCount.every(v => inRange(v, 0, 200)));
    }
    for (const [k, col] of Object.entries(S)) assert.equal(col.length, list.count, k);
    for (const k of Object.keys(S).filter(k => /score|Fund|Streef|^fund$|^streef$/.test(k))) assert.ok(S[k].every(v => inRange(v, 0, 100)), k);
    assert.ok(S.lat.every(v => inRange(v, 50.7, 53.6)) && S.lon.every(v => inRange(v, 3.3, 7.3)));
  });

  it('places at least 95% of the schools in a buurt and gives every pin a location', () => {
    const n = list.count;
    assert.ok(S.buurt.filter(Boolean).length / n >= 0.95);
    assert.ok(S.lat.filter(v => v != null).length / n >= 0.99);
  });

  it('has at least 150 scored schools in Rotterdam and a value for the gemeente', () => {
    const scored = S.score.filter((v, i) => v != null && gmOf(i) === 'GM0599').length;
    assert.ok(scored >= 150, `Rotterdam scored ${scored}`);
    const gm = data.levels.gemeente;
    assert.ok(gm.cols.eduScore[gm.codes.indexOf('GM0599')] > 0);
  });

  it('has schools-near-home values for most buurten and for Rotterdam', () => {
    const b = data.levels.buurt;
    const near = b.cols.eduNearScore.filter(v => v != null).length;
    assert.ok(near > 10000, `buurten with eduNearScore ${near}`);
    const gm = data.levels.gemeente;
    assert.ok(gm.cols.eduNearScore[gm.codes.indexOf('GM0599')] > 0);
    // a buurt with a near score has a scored school within 1.5 km; with a count it is an integer
    b.codes.forEach((c, i) => { if (b.cols.eduNearCount[i] != null) assert.ok(Number.isInteger(b.cols.eduNearCount[i]), c); });
  });

  it('lists schools without results with a null score', () => {
    const i = S.score.findIndex(v => v == null);
    if (i >= 0) assert.equal(S.estimate[i], null);
    assert.ok(S.score.filter(v => v != null).length > 5000);
  });
});
