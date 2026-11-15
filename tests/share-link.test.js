// "Delen" (v0.31.0): buildShareHash / parseShareHash, modules/share-link.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShareHash, buildShareUrl, parseShareHash, defaultShareOptions, availableParts, hasShareExtras,
  SHARE_GROUPS, SHARE_KEYS, SENSITIVE_KEYS, partSummary,
} from '../modules/share-link.js';
import { parseHash } from '../modules/state.js';
import { encodeAnswers, decodeAnswers } from '../modules/wizard-model.js';

const answers = {
  levensfase: 'gezin', bouw: 'karakter', budget: { mode: 'koop', income: 60, maxPrice: 450, hide: false },
  vervoer: ['fiets'], sfeer: 40, veiligheid: ['inbraak'], weights: {}, importance: { veiligheid: 4 },
  situatie: { edu: 'hoog', income: 'm2500' }, gemeenschap: { detail: 'nederland', pct: 10 },
};
const score = encodeAnswers(answers);
const snap = {
  state: { scope: 'rotterdam', view: 'list', dataset: 'crimeRate', crime: 'abs', area: 'WK059901', score },
  map: { lat: 51.922501234, lng: 4.479171234, zoom: 12.5 },
  modal: true,
  list: { level: 'buurten', rankKey: 'woonscore', sort: { column: 'rank', dir: 'desc' } },
  basemap: 'light',
  theme: 'klassiek',
};
const all = Object.fromEntries(SHARE_KEYS.map(k => [k, true]));
const none = Object.fromEntries(SHARE_KEYS.map(k => [k, false]));
const params = h => Object.fromEntries(new URLSearchParams(h.replace(/^#/, '')));

describe('share-link: defaults', () => {
  it('ticks every Weergave part and Jouw wensen, never a sensitive part', () => {
    const d = defaultShareOptions(snap);
    for (const k of ['view', 'scope', 'dataset', 'map', 'area', 'list', 'basemap', 'theme', 'answers']) assert.equal(d[k], true, k);
    for (const k of SENSITIVE_KEYS) assert.equal(d[k], false, k);
    assert.deepEqual(availableParts(snap), { ...all });
  });
  it('the default link carries the answers without herkomst, opleiding or inkomen', () => {
    const p = params(buildShareHash(snap, defaultShareOptions(snap)));
    const a = decodeAnswers(p.score);
    assert.equal(a.gemeenschap, null);
    assert.equal(a.situatie, null);
    assert.equal(a.levensfase, 'gezin');
    assert.equal(a.bouw, 'karakter');
    assert.deepEqual(a.vervoer, ['fiets']);
  });
  it('no wizard result: Jouw wensen and the sensitive parts are off and unavailable', () => {
    const s = { ...snap, state: { ...snap.state, score: null } };
    const d = defaultShareOptions(s), av = availableParts(s);
    assert.equal(d.answers, false);
    assert.equal(av.origin || av.education || av.income, false);
    assert.equal(partSummary(s, 'answers'), 'nog niet ingevuld');
  });
  it('groups: Weergave, Jouw wensen, Gevoelig (sensitive labelled)', () => {
    assert.deepEqual(SHARE_GROUPS.map(g => g.label), ['Weergave', 'Jouw wensen', 'Gevoelig']);
    assert.ok(SHARE_GROUPS[2].parts.every(p => /\(gevoelig\)$/.test(p.label)));
  });
});

describe('share-link: each checkbox toggles exactly its part', () => {
  const expect = {
    view: ['view'], scope: ['scope'], dataset: ['dataset', 'crime'], area: ['area', 'modal'], map: ['map'],
    list: ['lvl', 'rank', 'sort'], basemap: ['basemap'], theme: ['theme'], answers: ['score'],
  };
  for (const [key, keys] of Object.entries(expect)) {
    it(`${key} → ${keys.join(', ')}`, () => {
      assert.deepEqual(Object.keys(params(buildShareHash(snap, { ...none, [key]: true }))).sort(), [...keys].sort());
      const without = params(buildShareHash(snap, { ...all, [key]: false }));
      for (const k of keys) assert.ok(!(k in without), `${k} still in the link without ${key}`);
    });
  }
  it('sensitive ticks only add their own part to the score, and only with Jouw wensen', () => {
    const base = { ...none, answers: true };
    assert.equal(decodeAnswers(params(buildShareHash(snap, { ...base, origin: true })).score).gemeenschap?.detail, 'nederland');
    const edu = decodeAnswers(params(buildShareHash(snap, { ...base, education: true })).score);
    assert.deepEqual([edu.situatie?.edu, edu.situatie?.income ?? null, edu.gemeenschap], ['hoog', null, null]);
    const inc = decodeAnswers(params(buildShareHash(snap, { ...base, income: true })).score);
    assert.deepEqual([inc.situatie?.edu ?? null, inc.situatie?.income], [null, 'm2500']);
    assert.equal(buildShareHash(snap, { ...none, origin: true, education: true, income: true }), '');
  });
  it('nothing ticked → no hash; the url is the page without one', () => {
    assert.equal(buildShareHash(snap, none), '');
    assert.equal(buildShareUrl(snap, none, 'https://x.test/a/?q#old'), 'https://x.test/a/?q');
  });
  it('the modal flag only rides along with a selected area', () => {
    const s = { ...snap, state: { ...snap.state, area: null } };
    assert.deepEqual(params(buildShareHash(s, { ...none, area: true })), {});
  });
});

describe('share-link: round trip', () => {
  it('decodes every included part back', () => {
    const url = buildShareUrl(snap, { ...all }, 'https://x.test/r#scope=nederland');
    assert.match(url, /^https:\/\/x\.test\/r#scope=rotterdam&view=list/);
    const back = parseShareHash(url.slice(url.indexOf('#')));
    assert.deepEqual(back.state, { scope: 'rotterdam', view: 'list', dataset: 'crimeRate', crime: 'abs', area: 'WK059901', score });
    assert.deepEqual(back.map, { lat: 51.9225, lng: 4.47917, zoom: 12.5 });
    assert.equal(back.modal, true);
    assert.deepEqual(back.list, snap.list);
    assert.equal(back.basemap, 'light');
    assert.equal(back.theme, 'klassiek');
    assert.equal(hasShareExtras(back), true);
  });
  it('an excluded part stays absent, so it opens at its default', () => {
    const back = parseShareHash(buildShareHash(snap, { ...none, area: true }));
    assert.deepEqual(back.state, { area: 'WK059901' });
    assert.equal(back.map, null);
    assert.equal(back.list, null);
  });
  it('old hashes decode exactly as parseHash did, without view keys', () => {
    for (const h of ['', '#scope=rotterdam&view=map&area=WK059901', '#scope=nederland&view=dashboard&area=GM0599',
      '#dataset=jouwscore&score=lg.s40', '#scope=rotterdam&view=map&crime=abs']) {
      const back = parseShareHash(h);
      assert.deepEqual(back.state, parseHash(h), h);
      assert.equal(hasShareExtras(back), false, h);
    }
  });
  it('drops unreadable view keys', () => {
    const back = parseShareHash('#map=999,4,12&modal=1&lvl=straten&rank=nope&sort=x.up&basemap=evil&theme=neon');
    assert.deepEqual([back.map, back.modal, back.list, back.basemap, back.theme], [null, false, null, null, null]);
    assert.equal(parseShareHash('#map=51.9,4.4,25').map, null);
  });
});
