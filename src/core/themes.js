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

function listThemes() {
  return THEMES.map(t => ({ id: t.id, name: t.name, desc: t.desc, main: buildOne(t, 'main'), overlay: buildOne(t, 'overlay') }));
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
