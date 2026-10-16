'use strict';
// 핵심 모듈 조립 + 내부 명령 인터페이스(8.4).
// 조작 화면, 전역 단축키, 향후 Companion/Stream Deck 등은 모두 command() 하나로 들어온다.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { BibleStore } = require('./db');
const { Settings, DEFAULT_SHORTCUTS, SHORTCUT_LABELS } = require('./settings');
const { Presentation } = require('./presentation');
const { Logger } = require('./logger');
const { analyzeFile, commitImport } = require('./importer');
const { normalizeTemplate } = require('./templates');
const { listThemes, THEMES, buildOne } = require('./themes');
const { analyzeEpub } = require('./commentary');
const { findDirs, listBibles, metaFor } = require('./bethlehem');
const { normalizeCue, newId, sampleItems } = require('./cues');
const { Hymns } = require('./hymns');
const { BOOKS, getBook } = require('./books');
const { formatTitle } = require('./db');

const OUTPUTS = ['main', 'overlay'];
const PRINTABLE_PLAIN = /^(?:[A-Z0-9]|Space|Enter|Backspace|Tab|Minus|Equal|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Backquote)$/;

class WorshipCueCore extends EventEmitter {
  constructor({ dataDir, logEcho = false, seedDb = null }) {
    super();
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.mediaDir = path.join(dataDir, 'media');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    this.logger = new Logger(path.join(dataDir, 'logs'), { echo: logEcho });
    this.settings = new Settings(dataDir, this.logger);
    const dbFile = path.join(dataDir, 'bible.db');
    installSeedDb(dbFile, seedDb, this.logger);
    this.store = new BibleStore(dbFile);
    this.presentation = new Presentation(this.logger);
    this.hymns = new Hymns(this);
    this.pendingImports = new Map();
    this.outputClients = new Map(); // clientId → {client, kind, connectedAt, ack}
    this.desktop = null; // Electron 측에서 등록 (모니터·창 상태)

    const s = this.settings.get();
    if (!s.versionId || !this.store.getVersion(s.versionId)) {
      const all = this.store.listVersions();
      const first = all.find(v => v.id === 'nkrv') || all.find(v => v.id === 'krv') || all[0];
      this.settings.update(d => { d.versionId = first ? first.id : ''; });
    }
    this.presentation.on('live', () => this.emit('live'));
    this.presentation.on('preview', () => this.emit('preview'));
    this.presentation.on('edge', ({ edge, live }) => {
      // 큐시트 항목을 송출 중이면 다음(이전) 순서로 넘어간다
      if (live && live.passage && live.passage.cueId && live.passage.cueIndex >= 0 && this.settings.get().cueAdvance !== false) {
        this.emit('cue-next', { dir: edge === 'end' ? 1 : -1, version: this.presentation.version, cueId: live.passage.cueId, index: live.passage.cueIndex });
        return;
      }
      if (this.settings.get().navMode === 'continuous') {
        this.emit('extend-request', { dir: edge === 'end' ? 1 : -1, version: this.presentation.version });
      }
    });
    this.logger.info('WorshipCue 시작');
  }

  versionId(args) {
    return (args && args.versionId) || this.settings.get().versionId;
  }

  templateFor(output) {
    const s = this.settings.get();
    const id = s.activeTemplates[output];
    return s.templates.find(t => t.id === id) || s.templates[0];
  }

  /** 출력 화면(전체화면 창·OBS)에 보낼 데이터 */
  outputPayload(output) {
    const live = this.presentation.getLiveState();
    return {
      output,
      version: live.version,
      hasLive: live.hasLive,
      visible: live.visible,
      slide: live.slide,
      versionName: live.passage ? live.passage.versionName : '',
      template: this.templateFor(output),
      cursorHidden: this.settings.get().output.cursorHidden,
    };
  }

  outputStatus() {
    const list = [];
    for (const [id, c] of this.outputClients) {
      if (c.client === 'control') continue;
      list.push({ id, output: c.client, kind: c.kind, connectedAt: c.connectedAt, ack: c.ack });
    }
    return { clients: list, desktop: this.desktop ? this.desktop.status() : null };
  }

  getState() {
    const s = this.settings.get();
    return {
      live: this.presentation.getLiveState(),
      preview: this.presentation.preview ? {
        passage: this.presentation.preview.passage,
        index: this.presentation.preview.index,
        count: this.presentation.preview.slides.length,
      } : null,
      versions: this.store.listVersions(),
      commentaries: this.store.listCommentaries(),
      settings: s,
      shortcutLabels: SHORTCUT_LABELS,
      defaultShortcuts: DEFAULT_SHORTCUTS,
      outputs: this.outputStatus(),
      port: this.activePort || s.port,
      portWarning: this.portWarning || '',
      dataDir: this.dataDir,
    };
  }

  addHistory() {
    const live = this.presentation.live;
    if (!live) return;
    this.settings.update(d => {
      d.history.unshift({ at: Date.now(), title: live.passage.title, query: live.passage.query, versionId: live.passage.versionId, versionName: live.passage.versionName });
      if (d.history.length > 300) d.history.length = 300;
    });
  }

  settingsChanged(what) {
    this.emit('settings', what);
    if (what === 'templates') this.emit('live'); // 출력 화면 디자인 즉시 반영
  }

  // ---------------- 명령 ----------------
  command(cmd, args = {}) {
    const fn = this.commands[cmd];
    if (!fn) return { ok: false, error: `알 수 없는 명령: ${cmd}` };
    try {
      const result = fn.call(this, args || {});
      if (result && typeof result.then === 'function') {
        return result.then(v => ({ ok: true, result: v, liveVersion: this.presentation.version }))
          .catch(e => ({ ok: false, error: e.message, liveVersion: this.presentation.version }));
      }
      if (result && result.ok === false) return result;
      return { ok: true, result, liveVersion: this.presentation.version };
    } catch (e) {
      this.logger.error(`명령 ${cmd} 실패: ${e.message}`);
      return { ok: false, error: e.message, liveVersion: this.presentation.version };
    }
  }
}

WorshipCueCore.prototype.commands = {
  // ---- 검색 (Live 에 영향 없음) ----
  searchReference(a) { return this.store.resolveReference(this.versionId(a), String(a.query || '')); },
  searchText(a) { return this.store.searchText(this.versionId(a), String(a.query || ''), { limit: a.limit || 300, bookIds: a.bookIds }); },
  getStructure(a) { return { versionId: this.versionId(a), books: this.store.getStructure(this.versionId(a)) }; },
  getChapter(a) {
    return this.store.resolveRanges(this.versionId(a), Number(a.bookId), [{ sc: Number(a.chapter), sv: null, ec: Number(a.chapter), ev: null }]);
  },
  getRange(a) {
    return this.store.resolveRanges(this.versionId(a), Number(a.bookId), [{ sc: +a.sc, sv: +a.sv, ec: +a.ec, ev: +a.ev }]);
  },
  adjacentVerse(a) {
    const v = this.store.adjacentVerse(this.versionId(a), Number(a.book), Number(a.chapter), Number(a.verse), Number(a.dir) || 1);
    if (!v) return { ok: false, error: Number(a.dir) > 0 ? '책의 마지막 절입니다.' : '책의 첫 절입니다.', edge: true };
    return this.store.resolveRanges(this.versionId(a), v.book, [{ sc: v.chapter, sv: v.verse, ec: v.chapter, ev: v.verse }]);
  },
  getBooks() { return BOOKS.map(b => ({ id: b.id, name: b.name, short: b.short, testament: b.testament })); },

  // ---- 미리보기 ----
  previewReference(a) { return this.presentation.setPreview(a); },
  setPreview(a) { return this.presentation.setPreview(a); },
  setPreviewIndex(a) { return this.presentation.setPreviewIndex(a.index); },

  // ---- Live ----
  sendLive(a) {
    const r = this.presentation.sendLive(a && a.slides ? a : null);
    this.addHistory();
    // 송출을 시작하면 보조 화면(예배당 모니터) 출력을 자동으로 켠다
    const out = this.settings.get().output;
    if (this.desktop && out.autoOnSend !== false && !out.enabled) {
      try { this.desktop.setOutput({ enabled: true }); this.emit('outputs'); } catch (e) { this.logger.warn('보조 화면 자동 켜기 실패: ' + e.message); }
    }
    return r;
  },
  outputOff() {
    if (!this.desktop) return { enabled: false };
    const r = this.desktop.setOutput({ enabled: false });
    this.emit('outputs');
    return r;
  },
  nextSlide() { return this.presentation.move(1); },
  previousSlide() { return this.presentation.move(-1); },
  gotoSlide(a) { return this.presentation.gotoSlide(a.index); },
  extendLive(a) { return this.presentation.extendLive(a); },
  clearLive() { return this.presentation.clear(); },
  restoreLive() { return this.presentation.restore(); },
  toggleLive() { return this.presentation.toggle(); },
  getLiveState() { return this.presentation.getLiveState(); },
  getState() { return this.getState(); },

  // ---- 템플릿 ----
  setTemplate(a) {
    if (!OUTPUTS.includes(a.output)) throw new Error('출력 대상이 올바르지 않습니다.');
    const s = this.settings.get();
    if (!s.templates.some(t => t.id === a.templateId)) throw new Error('템플릿을 찾을 수 없습니다.');
    this.settings.update(d => { d.activeTemplates[a.output] = a.templateId; });
    this.settingsChanged('templates');
    return { output: a.output, templateId: a.templateId };
  },
  saveTemplate(a) {
    const t = normalizeTemplate(a.template || {});
    if (!t.name || !String(t.name).trim()) throw new Error('템플릿 이름을 입력하세요.');
    t.width = clampInt(t.width, 320, 7680, 1920);
    t.height = clampInt(t.height, 180, 4320, 1080);
    t.font.size = clampInt(t.font.size, 8, 400, 72);
    t.font.minSize = clampInt(t.font.minSize, 8, t.font.size, Math.min(44, t.font.size));
    this.settings.update(d => {
      const i = d.templates.findIndex(x => x.id === t.id);
      if (!t.id || i < 0) {
        t.id = t.id && !d.templates.some(x => x.id === t.id) ? t.id : 'tpl-' + Date.now().toString(36);
        t.preset = false;
        d.templates.push(t);
      } else {
        t.preset = d.templates[i].preset;
        d.templates[i] = t;
      }
    });
    this.settingsChanged('templates');
    return t;
  },
  duplicateTemplate(a) {
    const s = this.settings.get();
    const src = s.templates.find(t => t.id === a.id);
    if (!src) throw new Error('템플릿을 찾을 수 없습니다.');
    const copy = structuredClone(src);
    copy.id = 'tpl-' + Date.now().toString(36);
    copy.name = a.name || src.name + ' 복사본';
    copy.preset = false;
    this.settings.update(d => { d.templates.push(copy); });
    this.settingsChanged('templates');
    return copy;
  },
  // ---- 테마 (구세군 프리셋) ----
  listThemes() { return listThemes(); },
  /** 테마 적용: 테마 템플릿 한 쌍을 만들거나 기본값으로 되돌린 뒤 두 출력에 지정 */
  applyTheme(a) {
    const theme = THEMES.find(t => t.id === a.id);
    if (!theme) throw new Error('테마를 찾을 수 없습니다.');
    const outputs = Array.isArray(a.outputs) && a.outputs.length ? a.outputs.filter(o => OUTPUTS.includes(o)) : OUTPUTS;
    this.settings.update(d => {
      for (const o of outputs) {
        const tpl = buildOne(theme, o);
        const i = d.templates.findIndex(x => x.id === tpl.id);
        if (i >= 0) d.templates[i] = tpl; else d.templates.push(tpl);
        d.activeTemplates[o] = tpl.id;
      }
    });
    this.settingsChanged('templates');
    this.logger.info(`테마 적용: ${theme.name} (${outputs.join(', ')})`);
    return { id: theme.id, outputs };
  },
  deleteTemplate(a) {
    const s = this.settings.get();
    if (s.templates.length <= 1) throw new Error('마지막 템플릿은 삭제할 수 없습니다.');
    const inUse = Object.entries(s.activeTemplates).filter(([, id]) => id === a.id).map(([o]) => o);
    if (inUse.length) throw new Error(`현재 ${inUse.map(o => o === 'main' ? '전체 화면' : 'OBS 자막').join(', ')} 출력에서 사용 중인 템플릿입니다. 다른 템플릿을 먼저 지정하세요.`);
    this.settings.update(d => { d.templates = d.templates.filter(t => t.id !== a.id); });
    this.settingsChanged('templates');
    return { id: a.id };
  },

  // ---- 설정 ----
  updateSettings(a) {
    const p = a.patch || {};
    this.settings.update(d => {
      if (typeof p.versionId === 'string' && this.store.getVersion(p.versionId)) d.versionId = p.versionId;
      if (['auto', 'reference', 'text'].includes(p.searchMode)) d.searchMode = p.searchMode;
      if (p.split) {
        if (['auto', 'count'].includes(p.split.mode)) d.split.mode = p.split.mode;
        if (p.split.count != null) d.split.count = clampInt(p.split.count, 1, 20, 2);
      }
      if (['range', 'continuous'].includes(p.navMode)) d.navMode = p.navMode;
      if (typeof p.globalShortcuts === 'boolean') d.globalShortcuts = p.globalShortcuts;
      if (typeof p.cueAdvance === 'boolean') d.cueAdvance = p.cueAdvance;
      if (typeof p.hymnBackground === 'string') d.hymnBackground = p.hymnBackground.slice(0, 300);
      if (typeof p.reservedKeys === 'string') d.reservedKeys = p.reservedKeys.slice(0, 1000);
      if (p.output && typeof p.output.cursorHidden === 'boolean') d.output.cursorHidden = p.output.cursorHidden;
      if (p.output && typeof p.output.autoOnSend === 'boolean') d.output.autoOnSend = p.output.autoOnSend;
      if (p.port != null) d.port = clampInt(p.port, 1024, 65535, 37528);
      if (p.guide && typeof p.guide.bethlehemDone === 'boolean') d.guide = { ...(d.guide || {}), bethlehemDone: p.guide.bethlehemDone };
    });
    this.settingsChanged('settings');
    if (p.output) this.emit('live');
    return this.settings.get();
  },
  setShortcuts(a) {
    const map = { ...DEFAULT_SHORTCUTS, ...(a.shortcuts || {}) };
    const seen = new Map();
    for (const [action, key] of Object.entries(map)) {
      if (!(action in DEFAULT_SHORTCUTS)) throw new Error(`알 수 없는 기능: ${action}`);
      if (!key) continue; // 비워 두면 사용 안 함
      const mainKey = key.split('+').pop();
      const hasMod = /(?:^|\+)(Ctrl|Alt|Meta)\+/.test(key);
      if (!hasMod && PRINTABLE_PLAIN.test(mainKey)) throw new Error(`'${key}'는 글자 입력과 겹치므로 단독으로 쓸 수 없습니다. Ctrl/Alt 조합이나 F키를 쓰세요.`);
      if (seen.has(key)) throw new Error(`'${key}' 단축키가 '${SHORTCUT_LABELS[seen.get(key)]}'와(과) 중복됩니다.`);
      seen.set(key, action);
    }
    this.settings.update(d => { d.shortcuts = map; });
    this.settingsChanged('shortcuts');
    return map;
  },
  // ---- 모니터 출력 (Electron 데스크톱에서만) ----
  getDisplays() {
    if (!this.desktop) return { available: false, displays: [] };
    return { available: true, displays: this.desktop.listDisplays(), status: this.desktop.status() };
  },
  setOutputWindow(a) {
    if (!this.desktop) throw new Error('전체 화면 출력 창은 데스크톱 프로그램에서만 사용할 수 있습니다.');
    const r = this.desktop.setOutput({ enabled: a.enabled, displayId: a.displayId });
    this.emit('outputs');
    return r;
  },
  toggleOutputWindow() {
    if (!this.desktop) throw new Error('전체 화면 출력 창은 데스크톱 프로그램에서만 사용할 수 있습니다.');
    const r = this.desktop.setOutput({ enabled: !this.settings.get().output.enabled });
    this.emit('outputs');
    return r;
  },
  getGlobalShortcutStatus() {
    return this.desktop ? this.desktop.globalShortcutStatus() : { available: false };
  },
  clearHistory() { this.settings.update(d => { d.history = []; }); this.settingsChanged('settings'); return {}; },

  // ---- 성경 데이터 ----
  listVersions() { return this.store.listVersions(); },
  analyzeImport(a) {
    const analysis = analyzeFile(String(a.path));
    const token = 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.pendingImports.set(token, analysis);
    setTimeout(() => this.pendingImports.delete(token), 30 * 60e3).unref?.();
    return { token, report: analysis.report, meta: analysis.meta };
  },
  commitImport(a) {
    const analysis = this.pendingImports.get(a.token);
    if (!analysis) throw new Error('가져오기 분석 결과가 만료되었습니다. 다시 시도하세요.');
    const r = commitImport(this.store, analysis, a.meta || {});
    if (!r.ok) return { ok: false, error: r.errors.join('\n'), errors: r.errors };
    this.pendingImports.delete(a.token);
    this.logger.info(`성경 데이터 가져옴: ${a.meta.id} (${r.stats.verses}절)`);
    if (!this.settings.get().versionId) this.settings.update(d => { d.versionId = a.meta.id; });
    this.settingsChanged('versions');
    return r;
  },
  /** 베들레헴 설치 안내 페이지 열기 (데스크톱: 기본 브라우저, 브라우저 실행: 주소만 돌려줌) */
  openBethlehemSetup() {
    const url = 'https://bethlehembible.org/setup/#%EC%9C%88%EB%8F%84%EC%9A%B0';
    if (this.desktop && this.desktop.openExternal) { this.desktop.openExternal(url); return { opened: true, url }; }
    return { opened: false, url };
  },
  // ---- 베들레헴 성경 폴더에서 한꺼번에 가져오기 ----
  findBethlehem(a) {
    const extra = a.dir ? [String(a.dir)] : [];
    return findDirs(extra).map(dir => ({ dir, bibles: listBibles(dir) }));
  },
  importBethlehem(a) {
    const dir = String(a.dir || '');
    const files = Array.isArray(a.files) ? a.files : [];
    const list = listBibles(dir);
    const results = [];
    for (const f of files) {
      if (!list.some(x => x.file === f)) { results.push({ file: f, ok: false, error: '파일 없음' }); continue; }
      const analysis = analyzeFile(path.join(dir, f));
      const r = commitImport(this.store, analysis, metaFor(f));
      results.push(r.ok ? { file: f, ok: true, verses: r.stats.verses } : { file: f, ok: false, error: r.errors.slice(0, 2).join(' / ') });
    }
    const okIds = results.filter(r => r.ok).map(r => metaFor(r.file).id);
    if (okIds.length && !this.store.getVersion(this.settings.get().versionId)) this.settings.update(d => { d.versionId = okIds.includes('nkrv') ? 'nkrv' : okIds[0]; });
    this.logger.info(`베들레헴에서 가져옴: ${results.filter(r => r.ok).map(r => r.file).join(', ')}`);
    this.settingsChanged('versions');
    return results;
  },
  // ---- 찬송가·교독문 폴더 ----
  listHymnFolders() { return this.hymns.folders(); },
  addHymnFolder(a) { const r = this.hymns.addFolder(a.path, a.name); this.settingsChanged('settings'); return r; },
  removeHymnFolder(a) { this.hymns.removeFolder(String(a.path)); this.settingsChanged('settings'); return {}; },
  searchHymns(a) { return this.hymns.search(a.query, a.folder || null); },
  loadHymn(a) { return this.hymns.load(String(a.file)); },
  /** 폴더 고르기 창 (데스크톱에서만) */
  pickFolder(a) {
    if (!this.desktop || !this.desktop.pickFolder) throw new Error('폴더 고르기 창은 데스크톱 프로그램에서만 열 수 있습니다. 경로를 직접 입력하세요.');
    return this.desktop.pickFolder(a.title || '폴더 고르기');
  },
  // ---- 큐시트 (예배 순서) ----
  listCues() { return this.store.listCues(); },
  getCue(a) {
    const c = this.store.getCue(String(a.id));
    if (!c) throw new Error('큐시트를 찾을 수 없습니다.');
    return c;
  },
  saveCue(a) {
    const c = normalizeCue(a.cue);
    const saved = this.store.saveCue(c);
    this.settings.update(d => { d.activeCueId = saved.id; });
    this.emit('cues', { id: saved.id });
    return saved;
  },
  newCue(a) {
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const c = normalizeCue({ name: a.name || `${today} 예배`, serviceDate: a.serviceDate || today, items: a.empty ? [] : sampleItems() });
    return this.commands.saveCue.call(this, { cue: c });
  },
  duplicateCue(a) {
    const src = this.store.getCue(String(a.id));
    if (!src) throw new Error('큐시트를 찾을 수 없습니다.');
    const c = normalizeCue({ name: a.name || src.name + ' 복사본', serviceDate: src.serviceDate, items: src.items.map(it => ({ ...it, id: newId() })) });
    return this.commands.saveCue.call(this, { cue: c });
  },
  deleteCue(a) {
    this.store.deleteCue(String(a.id));
    if (this.settings.get().activeCueId === a.id) this.settings.update(d => { d.activeCueId = ''; });
    this.emit('cues', { id: '' });
    return {};
  },
  setActiveCue(a) { this.settings.update(d => { d.activeCueId = String(a.id || ''); }); return {}; },
  // ---- 주석 (조작 화면 참고용, 송출하지 않음) ----
  listCommentaries() { return this.store.listCommentaries(); },
  analyzeCommentary(a) {
    const r = analyzeEpub(String(a.path));
    const token = 'cm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.pendingImports.set(token, r);
    setTimeout(() => this.pendingImports.delete(token), 30 * 60e3).unref?.();
    const covered = r.stats.filter(s => s.entries > 0);
    return {
      token, title: r.title, entries: r.entries.length, articles: r.articles.length,
      books: covered.length, weak: r.stats.filter(s => s.chapters / s.of < 0.6).map(s => s.name),
      stats: r.stats,
    };
  },
  commitCommentary(a) {
    const r = this.pendingImports.get(a.token);
    if (!r) throw new Error('분석 결과가 만료되었습니다. 다시 시도하세요.');
    const meta = a.meta || {};
    if (!meta.id || !/^[a-z0-9_-]{2,32}$/i.test(meta.id)) throw new Error('주석 ID는 영문·숫자 2~32자로 입력하세요.');
    if (!meta.name) throw new Error('주석 이름을 입력하세요.');
    this.store.replaceCommentary(meta, r.entries, r.articles);
    this.pendingImports.delete(a.token);
    this.logger.info(`주석 가져옴: ${meta.name} (${r.entries.length}항목)`);
    this.settingsChanged('commentaries');
    return { entries: r.entries.length, articles: r.articles.length };
  },
  deleteCommentary(a) { this.store.deleteCommentary(String(a.id)); this.settingsChanged('commentaries'); return {}; },
  commentaryFor(a) {
    return this.store.commentaryFor(Number(a.book), +a.sc, +a.sv, +a.ec, +a.ev, a.commentaryId || null);
  },
  deleteVersion(a) {
    this.store.deleteVersion(String(a.id));
    if (this.settings.get().versionId === a.id) {
      const first = this.store.listVersions()[0];
      this.settings.update(d => { d.versionId = first ? first.id : ''; });
    }
    this.logger.info(`번역본 삭제: ${a.id}`);
    this.settingsChanged('versions');
    return {};
  },
};

/**
 * 프로그램에 포함된 기본 성경 DB를 데이터 폴더로 복사한다.
 * 데이터 폴더에 DB가 없거나, 있어도 번역본이 하나도 없을 때만 복사하므로 사용자가 가져온 데이터는 덮어쓰지 않는다.
 */
function installSeedDb(dbFile, seedDb, logger) {
  if (!seedDb || !fs.existsSync(seedDb)) return;
  if (fs.existsSync(dbFile)) {
    let count = 0;
    try {
      const { DatabaseSync } = require('node:sqlite');
      const d = new DatabaseSync(dbFile, { readOnly: true });
      try { count = d.prepare('SELECT COUNT(*) AS c FROM BibleVersions').get().c; } catch { count = 0; }
      d.close();
    } catch { return; } // 열 수 없는 DB는 건드리지 않는다
    if (count > 0) return;
    for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbFile + ext); } catch { /* 없음 */ } }
  }
  const tmp = dbFile + '.seed-tmp';
  fs.copyFileSync(seedDb, tmp);
  fs.renameSync(tmp, dbFile);
  logger.info('기본 성경 데이터 설치: ' + path.basename(seedDb));
}

function clampInt(v, min, max, def) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, v));
}

module.exports = { WorshipCueCore, OUTPUTS, formatTitle, getBook };
