'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('present', {
  session: () => ipcRenderer.invoke('present:session'),
  goTo: (index) => ipcRenderer.send('deck:goto', index),
  stop: () => ipcRenderer.send('present:stop'),
  moveDisplay: () => ipcRenderer.invoke('display:move'),
  setPath: (path) => ipcRenderer.send('present:setPath', path),
  blank: (mode) => ipcRenderer.send('display:blank', mode),
  onIndex: (fn) => ipcRenderer.on('deck:index', (_e, index) => fn(index)),
  onKey: (fn) => ipcRenderer.on('deck:key', (_e, payload) => fn(payload)),
  onReload: (fn) => ipcRenderer.on('deck:reload', (_e, payload) => fn(payload)),
});
