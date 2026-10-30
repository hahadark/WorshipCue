'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { parseReference } = require('../src/core/parser');
const { WorshipCueCore } = require('../src/core/core');
const { startServer } = require('../src/core/server');
const { analyzeFile } = require('../src/core/importer');
const { makeFixture } = require('./fixture');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worshipcue-test-'));
const fixtureFile = path.join(tmp, 'fixture.json');
fs.writeFileSync(fixtureFile, JSON.stringify(makeFixture()));

function newCore(name) {
  const core = new WorshipCueCore({ dataDir: path.join(tmp, name) });
  const a = core.command('analyzeImport', { path: fixtureFile });
  assert.equal(a.ok, true);
  assert.deepEqual(a.result.report.errors, []);
  const c = core.command('commitImport', { token: a.result.token, meta: a.result.meta });
  assert.equal(c.ok, true, c.error);
  return core;
}

// ---------------- FR-01 장절 파서 ----------------
test('장절 파서: 사양서 입력 형식', () => {
  const cases = [
    ['요3:16', 43, [{ sc: 3, sv: 16, ec: 3, ev: 16 }]],
    ['요한복음 3:16', 43, [{ sc: 3, sv: 16, ec: 3, ev: 16 }]],
    ['요 3장 16절', 43, [{ sc: 3, sv: 16, ec: 3, ev: 16 }]],
    ['요한복음 3장 16절', 43, [{ sc: 3, sv: 16, ec: 3, ev: 16 }]],
    ['행5:27-32', 44, [{ sc: 5, sv: 27, ec: 5, ev: 32 }]],
    ['롬 8', 45, [{ sc: 8, sv: null, ec: 8, ev: null }]],
    ['창1:1-2:3', 1, [{ sc: 1, sv: 1, ec: 2, ev: 3 }]],
    ['롬8:1,28', 45, [{ sc: 8, sv: 1, ec: 8, ev: 1 }, { sc: 8, sv: 28, ec: 8, ev: 28 }]],
    ['요일 4:8', 62, [{ sc: 4, sv: 8, ec: 4, ev: 8 }]],
    ['요한1서 4:8', 62, [{ sc: 4, sv: 8, ec: 4, ev: 8 }]],
    ['유 3', 65, [{ sc: 1, sv: 3, ec: 1, ev: 3 }]],
    ['1 John 4:8', 62, [{ sc: 4, sv: 8, ec: 4, ev: 8 }]],
    ['롬8：18～25', 45, [{ sc: 8, sv: 18, ec: 8, ev: 25 }]],
    ['요3.16', 43, [{ sc: 3, sv: 16, ec: 3, ev: 16 }]],
    ['고전13장4-7절', 46, [{ sc: 13, sv: 4, ec: 13, ev: 7 }]],
    // 띄어쓰기로 장·절 구분
    ['요 3 16', 43, [{ sc: 3, sv: 16, ec: 3, ev: 16 }]],
    ['요3 16', 43, [{ sc: 3, sv: 16, ec: 3, ev: 16 }]],
    ['행 5 27-32', 44, [{ sc: 5, sv: 27, ec: 5, ev: 32 }]],
    ['행 5 27 - 32', 44, [{ sc: 5, sv: 27, ec: 5, ev: 32 }]],
    ['롬 8 18 25', 45, [{ sc: 8, sv: 18, ec: 8, ev: 25 }]],
    ['창 1 1 2 3', 1, [{ sc: 1, sv: 1, ec: 2, ev: 3 }]],
    ['요한복음 3 16', 43, [{ sc: 3, sv: 16, ec: 3, ev: 16 }]],
    ['요일 4 8', 62, [{ sc: 4, sv: 8, ec: 4, ev: 8 }]],
    // 하이픈 범위
    ['요 3 16-4 2', 43, [{ sc: 3, sv: 16, ec: 4, ev: 2 }]],
    ['요 3:16 - 18', 43, [{ sc: 3, sv: 16, ec: 3, ev: 18 }]],
    ['요 3 16 ~ 18', 43, [{ sc: 3, sv: 16, ec: 3, ev: 18 }]],
    ['요3장16절-18절', 43, [{ sc: 3, sv: 16, ec: 3, ev: 18 }]],
    ['요3장16절-4장2절', 43, [{ sc: 3, sv: 16, ec: 4, ev: 2 }]],
    ['롬 8-9', 45, [{ sc: 8, sv: null, ec: 9, ev: null }]],
  ];
  for (const [input, book, ranges] of cases) {
    const r = parseReference(input);
    assert.equal(r.ok, true, `${input}: ${r.error}`);
    assert.equal(r.book.id, book, input);
    assert.deepEqual(r.ranges, ranges, input);
  }
});

test('장절 파서: 중의적 약어는 후보만 제시', () => {
  const r = parseReference('요한 3:16');
  assert.equal(r.ok, false);
  assert.equal(r.ambiguous, true);
  assert.ok(r.candidates.map(b => b.name).includes('요한복음'));
  assert.ok(r.candidates.map(b => b.name).includes('요한계시록'));
  const s = parseReference('사무엘 3:1');
  assert.equal(s.ambiguous, true);
});

test('장절 파서: 잘못된 입력', () => {
  assert.equal(parseReference('없는책 3:16').ok, false);
  assert.equal(parseReference('요3:16-10').ok, false);
  assert.equal(parseReference('롬').incomplete, true);
});

// ---------------- DB 검색 ----------------
test('T01/T02/T03 장절 검색과 오류', () => {
  const core = newCore('t01');
  const r = core.command('searchReference', { query: '행5:27-32' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.passage.verses.map(v => v.verse), [27, 28, 29, 30, 31, 32]);
  assert.equal(r.result.passage.title, '사도행전 5:27-32');

  const r2 = core.command('searchReference', { query: '요한복음 3장 16절' });
  assert.equal(r2.result.passage.verses[0].text, '하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니');

  const cross = core.command('searchReference', { query: '창1:39-2:2' });
  assert.deepEqual(cross.result.passage.verses.map(v => `${v.chapter}:${v.verse}`), ['1:39', '1:40', '2:1', '2:2']);

  const whole = core.command('searchReference', { query: '롬 8' });
  assert.equal(whole.result.passage.verses.length, 40);

  const bad = core.command('searchReference', { query: '요3:99' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /40절까지/);
  const bad2 = core.command('searchReference', { query: '요 30:1' });
  assert.match(bad2.error, /21장까지/);
  core.store.close();
});

test('T04 본문 키워드 검색 (짧은 단어·여러 단어·띄어쓰기 무시)', () => {
  const core = newCore('t04');
  let r = core.command('searchText', { query: '사랑' });
  assert.ok(r.result.results.some(x => x.ref === '요한복음 3:16'));
  r = core.command('searchText', { query: '하나님 순종' });
  assert.deepEqual(r.result.results.map(x => x.ref), ['사도행전 5:29']);
  r = core.command('searchText', { query: '세상을이처럼' });
  assert.deepEqual(r.result.results.map(x => x.ref), ['요한복음 3:16']);
  r = core.command('searchText', { query: '"합력하여 선을"' });
  assert.deepEqual(r.result.results.map(x => x.ref), ['로마서 8:28']);
  core.store.close();
});

test('다음/이전 절은 장을 넘고 책 경계에서 멈춘다', () => {
  const core = newCore('adj');
  assert.equal(core.command('adjacentVerse', { book: 45, chapter: 8, verse: 40, dir: 1 }).result.passage.title, '로마서 9:1');
  assert.equal(core.command('adjacentVerse', { book: 45, chapter: 9, verse: 1, dir: -1 }).result.passage.title, '로마서 8:40');
  assert.equal(core.command('adjacentVerse', { book: 66, chapter: 22, verse: 40, dir: 1 }).ok, false);
  assert.equal(core.command('adjacentVerse', { book: 1, chapter: 1, verse: 1, dir: -1 }).ok, false);
  core.store.close();
});

// ---------------- Preview / Live ----------------
const slide = (ref, verse) => ({ ref, parts: [{ book: 43, chapter: 3, verse, text: `본문 ${verse}` }] });

test('T06 미리보기 변경은 Live 를 바꾸지 않는다 / T08 T09 숨김·복원', () => {
  const core = newCore('live');
  core.command('setPreview', { passage: { title: '요 3:16' }, slides: [slide('요 3:16', 16)] });
  core.command('sendLive', {});
  const v1 = core.presentation.version;
  core.command('setPreview', { passage: { title: '롬 8:1' }, slides: [slide('롬 8:1', 1)] });
  core.command('searchReference', { query: '롬8:1' });
  core.command('searchReference', { query: '없는책1:1' });
  assert.equal(core.presentation.version, v1);
  assert.equal(core.command('getLiveState').result.slide.ref, '요 3:16');

  core.command('toggleLive');
  assert.equal(core.command('getLiveState').result.visible, false);
  assert.equal(core.command('getLiveState').result.slide.ref, '요 3:16'); // 숨겨도 본문 유지
  core.command('toggleLive');
  const s = core.command('getLiveState').result;
  assert.equal(s.visible, true);
  assert.equal(s.slide.ref, '요 3:16');
  assert.equal(core.settings.get().history[0].title, '요 3:16');
  core.store.close();
});

test('T05 슬라이드 이동은 범위 밖으로 나가지 않는다', () => {
  const core = newCore('nav');
  core.command('sendLive', { passage: { title: 'x' }, slides: [slide('a', 18), slide('b', 19), slide('c', 20)] });
  assert.equal(core.command('previousSlide').ok, false);
  assert.equal(core.command('nextSlide').result.state.slide.ref, 'b');
  assert.equal(core.command('nextSlide').result.state.slide.ref, 'c');
  const end = core.command('nextSlide');
  assert.equal(end.ok, false);
  assert.equal(end.reason, 'end');
  assert.equal(core.command('getLiveState').result.slide.ref, 'c');
  core.store.close();
});

test('연속 탐색 모드: 범위 끝에서 extend 요청', () => {
  const core = newCore('cont');
  core.command('updateSettings', { patch: { navMode: 'continuous' } });
  let req = null;
  core.on('extend-request', d => { req = d; });
  core.command('sendLive', { passage: { title: 'x' }, slides: [slide('a', 18)] });
  core.command('nextSlide');
  assert.equal(req.dir, 1);
  const r = core.command('extendLive', { dir: 1, slides: [slide('b', 19)], passage: { title: 'y' }, expectVersion: req.version });
  assert.equal(r.result.state.slide.ref, 'b');
  // 낡은 요청은 거부
  const stale = core.command('extendLive', { dir: 1, slides: [slide('c', 20)], passage: { title: 'z' }, expectVersion: req.version });
  assert.equal(stale.ok, false);
  core.store.close();
});

test('단축키 중복·글자키 단독 등록 방지', () => {
  const core = newCore('keys');
  assert.equal(core.command('setShortcuts', { shortcuts: { nextSlide: 'F5' } }).ok, false);
  assert.equal(core.command('setShortcuts', { shortcuts: { nextSlide: 'K' } }).ok, false);
  assert.equal(core.command('setShortcuts', { shortcuts: { nextSlide: 'Ctrl+ArrowRight' } }).ok, true);
  core.store.close();
});

test('가져오기 실패 시 기존 데이터 유지 / CSV·Zefania 형식', () => {
  const core = newCore('imp');
  const bad = path.join(tmp, 'bad.csv');
  fs.writeFileSync(bad, 'book,chapter,verse,text\n창,1,1,태초에\n창,1,1,중복\n없는책,1,1,x\n');
  const a = core.command('analyzeImport', { path: bad });
  assert.ok(a.result.report.errors.some(e => e.includes('중복')));
  assert.ok(a.result.report.errors.some(e => e.includes('없는책')));
  const c = core.command('commitImport', { token: a.result.token, meta: { id: 'test', name: 'x', license: 'x', source: 'x' } });
  assert.equal(c.ok, false);
  assert.equal(core.store.listVersions()[0].verse_count > 40000, true);
  assert.equal(core.command('searchReference', { query: '요3:16' }).ok, true);

  const xml = path.join(tmp, 'z.xml');
  fs.writeFileSync(xml, `<?xml version="1.0" encoding="utf-8"?><XMLBIBLE biblename="샘플"><INFORMATION><title>샘플역</title><rights>PD</rights></INFORMATION>
  <BIBLEBOOK bnumber="1"><CHAPTER cnumber="1"><CAPTION>천지 창조</CAPTION><VERS vnumber="1">태초에 <NOTE>각주</NOTE>하나님이</VERS><VERS vnumber="2">땅이 &amp; 혼돈</VERS></CHAPTER></BIBLEBOOK></XMLBIBLE>`);
  const z = analyzeFile(xml);
  assert.equal(z.report.format, 'Zefania XML');
  assert.equal(z.data.verses[0].text, '태초에 하나님이');
  assert.equal(z.data.verses[1].text, '땅이 & 혼돈');
  assert.equal(z.data.headings[0].text, '천지 창조');
  assert.equal(z.data.notes[0].text, '각주');
  assert.equal(z.meta.name, '샘플역');

  const euc = path.join(tmp, 'euc.csv');
  fs.writeFileSync(euc, Buffer.from(new TextEncoder().encode('x'))); // 자리만
  const csv = path.join(tmp, 'ok.csv');
  fs.writeFileSync(csv, '﻿book,chapter,verse,text\n창세기,1,1,"태초에, 하나님이"\n창,1,2,<b>땅이</b> 혼돈하고\n');
  const r = analyzeFile(csv);
  assert.deepEqual(r.data.verses.map(v => v.text), ['태초에, 하나님이', '땅이 혼돈하고']);
  core.store.close();
});

test('베들레헴 .bdb: 표제·각주 분리, 본문 없는 절 제외', () => {
  const { DatabaseSync } = require('node:sqlite');
  const file = path.join(tmp, 'sample.bdb');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE "Bible" ("id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL UNIQUE, "book" INTEGER, "chapter" INTEGER, "verse" INTEGER, "btext" VARCHAR)');
  const ins = db.prepare('INSERT INTO Bible (book, chapter, verse, btext) VALUES (?, ?, ?, ?)');
  ins.run(1, 1, 1, '<세계의 시작> 태초에 하나님께서 하늘과 땅을 창조하셨습니다.');
  ins.run(1, 1, 2, 'the earth* was formless,[a] and empty. / *Or land / **Or void');
  ins.run(1, 1, 3, '* / *Some manuscripts include here words.');
  ins.run(19, 3, 1, '[다윗이 그 아들 압살롬을 피할 때에 지은 시] 여호와여');
  db.close();
  const a = analyzeFile(file);
  assert.equal(a.report.format, '베들레헴 성경 (.bdb)');
  assert.deepEqual(a.report.errors.filter(e => !e.includes('장 누락')), []);
  const v = Object.fromEntries(a.data.verses.map(x => [`${x.book}:${x.chapter}:${x.verse}`, x.text]));
  assert.equal(v['1:1:1'], '태초에 하나님께서 하늘과 땅을 창조하셨습니다.');
  assert.equal(v['1:1:2'], 'the earth was formless, and empty.');
  assert.equal(v['1:1:3'], undefined); // 각주만 있는 절은 제외
  assert.equal(v['19:3:1'], '[다윗이 그 아들 압살롬을 피할 때에 지은 시] 여호와여'); // 시편 표제는 본문 유지
  assert.deepEqual(a.data.headings.map(h => h.text), ['세계의 시작']);
  assert.deepEqual(a.data.notes.map(n => n.text), ['Or land', 'Or void', 'Some manuscripts include here words.']);
});

test('기본 성경 DB: 빈 데이터 폴더에만 복사, 기존 데이터는 보존', () => {
  const seedCore = newCore('seedsrc');
  seedCore.store.close();
  const seed = path.join(tmp, 'seedsrc', 'bible.db');
  const fresh = new WorshipCueCore({ dataDir: path.join(tmp, 'fresh'), seedDb: seed });
  assert.deepEqual(fresh.store.listVersions().map(v => v.id), ['test']);
  assert.equal(fresh.settings.get().versionId, 'test');
  assert.equal(fresh.command('searchReference', { query: '요3:16' }).ok, true);
  fresh.store.deleteVersion('test');
  fresh.store.replaceVersion({ id: 'mine', name: '내 번역본', license: 'x', source: 'x' }, [{ book: 1, chapter: 1, verse: 1, text: '태초에' }]);
  fresh.store.close();
  const again = new WorshipCueCore({ dataDir: path.join(tmp, 'fresh'), seedDb: seed });
  assert.deepEqual(again.store.listVersions().map(v => v.id), ['mine']); // 덮어쓰지 않음
  again.store.close();
});

test('주석: 절 표시로 항목을 나누고 범위로 찾는다', () => {
  const { parseCommentary } = require('../src/core/commentary');
  const blocks = [{ type: 'h', text: '창세기' }];
  // 창세기 1~3장 (장마다 표시 여러 개), 중간에 다른 책 참조 "출 3:14" 는 무시
  for (let c = 1; c <= 3; c++) for (let v = 1; v <= 6; v++) blocks.push({ type: 'p', text: `${c}:${v} 표제${c}-${v}. 창세기 ${c}장 ${v}절 해설입니다. 출 3:14 참조.` });
  blocks.push({ type: 'h', text: '출애굽기' });
  for (let c = 1; c <= 3; c++) for (let v = 1; v <= 6; v++) blocks.push({ type: 'p', text: `${c}:${v} 제목${v}. 출애굽기 ${c}장 ${v}절 해설.` });
  const r = parseCommentary(blocks);
  const gen = r.entries.filter(e => e.book === 1);
  const exo = r.entries.filter(e => e.book === 2);
  assert.equal(gen.length, 18);
  assert.equal(exo.length, 18);
  assert.equal(gen[0].title, '표제1-1');
  assert.match(exo[7].text, /출애굽기 2장 2절/);

  const core = newCore('cm');
  core.store.replaceCommentary({ id: 'c1', name: '테스트 주석' }, r.entries, []);
  const hits = core.command('commentaryFor', { book: 2, sc: 2, sv: 2, ec: 2, ev: 3 }).result;
  assert.deepEqual(hits.map(h => `${h.sc}:${h.sv}`), ['2:2', '2:3']);
  assert.equal(core.getState().commentaries[0].entry_count, 36);
  core.store.close();
});

test('큐시트: 만들기·저장·복제·삭제와 항목 검증', () => {
  const core = newCore('cue');
  const created = core.command('newCue', { name: '주일 성결예배' });
  assert.equal(created.ok, true, created.error);
  assert.ok(created.result.items.length >= 5); // 기본 순서
  const c = created.result;
  c.items.push({ type: 'song', title: '주 하나님 지으신 모든 세계', lyrics: '[1절]\n주 하나님 지으신 모든 세계\n\n[후렴]\n주님의 높고 위대하심을' });
  const saved = core.command('saveCue', { cue: c });
  assert.equal(saved.ok, true);
  assert.equal(saved.result.items.at(-1).type, 'song');
  assert.equal(core.command('saveCue', { cue: { ...c, items: [{ type: 'bible', title: 'x', ref: '' }] } }).ok, true); // 바로 고치기: 빈 장절도 저장 (미리보기 때 안내)
  core.command('saveCue', { cue: saved.result }); // 원래대로
  assert.equal(core.command('saveCue', { cue: { ...c, items: [{ type: 'nope' }] } }).ok, false); // 알 수 없는 종류
  const dup = core.command('duplicateCue', { id: c.id });
  assert.notEqual(dup.result.id, c.id);
  assert.equal(dup.result.items.length, saved.result.items.length);
  assert.notEqual(dup.result.items[0].id, saved.result.items[0].id);
  assert.equal(core.command('listCues').result.length, 2);
  core.command('deleteCue', { id: dup.result.id });
  assert.equal(core.command('listCues').result.length, 1);
  assert.equal(core.settings.get().activeCueId, ''); // 열어 둔(복제본) 큐시트를 지우면 비움
  core.store.close();
});

test('큐시트 송출: 항목 끝에서 다음 순서 요청, 제목·이미지 슬라이드', () => {
  const core = newCore('cuelive');
  let req = null;
  core.on('cue-next', d => { req = d; });
  const title = { kind: 'title', ref: '대표기도', subtitle: '홍길동 집사', parts: [] };
  const r = core.command('sendLive', { passage: { title: '대표기도', cueId: 'c123', cueIndex: 2, itemTitle: '대표기도' }, slides: [title] });
  assert.equal(r.ok, true, r.error);
  const live = core.command('getLiveState').result;
  assert.equal(live.slide.kind, 'title');
  assert.equal(live.slide.subtitle, '홍길동 집사');
  assert.equal(live.passage.cueIndex, 2);
  core.command('nextSlide'); // 마지막 슬라이드에서 F6
  assert.deepEqual({ dir: req.dir, cueId: req.cueId, index: req.index }, { dir: 1, cueId: 'c123', index: 2 });
  // 자동 진행을 끄면 요청하지 않음
  req = null;
  core.command('updateSettings', { patch: { cueAdvance: false } });
  core.command('nextSlide');
  assert.equal(req, null);
  // 본문 없는 성경 슬라이드는 거부, 이미지·빈 화면은 허용
  assert.equal(core.command('sendLive', { passage: { title: 'x' }, slides: [{ kind: 'bible', parts: [] }] }).ok, false);
  assert.equal(core.command('sendLive', { passage: { title: 'x' }, slides: [{ kind: 'image', image: '/media/a.png', parts: [] }, { kind: 'blank', parts: [] }] }).ok, true);
  core.store.close();
});

test('찬송가 폴더: .pps 에서 배경·악보·교독문 글자 꺼내기', { skip: !fs.existsSync('D:/OneDrive - The Salvation Army Korea Territory/자료실/새찬송가및 구세군찬송가/새찬송가') && '찬송가 폴더 없음' }, async () => {
  const root = 'D:/OneDrive - The Salvation Army Korea Territory/자료실/새찬송가및 구세군찬송가/';
  const core = newCore('hymn');
  assert.equal((await core.command('loadHymn', { file: root + '새찬송가/010 전능왕 오셔서.pps' })).ok, false); // 등록 안 한 폴더
  const add = core.command('addHymnFolder', { path: root + '새찬송가' });
  assert.equal(add.ok, true, add.error);
  assert.ok(add.result.count > 600);
  core.command('addHymnFolder', { path: root + '교독문' });
  const byNum = core.command('searchHymns', { query: '10' }).result;
  assert.equal(byNum[0].number, 10);
  assert.equal(byNum[0].title, '전능왕 오셔서');
  const byTitle = core.command('searchHymns', { query: '전능왕' }).result;
  assert.ok(byTitle.some(h => h.number === 10));
  const h = await core.command('loadHymn', { file: byNum[0].file });
  assert.equal(h.ok, true, h.error);
  assert.match(h.result.background, /^\/hymn\/[0-9a-f]{16}\/bg\.png$/);
  assert.equal(h.result.scores.length, 8);
  assert.ok(fs.existsSync(core.hymns.cachePath(h.result.key, 'score-01.png')));
  const gyo = core.command('searchHymns', { query: '시편 23' }).result.find(x => x.folder === '교독문');
  const g = (await core.command('loadHymn', { file: gyo.file })).result;
  assert.equal(g.scores.length, 0);
  assert.match(g.texts[0].join(' '), /여호와는 나의 목자/);
  // 읽는 방식 '화면 그대로' (PowerPoint 가 있을 때만)
  if (await require('../src/core/pptrender').hasPowerPoint()) {
    core.command('setHymnFolderRender', { path: path.resolve(root + '새찬송가'), render: 'slides' });
    const sl = await core.command('loadHymn', { file: byNum[0].file });
    assert.equal(sl.ok, true, sl.error);
    assert.equal(sl.result.mode, 'slides');
    assert.ok(sl.result.slides.length >= 8);
    assert.ok(sl.result.aspect > 1.2 && sl.result.aspect < 1.4, `4:3 슬라이드 비율: ${sl.result.aspect}`);
    assert.ok(fs.existsSync(core.hymns.cachePath(sl.result.key, 'slide-001.png')));
  }
  core.store.close();
});

test('전환·PPT 표시: 예전 템플릿 값 바꾸기, 새찬송가 가사 나누기', async () => {
  const { normalizeTemplate } = require('../src/core/templates');
  assert.equal(normalizeTemplate({ animation: { type: 'fade', duration: 300 } }).animation.type, 'dissolve');
  assert.equal(normalizeTemplate({ animation: { type: 'none' } }).animation.type, 'cut');
  assert.equal(normalizeTemplate({ pptMode: 'x' }).pptMode, '');
  const { alignLyrics, parseHtext } = require('../src/core/hymnlyrics');
  const lyr = parseHtext("<b>1</b>. 가 나 다 라 마 바 사 아 <br><br><small><font color='#0099CC'>[후렴]</font></small> 후 렴 하 나<br><br><b>2</b>. 자 차 카 타 파 하 거 너<br><br><b>3</b>. 더 러 머 버 서 어 저 처<br>");
  assert.deepEqual(lyr.verses.length, 3);
  assert.equal(lyr.chorus, '후 렴 하 나');
  // 1절(2장) 후렴(1장) 2절(2장) 3절(2장) 후렴(1장) = 8장
  const c = alignLyrics(lyr, 8);
  assert.equal(c.length, 8);
  assert.match(c[2], /후/); assert.match(c[7], /후/);
  assert.match(c[3], /자/); assert.match(c[5], /더/);
  // 실제 새찬송가 31장 (베들레헴·찬송가 폴더가 있을 때만)
  const root = 'D:/OneDrive - The Salvation Army Korea Territory/자료실/새찬송가및 구세군찬송가/';
  const core = newCore('lyrics');
  if (core.hymnLyrics.status().found && fs.existsSync(root + '새찬송가')) {
    core.command('addHymnFolder', { path: root + '새찬송가' });
    const h = (await core.command('loadHymn', { file: root + '새찬송가/031 찬양하라 복되신 구세주 예수.pps' })).result;
    assert.equal(h.captions.length, 11);
    assert.match(h.captionSource, /새찬송가 가사 DB/);
    assert.match(h.captions[3], /높으신 권세/); // 후렴
    assert.match(h.captions[4], /우리 대신/);   // 2절
  }
  core.store.close();
});

test('라이브러리: 찬양 저장·검색, 큐시트 연결, 음악·배경·순서별 템플릿 항목', () => {
  const core = newCore('library');
  const a = core.command('saveSong', { song: { title: '은혜 아니면', lyrics: '[1절]\n어두운 밤 마음에 잠겨\n\n[후렴]\n은혜 아니면' } });
  assert.equal(a.ok, true, a.error);
  core.command('saveSong', { song: { title: '나는 예배자입니다', lyrics: '나는 예배자입니다' } });
  assert.equal(core.command('saveSong', { song: { title: ' ' } }).ok, false);
  const found = core.command('listSongs', { query: '마음에잠겨' }).result;
  assert.equal(found.length, 1);
  assert.equal(found[0].first, '어두운 밤 마음에 잠겨');
  const upd = core.command('saveSong', { song: { ...core.command('getSong', { id: a.result.id }).result, lyrics: '고친 가사' } });
  assert.equal(upd.result.id, a.result.id);
  assert.equal(core.command('getSong', { id: a.result.id }).result.lyrics, '고친 가사');
  // 큐시트 항목: 찬양 연결 · 음악 · 배경 · 순서별 템플릿
  const c = core.command('saveCue', { cue: { name: '라이브러리', items: [
    { type: 'song', title: '은혜 아니면', songId: a.result.id, lyrics: '고친 가사', bg: '/lib/file?p=x.png', tplMain: 'reading' },
    { type: 'audio', title: '배경음악', file: '/lib/file?p=a.mp3', volume: 0.5, loop: true },
  ] } });
  assert.equal(c.ok, true, c.error);
  const [song, aud] = c.result.items;
  assert.equal(song.songId, a.result.id);
  assert.equal(song.bg, '/lib/file?p=x.png');
  assert.equal(song.tplMain, 'reading');
  assert.equal(aud.type, 'audio');
  assert.equal(aud.volume, 0.5);
  assert.equal(aud.loop, true);
  assert.equal(aud.fadeOnLeave, true);
  assert.equal(core.command('deleteSong', { id: a.result.id }).ok, true);
  assert.equal(core.command('getSong', { id: a.result.id }).ok, false);
  core.store.close();
});

test('라이브러리: 이미지·음악 폴더와 파일 제공(구간 요청), 오버레이, 순서별 템플릿 송출', async () => {
  const core = newCore('libfiles');
  const img = path.join(tmp, 'libimg'), aud = path.join(tmp, 'libaud');
  fs.mkdirSync(path.join(img, 'sub'), { recursive: true }); fs.mkdirSync(aud);
  fs.writeFileSync(path.join(img, '배경 1.png'), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(path.join(img, 'sub', '로고.jpg'), 'x');
  fs.writeFileSync(path.join(img, 'memo.txt'), 'x');
  fs.writeFileSync(path.join(aud, '전주.mp3'), Buffer.alloc(1000, 7));
  assert.equal(core.command('addLibFolder', { kind: 'audio', path: img }).ok, false); // 음악 없음
  assert.equal(core.command('addLibFolder', { kind: 'image', path: img }).result.count, 2);
  assert.equal(core.command('addLibFolder', { kind: 'audio', path: aud }).ok, true);
  const imgs = core.command('searchLibFiles', { kind: 'image', query: '' }).result;
  assert.deepEqual(imgs.map(f => f.name).sort(), ['로고', '배경 1']);
  const mp3 = core.command('searchLibFiles', { kind: 'audio', query: '전주' }).result[0];
  assert.match(mp3.url, /^\/lib\/file\?p=/);
  // 등록 폴더 밖·다른 확장자는 거부
  assert.equal(core.library.resolveFile(path.join(img, 'memo.txt')), null);
  assert.equal(core.library.resolveFile(path.join(tmp, 'fixture.json')), null);
  // 서버: 전체 / 구간
  const port = 38000 + Math.floor(Math.random() * 1000);
  const srv = await startServer(core, { webDir: path.join(__dirname, '..', 'src', 'web'), port });
  const full = await get(port, mp3.url);
  assert.equal(full.status, 200);
  const part = await new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: mp3.url, headers: { Range: 'bytes=100-199' } }, r => {
    let n = 0; r.on('data', c => n += c.length); r.on('end', () => res({ status: r.statusCode, n, range: r.headers['content-range'] }));
  }).on('error', rej));
  assert.deepEqual(part, { status: 206, n: 100, range: 'bytes 100-199/1000' });
  assert.equal((await get(port, '/lib/file?p=' + encodeURIComponent(path.join(tmp, 'fixture.json')))).status, 404);
  // 오버레이: 만들기 → 켜기 → 출력 데이터에 포함 (보일 출력만)
  const o = core.command('saveOverlay', { overlay: { type: 'countdown', target: '5', outputs: ['main'] } }).result;
  assert.equal(o.on, false);
  assert.deepEqual(core.outputPayload('main').overlays, []);
  const on = core.command('toggleOverlay', { id: o.id, on: true }).result;
  assert.ok(on.startedAt > 0);
  assert.equal(core.outputPayload('main').overlays.length, 1);
  assert.equal(core.outputPayload('overlay').overlays.length, 0);
  assert.equal(core.command('saveOverlay', { overlay: { type: 'nope' } }).ok, false);
  // 순서별 템플릿: 송출한 본문에 tpl 이 있으면 그 템플릿으로
  const slide = { kind: 'title', ref: '설교', parts: [] };
  core.command('sendLive', { passage: { title: '설교', tpl: { main: 'reading', overlay: '' } }, slides: [slide], index: 0 });
  assert.equal(core.outputPayload('main').template.id, 'reading');
  assert.equal(core.outputPayload('overlay').template.id, core.settings.get().activeTemplates.overlay);
  core.command('sendLive', { passage: { title: '설교' }, slides: [slide], index: 0 });
  assert.equal(core.outputPayload('main').template.id, core.settings.get().activeTemplates.main);
  await srv.close();
  core.store.close();
});

test('영상 재생 순서: 재생 상태, 일시정지·처음부터, 끝나면 다음 순서', () => {
  const core = newCore('video');
  const vslide = { kind: 'video', image: '/lib/file?p=a.mp4', ref: '광고 영상', parts: [], video: { volume: 0.8, sound: true, loop: false, endAction: 'next' } };
  core.command('sendLive', { passage: { title: '광고 영상', cueId: 'c1', cueIndex: 2 }, slides: [vslide], index: 0 });
  const v1 = core.outputPayload('main').video;
  assert.equal(v1.playing, true);
  assert.equal(core.outputPayload('main').slide.video.endAction, 'next');
  // 숨김·복원은 처음부터 다시 재생하지 않는다
  core.command('toggleLive'); core.command('toggleLive');
  assert.equal(core.outputPayload('main').video.key, v1.key);
  assert.equal(core.command('videoControl', { action: 'pause' }).result.playing, false);
  assert.equal(core.command('videoControl', { action: 'seek', time: 12 }).result.offset, 12);
  const r = core.command('videoControl', { action: 'restart' }).result;
  assert.deepEqual([r.playing, r.offset], [true, 0]);
  assert.equal(core.command('videoControl', { action: 'nope' }).ok, false);
  // 끝 알림: 키가 맞을 때 한 번만, 다음 순서 요청
  let next = null;
  core.on('cue-next', d => { next = d; });
  assert.equal(core.command('videoEnded', { key: 'wrong' }).result.done, false);
  assert.equal(core.command('videoEnded', { key: v1.key, duration: 30 }).result.done, true);
  assert.equal(core.command('videoEnded', { key: v1.key }).result.done, false);
  assert.deepEqual(next && [next.dir, next.cueId, next.index], [1, 'c1', 2]);
  // 영상이 아닌 슬라이드면 재생 상태 없음
  core.command('sendLive', { passage: { title: 'x' }, slides: [{ kind: 'title', ref: 'x', parts: [] }], index: 0 });
  assert.equal(core.outputPayload('main').video, null);
  assert.equal(core.command('videoControl', { action: 'play' }).ok, false);
  // 큐시트 '영상' 항목
  const c = core.command('saveCue', { cue: { name: 'v', items: [{ type: 'video', title: '광고', file: '/lib/file?p=a.mp4', endAction: 'black', loop: true }] } });
  assert.deepEqual([c.result.items[0].type, c.result.items[0].endAction, c.result.items[0].loop, c.result.items[0].sound], ['video', 'black', true, true]);
  core.store.close();
});

test('무대 화면: 지금·다음 슬라이드, 순서 메모, 타이머, 메시지', () => {
  const core = newCore('stage');
  const sl = n => ({ kind: 'text', ref: '광고', label: String(n), parts: [{ book: 0, chapter: 0, verse: 0, text: '광고 ' + n }] });
  core.command('sendLive', { passage: { title: '광고', itemTitle: '교회소식', cueId: 'c', cueIndex: 3, note: '사회자' }, slides: [sl(1), sl(2)], index: 0 });
  let p = core.stagePayload();
  assert.equal(p.title, '교회소식');
  assert.equal(p.note, '사회자');
  assert.equal(p.slide.parts[0].text, '광고 1');
  assert.equal(p.nextSlide.parts[0].text, '광고 2');
  assert.equal(core.command('stageTimer', { action: 'start', minutes: 0 }).ok, false);
  const t = core.command('stageTimer', { action: 'start', minutes: 30 }).result;
  assert.equal(t.running, true);
  assert.ok(t.remaining > 29 * 60000);
  const paused = core.command('stageTimer', { action: 'pause' }).result;
  assert.equal(paused.running, false);
  const added = core.command('stageTimer', { action: 'add', minutes: 5 }).result;
  assert.ok(added.remaining > 34 * 60000);
  assert.equal(core.command('stageTimer', { action: 'reset' }).result.duration, 0);
  assert.equal(core.command('stageMessage', { text: '5분 남았습니다' }).result.message, '5분 남았습니다');
  assert.equal(core.stagePayload().message, '5분 남았습니다');
  assert.equal(core.getState().stage.message, '5분 남았습니다');
  core.store.close();
});

test('화면 지우기: 배경 숨김·로고 화면·오버레이 끄기/다시 켜기·모두 지우기', () => {
  const core = newCore('layers');
  const o1 = core.command('saveOverlay', { overlay: { type: 'clock', on: true } }).result;
  core.command('saveOverlay', { overlay: { type: 'banner', text: '공지', on: false } });
  core.command('sendLive', { passage: { title: 'x' }, slides: [{ kind: 'title', ref: 'x', parts: [] }], index: 0 });
  assert.equal(core.command('toggleBackground').result.hideBg, true);
  assert.equal(core.outputPayload('main').layers.hideBg, true);
  assert.equal(core.command('toggleBackground').result.hideBg, false);
  const lg = core.command('toggleLogoScreen').result;
  assert.equal(lg.logo, true);
  assert.match(lg.logoImage, /sa-shield|png|jpg/);
  core.command('toggleLogoScreen');
  // 오버레이 끄기 → 켜져 있던 것만 다시 켜기
  assert.equal(core.command('toggleOverlaysOff').result.overlaysOff, true);
  assert.equal(core.outputPayload('main').overlays.length, 0);
  assert.equal(core.command('toggleOverlaysOff').result.overlaysOff, false);
  assert.deepEqual(core.outputPayload('main').overlays.map(o => o.id), [o1.id]);
  // 모두 지우기
  const all = core.command('clearAll').result;
  assert.equal(all.hideBg, true);
  assert.equal(core.outputPayload('main').visible, false);
  assert.equal(core.outputPayload('main').overlays.length, 0);
  core.store.close();
});

test('찬양 부를 순서(편곡): 이름표 묶음, 줄임말(1·C·B), 없는 이름 알림, 라이브러리 기본 순서', () => {
  global.window = global; window.BCRender = window.BCRender || {};
  require('../src/web/shared/slides.js');
  const SL = window.BCSlides;
  const ch = SL.lyricsChunks('[1절]\n가\n\n나\n\n[2절]\n다\n\n[후렴]\n라\n\n[브릿지]\n마');
  assert.deepEqual(SL.lyricGroups(ch).map(g => [g.label, g.chunks.length]), [['1절', 2], ['2절', 1], ['후렴', 1], ['브릿지', 1]]);
  const txt = r => r.chunks.map(c => c.text).join('');
  assert.equal(txt(SL.arrange(ch, '1절 후렴 2절 후렴 후렴')), '가나라다라라');
  assert.equal(txt(SL.arrange(ch, '1 C 2 C B C')), '가나라다라마라');
  assert.deepEqual(SL.arrange(ch, '1 x 후렴').missing, ['x']);
  assert.equal(txt(SL.arrange(ch, '')), '가나다라마');
  const core = newCore('arr');
  const s = core.command('saveSong', { song: { title: '편곡', lyrics: '[1절]\n가', arrangement: '1 1' } }).result;
  assert.equal(core.command('getSong', { id: s.id }).result.arrangement, '1 1');
  const c = core.command('saveCue', { cue: { name: 'a', items: [{ type: 'song', title: 'x', lyrics: 'a', order: '1 C' }] } });
  assert.equal(c.result.items[0].order, '1 C');
  core.store.close();
});

test('휴대폰 리모컨: PIN 확인·잠금, 다음·숨김·메시지, 순서 송출 요청', async () => {
  const core = newCore('remote');
  const rport = 39000 + Math.floor(Math.random() * 500);
  core.settings.update(d => { d.remote = { enabled: false, pin: '', port: rport }; });
  const port = 38500 + Math.floor(Math.random() * 400);
  const srv = await startServer(core, { webDir: path.join(__dirname, '..', 'src', 'web'), port });
  try {
    const st = await core.command('setRemote', { enabled: true });
    assert.equal(st.ok, true, st.error);
    assert.equal(st.result.running, true);
    assert.match(st.result.pin, /^\d{6}$/);
    const pin = st.result.pin;
    const rget = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: rport, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d })); }).on('error', rej));
    const rpost = body => new Promise((res, rej) => {
      const data = JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port: rport, path: '/r/do', method: 'POST', headers: { 'Content-Type': 'application/json' } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: JSON.parse(d) })); });
      req.on('error', rej); req.end(data);
    });
    assert.equal((await rget('/')).status, 200);
    assert.equal((await rget('/r/state?pin=000000')).status, 401);
    const ok = await rget('/r/state?pin=' + pin);
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).live.has, false);
    // 조작 서버의 다른 기능은 리모컨 주소로 쓸 수 없다
    assert.equal((await rget('/api/state')).status, 404);
    const sl = n => ({ kind: 'text', ref: 'x', label: String(n), parts: [{ book: 0, chapter: 0, verse: 0, text: 't' + n }] });
    core.command('sendLive', { passage: { title: 'x' }, slides: [sl(1), sl(2)], index: 0 });
    assert.equal((await rpost({ pin, action: 'next' })).body.ok, true);
    assert.equal(core.presentation.getLiveState().index, 1);
    await rpost({ pin, action: 'toggle' });
    assert.equal(core.presentation.getLiveState().visible, false);
    await rpost({ pin, action: 'message', text: '5분' });
    assert.equal(core.stage.message, '5분');
    // 조작 화면이 없으면 순서 송출은 안 됨
    assert.equal((await rpost({ pin, action: 'cue', index: 0 })).body.ok, false);
    assert.equal((await rpost({ pin: 'x', action: 'next' })).status, 401);
    // 5번 틀리면 잠시 잠금
    for (let i = 0; i < 4; i++) await rget('/r/state?pin=1');
    assert.equal((await rget('/r/state?pin=' + pin)).status, 429);
    await core.command('setRemote', { enabled: false });
    assert.equal(core.remote.status().running, false);
  } finally {
    await srv.close();
    core.store.close();
  }
});

test('예배 진행 시계: 큐시트 시작 시각·순서 예정 시간 저장, 복제에도 유지', () => {
  const core = newCore('sched');
  const c = core.command('saveCue', { cue: { name: '주일', startTime: '11:00', items: [{ type: 'title', title: '묵도', duration: 2 }, { type: 'title', title: '설교', duration: 35 }, { type: 'title', title: 'x', duration: -5 }] } });
  assert.equal(c.ok, true, c.error);
  const g = core.command('getCue', { id: c.result.id }).result;
  assert.equal(g.startTime, '11:00');
  assert.deepEqual(g.items.map(i => i.duration), [2, 35, 0]);
  assert.equal(core.command('saveCue', { cue: { name: 'y', startTime: '25시', items: [] } }).result.startTime, '');
  const d = core.command('duplicateCue', { id: c.result.id }).result;
  assert.equal(core.command('getCue', { id: d.id }).result.startTime, '11:00');
  core.store.close();
});

test('AI 주보 → 큐시트: 한글 주보 글자, AI 요청 형식, 찬송가·장절 확인, 키 저장', async () => {
  const { readBulletin, parseJson, planToCue } = require('../src/core/bulletin');
  const hwp = 'C:/Users/Administrator/Downloads/20261011.hwp';
  if (fs.existsSync(hwp)) {
    const t = readBulletin(fs.readFileSync(hwp), '20261011.hwp').text;
    assert.match(t, /주일성결예배/);
    assert.match(t, /마태복음 6:9-13/);
  }
  assert.equal(readBulletin(Buffer.from('예배 순서'), 'a.txt').text, '예배 순서');
  assert.equal(readBulletin(Buffer.from([1, 2]), 'a.pdf').file.mime, 'application/pdf');
  assert.throws(() => readBulletin(Buffer.from('x'), 'a.exe'));
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('결과입니다: {"a":2} 끝'), { a: 2 });
  // 찬송가를 못 찾으면 제목 순서 + 경고
  const p = planToCue({ name: 'x', items: [{ type: 'hymn', title: '찬송', hymnNumber: 999 }, { type: 'bible', title: '성경봉독', ref: '마 6:9-13' }, { type: 'text', title: '광고', body: 'a\n---\nb' }] },
    { resolveHymn: () => null, checkRef: () => '마태복음 6:9-13' });
  assert.deepEqual(p.cue.items.map(i => i.type), ['title', 'bible', 'text']);
  assert.equal(p.warnings.length, 1);
  // 코어: 가짜 AI 응답으로 전체 흐름
  const core = newCore('ai');
  assert.equal((await core.command('aiMakeCue', { text: '주보' })).ok, false); // 키 없음
  core.command('setAi', { apiKey: 'sk-or-test', model: 'anthropic/claude-haiku-5.5' });
  assert.equal(core.command('aiSettings').result.hasKey, true);
  assert.equal(core.aiKey(), 'sk-or-test');
  let sent = null;
  core.aiFetch = async (url, opt) => {
    sent = { url, body: JSON.parse(opt.body), auth: opt.headers.Authorization };
    const plan = { name: '2026-10-11 주일성결예배', serviceDate: '2026-10-11', startTime: '11:00', items: [
      { type: 'title', title: '묵도', subtitle: '사회자' },
      { type: 'bible', title: '성경봉독', ref: '요 3:16' },
      { type: 'title', title: '설교', subtitle: '“주기도문 8” · 차재수 사관' },
      { type: 'blank', title: '예배 후' }] };
    return { ok: true, status: 200, json: async () => ({ model: 'anthropic/claude-haiku-5.5', usage: { cost: 0.0012 }, choices: [{ message: { content: JSON.stringify(plan) } }] }) };
  };
  const r = await core.command('aiMakeCue', { text: '주보 내용', extra: '오전 예배' });
  assert.equal(r.ok, true, r.error);
  assert.equal(sent.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(sent.auth, 'Bearer sk-or-test');
  assert.equal(sent.body.model, 'anthropic/claude-haiku-5.5');
  assert.match(JSON.stringify(sent.body.messages), /주보 내용/);
  assert.match(JSON.stringify(sent.body.messages), /오전 예배/);
  assert.equal(r.result.cue.name, '2026-10-11 주일성결예배');
  assert.equal(r.result.cue.startTime, '11:00');
  assert.deepEqual(r.result.cue.items.map(i => i.type), ['title', 'bible', 'title', 'blank']);
  assert.equal(core.settings.get().activeCueId, r.result.cue.id);
  core.command('setAi', { apiKey: '' });
  assert.equal(core.command('aiSettings').result.hasKey, false);
  core.store.close();
});

test('작업공간: 저장·이름 정리·지금 작업공간', () => {
  const core = newCore('ws');
  const r = core.command('saveWorkspaces', { list: [{ id: 'bad id!', name: '  수요예배  ', layout: '{"v":2}' }, { name: '빈 배치', layout: '' }, { name: 'x'.repeat(80), layout: '{}' }], active: 'b-live' });
  assert.equal(r.ok, true);
  const ws = r.result.workspaces;
  assert.equal(ws.length, 2); // 배치가 빈 것은 버린다
  assert.equal(ws[0].name, '수요예배');
  assert.match(ws[0].id, /^[a-z0-9-]+$/i);
  assert.equal(ws[1].name.length, 40);
  assert.equal(core.settings.get().activeWorkspace, 'b-live');
  core.command('setActiveWorkspace', { id: ws[0].id });
  assert.equal(core.settings.get().activeWorkspace, ws[0].id);
  assert.equal(core.settings.get().workspaces.length, 2);
});

test('슬라이드 편집: 정리·합치기·큐시트 저장·송출 슬라이드에 유지', () => {
  const { normalizeEdits, mergeEdit, normalizeEdit } = require('../src/core/slideedit');
  const e = normalizeEdits({
    '*': { style: { size: 90, color: '#ffcc00', align: 'left', bogus: 1 }, box: { x: 5, y: 60, w: 90, h: 30 } },
    '2': { style: { color: 'red' }, items: [{ type: 'text', text: '후렴', x: 5, y: 5, w: 20, h: 10 }, { type: 'evil' }], hideMain: true, bg: '#112233' },
    'x': { box: { x: 1 } }, '3': {},
  });
  assert.deepEqual(Object.keys(e).sort(), ['*', '2']); // 이상한 키·빈 편집은 버림
  assert.equal(e['*'].style.bogus, undefined);
  assert.equal(e['2'].style, undefined); // 'red' 는 색이 아님
  assert.equal(e['2'].items.length, 1);
  assert.equal(e['2'].items[0].align, 'center');
  const m = mergeEdit(e, 2);
  assert.equal(m.style.size, 90);
  assert.equal(m.box.y, 60);
  assert.equal(m.hideMain, true);
  assert.equal(mergeEdit(e, 7).style.color, '#ffcc00');
  assert.equal(normalizeEdit({}), null);
  // 큐시트 항목에 저장
  const core = newCore('slideedit');
  const cue = core.command('saveCue', { cue: { name: '편집', items: [{ type: 'song', title: '곡', lyrics: '가\n\n나', edits: e }, { type: 'image', title: '그림', edits: e }] } }).result;
  const got = core.command('getCue', { id: cue.id }).result;
  assert.equal(got.items[0].edits['2'].items[0].text, '후렴');
  assert.equal(got.items[1].edits['2'].hideMain, true); // 그림 순서도 꾸미기 저장
  // 송출 슬라이드에 편집·덩어리 번호 유지
  const r = core.command('sendLive', { passage: { title: '곡' }, slides: [{ kind: 'text', ref: '', src: 1, edit: mergeEdit(e, 1), parts: [{ text: '나' }] }] });
  assert.equal(r.ok, true);
  const live = core.presentation.live.slides[0];
  assert.equal(live.src, 1);
  assert.equal(live.edit.style.size, 90);
});

test('채팅 AI (키 없이): 프롬프트·샘플, 붙여 넣은 답 → 큐시트', () => {
  const core = newCore('chatai');
  const p = core.command('chatAiPrompt', { extra: '오후 예배로' }).result;
  assert.match(p.prompt, /WorshipCue-큐시트-샘플\.json/);
  assert.match(p.prompt, /규칙:/);
  assert.match(p.prompt, /추가 요청: 오후 예배로/);
  const sample = JSON.parse(p.sample);
  assert.ok(sample.items.length > 5);
  // 샘플 그대로는 거절
  const same = core.command('chatAiImport', { text: p.sample });
  assert.equal(same.ok, false);
  assert.match(same.error, /샘플/);
  // 설명 + 코드 블록이 섞인 채팅 답
  const plan = { name: '2026-10-25 주일 예배', serviceDate: '2026-10-25', startTime: '11:00', items: [
    { type: 'title', title: '묵도' },
    { type: 'hymn', title: '찬송', hymnNumber: 21, hymnbook: '새찬송가' },
    { type: 'bible', title: '성경봉독', ref: '요 3:16' },
    { type: 'text', title: '광고', body: '첫째\n---\n둘째' },
    { type: 'blank', title: '예배 후' },
  ] };
  const answer = '주보를 읽고 큐시트를 만들었습니다.\n\n```json\n' + JSON.stringify(plan, null, 2) + '\n```\n\n확인할 부분: 찬송 번호';
  const r = core.command('chatAiImport', { text: answer });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.cue.name, '2026-10-25 주일 예배');
  assert.equal(r.result.cue.items.length, 5);
  assert.equal(r.result.cue.items[2].type, 'bible');
  // 찬송가 PPT 폴더가 없으니: 베들레헴 가사가 있으면 가사 슬라이드로, 없으면 확인 경고
  const h21 = r.result.cue.items[1];
  if (h21.type === 'song') assert.match(h21.title, /^21장 /);
  else assert.ok(r.result.warnings.some(w => /21장/.test(w)));
  assert.equal(core.command('getCue', { id: r.result.cue.id }).ok, true);
  // 파일 내용(JSON 그대로)도 된다
  assert.equal(core.command('chatAiImport', { text: JSON.stringify(plan) }).ok, true);
  // JSON 이 없으면 안내
  const bad = core.command('chatAiImport', { text: '죄송하지만 파일을 읽을 수 없습니다.' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /JSON/);
});

test('사용 기록: 송출하면 남고, 5분 안 같은 것은 한 번, 제목별 횟수·CSV', () => {
  const core = newCore('usage');
  const passage = (title, extra = {}) => ({ title, versionId: 'test', versionName: '테스트역', query: title, ...extra });
  const slides = [{ kind: 'text', ref: 'x', label: '', parts: [{ text: '가사' }] }];
  const cue = core.command('saveCue', { cue: { name: '주일 예배', items: [{ type: 'song', title: '은혜 아니면', credit: '작사 홍길동' }] } }).result;
  core.command('sendLive', { passage: passage('은혜 아니면', { cueId: cue.id, cueIndex: 0, itemTitle: '은혜 아니면', itemType: 'song', credit: '작사 홍길동' }), slides, index: 0 });
  core.command('sendLive', { passage: passage('은혜 아니면', { cueId: cue.id, cueIndex: 0, itemTitle: '은혜 아니면', itemType: 'song', credit: '작사 홍길동' }), slides, index: 0 }); // 5분 안 → 한 번만
  core.command('sendLive', { passage: passage('요한복음 3:16', { book: { id: 43, name: '요한복음', short: '요' } }), slides, index: 0 });
  const r = core.command('usageLog', {}).result;
  assert.deepEqual(r.rows.map(x => [x.kind, x.title, x.credit, x.cue]), [['bible', '요한복음 3:16', '', ''], ['song', '은혜 아니면', '작사 홍길동', '주일 예배']]);
  assert.deepEqual(core.command('usageLog', { kinds: ['song'] }).result.summary.map(s => [s.title, s.count]), [['은혜 아니면', 1]]);
  // from·to 는 이 PC 의 날짜(한국 시간)로 본다 — toISOString(UTC) 날짜를 쓰면 자정~오전 9시에 하루가 어긋난다
  const nd = new Date();
  const today = `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`;
  assert.equal(core.command('usageLog', { from: '2000-01-01', to: '2000-12-31' }).result.rows.length, 0);
  assert.equal(core.command('usageLog', { from: today, to: today }).result.rows.length, 2);
  const csv = core.command('usageCsv', { kinds: ['song'], mode: 'summary' }).result;
  assert.match(csv.csv, /^﻿종류,제목,저작권·출처,횟수/);
  assert.match(csv.csv, /찬양,은혜 아니면,작사 홍길동,1,/);
  assert.match(csv.name, /사용기록-제목별/);
  assert.equal(core.command('clearUsageLog', {}).result.removed, 2);
  core.store.close();
});

test('여러 PC 동기화: 한쪽에서 쓴 찬양·큐시트를 다른 쪽이 받고, 최신 수정이 이긴다', () => {
  const dir = path.join(tmp, 'sync-folder');
  const a = newCore('syncA');
  const b = newCore('syncB');
  const song = a.command('saveSong', { song: { title: '은혜 아니면', lyrics: '가사 A' } }).result;
  const cue = a.command('saveCue', { cue: { name: '주일 예배', items: [{ type: 'title', title: '묵도' }] } }).result;
  const ra = a.command('setSyncDir', { dir });
  assert.equal(ra.ok, false); // 없는 폴더
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(a.command('setSyncDir', { dir }).ok, true);
  assert.ok(fs.existsSync(path.join(dir, 'WorshipCue-sync.json')));
  // B: 폴더를 설정하면 받는다
  const rb = b.command('setSyncDir', { dir }).result;
  assert.equal(rb.got.songs, 1); assert.equal(rb.got.cues, 1);
  assert.equal(b.command('getSong', { id: song.id }).result.lyrics, '가사 A');
  assert.equal(b.command('getCue', { id: cue.id }).result.name, '주일 예배');
  // B 가 고치고 씀 → A 가 받음 (B 쪽이 최신)
  b.command('saveSong', { song: { ...song, lyrics: '가사 B' } });
  assert.equal(b.sync.exportIfChanged(), true);
  assert.equal(a.command('syncNow').result.got.songs, 1);
  assert.equal(a.command('getSong', { id: song.id }).result.lyrics, '가사 B');
  // 다시 읽어도 같은 것은 받지 않는다
  assert.equal(a.sync.importNow().songs, 0);
  // 끄기
  assert.equal(a.command('setSyncDir', { dir: '' }).result.dir, '');
  a.store.close(); b.store.close();
});

test('자동 백업과 되돌리기: 백업 파일이 생기고, 예약한 되돌리기는 다음 시작 때 적용', () => {
  const name = 'backup';
  let core = newCore(name);
  core.command('saveSong', { song: { title: '백업 전 찬양', lyrics: '가사' } });
  const b = core.command('backupNow').result;
  assert.match(b.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(fs.existsSync(b.db) && b.size > 0);
  assert.equal(core.command('backups').result.list.length, 1);
  assert.equal(core.sync.backupDaily(), null); // 오늘 것이 있으면 안 만든다
  const after = core.command('saveSong', { song: { title: '백업 뒤 찬양', lyrics: '가사' } }).result;
  assert.equal(core.command('restoreBackup', { day: b.day }).result.restartNeeded, true);
  assert.equal(core.command('backups').result.pending, true);
  assert.equal(core.command('restoreBackup', { day: '1999-01-01' }).ok, false);
  core.store.close();
  // 다시 시작 → 백업 상태로
  core = new WorshipCueCore({ dataDir: path.join(tmp, name) });
  assert.equal(core.command('getSong', { id: after.id }).ok, false);
  assert.equal(core.command('listSongs', { query: '백업 전' }).result.length, 1);
  assert.ok(fs.existsSync(path.join(tmp, name, 'bible.pre-restore.db')));
  assert.equal(core.command('backups').result.pending, false);
  core.store.close();
});

test('규칙으로 바로 (AI 없이): 붙여 넣은 예배 순서 → 큐시트', () => {
  const { parseOrderText, planToCue } = require('../src/core/bulletin');
  const { looksLikeReference } = require('../src/core/parser');
  const text = `2026년 10월 18일 주일 성결예배 (11:00)
1. 예배로의 부름  8장*
2. 신앙고백 - 사도신경 *
대표기도: 김철수 장로
성경봉독 시 23:1-6
교독문 1
찬양 은혜 아니면, 주님 다시 오실 때까지
찬양 찬양대
설교 “선한 목자” 홍길동 목사
찬송 310장 / 봉헌 / 광고
구세군 찬송가 12장
축도 홍길동 목사 (일어서서)
예배 후`;
  const p = parseOrderText(text, { looksLikeRef: looksLikeReference });
  assert.equal(p.serviceDate, '2026-10-18');
  assert.equal(p.startTime, '11:00');
  assert.match(p.name, /주일 성결예배/);
  assert.deepEqual(p.items.map(i => i.type), ['hymn', 'title', 'title', 'bible', 'reading', 'song', 'song', 'title', 'title', 'hymn', 'title', 'text', 'hymn', 'title', 'blank']);
  assert.deepEqual(p.items[0], { type: 'hymn', title: '예배로의 부름', subtitle: '', note: '*일어서서', hymnNumber: 8, hymnbook: '새찬송가' });
  assert.equal(p.items[1].subtitle, '사도신경');
  assert.equal(p.items[3].ref, '시 23:1-6');
  assert.equal(p.items[4].hymnNumber, 1);
  assert.equal(p.items[6].song, '주님 다시 오실 때까지');
  assert.equal(p.items[8].subtitle, '“선한 목자” · 홍길동 목사');
  assert.equal(p.items[12].hymnbook, '구세군');
  assert.equal(p.items[13].note, '*일어서서');
  // 순서 → 큐시트: 찬양은 라이브러리에서, 교독문·찬송가는 베들레헴 가사에서 (없으면 제목 순서 + 경고)
  const song = { title: '은혜 아니면', lyrics: '가사', order: '', credit: '' };
  const reading = { kind: 'reading', title: '교독문 1 시편 1편', body: '복 있는 사람은\n**악인의 꾀를**' };
  const r = planToCue(p, { resolveHymn: () => null, checkRef: () => '시편 23:1-6',
    resolveHymnal: (n, book) => (/교독문/.test(book) ? reading : n === 8 ? { kind: 'hymn', title: '8장 거룩 거룩 거룩', lyrics: '[1절]\n거룩', order: '', credit: '새찬송가 8장' } : null),
    resolveSong: name => (name === '은혜 아니면' ? song : null) });
  const it = r.cue.items;
  assert.equal(it[0].type, 'song'); assert.equal(it[0].title, '예배로의 부름 · 8장 거룩 거룩 거룩'); assert.equal(it[0].note, '*일어서서');
  assert.equal(it[4].type, 'text'); assert.equal(it[4].title, '교독문 1 시편 1편');
  assert.equal(it[5].type, 'song'); assert.equal(it[5].title, '은혜 아니면');
  assert.equal(it[6].type, 'title'); assert.match(it[6].title, /주님 다시 오실 때까지/);
  assert.equal(it[9].type, 'title'); assert.match(it[9].title, /310장/);
  assert.ok(r.warnings.some(w => /주님 다시 오실 때까지/.test(w)));
  assert.ok(r.warnings.some(w => /310장/.test(w)));
  // 코어: 저장까지
  const core = newCore('quick');
  core.command('saveSong', { song: { title: '은혜 아니면', lyrics: '은혜 아니면 나 서지 못하네' } });
  assert.equal(core.command('quickMakeCue', { text: '' }).ok, false);
  const q = core.command('quickMakeCue', { text: '묵도 / 찬양 은혜 아니면 / 성경봉독 요 3:16 / 축도' });
  assert.equal(q.ok, true, q.error);
  assert.deepEqual(q.result.cue.items.map(i => i.type), ['title', 'song', 'bible', 'title']);
  assert.equal(q.result.cue.items[1].lyrics, '은혜 아니면 나 서지 못하네');
  assert.equal(core.command('getCue', { id: q.result.cue.id }).ok, true);
  core.store.close();
});

test('슬라이드쇼·자동 넘김·자동 동작: 저장 정리, 코어가 N초마다 넘기고 반복', async () => {
  const core = newCore('slideshow');
  const cue = core.command('saveCue', { cue: { name: '예배 전', items: [
    { type: 'slideshow', title: '예배 전 화면', images: ['/lib/file?p=a.png', '', '/lib/file?p=b.png'], countdown: '10:55', countdownLabel: '예배 시작까지', music: '/lib/file?p=m.mp3', actions: { timer: 0, bogus: 1, logo: 'off', ovOff: '*' } },
    { type: 'title', title: '설교', actions: { timer: 35, stageMsg: '설교 시작' }, autoSec: 1 },
    { type: 'audio', title: '음악', autoSec: 10, actions: { timer: 5 } },
  ] } }).result;
  const [ss, t, au] = core.command('getCue', { id: cue.id }).result.items;
  assert.deepEqual(ss.images, ['/lib/file?p=a.png', '/lib/file?p=b.png']);
  assert.equal(ss.autoSec, 8); // 슬라이드쇼 기본 8초 · 반복
  assert.equal(ss.autoLoop, true);
  assert.equal(ss.countdown, '10:55');
  assert.deepEqual(ss.actions, { logo: 'off', ovOff: '*' });
  assert.equal(ss.music, '/lib/file?p=m.mp3');
  assert.deepEqual(t.actions, { timer: 35, stageMsg: '설교 시작' });
  assert.equal(t.autoSec, 0); // 2초 미만은 끔
  assert.equal(au.autoSec, undefined); // 음악 순서는 자동 넘김·동작 없음
  assert.equal(au.actions, undefined);
  // 코어 자동 넘김: 2초마다, 끝에서 처음으로
  const r = core.command('sendLive', { passage: { title: '예배 전', auto: { sec: 2, loop: true } }, slides: [
    { kind: 'image', image: '/a.png', parts: [], countdown: { target: '10:55', label: '예배 시작까지' } },
    { kind: 'image', image: '/b.png', parts: [] },
  ] });
  assert.equal(r.ok, true);
  assert.equal(core.presentation.live.slides[0].countdown.target, '10:55');
  await new Promise(res => setTimeout(res, 2300));
  assert.equal(core.presentation.live.index, 1);
  await new Promise(res => setTimeout(res, 2100));
  assert.equal(core.presentation.live.index, 0); // 반복
  // 숨김(F10) 중에는 멈춤
  core.command('toggleLive');
  await new Promise(res => setTimeout(res, 2200));
  assert.equal(core.presentation.live.index, 0);
  clearTimeout(core.autoTimer);
});

test('화면에 그리기·강조: 선 넣기·이어 그리기·되돌리기, 슬라이드가 바뀌면 지움', () => {
  const core = newCore('draw');
  const got = [];
  core.on('draw', d => got.push(JSON.parse(JSON.stringify(d))));
  core.command('sendLive', { passage: { title: '본문' }, slides: [{ kind: 'text', ref: '', parts: [{ text: '가' }] }, { kind: 'text', ref: '', parts: [{ text: '나' }] }] });
  core.command('drawStroke', { stroke: { id: 's1', pts: [[0.1, 0.1]], color: '#ff0000', width: 0.01 } });
  core.command('drawStroke', { stroke: { id: 's1', pts: [[0.1, 0.1], [0.5, 0.5], [9, -9]], color: 'javascript:x' } }); // 같은 id = 이어 그리기
  assert.equal(core.draw.strokes.length, 1);
  assert.deepEqual(core.draw.strokes[0].pts[2], [1.1, -0.1]); // 화면 밖 좌표는 잘라냄
  assert.equal(core.draw.strokes[0].color, '#ff3b30'); // 이상한 색은 기본색
  assert.equal(core.command('drawStroke', { stroke: { pts: [[0, 0]] } }).ok, false); // id 없음
  core.command('drawStroke', { stroke: { id: 's2', pts: [[0.2, 0.2]] } });
  core.command('drawUndo');
  assert.equal(core.draw.strokes.length, 1);
  core.command('drawSpot', { on: true, x: 0.5, y: 0.4, r: 9 });
  assert.equal(core.draw.spot.r, 0.6);
  core.command('nextSlide');
  assert.equal(core.draw.strokes.length, 0); // 슬라이드가 바뀌면 지움
  assert.equal(core.draw.spot, null);
  assert.ok(got.length >= 5);
});

test('찬양 가져오기: OpenLyrics · ChordPro · ProPresenter 6 · txt → 라이브러리', () => {
  const core = newCore('songimport');
  const dir = path.join(tmp, 'songs-in');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'grace.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.8"><properties><titles><title>놀라운 은혜 (예시)</title></titles>
<authors><author>홍길동</author></authors><copyright>예시 2026</copyright><ccliNo>1234</ccliNo><verseOrder>v1 c v2 c</verseOrder></properties>
<lyrics><verse name="v1"><lines>첫째 줄<br/>둘째 줄</lines></verse><verse name="c"><lines><chord name="G"/>은혜 &amp; 사랑<br/>놀라워</lines><lines>후렴 둘째 장</lines></verse><verse name="v2"><lines>2절 가사</lines></verse></lyrics></song>`);
  fs.writeFileSync(path.join(dir, 'morning.cho'), `{title: 아침 찬양}\n{artist: 김철수}\n{ccli: 777}\n{key: G}\n{start_of_verse}\n[G]새벽빛 [D]비추는\n{end_of_verse}\n\n{start_of_chorus}\n[C]은혜 은혜\n{end_of_chorus}\n# 주석`);
  const plain = Buffer.from('목자 되신 주\n나를 부르시네', 'utf8').toString('base64');
  fs.writeFileSync(path.join(dir, 'shepherd.pro6'), `<RVPresentationDocument CCLISongTitle="목자 되신 주" CCLIAuthor="박영희"><groups><RVSlideGrouping name="Verse 1"><slides><RVDisplaySlide><displayElements><RVTextElement PlainText="${plain}"></RVTextElement></displayElements></RVDisplaySlide></slides></RVSlideGrouping><RVSlideGrouping name="Chorus"><slides><RVDisplaySlide><displayElements><RVTextElement RTFData="${Buffer.from('{\\rtf1\\ansi{\\fonttbl\\f0 Arial;}\\f0 Amazing\\par grace}', 'latin1').toString('base64')}"></RVTextElement></displayElements></RVDisplaySlide></slides></RVSlideGrouping></groups></RVPresentationDocument>`);
  fs.writeFileSync(path.join(dir, '작은 기도.txt'), '[1절]\n작은 손 모아\n\n[후렴]\n감사해요');
  fs.writeFileSync(path.join(dir, 'broken.xml'), '<html>아님</html>');
  const r = core.command('importSongs', { paths: [dir] });
  assert.equal(r.ok, true, r.error);
  const by = Object.fromEntries(r.result.songs.map(s => [s.title, s]));
  const g = by['놀라운 은혜 (예시)'];
  assert.match(g.lyrics, /^\[1절\]\n첫째 줄\n둘째 줄\n\n\[후렴\]\n\[G\]은혜 & 사랑\n놀라워\n\n후렴 둘째 장\n\n\[2절\]\n2절 가사$/);
  assert.equal(g.arrangement, '1절 후렴 2절 후렴');
  assert.equal(g.credit, '홍길동 · 예시 2026 · CCLI 1234');
  const c = by['아침 찬양'];
  assert.match(c.lyrics, /\[1절\]\n\[G\]새벽빛 \[D\]비추는/);
  assert.match(c.lyrics, /\[후렴\]\n\[C\]은혜 은혜/);
  assert.doesNotMatch(c.lyrics, /주석|key/);
  assert.equal(c.credit, '김철수 · CCLI 777');
  const p = by['목자 되신 주'];
  assert.match(p.lyrics, /\[1절\]\n목자 되신 주\n나를 부르시네/);
  assert.match(p.lyrics, /\[후렴\]\nAmazing\ngrace/);
  assert.ok(by['작은 기도']);
  assert.ok(r.result.errors.some(e => e.file === 'broken.xml'));
  // 저장 · 같은 제목 건너뛰기
  const s1 = core.command('saveImportedSongs', { songs: r.result.songs }).result;
  assert.equal(s1.saved, 4);
  const again = core.command('importSongs', { paths: [path.join(dir, 'morning.cho')] }).result;
  assert.equal(again.songs[0].dup, true);
  assert.deepEqual(core.command('saveImportedSongs', { songs: again.songs }).result, { saved: 0, skipped: 1 });
  assert.equal(core.command('saveImportedSongs', { songs: again.songs, dup: 'replace' }).result.saved, 1);
  assert.equal(core.command('listSongs', { query: '' }).result.filter(s => s.title === '아침 찬양').length, 1);
});

test('스트림덱·외부 단추: 열쇠가 맞을 때만 GET 으로 동작', async () => {
  const core = newCore('trigger');
  const port = 39000 + Math.floor(Math.random() * 500);
  const srv = await startServer(core, { webDir: path.join(__dirname, '..', 'src', 'web'), port });
  try {
    const info = core.command('triggerInfo').result;
    assert.match(info.key, /^[\w-]{10,}$/);
    assert.ok(info.actions.some(a => a.id === 'next'));
    core.command('sendLive', { passage: { title: '본문' }, slides: [{ kind: 'text', ref: '', parts: [{ text: '가' }] }, { kind: 'text', ref: '', parts: [{ text: '나' }] }] });
    assert.equal((await get(port, '/api/trigger/next')).status, 403); // 열쇠 없음
    assert.equal((await get(port, '/api/trigger/next?key=wrong')).status, 403);
    const ok = await get(port, `/api/trigger/next?key=${info.key}`);
    assert.equal(ok.status, 200, ok.body);
    assert.equal(core.presentation.live.index, 1);
    assert.equal((await get(port, `/api/trigger/hide?key=${info.key}`)).status, 200);
    assert.equal(core.presentation.live.visible, false);
    await get(port, `/api/trigger/timer?key=${info.key}&min=25`);
    assert.equal(core.stage.timer.duration, 25 * 60000);
    await get(port, `/api/trigger/message?key=${info.key}&text=${encodeURIComponent('5분 남았습니다')}`);
    assert.equal(core.stage.message, '5분 남았습니다');
    assert.equal((await get(port, `/api/trigger/nope?key=${info.key}`)).status, 400);
    // 열쇠를 바꾸면 예전 주소는 거부
    const nk = core.command('newTriggerKey').result.key;
    assert.notEqual(nk, info.key);
    assert.equal((await get(port, `/api/trigger/next?key=${info.key}`)).status, 403);
  } finally { await srv.close(); }
});

test('카메라 (FreeShow 방식): 송출 배경 층 · 카메라 순서 · 슬라이드 · 편집기 상자', () => {
  const core = newCore('camera');
  // 송출 배경 층: 예배당 화면에만, 배경 숨김을 풀고, null 이면 끔
  core.command('toggleBackground', { on: true });
  const r = core.command('setBackgroundMedia', { media: { type: 'camera', deviceId: 'cam-1', label: '앞 카메라' } });
  assert.equal(r.ok, true);
  assert.equal(r.result.media.deviceId, 'cam-1');
  assert.equal(r.result.hideBg, false);
  assert.equal(core.outputPayload('main').layers.media.label, '앞 카메라');
  assert.equal(core.outputPayload('overlay').layers.media, null); // OBS 자막(투명)에는 없음
  assert.equal(core.command('setBackgroundMedia', { media: { type: 'flash' } }).ok, false);
  core.command('setBackgroundMedia', { media: null });
  assert.equal(core.outputPayload('main').layers.media, null);
  // 카메라 순서
  const cue = core.command('saveCue', { cue: { name: '카메라', items: [{ type: 'camera', title: '📷 앞', deviceId: 'cam-1', label: '앞 카메라', fit: 'weird' }] } }).result;
  const it = core.command('getCue', { id: cue.id }).result.items[0];
  assert.deepEqual([it.type, it.deviceId, it.label, it.fit], ['camera', 'cam-1', '앞 카메라', 'cover']);
  // 카메라 슬라이드 송출
  const s = core.command('sendLive', { passage: { title: '카메라' }, slides: [{ kind: 'camera', camera: { deviceId: 'cam-1', label: '앞', fit: 'contain' }, parts: [] }] });
  assert.equal(s.ok, true);
  assert.deepEqual(core.presentation.live.slides[0].camera, { deviceId: 'cam-1', label: '앞', fit: 'contain' });
  // 슬라이드 편집기 카메라 상자
  const { normalizeEdits } = require('../src/core/slideedit');
  const e = normalizeEdits({ '0': { items: [{ type: 'camera', deviceId: 'cam-2', label: '설교자', x: 60, y: 5, w: 35, h: 35 }] } });
  assert.equal(e['0'].items[0].type, 'camera');
  assert.equal(e['0'].items[0].deviceId, 'cam-2');
});

test('큐시트 관리: 메모·고정·서식, 다음 주 복제, 휴지통, 여러 개 내보내기·가져오기, 순서지 글', () => {
  const core = newCore('cuemgr');
  const a = core.command('saveCue', { cue: { name: '2026-10-18 주일 예배', serviceDate: '2026-10-18', startTime: '11:00', items: [{ type: 'title', title: '예배로 부름', subtitle: '인도: 홍길동' }, { type: 'bible', title: '성경봉독', ref: '시 23:1-6', note: '일어서서' }] } }).result;
  const b = core.command('saveCue', { cue: { name: '수요 예배', serviceDate: '2026-10-21', items: [{ type: 'title', title: '찬양' }] } }).result;
  // 메모·고정·서식 (순서는 그대로)
  const m = core.command('updateCueMeta', { id: a.id, memo: '성찬 주일', pinned: true, template: true, serviceDate: 'bad' }).result;
  assert.equal(m.memo, '성찬 주일'); assert.equal(m.pinned, true); assert.equal(m.template, true);
  assert.equal(m.serviceDate, '2026-10-18'); // 이상한 날짜는 무시
  assert.equal(m.items.length, 2);
  let list = core.command('listCues').result;
  assert.equal(list[0].id, a.id); // 고정이 맨 위
  assert.equal(list[0].preview[1].sub, '시 23:1-6');
  // 순서를 저장해도 메모·고정은 남는다
  core.command('saveCue', { cue: { ...core.command('getCue', { id: a.id }).result, name: '2026-10-18 주일 예배' } });
  assert.equal(core.command('getCue', { id: a.id }).result.memo, '성찬 주일');
  // 다음 주로 복제: 날짜 +7, 이름 속 날짜도
  const n = core.command('duplicateCue', { id: a.id, nextWeek: true }).result;
  assert.equal(n.serviceDate, '2026-10-25');
  assert.equal(n.name, '2026-10-25 주일 예배');
  assert.equal(n.pinned, false); assert.equal(n.template, false); assert.equal(n.memo, '');
  assert.notEqual(n.items[0].id, core.command('getCue', { id: a.id }).result.items[0].id);
  // 휴지통 → 되살리기 → 아주 지우기
  core.command('trashCues', { ids: [b.id, n.id] });
  assert.equal(core.command('listCues').result.length, 1);
  assert.equal(core.command('listCues', { trash: true }).result.length, 2);
  core.command('restoreCues', { ids: [b.id] });
  assert.equal(core.command('listCues').result.length, 2);
  core.command('purgeCues', { ids: [n.id, a.id] }); // 휴지통에 없는 a 는 그대로
  assert.equal(core.command('listCues', { trash: true }).result.length, 0);
  assert.equal(core.command('getCue', { id: a.id }).ok, true);
  // 여러 개 내보내기 → 가져오기
  const ex = core.command('exportCues', { ids: [a.id, b.id] }).result;
  assert.equal(ex.cues.length, 2);
  const im = core.command('importCues', { data: ex }).result;
  assert.equal(im.count, 2);
  assert.equal(core.command('listCues').result.length, 4);
  assert.equal(core.command('importCues', { data: { name: '하나', items: [{ type: 'blank' }] } }).result.count, 1); // 예전 형식(하나)
  assert.equal(core.command('importCues', { data: { foo: 1 } }).ok, false);
  // 순서지 글
  const t = core.command('cueText', { id: a.id }).result.text;
  assert.match(t, /■ 2026-10-18 주일 예배 \(2026-10-18 11:00\)/);
  assert.match(t, /2\. 성경봉독 — 시 23:1-6 {2}\(일어서서\)/);
  assert.match(t, /※ 성찬 주일/);
  // 지우기(deleteCue) 는 휴지통으로
  core.command('deleteCue', { id: b.id });
  assert.ok(core.command('listCues', { trash: true }).result.some(c => c.id === b.id));
});

test('찬양 PPT 온라인: 검색 주소, 다운로드 폴더 지켜보기 → 찬양 폴더로 옮기고 알림', async () => {
  const { onlineSearchUrl } = require('../src/core/songinbox');
  assert.equal(onlineSearchUrl('https://example.org/search/{q}', '은혜 아니면'), 'https://example.org/search/%EC%9D%80%ED%98%9C%20%EC%95%84%EB%8B%88%EB%A9%B4');
  assert.throws(() => onlineSearchUrl('javascript:alert(1)', 'x'));
  const core = newCore('inbox');
  const dl = path.join(tmp, 'dl'), inbox = path.join(tmp, 'inbox-ppt');
  fs.mkdirSync(dl);
  fs.writeFileSync(path.join(dl, 'old.ppt'), 'x'); // 지켜보기 전부터 있던 파일은 건드리지 않는다
  core.command('updateSettings', { patch: { songDownloadDir: dl, songInboxDir: inbox, songSearchUrl: 'https://example.org/s/{q}' } });
  let opened = null;
  core.desktop = { openUrl: u => { opened = u; } };
  const got = new Promise(res => core.once('song-downloaded', res));
  const r = core.command('songOnlineSearch', { query: '은혜' });
  assert.equal(r.ok, true, r.error);
  assert.equal(opened, 'https://example.org/s/%EC%9D%80%ED%98%9C');
  assert.equal(core.command('songInboxStatus').result.watching, true);
  fs.writeFileSync(path.join(dl, '은혜 아니면.pptx.crdownload'), 'partial'); // 받는 중
  await new Promise(r => setTimeout(r, 1700));
  fs.renameSync(path.join(dl, '은혜 아니면.pptx.crdownload'), path.join(dl, '은혜 아니면 (1).pptx'));
  const d = await got;
  assert.equal(d.title, '은혜 아니면');
  assert.equal(d.file, path.join(inbox, '은혜 아니면.pptx'));
  assert.ok(fs.existsSync(d.file));
  assert.ok(!fs.existsSync(path.join(dl, '은혜 아니면 (1).pptx')));
  assert.ok(fs.existsSync(path.join(dl, 'old.ppt')));
  const f = core.command('listHymnFolders').result.find(x => x.path === inbox);
  assert.equal(f.render, 'slides');
  assert.equal(core.command('searchHymns', { query: '은혜' }).result[0].file, d.file);
  core.command('songInboxStop');
  assert.equal(core.command('songInboxStatus').result.watching, false);
  core.store.close();
});

// ---------------- 서버 / OBS ----------------
function get(port, p) {
  return new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d }));
  }).on('error', rej));
}
function post(port, p, body, headers = { 'X-WorshipCue': '1' }) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { let b = null; try { b = JSON.parse(d); } catch { b = d; } res({ status: r.statusCode, body: b }); });
    });
    req.on('error', rej); req.end(data);
  });
}
function sse(port, client) {
  const events = [];
  let resolveNext = null;
  const req = http.get({ host: '127.0.0.1', port, path: `/events?client=${client}` }, res => {
    let buf = '';
    res.on('data', ch => {
      buf += ch;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /event: (.*)/.exec(block)?.[1];
        const data = /data: (.*)/.exec(block)?.[1];
        if (ev) { events.push({ ev, data: JSON.parse(data) }); if (resolveNext) { resolveNext(); resolveNext = null; } }
      }
    });
  });
  return {
    events, close: () => req.destroy(),
    wait: (pred, ms = 2000) => new Promise((res, rej) => {
      const t0 = Date.now();
      const check = () => {
        const e = events.find(pred);
        if (e) return res(e);
        if (Date.now() - t0 > ms) return rej(new Error('timeout'));
        resolveNext = check; setTimeout(check, 50);
      };
      check();
    }),
  };
}

test('T11/T15 OBS 출력 동기화·재연결 시 최신 상태 / 보안', async () => {
  const core = newCore('srv');
  const port = 37000 + Math.floor(Math.random() * 1000);
  const srv = await startServer(core, { webDir: path.join(__dirname, '..', 'src', 'web'), port });
  try {
    const page = await get(port, '/outputs/overlay');
    assert.equal(page.status, 200);
    const s1 = sse(port, 'overlay');
    await s1.wait(e => e.ev === 'render');
    assert.equal(s1.events[0].data.template.id, 'overlay');
    assert.equal(s1.events[0].data.hasLive, false);

    const t0 = performance.now();
    const r = await post(port, '/api/command', { cmd: 'sendLive', args: { passage: { title: '요 3:16' }, slides: [slide('요한복음 3:16', 16)] } });
    assert.equal(r.body.ok, true);
    const ev = await s1.wait(e => e.ev === 'render' && e.data.hasLive);
    assert.ok(performance.now() - t0 < 300, 'T07 송출 반영 300ms 이내');
    assert.equal(ev.data.slide.ref, '요한복음 3:16');
    s1.close();

    // 끊긴 사이 Live 변경 → 재접속하면 최신 상태
    await post(port, '/api/command', { cmd: 'clearLive' });
    const s2 = sse(port, 'overlay');
    const ev2 = await s2.wait(e => e.ev === 'render');
    assert.equal(ev2.data.visible, false);
    assert.equal(ev2.data.slide.ref, '요한복음 3:16');
    s2.close();

    // 헤더 없는 POST(다른 웹사이트) 거부
    const forbidden = await post(port, '/api/command', { cmd: 'clearLive' }, {});
    assert.equal(forbidden.status, 403);
  } finally {
    await srv.close();
    core.store.close();
  }
});

test('성능: 장절 100ms / 본문 300ms 이내', () => {
  const core = newCore('perf');
  for (const q of ['요3:16', '창1:1-2:3', '시 119']) {
    const t = performance.now(); core.command('searchReference', { query: q });
    assert.ok(performance.now() - t < 100, q);
  }
  for (const q of ['사랑', '하나님 순종', '테스트 본문']) {
    const t = performance.now(); core.command('searchText', { query: q });
    const ms = performance.now() - t;
    assert.ok(ms < 300, `${q} ${ms}ms`);
  }
  core.store.close();
});

test('성경·그림 순서: 덧붙인 슬라이드(extra)·건너뛰기(skip) 저장', () => {
  const core = newCore('extra');
  const cue = core.command('saveCue', { cue: { name: '덧붙임', items: [
    { type: 'bible', title: '본문', ref: '요3:16', extra: [{ id: 'ab12', at: 0, text: '말씀\n요한복음' }, { at: 1, text: '' }], skip: [2, 2, -1, 'x'], edits: { xab12: { bg: '#000000' }, bad: { bg: '#111111' } } },
    { type: 'audio', title: '음악', extra: [{ at: 0, text: '안 됨' }], edits: { '*': { bg: '#000000' } } },
  ] } }).result;
  const got = core.command('getCue', { id: cue.id }).result;
  assert.deepEqual(got.items[0].extra, [{ id: 'ab12', at: 0, text: '말씀\n요한복음' }]);
  assert.deepEqual(got.items[0].skip, [2]);
  assert.equal(got.items[0].edits.xab12.bg, '#000000');
  assert.equal(got.items[0].edits.bad, undefined);
  assert.equal(got.items[1].extra, undefined);
  assert.equal(got.items[1].edits, undefined);
});

test('가사 정리: 되풀이로 1절·프리코러스·후렴 나누기, 여러 곡 붙여넣기', () => {
  const { arrange } = require('../src/core/lyricsweb');
  const { parseSongText } = require('../src/core/songimport');
  // 빈 줄 없이 줄만 있는 가사 (예시 가사)
  const v1 = ['첫째 절 하나', '첫째 절 둘', '첫째 절 셋'], pre = ['다리 하나', '다리 둘'], ch = ['후렴 하나', '후렴 둘'], v2 = ['둘째 절 하나', '둘째 절 둘'];
  const a = arrange([...v1, ...pre, ...ch, ...v2, ...pre, ...ch, ...ch].join('\n'));
  assert.equal(a.arrangement, '1절 프리코러스 후렴 2절 프리코러스 후렴 후렴');
  assert.match(a.lyrics, /^\[1절\]\n첫째 절 하나\n첫째 절 둘\n첫째 절 셋\n\n\[프리코러스\]/); // 3줄은 한 슬라이드
  // 한 줄 되풀이(할렐루야 할렐루야)는 나누지 않고, 곡 끝까지 이어진 되풀이도 찾는다
  const b = arrange('주님 사랑해\n주님 경배해\n할렐루야\n할렐루야\n주님 사랑해\n주님 경배해');
  assert.equal(b.arrangement, '후렴 1절 후렴');
  assert.match(b.lyrics, /\[1절\]\n할렐루야\n할렐루야/);
  // 이미 이름표가 있으면 그대로
  assert.equal(arrange('[1절]\n가\n\n[후렴]\n나').lyrics, '[1절]\n가\n\n[후렴]\n나');
  const songs = parseSongText('# 곡 하나\n가사 가\n가사 나\n\n# 곡 둘\n가사 다');
  assert.deepEqual(songs.map(s => s.title), ['곡 하나', '곡 둘']);
});

test('설교 포인트 슬라이드: 원고·자막에서 대지 찾기, AI 답 읽기, 제목 순서로', async () => {
  const sp = require('../src/core/sermonpoints');
  // 원고: 머리의 제목·본문·설교자, '첫째·둘째·셋째로', 대지 안의 1. 2. 작은 목록은 대지가 아님, '적용:'
  const ms = '제목: 복음을 부끄러워하지 않는 삶\n본문: 롬 1:16-17\n설교자: 홍길동 사관\n\n오늘 바울의 고백을 묵상합니다.\n\n'
    + '첫째, 복음은 하나님의 능력입니다.\n복음은 죽은 자를 살리시는 하나님의 능력입니다. 그래서 바울은 담대했습니다.\n1. 로마는 힘의 도시였습니다\n2. 복음은 더 큰 힘입니다\n\n'
    + '둘째, 복음은 모든 믿는 자에게 열려 있습니다.\n유대인에게나 헬라인에게나 차별이 없습니다.\n\n'
    + '셋째로 의인은 믿음으로 삽니다\n우리의 의는 믿음에서 나옵니다.\n\n적용: 이번 주 한 사람에게 복음을 전해 봅시다.';
  const a = sp.findPoints(ms, {});
  assert.equal(a.title, '복음을 부끄러워하지 않는 삶');
  assert.equal(a.verse, '롬 1:16-17');
  assert.equal(a.speaker, '홍길동 사관');
  assert.deepEqual(a.points.map(p => p.heading), ['복음은 하나님의 능력입니다', '복음은 모든 믿는 자에게 열려 있습니다', '의인은 믿음으로 삽니다']);
  assert.match(a.points[1].body, /차별이 없습니다/);
  assert.match(a.application, /복음을 전해/);
  // 숫자 목록 원고 · 화면에서 넣은 제목이 원고 머리보다 우선
  const b = sp.findPoints('1. 하나님은 사랑이십니다\n그 사랑은 십자가에서 드러났습니다.\n2. 우리도 서로 사랑합니다\n사랑은 행함입니다.', { title: '사랑' });
  assert.equal(b.title, '사랑');
  assert.deepEqual(b.points.map(p => p.heading), ['하나님은 사랑이십니다', '우리도 서로 사랑합니다']);
  // 자동 자막(srt): 부호 없이 '첫째 … 둘째 …'
  const srt = '1\n00:00:01,000 --> 00:00:04,000\n오늘 말씀은 로마서입니다 첫째 복음은 능력입니다\n\n2\n00:00:04,500 --> 00:00:08,000\n죽은 자를 살리는 힘이 있습니다 둘째 복음은 모두에게 열려 있습니다\n\n3\n00:00:08,500 --> 00:00:10,000\n누구든지 믿으면 구원을 받습니다';
  const c = sp.findPoints(srt, {});
  assert.equal(c.found, 'sentences');
  assert.deepEqual(c.points.map(p => p.heading), ['복음은 능력입니다', '복음은 모두에게 열려 있습니다']);
  // 대지 표시가 없으면 알려 준다
  assert.throws(() => sp.findPoints('그냥 긴 설교입니다. 대지 표시는 없습니다.', {}), /대지 표시/);
  // 채팅 AI 답 (설명 + json 코드 블록) · 설교쇼츠 편집기 '설교 요약' 모양
  const ans = '정리했습니다.\n```json\n{"title":"복음","verse":"롬 1:16-17","theme":"복음은 믿는 모든 자를 살리는 하나님의 능력입니다","points":[{"heading":"복음은 능력입니다","body":"죽은 자를 살리시는 힘"},{"heading":"모두에게 열린 복음","body":"차별 없이"}],"application":"한 사람에게 복음을 전합시다","prayer":"기도"}\n```';
  const d = sp.parseAnswer(ans);
  assert.equal(d.points.length, 2);
  assert.equal(sp.findPoints(ans, {}).found, 'json'); // 원고 칸에 붙여 넣어도 읽는다
  assert.throws(() => sp.parseAnswer('JSON 이 없는 답'), /찾지 못했습니다/);
  // 제목 순서: 첫 장 제목·본문, 다음 장 핵심·대지·적용 ('---' 로 나눔)
  const it = sp.toCueItem(d);
  assert.equal(it.type, 'title');
  assert.equal(it.title, '복음');
  assert.equal(it.subtitle, '롬 1:16-17');
  const pages = it.more.split('\n---\n');
  assert.deepEqual(pages.map(p => p.split('\n')[0]), ['복음은 믿는 모든 자를 살리는 하나님의 능력입니다', '첫째, 복음은 능력입니다', '둘째, 모두에게 열린 복음', '한 사람에게 복음을 전합시다']);
  assert.equal(it.note, '설교 포인트 5장');
  const it2 = sp.toCueItem({ ...d, points: [{ heading: '하나\n---\n둘', body: '' }] }, { numbering: 'num', theme: false, application: false });
  assert.equal(it2.more, '1. 하나 — 둘'); // 장 구분선·줄바꿈이 끼어들지 않게
  // 코어 명령: 규칙 · 프롬프트 · AI(가짜 응답) · 순서 만들기
  const core = newCore('points');
  const f = core.command('sermonPointsFind', { text: ms, meta: { speaker: '김사관' } });
  assert.equal(f.ok, true, f.error);
  assert.equal(f.result.data.speaker, '김사관');
  const pr = core.command('sermonPointsPrompt', { text: ms, meta: { title: '복음' } });
  assert.match(pr.result.prompt, /설교 제목: 복음/);
  assert.match(pr.result.prompt, /첫째, 복음은 하나님의 능력입니다/);
  core.command('setAi', { apiKey: 'sk-test' });
  let sent = null;
  core.aiFetch = async (url, opt) => { sent = JSON.parse(opt.body); return { ok: true, json: async () => ({ model: 'test/m', choices: [{ message: { content: JSON.stringify({ title: '', points: [{ heading: '하나', body: '일' }, { heading: '둘', body: '이' }] }) } }] }) }; };
  const ai = await core.command('sermonPointsAI', { text: ms, meta: { title: '복음' } });
  assert.equal(ai.ok, true, ai.error);
  assert.equal(ai.result.data.title, '복음'); // AI 가 비운 제목은 화면 값으로
  assert.match(sent.messages[1].content, /\[설교 원고\]/);
  const im = core.command('sermonPointsItem', { data: ai.result.data, opts: { numbering: 'word' } });
  assert.equal(im.ok, true, im.error);
  assert.match(im.result.item.more, /^첫째, 하나\n일\n---\n둘째, 둘\n이$/);
  core.store.close();
});

test('홈페이지 주보 연동: JSON → 큐시트(교회 소식에 광고 슬라이드) · 광고만 · 시각', async () => {
  const hf = require('../src/core/homefeed');
  const feedJson = {
    format: 'worshipcue-bulletin/1', church: '○○교회', updated: '2026-10-25',
    bulletins: [
      { date: '2026-10-18', sermon: { title: '지난 설교' }, services: [{ name: '주일 예배', items: [{ part: '묵도' }] }] },
      { date: '2026-10-25', issue: '제2권 43호', sermon: { title: '나라와 권세와 영광', passage: '마태복음 6:9-13', preacher: '홍길동 사관' },
        services: [
          { name: '주일 성결예배', time: '오전 11:00', items: [
            { part: '묵도', by: '사회자' },
            { part: '예배로의 부름', content: '304장 「그 크신 하나님의 사랑」', stand: true },
            { part: '교회소식', by: '사회자' },
            { part: '성경봉독', content: '요한복음 3:16' },
            { part: '설교', content: '나라와 권세와 영광', by: '홍길동 사관' },
            { part: '찬송', content: '「은혜 아니면」', stand: true },
            { part: '구역모임', content: '추수감사주일·순서 / 준비', by: '각 구역장' },
          ] },
          { name: '주일 오후예배', time: '오후 1:30', items: [{ part: '기도' }] },
        ],
        news: [{ title: '환영합니다!', body: '오늘 오신 분들을 환영합니다.' }, { title: '가정단 나들이', body: '10/31 토 오전 8:30 출발\n---\n회비 2만 원', link: 'https://x/news/1' }],
        prayers: [{ title: '건축을 위한 기도', body: '견고하게 세워지도록' }],
        events: [{ when: '10/31 (토)', title: '가정단 나들이', note: '보현산댐' }],
      },
    ],
  };
  const feed = hf.normalizeFeed(feedJson);
  assert.equal(feed.bulletins[0].date, '2026-10-25'); // 최신순
  assert.throws(() => hf.normalizeFeed({ hello: 1 }), /bulletins/);
  assert.equal(hf.pickBulletin(feed, '2026-10-18').sermon.title, '지난 설교');
  assert.equal(hf.pickBulletin(feed, '2030-01-01').date, '2026-10-25');
  assert.equal(hf.toHHMM('오전 11:00'), '11:00');
  assert.equal(hf.toHHMM('오후 1:30'), '13:30');
  assert.equal(hf.toHHMM('저녁 8시'), '20:00');
  // 광고 슬라이드: 고른 것만 · 일정 한 장 · 기도 제목 · 본문 안의 '---' 는 장을 나누지 않게
  const b = feed.bulletins[0];
  const body = hf.newsBody(b, { news: [1], events: true, prayers: true });
  const pages = body.split('\n---\n');
  assert.equal(pages.length, 3);
  assert.equal(pages[0], '**가정단 나들이**\n10/31 토 오전 8:30 출발\n—\n회비 2만 원');
  assert.match(pages[1], /^\*\*이번 주 일정\*\*\n10\/31 \(토\) {2}가정단 나들이 — 보현산댐$/);
  assert.match(pages[2], /^\*\*건축을 위한 기도\*\*/);
  // 예배 순서 → 계획: 찬송가 번호 · 성경 장절 · 설교 제목 · 교회 소식에 광고 · 곡 이름 찬송은 찬양으로 · 나누기 기호가 순서를 쪼개지 않음
  const { looksLikeReference } = require('../src/core/parser');
  const plan = hf.serviceToPlan(b, 0, { looksLikeRef: looksLikeReference, news: { news: 'all' } });
  assert.equal(plan.name, '2026-10-25 주일 성결예배');
  assert.equal(plan.startTime, '11:00');
  assert.equal(plan.serviceDate, '2026-10-25');
  assert.equal(plan.items.length, 7);
  assert.deepEqual(plan.items.map(x => x.type), ['title', 'hymn', 'text', 'bible', 'title', 'song', 'title']);
  assert.equal(plan.items[1].hymnNumber, 304);
  assert.equal(plan.items[1].note, '*일어서서');
  assert.equal(plan.items[2].body.split('\n---\n').length, 2);
  assert.equal(plan.items[3].ref, '요한복음 3:16');
  assert.equal(plan.items[4].subtitle, '“나라와 권세와 영광” · 홍길동 사관');
  assert.equal(plan.items[5].song, '은혜 아니면');
  assert.equal(plan.items[6].subtitle, '추수감사주일·순서 / 준비 · 각 구역장');
  assert.equal(plan.newsPlaced, true);
  // 코어: 주소 받기(가짜 응답) · 주소 기억 · 큐시트 만들기 · 광고만
  const core = newCore('homefeed');
  core.command('saveSong', { song: { title: '은혜 아니면', lyrics: '은혜 아니면 나 서지 못하네' } });
  core.httpFetch = async url => ({ ok: url.endsWith('/feed.json'), status: 404, text: async () => JSON.stringify(feedJson) });
  const bad = await core.command('homeFeed', { url: 'https://church.example/nope' });
  assert.equal(bad.ok, false);
  const got = await core.command('homeFeed', { url: 'https://church.example/bulletin/feed.json' });
  assert.equal(got.ok, true, got.error);
  assert.equal(got.result.church, '○○교회');
  assert.equal(core.command('homeFeedInfo').result.url, 'https://church.example/bulletin/feed.json');
  const mk = core.command('homeMakeCue', { bulletin: got.result.bulletins[0], service: 0, news: { news: [0], events: false } });
  assert.equal(mk.ok, true, mk.error);
  const cue = mk.result.cue;
  assert.equal(cue.name, '2026-10-25 주일 성결예배');
  assert.equal(cue.items.find(x => x.type === 'text').body, '**환영합니다!**\n오늘 오신 분들을 환영합니다.');
  assert.ok(cue.items.some(x => x.type === 'song' && x.lyrics === '은혜 아니면 나 서지 못하네')); // 곡 이름 찬송은 라이브러리에서 찾음 (304장은 베들레헴 가사로)
  const ni = core.command('homeNewsItem', { bulletin: got.result.bulletins[0], news: { news: [], events: true } });
  assert.equal(ni.ok, true, ni.error);
  assert.equal(ni.result.item.type, 'text');
  assert.match(ni.result.item.body, /이번 주 일정/);
  assert.equal(core.command('homeNewsItem', { bulletin: got.result.bulletins[0], news: { news: [] } }).ok, false);
  core.store.close();
});

test('예배 전 화면 자동 만들기: 최근 카드 묶음 · 홈페이지 묶음 문장 · QT 첫날 본문 → 슬라이드쇼', () => {
  const ps = require('../src/core/preservice');
  // 카드 그림 폴더: 묶음(이름_01, 이름_02)마다, 최근 것 먼저
  const dir = path.join(tmp, 'cards');
  fs.mkdirSync(dir, { recursive: true });
  const touch = (n, t) => { const f = path.join(dir, n); fs.writeFileSync(f, 'x'); fs.utimesSync(f, t, t); };
  const old = new Date('2026-10-12T10:00:00'), now = new Date('2026-10-26T10:00:00');
  touch('묵상카드_10월11일_01.png', old); touch('묵상카드_10월11일_02.png', old);
  touch('묵상카드_10월25일_02.png', now); touch('묵상카드_10월25일_01.png', now); touch('메모.txt', now);
  const g = ps.cardGroups(dir);
  assert.equal(g.length, 2);
  assert.equal(g[0].base, '묵상카드_10월25일');
  assert.deepEqual(g[0].files.map(f => f.name), ['묵상카드_10월25일_01.png', '묵상카드_10월25일_02.png']);
  assert.throws(() => ps.cardGroups(path.join(tmp, 'nope')), /열 수 없습니다/);
  // 설교쇼츠 편집기 '홈페이지 묶음': 오늘(포함) 이전의 가장 최근 날짜 폴더
  const bdir = path.join(tmp, 'bundles');
  for (const [d, line] of [['2026-10-18', '지난 문장'], ['2026-10-25', '복음은 하나님의 능력입니다'], ['2026-11-01', '미래 문장']]) {
    fs.mkdirSync(path.join(bdir, d), { recursive: true });
    fs.writeFileSync(path.join(bdir, d, 'bundle.json'), JSON.stringify({ date: d, cardLine: line }));
  }
  assert.equal(ps.latestBundle(bdir, '2026-10-30').cardLine, '복음은 하나님의 능력입니다');
  assert.equal(ps.latestBundle(path.join(tmp, 'none'), '2026-10-30'), null);
  // QT 첫날: JSON(설교쇼츠 편집기 QT 자료) · '1일째 · 제목 (장절)' 글 · 장절만
  const ref = s => /\d+:\d+/.test(s);
  assert.deepEqual(ps.parseQt('```json\n{"title":"주기도문 QT","days":[{"day":1,"title":"아버지","passage":"마 6:9-10"},{"day":2,"passage":"마 6:11"}]}\n```', ref), { title: '주기도문 QT', dayTitle: '아버지', ref: '마 6:9-10' });
  assert.deepEqual(ps.parseQt('주기도문 QT\n\n1일째 · 하늘에 계신 아버지 (마태복음 6:9-10)\n묵상…\n2일째 · 양식 (마태복음 6:11)', ref), { title: '', dayTitle: '하늘에 계신 아버지', ref: '마태복음 6:9-10' });
  assert.equal(ps.parseQt('요 3:16', ref).ref, '요 3:16');
  assert.throws(() => ps.parseQt('본문 없음', ref), /장절을 찾지 못했습니다/);
  // 슬라이드쇼 순서: 그림 + 글(지난주 말씀 · 주보 표지 말씀 · QT 머리 · 본문 3절씩) · 카운트다운 · 넘김 초
  const passage = { title: '마태복음 6:9-13', verses: [9, 10, 11, 12, 13].map(v => ({ verse: v, text: `${v}절 본문` })) };
  const it = ps.buildItem({ images: ['/lib/file?p=a.png'], cardLine: '복음은\n---\n능력', verse: { text: '영과 진리로', ref: '요 4:24' }, qt: { dayTitle: '아버지', ref: '마 6:9-13', passage }, countdown: '11:00', autoSec: 100 });
  assert.equal(it.type, 'slideshow');
  assert.equal(it.autoSec, 60);
  assert.equal(it.countdown, '11:00');
  const pages = it.body.split('\n---\n');
  assert.deepEqual(pages.map(p => p.split('\n')[0]), ['**지난주 말씀**', '**요 4:24**', '**이번 주 QT · 첫째 날**', '**마태복음 6:9-13**', '**마태복음 6:9-13**']);
  assert.equal(pages[0], '**지난주 말씀**\n복음은\n—\n능력'); // 글 안의 '---' 가 장을 나누지 않게
  assert.equal(pages[3].split('\n').length, 4); // 머리 + 3절
  assert.equal(it.note, '말씀카드 1장 · 글 5장');
  assert.throws(() => ps.buildItem({}), /넣을 것이 없습니다/);
  // 코어: 카드 폴더(그림을 열 수 있게 등록) · 묶음 · QT 본문(성경 DB) · 순서
  const core = newCore('preservice');
  const cards = core.command('preServiceCards', { folder: dir });
  assert.equal(cards.ok, true, cards.error);
  const u = cards.result.groups[0].files[0].url;
  assert.ok(core.library.resolveFile(decodeURIComponent(u.split('p=')[1])), '등록한 그림은 /lib/file 로 열린다');
  assert.equal(core.command('preServiceInfo').result.cardFolder, dir);
  assert.equal(core.command('preServiceBundle', { dir: bdir }).ok, true);
  const q = core.command('preServiceQt', { text: '요 3:16' });
  assert.equal(q.ok, true, q.error);
  assert.match(q.result.passage.verses[0].text, /하나님이 세상을/);
  assert.equal(core.command('preServiceQt', { text: '그냥 글' }).ok, false);
  const pi = core.command('preServiceItem', { images: [u], qt: q.result, autoSec: 6 });
  assert.equal(pi.ok, true, pi.error);
  assert.equal(pi.result.item.autoSec, 6);
  assert.equal(core.command('preServiceInfo').result.autoSec, 6);
  core.store.close();
});
