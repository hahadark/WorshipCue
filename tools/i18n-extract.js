#!/usr/bin/env node
'use strict';
// 화면 문구 모으기: 소스의 문자열·템플릿에서 한국어가 든 화면 글(태그 사이 글 · title/placeholder 등)을 뽑는다.
//   node tools/i18n-extract.js            → 번역 사전(src/web/shared/i18n-en.js)에 없는 문구 목록 (tools/i18n-missing.json)
//   node tools/i18n-extract.js --all      → 모든 문구 (tools/i18n-all.json)
// 템플릿의 ${…} 는 \u0001 로 바꿔 둔다 (번역에서는 {1} {2} … 로 같은 순서). 주석·로그·정규식은 건너뛴다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = [
  ...['src/web/control', 'src/web/output', 'src/web/remote', 'src/web/shared', 'src/web/splash'].flatMap(d => fs.readdirSync(path.join(ROOT, d)).filter(f => /\.(js|html)$/.test(f) && !/^i18n/.test(f)).map(f => path.join(d, f))),
  ...fs.readdirSync(path.join(ROOT, 'src/core')).filter(f => f.endsWith('.js') && !['books.js'].includes(f)).map(f => path.join('src/core', f)),
  'src/main/main.js',
];
const HANGUL = /[가-힣]/;
const PH = '\u0001';

/** JS 소스 → 문자열 조각들 [{ kind: 'str'|'tpl', raw }] (주석·정규식 제외) */
function scanJs(src, out, from = 0, stopAtBrace = false) {
  let i = from, depth = 0, lastSig = '';
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i = src.indexOf('*/', i + 2); if (i < 0) return n; i += 2; continue; }
    if (c === '/' && (lastSig === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(lastSig) || /\b(return|typeof|case|of|in)$/.test(lastSig))) {
      // 정규식 리터럴
      i++; let cls = false;
      while (i < n) { const d = src[i]; if (d === '\\') { i += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; i++; }
      i++; while (/[a-z]/i.test(src[i] || '')) i++;
      lastSig = 'x'; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < n && src[j] !== c) { if (src[j] === '\\') { s += unesc(src[j + 1]); j += 2; continue; } if (src[j] === '\n') break; s += src[j]; j++; }
      out.push({ kind: 'str', raw: s, ctx: src.slice(Math.max(0, i - 40), i) });
      i = j + 1; lastSig = 'x'; continue;
    }
    if (c === '`') {
      let j = i + 1, raw = '';
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') { raw += unesc(src[j + 1]); j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') { raw += PH; j = scanJs(src, out, j + 2, true); continue; }
        raw += src[j]; j++;
      }
      out.push({ kind: 'tpl', raw, ctx: src.slice(Math.max(0, i - 40), i) });
      i = j + 1; lastSig = 'x'; continue;
    }
    if (stopAtBrace) {
      if (c === '{') depth++;
      else if (c === '}') { if (depth === 0) return i + 1; depth--; }
    }
    if (!/\s/.test(c)) lastSig = (lastSig + c).slice(-8);
    i++;
  }
  return i;
}
function unesc(ch) { return ({ n: '\n', t: '\t', r: '', '\\': '\\', "'": "'", '"': '"', '`': '`', $: '$' })[ch] ?? ch; }

const ENT = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#10;': '\n' };
const decode = s => s.replace(/&(nbsp|amp|lt|gt|quot|#39|#10);/g, m => ENT[m]);
/** 화면 글 단위로: 태그 사이 글 + 화면에 보이는 속성 */
function units(raw) {
  const res = [];
  const parts = raw.split(/(<\/?[a-zA-Z][^<>]*>)/);
  for (const p of parts) {
    if (/^<\/?[a-zA-Z]/.test(p)) {
      for (const m of p.matchAll(/\b(title|placeholder|aria-label|alt|data-tip)="([^"]*)"/g)) push(res, decode(m[2]));
      continue;
    }
    push(res, decode(p));
  }
  return res;
}
function push(res, t) {
  // 줄마다 (화면에서도 줄바꿈은 같은 글 안이지만, 짧은 단위가 맞추기 쉽다) — 통째로도 넣는다
  const s = t.replace(/[ \t]+/g, ' ').trim();
  if (!HANGUL.test(s)) return;
  res.push(s);
}

const all = new Map(); // ko → { files:Set }
for (const f of FILES) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const frags = [];
  if (f.endsWith('.html')) {
    frags.push({ kind: 'tpl', ctx: '', raw: src.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '') });
    for (const m of src.matchAll(/<script>([\s\S]*?)<\/script>/g)) scanJs(m[1], frags);
  } else scanJs(src, frags);
  for (const fr of frags) {
    if (/(logger|console)\.\w+\($/.test(fr.ctx.trimEnd()) || /\.(warn|error|info|log)\($/.test(fr.ctx.trimEnd())) continue;
    if (/new RegExp\($|\.test\($|\.match\($|\.replace\($|\.split\($/.test(fr.ctx.trimEnd()) && fr.raw.length < 40) continue;
    for (const u of units(fr.raw)) {
      if (!all.has(u)) all.set(u, new Set());
      all.get(u).add(f.replace(/\\/g, '/'));
    }
  }
}
let dict = {};
try { global.window = global; require(path.join(ROOT, 'src/web/shared/i18n-en.js')); dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/en.json'), 'utf8')); } catch { /* 아직 없음 */ }
const keyOf = s => { let k = 0; return s.replace(//g, () => '{' + (++k) + '}'); };
const rows = [...all.entries()].map(([ko, fs2]) => ({ ko: keyOf(ko), files: [...fs2] }));
const missing = rows.filter(r => !(r.ko in dict));
const outFile = process.argv.includes('--all') ? 'i18n-all.json' : 'i18n-missing.json';
fs.writeFileSync(path.join(__dirname, outFile), JSON.stringify((process.argv.includes('--all') ? rows : missing).map(r => r.ko), null, 1));
console.log(`문구 ${rows.length}개 · 번역 없음 ${missing.length}개 → tools/${outFile}`);
