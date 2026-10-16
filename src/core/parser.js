'use strict';
// 장절 파서: "요3:16", "요한복음 3장 16절", "행5:27-32", "롬 8", "창1:1-2:3", "롬8:1,28" 등을 해석한다.
// 책 존재 여부와 장·절 형식만 검사하며, 실제 장·절 존재 여부는 DB(BibleStore.resolve)에서 확인한다.

const { resolveBook } = require('./books');

const KOREAN_ORDINAL = { 1: '일', 2: '이', 3: '삼' };

function normalizeInput(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/[　 ]/g, ' ')
    .replace(/[~～〜–—−]/g, '-')
    .replace(/[：]/g, ':')
    .trim();
}

/**
 * 입력을 책 부분과 장절 부분으로 나눈다.
 * 책 이름 안에 숫자가 들어가는 경우("요한1서", "1 John")도 처리한다.
 */
function splitBookAndRest(s) {
  // "요한1서 3:16" → "요한일서 3:16"
  s = s.replace(/^(요한)\s*([123])\s*서/, (_, a, n) => a + KOREAN_ORDINAL[n] + '서');
  // 영문 "1 John 3:16", "1John3:16"
  const m = s.match(/^(\d?\s*[^\d\s:.,\-][^\d:,\-]*?)\s*(\d.*)?$/);
  if (!m) return null;
  return { bookPart: m[1].trim(), rest: (m[2] || '').trim() };
}

/**
 * 띄어쓰기로 장·절을 구분한 입력을 "장:절" 형식으로 바꾼다.
 *   "3 16" → 3:16, "3 16-18"·"3 16 18" → 3:16-18, "1 1 2 3" → 1:1-2:3
 * 콜론·장·절·쉼표 등 다른 구분자가 있으면 그대로 둔다.
 */
function spacesToColon(rest) {
  const r = rest.trim().replace(/\s*-\s*/g, '-');
  if (/[:장절.,，、;]/.test(r)) return rest;
  const t = r.split(/\s+/);
  if (t.length < 2 || !t.every(x => /^\d+(-\d+)?$/.test(x))) return rest;
  if (t.length === 2) return `${t[0]}:${t[1]}`;
  // "3 16-4 2" → 3:16-4:2 (장을 넘는 범위)
  if (t.length === 3 && !t[0].includes('-') && /^\d+-\d+$/.test(t[1]) && !t[2].includes('-')) {
    const [v1, c2] = t[1].split('-');
    return `${t[0]}:${v1}-${c2}:${t[2]}`;
  }
  if (t.length === 3 && !t.some(x => x.includes('-'))) return `${t[0]}:${t[1]}-${t[2]}`;
  if (t.length === 4 && !t.some(x => x.includes('-'))) return `${t[0]}:${t[1]}-${t[2]}:${t[3]}`;
  return rest;
}

function normalizeRest(rest) {
  let r = spacesToColon(rest).replace(/\s+/g, '');
  r = r.replace(/장(?=\d)/g, ':').replace(/장/g, '').replace(/절/g, '');
  r = r.replace(/(\d)\.(\d)/g, '$1:$2');
  r = r.replace(/[,，、;]+/g, ',').replace(/^,|,$/g, '');
  return r;
}

const SEG = /^(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/;

/**
 * @returns {{ok:true, book, ranges:Array<{sc,sv,ec,ev}>}}  sv/ev 가 null 이면 장 전체(처음/끝)
 *        | {ok:false, error, candidates?, incomplete?, book?}
 */
function parseReference(input) {
  const s = normalizeInput(input);
  if (!s) return { ok: false, error: '검색어를 입력하세요.' };
  const parts = splitBookAndRest(s);
  if (!parts || !parts.bookPart) return { ok: false, error: '성경 책 이름을 인식할 수 없습니다.' };

  const { book, candidates } = resolveBook(parts.bookPart);
  if (!book) {
    if (candidates.length > 1) {
      return { ok: false, ambiguous: true, candidates, rest: parts.rest, error: `'${parts.bookPart}'에 해당하는 책이 여러 권입니다. 후보에서 선택하세요.` };
    }
    return { ok: false, error: `'${parts.bookPart}'은(는) 알 수 없는 성경 책 이름입니다.` };
  }
  if (!parts.rest) {
    return { ok: false, incomplete: true, book, error: `${book.name}: 장을 입력하세요. (예: ${book.short}1:1)` };
  }

  const rest = normalizeRest(parts.rest);
  if (!rest) return { ok: false, incomplete: true, book, error: `${book.name}: 장을 입력하세요.` };

  const ranges = [];
  let ctxChapter = null; // 직전 구간이 "장:절" 형식이었으면 이후의 단독 숫자는 절로 해석
  for (const seg of rest.split(',')) {
    const m = seg.match(SEG);
    if (!m) return { ok: false, book, error: `'${parts.rest}' 장절 형식을 인식할 수 없습니다. (예: 요3:16, 행5:27-32)` };
    const a = +m[1];
    const b = m[2] !== undefined ? +m[2] : null;
    const c = m[3] !== undefined ? +m[3] : null;
    const d = m[4] !== undefined ? +m[4] : null;
    let r;
    if (b === null && d === null) {
      if (ctxChapter !== null) {
        r = { sc: ctxChapter, sv: a, ec: ctxChapter, ev: c ?? a }; // "8:1,28" 의 28
      } else if (book.singleChapter) {
        r = { sc: 1, sv: a, ec: 1, ev: c ?? a }; // "유 3" → 유다서 1:3
        ctxChapter = 1;
      } else {
        r = { sc: a, sv: null, ec: c ?? a, ev: null }; // "롬 8", "롬 8-9"
      }
    } else if (b !== null && d === null) {
      // a:b 또는 a:b-c(같은 장)
      r = { sc: a, sv: b, ec: a, ev: c ?? b };
      ctxChapter = a;
    } else if (b !== null && d !== null) {
      r = { sc: a, sv: b, ec: c, ev: d }; // 창1:1-2:3
      ctxChapter = c;
    } else {
      // "1-2:3" → 1장 처음부터 2:3 까지
      r = { sc: a, sv: null, ec: c, ev: d };
      ctxChapter = c;
    }
    if (r.sc < 1 || r.ec < 1 || (r.sv !== null && r.sv < 1) || (r.ev !== null && r.ev < 1)) {
      return { ok: false, book, error: '장과 절 번호는 1 이상이어야 합니다.' };
    }
    if (r.ec < r.sc || (r.ec === r.sc && r.sv !== null && r.ev !== null && r.ev < r.sv)) {
      return { ok: false, book, error: '구절 범위의 끝이 시작보다 앞에 있습니다.' };
    }
    ranges.push(r);
  }
  return { ok: true, book, ranges };
}

/** 입력이 장절 검색처럼 보이는지(자동 모드 판별용) */
function looksLikeReference(input) {
  const s = normalizeInput(input);
  if (!/\d/.test(s)) return false;
  const p = parseReference(s);
  return p.ok || p.ambiguous === true || (p.book != null);
}

module.exports = { parseReference, looksLikeReference, normalizeInput };
