'use strict';
/**
 * 自动检测（自动 debug）内核
 *
 * 分两层，刻意分开：
 *   1) 采集层（src/core/autodebug-probe.js，主进程）：把机器真实状态采成一份纯数据快照 obs；
 *   2) 判定层（本文件，纯函数）：evaluate(obs) → issues[]。
 *
 * 判定层不碰 fs / child_process / electron，CI 可以直接 require 并单测
 * （教训见记忆 2026-11-17：CI 上 require 顶层依赖 electron 的模块会全红）。
 * 唯一额外依赖是同目录的 manual.js（纯映射表），用来把问题直接指到内置教程章节。
 *
 * 一条铁律：obs 里没有的字段一律当作「不知道」，不能因为探测失败就报问题。
 * 误报比漏报更伤用户信任 —— 用户一旦发现弹出来的「检测结果」是假的，
 * 就再也不会相信自动检测给出的任何结论了。
 */

const manual = require('./manual');
const { tr } = require('./i18n');

/** 问题分类（设置页按这个顺序分组展示） */
const CATEGORIES = [
  { id: 'runtime', name: 'Runtime', hint: 'Android virtual machine process, boot stage, snapshots and leftover locks' },
  { id: 'device', name: 'Device connection', hint: 'adb authorization state and whether the device is online' },
  { id: 'storage', name: 'Storage', hint: 'Free disk space, data partition and shared folder' },
  { id: 'settings', name: 'Settings', hint: 'Settings that conflict with or cancel each other' },
  { id: 'network', name: 'Network', hint: 'Android network and download source connectivity' },
  { id: 'logs', name: 'Logs', hint: 'Errors in the runtime log' },
];

const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

/** 严重度排序：数字越大越严重 */
const SEVERITY_RANK = { error: 3, warn: 2, info: 1 };

/** 归一化一条问题，保证 UI 拿到的字段永远齐全 */
function normalise(raw) {
  if (!raw || !raw.code) return null;
  const severity = SEVERITY_RANK[raw.severity] ? raw.severity : 'info';
  const item = {
    code: String(raw.code),
    category: CATEGORY_IDS.includes(raw.category) ? raw.category : 'runtime',
    severity,
    title: String(raw.title || raw.code),
    hint: String(raw.hint || ''),
    // fix 是「一键修复」的动作名，由渲染层映射到具体操作；没有就留空
    fix: raw.fix || '',
    // detail 是给人看的补充信息（路径、数值等），不进标题
    detail: raw.detail === undefined || raw.detail === null ? '' : String(raw.detail),
  };
  // 0.6.2：每条问题都自带「教程」目标，渲染层不用再复制一份故障分类表
  item.help = manual.topicForIssue(item);
  return item;
}

/**
 * 判定：把观测快照变成问题列表
 * @param {object} obs 采集层给出的快照（字段可缺省）
 * @returns {Array<object>} 归一化后的问题列表
 */
function evaluate(obs) {
  const o = obs || {};
  const runtime = o.runtime || {};
  const device = o.device || {};
  const storage = o.storage || {};
  const settings = o.settings || {};
  const network = o.network || {};
  const logs = o.logs || {};
  const accel = o.accel || {};
  const out = [];

  const push = (raw) => {
    const it = normalise(raw);
    if (it) out.push(it);
  };

  /* ---------------- 运行时 ---------------- */

  // 开机失败：直接给最后一条真实原因，别让用户猜
  const bootError = runtime.error || (runtime.lastFailure && runtime.lastFailure.error) || '';
  if (bootError) {
    push({
      code: 'runtime.bootFailed',
      category: 'runtime',
      severity: 'error',
      title: tr('The Android runtime failed to start last time'),
      hint: tr('The real error from the runtime was captured. Fixing this cause usually restores it in one go.'),
      detail: bootError,
      fix: 'restartRuntime',
    });
  }

  // 一直卡在引导中：超过阈值还没 ready，多半是快照坏了或镜像有问题
  if (runtime.running && runtime.phase && runtime.phase !== 'ready' && runtime.bootMs > 150000) {
    push({
      code: 'runtime.stuckBoot',
      category: 'runtime',
      severity: 'warn',
      title: tr('Android is stuck in the boot stage'),
      hint: tr('It has been booting for more than 2.5 minutes without reaching the system. A common cause is a damaged quick-start snapshot; restarting the runtime (one cold start) usually fixes it.'),
      detail: tr('Stage: {phase}', { phase: runtime.phase }),
      fix: 'restartRuntime',
    });
  }

  // 残留锁文件：会让下次启动被判成「AVD 已被占用」直接 FATAL
  if (Number(runtime.locks) > 0) {
    push({
      code: 'runtime.staleLocks',
      category: 'runtime',
      severity: 'warn',
      title: tr('Found {n} lock files left from the last run', { n: runtime.locks }),
      hint: tr('If lock files are not cleared, the next start is treated as "AVD already in use" and fails right away. You can clear them in one click.'),
      fix: 'lock',
    });
  }

  // 孤儿进程：emulator.exe 只是启动器，qemu 是 detached 的独立进程，
  // 只杀启动器会留下孤儿占着 multiinstance.lock（记忆 2026-11-13）。
  if (Number(runtime.orphans) > 0) {
    push({
      code: 'runtime.orphanProcesses',
      category: 'runtime',
      severity: 'warn',
      title: tr('{n} leftover emulator processes found', { n: runtime.orphans }),
      hint: tr('Android processes from a run that did not shut down cleanly still hold resources and the AVD lock, which makes the next start fail. You can clean them up in one click (installed apps and saves are not touched).'),
      fix: 'orphans',
    });
  }

  // 快照空壳：文件在但校验不过，每次开机都要「加载失败再冷启动」，等于白留了几 GB
  if (runtime.snapshotStale) {
    push({
      code: 'runtime.staleSnapshot',
      category: 'runtime',
      severity: 'warn',
      title: tr('The quick-start snapshot is damaged'),
      hint: tr('The snapshot file is still there but fails validation, so every start needs an extra cold start. Deleting it frees disk space at the cost of one cold start.'),
      fix: 'snapshots',
    });
  }

  /* ---------------- 设备连接 ---------------- */

  // unauthorized：安卓弹了「允许 USB 调试吗」但没人点（记忆 2026-11-17 的老坑）
  if (device.state === 'unauthorized') {
    push({
      code: 'device.unauthorized',
      category: 'device',
      severity: 'error',
      title: tr('The Android device has not authorized USB debugging'),
      hint: tr('Android showed an "Allow USB debugging?" prompt that was never confirmed, so adb cannot connect. Restarting the runtime (one cold start) shows the prompt again; once you confirm it, everything recovers.'),
      fix: 'restartRuntime',
    });
  } else if (device.state === 'offline') {
    push({
      code: 'device.offline',
      category: 'device',
      severity: 'warn',
      title: tr('The Android device is offline'),
      hint: tr('adb can see the device but cannot connect, usually because the virtual machine is still booting or the adb service did not finish its handshake. If it does not recover after a short wait, restart the runtime.'),
      fix: 'restartRuntime',
    });
  } else if (runtime.running && device.checked && device.state === 'no-device') {
    push({
      code: 'device.missing',
      category: 'device',
      severity: 'warn',
      title: tr('The runtime is running, but adb cannot see the device'),
      hint: tr('The Android process is alive but adb cannot see the device. Most likely another program is using the adb server port, or boot has not finished yet.'),
      fix: 'restartRuntime',
    });
  }

  /* ---------------- 存储 ---------------- */

  const freeMB = Number(storage.freeMB) || 0;
  if (freeMB > 0 && freeMB < 2048) {
    push({
      code: 'storage.diskCritical',
      category: 'storage',
      severity: 'error',
      title: tr('The disk with the runtime is almost full'),
      hint: tr('Less than 2 GB is free, so installing apps and saving snapshots will fail. Click "Clean up" to reclaim old images, old snapshots and logs.'),
      detail: tr('{mb} MB free', { mb: freeMB }),
      fix: 'disk',
    });
  } else if (freeMB > 0 && freeMB < 8192) {
    push({
      code: 'storage.diskLow',
      category: 'storage',
      severity: 'warn',
      title: tr('The disk with the runtime is getting low on space'),
      hint: tr('Less than 8 GB is free, and snapshots and system images still need space. We suggest cleaning up reclaimable files once.'),
      detail: tr('{mb} MB free', { mb: freeMB }),
      fix: 'disk',
    });
  }

  // 数据分区实际容量比配置小 → 装的游戏会提示「存储空间不足」
  if (storage.needsReset) {
    push({
      code: 'storage.dataNeedsReset',
      category: 'storage',
      severity: 'warn',
      title: tr('The data partition resize did not really take effect'),
      hint: tr('The delta disk used by quick start blocks resizing in place, so Android still sees the old size. You need to "Reset Android data" to rebuild it at the new size (installed apps will be removed).'),
      detail: tr('Configured {configured} GB · actual {actual} GB', { configured: storage.configuredGB, actual: storage.actualGB }),
      fix: 'dataReset',
    });
  } else if (Number(storage.configuredGB) > 0 && Number(storage.actualGB) > 0
    && Number(storage.configuredGB) > Number(storage.actualGB)) {
    push({
      code: 'storage.dataMismatch',
      category: 'storage',
      severity: 'error',
      title: tr('The Android data partition is smaller than configured'),
      hint: tr('The capacity Android really has is smaller than the value in Settings, so installing large games will report not enough storage.'),
      detail: tr('Configured {configured} GB · actual {actual} GB', { configured: storage.configuredGB, actual: storage.actualGB }),
      fix: 'dataReset',
    });
  }

  if (storage.sharedOk === false) {
    push({
      code: 'storage.sharedBroken',
      category: 'storage',
      severity: 'warn',
      title: tr('The shared folder is not available'),
      hint: tr('The folder on this PC used to exchange files does not exist or is not writable, so files saved in Android cannot sync over.'),
      detail: storage.sharedPath || '',
      fix: 'shared',
    });
  }

  /* ---------------- 设置 ---------------- */

  // 方向策略与物理面板打架 → 安卓只给应用中间一条窄画面（记忆 2026-11-18 的老坑）
  const mode = String(settings.orientationMode || 'auto');
  if (mode === 'portrait' && settings.landscape === true) {
    push({
      code: 'settings.orientationConflict',
      category: 'settings',
      severity: 'warn',
      title: tr('The screen orientation policy is opposite to the current panel orientation'),
      hint: tr('The policy asks for portrait but the panel is landscape, so Android gives apps a narrow picture with black bars on both sides. Make the panel orientation match the policy.'),
      fix: 'orientation',
    });
  } else if (mode === 'landscape' && settings.landscape === false) {
    push({
      code: 'settings.orientationConflict',
      category: 'settings',
      severity: 'warn',
      title: tr('The screen orientation policy is opposite to the current panel orientation'),
      hint: tr('The policy asks for landscape but the panel is portrait, so videos and games show as a narrow vertical picture. Make the panel orientation match the policy.'),
      fix: 'orientation',
    });
  }

  if (settings.windowEmbed === false && settings.autoFullscreen) {
    push({
      code: 'settings.detachedFullscreen',
      category: 'settings',
      severity: 'info',
      title: tr('"Fullscreen on start" has no effect in native window mode'),
      hint: tr('In native window mode the emulator opens its own window and decides fullscreen itself, so this switch does not control it. To fill the screen, press F11 in the window, or switch the window hosting mode to embedded.'),
    });
  }

  if (settings.keepSnapshot === false && freeMB > 0 && freeMB < 4096) {
    push({
      code: 'settings.snapshotOffLowDisk',
      category: 'settings',
      severity: 'info',
      title: tr('Disk space is low and the quick-start snapshot is turned off'),
      hint: tr('Less than 4 GB is free and snapshots are off, so opening an app does a full cold start (10 seconds or more). If you have enough disk space, turn snapshots back on.'),
      fix: 'settings',
    });
  }

  /* ---------------- 声音 ---------------- */

  // 0.6.2 新增：用户反馈「有的应用没声音」时，第一反应往往是系统音量问题，
  // 实际上最常见是引擎开关被关掉（-no-audio）或 Windows Audio 服务被停了。
  const audio = o.audio || {};
  if (audio.checked && audio.enabled === false) {
    push({
      code: 'audio.disabled',
      category: 'settings',
      severity: 'warn',
      title: tr('Android app sound is turned off in Settings'),
      hint: tr('The Android sound switch is off, so only apps inside ApkStart West have no sound. Click "Fix" to turn it back on, then restart the runtime once.'),
      fix: 'audio',
    });
  }
  if (audio.checked && audio.serviceRunning === false) {
    push({
      code: 'audio.windowsServiceStopped',
      category: 'settings',
      severity: 'warn',
      title: tr('The Windows audio service (Audiosrv) is not running'),
      hint: tr('This silences other software on the PC too. Start Windows Audio in services.msc and set it to automatic, or run net start Audiosrv in an administrator PowerShell.'),
      fix: 'audioService',
    });
  }
  // 麦克风输入被关掉：语音/通话/录音类应用会拿不到录音设备。
  // 只在明确关掉时才提示（micEnabled===false），探测不到不报，避免误报。
  if (audio.checked && audio.micEnabled === false) {
    push({
      code: 'audio.microphoneDisabled',
      category: 'settings',
      severity: 'warn',
      title: tr('Microphone input is turned off in Settings'),
      hint: tr('Voice, calls and recording in apps will fail (no recording device is found). Click "Fix" to turn it back on and restart the runtime once; also make sure the Windows microphone permission allows desktop apps.'),
      fix: 'microphone',
    });
  }

  /* ---------------- 网络 ---------------- */

  if (network.ok === false) {
    push({
      code: 'network.guestDown',
      category: 'network',
      severity: 'warn',
      title: tr('There is no network inside Android'),
      hint: tr('Android cannot resolve names or connect, so video and news apps keep spinning. Use "Repair network", which resets Android data (your app list is kept).'),
      detail: network.reason || '',
      fix: 'repairNetwork',
    });
  }

  const badSources = Array.isArray(network.sources) ? network.sources.filter((s) => s && s.ok === false) : [];
  if (badSources.length) {
    push({
      code: 'network.sourcesDown',
      category: 'network',
      severity: 'warn',
      title: tr('{n} download sources cannot be reached', { n: badSources.length }),
      hint: tr('Update checks ask several sources at once, so one being down does not matter; if all of them are down, check your network or proxy.'),
      detail: badSources.map((s) => s.name).join(', '),
      fix: 'settings',
    });
  }

  /* ---------------- 日志 ---------------- */

  const errLines = Array.isArray(logs.errors) ? logs.errors.filter(Boolean) : [];
  if (errLines.length) {
    push({
      code: 'logs.errors',
      category: 'logs',
      severity: 'warn',
      title: tr('{n} errors in the runtime log', { n: errLines.length }),
      hint: tr('The latest run left error records; open the diagnostic report to see the full context.'),
      detail: errLines.slice(-1)[0],
      fix: 'report',
    });
  }

  /* ---------------- 加速 ---------------- */

  if (accel.checked && accel.ok === false) {
    push({
      code: 'accel.softwareEmulation',
      category: 'runtime',
      severity: 'warn',
      title: tr('Hardware acceleration is not available'),
      hint: tr('Only pure software emulation is possible: booting takes minutes and frames are easily dropped. Turn on "Windows Hypervisor Platform" and restart.'),
      detail: accel.note || '',
      fix: 'virtualization',
    });
  }

  return dedupe(out);
}

/** 同 code 只留最后一条（后一次检测覆盖前一次） */
function dedupe(issues) {
  const map = new Map();
  for (const raw of issues || []) {
    const it = normalise(raw);
    if (!it) continue;
    map.set(it.code, it);
  }
  return Array.from(map.values());
}

/** 按严重度从高到低排 */
function bySeverity(a, b) {
  const d = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
  if (d) return d;
  return String(a.code).localeCompare(String(b.code));
}

/** 汇总：给状态条计数、给设置页分栏 */
function summarize(issues) {
  const list = dedupe(issues).sort(bySeverity);
  const errors = list.filter((i) => i.severity === 'error').length;
  const warns = list.filter((i) => i.severity === 'warn').length;
  const infos = list.filter((i) => i.severity === 'info').length;
  const byCategory = CATEGORIES.map((c) => {
    const items = list.filter((i) => i.category === c.id);
    return {
      id: c.id,
      name: tr(c.name),
      count: items.length,
      errors: items.filter((i) => i.severity === 'error').length,
    };
  });
  return {
    total: list.length,
    errors,
    warns,
    infos,
    byCategory,
    // 一眼能看出「有没有必须马上处理的问题」
    health: errors ? 'error' : (warns ? 'warn' : (infos ? 'info' : 'ok')),
  };
}

/** 按分类分组，用于设置页分类渲染 */
function groupByCategory(issues) {
  const list = dedupe(issues).sort(bySeverity);
  return CATEGORIES.map((c) => ({
    ...c, name: tr(c.name), hint: tr(c.hint),
    items: list.filter((i) => i.category === c.id),
  })).filter((g) => g.items.length);
}

/**
 * 对比两次检测结果：找出「新出现」和「已消失」的问题。
 * 自动检测只在新问题出现时提醒用户，已消失的只做静默记账 ——
 * 每次都弹「已恢复 3 项」会变成噪音。
 */
function diff(prevIssues, nextIssues) {
  const prev = new Map((prevIssues || []).map((i) => [i.code, i]));
  const next = new Map((nextIssues || []).map((i) => [i.code, i]));
  const added = [];
  const resolved = [];
  for (const [code, it] of next) {
    const before = prev.get(code);
    if (!before || before.severity !== it.severity) added.push(it);
  }
  for (const [code, it] of prev) {
    if (!next.has(code)) resolved.push(it);
  }
  return { added, resolved };
}

module.exports = {
  CATEGORIES,
  CATEGORY_IDS,
  SEVERITY_RANK,
  normalise,
  evaluate,
  dedupe,
  summarize,
  groupByCategory,
  diff,
  bySeverity,
};
