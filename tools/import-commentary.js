#!/usr/bin/env node
'use strict';
// 주석서 EPUB 가져오기 (명령줄)
//   node tools/import-commentary.js <파일.epub> --id ivp-bg --name "IVP 성경배경주석" [--license "..."] [--source "..."] [--data <폴더>] [--check]
const path = require('path');
const os = require('os');
const { BibleStore } = require('../src/core/db');
const { analyzeEpub } = require('../src/core/commentary');

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const file = args[0];
if (!file || file.startsWith('--')) { console.log('사용법: node tools/import-commentary.js <파일.epub> --id <ID> --name <이름> [--data <폴더>] [--check]'); process.exit(2); }
const r = analyzeEpub(path.resolve(file));
console.log(`제목: ${r.title}  절 표시 ${r.marks}개 → 주석 항목 ${r.entries.length}, 상자 글 ${r.articles.length}`);
console.log(r.stats.map(s => `${s.name} ${s.entries}(${s.chapters}/${s.of}장)`).join(' · '));
const weak = r.stats.filter(s => s.chapters / s.of < 0.6);
if (weak.length) console.log('\n[범위가 적거나 없는 책] ' + weak.map(s => s.name).join(', '));
if (args.includes('--check')) process.exit(0);
const dataDir = opt('data') || path.join(process.env.APPDATA || os.homedir(), 'WorshipCue', 'data');
const store = new BibleStore(path.join(dataDir, 'bible.db'));
const meta = { id: opt('id') || 'commentary', name: opt('name') || r.title || '주석', license: opt('license') || '개인 소장본 (조작 화면 참고용, 송출하지 않음)', source: opt('source') || path.basename(file) };
store.replaceCommentary(meta, r.entries, r.articles);
store.close();
console.log(`\n완료: ${meta.name} (${meta.id}) → ${path.join(dataDir, 'bible.db')}`);
