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
    const ids = TWEAKS.filter((t) => t.recommended).map((t) => t.id);
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
      await startup.setEnabled(x.id, !x.enabled);
      const again = (await startup.scan()).find((y) => y.id === x.id);
      assert.strictEqual(again.enabled, !x.enabled);
      await startup.setEnabled(x.id, x.enabled);
    }
  });
  await step('dns state / set / restore', async () => {
    const s0 = await network.dnsState(store);
    console.log('       ', JSON.stringify(s0.adapters.map((a) => ({ n: a.name, s: a.servers }))));
    if (!s0.adapters.length) return;
    await network.setDns(store, 'cloudflare');
    const s1 = await network.dnsState(store);
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
