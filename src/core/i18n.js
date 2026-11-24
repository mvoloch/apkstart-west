'use strict';
/**
 * Interface language for ApkStart West.
 *
 * The English text is both the default and the lookup key:
 *   t('Downloading {name}', { name }) -> "Downloading x" or "Baixando x".
 * Portuguese lives in src/i18n/pt-BR/*.json, flat { "English": "Português" }
 * objects merged at first use. A missing translation shows the English text.
 *
 * Works in the main process and in preloads (sandbox: false), so the same
 * dictionary serves menus, dialogs, notifications and the renderer.
 */
const fs = require('fs');
const path = require('path');

const DICT_DIR = path.join(__dirname, '..', 'i18n');
const SUPPORTED = ['en', 'pt-BR'];

let lang = 'en';
const dicts = Object.create(null);

function normalize(l) {
  return /^pt/i.test(String(l || '')) ? 'pt-BR' : 'en';
}

function loadDict(l) {
  if (dicts[l]) return dicts[l];
  const out = Object.create(null);
  const dir = path.join(DICT_DIR, l);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch (_) { /* no dictionary */ }
  for (const f of files) {
    try { Object.assign(out, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch (_) { /* skip a broken file */ }
  }
  dicts[l] = out;
  return out;
}

function setLang(l) {
  lang = normalize(l);
  return lang;
}

function getLang() {
  return lang;
}

function fill(s, vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

function t(text, vars) {
  const key = String(text == null ? '' : text);
  let out = key;
  if (lang !== 'en') {
    const d = loadDict(lang);
    const v = d[key];
    if (typeof v === 'string' && v) out = v;
  }
  return fill(out, vars);
}

/** The whole dictionary for a language ({} for English). Used by translateDom in the renderer. */
function dictionary(l = lang) {
  const n = normalize(l);
  return n === 'en' ? {} : { ...loadDict(n) };
}

module.exports = {
  t, tr: t, setLang, getLang, dictionary, normalize, fill, SUPPORTED,
  /** tests only */
  _inject(l, obj) { dicts[normalize(l)] = Object.assign(Object.create(null), obj); },
  _reset() { for (const k of Object.keys(dicts)) delete dicts[k]; },
};
