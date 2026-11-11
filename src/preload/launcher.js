'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('app', {
  // Desde o Electron 32 que File.path deixou de existir; é este o caminho.
  pathForFile: (file) => webUtils.getPathForFile(file),
  info: () => ipcRenderer.invoke('app:info'),
  recents: () => ipcRenderer.invoke('recents:list'),
  library: () => ipcRenderer.invoke('library:get'),
  pickLibrary: () => ipcRenderer.invoke('library:pick'),
  initialFile: () => ipcRenderer.invoke('launcher:initialFile'),
  onOpenFile: (fn) => ipcRenderer.on('launcher:open', (_e, filePath) => fn(filePath)),
  pickDeck: () => ipcRenderer.invoke('deck:pick'),
  inspect: (filePath) => ipcRenderer.invoke('deck:inspect', filePath),
  exportClean: (filePath) => ipcRenderer.invoke('deck:exportClean', filePath),
  reveal: (filePath) => ipcRenderer.invoke('deck:reveal', filePath),
  present: (filePath, options) => ipcRenderer.invoke('present:start', filePath, options),
});
