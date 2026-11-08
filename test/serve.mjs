// Serves docs/ under /daybook/, the way GitHub Pages will. Run with `npm run serve`, or import startServer.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../docs', import.meta.url));
const BASE = '/daybook/';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export function startServer(port = 0) {
  const requests = [];
  /** Published path → replacement text, to stand in for a new deployment. */
  const overrides = new Map();
  /**
   * While stalled, connections are accepted and not answered, like a captive portal or one bar of signal. Ending the
   * stall answers them late, the way a slow network finally does.
   */
  let stalled = false;
  const held = [];
  const stall = (on) => {
    stalled = on;
    if (!on) {
      for (const [request, response] of held.splice(0)) {
        if (!response.destroyed) answer(request, response);
      }
    }
  };
  const server = createServer((request, response) => {
    if (stalled) {
      response.on('error', () => {}); // The browser may have given up on it by the time it's answered.
      held.push([request, response]);
      return;
    }
    answer(request, response);
  });
  async function answer(request, response) {
    const { pathname } = new URL(request.url, 'http://localhost');
    requests.push(pathname);
    if (pathname === '/daybook') {
      response.writeHead(301, { Location: BASE });
      response.end();
      return;
    }
    if (!pathname.startsWith(BASE)) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not found: this site lives under /daybook/');
      return;
    }
    const relative = decodeURIComponent(pathname.slice(BASE.length)) || 'index.html';
    const file = normalize(join(ROOT, relative));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (overrides.has(relative)) {
      response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/plain', 'Cache-Control': 'no-cache' });
      response.end(overrides.get(relative));
      return;
    }
    try {
      const info = await stat(file);
      const body = await readFile(info.isDirectory() ? join(file, 'index.html') : file);
      response.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      response.end(body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not found');
    }
  }
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({ origin, url: `${origin}${BASE}`, requests, overrides, stall, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startServer(Number(process.env.PORT) || 8123);
  console.log(`Daybook: ${url}`);
}
