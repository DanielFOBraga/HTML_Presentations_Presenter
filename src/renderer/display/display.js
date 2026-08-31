'use strict';

/** Janela do slide: um iframe a ocupar o ecrã, conduzido pelo apresentador. */

const hint = document.getElementById('hint');

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
  // O deck nunca navega sozinho (o agente intercepta as teclas), mas se
  // alguma coisa lá dentro mudar de slide, o apresentador tem de saber.
  onIndex: (index) => window.present.goTo(index),
  onKey: (event) => handleKey(event.key, event.shiftKey),
});

function handleKey(key, shiftKey) {
  const total = frame.meta ? frame.meta.total : 0;
  const current = frame.api ? frame.api.index : 0;
  let next = null;

  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Spacebar', 'Enter'].includes(key)) next = current + 1;
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(key)) next = current - 1;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = total - 1;
  else if (key === 'Escape') { window.present.stop(); return; }
  else return;

  if (shiftKey && (key === ' ' || key === 'Spacebar')) next = current - 1;

  next = Math.max(0, Math.min(total - 1, next));
  frame.goTo(next);
  window.present.goTo(next);
}

window.addEventListener('keydown', (event) => {
  if (!event.isTrusted) return;
  handleKey(event.key, event.shiftKey);
});

window.present.onIndex((index) => frame.goTo(index));

(async function boot() {
  const session = await window.present.session();
  if (!session) return;

  await frame.load(session.deckUrl, session.index);
  frame.goTo(session.index);

  if (!session.onSecondScreen && session.displayCount < 2) {
    showHint('Só foi detetado um ecrã — mova esta janela para o projetor e prima F11.', 8000);
  }
})();
