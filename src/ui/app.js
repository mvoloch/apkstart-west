'use strict';

const api = window.apkstart;
const $ = (id) => document.getElementById(id);

const state = {
  apps: [],
  settings: null,
  status: null,
  filter: '',
  installing: false,
  setupBusy: null,
  menuPkg: null,
};

/* ---------------- 工具 ---------------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function initialOf(label) {
  const t = String(label || '?').trim();
  return (t[0] || '?').toUpperCase();
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

function relTime(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60000) return tr('just now');
  if (d < 3600000) return tr('{n} min ago', { n: Math.floor(d / 60000) });
  if (d < 86400000) return tr('{n} h ago', { n: Math.floor(d / 3600000) });
  if (d < 86400000 * 30) return tr('{n} d ago', { n: Math.floor(d / 86400000) });
  return new Date(ts).toLocaleDateString(window.uiLang === 'pt-BR' ? 'pt-BR' : 'en-US');
}

/**
 * 迷你 toast
 *
 * 同一类消息做去重 + 数量上限：
 * 安装失败时里面有「运行时启动日志」在持续推送，以前每条都新建一个 toast，
 * 于是屏幕上会不停叠加同一条错误，看起来像「失败信息一直循环」。
 */
let _toastSeq = 0;
function toast({ title, body = '', type = 'info', progress = null, sticky = false, spinner = false }) {
  const wrap = $('toastWrap');
  // ① 去重：同样的标题 + 正文（4 秒内）只刷新那一条，不叠加
  const key = `${title}|${body}`;
  const dup = [...wrap.children].find((n) => n.dataset.key === key && Date.now() - Number(n.dataset.at || 0) < 4000);
  if (dup) {
    dup.dataset.at = String(Date.now());
    return {
      el: dup,
      dismiss: () => dup.remove(),
      update: ({ title: t2, body: b2 } = {}) => {
        if (t2 !== undefined) dup.querySelector('.t-title-text').textContent = t2;
        if (b2 !== undefined) dup.querySelector('.t-body').textContent = b2;
      },
    };
  }
  // ② 上限：同时最多 4 条，超出先挤掉最旧的
  while (wrap.children.length >= 4) wrap.firstElementChild.remove();

  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.dataset.key = key;
  el.dataset.at = String(Date.now());
  el.dataset.seq = String(++_toastSeq);
  el.innerHTML = `
    <div class="t-title">
      ${spinner ? '<span class="spinner"></span>' : ''}
      <span class="t-title-text">${esc(title)}</span>
    </div>
    <div class="t-body">${esc(body)}</div>
    ${progress === null ? '' : '<div class="bar"><i></i></div>'}
  `;
  $('toastWrap').appendChild(el);

  const dismiss = () => {
    el.style.transition = 'opacity .18s, transform .18s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(4px)';
    setTimeout(() => el.remove(), 200);
  };

  const ctl = {
    el, dismiss,
    update({ title: t2, body: b2, progress: p2, type: ty } = {}) {
      if (t2 !== undefined) el.querySelector('.t-title-text').textContent = t2;
      if (b2 !== undefined) el.querySelector('.t-body').textContent = b2;
      if (p2 !== undefined && el.querySelector('.bar i')) {
        el.querySelector('.bar i').style.width = `${Math.max(2, Math.min(100, p2))}%`;
      }
      if (ty === 'error') el.classList.add('error');
      if (ty === 'ok') {
        el.querySelector('.spinner')?.remove();
        el.classList.remove('error');
      }
    },
  };

  if (!sticky) setTimeout(dismiss, type === 'error' ? 6000 : 3200);
  return ctl;
}

/* ---------------- 内置手册 ---------------- */

/** 打开内置手册；传故障信息时由主进程映射到对应章节 */
function openManual(payload) {
  if (!api || typeof api.openManual !== 'function') return Promise.resolve(null);
  return api.openManual(payload || { topic: 'overview' }).catch(() => null);
}

/** 自动检测问题 → 对应教程。reason 只影响主进程的去重策略。 */
function openManualForIssue(issue, reason = 'clicked') {
  if (!issue) return openManual({ topic: 'overview', reason });
  return openManual({
    issue: issue.code,
    title: issue.title,
    detail: issue.detail,
    reason,
  });
}

/** 安装/运行原始报错 → 对应教程 */
function openManualForError(message, reason = 'install-failed') {
  return openManual({ error: message, reason });
}

/* ---------------- 渲染 ---------------- */

function visibleApps() {
  const q = state.filter.trim().toLowerCase();
  if (!q) return state.apps;
  return state.apps.filter((a) => (
    a.label.toLowerCase().includes(q)
    || a.package.toLowerCase().includes(q)
  ));
}

function renderGrid() {
  const apps = visibleApps();
  const grid = $('grid');
  const empty = $('empty');

  const hasAny = state.apps.length > 0;
  grid.classList.toggle('hidden', apps.length === 0);
  empty.classList.toggle('hidden', apps.length > 0);

  if (!hasAny) {
    const s = state.status;
    $('emptyHint').textContent = s && s.adbOk === false
      ? tr('First time here: open Settings (top right) → Runtime → Set up everything, then come back to install apps.')
      : tr('Tip: all apps share the same Android runtime, so the second app starts almost instantly.');
    grid.innerHTML = '';
    return;
  }

  // 末尾放一块「添加应用」虚线卡片。
  // 目的不只是好看：应用少的时候下面是一大片空白，用户不知道该干什么；
  // 这块卡片把「还能拖 APK 进来」这件事直接摆在眼前，也顺手填掉了空白。
  grid.innerHTML = apps.map((a) => `
    <div class="card" data-pkg="${esc(a.package)}" title="${esc(a.label)} · ${esc(a.package)}">
      ${a.pinned ? '<span class="pin">★</span>' : ''}
      ${a.running ? `<span class="badge-run" title="${esc(tr('Running'))}"></span>` : ''}
      <div class="icon">
        ${a.iconUrl
          ? `<img src="${esc(a.iconUrl)}" alt="" draggable="false" />`
          : `<div class="fallback" style="background:${esc(a.accent || '#9aa6b2')}">${esc(initialOf(a.label))}</div>`}
      </div>
      <div class="name">${esc(a.label)}</div>
      <div class="meta">${a.running ? esc(tr('Running')) : `v${esc(a.versionName)}${a.lastLaunchAt ? ' · ' + esc(relTime(a.lastLaunchAt)) : ''}`}</div>
      <div class="open-hint">${a.running ? esc(tr('Switch to front')) : esc(tr('Open'))}</div>
    </div>
  `).join('') + `
    <div class="card card-add" id="cardAdd" role="button" tabindex="0" title="${esc(tr('Drop an APK file here, or click to choose one'))}">
      <div class="add-plus" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round"><path d="M12 6v12"/><path d="M6 12h12"/></svg>
      </div>
      <div class="name">${esc(tr('Add app'))}</div>
      <div class="meta">${esc(tr('Drop an APK to install it'))}</div>
    </div>
  `;
}

/* ---------------- 数据刷新 ---------------- */

async function refreshApps() {
  try {
    state.apps = await api.listApps();
    renderGrid();
    updateStats();
  } catch (e) {
    console.error(e);
  }
}

function updateStats() {
  const n = state.apps.length;
  $('statusStats').textContent = n ? tr('{n} apps', { n }) : tr('No apps yet');
}

async function refreshStatus() {
  try {
    state.status = await api.runtimeStatus();
    const s = state.status;
    const dot = $('statusDot');
    const text = $('statusText');
    const tag = $('engineTag');

    if (!s.adbOk) {
      dot.className = 'dot err';
      text.textContent = tr('Runtime not set up — open Settings → Runtime and run Set up everything');
      tag.textContent = tr('Setup needed');
      tag.className = 'brand-tag';
    } else if (s.deviceOnline) {
      dot.className = 'dot ok';
      text.textContent = tr('Runtime ready · Android {ver}', { ver: s.android || '?' }) + (s.freeform ? ' · ' + tr('separate windows enabled') : '');
      tag.textContent = `Android ${s.android || ''}`.trim();
      tag.className = 'brand-tag ok';
    } else if (s.phase === 'booting' || s.vmStarting) {
      dot.className = 'dot warn';
      text.textContent = tr('Starting Android…');
      tag.textContent = tr('Starting');
      tag.className = 'brand-tag';
    } else if (s.needsSetup === 'accel') {
      dot.className = 'dot warn';
      // 说清「怎么修」而不是只说「没开」——这句是状态条上最容易被看到的位置
      text.textContent = tr('Hardware acceleration is off: using slow software emulation. Click "Environment check → Fix" at the bottom right to turn it on');
      tag.textContent = tr('Software emulation');
      tag.className = 'brand-tag';
    } else if (s.needsSetup === 'sysimg') {
      dot.className = 'dot err';
      text.textContent = tr('Android 14 system image missing — download it in Settings → Runtime (about 1.5 GB, only once)');
      tag.textContent = tr('Image to download');
      tag.className = 'brand-tag';
    } else if (s.needsSetup === 'emulator') {
      dot.className = 'dot err';
      text.textContent = tr('Runtime engine not installed — open Settings → Runtime and run Set up everything');
      tag.textContent = tr('Setup needed');
      tag.className = 'brand-tag';
    } else if (s.needsSetup === 'boot') {
      dot.className = 'dot warn';
      text.textContent = tr('Runtime ready — installing an APK or double-clicking a desktop icon will start it automatically');
      tag.textContent = tr('Not started');
      tag.className = 'brand-tag';
    } else if (s.installing) {
      dot.className = 'dot warn';
      text.textContent = tr('Installer running — finish the installation in the virtual machine window');
      tag.textContent = tr('Installing');
      tag.className = 'brand-tag';
    } else {
      dot.className = 'dot';
      text.textContent = s.installed
        ? tr('Runtime idle (it starts automatically when you install or open an app)')
        : tr('Android is not installed in the runtime yet — open Settings → Runtime to continue');
      tag.textContent = s.installed ? tr('Idle') : tr('Not installed');
      tag.className = 'brand-tag';
    }
    $('statusDevice').textContent = s.deviceOnline ? (s.serial || '') : '';
    // 网络状态：这是用户最容易踩的坑（应用里一直「网络错误」，但看不出是虚拟机没网）。
    // 直接摆在状态栏，出问题时一眼能看到，不用去翻日志。
    const netEl = $('statusNet');
    const netSep = $('statusNetSep');
    if (netEl) {
      const show = !!s.deviceOnline && !!s.network;
      netEl.hidden = !show;
      if (netSep) netSep.hidden = !show;
      if (show) {
        netEl.textContent = s.network.ok ? tr('Network OK {ip}', { ip: s.network.ip || '' }).trim() : tr('VM offline');
        netEl.className = 'status-item status-net ' + (s.network.ok ? 'ok' : 'warn');
        netEl.title = s.network.ok
          ? tr('The Android virtual machine is online; apps that need the internet can load normally')
          : tr('The Android virtual machine has no network, so online pages stay blank or show errors. You can fix it in Settings → Repair network');
      }
    }

    renderSetup(s);
  } catch (e) {
    $('statusText').textContent = tr('Status check failed: {msg}', { msg: e.message });
  }
}

/* ---------------- 运行时部署（固定在设置里） ---------------- */

/**
 * 运行时/部署/自检面板现在都收在「设置」里，主界面只留已安装应用。
 * 保留 showSetup 给托盘菜单与 ui:navigate 复用，语义改为「打开设置并定位到运行时」。
 */
function showSetup(on) {
  if (!on) { $('setupGuide').hidden = true; return; }
  openSettings().then(() => {
    focusGroup($('runtimeGroup'));
  }).catch(() => {});
}

function fmtGB(n) { return n ? `${(n / 1073741824).toFixed(2)} GB` : ''; }

function stepRow(opt) {
  const cls = ['step'];
  if (opt.done) cls.push('done');
  if (opt.busy) cls.push('busy');
  return `
    <div class="${cls.join(' ')}" data-step="${opt.key}">
      <div class="idx">${opt.done ? '✓' : opt.index}</div>
      <div class="body">
        <div class="t">${esc(opt.title)}${opt.tag ? `<span class="tag ${opt.req ? 'req' : ''}">${esc(opt.tag)}</span>` : ''}</div>
        <div class="d" data-desc>${esc(opt.desc)}</div>
        <div class="bar"><i data-bar></i></div>
      </div>
      <div class="act">${opt.actions || ''}</div>
    </div>`;
}

function renderSetup(s) {
  if (!s) return;
  const env = s.env || {};
  const hv = env.hypervisor || {};
  const accel = env.accel || s.accel || {};

  // 启动即见已安装应用：不再用部署向导整屏接管主界面，
  // 状态只在设置里的运行时面板 + 底部状态条上体现。
  const accelOk = accel.ok || hv.whpx;
  const adbDone = !!(env.adb && env.adb.ok);
  const emuDone0 = !!(env.emulator && env.emulator.ok);
  const imgDone0 = !!(env.sysimg && env.sysimg.ok);
  const allDone0 = adbDone && emuDone0 && imgDone0;
  const stateText = $('setupStateText');
  if (stateText) {
    const missing = [];
    if (!adbDone) missing.push('adb');
    if (!emuDone0) missing.push(tr('engine'));
    if (!imgDone0) missing.push(tr('system image'));
    stateText.textContent = s.deviceOnline
      ? tr('Ready · Android {ver}', { ver: s.android || '' })
      : s.phase === 'booting' || s.vmStarting
        ? tr('Starting Android…')
        : allDone0
          ? tr('All components present · not started (starts when you open an app)')
          : tr('Missing {list}', { list: missing.join(', ') }) + (accelOk ? '' : ' ' + tr('(no hardware acceleration, will fall back to software emulation)'));
    stateText.title = s.autoProfile || accel.note || hv.note || '';
  }

  const emuDone = !!(env.emulator && env.emulator.ok);
  const imgDone = !!(env.sysimg && env.sysimg.ok);
  const busy = state.setupBusy;
  const booting = s.phase === 'booting';

  // 只保留一个步骤：下载、参数自适应、开机全部由「一键完成」串起来，
  // 且首次启动会在后台自动跑，用户不需要逐步点击。
  const allDone = !!(env.adb && env.adb.ok) && emuDone && imgDone;
  const left = [];
  if (!(env.adb && env.adb.ok)) left.push(tr('adb toolchain'));
  if (!emuDone) left.push(tr('Android runtime'));
  if (!imgDone) left.push(tr('system image'));
  const step = {
    key: 'all',
    index: 1,
    title: allDone ? tr('All set') : tr('Set up everything'),
    tag: allDone ? tr('Done automatically') : tr('Automatic'),
    done: allDone,
    busy: !!busy,
    desc: s.deviceOnline
      ? tr('Android {ver} is ready · app windows adapt to your screen automatically', { ver: s.android || '' })
      : booting
        ? tr('Starting Android…')
        : allDone
          ? tr('All components present; double-click any APK or desktop icon to start automatically')
          : tr('Still missing {list}; click "Set up everything" below to install it all in the background and start automatically', { list: left.join(', ') }),
    actions: s.deviceOnline
      ? `<button class="btn ghost sm" data-act="vmStop">${esc(tr('Stop runtime'))}</button>`
      : '',
  };

  $('setupSteps').innerHTML = stepRow(step);
  $('btnDeployAll').disabled = !!busy;
  $('btnDeployAll').textContent = busy ? tr('Working…') : (allDone ? tr('Done · click to re-check') : tr('Set up everything'));
  // 「上次为什么没起来」优先显示落盘的失败记录：进程重启后内存里的 diagnosis 是空的，
  // 只显示 autoProfile 会让用户完全看不出原因（issue #20/#25 的报告就是这样）。
  const lf = s.lastFailure;
  const lastMsg = (lf && lf.diagnosis && lf.diagnosis.title)
    ? tr('Last start failed: {title}', { title: lf.diagnosis.title })
    : (s.diagnosis ? tr('Last start, automatic diagnosis: {title}', { title: s.diagnosis.title }) : '');
  $('setupNote').textContent = lastMsg
    || s.autoProfile || tr('Fully automatic: no image to pick, no acceleration to enable, no memory to tune');
}

function store_getDiskSize() {
  return (state.settings && state.settings.runtime && state.settings.runtime.diskSizeGB) || 24;
}

function setStepBusy(key, on) {
  state.setupBusy = on ? key : null;
  // 五步已合并成一行，所有子步骤的进度都落在这唯一的进度条上
  const row = $('setupSteps').querySelector('[data-step="all"]');
  if (row) {
    row.classList.toggle('busy', !!on);
    if (on) {
      const bar = row.querySelector('[data-bar]');
      if (bar) bar.style.width = '3%';
    }
  }
}

function updateStepProgress(component, p) {
  if (!component) return;
  const row = $('setupSteps').querySelector('[data-step="all"]');
  if (!row) return;
  if (p.percent !== undefined) {
    const bar = row.querySelector('[data-bar]');
    if (bar) bar.style.width = `${Math.max(3, Math.min(100, p.percent))}%`;
  }
  if (p.message) {
    const d = row.querySelector('[data-desc]');
    if (d) d.textContent = p.message;
  }
}

async function deployAll() {
  if (state.setupBusy) return;
  setStepBusy('all', true);
  try {
    // 一次调用把 adb / 引擎 / 系统镜像全装完，进度统一显示在唯一那一行
    // 用户点「一键部署」属于明确的手动重试，绕过失败冷却
    const r = await api.autoDeploy({ force: true });
    if (!r || !r.ok) {
      toast({ title: tr('Setup failed'), body: (r && r.error) || tr('Check your network and try again'), type: 'error', sticky: true });
      return;
    }
    await refreshStatus();
    toast({ title: tr('Components ready, starting automatically…'), body: tr('The first start takes about 1-3 minutes, later ones a few seconds.'), type: 'info' });
    const started = await api.runtimeStart();
    await refreshStatus();
    toast(started && started.ok
      ? { title: tr('Runtime ready'), body: tr('Now drop an APK into the window, or double-click a desktop icon.'), type: 'ok' }
      : { title: tr('Start did not finish'), body: (started && started.error) || tr('Export a diagnostic report to see the cause'), type: 'error', sticky: true });
  } catch (e) {
    toast({ title: tr('Setup failed'), body: e.message, type: 'error', sticky: true });
  } finally {
    setStepBusy('all', false);
    await refreshStatus();
    selfCheck();
  }
}

async function runStep(key) {
  if (state.setupBusy) return { ok: false, error: tr('A setup task is already running') };
  setStepBusy(key, true);
  let r;
  try {
    if (key === 'adb') r = await api.installAdb();
    else if (key === 'emulator') r = await api.installEmulator();
    else if (key === 'sysimg') r = await api.installSysimg();
    else if (key === 'accel') {
      const t = toast({
        title: tr('Installing the hardware acceleration driver…'),
        body: tr('Click "Yes" in the permission prompt that appears'),
        sticky: true,
        spinner: true,
      });
      r = await api.enableAccel();
      if (r.ok) t.update({ title: tr('Hardware acceleration enabled'), type: 'ok' });
      else t.update({ title: tr('Acceleration not enabled'), body: r.error, type: 'error', sticky: true });
    } else if (key === 'qemu') r = await api.installQemu();
    else if (key === 'iso') r = await api.downloadIso();
    else if (key === 'disk') r = await api.createDisk(store_getDiskSize());
    else r = { ok: false, error: tr('Unknown step') };
  } catch (e) {
    r = { ok: false, error: e.message };
  }
  setStepBusy(key, false);
  await refreshStatus();
  return r;
}

async function startInstall() {
  const r = await api.startInstaller();
  if (!r.ok) {
    toast({ title: tr('Could not start the installer'), body: r.error, type: 'error', sticky: true });
    return;
  }
  $('setupGuide').hidden = false;
  $('setupGuide').scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast({ title: tr('Virtual machine window opened'), body: tr('Follow the 6 steps below to finish the installation, then click "I have finished installing".'), type: 'ok', sticky: true });
}

async function markInstalled() {
  await api.markInstalled();
  await api.runtimeStop();
  $('setupGuide').hidden = true;
  await refreshStatus();
  toast({ title: tr('Installation finished, runtime is ready'), body: tr('You can now drop APK files here to install them.'), type: 'ok' });
}



/* ---------------- 安装 ---------------- */

/** 把安装失败翻译成「下一步该做什么」，只对最常见的几种做提示，其它原样显示 */
function friendlyInstallErrorText(msg) {
  const s = String(msg || tr('Unknown error'));
  if (/INSUFFICIENT_STORAGE|not enough space|no space|disk space|空间不足|ENOSPC/i.test(s)) { // i18n-keep
    return `${s}\n${tr('The Android data partition is too small: go to Settings → Performance and resources → increase the Android data partition, then click "Expand now".')}`;
  }
  // 只有真正失败才走到这里：切换镜像是「进行中」的进度提示（install:progress），
  // 绝不能在红色失败横幅里再说「正在重试」——那会让用户以为还在处理，其实是真的失败了。
  if (/NO_MATCHING_ABIS/i.test(s)) {
    return /已切换到.*仍然安装失败|switched to .*still failed|abiRetried/i.test(s) // i18n-keep
      ? `${s}\n${tr('The ARM compatibility image is already on and the install still fails. Go to Settings → Diagnostics and repair, export a diagnostic report and send it as feedback.')}`
      : `${s}\n${tr('This package only has ARM libraries. The app will switch to the compatibility image and reinstall once; watch for the next message.')}`;
  }
  if (/INSTALL_FAILED_ALREADY_EXISTS|signatures do not match/i.test(s)) {
    return `${s}\n${tr('Same package name but a different signature (common when it was installed from another source). Right-click the app card, choose "Uninstall", then install again.')}`;
  }
  if (/INSTALL_FAILED_VERSION_DOWNGRADE/i.test(s)) return `${s}\n${tr('A newer version is already installed. Uninstall it from the right-click menu first, then install again.')}`;
  if (/ERR_FS_FILE_TOO_LARGE|greater than possible Buffer|Cannot allocate|ENOMEM|out of memory/i.test(s)) {
    return `${s}\n${tr('This package is too large or memory is low, so the system refused to parse it. Make sure disk and memory are sufficient and try again;')}`
      + ' ' + tr('if it still fails, move the package to a short, plain-English path (such as D:\\a.apk).');
  }
  return s;
}

/* 当前那条「正在安装…」的 sticky 提示。install:error 事件要能把它收掉：
 * 主进程是先 send('install:error') 再让 invoke 失败的，两者都可能到得很晚，
 * 只靠 catch 收会出现「报错了右下角还在转圈」。 */
let installToast = null;

async function installFiles(paths) {
  if (!paths || !paths.length) return;
  if (state.installing) {
    toast({ title: tr('An install is already running'), body: tr('Please wait until the current app finishes installing.') });
    return;
  }
  state.installing = true;
  let ok = 0;
  let failed = 0;

  for (const p of paths) {
    const name = p.split(/[\\/]/).pop();
    const t = toast({ title: tr('Installing {name}', { name }), body: tr('Reading the APK…'), progress: 8, sticky: true, spinner: true });
    installToast = t;
    let off = () => {};
    try {
      off = api.on('install:progress', (pr) => {
        const base = { parse: 12, 'parse-done': 24, runtime: 38, install: 62, shortcut: 88, done: 100 }[pr.stage] || 50;
        const pct = pr.percent != null ? Math.min(60, Math.round((pr.percent / 100) * 60)) : base;
        t.update({ title: pr.meta ? tr('Installing {name}', { name: pr.meta.label }) : tr('Installing {name}', { name }), body: pr.message, progress: pct });
      });
      const r = await api.installApk(p);
      t.update({ title: tr('{name} installed', { name: r.app.label }), body: r.app.shortcutPath ? tr('A desktop shortcut was created; double-click it to open the app.') : tr('Right-click the app card to create a desktop shortcut.'), progress: 100, type: 'ok' });
      t.el.querySelector('.spinner')?.remove();
      setTimeout(t.dismiss, 3600);
      if (r.warnings && r.warnings.length) {
        toast({ title: tr('{name}: compatibility notice', { name: r.app.label }), body: r.warnings.join(' '), type: 'error', sticky: false });
      }
      ok++;
    } catch (e) {
      failed++;
      // 先把那条「正在安装…」的 sticky 提示收掉，否则它会一直转圈、还继续被
      // 运行时日志刷新 —— 用户看到的就是「失败信息一直在循环」。
      // 错误提示统一由下面的 install:error 监听器负责（带文件名与中文原因），
      // 这里不再重复弹一条。
      try { off(); } catch (_) { /* ignore */ }
      t.dismiss();
      if (installToast === t) installToast = null;
    } finally {
      try { off(); } catch (_) { /* ignore */ }
    }
  }

  state.installing = false;
  await refreshApps();
  if (ok && !failed) $('search').value = '';
}

/* ---------------- 应用操作 ---------------- */

async function launchApp(pkg) {
  const app = state.apps.find((a) => a.package === pkg);
  state.launchPkg = pkg;
  const t = toast({
    title: tr('Opening {name}', { name: app ? app.label : pkg }),
    body: tr('The first start has to warm up the runtime, please wait…'),
    sticky: true,
    spinner: true,
  });
  const r = await api.launch(pkg);
  if (r.ok) {
    // 应用有自己的窗口，主界面自动收起；这里只留一句提示，然后隐藏窗口
    t.update({ title: tr('Started'), body: tr('The app runs in its own window (rotate the screen from the top bar).'), type: 'ok' });
    setTimeout(t.dismiss, 1600);
    setTimeout(() => api.winHide(), 900);
    setTimeout(refreshApps, 1200);
  } else {
    t.update({ title: tr('Start failed'), body: r.error, type: 'error' });
    setTimeout(t.dismiss, 6000);
  }
}

async function createShortcut(pkg) {
  try {
    const r = await api.createShortcut(pkg);
    toast({ title: tr('Desktop shortcut created'), body: r.path, type: 'ok' });
    refreshApps();
  } catch (e) {
    toast({ title: tr('Could not create the shortcut'), body: e.message, type: 'error' });
  }
}

async function uninstall(pkg) {
  const app = state.apps.find((a) => a.package === pkg);
  if (!app) return;
  const ok = window.confirm(tr('Uninstall "{name}"?', { name: app.label }) + '\n\n' + tr('Its data will be erased and its desktop shortcut deleted.'));
  if (!ok) return;
  try {
    await api.uninstall(pkg);
    toast({ title: tr('Uninstalled'), body: app.label, type: 'ok' });
    refreshApps();
  } catch (e) {
    toast({ title: tr('Uninstall failed'), body: e.message, type: 'error' });
  }
}

/* ---------------- 右键菜单 ---------------- */

const MENU_ITEMS = [
  { key: 'open', label: tr('Open app'), kbd: 'Enter' },
  // 只在应用真的在运行时才出现（见 showMenu 里的过滤）。
  // 以前完全没有这一项，独立窗口模式下又没有可点的关闭按钮，
  // 应用一起来就关不掉，只能退到托盘退出整个 ApkStart。
  { key: 'stop', label: tr('Close app'), onlyRunning: true },
  { key: 'shortcut', label: tr('Create desktop shortcut') },
  { key: 'orientation', label: tr('Landscape / portrait') },
  { key: 'pin', label: tr('Pin to top') },
  { key: 'keymap', label: tr('Key mapping…') },
  { divider: true },
  { key: 'reveal', label: tr('Show APK location') },
  { key: 'clear', label: tr('Clear app data') },
  { divider: true },
  { key: 'uninstall', label: tr('Uninstall'), danger: true },
];

function showMenu(x, y, pkg) {
  const menu = $('ctxmenu');
  state.menuPkg = pkg;
  const app = state.apps.find((a) => a.package === pkg);
  const items = MENU_ITEMS.filter((it) => !it.onlyRunning || (app && app.running));
  menu.innerHTML = items.map((it) => {
    if (it.divider) return '<div class="divider"></div>';
    const label = it.key === 'pin' ? (app && app.pinned ? tr('Unpin') : tr('Pin to top'))
      : (it.key === 'orientation'
        ? (app && app.orientationOverride === 'landscape' ? tr('Start in portrait (now landscape)')
          : (app && app.orientationOverride === 'portrait' ? tr('Start in landscape (now portrait)') : tr('Set to start in landscape')))
        : it.label);
    return `<div class="item ${it.danger ? 'danger' : ''}" data-key="${it.key}" data-act="${it.key}">
      <span>${esc(label)}</span>${it.kbd ? `<span class="k">${it.kbd}</span>` : ''}
    </div>`;
  }).join('');
  menu.classList.add('on');

  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 10)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 10)}px`;
}

function hideMenu() {
  $('ctxmenu').classList.remove('on');
  state.menuPkg = null;
}

async function handleMenu(act) {
  const pkg = state.menuPkg;
  const app = state.apps.find((a) => a.package === pkg);
  hideMenu();
  if (!app) return;
  switch (act) {
    case 'open': return launchApp(pkg);
    case 'stop': {
      try {
        const r = await api.stop(pkg);
        if (r && r.ok) {
          toast({ title: tr('Closed'), body: app.label, type: 'ok' });
        } else {
          toast({ title: tr('Could not close'), body: (r && r.error) || tr('Unknown error'), type: 'error' });
        }
      } catch (e) {
        toast({ title: tr('Could not close'), body: e.message, type: 'error' });
      }
      return refreshApps();
    }
    case 'shortcut': return createShortcut(pkg);
    case 'orientation': {
      // 三态循环：跟随应用 → 横屏 → 竖屏 → 跟随应用
      // 这样红果这类被清单判成竖屏的应用，用户点一下就能强制横屏并记住。
      const cur = app.orientationOverride;
      const next = cur === 'landscape' ? 'portrait' : (cur === 'portrait' ? null : 'landscape');
      try {
        const r = await api.setAppOrientation(pkg, next);
        const txt = next === 'landscape' ? tr('Start in landscape') : (next === 'portrait' ? tr('Start in portrait') : tr('Follow app'));
        toast({ title: tr('Set to: {mode}', { mode: txt }), body: tr('Takes effect the next time you open this app; no need to restart everything.'), type: 'ok' });
        if (r && typeof r.landscape === 'boolean' && state.apps) {
          const rec = state.apps.find((a) => a.package === pkg);
          if (rec) rec.orientationOverride = next;
        }
      } catch (e) {
        toast({ title: tr('Could not set the orientation'), body: e.message, type: 'error' });
      }
      return refreshApps();
    }
    case 'pin': return api.pin(pkg, !app.pinned).then(refreshApps);
    case 'keymap': return showKeymapPicker(pkg, app.label);
    case 'reveal': return api.revealApk(pkg);
    case 'clear': {
      if (!window.confirm(tr('Erase all data of "{name}"? This cannot be undone.', { name: app.label }))) return;
      try {
        await api.clearData(pkg);
        toast({ title: tr('Data cleared'), body: app.label, type: 'ok' });
      } catch (e) {
        toast({ title: tr('Could not clear data'), body: e.message, type: 'error' });
      }
      return;
    }
    case 'uninstall': return uninstall(pkg);
    default: return undefined;
  }
}

/**
 * 按键映射预设选择器。用 confirm + prompt 做最简交互（不引入新 UI 组件）。
 * 后续可以做成更精致的弹窗编辑器。
 */
async function showKeymapPicker(pkg, label) {
  try {
    const presets = await api.keymap.getPresets();
    const current = await api.keymap.getMap(pkg);
    const hasCurrent = current && current.length > 0;
    const lines = presets.map((p, i) => `${i + 1}. ${p.label} — ${p.desc}`);
    if (hasCurrent) lines.unshift(tr('0. Clear current mapping'));
    const msg = tr('Choose a key mapping preset for "{name}":', { name: label }) + '\n\n' + lines.join('\n') + '\n\n' + tr('Enter a number:');
    const input = window.prompt(msg, hasCurrent ? '0' : '1');
    if (input === null) return; // 取消
    const idx = parseInt(input, 10);
    if (hasCurrent && idx === 0) {
      await api.keymap.setMap(pkg, []);
      toast({ title: tr('Key mapping cleared'), body: label, type: 'ok' });
      return;
    }
    const presetIdx = hasCurrent ? idx - 1 : idx;
    if (presetIdx < 1 || presetIdx > presets.length) {
      toast({ title: tr('Invalid number'), type: 'error' });
      return;
    }
    const chosen = presets[presetIdx - 1];
    await api.keymap.applyPreset(pkg, chosen.id);
    toast({ title: tr('Applied "{name}"', { name: chosen.label }), body: tr('{name} · the keyboard works once the app is open', { name: label }), type: 'ok' });
  } catch (e) {
    toast({ title: tr('Could not set the key mapping'), body: e.message, type: 'error' });
  }
}

/* ---------------- 设置 ---------------- */

// ---------------- 安卓系统设置 ----------------

let volumeTimer = null;

async function refreshAndroid() {
  const el = $('androidStatus');
  if (!el) return;
  el.textContent = tr('Reading…');
  const r = await api.android.status().catch(() => null);
  if (!r || !r.ok) {
    el.textContent = r && r.error ? tr('Runtime not ready ({err})', { err: String(r.error).slice(0, 36) }) : tr('Runtime not started');
    return;
  }
  el.textContent = `Android ${r.sdk || '?'} · ${r.wifi ? tr('Wi-Fi on') : tr('Wi-Fi off')}` +
    `${r.airplane ? ' · ' + tr('Airplane mode') : ''} · ${tr('Volume {vol}%', { vol: r.volume })}`;
  $('setAndroidWifi').checked = !!r.wifi;
  $('setAndroidAirplane').checked = !!r.airplane;
  $('setAndroidAnim').checked = !r.animationsOff;
  $('setAndroidVolume').value = r.volume;
  $('androidVolumeText').textContent = `${r.volume}%`;
  if (r.fontScale) $('setAndroidFont').value = Number(r.fontScale).toFixed(2);
  if (r.density) {
    const opt = [...$('setAndroidDensity').options].find((o) => o.value === String(r.density));
    if (opt) $('setAndroidDensity').value = String(r.density);
  }
}

function bindAndroid() {
  const set = async (key, value, msg) => {
    const r = await api.android.set(key, value).catch(() => null);
    toast({
      type: r && r.ok ? 'ok' : 'error',
      title: r && r.ok ? (msg || tr('Applied')) : tr('Failed: {err}', { err: (r && r.error) || tr('Runtime not ready') }),
    });
    if (r && r.ok) refreshAndroid();
  };
  $('setAndroidWifi').addEventListener('change', (e) => set('wifi', e.target.checked, e.target.checked ? tr('Wi-Fi turned on') : tr('Wi-Fi turned off')));
  $('setAndroidAirplane').addEventListener('change', (e) => set('airplane', e.target.checked, e.target.checked ? tr('Airplane mode on') : tr('Airplane mode off')));
  $('setAndroidAnim').addEventListener('change', (e) => set('animations', e.target.checked, e.target.checked ? tr('System animations on') : tr('System animations off, the interface is faster')));
  $('setAndroidFont').addEventListener('change', (e) => set('fontScale', Number(e.target.value), tr('Font size changed')));
  $('setAndroidDensity').addEventListener('change', (e) => set('density', Number(e.target.value), tr('Display size changed')));
  $('setAndroidVolume').addEventListener('input', (e) => {
    $('androidVolumeText').textContent = `${e.target.value}%`;
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => set('volume', Number(e.target.value), tr('Volume changed')), 260);
  });
  $('btnAndroidRefresh').addEventListener('click', () => refreshAndroid());
  $('btnAndroidTune').addEventListener('click', async () => {
    const r = await api.android.tune(state.launchPkg || '').catch(() => null);
    toast({ type: r && r.ok ? 'ok' : 'error', title: r && r.ok ? tr('Optimized: animations off, background limits relaxed, battery allowlist') : tr('Optimization failed, the runtime may not be running') });
    if (r && r.ok) refreshAndroid();
  });
  const open = async (action) => {
    const r = await api.android.open(action).catch(() => null);
    if (!r || !r.ok) {
      toast({ type: 'error', title: tr('Open an app once first so the runtime starts') });
    }
  };
  $('btnAndroidSettings').addEventListener('click', () => open('settings'));
  $('btnAndroidDisplay').addEventListener('click', () => open('display'));
  $('btnAndroidSound').addEventListener('click', () => open('sound'));
  $('btnAndroidLocale').addEventListener('click', () => open('locale'));
  $('btnAndroidApps').addEventListener('click', () => open('apps'));
}

/** 设置页字段同步：只剩自带运行时，所有资源项都露出来，不再按底座切换 */
function syncBackendFields() {
  const perf = $('perfGroup');
  if (perf) perf.hidden = false;
  refreshResources();
}

/** 本机资源上限 + 当前分配（设置页里那几行灰字） */
async function refreshResources() {
  const bNote = $('builtinResNote');
  if (!bNote) return;
  const gb = (mb) => (Number(mb) > 0 ? `${Math.round(Number(mb) / 1024)} GB` : tr('unknown'));
  const r = await api.resources().catch(() => null);
  if (!r || r.ok === false) {
    bNote.textContent = (r && (r.note || r.error)) || tr('Resource information is not available right now');
    return;
  }
  const host = r.host || {};
  const lim = r.limits || {};
  const free = Number(r.freeMB) || Number((r.current && r.current.freeMB) || 0);
  bNote.textContent = tr('This PC has {mem} of memory and {cores} cores.', { mem: gb(host.totalMB), cores: host.cores })
    + ' ' + tr('Memory can be allocated up to {max}, cores up to {maxCores} (1/4 of the memory and 1 core are always left for Windows).', { max: gb(lim.maxMB), maxCores: Math.max(1, (host.cores || 1) - 1) })
    + ' ' + (free ? tr('Data partition limit: {gb} GB (free space on its disk: {free} GB).', { gb: lim.maxGB || 0, free: (free / 1024).toFixed(1) }) : tr('Data partition limit: {gb} GB.', { gb: lim.maxGB || 0 }))
    + (r.verdict && r.verdict.note ? ` ${r.verdict.note}` : '');
}

/** 本机体检：渲染报告（每条带等级点和可执行动作） */
function renderPreflight(res) {
  const list = $('preflightList');
  const sum = $('preflightSummary');
  const applyBtn = $('btnPreflightApply');
  if (!list) return;
  list.textContent = '';
  if (!res || !res.report) {
    if (sum) sum.textContent = (res && res.error) || tr('The check returned no result, please try again');
    return;
  }
  const { report, edition } = res;
  for (const it of report.items) {
    const item = document.createElement('div');
    item.className = 'pf-item';
    const head = document.createElement('div');
    head.className = 'pf-head';
    const dot = document.createElement('span');
    dot.className = `pf-dot ${it.level}`;
    const title = document.createElement('span');
    title.className = 'pf-title';
    title.textContent = it.title;
    head.append(dot, title);
    item.append(head);
    if (it.detail) {
      const d = document.createElement('div');
      d.className = 'pf-detail';
      d.textContent = it.detail;
      item.append(d);
    }
    if (it.action && it.action.kind === 'elevate') {
      const wrap = document.createElement('div');
      wrap.className = 'pf-action';
      const btn = document.createElement('button');
      btn.className = 'btn ghost sm';
      btn.textContent = it.action.label;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = tr('Working…');
        let r = null;
        if (it.action.id === 'accel') r = await api.enableAccel().catch(() => null);
        else r = await api.enableVirtualization().catch(() => null);
        btn.disabled = false;
        btn.textContent = old;
        if (!r) { toast({ type: 'error', title: tr('The action did not finish'), body: tr('Try again later, or follow the instructions by hand') }); return; }
        if (r.cancelled) toast({ type: 'warn', title: tr('Cancelled'), body: tr('No system settings were changed') });
        else if (r.ok || r.already) {
          const reboot = r.restartNeeded === true;
          toast({
            type: 'ok',
            title: r.already ? tr('Hardware acceleration is already available') : (reboot ? tr('Submitted, restart needed') : tr('Applied')),
            body: r.already ? '' : (reboot ? tr('Restart your PC for hardware acceleration to take effect, then come back and click "Start check" to confirm') : tr('Click "Start check" to confirm the result')),
          });
          if (r.already || !reboot) setTimeout(() => runPreflight().catch(() => {}), 1200);
        } else {
          toast({ type: 'error', title: tr('Could not finish automatically'), body: (r.error || r.note || tr('Follow the instructions by hand')) });
        }
      });
      wrap.append(btn);
      item.append(wrap);
    } else if (it.action && it.action.kind === 'manual') {
      const wrap = document.createElement('div');
      wrap.className = 'pf-action pf-detail';
      wrap.textContent = `⚠ ${it.action.label}`;
      item.append(wrap);
    }
    list.append(item);
  }
  const rec = report.recommended || {};
  if (sum) {
    sum.textContent = tr('{summary}. Recommended setup: {mem} GB memory / {cores} cores / {size} · rendering {gpu}', {
      summary: report.summary, mem: Math.round((rec.memoryMB || 0) / 1024), cores: rec.cores || 2, size: rec.renderSize || 'auto', gpu: rec.gpuMode || 'auto',
    }) + (edition === 'store' ? ' ' + tr('(Store edition: system features can only be turned on by hand in "Windows Features")') : '');
  }
  if (applyBtn) applyBtn.hidden = false;
}

async function runPreflight() {
  const btn = $('btnPreflight');
  const sum = $('preflightSummary');
  if (!btn) return null;
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = tr('Checking…');
  if (sum) sum.textContent = tr('Checking virtualization, graphics card and memory… (the first run takes about 2-3 seconds)');
  let r = null;
  try {
    r = await api.preflightRun();
  } catch (e) {
    r = { error: e.message || tr('The check failed') };
  }
  btn.disabled = false;
  btn.textContent = old;
  renderPreflight(r);
  return r;
}

/** 驱动（兼容补丁）：渲染清单 + 命中状态 */
function renderDrivers(r) {
  const list = $('drvList');
  const sum = $('drvSummary');
  if (!list) return;
  const host = (r && r.host) || {};
  const drivers = (r && r.drivers) || [];
  const errors = (r && r.errors) || [];
  const onCount = drivers.filter((d) => d.enabled && d.matched).length;
  if (sum) {
    const accel = host.accel === 'none' ? tr('no hardware acceleration') : (host.accel || tr('unknown'));
    sum.textContent = tr('This PC: {platform}/{arch} · {gpu} GPU · {accel}', { platform: host.platform || '', arch: host.arch || '', gpu: host.gpuVendor || tr('unknown'), accel })
      + ' · emulator ' + (host.emulatorVersion || tr('unknown')) + '; ' + tr('{n} drivers, {on} active on this PC.', { n: drivers.length, on: onCount })
      + (errors.length ? ' ' + tr('{n} files failed to load (see below).', { n: errors.length }) : '');
  }
  list.textContent = '';
  for (const d of drivers) {
    const item = document.createElement('div');
    item.className = d.enabled ? 'drv-item on' : 'drv-item';

    const head = document.createElement('div');
    head.className = 'drv-head';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!d.enabled;
    cb.addEventListener('change', async () => {
      const res = await api.driversSetEnabled(d.id, cb.checked).catch(() => null);
      if (res && res.ok && res.overview) renderDrivers(res.overview);
      else { cb.checked = !cb.checked; toast({ type: 'error', title: tr('Could not save'), body: (res && res.error) || tr('Please try again later') }); }
    });
    const name = document.createElement('span');
    name.className = 'drv-name';
    name.textContent = d.name;
    head.append(cb, name);

    if (d.matched && d.enabled) {
      const b = document.createElement('span');
      b.className = 'drv-badge hit';
      b.textContent = tr('Active');
      head.append(b);
    }
    if (d.builtin) {
      const b = document.createElement('span');
      b.className = 'drv-badge';
      b.textContent = tr('Built-in example');
      head.append(b);
    }
    item.append(head);

    const meta = document.createElement('div');
    meta.className = 'drv-meta';
    meta.textContent = `v${d.version || '?'}`
      + (d.author ? ` · ${d.author}` : '')
      + ` · priority ${d.priority}`
      + (d.hits && d.hits.length ? ' · ' + tr('matched: {list}', { list: d.hits.join(' / ') }) : ' · ' + tr('does not match this PC'));
    item.append(meta);

    if (d.description) {
      const desc = document.createElement('div');
      desc.className = 'drv-meta';
      desc.textContent = d.description;
      item.append(desc);
    }
    list.append(item);
  }
  for (const e of errors) {
    const err = document.createElement('div');
    err.className = 'drv-err';
    err.textContent = `${String(e.file || '').split(/[\\/]/).pop()}: ${(e.errors || []).join('; ')}`;
    list.append(err);
  }
  if (!drivers.length && !errors.length) {
    const empty = document.createElement('div');
    empty.className = 'drv-meta';
    empty.textContent = tr('No drivers yet. Click "Export template for this PC" to make one, or import a JSON file someone else made.');
    list.append(empty);
  }
}

async function refreshDrivers() {
  if (!$('drvList')) return;
  const r = await api.driversList().catch(() => null);
  if (!r) {
    if ($('drvSummary')) $('drvSummary').textContent = tr('Cannot read the driver list (the runtime may not be set up yet)');
    return;
  }
  renderDrivers(r);
}

function fillSettings(s) {
  syncBackendFields();
  refreshDrivers().catch(() => {});
  $('setAdbPath').value = s.adbPath || '';
  $('setSystemImage').value = s.runtime.isoPath || '';
  $('setMemory').value = s.engine.memoryMB;
  $('setCores').value = s.engine.cores;
  $('setIdle').value = s.engine.idleShutdownMinutes;
  if ($('setMirrorPrefix')) $('setMirrorPrefix').value = (s.runtime && s.runtime.mirrorPrefix) || '';
  if ($('setConnections')) $('setConnections').value = Number((s.runtime && s.runtime.downloadConnections) || 8);
  $('setAudio').checked = s.engine.audio !== false;
  if ($('setMicrophone')) $('setMicrophone').checked = s.engine.microphone !== false;
  $('setLiteMode').checked = s.engine.liteMode !== false;
  $('setPrewarm').checked = s.engine.prewarm !== false;
  $('setPriorityMode').value = ['performance', 'game'].includes(s.engine.priorityMode)
    ? s.engine.priorityMode : 'balanced';
  $('setDeepTrim').checked = !!s.engine.deepTrim;
  $('setMouseRightBack').checked = s.engine.mouseRightBack !== false;
  $('setMouseWheelMode').value = ['smooth', 'native', 'off'].includes(s.engine.mouseWheelMode)
    ? s.engine.mouseWheelMode : 'smooth';
  $('setMouseSideButtons').checked = !!s.engine.mouseSideButtons;
  if ($('setKeymapEnabled')) $('setKeymapEnabled').checked = s.engine.keymapEnabled !== false;
  // 实验室：原生多窗口多开（实验性）
  if ($('setMultiWindow')) $('setMultiWindow').checked = !!s.engine.multiWindow;
  if ($('setKeepBackground')) $('setKeepBackground').value = String(
    Number(s.engine.keepBackground) >= 0 ? Number(s.engine.keepBackground) : 1,
  );
  $('setCompat').checked = !!(s.runtime && s.runtime.compatImage);
  $('setAutoShortcut').checked = !!s.createShortcutOnInstall;
  $('setStartMenuShortcut').checked = s.createStartMenuShortcut !== false;
  $('setShortcutDir').value = s.shortcutDir || '';
  $('setSharedDir').value = s.sharedDir || '';
  $('setDeviceSharedDir').value = s.deviceSharedDir || '';
  const d = s.display || {};
  $('setAutoStart').checked = s.autoStart !== false;
  if ($('setUiLanguage')) $('setUiLanguage').value = (s.ui && s.ui.language) || 'en';
  const eng = s.engine || {};
  if ($('setResourceMode')) $('setResourceMode').value = eng.resourceMode || 'balanced';
  if ($('setGpuPreference')) $('setGpuPreference').value = eng.gpuPreference || 'auto';
  if ($('setRenderSize')) $('setRenderSize').value = eng.renderSize || 'auto';
  if ($('setDataGB')) $('setDataGB').value = String(Number(eng.dataPartitionGB || 0));
  if ($('setLocale')) $('setLocale').value = eng.locale || 'en-US';
  if ($('setChineseIme')) $('setChineseIme').checked = eng.chineseIme === true;
  if ($('setKeepSnapshot')) $('setKeepSnapshot').checked = eng.keepSnapshot !== false;
  $('setDisplayMode').value = d.mode === 'fullscreen' ? 'fullscreen' : 'window';
  if ($('setAutoFullscreen')) $('setAutoFullscreen').value = d.autoFullscreenOnLaunch === true ? 'on' : 'off';
  if ($('setLandscape')) $('setLandscape').value = d.landscape === true ? 'landscape' : 'portrait';
  if ($('setOrientationMode')) $('setOrientationMode').value = d.orientationMode || 'auto';
  if ($('setAutoRotate')) $('setAutoRotate').value = d.autoRotate === false ? 'off' : 'on';
  if ($('setTabletMode')) $('setTabletMode').value = d.tabletMode === false ? 'off' : 'on';
  $('setPortrait').value = d.portrait || '900x1600';
  // 0.6.0 起默认原生窗口：只有显式 true 才是嵌入模式（旧配置里 undefined 视为原生）
  if ($('setWindowEmbed')) $('setWindowEmbed').value = d.windowEmbed === true ? 'embed' : 'detached';
  $('portraitField').hidden = $('setDisplayMode').value === 'fullscreen';
}

/** 数据分区实际大小 + 磁盘余量，显示在设置页容量选择下方 */
async function refreshDataInfo() {
  const el = $('dataNote');
  if (!el) return;
  const info = await api.dataInfo().catch(() => null);
  if (!info) { el.textContent = tr('Could not read the data partition information'); return; }
  const auto = Number(($('setDataGB') || {}).value || 0) === 0;
  // 有 quickboot 差量盘时底座镜像的大小不等于 guest 看到的容量（实测 8GB 镜像、guest 5.7GB），
  // 与其显示一个会误导人的数字，不如明确说「以运行时为准」。
  const img = info.overlay
    ? tr('quick-start overlay disk (the real size is whatever /data shows inside the runtime)')
    : (info.fsGB ? tr('actual filesystem {gb} GB', { gb: info.fsGB }) : (info.imageGB ? `${info.imageGB} GB` : tr('not created yet')));
  const free = info.freeDiskMB ? `${(info.freeDiskMB / 1024).toFixed(1)} GB` : tr('unknown');
  const pending = Number(info.pendingGB) > 0
    ? tr('Target {gb} GB is not in effect yet: Android is using the quick-start overlay disk, so it must be rebuilt at the new size after "Reset Android data" (this erases installed apps).', { gb: info.configuredGB })
    : '';
  el.textContent = tr('Current data partition: {img}{auto} · free space on its disk: {free}.', { img, auto: auto ? ' ' + tr('(automatic)') : '', free }) + (pending ? ' ' + pending : '')
    + ' ' + tr('If a game says "not enough storage", increase this value and click "Expand now"; when it can be expanded in place, installed apps are kept.');
}

/* ---------------- 设置页：分类导航 + 搜索 ---------------- */

/**
 * 设置项越来越多，一条长滚动找起来很费劲（用户 0.6.0 的原话：
 * 「设置内做好分类功能」）。这里把设置按用途分成 8 类，左侧一列导航。
 *
 * 分类表必须与 index.html 里每个分组的 data-cat 一致 ——
 * test/settings-categories-test.js 会校验这一致性。
 */
const SETTINGS_CATS = [
  { id: 'basic', name: tr('Basics and install') },
  { id: 'display', name: tr('Display and windows') },
  { id: 'input', name: tr('Controls and input') },
  { id: 'perf', name: tr('Performance and resources') },
  { id: 'net', name: tr('Network and downloads') },
  { id: 'diag', name: tr('Diagnostics and repair') },
  { id: 'files', name: tr('Integration and files') },
  { id: 'about', name: tr('Updates and about') },
  { id: 'lab', name: tr('Lab') },
];

const settingsCatState = { cat: 'basic', query: '' };

/** 设置里所有带分类标记的分组（.group 和 details.advanced-group 都算） */
function settingsGroups() {
  return Array.from(document.querySelectorAll('#settingsBody [data-cat]'));
}

/** 分组内是否命中搜索词：标题、字段名、说明文字都算 */
function groupMatches(group, q) {
  if (!q) return true;
  const text = (group.textContent || '').toLowerCase();
  if (text.includes(q)) return true;
  const title = group.querySelector('.group-title');
  return !!title && title.textContent.toLowerCase().includes(q);
}

/** 切到某个分类 */
function switchSettingsCat(cat, { keepQuery = false } = {}) {
  const target = SETTINGS_CATS.some((c) => c.id === cat) ? cat : 'basic';
  settingsCatState.cat = target;
  if (!keepQuery) settingsCatState.query = '';
  try { localStorage.setItem('apkstart.settings.cat', target); } catch (_) { /* ignore */ }
  const search = $('setSearch');
  if (search && !keepQuery) search.value = '';
  const clear = $('btnClearSearch');
  if (clear) clear.hidden = !settingsCatState.query;
  document.querySelectorAll('#setNav .set-nav-item').forEach((b) => {
    b.classList.toggle('on', b.dataset.cat === target);
  });
  applySettingsFilter();
}

/**
 * 应用可见性：搜索时跨分类展示命中的分组（否则搜到的东西藏在别的分类里，
 * 用户会以为「搜了没反应」）；没搜索时只显示当前分类。
 */
function applySettingsFilter() {
  const q = settingsCatState.query.trim().toLowerCase();
  const groups = settingsGroups();
  const hitPerCat = {};
  for (const g of groups) {
    const hit = groupMatches(g, q);
    const inCat = g.dataset.cat === settingsCatState.cat;
    g.hidden = q ? !hit : !inCat;
    if (hit) hitPerCat[g.dataset.cat] = (hitPerCat[g.dataset.cat] || 0) + 1;
  }
  // 分类按钮：搜索时标出哪些分类有命中项
  document.querySelectorAll('#setNav .set-nav-item').forEach((b) => {
    const n = hitPerCat[b.dataset.cat] || 0;
    b.classList.toggle('dim', !!q && n === 0);
    b.title = q ? tr('{n} matches', { n }) : '';
  });
  // 最后一个可见分组不画分隔线（分组被隐藏后 :last-child 会选错对象）
  const visible = groups.filter((g) => !g.hidden);
  visible.forEach((g) => g.classList.remove('last-visible'));
  if (visible.length) visible[visible.length - 1].classList.add('last-visible');
  updateCatBadges();
}

/** 定位到某个分组：先切到它所属的分类，再滚动过去 */
function focusGroup(el) {
  if (!el) return;
  const cat = el.dataset && el.dataset.cat;
  if (cat) switchSettingsCat(cat);
  const body = $('settingsBody');
  if (body) body.scrollTop = 0;
  if (typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

function bindSettingsCategory() {
  const nav = $('setNav');
  if (nav) {
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('.set-nav-item');
      if (!btn) return;
      switchSettingsCat(btn.dataset.cat);
      const body = $('settingsBody');
      if (body) body.scrollTop = 0;
    });
  }

  const search = $('setSearch');
  const clear = $('btnClearSearch');
  if (search) {
    search.addEventListener('input', () => {
      settingsCatState.query = search.value || '';
      if (clear) clear.hidden = !settingsCatState.query;
      applySettingsFilter();
    });
    // 回车：跳到第一个命中的分组
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const hit = settingsGroups().find((g) => !g.hidden);
      if (hit) focusGroup(hit);
    });
  }
  if (clear) {
    clear.addEventListener('click', () => {
      settingsCatState.query = '';
      if (search) search.value = '';
      clear.hidden = true;
      applySettingsFilter();
    });
  }

  // 记住上次停留的分类
  try {
    const last = localStorage.getItem('apkstart.settings.cat');
    if (last && SETTINGS_CATS.some((c) => c.id === last)) settingsCatState.cat = last;
  } catch (_) { /* ignore */ }
  switchSettingsCat(settingsCatState.cat);
}

/* ---------------- 自动检测（自动 debug）---------------- */

/** 自动检测的问题分类名（与 src/core/autodebug.js 的 CATEGORIES 对应） */
const DEBUG_CATS = [
  { id: 'runtime', name: tr('Runtime') },
  { id: 'device', name: tr('Device connection') },
  { id: 'storage', name: tr('Storage') },
  { id: 'settings', name: tr('Settings') },
  { id: 'network', name: tr('Network') },
  { id: 'logs', name: tr('Logs') },
];

let autodebugLast = null;

function renderAutodebug(res) {
  const list = $('autodebugList');
  const txt = $('autodebugStateText');
  if (!list) return;
  autodebugLast = res || null;
  const issues = (res && res.issues) || [];
  const at = res && res.at;

  if (txt) {
    if (res && res.running) txt.textContent = tr('Checking…');
    else if (!at) txt.textContent = tr('Not checked yet');
    else if (!issues.length) txt.textContent = tr('Last check {when} · all good', { when: relTime(at) });
    else txt.textContent = tr('Last check {when} · {n} to fix', { when: relTime(at), n: issues.length });
  }

  if (!issues.length) {
    list.innerHTML = `<div class="dbg-ok">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
      <span>${esc(tr('No problems that affect use were found. The runtime, adb authorization, disk, data partition, snapshot and settings conflicts were all checked.'))}</span>
    </div>`;
    updateCatBadges();
    return;
  }

  const byCat = new Map();
  for (const it of issues) {
    const key = it.category || 'runtime';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key).push(it);
  }
  const order = DEBUG_CATS.map((c) => c.id);
  const keys = Array.from(byCat.keys()).sort((a, b) => {
    const ia = order.indexOf(a); const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  list.innerHTML = keys.map((key) => {
    const name = (DEBUG_CATS.find((c) => c.id === key) || {}).name || key;
    const items = byCat.get(key);
    return `<div class="dbg-group">
      <div class="dbg-group-title">${esc(name)}<span class="dbg-count">${items.length}</span></div>
      ${items.map((it) => `
        <div class="dbg-item ${esc(it.severity || 'info')}">
          <span class="dbg-sev"></span>
          <div class="dbg-body">
            <div class="dbg-name">${esc(it.title || '')}</div>
            <div class="dbg-hint">${esc(it.hint || '')}</div>
            ${it.detail ? `<div class="dbg-detail">${esc(it.detail)}</div>` : ''}
          </div>
          ${it.fix ? `<button class="dbg-fix" data-code="${esc(it.code)}">${esc(tr('Fix'))}</button>` : ''}
          <button class="dbg-help" data-code="${esc(it.code)}" title="${esc(tr('Open the built-in guide'))}">${esc(tr('Guide'))}</button>
        </div>`).join('')}
    </div>`;
  }).join('');

  list.querySelectorAll('.dbg-fix').forEach((b) => {
    b.addEventListener('click', () => {
      const issue = issues.find((x) => x.code === b.dataset.code);
      if (issue) fixIssue(issue);
    });
  });
  list.querySelectorAll('.dbg-help').forEach((b) => {
    b.addEventListener('click', () => {
      const issue = issues.find((x) => x.code === b.dataset.code);
      if (issue) openManualForIssue(issue, 'clicked');
    });
  });

  updateCatBadges();
}

/** 分类按钮上的问题角标：只在有问题的分类上显示数字 */
function updateCatBadges() {
  const issues = (autodebugLast && autodebugLast.issues) || [];
  document.querySelectorAll('#setNav .set-nav-badge').forEach((el) => {
    const cat = el.dataset.badge;
    // 自动检测的问题不一定都归属某个设置分类，只有设置类问题才在「诊断与修复」上打标
    const n = cat === 'diag' ? issues.filter((i) => i.severity === 'error').length : 0;
    el.hidden = n === 0;
    el.textContent = n ? String(n) : '';
    el.classList.toggle('warn', false);
  });
}

function bindAutodebug() {
  const btn = $('btnAutodebugRun');
  if (btn) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = tr('Checking…');
      try {
        const r = await api.autodebugRun().catch(() => null);
        if (r) renderAutodebug(r);
        else toast({ title: tr('Check failed'), body: tr('Something went wrong while collecting the status, try again later'), type: 'error' });
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    });
  }

  const report = $('btnAutodebugReport');
  if (report) {
    report.addEventListener('click', async () => {
      const r = await api.doctorReport().catch(() => null);
      if (r && r.ok !== false) toast({ title: tr('Diagnostic report exported'), body: tr('Sending the report to the author is the fastest way to find the problem'), type: 'ok' });
      else toast({ title: tr('Export failed'), body: (r && r.error) || tr('Please try again'), type: 'error' });
    });
  }

  const auto = $('setAutodebugAuto');
  if (auto) {
    auto.addEventListener('change', async () => {
      const r = await api.autodebugConfig({ auto: auto.checked }).catch(() => null);
      if (r) fillAutodebugSettings(r);
      toast({
        title: auto.checked ? tr('Automatic checks turned on') : tr('Automatic checks turned off'),
        body: auto.checked ? tr('Checks run in the background from time to time and only warn you about new problems') : tr('You can click "Check now" to run one by hand at any time'),
        type: 'info',
      });
    });
  }

  const interval = $('setAutodebugInterval');
  if (interval) {
    interval.addEventListener('change', async () => {
      const r = await api.autodebugConfig({ intervalMin: Number(interval.value) }).catch(() => null);
      if (r) fillAutodebugSettings(r);
      toast({ title: tr('Check interval updated'), body: tr('Checks run every {n} minutes', { n: r ? r.intervalMin : interval.value }), type: 'ok' });
    });
  }

  const notify = $('setAutodebugNotify');
  if (notify) {
    notify.addEventListener('change', async () => {
      const r = await api.autodebugConfig({ notify: notify.checked }).catch(() => null);
      if (r) fillAutodebugSettings(r);
    });
  }
}

function fillAutodebugSettings(cfg) {
  if (!cfg) return;
  const auto = $('setAutodebugAuto');
  if (auto) auto.checked = cfg.auto !== false;
  const interval = $('setAutodebugInterval');
  if (interval) interval.value = String(cfg.intervalMin || 10);
  const notify = $('setAutodebugNotify');
  if (notify) notify.checked = cfg.notify !== false;
}

async function openSettings() {
  state.settings = await api.getSettings();
  fillSettings(state.settings);
  fillAutodebugSettings((state.settings && state.settings.debug) || {});
  const info = await api.info();
  $('setRuntimeDir').value = info.runtimeDir || info.dataDir;
  if ($('setAvdDir')) {
    const di = await api.dataInfo().catch(() => null);
    $('setAvdDir').value = (di && di.avdDir) || '';
  }
  const verEl = document.getElementById('aboutVer');
  if (verEl && info.version) verEl.textContent = `v${info.version}`;
  const curVerEl = document.getElementById('updateCurrent');
  if (curVerEl && info.version) curVerEl.textContent = `v${info.version}`;
  const assoc = await api.assocStatus();
  const btn = $('btnAssoc');
  btn.textContent = assoc.registered ? tr('Linked · click to unlink') : tr('Not linked · click to link');
  btn.dataset.on = assoc.registered ? '1' : '0';

  api.doctorProfile().then((r) => {
    if (r && r.text) $('autoProfileText').textContent = r.text;
  }).catch(() => { $('autoProfileText').textContent = tr('Automatic mode'); });
  // 显卡偏好：显示 Windows 是否真的应用了（支持但没生效时提示重启安卓）
  if ($('gpuPrefNote') && api.gpuStatus) {
    api.gpuStatus().then((g) => {
      if (!g || !g.supported) { $('gpuPrefNote').textContent = tr('(this system does not support this setting)'); return; }
      const applied = g.applied || 'auto';
      const want = g.mode || 'auto';
      const label = { auto: tr('System default'), discrete: tr('Discrete GPU'), integrated: tr('Integrated GPU') };
      $('gpuPrefNote').textContent = applied === want || want === 'auto'
        ? tr('(in effect: {name})', { name: label[applied] || applied })
        : tr('(selected {name}, takes effect the next time Android starts)', { name: label[want] || want });
    }).catch(() => {});
  }
  api.runtimeUsage().then((u) => {
    $('usageText').textContent = u
      ? tr('Total {total}', { total: u.totalText }) + (u.reclaimable ? ' · ' + tr('{size} can be reclaimed ({n} items)', { size: u.reclaimableText, n: u.count }) : ' · ' + tr('already lean'))
      : tr('Statistics unavailable');
  }).catch(() => { $('usageText').textContent = tr('Statistics unavailable'); });

  $('settingsMask').classList.add('on');
  refreshAndroid();
  refreshDataInfo();
  applySettingsFilter();
  // 先把上一次的检测结果铺上（别让面板空着等），再后台刷新一份
  api.autodebugState().then((r) => { if (r) renderAutodebug(r); }).catch(() => {});
}

function closeSettings() {
  $('settingsMask').classList.remove('on');
}

/* ---------------- 软件更新 ---------------- */

let lastUpdate = null;

/** 把一次检查结果画到设置面板（也用于启动时静默检查推送过来的状态） */
function renderUpdate(info) {
  lastUpdate = info || null;
  const cur = $('updateCurrent');
  const st = $('updateState');
  const btn = $('btnDoUpdate');
  const bar = $('updateBar');
  if (!cur || !st || !btn) return;
  if (!info) return;
  if (info.current) cur.textContent = `v${info.current}`;

  if (info.ok === false) {
    st.textContent = tr('Check failed: {err}', { err: info.error || tr('network unavailable') });
    // 检查失败也要给一条出路：直接把发布页打开，用户至少能手动下载。
    // 以前这里是「什么都不显示」，用户只会觉得「更新功能坏了」。
    showUpdateBtn(true);
    btn.textContent = tr('Open download page');
    btn.dataset.mode = 'manual';
    lastUpdate = { htmlUrl: info.htmlUrl || '' };
    if (bar) bar.hidden = true;
    return;
  }
  if (info.hasUpdate) {
    // 如实说明这次是哪个源给出的版本、另一个源为什么没参与 ——
    // 用户排查「为什么检查更新很慢」时，这一行比任何日志都直接。
    const src = (info.sources || []).map((x) => `${x.name} ${x.tag || ''}`.trim()).join(' / ');
    const bad = (info.unreachable || []).map((x) => x.name).join(', ');
    const stale = info.stale ? ' ' + tr('(offline cache, may not be the latest)') : '';
    st.textContent = tr('New version {tag} found', { tag: info.tag }) + (src ? ` (${src})` : '') + (bad ? '; ' + tr('{list} unreachable', { list: bad }) : '') + stale;
    showUpdateBtn(true);
    btn.textContent = info.asset ? tr('Update now') : tr('Open download page');
    btn.dataset.mode = info.asset ? 'auto' : 'manual';
    const note = $('updateNote');
    if (note && info.notes) {
      const brief = String(info.notes).split('\n').slice(0, 8).join('\n').trim();
      if (brief) note.textContent = tr('What is new:') + '\n' + brief;
    }
    if (bar) bar.hidden = true;
  } else {
    const src = (info.sources || []).map((x) => x.name).join(' / ');
    const stale = info.stale ? ' ' + tr('(offline cache)') : '';
    st.textContent = tr('Up to date (v{ver})', { ver: info.current }) + (src ? ' · ' + tr('via {src}', { src }) : '') + stale;
    showUpdateBtn(false);
    if (bar) bar.hidden = true;
  }
}

/** .btn 自带 display:inline-flex，会盖掉 hidden 属性，所以这里直接改 display */
function showUpdateBtn(on) {
  const btn = $('btnDoUpdate');
  if (!btn) return;
  btn.hidden = !on;
  btn.style.display = on ? '' : 'none';
}

function renderUpdateProgress(p) {
  if (!p) return;
  const st = $('updateState');
  const bar = $('updateBar');
  const fill = $('updateBarFill');
  if (p.stage === 'error') {
    if (st) st.textContent = tr('Update failed: {err}', { err: p.message || '' });
    if (bar) bar.hidden = true;
    toast({ title: tr('Update failed'), body: p.message || '', type: 'error' });
    return;
  }
  if (st) st.textContent = p.message || tr('Updating…');
  if (bar && fill) {
    bar.hidden = false;
    fill.style.width = `${Math.max(0, Math.min(100, p.percent || 0))}%`;
  }
}

function bindUpdate() {
  const check = $('btnCheckUpdate');
  const go = $('btnDoUpdate');
  if (!check || !go) return;

  const runCheck = async (silent) => {
    if (!silent) {
      check.disabled = true;
      const old = check.textContent;
      check.textContent = tr('Checking…');
      $('updateState').textContent = tr('Connecting to GitHub…');
      try {
        const info = await api.updateCheck();
        renderUpdate(info);
        if (info && info.hasUpdate) toast({ title: tr('New version {tag} found', { tag: info.tag }), body: tr('Click "Update now" to download and install it automatically'), type: 'info' });
        else if (info && info.ok !== false) toast({ title: tr('You are up to date'), body: `v${info.current}`, type: 'ok' });
      } catch (e) {
        $('updateState').textContent = tr('Check failed: {err}', { err: e.message });
      } finally {
        check.disabled = false;
        check.textContent = old;
      }
      return;
    }
    const info = await api.updateCheck().catch(() => null);
    if (info) renderUpdate(info);
  };

  check.addEventListener('click', () => runCheck(false));

  go.addEventListener('click', async () => {
    if (go.dataset.mode === 'manual') {
      api.updateOpenRelease(lastUpdate && lastUpdate.htmlUrl);
      return;
    }
    go.disabled = true;
    go.textContent = tr('Updating…');
    const r = await api.updateApply().catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) {
      go.disabled = false;
      go.textContent = tr('Update now');
      if (r && r.error && !r.manual) {
        $('updateState').textContent = tr('Update failed: {err}', { err: r.error });
        toast({ title: tr('Update failed'), body: r.error, type: 'error' });
      }
    } else {
      $('updateState').textContent = tr('Downloaded v{ver}, restarting to finish the installation…', { ver: r.version });
    }
  });

  // ApkStart West: no automatic update check; only when the user clicks.
}

function bindSettings() {
  const save = async (patch) => {
    state.settings = await api.setSettings(patch);
  };

  if ($('btnPreflight')) $('btnPreflight').addEventListener('click', () => runPreflight());
  if ($('btnPreflightApply')) {
    $('btnPreflightApply').addEventListener('click', async () => {
      const btn = $('btnPreflightApply');
      btn.disabled = true;
      const r = await api.preflightApply().catch(() => null);
      btn.disabled = false;
      if (!r || !r.ok) {
        toast({ type: 'error', title: tr('Could not apply'), body: (r && r.error) || tr('Please try again later') });
        return;
      }
      state.settings = r.settings;
      toast({
        type: 'ok',
        title: tr('Configured for this PC'),
        body: tr('Memory {mem} GB / {cores} cores / {size}', { mem: Math.round((r.recommended.memoryMB || 0) / 1024), cores: r.recommended.cores, size: r.recommended.renderSize })
          + (r.driverFile ? '; ' + tr('a driver was created and will be applied on the next start') : ''),
      });
      if (r.driverError) toast({ type: 'warn', title: tr('The driver could not be written'), body: r.driverError });
      fillSettings(r.settings);
      refreshStatus();
    });
  }
  if ($('btnDrvReload')) $('btnDrvReload').addEventListener('click', () => refreshDrivers());
  if ($('btnDrvFolder')) {
    $('btnDrvFolder').addEventListener('click', async () => {
      const r = await api.driversOpenFolder().catch(() => null);
      if (!r || !r.ok) toast({ type: 'error', title: tr('Could not open the drivers folder') });
    });
  }
  if ($('btnDrvImport')) {
    $('btnDrvImport').addEventListener('click', async () => {
      const r = await api.driversImport().catch(() => null);
      if (!r || r.canceled) return;
      if (!r.ok) {
        toast({ type: 'error', title: tr('Import failed'), body: (r.errors || []).slice(0, 3).join('; ') });
        return;
      }
      toast({ type: 'ok', title: tr('Driver imported and turned on'), body: `${r.driver.name} v${r.driver.version}` });
      if (r.overview) renderDrivers(r.overview);
    });
  }
  if ($('btnDrvExport')) {
    $('btnDrvExport').addEventListener('click', async () => {
      const r = await api.driversExportTemplate().catch(() => null);
      if (!r || r.canceled) return;
      if (!r.ok) { toast({ type: 'error', title: tr('Export failed') }); return; }
      toast({ type: 'ok', title: tr('Template exported'), body: tr('After editing the effect, put it in the drivers folder and click "Refresh" to apply it') });
      refreshDrivers();
    });
  }

  $('setAdbPath').addEventListener('change', (e) => save({ adbPath: e.target.value.trim() }));
  $('setSystemImage').addEventListener('change', (e) => save({ runtime: { isoPath: e.target.value.trim() } }));
  // 内存 / 核心：填了具体值就关掉「自动」，填 0 又回到自动。
  // 旧代码只写 memoryMB，而 overridesFromSettings 只在 autoMemory=false 时才认它，
  // 于是「手动填了内存」一直被忽略 —— 这是设置页最容易被当成“没用”的一项。
  $('setMemory').addEventListener('change', (e) => {
    const v = Number(e.target.value) || 0;
    save(v > 0 ? { engine: { memoryMB: v, autoMemory: false } } : { engine: { memoryMB: 0, autoMemory: true } });
  });
  $('setCores').addEventListener('change', (e) => {
    const v = Number(e.target.value) || 0;
    save(v > 0 ? { engine: { cores: v, autoMemory: false } } : { engine: { cores: 0, autoMemory: true } });
  });
  if ($('setResourceMode')) {
    $('setResourceMode').addEventListener('change', async (e) => {
      // 资源策略会连带改 liteMode / priorityMode / renderSize（主进程里翻译）
      state.settings = await api.setSettings({ engine: { resourceMode: e.target.value } });
      fillSettings(state.settings);
      toast({ title: tr('Resource profile changed'), body: tr('Takes effect the next time you open an app'), type: 'ok' });
    });
  }
  if ($('setGpuPreference')) {
    $('setGpuPreference').addEventListener('change', (e) => {
      save({ engine: { gpuPreference: e.target.value } });
      toast({ title: tr('Graphics preference saved'), body: tr('Takes effect the next time Android starts'), type: 'ok' });
    });
  }
  if ($('setRenderSize')) {
    $('setRenderSize').addEventListener('change', (e) => save({ engine: { renderSize: e.target.value } }));
  }
  if ($('setUiLanguage')) {
    // The main process switches language and reloads this window.
    $('setUiLanguage').addEventListener('change', async (e) => {
      state.settings = await api.setSettings({ ui: { language: e.target.value } });
    });
  }
  if ($('setLocale')) {
    $('setLocale').addEventListener('change', async (e) => {
      state.settings = await api.setSettings({ engine: { locale: e.target.value } });
      toast({ title: tr('Android language updated'), body: tr('Takes effect after the Android runtime restarts'), type: 'ok' });
    });
  }
  if ($('setChineseIme')) {
    $('setChineseIme').addEventListener('change', async (e) => {
      state.settings = await api.setSettings({ engine: { chineseIme: e.target.checked } });
      toast({
        title: e.target.checked ? tr('Chinese keyboard turned on') : tr('Chinese keyboard turned off'),
        body: tr('Takes effect after the Android runtime restarts'),
        type: 'ok',
      });
    });
  }
  if ($('setKeepSnapshot')) {
    $('setKeepSnapshot').addEventListener('change', (e) => save({ engine: { keepSnapshot: e.target.checked } }));
  }
  if ($('setDataGB')) {
    $('setDataGB').addEventListener('change', (e) => {
      save({ engine: { dataPartitionGB: Number(e.target.value) || 0 } });
      refreshDataInfo();
    });
  }
  if ($('btnGrowData')) {
    $('btnGrowData').addEventListener('click', async () => {
      const gb = Number($('setDataGB').value) || 0;
      if (!gb) { toast({ title: tr('Choose a size first'), body: tr('"Automatic" lets the app decide from the free disk space, so there is nothing to expand'), type: 'info' }); return; }
      const { response } = await api.confirm({
        title: tr('Expand the Android data partition now?'),
        message: tr('/data will be resized to {gb} GB (in place; installed apps and saves are kept).', { gb }),
        detail: tr('Running Android apps must be closed first. Next time you open an app, Android boots again, which takes about ten extra seconds.'),
        okLabel: tr('Start expanding'),
      });
      if (response !== 1) return;
      $('btnGrowData').disabled = true;
      const old = $('btnGrowData').textContent;
      $('btnGrowData').textContent = tr('Expanding…');
      const r = await api.setDataSize(gb).catch((e) => ({ ok: false, error: e.message }));
      $('btnGrowData').disabled = false;
      $('btnGrowData').textContent = old;
      if (r && !r.ok && r.needsReset) {
        // 快速启动的差量盘挡着：就地扩容做不到，只能按新容量重建 /data。
        // 这是明确的数据丢失操作，必须单独再确认一次。
        const again = await api.confirm({
          title: tr('Android data must be reset to expand'),
          message: tr('Android is using the quick-start overlay disk, which cannot be expanded in place. To get {gb} GB, /data must be rebuilt at the new size.', { gb }),
          detail: tr('Rebuilding erases installed apps and saves (the emulator and the images are not affected). Continue?'),
          okLabel: tr('Erase and rebuild'),
        });
        if (again.response !== 1) { refreshDataInfo(); return; }
        $('btnGrowData').disabled = true;
        $('btnGrowData').textContent = tr('Rebuilding…');
        const rr = await api.resetAndResize(gb).catch((e) => ({ ok: false, error: e.message }));
        $('btnGrowData').disabled = false;
        $('btnGrowData').textContent = old;
        toast({
          type: rr && rr.ok ? 'ok' : 'error',
          title: rr && rr.ok ? tr('Rebuilt at the new size') : tr('Rebuild failed'),
          body: rr && rr.ok
            ? tr('Next time you open an app, /data is rebuilt at {gb} GB (the first start takes a few dozen seconds longer)', { gb })
            : (rr && rr.error) || tr('Unknown error'),
        });
        refreshDataInfo();
        return;
      }
      toast({
        type: r && r.ok ? 'ok' : 'error',
        title: r && r.ok ? tr('Data partition expanded') : tr('Expansion failed'),
        body: r && r.ok ? tr('About {gb} GB available now', { gb: r.fsGB || r.imageGB || gb }) : (r && r.error) || tr('Unknown error'),
      });
      refreshDataInfo();
    });
  }
  $('setIdle').addEventListener('change', (e) => save({ engine: { idleShutdownMinutes: Number(e.target.value) || 0 } }));
  if ($('setMirrorPrefix')) {
    $('setMirrorPrefix').addEventListener('change', (e) => save({ runtime: { mirrorPrefix: e.target.value.trim() } }));
  }
  if ($('setConnections')) {
    $('setConnections').addEventListener('change', (e) => {
      const n = Math.max(1, Math.min(16, Number(e.target.value) || 8));
      e.target.value = n;
      save({ runtime: { downloadConnections: n } });
    });
  }
  $('setAudio').addEventListener('change', (e) => save({ engine: { audio: e.target.checked } }));
  if ($('setMicrophone')) {
    $('setMicrophone').addEventListener('change', (e) => save({ engine: { microphone: e.target.checked } }));
  }
  $('setLiteMode').addEventListener('change', (e) => save({ engine: { liteMode: e.target.checked } }));
  $('setPrewarm').addEventListener('change', (e) => save({ engine: { prewarm: e.target.checked } }));
  $('setPriorityMode').addEventListener('change', (e) => save({ engine: { priorityMode: e.target.value } }));
  const savePointer = async (patch) => {
    await save({ engine: patch });
    // 立刻按当前窗口焦点重装/卸载钩子，不用等下次切窗口
    api.refreshPointerMapping().catch(() => {});
  };
  $('setMouseRightBack').addEventListener('change', (e) => savePointer({ mouseRightBack: e.target.checked }));
  $('setMouseWheelMode').addEventListener('change', (e) => savePointer({ mouseWheelMode: e.target.value }));
  $('setMouseSideButtons').addEventListener('change', (e) => savePointer({ mouseSideButtons: e.target.checked }));
  if ($('setKeymapEnabled')) {
    $('setKeymapEnabled').addEventListener('change', async (e) => {
      await api.keymap.setEnabled(e.target.checked);
      toast({ title: e.target.checked ? tr('Key mapping turned on') : tr('Key mapping turned off'), type: 'ok' });
    });
  }
  // 实验室：多开开关与后台保留数。改完提示下次打开应用生效（切换应用路径才读它）。
  if ($('setMultiWindow')) {
    $('setMultiWindow').addEventListener('change', (e) => {
      save({ engine: { multiWindow: e.target.checked } });
      toast({
        title: e.target.checked ? tr('Multi-window mode turned on (experimental)') : tr('Back to single-app mode'),
        body: e.target.checked ? tr('Takes effect the next time you open an app: several apps can run side by side, each in its own native window.') : '',
        type: 'ok',
      });
    });
  }
  if ($('setKeepBackground')) {
    $('setKeepBackground').addEventListener('change', (e) => {
      save({ engine: { keepBackground: Number(e.target.value) } });
    });
  }
  $('setDeepTrim').addEventListener('change', async (e) => {
    await save({ engine: { deepTrim: e.target.checked } });
    // 关掉深度裁剪必须把之前 pm disable-user 的包恢复回来，否则影响是持久的
    if (!e.target.checked) {
      api.restoreSystemApps().catch(() => {});
      toast({ title: tr('System components restored'), body: tr('Deep trim is off; background packages are being restored'), type: 'info' });
    }
  });
  $('setCompat').addEventListener('change', async (e) => {
    const on = e.target.checked;
    await save({ runtime: { compatImage: on } });
    const env = ((state.status = await api.runtimeStatus()).env) || {};
    const ok = env.playImage && env.playImage.ok;
    $('compatInstallField').hidden = !on || !!ok;
    if (on && !ok) toast({ title: tr('ARM compatibility mode turned on'), body: tr('You still need to download the Google Play compatibility image (Android 14, about 1.5 GB). Click the button below to start'), type: 'info' });
    else if (on) toast({ title: tr('ARM compatibility mode turned on'), body: tr('Takes effect after the runtime restarts'), type: 'info' });
  });
  $('setAutoShortcut').addEventListener('change', (e) => save({ createShortcutOnInstall: e.target.checked }));
  $('setStartMenuShortcut').addEventListener('change', (e) => save({ createStartMenuShortcut: e.target.checked }));
  $('setShortcutDir').addEventListener('change', (e) => save({ shortcutDir: e.target.value.trim() }));
  $('setDeviceSharedDir').addEventListener('change', (e) => save({ deviceSharedDir: e.target.value.trim() }));
  $('setAutoStart').addEventListener('change', (e) => save({ autoStart: e.target.checked }));
  $('setDisplayMode').addEventListener('change', async (e) => {
    const mode = e.target.value;
    $('portraitField').hidden = mode === 'fullscreen';
    state.settings = await api.setSettings({ display: { mode } });
    toast({ title: mode === 'fullscreen' ? tr('Switched to fullscreen') : tr('Switched to portrait window'), type: 'ok' });
  });
  if ($('setAutoFullscreen')) {
    $('setAutoFullscreen').addEventListener('change', async (e) => {
      const on = e.target.value === 'on';
      state.settings = await api.setSettings({ display: { autoFullscreenOnLaunch: on } });
      toast({ title: on ? tr('Auto fullscreen turned on') : tr('Auto fullscreen turned off'), body: tr('Takes effect the next time you open an app'), type: 'ok' });
    });
  }
  if ($('setOrientationMode')) {
    $('setOrientationMode').addEventListener('change', async (e) => {
      const mode = e.target.value;
      state.settings = await api.setSettings({ display: { orientationMode: mode } });
      toast({
        title: mode === 'auto' ? tr('Set to follow the app') : (mode === 'landscape' ? tr('Landscape forced') : tr('Portrait forced')),
        body: mode === 'auto'
          ? tr('The next time you open an app, the panel is chosen from the app\'s own orientation; if they differ, the runtime restarts once.')
          : tr('The next time you open an app, the runtime restarts once to switch the panel to the chosen orientation, and not again after that.'),
        type: 'ok',
      });
    });
  }
  if ($('setAutoRotate')) {
    $('setAutoRotate').addEventListener('change', async (e) => {
      const on = e.target.value === 'on';
      state.settings = await api.setSettings({ display: { autoRotate: on } });
      toast({
        title: on ? tr('Image auto-rotate turned on') : tr('Image auto-rotate turned off'),
        body: tr('Written into the Android image the next time you open an app. The screen orientation is still decided by the orientation policy and is not affected by this switch.'),
        type: 'ok',
      });
    });
  }
  if ($('setTabletMode')) {
    $('setTabletMode').addEventListener('change', async (e) => {
      const on = e.target.value === 'on';
      state.settings = await api.setSettings({ display: { tabletMode: on } });
      toast({
        title: on ? tr('Tablet layout turned on') : tr('Tablet layout turned off'),
        body: tr('Takes effect the next time you open an app (the runtime restarts once to change the logical density).'),
        type: 'ok',
      });
    });
  }
  if ($('setLandscape')) {
    $('setLandscape').addEventListener('change', async (e) => {
      const landscape = e.target.value === 'landscape';
      state.settings = await api.setSettings({ display: { landscape } });
      toast({
        title: landscape ? tr('Panel set to landscape') : tr('Panel set to portrait'),
        body: tr('The next time you open an app, the runtime restarts once to switch the physical panel orientation (about ten seconds), and not again after that.'),
        type: 'ok',
      });
    });
  }
  $('setPortrait').addEventListener('change', async (e) => {
    state.settings = await api.setSettings({ display: { portrait: e.target.value } });
    toast({ title: tr('Screen size updated'), body: tr('Takes effect the next time you open or switch apps'), type: 'ok' });
  });
  $('setWindowEmbed').addEventListener('change', async (e) => {
    const embed = e.target.value === 'embed';
    // windowEmbedChosen 标记「用户自己选过」：之后升级不会再被默认值迁移覆盖。
    state.settings = await api.setSettings({
      display: { windowEmbed: embed, windowEmbedChosen: true },
    });
    toast({
      title: embed ? tr('Switched back to embedded mode') : tr('Switched to native windows'),
      body: embed
        ? tr('Takes effect the next time you open an app. Embedded mode looks consistent and has a rotate button in the title bar, but may drop frames or show black borders when scaling or rotating.')
        : tr('Takes effect the next time you open an app. Native windows are drawn and laid out by the emulator itself, so frame rate and scaling are steadier; for landscape use the tray menu or Ctrl+Alt+R.'),
      type: 'ok',
    });
  });
  $('btnRebuildShortcuts').addEventListener('click', async () => {
    const r = await api.rebuildShortcuts();
    toast({
      title: r && r.fixed && r.fixed.length ? tr('Missing shortcuts restored') : tr('All shortcuts are in place'),
      body: r && r.fixed && r.fixed.length ? r.fixed.join(', ') : tr('The desktop and Start menu entries are fine'),
      type: 'ok',
    });
  });

  $('btnDiagnostics').addEventListener('click', async () => {
    try {
      const r = await api.doctorReport();
      toast({ title: tr('Diagnostic report exported'), body: `${r.diagnosis.title} · ${r.file}`, type: 'ok', sticky: true });
    } catch (e) {
      toast({ title: tr('Export failed'), body: e.message, type: 'error' });
    }
  });

  $('btnCleanup').addEventListener('click', async () => {
    const btn = $('btnCleanup');
    const includeSnapshots = $('chkCleanSnapshots') && $('chkCleanSnapshots').checked;
    btn.disabled = true;
    try {
      const preview = await api.runtimeCleanup({ apply: false, includeSnapshots });
      if (!preview.candidates.length) {
        toast({ title: tr('Already lean'), body: tr('There are no old images or snapshots to reclaim.'), type: 'ok' });
        return;
      }
      const r = await api.runtimeCleanup({ apply: true, includeSnapshots });
      if (r.cancelled) return;
      toast({
        title: tr('Cleanup finished'),
        body: tr('Freed about {mb} MB ({n} items). Installed apps are kept.', { mb: (r.saved / 1048576).toFixed(0), n: r.removed.length }),
        type: 'ok',
      });
      const u = await api.runtimeUsage();
      $('usageText').textContent = tr('Total {total} · {size} can be reclaimed ({n} items)', { total: u.totalText, size: u.reclaimableText, n: u.count });
    } catch (e) {
      toast({ title: tr('Cleanup failed'), body: e.message, type: 'error' });
    } finally {
      btn.disabled = false;
    }
  });

  // 重置安卓数据：二级确认（先确认意图，再确认不可撤销），清完刷新占用统计
  $('btnResetData').addEventListener('click', async () => {
    const btn = $('btnResetData');
    btn.disabled = true;
    try {
      const first = await api.confirm({
        type: 'warning',
        title: tr('Reset Android data?'),
        message: tr('This puts Android back to a clean, freshly installed state:'),
        detail: tr('• Deletes all installed third-party apps (games, video apps and so on) with their data and sign-ins') + '\n'
          + tr('• Deletes the quick-boot snapshot of the current AVD') + '\n'
          + tr('• The system image itself is not affected; opening an app again cold-starts and builds the data again') + '\n\n'
          + tr('This cannot be undone. Continue?'),
        buttons: [tr('Cancel'), tr('Continue')],
        defaultId: 0,
        cancelId: 0,
      });
      if (!first || first.response !== 1) return;
      const second = await api.confirm({
        type: 'warning',
        title: tr('Confirm once more'),
        message: tr('Installed apps and their data will be deleted permanently. Reset anyway?'),
        detail: tr('Rest assured: the system image, other AVDs, the APK cache and the icons on this PC are not touched.'),
        buttons: [tr('Cancel'), tr('Yes, reset')],
        defaultId: 0,
        cancelId: 0,
      });
      if (!second || second.response !== 1) return;
      const r = await api.runtimeResetData();
      if (!r || !r.ok) {
        toast({ title: tr('Reset failed'), body: (r && r.error) || tr('Please try again'), type: 'error' });
        return;
      }
      toast({
        title: tr('Android data reset'),
        body: tr('Freed about {mb} MB; the record of installed apps was cleared.', { mb: r.reclaimedMB }),
        type: 'ok',
      });
      const u = await api.runtimeUsage();
      $('usageText').textContent = tr('Total {total} · {size} can be reclaimed ({n} items)', { total: u.totalText, size: u.reclaimableText, n: u.count });
    } catch (e) {
      toast({ title: tr('Reset failed'), body: e.message, type: 'error' });
    } finally {
      btn.disabled = false;
    }
  });

  // 修复网络：安卓里联网页面一直黑屏（红果点「同意并继续」后整屏黑）时用。
  // 根因是虚拟机 /data 里的 Wi-Fi 配置坏了，wlan0 没起来、没有默认路由。
  // Play Store 镜像不允许 root，只能整体重置 /data；应用清单保留，点开时会自动重装。
  $('btnRepairNetwork').addEventListener('click', async () => {
    const btn = $('btnRepairNetwork');
    btn.disabled = true;
    try {
      const ok = await api.confirm({
        type: 'warning',
        title: tr('Repair the virtual machine network?'),
        message: tr('Pages in apps that need the internet stay black or keep spinning; this is usually because the Android virtual machine has no network.'),
        detail: tr('The repair tries things from the cheapest to the most costly:') + '\n\n'
          + tr('1. Cold-start the virtual machine (without loading the snapshot) and wait for the network. No data is affected') + '\n'
          + tr('2. Only if that fails, reset Android data. The app list is kept and apps reinstall when opened,') + '\n'
          + '   ' + tr('but sign-ins, watch history and the like inside apps are lost') + '\n\n'
          + tr('Only the current AVD is affected; the system image and the APK cache on this PC are not touched. The whole process takes about 1-5 minutes. Continue?'),
        buttons: [tr('Cancel'), tr('Start repair')],
        defaultId: 0,
        cancelId: 0,
      });
      if (!ok || ok.response !== 1) return;
      const r = await api.runtimeRepairNetwork();
      if (!r || !r.ok) {
        toast({
          title: tr('The network is still down'),
          body: (r && r.error) || tr('The virtual machine still has no network after the reset. Check whether the network or firewall on this PC is blocking the emulator.'),
          type: 'error',
        });
        return;
      }
      toast({
        title: tr('Network restored'),
        body: `${(r.network && r.network.ip) || tr('online')} ${r.wiped ? tr('(Android data was reset to repair the network; apps reinstall when opened)') : tr('(your data was not touched)')}`,
        type: 'ok',
      });
    } catch (e) {
      toast({ title: tr('Repair failed'), body: e.message, type: 'error' });
    } finally {
      btn.disabled = false;
    }
  });

  // 清理旧版本残留：扫描旧程序目录 / 失效卸载项 / 更新临时文件，确认后一次性清掉。
  $('btnLeftovers').addEventListener('click', async () => {
    const btn = $('btnLeftovers');
    btn.disabled = true;
    try {
      const r = await api.leftoversScan();
      if (!r || !r.ok) {
        toast({ title: tr('Scan failed'), body: (r && r.error) || tr('Please try again'), type: 'error' });
        return;
      }
      const items = r.items || [];
      if (!items.length) {
        toast({ title: tr('Nice and clean'), body: tr('No leftovers from old versions were found.'), type: 'ok' });
        return;
      }
      const mb = Math.round((r.totalBytes || 0) / 1048576);
      const lines = items.slice(0, 8).map((x) => `• ${x.note}: ${x.path}`);
      if (items.length > 8) lines.push(tr('…and {n} more', { n: items.length - 8 }));
      const ok = await api.confirm({
        type: 'warning',
        title: tr('Clean up leftovers from old versions?'),
        message: tr('Found {n} leftovers, about {mb} MB:', { n: items.length, mb }),
        detail: `${lines.join('\n')}\n\n${tr('Only old program folders, invalid uninstall entries and update temporary files are deleted; the running version and your app data are not touched.')}`,
        buttons: [tr('Cancel'), tr('Start cleanup')],
        defaultId: 1,
        cancelId: 0,
      });
      if (!ok || ok.response !== 1) return;
      const c = await api.leftoversClean(items);
      if (!c || !c.ok) {
        toast({ title: tr('Cleanup failed'), body: (c && c.error) || tr('Please try again'), type: 'error' });
        return;
      }
      const failNote = (c.failed && c.failed.length) ? ', ' + tr('{n} items were in use and not deleted', { n: c.failed.length }) : '';
      toast({
        title: tr('Leftovers from old versions cleaned up'),
        body: tr('Deleted {n} items, freed {mb} MB{note}.', { n: c.removed.length, mb: c.freedMB || 0, note: failNote }),
        type: 'ok',
      });
      const u = await api.runtimeUsage();
      $('usageText').textContent = tr('Total {total} · {size} can be reclaimed ({n} items)', { total: u.totalText, size: u.reclaimableText, n: u.count });
    } catch (e) {
      toast({ title: tr('Cleanup failed'), body: e.message, type: 'error' });
    } finally {
      btn.disabled = false;
    }
  });

  $('btnOpenShared').addEventListener('click', () => api.openSharedDir());

  // 重建快捷方式：桌面图标被误删 / 被安全软件拦掉时的兜底入口
  $('btnRebuildShortcuts').addEventListener('click', async () => {
    const btn = $('btnRebuildShortcuts');
    btn.disabled = true;
    try {
      const r = await api.rebuildShortcuts().catch(() => ({ ok: false }));
      const fixed = (r && r.fixed) || [];
      toast(fixed.length
        ? { title: tr('Shortcuts rebuilt'), body: fixed.join(', '), type: 'ok' }
        : { title: tr('All shortcuts are in place'), body: tr('Nothing needed rebuilding'), type: 'info' });
    } finally {
      btn.disabled = false;
    }
  });

  // 共享目录：先浏览选目录，再「保存并迁移」把旧文件一次性搬到新目录
  $('btnBrowseShared').addEventListener('click', async () => {
    const picked = await api.openDir();
    if (!picked) return;
    $('setSharedDir').value = picked;
    toast({ title: tr('New folder chosen'), body: tr('Click "Save and move" to move the old files over'), type: 'info' });
  });
  $('btnSaveShared').addEventListener('click', async () => {
    const dir = $('setSharedDir').value.trim();
    if (!dir) { toast({ title: tr('Type or browse for a folder first'), type: 'error' }); return; }
    const btn = $('btnSaveShared');
    btn.disabled = true;
    const r = await api.setSharedDir(dir).catch(() => ({ ok: false }));
    btn.disabled = false;
    if (r.ok) {
      const moved = r.oldDir && r.oldDir !== r.newDir;
      toast({ title: tr('Shared folder updated'), body: moved ? tr('The files that were in the old folder were moved to the new one') : tr('Saved'), type: 'ok' });
    } else {
      toast({ title: tr('Save failed'), body: r.error, type: 'error' });
    }
  });

  // 一键卸载 ApkStart 本体（取消 .apk 关联 + 启动卸载程序；便携版手动删除）
  $('btnUninstall').addEventListener('click', async () => {
    const ok = window.confirm(tr('Uninstall ApkStart West?') + '\n\n' + tr('This unlinks .apk files and removes the program. It cannot be undone.'));
    if (!ok) return;
    const btn = $('btnUninstall');
    btn.disabled = true;
    const r = await api.removeSelf().catch(() => ({ ok: false }));
    if (r.ok && r.portable) {
      btn.disabled = false;
      toast({
        title: tr('The portable edition cannot uninstall itself'),
        body: tr('Delete the program folder ({exeDir}) and the data folder ({dataDir}) by hand', { exeDir: r.exeDir, dataDir: r.dataDir }),
        type: 'info', sticky: true,
      });
      return;
    }
    if (!r.ok) {
      btn.disabled = false;
      toast({ title: tr('Uninstall failed'), body: r.error, type: 'error' });
      return;
    }
    toast({ title: tr('Uninstalling…'), body: tr('The uninstaller has started; ApkStart West is about to quit'), type: 'ok', sticky: true });
  });

  // ARM 兼容镜像下载（带进度 toast）
  $('btnInstallPlay').addEventListener('click', async () => {
    const btn = $('btnInstallPlay');
    btn.disabled = true;
    const t = toast({ title: tr('Starting the ARM compatibility image download'), body: tr('Preparing…'), sticky: true, spinner: true, progress: 3 });
    const un = api.on('provision:progress', (p) => {
      if (p.component !== 'playimg') return;
      t.update({ title: tr('Downloading the ARM compatibility image'), body: p.message || '', progress: p.percent });
    });
    try {
      const r = await api.installPlayImage();
      if (r && r.ok) {
        t.update({ title: tr('ARM compatibility image ready'), body: tr('Takes effect after the runtime restarts'), progress: 100 });
        setTimeout(() => t.dismiss(), 3000);
        $('compatInstallField').hidden = true;
        refreshStatus();
      } else {
        t.update({ title: tr('Compatibility image download failed'), body: (r && r.error) || tr('Unknown error'), progress: null });
        t.dismiss();
        toast({ title: tr('Compatibility image download failed'), body: (r && r.error) || tr('Unknown error'), type: 'error' });
      }
    } catch (e) {
      t.dismiss();
      toast({ title: tr('Compatibility image download failed'), body: e.message, type: 'error' });
    } finally {
      un();
      btn.disabled = false;
    }
  });

  // 兼容镜像状态显示
  (async () => {
    const env = ((state.status = await api.runtimeStatus()).env) || {};
    const s = state.settings;
    const on = !!(s && s.runtime && s.runtime.compatImage);
    const ok = env.playImage && env.playImage.ok;
    $('compatInstallField').hidden = !on || !!ok;
    if (env.playImage) {
      $('compatImgStatus').textContent = ok
        ? tr('Ready ({gb} GB)', { gb: (env.playImage.size / 1073741824).toFixed(2) }) : tr('Not downloaded');
    }
  })();
  $('btnOpenData').addEventListener('click', async () => {
    const info = await api.info();
    const dir = info.runtimeDir || info.dataDir;
    window.open(`file:///${dir.replace(/\\/g, '/')}`);
  });
  $('btnBrowseRuntimeDir').addEventListener('click', async () => {
    const info = await api.info();
    const picked = await api.openDir();
    if (!picked) return;
    await api.setSettings({ runtime: { dir: picked } });
    $('setRuntimeDir').value = picked;
    toast({ title: tr('Data folder updated'), body: tr('Restart ApkStart West for it to take effect (old data is not moved automatically)'), type: 'ok', sticky: true });
  });

  // 安卓数据目录（AVD + 快照）：真正吃盘的那块，单独指到别的盘
  if ($('btnBrowseAvdDir')) {
    $('btnBrowseAvdDir').addEventListener('click', async () => {
      const picked = await api.openDir();
      if (!picked) return;
      await api.setSettings({ runtime: { avdDir: picked } });
      $('setAvdDir').value = picked;
      toast({
        title: tr('Android data folder updated'),
        body: tr('Restart ApkStart West for it to take effect. You can move the apkstart.avd folder from the old folder to the new one as a whole, then delete the old one.'),
        type: 'ok',
        sticky: true,
      });
    });
  }
  if ($('btnOpenAvdDir')) {
    $('btnOpenAvdDir').addEventListener('click', async () => {
      const info = await api.dataInfo().catch(() => null);
      const dir = (info && info.avdDir) || (await api.info()).dataDir;
      window.open(`file:///${String(dir).replace(/\\/g, '/')}`);
    });
  }

  $('btnRuntimeStart').addEventListener('click', async () => {
    const el = $('probeResult');
    el.textContent = tr('Starting…');
    const r = await api.runtimeStart();
    el.textContent = r.ok ? tr('Ready: {engine}', { engine: r.engine }) : tr('Start failed: {err}', { err: r.error });
    refreshStatus();
  });

  $('btnRuntimeStop').addEventListener('click', async () => {
    await api.runtimeStop();
    $('probeResult').textContent = tr('Built-in virtual machine stopped');
    refreshStatus();
  });

  $('btnAssoc').addEventListener('click', async () => {
    const btn = $('btnAssoc');
    if (btn.dataset.on === '1') {
      await api.assocUnregister();
      btn.textContent = tr('Not linked · click to link');
      btn.dataset.on = '0';
      toast({ title: tr('.apk link removed') });
    } else {
      const r = await api.assocRegister();
      btn.textContent = tr('Linked · click to unlink');
      btn.dataset.on = '1';
      toast({ title: tr('.apk link turned on'), body: r.ok ? tr('Double-clicking an APK now installs it into ApkStart West') : '', type: r.ok ? 'ok' : 'error' });
    }
  });
}

/* ---------------- 事件绑定 ---------------- */

function bindEvents() {
  // 链接统一走系统浏览器
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="http"]');
    if (!a) return;
    e.preventDefault();
    api.openExternal(a.getAttribute('href'));
  });

  $('btnSettings').addEventListener('click', openSettings);
  // 0.6.2：内置手册从标题栏和「关于」页都能直接打开
  $('btnManual')?.addEventListener('click', () => openManual({ topic: 'overview', reason: 'toolbar' }));
  $('btnOpenManual')?.addEventListener('click', () => openManual({ topic: 'overview', reason: 'about' }));
  // 状态标签也当入口：点「需要部署 / 引导中 / Android 14」直接进设置的运行时面板
  $('engineTag').addEventListener('click', () => showSetup(true));
  $('btnCloseSettings').addEventListener('click', closeSettings);
  $('btnDoneSettings').addEventListener('click', closeSettings);
  $('settingsMask').addEventListener('click', (e) => {
    if (e.target === $('settingsMask')) closeSettings();
  });

  // 运行时部署：入口已收进设置，这里只处理面板内的按钮
  $('btnDeployAll').addEventListener('click', deployAll);
  $('btnMarkInstalled').addEventListener('click', markInstalled);
  $('btnGuideClose').addEventListener('click', () => { $('setupGuide').hidden = true; });
  $('btnSetupAdvanced').addEventListener('click', () => {
    const adv = document.querySelector('.advanced-group');
    if (adv) {
      adv.open = true;
      adv.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  });

  // 状态条上的自检计数：点开就是设置里的运行时面板
  $('envChip').addEventListener('click', () => {
    openSettings().then(() => {
      const box = $('envCheck');
      if (box && !box.hidden) focusGroup(box);
      else focusGroup($('runtimeGroup'));
    }).catch(() => {});
  });

  $('setupSteps').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'emulator' || act === 'sysimg' || act === 'accel'
      || act === 'adb' || act === 'qemu' || act === 'iso' || act === 'disk') {
      const r = await runStep(act);
      if (!r.ok) toast({ title: tr('Action failed'), body: r.error, type: 'error', sticky: true });
      return;
    }
    if (act === 'isoImport') {
      const r = await api.importIso();
      if (r.ok) { toast({ title: tr('System image imported'), body: r.path, type: 'ok' }); refreshStatus(); }
      else if (!r.canceled) toast({ title: tr('Import failed'), body: r.error, type: 'error' });
      return;
    }
    if (act === 'diskImport') {
      const r = await api.importDisk();
      if (r.ok) { toast({ title: tr('Virtual disk imported'), body: tr('You can start the runtime right away'), type: 'ok' }); refreshStatus(); }
      else if (!r.canceled) toast({ title: tr('Import failed'), body: r.error, type: 'error' });
      return;
    }
    if (act === 'install') { await startInstall(); return; }
    if (act === 'vmStart') {
      const t = toast({ title: tr('Starting the runtime…'), body: tr('The first start has to boot the Android system'), sticky: true, spinner: true });
      const r = await api.runtimeStart();
      if (r.ok) { t.update({ title: tr('Runtime ready'), type: 'ok' }); setTimeout(t.dismiss, 2200); }
      else t.update({ title: tr('Start failed'), body: r.error, type: 'error' });
      refreshStatus();
      return;
    }
    if (act === 'vmStop') {
      await api.runtimeStop();
      toast({ title: tr('Runtime session ended') });
      refreshStatus();
    }
  });

  const pick = async () => {
    const files = await api.pickApk();
    if (files.length) installFiles(files);
  };
  $('btnInstall').addEventListener('click', pick);
  $('btnInstall2').addEventListener('click', pick);
  // 共享目录入口移到设置里：同步 + 打开都在「文件互通」组内
  const btnSync = $('btnSyncShared');
  if (btnSync) btnSync.addEventListener('click', async () => {
    btnSync.disabled = true;
    try {
      await api.syncShared();
      toast({ title: tr('Shared folder synced'), type: 'ok' });
    } catch (_) {
      toast({ title: tr('Sync failed'), body: tr('Syncing is skipped while the runtime is not ready'), type: 'error' });
    } finally {
      btnSync.disabled = false;
    }
  });

  $('search').addEventListener('input', (e) => {
    state.filter = e.target.value;
    renderGrid();
  });

  $('grid').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    // 「添加应用」卡片没有 data-pkg，走安装流程而不是启动。
    // 直接转调工具栏那个「安装 APK」按钮，复用它的文件选择逻辑。
    if (card.classList.contains('card-add')) { $('btnInstall').click(); return; }
    if (card.dataset.pkg) launchApp(card.dataset.pkg);
  });

  $('grid').addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    showMenu(e.clientX, e.clientY, card.dataset.pkg);
  });

  $('grid').addEventListener('dblclick', (e) => {
    const card = e.target.closest('.card');
    if (card) createShortcut(card.dataset.pkg);
  });

  $('ctxmenu').addEventListener('click', (e) => {
    const item = e.target.closest('.item');
    if (item) handleMenu(item.dataset.act);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ctxmenu')) hideMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideMenu();
      closeSettings();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $('search').focus();
    }
  });

  // 拖放安装
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    $('dropzone').classList.add('on');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) $('dropzone').classList.remove('on');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('dropzone').classList.remove('on');
    const files = [...(e.dataTransfer?.files || [])];
    const paths = files
      .map((f) => { try { return api.pathForFile(f); } catch (_) { return null; } })
      .filter((p) => p && /\.apk$/i.test(p));
    if (paths.length) installFiles(paths);
    else toast({ title: tr('Only .apk files can be dropped here'), type: 'error' });
  });

  // 主进程事件
  api.on('install:error', (p) => {
    // 报错了就别再让「正在安装…」那条一直转圈（可能来自双击 APK 的另一条链路）
    if (installToast) { try { installToast.dismiss(); } catch (_) { /* ignore */ } installToast = null; }
    const name = p && p.file ? String(p.file).split(/[\\/]/).pop() : '';
    const raw = (p && p.message) || tr('Unknown error');
    toast({
      title: name ? tr('Install failed: {name}', { name }) : tr('Install failed'),
      body: friendlyInstallErrorText(raw),
      type: 'error',
    });
    // 0.6.2：安装失败自动把对应章节推到用户面前（ARM / 签名 / 空间…）
    openManualForError(raw, 'install-failed');
  });
  api.on('toast', (p) => toast({ title: p.message, type: p.type === 'error' ? 'error' : 'info' }));
  api.on('app:launched', () => setTimeout(refreshApps, 800));
  // 应用被关掉（托盘「关闭当前应用」、右键菜单、或窗口被关）后要刷新「运行中」标记
  api.on('apps:changed', () => setTimeout(refreshApps, 300));
  api.on('runtime:log', (m) => console.log('[runtime]', m));
  api.on('ui:navigate', (v) => {
    if (v === 'settings') openSettings();
    if (v === 'setup') { showSetup(true); refreshStatus(); }
  });
  api.on('provision:progress', (p) => updateStepProgress(p.component, p));
  api.on('update:state', (info) => {
    if (!info) return;
    renderUpdate(info);
    // 启动 8 秒后才拿到更新信息：欢迎卡若还开着，把「发现新版本」这条补进去
    const wm = $('welcomeMask');
    if (wm && !wm.hidden) renderWelcomeTips();
  });
  api.on('update:progress', (p) => renderUpdateProgress(p));
  // 自动检测：主进程定时跑完后把结果推过来，设置页开着就直接刷新面板
  api.on('autodebug:state', (r) => {
    if (r && r.running) {
      const txt = $('autodebugStateText');
      if (txt) txt.textContent = tr('Checking…');
      return;
    }
    renderAutodebug(r);
  });
}

/* ---------------- 启动 ---------------- */

async function init() {
  bindEvents();
  bindSettings();
  bindSettingsCategory();
  bindAutodebug();
  bindUpdate();
  bindAndroid();
  bindWelcome();
  state.settings = await api.getSettings();
  await refreshStatus();
  await refreshApps();
  refreshAndroid();
  selfCheck();
  maybeShowWelcome();
  setInterval(refreshStatus, 6000);
  setInterval(refreshApps, 15000);
  setInterval(selfCheck, 60000);
}

/* ---------------- 启动欢迎卡 ---------------- */

let startupInfo = null;

function greetingOf(h) {
  if (h < 5) return tr('Up late');
  if (h < 11) return tr('Good morning');
  if (h < 13) return tr('Hello');
  if (h < 18) return tr('Good afternoon');
  return tr('Good evening');
}

function bindWelcome() {
  const mask = $('welcomeMask');
  if (!mask) return;
  const close = () => { mask.hidden = true; };
  const never = $('welcomeNever');
  $('welcomeOk').addEventListener('click', () => {
    if (never && never.checked) api.setSettings({ welcome: { disabled: true } }).catch(() => {});
    close();
  });
  $('welcomeSettings').addEventListener('click', () => { close(); openSettings(); });
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !mask.hidden) close(); });
}

/** 决定要不要弹：开机自启必弹；手动打开则每天最多一次，且用户可永久关闭 */
async function maybeShowWelcome() {
  const mask = $('welcomeMask');
  if (!mask) return;
  // 冒烟截图时不要弹欢迎卡：否则每次自动截图都被它挡住主界面
  try { if ((await api.startupInfo()).smoke) return; } catch (_) { /* ignore */ }
  try { startupInfo = await api.startupInfo(); } catch (_) { startupInfo = null; }
  const cfg = (state.settings && state.settings.welcome) || {};
  if (cfg.disabled) return;
  const today = new Date().toISOString().slice(0, 10);
  if (!(startupInfo && startupInfo.autostart) && cfg.lastDate === today) return;

  const h = new Date().getHours();
  $('welcomeHi').textContent = tr('{greeting}, welcome back', { greeting: greetingOf(h) });
  const ver = (startupInfo && startupInfo.version) || (state.status && state.status.version) || '';
  const ready = state.status && state.status.ready;
  $('welcomeSub').textContent = `ApkStart West${ver ? ` v${ver}` : ''} · ${ready ? tr('Runtime ready, open an app to use it') : tr('The runtime is prepared automatically when needed')}`;

  const apps = (state.apps || []).length;
  const dev = $('statusDevice') ? $('statusDevice').textContent.trim() : '';
  const chips = [
    { k: String(apps), v: tr('Installed apps') },
    { k: ready ? tr('Ready') : tr('Standby'), v: tr('Android runtime') },
    { k: dev ? dev.replace(/^.*?(\d+)/, '$1') : '—', v: tr('Device / port') },
  ];
  $('welcomeStats').innerHTML = chips
    .map((c) => `<div class="welcome-stat"><b>${esc(c.k)}</b><span>${esc(c.v)}</span></div>`)
    .join('');

  const tips = [];
  $('welcomeTips').innerHTML = '';
  mask.hidden = false;
  renderWelcomeTips();
  api.setSettings({ welcome: { lastDate: today } }).catch(() => {});
}

/** 提示区单独渲染：启动 8 秒后才拿到更新信息，那时卡片可能还开着，需要补一次 */
function renderWelcomeTips() {
  const box = $('welcomeTips');
  if (!box) return;
  const apps = (state.apps || []).length;
  const tips = [];
  if (lastUpdate && lastUpdate.hasUpdate) {
    tips.push(tr('New version {tag} found; you can update with one click in Settings → Updates and about', { tag: `<b>${esc(lastUpdate.tag || '')}</b>` }));
  }
  if (!apps) {
    tips.push(tr('Drop an APK into the window to install it; a desktop icon is created automatically'));
  } else {
    tips.push(tr('Double-click an app card to run it in its own window; use the top right to rotate, resize or close'));
  }
  tips.push(tr('Closing a window only quits that app; the Android environment stays, so the next start is faster'));
  box.innerHTML = tips
    .map((t, i) => `<div class="welcome-tip"><i>${i + 1}</i><span>${t}</span></div>`)
    .join('');
}

/* ---------------- 环境自检 ---------------- */

let envBusy = false;

/** 拉取 doctor:selfCheck：把问题渲染到设置里的自检面板，并在状态条上留一个计数 */
async function selfCheck() {
  if (envBusy) return;
  envBusy = true;
  try {
    const r = await api.selfCheck().catch(() => null);
    if (r) renderEnvCheck(r);
  } catch (_) { /* 自检失败不阻断主流程 */ }
  finally { envBusy = false; }
}

function renderEnvCheck(r) {
  const box = $('envCheck');
  if (!box) return;
  // 「组件缺失」在同一个面板的一键完成里已经覆盖，不再重复列出
  const needDeploy = !!(state.status && state.status.needsSetup);
  const issues = (r.issues || []).filter((i) => !(needDeploy && i.fix === 'deploy'));

  // 主界面不再放横幅：只在底部状态条上留一个可点的计数，点开就是设置里的自检面板
  const chip = $('envChip');
  if (chip) {
    const errs = issues.filter((i) => i.severity === 'error').length;
    chip.hidden = issues.length === 0;
    chip.textContent = errs ? tr('{n} to fix', { n: errs }) : tr('{n} notices', { n: issues.length });
    chip.className = `status-chip${errs ? ' err' : ''}`;
    chip.title = issues.map((i) => i.title).join('; ');
  }

  if (!issues.length) {
    box.hidden = false;
    box.innerHTML = `
      <div class="env-check-ok">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
        <span>${esc(tr('Environment check passed; nothing that could affect running was found.'))}</span>
        <span style="flex:1"></span>
        <button class="btn ghost sm" id="btnEnvRecheck">${esc(tr('Check again'))}</button>
      </div>`;
    const re = $('btnEnvRecheck');
    if (re) re.addEventListener('click', selfCheck);
    return;
  }
  const errs = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.length - errs;
  box.hidden = false;
  box.innerHTML = `
    <div class="env-check-head">
      <span class="ec-title">${esc(tr('Environment check'))}</span>
      ${errs ? `<span class="ec-count">${esc(tr('{n} serious', { n: errs }))}</span>` : ''}
      ${warns ? `<span class="ec-count warn">${esc(tr('{n} notices', { n: warns }))}</span>` : ''}
      <span class="ec-spacer"></span>
      <button class="btn ghost sm" id="btnEnvRecheck">${esc(tr('Check again'))}</button>
      <button class="btn primary sm" id="btnEnvFixAll">${esc(tr('Fix all'))}</button>
    </div>
    <div class="env-check-list">
      ${issues.map((i) => `
        <div class="env-check-item ${i.severity}">
          <span class="ec-sev"></span>
          <div class="ec-body">
            <div class="ec-name">${esc(i.title)}</div>
            <div class="ec-hint">${esc(i.hint || '')}</div>
          </div>
          ${i.fix ? `<button class="ec-fix" data-code="${esc(i.code)}">${esc(tr('Fix'))}</button>` : ''}
          <button class="ec-help" data-code="${esc(i.code)}" title="${esc(tr('Open the built-in guide'))}">${esc(tr('Guide'))}</button>
        </div>`).join('')}
    </div>`;
  const re = $('btnEnvRecheck');
  if (re) re.addEventListener('click', selfCheck);
  const fixAll = $('btnEnvFixAll');
  if (fixAll) fixAll.addEventListener('click', () => fixAllIssues(issues));
  box.querySelectorAll('.ec-fix').forEach((b) => {
    b.addEventListener('click', () => {
      const issue = issues.find((x) => x.code === b.dataset.code);
      if (issue) fixIssue(issue);
    });
  });
  box.querySelectorAll('.ec-help').forEach((b) => {
    b.addEventListener('click', () => {
      const issue = issues.find((x) => x.code === b.dataset.code);
      if (issue) openManualForIssue(issue, 'clicked');
    });
  });
}

/** 修复没成功：如实报错，并把对应教程自动打开（同一章节主进程 60 秒内只弹一次） */
function failFix(issue, ctl, body) {
  const msg = body || tr('Follow the guide by hand');
  if (ctl && typeof ctl.update === 'function') ctl.update({ body: msg, type: 'error', sticky: true });
  else toast({ title: tr('Repair not finished'), body: msg, type: 'error' });
  openManualForIssue(issue, 'fix-failed');
}

async function fixIssue(issue) {
  switch (issue.fix) {
    case 'vcRedist': {
      const r = await api.installVcRedist().catch(() => ({ ok: false }));
      if (!r.ok && r.reason === 'no-installer') {
        api.openExternal(`https://learn.microsoft.com/${window.uiLang === 'pt-BR' ? 'pt-br' : 'en-us'}/cpp/windows/latest-supported-vc-redist?view=msvc-170#visual-studio-2015-2017-2019-and-2022`);
        toast({ title: tr('Built-in installer not found'), body: tr('The official Microsoft download page was opened; please download the x64 version'), type: 'info' });
        break;
      }
      toast(r.ok
        ? { title: tr('VC++ runtime installed'), type: 'ok' }
        : { title: tr('Installation not finished'), body: r.error || tr('Please try again'), type: 'error' });
      break;
    }
    case 'virtualization': {
      const t = toast({ title: tr('Turning on hardware acceleration…'), body: tr('Click "Yes" in the permission prompt that appears'), sticky: true, spinner: true });
      const r = await api.enableVirtualization().catch(() => ({ ok: false }));
      if (r.ok) {
        t.update({ title: tr('Hardware acceleration enabled'), body: r.restartNeeded ? tr('Restart your PC for the best performance') : (r.note || ''), type: 'ok' });
        setTimeout(t.dismiss, 3200);
      } else if (r.manual) {
        // 商店（MSIX）版：包固定 mediumIL，通常拿不到管理员授权。
        // 与其让用户点一个注定失败的按钮，不如直接把「启用或关闭 Windows 功能」
        // 对话框弹出来，并告诉他勾哪一项。
        t.dismiss();
        await api.openWindowsFeatures?.().catch(() => null);
        toast({
          title: tr('A one-time manual step is needed'),
          body: r.note || tr('In the window that opened, tick "Windows Hypervisor Platform", confirm, then restart your PC.'),
          type: 'info',
          sticky: true,
        });
        // 自动提权走不通时，同步把图文教程打开，避免用户对着系统窗口不知道勾哪个
        openManualForIssue(issue, 'fix-failed');
      } else if (r.cancelled) {
        t.update({ title: tr('Cancelled'), body: r.error || tr('Administrator permission was not granted, so hardware acceleration was not changed.'), type: 'info', spinner: false });
        setTimeout(t.dismiss, 4200);
      } else {
        failFix(issue, t, r.error || r.note || tr('Could not turn on hardware acceleration; the matching guide was opened'));
      }
      break;
    }
    case 'disk': {
      // 主进程会弹出原生确认框（含可释放空间预览），这里不再重复 confirm
      const r = await api.runtimeCleanup({ apply: true }).catch(() => null);
      if (!r) { toast({ title: tr('Cleanup failed'), body: tr('Please try again'), type: 'error' }); break; }
      if (r.cancelled) break;
      toast({ title: tr('Cleanup finished'), body: tr('Freed about {mb} MB', { mb: ((r.saved || 0) / 1048576).toFixed(0) }), type: 'ok' });
      break;
    }
    case 'path': {
      toast({ title: tr('Moving to a plain-English folder is recommended'), body: tr('Change "Runtime data folder" in Settings → Integration and files, then restart the app.'), type: 'info', sticky: true });
      openSettings();
      break;
    }
    case 'deploy': {
      toast({ title: tr('Installing the missing runtime components…'), type: 'info', sticky: true, spinner: true });
      await deployAll();
      break;
    }
    case 'lock': {
      const r = await api.clearLocks().catch(() => ({ ok: false }));
      toast(r.ok ? { title: tr('Leftover lock files removed'), type: 'ok' } : { title: tr('Cleanup failed'), body: r.error, type: 'error' });
      break;
    }
    // ---- 自动检测（自动 debug）新增的修复动作 ----
    case 'restartRuntime': {
      // unauthorized / 引导卡死 / 孤儿锁的首选自愈动作：停一次再拉起来（走冷启动）
      const t = toast({ title: tr('Restarting the Android runtime…'), body: tr('It boots again, which takes about ten seconds'), type: 'info', sticky: true, spinner: true });
      const r = await api.restartRuntime().catch(() => ({ ok: false }));
      if (r && r.ok) {
        t.update({ title: tr('Android runtime restarted'), body: tr('In the authorization prompt, click "Allow"'), type: 'ok' });
        setTimeout(t.dismiss, 3000);
      } else {
        failFix(issue, t, (r && r.error) || tr('Restart failed; the matching guide was opened'));
      }
      break;
    }
    case 'orphans': {
      const r = await api.clearOrphans().catch(() => ({ ok: false }));
      toast(r && r.ok
        ? { title: tr('Leftover emulator processes removed'), type: 'ok' }
        : { title: tr('Cleanup failed'), body: (r && r.error) || tr('Please try again'), type: 'error' });
      break;
    }
    case 'snapshots': {
      const r = await api.clearSnapshot().catch(() => ({ ok: false }));
      toast(r && r.ok
        ? { title: tr('Quick-boot snapshot discarded'), body: tr('The next time you open an app, it does one full cold start'), type: 'ok' }
        : { title: tr('Could not discard it'), body: (r && r.error) || tr('Please try again'), type: 'error' });
      break;
    }
    case 'dataReset': {
      // 扩容被差量盘挡住时必须重建：会清掉已装应用，所以只引导、不自动做。
      toast({
        title: tr('The Android data partition must be rebuilt'),
        body: tr('Go to Settings → Performance and resources and click "Expand now"; when it says a reset is needed, confirm once (this erases installed apps).'),
        type: 'info',
        sticky: true,
      });
      openSettings().then(() => focusGroup($('perfGroup'))).catch(() => {});
      break;
    }
    case 'orientation': {
      // 让物理面板方向跟上策略：策略要横屏就切横屏，要竖屏就切竖屏
      const s = (state.settings && state.settings.display) || {};
      const mode = s.orientationMode || 'auto';
      if (mode === 'auto') {
        toast({ title: tr('Currently set to "Follow the app"'), body: tr('The panel orientation switches automatically per app; if one app has the wrong orientation, set it for that app alone.'), type: 'info' });
        break;
      }
      const wantLandscape = mode === 'landscape';
      state.settings = await api.setSettings({ display: { landscape: wantLandscape } });
      fillSettings(state.settings);
      toast({
        title: wantLandscape ? tr('Panel switched to landscape') : tr('Panel switched to portrait'),
        body: tr('Takes effect the next time you open an app'),
        type: 'ok',
      });
      break;
    }
    case 'shared': {
      toast({ title: tr('Check the shared folder'), body: tr('Go to Settings → Integration and files and make sure the shared folder on this PC exists and is writable.'), type: 'info', sticky: true });
      openSettings().then(() => focusGroup(document.querySelector('#settingsBody [data-cat="files"]'))).catch(() => {});
      break;
    }
    // ---- 0.6.2 声音检测对应的修复动作 ----
    case 'audio': {
      const t = toast({ title: tr('Turning on sound for Android apps…'), body: tr('The runtime restarts now so that -no-audio no longer applies'), type: 'info', sticky: true, spinner: true });
      const s = await api.setSettings({ engine: { audio: true } }).catch(() => null);
      if (!s) { failFix(issue, t, tr('Could not save the sound setting; the matching guide was opened')); break; }
      state.settings = s;
      fillSettings(s);
      const r = await api.restartRuntime().catch(() => ({ ok: false }));
      if (r && r.ok !== false) {
        t.update({ title: tr('Sound turned on'), body: tr('The runtime restarted; you should now hear app sound'), type: 'ok' });
        setTimeout(t.dismiss, 3600);
      } else {
        failFix(issue, t, tr('The sound switch is on, but the runtime failed to restart; the matching guide was opened'));
      }
      break;
    }
    case 'audioService': {
      // MSIX / 普通权限都拿不到系统服务的提权操作，直接把教程送到用户面前
      toast({ title: tr('Windows Audio must be started by hand'), body: tr('The guide was opened; follow it once'), type: 'info', sticky: true });
      openManualForIssue(issue, 'clicked');
      break;
    }
    case 'microphone': {
      const t = toast({ title: tr('Turning on microphone input…'), body: tr('The runtime restarts now so the recording device takes effect'), type: 'info', sticky: true, spinner: true });
      const s = await api.setSettings({ engine: { microphone: true } }).catch(() => null);
      if (!s) { failFix(issue, t, tr('Could not save the microphone setting; the matching guide was opened')); break; }
      state.settings = s;
      fillSettings(s);
      const r = await api.restartRuntime().catch(() => ({ ok: false }));
      if (r && r.ok !== false) {
        t.update({ title: tr('Microphone turned on'), body: tr('The runtime restarted; apps should now be able to record'), type: 'ok' });
        setTimeout(t.dismiss, 3600);
      } else {
        failFix(issue, t, tr('The microphone switch is on, but the runtime failed to restart; the matching guide was opened'));
      }
      break;
    }
    case 'repairNetwork': {
      const t = toast({ title: tr('Resetting the Android network…'), body: tr('The app list is kept'), type: 'info', sticky: true, spinner: true });
      const r = await api.runtimeRepairNetwork().catch(() => ({ ok: false }));
      if (r && r.ok !== false) {
        t.update({ title: tr('Android network reset'), body: tr('Apps go back online the next time you open them'), type: 'ok' });
        setTimeout(t.dismiss, 3000);
      } else {
        t.update({ title: tr('Reset failed'), body: (r && r.error) || tr('Please try again'), type: 'error' });
      }
      break;
    }
    case 'report': {
      const r = await api.doctorReport().catch(() => null);
      toast(r && r.ok !== false
        ? { title: tr('Diagnostic report exported'), body: tr('Sending the report to the author is the fastest way to find the problem'), type: 'ok' }
        : { title: tr('Export failed'), body: (r && r.error) || tr('Please try again'), type: 'error' });
      break;
    }
    case 'settings': {
      openSettings();
      break;
    }
    default:
      toast({ title: tr('No automatic fix for this yet'), body: issue.hint || '', type: 'info' });
  }
  // 修复后重新自检，刷新横幅与状态
  setTimeout(selfCheck, 600);
  setTimeout(refreshStatus, 600);
}

async function fixAllIssues(issues) {
  const fixable = issues.filter((i) => i.fix);
  for (const i of fixable) {
    // eslint-disable-next-line no-await-in-loop
    await fixIssue(i);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((res) => setTimeout(res, 500));
  }
}

init().catch((e) => {
  console.error(e);
  toast({ title: tr('Initialization failed'), body: e.message, type: 'error', sticky: true });
});
