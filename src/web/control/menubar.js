/* 상단 메뉴바: 파일 · 큐시트 · 송출 · 보기 · 도구 · 도움말 (하는 일 순서대로, 긴 목록은 ▸ 하위 메뉴)
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
  // 라이브러리 패널을 연 뒤(배치가 잡힌 뒤) 탭을 바꾼다
  const lib = tab => () => { if (window.BCDock) window.BCDock.show('library'); setTimeout(() => window.BCLib && window.BCLib.show(tab), 120); };
  const settings = tab => () => window.BCSettings && window.BCSettings.open(tab);
  const ed = a => () => { const b = $(`#cueEditor [data-act="${a}"]`); if (b) b.click(); else app.showMsg('큐시트에서 순서를 먼저 고르세요.', 'info', 1500); };
  const panel = id => ({ label: () => (window.BCDock && window.BCDock.isOpen(id) ? '✓ ' : '　') + window.BCDock.panels.find(p => p.id === id).title, run: () => (window.BCDock.isOpen(id) ? window.BCDock.hide(id) : window.BCDock.show(id)) });

  /** 고른 순서(또는 미리보기 슬라이드)의 슬라이드 편집 */
  const slideEdit = () => { const p = app.preview; if (!window.BCSlideEdit) return; if (p && p.cue) window.BCSlideEdit.openPreviewSlide(p.index); else if (window.BCCue && window.BCCue.selIndex() >= 0) window.BCSlideEdit.open(window.BCCue.selIndex()); else app.showMsg('큐시트에서 찬양·공지·제목 순서를 고르세요.', 'info', 2000); };
  const on = (cond, label) => (cond ? '✓ ' : '　') + label;
  const H = head => ({ head }); // 작은 제목

  // 하는 일 순서대로: 파일 → 큐시트(준비) → 송출(예배 중) → 보기 → 도구 → 도움말
  // 메뉴마다 10줄 안팎. 긴 목록은 옆으로 펼치는 하위 메뉴(sub) 로. 같은 기능은 한 곳에만.
  const txt = (sel, dflt) => { const el = $(sel); return el ? el.textContent : dflt; };
  const MENUS = [
    ['파일', [
      { label: '📋 큐시트 관리 (새로 · 복제 · 서식 · 휴지통)…', run: click('#cueMenu') },
      { label: '🤖 주보로 큐시트 만들기 (AI)…', run: () => window.BCAI && window.BCAI.open() },
      '-',
      { label: '📥 가져오기', sub: [
        { label: '찬양 (OpenLP · ChordPro · ProPresenter · PPT)…', run: () => { lib('songs')(); setTimeout(() => { const b = document.querySelector('#panelLibrary [data-import]'); if (b) b.click(); }, 300); } },
        { label: '성경 번역본…', run: settings('data') },
      ] },
      { label: '송출 기록', key: 'Ctrl+H', run: act('openHistory') },
      '-',
      { label: '⚙ 설정…', key: 'Ctrl+,', run: settings() },
      { label: '설정 바로 가기', sub: [
        H('송출 화면 (예배당 · OBS)'),
        { label: '테마', run: settings('themes') }, { label: '템플릿 편집', run: settings('templates') }, { label: '출력 (모니터 · OBS 주소)', run: settings('output') },
        H('조작'),
        { label: '검색 · 슬라이드 나누기 · 큐시트', run: settings('behavior') }, { label: '단축키', run: settings('shortcuts') },
        H('데이터'),
        { label: '성경 데이터 · 주석', run: settings('data') },
      ] },
    ]],
    ['큐시트', [
      { label: '＋ 순서 넣기 (고른 순서 다음에)', sub: [
        { label: '🎼 찬송가·PPT', run: add('hymn') }, { label: '📖 성경', run: add('bible') }, { label: '🎵 찬양', run: add('song') },
        { label: '📢 공지', run: add('text') }, { label: '🏷 제목', run: add('title') },
        '-',
        { label: '🖼 이미지', run: add('image') }, { label: '🎬 영상', run: add('video') }, { label: '🔊 음악', run: add('audio') },
        { label: '🎞 슬라이드쇼 (예배 전 화면)', run: add('slideshow') }, { label: '📷 카메라', run: add('camera') }, { label: '⬛ 빈 화면', run: add('blank') },
      ] },
      H('고른 순서'),
      { label: '편집칸에서 고치기', key: 'F2', run: act('cueEdit') },
      { label: '✎ 슬라이드 편집 (글상자·그림·도형)', key: 'Ctrl+E', run: slideEdit },
      { label: '위로', key: 'Alt+↑', run: ed('up') }, { label: '아래로', key: 'Alt+↓', run: ed('down') },
      { label: '복제', run: ed('dup') }, { label: '지우기', key: 'Delete', run: ed('del') },
      '-',
      { label: () => on(window.BCCue && window.BCCue.editorOn(), '편집칸 보이기'), key: 'Ctrl+Shift+E', run: act('toggleEditor') },
      { label: () => on(window.BCCue && window.BCCue.timesOn(), '⏰ 예배 진행 시계'), run: () => window.BCCue && window.BCCue.setTimes(!window.BCCue.timesOn()) },
    ]],
    ['송출', [
      { label: '송출', key: 'F9', run: act('sendPreview') },
      { label: '다음 슬라이드', key: 'F6', run: act('nextSlide') }, { label: '이전 슬라이드', key: 'F5', run: act('prevSlide') },
      { label: '다음 순서 미리보기', key: 'Ctrl+↓', run: act('cueNext') }, { label: '이전 순서 미리보기', key: 'Ctrl+↑', run: act('cuePrev') },
      '-',
      { label: '화면 지우기', sub: () => [
        { label: '글자 숨김·복원', key: 'F10', run: act('toggleClear') },
        { label: txt('#bBg', '배경 지우기'), run: click('#bBg') }, { label: txt('#bOvOff', '오버레이 끄기'), run: click('#bOvOff') },
        { label: txt('#bLogo', '로고 화면'), run: click('#bLogo') }, { label: '음악 멈춤', run: click('#bAudio') },
        '-',
        { label: '모두 지우기', run: click('#bAll') },
      ] },
      { label: '송출 배경 (카메라·그림·영상)', sub: () => [
        { label: '📷 카메라·미디어 고르기…', run: lib('cameras') },
        { label: app.state && app.state.layers && app.state.layers.media ? `■ 송출 배경 끄기 (${app.state.layers.media.label || '미디어'})` : '　송출 배경 끄기', run: () => window.BCLib && window.BCLib.liveMedia(null) },
      ] },
      { label: () => on(window.BCDraw && window.BCDraw.isOn(), '✎ 화면에 그리기·강조'), run: () => window.BCDraw && window.BCDraw.toggle() },
      '-',
      { label: () => on(app.state && app.state.settings.previewMode === false, '미리보기 끄기 (클릭하면 바로 송출)'), run: click('#btnStudio') },
      { label: '보조 화면(예배당) 켜기·끄기', key: 'Ctrl+Shift+F', run: act('toggleOutputWindow') },
    ]],
    ['보기', () => {
      const D = window.BCDock;
      const cur = D ? D.activeWorkspace() : '';
      return [
        { label: '패널', sub: () => ['cue', 'main', 'quick', 'library', 'stage', 'preview', 'live'].map(panel) },
        { label: '슬라이드 보기', sub: () => [['list', '목록'], ['grid', '격자'], ['all', '전체 격자 (모든 순서)'], ['alllist', '전체 목록 (모든 순서)']].map(([v, l]) => ({ label: on(window.BCGrid && window.BCGrid.mode() === v, l), run: () => { const b = $(`#slideView [data-sv="${v}"]`); if (b) b.click(); } })) },
        { label: '작업공간 (화면 배치)', sub: () => [
          ...(D ? D.workspaces().map((w, i) => ({ label: on(w.id === cur, w.name), key: i < 9 ? 'Ctrl+Alt+' + (i + 1) : '', run: () => D.applyWorkspace(w.id) })) : []),
          '-',
          { label: '＋ 지금 배치를 새 작업공간으로…', run: () => D && D.saveAsWorkspace() },
          { label: '작업공간 관리 · 덮어쓰기…', run: () => D && D.manageWorkspaces() },
          { label: '패널 잠그기 · 기본 배치로…', run: () => D && D.openMenu() },
        ] },
        '-',
        { label: '🖥 무대 화면 창 열기 (설교자·찬양팀)', run: () => window.open('/outputs/stage?window=1', 'wc-stage', 'width=1280,height=720') },
        { label: '🎨 조작 화면 테마 · 글자 크기…', key: 'Ctrl+Shift+= / -', run: () => window.BCUiTheme && window.BCUiTheme.open() },
        { label: '🌐 Language · 언어', sub: () => [['ko', '한국어'], ['en', 'English']].map(([v, l]) => ({ label: on((app.state && app.state.settings.uiLang || 'ko') === v, l), run: () => app.cmd('updateSettings', { patch: { uiLang: v } }) })) },
      ];
    }],
    ['도구', [
      { label: '라이브러리', sub: [
        { label: '🎵 찬양', run: lib('songs') }, { label: '🎼 찬송가·PPT (폴더 · 온라인)', run: lib('hymns') },
        { label: '🖼 이미지·영상', run: lib('images') }, { label: '📷 카메라', run: lib('cameras') }, { label: '🔊 음악', run: lib('audio') },
        { label: '🕒 오버레이 (로고·시계·카운트다운·배너)', run: lib('overlays') }, { label: '🎨 템플릿', run: lib('templates') },
      ] },
      { label: '⏱ 무대·설교 타이머', run: () => window.BCDock && window.BCDock.show('stage') },
      { label: '🎛 스트림덱 · 외부 단추 연결…', run: () => window.BCTrigger && window.BCTrigger.open() },
      '-',
      { label: '📱 휴대폰 리모컨', sub: () => [
        { label: '열기 (QR · 주소 · PIN)…', run: () => window.BCRemote && window.BCRemote.open() },
        { label: window.BCRemote && window.BCRemote.status().enabled ? '✓ 켜짐 — 끄기' : '　켜기', run: () => window.BCRemote && window.BCRemote.toggle() },
        { label: 'PIN 바꾸기', run: () => window.BCRemote && window.BCRemote.newPin() },
      ] },
    ]],
    ['도움말', [
      { label: '📖 사용 설명서', run: () => app.cmd('openLink', { url: 'https://github.com/hahadark/WorshipCue/blob/main/docs/%EC%82%AC%EC%9A%A9%EC%9E%90%EC%84%A4%EB%AA%85%EC%84%9C.md' }) },
      { label: '그림으로 보는 사용법 (README)', run: () => app.cmd('openLink', { url: 'https://github.com/hahadark/WorshipCue#readme' }) },
      { label: 'OBS 연결 안내', run: () => app.cmd('openLink', { url: 'https://github.com/hahadark/WorshipCue/blob/main/docs/OBS%EC%84%A4%EC%A0%95%EA%B0%80%EC%9D%B4%EB%93%9C.md' }) },
      '-',
      { label: '단축키 보기', run: settings('shortcuts') },
      { label: '정보 · 라이선스', run: settings('about') },
    ]],
  ];

  let openIdx = -1;
  let subItems = [];
  const menuItems = i => (typeof MENUS[i][1] === 'function' ? MENUS[i][1]() : MENUS[i][1]);
  const lbl = it => (typeof it.label === 'function' ? it.label() : it.label);
  const itemsHtml = (items, attr) => items.map((it, k) => it === '-' ? '<div class="mb-sep"></div>'
    : it.head ? `${k ? '<div class="mb-sep"></div>' : ''}<div class="mb-head">${esc(it.head)}</div>`
      : `<button class="mb-item${it.sub ? ' mb-hassub' : ''}" ${attr}="${k}"><span>${esc(lbl(it))}</span>${it.sub ? '<i class="mb-arrow">▸</i>' : it.key ? `<kbd>${esc(it.key)}</kbd>` : ''}</button>`).join('');
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
