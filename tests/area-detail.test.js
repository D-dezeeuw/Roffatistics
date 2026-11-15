import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { peerRank, rankPhrase, rankWords, isExtreme, median, formatDiff, overallRank, buildAreaDetail } from '../modules/area-detail.js';
import { areaModalHtml, areaLink } from '../modules/area-modal.js';
import { withWoonscore } from '../modules/presets.js';

describe('peerRank', () => {
  it('ranks high-first for good and neutral data, low-first for crime', () => {
    const vals = [10, 20, 30, 40];
    assert.equal(peerRank(vals, 40, true).rank, 1);
    assert.equal(peerRank(vals, 40, null).rank, 1);
    assert.equal(peerRank(vals, 10, false).rank, 1);
    assert.equal(peerRank(vals, 40, false).rank, 4);
    const r = peerRank(vals, 30, true);
    assert.deepEqual([r.of, r.fromHigh, r.fromLow], [4, 2, 3]);
    assert.ok(Math.abs(r.pct - 200 / 3) < 1e-9);
    assert.ok(Math.abs(peerRank(vals, 30, false).score - 100 / 3) < 1e-9);
  });
  it('shares a place on ties (competition ranking) and skips nulls', () => {
    const vals = [5, null, 7, 7, undefined, 9, 'x'];
    const r = peerRank(vals, 7, true);
    assert.equal(r.of, 4, 'nulls and non-numbers are no peers');
    assert.equal(r.fromHigh, 2);
    assert.equal(r.fromLow, 2);
    assert.equal(peerRank(vals, 5, true).fromHigh, 4);
    assert.equal(r.pct, 50);
  });
  it('returns null without a value and 50 for a lone peer', () => {
    assert.equal(peerRank([1, 2], null, true), null);
    assert.equal(peerRank([], 3, true).pct, 50);
    assert.equal(peerRank([], 3, true).of, 1);
  });
});

describe('rankPhrase', () => {
  const r = (fromHigh, fromLow, of) => ({ fromHigh, fromLow, of });
  it('words crime from the safe end', () => {
    assert.equal(rankPhrase('crimeRate', r(76, 1, 76), { level: 'buurt' }).text, '#1 veiligste buurt (van 76)');
    assert.equal(rankPhrase('crimeRate', r(2, 20, 21), { level: 'wijk' }).text, '#2 minst veilige wijk (van 21)');
  });
  it('counts from the nearer end of the range', () => {
    assert.equal(rankPhrase('wozValue', r(25, 65, 89)).text, '#25 hoogste WOZ-waarde (van 89)');
    assert.equal(rankPhrase('wozValue', r(80, 10, 89)).text, '#10 laagste WOZ-waarde (van 89)');
    assert.equal(rankPhrase('nonWesternPct', r(3, 87, 89)).text, '#3 meeste inwoners met herkomst buiten Europa (van 89)');
  });
  it('a middle tie speaks from the good end, neutral from the high end', () => {
    assert.equal(rankPhrase('crimeBike', r(3, 3, 5)).side, 'low');
    assert.equal(rankPhrase('avgIncome', r(3, 3, 5)).side, 'high');
    assert.equal(rankPhrase('population', r(3, 3, 5)).side, 'high');
  });
  it('follows the crime mode', () => {
    assert.equal(rankWords('crimeRate', 'low', { mode: 'abs' }), 'minste misdrijven');
    assert.equal(rankWords('crimeBurglary', 'high', { mode: 'rate' }), 'meeste woninginbraak per inwoner');
    assert.equal(rankWords('crimeBurglary', 'high', { mode: 'abs' }), 'meeste woninginbraak');
    assert.equal(rankWords('density', 'high', { level: 'wijk' }), 'dichtstbevolkte wijk');
  });
  it('is null without a rank', () => assert.equal(rankPhrase('wozValue', null), null));
});

describe('helpers', () => {
  it('flags the top and bottom 10 % from five peers on', () => {
    assert.ok(isExtreme(1, 5));
    assert.ok(!isExtreme(2, 5));
    assert.ok(isExtreme(9, 89));
    assert.ok(!isExtreme(10, 89));
    assert.ok(!isExtreme(1, 4), 'too few peers');
  });
  it('median and difference', () => {
    assert.equal(median([3, null, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
    assert.equal(median([null]), null);
    assert.deepEqual(formatDiff(45.3, 40, '%'), { delta: 5.3, text: '+5,3 pp' });
    assert.deepEqual(formatDiff(300, 400, '×€1.000'), { delta: -25, text: '−25%' });
    assert.deepEqual(formatDiff(2, 0, 'per 1.000'), { delta: 2, text: '+2' });
    assert.equal(formatDiff(null, 1, '%'), null);
  });
});

// Four buurten in two wijken; buurt D has no crime and no WOZ.
const mk = (code, name, parent, level, v) => ({ code, name, parent, level, values: v, years: {} });
const areas = {
  wijken: [
    mk('WK059901', 'Noord', 'GM0599', 'wijk', { population: 3000, crimeRate: 50, totalCrimes: 150, wozValue: 300 }),
    mk('WK059902', 'Zuid', 'GM0599', 'wijk', { population: 5000, crimeRate: 80, totalCrimes: 400, wozValue: 250 }),
  ],
  buurten: [
    mk('BU05990101', 'A', 'WK059901', 'buurt', { population: 1000, density: 5000, crimeRate: 10, totalCrimes: 10, wozValue: 400, crimeTrend: -5 }),
    mk('BU05990102', 'B', 'WK059901', 'buurt', { population: 2000, density: 8000, crimeRate: 40, totalCrimes: 80, wozValue: 300 }),
    mk('BU05990201', 'C', 'WK059902', 'buurt', { population: 4000, density: 9000, crimeRate: 90, totalCrimes: 360, wozValue: 200 }),
    mk('BU05990202', 'D', 'WK059902', 'buurt', { population: 1000, density: 3000, crimeRate: null, totalCrimes: null, wozValue: null }),
  ],
};

describe('buildAreaDetail', () => {
  const d = buildAreaDetail(areas.buurten[0], areas);
  const e = key => d.entries.find(x => x.key === key);
  it('ranks among the buurten with a value', () => {
    assert.equal(d.level, 'buurt');
    assert.equal(e('crimeRate').of, 3, 'D has no crime value');
    assert.equal(e('crimeRate').rank, 1);
    assert.equal(e('crimeRate').text, '#1 veiligste buurt (van 3)');
    assert.equal(e('wozValue').text, '#1 hoogste WOZ-waarde (van 3)');
    assert.equal(e('population').of, 4);
    assert.equal(e('crimeRate').median, 40);
    assert.equal(e('crimeRate').diff.text, '−75%');
    assert.equal(d.entries.some(x => x.key === 'avgIncome'), false, 'no value → no entry');
  });
  it('facts, parent, trend and overall', () => {
    assert.equal(d.parent.code, 'WK059901');
    assert.deepEqual(d.children, []);
    assert.equal(d.areaKm2, 0.2);
    assert.equal(d.crimeTrend, -5);
    assert.equal(d.overall.rank, 1);
    assert.equal(d.overall.of, 3, 'D has no judged value');
  });
  it('a wijk lists its buurten and ranks among wijken', () => {
    const w = buildAreaDetail(areas.wijken[1], areas);
    assert.deepEqual(w.children.map(b => b.code), ['BU05990201', 'BU05990202']);
    assert.equal(w.parent, null);
    assert.equal(w.entries.find(x => x.key === 'crimeRate').text, '#1 minst veilige wijk (van 2)');
  });
  it('uses counts in the Absoluut mode', () => {
    const a = buildAreaDetail(areas.buurten[2], areas, { mode: 'abs' });
    const c = a.entries.find(x => x.key === 'crimeRate');
    assert.equal(c.value, 360);
    assert.equal(c.unit, 'misdrijven');
    assert.equal(c.text, '#1 meeste misdrijven (van 3)');
  });
  it('sorts the notable extremes first', () => {
    const many = { wijken: [], buurten: Array.from({ length: 20 }, (_, i) => mk(`BU0599${String(i).padStart(4, '0')}`, `B${i}`, 'WK059900', 'buurt', { population: 1000 + i, wozValue: 100 + i * 10 })) };
    const top = buildAreaDetail(many.buurten[19], many);
    assert.deepEqual(top.notable.map(x => x.key), ['population', 'wozValue']);
    const mid = buildAreaDetail(many.buurten[10], many);
    assert.deepEqual(mid.notable, []);
  });
  it('overallRank is null for an unknown code', () => assert.equal(overallRank('BU0', areas.buurten), null));
});

describe('areaModalHtml', () => {
  it('renders header, actions, table and links', () => {
    const html = areaModalHtml(buildAreaDetail(areas.wijken[0], areas), { dataYears: '2025' });
    assert.match(html, /id="area-modal-title">Noord</);
    assert.match(html, /data-area-close/);
    for (const a of ['map', 'compare', 'copy']) assert.match(html, new RegExp(`data-area-action="${a}"`));
    assert.match(html, /Buurten in Noord \(2\)/);
    assert.match(html, /data-area-modal="BU05990101"/);
    assert.match(html, /veiligste wijk/);
    const b = areaModalHtml(buildAreaDetail(areas.buurten[1], areas));
    assert.match(b, /in wijk <button[^>]*data-area-modal="WK059901"/);
    assert.match(areaModalHtml(null), /Geen gegevens/);
  });
  it('builds the share link with &area=', () => {
    const url = areaLink('BU05990101', { scope: 'nederland', view: 'list', crime: 'rate' }, { origin: 'https://x.nl', pathname: '/r/' });
    assert.equal(url, 'https://x.nl/r/#scope=rotterdam&view=list&area=BU05990101');
  });
});

describe('Woonscore in the area detail', () => {
  const wv = (crimeRate, avgIncome, highEdu, population) => ({ crimeRate, avgIncome, highEdu, population, distGP: 1, distSupermarket: 1 });
  const wijken = withWoonscore([
    { code: 'WK1', name: 'Noord', level: 'wijk', values: wv(10, 40, 50, 9000) },
    { code: 'WK2', name: 'Zuid', level: 'wijk', values: wv(60, 25, 20, 9000) },
  ]);
  const raw = [
    { code: 'BU1', name: 'Klein', level: 'buurt', parent: 'WK1', values: wv(90, 41, 52, 120) },
    { code: 'BU2', name: 'Groot', level: 'buurt', parent: 'WK2', values: wv(55, 24, 18, 3000) },
    { code: 'BU3', name: 'Rustig', level: 'buurt', parent: 'WK1', values: wv(12, 39, 49, 3000) },
  ];
  const buurten = withWoonscore(raw, { parents: wijken });
  const areas = { wijken, buurten };

  it('score, rank among peers and plus/minus factors; no table row for the score itself', () => {
    const d = buildAreaDetail(wijken[0], areas);
    assert.equal(d.woonscore.rank, 1);
    assert.equal(d.woonscore.of, 2);
    assert.ok(d.woonscore.score > 50);
    assert.ok(d.woonscore.plus.length > 0);
    assert.ok(!d.entries.some(e => e.key === 'woonscore'));
    const html = areaModalHtml(d);
    assert.match(html, /Woonscore · <strong>#1<\/strong> van 2 wijken/);
    assert.match(html, /Sterk:/);
    assert.doesNotMatch(html, /weinig inwoners/);
  });
  it('a tiny buurt gets the "weinig inwoners" badge', () => {
    const d = buildAreaDetail(buurten[0], areas);
    assert.equal(d.woonscore.shrunk, true);
    assert.match(areaModalHtml(d), /weinig inwoners/);
  });
  it('no Woonscore block without a score', () => {
    const d = buildAreaDetail(raw[0], { wijken, buurten: raw });
    assert.equal(d.woonscore, null);
    assert.doesNotMatch(areaModalHtml(d), /area-woonscore/);
  });
});
