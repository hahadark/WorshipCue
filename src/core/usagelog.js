'use strict';
// 사용 기록: 언제 어떤 찬양·찬송·본문을 띄웠는지 (저작권 보고 · "지난달에 부른 곡" 확인용)
// 송출(sendLive)할 때마다 한 줄. 같은 것을 5분 안에 다시 띄우면 적지 않는다.

const DEDUPE_MS = 5 * 60 * 1000;

class UsageLog {
  constructor(core) {
    this.core = core;
    this.db = core.store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS UsageLog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      credit TEXT NOT NULL DEFAULT '',
      cue TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS UsageLog_at ON UsageLog (at);`);
  }

  /** 송출한 본문 정보 → 기록 (kind: song · hymn · bible · text · title … ) */
  record(passage, cueName = '') {
    if (!passage) return null;
    const kind = passage.itemType || (passage.book ? 'bible' : '') || 'other';
    const title = String(passage.itemTitle || passage.title || '').trim();
    if (!title) return null;
    const last = this.db.prepare('SELECT at FROM UsageLog WHERE kind = ? AND title = ? ORDER BY id DESC LIMIT 1').get(kind, title);
    if (last && Date.now() - Date.parse(last.at) < DEDUPE_MS) return null;
    const row = { at: new Date().toISOString(), kind, title: title.slice(0, 300), credit: String(passage.credit || '').slice(0, 300), cue: String(cueName || '').slice(0, 200) };
    this.db.prepare('INSERT INTO UsageLog (at, kind, title, credit, cue) VALUES (?, ?, ?, ?, ?)').run(row.at, row.kind, row.title, row.credit, row.cue);
    return row;
  }

  /** from·to: 'YYYY-MM-DD' (그 날 포함), kinds: ['song','hymn'] 처럼 종류 고르기, q: 제목 검색 */
  list({ from = '', to = '', kinds = null, q = '' } = {}) {
    const where = [];
    const vals = [];
    if (from) { where.push('at >= ?'); vals.push(localIso(from, 0)); }
    if (to) { where.push('at <= ?'); vals.push(localIso(to, 1)); }
    if (Array.isArray(kinds) && kinds.length) { where.push(`kind IN (${kinds.map(() => '?').join(',')})`); vals.push(...kinds.map(String)); }
    if (q) { where.push('title LIKE ?'); vals.push('%' + String(q).replace(/\s+/g, '%') + '%'); }
    return this.db.prepare(`SELECT id, at, kind, title, credit, cue FROM UsageLog ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC LIMIT 5000`).all(...vals).map(r => ({ ...r }));
  }

  /** 제목별 횟수 (저작권 보고용) */
  summary(opts) {
    const m = new Map();
    for (const r of this.list(opts)) {
      const k = `${r.kind}\u0001${r.title}`;
      const s = m.get(k) || { kind: r.kind, title: r.title, credit: r.credit, count: 0, first: r.at, last: r.at };
      s.count += 1;
      if (r.at < s.first) s.first = r.at;
      if (r.at > s.last) s.last = r.at;
      if (!s.credit && r.credit) s.credit = r.credit;
      m.set(k, s);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  }

  /** CSV (엑셀에서 열리게 BOM 포함) — mode: 'rows' 날짜별 전체, 'summary' 제목별 횟수 */
  csv(opts, mode = 'rows') {
    const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const KIND = { song: '찬양', hymn: '찬송가', bible: '성경', text: '공지', title: '제목', image: '이미지', video: '영상', slideshow: '슬라이드쇼', camera: '카메라', blank: '빈 화면', other: '기타' };
    const lines = [];
    if (mode === 'summary') {
      lines.push(['종류', '제목', '저작권·출처', '횟수', '처음', '마지막'].join(','));
      for (const s of this.summary(opts)) lines.push([KIND[s.kind] || s.kind, s.title, s.credit, s.count, s.first.slice(0, 10), s.last.slice(0, 10)].map(esc).join(','));
    } else {
      lines.push(['날짜', '시각', '종류', '제목', '저작권·출처', '큐시트'].join(','));
      for (const r of this.list(opts)) { const d = new Date(r.at); lines.push([local(d).slice(0, 10), local(d).slice(11, 16), KIND[r.kind] || r.kind, r.title, r.credit, r.cue].map(esc).join(',')); }
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  clear(before = '') {
    if (before) return this.db.prepare('DELETE FROM UsageLog WHERE at < ?').run(localIso(before, 0)).changes;
    return this.db.prepare('DELETE FROM UsageLog').run().changes;
  }
}

/** 'YYYY-MM-DD' (이 PC 시간대) → 그 날 처음(end=0)·끝(end=1)의 ISO */
function localIso(day, end) {
  const [y, m, d] = String(day).split('-').map(Number);
  if (!y || !m || !d) return end ? '9999' : '';
  const t = new Date(y, m - 1, d + (end ? 1 : 0));
  return new Date(t.getTime() - (end ? 1 : 0)).toISOString();
}
function local(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

module.exports = { UsageLog };
