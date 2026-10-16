'use strict';
// Bible Data Manager + Bible Search Engine 의 DB 부분 (SQLite, node:sqlite)

const { DatabaseSync } = require('node:sqlite');
const { BOOKS, getBook } = require('./books');
const { parseReference } = require('./parser');
const { searchNormalize, compact } = require('./textnorm');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS BibleVersions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  language TEXT,
  copyright TEXT,
  license TEXT,
  source TEXT,
  imported_at TEXT,
  verse_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS BibleBooks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  testament TEXT NOT NULL,
  book_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS BibleVerses (
  rowid INTEGER PRIMARY KEY,
  version_id TEXT NOT NULL,
  book_id INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL,
  search_text TEXT NOT NULL,
  search_compact TEXT NOT NULL,
  UNIQUE (version_id, book_id, chapter, verse)
);
CREATE TABLE IF NOT EXISTS BibleHeadings (
  version_id TEXT NOT NULL,
  book_id INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_headings ON BibleHeadings(version_id, book_id, chapter, verse);
CREATE TABLE IF NOT EXISTS BibleNotes (
  version_id TEXT NOT NULL,
  book_id INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes ON BibleNotes(version_id, book_id, chapter, verse);
CREATE TABLE IF NOT EXISTS Commentaries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT,
  license TEXT,
  imported_at TEXT,
  entry_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS CommentaryEntries (
  id INTEGER PRIMARY KEY,
  commentary_id TEXT NOT NULL,
  book_id INTEGER NOT NULL,
  s INTEGER NOT NULL,   -- 시작 장*1000+절
  e INTEGER NOT NULL,   -- 끝 장*1000+절
  kind TEXT NOT NULL,   -- verse | article
  title TEXT,
  text TEXT NOT NULL,
  seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cm ON CommentaryEntries(commentary_id, book_id, s, e);
CREATE TABLE IF NOT EXISTS Cuesheets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  service_date TEXT,
  items TEXT NOT NULL,      -- JSON 배열 (예배 순서 항목)
  updated_at TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS BibleVersesFts USING fts5(
  search_compact, content='BibleVerses', content_rowid='rowid', tokenize='trigram'
);
`;

class BibleStore {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    // 큐시트 예배 시작 시각 칸 (예전 DB 에는 없으면 추가)
    if (!this.db.prepare('PRAGMA table_info(Cuesheets)').all().some(c => c.name === 'start_time')) this.db.exec("ALTER TABLE Cuesheets ADD COLUMN start_time TEXT NOT NULL DEFAULT ''");
    const ins = this.db.prepare('INSERT OR REPLACE INTO BibleBooks (id, name, short_name, testament, book_order) VALUES (?, ?, ?, ?, ?)');
    this.transaction(() => { for (const b of BOOKS) ins.run(b.id, b.name, b.short, b.testament, b.id); });
    this.structure = new Map(); // versionId → Map(bookId → [verseCount per chapter, index = chapter-1])
    this.reloadStructure();
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* 이미 롤백됨 */ }
      throw e;
    }
  }

  reloadStructure() {
    this.structure.clear();
    const rows = this.db.prepare('SELECT version_id, book_id, chapter, MAX(verse) AS maxv FROM BibleVerses GROUP BY version_id, book_id, chapter').all();
    for (const r of rows) {
      if (!this.structure.has(r.version_id)) this.structure.set(r.version_id, new Map());
      const vm = this.structure.get(r.version_id);
      if (!vm.has(r.book_id)) vm.set(r.book_id, []);
      vm.get(r.book_id)[r.chapter - 1] = r.maxv;
    }
  }

  listVersions() {
    return this.db.prepare('SELECT * FROM BibleVersions ORDER BY name').all().map(r => ({ ...r }));
  }

  getVersion(id) {
    const r = this.db.prepare('SELECT * FROM BibleVersions WHERE id = ?').get(id);
    return r ? { ...r } : null;
  }

  /** 번역본에 존재하는 책·장 구조 */
  getStructure(versionId) {
    const vm = this.structure.get(versionId);
    if (!vm) return [];
    return BOOKS.filter(b => vm.has(b.id)).map(b => ({
      id: b.id, name: b.name, short: b.short, testament: b.testament,
      chapters: vm.get(b.id).map(v => v || 0),
    }));
  }

  chapterCount(versionId, bookId) {
    const ch = this.structure.get(versionId)?.get(bookId);
    return ch ? ch.length : 0;
  }

  verseCount(versionId, bookId, chapter) {
    return this.structure.get(versionId)?.get(bookId)?.[chapter - 1] || 0;
  }

  getVerses(versionId, bookId, sc, sv, ec, ev) {
    return this.db.prepare(`
      SELECT book_id AS book, chapter, verse, text FROM BibleVerses
      WHERE version_id = ? AND book_id = ?
        AND (chapter > ? OR (chapter = ? AND verse >= ?))
        AND (chapter < ? OR (chapter = ? AND verse <= ?))
      ORDER BY chapter, verse`).all(versionId, bookId, sc, sc, sv, ec, ec, ev).map(r => ({ ...r }));
  }

  getHeadings(versionId, bookId, sc, ec) {
    return this.db.prepare(`SELECT chapter, verse, text FROM BibleHeadings
      WHERE version_id = ? AND book_id = ? AND chapter BETWEEN ? AND ? ORDER BY chapter, verse`)
      .all(versionId, bookId, sc, ec).map(r => ({ ...r }));
  }

  /**
   * 장절 문자열 → 본문. 오류는 throw 하지 않고 {ok:false} 로 반환한다.
   */
  resolveReference(versionId, input) {
    if (!this.structure.has(versionId)) return { ok: false, error: '선택한 번역본 데이터가 없습니다.' };
    const p = parseReference(input);
    if (!p.ok) {
      return {
        ok: false, error: p.error, incomplete: !!p.incomplete, ambiguous: !!p.ambiguous, rest: p.rest,
        book: p.book ? { id: p.book.id, name: p.book.name, short: p.book.short, chapters: this.chapterCount(versionId, p.book.id) } : null,
        candidates: (p.candidates || []).map(b => ({ id: b.id, name: b.name, short: b.short })),
      };
    }
    const r = this.resolveRanges(versionId, p.book.id, p.ranges);
    if (!r.ok) r.book = { id: p.book.id, name: p.book.name, short: p.book.short, chapters: this.chapterCount(versionId, p.book.id) };
    return r;
  }

  resolveRanges(versionId, bookId, ranges) {
    const book = getBook(bookId);
    const nCh = this.chapterCount(versionId, bookId);
    if (!nCh) return { ok: false, error: `이 번역본에는 ${book.name} 데이터가 없습니다.` };
    const verses = [];
    const seen = new Set();
    const norm = [];
    for (const r of ranges) {
      if (r.sc > nCh) return { ok: false, error: `${book.name}은(는) ${nCh}장까지 있습니다.` };
      if (r.ec > nCh) return { ok: false, error: `${book.name}은(는) ${nCh}장까지 있습니다.` };
      const sv = r.sv ?? 1;
      const ev = r.ev ?? this.verseCount(versionId, bookId, r.ec);
      const maxS = this.verseCount(versionId, bookId, r.sc);
      const maxE = this.verseCount(versionId, bookId, r.ec);
      if (sv > maxS) return { ok: false, error: `${book.name} ${r.sc}장은 ${maxS}절까지 있습니다.` };
      if (ev > maxE) return { ok: false, error: `${book.name} ${r.ec}장은 ${maxE}절까지 있습니다.` };
      norm.push({ sc: r.sc, sv, ec: r.ec, ev });
      for (const v of this.getVerses(versionId, bookId, r.sc, sv, r.ec, ev)) {
        const k = v.chapter * 1000 + v.verse;
        if (!seen.has(k)) { seen.add(k); verses.push(v); }
      }
    }
    if (!verses.length) return { ok: false, error: '해당 구절의 본문이 없습니다.' };
    const headings = this.getHeadings(versionId, bookId, norm[0].sc, norm[norm.length - 1].ec);
    const version = this.getVersion(versionId);
    return {
      ok: true,
      passage: {
        versionId, versionName: version?.name || versionId,
        book: { id: book.id, name: book.name, short: book.short },
        ranges: norm,
        title: formatTitle(book, norm),
        verses, headings,
      },
    };
  }

  /** 다음/이전 절 (같은 책 안에서만, 장 경계는 넘어감). 범위를 벗어나면 null */
  adjacentVerse(versionId, bookId, chapter, verse, dir) {
    const nCh = this.chapterCount(versionId, bookId);
    if (!nCh) return null;
    if (dir > 0) {
      if (verse < this.verseCount(versionId, bookId, chapter)) return { book: bookId, chapter, verse: verse + 1 };
      if (chapter < nCh) return { book: bookId, chapter: chapter + 1, verse: 1 };
      return null;
    }
    if (verse > 1) return { book: bookId, chapter, verse: verse - 1 };
    if (chapter > 1) return { book: bookId, chapter: chapter - 1, verse: this.verseCount(versionId, bookId, chapter - 1) };
    return null;
  }

  /**
   * 본문 키워드 검색. 여러 단어는 AND, "따옴표"는 구문 검색.
   * 띄어쓰기 차이는 무시한다(search_compact 비교).
   */
  searchText(versionId, query, { limit = 300, bookIds = null } = {}) {
    const terms = [];
    const q = String(query || '').normalize('NFC');
    const re = /"([^"]+)"|(\S+)/g;
    let m;
    while ((m = re.exec(q))) {
      const raw = (m[1] ?? m[2]).trim();
      const c = compact(raw);
      if (c) terms.push({ raw, c });
    }
    if (!terms.length) return { ok: false, error: '검색어를 입력하세요.', results: [], terms: [] };

    const where = ['v.version_id = ?'];
    const args = [versionId];
    const ftsTerms = terms.filter(t => [...t.c].length >= 3);
    if (ftsTerms.length) {
      where.push('v.rowid IN (SELECT rowid FROM BibleVersesFts WHERE BibleVersesFts MATCH ?)');
      args.push(ftsTerms.map(t => '"' + t.c.replace(/"/g, '""') + '"').join(' AND '));
    }
    for (const t of terms) {
      if ([...t.c].length < 3) { where.push("v.search_compact LIKE ? ESCAPE '\\'"); args.push('%' + t.c.replace(/[\\%_]/g, '\\$&') + '%'); }
    }
    if (bookIds && bookIds.length) {
      where.push(`v.book_id IN (${bookIds.map(() => '?').join(',')})`);
      args.push(...bookIds);
    }
    const sql = `SELECT v.book_id AS book, v.chapter, v.verse, v.text FROM BibleVerses v
      WHERE ${where.join(' AND ')} ORDER BY v.book_id, v.chapter, v.verse LIMIT ${Math.max(1, Math.min(2000, limit)) + 1}`;
    const rows = this.db.prepare(sql).all(...args).map(r => ({ ...r }));
    const truncated = rows.length > limit;
    if (truncated) rows.length = limit;
    for (const r of rows) {
      const b = getBook(r.book);
      r.bookName = b.name; r.bookShort = b.short;
      r.ref = `${b.name} ${r.chapter}:${r.verse}`;
    }
    return { ok: true, results: rows, truncated, terms: terms.map(t => t.raw) };
  }

  /**
   * 번역본 전체를 한 트랜잭션으로 교체한다. 실패하면 기존 데이터는 그대로 유지된다.
   */
  replaceVersion(meta, verses, headings = [], notes = []) {
    this.transaction(() => {
      const id = meta.id;
      // FTS(external content) 는 삭제 전 값으로 'delete' 명령을 보내야 한다
      this.db.prepare(`INSERT INTO BibleVersesFts(BibleVersesFts, rowid, search_compact)
        SELECT 'delete', rowid, search_compact FROM BibleVerses WHERE version_id = ?`).run(id);
      this.db.prepare('DELETE FROM BibleVerses WHERE version_id = ?').run(id);
      this.db.prepare('DELETE FROM BibleHeadings WHERE version_id = ?').run(id);
      this.db.prepare('DELETE FROM BibleNotes WHERE version_id = ?').run(id);
      this.db.prepare(`INSERT OR REPLACE INTO BibleVersions (id, name, language, copyright, license, source, imported_at, verse_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, meta.name, meta.language || 'ko', meta.copyright || '', meta.license || '', meta.source || '', new Date().toISOString(), verses.length);
      const insV = this.db.prepare('INSERT INTO BibleVerses (version_id, book_id, chapter, verse, text, search_text, search_compact) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const insF = this.db.prepare('INSERT INTO BibleVersesFts (rowid, search_compact) VALUES (?, ?)');
      for (const v of verses) {
        const st = searchNormalize(v.text);
        const sc = compact(v.text);
        const r = insV.run(id, v.book, v.chapter, v.verse, v.text, st, sc);
        insF.run(r.lastInsertRowid, sc);
      }
      const insH = this.db.prepare('INSERT INTO BibleHeadings (version_id, book_id, chapter, verse, text) VALUES (?, ?, ?, ?, ?)');
      for (const h of headings) insH.run(id, h.book, h.chapter, h.verse, h.text);
      const insN = this.db.prepare('INSERT INTO BibleNotes (version_id, book_id, chapter, verse, text) VALUES (?, ?, ?, ?, ?)');
      for (const n of notes) insN.run(id, n.book, n.chapter, n.verse, n.text);
    });
    this.reloadStructure();
  }

  deleteVersion(id) {
    this.transaction(() => {
      this.db.prepare(`INSERT INTO BibleVersesFts(BibleVersesFts, rowid, search_compact)
        SELECT 'delete', rowid, search_compact FROM BibleVerses WHERE version_id = ?`).run(id);
      for (const t of ['BibleVerses', 'BibleHeadings', 'BibleNotes']) this.db.prepare(`DELETE FROM ${t} WHERE version_id = ?`).run(id);
      this.db.prepare('DELETE FROM BibleVersions WHERE id = ?').run(id);
    });
    this.reloadStructure();
  }

  // ---------- 큐시트 (예배 순서) ----------
  listCues() {
    return this.db.prepare('SELECT id, name, service_date, items, updated_at FROM Cuesheets ORDER BY COALESCE(service_date, \'\') DESC, updated_at DESC').all()
      .map(r => ({ id: r.id, name: r.name, serviceDate: r.service_date || '', updatedAt: r.updated_at, count: safeJson(r.items, []).length }));
  }

  getCue(id) {
    const r = this.db.prepare('SELECT * FROM Cuesheets WHERE id = ?').get(id);
    return r ? { id: r.id, name: r.name, serviceDate: r.service_date || '', startTime: r.start_time || '', items: safeJson(r.items, []), updatedAt: r.updated_at } : null;
  }

  saveCue(cue) {
    this.db.prepare('INSERT OR REPLACE INTO Cuesheets (id, name, service_date, start_time, items, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(cue.id, cue.name, cue.serviceDate || '', cue.startTime || '', JSON.stringify(cue.items || []), new Date().toISOString());
    return this.getCue(cue.id);
  }

  deleteCue(id) {
    this.db.prepare('DELETE FROM Cuesheets WHERE id = ?').run(id);
  }

  // ---------- 주석 ----------
  listCommentaries() {
    return this.db.prepare('SELECT * FROM Commentaries ORDER BY name').all().map(r => ({ ...r }));
  }

  /** 주석 한 권을 한 트랜잭션으로 교체 */
  replaceCommentary(meta, entries, articles = []) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM CommentaryEntries WHERE commentary_id = ?').run(meta.id);
      this.db.prepare('INSERT OR REPLACE INTO Commentaries (id, name, source, license, imported_at, entry_count) VALUES (?, ?, ?, ?, ?, ?)')
        .run(meta.id, meta.name, meta.source || '', meta.license || '', new Date().toISOString(), entries.length + articles.length);
      const ins = this.db.prepare('INSERT INTO CommentaryEntries (commentary_id, book_id, s, e, kind, title, text, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      let seq = 0;
      for (const x of entries) ins.run(meta.id, x.book, x.sc * 1000 + x.sv, x.ec * 1000 + x.ev, 'verse', x.title || '', x.text || '', seq++);
      for (const x of articles) ins.run(meta.id, x.book, x.sc * 1000 + x.sv, x.ec * 1000 + x.ev, 'article', x.title || '', x.text || '', seq++);
    });
  }

  deleteCommentary(id) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM CommentaryEntries WHERE commentary_id = ?').run(id);
      this.db.prepare('DELETE FROM Commentaries WHERE id = ?').run(id);
    });
  }

  /** 범위(장·절)와 겹치는 주석 항목. 범위가 넓은 단락 주석도 함께 나온다 */
  commentaryFor(bookId, sc, sv, ec, ev, commentaryId = null) {
    const s = sc * 1000 + sv, e = ec * 1000 + ev;
    const args = [bookId, e, s];
    let extra = '';
    if (commentaryId) { extra = ' AND x.commentary_id = ?'; args.push(commentaryId); }
    // 정렬: 주석서별 → 여러 장에 걸친 단락 주석 먼저 → 시작 위치 순
    return this.db.prepare(`SELECT c.id AS cid, c.name AS cname, x.book_id AS book, x.s, x.e, x.kind, x.title, x.text
      FROM CommentaryEntries x JOIN Commentaries c ON c.id = x.commentary_id
      WHERE x.book_id = ? AND x.s <= ? AND x.e >= ?${extra}
      ORDER BY c.name, (x.e - x.s) > 999 DESC, x.s, x.seq LIMIT 400`).all(...args).map(r => ({
      ...r, sc: Math.floor(r.s / 1000), sv: r.s % 1000, ec: Math.floor(r.e / 1000), ev: r.e % 1000,
    }));
  }

  integrityCheck() {
    return this.db.prepare('PRAGMA quick_check').get();
  }

  close() {
    try { this.db.close(); } catch { /* 무시 */ }
  }
}

function safeJson(s, def) {
  try { return JSON.parse(s); } catch { return def; }
}

function formatTitle(book, ranges) {
  const parts = ranges.map((r, i) => {
    const prev = ranges[i - 1];
    const sameChapterAsPrev = prev && prev.ec === r.sc && r.sc === r.ec;
    let s;
    if (r.sc === r.ec) {
      s = r.sv === r.ev ? `${r.sc}:${r.sv}` : `${r.sc}:${r.sv}-${r.ev}`;
      if (sameChapterAsPrev) s = s.slice(String(r.sc).length + 1);
    } else {
      s = `${r.sc}:${r.sv}-${r.ec}:${r.ev}`;
    }
    return s;
  });
  return `${book.name} ${parts.join(', ')}`;
}

module.exports = { BibleStore, formatTitle };
