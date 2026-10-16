#!/usr/bin/env node
'use strict';
// 성경 데이터 가져오기 도구 (명령줄)
//   node tools/import.js <파일> --id krv --name 개역한글 --license "..." --source "..." [--copyright "..."] [--data <데이터폴더>] [--check]
// --check 를 주면 검증 보고서만 출력하고 DB는 바꾸지 않는다.
const path = require('path');
const os = require('os');
const { BibleStore } = require('../src/core/db');
const { analyzeFile, commitImport } = require('../src/core/importer');

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--check'));
if (!file) {
  console.log('사용법: node tools/import.js <파일.json|csv|xml> --id <ID> --name <이름> --license <사용허가> --source <출처> [--copyright <저작권>] [--data <폴더>] [--check]');
  process.exit(2);
}
const a = analyzeFile(path.resolve(file));
const r = a.report;
console.log(`형식: ${r.format}  인코딩: ${r.encoding}`);
console.log(`구절 ${r.stats.verses ?? 0}  책 ${r.stats.books ?? 0}권  표제 ${r.stats.headings ?? 0}  각주 ${r.stats.notes ?? 0}`);
for (const [t, list] of [['오류', r.errors], ['경고', r.warnings], ['참고', r.notes]]) {
  if (list.length) { console.log(`\n[${t}] ${list.length}건`); for (const x of list) console.log('  - ' + x); }
}
if (args.includes('--check')) process.exit(r.errors.length ? 1 : 0);
const dataDir = opt('data') || path.join(process.env.APPDATA || os.homedir(), 'WorshipCue', 'data');
const store = new BibleStore(path.join(dataDir, 'bible.db'));
const meta = { id: opt('id') || a.meta.identifier, name: opt('name') || a.meta.name, license: opt('license') || a.meta.license, source: opt('source') || a.meta.source, copyright: opt('copyright') || a.meta.copyright, language: opt('language') || a.meta.language || 'ko' };
const c = commitImport(store, a, meta);
store.close();
if (!c.ok) { console.error('\n가져오기 실패 (기존 데이터는 변경되지 않았습니다):'); for (const e of c.errors) console.error('  - ' + e); process.exit(1); }
console.log(`\n완료: ${meta.name} (${meta.id}) ${c.stats.verses}절 → ${path.join(dataDir, 'bible.db')}`);
