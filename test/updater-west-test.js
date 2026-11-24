// ApkStart West updater: only asks mvoloch/apkstart-west, and a repository
// with no releases yet means "no update", not an error.
// Network is stubbed at the https module, so this test never goes online.
const assert = require('assert');
const https = require('https');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${String(e.stack || e).split('\n').slice(0, 4).join('\n    ')}`); }
}

const seen = [];
function fakeResponse(status, body, headers = {}) {
  const res = new PassThrough();
  res.statusCode = status;
  res.headers = headers;
  process.nextTick(() => res.end(body || ''));
  return res;
}
// Simulates GitHub for a repository that exists but has no releases yet.
function emptyRepo(url) {
  const u = new URL(url);
  if (u.host === 'api.github.com' && u.pathname.endsWith('/releases/latest')) return fakeResponse(404, '{"message":"Not Found"}');
  if (u.host === 'api.github.com' && u.pathname.endsWith('/releases')) return fakeResponse(200, '[]');
  if (u.host === 'github.com' && u.pathname.endsWith('/releases/latest')) {
    return fakeResponse(302, '', { location: `https://github.com${u.pathname.replace(/\/latest$/, '')}` });
  }
  return fakeResponse(404, '');
}
let handler = emptyRepo;
const realRequest = https.request;
https.request = (url, opts, cb) => {
  const href = typeof url === 'string' ? url : url.href;
  seen.push(href);
  const req = new PassThrough();
  req.end = () => process.nextTick(() => cb(handler(href)));
  req.destroy = () => {};
  return req;
};

const { Sources } = require('../src/core/sources');
const { Updater } = require('../src/core/updater');

(async () => {
  console.log('\n[ApkStart West updater]');

  await test('repository without releases: latest() reports none, no error', async () => {
    seen.length = 0;
    const s = new Sources(() => ({ runtime: {} }));
    const r = await s.latest({ force: true });
    assert.strictEqual(r.none, true, 'expected none:true');
    assert.strictEqual(r.tag, '');
    assert.deepStrictEqual(r.assets, []);
  });

  await test('repository without releases: check() says no update, nothing to apply', async () => {
    seen.length = 0;
    const u = new Updater({
      currentVersion: '0.6.4',
      exePath: path.join(os.tmpdir(), 'apkstart-west-updater-test', 'ApkStart.exe'),
      dataDir: path.join(os.tmpdir(), 'apkstart-west-updater-test'),
      settings: () => ({ runtime: {} }),
    });
    const info = await u.check({ force: true });
    assert.strictEqual(info.hasUpdate, false, 'must not offer an update');
    assert.strictEqual(info.canAutoApply, false, 'must not try to apply anything');
    assert.strictEqual(info.asset, null);
  });

  await test('every update request goes to GitHub, for mvoloch/apkstart-west only', async () => {
    assert(seen.length > 0, 'no request recorded');
    for (const href of seen) {
      const u = new URL(href);
      assert(/^(api\.)?github\.com$/.test(u.host), `unexpected host: ${href}`);
      assert(/\/mvoloch\/apkstart-west\//.test(u.pathname + '/'), `not the West repo: ${href}`);
      assert(!/routinemiku|daily-miku/i.test(href), `upstream asked: ${href}`);
    }
  });

  await test('a newer upstream-style release in the West repo is still offered', async () => {
    handler = (url) => {
      const u = new URL(url);
      if (u.host === 'api.github.com' && u.pathname.endsWith('/releases/latest')) {
        return fakeResponse(200, JSON.stringify({
          tag_name: 'v0.7.0', name: 'v0.7.0', body: '', html_url: 'https://github.com/mvoloch/apkstart-west/releases/tag/v0.7.0',
          assets: [{ name: 'ApkStart-v0.7.0-win64-portable.zip', size: 10, browser_download_url: 'https://github.com/mvoloch/apkstart-west/releases/download/v0.7.0/ApkStart-v0.7.0-win64-portable.zip' }],
        }));
      }
      return emptyRepo(url);
    };
    const u = new Updater({
      currentVersion: '0.6.4',
      exePath: path.join(os.tmpdir(), 'apkstart-west-updater-test', 'ApkStart.exe'),
      dataDir: path.join(os.tmpdir(), 'apkstart-west-updater-test'),
      settings: () => ({ runtime: {} }),
    });
    const info = await u.check({ force: true });
    assert.strictEqual(info.hasUpdate, true);
    assert(/mvoloch\/apkstart-west/.test(info.asset.url), info.asset.url);
  });

  https.request = realRequest;
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
