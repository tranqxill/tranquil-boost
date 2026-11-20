'use strict';
// The only bridge between the window and the system. The window can ask for
// named actions; it can never send a command or a file path of its own.
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('boost', {
  info: call('app:info'),
  setSetting: call('app:setSetting'),

  tweaks: {
    list: call('tweaks:list'),
    status: call('tweaks:status'),
    apply: call('tweaks:apply'),
    applyMany: call('tweaks:applyMany'),
    undo: call('tweaks:undo'),
    undoAll: call('tweaks:undoAll'),
  },
  restorePoint: call('restorePoint:create'),
  openRestore: call('open:restoreUi'),

  cleanup: { list: call('cleanup:list'), scan: call('cleanup:scan'), clean: call('cleanup:clean') },
  startup: { scan: call('startup:scan'), set: call('startup:set') },
  net: {
    dns: call('net:dns'),
    setDns: call('net:setDns'),
    restoreDns: call('net:restoreDns'),
    dnsTest: call('net:dnsTest'),
    ping: call('net:ping'),
    flush: call('net:flush'),
  },
  stats: { sample: call('stats:sample'), info: call('stats:info') },
  win: {
    minimize: call('win:minimize'),
    maximize: call('win:maximize'),
    close: call('win:close'),
    onMaximized: (cb) => ipcRenderer.on('win:maximized', (_e, v) => cb(!!v)),
  },
});
