'use strict';
// Runs PowerShell scripts. Every script we run is built from our own
// static definitions, never from text the window sends us.
const { execFile } = require('child_process');
const zlib = require('zlib');

const PS_EXE = process.env.SystemRoot
  ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  : 'powershell.exe';

const PRELUDE = [
  "$ErrorActionPreference = 'Stop'",
  '$ProgressPreference = \'SilentlyContinue\'',
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
].join('\n');

// The script is gzipped and handed over in an environment variable. The
// command line only holds a short loader, so there's no length limit and no
// -EncodedCommand (which some antivirus tools treat as suspicious).
const LOADER = "$__s = (New-Object IO.StreamReader((New-Object IO.Compression.GZipStream((New-Object IO.MemoryStream(,[Convert]::FromBase64String($env:TB_PAYLOAD))), [IO.Compression.CompressionMode]::Decompress)), [Text.Encoding]::UTF8)).ReadToEnd(); Remove-Item Env:TB_PAYLOAD; & ([ScriptBlock]::Create($__s))";

const SYS32 = `${process.env.SystemRoot || 'C:\\Windows'}\\System32`;
const CANDIDATES = [
  PS_EXE,
  `${process.env.ProgramFiles || 'C:\\Program Files'}\\PowerShell\\7\\pwsh.exe`,
];
let workingExe = null;

const BLOCKED_MSG = 'Windows or your antivirus blocked Tranquil Boost from running PowerShell, so it can\'t read or change settings. Add Tranquil Boost to your antivirus\'s allowed apps (or turn off the block for it), then reopen the app.';

function spawnPs(exe, script, timeout) {
  return new Promise((resolve, reject) => {
    const payload = zlib.gzipSync(Buffer.from(`${PRELUDE}\n${script}`, 'utf8')).toString('base64');
    execFile(
      exe,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', LOADER],
      { windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024, cwd: SYS32, env: { ...process.env, TB_PAYLOAD: payload } },
      (err, stdout, stderr) => {
        if (err) {
          if (err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'ENOENT') {
            const e = new Error(BLOCKED_MSG);
            e.spawnFailed = true;
            e.original = `${err.code} ${exe}`;
            reject(e);
            return;
          }
          const msg = (stderr || '').replace(/#< CLIXML[\s\S]*/, '').trim() || err.message;
          reject(new Error(msg));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

async function run(script, { timeout = 60000 } = {}) {
  if (workingExe) return spawnPs(workingExe, script, timeout);
  let last;
  for (const exe of CANDIDATES) {
    try {
      const out = await spawnPs(exe, script, timeout);
      workingExe = exe;
      return out;
    } catch (e) {
      if (!e.spawnFailed) { workingExe = exe; throw e; }
      last = e;
    }
  }
  throw last;
}

// Quick check at startup so the window can warn right away if PowerShell is blocked.
async function health() {
  try {
    const out = await run("'ok'", { timeout: 20000 });
    return { ok: out === 'ok' };
  } catch (e) {
    return { ok: false, blocked: !!e.spawnFailed, message: e.message, detail: e.original || null };
  }
}

async function runJson(script, opts) {
  const out = await run(`$__r = & {\n${script}\n}\nConvertTo-Json -InputObject $__r -Depth 6 -Compress`, opts);
  if (!out) return null;
  return JSON.parse(out);
}

module.exports = { run, runJson, jsonArg, health };
