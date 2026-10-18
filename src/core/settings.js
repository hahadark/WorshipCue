'use strict';
// Settings Manager: JSON 파일 자동 저장(원자적 쓰기 + 백업)

const fs = require('fs');
const path = require('path');
const { defaultTemplates, normalizeTemplate } = require('./templates');

const DEFAULT_SHORTCUTS = {
  focusSearch: 'Ctrl+K',
  sendNow: 'Ctrl+Enter',
  prevSlide: 'F5',
  nextSlide: 'F6',
  sendPreview: 'F9',
  toggleClear: 'F10',
  openBooks: 'Ctrl+B',
  openHistory: 'Ctrl+H',
  previewPrevSlide: 'PageUp',
  previewNextSlide: 'PageDown',
  previewPrevVerse: 'Alt+ArrowLeft',
  previewNextVerse: 'Alt+ArrowRight',
  previewChapterStart: 'Ctrl+Home',
  toggleOutputWindow: 'Ctrl+Shift+F',
  outputOff: 'Escape',
  cuePrev: 'Ctrl+ArrowUp',
  cueNext: 'Ctrl+ArrowDown',
  cueEdit: 'F2',
  toggleEditor: 'Ctrl+Shift+E',
};

const SHORTCUT_LABELS = {
  focusSearch: '검색창으로 이동',
  sendNow: '선택한 본문 즉시 송출',
  prevSlide: '이전 슬라이드 (Live)',
  nextSlide: '다음 슬라이드 (Live)',
  sendPreview: '현재 미리보기 송출',
  toggleClear: '출력 숨김·복원',
  openBooks: '성경 책 목록',
  openHistory: '송출 기록',
  previewPrevSlide: '미리보기 이전 슬라이드',
  previewNextSlide: '미리보기 다음 슬라이드',
  previewPrevVerse: '미리보기 이전 절',
  previewNextVerse: '미리보기 다음 절',
  previewChapterStart: '미리보기 현재 장 처음으로',
  toggleOutputWindow: '보조 화면 출력 켜기·끄기',
  outputOff: '보조 화면 출력 끄기',
  cuePrev: '큐시트 이전 순서 미리보기',
  cueNext: '큐시트 다음 순서 미리보기',
  cueEdit: '선택한 순서 편집',
  toggleEditor: '편집칸 보이기·숨기기',
};

function defaults() {
  return {
    schema: 1,
    port: 37528,
    versionId: '',
    searchMode: 'auto', // auto | reference | text
    split: { mode: 'auto', count: 2 }, // auto | count (count=1 이면 한 절씩)
    navMode: 'range', // range: 선택 범위 안에서만 | continuous: 범위 끝에서 다음 절로 이어감(책 경계에서 멈춤)
    output: { enabled: false, displayId: null, cursorHidden: true, autoOnSend: true, linkObs: true },
    templates: defaultTemplates(),
    activeTemplates: { main: 'worship', overlay: 'overlay' },
    shortcuts: { ...DEFAULT_SHORTCUTS },
    globalShortcuts: false,
    reservedKeys: '', // OBS 등 다른 프로그램에서 쓰는 단축키(충돌 검사용), 쉼표 구분
    history: [],
    guide: { bethlehemDone: false },
    activeCueId: '',     // 열어 둔 큐시트
    cueAdvance: true,    // 항목의 마지막 슬라이드에서 F6 → 다음 순서로
    hymnFolders: [],     // [{ name, path }] 찬송가·교독문 .pps 폴더
    hymnBackground: 'original', // 찬송가 배경 기본값: original(파일의 배경) | template(템플릿 배경) | #ffffff | 이미지 주소
    songSearchUrl: 'https://cwy0675.tistory.com/search/{q}', // 온라인에서 찾기: {q} = 검색어
    songDownloadDir: '', // 지켜볼 다운로드 폴더 (비우면 Windows 다운로드 폴더)
    imageFolders: [],    // [{ name, path }] 라이브러리 이미지 폴더
    ui: { theme: 'dark', scale: 100 }, // 조작 화면 테마·글자 크기 (송출 디자인과 별개)
    droppedFiles: [],
    uiLang: 'ko',        // 화면 언어 ('ko' 한국어 · 'en' English)
    cueTimes: false,     // 예배 진행 시계 (⏰ 시작 시각 · 순서별 예정 시간) 쓰기 — 기본 끔 (큐시트 메뉴에서 켬)
    cueTimesV2: true,    // 예전 기본값(켬)을 한 번 끈 표시
    cameras: {},         // 카메라마다 세부 설정 { deviceId: { res, fps, exact, mirror, brightness, contrast, saturation } }
    triggerKey: '',      // 스트림덱·외부 단추용 주소의 열쇠 (처음 쓸 때 만든다)
    parallelVersionId: '', // 병행 번역본 (두 번역 함께 송출, '' = 안 함)    // 바깥에서 끌어다 놓은 파일 (등록 폴더 밖이어도 열 수 있게, 최근 500개)
    audioFolders: [],    // [{ name, path }] 라이브러리 음악 폴더
    overlays: [],
    ai: { model: '', keyEnc: '', key: '' }, // AI 주보 → 큐시트 (오픈라우터). 키는 Windows 보호 기능으로 암호화해 keyEnc 에
    remote: { enabled: false, pin: '', port: 37540 }, // 휴대폰 리모컨 (같은 Wi-Fi, PIN)
    logoScreenImage: '',  // '로고 화면' 단추에 쓸 그림 (비우면 템플릿 로고 → 레드 쉴드)        // 출력 위에 겹치는 층 (로고·시계·카운트다운·배너·글자)
    previewMode: true,   // false = 미리보기 끔: 클릭한 본문·순서를 바로 송출 (OBS 스튜디오 모드 끄기)
    dockLayout: '',      // 조작 화면 독 배치 (dockview JSON)
    workspaces: [],      // 저장한 작업공간 [{ id, name, layout }] (dockview JSON)
    activeWorkspace: 'b-default', // 지금 작업공간 (b-… = 기본 제공)
    dockLocked: false,   // 독 배치 잠금
    bethlehemDir: '',    // 베들레헴 BethlehemWin 폴더 (새찬송가 가사 DB). 비우면 자동으로 찾는다
    songInboxDir: '',    // 받은 찬양 PPT 를 모아 둘 폴더 (비우면 문서\WorshipCue 찬양 PPT)
  };
}

function deepMergeDefaults(def, val) {
  if (val === undefined || val === null) return def;
  if (typeof def !== 'object' || def === null || Array.isArray(def)) return val;
  const out = { ...def };
  for (const k of Object.keys(val)) out[k] = k in def ? deepMergeDefaults(def[k], val[k]) : val[k];
  return out;
}

class Settings {
  constructor(dir, logger, { uiLang } = {}) {
    this.dir = dir;
    this.firstLang = uiLang; // 처음 실행(설정 파일 없음)일 때의 화면 언어 (영어판 = 'en')
    this.file = path.join(dir, 'settings.json');
    this.backup = path.join(dir, 'settings.backup.json');
    this.logger = logger;
    this.timer = null;
    this.data = this.load();
  }

  load() {
    for (const f of [this.file, this.backup]) {
      try {
        if (!fs.existsSync(f)) continue;
        const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
        const data = deepMergeDefaults(defaults(), raw);
        data.shortcuts = { ...DEFAULT_SHORTCUTS, ...(raw.shortcuts || {}) };
        if (!raw.cueTimesV2) { data.cueTimes = false; data.cueTimesV2 = true; } // 시계는 기본 끔으로 바뀜: 예전 설정도 한 번 끈다
        data.templates = (Array.isArray(raw.templates) && raw.templates.length ? raw.templates : defaultTemplates()).map(normalizeTemplate);
        if (f === this.file) {
          try { fs.copyFileSync(f, this.backup); } catch { /* 백업 실패는 무시 */ }
        } else {
          this.logger?.warn('설정 파일이 손상되어 백업에서 복구했습니다.');
        }
        return data;
      } catch (e) {
        this.logger?.error(`설정 읽기 실패 (${path.basename(f)}): ${e.message}`);
      }
    }
    const d = defaults();
    if (this.firstLang === 'en') d.uiLang = 'en';
    return d;
  }

  get() { return this.data; }

  /** 변경 후 자동 저장(디바운스) */
  update(mutator) {
    mutator(this.data);
    this.scheduleSave();
  }

  scheduleSave() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 250);
  }

  saveNow() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      const fd = fs.openSync(tmp, 'w');
      fs.writeSync(fd, JSON.stringify(this.data, null, 2));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fs.renameSync(tmp, this.file);
    } catch (e) {
      this.logger?.error('설정 저장 실패: ' + e.message);
    }
  }
}

module.exports = { Settings, DEFAULT_SHORTCUTS, SHORTCUT_LABELS, defaults };
