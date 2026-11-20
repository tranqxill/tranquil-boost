'use strict';
const ps = require('./ps');
const { TWEAKS, byId } = require('./tweaks');

// PowerShell helpers shared by registry scripts.
const REG_FUNCS = `
function Read-Val($path, $name) {
  if (-not (Test-Path -LiteralPath $path)) { return @{ keyExists = $false; exists = $false } }
  $k = Get-Item -LiteralPath $path
  if (@($k.GetValueNames()) -notcontains $name) { return @{ keyExists = $true; exists = $false } }
  $kind = $k.GetValueKind($name).ToString()
  $v = $k.GetValue($name, $null, 'DoNotExpandEnvironmentNames')
  if ($kind -eq 'Binary') { $v = @($v | ForEach-Object { [int]$_ }) }
  return @{ keyExists = $true; exists = $true; kind = $kind; data = $v }
}
function Write-Val($path, $name, $kind, $data) {
  if (-not (Test-Path -LiteralPath $path)) { New-Item -Path $path -Force | Out-Null }
  switch ($kind) {
    'Binary'      { $data = [byte[]]@($data) }
    'MultiString' { $data = [string[]]@($data) }
    'DWord'       { $data = [int]$data }
    'QWord'       { $data = [long]$data }
    default       { $data = [string]$data }
  }
  New-ItemProperty -LiteralPath $path -Name $name -PropertyType $kind -Value $data -Force | Out-Null
}
function Remove-Val($path, $name, $removeKeyIfEmpty) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  Remove-ItemProperty -LiteralPath $path -Name $name -ErrorAction SilentlyContinue
  if ($removeKeyIfEmpty) {
    $k = Get-Item -LiteralPath $path
    if (@($k.GetValueNames()).Count -eq 0 -and $k.SubKeyCount -eq 0) { Remove-Item -LiteralPath $path -ErrorAction SilentlyContinue }
  }
}
`;

const u32 = (n) => Number(n) >>> 0;

function sameValue(want, got) {
  if (!got || !got.exists) return false;
  if (want.type === 'DWord') return typeof got.data === 'number' && u32(got.data) === u32(want.data);
  return String(got.data) === String(want.data);
}

function toArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

class Engine {
  constructor(store) {
    this.store = store;
  }

  list() {
    return TWEAKS.map(({ id, cat, title, desc, recommended, effect }) => ({ id, cat, title, desc, recommended, effect }));
  }

  // Works out the state of every tweak in one PowerShell call.
  // Returns { id: 'on' | 'off' | 'partial' | 'unknown' } plus whether we own each one.
  async status() {
    const regItems = [];
    for (const t of TWEAKS) {
      if (t.kind === 'script') continue;
      t.values.forEach((v, i) => regItems.push({ key: `${t.id}#${i}`, path: v.path, name: v.name }));
    }
    const checks = TWEAKS.filter((t) => t.kind === 'script');
    const script = `
      ${REG_FUNCS}
      $items = ${ps.jsonArg(regItems)}
      $vals = @{}
      foreach ($i in $items) { try { $vals[$i.key] = Read-Val $i.path $i.name } catch { $vals[$i.key] = $null } }
      $checks = @{}
      ${checks.map((t) => `try { $checks['${t.id}'] = & { ${t.check} } } catch { $checks['${t.id}'] = $null }`).join('\n')}
      @{ vals = $vals; checks = $checks }
    `;
    const res = await ps.runJson(script, { timeout: 45000 });
    const out = {};
    for (const t of TWEAKS) {
      let state = 'unknown';
      if (t.kind === 'script') {
        const c = res.checks[t.id];
        if (c === true) state = 'on';
        else if (c === false) state = 'off';
      } else {
        let vals = t.values.map((v, i) => [v, res.vals[`${t.id}#${i}`]]);
        // Service tweaks only count services that exist on this PC.
        if (t.requireKey) vals = vals.filter(([, got]) => got && got.keyExists);
        if (vals.length) {
          const n = vals.filter(([v, got]) => sameValue(v, got)).length;
          state = n === vals.length ? 'on' : n === 0 ? 'off' : 'partial';
        }
      }
      out[t.id] = { state, ours: !!this.store.getBackup(t.id) };
    }
    return out;
  }

  async apply(id) {
    const t = byId.get(id);
    if (!t) throw new Error('Unknown tweak.');

    if (t.kind === 'script') {
      let backup = this.store.getBackup(id);
      if (!backup) {
        const data = await ps.runJson(t.capture);
        backup = { kind: 'script', at: Date.now(), data };
        this.store.setBackup(id, backup);
      }
      try {
        await ps.run(`$b = ${ps.jsonArg(backup.data)}\n${t.apply}`);
      } catch (e) {
        await this.undo(id).catch(() => {});
        throw e;
      }
      return { effect: t.effect };
    }

    // Registry tweak: save the original values before touching anything.
    if (!this.store.getBackup(id)) {
      const originals = await ps.runJson(`
        ${REG_FUNCS}
        $items = ${ps.jsonArg(t.values.map((v) => ({ path: v.path, name: v.name })))}
        ,@($items | ForEach-Object { Read-Val $_.path $_.name })
      `);
      this.store.setBackup(id, { kind: 'reg', at: Date.now(), originals: toArray(originals) });
    }
    const backup = this.store.getBackup(id);
    if (t.requireKey && !backup.originals.some((o) => o && o.keyExists)) {
      this.store.clearBackup(id);
      throw new Error('This isn\'t available on your PC.');
    }
    const writes = t.values.map((v) => ({
      path: v.path,
      name: v.name,
      kind: v.type,
      data: v.type === 'DWord' ? (u32(v.data) | 0) : v.data,
      requireKey: !!t.requireKey,
    }));
    try {
      await ps.run(`
        ${REG_FUNCS}
        foreach ($w in ${ps.jsonArg(writes)}) {
          if ($w.requireKey -and -not (Test-Path -LiteralPath $w.path)) { continue }
          Write-Val $w.path $w.name $w.kind $w.data
        }
      `);
    } catch (e) {
      await this.undo(id).catch(() => {});
      throw e;
    }
    return { effect: t.effect };
  }

  async undo(id) {
    const t = byId.get(id);
    if (!t) throw new Error('Unknown tweak.');
    const backup = this.store.getBackup(id);
    if (!backup) throw new Error('Nothing to undo. This was set before Tranquil Boost changed it.');

    if (backup.kind === 'script') {
      await ps.run(`$b = ${ps.jsonArg(backup.data)}\n${t.restore}`);
    } else {
      const ops = t.values.map((v, i) => {
        const o = backup.originals[i] || { exists: false, keyExists: false };
        return { path: v.path, name: v.name, exists: !!o.exists, keyExists: !!o.keyExists, kind: o.kind || 'String', data: o.data };
      });
      await ps.run(`
        ${REG_FUNCS}
        foreach ($o in ${ps.jsonArg(ops)}) {
          if ($o.exists) { Write-Val $o.path $o.name $o.kind $o.data }
          else { Remove-Val $o.path $o.name (-not $o.keyExists) }
        }
      `);
    }
    this.store.clearBackup(id);
    return { effect: t.effect };
  }

  async undoAll() {
    const failed = [];
    for (const id of this.store.backupIds()) {
      if (!byId.has(id)) { this.store.clearBackup(id); continue; }
      try { await this.undo(id); } catch (e) { failed.push({ id, error: e.message }); }
    }
    return { failed };
  }

  // Raw registry values for a tweak (used by the self-test).
  async readRaw(id) {
    const t = byId.get(id);
    if (!t || t.kind === 'script') return null;
    const r = await ps.runJson(`
      ${REG_FUNCS}
      $items = ${ps.jsonArg(t.values.map((v) => ({ path: v.path, name: v.name })))}
      ,@($items | ForEach-Object { Read-Val $_.path $_.name })
    `);
    return toArray(r);
  }

  async createRestorePoint() {
    const res = await ps.runJson(`
      $before = @(Get-ComputerRestorePoint -ErrorAction SilentlyContinue).Count
      try {
        Checkpoint-Computer -Description 'Tranquil Boost' -RestorePointType MODIFY_SETTINGS -WarningAction SilentlyContinue
      } catch {
        return @{ ok = $false; reason = 'off'; message = $_.Exception.Message }
      }
      $after = @(Get-ComputerRestorePoint -ErrorAction SilentlyContinue).Count
      if ($after -gt $before) { @{ ok = $true; reason = 'created' } } else { @{ ok = $false; reason = 'recent' } }
    `, { timeout: 240000 });
    return res;
  }
}

module.exports = { Engine };
