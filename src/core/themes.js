'use strict';
// 구세군 테마 프리셋: 테마마다 예배당 화면(main)과 OBS 자막(overlay) 템플릿 한 쌍
// 색: 레드 쉴드 빨강 #D8102F · 남색 #1E2A57 · 금색 #F2B31B · 크레스트 자주 #6A1E3B
const { makeTemplate } = require('./templates');

const SHIELD = '/shared/assets/sa-shield.png';
const CREST = '/shared/assets/sa-crest.png';
const SERIF = "'Noto Serif KR', '나눔명조', 'NanumMyeongjo', '바탕', 'Batang', serif";

// OBS 하단 자막 공통 뼈대
function lowerThird(patch) {
  return makeTemplate({
    background: { type: 'transparent' }, clearHidesBackground: true,
    valign: 'bottom', align: 'left',
    padding: { top: 640, right: 120, bottom: 60, left: 120 },
    font: { size: 46, minSize: 34, lineHeight: 1.45, weight: 500, color: '#ffffff' },
    reference: { position: 'top', size: 34, align: 'left', color: '#F2B31B' },
    verseNumbers: { show: true, scale: 0.65, color: '#F2B31B' },
    box: { enabled: true, color: '#1E2A57', opacity: 0.92, radius: 12, padding: 30 },
    shadow: { enabled: false },
    ...patch,
  });
}

const THEMES = [
  {
    id: 'sa-redshield', name: '레드 쉴드', desc: '남색 배경 + 빨간 띠 + 레드 쉴드 로고. 주일 예배 기본용',
    main: () => makeTemplate({
      background: { type: 'gradient', color: '#0b1022', gradient: 'linear-gradient(to top, #D8102F 0 14px, transparent 14px), radial-gradient(ellipse at 50% 35%, #1d2a4f 0%, #0b1022 72%)' },
      font: { color: '#ffffff', weight: 500 },
      reference: { color: '#F2B31B' },
      verseNumbers: { color: '#ff6b7d' },
      padding: { top: 140, right: 200, bottom: 140, left: 200 },
      logo: { show: true, image: SHIELD, position: 'top-right', size: 120, margin: 48, opacity: 1 },
    }),
    overlay: () => lowerThird({
      padding: { top: 640, right: 120, bottom: 60, left: 250 },
      box: { enabled: true, color: '#B3001B', opacity: 0.93, radius: 12, padding: 30 },
      reference: { position: 'top', size: 34, align: 'left', color: '#FFE08A' },
      verseNumbers: { show: true, scale: 0.65, color: '#FFE08A' },
      logo: { show: true, image: SHIELD, position: 'bottom-left', size: 150, margin: 70, opacity: 1 },
    }),
  },
  {
    id: 'sa-flag', name: '깃발 (피와 불)', desc: '구세군 깃발 색: 남색 테두리 · 붉은 바탕 · 금색 장절, 크레스트 로고',
    main: () => makeTemplate({
      background: {
        type: 'gradient', color: '#6d0a17',
        gradient: 'linear-gradient(90deg, #1E2A57 0 30px, transparent 30px calc(100% - 30px), #1E2A57 calc(100% - 30px)), linear-gradient(#1E2A57 0 30px, transparent 30px calc(100% - 30px), #1E2A57 calc(100% - 30px)), radial-gradient(circle at 50% 45%, #a5122a 0%, #6d0a17 60%, #3d0610 100%)',
      },
      font: { color: '#ffffff', weight: 500 },
      reference: { color: '#F2B31B', size: 46 },
      verseNumbers: { color: '#F2B31B' },
      padding: { top: 250, right: 200, bottom: 120, left: 200 },
      logo: { show: true, image: CREST, position: 'top-center', size: 160, margin: 50, opacity: 1 },
    }),
    overlay: () => lowerThird({
      logo: { show: true, image: CREST, position: 'bottom-left', size: 150, margin: 60, opacity: 1 },
      padding: { top: 640, right: 120, bottom: 60, left: 250 },
    }),
  },
  {
    id: 'sa-holiness', name: '성결 (밝은 화면)', desc: '밝은 크림색 바탕에 남색 글씨 · 빨간 장절. 낮 예배·밝은 예배당용',
    main: () => makeTemplate({
      background: { type: 'gradient', color: '#f6f1e6', gradient: 'linear-gradient(180deg, #fdfbf6 0%, #efe7d6 100%)' },
      font: { color: '#1E2A57', weight: 500 },
      reference: { color: '#B3001B' },
      verseNumbers: { color: '#B3001B' },
      shadow: { enabled: false },
      padding: { top: 130, right: 200, bottom: 150, left: 200 },
      logo: { show: true, image: SHIELD, position: 'bottom-right', size: 100, margin: 44, opacity: 0.95 },
    }),
    overlay: () => lowerThird({
      font: { size: 46, minSize: 34, lineHeight: 1.45, weight: 500, color: '#1E2A57' },
      reference: { position: 'top', size: 34, align: 'left', color: '#B3001B' },
      verseNumbers: { show: true, scale: 0.65, color: '#B3001B' },
      box: { enabled: true, color: '#ffffff', opacity: 0.94, radius: 12, padding: 30 },
      padding: { top: 640, right: 120, bottom: 60, left: 250 },
      logo: { show: true, image: SHIELD, position: 'bottom-left', size: 150, margin: 70, opacity: 1 },
    }),
  },
  {
    id: 'sa-kettle', name: '자선냄비 (성탄)', desc: '빨간 자선냄비 색과 금색 장절. 성탄·자선냄비 시즌용',
    main: () => makeTemplate({
      background: { type: 'gradient', color: '#7a0a1c', gradient: 'radial-gradient(ellipse at 50% 30%, #d0142f 0%, #8a0b1f 55%, #4d0611 100%)' },
      font: { color: '#ffffff', weight: 500 },
      reference: { color: '#FFD76A' },
      verseNumbers: { color: '#FFD76A' },
      padding: { top: 140, right: 200, bottom: 140, left: 200 },
      logo: { show: true, image: CREST, position: 'top-right', size: 130, margin: 44, opacity: 1 },
    }),
    overlay: () => lowerThird({
      box: { enabled: true, color: '#8a0b1f', opacity: 0.95, radius: 12, padding: 30 },
      reference: { position: 'top', size: 34, align: 'left', color: '#FFD76A' },
      verseNumbers: { show: true, scale: 0.65, color: '#FFD76A' },
      padding: { top: 640, right: 120, bottom: 60, left: 250 },
      logo: { show: true, image: CREST, position: 'bottom-left', size: 150, margin: 60, opacity: 1 },
    }),
  },
  {
    id: 'sa-crest', name: '크레스트 (예식·기념)', desc: '짙은 자주 바탕 · 명조체 · 크레스트 문장. 입대식·기념 예배용',
    main: () => makeTemplate({
      background: { type: 'gradient', color: '#160812', gradient: 'radial-gradient(ellipse at 50% 40%, #3b1530 0%, #160812 80%)' },
      font: { family: SERIF, color: '#f8f1e3', weight: 500, lineHeight: 1.55 },
      reference: { color: '#F2B31B', weight: 700 },
      verseNumbers: { color: '#F2B31B' },
      padding: { top: 270, right: 220, bottom: 110, left: 220 },
      logo: { show: true, image: CREST, position: 'top-center', size: 180, margin: 46, opacity: 1 },
    }),
    overlay: () => lowerThird({
      font: { family: SERIF, size: 46, minSize: 34, lineHeight: 1.45, weight: 500, color: '#f8f1e3' },
      box: { enabled: true, color: '#4a1430', opacity: 0.93, radius: 12, padding: 30 },
      padding: { top: 640, right: 120, bottom: 60, left: 250 },
      logo: { show: true, image: CREST, position: 'bottom-left', size: 150, margin: 60, opacity: 1 },
    }),
  },
];

// ---------------- 방송 스타일 (예배 영상 자막 화면 구성 참고) ----------------
const BOLD = { weight: 700 };
const BROADCAST = [
  {
    id: 'bc-gradient-box', name: '방송형 · 그라데이션 상자', group: '방송 스타일',
    desc: '하단 왼쪽, 남색→자주 그라데이션 둥근 상자에 흰 굵은 글씨. 설교 요점·본문 자막에 많이 쓰는 형태',
    main: () => makeTemplate({
      background: { type: 'gradient', color: '#101c4a', gradient: 'radial-gradient(ellipse at 30% 30%, #2b3f8f 0%, #141f52 55%, #0a1030 100%)' },
      font: { color: '#ffffff', ...BOLD },
      reference: { color: '#d9c2ff' },
      verseNumbers: { color: '#c6b3ff' },
    }),
    overlay: () => makeTemplate({
      background: { type: 'transparent' }, clearHidesBackground: true,
      valign: 'bottom', align: 'left',
      padding: { top: 620, right: 640, bottom: 80, left: 110 },
      font: { size: 48, minSize: 34, lineHeight: 1.45, color: '#ffffff', ...BOLD },
      reference: { position: 'top', size: 32, align: 'left', color: '#e7d8ff' },
      verseNumbers: { show: false },
      box: { enabled: true, radius: 18, padding: 30, gradient: 'linear-gradient(90deg, rgba(22,44,120,0.93) 0%, rgba(58,48,140,0.92) 55%, rgba(118,44,128,0.90) 100%)' },
      shadow: { enabled: false },
    }),
  },
  {
    id: 'bc-clean-lyrics', name: '방송형 · 상자 없는 가사', group: '방송 스타일',
    desc: 'OBS: 상자 없이 그림자 진 흰 굵은 글씨를 화면 아래 가운데에 (찬양 가사용). 예배당: 어두운 바탕 + 왼쪽 보라 띠, 본문 가운데',
    main: () => makeTemplate({
      background: { type: 'gradient', color: '#17141c', gradient: 'linear-gradient(90deg, #3a2a52 0 300px, rgba(255,255,255,0.08) 300px 302px, transparent 302px), radial-gradient(ellipse at 60% 40%, #2c2633 0%, #17141c 75%)' },
      font: { color: '#ffffff', weight: 500, lineHeight: 1.6 },
      padding: { top: 120, right: 160, bottom: 120, left: 380 },
      reference: { color: '#e6dcff', align: 'left', position: 'fixed-top', offset: 70 },
      verseNumbers: { color: '#ffffff', scale: 0.75 },
      verseBreak: true,
    }),
    overlay: () => makeTemplate({
      background: { type: 'transparent' }, clearHidesBackground: true,
      valign: 'bottom', align: 'center',
      padding: { top: 640, right: 160, bottom: 70, left: 160 },
      font: { size: 52, minSize: 36, lineHeight: 1.35, color: '#ffffff', ...BOLD },
      reference: { position: 'bottom', size: 26, align: 'right', color: '#dddddd' },
      verseNumbers: { show: false },
      stroke: { width: 0, color: '#000000' },
      shadow: { enabled: true, blur: 12, x: 0, y: 3, color: 'rgba(0,0,0,0.95)' },
    }),
  },
  {
    id: 'bc-full-band', name: '방송형 · 전체 폭 하단 띠', group: '방송 스타일',
    desc: '화면 아래를 가로로 꽉 채우는 짙은 남청색 반투명 띠, 왼쪽 정렬. 뉴스·중계 방송 같은 느낌',
    main: () => makeTemplate({
      background: { type: 'gradient', color: '#0b3a7a', gradient: 'linear-gradient(180deg, #1f6fd1 0%, #0d47a1 55%, #0a2f6b 100%)' },
      font: { color: '#ffffff', weight: 500 },
      reference: { color: '#bfe3ff' },
      verseNumbers: { color: '#bfe3ff' },
    }),
    overlay: () => makeTemplate({
      background: { type: 'transparent' }, clearHidesBackground: true,
      valign: 'bottom', align: 'left',
      padding: { top: 700, right: 0, bottom: 40, left: 0 },
      font: { size: 42, minSize: 32, lineHeight: 1.4, color: '#ffffff', weight: 500 },
      reference: { position: 'top', size: 30, align: 'left', color: '#8fd3ff' },
      verseNumbers: { show: false },
      box: { enabled: true, radius: 0, padding: 26, gradient: 'linear-gradient(90deg, rgba(8,34,64,0.88) 0%, rgba(14,52,86,0.82) 100%)' },
      shadow: { enabled: false },
    }),
  },
  {
    id: 'bc-white-card', name: '방송형 · 흰 카드', group: '방송 스타일',
    desc: '하단의 흰 반투명 둥근 카드에 남색 글씨, 보라색 장절. 밝고 깔끔한 본문 자막',
    main: () => makeTemplate({
      background: { type: 'gradient', color: '#f3f1f8', gradient: 'linear-gradient(180deg, #ffffff 0%, #ece8f5 100%)' },
      font: { color: '#1f2340', weight: 500 },
      reference: { color: '#6a3fa0' },
      verseNumbers: { color: '#8a63c4' },
      shadow: { enabled: false },
    }),
    overlay: () => makeTemplate({
      background: { type: 'transparent' }, clearHidesBackground: true,
      valign: 'bottom', align: 'left',
      padding: { top: 640, right: 50, bottom: 40, left: 50 },
      font: { size: 42, minSize: 32, lineHeight: 1.45, color: '#1f2340', weight: 700 },
      reference: { position: 'top', size: 30, align: 'left', color: '#6a3fa0' },
      verseNumbers: { show: true, scale: 0.65, color: '#8a63c4' },
      box: { enabled: true, color: '#ffffff', opacity: 0.9, radius: 18, padding: 28 },
      shadow: { enabled: false },
    }),
  },
  {
    id: 'bc-compact-center', name: '방송형 · 가운데 작은 상자', group: '방송 스타일',
    desc: '화면 아래 가운데의 작고 짙은 자주색 상자. 화면(설교자)을 가리지 않는 간결한 자막',
    main: () => makeTemplate({
      background: { type: 'gradient', color: '#2a0d16', gradient: 'radial-gradient(ellipse at 50% 35%, #5a1a2c 0%, #2a0d16 70%, #14060b 100%)' },
      font: { color: '#ffffff', weight: 500 },
      reference: { color: '#f2c47a' },
      verseNumbers: { color: '#f2c47a' },
    }),
    overlay: () => makeTemplate({
      background: { type: 'transparent' }, clearHidesBackground: true,
      valign: 'bottom', align: 'center',
      padding: { top: 700, right: 420, bottom: 70, left: 420 },
      font: { size: 38, minSize: 28, lineHeight: 1.4, color: '#ffffff', weight: 500 },
      reference: { position: 'top', size: 28, align: 'center', color: '#f2c47a' },
      verseNumbers: { show: false },
      box: { enabled: true, color: '#4a1222', opacity: 0.9, radius: 6, padding: 20 },
      shadow: { enabled: false },
    }),
  },
];
THEMES.push(...BROADCAST);

function listThemes() {
  return THEMES.map(t => ({ id: t.id, name: t.name, desc: t.desc, group: t.group || '구세군', main: buildOne(t, 'main'), overlay: buildOne(t, 'overlay') }));
}

function buildOne(theme, output) {
  const tpl = theme[output]();
  tpl.id = `theme-${theme.id}-${output}`;
  tpl.name = `${theme.name} · ${output === 'main' ? '예배당' : 'OBS 자막'}`;
  tpl.preset = true;
  tpl.theme = theme.id;
  return tpl;
}

module.exports = { listThemes, THEMES, buildOne };
