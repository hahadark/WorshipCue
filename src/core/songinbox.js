'use strict';
// 온라인에서 받은 찬양 PPT 자동 추가
// - '온라인에서 찾기'를 누르면 정해진 시간 동안 다운로드 폴더를 지켜본다
// - 새 PPT 가 다 받아지면 찬양 PPT 폴더로 옮기고(폴더는 자동 등록) 'song-downloaded' 를 알린다
//   → 조작 화면이 큐시트의 고른 순서 다음에 넣는다

const fs = require('fs');
const os = require('os');
const path = require('path');

const PPT = /\.(pps|ppt|ppsx|pptx)$/i;
const PARTIAL = /\.(crdownload|part|tmp|download|partial)$/i;
const WATCH_MS = 20 * 60 * 1000;

class SongInbox {
  constructor(core) {
    this.core = core;
    this.timer = null;
    this.until = 0;
    this.seen = new Map();    // 지켜보기 시작할 때 있던 파일 → mtime
    this.pending = new Map(); // 받는 중인 파일 → 지난번 크기
  }

  downloadsDir() {
    const s = this.core.settings.get();
    if (s.songDownloadDir) return s.songDownloadDir;
    if (this.core.desktop && this.core.desktop.downloadsDir) return this.core.desktop.downloadsDir;
    return path.join(os.homedir(), 'Downloads');
  }

  targetDir() {
    const s = this.core.settings.get();
    if (s.songInboxDir) return s.songInboxDir;
    const docs = this.core.desktop && this.core.desktop.documentsDir ? this.core.desktop.documentsDir : path.join(os.homedir(), 'Documents');
    return path.join(docs, 'WorshipCue 찬양 PPT');
  }

  status() {
    return { watching: Date.now() < this.until, until: this.until, downloads: this.downloadsDir(), target: this.targetDir() };
  }

  /** 지켜보기 시작 (이미 보고 있으면 시간만 늘린다) */
  arm(ms = WATCH_MS) {
    const dir = this.downloadsDir();
    if (!fs.existsSync(dir)) throw new Error(`다운로드 폴더를 찾을 수 없습니다: ${dir}`);
    if (!this.timer) {
      this.seen = new Map(this.list(dir).map(f => [f.name, f.mtime]));
      this.pending.clear();
      this.timer = setInterval(() => this.tick(), 1500);
    }
    this.until = Date.now() + ms;
    this.core.emit('song-inbox', this.status());
    return this.status();
  }

  disarm() {
    clearInterval(this.timer);
    this.timer = null;
    this.until = 0;
    this.core.emit('song-inbox', this.status());
    return this.status();
  }

  list(dir) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    const out = [];
    for (const name of names) {
      if (!PPT.test(name) || PARTIAL.test(name) || name.startsWith('~$')) continue;
      try { const st = fs.statSync(path.join(dir, name)); if (st.isFile()) out.push({ name, mtime: st.mtimeMs, size: st.size }); } catch { /* 지워짐 */ }
    }
    return out;
  }

  tick() {
    if (Date.now() > this.until) return this.disarm();
    const dir = this.downloadsDir();
    for (const f of this.list(dir)) {
      if (this.seen.has(f.name) && this.seen.get(f.name) === f.mtime) continue;
      // 크기가 두 번 연속 같으면 다 받은 것
      const last = this.pending.get(f.name);
      if (last === undefined || last !== f.size || f.size === 0) { this.pending.set(f.name, f.size); continue; }
      this.pending.delete(f.name);
      this.seen.set(f.name, f.mtime);
      try { this.take(path.join(dir, f.name)); } catch (e) {
        this.core.logger && this.core.logger.warn(`다운로드한 PPT 처리 실패: ${e.message}`);
        this.core.emit('song-downloaded', { error: `${f.name}: ${e.message}` });
      }
    }
  }

  /** 받은 파일을 찬양 PPT 폴더로 옮기고 알린다 */
  take(src) {
    const target = this.targetDir();
    fs.mkdirSync(target, { recursive: true });
    const ext = path.extname(src);
    const base = path.basename(src, ext).replace(/\s*\(\d+\)$/, ''); // 브라우저가 붙인 "(1)" 은 뗀다
    let dest = path.join(target, base + ext);
    for (let k = 2; fs.existsSync(dest); k++) dest = path.join(target, `${base} (${k})${ext}`);
    try { fs.renameSync(src, dest); } catch { fs.copyFileSync(src, dest); try { fs.unlinkSync(src); } catch { /* 원본은 남긴다 */ } }
    const h = this.core.hymns;
    if (!h.folderOf(dest)) h.addFolder(target, '찬양 PPT (다운로드)', { render: 'slides', allowEmpty: true });
    const { parseName } = require('./hymns');
    this.core.settingsChanged('settings');
    this.core.emit('song-downloaded', { file: dest, ...parseName(dest) });
  }
}

/** 검색 주소 틀의 {q} 에 검색어를 넣는다 (http/https 만) */
function onlineSearchUrl(template, query) {
  const t = String(template || '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(t)) throw new Error('온라인 검색 주소가 올바르지 않습니다 (http:// 또는 https:// 로 시작).');
  const q = encodeURIComponent(String(query || '').trim());
  return t.includes('{q}') ? t.replace('{q}', q) : t;
}

module.exports = { SongInbox, onlineSearchUrl };
