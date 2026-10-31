'use strict';
// 큐시트(예배 순서) 항목 정의와 검증
//   bible  성경      { ref, versionId? }
//   song   찬양      { lyrics, showTitle?, credit? }   가사는 빈 줄로 슬라이드 구분, [1절] 같은 줄은 표시하지 않음
//   text   공지·글    { body }                         --- 줄로 슬라이드 구분
//   title  제목 카드  { subtitle }                     예: 대표기도 / 홍길동 집사
//   image  이미지     { image }
//   blank  빈 화면    { mode: 'black' | 'background' }
// 공통: id, type, title, note(조작자 메모)

const { normalizeEdits } = require('./slideedit');

const TYPES = ['bible', 'song', 'text', 'title', 'image', 'blank', 'hymn', 'audio', 'video', 'slideshow', 'camera'];
const TYPE_NAMES = { bible: '성경', song: '찬양', text: '공지', title: '제목', image: '이미지', blank: '빈 화면', hymn: '찬송가', audio: '음악', video: '영상', slideshow: '슬라이드쇼', camera: '카메라' };

const str = (v, max = 20000) => String(v ?? '').slice(0, max);

function newId(prefix = 'i') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalizeItem(x) {
  if (!x || !TYPES.includes(x.type)) throw new Error('알 수 없는 항목 종류입니다.');
  const it = { id: /^[a-z0-9]{4,40}$/i.test(x.id || '') ? x.id : newId(), type: x.type, title: str(x.title, 200).trim(), note: str(x.note, 1000) };
  switch (x.type) {
    case 'bible': it.ref = str(x.ref, 200).trim(); it.versionId = str(x.versionId, 40); break;
    case 'song': it.lyrics = str(x.lyrics); it.showTitle = !!x.showTitle; it.credit = str(x.credit, 300); it.creditShow = ['first', 'last', 'both'].includes(x.creditShow) ? x.creditShow : ''; it.songId = str(x.songId, 60); it.order = str(x.order, 300); break;
    case 'video': it.file = str(x.file, 1500); it.volume = Math.max(0, Math.min(1, Number(x.volume ?? 1) || 0)); it.sound = x.sound !== false; it.loop = !!x.loop; it.endAction = ['hold', 'black', 'next'].includes(x.endAction) ? x.endAction : 'hold'; break;
    case 'audio': it.file = str(x.file, 1500); it.volume = Math.max(0, Math.min(1, Number(x.volume ?? 1) || 0)); it.loop = !!x.loop; it.fadeOnLeave = x.fadeOnLeave !== false; break;
    case 'text': it.body = str(x.body); if (x.roleLabels) it.roleLabels = true; break; // roleLabels: 교독문 역할 이름(인도자:·회중:)도 화면에
    case 'title': it.subtitle = str(x.subtitle, 300); it.more = str(x.more, 20000); break; // more = 추가 슬라이드
    case 'image': it.image = str(x.image, 300); break;
    case 'blank': it.mode = x.mode === 'background' ? 'background' : 'black'; break;
    case 'camera': // 카메라 화면 (웹캠·캡처보드) 가득
      it.deviceId = str(x.deviceId, 200); it.label = str(x.label, 100); it.fit = x.fit === 'contain' ? 'contain' : 'cover';
      break;
    case 'slideshow': // 예배 전 화면: 그림·광고 글을 자동으로 넘기며 반복 (+ 배경 음악 · 카운트다운)
      it.images = (Array.isArray(x.images) ? x.images : []).slice(0, 200).map(u => str(u, 1500)).filter(Boolean);
      it.body = str(x.body);
      it.countdown = /^\d{1,2}:\d{2}$/.test(x.countdown || '') ? x.countdown : '';
      it.countdownLabel = str(x.countdownLabel, 60);
      break;
    case 'hymn':
      it.file = str(x.file, 1000); it.number = Number.isFinite(+x.number) ? +x.number : null;
      it.background = str(x.background, 300) || 'default'; // default(설정 기본값) | original | template | 이미지 주소
      it.obsLyrics = str(x.obsLyrics); // OBS 자막(가사만) 직접 입력: 슬라이드마다 빈 줄로 구분. 비우면 자동
      { const m = /^\s*(\d{1,3})\s*(?:[-~]\s*(\d{1,3}))?\s*$/.exec(String(x.range || '')); if (m) { const a = +m[1], b = +(m[2] || m[1]); if (a >= 1) it.range = `${Math.min(a, b)}-${Math.max(a, b)}`; } } // 슬라이드 범위 (한 PPT 를 여러 순서로)
      break;
  }
  // 순서별 배경 이미지·템플릿 (글자 순서)
  if (['song', 'text', 'title', 'bible'].includes(x.type)) it.bg = str(x.bg, 1500);
  // 슬라이드 편집 (글상자 위치·꾸미기·덧붙인 글·그림·도형)
  if (x.type !== 'audio') { const e = normalizeEdits(x.edits); if (e) it.edits = e; }
  // 성경·찬송가·그림·영상·슬라이드쇼·카메라·빈 화면: 사이에 덧붙인 제목 카드(extra) · 건너뛸 슬라이드(skip)
  if (!['song', 'text', 'title', 'audio'].includes(x.type)) {
    const extra = (Array.isArray(x.extra) ? x.extra : []).slice(0, 200).map(e => ({ id: /^[a-z0-9]{1,16}$/i.test(e && e.id || '') ? e.id : newId('').slice(0, 12), at: Math.max(-1, Math.min(999, Math.round(Number(e && e.at)) || 0)), text: str(e && e.text, 2000) })).filter(e => e.text.trim());
    if (extra.length) it.extra = extra;
    const skip = [...new Set((Array.isArray(x.skip) ? x.skip : []).map(n => Math.round(Number(n))).filter(n => n >= 0 && n < 1000))].sort((a, b) => a - b);
    if (skip.length) it.skip = skip;
  }
  it.duration = Math.max(0, Math.min(600, Number(x.duration) || 0)); // 예정 시간(분), 0 = 정하지 않음
  // 송출할 때 자동으로 (배경 음악 · 타이머 · 무대 메시지 · 로고 화면 · 배경 · 오버레이 · 음악 멈춤)
  if (x.type !== 'audio') {
    it.music = str(x.music, 1500);
    it.musicVolume = Math.max(0, Math.min(1, Number(x.musicVolume ?? 0.8) || 0));
    const a = x.actions && typeof x.actions === 'object' ? x.actions : {};
    const act = {};
    const tm = Math.round(Number(a.timer) || 0); if (tm > 0) act.timer = Math.min(240, tm);
    if (a.stageMsg) act.stageMsg = str(a.stageMsg, 200);
    if (['on', 'off'].includes(a.logo)) act.logo = a.logo;
    if (['hide', 'show'].includes(a.bg)) act.bg = a.bg;
    if (a.ovOn) act.ovOn = str(a.ovOn, 60);
    if (a.ovOff) act.ovOff = str(a.ovOff, 60);
    if (a.stopMusic) act.stopMusic = true;
    if (a.clearStage) act.clearStage = true;
    if (a.companion) { const loc = require('./companion').parseLocations(a.companion).map(l => `${l.page}/${l.row}/${l.col}`).join(', '); if (loc) act.companion = loc; } // Companion 단추 (페이지/줄/칸)
    if (a.stagePin) act.stagePin = str(a.stagePin, 40); // 무대 화면 고정: live(풀기) · order(순서표) · 프리셋 id
    if (a.obsScene) act.obsScene = str(a.obsScene, 120); // OBS 장면 바꾸기
    if (['start', 'stop'].includes(a.obsStream)) act.obsStream = a.obsStream; // OBS 방송 시작·끝
    if (['start', 'stop'].includes(a.obsRecord)) act.obsRecord = a.obsRecord; // OBS 녹화 시작·끝
    if (Object.keys(act).length) it.actions = act;
  }
  // 자동 넘김: N초마다 다음 슬라이드, 반복이면 끝에서 처음으로 (슬라이드쇼는 기본 8초·반복)
  if (x.type !== 'audio' && x.type !== 'video') {
    const sec = Math.round(Number(x.autoSec ?? (x.type === 'slideshow' ? 8 : 0)) || 0);
    it.autoSec = sec >= 2 ? Math.min(3600, sec) : 0;
    it.autoLoop = x.autoLoop === undefined ? x.type === 'slideshow' : !!x.autoLoop;
    // 글자 자동 숨김 (N초 뒤) · 처음·끝에서 한 번 더 누르면 숨김
    const hide = Math.round(Number(x.hideAfter) || 0);
    if (hide >= 1) it.hideAfter = Math.min(3600, hide);
    if (x.edgeHide) it.edgeHide = true;
  }
  it.tplMain = str(x.tplMain, 80);
  it.tplOverlay = str(x.tplOverlay, 80);
  if (!it.title) it.title = TYPE_NAMES[x.type];
  return it;
}

function normalizeCue(c) {
  if (!c || !String(c.name || '').trim()) throw new Error('큐시트 이름을 입력하세요.');
  return {
    id: /^[a-z0-9]{4,40}$/i.test(c.id || '') ? c.id : newId('c'),
    name: str(c.name, 200).trim(),
    serviceDate: /^\d{4}-\d{2}-\d{2}$/.test(c.serviceDate || '') ? c.serviceDate : '',
    startTime: /^\d{1,2}:\d{2}$/.test(c.startTime || '') ? c.startTime : '', // 예배 시작 시각 (진행 시계)
    memo: str(c.memo, 1000), // 큐시트 메모 (관리 창)
    pinned: !!c.pinned, // 맨 위에 고정
    template: !!c.template, // 서식: 새 큐시트의 바탕으로 쓰기
    items: (Array.isArray(c.items) ? c.items : []).slice(0, 500).map(normalizeItem),
  };
}

/** 새 큐시트 기본 순서 (구세군 성결예배 예시) */
function sampleItems(lang = 'ko') {
  if (lang === 'en') {
    return [
      { type: 'title', title: 'Call to Worship', subtitle: '' },
      { type: 'song', title: 'Praise', lyrics: '' },
      { type: 'title', title: 'Prayer', subtitle: '' },
      { type: 'bible', title: 'Scripture Reading', ref: 'Ps 23' },
      { type: 'title', title: 'Sermon', subtitle: '' },
      { type: 'text', title: 'Announcements', body: '' },
      { type: 'title', title: 'Benediction', subtitle: '' },
      { type: 'blank', title: 'Blank', mode: 'background' },
    ].map(x => ({ ...x, id: newId() }));
  }
  return [
    { type: 'title', title: '예배로 부름', subtitle: '' },
    { type: 'song', title: '찬양', lyrics: '' },
    { type: 'title', title: '대표기도', subtitle: '' },
    { type: 'bible', title: '성경 봉독', ref: '시 23' },
    { type: 'title', title: '설교', subtitle: '' },
    { type: 'text', title: '광고', body: '' },
    { type: 'title', title: '축도', subtitle: '' },
    { type: 'blank', title: '빈 화면', mode: 'background' },
  ].map(x => ({ ...x, id: newId() }));
}

module.exports = { TYPES, TYPE_NAMES, normalizeItem, normalizeCue, newId, sampleItems };
