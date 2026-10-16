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
