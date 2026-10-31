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
const { HymnLyrics, countHymns, FILE: HYMN_FILE } = require('./hymnlyrics');
const { Hymnal } = require('./hymnal');

/** 모두 지우기로 숨긴 배경은 다시 송출하면 돌아온다 (배경 끄기로 직접 끈 것은 그대로) */
/** 설교 포인트: 화면에서 넣은 설교 제목·본문·설교자 */
function pointsMeta(a) {
  const m = (a && a.meta) || {};
  const s = (v, n) => String(v || '').trim().slice(0, n);
  return { title: s(m.title, 120), verse: s(m.verse, 80), speaker: s(m.speaker, 60) };
}
function unclearBg(core) { if (core.layers.bgByClear) { core.layers.hideBg = false; core.layers.bgByClear = false; } }
const { Library } = require('./library');
const { UsageLog } = require('./usagelog');
const { Sync } = require('./sync');
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
  ['macro', '매크로 실행 (?name=매크로 이름)'],
].map(([id, name]) => ({ id, name }));

class WorshipCueCore extends EventEmitter {
  constructor({ dataDir, logEcho = false, seedDb = null, uiLang = 'ko' }) {
    super();
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.mediaDir = path.join(dataDir, 'media');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    this.logger = new Logger(path.join(dataDir, 'logs'), { echo: logEcho });
    Sync.applyPendingRestore(dataDir, this.logger); // 예약된 '백업에서 되돌리기' (DB·설정을 열기 전에)
    this.settings = new Settings(dataDir, this.logger, { uiLang });
    const dbFile = path.join(dataDir, 'bible.db');
    installSeedDb(dbFile, seedDb, this.logger);
    this.store = new BibleStore(dbFile);
    this.presentation = new Presentation(this.logger);
    this.hymns = new Hymns(this);
    this.songInbox = new SongInbox(this);
    this.hymnLyrics = new HymnLyrics(this);
    this.hymnal = new Hymnal(this); // 베들레헴 찬송가 (가사 · 악보 · 교독문)
    this.library = new Library(this);
    this.usage = new UsageLog(this); // 사용 기록 (저작권 보고)
    this.sync = new Sync(this); // 여러 PC 동기화 · 자동 백업
    this.message = null; // 회중 메시지 (아래 띠)
    this.stage = { timer: { running: false, endAt: 0, remaining: 0, duration: 0 }, message: '', pin: null }; // pin: 무대 화면 고정 { mode: 'order' | 'text', text, name }
    // 화면 지우기 층: 배경 숨김 · 로고 화면 · 오버레이 끄기 전 켜져 있던 것
    this.layers = { hideBg: false, logo: false, savedOverlays: [], media: null }; // media = 배경 미디어 (카메라·그림·영상, 슬라이드와 따로)
    this.pendingImports = new Map();
    this.outputClients = new Map(); // clientId → {client, kind, connectedAt, ack}
    this.desktop = null; // Electron 측에서 등록 (모니터·창 상태)
    this.obsHold = false;
    this.obsFull = false; // OBS 자막 출력에 '슬라이드 그대로' (예배당 화면 템플릿) — 그때그때 켜고 끔 // 보조 화면을 꺼서 OBS 화면도 숨긴 상태 (다시 켜거나 송출하면 풀림)

    const s = this.settings.get();
    if (!s.versionId || !this.store.getVersion(s.versionId)) {
      const all = this.store.listVersions();
      const first = all.find(v => v.id === 'nkrv') || all.find(v => v.id === 'krv') || all[0];
      this.settings.update(d => { d.versionId = first ? first.id : ''; });
    }
    this.draw = { strokes: [], spot: null }; // 화면에 그리기·강조 (슬라이드가 바뀌면 지움)
    this.presentation.on('live', () => {
      this.syncVideo(); this.scheduleAuto(); this.scheduleHide();
      if (this.draw.strokes.length || this.draw.spot) { this.draw = { strokes: [], spot: null }; this.emit('draw', this.draw); }
      this.emit('live');
    });
    this.presentation.on('preview', () => this.emit('preview'));
    this.presentation.on('edge', ({ edge, live }) => {
      // 처음·끝에서 한 번 더: 글자만 숨기고 멈춘다 (숨긴 채로 한 번 더 누르면 아래처럼 다음·이전 순서로)
      if (live && live.visible && live.passage && live.passage.cueId && (live.passage.edgeHide || this.settings.get().cueEdgeHide === true)) {
        this.presentation.clear();
        return;
      }
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
    this.logger.info('워십프리젠터 시작');
    // 예약 실행: 요일·시각이 되면 매크로 (30초마다 확인, 같은 날 한 번)
    this.scheduleDone = new Set();
    this.scheduleTimer = setInterval(() => { try { this.checkSchedule(); } catch (e) { this.logger.warn('예약 실행: ' + e.message); } }, 30000);
    if (this.scheduleTimer.unref) this.scheduleTimer.unref();
    // OBS 원격 조작: 켜 두었으면 연결 (desktop·암호 풀기가 붙은 뒤에)
    const { ObsLink } = require('./obs');
    this.obs = new ObsLink(this);
    const t = setTimeout(() => { try { this.obs.sync(); } catch (e) { this.logger.warn('OBS: ' + e.message); } }, 0);
    if (t.unref) t.unref();
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
      case 'macro': return C('runMacro', { name: q.name, id: q.id });
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

  /** 글자 자동 숨김: 이 순서에 'N초 뒤 숨김' 이 있으면 슬라이드가 보인 뒤 N초에 글자만 숨긴다 */
  scheduleHide() {
    clearTimeout(this.hideTimer);
    const P = this.presentation;
    const L = P.live;
    const sec = L && L.visible && L.passage && L.passage.hideAfter;
    if (!sec) return;
    const ver = P.version;
    this.hideTimer = setTimeout(() => {
      if (P.version !== ver || !P.live || !P.live.visible) return; // 그 사이 다른 송출·이동
      P.clear();
      this.autoHidAt = P.version; // 자동으로 숨긴 상태 — 다음 F6 은 다음 슬라이드를 보이며
    }, sec * 1000);
    if (this.hideTimer.unref) this.hideTimer.unref();
  }

  /** F5·F6: 자동 숨김 뒤라면 넘기면서 다시 보인다 */
  slideStep(d) {
    const P = this.presentation;
    if (P.live && !P.live.visible && this.autoHidAt === P.version) {
      this.autoHidAt = null;
      const r = P.move(d);
      if (r.ok) { P.restore(); return { ok: true, state: P.getLiveState() }; }
      return r; // 끝: 위 'edge' 처리 (다음 순서로)
    }
    return P.move(d);
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

  // ---------------- AI 주보 → 큐시트 · 설교 포인트 ----------------
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
    const resolveHymnal = (n, book) => {
      const { BOOKS } = require('./hymnal');
      if (/교독문/.test(book)) { const bk = BOOKS.find(x => x.id === '새찬송가'); return bk && bk.reading ? this.hymnal.get('새찬송가', bk.reading[0] + n - 1) : null; }
      return this.hymnal.get(/찬미가/.test(book) ? '찬미가' : '새찬송가', n);
    };
    const resolveSong = name => {
      const q = String(name).replace(/\s+/g, '').toLowerCase();
      const norm = t => String(t).replace(/\s+/g, '').toLowerCase();
      const hits = this.library.listSongs(name);
      const s = hits.find(x => norm(x.title) === q) || hits.find(x => norm(x.title).startsWith(q)) || (hits.length === 1 ? hits[0] : null);
      return s ? this.library.getSong(s.id) : null;
    };
    const { cue, warnings } = planToCue(plan, { resolveHymn, resolveHymnal, resolveSong, checkRef: ref => { try { return checkRef(ref); } catch { return null; } } });
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
      pin: this.stagePin(live),
    };
  }

  /** 예약 실행 확인: now 의 요일·시:분 이 맞는 켜진 예약 → 매크로 (같은 날 같은 예약은 한 번) */
  checkSchedule(now = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const ran = [];
    for (const e of this.settings.get().schedule || []) {
      if (!e.enabled || e.time !== hm || !(e.days || []).includes(now.getDay())) continue;
      const key = `${day}|${e.id}`;
      if (this.scheduleDone.has(key)) continue;
      this.scheduleDone.add(key);
      try { this.commands.runMacro.call(this, { id: e.macroId, by: '예약 ' + hm }); ran.push(e.id); } catch (err) { this.logger.warn(`예약 실행 실패 (${hm}): ${err.message}`); }
    }
    return ran;
  }

  /** 회중 메시지 (유아실 호출 · 차량 이동 등): 아래 띠 하나로, 정한 출력에만 */
  messageOverlay(output) {
    const m = this.message;
    if (!m || !m.outputs.includes(output)) return [];
    const { normalizeOverlay } = require('./library');
    return [normalizeOverlay({ id: 'wpmessage', type: 'banner', on: true, name: '회중 메시지', text: m.text, outputs: m.outputs, position: 'bottom-center', full: true, size: m.size || 52, color: '#ffffff', bg: 'rgba(12,14,20,0.88)', margin: 0 })];
  }

  /** 무대 화면 고정: 지금 슬라이드와 상관없이 계속 보이는 것 (순서표 · 고정 글). 지금 화면은 아래 작은 칸에 */
  stagePin(live) {
    const p = this.stage.pin;
    if (!p) return null;
    if (p.mode === 'text') return { mode: 'text', name: p.name || '', text: p.text || '' };
    const s = this.settings.get();
    const cueId = (live && live.passage && live.passage.cueId) || s.activeCueId;
    const cue = cueId ? this.store.getCue(cueId) : null;
    const cur = live && live.passage && live.passage.cueId === (cue && cue.id) ? live.passage.cueIndex : -1;
    return { mode: 'order', name: p.name || '', cueName: cue ? cue.name : '', current: cur, items: cue ? cue.items.map(it => ({ title: it.title, type: it.type, note: it.note || '' })) : [] };
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
    return v ? { key: v.key, playing: v.playing, offset: v.offset, at: v.at, now: Date.now(), ...(v.volume != null ? { volume: v.volume } : {}), ...(v.loop != null ? { loop: v.loop } : {}), ...(v.fade ? { fade: v.fade } : {}) } : null;
  }
  videoPosition() {
    const v = this.video;
    return v ? v.offset + (v.playing ? (Date.now() - v.at) / 1000 : 0) : 0;
  }

  /**
   * 지금 예배당 화면에 떠 있는 것 (FreeShow 처럼 층마다 보여 주고 따로 끄기)
   * bgs: 배경 [{ src: media|slide|template, type: camera|video|image|color, label }] · bgHidden: 배경 끔
   * content: 송출 중인 슬라이드 { kind, title, index, count, visible } · overlays: 켜진 오버레이 이름 · logo · draw
   */
  screenPayload() {
    const L = this.layers;
    const live = this.presentation.live;
    const slide = live ? live.slides[live.index] : null;
    const kindOf = u => (!u ? '' : u.startsWith('#') ? 'color' : u.startsWith('camera:') ? 'camera' : /\.(mp4|webm|mov|m4v|ogv|mkv)(\?|#|$)/i.test(u) ? 'video' : 'image');
    const bgs = [];
    if (L.media) bgs.push({ src: 'media', type: L.media.type, label: L.media.label || '' });
    if (slide && slide.bg && kindOf(slide.bg) !== 'color') bgs.push({ src: 'slide', type: kindOf(slide.bg), label: (live.passage && (live.passage.itemTitle || live.passage.title)) || '' });
    const t = this.templateFor('main');
    const b = (t && t.background) || {};
    if (['image', 'video', 'camera'].includes(b.type)) bgs.push({ src: 'template', type: b.type, label: t.name || '' });
    const ov = this.library.overlays().filter(o => o.on).map(o => o.name || o.text || '오버레이');
    return {
      bgs, bgHidden: !!L.hideBg,
      content: live ? { kind: slide ? slide.kind || 'text' : '', title: (live.passage && (live.passage.itemTitle || live.passage.title)) || '', index: live.index, count: live.slides.length, visible: !!live.visible } : null,
      overlays: ov, logo: !!L.logo, draw: !!(this.draw && (this.draw.strokes.length || this.draw.spot)),
    };
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
      // OBS 자막: '슬라이드 그대로' 면 예배당 화면과 같은 모양으로, 아니면 자막 템플릿
      template: output === 'overlay' && this.obsFull ? this.templateFor('main') : this.templateFor(output),
      obsFull: output === 'overlay' && this.obsFull,
      // OBS 자막: 글 없는 그림·악보 슬라이드를 우상단에 작게 (예배당 화면 모양으로)
      pip: output === 'overlay' && !this.obsFull && this.settings.get().output.obsPip ? { template: this.templateFor('main') } : null,
      overlays: [...this.library.activeFor(output), ...this.messageOverlay(output)],
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
    return { clients: list, desktop: this.desktop ? this.desktop.status() : null, stage: this.desktop && this.desktop.stageStatus ? this.desktop.stageStatus() : null };
  }

  getState() {
    const s = this.settings.get();
    return {
      obsView: this.obsView(),
      live: { ...this.presentation.getLiveState(), video: this.videoPayload() },
      stage: this.stagePayload(),
      layers: this.layersPayload('main'),
      screen: this.screenPayload(),
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
      obs: this.obs ? this.obs.status() : null,
      message: this.message || null,
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

/** OBS 자막 보기 상태: full (슬라이드 그대로) · pip (그림 슬라이드 우상단) */
WorshipCueCore.prototype.obsView = function () { return { full: !!this.obsFull, pip: !!this.settings.get().output.obsPip }; };

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
    unclearBg(this);
    this.holdObs(false); // 새로 송출하면 OBS 도 다시 보인다
    const r = this.presentation.sendLive(a && a.slides ? a : null);
    try {
      const L = this.presentation.live;
      if (L) { const cue = L.passage.cueId ? this.store.getCue(L.passage.cueId) : null; this.usage.record(L.passage, cue ? cue.name : ''); }
    } catch (e) { this.logger.warn('사용 기록 실패: ' + e.message); }
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
  nextSlide() { return this.slideStep(1); },
  previousSlide() { return this.slideStep(-1); },
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
  restoreLive() { unclearBg(this); return this.presentation.restore(); },
  toggleLive() { const r = this.presentation.toggle(); if (this.presentation.live && this.presentation.live.visible) { unclearBg(this); this.emit('live'); } return r; },
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
  /** 순서별 테마: 테마의 예배당·OBS 템플릿이 없으면 만들고 id 를 돌려준다 (전체 설정·이미 고친 템플릿은 그대로) */
  ensureTheme(a) {
    const theme = THEMES.find(t => t.id === a.id);
    if (!theme) throw new Error('테마를 찾을 수 없습니다.');
    const ids = {};
    let added = false;
    this.settings.update(d => {
      for (const o of OUTPUTS) {
        const tpl = buildOne(theme, o);
        ids[o] = tpl.id;
        if (!d.templates.some(x => x.id === tpl.id)) { d.templates.push(tpl); added = true; }
      }
    });
    if (added) this.settingsChanged('templates');
    return ids;
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
  /** OBS 자막 보기: pip (그림 슬라이드 우상단) · full (슬라이드 그대로) */
  setObsView(a) {
    if (typeof a.full === 'boolean') this.obsFull = a.full;
    if (typeof a.pip === 'boolean') { this.settings.update(d => { d.output.obsPip = a.pip; }); this.settingsChanged('settings'); }
    this.emit('live');
    return this.obsView();
  },
  /** 자동 업데이트 상태 */
  updateStatus() { return this.update || { state: 'idle', mode: 'none' }; },
  /** 자동 업데이트: check (지금 확인) · open (받기 페이지) · installNow (다시 시작해서 설치) */
  async updateAction(a) {
    const f = this.updateActions && this.updateActions[a.action];
    if (!f) throw new Error('데스크톱 프로그램에서만 됩니다.');
    await f(a);
    return this.update || { state: 'idle', mode: 'none' }; // (commands 안의 updateStatus 는 this 의 메서드가 아님)
  },
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
      if (typeof p.cueEdgeHide === 'boolean') d.cueEdgeHide = p.cueEdgeHide;
      if (typeof p.imeAuto === 'boolean') d.imeAuto = p.imeAuto;
      if (typeof p.cueTimes === 'boolean') d.cueTimes = p.cueTimes;
      if (p.uiLang === 'ko' || p.uiLang === 'en') d.uiLang = p.uiLang;
      if (typeof p.autoUpdate === 'boolean') d.autoUpdate = p.autoUpdate;
      if (typeof p.telemetry === 'boolean') d.telemetry = p.telemetry;
      if (p.telemetryNotice === true) d.telemetryNotice = true;
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
        if (['manna', 'dark', 'contrast', 'light', 'warm', 'navy'].includes(p.ui.theme)) d.ui.theme = p.ui.theme;
        if ([90, 100, 110, 120].includes(Number(p.ui.scale))) d.ui.scale = Number(p.ui.scale);
      }
      if (typeof p.dockLayout === 'string' && p.dockLayout.length <= 300000) d.dockLayout = p.dockLayout;
      if (typeof p.reservedKeys === 'string') d.reservedKeys = p.reservedKeys.slice(0, 1000);
      if (p.output && typeof p.output.cursorHidden === 'boolean') d.output.cursorHidden = p.output.cursorHidden;
      if (p.output && typeof p.output.autoOnSend === 'boolean') d.output.autoOnSend = p.output.autoOnSend;
      if (p.output && typeof p.output.linkObs === 'boolean') d.output.linkObs = p.output.linkObs;
      if (p.output && typeof p.output.obsPip === 'boolean') d.output.obsPip = p.output.obsPip;
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
  /** 장비 직접 제어 (X32 OSC · PTZ VISCA): 보내기 · 장비 저장 · 지우기 */
  async deviceRun(a) { return require('./devices').run(this, a || {}); },
  saveDevice(a) {
    const d = require('./devices').normalizeDevice(a.device || {});
    this.settings.update(s => { s.devices = [...(s.devices || []).filter(x => x.id !== d.id), d].slice(-20); });
    this.settingsChanged('settings');
    return d;
  },
  deleteDevice(a) {
    this.settings.update(s => { s.devices = (s.devices || []).filter(x => x.id !== a.id); });
    this.settingsChanged('settings');
    return {};
  },
  /** Companion 단추 누르기 (loc: '1/0/2, 2/1/0') · 설정 (주소·포트) */
  async companionPress(a) { return require('./companion').press(this, a && a.loc); },
  setCompanion(a) {
    this.settings.update(d => {
      d.companion = { host: '127.0.0.1', port: 8000, ...(d.companion || {}) };
      if (typeof a.host === 'string') d.companion.host = a.host.trim().slice(0, 200) || '127.0.0.1';
      if (a.port !== undefined) d.companion.port = Math.max(1, Math.min(65535, Math.round(Number(a.port)) || 8000));
    });
    this.settingsChanged('settings');
    return this.settings.get().companion;
  },
  /** 한글 입력 자동 전환: 가사·공지 칸에 들어가면 (설정 imeAuto, 윈도우 데스크톱만) */
  async imeKorean() {
    if (this.settings.get().imeAuto === false || !this.desktop || !this.desktop.setImeKorean) return { skipped: true };
    return { result: await this.desktop.setImeKorean() };
  },
  /** 무대 화면을 모니터에 전체 화면으로 (설교자·찬양팀 모니터) */
  setStageWindow(a) {
    if (!this.desktop || !this.desktop.setStageOutput) throw new Error('무대 화면 창은 데스크톱 프로그램에서만 띄울 수 있습니다.');
    const r = this.desktop.setStageOutput({ enabled: a.enabled, displayId: a.displayId });
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
    return findDirs(extra).map(dir => ({ dir, bibles: listBibles(dir), hymns: countHymns(path.join(dir, HYMN_FILE)), hymnal: Hymnal.scan(dir) }));
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
  /** 베들레헴의 새찬송가 가사 DB 를 데이터 폴더로 복사 (베들레헴을 지워도 OBS 자막 가사를 쓸 수 있게) */
  /** 베들레헴 찬송가(새찬송가 · 찬미가)의 가사 DB 와 악보를 데이터 폴더로 복사 */
  importBethlehemHymns(a) {
    const dir = String(a.dir || '');
    this.hymnLyrics.close();
    const done = this.hymnal.importFrom(dir, a.books);
    if (!done.length) throw new Error('찬송가 파일(새찬송가.hdb · .cmp)을 찾지 못했습니다.');
    const count = countHymns(require('path').join(this.hymnal.dir, HYMN_FILE));
    this.logger.info(`베들레헴에서 찬송가를 가져옴: ${done.map(d => d.book + (d.scores ? '(악보)' : '')).join(', ')}`);
    return { count, done };
  },
  hymnalBooks() { return this.hymnal.books(); },
  /** 베들레헴 찬송가 한 장 → 큐시트에 넣을 모양 (찬송: 가사 · 순서 · 악보 주소 / 교독문: 공지 글) */
  hymnalGet(a) { return this.hymnal.get(String(a.book || '새찬송가'), Number(a.number)); },
  // ---- 찬송가·교독문 폴더 ----
  listHymnFolders() { return this.hymns.folders(); },
  addHymnFolder(a) { const r = this.hymns.addFolder(a.path, a.name); this.settingsChanged('settings'); return r; },
  removeHymnFolder(a) { this.hymns.removeFolder(String(a.path)); this.settingsChanged('settings'); return {}; },
  searchHymns(a) {
    const own = this.hymns.search(a.query, a.folder || null);
    if (a.folder) return own;
    let bh = [];
    try { bh = this.hymnal.search(a.query, 60); } catch { /* 베들레헴 없음 */ }
    return [...own, ...bh.map(h => ({ bethlehem: true, book: h.book, number: h.number, title: h.kind === 'reading' ? h.label : h.title, label: h.label, kind: h.kind, scores: h.scores, folder: `${h.book} (베들레헴)` }))].slice(0, 300);
  },
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
  /** 붙여 넣은 예배 순서 글 → 규칙으로 바로 큐시트 (AI 없이) */
  quickMakeCue(a) {
    const { parseOrderText } = require('./bulletin');
    const { looksLikeReference } = require('./parser');
    const text = String((a && a.text) || '').slice(0, 100000);
    if (!text.trim()) throw new Error('예배 순서를 붙여 넣으세요.');
    const plan = parseOrderText(text, { looksLikeRef: looksLikeReference });
    if (a && typeof a.name === 'string' && a.name.trim()) plan.name = a.name.trim();
    return { ...this.planToSavedCue(plan), model: '규칙' };
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
  // ---- 예배 전 화면 자동 만들기 (지난주 말씀카드 + 이번 주 QT 첫날 본문 → 슬라이드쇼) ----
  preServiceInfo() {
    const fs = require('fs');
    const path = require('path');
    const p = this.settings.get().preService || {};
    let bundleDir = p.bundleDir || '';
    if (!bundleDir) for (const g of ['F:\\aside\\홈페이지보내기', path.join(require('os').homedir(), 'Documents', '홈페이지보내기')]) { try { if (fs.statSync(g).isDirectory()) { bundleDir = g; break; } } catch { /* 없음 */ } }
    return { cardFolder: p.cardFolder || '', bundleDir, autoSec: p.autoSec || 8, feedUrl: (this.settings.get().home || {}).feedUrl || '' };
  },
  /** 말씀카드 그림 폴더 → 최근 묶음들 (그림 주소는 끌어다 놓은 파일처럼 등록해 보여 줄 수 있게) */
  preServiceCards(a) {
    const { cardGroups } = require('./preservice');
    const folder = String((a && a.folder) || '').trim();
    const groups = cardGroups(folder);
    const paths = groups.flatMap(g => g.files.map(f => f.path)).slice(0, 80);
    const reg = paths.length ? this.commands.addDroppedFiles.call(this, { paths }) : [];
    const url = p => (reg.find(x => x.path === require('path').resolve(p)) || {}).url || this.library.fileUrl(p);
    this.settings.update(d => { d.preService = { ...(d.preService || {}), cardFolder: folder.slice(0, 500) }; });
    return { groups: groups.map(g => ({ base: g.base, mtime: g.mtime, files: g.files.map(f => ({ name: f.name, url: url(f.path) })) })) };
  },
  /** 설교쇼츠 편집기 '홈페이지 묶음' 의 최근 카드 문장 */
  preServiceBundle(a) {
    const { latestBundle } = require('./preservice');
    const dir = String((a && a.dir) || '').trim();
    const b = latestBundle(dir);
    if (dir) this.settings.update(d => { d.preService = { ...(d.preService || {}), bundleDir: dir.slice(0, 500) }; });
    return { bundle: b };
  },
  /** QT 자료·장절 → 첫날 본문 (성경 DB) */
  preServiceQt(a) {
    const { parseQt } = require('./preservice');
    const { looksLikeReference } = require('./parser');
    const q = parseQt(String((a && a.text) || '').slice(0, 200000), looksLikeReference);
    const r = this.commands.searchReference.call(this, { query: q.ref });
    if (!r || !r.passage || !r.passage.verses || !r.passage.verses.length) throw new Error(`'${q.ref}' 본문을 성경에서 찾지 못했습니다. 장절을 확인하세요.`);
    const passage = { title: r.passage.title, verses: r.passage.verses.slice(0, 30).map(v => ({ verse: v.verse, text: v.text })) };
    return { ...q, passage };
  },
  /** 슬라이드쇼 순서 만들기 (넣는 것은 조작 화면: 실행 취소가 되게) */
  preServiceItem(a) {
    const { buildItem } = require('./preservice');
    const sec = Number(a && a.autoSec) || 0;
    if (sec) this.settings.update(d => { d.preService = { ...(d.preService || {}), autoSec: Math.max(3, Math.min(60, Math.round(sec))) }; });
    return { item: buildItem(a || {}) };
  },
  // ---- 홈페이지 주보 연동 (교회 홈페이지의 주보 JSON → 큐시트 · 광고 슬라이드) ----
  homeFeedInfo() { const h = this.settings.get().home || {}; return { url: h.feedUrl || '' }; },
  /** 주보 JSON 받기 (받으면 주소를 기억) */
  async homeFeed(a) {
    const { fetchFeed } = require('./homefeed');
    const url = String((a && a.url) || (this.settings.get().home || {}).feedUrl || '').trim();
    const feed = await fetchFeed(url, this.httpFetch || fetch);
    this.settings.update(d => { d.home = { ...(d.home || {}), feedUrl: url.slice(0, 500) }; });
    return feed;
  },
  /** 주보 한 호의 예배 하나 → 큐시트 저장 (교회 소식 순서에 광고 슬라이드) */
  homeMakeCue(a) {
    const { normalizeFeed, serviceToPlan } = require('./homefeed');
    const { looksLikeReference } = require('./parser');
    const b = normalizeFeed({ bulletins: [(a && a.bulletin) || {}] }).bulletins[0];
    const plan = serviceToPlan(b, Number((a && a.service) || 0), { looksLikeRef: looksLikeReference, news: (a && a.news) || {} });
    const r = this.planToSavedCue(plan);
    return { ...r, newsPlaced: plan.newsPlaced, model: '홈페이지 주보' };
  },
  /** 광고·일정·기도 제목 → 공지 순서 (넣는 것은 조작 화면: 실행 취소가 되게) */
  homeNewsItem(a) {
    const { normalizeFeed, newsBody } = require('./homefeed');
    const b = normalizeFeed({ bulletins: [(a && a.bulletin) || {}] }).bulletins[0];
    const body = newsBody(b, (a && a.news) || {});
    if (!body.trim()) throw new Error('넣을 광고가 없습니다. 하나 이상 고르세요.');
    return { item: { type: 'text', title: '교회 소식', body, note: `홈페이지 주보 ${b.date}`.trim() } };
  },
  // ---- 설교 포인트 슬라이드 (원고 → 대지·핵심 문장 → '제목' 순서) ----
  /** 규칙으로 대지 찾기 (AI 없이). 붙여 넣은 글이 AI 답(JSON)이면 그대로 읽는다 */
  sermonPointsFind(a) {
    const { findPoints } = require('./sermonpoints');
    return { data: findPoints(String((a && a.text) || '').slice(0, 300000), pointsMeta(a)) };
  },
  /** 오픈라우터 API 로 대지 뽑기 */
  async sermonPointsAI(a) {
    const { askPoints } = require('./sermonpoints');
    const ai = this.settings.get().ai || {};
    return askPoints({ apiKey: this.aiKey(), model: ai.model || undefined, endpoint: ai.endpoint || undefined, text: String((a && a.text) || ''), meta: pointsMeta(a), extra: String((a && a.extra) || '').slice(0, 500), fetchImpl: this.aiFetch || fetch });
  },
  /** 채팅 AI 에 붙여 넣을 프롬프트 (원고 포함) */
  sermonPointsPrompt(a) {
    const { chatPrompt } = require('./sermonpoints');
    return { prompt: chatPrompt(String((a && a.text) || '').slice(0, 300000), pointsMeta(a), String((a && a.extra) || '').slice(0, 500)) };
  },
  /** 채팅 AI 답 → 데이터 */
  sermonPointsImport(a) {
    const { parseAnswer } = require('./sermonpoints');
    const d = parseAnswer(String((a && a.text) || '').slice(0, 300000));
    const m = pointsMeta(a);
    return { data: { ...d, title: d.title || m.title, verse: d.verse || m.verse, speaker: d.speaker || m.speaker } };
  },
  /** 데이터 → 큐시트 '제목' 순서 (넣는 것은 조작 화면이 한다: 실행 취소가 되게) */
  sermonPointsItem(a) {
    const { toCueItem } = require('./sermonpoints');
    return { item: toCueItem((a && a.data) || {}, (a && a.opts) || {}) };
  },
  // ---- 사용 기록 (저작권 보고) ----
  usageLog(a) { const o = { from: String((a && a.from) || ''), to: String((a && a.to) || ''), kinds: a && Array.isArray(a.kinds) ? a.kinds : null, q: String((a && a.q) || '') }; return { rows: this.usage.list(o), summary: this.usage.summary(o) }; },
  usageCsv(a) { const o = { from: String((a && a.from) || ''), to: String((a && a.to) || ''), kinds: a && Array.isArray(a.kinds) ? a.kinds : null }; const mode = a && a.mode === 'summary' ? 'summary' : 'rows'; return { csv: this.usage.csv(o, mode), name: `WorshipCue-사용기록${mode === 'summary' ? '-제목별' : ''}${o.from ? '-' + o.from : ''}${o.to ? '~' + o.to : ''}.csv` }; },
  clearUsageLog(a) { return { removed: this.usage.clear(String((a && a.before) || '')) }; },
  // ---- 여러 PC 동기화 · 백업 ----
  syncInfo() { return this.sync.info(); },
  setSyncDir(a) {
    const dir = String((a && a.dir) || '').trim();
    if (dir && !fs.existsSync(dir)) throw new Error('폴더가 없습니다: ' + dir);
    this.settings.update(d => { d.syncDir = dir; });
    this.settingsChanged('settings');
    let got = null;
    if (dir) { got = this.sync.importNow(); if (got.none) this.sync.exportNow(); }
    return { ...this.sync.info(), got };
  },
  syncNow() { const got = this.sync.importNow(); const put = this.sync.exportNow(); return { ...this.sync.info(), got, put }; },
  backups() { return { list: this.sync.backups(), pending: this.sync.restorePending(), dir: this.sync.backupDir() }; },
  backupNow() { return this.sync.backupNow(); },
  restoreBackup(a) { return this.sync.restore(String((a && a.day) || '')); },
  cancelRestore() { return this.sync.cancelRestore(); },
  openPath(a) {
    const p = String((a && a.path) || '');
    if (!this.desktop || !this.desktop.openPath) throw new Error('폴더 열기는 데스크톱 프로그램에서만 됩니다.');
    if (!p.startsWith(this.dataDir) && p !== this.sync.dir()) throw new Error('열 수 없는 경로입니다.');
    this.desktop.openPath(p);
    return {};
  },
  // ---- 휴대폰 리모컨 ----
  // ---- OBS 원격 조작 (obs-websocket 5) ----
  obsStatus() { return this.obs.status(); },
  setObs(a) {
    this.settings.update(d => {
      d.obs = { enabled: false, host: '127.0.0.1', port: 4455, password: '', passwordEnc: '', ...(d.obs || {}) };
      if (typeof a.enabled === 'boolean') d.obs.enabled = a.enabled;
      if (typeof a.host === 'string') d.obs.host = a.host.trim().slice(0, 200) || '127.0.0.1';
      if (a.port !== undefined) d.obs.port = Math.max(1, Math.min(65535, Math.round(Number(a.port)) || 4455));
      if (typeof a.password === 'string') {
        const dk = this.desktop;
        if (!a.password) { d.obs.password = ''; d.obs.passwordEnc = ''; }
        else if (dk && dk.canEncrypt && dk.canEncrypt()) { d.obs.passwordEnc = dk.encrypt(a.password); d.obs.password = ''; }
        else { d.obs.password = a.password; d.obs.passwordEnc = ''; }
      }
    });
    this.obs.sync();
    this.settingsChanged('settings');
    return this.obs.status();
  },
  async obsAction(a) { return this.obs.action(a || {}); },
  /** 연결 점검 (도움말 → 연결 점검): 예배당 화면 · OBS · 내부망 · 리모컨 · 데이터 · 오늘 큐시트 · 동기화 · 저장 공간 */
  diagnose(a) { return require('./diagnose').diagnose(this, { cueId: a && a.cueId, port: a && a.port }); },
  /** 로그 묶음 (도움말 → 로그 묶음 저장): 버전 · 점검 결과 · 설정(비밀은 가림) · 최근 로그 → 글 파일 하나 */
  logBundle(a) { return require('./logbundle').logBundle(this, { days: Math.max(1, Math.min(30, Number(a && a.days) || 7)), port: a && a.port, cueId: a && a.cueId }); },
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
  /** 배경 끄기 ↔ 다시 켜기. 끌 때 송출 배경(라이브러리에서 띄운 카메라·그림·영상)은 아예 끈다 */
  toggleBackground(a) {
    const off = a && typeof a.on === 'boolean' ? a.on : !this.layers.hideBg;
    if (off && this.layers.media) {
      this.layers.media = null;
      // 송출 배경만 있었으면 거기서 끝 (순서·템플릿 배경까지 숨겨 두지 않는다)
      if (!this.screenPayload().bgs.length) { this.emit('live'); return this.layersPayload(); }
    }
    this.layers.hideBg = off;
    this.layers.bgByClear = false; // 직접 끈 배경은 다시 켤 때까지
    this.emit('live');
    return this.layersPayload();
  },
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
    if (!this.layers.hideBg) { this.layers.hideBg = true; this.layers.bgByClear = true; } // 모두 지우기로 숨긴 배경은 다음 송출 때 다시
    this.layers.logo = false;
    this.layers.media = null; // 송출 배경(카메라·그림·영상)도 끄기 — 카메라가 계속 켜져 있지 않게
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
  // ---- 매크로: 이름 붙인 '송출할 때 자동으로' 묶음 (실행은 조작 화면이 한다 — 음악·OBS 등이 그쪽에 있음) ----
  saveMacro(a) {
    const m = a.macro || {};
    const name = String(m.name || '').trim().slice(0, 40);
    if (!name) throw new Error('매크로 이름을 입력하세요.');
    const { normalizeItem } = require('./cues');
    const it = normalizeItem({ type: 'title', title: name, actions: m.actions || {}, music: m.music || '', musicVolume: m.musicVolume });
    if (!it.actions && !it.music) throw new Error('매크로에 넣을 동작이 없습니다. 순서의 ⚡ 송출할 때 자동으로 에서 동작을 정한 뒤 저장하세요.');
    const id = /^[a-z0-9]{3,30}$/i.test(m.id || '') ? m.id : 'mc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const color = /^#[0-9a-f]{6}$/i.test(m.color || '') ? m.color : '';
    this.settings.update(d => {
      const list = (d.macros || []).filter(x => x.id !== id).map(x => (m.startup ? { ...x, startup: false } : x));
      const i = (d.macros || []).findIndex(x => x.id === id);
      const one = { id, name, color, actions: it.actions || {}, ...(it.music ? { music: it.music, musicVolume: it.musicVolume } : {}), ...(m.startup ? { startup: true } : {}) };
      if (i >= 0) list.splice(Math.min(i, list.length), 0, one); else list.push(one);
      d.macros = list.slice(0, 40);
    });
    this.settingsChanged('settings');
    return { id };
  },
  /** 예약 실행 목록 저장: [{ id, days: [0~6 (일~토)], time: 'HH:MM', macroId, enabled }] */
  saveSchedule(a) {
    const list = (Array.isArray(a.list) ? a.list : []).slice(0, 50).map(e => ({
      id: /^[a-z0-9]{3,30}$/i.test(e.id || '') ? e.id : 'sc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      days: [...new Set((Array.isArray(e.days) ? e.days : []).map(Number).filter(d => d >= 0 && d <= 6))].sort(),
      time: /^\d{2}:\d{2}$/.test(e.time || '') ? e.time : '',
      macroId: String(e.macroId || ''),
      enabled: e.enabled !== false,
    })).filter(e => e.time && e.macroId);
    this.settings.update(d => { d.schedule = list; });
    this.settingsChanged('settings');
    return list;
  },
  deleteMacro(a) { this.settings.update(d => { d.macros = (d.macros || []).filter(x => x.id !== a.id); }); this.settingsChanged('settings'); return {}; },
  /** 매크로 실행 요청 (외부 단추 · 예약): 조작 화면에 알린다 */
  runMacro(a) {
    const list = this.settings.get().macros || [];
    const m = list.find(x => x.id === a.id) || list.find(x => x.name === String(a.name || '').trim());
    if (!m) throw new Error('매크로를 찾을 수 없습니다: ' + (a.name || a.id || ''));
    const ctl = [...this.outputClients.values()].some(c => c.client === 'control');
    this.emit('run-macro', { id: m.id, name: m.name, by: a.by || '' });
    this.logger.info(`매크로 '${m.name}'${a.by ? ' (' + a.by + ')' : ''}`);
    return { id: m.id, name: m.name, delivered: ctl };
  },
  /** 회중 메시지 보이기: text(칸을 채운 글) · seconds(0 = 숨길 때까지) · outputs(main · overlay) */
  showMessage(a) {
    const text = String(a.text || '').trim().slice(0, 300);
    if (!text) throw new Error('보일 메시지를 쓰세요.');
    if (/\{[^}]+\}/.test(text)) throw new Error('채우지 않은 칸이 있습니다: ' + text.match(/\{[^}]+\}/g).join(' '));
    const outputs = (Array.isArray(a.outputs) ? a.outputs : ['main', 'overlay']).filter(x => x === 'main' || x === 'overlay');
    if (!outputs.length) throw new Error('보일 화면(예배당 · OBS)을 고르세요.');
    const sec = Math.max(0, Math.min(3600, Math.round(Number(a.seconds) || 0)));
    clearTimeout(this.messageTimer);
    this.message = { text, outputs, size: Number(a.size) || 0, until: sec ? Date.now() + sec * 1000 : 0, at: Date.now() };
    if (sec) { this.messageTimer = setTimeout(() => { this.message = null; this.emit('live'); this.emit('message', null); }, sec * 1000); if (this.messageTimer.unref) this.messageTimer.unref(); }
    this.logger.info('회중 메시지: ' + text);
    this.emit('live'); this.emit('message', this.message);
    return this.message;
  },
  clearMessage() { clearTimeout(this.messageTimer); this.message = null; this.emit('live'); this.emit('message', null); return {}; },
  /** 메시지 틀 저장 (같은 id 면 고침) · 지우기 */
  saveMessageTemplate(a) {
    const t = a.template || {};
    const name = String(t.name || '').trim().slice(0, 40), text = String(t.text || '').trim().slice(0, 300);
    if (!name || !text) throw new Error('틀 이름과 글을 쓰세요.');
    const id = /^[a-z0-9]{3,30}$/i.test(t.id || '') ? t.id : 'mt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.settings.update(d => { const l = (d.messageTemplates || []).filter(x => x.id !== id); l.push({ id, name, text, seconds: Math.max(0, Math.min(3600, Math.round(Number(t.seconds) || 0))) }); d.messageTemplates = l.slice(-40); });
    this.settingsChanged('settings');
    return { id };
  },
  deleteMessageTemplate(a) { this.settings.update(d => { d.messageTemplates = (d.messageTemplates || []).filter(x => x.id !== a.id); }); this.settingsChanged('settings'); return {}; },
  /** 무대 화면 고정: { mode: 'order' | 'text', text, name } · { preset: id } · null(지금 화면으로) */
  stagePinSet(a) {
    let p = a && a.preset ? (this.settings.get().stagePresets || []).find(x => x.id === a.preset) : a;
    if (a && a.preset && !p) throw new Error('무대 화면 프리셋을 찾을 수 없습니다.');
    this.stage.pin = p && ['order', 'text'].includes(p.mode) ? { mode: p.mode, text: String(p.text || '').slice(0, 2000), name: String(p.name || '').slice(0, 60), id: p.id || '' } : null;
    this.emit('live');
    return this.stage.pin;
  },
  /** 무대 화면 프리셋 저장 (같은 id 면 고침) · 지우기 */
  saveStagePreset(a) {
    const p = a.preset || {};
    if (!['order', 'text'].includes(p.mode)) throw new Error('고정할 것을 고르세요.');
    const name = String(p.name || '').trim().slice(0, 60);
    if (!name) throw new Error('프리셋 이름을 입력하세요.');
    const id = /^[a-z0-9]{3,30}$/i.test(p.id || '') ? p.id : 'sp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.settings.update(d => {
      const list = (d.stagePresets || []).filter(x => x.id !== id);
      list.push({ id, name, mode: p.mode, text: String(p.text || '').slice(0, 2000) });
      d.stagePresets = list.slice(-30);
    });
    this.settingsChanged('settings');
    return { id };
  },
  deleteStagePreset(a) {
    this.settings.update(d => { d.stagePresets = (d.stagePresets || []).filter(x => x.id !== a.id); });
    if (this.stage.pin && this.stage.pin.id === a.id) { this.stage.pin = null; this.emit('live'); }
    this.settingsChanged('settings');
    return {};
  },
  /** 무대 화면에 전달 메시지 (빈 글이면 지움) */
  stageMessage(a) {
    this.stage.message = String(a.text || '').slice(0, 300);
    this.emit('live');
    return { message: this.stage.message };
  },
  /** 영상 재생 조작: play | pause | toggle | restart | seek(time) | volume(value) | loop(on) | fadeout(ms) | stop */
  videoControl(a) {
    const v = this.video;
    if (!v) throw new Error('송출 중인 영상이 없습니다.');
    const pos = this.videoPosition();
    const act = String(a.action || '');
    if (['play', 'toggle', 'restart', 'seek'].includes(act)) { v.fade = null; clearTimeout(this._fadeT); } // 페이드 중에 다시 재생하면 페이드 취소
    if (act === 'play' || (act === 'toggle' && !v.playing)) Object.assign(v, { playing: true, offset: pos, at: Date.now(), ended: false });
    else if (act === 'pause' || act === 'toggle') Object.assign(v, { playing: false, offset: pos, at: Date.now() });
    else if (act === 'restart') Object.assign(v, { playing: true, offset: 0, at: Date.now(), ended: false });
    else if (act === 'seek') Object.assign(v, { offset: Math.max(0, Number(a.time) || 0), at: Date.now(), ended: false });
    else if (act === 'volume') v.volume = Math.max(0, Math.min(1, Number(a.value)));
    else if (act === 'loop') v.loop = !!a.on;
    else if (act === 'fadeout' || act === 'stop') {
      // 페이드아웃: 출력 화면이 소리·화면을 줄이고, 끝나면 멈추고 화면을 숨긴다 (정지 = 바로)
      const ms = act === 'stop' ? 0 : Math.max(300, Math.min(10000, Number(a.ms) || 3000));
      v.fade = ms ? { at: Date.now(), ms } : null;
      clearTimeout(this._fadeT);
      const key = v.key;
      this._fadeT = setTimeout(() => {
        if (!this.video || this.video.key !== key) return;
        Object.assign(this.video, { playing: false, offset: 0, at: Date.now(), fade: null, ended: true });
        this.presentation.clear();
        this.emit('live');
      }, ms);
    }
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
    const MAX = 3000;
    // 폴더는 하위 폴더까지 (깊이 8 · 최대 3000개)
    const walk = (dir, depth) => {
      let names = [];
      try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const d of names) {
        if (files.length >= MAX) return;
        if (d.name.startsWith('.') || d.name.startsWith('~$')) continue;
        const f = path.join(dir, d.name);
        if (d.isDirectory()) { if (depth < 8) walk(f, depth + 1); }
        else if (SONG_EXT.test(d.name)) files.push(f);
      }
    };
    for (const raw of (Array.isArray(a.paths) ? a.paths : []).slice(0, 500)) {
      const p = path.resolve(String(raw || ''));
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, 0);
      else if (files.length < MAX) files.push(p);
    }
    const have = new Set(this.library.listSongs('').map(s => s.title.replace(/\s+/g, '').toLowerCase()));
    const songs = [], errors = [];
    for (const f of files) {
      try {
        for (const s of parseSongFile(f)) {
          if (!String(s.lyrics || '').trim()) { errors.push({ file: path.basename(f), error: '가사가 없습니다.' }); continue; }
          songs.push({ ...s, source: path.relative(path.dirname(path.resolve(String(a.paths[0] || f))), f) || path.basename(f), dup: have.has(String(s.title).replace(/\s+/g, '').toLowerCase()) });
        }
      } catch (e) { errors.push({ file: path.basename(f), error: e.message }); }
    }
    return { songs, errors };
  },
  /** 붙여넣은 여러 곡 ('# 제목' 줄마다 새 곡) → 미리 보기 목록 (저장은 saveImportedSongs) */
  parseSongText(a) {
    const { parseSongText } = require('./songimport');
    const songs = parseSongText(String(a.text || '').slice(0, 500000), { lines: Math.max(1, Math.min(6, +a.lines || 2)) });
    const have = new Set(this.library.listSongs('').map(s => s.title.replace(/\s+/g, '').toLowerCase()));
    return { songs: songs.map(s => ({ ...s, source: '붙여넣기', dup: have.has(s.title.replace(/\s+/g, '').toLowerCase()) })), errors: [] };
  },
  // ---- 웹에서 가사 찾기 (벅스·지니·멜론, 사용자가 고른 한 곡씩) ----
  lyricsSearch(a) {
    const sites = Array.isArray(a.sites) && a.sites.length ? a.sites : undefined;
    return require('./lyricsweb').search(a.query, sites);
  },
  async lyricsGet(a) {
    const L = require('./lyricsweb');
    const text = await L.lyrics(String(a.site), String(a.id));
    return { text, ...L.arrange(text, { lines: Math.max(1, Math.min(6, +a.lines || 2)) }) };
  },
  lyricsArrange(a) { return require('./lyricsweb').arrange(String(a.text || '').slice(0, 100000), { lines: Math.max(1, Math.min(6, +a.lines || 2)) }); },
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
    if (!list.length) throw new Error('워십프리젠터(WorshipCue) 큐시트 파일이 아닙니다.');
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
