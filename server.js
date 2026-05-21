import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

createServer(async (req, res) => {
  const pathname = req.url.split('?')[0];
  const filepath = join(ROOT, pathname === '/' ? 'index.html' : pathname);
  const mime = MIME[extname(filepath)] ?? 'text/plain';

  try {
    const body = await readFile(filepath);
    const acceptsGzip = (req.headers['accept-encoding'] ?? '').includes('gzip');

    if (acceptsGzip && mime === 'application/json') {
      res.writeHead(200, { 'Content-Type': mime, 'Content-Encoding': 'gzip' });
      Readable.from(body).pipe(createGzip()).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': mime });
      res.end(body);
    }
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not found');
  }
}).listen(PORT, () => {
  console.log(`Roffatistics → http://localhost:${PORT}`);
});
