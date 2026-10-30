'use strict';
// 예배 전 화면 자동 만들기: 지난주 말씀카드 + 이번 주 QT 첫날 본문 → 슬라이드쇼 순서 하나 (자동으로 넘기며 반복 · 카운트다운)
//  - 말씀카드 그림: 설교쇼츠 편집기 '교인 자료' 의 묵상카드·카드뉴스 PNG 를 저장한 폴더에서 가장 최근 묶음 (이름_01.png, 이름_02.png …)
//  - 말씀 글: 설교쇼츠 편집기의 '홈페이지 묶음' (…/홈페이지보내기/<날짜>/bundle.json 의 cardLine) · 홈페이지 주보의 표지 말씀
//  - 이번 주 QT 첫날 본문: 장절, 또는 QT 자료(JSON 의 days[0] · '1일째 · 제목 (장절)' 글)를 붙여 넣으면 성경 DB 에서 본문을 찾는다

const fs = require('fs');
const path = require('path');
const { IMAGE } = require('./library');

/** 폴더의 그림들을 '이름_01' 묶음으로 (최근 것 먼저) */
function cardGroups(folder, max = 6) {
  const dir = String(folder || '').trim();
  if (!dir) throw new Error('말씀카드 그림 폴더를 고르세요.');
  let names;
  try { names = fs.readdirSync(dir); } catch { throw new Error(`폴더를 열 수 없습니다: ${dir}`); }
  const groups = new Map();
  for (const name of names) {
    if (!IMAGE.test(name)) continue;
    const p = path.join(dir, name);
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    const base = name.replace(/\.[^.]+$/, '').replace(/[_\-\s]?\(?\d{1,3}\)?$/, '') || name;
    const g = groups.get(base) || { base, files: [], mtime: 0 };
    g.files.push({ path: p, name, mtime: st.mtimeMs });
    g.mtime = Math.max(g.mtime, st.mtimeMs);
    groups.set(base, g);
  }
  const list = [...groups.values()].sort((a, b) => b.mtime - a.mtime).slice(0, max);
  for (const g of list) g.files.sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
  return list;
}

/** 설교쇼츠 편집기 '홈페이지 묶음' 폴더에서 오늘(포함) 이전의 가장 최근 묶음 */
function latestBundle(root, today = localDay()) {
  const dir = String(root || '').trim();
  if (!dir) return null;
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  const dates = names.filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n) && n <= today).sort().reverse();
  for (const d of dates) {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(dir, d, 'bundle.json'), 'utf8'));
      return { date: d, cardLine: String(b.cardLine || '').trim(), service: String(b.service || '') };
    } catch { /* 다음 */ }
  }
  return null;
}

/** 이 PC 의 오늘 날짜 'YYYY-MM-DD' */
function localDay(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * QT 자료에서 첫날 본문: { title, dayTitle, ref }
 *  - JSON: { title, days:[{ day, title, passage }] }  (설교쇼츠 편집기 'QT 자료' 와 같은 모양)
 *  - 글: '1일째 · 그날의 제목 (마태복음 6:9-10)'
 *  - 장절만: '마 6:9-13'
 */
function parseQt(text, looksLikeRef = () => true) {
  const t = String(text || '').replace(/^\ufeff/, '').trim();
  if (!t) throw new Error('이번 주 QT 첫날 본문(장절)을 넣거나 QT 자료를 붙여 넣으세요.');
  // JSON
  const blocks = [...t.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)].map(m => m[1]);
  for (const b of [...blocks, t]) {
    if (!/[{[]/.test(b)) continue;
    try {
      const a = b.indexOf('{'), z = b.lastIndexOf('}');
      const o = JSON.parse(b.slice(a, z + 1));
      const qt = o.qt || o;
      const d = Array.isArray(qt.days) ? qt.days.find(x => x && x.passage) : null;
      if (d) return { title: String(qt.title || '').trim(), dayTitle: String(d.title || '').trim(), ref: String(d.passage).trim() };
    } catch { /* 글로 */ }
  }
  // '1일째 · 제목 (장절)' · '첫째 날: 제목 - 장절'
  const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const l of lines) {
    const m = l.match(/^(?:1\s*일\s*째|첫\s*(?:째\s*)?날|1\s*일|day\s*1)\s*[·:：.\-–]?\s*(.*?)\s*[(（]([^()（）]+)[)）]\s*$/i);
    if (m && looksLikeRef(m[2])) return { title: '', dayTitle: m[1].trim(), ref: m[2].trim() };
  }
  // 첫 번째로 장절처럼 보이는 줄 (또는 괄호 안)
  for (const l of lines) {
    const inner = l.match(/[(（]([^()（）]+)[)）]/);
    if (inner && looksLikeRef(inner[1])) return { title: '', dayTitle: l.replace(inner[0], '').replace(/^[^·:：]*[·:：]\s*/, '').trim(), ref: inner[1].trim() };
    if (looksLikeRef(l)) return { title: '', dayTitle: '', ref: l };
  }
  throw new Error('QT 첫날 본문 장절을 찾지 못했습니다. "마 6:9-13" 처럼 장절을 넣어 주세요.');
}

/** 절들 → 슬라이드 글 (한 장에 3절 또는 160자 안쪽) */
function verseSlides(passage, head) {
  const out = [];
  let cur = [];
  let len = 0;
  for (const v of passage.verses || []) {
    const t = `${v.verse} ${String(v.text || '').trim()}`;
    if (cur.length && (cur.length >= 3 || len + t.length > 160)) { out.push(cur); cur = []; len = 0; }
    cur.push(t); len += t.length;
  }
  if (cur.length) out.push(cur);
  return out.map(c => `**${head}**\n${c.join('\n')}`);
}

const one = t => String(t || '').replace(/\r/g, '').replace(/^\s*-{3,}\s*$/gm, '—').trim();

/**
 * 슬라이드쇼 순서 만들기
 * a: { images:[url], cardLine, cardDate, verse:{ text, ref }, qt:{ title, dayTitle, ref, passage }, countdown:'HH:MM', autoSec }
 */
function buildItem(a = {}) {
  const pages = [];
  if (a.cardLine && one(a.cardLine)) pages.push(`**지난주 말씀**\n${one(a.cardLine)}`);
  if (a.verse && a.verse.text) pages.push(`**${one(a.verse.ref) || '이번 주 말씀'}**\n${one(a.verse.text)}`);
  if (a.qt && a.qt.passage && a.qt.passage.verses && a.qt.passage.verses.length) {
    const ref = one(a.qt.passage.title || a.qt.ref);
    pages.push(['**이번 주 QT · 첫째 날**', one(a.qt.dayTitle || a.qt.title), ref].filter(Boolean).join('\n'));
    pages.push(...verseSlides(a.qt.passage, ref));
  }
  const images = (Array.isArray(a.images) ? a.images : []).map(String).filter(Boolean).slice(0, 60);
  if (!images.length && !pages.length) throw new Error('넣을 것이 없습니다. 말씀카드 그림·말씀 글·QT 본문 중 하나 이상 고르세요.');
  const sec = Math.max(3, Math.min(60, Math.round(Number(a.autoSec) || 8)));
  return {
    type: 'slideshow',
    title: '예배 전 화면',
    images,
    body: pages.join('\n---\n'),
    autoSec: sec,
    autoLoop: true,
    countdown: /^\d{1,2}:\d{2}$/.test(a.countdown || '') ? a.countdown : '',
    countdownLabel: '예배 시작까지',
    note: `말씀카드 ${images.length}장 · 글 ${pages.length}장`,
  };
}

module.exports = { cardGroups, latestBundle, parseQt, verseSlides, buildItem, localDay };
