'use strict';
// Runs on a throwaway Windows machine in GitHub Actions (never on your PC).
// Turns every tweak on, checks it worked, undoes it, and checks the PC is
// exactly back to how it was. Also runs every scan once.
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { Store } = require('../src/main/store');
const { Engine } = require('../src/main/engine');
const { TWEAKS } = require('../src/main/tweaks');
const cleanup = require('../src/main/cleanup');
const startup = require('../src/main/startup');
const network = require('../src/main/network');
const stats = require('../src/main/stats');
const processes = require('../src/main/processes');
const { spawn } = require('child_process');

if (process.platform !== 'win32' || !process.env.CI) {
  console.error('The self-test changes system settings. It only runs on a CI machine (Windows, CI=true).');
  process.exit(1);
}

const storeFile = path.join(os.tmpdir(), `tb-selftest-${Date.now()}.json`);
const store = new Store(storeFile);
const engine = new Engine(store);
let failures = 0;

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`  ok   ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}: ${e.stack || e.message}`);
  }
}

(async () => {
  console.log('Tweaks');
  const before = await engine.status();
  for (const t of TWEAKS) {
    if (before[t.id].state === 'unknown') {
      console.log(`  skip ${t.id}: not available on this machine`);
      await step(`${t.id}: refuses cleanly when not available`, async () => {
        await assert.rejects(engine.apply(t.id));
        assert.ok(!store.getBackup(t.id), 'left a backup behind');
      });
      continue;
    }
    await step(`${t.id}: apply, check, undo, compare`, async () => {
      const raw0 = await engine.readRaw(t.id);
      await engine.apply(t.id);
      const mid = await engine.status();
      assert.strictEqual(mid[t.id].state, 'on', `expected on after apply, got ${mid[t.id].state}`);
      assert.ok(mid[t.id].ours, 'expected a saved backup');
      await engine.undo(t.id);
      const after = await engine.status();
      assert.strictEqual(after[t.id].state, before[t.id].state, `state after undo ${after[t.id].state} != before ${before[t.id].state}`);
      const raw1 = await engine.readRaw(t.id);
      assert.deepStrictEqual(raw1, raw0, 'registry values after undo differ from the originals');
    });
  }
  await step('applyMany + undoAll', async () => {
    const ids = TWEAKS.filter((t) => t.recommended && before[t.id].state !== 'unknown').map((t) => t.id);
    for (const id of ids) await engine.apply(id).catch(() => {});
    const r = await engine.undoAll();
    assert.deepStrictEqual(r.failed, []);
    assert.deepStrictEqual(store.backupIds(), []);
  });

  console.log('Scans');
  await step('cleanup.scan', async () => {
    const r = await cleanup.scan();
    for (const c of cleanup.list()) assert.ok(r[c.id] && typeof r[c.id].bytes === 'number', `missing ${c.id}`);
    console.log('       ', JSON.stringify(r));
  });
  await step('cleanup.clean (user temp only)', async () => {
    const r = await cleanup.clean(['user-temp', 'not-a-real-id']);
    assert.ok(typeof r.freed === 'number');
  });
  await step('startup.scan + toggle round trip', async () => {
    const list = await startup.scan();
    console.log(`        ${list.length} startup items`);
    if (list.length) {
      const x = list[0];
      const was = x.enabled;
      console.log('       ', JSON.stringify(list.map((y) => ({ id: y.id, on: y.enabled }))));
      await startup.setEnabled(x.id, !was);
      const again = (await startup.scan()).find((y) => y.id === x.id);
      assert.strictEqual(again.enabled, !was);
      await startup.setEnabled(x.id, was);
      const back = (await startup.scan()).find((y) => y.id === x.id);
      assert.strictEqual(back.enabled, was);
    }
  });
  await step('game booster: lists apps, closes a picked one, refuses protected ones', async () => {
    const dummy = path.join(os.tmpdir(), 'tbdummyapp.exe');
    fs.copyFileSync(path.join(process.env.SystemRoot, 'System32', 'PING.EXE'), dummy);
    const child = spawn(dummy, ['-n', '600', '127.0.0.1'], { detached: true, stdio: 'ignore' });
    child.unref();
    await new Promise((r) => setTimeout(r, 1500));
    const list = await processes.list();
    console.log(`        ${list.length} apps, tiers: ${JSON.stringify(list.reduce((a, p) => { a[p.tier] = (a[p.tier] || 0) + 1; return a; }, {}))}`);
    const d = list.find((p) => p.key === 'tbdummyapp');
    assert.ok(d, 'dummy app not listed');
    assert.strictEqual(d.tier, 'other');
    assert.ok(list.filter((p) => p.key === 'explorer' || p.key === 'csrss').every((p) => p.tier === 'protected'), 'explorer/csrss not protected');
    const bad = await processes.close(['explorer', 'csrss', 'svchost', 'lsass']);
    assert.deepStrictEqual(bad.closed, [], 'closed a protected process!');
    const r = await processes.close(['tbdummyapp']);
    assert.deepStrictEqual(r.closed, ['tbdummyapp']);
    await new Promise((res) => setTimeout(res, 800));
    assert.ok(!(await processes.list()).some((p) => p.key === 'tbdummyapp'), 'dummy still running');
  });
  await step('dns state / set / restore', async () => {
    const s0 = await network.dnsState(store);
    console.log('       ', JSON.stringify(s0.adapters.map((a) => ({ n: a.name, s: a.servers }))));
    if (!s0.adapters.length) return;
    await network.setDns(store, 'cloudflare');
    const s1 = await network.dnsState(store);
    console.log('        after set:', JSON.stringify(s1.adapters));
    assert.strictEqual(s1.current, 'cloudflare');
    await network.restoreDns(store);
    const s2 = await network.dnsState(store);
    assert.strictEqual(s2.current, s0.current);
  });
  await step('dns speed test', async () => console.log('       ', JSON.stringify(await network.dnsSpeedTest())));
  await step('ping test', async () => console.log('       ', JSON.stringify(await network.pingTest())));
  await step('stats', async () => {
    await stats.sample();
    await new Promise((r) => setTimeout(r, 1500));
    const s = await stats.sample();
    assert.ok(s.cpu >= 0 && s.ramTotal > 0);
    console.log('       ', JSON.stringify(await stats.systemInfo()));
  });

  fs.rmSync(storeFile, { force: true });
  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})();
