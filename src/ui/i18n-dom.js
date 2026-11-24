'use strict';
/**
 * Renderer side of the ApkStart West i18n layer (see src/core/i18n.js).
 *
 *   tr('Downloading {name}', { name })  -> English, or Portuguese when the UI is pt-BR
 *   translateDom(root)                  -> swaps static text and placeholder/title/alt/aria-label
 *
 * English is the key. Loaded before each page's own script; a MutationObserver
 * also translates nodes added later, so static English written into innerHTML
 * templates is covered too. With the English UI there is nothing to do.
 */
(function () {
  const bridge = window.apkstart || window.apkstartSplash || {};
  const dict = (typeof bridge.dictionary === 'function' && bridge.dictionary()) || {};
  const hasDict = Object.keys(dict).length > 0;
  const fill = (s, vars) => (vars
    ? String(s).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m))
    : String(s));

  function tr(text, vars) {
    const key = String(text == null ? '' : text);
    const v = hasDict ? dict[key] : '';
    return fill(typeof v === 'string' && v ? v : key, vars);
  }

  const ATTRS = ['placeholder', 'title', 'alt', 'aria-label'];
  // Keys are whitespace-collapsed (HTML text often spans indented lines);
  // the node keeps its leading/trailing space so inline layout stays the same.
  function swap(s) {
    const raw = String(s || '');
    const k = raw.replace(/\s+/g, ' ').trim();
    const v = k && dict[k];
    if (!(typeof v === 'string' && v)) return null;
    const lead = /^\s/.test(raw) ? ' ' : '';
    const tail = /\s$/.test(raw) ? ' ' : '';
    return lead + v + tail;
  }

  function translateDom(root) {
    if (!hasDict || !root) return;
    if (root.nodeType === 3) {
      const r = swap(root.nodeValue);
      if (r !== null) root.nodeValue = r;
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentNode && n.parentNode.nodeName;
      if (p === 'SCRIPT' || p === 'STYLE') continue;
      const r = swap(n.nodeValue);
      if (r !== null) n.nodeValue = r;
    }
    const els = root.nodeType === 1 ? [root, ...root.querySelectorAll('*')] : [...root.querySelectorAll('*')];
    for (const el of els) {
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        const r = swap(v);
        if (r !== null) el.setAttribute(a, r);
      }
    }
  }

  function start() {
    if (!hasDict) return;
    translateDom(document.documentElement);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'attributes') {
          const v = m.target.getAttribute(m.attributeName);
          const r = v && swap(v);
          if (r) m.target.setAttribute(m.attributeName, r);
          continue;
        }
        for (const n of m.addedNodes) translateDom(n);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ATTRS });
  }

  window.tr = tr;
  window.translateDom = translateDom;
  window.uiLang = (typeof bridge.lang === 'function' && bridge.lang()) || 'en';
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
