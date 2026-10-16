'use strict';
// 라이브러리: 찬양(가사 저장·재사용) · 이미지 폴더 · 오디오 폴더 · 오버레이
// - 찬양은 DB(Songs)에 저장하고, 큐시트 항목은 songId 로 연결한다 (한 번 고치면 모든 큐시트에 반영)
// - 이미지·오디오는 등록한 폴더의 파일을 /lib/file?p=… 로 제공한다 (등록 폴더 밖은 거부)
// - 오버레이는 슬라이드와 따로 출력 위에 겹치는 층 (로고·시계·카운트다운·배너)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IMAGE = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;
const VIDEO = /\.(mp4|m4v|webm|mov)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|wma)$/i;
// 이미지 폴더(= 이미지·영상)는 영상 파일도 함께 읽는다
const KINDS = { image: /\.(png|jpe?g|webp|gif|bmp|svg|mp4|m4v|webm|mov)$/i, audio: AUDIO };

const OVERLAY_TYPES = ['logo', 'clock', 'countdown', 'banner', 'text'];
const POSITIONS = ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];

const str = (v, max = 2000) => String(v ?? '').slice(0, max);
const newId = p => p + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

function normalizeOverlay(o) {
  if (!o || !OVERLAY_TYPES.includes(o.type)) throw new Error('알 수 없는 오버레이 종류입니다.');
  const num = (v, d, a, b) => { const n = Number(v); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; };
  return {
    id: /^[a-z0-9]{4,40}$/i.test(o.id || '') ? o.id : newId('o'),
    type: o.type,
    name: str(o.name, 80).trim() || { logo: '로고', clock: '시계', countdown: '카운트다운', banner: '배너', text: '글자' }[o.type],
    on: !!o.on,
    outputs: (Array.isArray(o.outputs) ? o.outputs : ['main', 'overlay']).filter(x => x === 'main' || x === 'overlay'),
    position: POSITIONS.includes(o.position) ? o.position : (o.type === 'banner' ? 'bottom-center' : 'top-right'),
    margin: num(o.margin, 40, 0, 400),
    size: num(o.size, o.type === 'logo' ? 140 : 44, 10, 800), // 로고: 높이(px) · 글자: 글자 크기(px)
    color: str(o.color, 40) || '#ffffff',
    bg: str(o.bg, 60), // 상자 색 (비우면 상자 없음)
    opacity: num(o.opacity, 1, 0.05, 1),
    image: str(o.image, 600),
    text: str(o.text, 1000),
    target: str(o.target, 40), // 카운트다운: "HH:MM" (그 시각까지) 또는 "10" (분)
    startedAt: Number(o.startedAt) || 0, // 카운트다운(분) 시작 시각
    doneText: str(o.doneText, 200),
    format: o.format === '12' ? '12' : '24',
    showSeconds: o.showSeconds !== false,
    full: !!o.full, // 배너: 화면 너비 가득
  };
}

class Library {
  constructor(core) {
    this.core = core;
    this.db = core.store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS Songs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      lyrics TEXT NOT NULL DEFAULT '',
      credit TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      updated_at TEXT
    );`);
  }

  // ---------------- 찬양 ----------------
  listSongs(query = '') {
    const q = String(query || '').replace(/\s+/g, '').toLowerCase();
    const rows = this.db.prepare('SELECT id, title, lyrics, credit, tags, updated_at FROM Songs ORDER BY title COLLATE NOCASE').all();
    const out = [];
    for (const r of rows) {
      const hay = (r.title + r.lyrics + r.tags).replace(/\s+/g, '').toLowerCase();
      if (q && !hay.includes(q)) continue;
      const first = r.lyrics.split('\n').map(l => l.trim()).find(l => l && !/^\[.*\]$/.test(l)) || '';
      out.push({ id: r.id, title: r.title, first, credit: r.credit, tags: r.tags, updatedAt: r.updated_at, titleHit: !q || r.title.replace(/\s+/g, '').toLowerCase().includes(q) });
    }
    // 제목에 맞는 곡을 앞으로
    out.sort((a, b) => (b.titleHit - a.titleHit));
    return out.slice(0, 500);
  }

  getSong(id) {
    const r = this.db.prepare('SELECT * FROM Songs WHERE id = ?').get(String(id));
    return r ? { id: r.id, title: r.title, lyrics: r.lyrics, credit: r.credit, tags: r.tags, updatedAt: r.updated_at } : null;
  }

  saveSong(s) {
    if (!s || !String(s.title || '').trim()) throw new Error('찬양 제목을 입력하세요.');
    const id = /^[a-z0-9]{4,40}$/i.test(s.id || '') ? s.id : newId('s');
    this.db.prepare('INSERT OR REPLACE INTO Songs (id, title, lyrics, credit, tags, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, str(s.title, 200).trim(), str(s.lyrics, 50000), str(s.credit, 300), str(s.tags, 300), new Date().toISOString());
    return this.getSong(id);
  }

  deleteSong(id) { this.db.prepare('DELETE FROM Songs WHERE id = ?').run(String(id)); }

  // ---------------- 이미지·오디오 폴더 ----------------
  folders(kind) {
    const key = kind === 'audio' ? 'audioFolders' : 'imageFolders';
    return (this.core.settings.get()[key] || []).map(f => ({ ...f, exists: fs.existsSync(f.path), count: this.listFiles(kind, f.path).length }));
  }

  addFolder(kind, dir, name) {
    if (!KINDS[kind]) throw new Error('알 수 없는 종류입니다.');
    dir = path.resolve(String(dir || ''));
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('폴더를 찾을 수 없습니다.');
    const n = this.listFiles(kind, dir).length;
    if (!n) throw new Error(kind === 'audio' ? '이 폴더에 음악 파일(mp3·wav·m4a 등)이 없습니다.' : '이 폴더에 그림·영상 파일(png·jpg·mp4 등)이 없습니다.');
    const key = kind === 'audio' ? 'audioFolders' : 'imageFolders';
    const label = String(name || path.basename(dir)).trim();
    this.core.settings.update(d => {
      d[key] = (d[key] || []).filter(f => path.resolve(f.path) !== dir);
      d[key].push({ name: label, path: dir });
    });
    return { name: label, path: dir, count: n };
  }

  removeFolder(kind, dir) {
    const key = kind === 'audio' ? 'audioFolders' : 'imageFolders';
    this.core.settings.update(d => { d[key] = (d[key] || []).filter(f => f.path !== dir); });
  }

  /** 폴더 안 파일 (한 단계 아래 폴더까지) */
  listFiles(kind, dir) {
    const re = KINDS[kind];
    const out = [];
    const walk = (d, depth) => {
      let names = [];
      try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of names) {
        if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (depth < 1) walk(p, depth + 1); } else if (re.test(e.name)) out.push(p);
        if (out.length >= 3000) return;
      }
    };
    walk(dir, 0);
    return out.sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
  }

  /** 검색: 파일 이름 */
  searchFiles(kind, query = '', folder = '') {
    const q = String(query || '').replace(/\s+/g, '').toLowerCase();
    const out = [];
    for (const f of this.folders(kind)) {
      if (folder && f.path !== folder) continue;
      for (const p of this.listFiles(kind, f.path)) {
        const name = path.basename(p).replace(/\.[^.]+$/, '');
        if (q && !name.replace(/\s+/g, '').toLowerCase().includes(q)) continue;
        out.push({ path: p, name, folder: f.name, url: this.fileUrl(p), video: VIDEO.test(p) });
        if (out.length >= 1000) return out;
      }
    }
    return out;
  }

  fileUrl(p) { return '/lib/file?p=' + encodeURIComponent(p); }

  /** /lib/file 요청: 등록한 이미지·오디오 폴더 안의 파일만 */
  resolveFile(p) {
    const f = path.resolve(String(p || ''));
    const s = this.core.settings.get();
    const roots = [...(s.imageFolders || []), ...(s.audioFolders || [])].map(x => path.resolve(x.path));
    if (!roots.some(r => f.startsWith(r + path.sep))) return null;
    if (!IMAGE.test(f) && !AUDIO.test(f) && !VIDEO.test(f)) return null;
    return fs.existsSync(f) ? f : null;
  }

  // ---------------- 오버레이 ----------------
  overlays() { return (this.core.settings.get().overlays || []).map(o => ({ ...o })); }

  saveOverlay(o) {
    const n = normalizeOverlay(o);
    this.core.settings.update(d => {
      const list = d.overlays || (d.overlays = []);
      const i = list.findIndex(x => x.id === n.id);
      if (i >= 0) list[i] = n; else list.push(n);
    });
    return n;
  }

  deleteOverlay(id) {
    this.core.settings.update(d => { d.overlays = (d.overlays || []).filter(o => o.id !== id); });
  }

  /** 켜기·끄기 (카운트다운(분)은 켤 때 시작 시각을 기록) */
  toggleOverlay(id, on) {
    let out = null;
    this.core.settings.update(d => {
      const o = (d.overlays || []).find(x => x.id === id);
      if (!o) return;
      o.on = on === undefined ? !o.on : !!on;
      if (o.on && o.type === 'countdown') o.startedAt = Date.now();
      out = { ...o };
    });
    if (!out) throw new Error('오버레이를 찾을 수 없습니다.');
    return out;
  }

  /** 출력 화면에 보낼, 켜져 있는 오버레이 */
  activeFor(output) {
    return this.overlays().filter(o => o.on && o.outputs.includes(output));
  }
}

module.exports = { Library, normalizeOverlay, OVERLAY_TYPES, POSITIONS, IMAGE, AUDIO, VIDEO };
