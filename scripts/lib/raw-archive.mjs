// Raw archive of every source download (docs/plan-data-mirror.md, layer 1).
// Each download lands unchanged in <RAW_ROOT>/<source>/<YYYY-MM-DD>/<name>, with
// a manifest.json in that directory: { source, date, files: { name: { url, bytes, sha256, fetched } } }.
// A rebuild reads the newest archived copy of a URL and only goes back to the
// source when nothing is archived yet or when --refresh is given.
// Polite to CBS/PDOK: one request at a time, a short pause before each one,
// retries with a growing back-off.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const RAW_ROOT = process.env.ROFFA_RAW_DIR ?? '/nebula/data/roffatistics/raw';
export const REFRESH = process.argv.includes('--refresh');
/** The first command-line argument that is not a --flag (an optional input path of a build script). */
export const firstPathArg = () => process.argv.slice(2).find(a => !a.startsWith('--')) ?? null;

const PAUSE_MS = Number(process.env.ROFFA_FETCH_PAUSE_MS ?? 300);
const UA = 'roffatistics-snapshot (+https://github.com/D-dezeeuw/Roffatistics)';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const sha256 = buf => createHash('sha256').update(buf).digest('hex');
export const today = () => new Date().toISOString().slice(0, 10);

/** Archive directory name for a URL: cbs/<table>, politie/<table>, pdok/gebiedsindelingen-<year>, cbs/download, duo, else the host. */
export function sourceForUrl(url) {
  const u = new URL(url);
  const table = /\/odata\/([^/]+)\//i.exec(u.pathname)?.[1];
  if (u.hostname === 'opendata.cbs.nl' && table) return `cbs/${table}`;
  if (u.hostname === 'dataderden.cbs.nl' && table) return `politie/${table}`;
  const gi = /\/gebiedsindelingen\/(\d{4})\//.exec(u.pathname);
  if (u.hostname === 'service.pdok.nl' && gi) return `pdok/gebiedsindelingen-${gi[1]}`;
  if (u.hostname === 'download.cbs.nl') return 'cbs/download';
  if (/duo\.nl$/.test(u.hostname)) return 'duo';
  return u.hostname;
}

/** File name for a URL: its own base name for files (zip, csv, gpkg), else a hash + .json. */
export function nameForUrl(url) {
  const base = new URL(url).pathname.split('/').pop() ?? '';
  if (/\.(zip|csv|gpkg|json|geojson)$/i.test(base)) return base;
  return `${sha256(url).slice(0, 16)}.json`;
}

/** One GET with retries (sequential callers; pauses PAUSE_MS first). Returns a Buffer. */
export async function download(url, { tries = 4, accept = 'application/json' } = {}) {
  for (let i = 1; ; i++) {
    await sleep(PAUSE_MS);
    try {
      const res = await fetch(url, { headers: { Accept: accept, 'User-Agent': UA } });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await sleep(2000 * i);
    }
  }
}

const manifestPath = dir => join(dir, 'manifest.json');
async function readManifest(dir) {
  try { return JSON.parse(await readFile(manifestPath(dir), 'utf8')); } catch { return null; }
}

/** Date directories of a source, newest first. */
export async function archiveDates(source, root = RAW_ROOT) {
  const dir = join(root, source);
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
}

/** The newest archived copy of `url` under `source`: { path, entry, date } or null. */
export async function findArchived(source, url, root = RAW_ROOT) {
  for (const date of await archiveDates(source, root)) {
    const dir = join(root, source, date);
    const m = await readManifest(dir);
    for (const [name, entry] of Object.entries(m?.files ?? {})) {
      if (entry.url === url && existsSync(join(dir, name))) return { path: join(dir, name), entry, date };
    }
  }
  return null;
}

let manifestQueue = Promise.resolve();
/** Stores `buf` as <source>/<date>/<name> and records it in that day's manifest. */
export async function store(source, url, buf, { name = nameForUrl(url), date = today(), root = RAW_ROOT } = {}) {
  const dir = join(root, source, date);
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, buf);
  const entry = { url, bytes: buf.length, sha256: sha256(buf), fetched: new Date().toISOString() };
  manifestQueue = manifestQueue.then(async () => {
    const m = (await readManifest(dir)) ?? { source, date, files: {} };
    m.files[name] = entry;
    await writeFile(manifestPath(dir), `${JSON.stringify(m, null, 1)}\n`);
  });
  await manifestQueue;
  return { path, entry, date };
}

/**
 * The bytes of `url`: the newest archived copy, or (none archived, or refresh)
 * a fresh download that is archived first. Returns { buf, path, entry, date, fresh }.
 */
export async function archived(source, url, { name, refresh = REFRESH, accept, root = RAW_ROOT } = {}) {
  if (!refresh) {
    const hit = await findArchived(source, url, root);
    if (hit) return { ...hit, buf: await readFile(hit.path), fresh: false };
  }
  const buf = await download(url, { accept });
  const saved = await store(source, url, buf, { name: name ?? nameForUrl(url), root });
  return { ...saved, buf, fresh: true };
}

export const archivedJson = async (source, url, opts) => JSON.parse((await archived(source, url, opts)).buf.toString('utf8'));
/** Local path of the archived copy of a file download (zip, csv). */
export const archivedFile = async (source, url, opts) => (await archived(source, url, { accept: '*/*', ...opts })).path;

/** Every row of an OData query, following odata.nextLink; each page archived. Returns { rows, pages: [{ url, sha256 }] }. */
export async function pagedOData(source, url, opts = {}) {
  const rows = [], pages = [];
  for (let next = url; next;) {
    const got = await archived(source, next, opts);
    const page = JSON.parse(got.buf.toString('utf8'));
    rows.push(...(page.value ?? []));
    pages.push({ url: next, sha256: got.entry.sha256 });
    next = page['odata.nextLink'] ?? null;
  }
  return { rows, pages };
}

/** Every feature of a WFS query paged by startIndex (`pageUrl(start)`, `size` per page); each page archived. */
export async function pagedWfs(source, pageUrl, { size = 1000, ...opts } = {}) {
  const features = [], pages = [];
  for (let start = 0; ; start += size) {
    const url = pageUrl(start);
    const got = await archived(source, url, opts);
    const page = JSON.parse(got.buf.toString('utf8'));
    features.push(...(page.features ?? []));
    pages.push({ url, sha256: got.entry.sha256 });
    if ((page.features ?? []).length < size) break;
  }
  return { features, pages };
}
