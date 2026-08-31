'use strict';

const path = require('path');
const { BrowserWindow, screen } = require('electron');

const PRELOAD = (name) => path.join(__dirname, '..', 'preload', `${name}.js`);

const baseWebPreferences = (name) => ({
  preload: PRELOAD(name),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  spellcheck: false,
});

function createLauncher(origin) {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    title: 'Apresentações HTML',
    backgroundColor: '#12101a',
    show: false,
    webPreferences: baseWebPreferences('launcher'),
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.loadURL(`${origin}/ui/launcher/index.html`);
  return win;
}

function createPresenter(origin) {
  const area = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    x: area.x + 20,
    y: area.y + 20,
    width: Math.min(1400, area.width - 40),
    height: Math.min(900, area.height - 40),
    minWidth: 900,
    minHeight: 560,
    title: 'Vista do apresentador',
    backgroundColor: '#0b0a10',
    show: false,
    webPreferences: baseWebPreferences('presenter'),
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.loadURL(`${origin}/ui/presenter/index.html`);
  return win;
}

/**
 * Escolhe o ecrã para o slide: o primeiro que não seja o principal.
 * Devolve null quando só existe um monitor.
 */
function secondaryDisplay() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().find((d) => d.id !== primary.id) || null;
}

function createDisplay(origin) {
  const target = secondaryDisplay();
  const bounds = (target || screen.getPrimaryDisplay()).bounds;

  const win = new BrowserWindow({
    // Posicionar dentro do ecrã de destino ANTES de pôr fullscreen — é o que
    // decide em que monitor o fullscreen acontece.
    x: bounds.x + (target ? 0 : 80),
    y: bounds.y + (target ? 0 : 80),
    width: target ? bounds.width : Math.min(1280, bounds.width - 160),
    height: target ? bounds.height : Math.min(720, bounds.height - 160),
    title: 'Apresentação',
    backgroundColor: '#000000',
    frame: !target,
    fullscreen: Boolean(target),
    show: false,
    webPreferences: baseWebPreferences('display'),
  });
  win.removeMenu();
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.loadURL(`${origin}/ui/display/index.html`);
  win.__onSecondScreen = Boolean(target);
  return win;
}

/** Move a janela do slide para o ecrã seguinte e põe-na em fullscreen. */
function moveToNextDisplay(win) {
  const displays = screen.getAllDisplays();
  if (displays.length < 2) return false;

  const current = screen.getDisplayMatching(win.getBounds());
  const next = displays[(displays.findIndex((d) => d.id === current.id) + 1) % displays.length];

  win.setFullScreen(false);
  win.setBounds(next.bounds);
  win.setFullScreen(true);
  win.__onSecondScreen = next.id !== screen.getPrimaryDisplay().id;
  return true;
}

module.exports = { createLauncher, createPresenter, createDisplay, moveToNextDisplay, secondaryDisplay };
