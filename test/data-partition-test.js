'use strict';
/**
 * /data partition guards (XPS failure of 2026-11-24: Android never finished its
 * first boot because /data was left at 64 MB, then lost its encrypt flag when a
 * later attempt tried to resize it underneath the emulator's .qcow2 delta disk).
 *
 * Uses the emulator's bundled e2fsprogs, so it is skipped when the runtime is
 * not installed. Run: node test/data-partition-test.js
 */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const userdata = require('../src/core/userdata');
const { EmulatorEngine } = require('../src/core/emulator');

const ENCRYPT = 0x10000;
function incompat(img) {
  const fd = fs.openSync(img, 'r');
  try { const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 1024 + 0x60); return b.readUInt32LE(0); }
  finally { fs.closeSync(fd); }
}
function markErrors(img) {
  const fd = fs.openSync(img, 'r+');
  try { const b = Buffer.alloc(2); b.writeUInt16LE(3, 0); fs.writeSync(fd, b, 0, 2, 1024 + 0x3a); }
  finally { fs.closeSync(fd); }
}

const engine = new EmulatorEngine(path.join(__dirname, '..'));
const exe = engine.locate().emulatorExe;
if (!exe || !fs.existsSync(exe)) {
  console.log('  - skipped: emulator runtime not installed');
  process.exit(0);
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
function freshDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'apkstart-data-')); }
function smallImage(dir) {
  const img = path.join(dir, 'userdata-qemu.img');
  fs.writeFileSync(img, userdata.buildEmptyExt4({ sizeMB: 64, encrypt: true }));
  return img;
}

test('a /data under a .qcow2 delta disk is left untouched', () => {
  const dir = freshDir();
  const img = smallImage(dir);
  fs.writeFileSync(`${img}.qcow2`, 'delta');
  const before = fs.readFileSync(img);
  const r = engine.ensureDataPartition(dir, 1024);
  assert.equal(r.ok, false);
  assert.equal(r.overlay, true);
  assert.ok(fs.readFileSync(img).equals(before), 'base image changed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failed resize puts the encrypt flag back', () => {
  const dir = freshDir();
  const img = smallImage(dir);
  markErrors(img); // resize2fs 1.42 then refuses: "Please run e2fsck -f first"
  const r = engine.ensureDataPartition(dir, 1024);
  assert.equal(r.ok, false);
  assert.ok(incompat(img) & ENCRYPT, 'encrypt flag missing after failed resize');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failed build is retried and ends full size with journal and encrypt flag', () => {
  const dir = freshDir();
  const img = path.join(dir, 'userdata-qemu.img');
  const real = engine._resize2fs;
  let calls = 0;
  engine._resize2fs = function (f) { calls++; if (calls === 1) throw new Error('simulated'); return real.call(this, f); };
  try {
    const r = engine.ensureDataPartition(dir, 1024);
    assert.equal(r.ok, true);
    assert.equal(calls, 2);
    assert.ok(userdata.fsBytes(img) >= 1024 * 1048576 * 0.95, 'filesystem not grown');
    assert.ok(incompat(img) & ENCRYPT, 'encrypt flag missing');
    const fd = fs.openSync(img, 'r'); const b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 1024 + 0x5c); fs.closeSync(fd);
    assert.ok(b.readUInt32LE(0) & 0x4, 'no journal');
  } finally {
    engine._resize2fs = real;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
