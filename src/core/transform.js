'use strict';

/**
 * Transformações sobre o HTML de uma apresentação.
 *
 * O componente <deck-stage> das apresentações Claude Design já sabe esconder a
 * barra lateral e o overlay inferior; só não expõe isso ao utilizador. Aqui
 * ativamos as duas vias que o próprio runtime suporta:
 *
 *   - atributo `no-rail`  -> `:host([no-rail]) .rail { display: none }`,
 *     aplicado antes da primeira pintura, sem qualquer flash da barra;
 *   - postMessage `{__omelette_presenting: true}` -> o runtime esconde também
 *     o overlay do rodapé (contador "1/19", atalho "Reset R") e refaz o fit
 *     do palco para ocupar a largura toda.
 */

/** Marca inserida no HTML para reconhecer um ficheiro já transformado. */
const CLEAN_MARKER = 'data-apresentacao-limpa';

const PRESENTING_SCRIPT = `
<script ${CLEAN_MARKER}>
/* Modo apresentação: sem barra lateral e sem overlay de navegação. */
(function () {
  function announce() {
    try { window.postMessage({ __omelette_presenting: true }, '*'); } catch (e) {}
  }
  announce();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announce);
  }
  window.addEventListener('load', announce);
  document.addEventListener('slidechange', announce, true);
  /* O runtime só passa a ouvir mensagens no connectedCallback; se o nosso
     primeiro post chegar antes disso, perde-se. Repetimos durante ~1,5 s. */
  var tries = 0;
  var timer = setInterval(function () {
    announce();
    if (++tries > 25) clearInterval(timer);
  }, 60);
})();
</script>
`;

/** Insere `html` imediatamente antes de </body> (ou no fim, se não existir). */
function beforeBodyEnd(source, html) {
  const i = source.toLowerCase().lastIndexOf('</body>');
  if (i === -1) return source + html;
  return source.slice(0, i) + html + source.slice(i);
}

/** Insere `html` imediatamente a seguir à tag <head> de abertura. */
function afterHeadStart(source, html) {
  const m = source.match(/<head[^>]*>/i);
  if (!m) return html + source;
  const i = m.index + m[0].length;
  return source.slice(0, i) + html + source.slice(i);
}

/** Este HTML tem uma barra lateral de slides para remover? */
function hasRail(html) {
  return /<deck-stage[\s>]/i.test(html);
}

/** Já foi transformado por nós? */
function isClean(html) {
  return html.includes(CLEAN_MARKER);
}

/**
 * Devolve o HTML em modo apresentação limpo. Idempotente: aplicar duas vezes
 * dá exatamente o mesmo resultado.
 */
function toCleanPresentation(html) {
  if (isClean(html)) return html;

  // Acrescenta `no-rail` a cada <deck-stage> que ainda não o tenha.
  const out = html.replace(/<deck-stage(?=[\s>])([^>]*)>/gi, (tag, attrs) =>
    /(^|\s)no-rail(\s|=|$)/i.test(attrs) ? tag : `<deck-stage no-rail${attrs}>`);

  return beforeBodyEnd(out, PRESENTING_SCRIPT);
}

const decodeEntities = (text) => text
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));

/**
 * Percursos alternativos dentro do mesmo deck — o equivalente às
 * "apresentações personalizadas" do PowerPoint.
 *
 * Convenção usada nos decks (ex.: consórcio I&D, Indústria vs ENESII):
 *   - slides alternativos marcados com `data-path="<id>"`;
 *   - um script lê o percurso do URL (`?p=<id>`) e remove do DOM os slides
 *     dos outros percursos ANTES de o motor contar os slides;
 *   - opcionalmente, botões `data-path-opt="<id>"` com o nome a mostrar.
 *
 * A app só precisa de saber quais são e como se chama o parâmetro; o resto
 * fica com o próprio deck. O primeiro botão (ou o primeiro slide marcado) é
 * o percurso por omissão.
 *
 * @returns {null | {param: string, options: {id: string, label: string}[]}}
 */
function detectPaths(html) {
  const ids = [];
  const labels = {};
  const add = (id, label) => {
    if (!ids.includes(id)) ids.push(id);
    if (label && !labels[id]) labels[id] = label;
  };

  for (const m of html.matchAll(/<[a-z][\w-]*\b[^>]*\bdata-path-opt="([\w-]+)"[^>]*>([\s\S]*?)<\//gi)) {
    add(m[1], decodeEntities(m[2].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim());
  }
  const sectionIds = new Set();
  for (const m of html.matchAll(/<section\b[^>]*\bdata-path="([\w-]+)"/gi)) {
    sectionIds.add(m[1]);
    add(m[1]);
  }
  // Sem slides marcados não há nada a escolher, mesmo que haja botões.
  if (sectionIds.size < 2) return null;

  const paramMatch = html.match(/URLSearchParams\([^)]*\)\s*\.get\(\s*['"]([\w-]+)['"]\s*\)/);
  return {
    param: paramMatch ? paramMatch[1] : 'p',
    options: ids.map((id) => ({ id, label: labels[id] || id.charAt(0).toUpperCase() + id.slice(1) })),
  };
}

/**
 * Prepara o HTML para ser conduzido pelo modo apresentador: injeta o agente,
 * e — quando existem — as referências de recursos externos que o invólucro
 * original expunha em window.__resources.
 */
function forPresenting(html, { agentSrc, resources }) {
  let out = html;

  if (resources && Object.keys(resources).length) {
    const json = JSON.stringify(resources).replace(/<\//g, '<\\u002F');
    out = afterHeadStart(out, `\n<script>window.__resources = ${json};</script>\n`);
  }

  // Blob URLs de origem nula é que obrigavam o invólucro a limpar isto; aqui
  // servimos por http, mas os hashes SRI eram dos ficheiros no CDN e já não
  // correspondem aos assets desempacotados.
  out = out.replace(/\s+integrity="[^"]*"/gi, '').replace(/\s+crossorigin="[^"]*"/gi, '');

  return beforeBodyEnd(out, `\n<script src="${agentSrc}"></script>\n`);
}

module.exports = {
  CLEAN_MARKER,
  hasRail,
  isClean,
  detectPaths,
  toCleanPresentation,
  forPresenting,
  beforeBodyEnd,
  afterHeadStart,
};
