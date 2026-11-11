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

// ------------------------------------------------------------- definições

const settingsFile = () => path.join(app.getPath('userData'), 'definicoes.json');

function readSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.warn('[definições] não foi possível gravar:', err.message);
  }
  return next;
}

// -------------------------------------------------------------- biblioteca

const isHtml = (name) => /\.html?$/i.test(name);

function listHtml(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && isHtml(e.name))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * Apresentações dentro da pasta escolhida. Segue a organização de projeto
 * (uma pasta por apresentação, com o ficheiro final em `standalone/`), mas
 * aceita também .html soltos na raiz ou na pasta de cada apresentação quando
 * essa não tem `standalone/`.
 */
function scanLibrary(root) {
  if (!root || !fs.existsSync(root)) return [];
  const found = listHtml(root).map((filePath) => ({ filePath, folder: '' }));

  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch { /* pasta ilegível: devolve o que houver */ }

  for (const dir of dirs) {
    const base = path.join(root, dir.name);
    const standalone = listHtml(path.join(base, 'standalone'));
    const files = standalone.length ? standalone : listHtml(base);
    for (const filePath of files) found.push({ filePath, folder: dir.name });
  }

  return found
    .map((item) => {
      let modifiedAt = 0;
      let size = 0;
      try {
        const st = fs.statSync(item.filePath);
        modifiedAt = st.mtimeMs;
        size = st.size;
      } catch { /* entretanto apagado */ }
      return { ...item, name: path.basename(item.filePath), modifiedAt, size };
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
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
    paths: transform.detectPaths(deck.template),
  };
}

/** URL do deck dentro do servidor, com o percurso escolhido (se houver). */
function deckUrlFor(current) {
  if (!current.paths || !current.path) return '/deck/deck.html';
  return `/deck/deck.html?${encodeURIComponent(current.paths.param)}=${encodeURIComponent(current.path)}`;
}

/** Percurso válido para este deck: o pedido, ou o primeiro. */
function pickPath(paths, wanted) {
  if (!paths) return null;
  return paths.options.some((o) => o.id === wanted) ? wanted : paths.options[0].id;
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

async function startSession(filePath, { path: wantedPath } = {}) {
  endSession({ showLauncher: false });

  const info = inspect(filePath);
  info.path = pickPath(info.paths, wantedPath);
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

  ipcMain.handle('library:get', () => {
    const { libraryDir = null } = readSettings();
    return { dir: libraryDir, items: scanLibrary(libraryDir) };
  });

  ipcMain.handle('library:pick', async () => {
    const result = await dialog.showOpenDialog(launcherWin, {
      title: 'Pasta com as apresentações',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const libraryDir = result.filePaths[0];
    writeSettings({ libraryDir });
    return { dir: libraryDir, items: scanLibrary(libraryDir) };
  });

  ipcMain.handle('launcher:initialFile', () => {
    const file = pendingFile;
    pendingFile = null;
    return file;
  });

  ipcMain.handle('present:start', async (_e, filePath, options) => {
    try {
      return await startSession(filePath, options || {});
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
      deckUrl: deckUrlFor(session),
      paths: session.paths,
      path: session.path,
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

  // Teclas e cliques na janela do slide: quem decide é o apresentador.
  ipcMain.on('deck:key', (event, key, shiftKey) => forward(event.sender, 'deck:key', { key, shiftKey }));

  // Ecrã preto/branco (B / W no PowerPoint).
  ipcMain.on('display:blank', (event, mode) => forward(event.sender, 'display:blank', mode || null));

  // Trocar de percurso a meio: as duas janelas recarregam o deck no novo URL.
  ipcMain.on('present:setPath', (_event, wanted) => {
    if (!session || !session.paths) return;
    const next = pickPath(session.paths, wanted);
    if (next === session.path) return;
    session.path = next;
    const payload = { path: next, deckUrl: deckUrlFor(session), index: session.index };
    for (const win of [session.presenterWin, session.displayWin]) {
      if (win && !win.isDestroyed()) win.webContents.send('deck:reload', payload);
    }
  });

  ipcMain.handle('display:move', () => {
    if (!session || !session.displayWin || session.displayWin.isDestroyed()) return false;
    const moved = windows.moveToNextDisplay(session.displayWin);
    return moved && session.displayWin.__onSecondScreen;
  });
}

// ---------------------------------------------------------------- lifecycle

/**
 * Ficheiro passado na linha de comandos — "Abrir com", ou arrastar um .html
 * para cima do executável. Fica à espera até o ecrã inicial o pedir.
 */
let pendingFile = null;

function fileFromArgv(argv) {
  const candidate = argv.slice(1).reverse().find((arg) => isHtml(arg) && !arg.startsWith('-'));
  return candidate && fs.existsSync(candidate) ? path.resolve(candidate) : null;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  pendingFile = fileFromArgv(process.argv);

  // Segunda instância (ex.: outro ficheiro aberto com a app já aberta): a
  // primeira recebe o ficheiro e vem para a frente.
  app.on('second-instance', (_event, argv) => {
    const file = fileFromArgv(argv);
    if (!launcherWin || launcherWin.isDestroyed()) return;
    if (file && !session) launcherWin.webContents.send('launcher:open', file);
    const front = session && session.presenterWin && !session.presenterWin.isDestroyed()
      ? session.presenterWin : launcherWin;
    if (front.isMinimized()) front.restore();
    front.show();
    front.focus();
  });
}

app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
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
