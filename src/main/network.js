'use strict';
const ps = require('./ps');

const DNS_PRESETS = [
  { id: 'auto', title: 'Automatic', desc: 'Whatever your router hands out. This is the Windows default.', servers: [] },
  { id: 'cloudflare', title: 'Cloudflare', desc: 'Usually the fastest. Doesn\'t log your IP.', servers: ['1.1.1.1', '1.0.0.1', '2606:4700:4700::1111', '2606:4700:4700::1001'] },
  { id: 'google', title: 'Google', desc: 'Fast and reliable pretty much everywhere.', servers: ['8.8.8.8', '8.8.4.4', '2001:4860:4860::8888', '2001:4860:4860::8844'] },
  { id: 'quad9', title: 'Quad9', desc: 'Blocks known malware and scam sites.', servers: ['9.9.9.9', '149.112.112.112', '2620:fe::fe', '2620:fe::9'] },
];
const presetById = new Map(DNS_PRESETS.map((p) => [p.id, p]));

const ADAPTERS = `
function Get-ActiveAdapters {
  @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' })
}
function Get-StaticDns($guid) {
  $v4 = (Get-ItemProperty -LiteralPath "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\$guid" -ErrorAction SilentlyContinue).NameServer
  $v6 = (Get-ItemProperty -LiteralPath "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters\\Interfaces\\$guid" -ErrorAction SilentlyContinue).NameServer
  $all = @()
  foreach ($s in @($v4, $v6)) { if ($s) { $all += ($s -split '[,\\s]+' | Where-Object { $_ }) } }
  return ,$all
}
`;

async function dnsState(store) {
  const res = await ps.runJson(`
    ${ADAPTERS}
    $out = @()
    foreach ($a in Get-ActiveAdapters) {
      $servers = @(Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue | ForEach-Object { $_.ServerAddresses })
      $out += @{ name = $a.Name; desc = $a.InterfaceDescription; servers = @($servers | Where-Object { $_ }); static = (Get-StaticDns $a.InterfaceGuid) }
    }
    ,$out
  `);
  const adapters = Array.isArray(res) ? res : res ? [res] : [];
  let current = 'custom';
  const allStatic = adapters.every((a) => !a.static || a.static.length === 0);
  if (adapters.length && allStatic) current = 'auto';
  for (const p of DNS_PRESETS) {
    if (p.id === 'auto') continue;
    if (adapters.length && adapters.every((a) => a.static && a.static.length && a.static.every((s) => p.servers.includes(s)))) current = p.id;
  }
  return { presets: DNS_PRESETS, current, adapters, hasBackup: !!store.data.dnsBackup };
}

async function setDns(store, presetId) {
  const preset = presetById.get(presetId);
  if (!preset) throw new Error('Unknown DNS option.');

  if (!store.data.dnsBackup) {
    const backup = await ps.runJson(`
      ${ADAPTERS}
      $out = @()
      foreach ($a in Get-ActiveAdapters) { $out += @{ guid = $a.InterfaceGuid; index = $a.ifIndex; name = $a.Name; static = (Get-StaticDns $a.InterfaceGuid) } }
      ,$out
    `);
    store.data.dnsBackup = { at: Date.now(), adapters: Array.isArray(backup) ? backup : backup ? [backup] : [] };
    store.save();
  }

  await ps.run(`
    $servers = @(${ps.jsonArg(preset.servers)})
    $hasV6 = [bool](Get-NetAdapterBinding -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue | Where-Object Enabled)
    foreach ($a in @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' })) {
      if ($servers.Count -eq 0) { Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ResetServerAddresses }
      else {
        $use = $servers
        if (-not $hasV6) { $use = @($servers | Where-Object { $_ -notmatch ':' }) }
        Set-DnsClientServerAddress -InterfaceIndex $a.ifIndex -ServerAddresses $use
      }
    }
    Clear-DnsClientCache
  `);
  return { ok: true };
}

async function restoreDns(store) {
  const backup = store.data.dnsBackup;
  if (!backup) throw new Error('There\'s no saved DNS setting to go back to.');
  await ps.run(`
    foreach ($a in @(${ps.jsonArg(backup.adapters)})) {
      $live = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceGuid -eq $a.guid }
      if (-not $live) { continue }
      Set-DnsClientServerAddress -InterfaceIndex $live.ifIndex -ResetServerAddresses
      $s = @($a.static | Where-Object { $_ })
      if ($s.Count -gt 0) { Set-DnsClientServerAddress -InterfaceIndex $live.ifIndex -ServerAddresses $s }
    }
    Clear-DnsClientCache
  `);
  delete store.data.dnsBackup;
  store.save();
  return { ok: true };
}

async function dnsSpeedTest() {
  const targets = [
    { id: 'current', title: 'Your current DNS', server: null },
    ...DNS_PRESETS.filter((p) => p.servers.length).map((p) => ({ id: p.id, title: p.title, server: p.servers[0] })),
  ];
  return ps.runJson(`
    $domains = @('google.com', 'youtube.com', 'discord.com', 'steampowered.com', 'microsoft.com')
    $out = @()
    foreach ($t in ${ps.jsonArg(targets)}) {
      $server = $t.server
      if (-not $server) {
        $server = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $_.ServerAddresses } | Where-Object { $_ })[0]
      }
      if (-not $server) { $out += @{ id = $t.id; title = $t.title; ms = $null }; continue }
      $times = @()
      foreach ($d in $domains) {
        try {
          $ms = (Measure-Command { Resolve-DnsName -Name $d -Server $server -DnsOnly -NoHostsFile -QuickTimeout -Type A -ErrorAction Stop | Out-Null }).TotalMilliseconds
          $times += $ms
        } catch {}
      }
      $avg = if ($times.Count) { [math]::Round(($times | Measure-Object -Average).Average) } else { $null }
      $out += @{ id = $t.id; title = $t.title; server = $server; ms = $avg }
    }
    ,$out
  `, { timeout: 90000 });
}

async function pingTest() {
  return ps.runJson(`
    $out = @()
    foreach ($h in @('1.1.1.1', '8.8.8.8')) {
      $r = @(Test-Connection -ComputerName $h -Count 6 -ErrorAction SilentlyContinue)
      if ($r.Count -eq 0) { $out += @{ host = $h; avg = $null; jitter = $null; loss = 100 }; continue }
      $t = @($r | ForEach-Object { [double]$_.ResponseTime })
      $avg = ($t | Measure-Object -Average).Average
      $jit = 0
      for ($i = 1; $i -lt $t.Count; $i++) { $jit += [math]::Abs($t[$i] - $t[$i - 1]) }
      if ($t.Count -gt 1) { $jit = $jit / ($t.Count - 1) }
      $out += @{ host = $h; avg = [math]::Round($avg); jitter = [math]::Round($jit, 1); loss = [math]::Round((6 - $r.Count) / 6 * 100) }
    }
    ,$out
  `, { timeout: 60000 });
}

async function flushDns() {
  await ps.run('Clear-DnsClientCache');
  return { ok: true };
}

module.exports = { dnsState, setDns, restoreDns, dnsSpeedTest, pingTest, flushDns };
