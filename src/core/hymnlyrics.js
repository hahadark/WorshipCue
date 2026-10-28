'use strict';
// 베들레헴 성경의 새찬송가 가사 DB (BethlehemWin\새찬송가.hdb, SQLite: hymnal(chapter, title, htext))
// - 찬송가 PPT 의 악보 그림에는 글자가 없으므로, OBS 자막(가사만)에 쓸 가사를 여기서 가져온다
// - 사용자의 베들레헴 설치 폴더에서 읽기만 한다 (공개판에는 포함하지 않음 · 개인용 빌드만 resources 에 넣음)

const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = '새찬송가.hdb';

/** 흔한 설치 위치 (문서 · OneDrive 문서 · Program Files) */
function candidates() {
  const home = os.homedir();
  const out = [];
  const docs = [path.join(home, 'Documents'), path.join(home, '문서')];
  for (const base of [home, 'D:\\', 'E:\\']) {
    let names = [];
    try { names = fs.readdirSync(base).filter(n => /^OneDrive/i.test(n)); } catch { /* 없음 */ }
    for (const n of names) docs.push(path.join(base, n, '문서'), path.join(base, n, 'Documents'));
  }
  for (const d of docs) out.push(path.join(d, '베들레헴 성경', 'BethlehemWin'));
  for (const pf of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, 'C:\\BethlehemWin']) {
    if (pf) out.push(path.basename(pf) === 'BethlehemWin' ? pf : path.join(pf, 'BethlehemWin'));
  }
  return out;
}

/** "<b>1</b>. 가사 <br><br><small>…[후렴]…</small> 가사<br><br><b>2</b>. …" → { verses: [], chorus } */
function parseHtext(html) {
  const clean = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const verses = [];
  let chorus = '';
  for (const block of String(html || '').split(/<br\s*\/?>\s*<br\s*\/?>/i)) {
    if (!clean(block)) continue;
    if (/\[후렴\]/.test(block)) { if (!chorus) chorus = clean(block.replace(/\[후렴\]/, '')); continue; }
    verses.push(clean(block).replace(/^\d+\s*\.\s*/, ''));
  }
  return { verses, chorus };
}

const syl = s => s.replace(/\s+/g, '').length;

/** 글을 낱말 경계에서 parts 조각으로 고르게 나눈다 (글자 수 기준) */
function splitEven(text, parts) {
  const words = text.split(/\s+/).filter(Boolean);
  if (parts <= 1 || words.length <= 1) return [words.join(' ')];
  const total = syl(text);
  const out = [];
  let cur = [], acc = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const left = words.length - i; // 남은 낱말 수
    const need = parts - out.length - 1; // 이 조각 뒤에 더 만들어야 할 조각 수
    cur.push(w); acc += syl(w);
    const goal = total * (out.length + 1) / parts;
    const nextAcc = i + 1 < words.length ? acc + syl(words[i + 1]) : Infinity;
    // 목표에 더 가까워지는 지점에서 끊는다 (뒤 조각에 낱말이 남도록)
    if (need > 0 && left - 1 >= need && Math.abs(acc - goal) <= Math.abs(nextAcc - goal)) { out.push(cur.join(' ')); cur = []; }
  }
  if (cur.length) out.push(cur.join(' '));
  while (out.length < parts) out.push('');
  return out;
}

/** 한 슬라이드 글 → 두 줄 (악보 슬라이드 한 장에 가사 두 줄) */
const twoLines = s => splitEven(s, 2).filter(Boolean).join('\n');

/**
 * 찬송가 PPT 의 악보 슬라이드 n 장에 가사를 맞춘다.
 * 보통 순서: 1절 → 후렴 → 2절 → … → 마지막 절 → 후렴. (후렴이 매 절마다 / 끝에만 / 없음 도 시도)
 * 절은 s 장, 후렴은 c 장씩이라고 보고, 글자 수 비율(절:후렴)에 가장 가까운 조합을 고른다.
 */
function alignLyrics(lyr, n) {
  if (!lyr || !lyr.verses || !lyr.verses.length || n < 1) return [];
  const V = lyr.verses, C = lyr.chorus || '', k = V.length;
  const avgV = V.reduce((a, v) => a + syl(v), 0) / k;
  const plans = [];
  const after = {
    'first-last': i => i === 0 || i === k - 1,
    each: () => true,
    last: i => i === k - 1,
    none: () => false,
  };
  for (const [name, fn] of Object.entries(after)) {
    if (!C && name !== 'none') continue;
    const m = V.filter((_, i) => fn(i)).length;
    for (let c = m ? 1 : 0; c <= (m ? 4 : 0); c++) {
      const rem = n - m * c;
      if (rem < k || rem % k) continue;
      const s = rem / k;
      // 슬라이드 한 장당 글자 수가 절과 후렴에서 비슷할수록 좋다
      const perV = avgV / s, perC = c ? syl(C) / c : perV;
      const score = Math.abs(Math.log(perV / perC)) + (name === 'first-last' ? 0 : name === 'each' ? 0.05 : 0.1);
      plans.push({ fn, s, c, score });
    }
  }
  const out = [];
  if (plans.length) {
    plans.sort((a, b) => a.score - b.score);
    const { fn, s, c } = plans[0];
    V.forEach((v, i) => {
      out.push(...splitEven(v, s).map(twoLines));
      if (c && fn(i)) out.push(...splitEven(C, c).map(twoLines));
    });
  } else {
    // 맞는 조합이 없으면 1절·후렴·2절·후렴… 전체를 고르게 나눈다
    const all = V.flatMap(v => (C ? [v, C] : [v])).join(' ');
    out.push(...splitEven(all, n).map(twoLines));
  }
  return out.slice(0, n);
}

class HymnLyrics {
  constructor(core) {
    this.core = core;
    this.db = null;
    this.dbPath = '';
  }

  /** 가사 DB 파일 위치 (설정 → 자동 찾기) */
  find() {
    const s = this.core.settings.get();
    const dirs = s.bethlehemDir ? [s.bethlehemDir] : candidates();
    // 설정 → 베들레헴에서 가져오기로 데이터 폴더에 복사해 둔 것 → 개인용 빌드의 프로그램 폴더(resources)
    // (베들레헴을 지웠거나 없는 PC 에서도)
    if (this.core.dataDir) dirs.push(path.join(this.core.dataDir, 'hymnal'), this.core.dataDir);
    if (process.resourcesPath) dirs.push(process.resourcesPath);
    for (const d of dirs) {
      const f = /\.hdb$/i.test(d) ? d : path.join(d, FILE);
      if (fs.existsSync(f)) return f;
    }
    return '';
  }

  open() {
    const f = this.find();
    if (!f) return null;
    if (this.db && this.dbPath === f) return this.db;
    try { if (this.db) this.db.close(); } catch { /* 무시 */ }
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(f, { readOnly: true });
    this.dbPath = f;
    return this.db;
  }

  status() {
    const f = this.find();
    const inData = !!this.core.dataDir && fs.existsSync(path.join(this.core.dataDir, FILE)); // 데이터 폴더에 복사해 둔 것
    return { found: !!f, path: f, inData };
  }

  /** 장 번호 → { number, title, verses, chorus } 또는 null */
  get(number) {
    if (!Number.isInteger(number) || number < 1) return null;
    let db;
    try { db = this.open(); } catch { return null; }
    if (!db) return null;
    const r = db.prepare('SELECT chapter, title, htext FROM hymnal WHERE chapter = ? ORDER BY id LIMIT 1').get(number);
    if (!r) return null;
    const { verses, chorus } = parseHtext(r.htext);
    return verses.length ? { number: r.chapter, title: r.title, verses, chorus } : null;
  }

  close() { try { if (this.db) this.db.close(); } catch { /* 무시 */ } this.db = null; }

  /** 베들레헴 폴더의 가사 DB 를 데이터 폴더로 복사 → 가사 수 */
  importFrom(dir) {
    const src = path.join(String(dir || ''), FILE);
    const n = countHymns(src);
    if (!n) throw new Error('새찬송가 가사 파일(새찬송가.hdb)을 읽지 못했습니다.');
    const dest = path.join(this.core.dataDir, FILE);
    if (path.resolve(src) === path.resolve(dest)) return n;
    this.close(); // 데이터 폴더의 것을 열고 있으면 덮어쓰지 못한다
    fs.copyFileSync(src, dest);
    return n;
  }
}

/** 가사 DB 의 찬송가 수 (없거나 읽지 못하면 0) */
function countHymns(file) {
  if (!fs.existsSync(file)) return 0;
  let db = null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(file, { readOnly: true });
    return db.prepare('SELECT COUNT(DISTINCT chapter) AS c FROM hymnal').get().c || 0;
  } catch { return 0; } finally { try { if (db) db.close(); } catch { /* 무시 */ } }
}

module.exports = { HymnLyrics, parseHtext, candidates, alignLyrics, splitEven, countHymns, FILE };
