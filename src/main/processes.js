'use strict';
const ps = require('./ps');

// Never offered for closing. Killing these can crash Windows, break audio,
// input or networking, or trip a game's anti-cheat.
const PROTECTED = new Set([
  'system', 'idle', 'registry', 'memory compression', 'secure system', 'smss', 'csrss', 'wininit', 'winlogon',
  'services', 'lsass', 'lsaiso', 'svchost', 'dwm', 'explorer', 'fontdrvhost', 'sihost', 'ctfmon', 'taskhostw',
  'runtimebroker', 'searchhost', 'searchindexer', 'startmenuexperiencehost', 'shellexperiencehost', 'shellhost',
  'textinputhost', 'applicationframehost', 'systemsettings', 'lockapp', 'logonui', 'userinit', 'dllhost',
  'conhost', 'audiodg', 'wmiprvse', 'spoolsv', 'smartscreen', 'sgrmbroker', 'securityhealthservice',
  'securityhealthsystray', 'msmpeng', 'nissrv', 'mpdefendercoreservice', 'mpcmdrun', 'msseces',
  'wudfhost', 'dashost', 'unsecapp', 'wlanext', 'igfxem', 'igfxhk', 'igfxtray', 'rtkauduservice64', 'rtkaudioservice64',
  'nvdisplay.container', 'nvcontainer', 'nvidia web helper', 'amdrsserv', 'atiedxx', 'atieclxx', 'radeonsoftware',
  'easyanticheat', 'easyanticheat_eos', 'beservice', 'vgc', 'vgtray', 'faceitclient', 'faceitservice',
  'tranquil boost', 'powershell', 'pwsh', 'cmd', 'windowsterminal', 'openconsole', 'taskmgr', 'msiexec', 'trustedinstaller',
  'tiworker', 'usocoreworker', 'musnotification', 'gamebarpresencewriter', 'claude',
]);

// Known background apps. 'safe' ones get closed by one-click Boost.
// 'ask' ones are listed but left alone unless you pick them, because closing
// them has a side effect you might notice.
const KNOWN = [
  // Cloud sync / Microsoft extras
  { names: ['onedrive'], label: 'OneDrive', tier: 'safe', why: 'Stops syncing until you open it again.' },
  { names: ['googledrivefs'], label: 'Google Drive', tier: 'safe', why: 'Stops syncing until you open it again.' },
  { names: ['dropbox'], label: 'Dropbox', tier: 'safe', why: 'Stops syncing until you open it again.' },
  { names: ['icloudservices', 'icloudckks', 'icloudphotos', 'icloud'], label: 'iCloud', tier: 'safe', why: 'Stops syncing until you open it again.' },
  { names: ['ms-teams', 'teams', 'msteams'], label: 'Microsoft Teams', tier: 'safe', why: 'You won\'t get Teams messages until you open it.' },
  { names: ['skype', 'skypeapp', 'skypebackgroundhost'], label: 'Skype', tier: 'safe', why: 'You won\'t get Skype calls until you open it.' },
  { names: ['phoneexperiencehost', 'yourphone', 'yourphoneserver'], label: 'Phone Link', tier: 'safe', why: 'Phone notifications stop showing on your PC.' },
  { names: ['widgets', 'widgetservice'], label: 'Widgets', tier: 'safe', why: 'The widgets panel reloads next time you open it.' },
  { names: ['copilot'], label: 'Copilot', tier: 'safe', why: 'Closes the Copilot app.' },
  { names: ['crossdeviceresume', 'crossdeviceservice'], label: 'Cross-device features', tier: 'safe', why: 'Phone-to-PC resume pauses until next sign-in.' },
  { names: ['cortana'], label: 'Cortana', tier: 'safe', why: 'Closes Cortana.' },
  { names: ['gamebar', 'gamebarftserver'], label: 'Xbox Game Bar', tier: 'safe', why: 'Win+G still opens it again.' },
  // Launchers that sit in the tray
  { names: ['epicgameslauncher', 'epicwebhelper'], label: 'Epic Games Launcher', tier: 'safe', why: 'Only needed while you\'re playing an Epic game.' },
  { names: ['eadesktop', 'eabackgroundservice', 'origin', 'originwebhelperservice'], label: 'EA app', tier: 'safe', why: 'Only needed while you\'re playing an EA game.' },
  { names: ['upc', 'ubisoftconnect', 'ubisoftgamelauncher'], label: 'Ubisoft Connect', tier: 'safe', why: 'Only needed while you\'re playing a Ubisoft game.' },
  { names: ['galaxyclient', 'galaxyclient helper'], label: 'GOG Galaxy', tier: 'safe', why: 'Only needed while you\'re playing a GOG game.' },
  { names: ['steam', 'steamwebhelper'], label: 'Steam', tier: 'ask', why: 'Steam games need Steam running, so leave it open if you\'re about to play one.' },
  { names: ['battle.net'], label: 'Battle.net', tier: 'ask', why: 'Blizzard games need it running.' },
  { names: ['riotclientservices', 'riotclientux', 'riotclientuxrender'], label: 'Riot Client', tier: 'ask', why: 'Valorant and League need it running.' },
  // Updaters and helpers
  { names: ['adobeipcbroker', 'ccxprocess', 'creative cloud', 'coresync', 'adobe desktop service', 'acrocef', 'adobecollabsync', 'acrobatnotificationclient', 'adobe_licensing_wf_helper'], label: 'Adobe background apps', tier: 'safe', why: 'Creative Cloud starts again when you open an Adobe app.' },
  { names: ['jusched', 'jucheck'], label: 'Java updater', tier: 'safe', why: 'Only checks for Java updates.' },
  { names: ['hpprintscandoctor', 'hpsmartmonitor', 'hpsysinfo'], label: 'HP helpers', tier: 'safe', why: 'Printer and system helpers you don\'t need while gaming.' },
  { names: ['grammarly.desktop', 'grammarly'], label: 'Grammarly', tier: 'safe', why: 'Stops checking your typing until you open it.' },
  { names: ['zoom'], label: 'Zoom', tier: 'safe', why: 'Leaves any meeting you\'re in.' },
  { names: ['slack'], label: 'Slack', tier: 'safe', why: 'You won\'t get Slack messages until you open it.' },
  { names: ['overwolf', 'overwolfbrowser', 'overwolfhelper', 'overwolfhelper64'], label: 'Overwolf', tier: 'ask', why: 'Its in-game overlays stop working.' },
  // Things you might be using right now
  { names: ['discord'], label: 'Discord', tier: 'ask', why: 'You\'ll drop out of any voice call.' },
  { names: ['spotify'], label: 'Spotify', tier: 'ask', why: 'Your music stops.' },
  { names: ['chrome', 'msedge', 'firefox', 'opera', 'opera_gx', 'brave', 'vivaldi'], label: null, tier: 'ask', why: 'Closes every tab in this browser.' },
  { names: ['msedgewebview2'], label: 'Edge WebView', tier: 'ask', why: 'Some apps use this to draw their window and may need restarting.' },
  { names: ['medal', 'medalencoder'], label: 'Medal', tier: 'ask', why: 'Clips won\'t record until you open it again.' },
  { names: ['nvidia overlay', 'nvidia share', 'nvidia app'], label: 'NVIDIA overlay', tier: 'ask', why: 'Instant Replay and the Alt+Z overlay stop until it restarts.' },
  { names: ['obs64', 'obs32'], label: 'OBS Studio', tier: 'ask', why: 'Stops any recording or stream.' },
  { names: ['razer synapse', 'razer synapse 3', 'razercentral', 'razer synapse service process', 'rzsynapse'], label: 'Razer Synapse', tier: 'ask', why: 'Custom lighting and macros may stop working.' },
  { names: ['icue', 'corsair.service', 'icue.service'], label: 'Corsair iCUE', tier: 'ask', why: 'Custom lighting and macros may stop working.' },
  { names: ['lghub', 'lghub_agent', 'lghub_system_tray'], label: 'Logitech G HUB', tier: 'ask', why: 'Custom DPI and macros may stop working.' },
  { names: ['steelseriesgg', 'steelseriesengine', 'steelseriesggclient'], label: 'SteelSeries GG', tier: 'ask', why: 'Custom settings and macros may stop working.' },
  { names: ['ngenuity', 'hyperxngenuity'], label: 'HyperX NGENUITY', tier: 'ask', why: 'Custom lighting and macros may stop working.' },
  { names: ['wallpaper32', 'wallpaper64', 'webwallpaper32'], label: 'Wallpaper Engine', tier: 'safe', why: 'Your animated wallpaper stops. It usually pauses in games anyway.' },
  { names: ['lively'], label: 'Lively Wallpaper', tier: 'safe', why: 'Your animated wallpaper stops.' },
];

const knownByName = new Map();
for (const k of KNOWN) for (const n of k.names) knownByName.set(n, k);

let lastList = new Map(); // name -> { pids, path }
const closedThisSession = new Map(); // name -> path

async function list() {
  const raw = await ps.runJson(`
    $me = [Diagnostics.Process]::GetCurrentProcess().SessionId
    $a = @{}
    foreach ($p in Get-Process) { try { $a[$p.Id] = $p.TotalProcessorTime.TotalMilliseconds } catch {} }
    Start-Sleep -Milliseconds 1000
    $cores = [Environment]::ProcessorCount
    $out = @()
    foreach ($p in Get-Process) {
      if ($p.SessionId -eq 0) { continue }
      $cpu = 0
      try { if ($a.ContainsKey($p.Id)) { $cpu = ($p.TotalProcessorTime.TotalMilliseconds - $a[$p.Id]) / 10 / $cores } } catch {}
      $path = $null; $company = $null; $desc = $null
      try { $path = $p.Path; $company = $p.Company; $desc = $p.Description } catch {}
      $out += @{ id = $p.Id; name = $p.ProcessName; mem = [long]$p.WorkingSet64; cpu = [math]::Round([math]::Max(0, $cpu), 1); path = $path; company = $company; desc = $desc; title = $p.MainWindowTitle }
    }
    ,$out
  `, { timeout: 30000 });

  const groups = new Map();
  for (const p of Array.isArray(raw) ? raw : raw ? [raw] : []) {
    const key = String(p.name || '').toLowerCase();
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = { name: p.name, key, pids: [], mem: 0, cpu: 0, path: p.path, company: p.company, desc: p.desc, windows: 0 };
      groups.set(key, g);
    }
    g.pids.push(p.id);
    g.mem += p.mem || 0;
    g.cpu += p.cpu || 0;
    if (p.title) g.windows++;
    if (!g.path && p.path) g.path = p.path;
    if (!g.desc && p.desc) g.desc = p.desc;
    if (!g.company && p.company) g.company = p.company;
  }

  const out = [];
  for (const g of groups.values()) {
    const sysPath = g.path && /^[a-z]:\\windows\\/i.test(g.path) && !/\\systemapps\\|\\windowsapps\\/i.test(g.path);
    const known = knownByName.get(g.key);
    let tier = 'other';
    if (PROTECTED.has(g.key) || sysPath) tier = 'protected';
    else if (known) tier = known.tier;
    // Our own app and its helper processes.
    if (g.path && /tranquil boost/i.test(g.path)) tier = 'protected';
    out.push({
      key: g.key,
      label: (known && known.label) || g.desc || g.name,
      exe: g.name,
      company: g.company || null,
      count: g.pids.length,
      mem: g.mem,
      cpu: Math.round(g.cpu * 10) / 10,
      tier,
      why: known ? known.why : tier === 'protected' ? 'Part of Windows, your drivers, security, or anti-cheat. Closing it could crash something.' : 'Not on our list. Only close it if you know what it is.',
      hasWindow: g.windows > 0,
    });
  }
  out.sort((a, b) => b.mem - a.mem);
  lastList = new Map([...groups.values()].map((g) => [g.key, { pids: g.pids, path: g.path }]));
  return out;
}

// Closes every process with the given names. Protected names are refused here
// as well, not just hidden in the window.
async function close(keys) {
  const picked = [];
  for (const k of (Array.isArray(keys) ? keys : []).map((x) => String(x).toLowerCase())) {
    if (PROTECTED.has(k)) continue;
    const g = lastList.get(k);
    if (!g) continue;
    if (g.path && (/^[a-z]:\\windows\\/i.test(g.path) && !/\\systemapps\\|\\windowsapps\\/i.test(g.path))) continue;
    if (g.path && /tranquil boost/i.test(g.path)) continue;
    picked.push({ key: k, pids: g.pids, path: g.path || null });
  }
  if (!picked.length) return { closed: [], freed: 0 };
  const res = await ps.runJson(`
    $freed = [long]0
    $closed = @()
    foreach ($g in @(${ps.jsonArg(picked)})) {
      $procs = @(Get-Process -Id @($g.pids) -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName.ToLower() -eq $g.key })
      if ($procs.Count -eq 0) { continue }
      $mem = ($procs | Measure-Object WorkingSet64 -Sum).Sum
      foreach ($p in $procs) { try { [void]$p.CloseMainWindow() } catch {} }
      Start-Sleep -Milliseconds 1200
      foreach ($p in $procs) { try { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction Stop } } catch {} }
      $freed += $mem
      $closed += $g.key
    }
    @{ freed = $freed; closed = @($closed) }
  `, { timeout: 60000 });
  const closed = [].concat(res.closed || []);
  for (const k of closed) {
    const g = picked.find((x) => x.key === k);
    if (g && g.path) closedThisSession.set(k, g.path);
  }
  return { closed, freed: res.freed || 0 };
}

async function boost() {
  const all = await list();
  const keys = all.filter((p) => p.tier === 'safe').map((p) => p.key);
  const r = await close(keys);
  return { ...r, list: await list() };
}

function closedList() {
  return [...closedThisSession.keys()];
}

// Reopens apps closed this session. They're started through Explorer so they
// run as you, not as admin like this app does.
async function reopen() {
  const items = [...closedThisSession.entries()].map(([key, path]) => ({ key, path }));
  if (!items.length) return { reopened: 0 };
  await ps.run(`
    foreach ($i in @(${ps.jsonArg(items)})) {
      if ($i.path -and (Test-Path -LiteralPath $i.path)) {
        if (-not (Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($i.path)) -ErrorAction SilentlyContinue)) {
          Start-Process -FilePath "$env:SystemRoot\\explorer.exe" -ArgumentList ('"' + $i.path + '"')
        }
      }
    }
  `);
  const n = items.length;
  closedThisSession.clear();
  return { reopened: n };
}

module.exports = { list, close, boost, reopen, closedList };
