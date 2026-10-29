'use strict';
// Presentation Engine: Preview 와 Live 상태를 완전히 분리해 관리한다.
// Live 는 sendLive / 슬라이드 이동 / clear / restore / extend 명령으로만 바뀐다.

const { EventEmitter } = require('events');
const { normalizeEdit } = require('./slideedit');

const MAX_SLIDES = 2000;
const MAX_TEXT = 5000;

function validateSlides(slides) {
  if (!Array.isArray(slides) || !slides.length) throw new Error('슬라이드가 없습니다.');
  if (slides.length > MAX_SLIDES) throw new Error('슬라이드가 너무 많습니다.');
  const KINDS = ['bible', 'text', 'title', 'image', 'blank', 'score', 'video', 'camera'];
  return slides.map((s, i) => {
    const kind = KINDS.includes(s && s.kind) ? s.kind : 'bible';
    // 제목 카드·이미지·빈 화면은 본문(parts)이 없어도 된다
    if (!s || !Array.isArray(s.parts) || (!s.parts.length && (kind === 'bible' || kind === 'text'))) throw new Error(`슬라이드 ${i + 1} 형식 오류`);
    return {
      kind,
      label: String(s.label || ''),
      subtitle: String(s.subtitle || '').slice(0, 300),
      image: String(s.image || '').slice(0, 300),
      bg: String(s.bg || '').slice(0, 300), // 슬라이드 자체 배경 (찬송가 원래 배경·지정 이미지)
      ...(typeof s.caption === 'string' ? { caption: s.caption.slice(0, 2000) } : {}), // PPT·찬송가 슬라이드의 가사 (OBS '가사만' 출력용)
      mode: s.mode === 'background' ? 'background' : 'black',
      // 영상 재생 슬라이드: 소리·반복·끝나면
      ...(kind === 'camera' ? { camera: { deviceId: String((s.camera && s.camera.deviceId) || '').slice(0, 200), label: String((s.camera && s.camera.label) || '').slice(0, 100), fit: s.camera && s.camera.fit === 'contain' ? 'contain' : 'cover' } } : {}),
      ...(kind === 'video' ? { video: { volume: Math.max(0, Math.min(1, Number(s.video && s.video.volume) || 0)), sound: !!(s.video && s.video.sound), loop: !!(s.video && s.video.loop), endAction: ['hold', 'black', 'next'].includes(s.video && s.video.endAction) ? s.video.endAction : 'hold' } } : {}),
      ref: String(s.ref || ''),
      ...(s.footer ? { footer: String(s.footer).slice(0, 300) } : {}),
      ...(s.countdown && /^\d{1,2}:\d{2}$/.test(s.countdown.target || '') ? { countdown: { target: s.countdown.target, label: String(s.countdown.label || '').slice(0, 60) } } : {}), // 예배 시작까지 // 곡 정보 (작사·작곡·저작권) — 화면 아래 작게
      title: String(s.title || ''), // 전체 범위 (장절 '전체 범위 고정' 표시용)
      ...(Number.isInteger(s.src) && s.src >= 0 ? { src: s.src } : {}), // 원래 가사·글 덩어리 번호 (슬라이드 편집 키)
      ...(s.edit ? (e => (e ? { edit: e } : {}))(normalizeEdit(s.edit)) : {}), // 슬라이드 편집
      parts: s.parts.map(p => {
        const text = String(p.text ?? '');
        if (text.length > MAX_TEXT) throw new Error('본문이 너무 깁니다.');
        return {
          book: Number(p.book), chapter: Number(p.chapter), verse: Number(p.verse), text,
          partIndex: p.partIndex ? Number(p.partIndex) : 0, partCount: p.partCount ? Number(p.partCount) : 0,
          heading: p.heading ? String(p.heading) : '',
          ...(p.text2 ? { text2: String(p.text2).slice(0, MAX_TEXT) } : {}), // 병행 번역
        };
      }),
    };
  });
}

function validatePassage(p) {
  if (!p || typeof p !== 'object') throw new Error('본문 정보가 없습니다.');
  return {
    title: String(p.title || ''),
    versionId: String(p.versionId || ''),
    versionName: String(p.versionName || ''),
    book: p.book ? { id: Number(p.book.id), name: String(p.book.name || ''), short: String(p.book.short || '') } : null,
    first: p.first ? { chapter: Number(p.first.chapter), verse: Number(p.first.verse) } : null,
    last: p.last ? { chapter: Number(p.last.chapter), verse: Number(p.last.verse) } : null,
    query: String(p.query || ''),
    // 큐시트에서 보낸 경우: 어느 큐시트의 몇 번째 항목인지
    cueId: p.cueId ? String(p.cueId) : '',
    cueIndex: Number.isInteger(p.cueIndex) ? p.cueIndex : -1,
    itemType: String(p.itemType || '').slice(0, 20), // 순서 종류 (song · hymn · …) — 사용 기록용
    credit: String(p.credit || '').slice(0, 300), // 저작권·출처 — 사용 기록용
    itemTitle: String(p.itemTitle || ''),
    note: String(p.note || '').slice(0, 1000), // 큐시트 순서 메모 (무대 화면에 보임)
    // 이 순서에만 쓰는 템플릿 (비우면 출력의 기본 템플릿)
    tpl: p.tpl ? { main: String(p.tpl.main || ''), overlay: String(p.tpl.overlay || '') } : null,
    // 자동 넘김: sec 초마다 다음 슬라이드, loop 면 끝에서 처음으로
    auto: p.auto && Number(p.auto.sec) >= 2 ? { sec: Math.min(3600, Math.round(Number(p.auto.sec))), loop: !!p.auto.loop } : null,
  };
}

class Presentation extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.version = 0;
    this.preview = null; // { passage, slides, index }
    this.live = null;    // { passage, slides, index, visible, sentAt }
  }

  setPreview({ passage, slides, index = 0 }) {
    const s = validateSlides(slides);
    this.preview = { passage: validatePassage(passage), slides: s, index: clampIndex(index, s.length) };
    this.emit('preview', this.preview);
    return { index: this.preview.index, count: s.length };
  }

  setPreviewIndex(index) {
    if (!this.preview) throw new Error('미리보기 본문이 없습니다.');
    this.preview.index = clampIndex(index, this.preview.slides.length);
    this.emit('preview', this.preview);
    return { index: this.preview.index };
  }

  /** 미리보기(또는 명시한 본문)를 Live 로 보낸다 */
  sendLive(payload) {
    let src = this.preview;
    if (payload && payload.slides) {
      const slides = validateSlides(payload.slides);
      src = { passage: validatePassage(payload.passage), slides, index: clampIndex(payload.index || 0, slides.length) };
    }
    if (!src) throw new Error('송출할 미리보기 본문이 없습니다.');
    this.live = {
      passage: structuredClone(src.passage),
      slides: structuredClone(src.slides),
      index: src.index,
      visible: true,
      sentAt: Date.now(),
    };
    this.bump(`송출: ${this.live.passage.title} [${this.live.index + 1}/${this.live.slides.length}]`);
    return this.getLiveState();
  }

  move(delta) {
    if (!this.live) return { ok: false, reason: 'no-live', state: this.getLiveState() };
    const next = this.live.index + delta;
    if (next < 0 || next >= this.live.slides.length) {
      // 범위 밖: Live 는 그대로 두고 경계에 닿았음을 알린다
      const edge = delta > 0 ? 'end' : 'start';
      this.emit('edge', { edge, live: this.live });
      return { ok: false, reason: edge, state: this.getLiveState() };
    }
    this.live.index = next;
    this.bump(`슬라이드 ${delta > 0 ? '다음' : '이전'}: ${this.live.slides[next].ref} [${next + 1}/${this.live.slides.length}]`);
    return { ok: true, state: this.getLiveState() };
  }

  gotoSlide(i) {
    if (!this.live) return { ok: false, reason: 'no-live' };
    this.live.index = clampIndex(i, this.live.slides.length);
    this.bump(`슬라이드 이동: ${this.live.slides[this.live.index].ref}`);
    return { ok: true, state: this.getLiveState() };
  }

  /**
   * 연속 탐색 모드: Live 범위 끝(또는 처음)에 다음 절 슬라이드를 붙이고 그 슬라이드로 이동.
   * expectVersion 으로 그 사이 Live 가 바뀌었으면 거부한다.
   */
  extendLive({ dir, slides, passage, expectVersion }) {
    if (!this.live) throw new Error('송출 중인 본문이 없습니다.');
    if (expectVersion != null && expectVersion !== this.version) return { ok: false, reason: 'stale', state: this.getLiveState() };
    const s = validateSlides(slides);
    const p = validatePassage(passage);
    if (dir > 0) {
      this.live.slides.push(...s);
      this.live.index = this.live.slides.length - s.length;
    } else {
      this.live.slides.unshift(...s);
      this.live.index = s.length - 1;
    }
    this.live.passage = p;
    this.bump(`연속 이동: ${this.live.slides[this.live.index].ref}`);
    return { ok: true, state: this.getLiveState() };
  }

  clear() {
    if (!this.live || !this.live.visible) return this.getLiveState();
    this.live.visible = false;
    this.bump('출력 숨김');
    return this.getLiveState();
  }

  restore() {
    if (!this.live || this.live.visible) return this.getLiveState();
    this.live.visible = true;
    this.bump(`출력 복원: ${this.live.slides[this.live.index].ref}`);
    return this.getLiveState();
  }

  toggle() {
    if (!this.live) return this.getLiveState();
    return this.live.visible ? this.clear() : this.restore();
  }

  bump(logMsg) {
    this.version++;
    if (logMsg) this.logger?.event(logMsg);
    this.emit('live', this.getLiveState());
  }

  /** 출력 화면과 외부 연동이 쓰는 Live 상태 */
  getLiveState() {
    const l = this.live;
    return {
      version: this.version,
      hasLive: !!l,
      visible: !!(l && l.visible),
      index: l ? l.index : -1,
      count: l ? l.slides.length : 0,
      slide: l ? l.slides[l.index] : null,
      nextSlide: l && l.index + 1 < l.slides.length ? l.slides[l.index + 1] : null,
      passage: l ? l.passage : null,
      // 슬라이드 목록 표시용: 가사 등 이름표가 있으면 '¶이름표', 없으면 장절
      slides: l ? l.slides.map(s => (s.label ? '¶' + s.label : s.ref || s.kind)) : [],
      sentAt: l ? l.sentAt : null,
    };
  }
}

function clampIndex(i, n) {
  i = Number(i) || 0;
  return Math.max(0, Math.min(n - 1, i));
}

module.exports = { Presentation, validateSlides };
