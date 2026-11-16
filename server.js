import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES, resolveCitySlug, cityBySlug, cityMeta, sloganHtml, sloganLines } from './modules/city.js';
import { THEMES, cityDefaultTheme } from './modules/theme.js';

const PORT = 3000;
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const escText = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escAttr = s => escText(s).replace(/"/g, '&quot;');
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The city of a request: ?city= → the Host header (port dropped) → the default city. */
export function cityForRequest(url = '/', host = '') {
  const search = String(url).includes('?') ? String(url).slice(String(url).indexOf('?')) : '';
  const hostname = String(host ?? '').replace(/:\d+$/, '');
  return cityBySlug(resolveCitySlug({ search, hostname }, CITIES));
}

/**
 * index.html for one city (docs/plan-mokumistics.md, step 3): title, meta
 * description, OG/twitter tags, canonical, favicons, <html data-city/theme>,
 * and the brand in the body (logos, app name, slogan, disclaimer, scope
 * label), so crawlers and the first paint see the city of the host. Every
 * value of the default city equals the static file, so the Rotterdam output is
 * byte-identical to index.html (tests/brand.test.js).
 */
export function renderIndex(html, city) {
  const m = cityMeta(city);
  let out = String(html);
  const attr = (re, v) => { if (v != null) out = out.replace(re, (_, pre) => `${pre}${escAttr(v)}"`); };
  const text = (re, v) => { if (v != null) out = out.replace(re, (_, pre, post) => `${pre}${escText(v)}${post}`); };
  const meta = (kind, key, v) => attr(new RegExp(`(<meta ${kind}="${reEsc(key)}" content=")[^"]*"`), v);
  attr(/(<html\b[^>]*\bdata-theme=")[^"]*"/, cityDefaultTheme(city));
  attr(/(<html\b[^>]*\bdata-city=")[^"]*"/, city.slug);
  text(/(<title>)[^<]*(<\/title>)/, m.title);
  meta('name', 'description', m.description);
  meta('name', 'theme-color', THEMES[cityDefaultTheme(city)].themeColor);
  attr(/(<link rel="canonical" href=")[^"]*"/, m.canonical);
  meta('property', 'og:site_name', m.siteName);
  meta('property', 'og:url', m.canonical);
  meta('property', 'og:title', m.title);
  meta('property', 'og:description', m.ogDescription);
  meta('property', 'og:image', m.ogImage);
  meta('property', 'og:image:alt', m.ogImageAlt);
  meta('name', 'twitter:title', m.title);
  meta('name', 'twitter:description', m.twitterDescription);
  meta('name', 'twitter:image', m.ogImage);
  attr(/(<link rel="icon" href=")[^"]*"(?= sizes=)/, m.icons?.ico);
  attr(/(<link rel="icon" href=")[^"]*"(?= type="image\/svg\+xml")/, m.icons?.svg);
  attr(/(<link rel="apple-touch-icon" href=")[^"]*"/, m.icons?.apple);
  attr(/(<img class="app-loader__logo" src=")[^"]*"/, m.logo?.loader);
  attr(/(<img class="nav-logo" src=")[^"]*"/, m.logo?.ui);
  attr(/(<img class="splash-logo" src=")[^"]*"/, m.logo?.ui);
  attr(/(<button type="button" class="nav-title"[^>]*\btitle=")[^"]*"/, m.aboutTitle);
  text(/(<span class="nav-title-text">)[^<]*(<\/span>)/, city.appName);
  text(/(<h1 id="splash-title" class="splash-title">)[^<]*(<\/h1>)/, city.appName);
  attr(/(<button class="about-btn[^"]*"[^>]*\baria-label=")[^"]*"/, `Over ${city.appName}`);
  attr(/(<button class="about-btn[^"]*"[^>]*\btitle=")[^"]*"/, `Over ${city.appName}`);
  text(/(<span class="nav-menu-label">)Over [^<]*(<\/span>)/, `Over ${city.appName}`);
  text(/(<option value="rotterdam">)[^<]*(<\/option>)/, city.name);
  out = out.replace(/(class="[^"]*\bcity-disclaimer\b[^"]*">)[^<]*(<)/g, (_, pre, post) => `${pre}${escText(m.disclaimer)}${post}`);
  if (sloganLines(city).length) out = out.replace(/(<p id="splash-tagline" class="splash-tagline">)[\s\S]*?(<\/p>)/, (_, pre, post) => `${pre}${sloganHtml(city)}${post}`);
  return out;
}

export function createAppServer(root = ROOT) {
  return createServer(async (req, res) => {
    const pathname = req.url.split('?')[0];
    const isIndex = pathname === '/' || pathname === '/index.html';
    const filepath = join(root, isIndex ? 'index.html' : pathname);
    const mime = MIME[extname(filepath)] ?? 'text/plain';

    try {
      let body = await readFile(filepath);
      if (isIndex) body = Buffer.from(renderIndex(body.toString('utf8'), cityForRequest(req.url, req.headers.host)));
      const acceptsGzip = (req.headers['accept-encoding'] ?? '').includes('gzip');

      if (acceptsGzip && mime === 'application/json') {
        res.writeHead(200, { 'Content-Type': mime, 'Content-Encoding': 'gzip' });
        Readable.from(body).pipe(createGzip()).pipe(res);
      } else {
        res.writeHead(200, isIndex ? { 'Content-Type': mime, Vary: 'Host' } : { 'Content-Type': mime });
        res.end(body);
      }
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not found');
    }
  });
}

const isMain = (() => { try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  createAppServer().listen(PORT, () => {
    console.log(`Roffatistics → http://localhost:${PORT}`);
  });
}
