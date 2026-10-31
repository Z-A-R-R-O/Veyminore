import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WorkspaceProjection } from './data.mjs';

const appRoot = dirname(fileURLToPath(import.meta.url));
const routes = new Map([
  ['/computer-preview/', ['computer-preview/index.html', 'text/html; charset=utf-8']],
  ['/computer-preview/style.css', ['computer-preview/style.css', 'text/css; charset=utf-8']],
  ['/computer-preview/orb.js', ['computer-preview/orb.js', 'text/javascript; charset=utf-8']],
  ['/computer-preview/orb.css', ['computer-preview/orb.css', 'text/css; charset=utf-8']],
  ['/computer-preview/app.js', ['computer-preview/app.js', 'text/javascript; charset=utf-8']],
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/worker-detail/view.js', ['worker-detail/view.js', 'text/javascript; charset=utf-8']],
  ['/worker-detail/style.css', ['worker-detail/style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/agent-nav.js', ['agent-nav.js', 'text/javascript; charset=utf-8']],
  ['/background.js', ['background.js', 'text/javascript; charset=utf-8']],
  ['/dock.js', ['dock.js', 'text/javascript; charset=utf-8']],
  ['/dock.css', ['dock.css', 'text/css; charset=utf-8']],
  ['/bento.js', ['bento.js', 'text/javascript; charset=utf-8']],
  ['/bento.css', ['bento.css', 'text/css; charset=utf-8']],
  ['/product-shell.js', ['product-shell.js', 'text/javascript; charset=utf-8']],
  ['/product-shell.css', ['product-shell.css', 'text/css; charset=utf-8']],
  ['/work.js', ['work.js', 'text/javascript; charset=utf-8']],
  ['/work.css', ['work.css', 'text/css; charset=utf-8']],
  ['/ifz-work.css', ['ifz-work.css', 'text/css; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/fonts/Satoshi-Variable.ttf', ['fonts/Satoshi-Variable.ttf', 'font/ttf']]
]);

export function createControlCenter(root = resolve(appRoot, '../..'), options = {}) {
  const projection = new WorkspaceProjection(root, options.live);
  const token = randomBytes(24).toString('hex');
  return http.createServer(async (req, res) => {
    const authority = `127.0.0.1:${req.socket.localPort}`;
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers.host !== authority || !['GET', 'HEAD'].includes(req.method)) return reply(res, 403, 'Forbidden');
    if (req.headers.origin && req.headers.origin !== `http://${authority}`) return reply(res, 403, 'Forbidden');
    if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return reply(res, 403, 'Forbidden');
    const url = new URL(req.url, `http://${authority}`);
    try {
      if (url.pathname === '/api/status') {
        const supplied = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('zetro_view='))?.slice(11) || '';
        if (supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return reply(res, 401, 'Open the control center first');
        return reply(res, 200, JSON.stringify(await projection.snapshot()), 'application/json; charset=utf-8');
      }
      const asset = routes.get(url.pathname);
      if (!asset) return reply(res, 404, 'Not found');
      if (url.pathname === '/') res.setHeader('Set-Cookie', `zetro_view=${token}; HttpOnly; SameSite=Strict; Path=/`);
      const body = await readFile(join(appRoot, 'public', asset[0]));
      reply(res, 200, req.method === 'HEAD' ? '' : body, asset[1]);
    } catch { reply(res, 503, 'Local preview unavailable'); }
  });
}

function reply(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createControlCenter().listen(4317, '127.0.0.1', () => console.log('ZETRO control center: http://127.0.0.1:4317'));
}
