'use strict';

/**
 * Janela do slide: um iframe a ocupar o ecrã, conduzido pelo apresentador.
 *
 * Não decide nada sozinha. Teclas e cliques — os daqui e os que o agente
 * apanha dentro do deck — seguem para a vista do apresentador, que é quem
 * guarda o índice e responde com `deck:index`. Assim há um só sítio com a
 * lógica do teclado (números + Enter, B/W, Esc…) e as janelas não divergem.
 */

const hint = document.getElementById('hint');
const blank = document.getElementById('blank');

function showHint(text, ms = 5000) {
  hint.firstElementChild.textContent = text;
  hint.hidden = false;
  hint.style.opacity = '1';
  setTimeout(() => {
    hint.style.opacity = '0';
    setTimeout(() => { hint.hidden = true; }, 320);
  }, ms);
}

const frame = new window.DeckFrame(document.getElementById('frame'), {
  // O deck nunca navega sozinho (o agente intercepta teclas e cliques), mas
  // se alguma coisa lá dentro mudar de slide, o apresentador tem de saber.
  onIndex: (index) => window.present.goTo(index),
  onKey: (event) => window.present.key(event.key, event.shiftKey),
  onPath: (path) => window.present.setPath(path),
});

window.addEventListener('keydown', (event) => {
  if (!event.isTrusted || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  window.present.key(event.key, event.shiftKey);
});

// Clique fora do deck (nas barras pretas) avança, como no PowerPoint.
document.addEventListener('click', (event) => {
  if (!event.isTrusted || event.button !== 0) return;
  window.present.key(event.clientX < window.innerWidth * 0.3 ? 'ArrowLeft' : 'ArrowRight', false);
});

window.present.onIndex((index) => frame.goTo(index));

window.present.onBlank((mode) => {
  blank.hidden = !mode;
  blank.className = mode || '';
});

window.present.onReload(async ({ deckUrl, index }) => {
  await frame.load(deckUrl, index);
  frame.goTo(index);
});

(async function boot() {
  const session = await window.present.session();
  if (!session) return;

  await frame.load(session.deckUrl, session.index);
  frame.goTo(session.index);

  if (!session.onSecondScreen && session.displayCount < 2) {
    showHint('Só foi detetado um ecrã — mova esta janela para o projetor e prima F11.', 8000);
  }
})();
