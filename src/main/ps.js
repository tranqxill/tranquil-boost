'use strict';
// Runs PowerShell scripts. Every script we run is built from our own
// static definitions, never from text the window sends us.
const { execFile } = require('child_process');

const PS_EXE = process.env.SystemRoot
  ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  : 'powershell.exe';

const PRELUDE = [
  "$ErrorActionPreference = 'Stop'",
  '$ProgressPreference = \'SilentlyContinue\'',
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
].join('\n');

function encode(script) {
  return Buffer.from(`${PRELUDE}\n${script}`, 'utf16le').toString('base64');
}

// Pass data into a script without any quoting problems. Arrays come out
// enumerated (Windows PowerShell 5.1 otherwise hands back one nested array),
// so wrap the result in @() wherever a list is expected.
function jsonArg(value) {
  const b64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  return `$([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json | ForEach-Object { $_ })`;
}

function run(script, { timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      PS_EXE,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)],
      { windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || '').replace(/#< CLIXML[\s\S]*/, '').trim() || err.message;
          reject(new Error(msg));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

async function runJson(script, opts) {
  const out = await run(`$__r = & {\n${script}\n}\nConvertTo-Json -InputObject $__r -Depth 6 -Compress`, opts);
  if (!out) return null;
  return JSON.parse(out);
}

module.exports = { run, runJson, jsonArg };
