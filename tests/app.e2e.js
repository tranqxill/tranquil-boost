'use strict';
// Opens the real app on a throwaway Windows machine in GitHub Actions and
// clicks through it like a person would. Never run this on your own PC: it
// turns a tweak on and off.
const path = require('path');
const fs = require('fs');
const { _electron: electron } = require('playwright-core');

if (process.platform !== 'win32' || !process.env.CI) {
  console.error('This test clicks real switches. It only runs on a CI machine (Windows, CI=true).');
  process.exit(1);
}

const SHOTS = path.join(__dirname, '..', 'e2e-shots');
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;

async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); console.log(`  ok   ${name} (${Date.now() - t0} ms)`); }
  catch (e) { failures++; console.log(`  FAIL ${name}: ${e.message}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const app = await electron.launch({ args: [path.join(__dirname, '..')], timeout: 60000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  const go = async (id) => { await page.click(`[data-page="${id}"]`); await page.waitForTimeout(300); };

  await step('window opens and shows the sidebar', async () => {
    await page.waitForSelector('.nav-item', { timeout: 30000 });
    assert((await page.locator('.nav-item').count()) === 7, 'expected 7 sidebar items');
  });

  await step('knows it is running as admin', async () => {
    await page.waitForSelector('#admin-pill .pill', { timeout: 20000 });
    const t = await page.textContent('#admin-pill');
    assert(t.includes('Running as admin'), `admin pill says: ${t}`);
  });

  await step('home loads real numbers', async () => {
    await page.waitForFunction(() => {
      const b = document.querySelector('.ring-label b');
      return b && /\d+\/\d+/.test(b.textContent);
    }, null, { timeout: 60000 });
    await page.waitForTimeout(4500);
    const cpu = await page.locator('.stat-val').first().textContent();
    assert(/\d/.test(cpu), `CPU card shows: ${cpu}`);
    console.log(`        ring ${await page.textContent('.ring-label b')}, cpu "${cpu.trim()}"`);
    await shot('1-home');
  });

  // Keep the test fast: Windows Server can't make restore points anyway.
  await go('backups');
  await step('restore point setting can be switched off', async () => {
    const t = page.locator('[data-act="rp-setting"]');
    if (await t.evaluate((el) => el.classList.contains('on'))) await t.click();
    await page.waitForTimeout(400);
    assert(!(await t.evaluate((el) => el.classList.contains('on'))), 'setting did not turn off');
  });

  await go('optimize');
  await step('optimize page lists every tweak with a working switch', async () => {
    await page.waitForFunction(() => ![...document.querySelectorAll('.tweak-foot .state')].some((s) => s.textContent.includes('Checking')), null, { timeout: 60000 });
    const states = await page.$$eval('.tweak', (els) => els.map((e) => `${e.querySelector('h3').textContent} = ${e.querySelector('.state').textContent}`));
    console.log(`        ${states.join(' | ')}`);
    assert(states.length === 18, `expected 18 tweaks, saw ${states.length}`);
    assert(!states.some((s) => s.endsWith('Not available')), 'some tweaks show Not available');
    await shot('2-optimize');
  });

  // Use the first tweak that's currently off.
  const title = await page.$$eval('.tweak', (els) => {
    const c = els.find((e) => e.querySelector('.state').textContent === 'Off');
    return c ? c.querySelector('h3').textContent : null;
  });
  console.log(`        testing with "${title}"`);
  const card = page.locator('.tweak', { has: page.locator('h3', { hasText: title || 'none' }) });
  const stateIs = (want) => page.waitForFunction(([t, w]) => {
    const c = [...document.querySelectorAll('.tweak')].find((e) => e.querySelector('h3').textContent === t);
    return c && c.querySelector('.state').textContent === w;
  }, [title, want], { timeout: 30000 });
  await step('turning a tweak on works and shows up in Backups', async () => {
    assert(title, 'no tweak is off on this machine');
    await card.locator('.toggle').click();
    await stateIs('On');
    const count = await page.textContent('[data-page="backups"] .nav-count');
    assert(count.trim() === '1', `backups badge shows ${count}`);
    await shot('3-tweak-on');
  });

  await step('turning it back off undoes it', async () => {
    await card.locator('.toggle').click();
    await stateIs('Off');
    assert((await page.locator('[data-page="backups"] .nav-count').count()) === 0, 'backups badge still there');
  });

  await go('network');
  await step('network page reads DNS and tests speed', async () => {
    await page.waitForSelector('.dns-opt', { timeout: 30000 });
    assert((await page.locator('.dns-opt').count()) === 4, 'expected 4 DNS options');
    assert((await page.locator('.dns-opt.active').count()) === 1, 'no DNS option is marked as current');
    await page.click('[data-act="dnstest"]');
    await page.waitForFunction(() => [...document.querySelectorAll('.dns-opt .ms')].some((e) => /ms/.test(e.textContent)), null, { timeout: 60000 });
    console.log(`        ${(await page.$$eval('.dns-opt', (els) => els.map((e) => `${e.querySelector('b').textContent}: ${e.querySelector('.ms').textContent.trim()}`))).join(' | ')}`);
    await page.click('[data-act="ping"]');
    await page.waitForFunction(() => !document.querySelector('[data-act="ping"]').disabled, null, { timeout: 60000 });
    await shot('4-network');
  });

  await go('cleanup');
  await step('cleanup scans and shows sizes', async () => {
    await page.waitForFunction(() => document.querySelectorAll('.list-row .size .spinner').length === 0 && /\d/.test(document.querySelector('[data-act="clean"]').textContent), null, { timeout: 120000 });
    console.log(`        ${(await page.$$eval('.list-row', (els) => els.map((e) => `${e.querySelector('b').textContent}: ${e.querySelector('.size').textContent.trim()}`))).join(' | ')}`);
    await shot('5-cleanup');
  });

  await go('startup');
  await step('startup apps list loads', async () => {
    await page.waitForFunction(() => !document.querySelector('.loading-row'), null, { timeout: 60000 });
    const n = await page.locator('[data-startup]').count();
    console.log(`        ${n} startup apps`);
    assert(n > 0, 'no startup apps listed');
    await page.fill('#startup-search', 'zzzz-nothing');
    await page.waitForSelector('.empty');
    await page.fill('#startup-search', '');
    await shot('6-startup');
  });

  await go('stats');
  await step('live stats update', async () => {
    await page.waitForTimeout(5000);
    const vals = await page.$$eval('.stat-val', (els) => els.map((e) => e.textContent.trim()));
    console.log(`        ${vals.join(' | ')} | ${await page.textContent('.kv')}`.replace(/\s+/g, ' '));
    assert(/\d/.test(vals[0]) && /\d/.test(vals[2]), 'CPU or memory missing');
    await shot('7-stats');
  });

  await go('backups');
  await step('backups page shows nothing left to undo', async () => {
    assert((await page.locator('.empty').count()) === 1, 'expected the empty message');
    await shot('8-backups');
  });

  await step('no errors in the window', async () => {
    assert(errors.length === 0, errors.join('\n'));
  });

  await app.close();
  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
