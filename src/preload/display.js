'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('present', {
  session: () => ipcRenderer.invoke('present:session'),
  goTo: (index) => ipcRenderer.send('deck:goto', index),
  key: (key, shiftKey) => ipcRenderer.send('deck:key', key, Boolean(shiftKey)),
  setPath: (path) => ipcRenderer.send('present:setPath', path),
  stop: () => ipcRenderer.send('present:stop'),
  onIndex: (fn) => ipcRenderer.on('deck:index', (_e, index) => fn(index)),
  onBlank: (fn) => ipcRenderer.on('display:blank', (_e, mode) => fn(mode)),
  onReload: (fn) => ipcRenderer.on('deck:reload', (_e, payload) => fn(payload)),
});
