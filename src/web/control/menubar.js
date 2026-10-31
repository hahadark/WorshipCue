/* 상단 메뉴바: 파일 · 큐시트 · 송출 · 보기 · 도구 · 도움말 (하는 일 순서대로, 긴 목록은 ▸ 하위 메뉴)
 * 메뉴 항목은 기존 단추·기능을 그대로 부른다 (같은 동작). 아이콘은 BCIcon(Lucide) 한 벌로.
 *   파일   = 큐시트 문서 · 가져오기 · 기록 · 백업 · 설정
 *   큐시트 = 열린 큐시트를 고치는 일 (되돌리기 · 순서 넣기 · 고른 순서)
 *   송출   = 예배 중에 하는 일 (송출 · 넘기기 · 지우기 · 배경 · 출력 화면)
 *   보기   = 패널 · 슬라이드 보기 · 작업공간 · 테마 · 언어
 *   도구   = 바깥 기기 (리모컨 · 스트림덱) · 라이브러리 바로 가기
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const I = n => (window.BCIcon ? window.BCIcon(n) : '');
  const click = sel => () => { const el = $(sel); if (el) el.click(); };
  const act = name => () => app.runAction && app.runAction(name);
  const add = type => () => { const b = $(`#cueAdd [data-add="${type}"]`); if (b) b.click(); };
  // 라이브러리 패널을 연 뒤(배치가 잡힌 뒤) 탭을 바꾼다
  const lib = tab => () => { if (window.BCDock) window.BCDock.show('library'); setTimeout(() => window.BCLib && window.BCLib.show(tab), 120); };
  const settings = tab => () => window.BCSettings && window.BCSettings.open(tab);
  const ed = a => () => { const b = $(`#cueEditor [data-act="${a}"]`); if (b) b.click(); else app.showMsg('큐시트에서 순서를 먼저 고르세요.', 'info', 1500); };
  const panel = id => ({ label: () => (window.BCDock && window.BCDock.isOpen(id) ? '✓ ' : '　') + window.BCDock.panels.find(p => p.id === id).title, run: () => (window.BCDock.isOpen(id) ? window.BCDock.hide(id) : window.BCDock.show(id)) });
  const link = url => () => app.cmd('openLink', { url });

  /** 고른 순서(또는 미리보기 슬라이드)의 슬라이드 편집 */
  const slideEdit = () => { const p = app.preview; if (!window.BCSlideEdit) return; if (p && p.cue) window.BCSlideEdit.openPreviewSlide(p.index); else if (window.BCCue && window.BCCue.selIndex() >= 0) window.BCSlideEdit.open(window.BCCue.selIndex()); else app.showMsg('큐시트에서 찬양·공지·제목 순서를 고르세요.', 'info', 2000); };
  const undo = redo => () => { if (!window.BCCue || window.BCCue.undo(redo) === false) app.showMsg(redo ? '다시 실행할 것이 없습니다.' : '되돌릴 것이 없습니다.', 'info', 1200); };
  const on = (cond, label) => (cond ? '✓ ' : '　') + label;
  const H = head => ({ head }); // 작은 제목
  const txt = (sel, dflt) => { const el = $(sel); return el ? el.textContent : dflt; };

  // 메뉴마다 10줄 안팎. 긴 목록은 옆으로 펼치는 하위 메뉴(sub) 로. 같은 기능은 한 곳에만.
  const MENUS = [
    ['파일', [
      { ic: 'folder-open', label: '큐시트 열기 · 새로 만들기 · 관리…', run: click('#cueMenu') },
      { ic: 'clipboard-paste', label: '주보 순서 붙여 넣기 → 큐시트…', run: () => window.BCAI && window.BCAI.open() },
      { ic: 'globe', label: '홈페이지 주보 → 큐시트 · 광고…', run: () => window.BCHome && window.BCHome.open() },
      '-',
      { ic: 'download', label: '가져오기', sub: [
        { ic: 'music', label: '찬양 (OpenLP · ChordPro · ProPresenter · PPT)…', run: () => { lib('songs')(); setTimeout(() => { const b = document.querySelector('#panelLibrary [data-import]'); if (b) b.click(); }, 300); } },
        { ic: 'book-open', label: '성경 번역본…', run: settings('data') },
      ] },
      '-',
      { ic: 'history', label: '송출 기록', key: 'Ctrl+H', run: act('openHistory') },
      { ic: 'chart-column', label: '사용 기록 (저작권 보고)…', run: () => window.BCUsage && window.BCUsage.open() },
      { ic: 'refresh-cw', label: '여러 PC 동기화 · 자동 백업…', run: settings('data') },
      '-',
      { ic: 'settings', label: '설정…', key: 'Ctrl+,', run: settings() },
    ]],
    ['큐시트', [
      { ic: 'undo-2', label: '실행 취소', key: 'Ctrl+Z', run: undo(false) },
      { ic: 'redo-2', label: '다시 실행', key: 'Ctrl+Y', run: undo(true) },
      '-',
      { ic: 'plus', label: '순서 넣기 (고른 순서 다음에)', sub: [
        { ic: 'music-2', label: '찬송가·PPT', run: add('hymn') }, { ic: 'book-open', label: '성경', run: add('bible') }, { ic: 'music', label: '찬양', run: add('song') }, { ic: 'globe', label: '웹에서 가사 찾아 찬양 넣기…', key: 'Ctrl+L', run: () => window.BCCue && window.BCCue.webLyrics() },
        { ic: 'megaphone', label: '공지', run: add('text') }, { ic: 'tag', label: '제목', run: add('title') },
        '-',
        { ic: 'image', label: '이미지', run: add('image') }, { ic: 'clapperboard', label: '영상', run: add('video') }, { ic: 'volume-2', label: '음악', run: add('audio') },
        { ic: 'images', label: '슬라이드쇼 (예배 전 화면)', run: add('slideshow') }, { ic: 'camera', label: '카메라', run: add('camera') }, { ic: 'square', label: '빈 화면', run: add('blank') },
        '-',
        { ic: 'presentation', label: '설교 포인트 슬라이드 (원고에서 대지 뽑기)…', run: () => window.BCPoints && window.BCPoints.open() },
        { ic: 'images', label: '예배 전 화면 자동 만들기 (말씀카드 · QT 본문)…', run: () => window.BCPreService && window.BCPreService.open() },
      ] },
      H('고른 순서'),
      { ic: 'pencil', label: '편집칸에서 고치기', key: 'F2', run: act('cueEdit') },
      { ic: 'square-pen', label: '슬라이드 편집 (글상자·그림·도형)', key: 'Ctrl+E', run: slideEdit },
      { ic: 'arrow-up', label: '위로', key: 'Alt+↑', run: ed('up') }, { ic: 'arrow-down', label: '아래로', key: 'Alt+↓', run: ed('down') },
      { ic: 'copy', label: '복제', run: ed('dup') }, { ic: 'trash-2', label: '지우기', key: 'Delete', run: ed('del') },
      '-',
      { label: () => on(window.BCCue && window.BCCue.editorOn(), '편집칸 보이기'), key: 'Ctrl+Shift+E', run: act('toggleEditor') },
      { label: () => on(window.BCCue && window.BCCue.timesOn(), '예배 진행 시계'), run: () => window.BCCue && window.BCCue.setTimes(!window.BCCue.timesOn()) },
    ]],
    ['송출', [
      { ic: 'play', label: '송출', key: 'F9', run: act('sendPreview') },
      { ic: 'skip-forward', label: '다음 슬라이드', key: 'F6', run: act('nextSlide') }, { ic: 'skip-back', label: '이전 슬라이드', key: 'F5', run: act('prevSlide') },
      { ic: 'chevrons-down', label: '다음 순서 미리보기', key: 'Ctrl+↓', run: act('cueNext') }, { ic: 'chevrons-up', label: '이전 순서 미리보기', key: 'Ctrl+↑', run: act('cuePrev') },
      { ic: 'text', label: '즉석 자막 (글을 써서 바로 송출)…', key: 'Ctrl+T', run: act('quickText') },
      { ic: 'megaphone', label: '회중 메시지 (유아실 호출 · 차량 이동)…', key: 'Ctrl+M', run: act('messages') },
      '-',
      { ic: 'eraser', label: '화면 지우기', sub: () => [
        { ic: 'eye-off', label: '글자 숨김·복원', key: 'F10', run: act('toggleClear') },
        { ic: 'image', label: txt('#bBg', '배경 지우기'), run: click('#bBg') }, { ic: 'layers', label: txt('#bOvOff', '오버레이 끄기'), run: click('#bOvOff') },
        { ic: 'flag', label: txt('#bLogo', '로고 화면'), run: click('#bLogo') }, { ic: 'volume-2', label: '음악 멈춤', run: click('#bAudio') },
        '-',
        { ic: 'circle-x', label: '모두 지우기', run: click('#bAll') },
      ] },
      { ic: 'radio', label: 'OBS (방송 · 녹화 · 장면)', sub: () => (window.BCObs ? window.BCObs.menu() : []) },
      { ic: 'camera', label: '송출 배경 (카메라·그림·영상)', sub: () => [
        { ic: 'camera', label: '카메라·미디어 고르기…', run: lib('cameras') },
        { label: app.state && app.state.layers && app.state.layers.media ? `■ 송출 배경 끄기 (${app.state.layers.media.label || '미디어'})` : '　송출 배경 끄기', run: () => window.BCLib && window.BCLib.liveMedia(null) },
      ] },
      { ic: 'brush', label: () => on(window.BCDraw && window.BCDraw.isOn(), '화면에 그리기·강조'), run: () => window.BCDraw && window.BCDraw.toggle() },
      { ic: 'picture-in-picture-2', label: 'OBS 자막 모양', sub: () => [
        { label: () => on(app.state && app.state.obsView && app.state.obsView.pip, '그림·악보 슬라이드는 우상단에'), run: () => app.cmd('setObsView', { pip: !(app.state.obsView && app.state.obsView.pip) }) },
        { label: () => on(app.state && app.state.obsView && app.state.obsView.full, '슬라이드 그대로 (예배당 화면 모양)'), run: () => app.cmd('setObsView', { full: !(app.state.obsView && app.state.obsView.full) }) },
      ] },
      '-',
      { label: () => on(app.state && app.state.settings.previewMode === false, '미리보기 끄기 (클릭하면 바로 송출)'), run: click('#btnStudio') },
      { ic: 'monitor', label: '보조 화면(예배당) 켜기·끄기', key: 'Ctrl+Shift+F', run: act('toggleOutputWindow') },
      { ic: 'presentation', label: '무대 화면 창 열기 (설교자·찬양팀)', run: () => window.open('/outputs/stage?window=1', 'wc-stage', 'width=1280,height=720') },
    ]],
    ['보기', () => {
      const D = window.BCDock;
      const cur = D ? D.activeWorkspace() : '';
      return [
        { ic: 'layout-panel-left', label: '패널', sub: () => ['cue', 'main', 'quick', 'library', 'stage', 'media', 'preview', 'live'].map(panel) },
        { ic: 'layout-grid', label: '슬라이드 보기', sub: () => [['list', '목록'], ['grid', '격자'], ['all', '전체 격자 (모든 순서)'], ['alllist', '전체 목록 (모든 순서)']].map(([v, l]) => ({ label: on(window.BCGrid && window.BCGrid.mode() === v, l), run: () => { const b = $(`#slideView [data-sv="${v}"]`); if (b) b.click(); } })) },
        { ic: 'columns-2', label: '작업공간 (화면 배치)', sub: () => [
          ...(D ? D.workspaces().map((w, i) => ({ label: on(w.id === cur, w.name), key: i < 9 ? 'Ctrl+Alt+' + (i + 1) : '', run: () => D.applyWorkspace(w.id) })) : []),
          '-',
          { ic: 'plus', label: '지금 배치를 새 작업공간으로…', run: () => D && D.saveAsWorkspace() },
          { label: '작업공간 관리 · 덮어쓰기…', run: () => D && D.manageWorkspaces() },
          { ic: 'lock', label: '패널 잠그기 · 기본 배치로…', run: () => D && D.openMenu() },
        ] },
        '-',
        { ic: 'palette', label: '조작 화면 테마 · 글자 크기…', key: 'Ctrl+Shift+= / -', run: () => window.BCUiTheme && window.BCUiTheme.open() },
        { ic: 'languages', label: 'Language · 언어', sub: () => [['ko', '한국어'], ['en', 'English']].map(([v, l]) => ({ label: on((app.state && app.state.settings.uiLang || 'ko') === v, l), run: () => app.cmd('updateSettings', { patch: { uiLang: v } }) })) },
      ];
    }],
    ['도구', [
      { ic: 'library', label: '라이브러리', sub: [
        { ic: 'music', label: '찬양', run: lib('songs') }, { ic: 'music-2', label: '찬송가·PPT (폴더 · 온라인)', run: lib('hymns') },
        { ic: 'image', label: '이미지·영상', run: lib('images') }, { ic: 'camera', label: '카메라', run: lib('cameras') }, { ic: 'volume-2', label: '음악', run: lib('audio') },
        { ic: 'layers', label: '오버레이 (로고·시계·카운트다운·배너)', run: lib('overlays') }, { ic: 'palette', label: '템플릿', run: lib('templates') },
      ] },
      { ic: 'video', label: '미디어 (영상·음악 바로 재생)', run: () => window.BCDock && window.BCDock.show('media') },
      { ic: 'timer', label: '무대·설교 타이머', run: () => window.BCDock && window.BCDock.show('stage') },
      { ic: 'sparkles', label: '매크로 (동작 묶음 · Alt+1~9)…', run: () => window.BCMacro && window.BCMacro.open() },
      { ic: 'radio', label: 'OBS 원격 조작 (방송 · 녹화 · 장면)…', run: () => window.BCObs && window.BCObs.open() },
      { ic: 'sliders-horizontal', label: '장비 (X32 음향 · PTZ 카메라)…', run: () => window.BCDevices && window.BCDevices.open() },
      '-',
      { ic: 'smartphone', label: '휴대폰 리모컨', sub: () => [
        { label: '열기 (QR · 주소 · PIN)…', run: () => window.BCRemote && window.BCRemote.open() },
        { label: window.BCRemote && window.BCRemote.status().enabled ? '✓ 켜짐 — 끄기' : '　켜기', run: () => window.BCRemote && window.BCRemote.toggle() },
        { label: 'PIN 바꾸기', run: () => window.BCRemote && window.BCRemote.newPin() },
      ] },
      { ic: 'gamepad-2', label: '스트림덱 · 외부 단추 연결…', run: () => window.BCTrigger && window.BCTrigger.open() },
    ]],
    ['도움말', [
      { ic: 'book', label: '사용 설명서', run: link('https://github.com/hahadark/WorshipCue/blob/main/docs/%EC%82%AC%EC%9A%A9%EC%9E%90%EC%84%A4%EB%AA%85%EC%84%9C.md') },
      { ic: 'image', label: '그림으로 보는 사용법 (README)', run: link('https://github.com/hahadark/WorshipCue#readme') },
      { ic: 'video', label: 'OBS 연결 안내', run: link('https://github.com/hahadark/WorshipCue/blob/main/docs/OBS%EC%84%A4%EC%A0%95%EA%B0%80%EC%9D%B4%EB%93%9C.md') },
      '-',
      { ic: 'list-checks', label: '연결 점검 (예배 전에 한 번)…', run: () => window.BCDiag && window.BCDiag.open() },
      { ic: 'keyboard', label: '단축키 보기', run: settings('shortcuts') },
      { ic: 'sparkles', label: '새 소식 (버전별 바뀐 점)', run: link('https://github.com/hahadark/WorshipCue/releases') },
      { ic: 'download', label: '로그 묶음 저장 (문제 알릴 때 첨부)…', run: () => window.BCLogs && window.BCLogs.save() },
      { ic: 'bug', label: '문제 알리기 · 건의', run: link('https://github.com/hahadark/WorshipCue/issues') },
      '-',
      { ic: 'info', label: '정보 · 라이선스', run: settings('about') },
    ]],
  ];

  let openIdx = -1;
  let subItems = [];
  const menuItems = i => (typeof MENUS[i][1] === 'function' ? MENUS[i][1]() : MENUS[i][1]);
  const lbl = it => (typeof it.label === 'function' ? it.label() : it.label);
  const itemsHtml = (items, attr) => items.map((it, k) => it === '-' ? '<div class="mb-sep"></div>'
    : it.head ? `${k ? '<div class="mb-sep"></div>' : ''}<div class="mb-head">${esc(it.head)}</div>`
      : `<button class="mb-item${it.sub ? ' mb-hassub' : ''}" ${attr}="${k}"><i class="mb-ic">${it.ic ? I(it.ic) : ''}</i><span>${esc(lbl(it))}</span>${it.sub ? '<i class="mb-arrow">' + (I('chevron-right') || '▸') + '</i>' : it.key ? `<kbd>${esc(it.key)}</kbd>` : '<i></i>'}</button>`).join('');
  function init() {
    const bar = document.createElement('nav');
    bar.className = 'menubar';
    bar.innerHTML = MENUS.map(([n], i) => `<button class="mb-top" data-m="${i}"${n === '도구' ? ' data-remote="1" title="휴대폰 리모컨이 켜져 있으면 초록 점"' : ''}>${esc(n)}</button>`).join('') + '<div class="mb-drop" hidden></div><div class="mb-drop mb-sub" hidden></div>';
    document.body.insertBefore(bar, document.body.firstChild);
    const drop = bar.querySelector('.mb-drop:not(.mb-sub)');
    const sub = bar.querySelector('.mb-sub');
    let subFor = -1;
    let subT = 0;
    const closeSub = () => { sub.hidden = true; subFor = -1; drop.querySelectorAll('.mb-hassub').forEach(x => x.classList.remove('on')); };
    const openSub = btn => {
      const k = +btn.dataset.k;
      if (subFor === k && !sub.hidden) return;
      const it = menuItems(openIdx)[k];
      subItems = typeof it.sub === 'function' ? it.sub() : it.sub;
      sub.innerHTML = itemsHtml(subItems, 'data-s');
      drop.querySelectorAll('.mb-hassub').forEach(x => x.classList.toggle('on', x === btn));
      const br = bar.getBoundingClientRect(), r = btn.getBoundingClientRect();
      sub.hidden = false;
      const h = sub.offsetHeight, w = sub.offsetWidth;
      const left = r.right + w + 4 > innerWidth ? r.left - w + 2 : r.right - 2;
      sub.style.left = (left - br.left) + 'px';
      sub.style.top = Math.max(0, Math.min(r.top - 5, innerHeight - h - 6) - br.top) + 'px';
      subFor = k;
    };
    const show = i => {
      openIdx = i;
      closeSub();
      bar.querySelectorAll('.mb-top').forEach(b => b.classList.toggle('on', +b.dataset.m === i));
      if (i < 0) { drop.hidden = true; return; }
      drop.innerHTML = itemsHtml(menuItems(i), 'data-k');
      const t = bar.querySelector(`.mb-top[data-m="${i}"]`);
      drop.style.left = t.offsetLeft + 'px';
      drop.hidden = false;
    };
    const run = m => { show(-1); try { m.run(); } catch (err) { app.showMsg(err.message, 'error'); } };
    bar.addEventListener('click', e => {
      const t = e.target.closest('.mb-top');
      if (t) { show(openIdx === +t.dataset.m ? -1 : +t.dataset.m); return; }
      const si = e.target.closest('.mb-sub .mb-item');
      if (si) { const m = subItems[+si.dataset.s]; if (m && m.run) run(m); return; }
      const it = e.target.closest('.mb-item');
      if (!it) return;
      const m = menuItems(openIdx)[+it.dataset.k];
      if (m.sub) openSub(it); else run(m);
    });
    bar.addEventListener('mouseover', e => {
      const t = e.target.closest('.mb-top');
      if (t && openIdx >= 0 && +t.dataset.m !== openIdx) { show(+t.dataset.m); return; }
      const it = e.target.closest('.mb-item');
      if (!it || it.closest('.mb-sub')) return;
      clearTimeout(subT);
      // 하위 메뉴 쪽으로 비스듬히 지나가도 바로 닫히지 않게 조금 기다린다
      const has = it.classList.contains('mb-hassub');
      subT = setTimeout(() => { if (has) openSub(it); else closeSub(); }, has ? 60 : 220);
    });
    sub.addEventListener('mouseover', () => clearTimeout(subT));
    document.addEventListener('mousedown', e => { if (openIdx >= 0 && !bar.contains(e.target)) show(-1); }, true);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && openIdx >= 0) { if (!sub.hidden) closeSub(); else show(-1); e.stopPropagation(); return; }
      // Ctrl+, : 설정
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'Comma') { e.preventDefault(); settings()(); }
    }, true);
  }

  window.BCMenu = { init };
})();
