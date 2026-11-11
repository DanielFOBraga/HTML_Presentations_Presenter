'use strict';

/**
 * Vista do apresentador. É esta janela que manda: guarda o índice, conduz os
 * seus dois iframes e avisa a janela do slide pelo processo principal. As
 * teclas carregadas na janela do slide também vêm parar aqui (`deck:key`),
 * para que toda a lógica do teclado viva num sítio só.
 */

const $ = (id) => document.getElementById(id);

const els = {
  name: $('deck-name'),
  position: $('position'),
  pathBox: $('path-box'),
  path: $('path'),
  prev: $('prev'),
  next: $('next'),
  timer: $('timer'),
  clock: $('clock'),
  toggleGrid: $('toggle-grid'),
  black: $('black'),
  move: $('move'),
  stop: $('stop'),
  currentBox: $('current-box'),
  blankCard: $('blank-card'),
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
let blank = null;          // null | 'black' | 'white'
let typed = '';            // número do slide a ser escrito (N + Enter)
let typedTimer = null;

const currentFrame = new window.DeckFrame($('current-frame'), {
  onKey: (e) => onKey(e.key, e.shiftKey),
  onPath: (p) => window.present.setPath(p),
});
const nextFrame = new window.DeckFrame($('next-frame'), { onKey: (e) => onKey(e.key, e.shiftKey) });
const grid = new window.ThumbGrid(els.grid, { onPick: (i) => goTo(i) });

const gotoBox = document.createElement('div');
gotoBox.className = 'goto';
gotoBox.hidden = true;
document.body.appendChild(gotoBox);

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

// ------------------------------------------------- ecrã preto / branco (B/W)

function setBlank(mode) {
  blank = mode || null;
  window.present.blank(blank);
  els.black.classList.toggle('on', blank === 'black');
  els.blankCard.hidden = !blank;
  els.blankCard.className = `blank-card ${blank === 'white' ? 'white' : ''}`.trim();
  els.blankCard.textContent = blank === 'white' ? 'Ecrã branco no projetor' : 'Ecrã preto no projetor';
}

// ----------------------------------------------------- número + Enter (N ↵)

function setTyped(value) {
  typed = value;
  clearTimeout(typedTimer);
  gotoBox.hidden = !typed;
  if (!typed) return;
  const n = parseInt(typed, 10);
  const valid = n >= 1 && n <= total;
  gotoBox.textContent = valid ? `Ir para o slide ${n} ↵` : `Slide ${typed}?`;
  typedTimer = setTimeout(() => setTyped(''), 3000);
}

// ------------------------------------------------------------------ teclado

const NEXT_KEYS = ['ArrowRight', 'ArrowDown', 'PageDown', 'Enter', 'n', 'N'];
const PREV_KEYS = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'];

/**
 * Atalhos do modo de apresentação do PowerPoint:
 *   → ↓ PgDn Enter Espaço N   seguinte        ← ↑ PgUp Backspace P   anterior
 *   Home / End                primeiro/último  número + Enter          ir para o slide
 *   B ou .   ecrã preto        W ou ,   ecrã branco     Esc   terminar
 *   G   grelha de slides
 * Com o ecrã em branco/preto, a primeira tecla de navegação só o desliga.
 */
function onKey(key, shiftKey) {
  if (/^[0-9]$/.test(key)) { setTyped((typed + key).slice(-4)); return true; }

  if (key === 'Enter' && typed) {
    const n = parseInt(typed, 10);
    setTyped('');
    if (n >= 1 && n <= total) { setBlank(null); goTo(n - 1); }
    return true;
  }
  if (typed && key === 'Backspace') { setTyped(typed.slice(0, -1)); return true; }
  if (typed && key !== 'Escape') setTyped('');

  if (key === 'b' || key === 'B' || key === '.') { setBlank(blank === 'black' ? null : 'black'); return true; }
  if (key === 'w' || key === 'W' || key === ',') { setBlank(blank === 'white' ? null : 'white'); return true; }

  const isNav = NEXT_KEYS.includes(key) || PREV_KEYS.includes(key)
    || key === ' ' || key === 'Spacebar' || key === 'Home' || key === 'End';
  if (blank && isNav) { setBlank(null); return true; }

  if (NEXT_KEYS.includes(key)) goTo(index + 1);
  else if (key === ' ' || key === 'Spacebar') goTo(shiftKey ? index - 1 : index + 1);
  else if (PREV_KEYS.includes(key)) goTo(index - 1);
  else if (key === 'Home') goTo(0);
  else if (key === 'End') goTo(total - 1);
  else if (key === 'Escape') {
    if (typed) setTyped('');
    else if (blank) setBlank(null);
    else if (!els.gridPanel.hidden) setGrid(false);
    else window.present.stop();
  } else if (key === 'g' || key === 'G') setGrid(els.gridPanel.hidden);
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

// ---------------------------------------------------------------- percursos

function renderPaths(paths, current) {
  els.pathBox.hidden = !paths;
  if (!paths) return;
  els.path.innerHTML = '';
  for (const option of paths.options) {
    const el = document.createElement('option');
    el.value = option.id;
    el.textContent = option.label;
    els.path.appendChild(el);
  }
  els.path.value = current;
}

/** (Re)carrega o deck nos dois iframes e reconstrói a grelha. */
async function loadDeck(url, startIndex) {
  deckUrl = url;
  meta = await currentFrame.load(deckUrl, startIndex);
  total = meta.total;
  index = Math.max(0, Math.min(total - 1, startIndex));

  // Proporção real do deck (1920×1080 no Claude Design, 1280×720 no Claude Code).
  const ratio = `${meta.design.width} / ${meta.design.height}`;
  els.currentBox.style.aspectRatio = ratio;
  els.nextBox.style.aspectRatio = ratio;

  await nextFrame.load(deckUrl, Math.min(index + 1, total - 1));

  grid.build(currentFrame);
  render();
}

// ------------------------------------------------------------------ eventos

els.prev.addEventListener('click', () => onKey('ArrowLeft'));
els.next.addEventListener('click', () => onKey('ArrowRight'));
els.toggleGrid.addEventListener('click', () => setGrid(els.gridPanel.hidden));
els.black.addEventListener('click', () => setBlank(blank === 'black' ? null : 'black'));
els.stop.addEventListener('click', () => window.present.stop());
els.path.addEventListener('change', () => window.present.setPath(els.path.value));

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
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return;
  if (onKey(event.key, event.shiftKey)) event.preventDefault();
});

// A janela do slide manda-nos as teclas e cliques dela.
window.present.onKey(({ key, shiftKey }) => onKey(key, shiftKey));

// Se o deck da janela do slide mudar por si, acompanhamos.
window.present.onIndex((i) => goTo(i, { broadcast: false }));

// Mudou o percurso (aqui ou no seletor desenhado no deck).
window.present.onReload(async ({ deckUrl: url, index: at, path }) => {
  els.path.value = path;
  const label = els.path.selectedOptions[0] ? els.path.selectedOptions[0].textContent : path;
  await loadDeck(url, at);
  toast(`Percurso: ${label}`);
});

// ------------------------------------------------------------------ arranque

(async function boot() {
  const session = await window.present.session();
  if (!session) return;

  els.name.textContent = session.name;
  renderPaths(session.paths, session.path);
  await loadDeck(session.deckUrl, session.index);

  if (!session.onSecondScreen && session.displayCount < 2) {
    toast('Só há um ecrã: a janela do slide abriu por cima. Ligue o projetor e use "Trocar ecrã".');
  }
})();
