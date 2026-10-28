'use strict';
// AI 주보 → 큐시트
// 1) 주보 파일에서 글자를 꺼낸다 (hwp · hwpx · docx · txt). PDF·그림은 그대로 AI 에 보낸다
// 2) 오픈라우터(OpenRouter) API 로 예배 순서를 JSON 으로 받는다
// 3) 찬송가 번호는 등록한 찬송가 폴더의 PPT 로, 성경 장절은 성경 DB 로 확인해 큐시트로 만든다

const zlib = require('zlib');
const path = require('path');
const { readCfb } = require('./ppt');
const { readZip } = require('./pptrender');

const RECOMMENDED = [
  { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5 — 추천 (빠르고 쌈, 한국어·표 정리 잘함)' },
  { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna — 비슷한 가격대' },
  { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash — PDF·사진 주보에 강함' },
  { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5 — 복잡한 주보용 (더 정확, 약 20배 비쌈)' },
];
const DEFAULT_MODEL = RECOMMENDED[0].id;

// ---------------- 글자 꺼내기 ----------------
/** 한글(HWP 5) 본문 글자 */
function hwpText(buf) {
  const c = readCfb(buf);
  const hdr = c.stream('FileHeader');
  if (!hdr) throw new Error('한글 파일 형식이 아닙니다.');
  const compressed = hdr.readUInt32LE(36) & 1;
  if (hdr.readUInt32LE(36) & 2) throw new Error('암호가 걸린 한글 파일입니다.');
  const EXT = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  const lines = [];
  for (const s of c.names.filter(n => /^Section\d+$/.test(n)).sort()) {
    let b = c.stream(s);
    if (compressed) b = zlib.inflateRawSync(b);
    let o = 0;
    while (o + 4 <= b.length) {
      const h = b.readUInt32LE(o); o += 4;
      const tag = h & 0x3ff; let size = h >>> 20;
      if (size === 0xfff) { size = b.readUInt32LE(o); o += 4; }
      if (tag === 67) { // PARA_TEXT
        let t = '';
        for (let i = o; i + 1 < o + size;) {
          const ch = b.readUInt16LE(i);
          if (EXT.has(ch)) { i += 16; if (ch === 9) t += '\t'; continue; }
          if (ch === 13 || ch === 10) t += '\n'; else if (ch >= 32) t += String.fromCharCode(ch);
          i += 2;
        }
        if (t.trim()) lines.push(t.trim());
      }
      o += size;
    }
  }
  return lines.join('\n');
}

const xmlText = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** hwpx · docx (압축 XML) 글자 */
function zipXmlText(buf, kind) {
  const z = readZip(buf);
  const files = kind === 'hwpx'
    ? z.names.filter(n => /^Contents\/section\d+\.xml$/i.test(n)).sort()
    : ['word/document.xml'];
  const out = [];
  for (const f of files) {
    const x = z.get(f);
    if (!x) continue;
    const xml = x.toString('utf8');
    const paraTag = kind === 'hwpx' ? /<hp:p[ >][\s\S]*?<\/hp:p>/g : /<w:p[ >][\s\S]*?<\/w:p>/g;
    const textTag = kind === 'hwpx' ? /<hp:t[^>]*>([^<]*)<\/hp:t>/g : /<w:t[^>]*>([^<]*)<\/w:t>/g;
    for (const p of xml.match(paraTag) || []) {
      const t = [...p.matchAll(textTag)].map(m => xmlText(m[1])).join('');
      if (t.trim()) out.push(t.trim());
    }
  }
  return out.join('\n');
}

/**
 * 주보 파일 → { text } 또는 { file: { mime, base64, name } } (PDF·그림은 AI 가 직접 읽음)
 */
function readBulletin(buf, name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext === '.hwp') return { text: hwpText(buf) };
  if (ext === '.hwpx') return { text: zipXmlText(buf, 'hwpx') };
  if (ext === '.docx') return { text: zipXmlText(buf, 'docx') };
  if (ext === '.txt' || ext === '.md') return { text: buf.toString('utf8').replace(/^﻿/, '') };
  const mime = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext];
  if (mime) return { file: { mime, base64: buf.toString('base64'), name: path.basename(name) } };
  throw new Error('읽을 수 없는 파일입니다 (hwp · hwpx · docx · pdf · txt · 사진).');
}

// ---------------- AI 요청 ----------------
// 큐시트 JSON 형식과 규칙 (API 요청과 '채팅 AI' 프롬프트가 함께 쓴다)
const FORMAT = `{
  "name": "큐시트 이름 (예: 2026-10-11 주일성결예배)",
  "serviceDate": "YYYY-MM-DD 또는 빈 문자열",
  "startTime": "HH:MM (예배 시작 시각, 모르면 빈 문자열)",
  "items": [
    { "type": "title|hymn|bible|song|text|blank",
      "title": "화면 제목 (예: 묵도, 기도, 설교)",
      "subtitle": "제목 화면 아래 줄 (예: 김명수 정교 / 설교 제목 · 설교자)",
      "hymnNumber": 31, "hymnbook": "새찬송가 또는 구세군",
      "ref": "성경 장절 (예: 마 6:9-13)",
      "body": "공지 내용 (슬라이드는 '---' 줄로 나눔)",
      "note": "조작자 메모 (일어서기 *, 담당자 등)",
      "duration": 0 }
  ]
}`;
const RULES = `규칙:
- 찬송(가) 순서는 type "hymn" 과 hymnNumber. '예배로의 부름'처럼 찬송가를 부르는 순서도 hymn (title 은 '예배로의 부름').
- 성경봉독·본문은 type "bible" 과 ref (책 이름은 한국어 약칭 가능).
- 찬양팀·찬양대처럼 곡이 정해지지 않은 찬양은 type "title" (subtitle 에 찬양팀 이름).
- 교회소식·광고는 type "text" 하나로, body 에 항목마다 '---' 로 나눠 요약 (한 장에 3~4줄).
- 설교는 type "title", subtitle 에 "“설교 제목” · 설교자".
- 일어서는 순서(* 표시)는 note 에 "*일어서서".
- 기도·봉헌·축도 등 나머지는 type "title" 과 담당자 subtitle.
- 마지막에 { "type": "blank", "title": "예배 후" } 를 넣는다.
- 주보에 없는 내용은 지어내지 않는다.`;
const SYSTEM = `너는 한국 교회 예배 방송실을 돕는 도우미다. 주보에서 '예배 순서'(주일 낮/오전 예배를 우선)를 찾아 송출 큐시트 JSON 으로 만든다.
반드시 아래 JSON 하나만 출력한다 (설명·코드블록 없이).
${FORMAT}
${RULES}`;

// ---------------- 채팅 AI (키 없이): 프롬프트 · 샘플 파일 ----------------
const SAMPLE_NAME = 'WorshipCue-큐시트-샘플.json';
/** 샘플 큐시트 (가상 이름·예시) — 채팅 AI 에 형식을 보여 주는 용도 */
const SAMPLE = {
  _안내: 'WorshipCue 큐시트 형식 예시입니다. 주보의 예배 순서로 이 형식 그대로 새로 만들어 주세요. (이 파일의 내용은 예시일 뿐입니다)',
  name: '2026-10-18 주일 예배',
  serviceDate: '2026-10-18',
  startTime: '11:00',
  items: [
    { type: 'title', title: '예배로 부름', subtitle: '인도: 홍길동 목사', note: '' },
    { type: 'hymn', title: '찬송', hymnNumber: 8, hymnbook: '새찬송가', note: '*일어서서' },
    { type: 'title', title: '신앙고백', subtitle: '사도신경', note: '*일어서서' },
    { type: 'title', title: '대표기도', subtitle: '김철수 장로' },
    { type: 'bible', title: '성경봉독', ref: '시 23:1-6' },
    { type: 'title', title: '찬양', subtitle: '찬양대' },
    { type: 'title', title: '설교', subtitle: '“선한 목자” · 홍길동 목사', duration: 30 },
    { type: 'hymn', title: '찬송', hymnNumber: 310, hymnbook: '새찬송가' },
    { type: 'text', title: '교회 소식', body: '다음 주일은 추수감사주일로 지킵니다\n---\n수요예배: 저녁 7시 30분 본당\n---\n새가족 환영회: 예배 후 2층 교육관' },
    { type: 'title', title: '축도', subtitle: '홍길동 목사', note: '*일어서서' },
    { type: 'blank', title: '예배 후' },
  ],
};

/** 채팅 AI(ChatGPT·Claude·Gemini 등) 에 붙여 넣을 프롬프트 */
function chatPrompt(extra = '') {
  return `[WorshipCue 큐시트 만들기]
너는 한국 교회 예배 방송실을 돕는 도우미다. 첨부한 주보에서 '예배 순서'(주일 낮/오전 예배를 우선)를 찾아, 송출 프로그램 WorshipCue 가 불러올 큐시트 JSON 을 만들어 줘.
첨부한 샘플 파일(${SAMPLE_NAME})과 똑같은 형식으로 만든다. 샘플의 내용(이름·장절·찬송 번호)은 예시일 뿐이니 쓰지 말고, 주보 내용으로만 채운다.

형식:
${FORMAT}
${RULES}
- "_안내" 항목은 넣지 않는다.

답하는 법:
- JSON 하나만 \`\`\`json 코드 블록으로 답한다. 앞뒤 설명은 짧게.
- 파일을 만들 수 있으면 'WorshipCue-큐시트.json' 파일로 줘도 된다.
- 주보에서 읽기 어려운 부분은 지어내지 말고 note 에 "확인 필요" 라고 적는다.${extra ? `\n\n추가 요청: ${extra}` : ''}`;
}

/** 채팅 AI 가 쓴 답(글 전체 또는 파일 내용) → 큐시트 계획 */
function parseChatAnswer(text) {
  const t = String(text || '').replace(/^\ufeff/, '').trim();
  if (!t) throw new Error('AI 답을 붙여 넣거나 결과 파일을 불러오세요.');
  // 코드 블록이 있으면 그 안에서 (여러 개면 items 가 있는 것)
  const blocks = [...t.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)].map(m => m[1]);
  let plan = null;
  for (const b of [...blocks, t]) {
    try { const p = parseJson(b); if (p && (Array.isArray(p.items) || Array.isArray(p) || (p.cue && Array.isArray(p.cue.items)))) { plan = p; break; } } catch { /* 다음 */ }
  }
  if (!plan) throw new Error('AI 답에서 큐시트 JSON 을 찾지 못했습니다. AI 에게 "JSON 코드 블록 하나로 다시 답해 줘" 라고 해 보세요.');
  if (Array.isArray(plan)) plan = { items: plan };
  if (plan.cue && Array.isArray(plan.cue.items)) plan = plan.cue;
  delete plan._안내;
  if (!plan.items.length) throw new Error('예배 순서(items)가 비어 있습니다.');
  const isSample = JSON.stringify(plan.items) === JSON.stringify(SAMPLE.items);
  return { plan, isSample };
}

/** 응답 글에서 JSON 꺼내기 (코드블록·앞뒤 설명이 붙어도) */
function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* 아래에서 다시 */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('AI 응답을 해석하지 못했습니다.');
}

// ---------------- 규칙으로 바로 (AI 없이) ----------------
// 붙여 넣은 예배 순서 글 → 큐시트 계획 (AI 와 같은 JSON). 줄마다 하나의 순서.
//   "찬송 288장" · "성경봉독 요 3:16-18" · "교독문 1" · "찬양 은혜 아니면" · "설교 “선한 목자” 홍길동 목사" · "광고 …"
//   '*' 또는 '(일어서서)' → note,  "2026-10-18" · "11:00" 이 든 줄 → 날짜·시작 시각
const ORDER_SPLIT = /\s*(?:\/|\||·|•|→|➔)\s*/;
const BOOKS_KO = /^(창|출|레|민|신|수|삿|룻|삼상|삼하|왕상|왕하|대상|대하|스|느|에|욥|시|잠|전|아|사|렘|애|겔|단|호|욜|암|옵|욘|미|나|합|습|학|슥|말|마|막|눅|요|행|롬|고전|고후|갈|엡|빌|골|살전|살후|딤전|딤후|딛|몬|히|약|벧전|벧후|요일|요이|요삼|유|계)/;
/** 글 한 덩어리 → { name, serviceDate, startTime, items } (looksLikeRef(text) → bool 로 장절인지 확인) */
function parseOrderText(text, { looksLikeRef = () => false } = {}) {
  const plan = { name: '', serviceDate: '', startTime: '', items: [] };
  const src = String(text || '').replace(/\r/g, '').replace(/ /g, ' ');
  const lines = [];
  for (const raw of src.split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    // 한 줄에 여러 순서 ("찬송 8장 / 기도 / 성경봉독 시 23") — 장절 안의 ':' 는 건드리지 않는다
    for (const p of (ORDER_SPLIT.test(l) && !/^\d/.test(l) ? l.split(ORDER_SPLIT) : [l])) if (p.trim()) lines.push(p.trim());
  }
  for (let l of lines) {
    // 날짜 · 시작 시각 · 큐시트 이름 (첫 줄이 제목처럼 보이면)
    const dm = l.match(/(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})일?/);
    const tm = l.match(/(?:^|\D)([01]?\d|2[0-3])[:시]\s*([0-5]\d)분?(?!\d)/);
    if (dm && !plan.serviceDate) plan.serviceDate = `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}`;
    if (tm && !plan.startTime && !looksLikeRef(l)) plan.startTime = `${tm[1].padStart(2, '0')}:${tm[2]}`;
    if ((dm || /예배$|예배\s*순서|주보/.test(l)) && !plan.items.length && !/찬송|성경|교독|찬양|기도|광고/.test(l)) {
      if (!plan.name) plan.name = l.replace(/[\s|·•]*(예배\s*)?순서$/, '').replace(/\(?\s*\d{1,2}[:시]\s*[0-5]\d분?\s*\)?/, '').trim();
      continue;
    }
    // 번호 매김 · 일어서기 표시
    l = l.replace(/^(?:\d+[.)]|[①-⑳]|[-•*·]\s)\s*/, '');
    let note = '';
    if (/^\*|[*※]\s*$|\(일어서서\)|일어서서|[*※]\s*일어/.test(l)) { note = '*일어서서'; l = l.replace(/^\*+\s*|\s*[*※]+\s*$|\s*\(?일어서서\)?/g, '').trim(); }
    const memo = l.match(/[(（]([^()（）]*)[)）]\s*$/); // 끝의 괄호 → 메모
    const it = { type: 'title', title: '', subtitle: '', note };
    let m;
    if ((m = l.match(/교독문\s*(?:제\s*)?(\d+)\s*(?:번|장)?\s*(.*)$/))) {
      Object.assign(it, { type: 'reading', title: '교독문', hymnNumber: +m[1], subtitle: m[2].trim() });
    } else if ((m = l.match(/^(.*?)(새\s*찬송가|구세군\s*찬송가|구세군|통일\s*찬송가|찬송가|찬송)?\s*(?:제\s*)?(\d{1,3})\s*장\s*(.*)$/)) && (m[2] || /찬송|부름|송영|경배/.test(m[1]) || !m[1].trim())) {
      const book = /구세군/.test(m[2] || '') ? '구세군' : '새찬송가';
      const head = m[1].replace(/[:：\-–]\s*$/, '').trim();
      Object.assign(it, { type: 'hymn', title: head && !/^찬송/.test(head) ? head : '찬송', hymnNumber: +m[3], hymnbook: book, subtitle: m[4].trim() });
    } else if ((m = l.match(/^(성경\s*봉독|본문\s*말씀|본문|말씀\s*봉독|봉독|성경)\s*[:：\-–]?\s*(.+)$/)) && looksLikeRef(m[2])) {
      Object.assign(it, { type: 'bible', title: m[1].replace(/\s+/g, ''), ref: m[2].trim() });
    } else if (looksLikeRef(l) && BOOKS_KO.test(l.replace(/\s/g, '')) && /\d/.test(l)) {
      Object.assign(it, { type: 'bible', title: '성경봉독', ref: l });
    } else if ((m = l.match(/^(교회\s*소식|광고|알림|공지)\s*[:：\-–]?\s*(.*)$/))) {
      Object.assign(it, { type: 'text', title: m[1].replace(/\s+/g, ''), body: m[2].trim() });
    } else if ((m = l.match(/^(찬양|특송|헌금\s*송|봉헌\s*송|경배와\s*찬양|찬양\s*콘티|콘티)\s*[:：\-–]?\s*(.+)$/)) && !/찬양대|찬양팀\s*$/.test(m[2])) {
      // "찬양 은혜 아니면, 주님 다시 오실 때까지" → 곡마다 하나
      const songs = m[2].split(/\s*[,，、]\s*/).map(s => s.trim()).filter(Boolean);
      for (const s of songs) plan.items.push({ type: 'song', title: m[1].replace(/\s+/g, ''), song: s, note });
      continue;
    } else if ((m = l.match(/^(설교|말씀)\s*[:：\-–]?\s*(.*)$/))) {
      const t = m[2].trim();
      const q = t.match(/^[“"'‘「『]?(.+?)[”"'’」』]\s*[,·\-–]?\s*(.*)$/);
      Object.assign(it, { title: m[1], subtitle: q && /[“"'‘「『]/.test(t) ? `“${q[1]}” · ${q[2]}`.replace(/ · $/, '') : t });
    } else if (/^(예배\s*후|폐회|끝)$/.test(l)) {
      Object.assign(it, { type: 'blank', title: l });
    } else {
      // "대표기도  김철수 장로" · "기도 - 김철수" · "기도: 김철수" · "기도(김철수)"
      const sp = l.match(/^(.+?)\s*(?:[:：]|\s[-–]\s|\t|\s{2,})\s*(.+)$/) || l.match(/^(\S+)\s+(\S.*)$/);
      if (sp) Object.assign(it, { title: sp[1].trim(), subtitle: sp[2].trim() });
      else it.title = l;
    }
    if (memo && it.type === 'title' && it.subtitle.endsWith(memo[0].trim())) { it.subtitle = it.subtitle.slice(0, -memo[0].length).trim(); it.note = [it.note, memo[1].trim()].filter(Boolean).join(' / '); }
    plan.items.push(it);
  }
  if (!plan.name) plan.name = plan.serviceDate ? `${plan.serviceDate} 예배` : '새 예배';
  return plan;
}

const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** endpoint: 오픈라우터(기본) 또는 OpenAI 호환 주소 */
async function askAI({ apiKey, model, input, fetchImpl = fetch, extra = '', endpoint = DEFAULT_ENDPOINT }) {
  if (!apiKey) throw new Error('오픈라우터 API 키를 넣으세요.');
  const content = [];
  if (input.text) content.push({ type: 'text', text: `주보 내용:\n${input.text.slice(0, 60000)}` });
  if (input.file) {
    const url = `data:${input.file.mime};base64,${input.file.base64}`;
    if (input.file.mime === 'application/pdf') content.push({ type: 'file', file: { filename: input.file.name, file_data: url } });
    else content.push({ type: 'image_url', image_url: { url } });
    content.push({ type: 'text', text: '위 주보에서 예배 순서를 큐시트 JSON 으로 만들어 줘.' });
  }
  if (extra) content.push({ type: 'text', text: '추가 요청: ' + extra });
  const r = await fetchImpl(endpoint || DEFAULT_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/hahadark/WorshipCue', 'X-Title': 'WorshipCue' },
    body: JSON.stringify({ model: model || DEFAULT_MODEL, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }], temperature: 0.1, response_format: { type: 'json_object' } }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`오픈라우터 오류 (${r.status}): ${(body.error && body.error.message) || r.statusText}`);
  const msg = body.choices && body.choices[0] && body.choices[0].message;
  if (!msg || !msg.content) throw new Error('AI 응답이 비었습니다.');
  return { plan: parseJson(typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text || '').join('')), usage: body.usage || null, model: body.model || model };
}

/**
 * AI 가 만든 순서 → 큐시트 항목 (찬송가 파일 찾기 · 장절 확인)
 * resolveHymn(number, book) → { file, title } | null,  checkRef(ref) → passage title | null
 * resolveHymnal(number, book) → 베들레헴 가사 { kind:'hymn', title, lyrics, order, credit } | { kind:'reading', title, body } | null (PPT 가 없을 때)
 * resolveSong(name) → 라이브러리 찬양 { title, lyrics, order, credit } | null
 */
const safe = f => { try { return f(); } catch { return null; } };
function planToCue(plan, { resolveHymn, checkRef, resolveHymnal = () => null, resolveSong = () => null }) {
  const items = [];
  const warnings = [];
  for (const x of Array.isArray(plan.items) ? plan.items : []) {
    const title = String(x.title || '').trim();
    const base = { title: title || '순서', note: String(x.note || ''), duration: Number(x.duration) || 0 };
    if (x.type === 'hymn' && Number(x.hymnNumber)) {
      const h = resolveHymn(Number(x.hymnNumber), String(x.hymnbook || ''));
      const label = `${x.hymnNumber}장`;
      const bh = h ? null : safe(() => resolveHymnal(Number(x.hymnNumber), String(x.hymnbook || '')));
      if (h) items.push({ ...base, type: 'hymn', title: title && !/^\d+장/.test(title) && !/^찬송/.test(title) ? `${title} · ${label} ${h.title}` : `${label} ${h.title}`, file: h.file, number: Number(x.hymnNumber), background: 'default' });
      else if (bh && bh.kind === 'hymn') items.push({ ...base, type: 'song', title: title && !/^\d+장/.test(title) && !/^찬송/.test(title) ? `${title} · ${bh.title}` : bh.title, lyrics: bh.lyrics, order: bh.order || '', credit: bh.credit || '' });
      else { items.push({ ...base, type: 'title', title: `${title || '찬송'} · ${label}`, subtitle: '', note: [base.note, '찬송가 파일 없음 — 🎼 로 넣으세요'].filter(Boolean).join(' / ') }); warnings.push(`${label}: 찬송가 폴더에서 찾지 못함`); }
    } else if (x.type === 'bible' && x.ref) {
      const ok = checkRef(String(x.ref));
      items.push({ ...base, type: 'bible', ref: String(x.ref), title: title || '성경봉독' });
      if (!ok) warnings.push(`'${x.ref}': 장절을 확인하세요`);
    } else if (x.type === 'reading' && Number(x.hymnNumber)) {
      const r = safe(() => resolveHymnal(Number(x.hymnNumber), '교독문'));
      if (r && r.kind === 'reading') items.push({ ...base, type: 'text', title: r.title, body: r.body });
      else { items.push({ ...base, type: 'title', title: `교독문 ${x.hymnNumber}`, subtitle: String(x.subtitle || '') }); warnings.push(`교독문 ${x.hymnNumber}: 베들레헴 찬송가 가사가 없습니다 (설정 → 베들레헴에서 가져오기)`); }
    } else if (x.type === 'song' && x.song && !x.lyrics) {
      const sg = safe(() => resolveSong(String(x.song)));
      if (sg) items.push({ ...base, type: 'song', title: sg.title, lyrics: sg.lyrics || '', order: sg.order || '', credit: sg.credit || '' });
      else { items.push({ ...base, type: 'title', title: `${title || '찬양'} · ${x.song}`, subtitle: '' }); warnings.push(`'${x.song}': 라이브러리에 없는 찬양 — 🌐 가사 찾기로 넣으세요`); }
    } else if (x.type === 'text') items.push({ ...base, type: 'text', body: String(x.body || ''), title: title || '광고' });
    else if (x.type === 'song') items.push({ ...base, type: 'song', lyrics: String(x.lyrics || ''), title: title || '찬양' });
    else if (x.type === 'blank') items.push({ ...base, type: 'blank', mode: 'background', title: title || '빈 화면' });
    else items.push({ ...base, type: 'title', subtitle: String(x.subtitle || '') });
  }
  if (!items.length) throw new Error('주보에서 예배 순서를 찾지 못했습니다.');
  return {
    cue: {
      name: String(plan.name || '').trim() || '새 예배 (AI)',
      serviceDate: /^\d{4}-\d{2}-\d{2}$/.test(plan.serviceDate || '') ? plan.serviceDate : '',
      startTime: /^\d{1,2}:\d{2}$/.test(plan.startTime || '') ? plan.startTime : '',
      items,
    },
    warnings,
  };
}

module.exports = { parseOrderText, DEFAULT_ENDPOINT, readBulletin, hwpText, askAI, planToCue, parseJson, RECOMMENDED, DEFAULT_MODEL, SYSTEM, SAMPLE, SAMPLE_NAME, chatPrompt, parseChatAnswer };
