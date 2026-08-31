'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('present', {
  session: () => ipcRenderer.invoke('present:session'),
  goTo: (index) => ipcRenderer.send('deck:goto', index),
  stop: () => ipcRenderer.send('present:stop'),
  moveDisplay: () => ipcRenderer.invoke('display:move'),
  onIndex: (fn) => ipcRenderer.on('deck:index', (_e, index) => fn(index)),
});
