#!/usr/bin/env node
'use strict';
/**
 * i18n coverage check for ApkStart West.
 *
 *   node tools/i18n-check.js                 # all of src/
 *   node tools/i18n-check.js src/ui/app.js   # just these files
 *   node tools/i18n-check.js --json          # machine-readable
 *
 * Reports, per file:
 *   cjk      lines with Chinese characters outside comments (should be none,
 *            except strings that must match Chinese text coming from outside,
 *            marked with the comment  i18n-keep  on the same line)
 *   missing  English keys used in the UI that have no pt-BR translation
 *   dynamic  tr(`...${x}...`) calls (use tr('... {x} ...', { x }) instead)
 *
 * Keys come from tr('...')/t('...') literals in .js files and, in .html
 * files, from text nodes and placeholder/title/alt/aria-label attributes.
 * Exit code 1 when anything is reported.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CJK = /[㐀-鿿！-｠　-〿]/;
const args = process.argv.slice(2);
const asJson = args.includes('--json');
let files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  files = execSync('git ls-files src', { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter((f) => /\.(js|html)$/.test(f) && !/manual\.html$/.test(f) && !/manual\.pt-BR\.html$/.test(f));
}

function loadDict() {
  const dir = path.join(ROOT, 'src', 'i18n', 'pt-BR');
  const out = {};
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort() : []) {
    Object.assign(out, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  }
  return out;
}

/** Remove comments but keep line structure (so line numbers stay right). */
function stripJsComments(src) {
  let out = '';
  let i = 0;
  let mode = 'code';
  let quote = '';
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { mode = 'str'; quote = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i++; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i += 2; continue; } if (c === '\n') out += c; i++; continue; }
    if (mode === 'str') {
      out += c;
      if (c === '\\') { out += n || ''; i += 2; continue; }
      if (c === quote) mode = 'code';
      i++; continue;
    }
  }
  return out;
}

function stripHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));
}

function unescapeJs(s) {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|n|t|r|\\|'|"|`)/g, (m, e) => {
    if (e === 'n') return '\n';
    if (e === 't') return '\t';
    if (e === 'r') return '\r';
    if (e[0] === 'u' || e[0] === 'x') return String.fromCodePoint(parseInt(e.replace(/[ux{}]/g, ''), 16));
    return e;
  });
}

function jsKeys(code) {
  const keys = [];
  const dynamic = [];
  const re = /\b(?:tr|t)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = re.exec(code))) {
    const line = code.slice(0, m.index).split('\n').length;
    if (m[1] === '`' && /\$\{/.test(m[2])) { dynamic.push({ line, text: m[2] }); continue; }
    keys.push({ line, key: unescapeJs(m[2]) });
  }
  return { keys, dynamic };
}

function htmlKeys(html) {
  const keys = [];
  const body = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (m) => m.replace(/[^\n]/g, ''));
  const lineOf = (idx) => body.slice(0, idx).split('\n').length;
  const text = /> *([^<>]*[A-Za-z㐀-鿿][^<>]*?) *</g;
  let m;
  while ((m = text.exec(body))) {
    const k = m[1].replace(/\s+/g, ' ').trim();
    if (k && !/^[\d\s.:/%·•—–\-+()]+$/.test(k) && !/^&[a-z]+;$/.test(k)) keys.push({ line: lineOf(m.index), key: k });
  }
  const attr = /\b(placeholder|title|alt|aria-label)="([^"]+)"/g;
  while ((m = attr.exec(body))) keys.push({ line: lineOf(m.index), key: m[2].trim() });
  return keys;
}

const dict = loadDict();
const report = [];
let problems = 0;
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const raw = fs.readFileSync(abs, 'utf8');
  const isHtml = rel.endsWith('.html');
  const code = isHtml ? stripHtmlComments(raw) : stripJsComments(raw);
  const rawLines = raw.split('\n');
  const cjk = [];
  code.split('\n').forEach((l, i) => {
    if (CJK.test(l) && !/i18n-keep/.test(rawLines[i] || '')) cjk.push({ line: i + 1, text: l.trim().slice(0, 140) });
  });
  let keys = [];
  let dynamic = [];
  if (isHtml) keys = htmlKeys(code);
  else ({ keys, dynamic } = jsKeys(code));
  const missing = [];
  const seen = new Set();
  for (const k of keys) {
    if (CJK.test(k.key) || seen.has(k.key)) continue;
    seen.add(k.key);
    if (!/[A-Za-z]/.test(k.key)) continue;
    if (isHtml && /^(ApkStart( West)?|English|Português \(Brasil\)|GitHub|Android|adb|APK)$/.test(k.key)) continue;
    if (!(k.key in dict)) missing.push(k);
  }
  if (cjk.length || missing.length || dynamic.length) {
    problems += cjk.length + missing.length + dynamic.length;
    report.push({ file: rel, cjk, missing, dynamic });
  }
}

if (asJson) {
  console.log(JSON.stringify({ problems, report }, null, 2));
} else {
  for (const r of report) {
    console.log(`\n${r.file}`);
    for (const x of r.cjk) console.log(`  cjk     ${r.file}:${x.line}  ${x.text}`);
    for (const x of r.dynamic) console.log(`  dynamic ${r.file}:${x.line}  ${x.text.slice(0, 120)}`);
    for (const x of r.missing) console.log(`  missing ${r.file}:${x.line}  ${JSON.stringify(x.key).slice(0, 140)}`);
  }
  console.log(`\n${problems ? `${problems} problem(s)` : 'i18n check: clean'} in ${files.length} file(s)`);
}
process.exit(problems ? 1 : 0);
