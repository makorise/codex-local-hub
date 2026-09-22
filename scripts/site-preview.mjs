import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const website = join(root, 'website');
const port = Number(process.env.SITE_PREVIEW_PORT || 8792);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
};

function resolveFile(pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (requested.startsWith('assets/')) {
    const name = requested.slice('assets/'.length);
    if (name === 'favicon.svg') return join(root, 'public', 'favicon.svg');
    if (name === 'social-preview.png') return join(root, 'docs', 'assets', 'social-preview', 'codex-local-hub-social-preview.png');
    return join(root, 'docs', 'assets', 'screenshots', name);
  }
  const file = normalize(join(website, requested));
  return file.startsWith(website) ? file : null;
}

createServer(async (request, response) => {
  const file = resolveFile(new URL(request.url, `http://${request.headers.host}`).pathname);
  if (!file) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': mimeTypes[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Codex Lookout website: http://127.0.0.1:${port}/`);
});
