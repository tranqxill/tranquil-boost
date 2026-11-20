'use strict';
const ps = require('./ps');

// What the Cleanup page can clear. Files changed in the last hour are left
// alone so we don't pull the rug out from under an installer that's running.
const TARGETS = [
  { id: 'user-temp', title: 'Your temp files', desc: 'Leftovers from installers and apps.', paths: ['$env:TEMP'], defaultOn: true },
  { id: 'win-temp', title: 'Windows temp files', desc: 'Temp files Windows itself left behind.', paths: ['$env:SystemRoot\\Temp'], defaultOn: true },
  { id: 'crash-dumps', title: 'Crash dumps', desc: 'Reports saved when apps or Windows crashed. Only useful if you\'re sending them to someone.', paths: ['$env:LOCALAPPDATA\\CrashDumps', '$env:SystemRoot\\Minidump'], defaultOn: true },
  { id: 'wu-cache', title: 'Windows Update downloads', desc: 'Update files that were already installed.', paths: ['$env:SystemRoot\\SoftwareDistribution\\Download'], defaultOn: true },
  { id: 'do-cache', title: 'Delivery Optimization cache', desc: 'Update pieces Windows keeps to share with other PCs.', paths: ['$env:SystemRoot\\ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache'], defaultOn: true },
  { id: 'shader-cache', title: 'Shader caches (DirectX / NVIDIA / AMD)', desc: 'Clears saved shaders. Fixes some stutter and graphics glitches after driver updates, but games will rebuild them, so the first load or two can stutter.', paths: ['$env:LOCALAPPDATA\\D3DSCache', '$env:LOCALAPPDATA\\NVIDIA\\DXCache', '$env:LOCALAPPDATA\\NVIDIA\\GLCache', '$env:LOCALAPPDATA\\AMD\\DxCache', '$env:LOCALAPPDATA\\AMD\\DxcCache'], defaultOn: false },
  { id: 'recycle-bin', title: 'Recycle Bin', desc: 'Empties the Recycle Bin. Those files are gone for good after this.', recycle: true, defaultOn: false },
];

const byId = new Map(TARGETS.map((t) => [t.id, t]));

const SIZE_FN = `
function Get-Junk($paths) {
  $cut = (Get-Date).AddHours(-1)
  $files = @()
  foreach ($p in $paths) {
    $full = $ExecutionContext.InvokeCommand.ExpandString($p)
    if (-not (Test-Path -LiteralPath $full)) { continue }
    $found = @(Get-ChildItem -LiteralPath $full -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cut })
    $files += $found
  }
  return ,$files
}
function Get-BinSize {
  $total = 0
  foreach ($d in Get-PSDrive -PSProvider FileSystem) {
    $bin = Join-Path $d.Root '$Recycle.Bin'
    if (Test-Path -LiteralPath $bin) {
      $s = (Get-ChildItem -LiteralPath $bin -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
      if ($s) { $total += $s }
    }
  }
  return $total
}
`;

function list() {
  return TARGETS.map(({ id, title, desc, defaultOn }) => ({ id, title, desc, defaultOn }));
}

async function scan() {
  const script = `
    ${SIZE_FN}
    $res = @{}
    foreach ($t in ${ps.jsonArg(TARGETS)}) {
      if ($t.recycle) { $res[$t.id] = @{ bytes = (Get-BinSize); files = $null }; continue }
      $f = Get-Junk @($t.paths)
      $sum = ($f | Measure-Object Length -Sum).Sum
      $res[$t.id] = @{ bytes = [long]$(if ($sum) { $sum } else { 0 }); files = $f.Count }
    }
    $res
  `;
  return ps.runJson(script, { timeout: 180000 });
}

async function clean(ids) {
  const picked = (Array.isArray(ids) ? ids : []).filter((id) => byId.has(id)).map((id) => byId.get(id));
  if (!picked.length) return { freed: 0 };
  const script = `
    ${SIZE_FN}
    $freed = [long]0
    foreach ($t in ${ps.jsonArg(picked)}) {
      if ($t.recycle) {
        $before = Get-BinSize
        try { Clear-RecycleBin -Force -ErrorAction Stop } catch {}
        $freed += [math]::Max(0, $before - (Get-BinSize))
        continue
      }
      if ($t.id -eq 'do-cache') { try { Delete-DeliveryOptimizationCache -Force -ErrorAction Stop } catch {} }
      foreach ($f in (Get-Junk @($t.paths))) {
        try { $len = $f.Length; Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; $freed += $len } catch {}
      }
      # Tidy up folders that are now empty (but never the top folder itself).
      foreach ($p in @($t.paths)) {
        $full = $ExecutionContext.InvokeCommand.ExpandString($p)
        if (-not (Test-Path -LiteralPath $full)) { continue }
        Get-ChildItem -LiteralPath $full -Recurse -Force -Directory -ErrorAction SilentlyContinue |
          Sort-Object { $_.FullName.Length } -Descending |
          ForEach-Object { if (-not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue)) { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue } }
      }
    }
    @{ freed = $freed }
  `;
  return ps.runJson(script, { timeout: 600000 });
}

module.exports = { list, scan, clean };
