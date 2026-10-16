'use strict';
// 성경 데이터 가져오기: JSON / CSV / Zefania XML
// 1) analyze(): 파일을 읽어 검증 보고서를 만든다 (DB 변경 없음)
// 2) commit(): 검증을 통과한 데이터를 한 트랜잭션으로 DB에 반영한다

const fs = require('fs');
const path = require('path');
const { BOOKS, resolveBook, getBook } = require('./books');
const { cleanDisplayText } = require('./textnorm');

// ---------- 인코딩 ----------
function decodeBuffer(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString('utf8'), encoding: 'UTF-8 (BOM)' };
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'UTF-16LE' };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'UTF-16BE' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'UTF-8' };
  } catch {
    // 오래된 한글 자료는 EUC-KR(CP949)인 경우가 많다
    return { text: new TextDecoder('euc-kr').decode(buf), encoding: 'EUC-KR (CP949)', converted: true };
  }
}

// ---------- 책 식별 ----------
function bookFrom(value, positionalIndex) {
  if (value === undefined || value === null || value === '') {
    return positionalIndex != null ? getBook(positionalIndex + 1) : null;
  }
  if (typeof value === 'number' || /^\d+$/.test(String(value).trim())) {
    return getBook(Number(value));
  }
  const r = resolveBook(String(value));
  return r.book || null;
}

// ---------- JSON ----------
function parseJson(text, report) {
  const data = JSON.parse(text);
  const out = { meta: {}, verses: [], headings: [], notes: [] };
  const push = (bookVal, ch, v, t, idx) => {
    out.verses.push({ bookRaw: bookVal, bookIndex: idx, chapter: ch, verse: v, text: t });
  };

  // 1) WorshipCue 기본 형식: { version: {...}, verses: [{book, chapter, verse, text}], headings?: [...] }
  if (data && !Array.isArray(data) && Array.isArray(data.verses)) {
    out.meta = data.version || data.meta || {};
    for (const r of data.verses) push(r.book ?? r.book_id ?? r.b, r.chapter ?? r.c, r.verse ?? r.v, r.text ?? r.t);
    for (const h of data.headings || []) out.headings.push({ bookRaw: h.book, chapter: h.chapter, verse: h.verse ?? 1, text: h.text });
    for (const n of data.notes || []) out.notes.push({ bookRaw: n.book, chapter: n.chapter, verse: n.verse, text: n.text });
    report.format = 'JSON (WorshipCue)';
    return out;
  }
  // 2) 평면 배열: [{book, chapter, verse, text}]
  if (Array.isArray(data) && data.length && data[0] && (data[0].verse !== undefined || data[0].v !== undefined) && !Array.isArray(data[0].chapters)) {
    for (const r of data) push(r.book ?? r.book_id ?? r.b, r.chapter ?? r.c, r.verse ?? r.v, r.text ?? r.t);
    report.format = 'JSON (구절 배열)';
    return out;
  }
  // 3) 책 배열: [{name|abbrev|book, chapters: [[verse text...]]}] (책 순서 = 성경 순서)
  if (Array.isArray(data) && data.length && data[0] && Array.isArray(data[0].chapters)) {
    data.forEach((b, bi) => {
      const bookVal = b.book ?? b.name ?? b.abbrev;
      b.chapters.forEach((chap, ci) => {
        if (Array.isArray(chap)) chap.forEach((t, vi) => push(bookVal, ci + 1, vi + 1, t, bi));
        else if (chap && typeof chap === 'object') {
          const verses = Array.isArray(chap.verses) ? chap.verses : null;
          if (verses) verses.forEach((t, vi) => push(bookVal, chap.chapter ?? ci + 1, (t && t.verse) ?? vi + 1, typeof t === 'string' ? t : t?.text, bi));
          else for (const [vk, t] of Object.entries(chap)) push(bookVal, ci + 1, Number(vk), t, bi);
        }
      });
    });
    report.format = 'JSON (책별 장 배열)';
    report.notes.push('책 이름을 인식하지 못하면 배열 순서(66권 표준 순서)로 책을 지정합니다.');
    return out;
  }
  // 4) 중첩 객체: { "창세기": { "1": { "1": "..." } } }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [bk, chapters] of Object.entries(data)) {
      if (!chapters || typeof chapters !== 'object') continue;
      for (const [ck, verses] of Object.entries(chapters)) {
        if (!verses || typeof verses !== 'object') continue;
        for (const [vk, t] of Object.entries(verses)) push(bk, Number(ck), Number(vk), t);
      }
    }
    report.format = 'JSON (책/장/절 객체)';
    return out;
  }
  throw new Error('지원하지 않는 JSON 구조입니다.');
}

// ---------- CSV ----------
function parseCsvRows(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function parseCsv(text, report) {
  const rows = parseCsvRows(text);
  if (!rows.length) throw new Error('CSV 파일이 비어 있습니다.');
  const head = rows[0].map(h => h.trim().toLowerCase());
  const idx = name => head.findIndex(h => name.includes(h));
  let ib = idx(['book', 'book_id', 'b', '책', '권']);
  let ic = idx(['chapter', 'c', '장']);
  let iv = idx(['verse', 'v', '절']);
  let it = idx(['text', 't', '본문', '내용']);
  let start = 1;
  if ([ib, ic, iv, it].some(i => i < 0)) {
    // 헤더가 없으면 book,chapter,verse,text 순서로 간주
    ib = 0; ic = 1; iv = 2; it = 3; start = 0;
    report.notes.push('CSV 머리글이 없어 열 순서를 책,장,절,본문으로 간주했습니다.');
  }
  const out = { meta: {}, verses: [], headings: [], notes: [] };
  for (let r = start; r < rows.length; r++) {
    const row = rows[r];
    out.verses.push({ bookRaw: row[ib], chapter: row[ic], verse: row[iv], text: row.slice(it).join(','), line: r + 1 });
  }
  report.format = 'CSV';
  return out;
}

// ---------- Zefania XML ----------
function decodeEntities(s) {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function attrs(tag) {
  const o = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) o[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4]);
  return o;
}

/** VERS 내부: NOTE(각주)·GRAM 등 부가요소를 본문에서 분리 */
function splitVerseContent(inner) {
  const notes = [];
  let body = inner.replace(/<NOTE\b[^>]*>([\s\S]*?)<\/NOTE>/gi, (_, n) => { notes.push(cleanDisplayText(decodeEntities(n))); return ''; });
  body = body.replace(/<NOTE\b[^>]*\/>/gi, '');
  body = body.replace(/<BR\b[^>]*\/?>/gi, ' ');
  body = body.replace(/<[^>]+>/g, '');
  return { text: decodeEntities(body), notes };
}

function parseZefania(text, report) {
  const out = { meta: {}, verses: [], headings: [], notes: [] };
  const info = text.match(/<INFORMATION>([\s\S]*?)<\/INFORMATION>/i);
  if (info) {
    const get = t => { const m = info[1].match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? decodeEntities(m[1]).trim() : ''; };
    out.meta = { name: get('title'), language: get('language'), copyright: get('rights'), source: get('source') || get('publisher'), identifier: get('identifier') };
  }
  const root = text.match(/<XMLBIBLE\b[^>]*>/i);
  if (!root) throw new Error('Zefania XML(<XMLBIBLE>) 형식이 아닙니다.');
  const rootAttrs = attrs(root[0]);
  if (!out.meta.name && rootAttrs.biblename) out.meta.name = rootAttrs.biblename;

  for (const bm of text.matchAll(/<BIBLEBOOK\b([^>]*)>([\s\S]*?)<\/BIBLEBOOK>/gi)) {
    const ba = attrs(bm[1]);
    const bookVal = ba.bnumber ?? ba.bname ?? ba.bsname;
    for (const cm of bm[2].matchAll(/<CHAPTER\b([^>]*)>([\s\S]*?)<\/CHAPTER>/gi)) {
      const ca = attrs(cm[1]);
      const chapter = ca.cnumber;
      // CAPTION(표제)은 다음에 나오는 절 앞에 붙인다
      const tokenRe = /<CAPTION\b([^>]*)>([\s\S]*?)<\/CAPTION>|<VERS\b([^>]*)>([\s\S]*?)<\/VERS>|<VERS\b([^>]*)\/>/gi;
      let pendingCaptions = [];
      for (const t of cm[2].matchAll(tokenRe)) {
        if (t[2] !== undefined) {
          pendingCaptions.push(cleanDisplayText(decodeEntities(t[2].replace(/<[^>]+>/g, ''))));
        } else {
          const va = attrs(t[3] ?? t[5]);
          const { text: vt, notes } = splitVerseContent(t[4] ?? '');
          out.verses.push({ bookRaw: bookVal, chapter, verse: va.vnumber, text: vt });
          for (const c of pendingCaptions) out.headings.push({ bookRaw: bookVal, chapter, verse: va.vnumber, text: c });
          pendingCaptions = [];
          for (const n of notes) out.notes.push({ bookRaw: bookVal, chapter, verse: va.vnumber, text: n });
        }
      }
    }
  }
  report.format = 'Zefania XML';
  return out;
}

// ---------- 베들레헴 성경 (.bdb, SQLite) ----------
// 테이블 Bible(book, chapter, verse, btext). 번역본에 따라 본문 안에
//  - 단락 표제 "<세계의 시작>" (쉬운성경), 시편 권 표시 "[제1권]"
//  - 각주 표시 "*", "[a]" 와 본문 뒤 " / *각주 내용" (NIV 등)
// 이 섞여 있어 표제·각주를 본문과 분리한다. 시편 표제 "[다윗의 시]" 는 원래 1절 본문이므로 그대로 둔다.
function splitBethlehemText(raw) {
  let text = String(raw ?? '').replace(/\r?\n/g, ' ');
  const headings = [];
  const notes = [];
  // 본문 뒤 각주: " / *내용 / **내용"
  const slash = text.search(/\s\/\s*\*/);
  if (slash >= 0) {
    for (const n of text.slice(slash).split(/\s\/\s*/)) {
      const t = n.replace(/^\*+\s*/, '').trim();
      if (t) notes.push(t);
    }
    text = text.slice(0, slash);
  }
  // 앞쪽 표제: [제1권], [2권], <제목> (여러 개 가능)
  let m;
  while ((m = text.match(/^\s*(\[(?:제\s*)?\d+\s*권\]|<([^<>a-zA-Z\/][^<>]*)>)\s*/))) {
    headings.push((m[2] ?? m[1].slice(1, -1)).trim());
    text = text.slice(m[0].length);
  }
  // 본문 중간의 <제목> (쉬운성경)
  text = text.replace(/<([^<>a-zA-Z\/][^<>]*)>\s*/g, (_, h) => { headings.push(h.trim()); return ''; });
  // 각주 표시 제거
  text = text.replace(/\[[a-z]{1,2}\]/g, '').replace(/\*+/g, '');
  return { text, headings, notes };
}

function parseBethlehem(filePath, report) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='Bible'").get();
    if (!t) throw new Error('베들레헴 성경 형식(Bible 테이블)이 아닙니다. 주석(.cdb)·사전 파일은 가져올 수 없습니다.');
    const out = { meta: { name: path.basename(filePath, path.extname(filePath)).replace(/^\d{10,}-/, '') }, verses: [], headings: [], notes: [] };
    let nh = 0, nn = 0;
    for (const r of db.prepare('SELECT book, chapter, verse, btext FROM Bible ORDER BY book, chapter, verse').all()) {
      const s = splitBethlehemText(r.btext);
      // NIV 등은 사본상 논란이 있는 절(마 17:21 등)을 본문 없이 각주로만 둔다
      out.verses.push({ bookRaw: r.book, chapter: r.chapter, verse: r.verse, text: s.text, noteOnly: !s.text.trim() && s.notes.length > 0 });
      for (const h of s.headings) { out.headings.push({ bookRaw: r.book, chapter: r.chapter, verse: r.verse, text: h }); nh++; }
      for (const n of s.notes) { out.notes.push({ bookRaw: r.book, chapter: r.chapter, verse: r.verse, text: n }); nn++; }
    }
    report.format = '베들레헴 성경 (.bdb)';
    report.encoding = 'UTF-8 (SQLite)';
    if (nh) report.notes.push(`본문 안의 단락 표제 ${nh}개를 본문과 분리했습니다. (템플릿에서 표시 여부 선택)`);
    if (nn) report.notes.push(`본문 안의 각주 ${nn}개를 분리하고 각주 표시(*, [a])를 지웠습니다.`);
    return out;
  } finally {
    db.close();
  }
}

// ---------- 검증 ----------
const MAX_LIST = 30;

function addIssue(list, msg) {
  if (list.length < MAX_LIST) list.push(msg);
  else if (list.length === MAX_LIST) list.push('… (이하 생략)');
}

function validate(parsed, report) {
  const verses = [];
  const keys = new Set();
  const unknownBooks = new Set();
  for (const r of parsed.verses) {
    const where = r.line ? `${r.line}행` : `${r.bookRaw ?? '?'} ${r.chapter}:${r.verse}`;
    const book = bookFrom(r.bookRaw, r.bookIndex);
    if (!book) { unknownBooks.add(String(r.bookRaw)); continue; }
    const chapter = Number(r.chapter), verse = Number(r.verse);
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > 200) { addIssue(report.errors, `장 번호 오류: ${where}`); continue; }
    if (!Number.isInteger(verse) || verse < 0 || verse > 200) { addIssue(report.errors, `절 번호 오류: ${where}`); continue; }
    if (verse === 0) { addIssue(report.warnings, `0절(시편 표제 등)은 본문에서 제외했습니다: ${book.name} ${chapter}:0`); continue; }
    const text = cleanDisplayText(r.text);
    if (!text && r.noteOnly) { addIssue(report.warnings, `원본에 본문이 없는 절(각주만 있음, 제외): ${book.name} ${chapter}:${verse}`); continue; }
    if (!text) { addIssue(report.errors, `본문 누락: ${book.name} ${chapter}:${verse}`); continue; }
    if (/�/.test(text)) addIssue(report.warnings, `깨진 문자(인코딩 확인 필요): ${book.name} ${chapter}:${verse}`);
    const k = `${book.id}:${chapter}:${verse}`;
    if (keys.has(k)) { addIssue(report.errors, `중복 구절: ${book.name} ${chapter}:${verse}`); continue; }
    keys.add(k);
    verses.push({ book: book.id, chapter, verse, text });
  }
  for (const b of unknownBooks) addIssue(report.errors, `알 수 없는 책 이름/번호: '${b}'`);

  // 장·절 연속성 검사 (누락 구절)
  const struct = new Map();
  for (const v of verses) {
    if (!struct.has(v.book)) struct.set(v.book, new Map());
    const m = struct.get(v.book);
    if (!m.has(v.chapter)) m.set(v.chapter, new Set());
    m.get(v.chapter).add(v.verse);
  }
  for (const b of BOOKS) {
    const m = struct.get(b.id);
    if (!m) { addIssue(report.warnings, `책 없음: ${b.name}`); continue; }
    const maxCh = Math.max(...m.keys());
    if (maxCh !== b.chapters) addIssue(report.warnings, `${b.name}: ${maxCh}장 (표준 ${b.chapters}장)`);
    for (let c = 1; c <= maxCh; c++) {
      const set = m.get(c);
      if (!set) { addIssue(report.errors, `장 누락: ${b.name} ${c}장`); continue; }
      const maxV = Math.max(...set);
      const missing = [];
      for (let v = 1; v <= maxV; v++) if (!set.has(v)) missing.push(v);
      if (missing.length) addIssue(report.warnings, `절 번호 누락: ${b.name} ${c}장 ${missing.slice(0, 5).join(',')}${missing.length > 5 ? '…' : ''}절 (원본 편집 체계일 수 있음)`);
    }
  }

  const headings = [];
  for (const h of parsed.headings) {
    const book = bookFrom(h.bookRaw);
    if (book && h.text) headings.push({ book: book.id, chapter: Number(h.chapter), verse: Number(h.verse) || 1, text: cleanDisplayText(h.text) });
  }
  const notes = [];
  for (const n of parsed.notes) {
    const book = bookFrom(n.bookRaw);
    if (book && n.text) notes.push({ book: book.id, chapter: Number(n.chapter), verse: Number(n.verse), text: cleanDisplayText(n.text) });
  }
  verses.sort((a, b) => a.book - b.book || a.chapter - b.chapter || a.verse - b.verse);
  report.stats = { verses: verses.length, books: struct.size, headings: headings.length, notes: notes.length };
  return { verses, headings, notes };
}

function validateMeta(meta) {
  const errors = [];
  if (!meta.id || !/^[a-z0-9_-]{2,32}$/i.test(meta.id)) errors.push('번역본 ID는 영문·숫자·-·_ 2~32자로 입력하세요. (예: krv)');
  if (!meta.name || !String(meta.name).trim()) errors.push('번역본 이름을 입력하세요.');
  if (!meta.source || !String(meta.source).trim()) errors.push('데이터 출처를 입력하세요.');
  if (!meta.license || !String(meta.license).trim()) errors.push('사용 허가(라이선스) 정보를 입력하세요. 권리 확인이 안 된 번역본은 가져올 수 없습니다.');
  return errors;
}

/** 파일을 읽어 분석한다. DB는 건드리지 않는다. */
function analyzeFile(filePath) {
  const report = { file: path.basename(filePath), format: '', encoding: '', errors: [], warnings: [], notes: [], stats: {} };
  const buf = fs.readFileSync(filePath);
  if (buf.subarray(0, 16).toString('latin1') === 'SQLite format 3\0') {
    let parsed;
    try { parsed = parseBethlehem(filePath, report); } catch (e) {
      report.errors.push('파일을 해석할 수 없습니다: ' + e.message);
      return { report, data: null, meta: {} };
    }
    const data = validate(parsed, report);
    return { report, data, meta: parsed.meta };
  }
  const dec = decodeBuffer(buf);
  report.encoding = dec.encoding;
  if (dec.converted) report.notes.push('UTF-8이 아니어서 EUC-KR(CP949)로 변환했습니다. 본문이 올바르게 보이는지 확인하세요.');
  const text = dec.text;
  const ext = path.extname(filePath).toLowerCase();
  let parsed;
  try {
    if (ext === '.json' || /^\s*[[{]/.test(text)) parsed = parseJson(text, report);
    else if (ext === '.xml' || /^\s*<\?xml|<XMLBIBLE/i.test(text)) parsed = parseZefania(text, report);
    else if (ext === '.csv' || ext === '.tsv' || ext === '.txt') parsed = parseCsv(text, report);
    else throw new Error('지원하지 않는 파일 형식입니다. (JSON, CSV, Zefania XML)');
  } catch (e) {
    report.errors.push('파일을 해석할 수 없습니다: ' + e.message);
    return { report, data: null, meta: {} };
  }
  const data = validate(parsed, report);
  if (!data.verses.length) report.errors.push('가져올 수 있는 구절이 없습니다.');
  return { report, data, meta: parsed.meta || {} };
}

/** 분석 결과를 DB에 반영. 오류가 있거나 메타데이터가 불완전하면 아무것도 바꾸지 않는다. */
function commitImport(store, analysis, meta) {
  const metaErrors = validateMeta(meta);
  if (metaErrors.length) return { ok: false, errors: metaErrors };
  if (!analysis.data || analysis.report.errors.length) return { ok: false, errors: ['검증 오류가 있어 가져올 수 없습니다.', ...analysis.report.errors] };
  store.replaceVersion(
    { id: meta.id.trim(), name: String(meta.name).trim(), language: meta.language || 'ko', copyright: meta.copyright || '', license: meta.license, source: meta.source },
    analysis.data.verses, analysis.data.headings, analysis.data.notes,
  );
  return { ok: true, stats: analysis.report.stats };
}

module.exports = { analyzeFile, commitImport, validateMeta, decodeBuffer, parseCsvRows, splitBethlehemText };
