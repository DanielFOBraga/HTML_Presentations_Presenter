'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('app', {
  // Desde o Electron 32 que File.path deixou de existir; é este o caminho.
  pathForFile: (file) => webUtils.getPathForFile(file),
  info: () => ipcRenderer.invoke('app:info'),
  recents: () => ipcRenderer.invoke('recents:list'),
  pickDeck: () => ipcRenderer.invoke('deck:pick'),
  inspect: (filePath) => ipcRenderer.invoke('deck:inspect', filePath),
  exportClean: (filePath) => ipcRenderer.invoke('deck:exportClean', filePath),
  reveal: (filePath) => ipcRenderer.invoke('deck:reveal', filePath),
  present: (filePath) => ipcRenderer.invoke('present:start', filePath),
});
