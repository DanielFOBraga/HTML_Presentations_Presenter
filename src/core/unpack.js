'use strict';

/**
 * Desempacota uma apresentação para uma pasta de trabalho servível por http.
 *
 * Porquê não usar o ficheiro original diretamente: o invólucro standalone
 * descomprime ~12 MB para blob URLs em cada documento que o carrega, e o modo
 * apresentador abre três instâncias do deck (ecrã, slide atual, próximo).
 * Desempacotar uma vez para ficheiros reais faz com que as três partilhem a
 * cache do http, e dá seek nos vídeos webm (Range requests).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const bundle = require('./bundle');
const transform = require('./transform');

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'video/webm': '.webm',
  'video/mp4': '.mp4',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'font/ttf': '.ttf',
  'font/otf': '.otf',
  'font/woff': '.woff',
  'font/woff2': '.woff2',
  'application/font-woff': '.woff',
  'text/javascript': '.js',
  'application/javascript': '.js',
  'text/css': '.css',
  'application/json': '.json',
};

const extFor = (mime) => EXT_BY_MIME[String(mime || '').toLowerCase()] || '.bin';

/** Identidade estável da pasta de trabalho: caminho + mtime + tamanho. */
function workDirName(filePath) {
  const st = fs.statSync(filePath);
  const key = `${path.resolve(filePath)}|${st.mtimeMs}|${st.size}`;
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
  return `${path.basename(filePath, path.extname(filePath)).slice(0, 40).replace(/[^\w .-]/g, '_')}-${hash}`;
}

/**
 * Prepara `filePath` dentro de `cacheRoot` e devolve a pasta resultante, com
 * um `deck.html` pronto a servir. Reutiliza a pasta se já estiver completa.
 *
 * @returns {{dir, kind, innerKind, slideCount, cached}}
 */
function prepare(filePath, cacheRoot, { agentSrc = '/agent/deck-agent.js' } = {}) {
  const dir = path.join(cacheRoot, workDirName(filePath));
  const deckHtml = path.join(dir, 'deck.html');
  const stamp = path.join(dir, '.ready');

  const deck = bundle.read(filePath);

  if (fs.existsSync(stamp) && fs.existsSync(deckHtml)) {
    return { dir, kind: deck.kind, innerKind: deck.innerKind, cached: true };
  }

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  let html = deck.template;
  const resources = {};

  if (deck.kind === 'bundle') {
    const assetsDir = path.join(dir, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });

    const nameByUuid = {};
    for (const [uuid, entry] of Object.entries(deck.manifest)) {
      const name = uuid + extFor(entry.mime);
      let bytes = Buffer.from(entry.data, 'base64');
      if (entry.compressed) {
        try {
          bytes = zlib.gunzipSync(bytes);
        } catch (err) {
          // Mesma postura do invólucro original: um asset ilegível não deve
          // impedir o resto da apresentação de abrir.
          console.warn(`[unpack] asset ${uuid} ilegível:`, err.message);
          bytes = Buffer.alloc(0);
        }
      }
      fs.writeFileSync(path.join(assetsDir, name), bytes);
      nameByUuid[uuid] = 'assets/' + name;
    }

    // O invólucro faz exatamente esta substituição cega para blob URLs.
    for (const [uuid, rel] of Object.entries(nameByUuid)) {
      html = html.split(uuid).join(rel);
    }

    for (const entry of deck.extResources || []) {
      if (nameByUuid[entry.uuid]) resources[entry.id] = nameByUuid[entry.uuid];
    }
  }

  html = transform.forPresenting(html, { agentSrc, resources });
  fs.writeFileSync(deckHtml, html, 'utf8');
  fs.writeFileSync(stamp, new Date().toISOString(), 'utf8');

  return { dir, kind: deck.kind, innerKind: deck.innerKind, cached: false };
}

/** Apaga pastas de trabalho não tocadas há mais de `maxAgeMs`. */
function prune(cacheRoot, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  if (!fs.existsSync(cacheRoot)) return;
  const cutoff = Date.now() - maxAgeMs;
  for (const name of fs.readdirSync(cacheRoot)) {
    const dir = path.join(cacheRoot, name);
    try {
      if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* uma pasta que desapareceu entretanto não é problema */ }
  }
}

module.exports = { prepare, prune, workDirName, extFor };
