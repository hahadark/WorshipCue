/* 조작 화면 독(dock) 배치 — OBS 처럼 패널을 끌어 원하는 곳에 붙이고, 탭으로 합치고, 띄우고, 닫는다.
 * - 패널: 큐시트·성경 책 / 본문·편집 / 빠른 설정 / 미리보기 / LIVE
 * - 기존 DOM(아이디·이벤트)을 그대로 패널 안으로 옮긴다. 닫힌 패널은 숨은 보관함(#dockPark)에 둔다
 * - 배치는 설정(dockLayout)에 저장되어 다음 실행 때 그대로
 */
(function () {
  'use strict';
  const DV = window['dockview-core'];
  const $ = s => document.querySelector(s);

  const PANELS = [
    { id: 'cue', title: '큐시트 · 성경 책', node: () => $('#panelCue') },
    { id: 'main', title: '본문 · 편집', node: () => $('#panelMain') },
    { id: 'quick', title: '빠른 설정', node: () => $('#quick') },
    { id: 'library', title: '라이브러리', node: () => $('#panelLibrary') },
    { id: 'stage', title: '무대·타이머', node: () => $('#panelStage') },
    { id: 'preview', title: '미리보기', node: () => $('#panelPreview') },
    { id: 'live', title: 'LIVE', node: () => $('#panelLive') },
  ];
  const byId = Object.fromEntries(PANELS.map(p => [p.id, p]));
  // 패널 노드는 처음에 한 번 잡아 둔다 (닫힌 패널은 문서 밖으로 떨어지지 않게 보관함으로)
  const nodes = {};
  const nodeOf = id => nodes[id] || (nodes[id] = byId[id] && byId[id].node());
  const park = id => { const n = nodeOf(id); if (n && !$('#dockPark').contains(n)) $('#dockPark').appendChild(n); };

  let api = null;
  let app = null;
  let saveTimer = null;
  let restoring = false;

  /** 패널 내용: 기존 노드를 감싸서 넣고, 닫히면 보관함으로 돌려보낸다 */
  function createComponent(opts) {
    const def = byId[opts.id] || byId[opts.name];
    const el = document.createElement('div');
    el.className = 'dock-body dock-' + (def ? def.id : 'x');
    return {
      element: el,
      init() { const n = def && nodeOf(def.id); if (n) el.appendChild(n); fitScreens(); },
      dispose() { if (def) park(def.id); },
    };
  }

  /** 띄우기(떠 있는 창) ↔ 붙이기 단추 */
  function headerActions(group) {
    const el = document.createElement('div');
    el.className = 'dock-actions';
    const b = document.createElement('button');
    b.type = 'button';
    const sync = () => {
      const floating = group.api.location && group.api.location.type === 'floating';
      b.textContent = floating ? '⇲' : '⧉';
      b.title = floating ? '제자리에 붙이기' : '떠 있는 창으로 띄우기';
    };
    b.onclick = () => {
      const floating = group.api.location && group.api.location.type === 'floating';
      if (floating) group.api.moveTo({ position: 'right' });
      else api.addFloatingGroup(group, { width: 520, height: 420 });
      sync();
    };
    el.appendChild(b);
    return { element: el, init() { sync(); }, dispose() {} };
  }

  function defaultLayout() {
    api.clear();
    api.addPanel({ id: 'cue', component: 'cue', title: byId.cue.title });
    api.addPanel({ id: 'main', component: 'main', title: byId.main.title, position: { referencePanel: 'cue', direction: 'right' } });
    api.addPanel({ id: 'preview', component: 'preview', title: byId.preview.title, position: { referencePanel: 'main', direction: 'right' } });
    api.addPanel({ id: 'live', component: 'live', title: byId.live.title, position: { referencePanel: 'preview', direction: 'below' } });
    api.addPanel({ id: 'quick', component: 'quick', title: byId.quick.title, position: { referencePanel: 'main', direction: 'below' } });
    api.addPanel({ id: 'library', component: 'library', title: byId.library.title, position: { referencePanel: 'quick', direction: 'within' } });
    api.addPanel({ id: 'stage', component: 'stage', title: byId.stage.title, position: { referencePanel: 'library', direction: 'within' } });
    const W = $('#dock').clientWidth || 1600, H = $('#dock').clientHeight || 800;
    try {
      api.getPanel('cue').group.api.setSize({ width: 300 });
      api.getPanel('preview').group.api.setSize({ width: Math.round(W * 0.42) });
      api.getPanel('quick').group.api.setSize({ height: Math.round(H * 0.4) });
    } catch { /* 크기 조정 실패는 무시 */ }
    if (app.state && app.state.settings.previewMode === false) hide('preview');
  }

  function save() {
    if (restoring) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { app.cmd('saveDockLayout', { layout: JSON.stringify({ v: 2, known: PANELS.map(p => p.id), layout: api.toJSON() }) }); } catch { /* 무시 */ }
    }, 700);
  }

  function isOpen(id) { return !!(api && api.getPanel(id)); }

  function show(id) {
    if (!api || isOpen(id)) { const p = api && api.getPanel(id); if (p) p.api.setActive(); return; }
    const def = byId[id];
    // 원래 자리 가까이: 미리보기는 LIVE 위, LIVE 는 미리보기 아래, 나머지는 본문 옆
    let position;
    if (id === 'preview' && isOpen('live')) position = { referencePanel: 'live', direction: 'above' };
    else if (id === 'live' && isOpen('preview')) position = { referencePanel: 'preview', direction: 'below' };
    else if (id === 'quick' && isOpen('main')) position = { referencePanel: 'main', direction: 'below' };
    else if (id === 'library' && isOpen('quick')) position = { referencePanel: 'quick', direction: 'within' };
    else if (id === 'library' && isOpen('main')) position = { referencePanel: 'main', direction: 'below' };
    else if (id === 'stage' && (isOpen('library') || isOpen('quick'))) position = { referencePanel: isOpen('library') ? 'library' : 'quick', direction: 'within' };
    else if (id === 'cue' && isOpen('main')) position = { referencePanel: 'main', direction: 'left' };
    else { const any = api.panels[0]; position = any ? { referencePanel: any.id, direction: 'right' } : undefined; }
    api.addPanel({ id, component: id, title: def.title, ...(position ? { position } : {}) });
  }

  function hide(id) {
    const p = api && api.getPanel(id);
    if (p) api.removePanel(p);
    park(id);
  }

  function setLocked(on) {
    if (!api) return;
    api.updateOptions({ disableDnd: !!on, locked: !!on });
    document.body.classList.toggle('dock-locked', !!on);
  }

  /** 미리보기·LIVE 화면: 패널 크기 안에서 16:9 로 가장 크게 */
  function fitScreens() {
    for (const id of ['panelPreview', 'panelLive']) {
      const pane = document.getElementById(id);
      const body = pane && pane.closest('.dock-body');
      if (!body) continue;
      const scr = pane.querySelector('.screen');
      const other = [...pane.children].filter(c => c !== scr).reduce((h, c) => h + c.offsetHeight, 0);
      const availH = body.clientHeight - other - 52; // 패널 안쪽 여백·줄 간격
      const availW = body.clientWidth - 28;
      const w = Math.max(160, Math.min(availW, availH * 16 / 9));
      scr.style.width = w + 'px';
    }
  }

  function init(theApp) {
    app = theApp;
    PANELS.forEach(p => nodeOf(p.id));
    const el = $('#dock');
    api = DV.createDockview(el, {
      createComponent,
      createRightHeaderActionComponent: headerActions,
      className: 'dockview-theme-abyss wc-dock',
      disableFloatingGroups: false,
      floatingGroupBounds: 'boundedWithinViewport',
      // 탭 뒤에 가려진 패널도 내용(DOM)을 그대로 둔다 (조작 코드가 늘 찾을 수 있게)
      defaultRenderer: 'always',
    });
    let saved = null;
    let known = null;
    try { saved = app.state.settings.dockLayout ? JSON.parse(app.state.settings.dockLayout) : null; } catch { saved = null; }
    if (saved && saved.v === 2) { known = saved.known || []; saved = saved.layout; } else if (saved) known = ['cue', 'main', 'quick', 'preview', 'live'];
    restoring = true;
    try {
      if (saved) api.fromJSON(saved); else defaultLayout();
      // 저장된 배치에 없어진 필수 패널이 하나도 없으면 기본 배치
      if (!api.panels.length) defaultLayout();
      // 이번 버전에 새로 생긴 패널은 한 번 보여 준다
      if (known) PANELS.filter(p => !known.includes(p.id) && !isOpen(p.id)).forEach(p => show(p.id));
    } catch { defaultLayout(); }
    restoring = false;
    if (known && PANELS.some(p => !known.includes(p.id))) save();
    // 미리보기 끔(바로 송출)이면 미리보기 패널은 닫는다
    if (app.state.settings.previewMode === false) hide('preview');
    setLocked(!!app.state.settings.dockLocked);
    // 페이지 전체·독 틀은 절대 스크롤되지 않게 (scrollIntoView 등이 바깥까지 밀어 배치가 틀어지는 것 방지)
    document.addEventListener('scroll', e => {
      const t = e.target;
      if (t === document || t === document.documentElement || t === document.body) { if (window.scrollY || window.scrollX) window.scrollTo(0, 0); return; }
      if (t instanceof Element && (t.id === 'dock' || /(^|\s)dv-/.test(t.className || '')) && !t.classList.contains('dock-body')) { t.scrollTop = 0; t.scrollLeft = 0; }
    }, true);
    api.onDidRemovePanel(p => park(p.id));
    api.onDidLayoutChange(() => { save(); requestAnimationFrame(fitScreens); });
    // 창 크기·표시가 바뀌면 배치를 다시 계산 (숨긴 채 시작하거나 최대화가 늦을 때도)
    const relayout = () => { if (el.clientWidth && el.clientHeight) { try { api.layout(el.clientWidth, el.clientHeight, true); } catch { /* 무시 */ } } requestAnimationFrame(fitScreens); };
    new ResizeObserver(relayout).observe(el);
    window.addEventListener('resize', relayout);
    document.addEventListener('visibilitychange', relayout);
    [50, 400, 1500].forEach(ms => setTimeout(relayout, ms));
    // 안전장치: 시작 뒤 패널이 하나도 안 보이면 다시 그리고, 그래도 안 되면 기본 배치로
    setTimeout(() => {
      if (visibleTabs()) return;
      relayout();
      setTimeout(() => {
        if (visibleTabs()) return;
        app.logError && app.logError('독 배치가 보이지 않아 기본 배치로 되돌림: ' + JSON.stringify({ panels: api.panels.length, w: el.clientWidth, h: el.clientHeight }));
        resetLayout();
        app.showMsg('화면 배치가 보이지 않아 기본 배치로 되돌렸습니다.', 'info', 4000);
      }, 800);
    }, 2500);
    // 패널 노드 크기가 바뀌면 미리보기·LIVE 다시 그림 (control.js 의 ResizeObserver 가 처리)
  }

  /** 화면에 실제로 보이는 탭이 있는가 */
  function visibleTabs() {
    return [...document.querySelectorAll('#dock .dv-tab')].some(t => { const r = t.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  }
  function resetLayout() {
    restoring = true;
    try { defaultLayout(); } finally { restoring = false; }
    save();
    requestAnimationFrame(fitScreens);
  }

  /** 화면 배치 메뉴 */
  function openMenu() {
    const s = app.state.settings;
    app.openModal('화면 배치', `<div class="form dock-menu">
      <label>패널 보이기</label><div class="dock-checks">${PANELS.map(p => `<label class="tc-toggle"><input type="checkbox" data-panel="${p.id}" ${isOpen(p.id) ? 'checked' : ''}> ${p.title}</label>`).join('')}</div>
      <label>배치 잠그기</label><label class="tc-toggle"><input type="checkbox" id="dkLock" ${s.dockLocked ? 'checked' : ''}> 예배 중 실수로 패널이 옮겨지지 않게 잠급니다</label>
      <span></span><div class="row-flex"><button id="dkReset">기본 배치로 되돌리기</button></div>
      <span></span><div class="note">
        · 패널 <b>탭을 끌어</b> 다른 패널의 위·아래·왼쪽·오른쪽 가장자리에 놓으면 그쪽에 붙고, 가운데에 놓으면 탭으로 합쳐집니다.<br>
        · 패널 사이 경계선을 끌어 크기를 바꿉니다.<br>
        · 탭 줄 오른쪽 <b>⧉</b> 를 누르면 떠 있는 창이 되고, <b>⇲</b> 를 누르면 다시 붙습니다.<br>
        · 탭의 ✕ 로 닫은 패널은 여기서 다시 켤 수 있습니다. 배치는 자동으로 저장됩니다.
      </div>
    </div>`);
    document.querySelectorAll('[data-panel]').forEach(c => c.onchange = () => {
      if (c.checked) show(c.dataset.panel); else hide(c.dataset.panel);
    });
    $('#dkLock').onchange = e => { setLocked(e.target.checked); app.cmd('updateSettings', { patch: { dockLocked: e.target.checked } }); };
    $('#dkReset').onclick = () => { resetLayout(); app.closeModal(); app.showMsg('기본 배치로 되돌렸습니다.', 'ok', 1500); };
  }

  window.BCDock = { init, show, hide, isOpen, openMenu, fitScreens, resetLayout, panels: PANELS };
})();
