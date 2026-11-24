// i18n layer: English is the key and the default; Portuguese comes from
// src/i18n/pt-BR/*.json. Missing translations fall back to English.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const i18n = require('../src/core/i18n');

console.log('\n[i18n]');

test('English is the default and returns the key unchanged', () => {
  i18n.setLang('en');
  assert.strictEqual(i18n.getLang(), 'en');
  assert.strictEqual(i18n.t('Install'), 'Install');
});

test('pt-BR uses the dictionary', () => {
  i18n._inject('pt-BR', { Install: 'Instalar', 'Downloading {name}': 'Baixando {name}' });
  i18n.setLang('pt-BR');
  assert.strictEqual(i18n.t('Install'), 'Instalar');
});

test('pt-BR falls back to English when a key is missing', () => {
  i18n.setLang('pt-BR');
  assert.strictEqual(i18n.t('Never translated'), 'Never translated');
});

test('placeholders are filled in both languages', () => {
  i18n.setLang('en');
  assert.strictEqual(i18n.t('Downloading {name}', { name: 'x' }), 'Downloading x');
  i18n.setLang('pt-BR');
  assert.strictEqual(i18n.t('Downloading {name}', { name: 'x' }), 'Baixando x');
  assert.strictEqual(i18n.t('Left {alone}', {}), 'Left {alone}', 'unknown placeholder stays');
});

test('language names are normalized; anything unknown is English', () => {
  assert.strictEqual(i18n.setLang('pt'), 'pt-BR');
  assert.strictEqual(i18n.setLang('pt-br'), 'pt-BR');
  assert.strictEqual(i18n.setLang('zh-CN'), 'en');
  assert.strictEqual(i18n.setLang(undefined), 'en');
});

test('every dictionary file parses and has non-empty string values', () => {
  i18n._reset();
  const dir = path.join(__dirname, '..', 'src', 'i18n', 'pt-BR');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const obj = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert(obj && typeof obj === 'object' && !Array.isArray(obj), `${f} must be an object`);
    for (const [k, v] of Object.entries(obj)) {
      assert(typeof v === 'string' && v.trim(), `${f}: empty translation for "${k}"`);
      const want = (k.match(/\{\w+\}/g) || []).sort().join();
      const got = (v.match(/\{\w+\}/g) || []).sort().join();
      assert.strictEqual(got, want, `${f}: placeholders differ for "${k}"`);
    }
  }
});

test('settings default to English UI', () => {
  const storeJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'store.js'), 'utf8');
  assert(/ui:\s*\{\s*language:\s*'en'/.test(storeJs), "store.js must default ui.language to 'en'");
});

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
