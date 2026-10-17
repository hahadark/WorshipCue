'use strict';
// 찬송가·교독문·찬양 PPT 폴더 (.pps .ppt .pptx .ppsx)
// - 폴더를 등록해 두면 번호·제목으로 찾아 큐시트에 넣는다
// - 처음 쓸 때 파일에서 그림·글자를 꺼내 데이터 폴더의 hymn-cache 에 저장 (다음부터 바로)
// - 폴더마다 읽는 방식: auto(악보·배경을 나눠 꺼냄) | slides(PowerPoint 로 슬라이드를 화면 그대로 그림으로)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractPps } = require('./ppt');
const { hasPowerPoint, exportWithPowerPoint, extractPptx } = require('./pptrender');
const { alignLyrics } = require('./hymnlyrics');

const EXT = /\.(pps|ppt|ppsx|pptx)$/i;

/** "010 전능왕 오셔서.pps" → { number: 10, title: '전능왕 오셔서' } */
function parseName(file) {
  const base = path.basename(file).replace(EXT, '').trim();
  const m = base.match(/^(\d{1,4})\s*[._-]?\s*(.+)$/);
  if (m) return { number: Number(m[1]), title: m[2].trim(), name: base };
  const m2 = base.match(/^(.+?)\s*(\d{1,4})\s*\((.+)\)$/); // "교독문 13 (시편 23편)"
  if (m2) return { number: Number(m2[2]), title: `${m2[1].trim()} ${m2[2]} (${m2[3]})`, name: base };
  return { number: null, title: base, name: base };
}

function listFolder(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => EXT.test(f)); } catch { return []; }
  return files.map(f => ({ file: path.join(dir, f), ...parseName(f) }))
    .sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || a.title.localeCompare(b.title, 'ko'));
}

class Hymns {
  constructor(core) {
    this.core = core;
    this.cacheDir = path.join(core.dataDir, 'hymn-cache');
    this.loading = new Map(); // 같은 파일을 동시에 두 번 꺼내지 않도록
  }

  folders() {
    return (this.core.settings.get().hymnFolders || []).map(f => ({ render: 'auto', ...f, count: listFolder(f.path).length, exists: fs.existsSync(f.path) }));
  }

  addFolder(dir, name, { render = 'auto', allowEmpty = false } = {}) {
    dir = path.resolve(String(dir || ''));
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('폴더를 찾을 수 없습니다.');
    const n = listFolder(dir).length;
    if (!n && !allowEmpty) throw new Error('이 폴더에 .pps / .ppt / .pptx 파일이 없습니다.');
    const label = String(name || path.basename(dir)).trim();
    this.core.settings.update(d => {
      d.hymnFolders = (d.hymnFolders || []).filter(f => path.resolve(f.path) !== dir);
      d.hymnFolders.push({ name: label, path: dir, render: render === 'slides' ? 'slides' : 'auto' });
    });
    return { name: label, path: dir, count: n };
  }

  setFolderRender(dir, render) {
    this.core.settings.update(d => { for (const f of d.hymnFolders || []) if (f.path === dir) f.render = render === 'slides' ? 'slides' : 'auto'; });
  }

  folderOf(file) {
    const f = path.resolve(file);
    return this.folders().find(x => f.startsWith(path.resolve(x.path) + path.sep)) || null;
  }

  removeFolder(dir) {
    this.core.settings.update(d => { d.hymnFolders = (d.hymnFolders || []).filter(f => f.path !== dir); });
  }

  /** 번호(예: 10, 010) 또는 제목 일부로 찾기 */
  search(query, folderPath) {
    const q = String(query || '').trim();
    const num = /^\d{1,4}$/.test(q) ? Number(q) : null;
    const key = q.replace(/\s+/g, '');
    const out = [];
    for (const f of this.folders()) {
      if (folderPath && f.path !== folderPath) continue;
      for (const h of listFolder(f.path)) {
        if (!q || (num !== null ? h.number === num || String(h.number).startsWith(q) : h.title.replace(/\s+/g, '').includes(key))) {
          out.push({ ...h, folder: f.name });
        }
      }
    }
    // 번호 정확히 일치하는 것을 맨 앞으로
    if (num !== null) out.sort((a, b) => (b.number === num) - (a.number === num));
    return out.slice(0, 300);
  }

  isAllowed(file) {
    const f = path.resolve(file);
    const s = this.core.settings.get();
    if ((s.droppedFiles || []).some(x => path.resolve(x) === f) && EXT.test(f)) return true; // 끌어다 놓은 PPT
    return (s.hymnFolders || []).some(x => f.startsWith(path.resolve(x.path) + path.sep));
  }

  /** 파일에서 그림·글자를 꺼내 캐시에 두고 주소를 돌려준다 */
  async load(file) {
    if (!this.isAllowed(file)) throw new Error('등록한 찬송가 폴더 안의 파일만 열 수 있습니다.');
    const st = fs.statSync(file);
    const folder = this.folderOf(file);
    const pp = await hasPowerPoint();
    const xml = /\.(pptx|ppsx)$/i.test(file);
    const mode = xml ? (pp ? 'slides' : 'pptx') : (folder && folder.render === 'slides' && pp ? 'slides' : 'auto');
    const key = crypto.createHash('sha1').update(`${path.resolve(file)}|${st.size}|${st.mtimeMs}|${mode}|v2`).digest('hex').slice(0, 16);
    if (!this.loading.has(key)) this.loading.set(key, this.build(file, key, mode, pp).finally(() => this.loading.delete(key)));
    const meta = await this.loading.get(key);
    return this.withCaptions(meta, folder);
  }

  /**
   * 슬라이드마다 OBS 자막(가사만)에 쓸 글자: PPT 안의 글자 → (새찬송가 폴더면) 베들레헴 새찬송가 가사 DB
   * captions[i] = i번째 슬라이드 가사 ('' 이면 없음)
   */
  withCaptions(meta, folder) {
    const n = meta.slides ? meta.slides.length : meta.scores.length;
    const own = meta.slides ? meta.slideTexts || [] : meta.texts.length === n ? meta.texts.map(t => t.join('\n')) : [];
    if (own.some(t => t && t.trim())) return { ...meta, captions: own.map(t => String(t || '').replace(/\n\s*\n/g, '\n').trim()), captionSource: 'PPT 안의 글자' };
    const isNew = folder && /새찬송가/.test(`${folder.name} ${path.basename(folder.path)}`);
    if (isNew && meta.number && n) {
      const lyr = this.core.hymnLyrics.get(meta.number);
      if (lyr) return { ...meta, captions: alignLyrics(lyr, n), captionSource: `새찬송가 가사 DB (${lyr.number}장 ${lyr.title})` };
    }
    return { ...meta, captions: [], captionSource: '' };
  }

  async build(file, key, mode, pp) {
    const dir = path.join(this.cacheDir, key);
    const metaFile = path.join(dir, 'meta.json');
    if (fs.existsSync(metaFile)) {
      try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { /* 다시 만든다 */ }
    }
    const url = f => `/hymn/${key}/${f}`;
    let r = null;
    if (mode === 'auto') {
      try { r = extractPps(file); } catch (e) { if (!pp) throw new Error('파일을 읽지 못했습니다: ' + e.message); }
      // 그림도 글자도 못 꺼냈으면 PowerPoint 로 화면 그대로
      if ((!r || (!r.scores.length && !r.texts.some(t => t.length))) && pp) mode = 'slides';
    }
    if (mode === 'slides') {
      const e = await exportWithPowerPoint(file, dir);
      if (!e.files.length) throw new Error('슬라이드가 없는 파일입니다.');
      const meta = { key, ...parseName(file), file, mode, background: null, scores: [], texts: [], slides: e.files.map(url), slideTexts: e.texts || [], aspect: e.width / e.height };
      fs.writeFileSync(metaFile, JSON.stringify(meta));
      return meta;
    }
    if (mode === 'pptx') r = extractPptx(file);
    if (!r) throw new Error('파일을 읽지 못했습니다.');
    fs.mkdirSync(dir, { recursive: true });
    const meta = { key, ...parseName(file), file, mode, background: null, scores: [], texts: r.texts };
    if (r.background) { const f = `bg.${r.background.ext}`; fs.writeFileSync(path.join(dir, f), r.background.data); meta.background = url(f); }
    r.scores.forEach((p, i) => { const f = `score-${String(i + 1).padStart(2, '0')}.${p.ext}`; fs.writeFileSync(path.join(dir, f), p.data); meta.scores.push(url(f)); });
    fs.writeFileSync(metaFile, JSON.stringify(meta));
    return meta;
  }

  /** /hymn/<key>/<file> 요청 → 캐시 파일 경로 */
  cachePath(key, file) {
    if (!/^[0-9a-f]{16}$/.test(key) || !/^[\w.-]+$/.test(file)) return null;
    return path.join(this.cacheDir, key, file);
  }
}

module.exports = { Hymns, parseName, listFolder };
