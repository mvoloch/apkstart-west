'use strict';
/**
 * ApkStart West guard: no tracked file may point the app (or its build, CI,
 * docs or tests) at a server in mainland China.
 *
 * Fails with file:line for every hit. The only files allowed to mention the
 * blocked hosts are this test and docs/NO-CHINA.md (the audit report).
 *
 * Run: node test/no-china-test.js
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message.split('\n').join('\n    ')}`); }
}

// Host / address patterns that must never appear.
const BLOCKED = [
  [/gitee\.com/i, 'Gitee'],
  [/ghfast\.top/i, 'ghfast GitHub proxy'],
  [/gh-proxy\.com/i, 'gh-proxy GitHub proxy'],
  [/\bmiui\.com/i, 'Xiaomi MIUI'],
  [/douyin\.com/i, 'Douyin'],
  [/\bqq\.com/i, 'Tencent QQ / WeChat'],
  [/npmmirror\.com/i, 'npmmirror (Alibaba)'],
  [/tsinghua\.edu/i, 'Tsinghua mirror'],
  [/\b[a-z0-9-]+(\.[a-z0-9-]+)*\.cn\b(?![-\w])/i, '.cn host'],
  [/fydeos\.com/i, 'FydeOS'],
  [/nchc\.dl\.sourceforge/i, 'NCHC SourceForge mirror'],
  [/\b223\.5\.5\.5\b/, 'Alibaba public DNS'],
  [/\b223\.6\.6\.6\b/, 'Alibaba public DNS'],
  [/\b119\.29\.29\.29\b/, 'Tencent DNSPod'],
  [/\b114\.114\.11[45]\.11[45]\b/, '114DNS'],
  [/\b180\.76\.76\.76\b/, 'Baidu DNS'],
  [/Asia\/Shanghai/, 'China timezone'],
];

// Settings / code paths that existed only to reach Chinese servers.
const DEAD_KEYS = ['giteeToken', 'sourcePreference', 'autoMirror', 'KNOWN_MIRRORS', 'fastDns', 'ensureChineseLocale'];

const ALLOW = new Set(['test/no-china-test.js', 'docs/NO-CHINA.md']);
const TEXT_EXT = /\.(js|mjs|cjs|json|md|txt|html|css|yml|yaml|ps1|sh|py|nsh|xml|ini|cfg|toml)$|(^|\/)\.[a-z]+$|(^|\/)[A-Z]+$/i;

function tracked() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean)
    .filter((f) => !ALLOW.has(f) && !f.startsWith('docs/superpowers/'))
    .filter((f) => TEXT_EXT.test(f))
    .filter((f) => fs.existsSync(path.join(ROOT, f)));
}

test('no tracked file references a host or DNS server in China', () => {
  const hits = [];
  for (const f of tracked()) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const [re, what] of BLOCKED) {
        if (re.test(line)) hits.push(`${f}:${i + 1}  [${what}]  ${line.trim().slice(0, 120)}`);
      }
    });
  }
  assert.equal(hits.length, 0, `${hits.length} reference(s):\n${hits.join('\n')}`);
});

test('src/ no longer carries the China-only settings and code paths', () => {
  const hits = [];
  for (const f of tracked().filter((x) => x.startsWith('src/'))) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const k of DEAD_KEYS) if (line.includes(k)) hits.push(`${f}:${i + 1}  ${k}`);
    });
  }
  assert.equal(hits.length, 0, `${hits.length} leftover(s):\n${hits.join('\n')}`);
});

test('Douyin / WeChat assets and promo material are gone', () => {
  const gone = ['src/ui/assets/douyin-qr.jpg', 'src/ui/assets/wechat-qr.jpg', 'docs/promo'];
  const still = gone.filter((p) => fs.existsSync(path.join(ROOT, p)));
  assert.deepEqual(still, []);
});

test('updater and package metadata point at the West repo, not upstream', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'apkstart-west');
  assert.match(pkg.repository.url, /github\.com\/mvoloch\/apkstart-west/);
  const src = fs.readFileSync(path.join(ROOT, 'src/core/sources.js'), 'utf8');
  assert.match(src, /OWNER_GH\s*=\s*'mvoloch'/);
  assert.match(src, /REPO\s*=\s*'apkstart-west'/);
});

test('emulator: no DNS override, and packet capture only when APKSTART_EMULATOR_TCPDUMP is set', () => {
  const { EmulatorEngine } = require('../src/core/emulator');
  const emu = new EmulatorEngine(ROOT);
  const saved = process.env.APKSTART_EMULATOR_TCPDUMP;
  try {
    delete process.env.APKSTART_EMULATOR_TCPDUMP;
    const plain = emu.buildArgs({ gpu: 'software' });
    assert.ok(!plain.includes('-dns-server'), 'no DNS override');
    assert.ok(!plain.includes('-tcpdump'), 'no capture by default');
    process.env.APKSTART_EMULATOR_TCPDUMP = 'C:\\audit\\run.pcap';
    const audited = emu.buildArgs({ gpu: 'software' });
    assert.equal(audited[audited.indexOf('-tcpdump') + 1], 'C:\\audit\\run.pcap');
  } finally {
    if (saved === undefined) delete process.env.APKSTART_EMULATOR_TCPDUMP;
    else process.env.APKSTART_EMULATOR_TCPDUMP = saved;
  }
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
