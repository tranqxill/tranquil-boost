'use strict';
const ps = require('./ps');

// Startup apps are turned on/off the same way Task Manager does it
// (the StartupApproved keys), so nothing gets deleted and Task Manager
// shows the same on/off state.
const APPROVED = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved';
const SOURCES = [
  { key: 'hkcu-run', kind: 'reg', where: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', approved: `HKCU:\\${APPROVED}\\Run`, scope: 'You' },
  { key: 'hklm-run', kind: 'reg', where: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', approved: `HKLM:\\${APPROVED}\\Run`, scope: 'All users' },
  { key: 'hklm-run32', kind: 'reg', where: 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run', approved: `HKLM:\\${APPROVED}\\Run32`, scope: 'All users' },
  { key: 'user-folder', kind: 'folder', where: 'Startup', approved: `HKCU:\\${APPROVED}\\StartupFolder`, scope: 'You' },
  { key: 'common-folder', kind: 'folder', where: 'CommonStartup', approved: `HKLM:\\${APPROVED}\\StartupFolder`, scope: 'All users' },
];
const sourceByKey = new Map(SOURCES.map((s) => [s.key, s]));

let lastScan = new Map();

async function scan() {
  const script = `
    function Get-ExePath($cmd) {
      if (-not $cmd) { return $null }
      $c = [Environment]::ExpandEnvironmentVariables($cmd).Trim()
      if ($c.StartsWith('"')) { $e = $c.IndexOf('"', 1); if ($e -gt 1) { return $c.Substring(1, $e - 1) } }
      $i = $c.ToLower().IndexOf('.exe')
      if ($i -gt 0) { return $c.Substring(0, $i + 4) }
      return $c.Split(' ')[0]
    }
    function Get-State($approved, $name) {
      if (-not (Test-Path -LiteralPath $approved)) { return $true }
      $k = Get-Item -LiteralPath $approved
      if (@($k.GetValueNames()) -notcontains $name) { return $true }
      $v = $k.GetValue($name)
      if ($v -is [byte[]] -and $v.Length -gt 0) { return (($v[0] -band 1) -eq 0) }
      return $true
    }
    $out = @()
    foreach ($s in ${ps.jsonArg(SOURCES)}) {
      $items = @()
      if ($s.kind -eq 'reg') {
        if (-not (Test-Path -LiteralPath $s.where)) { continue }
        $k = Get-Item -LiteralPath $s.where
        foreach ($n in $k.GetValueNames()) {
          if (-not $n) { continue }
          $items += @{ name = $n; command = [string]$k.GetValue($n) }
        }
      } else {
        $dir = [Environment]::GetFolderPath($s.where)
        if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
        foreach ($f in Get-ChildItem -LiteralPath $dir -File -Force -ErrorAction SilentlyContinue) {
          if ($f.Name -ieq 'desktop.ini') { continue }
          $target = $f.FullName
          if ($f.Extension -ieq '.lnk') {
            try { $target = (New-Object -ComObject WScript.Shell).CreateShortcut($f.FullName).TargetPath } catch {}
          }
          $items += @{ name = $f.Name; command = $target }
        }
      }
      foreach ($i in $items) {
        $exe = Get-ExePath $i.command
        $desc = $null; $company = $null
        try {
          if ($exe -and (Test-Path -LiteralPath $exe)) {
            $vi = (Get-Item -LiteralPath $exe).VersionInfo
            $desc = $vi.FileDescription; $company = $vi.CompanyName
          }
        } catch {}
        $out += @{
          source = $s.key; scope = $s.scope; name = $i.name; command = $i.command
          label = $(if ($desc) { $desc.Trim() } else { [IO.Path]::GetFileNameWithoutExtension($i.name) })
          company = $company
          enabled = (Get-State $s.approved $i.name)
        }
      }
    }
    ,$out
  `;
  const res = await ps.runJson(script, { timeout: 60000 });
  const list = (Array.isArray(res) ? res : res ? [res] : []).map((x) => ({ ...x, id: `${x.source}|${x.name}` }));
  lastScan = new Map(list.map((x) => [x.id, x]));
  return list;
}

async function setEnabled(id, enabled) {
  const item = lastScan.get(id);
  if (!item) throw new Error('That startup item isn\'t in the list anymore. Refresh and try again.');
  const src = sourceByKey.get(item.source);
  await ps.run(`
    $o = ${ps.jsonArg({ path: src.approved, name: item.name, enabled: !!enabled })}
    if (-not (Test-Path -LiteralPath $o.path)) { New-Item -Path $o.path -Force | Out-Null }
    if ($o.enabled) { $bytes = [byte[]](2,0,0,0,0,0,0,0,0,0,0,0) }
    else { $bytes = [byte[]](@(3,0,0,0) + [BitConverter]::GetBytes([long](Get-Date).ToFileTime())) }
    New-ItemProperty -LiteralPath $o.path -Name $o.name -PropertyType Binary -Value $bytes -Force | Out-Null
  `);
  item.enabled = !!enabled;
  return { ok: true };
}

module.exports = { scan, setEnabled };
