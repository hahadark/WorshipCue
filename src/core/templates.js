'use strict';
// 기본 출력 템플릿(프리셋). 좌표·크기는 모두 템플릿 해상도(width×height) 기준 px.

const FONT_SANS = "'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif";

function base() {
  return {
    id: '', name: '', preset: false,
    width: 1920, height: 1080,
    safeArea: 0, // 화면 가장자리 안전영역(%)
    background: { type: 'color', color: '#000000', image: '', imageFit: 'cover', dim: 0 },
    clearHidesBackground: false, // 숨김(Clear) 시 배경까지 숨길지
    font: { family: FONT_SANS, size: 72, minSize: 44, autoFit: true, weight: 500, color: '#ffffff', lineHeight: 1.5, letterSpacing: 0 },
    align: 'center', valign: 'middle',
    padding: { top: 120, right: 160, bottom: 120, left: 160 },
    verseNumbers: { show: true, color: '#9ec5ff', scale: 0.6 },
    verseBreak: false, // 절마다 줄바꿈
    // position: top|bottom(본문에 붙음) · fixed-top|fixed-bottom(화면 가장자리 고정, offset=가장자리에서 거리)
    // mode: slide(슬라이드마다 그 범위) · passage(전체 범위 고정)
    reference: { show: true, position: 'top', size: 44, color: '#ffd479', weight: 700, align: 'center', mode: 'slide', offset: 60 },
    versionLabel: { show: false, size: 28, color: '#bbbbbb' },
    headings: { show: false, size: 36, color: '#cccccc' },
    box: { enabled: false, color: '#000000', opacity: 0.6, radius: 16, padding: 32 },
    stroke: { width: 0, color: '#000000' },
    shadow: { enabled: true, blur: 8, x: 0, y: 3, color: 'rgba(0,0,0,0.8)' },
    animation: { type: 'dissolve', duration: 400 }, // dissolve(디졸브: 새 화면이 이전 화면 위로 서서히) | cut(컷: 바로 바뀜)
    // PPT·찬송가 슬라이드를 이 출력에서 어떻게: image(그림 그대로) | lyrics(가사 글자만, 템플릿 위치에) | ''(자동: 투명 배경이면 가사만)
    pptMode: '',
    // 로고 층 (배경과 함께 고정 표시). position: top-left|top-center|top-right|bottom-left|bottom-right
    logo: { show: false, image: '', position: 'top-right', size: 120, opacity: 1, margin: 40 },
  };
}

function merge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') merge(target[k], v);
    else target[k] = v;
  }
  return target;
}

function make(patch) {
  return merge(base(), patch);
}

const PRESETS = [
  make({ id: 'worship', name: '일반 예배', preset: true }),
  make({
    id: 'sermon-lower', name: '설교 송출 (하단 자막)', preset: true,
    background: { type: 'transparent' },
    clearHidesBackground: true,
    valign: 'bottom', align: 'left',
    padding: { top: 640, right: 120, bottom: 70, left: 120 },
    font: { size: 46, minSize: 34, lineHeight: 1.45, weight: 500 },
    reference: { position: 'top', size: 34, align: 'left', color: '#ffd479' },
    verseNumbers: { show: true, scale: 0.65 },
    box: { enabled: true, color: '#000000', opacity: 0.65, radius: 14, padding: 30 },
    shadow: { enabled: false },
  }),
  make({
    id: 'reading', name: '성경 봉독 (큰 글씨)', preset: true,
    font: { size: 92, minSize: 64, weight: 700, lineHeight: 1.45 },
    padding: { top: 100, right: 120, bottom: 100, left: 120 },
    reference: { size: 48 },
  }),
  make({
    id: 'overlay', name: '투명 출력 (OBS 자막)', preset: true,
    background: { type: 'transparent' },
    clearHidesBackground: true,
    valign: 'bottom', align: 'center',
    padding: { top: 700, right: 160, bottom: 60, left: 160 },
    font: { size: 44, minSize: 32, lineHeight: 1.4, weight: 700 },
    reference: { position: 'bottom', size: 30, align: 'center' },
    verseNumbers: { show: false },
    stroke: { width: 2, color: '#000000' },
    shadow: { enabled: true, blur: 10, x: 0, y: 2, color: 'rgba(0,0,0,0.9)' },
  }),
  make({ id: 'custom', name: '사용자 설정', preset: false }),
];

function defaultTemplates() {
  return JSON.parse(JSON.stringify(PRESETS));
}

/** 저장된 템플릿에 새 버전의 기본 필드를 채워 넣는다 */
function normalizeTemplate(t) {
  const out = merge(base(), JSON.parse(JSON.stringify(t)));
  // 예전 값: fade → 디졸브, none → 컷
  if (out.animation.type === 'fade') out.animation.type = 'dissolve';
  if (out.animation.type !== 'dissolve') out.animation.type = 'cut';
  if (!['', 'image', 'lyrics'].includes(out.pptMode)) out.pptMode = '';
  return out;
}

module.exports = { defaultTemplates, normalizeTemplate, mergeDeep: merge, makeTemplate: make };
