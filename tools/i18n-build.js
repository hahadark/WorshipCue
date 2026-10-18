#!/usr/bin/env node
'use strict';
// 영어 번역 사전 만들기: i18n/en.json (한국어 → 영어, 자리 {1} {2} …) → src/web/shared/i18n-en.js
//   node tools/i18n-build.js
// i18n/en-*.json 조각이 있으면 en.json 에 합친 뒤 지운다.
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'i18n');
const main = path.join(DIR, 'en.json');
let dict = fs.existsSync(main) ? JSON.parse(fs.readFileSync(main, 'utf8')) : {};
for (const f of fs.readdirSync(DIR).filter(f => /^en-.+\.json$/.test(f)).sort()) {
  Object.assign(dict, JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
  fs.unlinkSync(path.join(DIR, f));
}
dict = Object.fromEntries(Object.entries(dict).sort(([a], [b]) => a.localeCompare(b, 'ko')));
fs.writeFileSync(main, JSON.stringify(dict, null, 1) + '\n');

// 자리 표시가 없는 것은 그대로 찾기, 있는 것은 정규식으로
const strings = {};
const patterns = [];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const [ko, en] of Object.entries(dict)) {
  if (/\{\d\}/.test(ko)) {
    const src = '^' + ko.split(/\{\d\}/).map(esc).join('([\\s\\S]*?)') + '$';
    const order = [...ko.matchAll(/\{(\d)\}/g)].map(m => +m[1]);
    patterns.push([src, en, order]);
  } else strings[ko] = en;
}
// 고정 글이 긴 것부터 (더 구체적인 것이 먼저), 같으면 자리가 적은 것
const lit = src => src.split('([\\s\\S]*?)').join('').length;
patterns.sort((a, b) => lit(b[0]) - lit(a[0]) || a[2].length - b[2].length);
const out = `/* 자동 생성 — 고치지 마세요. 원본: i18n/en.json → node tools/i18n-build.js */
(function (g) { g.BCI18N_EN = ${JSON.stringify({ strings, patterns })}; })(typeof window !== 'undefined' ? window : globalThis);
`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'web', 'shared', 'i18n-en.js'), out);
console.log(`사전: 문구 ${Object.keys(strings).length} · 자리 있는 문구 ${patterns.length} → src/web/shared/i18n-en.js`);
