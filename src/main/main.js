'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require('electron');

const bundle = require('../core/bundle');
const transform = require('../core/transform');
const unpack = require('../core/unpack');
const { exportClean } = require('../core/export-clean');
const server = require('./server');
const windows = require('./windows');

const RENDERER_ROOT = path.join(__dirname, '..', 'renderer');

let http = null;
let launcherWin = null;
let cacheRoot = null;

/** Sessão de apresentação em curso, ou null. */
let session = null;

// ---------------------------------------------------------------- recentes

const recentsFile = () => path.join(app.getPath('userData'), 'recentes.json');

function readRecents() {
  try {
    const list = JSON.parse(fs.readFileSync(recentsFile(), 'utf8'));
    return Array.isArray(list) ? list.filter((r) => r && fs.existsSync(r.filePath)) : [];
  } catch {
    return [];
  }
}

function rememberRecent(filePath) {
  const entry = { filePath, name: path.basename(filePath), openedAt: Date.now() };
  const list = [entry, ...readRecents().filter((r) => r.filePath !== filePath)].slice(0, 12);
  try {
    fs.mkdirSync(path.dirname(recentsFile()), { recursive: true });
    fs.writeFileSync(recentsFile(), JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.warn('[recentes] não foi possível gravar:', err.message);
  }
  return list;
}

// ------------------------------------------------------------------ sessão

function inspect(filePath) {
  const deck = bundle.read(filePath);
  return {
    filePath,
    name: path.basename(filePath),
    kind: deck.kind,
    innerKind: deck.innerKind,
    hasRail: transform.hasRail(deck.template),
    isClean: transform.isClean(deck.template),
  };
}

function endSession({ showLauncher = true } = {}) {
  const current = session;
  session = null;
  if (current) {
    for (const win of [current.presenterWin, current.displayWin]) {
      if (win && !win.isDestroyed()) win.destroy();
    }
  }
  if (http) http.setDeckDir(null);
  if (showLauncher && launcherWin && !launcherWin.isDestroyed()) {
    launcherWin.show();
    launcherWin.focus();
  }
}

async function startSession(filePath) {
  endSession({ showLauncher: false });

  const info = inspect(filePath);
  const prepared = unpack.prepare(filePath, cacheRoot);
  http.setDeckDir(prepared.dir);
  rememberRecent(filePath);

  const presenterWin = windows.createPresenter(http.origin);
  const displayWin = windows.createDisplay(http.origin);

  session = { ...info, dir: prepared.dir, presenterWin, displayWin, index: 0 };

  const onClosed = () => { if (session) endSession(); };
  presenterWin.once('closed', onClosed);
  displayWin.once('closed', onClosed);

  if (launcherWin && !launcherWin.isDestroyed()) launcherWin.hide();
  return { ok: true, ...info };
}

/** Envia uma mensagem à outra janela da sessão. */
function forward(fromWebContents, channel, payload) {
  if (!session) return;
  for (const win of [session.presenterWin, session.displayWin]) {
    if (!win || win.isDestroyed()) continue;
    if (win.webContents === fromWebContents) continue;
    win.webContents.send(channel, payload);
  }
}

// --------------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('app:info', () => ({
    origin: http.origin,
    displayCount: screen.getAllDisplays().length,
    hasSecondDisplay: Boolean(windows.secondaryDisplay()),
  }));

  ipcMain.handle('recents:list', () => readRecents());

  ipcMain.handle('deck:pick', async () => {
    const result = await dialog.showOpenDialog(launcherWin, {
      title: 'Escolher apresentação HTML',
      properties: ['openFile'],
      filters: [{ name: 'Apresentações HTML', extensions: ['html', 'htm'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return inspect(result.filePaths[0]);
  });

  ipcMain.handle('deck:inspect', (_e, filePath) => {
    try {
      return inspect(filePath);
    } catch (err) {
      return { filePath, error: err.message };
    }
  });

  ipcMain.handle('deck:exportClean', (_e, filePath) => {
    try {
      const result = exportClean(filePath);
      if (result.ok) shell.showItemInFolder(result.destPath);
      return result;
    } catch (err) {
      return { ok: false, reason: `Falhou a exportação: ${err.message}` };
    }
  });

  ipcMain.handle('deck:reveal', (_e, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('present:start', async (_e, filePath) => {
    try {
      return await startSession(filePath);
    } catch (err) {
      console.error('[apresentar] falhou:', err);
      endSession();
      return { ok: false, reason: `Não foi possível preparar a apresentação: ${err.message}` };
    }
  });

  ipcMain.handle('present:session', (event) => {
    if (!session) return null;
    const isDisplay = session.displayWin && !session.displayWin.isDestroyed()
      && session.displayWin.webContents === event.sender;
    return {
      name: session.name,
      filePath: session.filePath,
      innerKind: session.innerKind,
      deckUrl: '/deck/deck.html',
      index: session.index,
      role: isDisplay ? 'display' : 'presenter',
      onSecondScreen: Boolean(session.displayWin && session.displayWin.__onSecondScreen),
      displayCount: screen.getAllDisplays().length,
    };
  });

  ipcMain.on('present:stop', () => endSession());

  ipcMain.on('deck:goto', (event, index) => {
    if (!session) return;
    session.index = index;
    forward(event.sender, 'deck:index', index);
  });

  ipcMain.handle('display:move', () => {
    if (!session || !session.displayWin || session.displayWin.isDestroyed()) return false;
    const moved = windows.moveToNextDisplay(session.displayWin);
    return moved && session.displayWin.__onSecondScreen;
  });
}

// ---------------------------------------------------------------- lifecycle

app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  cacheRoot = path.join(app.getPath('temp'), 'apresentacoes-html');
  unpack.prune(cacheRoot);

  http = await server.start({ rendererRoot: RENDERER_ROOT });
  registerIpc();
  launcherWin = windows.createLauncher(http.origin);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      launcherWin = windows.createLauncher(http.origin);
    }
  });
});

app.on('before-quit', () => {
  if (http) http.close().catch(() => {});
});
