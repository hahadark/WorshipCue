/* 상단 메뉴바: 파일 · 편집 · 순서 넣기 · 송출 · 보기 · 작업공간 · 도구 · 리모컨 · 설정 · 도움말
 * 메뉴 항목은 기존 단추·기능을 그대로 부른다 (같은 동작)
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const click = sel => () => { const el = $(sel); if (el) el.click(); };
  const act = name => () => app.runAction && app.runAction(name);
  const add = type => () => { const b = $(`#cueAdd [data-add="${type}"]`); if (b) b.click(); };
  const lib = tab => () => { if (window.BCDock) window.BCDock.show('library'); if (window.BCLib) window.BCLib.show(tab); };
  const settings = tab => () => window.BCSettings && window.BCSettings.open(tab);
  const ed = a => () => { const b = $(`#cueEditor [data-act="${a}"]`); if (b) b.click(); else app.showMsg('큐시트에서 순서를 먼저 고르세요.', 'info', 1500); };
  const panel = id => ({ label: () => (window.BCDock && window.BCDock.isOpen(id) ? '✓ ' : '　') + window.BCDock.panels.find(p => p.id === id).title, run: () => (window.BCDock.isOpen(id) ? window.BCDock.hide(id) : window.BCDock.show(id)) });

  const MENUS = [
    ['파일', [
      { label: '새 큐시트 · 복제 · 가져오기·내보내기…', run: click('#cueMenu') },
      { label: '🤖 주보로 큐시트 만들기 (AI)…', run: () => window.BCAI && window.BCAI.open() },
      '-',
      { label: '송출 기록', key: 'Ctrl+H', run: act('openHistory') },
      { label: '성경 데이터 가져오기…', run: settings('data') },
    ]],
    ['편집', [
      { label: '고른 순서 고치기', key: 'F2', run: act('cueEdit') },
      { label: '✎ 슬라이드 편집 (글상자·그림·도형)', key: 'Ctrl+E', run: () => { const p = app.preview; if (window.BCSlideEdit) { if (p && p.cue) window.BCSlideEdit.openPreviewSlide(p.index); else if (window.BCCue && window.BCCue.selIndex() >= 0) window.BCSlideEdit.open(window.BCCue.selIndex()); else app.showMsg('큐시트에서 찬양·공지·제목 순서를 고르세요.', 'info', 2000); } } },
      { label: '순서 위로', run: ed('up') }, { label: '순서 아래로', run: ed('down') },
      { label: '순서 복제', run: ed('dup') }, { label: '순서 지우기', run: ed('del') },
      '-',
      { label: '검색창으로', key: 'Ctrl+K', run: act('focusSearch') },
      { label: '성경 책 목록', key: 'Ctrl+B', run: act('openBooks') },
    ]],
    ['순서 넣기', [
      { label: '🎼 찬송가·PPT', run: add('hymn') }, { label: '📖 성경', run: add('bible') }, { label: '🎵 찬양', run: add('song') },
      { label: '📢 공지', run: add('text') }, { label: '🏷 제목', run: add('title') }, { label: '🖼 이미지', run: add('image') },
      { label: '🎬 영상', run: add('video') }, { label: '🔊 음악', run: add('audio') }, { label: '⬛ 빈 화면', run: add('blank') },
    ]],
    ['송출', [
      { label: '송출', key: 'F9', run: act('sendPreview') },
      { label: '다음 슬라이드', key: 'F6', run: act('nextSlide') }, { label: '이전 슬라이드', key: 'F5', run: act('prevSlide') },
      { label: '다음 순서 미리보기', key: 'Ctrl+↓', run: act('cueNext') }, { label: '이전 순서 미리보기', key: 'Ctrl+↑', run: act('cuePrev') },
      '-',
      { label: '글자 숨김·복원', key: 'F10', run: act('toggleClear') },
      { label: '배경 지우기·보이기', run: click('#bBg') }, { label: '오버레이 끄기·다시 켜기', run: click('#bOvOff') },
      { label: '음악 멈춤', run: click('#bAudio') }, { label: '로고 화면', run: click('#bLogo') }, { label: '모두 지우기', run: click('#bAll') },
      '-',
      { label: '미리보기 켜기·끄기 (바로 송출)', run: click('#btnStudio') },
      { label: '보조 화면 켜기·끄기', key: 'Ctrl+Shift+F', run: act('toggleOutputWindow') },
    ]],
    ['보기', [
      panel('cue'), panel('main'), panel('quick'), panel('library'), panel('stage'), panel('preview'), panel('live'),
      '-',
      { label: () => (window.BCCue && window.BCCue.editorOn() ? '✓ ' : '　') + '편집칸 보이기 (큐시트 순서 고치기)', key: 'Ctrl+Shift+E', run: act('toggleEditor') },
      { label: '슬라이드 목록 / 격자 바꾸기', run: () => { const on = window.BCGrid && window.BCGrid.isOn(); const b = $(`#slideView [data-sv="${on ? 'list' : 'grid'}"]`); if (b) b.click(); } },
      { label: '🖥 무대 화면 창 열기', run: () => window.open('/outputs/stage?window=1', 'wc-stage', 'width=1280,height=720') },
      '-',
      { label: '🎨 화면 테마 · 글자 크기…', run: () => window.BCUiTheme && window.BCUiTheme.open() },
      { label: '글자 크게', key: 'Ctrl+Shift+=', run: () => window.BCUiTheme && window.BCUiTheme.stepScale(1) },
      { label: '글자 작게', key: 'Ctrl+Shift+-', run: () => window.BCUiTheme && window.BCUiTheme.stepScale(-1) },
    ]],
    ['작업공간', () => {
      const D = window.BCDock;
      if (!D) return [];
      const act = D.activeWorkspace();
      return [
        ...D.workspaces().slice(0, 9).map((w, i) => ({ label: (w.id === act ? '✓ ' : '　') + w.name, key: 'Ctrl+Alt+' + (i + 1), run: () => D.applyWorkspace(w.id) })),
        ...D.workspaces().slice(9).map(w => ({ label: (w.id === act ? '✓ ' : '　') + w.name, run: () => D.applyWorkspace(w.id) })),
        '-',
        { label: '＋ 지금 배치를 새 작업공간으로 저장…', run: () => D.saveAsWorkspace() },
        { label: '지금 작업공간에 배치 덮어쓰기', run: () => D.overwriteWorkspace() },
        { label: '작업공간 관리 (이름·순서·지우기)…', run: () => D.manageWorkspaces() },
        '-',
        { label: '패널 보이기·잠그기…', run: () => D.openMenu() },
        { label: '기본 배치로 되돌리기', run: () => { D.resetLayout(); app.showMsg('기본 배치로 되돌렸습니다.', 'ok', 1500); } },
      ];
    }],
    ['도구', [
      { label: '찬양 라이브러리', run: lib('songs') }, { label: '찬송가·PPT (폴더·온라인에서 찾기)', run: lib('hymns') },
      { label: '이미지·영상', run: lib('images') }, { label: '음악', run: lib('audio') },
      { label: '오버레이 (로고·시계·카운트다운·배너)', run: lib('overlays') }, { label: '템플릿', run: lib('templates') },
      '-',
      { label: '무대 화면·설교 타이머', run: () => window.BCDock && window.BCDock.show('stage') },
      { label: '📱 휴대폰 리모컨…', run: () => window.BCRemote && window.BCRemote.open() },
    ]],
    ['리모컨', [
      { label: '📱 리모컨 열기 (QR · 주소 · PIN)…', run: () => window.BCRemote && window.BCRemote.open() },
      { label: () => (window.BCRemote && window.BCRemote.status().enabled ? '✓ 리모컨 켜짐 — 끄기' : '　리모컨 켜기'), run: () => window.BCRemote && window.BCRemote.toggle() },
      { label: 'PIN 바꾸기', run: () => window.BCRemote && window.BCRemote.newPin() },
    ]],
    ['설정', [
      { label: '설정 열기…', run: settings() },
      { label: '🎨 화면 테마 · 글자 크기 (조작 화면)…', run: () => window.BCUiTheme && window.BCUiTheme.open() },
      '-',
      { label: '테마', run: settings('themes') }, { label: '출력 (모니터·OBS)', run: settings('output') },
      { label: '템플릿 편집', run: settings('templates') }, { label: '검색·분할', run: settings('behavior') },
      { label: '단축키', run: settings('shortcuts') }, { label: '성경 데이터', run: settings('data') },
    ]],
    ['도움말', [
      { label: '단축키 보기', run: settings('shortcuts') },
      { label: '사용 설명 (GitHub)', run: () => app.cmd('openLink', { url: 'https://github.com/hahadark/WorshipCue#readme' }) },
      { label: '정보·라이선스', run: settings('about') },
    ]],
  ];

  let openIdx = -1;
  const menuItems = i => (typeof MENUS[i][1] === 'function' ? MENUS[i][1]() : MENUS[i][1]);
  function init() {
    const bar = document.createElement('nav');
    bar.className = 'menubar';
    bar.innerHTML = MENUS.map(([n], i) => `<button class="mb-top" data-m="${i}"${n === '리모컨' ? ' data-remote="1" title="휴대폰 리모컨 (켜져 있으면 초록 점)"' : ''}>${esc(n)}</button>`).join('') + '<div class="mb-drop" hidden></div>';
    document.body.insertBefore(bar, document.body.firstChild);
    const drop = bar.querySelector('.mb-drop');
    const show = i => {
      openIdx = i;
      bar.querySelectorAll('.mb-top').forEach(b => b.classList.toggle('on', +b.dataset.m === i));
      if (i < 0) { drop.hidden = true; return; }
      const items = menuItems(i);
      drop.innerHTML = items.map((it, k) => it === '-' ? '<div class="mb-sep"></div>' : `<button class="mb-item" data-k="${k}"><span>${esc(typeof it.label === 'function' ? it.label() : it.label)}</span>${it.key ? `<kbd>${esc(it.key)}</kbd>` : ''}</button>`).join('');
      const t = bar.querySelector(`.mb-top[data-m="${i}"]`);
      drop.style.left = t.offsetLeft + 'px';
      drop.hidden = false;
    };
    bar.addEventListener('click', e => {
      const t = e.target.closest('.mb-top');
      if (t) { show(openIdx === +t.dataset.m ? -1 : +t.dataset.m); return; }
      const it = e.target.closest('.mb-item');
      if (it) { const m = menuItems(openIdx)[+it.dataset.k]; show(-1); try { m.run(); } catch (err) { app.showMsg(err.message, 'error'); } }
    });
    bar.addEventListener('mouseover', e => { const t = e.target.closest('.mb-top'); if (t && openIdx >= 0 && +t.dataset.m !== openIdx) show(+t.dataset.m); });
    document.addEventListener('mousedown', e => { if (openIdx >= 0 && !bar.contains(e.target)) show(-1); }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && openIdx >= 0) { show(-1); e.stopPropagation(); } }, true);
  }

  window.BCMenu = { init };
})();
