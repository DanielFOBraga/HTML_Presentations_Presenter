'use strict';

/**
 * Servidor http local (só 127.0.0.1, porta atribuída pelo sistema).
 *
 * Serve a UI da app e a apresentação desempacotada sob a MESMA origem, que é o
 * que permite à janela do apresentador falar diretamente com o documento
 * dentro do iframe. Suporta Range requests porque as apresentações trazem
 * vídeos webm e sem isso o <video> não faz seek.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const typeFor = (file) => CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';

/** Resolve `rel` dentro de `root`, recusando qualquer fuga da pasta. */
function safeJoin(root, rel) {
  const target = path.resolve(root, '.' + path.posix.resolve('/', rel));
  const base = path.resolve(root);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

function sendFile(req, res, file, { immutable = false } = {}) {
  let stat;
  try {
    stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('não é ficheiro');
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }

  const headers = {
    'Content-Type': typeFor(file),
    'Accept-Ranges': 'bytes',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  };

  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {
    const size = stat.size;
    let start = range[1] === '' ? null : parseInt(range[1], 10);
    let end = range[2] === '' ? null : parseInt(range[2], 10);

    if (start === null) {
      // "bytes=-500" — os últimos 500 bytes.
      start = Math.max(0, size - (end || 0));
      end = size - 1;
    } else {
      end = end === null ? size - 1 : Math.min(end, size - 1);
    }

    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/**
 * @param {{rendererRoot: string}} opts
 * @returns {Promise<{port, origin, setDeckDir, getDeckDir, close}>}
 */
function start({ rendererRoot }) {
  let deckDir = null;

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }

    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/') {
      res.writeHead(302, { Location: '/ui/launcher/index.html' }).end();
      return;
    }

    if (pathname.startsWith('/deck/')) {
      if (!deckDir) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Nenhuma apresentação carregada.');
        return;
      }
      const file = safeJoin(deckDir, pathname.slice('/deck'.length));
      if (!file) { res.writeHead(403).end(); return; }
      sendFile(req, res, file, { immutable: pathname.startsWith('/deck/assets/') });
      return;
    }

    // Tudo o resto vem da pasta dos renderers: /ui/... e /agent/...
    const rel = pathname.startsWith('/ui/') ? pathname.slice('/ui'.length) : pathname;
    const file = safeJoin(rendererRoot, rel);
    if (!file) { res.writeHead(403).end(); return; }
    sendFile(req, res, file);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        origin: `http://127.0.0.1:${port}`,
        setDeckDir: (dir) => { deckDir = dir; },
        getDeckDir: () => deckDir,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

module.exports = { start };
