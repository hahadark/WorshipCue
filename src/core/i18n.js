'use strict';
// 프로그램(메인 프로세스) 쪽 문구 번역: 대화상자·로딩 화면·오른쪽 클릭 메뉴 등
// 화면 쪽(src/web/shared/i18n.js)과 같은 사전(i18n-en.js)을 쓴다.
const path = require('path');

let dict = null;
const cache = new Map();
function load() {
  if (dict) return dict;
  try { require(path.join(__dirname, '..', 'web', 'shared', 'i18n-en.js')); dict = globalThis.BCI18N_EN; } catch { dict = { strings: {}, patterns: [] }; }
  dict.compiled = dict.patterns.map(([src, en, order]) => ({ re: new RegExp(src), en, order }));
  return dict;
}

/** 한국어 문구 → lang 에 맞는 문구 (영어 사전에 없으면 그대로) */
function t(s, lang) {
  if (lang !== 'en' || !/[가-힣]/.test(String(s ?? ''))) return s;
  const key = String(s);
  if (cache.has(key)) return cache.get(key);
  const d = load();
  let out = Object.prototype.hasOwnProperty.call(d.strings, key) ? d.strings[key] : null;
  if (out == null) {
    for (const p of d.compiled) {
      const m = p.re.exec(key);
      if (m) { out = p.en.replace(/\{(\d)\}/g, (_, k) => sub(m[p.order.indexOf(+k) + 1] ?? '', lang)); break; }
    }
  }
  cache.set(key, out ?? key);
  return out ?? key;
}

/** 자리에 들어간 글도 사전에 있으면 바꾼다 (앞뒤 빈칸은 그대로) */
function sub(v, lang) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(v);
  return /[가-힣]/.test(m[2]) ? m[1] + t(m[2], lang) + m[3] : v;
}

module.exports = { t };
