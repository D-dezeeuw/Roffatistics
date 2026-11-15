import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, prep, damerau, scoreName, createSearcher, toRanges, TIER } from '../modules/fuzzy.js';

const INDEX = [
  { code: 'PV27', name: 'Noord-Holland',   level: 'provincie', scope: 'nederland' },
  { code: 'PV28', name: 'Zuid-Holland',    level: 'provincie', scope: 'nederland' },
  { code: 'PV26', name: 'Utrecht',         level: 'provincie', scope: 'nederland' },
  { code: 'PV21', name: 'Fryslân',         level: 'provincie', scope: 'nederland' },
  { code: 'GM0344', name: 'Utrecht',       level: 'gemeente', scope: 'nederland' },
  { code: 'GM0599', name: 'Rotterdam',     level: 'gemeente', scope: 'nederland' },
  { code: 'GM0518', name: "'s-Gravenhage", level: 'gemeente', scope: 'nederland' },
  { code: 'GM0503', name: 'Delft',         level: 'gemeente', scope: 'nederland' },
  { code: 'GM0606', name: 'Schiedam',      level: 'gemeente', scope: 'nederland' },
  { code: 'GM1621', name: 'Lansingerland', level: 'gemeente', scope: 'nederland' },
  { code: 'GM0307', name: 'Amersfoort',    level: 'gemeente', scope: 'nederland' },
  { code: 'WK059903', name: 'Delfshaven',          level: 'wijk', scope: 'rotterdam' },
  { code: 'WK059910', name: 'Kralingen-Crooswijk', level: 'wijk', scope: 'rotterdam' },
  { code: 'WK059915', name: 'Feijenoord',          level: 'wijk', scope: 'rotterdam' },
  { code: 'WK059901', name: 'Rotterdam Centrum',   level: 'wijk', scope: 'rotterdam' },
  { code: 'BU05991031', name: 'Kralingen West',    level: 'buurt', scope: 'rotterdam', parent: 'WK059910' },
  { code: 'BU05991032', name: 'Kralingen Oost',    level: 'buurt', scope: 'rotterdam', parent: 'WK059910' },
  { code: 'BU05991501', name: 'Feijenoord',        level: 'buurt', scope: 'rotterdam', parent: 'WK059915' },
  { code: 'BU05990310', name: 'Oud Delfshaven',    level: 'buurt', scope: 'rotterdam', parent: 'WK059903' },
  { code: 'BU05990311', name: 'Bospolder',         level: 'buurt', scope: 'rotterdam', parent: 'WK059903' },
  { code: 'BU05990120', name: "Cool",              level: 'buurt', scope: 'rotterdam', parent: 'WK059901' },
];
const search = createSearcher(INDEX);
const codes = (q, opts) => search(q, opts).map(r => r.item.code);

describe('normalize / prep', () => {
  it('folds case, diacritics and punctuation', () => {
    assert.equal(normalize("'s-Gravenhage"), 'sgravenhage');
    assert.equal(normalize('Fryslân'), 'fryslan');
    assert.equal(normalize('Súdwest-Fryslân'), 'sudwestfryslan');
    assert.equal(normalize('  Zuid  Holland '), 'zuidholland');
    assert.equal(normalize('ĲSSELSTEIN'), 'ijsselstein');
  });
  it('keeps token starts and maps back to the original text', () => {
    const p = prep('Kralingen-Crooswijk');
    assert.deepEqual(p.tokens.map(t => t.text), ['kralingen', 'crooswijk']);
    assert.equal(p.tokens[1].start, 9);
    assert.equal(p.map[9], 10);   // 'C' after the hyphen
  });
  it('handles empty input', () => {
    assert.equal(normalize(null), '');
    assert.deepEqual(search('   '), []);
    assert.deepEqual(search('-'), []);
  });
});

describe('damerau', () => {
  it('counts insert, delete, substitute and transposition as one', () => {
    assert.equal(damerau('kralingen', 'kralingen'), 0);
    assert.equal(damerau('krlingen', 'kralingen'), 1);
    assert.equal(damerau('kralinngen', 'kralingen'), 1);
    assert.equal(damerau('kralimgen', 'kralingen'), 1);
    assert.equal(damerau('karlingen', 'kralingen'), 1);
  });
  it('caps at max + 1', () => {
    assert.equal(damerau('krlngen', 'kralingen'), 2);
    assert.equal(damerau('abc', 'xyzxyz'), 2);
  });
});

describe('scoreName tiers', () => {
  it('ranks exact > prefix > word-start > substring > typo > subsequence', () => {
    const exact = scoreName('delft', 'Delft').score;
    const prefix = scoreName('delf', 'Delfshaven').score;
    const word = scoreName('delf', 'Oud Delfshaven').score;
    const sub = scoreName('haven', 'Delfshaven').score;
    const typo = scoreName('delfshavn', 'Delfshaven').score;
    const subseq = scoreName('dfsh', 'Delfshaven').score;
    assert.equal(exact, TIER.exact);
    assert.ok(exact > prefix && prefix > word && word > sub && sub > typo && typo > subseq,
      JSON.stringify({ exact, prefix, word, sub, typo, subseq }));
  });
  it('allows no typo below 4 characters', () => {
    assert.equal(scoreName('dlf', 'Cool'), null);
    assert.equal(scoreName('col', 'Cool').score > TIER.subsequence - 1, true); // subsequence, not typo
    assert.equal(scoreName('xool', 'Cool').score, TIER.typo);
  });
  it('two typos are no typo match (only a weak subsequence, or nothing)', () => {
    assert.ok(scoreName('krlngen', 'Kralingen West').score < TIER.typoPrefix);
    assert.equal(scoreName('kralnigenn', 'Kralingen West'), null);
  });
  it('returns highlight ranges in the original text', () => {
    assert.deepEqual(scoreName('crooswijk', 'Kralingen-Crooswijk').ranges, [[10, 19]]);
    assert.deepEqual(scoreName('zuid-holland', 'Zuid-Holland').ranges, [[0, 4], [5, 12]]);
    assert.deepEqual(scoreName('fryslan', 'Fryslân').ranges, [[0, 7]]);
  });
});

describe('createSearcher', () => {
  it('"kralingen" finds the wijk and its buurten, wijk first', () => {
    const r = codes('kralingen');
    assert.equal(r[0], 'WK059910');
    assert.ok(r.includes('BU05991031') && r.includes('BU05991032'));
  });
  it('"Krlingen" (one typo) still finds Kralingen', () => {
    const r = search('Krlingen');
    assert.ok(r.length >= 3);
    assert.ok(r.slice(0, 3).every(x => x.item.name.startsWith('Kralingen')));
    assert.ok(r[0].ranges.length > 0);
  });
  it('"feijenoord": wijk before buurt in Rotterdam scope', () => {
    assert.deepEqual(codes('feijenoord').slice(0, 2), ['WK059915', 'BU05991501']);
  });
  it('"delfshaven" ranks the exact wijk above "Oud Delfshaven"', () => {
    assert.deepEqual(codes('delfshaven').slice(0, 2), ['WK059903', 'BU05990310']);
  });
  it('"utrecht" finds gemeente and provincie; tie order follows the scope', () => {
    assert.deepEqual(codes('utrecht', { scope: 'nederland' }), ['GM0344', 'PV26']);
    assert.deepEqual(codes('utrecht', { scope: 'rotterdam' }), ['GM0344', 'PV26']);
  });
  it('"zuid-holland", "zuid holland", "zuidholland" and "Zuid-Holand" all find the province', () => {
    for (const q of ['zuid-holland', 'zuid holland', 'zuidholland', 'ZUID HOLLAND', 'Zuid-Holand']) {
      assert.equal(codes(q)[0], 'PV28', q);
    }
  });
  it('"holland" matches both provinces on a word start', () => {
    assert.deepEqual(codes('holland').sort(), ['PV27', 'PV28']);
  });
  it('"s-gravenhage" and the alias "Den Haag" find GM0518', () => {
    assert.equal(codes('s-gravenhage')[0], 'GM0518');
    assert.equal(codes("'s Gravenhage")[0], 'GM0518');
    const haag = search('den haag');
    assert.equal(haag[0].item.code, 'GM0518');
    assert.equal(haag[0].alias, 'Den Haag');
    assert.deepEqual(haag[0].ranges, [[0, 3], [4, 8]]);
    assert.equal(codes('friesland')[0], 'PV21');
  });
  it('Rotterdam areas win ties in Rotterdam scope, Nederland areas in Nederland scope', () => {
    const tied = createSearcher([
      { code: 'GM9999', name: 'Testdorp', level: 'gemeente', scope: 'nederland' },
      { code: 'WK999901', name: 'Testdorp', level: 'wijk', scope: 'rotterdam' },
    ]);
    assert.equal(tied('testdorp', { scope: 'rotterdam' })[0].item.code, 'WK999901');
    assert.equal(tied('testdorp', { scope: 'nederland' })[0].item.code, 'GM9999');
  });
  it('a better score beats the scope tie-break', () => {
    assert.equal(codes('rotterdam', { scope: 'rotterdam' })[0], 'GM0599');
  });
  it('caps the result count', () => {
    const many = createSearcher(Array.from({ length: 40 }, (_, i) => ({ code: `GM${1000 + i}`, name: `Plaats ${i}`, level: 'gemeente', scope: 'nederland' })));
    assert.equal(many('plaats').length, 12);
    assert.equal(many('plaats', { limit: 5 }).length, 5);
  });
  it('finds nothing for unrelated input', () => {
    assert.deepEqual(search('xyzzy'), []);
  });
});

describe('toRanges', () => {
  it('merges adjacent original indices', () => {
    const p = prep('Ab-cd');
    assert.deepEqual(toRanges(p, [0, 1, 2, 3]), [[0, 2], [3, 5]]);
  });
});
