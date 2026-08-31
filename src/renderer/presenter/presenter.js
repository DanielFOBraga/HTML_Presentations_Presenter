'use strict';

/**
 * Vista do apresentador. É esta janela que manda: guarda o índice, conduz os
 * seus dois iframes e avisa a janela do slide pelo processo principal.
 */

const $ = (id) => document.getElementById(id);

const els = {
  name: $('deck-name'),
  position: $('position'),
  prev: $('prev'),
  next: $('next'),
  timer: $('timer'),
  clock: $('clock'),
  toggleGrid: $('toggle-grid'),
  move: $('move'),
  stop: $('stop'),
  currentBox: $('current-box'),
  nextBox: $('next-box'),
  nextEnd: $('next-end'),
  nextLabel: $('next-label'),
  notes: $('notes'),
  gridPanel: $('grid-panel'),
  grid: $('grid'),
  toast: $('toast'),
};

let index = 0;
let total = 0;
let meta = null;
let deckUrl = null;
let toastTimer = null;

const currentFrame = new window.DeckFrame($('current-frame'), { onKey: (e) => onKey(e.key, e.shiftKey) });
const nextFrame = new window.DeckFrame($('next-frame'), { onKey: (e) => onKey(e.key, e.shiftKey) });
const grid = new window.ThumbGrid(els.grid, { onPick: (i) => goTo(i) });

function toast(message, tone = '') {
  els.toast.textContent = message;
  els.toast.className = `toast ${tone}`.trim();
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 5000);
}

// ---------------------------------------------------------------- navegação

function render() {
  els.position.textContent = total ? `${index + 1} / ${total}` : '–';

  const notes = (meta && meta.notes && meta.notes[index]) || '';
  els.notes.textContent = notes || 'Sem notas para este slide.';
  els.notes.classList.toggle('empty', !notes);
  els.notes.scrollTop = 0;

  const isLast = index >= total - 1;
  els.nextEnd.hidden = !isLast;
  els.next.disabled = isLast;
  els.prev.disabled = index <= 0;

  const nextInfo = meta && meta.slides && meta.slides[index + 1];
  els.nextLabel.textContent = isLast ? '' : (nextInfo ? nextInfo.label : '');

  grid.setActive(index);
}

/** Navega localmente e avisa a janela do slide. */
function goTo(target, { broadcast = true } = {}) {
  const clamped = Math.max(0, Math.min(total - 1, target));
  if (clamped === index && total) { render(); return; }
  index = clamped;

  currentFrame.goTo(index);
  if (index < total - 1) nextFrame.goTo(index + 1);

  if (broadcast) window.present.goTo(index);
  startTimer();
  render();
}

function onKey(key, shiftKey) {
  if (['ArrowRight', 'ArrowDown', 'PageDown', 'Enter'].includes(key)) goTo(index + 1);
  else if ([' ', 'Spacebar'].includes(key)) goTo(shiftKey ? index - 1 : index + 1);
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(key)) goTo(index - 1);
  else if (key === 'Home') goTo(0);
  else if (key === 'End') goTo(total - 1);
  else if (key === 'Escape') window.present.stop();
  else if (key === 'g' || key === 'G') setGrid(els.gridPanel.hidden);
  else return false;
  return true;
}

// ------------------------------------------------------------- cronómetro

let startedAt = null;

function startTimer() {
  if (startedAt === null) {
    startedAt = Date.now();
    els.timer.classList.add('running');
  }
}

function tick() {
  const elapsed = startedAt === null ? 0 : Math.floor((Date.now() - startedAt) / 1000);
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const pad = (n) => String(n).padStart(2, '0');
  els.timer.textContent = hours
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;

  els.clock.textContent = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
}

setInterval(tick, 1000);
tick();

// ------------------------------------------------------------------ grelha

function setGrid(show) {
  els.gridPanel.hidden = !show;
  els.toggleGrid.classList.toggle('on', show);
  if (show) {
    grid.rescale();
    grid.setActive(index);
  }
}

// ------------------------------------------------------------------ eventos

els.prev.addEventListener('click', () => goTo(index - 1));
els.next.addEventListener('click', () => goTo(index + 1));
els.toggleGrid.addEventListener('click', () => setGrid(els.gridPanel.hidden));
els.stop.addEventListener('click', () => window.present.stop());

els.timer.addEventListener('click', () => {
  startedAt = null;
  els.timer.classList.remove('running');
  tick();
});

els.move.addEventListener('click', async () => {
  const onSecond = await window.present.moveDisplay();
  toast(onSecond === false
    ? 'Só foi detetado um ecrã — ligue o segundo monitor e tente outra vez.'
    : 'Slide movido para o outro ecrã.', onSecond === false ? 'warn' : '');
});

window.addEventListener('keydown', (event) => {
  if (!event.isTrusted) return;
  if (event.target instanceof HTMLElement && event.target.closest('input, textarea')) return;
  if (onKey(event.key, event.shiftKey)) event.preventDefault();
});

// A janela do slide também aceita teclas; quando é ela a mudar, acompanhamos.
window.present.onIndex((i) => goTo(i, { broadcast: false }));

// ------------------------------------------------------------------ arranque

(async function boot() {
  const session = await window.present.session();
  if (!session) return;

  deckUrl = session.deckUrl;
  index = session.index;
  els.name.textContent = session.name;

  meta = await currentFrame.load(deckUrl, index);
  total = meta.total;

  // Proporção real do deck (1920×1080 no Claude Design, 1280×720 no Claude Code).
  const ratio = `${meta.design.width} / ${meta.design.height}`;
  els.currentBox.style.aspectRatio = ratio;
  els.nextBox.style.aspectRatio = ratio;

  await nextFrame.load(deckUrl, Math.min(index + 1, total - 1));

  grid.build(currentFrame);
  render();

  if (!session.onSecondScreen && session.displayCount < 2) {
    toast('Só há um ecrã: a janela do slide abriu por cima. Ligue o projetor e use "Trocar ecrã".');
  }
})();
