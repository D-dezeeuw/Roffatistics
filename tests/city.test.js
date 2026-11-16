// City config and resolution (docs/plan-mokumistics.md, step 1): one app, a
// city per domain. Pure resolution, the early boot script in index.html in
// step with config/cities.json, and no Rotterdam constant left in the code.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import {
  CITIES, CITY, CITY_SLUGS, DEFAULT_CITY, resolveCitySlug, currentCitySlug, cityBySlug, cityCodes, isCityAreaCode,
  centrumCoords, cityNeighbours, cityTitle, applyCityToDocument, cityAdjective,
} from '../modules/city.js';
import { cityDatasetGroups, DATASET_GROUPS } from '../modules/datasets.js';

const root = new URL('../', import.meta.url);
const read = f => readFile(new URL(f, root), 'utf8');
const html = await read('index.html');
const json = JSON.parse(await read('config/cities.json'));

describe('config/cities.json', () => {
  it('has the default city and complete entries', () => {
    assert.equal(json.default, 'rotterdam');
    assert.ok(CITIES[DEFAULT_CITY]);
    const hosts = new Set();
    for (const [slug, c] of Object.entries(CITIES)) {
      assert.equal(c.slug, slug);
      assert.match(c.gemeente, /^GM\d{4}$/, slug);
      for (const k of ['name', 'adjective', 'nickname', 'appName', 'theme', 'palette', 'canonical']) assert.ok(c[k], `${slug}.${k}`);
      assert.ok(c.centre.length === 2 && c.centrum.point.length === 2 && c.centrum.name, `${slug} centre/centrum`);
      for (const k of ['gemeente', 'wijken', 'buurten']) assert.match(c.geo[k], /^\.\/data\/.+\.geojson$/, `${slug}.geo.${k}`);
      for (const k of ['bus', 'afstand']) assert.match(c.ov[k], /^\.\/data\/ov\/.+\.json$/, `${slug}.ov.${k}`);
      assert.equal(c.ov.busBbox.length, 4);
      assert.equal(typeof c.p2000, 'boolean');
      for (const h of c.hosts) { assert.ok(!hosts.has(h), `host ${h} once`); hosts.add(h); }
    }
  });
  it('Rotterdam keeps its constants; Amsterdam is GM0363 with placeholder brand fields', () => {
    const r = CITIES.rotterdam, a = CITIES.amsterdam;
    assert.deepEqual([r.gemeente, r.name, r.adjective, r.appName, r.theme], ['GM0599', 'Rotterdam', 'Rotterdamse', 'Roffatistics', 'rotterdam']);
    assert.deepEqual(r.centre, [51.9225, 4.4792]);
    assert.deepEqual(r.centrum.point, [51.9244, 4.4690]);
    assert.deepEqual([a.gemeente, a.name, a.adjective, a.nickname, a.appName, a.theme, a.p2000], ['GM0363', 'Amsterdam', 'Amsterdamse', 'Mokum', 'Mokumistics', 'mokum', false]);
    assert.ok(a.hosts.includes('mokumistics.hermes.blockworlds.nl'));
  });
});

describe('city resolution', () => {
  it('?city= → hostname → rotterdam', () => {
    assert.equal(resolveCitySlug({}), 'rotterdam');
    assert.equal(resolveCitySlug({ search: '?city=amsterdam' }), 'amsterdam');
    assert.equal(resolveCitySlug({ search: '?city=AMSTERDAM' }), 'amsterdam');
    assert.equal(resolveCitySlug({ hostname: 'mokumistics.hermes.blockworlds.nl' }), 'amsterdam');
    assert.equal(resolveCitySlug({ hostname: 'MOKUMISTICS.hermes.blockworlds.nl' }), 'amsterdam');
    assert.equal(resolveCitySlug({ search: '?city=rotterdam', hostname: 'mokumistics.hermes.blockworlds.nl' }), 'rotterdam', 'the query wins');
    assert.equal(resolveCitySlug({ search: '?city=utrecht', hostname: 'mokumistics.hermes.blockworlds.nl' }), 'amsterdam', 'unknown slug: host');
    assert.equal(resolveCitySlug({ search: '?city=constructor' }), 'rotterdam');
    assert.equal(resolveCitySlug({ hostname: 'roffatistics.hermes.blockworlds.nl' }), 'rotterdam');
    assert.equal(resolveCitySlug({ hostname: 'localhost' }), 'rotterdam');
  });
  it('the page city: <html data-city> first, else the location; Node has no location → rotterdam', () => {
    assert.equal(CITY.slug, 'rotterdam');
    assert.equal(currentCitySlug({ document: { documentElement: { dataset: { city: 'amsterdam' } } } }), 'amsterdam');
    assert.equal(currentCitySlug({ document: { documentElement: { dataset: { city: 'x' } } }, location: { search: '', hostname: 'mokumistics.hermes.blockworlds.nl' } }), 'amsterdam');
    assert.equal(cityBySlug('nope').slug, 'rotterdam');
  });
  it('the early boot script in index.html makes the same choice', () => {
    const script = html.match(/<script>(try\{var s=\[[^<]*)<\/script>/)?.[1];
    assert.ok(script, 'city boot script in <head>');
    const slugs = JSON.parse(script.match(/var s=(\[[^\]]*\])/)[1]);
    const hosts = JSON.parse(script.match(/h=(\{[^}]*\})/)[1]);
    assert.deepEqual(slugs, CITY_SLUGS);
    assert.deepEqual(hosts, Object.fromEntries(Object.values(CITIES).flatMap(c => c.hosts.map(h => [h, c.slug]))));
    const cases = [['', 'localhost'], ['?city=amsterdam', 'localhost'], ['', 'mokumistics.hermes.blockworlds.nl'], ['?city=Rotterdam', 'mokumistics.hermes.blockworlds.nl'], ['?city=foo', 'roffatistics.hermes.blockworlds.nl'], ['?city=constructor', 'constructor']];
    for (const [search, hostname] of cases) {
      const documentElement = { dataset: {} };
      vm.runInNewContext(script, { location: { search, hostname }, document: { documentElement }, URLSearchParams });
      assert.equal(documentElement.dataset.city, resolveCitySlug({ search, hostname }), `${search} ${hostname}`);
    }
    assert.match(html, /<html lang="nl" data-theme="rotterdam" data-city="rotterdam">/);
  });
});

describe('city helpers', () => {
  it('codes, area codes, centrum, neighbours, adjective', () => {
    assert.deepEqual({ ...cityCodes(CITIES.rotterdam) }, { gemeente: 'GM0599', wijkPrefix: 'WK0599', buurtPrefix: 'BU0599' });
    assert.deepEqual({ ...cityCodes(CITIES.amsterdam) }, { gemeente: 'GM0363', wijkPrefix: 'WK0363', buurtPrefix: 'BU0363' });
    assert.ok(isCityAreaCode('WK059901') && isCityAreaCode('BU05990110') && !isCityAreaCode('GM0599') && !isCityAreaCode('WK036301'));
    assert.ok(isCityAreaCode('WK0363AA', CITIES.amsterdam) && isCityAreaCode('BU0363AA01', CITIES.amsterdam) && !isCityAreaCode('WK059901', CITIES.amsterdam));
    assert.equal(centrumCoords(), '51,9244 N, 4,4690 O');
    assert.equal(cityNeighbours(), 'Schiedam, Capelle, Barendrecht');
    assert.equal(cityNeighbours('of'), 'Schiedam, Capelle of Barendrecht');
    assert.equal(cityAdjective(), 'Rotterdamse');
    assert.equal(cityAdjective(CITIES.amsterdam), 'Amsterdamse');
  });
  it('the Rotterdam title is the static one; another city rewrites the head', () => {
    assert.ok(html.includes(`<title>${cityTitle()}</title>`));
    const el = () => ({ attrs: {}, textContent: 'Rotterdam', setAttribute(k, v) { this.attrs[k] = v; } });
    const nodes = { meta: [el(), el()], url: [el()], canon: [el()], option: [el()] };
    const doc = {
      title: 'static', documentElement: { dataset: {} },
      querySelectorAll: sel => (sel.includes('og:title') ? nodes.meta : sel.includes('og:url') ? nodes.url : sel.includes('canonical') ? nodes.canon : sel.includes('scope-select') ? nodes.option : []),
    };
    applyCityToDocument(doc, CITIES.rotterdam);
    assert.equal(doc.title, 'static', 'Rotterdam: index.html as it is');
    assert.equal(doc.documentElement.dataset.city, 'rotterdam');
    applyCityToDocument(doc, CITIES.amsterdam);
    assert.equal(doc.title, 'Mokumistics — Amsterdam en Nederland in cijfers');
    assert.equal(nodes.meta[1].attrs.content, doc.title);
    assert.equal(nodes.canon[0].attrs.href, 'https://mokumistics.hermes.blockworlds.nl/');
    assert.equal(nodes.option[0].textContent, 'Amsterdam');
    assert.equal(doc.documentElement.dataset.city, 'amsterdam');
  });
  it('a city without P2000 has no Actueel section', () => {
    assert.ok(DATASET_GROUPS.some(g => g.key === 'actueel'), 'Rotterdam keeps it');
    assert.ok(!cityDatasetGroups(CITIES.amsterdam).some(g => g.key === 'actueel'));
    assert.equal(cityDatasetGroups(CITIES.amsterdam).length, DATASET_GROUPS.length - 1);
  });
});

// ── No Rotterdam constant in the code ────────────────────────────────────────
// Comments may name Rotterdam (it is the default city). Lower-case 'rotterdam'
// is an id (scope, theme, palette, storage keys) and stays. Allowed in code:
const ALLOW = Object.freeze({
  'modules/theme.js':    ["label: 'Rotterdam'"],                       // the theme's name
  'modules/palette.js':  ["label: 'Rotterdam'"],                       // the palette's name
  'modules/settings.js': ['Rotterdam: rood = slechter'],               // that palette, by name
  'modules/p2000.js':    ["P2000_COVERAGE = 'Rotterdam-Rijnmond"],      // what the Randstad P2000 source covers
  'modules/area-modal.js': ['alleen Rotterdam-Rijnmond en Zuid-Holland-Zuid'],   // idem
  'modules/datasets.js': ['zoals het centrum van Rotterdam'],          // a historical example (1940)
});
const code = text => text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, '')).split('\n').map(l => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/\s.*$/, ''))).join('\n');

describe('no Rotterdam constants outside config/cities.json', () => {
  it('modules and app.js name Rotterdam or GM0599 only on the allowlist', async () => {
    const files = [...(await readdir(new URL('modules/', root))).filter(f => f.endsWith('.js')).map(f => `modules/${f}`), 'app.js'];
    const offenders = [];
    for (const f of files) {
      code(await read(f)).split('\n').forEach((line, i) => {
        if (!/Rotterdam|0599/.test(line)) return;
        if ((ALLOW[f] ?? []).some(s => line.includes(s))) return;
        offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 110)}`);
      });
    }
    assert.deepEqual(offenders, [], 'use CITY.name / cityAdjective / cityCodes from modules/city.js');
  });
  it('every allowlist entry is still needed', async () => {
    for (const [f, list] of Object.entries(ALLOW)) {
      const text = code(await read(f));
      for (const s of list) assert.ok(text.includes(s), `${f}: '${s}' is gone, drop it from ALLOW`);
    }
  });
});
