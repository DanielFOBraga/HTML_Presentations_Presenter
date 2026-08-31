'use strict';

/**
 * Leitura e escrita do formato "standalone" das apresentações Claude Design.
 *
 * O ficheiro é um invólucro fixo que se auto-descompacta no arranque, com três
 * blocos de dados:
 *   <script type="__bundler/manifest">      {uuid: {data, mime, compressed}}
 *   <script type="__bundler/ext_resources"> [{id, uuid}]
 *   <script type="__bundler/template">      string JSON com o HTML real
 *
 * O emissor original escreve cada bloco como "\n" + JSON + "\n  ", escapando a
 * barra de cada "</" para a sequência unicode / — senão o parser de HTML
 * fechava o <script> a meio dos dados. Reproduzir isto byte a byte permite
 * reescrever só o template e deixar os 12 MB do manifest exatamente como
 * estavam (verificado contra os dois ficheiros de exemplo).
 */

const fs = require('fs');

const BLOCKS = ['manifest', 'ext_resources', 'template'];

const blockRe = (tag) =>
  new RegExp('<script type="__bundler/' + tag + '">([\\s\\S]*?)</script>');

/** Codifica um valor para dentro de um bloco <script type="__bundler/*">. */
function encodeBlock(value) {
  return '\n' + JSON.stringify(value).replace(/<\//g, '<\\u002F') + '\n  ';
}

/**
 * Que tipo de apresentação é este HTML.
 *   'bundle'     — standalone Claude Design (contém os blocos __bundler)
 *   'deck-stage' — HTML já desempacotado que usa o componente <deck-stage>
 *   'generic'    — qualquer outro deck (ex.: os gerados no Claude Code)
 */
function detectKind(html) {
  if (blockRe('template').test(html)) return 'bundle';
  if (/<deck-stage[\s>]/i.test(html)) return 'deck-stage';
  return 'generic';
}

/**
 * Lê uma apresentação do disco.
 * @returns {{filePath, kind, innerKind, raw, manifest, extResources, template}}
 *   `template` é sempre o HTML da apresentação: para um bundle é o conteúdo
 *   descodificado do bloco, para os restantes é o próprio ficheiro.
 *   `innerKind` diz se esse HTML usa <deck-stage> ou é genérico.
 */
function read(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const kind = detectKind(raw);

  if (kind !== 'bundle') {
    return {
      filePath, kind, innerKind: kind, raw,
      manifest: null, extResources: [], template: raw,
    };
  }

  const manifest = JSON.parse(raw.match(blockRe('manifest'))[1]);
  const extMatch = raw.match(blockRe('ext_resources'));
  const extResources = extMatch ? JSON.parse(extMatch[1]) : [];
  const template = JSON.parse(raw.match(blockRe('template'))[1]);

  return {
    filePath, kind, innerKind: detectKind(template), raw,
    manifest, extResources, template,
  };
}

/**
 * Escreve uma apresentação, preservando o invólucro original byte a byte e
 * substituindo apenas os blocos indicados em `patch`.
 * Para decks não-bundle, `patch.template` é o ficheiro inteiro.
 */
function write(destPath, deck, patch = {}) {
  if (deck.kind !== 'bundle') {
    fs.writeFileSync(destPath, patch.template != null ? patch.template : deck.template, 'utf8');
    return destPath;
  }

  let out = deck.raw;
  const values = {
    manifest: patch.manifest,
    ext_resources: patch.extResources,
    template: patch.template,
  };

  for (const tag of BLOCKS) {
    if (values[tag] === undefined) continue;
    const m = out.match(blockRe(tag));
    if (!m) continue;
    // slice() em vez de replace() — o conteúdo tem $ e replace interpretaria
    // $&, $1, etc. como padrões de substituição.
    const start = m.index + m[0].indexOf('>') + 1;
    const end = m.index + m[0].length - '</script>'.length;
    out = out.slice(0, start) + encodeBlock(values[tag]) + out.slice(end);
  }

  fs.writeFileSync(destPath, out, 'utf8');
  return destPath;
}

module.exports = { read, write, detectKind, encodeBlock, blockRe };
