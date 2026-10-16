#!/usr/bin/env node
'use strict';
// 베들레헴 성경 폴더의 .bdb 번역본을 한 번에 가져온다.
//   node tools/import-bethlehem.js "<BethlehemWin 폴더>" [--data <데이터폴더>]
// 저작권 정보는 각 번역본의 권리자 표기이며, 송출(예배당·온라인) 범위는 권리자 이용 조건을 따로 확인해야 한다.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { BibleStore } = require('../src/core/db');
const { analyzeFile, commitImport } = require('../src/core/importer');

const SOURCE = '베들레헴 성경 프로그램 데이터 파일 (사용자 보유분)';
const VERSIONS = [
  { file: '개역한글.bdb', id: 'krv', name: '개역한글', language: 'ko', copyright: '대한성서공회 (저작재산권 보호기간 만료)', license: '공공 영역' },
  { file: '개역개정.bdb', id: 'nkrv', name: '개역개정', language: 'ko', copyright: '© 대한성서공회', license: '대한성서공회 이용 조건에 따름 — 송출 전 허가 확인 필요' },
  { file: '쉬운성경.bdb', id: 'easy', name: '쉬운성경', language: 'ko', copyright: '© 아가페출판사', license: '권리자 이용 조건에 따름 — 송출 전 허가 확인 필요' },
  { file: '우리말.bdb', id: 'woorimal', name: '우리말성경', language: 'ko', copyright: '© 두란노서원', license: '권리자 이용 조건에 따름 — 송출 전 허가 확인 필요' },
  { file: '현대인.bdb', id: 'klb', name: '현대인의성경', language: 'ko', copyright: '© 생명의말씀사', license: '권리자 이용 조건에 따름 — 송출 전 허가 확인 필요' },
  { file: 'ESV.bdb', id: 'esv', name: 'ESV', language: 'en', copyright: '© Crossway', license: 'Crossway 이용 조건에 따름 — 송출 전 허가 확인 필요' },
  { file: 'NIV2011.bdb', id: 'niv2011', name: 'NIV (2011)', language: 'en', copyright: '© Biblica, Inc.', license: 'Biblica 이용 조건에 따름 — 송출 전 허가 확인 필요' },
];

const dir = process.argv[2];
if (!dir) { console.log('사용법: node tools/import-bethlehem.js "<BethlehemWin 폴더>" [--data <데이터폴더>]'); process.exit(2); }
const di = process.argv.indexOf('--data');
const dataDir = di > 0 ? process.argv[di + 1] : path.join(process.env.APPDATA || os.homedir(), 'WorshipCue', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const store = new BibleStore(path.join(dataDir, 'bible.db'));
let failed = 0;
for (const v of VERSIONS) {
  const file = path.join(dir, v.file);
  if (!fs.existsSync(file)) { console.log(`- ${v.name}: 파일 없음 (${v.file}) — 건너뜀`); continue; }
  const a = analyzeFile(file);
  const r = commitImport(store, a, { ...v, source: SOURCE });
  if (r.ok) console.log(`✓ ${v.name} (${v.id}): ${r.stats.verses}절, 표제 ${r.stats.headings}, 각주 ${r.stats.notes}, 경고 ${a.report.warnings.length}`);
  else { failed++; console.log(`✗ ${v.name}: ${r.errors.slice(0, 5).join(' / ')}`); }
}
store.close();
console.log(`\n데이터 폴더: ${dataDir}`);
process.exit(failed ? 1 : 0);
