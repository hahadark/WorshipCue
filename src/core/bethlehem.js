'use strict';
// 베들레헴 성경(https://bethlehembible.org/setup/) 윈도우판의 성경 파일(.bdb) 찾기·가져오기
// 베들레헴은 BethlehemWin 폴더를 드라이브 최상위(C:\BethlehemWin 등)에 두도록 안내한다.
const fs = require('fs');
const path = require('path');

const SOURCE = '베들레헴 성경 (bethlehembible.org) 데이터 파일';

// 알려진 한국어·영어 번역본: 파일 이름 → 번역본 정보
const KNOWN = {
  '개역한글.bdb': { id: 'krv', name: '개역한글', language: 'ko', copyright: '대한성서공회 (저작재산권 보호기간 만료)', license: '공공 영역' },
  '개역개정.bdb': { id: 'nkrv', name: '개역개정', language: 'ko', copyright: '© 대한성서공회', license: '대한성서공회 이용 조건에 따름' },
  '쉬운성경.bdb': { id: 'easy', name: '쉬운성경', language: 'ko', copyright: '© 아가페출판사', license: '권리자 이용 조건에 따름' },
  '우리말.bdb': { id: 'woorimal', name: '우리말성경', language: 'ko', copyright: '© 두란노서원', license: '권리자 이용 조건에 따름' },
  '현대인.bdb': { id: 'klb', name: '현대인의성경', language: 'ko', copyright: '© 생명의말씀사', license: '권리자 이용 조건에 따름' },
  '공동번역.bdb': { id: 'common', name: '공동번역', language: 'ko', copyright: '© 대한성서공회', license: '대한성서공회 이용 조건에 따름' },
  'ESV.bdb': { id: 'esv', name: 'ESV', language: 'en', copyright: '© Crossway', license: 'Crossway 이용 조건에 따름' },
  'NIV2011.bdb': { id: 'niv2011', name: 'NIV (2011)', language: 'en', copyright: '© Biblica, Inc.', license: 'Biblica 이용 조건에 따름' },
  'KJV.bdb': { id: 'kjv', name: 'KJV', language: 'en', copyright: 'Public Domain', license: '공공 영역' },
};

/** 흔한 설치 위치에서 BethlehemWin 폴더 찾기 */
function findDirs(extra = []) {
  const cands = [...extra];
  for (const d of 'CDEFGHIJ') cands.push(`${d}:\\BethlehemWin`, `${d}:\\베들레헴\\BethlehemWin`);
  const home = process.env.USERPROFILE || '';
  if (home) for (const sub of ['Desktop', 'Documents', 'Downloads', '바탕 화면']) cands.push(path.join(home, sub, 'BethlehemWin'));
  const seen = new Set();
  return cands.filter(d => {
    try {
      const k = path.resolve(d).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return fs.statSync(d).isDirectory() && fs.readdirSync(d).some(f => f.toLowerCase().endsWith('.bdb'));
    } catch { return false; }
  });
}

/** 폴더 안의 .bdb 목록 (알려진 번역본 먼저) */
function listBibles(dir) {
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.bdb'));
  return files.map(f => {
    const k = KNOWN[f];
    const base = path.basename(f, '.bdb');
    return {
      file: f, known: !!k,
      id: k ? k.id : base.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'b' + Buffer.from(base).toString('hex').slice(0, 10),
      name: k ? k.name : base, size: fs.statSync(path.join(dir, f)).size,
    };
  }).sort((a, b) => (b.known - a.known) || a.name.localeCompare(b.name, 'ko'));
}

function metaFor(file) {
  const k = KNOWN[file];
  const base = path.basename(file, '.bdb');
  return k ? { ...k, source: SOURCE } : {
    id: base.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'b' + Buffer.from(base).toString('hex').slice(0, 10),
    name: base, language: /[가-힣]/.test(base) ? 'ko' : 'en', copyright: '', license: '베들레헴 성경 데이터 (권리자 이용 조건에 따름)', source: SOURCE,
  };
}

module.exports = { findDirs, listBibles, metaFor, KNOWN, SOURCE };
