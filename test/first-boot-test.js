'use strict';
/**
 * First boot on fresh data: the app must not cut it short or knock out adb
 * while Android is still turning adb on (the XPS failure of 2026-11-24, where
 * adb stayed "offline" for good after the first boot was force-killed).
 *
 * Run: node test/first-boot-test.js
 */
const assert = require('assert/strict');
const { firstBootTimeout } = require('../src/core/emulator');
const { shouldHealAdb } = require('../src/core/engine');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

test('first boot waits at least 10 minutes; later boots keep their own limit', () => {
  assert.equal(firstBootTimeout(240000, true), 600000);
  assert.equal(firstBootTimeout(900000, true), 900000);
  assert.equal(firstBootTimeout(240000, false), 240000);
});

test('adb is not restarted while the device is listed as offline (still booting)', () => {
  assert.equal(shouldHealAdb({ errStreak: 10, sinceStart: 60000, sinceHeal: 60000, state: 'offline' }), false);
  assert.equal(shouldHealAdb({ errStreak: 10, sinceStart: 200000, sinceHeal: 200000, state: 'offline' }), false);
});

test('offline for over 5 minutes may restart adb, at most every 2 minutes', () => {
  assert.equal(shouldHealAdb({ errStreak: 10, sinceStart: 310000, sinceHeal: 310000, state: 'offline' }), true);
  assert.equal(shouldHealAdb({ errStreak: 10, sinceStart: 400000, sinceHeal: 60000, state: 'offline' }), false);
});

test('device missing from adb keeps the original 25 s / 30 s rule', () => {
  assert.equal(shouldHealAdb({ errStreak: 6, sinceStart: 26000, sinceHeal: 31000, state: 'no-device' }), true);
  assert.equal(shouldHealAdb({ errStreak: 5, sinceStart: 26000, sinceHeal: 31000, state: 'no-device' }), false);
  assert.equal(shouldHealAdb({ errStreak: 6, sinceStart: 20000, sinceHeal: 31000, state: '' }), false);
});

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
