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
  toCleanPresentation,
  forPresenting,
  beforeBodyEnd,
  afterHeadStart,
};
