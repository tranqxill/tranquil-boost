'use strict';
// Fake backend so the UI can be previewed in a normal browser (no Windows needed).
(() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const TWEAKS = [
    ['power-plan', 'fps', 'High performance power plan', 'Switches to Ultimate Performance (or High Performance if your PC doesn\'t have it) so your CPU stops dropping its clock speed mid-game. Uses more power, so maybe skip it on a laptop running on battery.', true, 'now'],
    ['game-mode', 'fps', 'Windows Game Mode', 'Makes sure Windows Game Mode is on. It gives the game you\'re playing priority and holds off Windows Update restarts while you play.', true, 'now'],
    ['game-dvr', 'fps', 'Turn off background game recording', 'Stops Xbox Game Bar from recording gameplay in the background, which costs FPS. Game Bar itself still opens with Win+G.', true, 'signout'],
    ['hags', 'fps', 'Hardware-accelerated GPU scheduling', 'Lets your graphics card manage its own memory instead of Windows. Can lower latency on newer GPUs (GTX 10 series / RX 5000 and up). Needs a restart.', false, 'restart'],
    ['game-priority', 'fps', 'Give games more CPU priority', 'Tells Windows to save less CPU time for background tasks and to put games first when they ask for it.', true, 'restart'],
    ['mouse-accel', 'fps', 'Turn off mouse acceleration', 'Same as unticking "Enhance pointer precision". Your aim moves the same distance no matter how fast you flick. Takes effect after you sign out.', true, 'signout'],
    ['network-throttling', 'network', 'Turn off network throttling', 'Windows limits network traffic while media is playing. This removes that limit so music or videos in the background don\'t mess with your ping.', true, 'restart'],
    ['nagle', 'network', 'Turn off Nagle\'s algorithm', 'Windows sometimes holds small packets back to send them in groups. This sends them straight away, which can help ping in some online games.', true, 'restart'],
    ['ad-id', 'privacy', 'Turn off advertising ID', 'Stops apps from using your Windows advertising ID to show you targeted ads.', true, 'now'],
    ['start-ads', 'privacy', 'Remove suggestions and ads in Windows', 'Gets rid of "suggested" apps in Start, tips in Settings, and stops Windows from quietly installing promoted apps.', true, 'signout'],
  ].map(([id, cat, title, desc, recommended, effect]) => ({ id, cat, title, desc, recommended, effect }));

  const status = {};
  TWEAKS.forEach((t, i) => { status[t.id] = { state: i % 3 === 0 ? 'on' : 'off', ours: i % 3 === 0 && i > 0 }; });
  status['game-mode'] = { state: 'on', ours: false };

  let cpu = 18;
  window.boost = {
    info: async () => ({ version: '0.1.0', admin: true, settings: { restorePointBeforeApply: true } }),
    setSetting: async (k, v) => ({ restorePointBeforeApply: v }),
    tweaks: {
      list: async () => TWEAKS,
      status: async () => { await wait(300); return JSON.parse(JSON.stringify(status)); },
      apply: async (id) => { await wait(500); status[id] = { state: 'on', ours: true }; return { effect: TWEAKS.find((t) => t.id === id).effect }; },
      applyMany: async (ids) => { await wait(800); ids.forEach((id) => { status[id] = { state: 'on', ours: true }; }); return { done: ids.map((id) => ({ id, effect: 'restart' })), failed: [] }; },
      undo: async (id) => { await wait(400); status[id] = { state: 'off', ours: false }; return { effect: 'now' }; },
      undoAll: async () => ({ failed: [] }),
    },
    restorePoint: async () => { await wait(800); return { ok: true, reason: 'created' }; },
    openRestore: async () => {},
    cleanup: {
      list: async () => [
        { id: 'user-temp', title: 'Your temp files', desc: 'Leftovers from installers and apps.', defaultOn: true },
        { id: 'win-temp', title: 'Windows temp files', desc: 'Temp files Windows itself left behind.', defaultOn: true },
        { id: 'crash-dumps', title: 'Crash dumps', desc: 'Reports saved when apps or Windows crashed. Only useful if you\'re sending them to someone.', defaultOn: true },
        { id: 'wu-cache', title: 'Windows Update downloads', desc: 'Update files that were already installed.', defaultOn: true },
        { id: 'do-cache', title: 'Delivery Optimization cache', desc: 'Update pieces Windows keeps to share with other PCs.', defaultOn: true },
        { id: 'shader-cache', title: 'Shader caches (DirectX / NVIDIA / AMD)', desc: 'Clears saved shaders. Fixes some stutter and graphics glitches after driver updates, but games will rebuild them, so the first load or two can stutter.', defaultOn: false },
        { id: 'recycle-bin', title: 'Recycle Bin', desc: 'Empties the Recycle Bin. Those files are gone for good after this.', defaultOn: false },
      ],
      scan: async () => { await wait(600); return { 'user-temp': { bytes: 2.4e9 }, 'win-temp': { bytes: 3.1e8 }, 'crash-dumps': { bytes: 8.8e7 }, 'wu-cache': { bytes: 1.2e9 }, 'do-cache': { bytes: 6.4e8 }, 'shader-cache': { bytes: 9.1e8 }, 'recycle-bin': { bytes: 4.2e8 } }; },
      clean: async () => { await wait(800); return { freed: 4.5e9 }; },
    },
    startup: {
      scan: async () => { await wait(400); return [
        { id: 'a', label: 'Discord', company: 'Discord Inc.', scope: 'You', command: 'C:\\Users\\you\\AppData\\Local\\Discord\\Update.exe --processStart Discord.exe', enabled: true },
        { id: 'b', label: 'Steam', company: 'Valve Corporation', scope: 'You', command: '"C:\\Program Files (x86)\\Steam\\steam.exe" -silent', enabled: true },
        { id: 'c', label: 'Spotify', company: 'Spotify Ltd', scope: 'You', command: 'C:\\Users\\you\\AppData\\Roaming\\Spotify\\Spotify.exe /minimized', enabled: false },
        { id: 'd', label: 'Medal', company: 'Medal B.V.', scope: 'You', command: 'C:\\Users\\you\\AppData\\Local\\Medal\\update.exe', enabled: true },
        { id: 'e', label: 'NVIDIA app', company: 'NVIDIA Corporation', scope: 'All users', command: 'C:\\Program Files\\NVIDIA Corporation\\NVIDIA app\\CEF\\NVIDIA app.exe', enabled: true },
      ]; },
      set: async () => { await wait(300); return { ok: true }; },
    },
    net: {
      dns: async () => { await wait(300); return { current: 'auto', hasBackup: false, presets: [
        { id: 'auto', title: 'Automatic', desc: 'Whatever your router hands out. This is the Windows default.' },
        { id: 'cloudflare', title: 'Cloudflare', desc: 'Usually the fastest. Doesn\'t log your IP.' },
        { id: 'google', title: 'Google', desc: 'Fast and reliable pretty much everywhere.' },
        { id: 'quad9', title: 'Quad9', desc: 'Blocks known malware and scam sites.' },
      ] }; },
      setDns: async () => { await wait(500); return { ok: true }; },
      restoreDns: async () => ({ ok: true }),
      dnsTest: async () => { await wait(900); return [{ id: 'current', ms: 31 }, { id: 'cloudflare', ms: 12 }, { id: 'google', ms: 19 }, { id: 'quad9', ms: 24 }]; },
      ping: async () => { await wait(1200); return [{ host: '1.1.1.1', avg: 14, jitter: 1.8, loss: 0 }, { host: '8.8.8.8', avg: 18, jitter: 2.4, loss: 0 }]; },
      flush: async () => ({ ok: true }),
    },
    proc: {
      list: async () => { await wait(500); return [
        { key: 'chrome', label: 'Google Chrome', exe: 'chrome', count: 23, mem: 2.9e9, cpu: 4.1, tier: 'ask', why: 'Closes every tab in this browser.' },
        { key: 'discord', label: 'Discord', exe: 'Discord', count: 6, mem: 7.1e8, cpu: 0.8, tier: 'ask', why: 'You\'ll drop out of any voice call.' },
        { key: 'medal', label: 'Medal', exe: 'Medal', count: 3, mem: 5.2e8, cpu: 1.6, tier: 'ask', why: 'Clips won\'t record until you open it again.' },
        { key: 'onedrive', label: 'OneDrive', exe: 'OneDrive', count: 1, mem: 1.4e8, cpu: 0.2, tier: 'safe', why: 'Stops syncing until you open it again.' },
        { key: 'epicgameslauncher', label: 'Epic Games Launcher', exe: 'EpicGamesLauncher', count: 2, mem: 3.1e8, cpu: 0.4, tier: 'safe', why: 'Only needed while you\'re playing an Epic game.' },
        { key: 'widgets', label: 'Widgets', exe: 'Widgets', count: 2, mem: 1.1e8, cpu: 0, tier: 'safe', why: 'The widgets panel reloads next time you open it.' },
        { key: 'phoneexperiencehost', label: 'Phone Link', exe: 'PhoneExperienceHost', count: 1, mem: 9.0e7, cpu: 0, tier: 'safe', why: 'Phone notifications stop showing on your PC.' },
        { key: 'spotify', label: 'Spotify', exe: 'Spotify', count: 5, mem: 4.0e8, cpu: 0.6, tier: 'ask', why: 'Your music stops.' },
        { key: 'someapp', label: 'Some App', exe: 'someapp', count: 1, mem: 6.0e7, cpu: 0, tier: 'other', why: 'Not on our list. Only close it if you know what it is.' },
        { key: 'explorer', label: 'Windows Explorer', exe: 'explorer', count: 1, mem: 1.9e8, cpu: 0.3, tier: 'protected', why: '' },
      ]; },
      close: async (keys) => { await wait(800); return { closed: keys, freed: 6.5e8 }; },
      reopen: async () => ({ reopened: 2 }),
      closed: async () => ['onedrive'],
    },
    stats: {
      sample: async () => { cpu = Math.max(4, Math.min(95, cpu + (Math.random() - 0.5) * 18)); return { cpu: Math.round(cpu), ramUsed: 13.6e9, ramTotal: 34.2e9, gpu: { util: Math.round(30 + Math.random() * 40), temp: 61, vramUsed: 5200, vramTotal: 12288 }, uptime: 200000 }; },
      info: async () => ({ cpu: 'AMD Ryzen 7 7800X3D 8-Core Processor', threads: 16, ram: 34.2e9, os: 'Microsoft Windows 11 Home', build: '26100', gpus: ['NVIDIA GeForce RTX 4070'], diskFree: 412e9, diskUsed: 588e9 }),
    },
    update: { get: async () => ({ state: 'ready', version: '0.1.1' }), check: async () => ({ state: 'none' }), install: async () => {}, onStatus() {} },
    win: { minimize() {}, maximize() {}, close() {}, onMaximized() {} },
  };
})();
