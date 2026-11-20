'use strict';
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const { execFile } = require('child_process');

const { Store } = require('./store');
const { Engine } = require('./engine');
const cleanup = require('./cleanup');
const startup = require('./startup');
const network = require('./network');
const stats = require('./stats');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let store = null;
let engine = null;
let restorePointTried = false;

function isAdmin() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    execFile('net', ['session'], { windowsHide: true }, (err) => resolve(!err));
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 780,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0d1117',
    title: 'Tranquil Boost',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // The app only ever shows its own local page.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('maximize', () => win.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized', false));
}

// Only messages from our own window are accepted.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!win || event.sender !== win.webContents) throw new Error('Not allowed.');
    return fn(...args);
  });
}

async function maybeRestorePoint() {
  if (restorePointTried || !store.settings.restorePointBeforeApply) return null;
  restorePointTried = true;
  try { return await engine.createRestorePoint(); } catch (e) { return { ok: false, reason: 'off', message: e.message }; }
}

function registerIpc() {
  handle('app:info', async () => ({ version: app.getVersion(), admin: await isAdmin(), settings: store.settings }));
  handle('app:setSetting', (key, value) => {
    if (key !== 'restorePointBeforeApply') throw new Error('Unknown setting.');
    store.setSetting(key, !!value);
    return store.settings;
  });

  handle('tweaks:list', () => engine.list());
  handle('tweaks:status', () => engine.status());
  handle('tweaks:apply', async (id) => {
    const rp = await maybeRestorePoint();
    const res = await engine.apply(String(id));
    return { ...res, restorePoint: rp };
  });
  handle('tweaks:applyMany', async (ids) => {
    const rp = await maybeRestorePoint();
    const done = [], failed = [];
    for (const id of (Array.isArray(ids) ? ids : []).map(String)) {
      try { const r = await engine.apply(id); done.push({ id, effect: r.effect }); }
      catch (e) { failed.push({ id, error: e.message }); }
    }
    return { done, failed, restorePoint: rp };
  });
  handle('tweaks:undo', (id) => engine.undo(String(id)));
  handle('tweaks:undoAll', () => engine.undoAll());
  handle('restorePoint:create', () => engine.createRestorePoint());

  handle('cleanup:list', () => cleanup.list());
  handle('cleanup:scan', () => cleanup.scan());
  handle('cleanup:clean', async (ids) => { const r = await cleanup.clean(ids); stats.clearInfoCache(); return r; });

  handle('startup:scan', () => startup.scan());
  handle('startup:set', (id, enabled) => startup.setEnabled(String(id), !!enabled));

  handle('net:dns', () => network.dnsState(store));
  handle('net:setDns', (id) => network.setDns(store, String(id)));
  handle('net:restoreDns', () => network.restoreDns(store));
  handle('net:dnsTest', () => network.dnsSpeedTest());
  handle('net:ping', () => network.pingTest());
  handle('net:flush', () => network.flushDns());

  handle('stats:sample', () => stats.sample());
  handle('stats:info', () => stats.systemInfo());

  handle('win:minimize', () => win.minimize());
  handle('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  handle('win:close', () => win.close());
  handle('open:restoreUi', () => { execFile('rstrui.exe', [], { windowsHide: false }, () => {}); });
}

app.whenReady().then(() => {
  // Block every outside request. The app doesn't need the internet to work.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    cb({ cancel: !details.url.startsWith('file://') && !details.url.startsWith('devtools://') });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  store = new Store(path.join(app.getPath('userData'), 'tranquil-boost.json'));
  engine = new Engine(store);
  registerIpc();
  createWindow();
});

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.on('window-all-closed', () => app.quit());
