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
const { SongInbox, onlineSearchUrl } = require('./songinbox');
const { HymnLyrics } = require('./hymnlyrics');
const { Library } = require('./library');
const { BOOKS, getBook } = require('./books');
const { formatTitle } = require('./db');

const OUTPUTS = ['main', 'overlay'];
const PRINTABLE_PLAIN = /^(?:[A-Z0-9]|Space|Enter|Backspace|Tab|Minus|Equal|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash|Backquote)$/;

/** 외부 단추 동작 목록 (스트림덱·Companion 안내용) */
const TRIGGERS = [
  ['next', '다음 슬라이드 (F6)'], ['prev', '이전 슬라이드 (F5)'], ['send', '미리보기 송출 (F9)'], ['hide', '글자 숨김·복원 (F10)'],
  ['cue-next', '다음 순서 송출'], ['cue-prev', '이전 순서 송출'],
  ['logo', '로고 화면 켜기·끄기'], ['bg', '배경 지우기·보이기'], ['overlays', '오버레이 끄기·다시 켜기'], ['clear-all', '모두 지우기'],
  ['timer', '설교 타이머 시작 (?min=30)'], ['timer-pause', '타이머 일시정지·계속'], ['timer-reset', '타이머 지우기'],
  ['message', '무대 메시지 (?text=…, 비우면 지움)'], ['draw-clear', '화면에 그린 것 지우기'],
].map(([id, name]) => ({ id, name }));

class WorshipCueCore extends EventEmitter {
  constructor({ dataDir, logEcho = false, seedDb = null, uiLang = 'ko' }) {
    super();
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.mediaDir = path.join(dataDir, 'media');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    this.logger = new Logger(path.join(dataDir, 'logs'), { echo: logEcho });
    this.settings = new Settings(dataDir, this.logger, { uiLang });
    const dbFile = path.join(dataDir, 'bible.db');
    installSeedDb(dbFile, seedDb, this.logger);
    this.store = new BibleStore(dbFile);
    this.presentation = new Presentation(this.logger);
    this.hymns = new Hymns(this);
    this.songInbox = new SongInbox(this);
    this.hymnLyrics = new HymnLyrics(this);
    this.library = new Library(this);
    this.stage = { timer: { running: false, endAt: 0, remaining: 0, duration: 0 }, message: '' };
    // 화면 지우기 층: 배경 숨김 · 로고 화면 · 오버레이 끄기 전 켜져 있던 것
    this.layers = { hideBg: false, logo: false, savedOverlays: [], media: null }; // media = 배경 미디어 (카메라·그림·영상, 슬라이드와 따로)
    this.pendingImports = new Map();
    this.outputClients = new Map(); // clientId → {client, kind, connectedAt, ack}
    this.desktop = null; // Electron 측에서 등록 (모니터·창 상태)
    this.obsHold = false; // 보조 화면을 꺼서 OBS 화면도 숨긴 상태 (다시 켜거나 송출하면 풀림)

    const s = this.settings.get();
    if (!s.versionId || !this.store.getVersion(s.versionId)) {
      const all = this.store.listVersions();
      const first = all.find(v => v.id === 'nkrv') || all.find(v => v.id === 'krv') || all[0];
      this.settings.update(d => { d.versionId = first ? first.id : ''; });
    }
    this.draw = { strokes: [], spot: null }; // 화면에 그리기·강조 (슬라이드가 바뀌면 지움)
    this.presentation.on('live', () => {
      this.syncVideo(); this.scheduleAuto();
      if (this.draw.strokes.length || this.draw.spot) { this.draw = { strokes: [], spot: null }; this.emit('draw', this.draw); }
      this.emit('live');
    });
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
    try { const n = this.store.purgeTrash(30); if (n) this.logger.info(`휴지통: 30일 지난 큐시트 ${n}개를 비웠습니다`); } catch { /* 무시 */ }
    this.logger.info('WorshipCue 시작');
  }

  versionId(args) {
    return (args && args.versionId) || this.settings.get().versionId;
  }

  /** 외부 단추 하나 실행 (열쇠 확인은 서버가 한다) */
  trigger(action, q = {}) {
    const C = (n, a) => { const r = this.command(n, a || {}); if (!r.ok) throw new Error(r.error); return r.result; };
    const L = this.presentation.live;
    switch (action) {
      case 'next': return C('nextSlide');
      case 'prev': return C('previousSlide');
      case 'send': return C('sendLive');
      case 'hide': return C('toggleLive');
      case 'logo': return C('toggleLogoScreen');
      case 'bg': return C('toggleBackground');
      case 'overlays': return C('toggleOverlaysOff');
      case 'clear-all': return C('clearAll');
      case 'cue-next': case 'cue-prev': {
        if (!L || !L.passage || !L.passage.cueId || L.passage.cueIndex < 0) throw new Error('송출 중인 큐시트 순서가 없습니다.');
        this.emit('cue-next', { dir: action === 'cue-next' ? 1 : -1, version: this.presentation.version, cueId: L.passage.cueId, index: L.passage.cueIndex });
        return {};
      }
      case 'timer': return C('stageTimer', { action: 'start', minutes: Number(q.min) || 30 });
      case 'timer-pause': return C('stageTimer', { action: this.stage.timer.running ? 'pause' : 'resume' });
      case 'timer-reset': return C('stageTimer', { action: 'reset' });
      case 'message': return C('stageMessage', { text: String(q.text || '').slice(0, 300) });
      case 'draw-clear': return C('drawClear');
      default: throw new Error('알 수 없는 동작: ' + action);
    }
  }

  // ---------------- 자동 넘김 (슬라이드쇼 · 순서의 '자동 넘김') ----------------
  /** 송출이 바뀔 때마다: 이 송출에 자동 넘김이 있으면 다음 넘김을 예약 (숨김 중이면 멈춤) */
  scheduleAuto() {
    clearTimeout(this.autoTimer);
    const P = this.presentation;
    const L = P.live;
    const a = L && L.passage && L.passage.auto;
    if (!a || !L.visible || L.slides.length < 1) return;
    const ver = P.version;
    this.autoTimer = setTimeout(() => {
      if (P.version !== ver || !P.live || !P.live.visible) return; // 그 사이 다른 송출·이동
      if (P.live.index < P.live.slides.length - 1) P.move(1);
      else if (a.loop) P.gotoSlide(0);
      else P.move(1); // 끝: 큐시트 순서면 다음 순서로 (자동 넘김 설정에 따라)
    }, a.sec * 1000);
    if (this.autoTimer.unref) this.autoTimer.unref();
  }

  // ---------------- 화면 지우기 층 ----------------
  layersPayload(output) {
    const s = this.settings.get();
    const tpl = this.templateFor(output || 'main');
    const logo = s.logoScreenImage || (tpl.logo && tpl.logo.image) || '/shared/assets/sa-shield.png';
    // 배경 미디어는 예배당 화면용 (OBS 자막은 투명이라 넣지 않음)
    const media = this.layers.media && (!output || output === 'main') ? this.layers.media : null;
    return { hideBg: this.layers.hideBg, logo: this.layers.logo, logoImage: logo, overlaysOff: this.layers.savedOverlays.length > 0, media };
  }

  // ---------------- AI 주보 → 큐시트 ----------------
  aiKey() {
    const a = this.settings.get().ai || {};
    if (a.keyEnc && this.desktop && this.desktop.decrypt) { try { return this.desktop.decrypt(a.keyEnc); } catch { return ''; } }
    return a.key || '';
  }
  /** input: { text } 또는 { file } → AI → 찬송가·장절 확인 → 큐시트 저장 */
  async aiBulletin({ input, extra = '', fetchImpl }) {
    const { askAI, planToCue, DEFAULT_MODEL } = require('./bulletin');
    if (input.text !== undefined && !String(input.text).trim()) throw new Error('주보 내용이 비었습니다.');
    const ai = this.settings.get().ai || {};
    const { plan, usage, model } = await askAI({ apiKey: this.aiKey(), model: ai.model || DEFAULT_MODEL, input, extra, endpoint: ai.endpoint || undefined, fetchImpl: fetchImpl || this.aiFetch || fetch });
    return { ...this.planToSavedCue(plan), usage, model };
  }

  /** AI 가 만든 순서 → 찬송가 PPT 연결·장절 확인 → 큐시트 저장 (API · 채팅 AI 공통) */
  planToSavedCue(plan) {
    const { planToCue } = require('./bulletin');
    const resolveHymn = (n, book) => {
      const hits = this.hymns.search(String(n)).filter(h => h.number === n);
      if (!hits.length) return null;
      const want = /구세군/.test(book) ? /구세군/ : /새찬송가|찬송가/;
      return hits.find(h => want.test(h.folder)) || hits.find(h => !/교독문/.test(h.folder)) || null;
    };
    const checkRef = ref => { const r = this.commands.searchReference.call(this, { query: ref }); return r && r.passage ? r.passage.title : null; };
    const { cue, warnings } = planToCue(plan, { resolveHymn, checkRef: ref => { try { return checkRef(ref); } catch { return null; } } });
    const saved = this.commands.saveCue.call(this, { cue });
    return { cue: saved, warnings };
  }

  // ---------------- 무대 화면 (설교자·찬양팀 모니터) ----------------
  /** 무대 화면에 보낼 데이터: 지금·다음 슬라이드, 순서 이름·메모, 타이머, 전달 메시지 */
  stagePayload() {
    const live = this.presentation.getLiveState();
    const t = this.stage.timer;
    const remaining = t.running ? t.endAt - Date.now() : t.remaining;
    return {
      output: 'stage', version: live.version, hasLive: live.hasLive, visible: live.visible,
      slide: live.slide, nextSlide: live.nextSlide, index: live.index, count: live.count,
      title: live.passage ? (live.passage.cueIndex >= 0 && live.passage.itemTitle ? live.passage.itemTitle : live.passage.title) : '',
      versionName: live.passage ? live.passage.versionName : '',
      note: live.passage ? live.passage.note || '' : '',
      timer: { running: t.running, remaining, duration: t.duration, now: Date.now() },
      message: this.stage.message,
    };
  }

  // ---------------- 영상 재생 (큐시트 '영상' 순서) ----------------
  /** 송출 중인 슬라이드가 영상이면 재생 상태를 둔다 (새 영상이면 처음부터 재생) */
  syncVideo() {
    const l = this.presentation.live;
    const slide = l ? l.slides[l.index] : null;
    if (!slide || slide.kind !== 'video') { this.video = null; return; }
    const key = `${l.sentAt}|${l.index}`;
    if (this.video && this.video.key === key) return;
    this.video = { key, playing: true, offset: 0, at: Date.now(), ended: false };
  }
  videoPayload() {
    const v = this.video;
    return v ? { key: v.key, playing: v.playing, offset: v.offset, at: v.at, now: Date.now() } : null;
  }
  videoPosition() {
    const v = this.video;
    return v ? v.offset + (v.playing ? (Date.now() - v.at) / 1000 : 0) : 0;
  }

  templateFor(output) {
    const s = this.settings.get();
    // 송출 중인 순서에 따로 정한 템플릿이 있으면 그것
    const live = this.presentation.live;
    const over = live && live.passage && live.passage.tpl ? live.passage.tpl[output] : '';
    const id = (over && s.templates.some(t => t.id === over)) ? over : s.activeTemplates[output];
    return s.templates.find(t => t.id === id) || s.templates[0];
  }

  /** 출력 화면(전체화면 창·OBS)에 보낼 데이터 */
  /** 보조 화면(예배당 모니터)을 끄면 OBS 화면도 같이 숨기고, 다시 켜면 다시 보인다 (설정: output.linkObs) */
  outputToggled(before, after) {
    if (before && !after && this.settings.get().output.linkObs !== false) this.holdObs(true);
    else if (!before && after) this.holdObs(false);
  }
  holdObs(on) {
    if (this.obsHold === !!on) return;
    this.obsHold = !!on;
    this.emit('live');
  }

  outputPayload(output) {
    const live = this.presentation.getLiveState();
    return {
      output,
      version: live.version,
      hasLive: live.hasLive,
      visible: live.visible && !this.obsHold,
      held: this.obsHold,
      slide: live.slide,
      versionName: live.passage ? live.passage.versionName : '',
      template: this.templateFor(output),
      overlays: this.library.activeFor(output),
      layers: this.layersPayload(output),
      video: this.videoPayload(),
      cursorHidden: this.settings.get().output.cursorHidden,
      cameras: this.settings.get().cameras || {},
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
      live: { ...this.presentation.getLiveState(), video: this.videoPayload() },
      stage: this.stagePayload(),
      layers: this.layersPayload('main'),
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
  // ---- 화면에 그리기 · 강조 (설교 중 밑줄·동그라미, 한 곳만 밝게) ----
  /** 선 하나 넣기·이어 그리기 (같은 id 면 바꿈). 좌표는 화면 비율 0~1 */
  drawStroke(a) {
    const s = a.stroke || {};
    const id = String(s.id || '').slice(0, 40);
    if (!id) throw new Error('선 id 가 없습니다.');
    const pts = (Array.isArray(s.pts) ? s.pts : []).slice(0, 4000).map(p => [Math.max(-0.1, Math.min(1.1, Number(p[0]) || 0)), Math.max(-0.1, Math.min(1.1, Number(p[1]) || 0))]);
    const st = { id, pts, color: /^#[0-9a-f]{3,8}$/i.test(s.color || '') ? s.color : '#ff3b30', width: Math.max(0.001, Math.min(0.08, Number(s.width) || 0.006)), alpha: Math.max(0.1, Math.min(1, Number(s.alpha) || 1)) };
    const list = this.draw.strokes;
    const k = list.findIndex(x => x.id === id);
    if (k >= 0) list[k] = st; else list.push(st);
    if (list.length > 300) list.splice(0, list.length - 300);
    this.emit('draw', this.draw);
    return { count: list.length };
  },
  drawUndo() { this.draw.strokes.pop(); this.emit('draw', this.draw); return { count: this.draw.strokes.length }; },
  drawClear() { this.draw = { strokes: [], spot: null }; this.emit('draw', this.draw); return {}; },
  /** 강조: 원 하나만 밝게 (나머지 어둡게) */
  drawSpot(a) {
    this.draw.spot = a && a.on ? { x: Math.max(0, Math.min(1, Number(a.x) || 0.5)), y: Math.max(0, Math.min(1, Number(a.y) || 0.5)), r: Math.max(0.03, Math.min(0.6, Number(a.r) || 0.18)) } : null;
    this.emit('draw', this.draw);
    return { spot: this.draw.spot };
  },
  /** 병행 번역본: 같은 범위의 다른 번역 본문 */
  parallelVerses(a) {
    const v = this.store.getVersion(String(a.versionId || ''));
    if (!v) throw new Error('병행 번역본이 없습니다.');
    const n = x => Number(x) || 0;
    return { versionId: v.id, versionName: v.name, verses: this.store.getVerses(v.id, n(a.bookId), n(a.sc), n(a.sv), n(a.ec), n(a.ev)).map(x => ({ chapter: x.chapter, verse: x.verse, text: x.text })) };
  },
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
    this.holdObs(false); // 새로 송출하면 OBS 도 다시 보인다
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
  // ---- 스트림덱 · Companion · 외부 단추 (GET /api/trigger/<동작>?key=…) ----
  triggerInfo() {
    if (!this.settings.get().triggerKey) this.commands.newTriggerKey.call(this);
    return { key: this.settings.get().triggerKey, actions: TRIGGERS };
  },
  newTriggerKey() {
    const key = require('crypto').randomBytes(9).toString('base64url');
    this.settings.update(d => { d.triggerKey = key; });
    return { key, actions: TRIGGERS };
  },
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
  /** 내부망 출력: 상태 · 주소 */
  lanOutputInfo() { return this.lanOutput ? this.lanOutput.status() : { running: false, urls: [] }; },
  /** 내부망 출력 열쇠 새로 (예전 주소는 더 이상 안 열림) */
  newLanKey() {
    this.settings.update(d => { d.lanOutput = { enabled: false, port: 37550, ...(d.lanOutput || {}), key: require('crypto').randomBytes(9).toString('base64url') }; });
    this.settingsChanged('settings');
    return this.lanOutputInfo();
  },
  /** 카메라 세부 설정 (해상도·프레임·밝기 등). prefs = null 이면 기본값으로 */
  setCameraPrefs(a) {
    const id = String(a.deviceId || '').slice(0, 300);
    const p = a.prefs;
    const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
    this.settings.update(d => {
      d.cameras = d.cameras && typeof d.cameras === 'object' ? d.cameras : {};
      if (!p) { delete d.cameras[id]; return; }
      d.cameras[id] = {
        label: String(p.label || '').slice(0, 200),
        res: ['auto', '720', '1080', '1440', '2160'].includes(p.res) ? p.res : 'auto',
        fps: [0, 24, 25, 30, 50, 60].includes(Number(p.fps)) ? Number(p.fps) : 0,
        exact: !!p.exact,
        mirror: !!p.mirror,
        brightness: num(p.brightness, 50, 200, 100),
        contrast: num(p.contrast, 50, 200, 100),
        saturation: num(p.saturation, 0, 200, 100),
      };
      const keys = Object.keys(d.cameras);
      if (keys.length > 30) delete d.cameras[keys[0]];
    });
    this.emit('settings', 'cameras');
    this.emit('live');
    return this.settings.get().cameras;
  },
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
      if (typeof p.cueTimes === 'boolean') d.cueTimes = p.cueTimes;
      if (p.uiLang === 'ko' || p.uiLang === 'en') d.uiLang = p.uiLang;
      if (typeof p.hymnBackground === 'string') d.hymnBackground = p.hymnBackground.slice(0, 300);
      if (typeof p.songSearchUrl === 'string') d.songSearchUrl = p.songSearchUrl.trim().slice(0, 500);
      if (typeof p.songDownloadDir === 'string') d.songDownloadDir = p.songDownloadDir.trim().slice(0, 500);
      if (typeof p.songInboxDir === 'string') d.songInboxDir = p.songInboxDir.trim().slice(0, 500);
      if (typeof p.bethlehemDir === 'string') d.bethlehemDir = p.bethlehemDir.trim().slice(0, 500);
      if (typeof p.previewMode === 'boolean') d.previewMode = p.previewMode;
      if (typeof p.logoScreenImage === 'string') d.logoScreenImage = p.logoScreenImage.slice(0, 1500);
      if (typeof p.dockLocked === 'boolean') d.dockLocked = p.dockLocked;
      if (typeof p.parallelVersionId === 'string' && (!p.parallelVersionId || this.store.getVersion(p.parallelVersionId))) d.parallelVersionId = p.parallelVersionId;
      if (p.ui && typeof p.ui === 'object') {
        d.ui = { theme: 'dark', scale: 100, ...(d.ui || {}) };
        if (['dark', 'contrast', 'light', 'warm', 'navy'].includes(p.ui.theme)) d.ui.theme = p.ui.theme;
        if ([90, 100, 110, 120].includes(Number(p.ui.scale))) d.ui.scale = Number(p.ui.scale);
      }
      if (typeof p.dockLayout === 'string' && p.dockLayout.length <= 300000) d.dockLayout = p.dockLayout;
      if (typeof p.reservedKeys === 'string') d.reservedKeys = p.reservedKeys.slice(0, 1000);
      if (p.output && typeof p.output.cursorHidden === 'boolean') d.output.cursorHidden = p.output.cursorHidden;
      if (p.output && typeof p.output.autoOnSend === 'boolean') d.output.autoOnSend = p.output.autoOnSend;
      if (p.output && typeof p.output.linkObs === 'boolean') d.output.linkObs = p.output.linkObs;
      if (p.lanOutput) {
        d.lanOutput = { enabled: false, port: 37550, key: '', ...(d.lanOutput || {}) };
        if (typeof p.lanOutput.enabled === 'boolean') d.lanOutput.enabled = p.lanOutput.enabled;
        if (p.lanOutput.port != null) d.lanOutput.port = clampInt(p.lanOutput.port, 1024, 65535, 37550);
        if (d.lanOutput.enabled && !d.lanOutput.key) d.lanOutput.key = require('crypto').randomBytes(9).toString('base64url');
      }
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
  setHymnFolderRender(a) { this.hymns.setFolderRender(String(a.path), a.render); this.settingsChanged('settings'); return {}; },
  // ---- 온라인 찬양 PPT: 브라우저로 검색 페이지를 열고, 다운로드 폴더를 지켜본다 ----
  songOnlineSearch(a) {
    const url = onlineSearchUrl(this.settings.get().songSearchUrl, a.query);
    if (!this.desktop || !this.desktop.openUrl) throw new Error('브라우저 열기는 데스크톱 프로그램에서만 됩니다.');
    this.desktop.openUrl(url);
    return { url, ...this.songInbox.arm() };
  },
  songInboxStatus() { return this.songInbox.status(); },
  hymnLyricsStatus() { return this.hymnLyrics.status(); },
  /**
   * 바깥(탐색기)에서 끌어다 놓은 파일·폴더: 종류를 알려 주고, 등록 폴더 밖이어도 열 수 있게 기억한다
   * → [{ path, name, kind: ppt|image|video|audio|text|folder, url?, text?, number?, title? }]
   */
  addDroppedFiles(a) {
    const path = require('path');
    const fs = require('fs');
    const { IMAGE, AUDIO, VIDEO } = require('./library');
    const { parseName } = require('./hymns');
    const out = [];
    const keep = [];
    for (const raw of (Array.isArray(a.paths) ? a.paths : []).slice(0, 100)) {
      const p = path.resolve(String(raw || ''));
      if (!raw || !path.isAbsolute(String(raw))) continue;
      let st;
      try { st = fs.statSync(p); } catch { out.push({ path: p, name: path.basename(p), kind: 'missing' }); continue; }
      const name = path.basename(p);
      const base = name.replace(/\.[^.]+$/, '');
      if (st.isDirectory()) { out.push({ path: p, name, kind: 'folder' }); continue; }
      if (/\.(pps|ppt|ppsx|pptx)$/i.test(p)) { const n = parseName(name); out.push({ path: p, name, kind: 'ppt', number: n.number, title: n.title || base }); keep.push(p); }
      else if (IMAGE.test(p)) { out.push({ path: p, name, kind: 'image', title: base, url: this.library.fileUrl(p) }); keep.push(p); }
      else if (VIDEO.test(p)) { out.push({ path: p, name, kind: 'video', title: base, url: this.library.fileUrl(p) }); keep.push(p); }
      else if (AUDIO.test(p)) { out.push({ path: p, name, kind: 'audio', title: base, url: this.library.fileUrl(p) }); keep.push(p); }
      else if (/\.txt$/i.test(p) && st.size <= 200000) {
        let text = fs.readFileSync(p);
        // UTF-8 이 아니면 (예: 메모장 ANSI) 한글 코드(cp949)로
        let s = text.toString('utf8');
        if (s.includes('\ufffd')) { try { s = new TextDecoder('euc-kr').decode(text); } catch { /* 그대로 */ } }
        out.push({ path: p, name, kind: 'text', title: base, text: s.replace(/^\ufeff/, '') });
      } else out.push({ path: p, name, kind: 'other' });
    }
    if (keep.length) {
      this.settings.update(d => {
        const list = (d.droppedFiles || []).filter(x => !keep.includes(x));
        d.droppedFiles = [...list, ...keep].slice(-500);
      });
    }
    return out;
  },
  /** 조작 화면 준비 끝 (로딩 화면을 닫는 신호) */
  uiReady() { this.emit('ui-ready'); return {}; },
  logClientError(a) { this.logger.error('조작 화면: ' + String(a.message || '').slice(0, 2000)); return {}; },
  // ---- AI 주보 → 큐시트 ----
  /** 안내 페이지를 기본 브라우저로 (https 만) */
  openLink(a) {
    const url = String(a.url || '');
    if (!/^https:\/\/(openrouter\.ai|github\.com|bethlehembible\.org)\//.test(url)) throw new Error('열 수 없는 주소입니다.');
    if (!this.desktop || !this.desktop.openUrl) throw new Error('브라우저 열기는 데스크톱 프로그램에서만 됩니다.');
    this.desktop.openUrl(url);
    return {};
  },
  aiSettings() {
    const { RECOMMENDED, DEFAULT_MODEL } = require('./bulletin');
    const a = this.settings.get().ai || {};
    return { hasKey: !!(a.keyEnc || a.key), model: a.model || DEFAULT_MODEL, models: RECOMMENDED, encrypted: !!a.keyEnc };
  },
  setAi(a) {
    this.settings.update(d => {
      d.ai = { model: '', keyEnc: '', key: '', ...(d.ai || {}) };
      if (typeof a.model === 'string') d.ai.model = a.model.trim().slice(0, 120);
      if (typeof a.endpoint === 'string') d.ai.endpoint = /^https?:\/\//.test(a.endpoint.trim()) ? a.endpoint.trim().slice(0, 300) : '';
      if (typeof a.apiKey === 'string') {
        const k = a.apiKey.trim();
        const dk = this.desktop;
        if (!k) { d.ai.keyEnc = ''; d.ai.key = ''; }
        else if (dk && dk.canEncrypt && dk.canEncrypt()) { d.ai.keyEnc = dk.encrypt(k); d.ai.key = ''; }
        else { d.ai.key = k; d.ai.keyEnc = ''; }
      }
    });
    return this.commands.aiSettings.call(this);
  },
  /** 붙여 넣은 주보 글로 큐시트 만들기 */
  aiMakeCue(a) { return this.aiBulletin({ input: { text: String(a.text || '') }, extra: a.extra }); },
  /** 채팅 AI (키 없이): 붙여 넣을 프롬프트와 샘플 파일 */
  chatAiPrompt(a) {
    const { chatPrompt, SAMPLE, SAMPLE_NAME } = require('./bulletin');
    return { prompt: chatPrompt(String((a && a.extra) || '').slice(0, 500)), sample: JSON.stringify(SAMPLE, null, 2), sampleName: SAMPLE_NAME };
  },
  /** 채팅 AI 가 쓴 답(글·파일 내용) → 큐시트 */
  chatAiImport(a) {
    const { parseChatAnswer } = require('./bulletin');
    const { plan, isSample } = parseChatAnswer(String((a && a.text) || '').slice(0, 300000));
    if (isSample) throw new Error('샘플 파일 내용 그대로입니다. 채팅 AI 가 주보로 새로 만든 답을 붙여 넣으세요.');
    return { ...this.planToSavedCue(plan), model: '채팅 AI' };
  },
  // ---- 휴대폰 리모컨 ----
  remoteStatus() { return this.remote ? this.remote.status() : { enabled: false, running: false, urls: [], error: '리모컨을 쓸 수 없습니다.' }; },
  async setRemote(a) {
    const { newPin } = require('./remote');
    this.settings.update(d => {
      d.remote = { enabled: false, pin: '', port: 37540, ...(d.remote || {}) };
      if (typeof a.enabled === 'boolean') d.remote.enabled = a.enabled;
      if (a.newPin || !d.remote.pin) d.remote.pin = newPin();
    });
    if (this.remote) await this.remote.sync();
    this.settingsChanged('settings');
    return this.remote ? this.remote.status() : { enabled: false, running: false, urls: [] };
  },
  // ---- 화면 지우기 ----
  /** 배경 미디어 송출 (FreeShow 방식: 라이브러리에서 고르면 바로 배경 층에) — null 이면 끄기 */
  setBackgroundMedia(a) {
    const m = a && a.media;
    if (!m) this.layers.media = null;
    else {
      const type = ['camera', 'image', 'video'].includes(m.type) ? m.type : null;
      if (!type) throw new Error('알 수 없는 배경 종류입니다.');
      this.layers.media = { type, deviceId: String(m.deviceId || '').slice(0, 200), url: String(m.url || '').slice(0, 1500), label: String(m.label || '').slice(0, 100), fit: m.fit === 'contain' ? 'contain' : 'cover' };
      this.layers.hideBg = false; // 배경을 숨겨 두었으면 다시 보이게
    }
    this.emit('live');
    return this.layersPayload();
  },
  toggleBackground(a) { this.layers.hideBg = a && typeof a.on === 'boolean' ? a.on : !this.layers.hideBg; this.emit('live'); return this.layersPayload(); },
  toggleLogoScreen(a) { this.layers.logo = a && typeof a.on === 'boolean' ? a.on : !this.layers.logo; this.emit('live'); return this.layersPayload(); },
  /** 오버레이 모두 끄기 ↔ 다시 켜기 (끄기 전에 켜져 있던 것만) */
  toggleOverlaysOff() {
    const on = this.library.overlays().filter(o => o.on).map(o => o.id);
    if (on.length) { this.layers.savedOverlays = on; on.forEach(id => this.library.toggleOverlay(id, false)); }
    else { this.layers.savedOverlays.forEach(id => { try { this.library.toggleOverlay(id, true); } catch { /* 지워진 것 */ } }); this.layers.savedOverlays = []; }
    this.settingsChanged('overlays');
    this.emit('live');
    return this.layersPayload();
  },
  /** 모두 지우기: 글자 숨김 + 배경 숨김 + 오버레이 끄기 + 로고 화면 끔 (음악은 조작 화면에서 멈춤) */
  clearAll() {
    if (this.presentation.live && this.presentation.live.visible) this.presentation.clear();
    this.layers.hideBg = true;
    this.layers.logo = false;
    const on = this.library.overlays().filter(o => o.on).map(o => o.id);
    if (on.length) { this.layers.savedOverlays = on; on.forEach(id => this.library.toggleOverlay(id, false)); this.settingsChanged('overlays'); }
    if (this.video && this.video.playing) Object.assign(this.video, { playing: false, offset: this.videoPosition(), at: Date.now() });
    this.emit('live');
    return this.layersPayload();
  },
  /** 무대 타이머: start(minutes) | pause | resume | reset | add(minutes) */
  stageTimer(a) {
    const t = this.stage.timer;
    const now = Date.now();
    const cur = t.running ? t.endAt - now : t.remaining;
    const act = String(a.action || '');
    if (act === 'start') { const ms = Math.round((Number(a.minutes) || 0) * 60000); if (ms <= 0) throw new Error('시간(분)을 입력하세요.'); Object.assign(t, { running: true, endAt: now + ms, remaining: ms, duration: ms }); }
    else if (act === 'pause') Object.assign(t, { running: false, remaining: cur });
    else if (act === 'resume') Object.assign(t, { running: true, endAt: now + cur });
    else if (act === 'reset') Object.assign(t, { running: false, endAt: 0, remaining: 0, duration: 0 });
    else if (act === 'add') { const ms = Math.round((Number(a.minutes) || 0) * 60000); if (t.running) t.endAt += ms; else t.remaining = cur + ms; t.duration += ms; }
    else throw new Error('알 수 없는 타이머 조작입니다.');
    this.emit('live');
    return this.stagePayload().timer;
  },
  /** 무대 화면에 전달 메시지 (빈 글이면 지움) */
  stageMessage(a) {
    this.stage.message = String(a.text || '').slice(0, 300);
    this.emit('live');
    return { message: this.stage.message };
  },
  /** 영상 재생 조작: play | pause | toggle | restart | seek(time) */
  videoControl(a) {
    const v = this.video;
    if (!v) throw new Error('송출 중인 영상이 없습니다.');
    const pos = this.videoPosition();
    const act = String(a.action || '');
    if (act === 'play' || (act === 'toggle' && !v.playing)) Object.assign(v, { playing: true, offset: pos, at: Date.now(), ended: false });
    else if (act === 'pause' || act === 'toggle') Object.assign(v, { playing: false, offset: pos, at: Date.now() });
    else if (act === 'restart') Object.assign(v, { playing: true, offset: 0, at: Date.now(), ended: false });
    else if (act === 'seek') Object.assign(v, { offset: Math.max(0, Number(a.time) || 0), at: Date.now(), ended: false });
    else throw new Error('알 수 없는 영상 조작입니다.');
    this.emit('live');
    return this.videoPayload();
  },
  /** 출력 화면이 '영상이 끝났다'고 알림 → 순서에 정한 대로 (한 번만) */
  videoEnded(a) {
    const v = this.video;
    if (!v || v.key !== a.key || v.ended) return { done: false };
    v.ended = true;
    v.playing = false;
    v.offset = Number(a.duration) || this.videoPosition();
    v.at = Date.now();
    const l = this.presentation.live;
    const slide = l && l.slides[l.index];
    const end = slide && slide.video ? slide.video.endAction : 'hold';
    if (end === 'black') this.presentation.clear();
    else if (end === 'next' && l.passage && l.passage.cueId && l.passage.cueIndex >= 0) {
      this.emit('cue-next', { dir: 1, version: this.presentation.version, cueId: l.passage.cueId, index: l.passage.cueIndex });
    }
    this.emit('live');
    return { done: true, end };
  },
  // ---- 라이브러리: 찬양 ----
  listSongs(a) { return this.library.listSongs(a.query); },
  /** 찬양 가져오기: 파일·폴더 → 미리 보기 목록 (저장은 saveImportedSongs) */
  importSongs(a) {
    const path = require('path');
    const fs = require('fs');
    const { parseSongFile, SONG_EXT } = require('./songimport');
    const files = [];
    for (const raw of (Array.isArray(a.paths) ? a.paths : []).slice(0, 200)) {
      const p = path.resolve(String(raw || ''));
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) { for (const f of fs.readdirSync(p)) if (SONG_EXT.test(f) && files.length < 1000) files.push(path.join(p, f)); }
      else files.push(p);
    }
    const have = new Set(this.library.listSongs('').map(s => s.title.replace(/\s+/g, '').toLowerCase()));
    const songs = [], errors = [];
    for (const f of files) {
      try {
        for (const s of parseSongFile(f)) {
          if (!String(s.lyrics || '').trim()) { errors.push({ file: path.basename(f), error: '가사가 없습니다.' }); continue; }
          songs.push({ ...s, source: path.basename(f), dup: have.has(String(s.title).replace(/\s+/g, '').toLowerCase()) });
        }
      } catch (e) { errors.push({ file: path.basename(f), error: e.message }); }
    }
    return { songs, errors };
  },
  /** 가져온 찬양 저장 (같은 제목: skip = 건너뛰기 · new = 새로 하나 더 · replace = 덮어쓰기) */
  saveImportedSongs(a) {
    const list = (Array.isArray(a.songs) ? a.songs : []).slice(0, 1000);
    const mode = ['skip', 'new', 'replace'].includes(a.dup) ? a.dup : 'skip';
    const byTitle = new Map(this.library.listSongs('').map(s => [s.title.replace(/\s+/g, '').toLowerCase(), s.id]));
    let saved = 0, skipped = 0;
    for (const s of list) {
      const key = String(s.title || '').replace(/\s+/g, '').toLowerCase();
      const old = byTitle.get(key);
      if (old && mode === 'skip') { skipped++; continue; }
      const r = this.library.saveSong({ ...(old && mode === 'replace' ? { id: old } : {}), title: s.title, lyrics: s.lyrics, credit: s.credit || '', arrangement: s.arrangement || '' });
      byTitle.set(key, r.id);
      saved++;
    }
    this.emit('songs', {});
    return { saved, skipped };
  },
  getSong(a) { const s = this.library.getSong(a.id); if (!s) throw new Error('찬양을 찾을 수 없습니다.'); return s; },
  saveSong(a) { const s = this.library.saveSong(a.song || {}); this.emit('songs', { id: s.id }); return s; },
  deleteSong(a) { this.library.deleteSong(a.id); this.emit('songs', { id: a.id }); return {}; },
  // ---- 라이브러리: 이미지·음악 폴더 ----
  listLibFolders(a) { return this.library.folders(a.kind); },
  addLibFolder(a) { const r = this.library.addFolder(a.kind, a.path, a.name); this.settingsChanged('settings'); return r; },
  removeLibFolder(a) { this.library.removeFolder(a.kind, String(a.path)); this.settingsChanged('settings'); return {}; },
  searchLibFiles(a) { return this.library.searchFiles(a.kind, a.query, a.folder || ''); },
  // ---- 오버레이 ----
  listOverlays() { return this.library.overlays(); },
  saveOverlay(a) { const o = this.library.saveOverlay(a.overlay || {}); this.settingsChanged('overlays'); this.emit('live'); return o; },
  deleteOverlay(a) { this.library.deleteOverlay(String(a.id)); this.settingsChanged('overlays'); this.emit('live'); return {}; },
  toggleOverlay(a) { const o = this.library.toggleOverlay(String(a.id), a.on); this.settingsChanged('overlays'); this.emit('live'); return o; },
  /** 작업공간 목록 저장 (이름·배치) / 지금 작업공간 */
  saveWorkspaces(a) {
    const list = (Array.isArray(a.list) ? a.list : []).slice(0, 30).map(w => ({
      id: /^[a-z0-9-]{3,40}$/i.test(w.id || '') ? w.id : 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: String(w.name || '').trim().slice(0, 40) || '작업공간',
      layout: String(w.layout || '').slice(0, 300000),
    })).filter(w => w.layout);
    this.settings.update(d => { d.workspaces = list; if (typeof a.active === 'string') d.activeWorkspace = a.active.slice(0, 60); });
    return { workspaces: list, active: this.settings.get().activeWorkspace };
  },
  setActiveWorkspace(a) { this.settings.update(d => { d.activeWorkspace = String(a.id || '').slice(0, 60); }); return {}; },
  /** 조작 화면 독 배치 저장 (다른 화면에 알릴 필요 없음) */
  saveDockLayout(a) {
    const s = String(a.layout || '');
    if (s.length > 300000) throw new Error('배치 정보가 너무 큽니다.');
    this.settings.update(d => { d.dockLayout = s; });
    return {};
  },
  songInboxStop() { return this.songInbox.disarm(); },
  /** 폴더 고르기 창 (데스크톱에서만) */
  pickFolder(a) {
    if (!this.desktop || !this.desktop.pickFolder) throw new Error('폴더 고르기 창은 데스크톱 프로그램에서만 열 수 있습니다. 경로를 직접 입력하세요.');
    return this.desktop.pickFolder(a.title || '폴더 고르기');
  },
  // ---- 큐시트 (예배 순서) ----
  listCues(a) { return this.store.listCues(!!(a && a.trash)); },
  /** 큐시트 관리: 이름·날짜·메모·고정·서식 */
  updateCueMeta(a) {
    const c = this.store.getCue(String(a.id));
    if (!c) throw new Error('큐시트를 찾을 수 없습니다.');
    const m = {};
    if (typeof a.name === 'string' && a.name.trim()) m.name = a.name.trim().slice(0, 200);
    if (typeof a.serviceDate === 'string' && (!a.serviceDate || /^\d{4}-\d{2}-\d{2}$/.test(a.serviceDate))) m.serviceDate = a.serviceDate;
    if (typeof a.memo === 'string') m.memo = a.memo.slice(0, 1000);
    if (typeof a.pinned === 'boolean') m.pinned = a.pinned;
    if (typeof a.template === 'boolean') m.template = a.template;
    this.store.updateCueMeta(c.id, m);
    this.emit('cues', { id: c.id });
    return this.store.getCue(c.id);
  },
  /** 휴지통으로 (여러 개) — 30일 뒤 저절로 비움 */
  trashCues(a) {
    const ids = (Array.isArray(a.ids) ? a.ids : [a.id]).map(String).filter(Boolean);
    const at = new Date().toISOString();
    ids.forEach(id => this.store.updateCueMeta(id, { deletedAt: at, pinned: false }));
    if (ids.includes(this.settings.get().activeCueId)) this.settings.update(d => { d.activeCueId = ''; });
    this.emit('cues', { id: '' });
    return { count: ids.length };
  },
  restoreCues(a) {
    const ids = (Array.isArray(a.ids) ? a.ids : [a.id]).map(String).filter(Boolean);
    ids.forEach(id => this.store.updateCueMeta(id, { deletedAt: '' }));
    this.emit('cues', { id: ids[0] || '' });
    return { count: ids.length };
  },
  /** 휴지통에서 아주 지우기 */
  purgeCues(a) {
    const ids = (Array.isArray(a.ids) ? a.ids : [a.id]).map(String).filter(Boolean);
    for (const id of ids) { const c = this.store.getCue(id); if (c && c.deletedAt) this.store.deleteCue(id); }
    this.emit('cues', { id: '' });
    return { count: ids.length };
  },
  /** 여러 큐시트를 파일 하나로 */
  exportCues(a) {
    const ids = (Array.isArray(a.ids) ? a.ids : []).map(String);
    const cues = ids.map(id => this.store.getCue(id)).filter(Boolean).map(c => ({ name: c.name, serviceDate: c.serviceDate, startTime: c.startTime, memo: c.memo, items: c.items }));
    return { worshipcue: 2, exportedAt: new Date().toISOString(), cues };
  },
  /** 파일에서 가져오기: 큐시트 하나({ name, items }) 또는 여러 개({ cues: [...] }) */
  importCues(a) {
    const d = a.data || {};
    const list = Array.isArray(d.cues) ? d.cues : Array.isArray(d.items) ? [d] : [];
    if (!list.length) throw new Error('WorshipCue 큐시트 파일이 아닙니다.');
    const ids = [];
    for (const c of list.slice(0, 500)) {
      const cue = normalizeCue({ name: c.name || '가져온 큐시트', serviceDate: c.serviceDate || '', startTime: c.startTime || '', memo: c.memo || '', items: (c.items || []).map(x => ({ ...x, id: '' })) });
      ids.push(this.store.saveCue(cue).id);
    }
    this.emit('cues', { id: ids[0] });
    return { ids, count: ids.length };
  },
  /** 순서지 (글): 큐시트를 읽기 좋은 글로 — 단톡방·문서에 붙이기 */
  cueText(a) {
    const c = this.store.getCue(String(a.id));
    if (!c) throw new Error('큐시트를 찾을 수 없습니다.');
    const lines = [`■ ${c.name}${c.serviceDate ? ` (${c.serviceDate}${c.startTime ? ' ' + c.startTime : ''})` : ''}`];
    c.items.forEach((it, i) => {
      const sub = it.type === 'bible' ? it.ref : it.type === 'hymn' ? '' : it.subtitle || '';
      lines.push(`${i + 1}. ${it.title}${sub ? ' — ' + sub : ''}${it.note ? `  (${it.note})` : ''}`);
    });
    if (c.memo) lines.push('', '※ ' + c.memo);
    return { text: lines.join('\n'), name: c.name };
  },
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
    const en = this.settings.get().uiLang === 'en';
    const c = normalizeCue({ name: a.name || `${today} ${en ? 'Service' : '예배'}`, serviceDate: a.serviceDate || today, items: a.empty ? [] : sampleItems(en ? 'en' : 'ko') });
    return this.commands.saveCue.call(this, { cue: c });
  },
  /** 복제: nextWeek 면 예배 날짜를 7일 뒤로 (이름 속 날짜도) — 서식에서 만들 때도 이것 */
  duplicateCue(a) {
    const src = this.store.getCue(String(a.id));
    if (!src) throw new Error('큐시트를 찾을 수 없습니다.');
    let date = typeof a.serviceDate === 'string' ? a.serviceDate : src.serviceDate;
    let name = a.name || '';
    if (a.nextWeek) {
      const base = /^\d{4}-\d{2}-\d{2}$/.test(src.serviceDate) ? new Date(src.serviceDate + 'T00:00:00') : new Date();
      base.setDate(base.getDate() + 7);
      date = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
      if (!name) name = src.serviceDate && src.name.includes(src.serviceDate) ? src.name.replace(src.serviceDate, date) : `${src.name} (${date})`;
    }
    const c = normalizeCue({ name: name || src.name + ' 복사본', serviceDate: date, startTime: src.startTime, memo: a.keepMemo ? src.memo : '', items: src.items.map(it => ({ ...it, id: newId() })) });
    return this.commands.saveCue.call(this, { cue: c });
  },
  /** 지우기 = 휴지통으로 (되살릴 수 있음) */
  deleteCue(a) {
    this.store.updateCueMeta(String(a.id), { deletedAt: new Date().toISOString(), pinned: false });
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
