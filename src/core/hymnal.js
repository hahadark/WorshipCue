'use strict';
// 베들레헴 성경의 찬송가: 가사 DB(.hdb, SQLite hymnal(chapter, title, htext)) + 악보 그림 묶음(.cmp, 압축 안 한 zip: p{장}.png)
// - 새찬송가: 1~645장 · 교독문 701~836 (701 = 교독문 1) · 찬미가: 1~859장
// - 찾는 곳: 데이터 폴더 hymnal/ (설정 → 베들레헴에서 가져오기) → 베들레헴 설치 폴더 → 프로그램 폴더(개인용 빌드)
// - 사용자가 가진 베들레헴 데이터를 읽기만 한다 (공개판에는 포함하지 않음)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { candidates, parseHtext, splitEven } = require('./hymnlyrics');

const BOOKS = [
  { id: '새찬송가', name: '새찬송가', hymns: 645, reading: [701, 836] },
  { id: '찬미가', name: '찬미가', hymns: 899, reading: null },
];
const clean = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** 압축 안 한(또는 deflate) zip 에서 파일 하나 꺼내기 — 큰 파일도 필요한 부분만 읽는다 */
class ZipIndex {
  constructor(file) {
    this.file = file;
    this.map = new Map();
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const tail = Math.min(size, 66000);
      const buf = Buffer.alloc(tail);
      fs.readSync(fd, buf, 0, tail, size - tail);
      const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (eocd < 0) throw new Error('zip 형식이 아닙니다');
      const cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
      const cd = Buffer.alloc(cdSize);
      fs.readSync(fd, cd, 0, cdSize, cdOff);
      for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
        const method = cd.readUInt16LE(p + 10), csize = cd.readUInt32LE(p + 20);
        const nl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
        const off = cd.readUInt32LE(p + 42);
        this.map.set(cd.toString('utf8', p + 46, p + 46 + nl).toLowerCase(), { method, csize, off });
        p += 46 + nl + el + cl;
      }
    } finally { fs.closeSync(fd); }
  }
  read(name) {
    const e = this.map.get(name.toLowerCase());
    if (!e) return null;
    const fd = fs.openSync(this.file, 'r');
    try {
      const h = Buffer.alloc(30);
      fs.readSync(fd, h, 0, 30, e.off);
      const start = e.off + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
      const data = Buffer.alloc(e.csize);
      fs.readSync(fd, data, 0, e.csize, start);
      return e.method === 8 ? zlib.inflateRawSync(data) : data;
    } finally { fs.closeSync(fd); }
  }
}

class Hymnal {
  constructor(core) {
    this.core = core;
    this.dbs = new Map();
    this.zips = new Map();
  }
  get dir() { return path.join(this.core.dataDir, 'hymnal'); }
  /** 찾는 폴더들 (앞이 우선) */
  dirs() {
    const s = this.core.settings.get();
    return [this.dir, ...(s.bethlehemDir ? [s.bethlehemDir] : []), ...candidates(), ...(process.resourcesPath ? [process.resourcesPath] : [])];
  }
  find(book, ext) {
    for (const d of this.dirs()) {
      const f = path.join(d, book + ext);
      if (fs.existsSync(f)) return f;
    }
    return '';
  }
  db(book) {
    const f = this.find(book, '.hdb');
    if (!f) return null;
    const c = this.dbs.get(book);
    if (c && c.f === f) return c.db;
    if (c) try { c.db.close(); } catch { /* 무시 */ }
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(f, { readOnly: true });
    this.dbs.set(book, { f, db });
    return db;
  }
  zip(book) {
    const f = this.find(book, '.cmp');
    if (!f) return null;
    const c = this.zips.get(book);
    if (c && c.file === f) return c;
    try { const z = new ZipIndex(f); this.zips.set(book, z); return z; } catch { return null; }
  }
  close() {
    for (const c of this.dbs.values()) try { c.db.close(); } catch { /* 무시 */ }
    this.dbs.clear();
    this.zips.clear();
  }

  /** 쓸 수 있는 찬송가책 */
  books() {
    return BOOKS.map(b => {
      let count = 0;
      try { const db = this.db(b.id); if (db) count = db.prepare('SELECT COUNT(*) AS n FROM hymnal WHERE chapter <= ?').get(b.hymns).n; } catch { /* 못 읽음 */ }
      return { id: b.id, name: b.name, lyrics: count > 0, count, scores: !!this.find(b.id, '.cmp'), reading: !!b.reading && count > 0 };
    }).filter(b => b.lyrics || b.scores);
  }

  /** 장 번호 → 종류 (찬송 · 교독문 · 안내 없음) */
  kindOf(book, n) {
    const b = BOOKS.find(x => x.id === book);
    if (!b) return '';
    if (n >= 1 && n <= b.hymns) return 'hymn';
    if (b.reading && n >= b.reading[0] && n <= b.reading[1]) return 'reading';
    return '';
  }

  /** 찾기: 번호(10 · 10장) · 교독문 번호(교독문 1) · 제목 · 첫 가사 → [{ book, number, title, kind, label }] */
  search(query, limit = 60) {
    const q = String(query || '').trim();
    if (!q) return [];
    const out = [];
    const mRead = /^교독문\s*(\d{1,3})$/.exec(q);
    const mNum = /^(\d{1,3})\s*장?$/.exec(q);
    const key = q.replace(/\s+/g, '');
    for (const b of BOOKS) {
      let db;
      try { db = this.db(b.id); } catch { db = null; }
      if (!db) continue;
      let rows = [];
      if (mRead && b.reading) rows = db.prepare('SELECT chapter, title FROM hymnal WHERE chapter = ?').all(b.reading[0] - 1 + Number(mRead[1]));
      else if (mNum) rows = db.prepare('SELECT chapter, title FROM hymnal WHERE chapter = ?').all(Number(mNum[1]));
      else if (key.length >= 2) {
        const like = '%' + q.replace(/[%_]/g, '') + '%';
        rows = db.prepare("SELECT chapter, title FROM hymnal WHERE (title LIKE ?1 OR replace(title, ' ', '') LIKE ?2 OR htext LIKE ?1) ORDER BY (replace(title, ' ', '') LIKE ?2) DESC, chapter LIMIT ?3").all(like, '%' + key.replace(/[%_]/g, '') + '%', limit);
      }
      for (const r of rows) {
        const kind = this.kindOf(b.id, r.chapter);
        if (!kind) continue;
        const rn = kind === 'reading' ? r.chapter - b.reading[0] + 1 : r.chapter;
        out.push({ book: b.id, number: r.chapter, title: r.title, kind, label: kind === 'reading' ? `교독문 ${rn} ${r.title}` : `${r.chapter}장 ${r.title}`, scores: kind === 'hymn' && !!this.find(b.id, '.cmp') });
      }
    }
    return out.slice(0, limit);
  }

  /** 한 장의 내용 → 큐시트 순서로 쓸 모양 */
  get(book, number) {
    const db = this.db(book);
    if (!db) throw new Error(`${book} 가사 파일을 찾지 못했습니다. 설정 → 성경 데이터 → 베들레헴에서 가져오기를 하세요.`);
    const r = db.prepare('SELECT chapter, title, htext FROM hymnal WHERE chapter = ? ORDER BY id LIMIT 1').get(Number(number));
    if (!r) throw new Error(`${book} ${number}장이 없습니다.`);
    const kind = this.kindOf(book, r.chapter);
    const b = BOOKS.find(x => x.id === book);
    if (kind === 'reading') {
      // 교독문: 줄마다 인도자 / 회중(굵게) 번갈아
      const lines = String(r.htext).split(/<br\s*\/?>/i).map(l => ({ text: clean(l), people: /<b>/i.test(l) })).filter(l => l.text);
      const pages = [];
      for (let i = 0; i < lines.length; i += 2) pages.push(lines.slice(i, i + 2).map(l => (l.people ? `**${l.text}**` : l.text)).join('\n'));
      const n = r.chapter - b.reading[0] + 1;
      return { kind, book, number: r.chapter, title: `교독문 ${n} ${r.title}`, body: pages.join('\n---\n') };
    }
    const { verses, chorus } = parseHtext(r.htext);
    const slides = text => {
      // 한 절을 고르게 줄로 나눠 (낱말 경계, 한 줄 14자 안팎) 두 줄씩 슬라이드로
      const t = clean(text);
      const n = t.replace(/\s/g, '').length;
      let lines = Math.max(2, Math.round(n / 14));
      if (lines % 2) lines += 1;
      const ls = splitEven(t, lines);
      const out = [];
      for (let i = 0; i < ls.length; i += 2) out.push(ls.slice(i, i + 2).join('\n'));
      return out.join('\n\n');
    };
    const parts = [];
    const order = [];
    verses.forEach((v, k) => { parts.push(`[${k + 1}절]\n${slides(v)}`); order.push(`${k + 1}절`); if (chorus) order.push('후렴'); });
    if (chorus) parts.push(`[후렴]\n${slides(chorus)}`);
    return { kind: 'hymn', book, number: r.chapter, title: `${r.chapter}장 ${r.title}`, lyrics: parts.join('\n\n'), order: chorus ? order.join(' ') : '', credit: `${book} ${r.chapter}장`, score: this.find(book, '.cmp') ? `/hymnal/score/${encodeURIComponent(book)}/${r.chapter}.png` : '' };
  }

  /** 악보 그림 (png) */
  score(book, number) {
    const z = this.zip(book);
    return z ? z.read(`p${Number(number)}.png`) : null;
  }

  /** 베들레헴 폴더에서 데이터 폴더로 복사 → [{ book, lyrics, scores }] */
  importFrom(dir, books) {
    const want = Array.isArray(books) && books.length ? books : BOOKS.map(b => b.id);
    fs.mkdirSync(this.dir, { recursive: true });
    this.close();
    const done = [];
    for (const b of BOOKS.filter(x => want.includes(x.id))) {
      const r = { book: b.id, lyrics: false, scores: false };
      for (const ext of ['.hdb', '.cmp']) {
        const src = path.join(dir, b.id + ext);
        if (!fs.existsSync(src)) continue;
        const dest = path.join(this.dir, b.id + ext);
        if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest);
        if (ext === '.hdb') r.lyrics = true; else r.scores = true;
      }
      if (r.lyrics || r.scores) done.push(r);
    }
    return done;
  }

  /** 베들레헴 폴더에 있는 찬송가책 (가져오기 화면용) */
  static scan(dir) {
    return BOOKS.map(b => ({ book: b.id, lyrics: fs.existsSync(path.join(dir, b.id + '.hdb')), scores: fs.existsSync(path.join(dir, b.id + '.cmp')) })).filter(x => x.lyrics || x.scores);
  }
}

module.exports = { Hymnal, ZipIndex, BOOKS };
