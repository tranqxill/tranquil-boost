'use strict';
/* global icon */

const api = window.boost;

const S = {
  page: 'home',
  info: null,
  tweaks: [],
  status: {},
  statusLoading: true,
  busy: new Set(),
  optTab: 'all',
  cleanupList: [],
  cleanupScan: null,
  cleanupPick: new Set(),
  cleanupBusy: false,
  startup: null,
  startupFilter: '',
  startupFocus: false,
  dns: null,
  dnsTest: null,
  ping: null,
  netBusy: {},
  sys: null,
  live: null,
  hist: { cpu: [], gpu: [], ram: [] },
  needs: new Set(), // 'restart' | 'signout'
  procs: null,
  procPick: new Set(),
  procBusy: false,
  procClosed: [],
  showOther: false,
};

const CATS = { fps: 'FPS & latency', network: 'Network', qol: 'Quality of life', privacy: 'Privacy', services: 'Services' };
const EFFECT = { now: 'Works right away', signout: 'After you sign out', restart: 'After a restart' };

const PAGES = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'optimize', label: 'Optimize', icon: 'bolt' },
  { id: 'booster', label: 'Game Booster', icon: 'gauge' },
  { id: 'network', label: 'Network & ping', icon: 'wifi' },
  { id: 'cleanup', label: 'Cleanup', icon: 'broom' },
  { id: 'startup', label: 'Startup apps', icon: 'rocket' },
  { id: 'stats', label: 'Live stats', icon: 'chart' },
  { id: 'backups', label: 'Backups & undo', icon: 'shield' },
];

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function bytes(n) {
  if (n == null || isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function cleanError(e) {
  const m = (e && e.message) || String(e);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function toast(msg, kind = 'ok', ms = 4200) {
  const ic = kind === 'err' ? 'warn' : kind === 'info' ? 'info' : 'check';
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.innerHTML = `${icon(ic)}<div>${esc(msg)}</div>`;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function confirmBox(title, text, okLabel = 'Continue', danger = false) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal">
        <h3>${esc(title)}</h3>
        <p>${esc(text)}</p>
        <div class="row">
          <button class="btn" data-a="no">Cancel</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(okLabel)}</button>
        </div>
      </div>`;
    back.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = e.target.closest('[data-a]');
      if (!a && e.target !== back) return;
      back.remove();
      resolve(a ? a.dataset.a === 'yes' : false);
    });
    document.body.appendChild(back);
  });
}

function noteEffect(effect) {
  if (effect === 'restart' || effect === 'signout') S.needs.add(effect);
  const bar = $('#restart-bar');
  if (!S.needs.size) { bar.classList.add('hidden'); return; }
  $('#restart-text').textContent = S.needs.has('restart')
    ? 'Restart your PC so every change kicks in.'
    : 'Sign out and back in so every change kicks in.';
  bar.classList.remove('hidden');
}

function reportRestorePoint(rp) {
  if (!rp) return;
  if (rp.reason === 'created') toast('Made a restore point before changing anything.', 'info');
  else if (rp.reason === 'off') toast('System Restore is off on this PC, so no restore point was made. Undo still works.', 'info', 6500);
}

// ---------- nav ----------
function renderNav() {
  const ours = Object.values(S.status).filter((s) => s.ours).length;
  $('#nav').innerHTML = PAGES.map((p) => `
    <button class="nav-item ${S.page === p.id ? 'active' : ''}" data-page="${p.id}">
      ${icon(p.icon)}<span>${p.label}</span>
      ${p.id === 'backups' && ours ? `<span class="nav-count">${ours}</span>` : ''}
    </button>`).join('') + `
    <div class="nav-spacer"></div>
    <div class="nav-foot">Tranquil Boost ${esc(S.info ? `v${S.info.version}` : '')}<br>Tranquil Interactive Co.</div>`;
}

function go(page) {
  S.page = page;
  renderNav();
  render();
  $('#page').scrollTop = 0;
  if (page === 'cleanup' && !S.cleanupScan && !S.cleanupBusy) scanCleanup();
  if (page === 'startup' && !S.startup) loadStartup();
  if (page === 'network' && !S.dns) loadDns();
  if (page === 'booster' && !S.procs && !S.procBusy) loadProcs(true);
}

// ---------- tweak actions ----------
async function refreshStatus() {
  try {
    S.status = await api.tweaks.status();
  } catch (e) {
    toast(`Couldn't read your current settings: ${cleanError(e)}`, 'err');
  }
  S.statusLoading = false;
  renderNav();
  render();
}

async function toggleTweak(id) {
  if (S.busy.has(id)) return;
  const st = S.status[id] || {};
  const t = S.tweaks.find((x) => x.id === id);
  S.busy.add(id);
  render();
  try {
    if (st.ours) {
      const r = await api.tweaks.undo(id);
      noteEffect(r.effect);
      toast(`Undid "${t.title}".`);
    } else {
      const r = await api.tweaks.apply(id);
      reportRestorePoint(r.restorePoint);
      noteEffect(r.effect);
      toast(`"${t.title}" is on.`);
    }
  } catch (e) {
    toast(cleanError(e), 'err', 7000);
  }
  S.busy.delete(id);
  await refreshStatus();
}

function recommendedLeft() {
  return S.tweaks.filter((t) => t.recommended && (S.status[t.id] || {}).state !== 'on');
}

async function applyRecommended() {
  const left = recommendedLeft();
  if (!left.length) { toast('All the recommended tweaks are already on.', 'info'); return; }
  const ok = await confirmBox(
    `Turn on ${left.length} recommended tweak${left.length > 1 ? 's' : ''}?`,
    'We\'ll try to make a restore point first, and you can undo any of these later from Backups & undo.',
    'Turn them on'
  );
  if (!ok) return;
  left.forEach((t) => S.busy.add(t.id));
  render();
  try {
    const r = await api.tweaks.applyMany(left.map((t) => t.id));
    reportRestorePoint(r.restorePoint);
    r.done.forEach((d) => noteEffect(d.effect));
    if (r.failed.length) {
      toast(`${r.done.length} turned on, ${r.failed.length} couldn't be: ${r.failed.map((f) => f.error).join(' ')}`, 'err', 8000);
    } else {
      toast(`Turned on ${r.done.length} tweak${r.done.length > 1 ? 's' : ''}.`);
    }
  } catch (e) {
    toast(cleanError(e), 'err');
  }
  S.busy.clear();
  await refreshStatus();
}

// ---------- render: shared pieces ----------
function tweakCard(t) {
  const st = S.status[t.id] || { state: 'unknown' };
  const busy = S.busy.has(t.id);
  const on = st.state === 'on';
  const external = on && !st.ours;
  let label = 'Off';
  if (S.statusLoading) label = 'Checking…';
  else if (busy) label = 'Working…';
  else if (st.ours) label = 'On';
  else if (external) label = 'Already on';
  else if (st.state === 'partial') label = 'Partly on';
  else if (st.state === 'unknown') label = 'Not on this PC';
  const toggleCls = [(on || st.ours) ? 'on' : '', st.state === 'partial' && !st.ours ? 'partial' : '', busy ? 'busy' : ''].join(' ');
  const lockTitle = external ? 'This was already set before Tranquil Boost, so there\'s nothing for it to undo.' : '';
  return `
    <div class="card tweak ${on ? 'on' : ''}">
      <div class="tweak-tags">
        <span class="tag">${CATS[t.cat]}</span>
        ${t.recommended ? '<span class="tag rec">Recommended</span>' : ''}
      </div>
      <h3>${esc(t.title)}</h3>
      <p>${esc(t.desc)}</p>
      <div class="tweak-foot">
        <span>${EFFECT[t.effect]}</span>
        <span class="state">${label}</span>
        <button class="toggle ${toggleCls}" data-tweak="${t.id}" title="${esc(lockTitle)}"
          ${busy || S.statusLoading || external || st.state === 'unknown' ? 'disabled' : ''}></button>
      </div>
    </div>`;
}

function meterCard(ic, title, val, unit, pct, sub) {
  return `
    <div class="card stat-card">
      <div class="stat-top">${icon(ic)}${esc(title)}</div>
      <div class="stat-val">${val}<small>${unit}</small></div>
      <div class="meter ${pct > 85 ? 'hot' : ''}"><i style="width:${Math.max(0, Math.min(100, pct || 0))}%"></i></div>
      <div class="stat-sub" title="${esc(sub)}">${esc(sub)}</div>
    </div>`;
}

function liveCards() {
  const l = S.live;
  const sys = S.sys || {};
  const ramPct = l ? (l.ramUsed / l.ramTotal) * 100 : 0;
  const gpu = l && l.gpu;
  const gpuName = sys.gpus && sys.gpus.length ? sys.gpus[0] : 'Graphics card';
  return `
    <div class="grid cols-3">
      ${meterCard('cpu', 'CPU', l ? l.cpu : '—', '%', l ? l.cpu : 0, sys.cpu || 'Processor')}
      ${meterCard('gpu', 'GPU', gpu && gpu.util != null ? gpu.util : '—', '%', gpu ? gpu.util : 0,
        gpu && gpu.temp != null ? `${gpuName} · ${gpu.temp}°C` : gpuName)}
      ${meterCard('ram', 'Memory', l ? (l.ramUsed / 1073741824).toFixed(1) : '—', ` / ${l ? (l.ramTotal / 1073741824).toFixed(0) : '—'} GB`, ramPct,
        l ? `${Math.round(ramPct)}% in use` : 'RAM')}
    </div>`;
}

// ---------- pages ----------
const RENDER = {
  home() {
    const rec = S.tweaks.filter((t) => t.recommended);
    const onCount = rec.filter((t) => (S.status[t.id] || {}).state === 'on').length;
    const pct = rec.length ? onCount / rec.length : 0;
    const C = 2 * Math.PI * 56;
    const left = rec.length - onCount;
    const applying = rec.some((t) => S.busy.has(t.id));
    return `
      <div class="page-head"><div>
        <h1>Welcome back</h1>
        <p>Tune Windows for gaming in a couple of clicks. Everything here can be undone.</p>
      </div></div>

      <div class="card hero">
        <div class="ring">
          <svg viewBox="0 0 132 132">
            <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2dd4bf"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs>
            <circle class="track" cx="66" cy="66" r="56" fill="none" stroke-width="11"/>
            <circle class="bar" cx="66" cy="66" r="56" fill="none" stroke-width="11" stroke-linecap="round"
              stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
          </svg>
          <div class="ring-label"><b>${S.statusLoading ? '…' : `${onCount}/${rec.length}`}</b><span>turned on</span></div>
        </div>
        <div>
          <h2>${S.statusLoading ? 'Checking your PC…' : left === 0 ? 'You\'re all set' : `${left} recommended tweak${left > 1 ? 's' : ''} left`}</h2>
          <p>${left === 0 && !S.statusLoading
            ? 'Every recommended tweak is on. Have a look at Optimize for the extra ones, or run a cleanup.'
            : 'These are the safe, well-tested ones that help most PCs. Tranquil Boost saves your current settings first so you can put them back any time.'}</p>
          <div class="row">
            <button class="btn primary" data-act="apply-rec" ${S.statusLoading || left === 0 || applying ? 'disabled' : ''}>
              ${applying ? '<span class="spinner"></span>' : icon('bolt')} Apply recommended
            </button>
            <button class="btn" data-goto="optimize">See all tweaks</button>
          </div>
        </div>
      </div>

      <div class="section-title">Right now</div>
      ${liveCards()}

      <div class="section-title">Quick actions</div>
      <div class="grid cols-3">
        <div class="card quick" data-goto="cleanup"><div class="q-ic">${icon('broom')}</div><div><b>Clean up junk</b><span>Temp files, old updates, crash dumps</span></div></div>
        <div class="card quick" data-goto="network"><div class="q-ic">${icon('wifi')}</div><div><b>Test your ping</b><span>And find the fastest DNS for you</span></div></div>
        <div class="card quick" data-goto="booster"><div class="q-ic">${icon('gauge')}</div><div><b>Game Booster</b><span>Close background apps before you play</span></div></div>
      </div>`;
  },

  optimize() {
    const tabs = [['all', 'All'], ['rec', 'Recommended'], ...Object.entries(CATS)];
    const list = S.tweaks.filter((t) => S.optTab === 'all' || (S.optTab === 'rec' ? t.recommended : t.cat === S.optTab));
    const onN = list.filter((t) => (S.status[t.id] || {}).state === 'on').length;
    return `
      <div class="page-head">
        <div>
          <h1>Optimize</h1>
          <p>Flip a switch to turn a tweak on. Flip it back to put your old setting back exactly how it was.</p>
        </div>
        <div class="actions">
          <button class="btn primary" data-act="apply-rec" ${S.statusLoading || !recommendedLeft().length ? 'disabled' : ''}>${icon('bolt')} Apply recommended</button>
        </div>
      </div>
      <div class="tabs">${tabs.map(([id, l]) => `<button class="tab ${S.optTab === id ? 'active' : ''}" data-tab="${id}">${l}</button>`).join('')}
        <span class="muted small" style="margin-left:auto;align-self:center">${S.statusLoading ? '' : `${onN} of ${list.length} on`}</span></div>
      ${S.optTab === 'services' ? `<div class="note" style="margin-bottom:14px">${icon('info')}<div>These change when a Windows service starts. They only touch optional services, never anything Windows needs to run. Each one takes effect after a restart.</div></div>` : ''}
      <div class="grid tweaks">${list.map(tweakCard).join('')}</div>`;
  },

  booster() {
    const all = S.procs || [];
    const safe = all.filter((p) => p.tier === 'safe');
    const ask = all.filter((p) => p.tier === 'ask');
    const other = all.filter((p) => p.tier === 'other');
    const prot = all.filter((p) => p.tier === 'protected');
    let pickMem = 0;
    all.forEach((p) => { if (S.procPick.has(p.key)) pickMem += p.mem; });
    const row = (p) => `
      <div class="list-row">
        <button class="check ${S.procPick.has(p.key) ? 'on' : ''}" data-ppick="${esc(p.key)}">${icon('check')}</button>
        <div class="grow">
          <b>${esc(p.label)}${p.count > 1 ? ` <span class="muted small">×${p.count}</span>` : ''}</b>
          <div class="sub" title="${esc(p.why)}">${esc(p.why)}</div>
        </div>
        <div class="proc-num">${p.cpu}%<span>CPU</span></div>
        <div class="proc-num">${bytes(p.mem)}<span>RAM</span></div>
      </div>`;
    const section = (title, list, note) => !list.length ? '' : `
      <div class="section-title">${title}</div>
      ${note ? `<div class="muted small" style="margin:-4px 0 10px">${note}</div>` : ''}
      <div class="card flush"><div class="list">${list.map(row).join('')}</div></div>`;
    return `
      <div class="page-head">
        <div>
          <h1>Game Booster</h1>
          <p>Close background apps you don't need while you play. Windows, your drivers, your antivirus and anti-cheat are never on this list.</p>
        </div>
        <div class="actions">
          <button class="btn" data-act="proc-refresh" ${S.procBusy ? 'disabled' : ''}>${icon('refresh')} Refresh</button>
          ${S.procClosed.length ? `<button class="btn" data-act="proc-reopen" ${S.procBusy ? 'disabled' : ''}>${icon('undo')} Reopen closed apps</button>` : ''}
        </div>
      </div>

      <div class="card hero boost-hero">
        <div class="q-ic big">${icon('gauge')}</div>
        <div class="grow">
          <h2>${!S.procs ? 'Looking at what\'s running…' : S.procPick.size ? `${S.procPick.size} app${S.procPick.size > 1 ? 's' : ''} picked` : 'Nothing picked'}</h2>
          <p style="margin:0">${!S.procs ? 'This takes a second.' : S.procPick.size ? `Closing them frees about ${bytes(pickMem)} of RAM. Anything open in them, like unsaved work, will be lost.` : 'Tick the apps you want to close below.'}</p>
        </div>
        <button class="btn primary" data-act="proc-close" ${S.procBusy || !S.procPick.size ? 'disabled' : ''}>
          ${S.procBusy && S.procs ? '<span class="spinner"></span>' : icon('bolt')} Close ${S.procPick.size || ''} app${S.procPick.size === 1 ? '' : 's'}
        </button>
      </div>

      ${!S.procs ? '<div class="loading-row"><span class="spinner"></span>Reading running apps…</div>' : `
        ${section('Safe to close', safe, 'Picked for you. None of these are needed to play games.')}
        ${section('Close if you\'re not using them', ask, 'Not picked, because closing them does something you might notice.')}
        ${!safe.length && !ask.length ? '<div class="card empty">Nothing from our list is running right now. Your PC is already pretty clean.</div>' : ''}
        ${other.length ? `
          <div class="section-title" style="display:flex;align-items:center;gap:10px">Everything else
            <button class="btn small" data-act="proc-other">${S.showOther ? 'Hide' : `Show ${other.length}`}</button>
          </div>
          ${S.showOther ? `<div class="note warn" style="margin-bottom:10px">${icon('warn')}<div>These aren't on our list, so we can't tell you what closing them does. Only close one if you know what it is.</div></div>
            <div class="card flush"><div class="list">${other.map(row).join('')}</div></div>` : ''}` : ''}
        <div class="muted small" style="margin-top:18px">${prot.length} Windows, driver, security and anti-cheat processes are hidden and can't be closed from here.</div>`}`;
  },

  network() {
    const d = S.dns;
    const testMap = {};
    let best = null;
    (S.dnsTest || []).forEach((r) => {
      testMap[r.id] = r.ms;
      if (r.ms != null && r.id !== 'current' && (best == null || r.ms < testMap[best])) best = r.id;
    });
    const pings = S.ping || [];
    const p0 = pings.find((p) => p.avg != null);
    const netTweaks = S.tweaks.filter((t) => t.cat === 'network');
    const nb = S.netBusy;
    return `
      <div class="page-head"><div>
        <h1>Network &amp; ping</h1>
        <p>Check your connection, pick a faster DNS, and turn off the Windows settings that can add delay.</p>
      </div></div>

      <div class="grid cols-2">
        <div class="card">
          <div class="stat-top">${icon('wifi')}Ping test</div>
          <div class="ping-row">
            <div><div class="big-num">${p0 ? p0.avg : '—'}<small>ms</small></div><div class="muted small">Average ping</div></div>
            <div><div class="big-num">${p0 ? p0.jitter : '—'}<small>ms</small></div><div class="muted small">Jitter</div></div>
            <div><div class="big-num">${p0 ? p0.loss : '—'}<small>%</small></div><div class="muted small">Packet loss</div></div>
          </div>
          <div class="btn-row">
            <button class="btn primary" data-act="ping" ${nb.ping ? 'disabled' : ''}>${nb.ping ? '<span class="spinner"></span> Testing…' : `${icon('play')} Run test`}</button>
            <button class="btn" data-act="flush" ${nb.flush ? 'disabled' : ''}>${icon('refresh')} Flush DNS cache</button>
          </div>
          ${pings.length ? `<div class="muted small" style="margin-top:12px">${pings.map((p) => `${esc(p.host)}: ${p.avg != null ? `${p.avg} ms` : 'no reply'}`).join(' · ')}</div>` : ''}
        </div>

        <div class="card">
          <div class="stat-top">${icon('info')}What these mean</div>
          <p class="muted body-text">
            Ping is how long it takes your PC to reach a server and hear back. Jitter is how much that jumps around, and in games that's often worse than a high ping.
            DNS turns names like discord.com into addresses. A faster DNS makes websites and game launchers connect quicker, but it won't change your in-game ping once you're connected.
          </p>
        </div>
      </div>

      <div class="section-title">DNS server</div>
      <div class="card">
        ${!d ? '<div class="loading-row"><span class="spinner"></span>Reading your network settings…</div>' : `
          <div class="grid cols-2" style="gap:10px">
            ${d.presets.map((p) => `
              <div class="dns-opt ${d.current === p.id ? 'active' : ''}" data-dns="${p.id}">
                <div class="radio"></div>
                <div><b>${esc(p.title)}</b><div class="muted small" style="margin-top:2px">${esc(p.desc)}</div></div>
                <span class="ms ${best === p.id ? 'best' : ''}">${nb.dns === p.id ? '<span class="spinner"></span>' : testMap[p.id] != null ? `${testMap[p.id]} ms` : ''}</span>
              </div>`).join('')}
          </div>
          <div class="btn-row" style="margin-top:14px;align-items:center;flex-wrap:wrap">
            <button class="btn" data-act="dnstest" ${nb.dnstest ? 'disabled' : ''}>${nb.dnstest ? '<span class="spinner"></span> Testing…' : `${icon('search')} Test DNS speed`}</button>
            ${d.hasBackup ? `<button class="btn" data-act="dnsrestore">${icon('undo')} Put back my old DNS</button>` : ''}
            <span class="muted small" style="margin-left:auto">
              ${d.current === 'custom' ? 'You\'re using a custom DNS right now. ' : ''}
              ${testMap.current != null ? `Your current DNS: ${testMap.current} ms` : ''}
            </span>
          </div>`}
      </div>

      <div class="section-title">Network tweaks</div>
      <div class="grid tweaks">${netTweaks.map(tweakCard).join('')}</div>`;
  },

  cleanup() {
    const scan = S.cleanupScan;
    let total = 0;
    S.cleanupPick.forEach((id) => { total += (scan && scan[id] && scan[id].bytes) || 0; });
    return `
      <div class="page-head">
        <div>
          <h1>Cleanup</h1>
          <p>Clear out files Windows and your apps don't need anymore. Anything changed in the last hour gets skipped in case it's still in use.</p>
        </div>
        <div class="actions">
          <button class="btn" data-act="scan" ${S.cleanupBusy ? 'disabled' : ''}>${icon('refresh')} Scan again</button>
          <button class="btn primary" data-act="clean" ${S.cleanupBusy || !scan || total === 0 ? 'disabled' : ''}>
            ${S.cleanupBusy && scan ? '<span class="spinner"></span>' : icon('broom')} Clean ${scan ? bytes(total) : ''}
          </button>
        </div>
      </div>
      <div class="card flush"><div class="list">
        ${S.cleanupList.map((c) => {
          const r = scan && scan[c.id];
          const on = S.cleanupPick.has(c.id);
          return `
            <div class="list-row">
              <button class="check ${on ? 'on' : ''}" data-pick="${c.id}">${icon('check')}</button>
              <div class="grow"><b>${esc(c.title)}</b><div class="sub" title="${esc(c.desc)}">${esc(c.desc)}</div></div>
              <div class="size">${!scan ? (S.cleanupBusy ? '<span class="spinner"></span>' : '—') : r ? bytes(r.bytes) : '—'}</div>
            </div>`;
        }).join('')}
      </div></div>`;
  },

  startup() {
    const list = (S.startup || []).filter((x) => !S.startupFilter || `${x.label} ${x.company || ''} ${x.name}`.toLowerCase().includes(S.startupFilter));
    const onCount = (S.startup || []).filter((x) => x.enabled).length;
    return `
      <div class="page-head">
        <div>
          <h1>Startup apps</h1>
          <p>Apps that open by themselves when Windows starts. Turning one off doesn't uninstall it, it just won't launch until you open it. Same as the switch in Task Manager.</p>
        </div>
        <div class="actions">
          <div class="search">${icon('search')}<input id="startup-search" placeholder="Search apps" value="${esc(S.startupFilter)}"></div>
          <button class="btn" data-act="startup-refresh">${icon('refresh')} Refresh</button>
        </div>
      </div>
      ${S.startup ? `<div class="muted" style="margin:-8px 0 14px;font-size:13px">${onCount} of ${S.startup.length} start with Windows</div>` : ''}
      <div class="card flush"><div class="list">
        ${!S.startup ? '<div class="loading-row"><span class="spinner"></span>Looking for startup apps…</div>'
          : !list.length ? '<div class="empty">Nothing here.</div>'
          : list.map((x) => `
            <div class="list-row">
              <div class="grow">
                <b>${esc(x.label)}</b>
                <div class="sub" title="${esc(x.command)}">${esc(x.company || 'Unknown publisher')} · ${esc(x.scope)} · ${esc(x.command)}</div>
              </div>
              <span class="muted small" style="width:72px;text-align:right">${x.enabled ? 'Starts up' : 'Off'}</span>
              <button class="toggle ${x.enabled ? 'on' : ''} ${S.busy.has(x.id) ? 'busy' : ''}" data-startup="${esc(x.id)}" ${S.busy.has(x.id) ? 'disabled' : ''}></button>
            </div>`).join('')}
      </div></div>`;
  },

  stats() {
    const sys = S.sys || {};
    const spark = (arr) => {
      const w = 300, h = 70;
      if (arr.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}"></svg>`;
      const step = w / Math.max(arr.length - 1, 15);
      const pts = arr.map((v, i) => [w - (arr.length - 1 - i) * step, h - 4 - (Math.max(0, Math.min(100, v)) / 100) * (h - 8)]);
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
      const area = `${line}L${pts[pts.length - 1][0].toFixed(1)},${h}L${pts[0][0].toFixed(1)},${h}Z`;
      return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <defs><linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2dd4bf" stop-opacity=".35"/><stop offset="1" stop-color="#2dd4bf" stop-opacity="0"/></linearGradient></defs>
        <path class="area" d="${area}"/><path class="line" d="${line}"/></svg>`;
    };
    const l = S.live;
    const gpu = l && l.gpu;
    const g = (key, ic, title, val, unit, sub) => `
      <div class="card gauge-card">
        <div class="stat-top">${icon(ic)}${title}</div>
        <div class="stat-val">${val}<small>${unit}</small></div>
        <div class="stat-sub">${esc(sub)}</div>
        ${spark(S.hist[key])}
      </div>`;
    const up = l ? l.uptime : 0;
    let gpuSub = 'Temperature shows on NVIDIA cards';
    if (gpu && gpu.temp != null) {
      gpuSub = `${gpu.temp}°C`;
      if (gpu.vramTotal) gpuSub += ` · ${(gpu.vramUsed / 1024).toFixed(1)} / ${(gpu.vramTotal / 1024).toFixed(0)} GB VRAM`;
    }
    return `
      <div class="page-head"><div>
        <h1>Live stats</h1>
        <p>What your PC is doing right now. Updates every couple of seconds.</p>
      </div></div>
      <div class="grid cols-3">
        ${g('cpu', 'cpu', 'CPU usage', l ? l.cpu : '—', '%', `${sys.threads || '—'} threads`)}
        ${g('gpu', 'gpu', 'GPU usage', gpu && gpu.util != null ? gpu.util : '—', '%', gpuSub)}
        ${g('ram', 'ram', 'Memory', l ? (l.ramUsed / 1073741824).toFixed(1) : '—', ' GB', l ? `${bytes(l.ramTotal - l.ramUsed)} free` : '')}
      </div>
      <div class="section-title">Your PC</div>
      <div class="card">
        <div class="kv">
          <span>Windows</span><div>${esc(sys.os || '—')}${sys.build ? ` (build ${esc(sys.build)})` : ''}</div>
          <span>Processor</span><div>${esc(sys.cpu || '—')}</div>
          <span>Graphics</span><div>${esc((sys.gpus || []).join(', ') || '—')}</div>
          <span>Memory</span><div>${sys.ram ? bytes(sys.ram) : '—'}</div>
          <span>System drive</span><div>${sys.diskFree != null ? `${bytes(sys.diskFree)} free of ${bytes(sys.diskFree + sys.diskUsed)}` : '—'}</div>
          <span>Up for</span><div>${up ? `${Math.floor(up / 86400)}d ${Math.floor((up % 86400) / 3600)}h ${Math.floor((up % 3600) / 60)}m` : '—'}</div>
        </div>
      </div>`;
  },

  backups() {
    const ours = S.tweaks.filter((t) => (S.status[t.id] || {}).ours);
    const rpOn = S.info && S.info.settings && S.info.settings.restorePointBeforeApply;
    return `
      <div class="page-head">
        <div>
          <h1>Backups &amp; undo</h1>
          <p>Every change Tranquil Boost makes is listed here with your old setting saved, so you can put things back one at a time or all at once.</p>
        </div>
        <div class="actions">
          <button class="btn danger" data-act="undo-all" ${!ours.length ? 'disabled' : ''}>${icon('undo')} Undo everything</button>
        </div>
      </div>

      <div class="card flush"><div class="list">
        ${!ours.length ? '<div class="empty">Nothing changed yet. Tweaks you turn on will show up here.</div>'
          : ours.map((t) => `
            <div class="list-row">
              <div class="grow"><b>${esc(t.title)}</b><div class="sub">${CATS[t.cat]} · ${EFFECT[t.effect]}</div></div>
              <button class="btn small" data-undo="${t.id}" ${S.busy.has(t.id) ? 'disabled' : ''}>${S.busy.has(t.id) ? '<span class="spinner"></span>' : icon('undo')} Undo</button>
            </div>`).join('')}
      </div></div>

      <div class="section-title">Windows restore points</div>
      <div class="grid cols-2">
        <div class="card">
          <div class="stat-top">${icon('restore')}Restore point</div>
          <p class="muted body-text">A snapshot of your system settings made by Windows itself. If something ever goes really wrong, you can roll back with it even without this app. Windows only allows one every 24 hours.</p>
          <div class="btn-row">
            <button class="btn primary" data-act="rp" ${S.netBusy.rp ? 'disabled' : ''}>${S.netBusy.rp ? '<span class="spinner"></span> Making one…' : 'Make one now'}</button>
            <button class="btn" data-act="rp-open">Open System Restore</button>
          </div>
        </div>
        <div class="card">
          <div class="stat-top">${icon('shield')}Safety</div>
          <div class="list-row" style="padding:14px 0 0;border:0">
            <div class="grow"><b>Make a restore point before the first change</b><div class="sub">Once each time you open the app, before any tweak goes on</div></div>
            <button class="toggle ${rpOn ? 'on' : ''}" data-act="rp-setting"></button>
          </div>
        </div>
      </div>`;
  },
};

function render() {
  const fn = RENDER[S.page];
  const page = $('#page');
  const scroll = page.scrollTop;
  page.innerHTML = fn ? fn() : '';
  page.scrollTop = scroll;
  if (S.page === 'startup' && S.startupFocus) {
    const inp = $('#startup-search');
    if (inp) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  }
}

// ---------- data loading ----------
async function scanCleanup() {
  S.cleanupBusy = true;
  render();
  try {
    S.cleanupScan = await api.cleanup.scan();
  } catch (e) {
    toast(`Scan failed: ${cleanError(e)}`, 'err');
  }
  S.cleanupBusy = false;
  render();
}

async function runClean() {
  const ids = [...S.cleanupPick];
  if (ids.includes('recycle-bin')) {
    const ok = await confirmBox('Empty the Recycle Bin?', 'Files in the Recycle Bin will be deleted for good. You can\'t get them back after this.', 'Empty it', true);
    if (!ok) return;
  }
  S.cleanupBusy = true;
  render();
  try {
    const r = await api.cleanup.clean(ids);
    toast(`Freed up ${bytes(r.freed)}.`);
  } catch (e) {
    toast(`Cleanup failed: ${cleanError(e)}`, 'err');
  }
  S.cleanupBusy = false;
  api.stats.info().then((s) => { S.sys = s; }).catch(() => {});
  await scanCleanup();
}

async function loadStartup() {
  S.startup = null;
  render();
  try {
    S.startup = await api.startup.scan();
    S.startup.sort((a, b) => a.label.localeCompare(b.label));
  } catch (e) {
    S.startup = [];
    toast(`Couldn't read startup apps: ${cleanError(e)}`, 'err');
  }
  render();
}

async function toggleStartup(id) {
  const item = (S.startup || []).find((x) => x.id === id);
  if (!item || S.busy.has(id)) return;
  S.busy.add(id);
  render();
  try {
    await api.startup.set(id, !item.enabled);
    item.enabled = !item.enabled;
    toast(item.enabled ? `${item.label} will start with Windows again.` : `${item.label} won't start with Windows anymore.`);
  } catch (e) {
    toast(cleanError(e), 'err');
  }
  S.busy.delete(id);
  render();
}

async function loadProcs(pickDefaults) {
  S.procBusy = true;
  render();
  try {
    S.procs = await api.proc.list();
    const keys = new Set(S.procs.map((p) => p.key));
    [...S.procPick].forEach((k) => { if (!keys.has(k)) S.procPick.delete(k); });
    if (pickDefaults) S.procs.forEach((p) => { if (p.tier === 'safe') S.procPick.add(p.key); });
  } catch (e) {
    S.procs = S.procs || [];
    toast(`Couldn't read running apps: ${cleanError(e)}`, 'err');
  }
  S.procBusy = false;
  render();
}

async function closeProcs() {
  const keys = [...S.procPick];
  const risky = (S.procs || []).filter((p) => S.procPick.has(p.key) && p.tier !== 'safe');
  if (risky.length) {
    const ok = await confirmBox(`Close ${keys.length} app${keys.length > 1 ? 's' : ''}?`,
      `Heads up: ${risky.map((p) => p.label).join(', ')} ${risky.length > 1 ? 'are' : 'is'} picked. ${risky[0].why}`, 'Close them');
    if (!ok) return;
  }
  S.procBusy = true;
  render();
  try {
    const r = await api.proc.close(keys);
    S.procClosed = await api.proc.closed();
    toast(r.closed.length ? `Closed ${r.closed.length} app${r.closed.length > 1 ? 's' : ''} and freed about ${bytes(r.freed)} of RAM.` : 'Nothing was closed. Those apps may have already quit.', r.closed.length ? 'ok' : 'info');
    S.procPick.clear();
  } catch (e) {
    toast(cleanError(e), 'err');
  }
  S.procBusy = false;
  await loadProcs(false);
}

async function loadDns() {
  try { S.dns = await api.net.dns(); } catch (e) { toast(`Couldn't read DNS settings: ${cleanError(e)}`, 'err'); }
  render();
}

async function netAction(key, fn) {
  if (S.netBusy[key]) return;
  S.netBusy[key] = true;
  render();
  try { await fn(); } catch (e) { toast(cleanError(e), 'err', 6500); }
  delete S.netBusy[key];
  render();
}

async function statsTick() {
  if (S.page === 'home' || S.page === 'stats') {
    try {
      const l = await api.stats.sample();
      S.live = l;
      const push = (k, v) => { S.hist[k].push(v); if (S.hist[k].length > 60) S.hist[k].shift(); };
      push('cpu', l.cpu);
      push('ram', (l.ramUsed / l.ramTotal) * 100);
      push('gpu', l.gpu && l.gpu.util != null ? l.gpu.util : 0);
      if (!document.querySelector('.modal-back') && (S.page === 'home' || S.page === 'stats')) render();
    } catch { /* skip a missed sample */ }
  }
  setTimeout(statsTick, 2000);
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, [data-goto], [data-dns]');
  if (!t || t.disabled) return;
  const d = t.dataset;

  if (d.win) { api.win[d.win](); return; }
  if (d.page) { go(d.page); return; }
  if (d.goto) { go(d.goto); return; }
  if (d.tab) { S.optTab = d.tab; render(); return; }
  if (d.tweak) { toggleTweak(d.tweak); return; }
  if (d.undo) { toggleTweak(d.undo); return; }
  if (d.startup) { toggleStartup(d.startup); return; }
  if (d.ppick) {
    if (S.procPick.has(d.ppick)) S.procPick.delete(d.ppick); else S.procPick.add(d.ppick);
    render();
    return;
  }
  if (d.pick) {
    if (S.cleanupPick.has(d.pick)) S.cleanupPick.delete(d.pick); else S.cleanupPick.add(d.pick);
    render();
    return;
  }
  if (d.dns) {
    if (!S.dns || S.dns.current === d.dns || S.netBusy.dns) return;
    const preset = S.dns.presets.find((p) => p.id === d.dns);
    const pick = d.dns;
    netAction('dns', async () => {
      S.netBusy.dns = pick;
      render();
      await api.net.setDns(pick);
      S.dns = await api.net.dns();
      toast(`Switched DNS to ${preset.title}.`);
    });
    return;
  }

  switch (d.act) {
    case 'apply-rec': applyRecommended(); break;
    case 'scan': scanCleanup(); break;
    case 'clean': runClean(); break;
    case 'startup-refresh': loadStartup(); break;
    case 'proc-refresh': loadProcs(false); break;
    case 'proc-close': closeProcs(); break;
    case 'proc-other': S.showOther = !S.showOther; render(); break;
    case 'proc-reopen': {
      S.procBusy = true;
      render();
      try { const r = await api.proc.reopen(); S.procClosed = []; toast(`Reopening ${r.reopened} app${r.reopened === 1 ? '' : 's'}.`); } catch (err) { toast(cleanError(err), 'err'); }
      S.procBusy = false;
      setTimeout(() => loadProcs(false), 2500);
      break;
    }
    case 'ping': netAction('ping', async () => { S.ping = await api.net.ping(); }); break;
    case 'flush': netAction('flush', async () => { await api.net.flush(); toast('DNS cache cleared.'); }); break;
    case 'dnstest': netAction('dnstest', async () => { S.dnsTest = await api.net.dnsTest(); }); break;
    case 'dnsrestore':
      netAction('dnsrestore', async () => { await api.net.restoreDns(); S.dns = await api.net.dns(); toast('Your old DNS settings are back.'); });
      break;
    case 'undo-all': {
      const ok = await confirmBox('Undo everything?', 'Every tweak Tranquil Boost turned on goes back to how it was before. Your DNS and startup apps aren\'t touched.', 'Undo everything', true);
      if (!ok) return;
      S.tweaks.forEach((x) => { if ((S.status[x.id] || {}).ours) S.busy.add(x.id); });
      render();
      try {
        const r = await api.tweaks.undoAll();
        noteEffect('restart');
        if (r.failed.length) toast(`Some couldn't be undone: ${r.failed.map((f) => f.error).join(' ')}`, 'err', 8000);
        else toast('Everything is back to how it was.');
      } catch (err) { toast(cleanError(err), 'err'); }
      S.busy.clear();
      await refreshStatus();
      break;
    }
    case 'rp':
      netAction('rp', async () => {
        const r = await api.restorePoint();
        if (r.reason === 'created') toast('Restore point made.');
        else if (r.reason === 'recent') toast('Windows already made one in the last 24 hours, so it skipped this one.', 'info', 6500);
        else toast('System Restore is turned off on this PC. You can turn it on in Windows under "Create a restore point".', 'err', 8000);
      });
      break;
    case 'rp-open': api.openRestore(); break;
    case 'rp-setting': {
      const cur = !!(S.info.settings && S.info.settings.restorePointBeforeApply);
      S.info.settings = await api.setSetting('restorePointBeforeApply', !cur);
      render();
      break;
    }
    default: break;
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'startup-search') {
    S.startupFilter = e.target.value.toLowerCase();
    S.startupFocus = true;
    render();
  }
});
document.addEventListener('focusout', (e) => {
  if (e.target.id === 'startup-search' && e.relatedTarget) S.startupFocus = false;
});

// ---------- boot ----------
async function boot() {
  renderNav();
  render();
  const [info, tweaks, cl] = await Promise.all([api.info(), api.tweaks.list(), api.cleanup.list()]);
  S.info = info;
  S.tweaks = tweaks;
  S.cleanupList = cl;
  cl.forEach((c) => { if (c.defaultOn) S.cleanupPick.add(c.id); });
  $('#admin-pill').innerHTML = info.admin
    ? '<span class="pill ok"><span class="dot"></span>Running as admin</span>'
    : '<span class="pill warn"><span class="dot"></span>Not running as admin, so most tweaks won\'t work</span>';
  renderNav();
  render();
  api.stats.info().then((s) => { S.sys = s; render(); }).catch(() => {});
  statsTick();
  refreshStatus();
}

boot();
