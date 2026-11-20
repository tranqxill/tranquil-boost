'use strict';
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const ps = require('./ps');

let prevCpu = null;
function cpuUsage() {
  const now = os.cpus().map((c) => c.times);
  let pct = 0;
  if (prevCpu && prevCpu.length === now.length) {
    let idle = 0, total = 0;
    now.forEach((t, i) => {
      const p = prevCpu[i];
      const d = (k) => t[k] - p[k];
      const tot = d('user') + d('nice') + d('sys') + d('idle') + d('irq');
      idle += d('idle');
      total += tot;
    });
    pct = total > 0 ? Math.round((1 - idle / total) * 100) : 0;
  }
  prevCpu = now;
  return Math.max(0, Math.min(100, pct));
}

const NVSMI = [
  'C:\\Windows\\System32\\nvidia-smi.exe',
  'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

function nvidiaStats() {
  return new Promise((resolve) => {
    if (!NVSMI) return resolve(null);
    execFile(NVSMI, ['--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 4000 }, (err, out) => {
        if (err) return resolve(null);
        const [util, temp, used, total] = out.split('\n')[0].split(',').map((s) => Number(s.trim()));
        resolve({ util, temp, vramUsed: used, vramTotal: total });
      });
  });
}

// Fallback for AMD / Intel: Windows' own GPU counters (slower, no temperature).
async function genericGpuStats() {
  try {
    const v = await ps.runJson(`
      $s = (Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction Stop).CounterSamples
      [math]::Round([math]::Min(100, ($s | Measure-Object CookedValue -Sum).Sum))
    `, { timeout: 8000 });
    return typeof v === 'number' ? { util: v, temp: null } : null;
  } catch {
    return null;
  }
}

let gpuBusy = false;
let lastGpu = null;
async function sample() {
  if (!gpuBusy) {
    gpuBusy = true;
    (NVSMI ? nvidiaStats() : genericGpuStats())
      .then((g) => { lastGpu = g; })
      .finally(() => { gpuBusy = false; });
  }
  const total = os.totalmem();
  const free = os.freemem();
  return {
    cpu: cpuUsage(),
    ramUsed: total - free,
    ramTotal: total,
    gpu: lastGpu,
    uptime: os.uptime(),
  };
}

let sysInfoCache = null;
async function systemInfo() {
  if (sysInfoCache) return sysInfoCache;
  const info = await ps.runJson(`
    $os = Get-CimInstance Win32_OperatingSystem
    $gpu = @(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Basic Display|Remote|Virtual' } | ForEach-Object { $_.Name })
    $sys = Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':'))
    @{
      os = $os.Caption; build = $os.BuildNumber
      gpus = $gpu
      diskFree = [long]$sys.Free; diskUsed = [long]$sys.Used
    }
  `).catch(() => ({}));
  const cpus = os.cpus();
  sysInfoCache = {
    cpu: cpus[0] ? cpus[0].model.trim() : 'Unknown CPU',
    threads: cpus.length,
    ram: os.totalmem(),
    ...info,
  };
  return sysInfoCache;
}

function clearInfoCache() { sysInfoCache = null; }

module.exports = { sample, systemInfo, clearInfoCache };
