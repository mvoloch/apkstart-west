'use strict';
/**
 * The emulator must only ever see ApkStart West's own adb (XPS, 2026-11-27).
 *
 * Google's emulator.exe looks for adb in ANDROID_SDK_ROOT and also on PATH. On
 * the XPS the winget platform-tools folder is on PATH, and emulator.log showed
 * the emulator alternating between the runtime's adb and the winget one. Both
 * talk to the same dedicated server port (5044); while their versions match it
 * works, but an adb of another version kills the running server and Android
 * shows up as "offline". So env() puts the runtime's platform-tools first and
 * drops every other PATH folder that holds an adb.exe.
 *
 * Run: node test/adb-path-test.js
 */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EmulatorEngine } = require('../src/core/emulator');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apkstart-adbpath-'));
const root = path.join(tmp, 'runtime');
const ours = path.join(root, 'platform-tools');
const foreign = path.join(tmp, 'winget', 'platform-tools');
const plain = path.join(tmp, 'tools');
for (const d of [ours, foreign, plain]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(ours, 'adb.exe'), '');
fs.writeFileSync(path.join(foreign, 'adb.exe'), '');

const norm = (p) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
const pathKeys = (env) => Object.keys(env).filter((k) => k.toUpperCase() === 'PATH');

const saved = {};
for (const k of Object.keys(process.env)) if (k.toUpperCase() === 'PATH') saved[k] = process.env[k];
try {
  for (const k of Object.keys(saved)) delete process.env[k];
  process.env.Path = [foreign, plain].join(path.delimiter);

  const engine = new EmulatorEngine(path.join(__dirname, '..'));
  const env = engine.env(root);
  const keys = pathKeys(env);
  const dirs = String(env[keys[0]] || '').split(path.delimiter).filter(Boolean).map(norm);

  test('exactly one PATH variable reaches the emulator', () => {
    assert.equal(keys.length, 1, `got ${JSON.stringify(keys)}`);
  });
  test("the runtime's own platform-tools comes first", () => {
    assert.equal(dirs[0], norm(ours));
  });
  test('another folder with an adb.exe is left out', () => {
    assert.ok(!dirs.includes(norm(foreign)), `PATH still has ${foreign}`);
  });
  test('folders without adb stay on PATH', () => {
    assert.ok(dirs.includes(norm(plain)), `PATH lost ${plain}`);
  });
  test('the parent process PATH is not changed', () => {
    assert.equal(process.env.Path, [foreign, plain].join(path.delimiter));
  });

  // The app's own adb calls (restart server, console stop, network checks) used
  // to fall back to a bare "adb" when no adbPath was set, i.e. the PATH one; on
  // the XPS that started the winget adb as the server on port 5044.
  const eng2 = new EmulatorEngine(path.join(__dirname, '..'));
  eng2.provisioner = { paths: () => ({ adbExe: path.join(ours, 'adb.exe') }), adbVersionPath: () => '' };
  eng2.locate = () => ({ root });
  test("the app's own adb calls use the runtime adb, not PATH", () => {
    assert.equal(norm(eng2._ownAdb()), norm(path.join(ours, 'adb.exe')));
  });
  const eng3 = new EmulatorEngine(path.join(__dirname, '..'));
  eng3.provisioner = { paths: () => ({ adbExe: path.join(tmp, 'none', 'adb.exe') }), adbVersionPath: () => '' };
  eng3.locate = () => { throw new Error('no runtime'); };
  test('with no runtime adb it still falls back to PATH', () => {
    assert.equal(eng3._ownAdb(), 'adb');
  });
} finally {
  for (const k of Object.keys(process.env)) if (k.toUpperCase() === 'PATH') delete process.env[k];
  Object.assign(process.env, saved);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nadb-path: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
