'use strict';
// 주석(EPUB) → 절 단위 주석 데이터베이스
//
// 대상: 스캔본을 글자로 바꾼(OCR) EPUB 처럼 구조 정보가 거의 없는 주석서.
// 본문 속 "1:1 태초에." 같은 절 표시를 찾아 항목을 나누고, 책 경계는
//   ① 장 번호가 1장으로 되돌아가는 지점 ② 근처 쪽머리 제목(오타 섞인 책 이름)과의 유사도 ③ 성경 순서
// 를 함께 써서 정한다. 결과는 참고용이며, 원문의 OCR 오류·단 섞임은 그대로 남는다.

const fs = require('fs');
const zlib = require('zlib');
const { BOOKS } = require('./books');

// ---------- 최소 ZIP 읽기 (EPUB 은 ZIP) ----------
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP(EPUB) 형식이 아닙니다.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    files.set(name, { method, csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: [...files.keys()],
    read(name) {
      const f = files.get(name);
      if (!f) return null;
      const lp = f.local;
      const start = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28);
      const data = buf.subarray(start, start + f.csize);
      return f.method === 0 ? data : zlib.inflateRawSync(data);
    },
  };
}

function decode(s) {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/** EPUB 의 본문 XHTML 들을 읽기 순서대로 이어 붙여 [{type:'h'|'p', text}] 로 */
function epubBlocks(file) {
  const z = readZip(file);
  const container = z.read('META-INF/container.xml')?.toString('utf8') || '';
  const opfPath = (container.match(/full-path="([^"]+)"/) || [])[1] || z.names.find(n => n.endsWith('.opf'));
  const opf = z.read(opfPath).toString('utf8');
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map([...opf.matchAll(/<item\b[^>]*>/g)].map(m => [(m[0].match(/id="([^"]+)"/) || [])[1], (m[0].match(/href="([^"]+)"/) || [])[1]]));
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map(m => manifest.get(m[1])).filter(Boolean);
  const title = decode((opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/) || [])[1] || '').trim();
  const blocks = [];
  for (const href of spine) {
    if (/nav/i.test(href)) continue;
    const html = z.read(base + decodeURIComponent(href))?.toString('utf8') || '';
    const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
    for (const m of body.matchAll(/<(h[1-6]|p|li|div)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const text = decode(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      if (text) blocks.push({ type: m[1][0].toLowerCase() === 'h' ? 'h' : 'p', text });
    }
  }
  return { title, blocks };
}

// ---------- 책 이름 유사도 (OCR 오타 허용) ----------
const hangul = s => s.replace(/[^가-힣]/g, '');
function lcs(a, b) {
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}
/** 쪽머리 글자가 어느 책 이름에 가까운지 (0~1) */
function bookScore(head, book) {
  const h = hangul(head);
  const n = book.name;
  if (h.length < 2) return 0;
  if (h.includes(n)) return 1;
  const l = lcs(h.slice(0, n.length + 2), n);
  return l / Math.max(n.length, 2);
}

// ---------- 절 표시 찾기 ----------
// "1:1 태초에." "1:1-5저녁과 아침." "1:1-2:3 창조" 처럼 장:절 뒤에 짧은 표제가 오는 형태
const MARK = /(^|[^\d:가-힣A-Za-z(])(\d{1,3})\s?[:：]\s?(\d{1,3})(?:\s?[-–~]\s?(\d{1,3})(?:\s?[:：]\s?(\d{1,3}))?)?(?![\d:])/g;
// 바로 앞에 책 이름·약어가 있으면 다른 곳을 가리키는 참조 (예: "출 3:14", "(요 1:1")
const REF_BEFORE = new RegExp('(?:' + BOOKS.flatMap(b => [b.name, b.short]).sort((a, b) => b.length - a.length).join('|') + ')[ \\t]?$');

function findMarks(text) {
  const out = [];
  for (const m of text.matchAll(MARK)) {
    const at = m.index + m[1].length;
    // 같은 줄 안에서만 본다 (윗줄의 쪽머리 '창세기' 바로 뒤 1:1 은 참조가 아님)
    const line = text.slice(Math.max(0, at - 8), at);
    const before = line.slice(line.lastIndexOf('\n') + 1);
    if (REF_BEFORE.test(before)) continue;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 4);
    if (/^\s*[)\]절장편참]/.test(after)) continue; // "3:16절", "1:1)" 등은 참조
    const sc = +m[2], sv = +m[3];
    let ec = sc, ev = sv;
    if (m[4] !== undefined && m[5] !== undefined) { ec = +m[4]; ev = +m[5]; } else if (m[4] !== undefined) ev = +m[4];
    if (sv < 1 || ev < sv && ec === sc || ec < sc) continue;
    out.push({ at, end: m.index + m[0].length, sc, sv, ec, ev });
  }
  return out;
}

/**
 * 블록 목록 → 주석 항목
 * @returns {entries:[{book, sc, sv, ec, ev, title, text}], articles:[{book, sc, sv, title, text}], stats}
 */
function parseCommentary(blocks) {
  // 1) 하나의 긴 글로 이어 붙이고, 제목(h) 위치를 기억
  let text = '';
  const heads = [];
  for (const b of blocks) {
    if (b.type === 'h') heads.push({ at: text.length, text: b.text });
    text += (b.type === 'h' ? '\n§ ' : '\n') + b.text;
  }
  const marks = findMarks(text);

  // 2) 쪽머리 제목마다 가장 가까운 책 후보 (점수 0.67 이상)
  const headBooks = heads.map(h => {
    let best = null;
    for (const bk of BOOKS) {
      const s = bookScore(h.text, bk);
      if (s >= 0.67 && (!best || s > best.s)) best = { s, id: bk.id };
    }
    return best ? { at: h.at, id: best.id, s: best.s, text: h.text } : null;
  }).filter(Boolean);

  // 3) 본문 시작: '창세기' 쪽머리 뒤 첫 1:1
  const genHead = headBooks.find(h => h.id === 1 && h.s >= 0.99);
  const startAt = genHead ? genHead.at : 0;
  const ms = marks.filter(m => m.at >= startAt);
  const s0 = ms.findIndex(m => m.sc === 1 && m.sv <= 2);
  const seq = s0 >= 0 ? ms.slice(s0) : [];

  // 4) 장 번호가 1장으로 되돌아가는 곳(앞쪽 표시들의 중앙값이 3장 이상)을 책 경계 후보로
  const cuts = [0];
  for (let i = 1; i < seq.length; i++) {
    const m = seq[i];
    if (!(m.sc === 1 && m.sv <= 3)) continue;
    const prev = seq.slice(Math.max(cuts[cuts.length - 1], i - 9), i).map(x => x.sc).sort((a, b) => a - b);
    if (prev.length >= 3 && prev[prev.length >> 1] >= 3) cuts.push(i);
  }
  cuts.push(seq.length);
  // 표시가 12개도 안 되는 작은 구간은 잡음 → 다음 구간과 합친다
  for (let k = cuts.length - 2; k >= 1; k--) {
    if (cuts[k + 1] - cuts[k] < 12 || cuts[k] - cuts[k - 1] < 12) cuts.splice(k, 1);
  }

  // 5) 구간 → 책 배정을 전체에서 한꺼번에 최적화 (동적 계획법)
  //    점수 = 구간 안 쪽머리 제목 득표 + 구간의 장 번호가 그 책의 장 수와 맞는 정도
  //    제약 = 성경 순서(뒤로 가지 않음). 책 건너뛰기·같은 책 반복에는 작은 벌점
  const S = cuts.length - 1;
  const segInfo = [];
  for (let k = 0; k < S; k++) {
    const from = seq[cuts[k]].at;
    const to = cuts[k + 1] < seq.length ? seq[cuts[k + 1]].at : text.length;
    const votes = new Array(67).fill(0);
    // 다음 책의 첫 쪽머리는 앞 구간 끝에 붙어 나오므로, 구간 시작 2500자 앞 ~ 끝 2500자 앞까지만 센다
    const lo = from - 2500, hi2 = Math.max(from + 500, to - 2500);
    for (const h of headBooks) {
      if (h.at < lo || h.at >= hi2) continue;
      const strong = /\d+\s?:\s?\d+/.test(h.text) ? 2.5 : 1; // "창세기3:2-14" 처럼 장절이 붙은 쪽머리는 더 믿을 만함
      votes[h.id] += h.s * strong;
    }
    // 이 구간이 몇 장까지 다루는지: 두 번 이상 나온 장 번호 중 가장 큰 값 (단 섞임으로 끼어든 한두 개는 무시)
    const cnt = new Map();
    for (let i = cuts[k]; i < cuts[k + 1]; i++) cnt.set(seq[i].sc, (cnt.get(seq[i].sc) || 0) + 1);
    // 두 번 이상 나온 장 번호들의 분포: 아래 10%(시작 장)와 위 90%(끝 장)
    const vals = [];
    for (let i = cuts[k]; i < cuts[k + 1]; i++) if (cnt.get(seq[i].sc) >= 2 && seq[i].sc <= 150) vals.push(seq[i].sc);
    vals.sort((a, b) => a - b);
    const q = p => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 1);
    // 시작 장이 높으면(예: 12장부터) 앞 책이 이어지는 구간 (본문 속 "1:1" 참조 때문에 잘린 것)
    segInfo.push({ votes, maxCh: q(0.9), minCh: q(0.05), size: cuts[k + 1] - cuts[k] });
  }
  const NEG = -1e9;
  const dp = Array.from({ length: S }, () => new Array(67).fill(NEG));
  const back = Array.from({ length: S }, () => new Array(67).fill(0));
  const local = (k, b) => {
    const bk = BOOKS[b - 1], si = segInfo[k];
    let sc = Math.min(si.votes[b], 10) * 1.5;
    const over = si.maxCh - bk.chapters;
    if (over > 2) sc -= 8 + over;            // 장 수를 크게 넘으면 그 책일 수 없음
    else if (over > 0) sc -= 1.5 * over;     // 한두 장 넘는 것은 단 섞임 잡음일 수 있음
    else sc -= 6 * (bk.chapters - si.maxCh) / bk.chapters; // 장 수가 비슷할수록 좋음
    return sc;
  };
  for (let b = 1; b <= 66; b++) dp[0][b] = local(0, b) - (b - 1) * 2; // 첫 구간은 창세기 쪽으로
  for (let k = 1; k < S; k++) {
    for (let b = 1; b <= 66; b++) {
      const l = local(k, b);
      let best = NEG, arg = 0;
      for (let p = Math.max(1, b - 10); p <= b; p++) {
        if (dp[k - 1][p] === NEG) continue;
        const cont = segInfo[k].minCh >= 6; // 이어지는 구간처럼 보임 (앞쪽 장이 거의 없음)
        const pen = p === b ? (cont ? 0 : 1.5) : (b - p - 1) * 1.2 + (cont ? 4 : 0); // 같은 책 반복 / 건너뛴 책 수
        const v = dp[k - 1][p] - pen;
        if (v > best) { best = v; arg = p; }
      }
      if (arg) { dp[k][b] = best + l; back[k][b] = arg; }
    }
  }
  let endB = 1;
  for (let b = 1; b <= 66; b++) if (dp[S - 1][b] > dp[S - 1][endB]) endB = b;
  const assign = new Array(S);
  for (let k = S - 1, b = endB; k >= 0; k--) { assign[k] = b; b = back[k][b]; }
  const segments = assign.map((book, k) => ({ from: cuts[k], to: cuts[k + 1], book }));

  // 6) 구간 안에서 순서·장 수에 맞는 표시만 항목으로 (뒤로 가는 번호는 본문 속 참조로 본다)
  //    한 책에 처음부터 시작하는 구간이 여럿이면 가장 큰 구간을 본문으로, 그 뒤 이어지는 구간까지만 쓴다
  const primary = new Map();
  segments.forEach((sg, k) => {
    if (segInfo[k].minCh >= 6) return;
    const p = primary.get(sg.book);
    if (p === undefined || segInfo[k].size > segInfo[p].size) primary.set(sg.book, k);
  });
  const keep = segments.map((sg, k) => {
    const p = primary.get(sg.book);
    if (p === undefined) return true;
    if (k === p) return true;
    if (k < p) return false;
    for (let j = p + 1; j <= k; j++) if (segments[j].book !== sg.book || segInfo[j].minCh < 6) return false;
    return true;
  });
  const accepted = [];
  let lastBook = 0, lastC = 0, lastV = 0;
  for (const [k, sg] of segments.entries()) {
    if (!keep[k]) continue;
    const book = BOOKS[sg.book - 1];
    if (sg.book !== lastBook) { lastC = 0; lastV = 0; lastBook = sg.book; }
    for (let i = sg.from; i < sg.to; i++) {
      const m = seq[i];
      if (m.sc > book.chapters || m.ec > book.chapters) continue;
      if (m.sc < lastC || (m.sc === lastC && m.sv < lastV - 2)) continue;
      if (lastC > 0 && m.sc > lastC + 3) continue; // 갑작스러운 큰 장 건너뜀은 참조일 가능성
      accepted.push({ ...m, book: sg.book });
      lastV = m.sc !== lastC ? m.sv : Math.max(lastV, m.sv);
      lastC = m.sc;
    }
  }

  // 4) 항목 글: 표시 다음부터 다음 표시까지. 첫 마침표까지(짧으면)를 표제로
  const entries = [];
  for (let i = 0; i < accepted.length; i++) {
    const a = accepted[i];
    const end = i + 1 < accepted.length ? accepted[i + 1].at : Math.min(text.length, a.end + 4000);
    let body = text.slice(a.end, end).replace(/\n§ [^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
    let title = '';
    const tm = body.match(/^([^.。\n]{1,30})[.。]\s*/);
    if (tm && !/\d{2,}/.test(tm[1])) { title = tm[1].trim(); body = body.slice(tm[0].length); }
    else {
      // "1:1-2:3 창조 1:1 …" 같은 단락 제목: 다음 표시가 바로 붙어 있으면 제목만 있는 항목
      const sm = body.match(/^([가-힣A-Za-z ·,]{1,24})$/);
      if (sm) { title = sm[1].trim(); body = ''; }
    }
    if (!body && !title) continue;
    entries.push({ book: a.book, sc: a.sc, sv: a.sv, ec: a.ec, ev: a.ev, title, text: body.slice(0, 6000) });
  }

  // 5) 상자 글(쪽머리가 아닌 긴 제목 + 그 뒤 문단): 가장 가까운 앞 항목의 위치에 붙인다
  const articles = [];
  for (const h of heads) {
    const t = h.text.trim();
    if (t.length < 5 || t.length > 30 || /\d/.test(t) || BOOKS.some(b => bookScore(t, b) >= 0.67)) continue;
    if (!/[가-힣]{2,}\s?[가-힣]{2,}/.test(t)) continue;
    const prev = [...accepted].reverse().find(x => x.at < h.at);
    if (!prev) continue;
    const nextBreak = text.indexOf('\n§ ', h.at + 3);
    const body = text.slice(h.at, nextBreak > 0 ? Math.min(nextBreak, h.at + 5000) : h.at + 5000).replace(/^\n§ [^\n]*/, '').replace(/\s+/g, ' ').trim();
    if (body.length < 80) continue;
    articles.push({ book: prev.book, sc: prev.sc, sv: prev.sv, ec: prev.ec, ev: prev.ev, title: t, text: body });
  }

  // 통계
  const perBook = new Map();
  for (const e of entries) {
    if (!perBook.has(e.book)) perBook.set(e.book, { n: 0, chapters: new Set() });
    const s = perBook.get(e.book); s.n++; s.chapters.add(e.sc);
  }
  const stats = BOOKS.map(b => {
    const s = perBook.get(b.id);
    return { id: b.id, name: b.name, entries: s ? s.n : 0, chapters: s ? s.chapters.size : 0, of: b.chapters };
  });
  const debugSegments = segments.map((sg, k) => ({
    book: BOOKS[sg.book - 1].name, maxCh: segInfo[k].maxCh, size: segInfo[k].size, at: seq[sg.from].at,
    top: segInfo[k].votes.map((v, id) => [id, v]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, v]) => `${BOOKS[id - 1].short}${v.toFixed(1)}`).join(' '),
  }));
  return { entries, articles, stats, marks: marks.length, debugSegments };
}

function analyzeEpub(file) {
  const { title, blocks } = epubBlocks(file);
  const r = parseCommentary(blocks);
  return { title, ...r };
}

module.exports = { analyzeEpub, parseCommentary, epubBlocks, readZip };
