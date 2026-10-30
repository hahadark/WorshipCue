'use strict';
// 홈페이지 주보 연동: 교회 홈페이지가 내는 주보 JSON (예: https://교회주소/bulletin/feed.json) 을 읽어
//  - 예배 순서 → 큐시트 (찬송가 번호·장절 확인은 주보 AI 와 같은 planToSavedCue)
//  - 교회 소식(광고) · 일정 · 기도 제목 → 공지 슬라이드 ('---' 로 장 나눔)
// 주보를 홈페이지 관리자 화면에 한 번 입력하면 홈페이지와 예배 화면에 같이 쓰인다.
//
// JSON 모양 (format: "worshipcue-bulletin/1"):
//   { church, updated, bulletins: [ { date:'YYYY-MM-DD', issue, url, sermon:{title,passage,preacher}, verse:{text,ref},
//       services:[{ name, time, host, items:[{ part, content, by, stand }] }],
//       news:[{ title, body, link }], prayers:[{ title, body }], events:[{ when, title, note }] } ] }

const { parseOrderText } = require('./bulletin');

const s = (v, n = 2000) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
const arr = v => (Array.isArray(v) ? v : []);

/** 받은 JSON → 정리된 주보 목록 (최신순) */
function normalizeFeed(o) {
  if (!o || typeof o !== 'object') throw new Error('주보 자료가 JSON 이 아닙니다.');
  const list = Array.isArray(o) ? o : Array.isArray(o.bulletins) ? o.bulletins : o.date ? [o] : null;
  if (!list) throw new Error("주보 자료에서 'bulletins' 를 찾지 못했습니다. 홈페이지의 주보 JSON 주소(예: …/bulletin/feed.json)인지 확인하세요.");
  const bulletins = list.map(b => ({
    date: /^\d{4}-\d{2}-\d{2}/.test(s(b && b.date)) ? s(b.date).slice(0, 10) : '',
    issue: s(b.issue, 60), url: s(b.url, 500),
    sermon: { title: s(b.sermon && b.sermon.title, 200), passage: s(b.sermon && b.sermon.passage, 100), preacher: s(b.sermon && b.sermon.preacher, 80) },
    verse: b.verse && b.verse.text ? { text: s(b.verse.text, 500), ref: s(b.verse.ref, 80) } : null,
    services: arr(b.services).map(v => ({
      name: s(v && v.name, 80), time: s(v && v.time, 40), host: s(v && v.host, 120),
      items: arr(v && v.items).map(x => ({ part: s(x && x.part, 80), content: s(x && x.content, 300), by: s(x && x.by, 80), stand: !!(x && x.stand) })).filter(x => x.part),
    })).filter(v => v.name || v.items.length),
    news: arr(b.news).map(n => ({ title: s(n && n.title, 200), body: s(n && n.body, 1500), link: s(n && n.link, 500) })).filter(n => n.title || n.body),
    prayers: arr(b.prayers).map(n => ({ title: s(n && n.title, 200), body: s(n && n.body, 1500) })).filter(n => n.title || n.body),
    events: arr(b.events).map(e => ({ when: s(e && e.when, 60), title: s(e && e.title, 200), note: s(e && e.note, 300) })).filter(e => e.title),
  })).filter(b => b.date || b.services.length || b.news.length).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!bulletins.length) throw new Error('주보가 하나도 없습니다.');
  return { church: s(o.church, 120), updated: s(o.updated, 40), bulletins };
}

/** 주소에서 받기 */
async function fetchFeed(url, fetchImpl = fetch) {
  const u = s(url, 500);
  if (!/^https?:\/\//i.test(u)) throw new Error('홈페이지 주보 주소를 넣으세요 (예: https://교회주소/bulletin/feed.json).');
  let r;
  try { r = await fetchImpl(u, { headers: { Accept: 'application/json' } }); } catch (e) { throw new Error(`홈페이지에 연결하지 못했습니다: ${e.message}`); }
  if (!r.ok) throw new Error(`홈페이지에서 주보를 받지 못했습니다 (${r.status}).`);
  const text = await r.text();
  let o;
  try { o = JSON.parse(text.replace(/^\ufeff/, '')); } catch { throw new Error('받은 내용이 JSON 이 아닙니다. 주보 JSON 주소(…/bulletin/feed.json)인지 확인하세요.'); }
  return normalizeFeed(o);
}

/** 큐시트의 예배 날짜와 같은 주보 (없으면 가장 최근) */
function pickBulletin(feed, date) {
  return (date && feed.bulletins.find(b => b.date === date)) || feed.bulletins[0];
}

const isNewsPart = p => /^(교회\s*소식|광고|알림|공지)/.test(p.replace(/\s+/g, ' '));

/**
 * 광고 · 일정 · 기도 제목 → 공지 슬라이드 글 (장마다 '---')
 * sel: { news: [번호…] | 'all', events: bool, prayers: bool }
 */
function newsBody(b, sel = {}) {
  const pages = [];
  const pickN = sel.news === undefined || sel.news === 'all' ? b.news.map((_, i) => i) : arr(sel.news).map(Number);
  for (const i of pickN) {
    const n = b.news[i];
    if (!n) continue;
    pages.push([n.title && `**${one(n.title)}**`, n.body].filter(Boolean).join('\n'));
  }
  if (sel.events && b.events.length) {
    pages.push(['**이번 주 일정**', ...b.events.map(e => `${e.when ? e.when + '  ' : ''}${one(e.title)}${e.note ? ` — ${one(e.note)}` : ''}`)].join('\n'));
  }
  if (sel.prayers) for (const p of b.prayers) pages.push([`**${one(p.title || '기도 제목')}**`, p.body].filter(Boolean).join('\n'));
  return pages.map(p => p.replace(/^\s*-{3,}\s*$/gm, '—')).join('\n---\n');
}
const one = t => String(t || '').replace(/\n+/g, ' ').trim();

/**
 * 주보 한 호의 예배 하나 → 큐시트 계획 (planToSavedCue 가 찬송가 PPT · 장절을 확인)
 * 각 순서를 bulletin.js 의 규칙 파서로 알아본다 (찬송 304장 → 찬송가, 마태복음 6:9-13 → 성경). 교회 소식 순서에는 광고 슬라이드를 채운다.
 */
function serviceToPlan(b, serviceIndex, { looksLikeRef = () => false, news = {} } = {}) {
  const v = b.services[serviceIndex] || b.services[0];
  if (!v) throw new Error('이 주보에는 예배 순서가 없습니다.');
  const items = [];
  let newsPlaced = false;
  const body = newsBody(b, news);
  for (const x of v.items) {
    const note = x.stand ? '*일어서서' : '';
    if (isNewsPart(x.part)) {
      items.push({ type: 'text', title: x.part.replace(/\s+/g, ''), body, note });
      newsPlaced = true;
      continue;
    }
    if (/^(설교|말씀)$/.test(x.part.replace(/\s+/g, '')) && x.content) {
      items.push({ type: 'title', title: x.part, subtitle: [`“${x.content}”`, x.by].filter(Boolean).join(' · '), note });
      continue;
    }
    // 한 줄 규칙 파서로 찬송가·성경·교독문을 알아본다 (나누기 기호는 빼고)
    const clean = t => t.replace(/[/|·•→➔]/g, ' ').replace(/\s+/g, ' ').trim();
    const line = [clean(x.part), clean(x.content)].filter(Boolean).join(' ');
    const p = parseOrderText(line, { looksLikeRef }).items[0];
    if (p && (p.type === 'hymn' || p.type === 'bible' || p.type === 'reading')) {
      items.push({ ...p, title: p.type === 'bible' ? x.part.replace(/\s+/g, '') : p.title, note: note || p.note || '' });
      continue;
    }
    // 번호 없는 찬송·찬양 곡 이름 (예: 찬송 「여기에 모인 우리」) → 라이브러리 찬양에서 찾기
    if (/^(찬송|찬양|특송|헌금\s*송|봉헌\s*송)/.test(x.part) && x.content && !/\d/.test(x.content)) {
      items.push({ type: 'song', title: x.part, song: x.content.replace(/[「」『』“”"'‘’]/g, '').trim(), note });
      continue;
    }
    items.push({ type: 'title', title: x.part, subtitle: [x.content, x.by].filter(Boolean).join(' · '), note });
  }
  return {
    name: `${b.date ? b.date + ' ' : ''}${v.name || '예배'}`.trim(),
    serviceDate: b.date || '',
    startTime: toHHMM(v.time),
    items,
    newsPlaced,
  };
}

/** '오전 11:00' · '오후 1:30' · '저녁 8:00' · '14:00' → 'HH:MM' */
function toHHMM(t) {
  const m = String(t || '').match(/(오전|오후|저녁|밤|새벽)?\s*(\d{1,2})\s*[:시]\s*(\d{2})?/);
  if (!m) return '';
  let h = +m[2];
  const min = m[3] || '00';
  if (/오후|저녁|밤/.test(m[1] || '') && h < 12) h += 12;
  if (h > 23) return '';
  return `${String(h).padStart(2, '0')}:${min}`;
}

module.exports = { normalizeFeed, fetchFeed, pickBulletin, newsBody, serviceToPlan, toHHMM };
