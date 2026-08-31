'use strict';

/**
 * Funcionalidade A — gerar uma cópia da apresentação sem a barra lateral.
 *
 * A edição é cirúrgica: descodificamos só o bloco `template`, mexemos no HTML
 * e reescrevemos. O manifest de ~12 MB é copiado byte a byte, e o resultado
 * continua a ser um ficheiro único que abre com duplo clique — que é
 * precisamente a razão de ser destes ficheiros.
 */

const fs = require('fs');
const path = require('path');

const bundle = require('./bundle');
const transform = require('./transform');

const SUFFIX = ' (apresentação)';

/** Caminho de destino que ainda não existe: "... (apresentação) (2).html". */
function freePath(dir, base, ext) {
  let candidate = path.join(dir, base + ext);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n++;
  }
  return candidate;
}

/**
 * @returns {{ok: true, destPath: string} | {ok: false, reason: string}}
 */
function exportClean(filePath, destPath) {
  const deck = bundle.read(filePath);

  if (!transform.hasRail(deck.template)) {
    return {
      ok: false,
      reason: deck.kind === 'generic'
        ? 'Esta apresentação não usa o componente <deck-stage>, por isso não tem barra lateral para remover — já abre em ecrã inteiro.'
        : 'Não foi encontrada nenhuma barra lateral de slides neste ficheiro.',
    };
  }

  if (transform.isClean(deck.template)) {
    return { ok: false, reason: 'Este ficheiro já é uma versão sem barra lateral.' };
  }

  const dest = destPath || freePath(
    path.dirname(filePath),
    path.basename(filePath, path.extname(filePath)) + SUFFIX,
    path.extname(filePath) || '.html',
  );

  bundle.write(dest, deck, { template: transform.toCleanPresentation(deck.template) });
  return { ok: true, destPath: dest };
}

module.exports = { exportClean, freePath, SUFFIX };
