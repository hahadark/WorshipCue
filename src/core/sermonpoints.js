'use strict';
// 설교 포인트 슬라이드: 설교 원고(또는 자막) → 대지 3~4개와 핵심 문장 → 송출용 '제목' 순서 하나 (장마다 카드 한 장)
//  - 규칙으로 (AI 없이): '첫째·둘째', '1. 2.', 'Ⅰ. Ⅱ.', '대지 1' 같은 표시를 찾는다
//  - API 키로 (오픈라우터) · 채팅 AI 로 (프롬프트 복사 → 답 붙여 넣기)
//  - 데이터 모양은 설교쇼츠 편집기의 '설교 요약' 과 같다: { title, verse, speaker, theme, points:[{heading, body}], application }

const { parseJson, DEFAULT_ENDPOINT, DEFAULT_MODEL } = require('./bulletin');

const ORDINAL_WORDS = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째'];
const ORDINAL_LONG = ['첫 번째', '두 번째', '세 번째', '네 번째', '다섯 번째', '여섯 번째'];
const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ'];
const ROMAN_ASCII = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥'];

const MAX_HEAD = 40; // 카드 큰 글 (화면 한두 줄)
const MAX_BODY = 80; // 카드 작은 글

/** 원고 정리: BOM · 자막 번호·시간 줄 지우기. 자막이면 한 문단으로 잇는다 */
function normalize(text) {
  let t = String(text || '').replace(/^\ufeff/, '').replace(/\r/g, '').replace(/\u00a0/g, ' ');
  const isSub = /^WEBVTT/m.test(t) || /\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(t);
  if (isSub) {
    t = t.split('\n').filter(l => !/^\s*\d+\s*$/.test(l) && !/-->/.test(l) && !/^WEBVTT/.test(l) && !/^(NOTE|STYLE)\b/.test(l))
      .map(l => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join(' ');
  }
  return { text: t.trim(), isSub };
}

/** 문장 나누기 (한국어 설교: '다.' '요.' '까?' 등) */
function sentences(s) {
  // 마침표 뒤, 또는 (자막처럼 부호가 없을 때) '…니다 …어요 …죠' 같은 끝말 뒤에서 나눈다
  return String(s || '').replace(/\s+/g, ' ').split(/(?<=[.!?。])\s+|(?<=(?:니다|어요|아요|에요|지요|죠|까요|세요|십시다|합시다))\s+(?=\S)/).map(x => x.trim()).filter(Boolean);
}

/** 글을 n 자 안쪽으로 (낱말 경계에서 자르고 …) */
function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,，·\s]+$/, '') + '…';
}

/** 대지 제목 다듬기: 끝 마침표 · 따옴표 정리 */
const tidyHead = s => clip(String(s || '').replace(/^[\s,，.:：)\]-]+/, '').replace(/[.。]+$/, '').trim(), MAX_HEAD);
const tidyBody = s => clip(String(s || '').trim(), MAX_BODY);

/** 원고 머리의 '제목: …' '본문: …' '설교자: …' */
function headerMeta(lines) {
  const meta = { title: '', verse: '', speaker: '' };
  for (const l of lines.slice(0, 15)) {
    let m;
    if (!meta.title && (m = l.match(/^(?:설교\s*)?제\s*목\s*[:：]\s*(.+)$/))) meta.title = m[1].replace(/^[“"'‘「『]|[”"'’」』]$/g, '').trim();
    else if (!meta.verse && (m = l.match(/^(?:본\s*문|성\s*경|말\s*씀|봉\s*독)\s*[:：]\s*(.+)$/))) meta.verse = m[1].trim();
    else if (!meta.speaker && (m = l.match(/^(?:설교자|설교|말씀)\s*[:：]\s*(.+)$/))) meta.speaker = m[1].trim();
  }
  return meta;
}

/** 줄 머리의 대지 표시 → { fam, n, rest } */
function headMark(line) {
  const l = line.trim();
  let m;
  for (let i = 0; i < ORDINAL_WORDS.length; i++) {
    // '첫째,' '첫째로' '첫 번째는' (뒤에 띄어쓰기·부호가 있어야 한다: '첫째날' 은 아님)
    const re = new RegExp('^(?:' + ORDINAL_WORDS[i] + '|' + ORDINAL_LONG[i].replace(' ', '\\s*') + ')(?:\\s*(?:으로|로|는|은))?(?=[\\s,，.:：)]|$)\\s*[,，.:：)]?\\s*');
    if ((m = l.match(re))) return { fam: 'word', n: i + 1, rest: l.slice(m[0].length) };
  }
  if ((m = l.match(/^마지막으로[\s,，]/))) return { fam: 'word', n: 0, rest: l.slice(m[0].length) }; // n 0 = 바로 다음 번호
  if ((m = l.match(/^(?:대지|포인트|요점)\s*([1-6])\s*[.:：)]?\s*/))) return { fam: 'daeji', n: +m[1], rest: l.slice(m[0].length) };
  if ((m = l.match(/^([ⅠⅡⅢⅣⅤⅥ])\s*[.)]?\s*/))) return { fam: 'roman', n: ROMAN.indexOf(m[1]) + 1, rest: l.slice(m[0].length) };
  if ((m = l.match(/^(VI|IV|V|I{1,3})\s*[.)]\s*/))) return { fam: 'roman', n: ROMAN_ASCII.indexOf(m[1]) + 1, rest: l.slice(m[0].length) };
  if ((m = l.match(/^([①-⑥])\s*/))) return { fam: 'circled', n: CIRCLED.indexOf(m[1]) + 1, rest: l.slice(m[0].length) };
  if ((m = l.match(/^([1-6])\s*[.)]\s+/))) return { fam: 'num', n: +m[1], rest: l.slice(m[0].length) };
  return null;
}

/** 표시가 붙은 덩어리들 중 1,2,3… 차례로 이어지는 가장 그럴듯한 묶음 */
function bestRun(marks) {
  const PREF = ['word', 'roman', 'daeji', 'circled', 'num'];
  let best = null;
  for (const fam of PREF) {
    const list = marks.filter(x => x.fam === fam);
    const run = [];
    for (const x of list) {
      const want = run.length + 1;
      if (x.n === want || (x.n === 0 && run.length >= 1)) run.push(x);
      else if (x.n === 1 && run.length < 2) { run.length = 0; run.push(x); } // 다시 시작 (앞의 짧은 목록은 버림)
    }
    if (run.length >= 2 && (!best || run.length > best.length)) best = run;
    if (best && fam === 'word') break; // '첫째·둘째' 가 있으면 그것이 대지
  }
  return best;
}

/** 대지 덩어리(표시 뒤의 글 + 다음 대지 전까지의 글) → { heading, body } */
function pointOf(rest, follow) {
  const first = sentences(rest);
  let heading = first[0] || '';
  let body = first[1] || '';
  // 제목 줄이 길고 쉼표로 나뉘면 앞부분만 제목으로
  if (heading.length > MAX_HEAD && /[,，]/.test(heading.slice(6, MAX_HEAD + 6))) {
    const k = heading.search(/[,，]/);
    if (k > 5) { body = body || heading.slice(k + 1).trim(); heading = heading.slice(0, k); }
  }
  if (!body) body = sentences(follow).find(s => s.replace(/\s/g, '').length >= 8) || '';
  return { heading: tidyHead(heading), body: tidyBody(body) };
}

/**
 * 규칙으로 대지 찾기 (AI 없이). meta: { title, verse, speaker } 는 화면에서 넣은 값 (비어 있으면 원고 머리에서)
 * → { title, verse, speaker, theme, points, application, found }
 */
function findPoints(text, meta = {}) {
  const { text: t, isSub } = normalize(text);
  if (!t) throw new Error('설교 원고를 붙여 넣거나 파일을 불러오세요.');
  // 원고 대신 AI 답(JSON)을 붙여 넣었으면 그대로 읽는다
  const asJson = tryAnswer(t);
  if (asJson) return { ...asJson, title: asJson.title || meta.title || '', verse: asJson.verse || meta.verse || '', speaker: asJson.speaker || meta.speaker || '', found: 'json' };
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  const hm = headerMeta(lines);
  const out = { title: meta.title || hm.title, verse: meta.verse || hm.verse, speaker: meta.speaker || hm.speaker, theme: '', points: [], application: '', found: '' };

  // 1) 줄 머리 표시 (원고)
  let blocks = [];
  if (!isSub) {
    const marks = [];
    lines.forEach((l, i) => { const h = headMark(l); if (h) marks.push({ ...h, i }); });
    const run = bestRun(marks);
    if (run) {
      blocks = run.map((x, k) => {
        const end = k + 1 < run.length ? run[k + 1].i : lines.length;
        return { rest: x.rest, follow: lines.slice(x.i + 1, end).join(' ') };
      });
      out.found = 'lines';
    }
  }
  // 2) 문장 머리 표시 (자막·한 문단 원고: "첫째, … 둘째, …")
  if (!blocks.length) {
    const ss = sentences(t);
    const marks = [];
    ss.forEach((s, i) => { const h = headMark(s); if (h && h.fam === 'word') marks.push({ ...h, i }); });
    const run = bestRun(marks);
    if (run) {
      blocks = run.map((x, k) => {
        const end = k + 1 < run.length ? run[k + 1].i : Math.min(ss.length, x.i + 8);
        return { rest: x.rest, follow: ss.slice(x.i + 1, end).join(' ') };
      });
      out.found = 'sentences';
    }
  }
  if (!blocks.length) throw new Error("대지 표시('첫째·둘째', '1. 2.', 'Ⅰ. Ⅱ.')를 찾지 못했습니다. 'AI 로 뽑기' 를 쓰거나 대지를 직접 입력하세요.");
  out.points = blocks.slice(0, 6).map(b => pointOf(b.rest, b.follow)).filter(p => p.heading);
  // 적용: '적용' '결론' 으로 시작하는 줄의 첫 문장
  const ap = lines.find(l => /^(?:적용|결론|맺음말|마치며)\s*[:：]?\s*\S/.test(l));
  if (ap) out.application = tidyBody(sentences(ap.replace(/^(?:적용|결론|맺음말|마치며)\s*[:：]?\s*/, ''))[0] || '');
  return out;
}

// ---------------- AI ----------------
const FORMAT = `{
  "title": "설교 제목",
  "verse": "본문 장절 (예: 롬 1:16-17)",
  "speaker": "설교자 (모르면 빈 문자열)",
  "theme": "설교 전체의 핵심을 한 문장으로 (40자 안팎)",
  "points": [
    { "heading": "대지 제목 (20자 안팎, 예: 복음은 하나님의 능력입니다)", "body": "그 대지의 핵심 문장 한 줄 (50자 안팎)" }
  ],
  "application": "이번 주 삶의 적용 한 문장 (없으면 빈 문자열)"
}`;
const RULES = `원칙:
- 설교 원고에 실제로 있는 흐름과 대지만 씁니다. 원고에 '첫째·둘째' 같은 대지가 있으면 그 순서와 뜻을 그대로 따릅니다.
- 대지는 3~4개 (원고가 2개나 5개로 분명히 나뉘면 그대로).
- 예배 화면(큰 글씨)에 띄울 글입니다. heading 은 20자 안팎의 한 줄, body 는 50자 안팎의 한 문장으로 짧고 분명하게.
- 성경 본문 문장을 새로 만들지 않습니다. 장절은 "롬 1:16-17" 처럼만 씁니다.
- 원고가 자동 자막이면 띄어쓰기·맞춤법·교회 용어를 문맥에 맞게 바로잡습니다.
- 교회·설교자 이름은 주어진 대로 씁니다. 모든 글은 한국어 존댓말.`;
const SYSTEM = `당신은 한국 교회의 예배 화면(PPT) 담당자입니다. 주일 설교 원고에서 예배 중 화면에 띄울 '설교 포인트'(대지와 핵심 문장)를 뽑습니다.
답은 아래 형식의 JSON 하나만 씁니다.

형식:
${FORMAT}

${RULES}`;

function metaLines(meta = {}) {
  return [meta.title && `설교 제목: ${meta.title}`, meta.verse && `본문: ${meta.verse}`, meta.speaker && `설교자: ${meta.speaker}`].filter(Boolean).join('\n');
}

/** 채팅 AI (키 없이) 에 붙여 넣을 프롬프트 (원고 포함) */
function chatPrompt(text, meta = {}, extra = '') {
  const { text: t } = normalize(text);
  if (!t) throw new Error('설교 원고를 먼저 붙여 넣으세요.');
  return `${SYSTEM}

답하는 법:
- JSON 하나만 \`\`\`json 코드 블록으로 답합니다. 앞뒤 설명은 쓰지 않습니다.${extra ? `\n\n추가 요청: ${extra}` : ''}

${metaLines(meta) ? metaLines(meta) + '\n\n' : ''}[설교 원고]
${t.slice(0, 60000)}`;
}

/** 오픈라우터(또는 OpenAI 호환)로 뽑기 */
async function askPoints({ apiKey, model, text, meta = {}, extra = '', fetchImpl = fetch, endpoint = DEFAULT_ENDPOINT }) {
  if (!apiKey) throw new Error('오픈라우터 API 키가 없습니다. 파일 → 주보로 큐시트 만들기 → API 키로 에서 넣거나, 채팅 AI 를 쓰세요.');
  const { text: t } = normalize(text);
  if (!t) throw new Error('설교 원고를 붙여 넣으세요.');
  const user = `${metaLines(meta) ? metaLines(meta) + '\n\n' : ''}[설교 원고]\n${t.slice(0, 60000)}${extra ? `\n\n추가 요청: ${extra}` : ''}`;
  const r = await fetchImpl(endpoint || DEFAULT_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/hahadark/WorshipCue', 'X-Title': 'Worship Presenter' },
    body: JSON.stringify({ model: model || DEFAULT_MODEL, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], temperature: 0.2, response_format: { type: 'json_object' } }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`오픈라우터 오류 (${r.status}): ${(body.error && body.error.message) || r.statusText}`);
  const msg = body.choices && body.choices[0] && body.choices[0].message;
  if (!msg || !msg.content) throw new Error('AI 응답이 비었습니다.');
  const data = cleanData(parseJson(typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text || '').join('')));
  if (!data.points.length) throw new Error('AI 답에 대지(points)가 없습니다.');
  return { data: { ...data, title: data.title || meta.title || '', verse: data.verse || meta.verse || '', speaker: data.speaker || meta.speaker || '' }, usage: body.usage || null, model: body.model || model };
}

/** AI 답 · 설교쇼츠 편집기 '설교 요약' JSON → 정리된 데이터 */
function cleanData(o) {
  o = o && typeof o === 'object' ? o : {};
  if (o.summary && typeof o.summary === 'object') o = o.summary; // { summary: {...} } 로 감싼 경우
  const s = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const pts = Array.isArray(o.points) ? o.points : Array.isArray(o.대지) ? o.대지 : [];
  return {
    title: s(o.title, 120), verse: s(o.verse || o.ref, 80), speaker: s(o.speaker, 60), theme: tidyBody(s(o.theme, 300)),
    points: pts.slice(0, 6).map(p => (typeof p === 'string' ? { heading: tidyHead(p), body: '' } : { heading: tidyHead(s(p && (p.heading || p.title), 200)), body: tidyBody(s(p && (p.body || p.text), 400)) })).filter(p => p.heading),
    application: tidyBody(s(o.application, 300)),
  };
}

/** 글에서 포인트 JSON 을 찾으면 정리해서, 아니면 null */
function tryAnswer(text) {
  const t = String(text || '').trim();
  if (!/[{[]/.test(t) || !/"points"|"heading"|"대지"/.test(t)) return null;
  const blocks = [...t.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)].map(m => m[1]);
  for (const b of [...blocks, t]) {
    try { const d = cleanData(parseJson(b)); if (d.points.length) return d; } catch { /* 다음 */ }
  }
  return null;
}

/** 채팅 AI 답 → 데이터 (못 읽으면 오류) */
function parseAnswer(text) {
  const d = tryAnswer(text);
  if (!d) throw new Error('AI 답에서 설교 포인트 JSON 을 찾지 못했습니다. AI 에게 "JSON 코드 블록 하나로 다시 답해 줘" 라고 해 보세요.');
  return d;
}

// ---------------- 큐시트 순서로 ----------------
const LABELS = { word: ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째'], num: ['1.', '2.', '3.', '4.', '5.', '6.'] };
/** 장 글에서 '---' 줄 · 줄바꿈 없애기 (장 구분과 제목/부제 구분을 지키려고) */
const one = s => String(s || '').replace(/\n+/g, ' ').replace(/-{3,}/g, '—').trim();

/**
 * 데이터 → '제목' 순서 하나 (첫 장 = 설교 제목 · 본문/설교자, 다음 장 = 핵심 · 대지들 · 적용)
 * opts: { numbering: 'word'|'num'|'none', theme: true, application: true }
 */
function toCueItem(data, opts = {}) {
  const d = cleanData(data);
  if (!d.points.length) throw new Error('대지가 하나도 없습니다.');
  const numbering = ['word', 'num', 'none'].includes(opts.numbering) ? opts.numbering : 'word';
  const pages = [];
  if (opts.theme !== false && d.theme) pages.push(`${one(d.theme)}\n오늘의 핵심`);
  d.points.forEach((p, i) => {
    const lab = numbering === 'none' ? '' : LABELS[numbering][i] + (numbering === 'word' ? ', ' : ' ');
    pages.push(`${lab}${one(p.heading)}${p.body ? '\n' + one(p.body) : ''}`);
  });
  if (opts.application !== false && d.application) pages.push(`${one(d.application)}\n이번 주 적용`);
  return {
    type: 'title',
    title: one(d.title) || '설교',
    subtitle: [one(d.verse), one(d.speaker)].filter(Boolean).join(' · '),
    more: pages.join('\n---\n'),
    note: `설교 포인트 ${pages.length + 1}장`,
  };
}

module.exports = { normalize, sentences, findPoints, chatPrompt, askPoints, parseAnswer, tryAnswer, cleanData, toCueItem, SYSTEM, FORMAT };
