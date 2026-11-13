// A stand-in for the part of OpenChamber that serves an extension's files.
//
// It follows OpenChamber 2.7.0 (packages/web/server/lib/guests/routes.js and catalog.js):
// the same six file types, the same sandbox and Content-Security-Policy header, the same
// `Access-Control-Allow-Origin: null`, and the same styles appended to HTML. A page that
// works here should work there, and a file type or request the real app refuses fails here too.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { guestFramePolicy, GUEST_SCROLLBAR_CSS, GUEST_SCROLLBAR_SCRIPT } from '@openchamber/sdk';
import { GUEST_UI_LOOK_CSS } from '@openchamber/sdk/ui';

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
};

const GRANT = 'test-grant';
const GUEST_PREFIX = `/api/guest-files/${GRANT}/`;

const injectGuestDocumentStyles = (html) => {
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? '';
  const declared = `${doctype}<meta name="color-scheme" content="light dark">${html.slice(doctype.length)}`;
  return `${declared}\n<style data-openchamber-guest-styles>${GUEST_SCROLLBAR_CSS}${GUEST_UI_LOOK_CSS}</style>\n<script data-openchamber-guest-scrollbar>${GUEST_SCROLLBAR_SCRIPT}</script>`;
};

/**
 * @param {{ packageRoot: string, harnessRoot: string, origins?: string[], port?: number }} options
 * @returns {Promise<{ url: string, guestUrl: string, close: () => Promise<void> }>}
 */
export async function startServer({ packageRoot, harnessRoot, origins = [], port = 0 }) {
  const packageReal = resolve(packageRoot);

  const sendGuestFile = async (req, res, relativePath) => {
    const segments = relativePath.split('/');
    if (relativePath.includes('\\') || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      res.writeHead(404).end();
      return;
    }
    const filePath = join(packageReal, ...segments);
    const contentType = MIME_BY_EXT[extname(filePath).toLowerCase()];
    if (!filePath.startsWith(packageReal + sep) || !contentType) {
      res.writeHead(404).end();
      return;
    }
    let raw;
    try {
      raw = await readFile(filePath);
    } catch {
      res.writeHead(404).end();
      return;
    }
    const body = contentType.startsWith('text/html') ? injectGuestDocumentStyles(raw.toString('utf8')) : raw;
    const connectSource = `${req.headers.host}${GUEST_PREFIX}`;
    res.writeHead(200, {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `sandbox allow-scripts; ${guestFramePolicy(connectSource, origins)}`,
      'Access-Control-Allow-Origin': 'null',
    });
    res.end(body);
  };

  const server = http.createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      if (path.startsWith(GUEST_PREFIX)) {
        await sendGuestFile(req, res, path.slice(GUEST_PREFIX.length));
        return;
      }
      // The pretend app shell: the page that frames the extension.
      const name = path === '/' ? 'host.html' : path.slice(1);
      if (!/^[a-z0-9.-]+\.(html|js|css)$/i.test(name)) {
        res.writeHead(404).end();
        return;
      }
      const body = await readFile(join(harnessRoot, name));
      res.writeHead(200, { 'Content-Type': MIME_BY_EXT[extname(name)] ?? 'text/plain', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });

  await new Promise((done) => server.listen(port, '127.0.0.1', done));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    guestUrl: `${url}${GUEST_PREFIX}editor/index.html`,
    close: () => new Promise((done) => server.close(() => done())),
  };
}
