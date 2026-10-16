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
const SYSTEM = `너는 한국 교회 예배 방송실을 돕는 도우미다. 주보에서 '예배 순서'(주일 낮/오전 예배를 우선)를 찾아 송출 큐시트 JSON 으로 만든다.
반드시 아래 JSON 하나만 출력한다 (설명·코드블록 없이).
{
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
}
규칙:
- 찬송(가) 순서는 type "hymn" 과 hymnNumber. '예배로의 부름'처럼 찬송가를 부르는 순서도 hymn (title 은 '예배로의 부름').
- 성경봉독·본문은 type "bible" 과 ref (책 이름은 한국어 약칭 가능).
- 찬양팀·찬양대처럼 곡이 정해지지 않은 찬양은 type "title" (subtitle 에 찬양팀 이름).
- 교회소식·광고는 type "text" 하나로, body 에 항목마다 '---' 로 나눠 요약 (한 장에 3~4줄).
- 설교는 type "title", subtitle 에 "“설교 제목” · 설교자".
- 일어서는 순서(* 표시)는 note 에 "*일어서서".
- 기도·봉헌·축도 등 나머지는 type "title" 과 담당자 subtitle.
- 마지막에 { "type": "blank", "title": "예배 후" } 를 넣는다.
- 주보에 없는 내용은 지어내지 않는다.`;

/** 응답 글에서 JSON 꺼내기 (코드블록·앞뒤 설명이 붙어도) */
function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* 아래에서 다시 */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('AI 응답을 해석하지 못했습니다.');
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
 */
function planToCue(plan, { resolveHymn, checkRef }) {
  const items = [];
  const warnings = [];
  for (const x of Array.isArray(plan.items) ? plan.items : []) {
    const title = String(x.title || '').trim();
    const base = { title: title || '순서', note: String(x.note || ''), duration: Number(x.duration) || 0 };
    if (x.type === 'hymn' && Number(x.hymnNumber)) {
      const h = resolveHymn(Number(x.hymnNumber), String(x.hymnbook || ''));
      const label = `${x.hymnNumber}장`;
      if (h) items.push({ ...base, type: 'hymn', title: title && !/^\d+장/.test(title) && !/^찬송/.test(title) ? `${title} · ${label} ${h.title}` : `${label} ${h.title}`, file: h.file, number: Number(x.hymnNumber), background: 'default' });
      else { items.push({ ...base, type: 'title', title: `${title || '찬송'} · ${label}`, subtitle: '', note: [base.note, '찬송가 파일 없음 — 🎼 로 넣으세요'].filter(Boolean).join(' / ') }); warnings.push(`${label}: 찬송가 폴더에서 찾지 못함`); }
    } else if (x.type === 'bible' && x.ref) {
      const ok = checkRef(String(x.ref));
      items.push({ ...base, type: 'bible', ref: String(x.ref), title: title || '성경봉독' });
      if (!ok) warnings.push(`'${x.ref}': 장절을 확인하세요`);
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

module.exports = { DEFAULT_ENDPOINT, readBulletin, hwpText, askAI, planToCue, parseJson, RECOMMENDED, DEFAULT_MODEL, SYSTEM };
