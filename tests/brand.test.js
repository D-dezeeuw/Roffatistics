// Mokumistics brand (docs/plan-mokumistics.md, step 3): city brand resolution,
// the Mokum themes, the early boot scripts, the logo files and server.js's
// per-host index.html (Rotterdam byte-identical to the static file).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import vm from 'node:vm';
import { CITIES, cityMeta, sloganLines, sloganHtml, cityDisclaimer, applyCityToDocument, cityTourUrl } from '../modules/city.js';
import { THEMES, MAP_COLORS, cityDefaultTheme, pickInitialTheme, THEME_STORAGE_KEY } from '../modules/theme.js';
import { THEME_PALETTE, resolvePalette } from '../modules/palette.js';
import { renderIndex, cityForRequest, createAppServer } from '../server.js';

const root = new URL('../', import.meta.url);
const read = f => readFile(new URL(f, root), 'utf8');
const html = await read('index.html');
const head = h => h.slice(0, h.indexOf('</head>'));
const metaContent = (h, kind, key) => h.match(new RegExp(`<meta ${kind}="${key}" content="([^"]*)"`))?.[1];

describe('city brand', () => {
  it('Amsterdam is Mokumistics with its own theme, palette, slogan and assets', () => {
    const a = CITIES.amsterdam;
    assert.deepEqual([a.appName, a.nickname, a.theme, a.palette], ['Mokumistics', 'Mokum', 'mokum', 'mokum']);
    assert.deepEqual(sloganLines(a), ['Liever in Mokum zonder poen,', 'dan in Parijs met een miljoen.']);
    assert.deepEqual(a.hosts, ['mokumistics.hermes.blockworlds.nl']);
    assert.equal(a.canonical, 'https://mokumistics.hermes.blockworlds.nl/');
    assert.deepEqual(sloganLines(CITIES.rotterdam), [], 'Rotterdam keeps the static tagline');
  });
  it('the slogan is a short poem in italics, one line per phrase', () => {
    assert.equal(sloganHtml(CITIES.amsterdam), '<em class="city-slogan">Liever in Mokum zonder poen,<br>dan in Parijs met een miljoen.</em>');
    assert.equal(sloganHtml(CITIES.rotterdam), '');
  });
  it('a disclaimer per city', () => {
    assert.equal(cityDisclaimer(CITIES.amsterdam), 'Geen website van de gemeente Amsterdam.');
    assert.equal(cityDisclaimer(CITIES.rotterdam), 'Geen website van de gemeente Rotterdam.');
    assert.equal((html.match(/class="[^"]*city-disclaimer[^"]*">Geen website van de gemeente Rotterdam\./g) ?? []).length, 2, 'footer and splash');
  });
  it('Rotterdam meta equals the static index.html', () => {
    const m = cityMeta(CITIES.rotterdam);
    assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], m.title);
    assert.equal(metaContent(html, 'name', 'description'), m.description);
    assert.equal(metaContent(html, 'property', 'og:description'), m.ogDescription);
    assert.equal(metaContent(html, 'name', 'twitter:description'), m.twitterDescription);
    assert.equal(metaContent(html, 'property', 'og:image'), m.ogImage);
    assert.equal(metaContent(html, 'property', 'og:image:alt'), m.ogImageAlt);
  });
  it('Amsterdam meta: absolute OG image on its own host, slogan in the link preview', () => {
    const m = cityMeta(CITIES.amsterdam);
    assert.equal(m.title, 'Mokumistics — Amsterdam en Nederland in cijfers');
    assert.equal(m.ogImage, 'https://mokumistics.hermes.blockworlds.nl/assets/cities/amsterdam/og-image.png');
    assert.match(m.ogDescription, /^Liever in Mokum zonder poen, dan in Parijs met een miljoen\. Kaarten/);
    assert.match(m.description, /^Amsterdam en Nederland in cijfers/);
  });
  it('every brand file in the config exists', () => {
    for (const c of Object.values(CITIES)) {
      for (const f of [...Object.values(c.logo), ...Object.values(c.icons), c.og]) assert.ok(existsSync(new URL(f, root)), `${c.slug}: ${f}`);
    }
  });
  it('applyCityToDocument sets logo, name, slogan, disclaimer and icons for Amsterdam', () => {
    const el = () => ({ attrs: {}, textContent: '', innerHTML: '', setAttribute(k, v) { this.attrs[k] = v; } });
    const nodes = new Map();
    const doc = {
      title: 'static', documentElement: { dataset: {} },
      querySelectorAll(sel) { if (!nodes.has(sel)) nodes.set(sel, [el()]); return nodes.get(sel); },
    };
    applyCityToDocument(doc, CITIES.rotterdam);
    assert.equal(nodes.size, 0, 'Rotterdam: nothing touched');
    applyCityToDocument(doc, CITIES.amsterdam);
    const a = CITIES.amsterdam;
    assert.equal(nodes.get('.nav-logo, .splash-logo')[0].attrs.src, a.logo.ui);
    assert.equal(nodes.get('.app-loader__logo')[0].attrs.src, a.logo.loader);
    assert.equal(nodes.get('link[rel="icon"][type="image/svg+xml"]')[0].attrs.href, a.icons.svg);
    assert.equal(nodes.get('link[rel="icon"][sizes]')[0].attrs.href, a.icons.ico);
    assert.equal(nodes.get('.nav-title-text, #splash-title')[0].textContent, 'Mokumistics');
    assert.equal(nodes.get('#splash-tagline')[0].innerHTML, sloganHtml(a));
    assert.equal(nodes.get('.city-disclaimer')[0].textContent, 'Geen website van de gemeente Amsterdam.');
    assert.equal(nodes.get('meta[property="og:site_name"]')[0].attrs.content, 'Mokumistics');
    assert.equal(nodes.get('.splash-tour-link')[0].attrs.href, 'https://flightroutes.hermes.blockworlds.nl/#/tour/tijdreis-schiphol');
    assert.equal(nodes.get('.splash-tour-title')[0].textContent, 'Tijdreis Schiphol');
    assert.equal(nodes.get('.city-name')[0].textContent, 'Amsterdam', 'splash: "Niet alleen Amsterdam."');
    assert.equal(nodes.get('.city-app-name')[0].textContent, 'Mokumistics');
  });
  it('the splash note names the city through .city-name and .city-app-name', () => {
    assert.match(html, /Niet alleen <span class="city-name">Rotterdam<\/span>\.<\/strong> <span class="city-app-name">Roffatistics<\/span> begint bij <span class="city-name">Rotterdam<\/span>/);
  });
  it('each city links its own time-travel tour; the static page is Rotterdam', () => {
    assert.equal(cityTourUrl(CITIES.rotterdam), 'https://flightroutes.hermes.blockworlds.nl/#/tour/tijdreis-rotterdam');
    assert.equal(cityTourUrl(CITIES.amsterdam), 'https://flightroutes.hermes.blockworlds.nl/#/tour/tijdreis-schiphol');
    assert.match(html, new RegExp(`class="splash-more-link splash-tour-link" href="${cityTourUrl(CITIES.rotterdam).replace(/[.?#/]/g, '\\$&')}"`));
    assert.match(html, new RegExp(`<strong class="splash-tour-title">${CITIES.rotterdam.tour.title}</strong>`));
  });
});

describe('logo files', () => {
  it('logo-mark.svg: three black ×, two square-ended bars each, no shield or tile', async () => {
    const s = await read('assets/cities/amsterdam/logo-mark.svg');
    assert.doesNotMatch(s, /<rect|<circle|<text|stroke-linecap="round"/);
    assert.match(s, /fill="#000"/);
    const bars = s.match(/d="([^"]*)"/)[1].split('Z').filter(Boolean);
    assert.equal(bars.length, 6);
    const centres = bars.map(b => { const p = b.replace('M', '').split('L').map(q => q.trim().split(' ').map(Number)); return p.reduce((a, [, y]) => a + y / 4, 0); });
    const ys = [...new Set(centres.map(c => Math.round(c)))];
    assert.equal(ys.length, 3, 'three crosses, stacked');
    const boxes = [0, 2, 4].map(i => bars.slice(i, i + 2).join(' ').match(/-?\d+(\.\d+)?/g).map(Number).filter((_, k) => k % 2 === 1));
    for (let i = 1; i < 3; i++) assert.ok(Math.min(...boxes[i]) - Math.max(...boxes[i - 1]) >= 2, 'clear margin between the crosses');
  });
  it('favicon.svg is a red tile with white crosses; logo.svg adds the word mark as outlines', async () => {
    const f = await read('assets/cities/amsterdam/favicon.svg');
    assert.match(f, /<rect [^>]*fill="#E30613"/);
    assert.match(f, /<path fill="#fff"/);
    const l = await read('assets/cities/amsterdam/logo.svg');
    assert.match(l, /<title>Mokumistics<\/title>/);
    assert.equal((l.match(/<path /g) ?? []).length, 2);
    assert.doesNotMatch(l, /<text|font-family/);
  });
  it('the icons and the OG image are real PNG/ICO files of the right size', async () => {
    const b = await readFile(new URL('assets/cities/amsterdam/og-image.png', root));
    assert.equal(b.toString('latin1', 1, 4), 'PNG');
    assert.deepEqual([b.readUInt32BE(16), b.readUInt32BE(20)], [1200, 630]);
    const ico = await readFile(new URL('assets/cities/amsterdam/favicon.ico', root));
    assert.deepEqual([ico.readUInt16LE(2), ico.readUInt16LE(4)], [1, 3]);
    const apple = await readFile(new URL('assets/cities/amsterdam/apple-touch-icon.png', root));
    assert.equal(apple.readUInt32BE(16), 180);
  });
});

describe('Mokum theme', () => {
  it('two Mokum themes; the default theme follows the city', () => {
    assert.deepEqual(Object.keys(THEMES), ['rotterdam', 'klassiek', 'mokum', 'mokum-licht']);
    assert.equal(cityDefaultTheme(CITIES.amsterdam), 'mokum');
    assert.equal(cityDefaultTheme(CITIES.rotterdam), 'rotterdam');
    const st = v => ({ getItem: k => (k === THEME_STORAGE_KEY ? v : null) });
    assert.equal(pickInitialTheme(st(null), 'mokum'), 'mokum');
    assert.equal(pickInitialTheme(st('neon'), 'mokum'), 'mokum');
    assert.equal(pickInitialTheme(st('klassiek'), 'mokum'), 'klassiek', 'a stored choice wins');
    assert.equal(pickInitialTheme({ getItem() { throw new Error('blocked'); } }, 'mokum'), 'mokum');
    assert.equal(pickInitialTheme(null), 'rotterdam');
  });
  it('map colours and "Volgt thema" for both Mokum themes', () => {
    for (const id of ['mokum', 'mokum-licht']) {
      assert.equal(MAP_COLORS[id].accent, '#e30613');
      assert.equal(THEME_PALETTE[id], 'mokum');
      assert.equal(resolvePalette('auto', id).id, 'mokum');
    }
  });
  it('the early theme script: stored theme, else the city theme', () => {
    const script = html.match(/<script>(try\{var e=document\.documentElement,t=null[^<]*)<\/script>/)?.[1];
    assert.ok(script);
    assert.deepEqual(JSON.parse(script.match(/(\[[^\]]*\])\.indexOf\(t\)/)[1].replace(/'/g, '"')), Object.keys(THEMES));
    assert.deepEqual(JSON.parse(script.match(/d=(\{[^}]*\})/)[1]), Object.fromEntries(Object.values(CITIES).map(c => [c.slug, c.theme])));
    const run = (city, stored, throws = false) => {
      const documentElement = { dataset: { city } };
      const localStorage = { getItem: () => { if (throws) throw new Error('blocked'); return stored; } };
      vm.runInNewContext(script, { document: { documentElement }, localStorage });
      return documentElement.dataset.theme;
    };
    assert.equal(run('amsterdam', null), 'mokum');
    assert.equal(run('amsterdam', 'rotterdam'), 'rotterdam');
    assert.equal(run('rotterdam', null), 'rotterdam');
    assert.equal(run('rotterdam', 'mokum-licht'), 'mokum-licht');
    assert.equal(run('amsterdam', null, true), 'mokum');
    assert.equal(run('nope', 'neon'), 'rotterdam');
  });
  it('the early brand script sets the title and icons of the city before first paint', () => {
    const script = html.match(/<script>(try\{var b=[^<]*)<\/script>/)?.[1];
    assert.ok(script);
    const run = city => {
      const links = {}, document = { title: 'static', documentElement: { dataset: { city } }, querySelector: s => (links[s] ??= { setAttribute(k, v) { this[k] = v; } }) };
      vm.runInNewContext(script, { document });
      return { title: document.title, links };
    };
    const r = run('rotterdam');
    assert.equal(r.title, 'static');
    assert.deepEqual(r.links, {});
    const a = run('amsterdam'), m = cityMeta(CITIES.amsterdam);
    assert.equal(a.title, m.title);
    assert.equal(a.links['link[rel="icon"][sizes]'].href, m.icons.ico);
    assert.equal(a.links['link[rel="icon"][type="image/svg+xml"]'].href, m.icons.svg);
    assert.equal(a.links['link[rel="apple-touch-icon"]'].href, m.icons.apple);
  });
});

describe('server.js: index.html per host', () => {
  it('Rotterdam output is byte-identical to index.html', () => {
    assert.equal(renderIndex(html, CITIES.rotterdam), html);
  });
  it('Amsterdam: title, meta, OG/twitter, canonical, favicons, theme and brand', () => {
    const out = renderIndex(html, CITIES.amsterdam), m = cityMeta(CITIES.amsterdam);
    const h = head(out);
    assert.match(out, /<html lang="nl" data-theme="mokum" data-city="amsterdam">/);
    assert.equal(h.match(/<title>([^<]*)<\/title>/)[1], m.title);
    assert.equal(metaContent(h, 'name', 'description'), m.description);
    assert.equal(metaContent(h, 'name', 'theme-color'), '#000000');
    assert.equal(metaContent(h, 'property', 'og:site_name'), 'Mokumistics');
    assert.equal(metaContent(h, 'property', 'og:url'), m.canonical);
    assert.equal(metaContent(h, 'property', 'og:title'), m.title);
    assert.equal(metaContent(h, 'property', 'og:description'), m.ogDescription);
    assert.equal(metaContent(h, 'property', 'og:image'), m.ogImage);
    assert.equal(metaContent(h, 'property', 'og:image:alt'), m.ogImageAlt);
    assert.equal(metaContent(h, 'name', 'twitter:title'), m.title);
    assert.equal(metaContent(h, 'name', 'twitter:description'), m.twitterDescription);
    assert.equal(metaContent(h, 'name', 'twitter:image'), m.ogImage);
    assert.match(h, /<link rel="canonical" href="https:\/\/mokumistics\.hermes\.blockworlds\.nl\/" \/>/);
    assert.match(h, /<link rel="icon" href="assets\/cities\/amsterdam\/favicon\.ico" sizes=/);
    assert.match(h, /<link rel="icon" href="assets\/cities\/amsterdam\/favicon\.svg" type="image\/svg\+xml"/);
    assert.match(h, /<link rel="apple-touch-icon" href="assets\/cities\/amsterdam\/apple-touch-icon\.png"/);
    const markup = h.replace(/<!--[\s\S]*?-->/g, '').replace(/<script>[\s\S]*?<\/script>/g, '');
    assert.doesNotMatch(markup, /Roffatistics|Rotterdam|d-dezeeuw\.github\.io/, 'no Rotterdam brand left in the head');
    assert.match(out, /<span class="nav-title-text">Mokumistics<\/span>/);
    assert.match(out, /<h1 id="splash-title" class="splash-title">Mokumistics<\/h1>/);
    assert.match(out, /<p id="splash-tagline" class="splash-tagline"><em class="city-slogan">Liever in Mokum zonder poen,<br>dan in Parijs met een miljoen\.<\/em><\/p>/);
    assert.match(out, /<img class="nav-logo" src="assets\/cities\/amsterdam\/favicon\.svg"/);
    assert.match(out, /<img class="app-loader__logo" src="assets\/cities\/amsterdam\/logo-mark\.svg"/);
    assert.equal((out.match(/Geen website van de gemeente Amsterdam\./g) ?? []).length, 2);
    assert.match(out, /<option value="rotterdam">Amsterdam<\/option>/);
    assert.match(out, /title="Over Mokumistics \(titelscherm\)"/);
    assert.match(out, /<button class="about-btn footer-link"[^>]*aria-label="Over Mokumistics"[^>]*>Over<\/button>/);
  });
  it('picks the city from ?city=, then the Host header (port dropped), then Rotterdam', () => {
    assert.equal(cityForRequest('/', 'mokumistics.hermes.blockworlds.nl').slug, 'amsterdam');
    assert.equal(cityForRequest('/', 'mokumistics.hermes.blockworlds.nl:443').slug, 'amsterdam');
    assert.equal(cityForRequest('/', 'roffatistics.hermes.blockworlds.nl').slug, 'rotterdam');
    assert.equal(cityForRequest('/?city=amsterdam', 'localhost:3000').slug, 'amsterdam');
    assert.equal(cityForRequest('/', undefined).slug, 'rotterdam');
  });
  it('serves the rendered page per Host header', async () => {
    const srv = createAppServer().listen(0);
    await new Promise(r => srv.once('listening', r));
    const get = (path, host) => new Promise((res, rej) => {
      request({ port: srv.address().port, path, headers: { host } }, r => { let b = ''; r.setEncoding('utf8'); r.on('data', c => { b += c; }); r.on('end', () => res(b)); }).on('error', rej).end();
    });
    try {
      assert.equal(await get('/', 'roffatistics.hermes.blockworlds.nl'), html);
      assert.match(await get('/index.html', 'mokumistics.hermes.blockworlds.nl'), /<title>Mokumistics — Amsterdam/);
    } finally { srv.close(); }
  });
});
