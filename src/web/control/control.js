/* WorshipCue 조작 화면
 * 원칙: 검색·미리보기는 Live 를 절대 바꾸지 않는다. Live 는 송출 명령으로만 바뀐다.
 */
(function () {
  'use strict';
  const R = window.BCRender;
  const SL = window.BCSlides;
  const $ = s => document.querySelector(s);
  const esc = R.esc;

  // ---------------- 상태 ----------------
  const app = {
    state: null,          // 코어 상태 (live, settings, versions, outputs …)
    books: [],            // 66권 기본 정보
    structure: [],        // 현재 번역본의 책별 장 구조
    preview: null,        // { passage, slides, index, query }
    results: { type: 'none', items: [], sel: -1 },
    view: { pv: 'main', lv: 'main' },
    suggest: { items: [], sel: -1 },
    selectedBook: null,
    capturing: null,      // 단축키 입력 대기 콜백 (설정 화면)
    connected: false,
  };
  window.BC = app;

  // ---------------- 코어 API ----------------
  async function cmd(name, args = {}) {
    try {
      const r = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WorshipCue': '1' },
        body: JSON.stringify({ cmd: name, args }),
      });
      return await r.json();
    } catch (e) {
      return { ok: false, error: '코어와 통신할 수 없습니다: ' + e.message };
    }
  }
  app.cmd = cmd;
  // 조작 화면에서 난 오류는 로그 파일에도 남긴다 (문제 원인 찾기용)
  app.logError = msg => { try { fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WorshipCue': '1' }, body: JSON.stringify({ cmd: 'logClientError', args: { message: String(msg).slice(0, 2000) } }) }); } catch { /* 무시 */ } };
  window.addEventListener('error', e => app.logError(`${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', e => app.logError('Promise: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));

  const settings = () => app.state.settings;
  const tplById = id => settings().templates.find(t => t.id === id) || settings().templates[0];
  /**
   * 출력 템플릿. over = { main, overlay } 순서별 템플릿 (큐시트 순서에 따로 정한 것)
   * 미리보기는 미리보기 중인 순서의 것, LIVE 는 송출 중인 순서의 것을 쓴다
   */
  const tplFor = (output, over) => {
    const id = over && over[output] && settings().templates.some(t => t.id === over[output]) ? over[output] : settings().activeTemplates[output];
    return tplById(id);
  };
  app.tplFor = tplFor;
  // ---------------- 배경 빼기: 순서 배경(그 순서에서 지움) · 템플릿 배경(템플릿을 단색으로) ----------------
  const MEDIA_BG = ['image', 'video', 'camera'];
  /** i 번째 큐시트 순서의 배경이 어디서 오는지 */
  app.bgInfo = i => {
    const C = window.BCCue;
    const it = C && i >= 0 ? C.item(i) : null;
    const t = tplFor('main', it && C.tplOf ? C.tplOf(i) : null);
    return { i, item: it, itemBg: it && it.bg && !String(it.bg).startsWith('#') ? it.bg : '', tpl: t && t.background && MEDIA_BG.includes(t.background.type) ? t : null };
  };
  app.removeItemBg = async i => {
    const it = window.BCCue && window.BCCue.item(i);
    if (!it || !window.BCCue.updateItem(i, x => { x.bg = ''; })) return;
    showMsg(`'${it.title}' 순서에서 배경을 뺐습니다.`, 'ok', 2000);
    // 지금 송출 중인 순서면 송출 화면도 바로 (보던 슬라이드 그대로)
    const L = app.state.live;
    if (!(L && L.hasLive && L.visible && L.passage && L.passage.cueId === window.BCCue.currentId() && L.passage.cueIndex === i)) return;
    const at = L.index;
    for (let k = 0; k < 20 && !(app.preview && app.preview.cue && app.preview.cue.index === i && !app.preview.slides.some(s => s.bg)); k++) await new Promise(r => setTimeout(r, 100));
    if (!app.preview || !app.preview.cue || app.preview.cue.index !== i) return;
    app.setPreviewIndex(at);
    await sendPreview();
  };
  /** 지금 송출 중인 순서에서 배경 빼기 */
  async function removeLiveItemBg() {
    const lv = app.state.live && app.state.live.passage;
    if (!lv || !(lv.cueIndex >= 0) || !lv.cueId) return;
    if (window.BCCue && lv.cueId === window.BCCue.currentId()) return app.removeItemBg(lv.cueIndex);
    // 다른 큐시트의 순서: 저장된 큐시트에서 뺀다 (다음 송출부터)
    const r = await cmd('getCue', { id: lv.cueId });
    if (!r.ok || !r.result.items[lv.cueIndex]) return;
    r.result.items[lv.cueIndex].bg = '';
    await cmd('saveCue', { cue: r.result });
    showMsg(`'${lv.itemTitle || lv.title}' 순서에서 배경을 뺐습니다.`, 'ok', 2000);
  }
  app.removeTemplateBg = async t => {
    const c = structuredClone(t);
    c.background = { ...c.background, type: 'color', color: c.background.color || '#000000' };
    const r = await cmd('saveTemplate', { template: c });
    if (!r.ok) return showMsg(r.error, 'error');
    showMsg(`템플릿 '${t.name}' 의 배경을 뺐습니다 (단색).`, 'ok', 2500);
  };
  /** 배경 메뉴: 이 순서에서 빼기 · 템플릿에서 빼기 · 잠깐 끄기 */
  app.bgMenuItems = i => {
    const b = app.bgInfo(i);
    const L = (app.state && app.state.layers) || {};
    return [
      { head: '배경' },
      ...(b.itemBg ? [{ label: `🗑 이 순서에서 배경 빼기 ('${b.item.title}')`, run: () => app.removeItemBg(i) }] : []),
      ...(b.tpl ? [{ label: `🗑 템플릿 '${b.tpl.name}' 배경 빼기 (이 템플릿을 쓰는 모든 순서)`, run: () => app.removeTemplateBg(b.tpl) }] : []),
      ...(L.media ? [{ label: `■ 송출 배경 끄기 (${L.media.label || '미디어'})`, run: () => cmd('setBackgroundMedia', { media: null }) }] : []),
      '-',
      { label: L.hideBg ? '배경 다시 켜기' : '잠깐 끄기 (다시 켤 때까지 모든 순서에서 배경 없이)', run: () => cmd('toggleBackground', { on: !L.hideBg }) },
    ];
  };
  const pvOver = () => (app.preview && app.preview.tpl) || null;
  const lvOver = () => (app.state.live.passage && app.state.live.passage.tpl) || null;
  /** 모니터에 함께 보일 오버레이 (켜져 있고 그 출력에 나가는 것) */
  const overlaysFor = output => (settings().overlays || []).filter(o => o.on && (o.outputs || []).includes(output));
  app.overlaysFor = overlaysFor;

  // ---------------- 메시지 ----------------
  let msgTimer = null;
  // 알림: 오른쪽 아래에 상자로 잠깐 떴다가 사라진다 (화면 배치는 움직이지 않음). 누르면 바로 닫힘
  function showMsg(text, kind = 'info', ms = 4000) {
    const el = $('#msg');
    el.textContent = text;
    el.className = 'msg ' + kind + (ms ? '' : ' sticky');
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth; // 나타나는 효과를 다시 시작
    el.classList.add('show');
    clearTimeout(msgTimer);
    if (ms) msgTimer = setTimeout(hideMsg, ms);
  }
  function hideMsg() {
    const el = $('#msg');
    el.classList.remove('show');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { el.hidden = true; }, 250);
  }
  $('#msg').addEventListener('click', hideMsg);
  app.showMsg = showMsg;

  // ---------------- 실시간 연결 ----------------
  function connect() {
    const es = new EventSource('/events?client=control');
    es.addEventListener('draw', e => { try { const d = JSON.parse(e.data); if (app.state && app.state.screen) app.state.screen.draw = !!((d.strokes && d.strokes.length) || d.spot); renderScreenLayers(); window.BCDraw && window.BCDraw.onDraw(d); } catch { /* 무시 */ } });
    es.addEventListener('state', e => {
      const first = !app.state;
      app.state = JSON.parse(e.data);
      R.setCameraPrefs(app.state.settings.cameras);
      if (window.BCI18n) window.BCI18n.sync(app.state.settings.uiLang); else if (app.state.settings.uiLang === 'en') location.reload();
      if (!first) keepLocalTemplate();
      app.connected = true;
      $('#conn').hidden = true;
      if (first) init2();
      renderLive();
      renderStatus();
      renderScreenLayers();
      if (window.BCLib && window.BCLib.onLayers) window.BCLib.onLayers(); // 송출 배경 표시 (송출 중인 슬라이드가 없어도)
      markResults();
      if (window.BCCue && !first) window.BCCue.onLive();
    });
    es.addEventListener('settings', e => {
      const d = JSON.parse(e.data);
      app.state = d.state;
      R.setCameraPrefs(app.state.settings.cameras);
      if (d.what === 'cameras' && window.BCLib) window.BCLib.onCameraPrefs();
      if (window.BCI18n) window.BCI18n.sync(app.state.settings.uiLang); else if (app.state.settings.uiLang === 'en') location.reload();
      keepLocalTemplate();
      if (d.what === 'versions') { fillVersions(); loadStructure(); }
      if (d.what === 'commentaries') { cm.key = ''; updateCommentary(); }
      if (d.what === 'templates' || d.what === 'settings') { rebuildPreview(); renderLive(); }
      if (d.what === 'overlays') { renderPreview(); renderLive(); if (window.BCLib) window.BCLib.onOverlays(); }
      if (window.BCLib) window.BCLib.onSettings(d.what);
      syncControls();
      renderStudio();
      renderQuick(false);
      if (window.BCSettings) window.BCSettings.onState(d.what);
      renderScreenLayers();
    });
    es.addEventListener('update', e => {
      const u = JSON.parse(e.data);
      const before = app.update && app.update.state;
      app.update = u;
      renderStatus();
      if (u.state !== before && u.state === 'ready') showMsg(`새 버전 ${u.version} 을 받았습니다. 프로그램을 끌 때 설치됩니다.`, 'ok', 6000);
      if (u.state !== before && u.state === 'available') showMsg(`새 버전 ${u.version} 이 나왔습니다. 아래 상태줄의 '새 버전' 을 누르면 받는 곳이 열립니다.`, 'info', 6000);
      if (window.BCSettings && window.BCSettings.onUpdate) window.BCSettings.onUpdate();
    });
    es.addEventListener('outputs', e => {
      if (!app.state) return;
      app.state.outputs = JSON.parse(e.data);
      renderStatus();
      if (window.BCSettings) window.BCSettings.onState('outputs');
    });
    es.addEventListener('extend-request', e => handleExtend(JSON.parse(e.data)));
    es.addEventListener('cue-next', e => window.BCCue && window.BCCue.onCueNext(JSON.parse(e.data)));
    es.addEventListener('song-downloaded', e => window.BCCue && window.BCCue.onSongDownloaded(JSON.parse(e.data)));
    es.addEventListener('song-inbox', e => window.BCCue && window.BCCue.onSongInbox(JSON.parse(e.data)));
    es.addEventListener('remote', e => window.BCRemote && window.BCRemote.onStatus(JSON.parse(e.data)));
    es.addEventListener('remote-cue', e => { const d = JSON.parse(e.data); if (window.BCCue) window.BCCue.sendItem(d.index); });
    es.addEventListener('songs', e => { const d = JSON.parse(e.data); if (window.BCLib) window.BCLib.onSongs(d); if (window.BCCue) window.BCCue.onSongs(d); });
    es.addEventListener('cues', e => window.BCCue && window.BCCue.onCues(JSON.parse(e.data)));
    es.onerror = () => {
      app.connected = false;
      $('#conn').hidden = false;
    };
  }

  // ---------------- 초기화 ----------------
  async function init2() {
    if (window.BCDock) window.BCDock.init(app);
    renderStudio();
    // 익명 사용 통계: 처음 한 번 알린다 (설정 → 정보에서 끄기)
    if (!app.state.settings.telemetryNotice) {
      setTimeout(() => showMsg('📊 사용자 수를 세려고 하루 한 번 익명 신호(무작위 설치 번호 · 버전 · 언어 · OS)를 보냅니다. 설정 → 정보에서 끌 수 있습니다.', 'info', 12000), 4000);
      cmd('updateSettings', { patch: { telemetryNotice: true } });
    }
    const b = await cmd('getBooks');
    app.books = b.ok ? b.result : [];
    fillVersions();
    syncControls();
    await loadStructure();
    renderPreview();
    renderQuick(true);
    if (window.BCCue) await window.BCCue.init();
    if (window.BCLib) window.BCLib.init();
    if (window.BCStage) window.BCStage.init();
    if (window.BCMedia) window.BCMedia.init();
    if (window.BCGrid) window.BCGrid.init();
    if (window.BCMenu) window.BCMenu.init();
    if (window.BCRemote) window.BCRemote.init();
    if (window.BCUiTheme) window.BCUiTheme.init();
    if (window.BCSlideEdit) window.BCSlideEdit.init();
    if (window.BCDrop) window.BCDrop.init();
    if (window.BCCtx) window.BCCtx.init();
    if (window.BCDraw) window.BCDraw.init();
    // 로딩 화면 닫기: 배치가 자리 잡은 뒤 (숨긴 창에서는 화면 그리기 신호가 없으므로 시간으로)
    setTimeout(() => cmd('uiReady'), 150);
    if (!app.state.versions.length) showWelcome();
    // 개역한글만 있으면(또는 아무것도 없으면) 베들레헴 설치 안내를 한 번 보여 준다
    else if (app.state.versions.length <= 1 && settings().uiLang !== 'en' && !(settings().guide && settings().guide.bethlehemDone)) showBethlehemGuide(); // 영어 화면에서는 안 보임 (한국어 성경 프로그램)
    if (app.state.portWarning) showMsg(app.state.portWarning, 'error', 0);
    $('#q').focus();
  }

  function fillVersions() {
    const sel = $('#version');
    const vs = app.state.versions;
    sel.innerHTML = vs.length ? vs.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('') : '<option value="">(성경 데이터 없음)</option>';
    sel.value = settings().versionId;
    // 병행 번역본 (두 번역 함께)
    const s2 = $('#version2');
    if (s2) {
      s2.innerHTML = '<option value="">병행: 없음</option>' + vs.map(v => `<option value="${esc(v.id)}">+ ${esc(v.name)}</option>`).join('');
      s2.value = settings().parallelVersionId || '';
      s2.hidden = vs.length < 2;
    }
  }

  function syncControls() {
    const s = settings();
    $('#mode').value = s.searchMode;
    $('#splitMode').value = s.split.mode === 'auto' ? 'auto' : String(Math.min(4, s.split.count));
    $('#navMode').value = s.navMode;
    if ($('#version').value !== s.versionId) $('#version').value = s.versionId;
    if ($('#version2') && $('#version2').value !== (s.parallelVersionId || '')) $('#version2').value = s.parallelVersionId || '';
  }

  async function loadStructure() {
    const r = await cmd('getStructure');
    app.structure = r.ok ? r.result.books : [];
    renderBooks();
  }

  /** 베들레헴 설치 안내 페이지 열기 (데스크톱은 기본 브라우저, 브라우저 실행은 새 탭) */
  async function openBethlehemSetup() {
    const r = await cmd('openBethlehemSetup');
    if (r.ok && !r.result.opened) window.open(r.result.url, '_blank');
    else if (r.ok) showMsg('기본 브라우저에서 베들레헴 설치 안내를 열었습니다.', 'ok', 2500);
    else showMsg(r.error, 'error');
  }
  app.openBethlehemSetup = openBethlehemSetup;

  /** 처음 실행 안내: 개역한글만 있을 때 베들레헴으로 다른 번역본을 추가하는 방법 */
  function showBethlehemGuide() {
    openModal('성경 번역본 추가 안내', `<div class="guide">
      <p>지금은 <b>개역한글</b>만 들어 있습니다. 개역개정 · 쉬운성경 · 우리말성경 · 현대인의성경 · ESV · NIV 등을 쓰려면 <b>베들레헴 성경</b>을 설치한 뒤 그 데이터를 가져오세요.</p>
      <ol>
        <li><b>베들레헴 성경 내려받기</b><br>
          <button id="gOpen" class="big">베들레헴 설치 안내 페이지 열기</button>
          <div class="note">안내 페이지에서 윈도우용 베들레헴을 내려받아 압축을 풉니다.</div></li>
        <li><b>BethlehemWin 폴더 복사</b><br>
          <div class="note">압축을 풀면 나오는 <b>BethlehemWin</b> 폴더를 통째로 <span class="url">C:\\BethlehemWin</span> 처럼 드라이브 맨 위에 복사합니다. (Program Files 안은 피하세요)</div></li>
        <li><b>WorshipCue 로 가져오기</b><br>
          <button id="gFind" class="big send">베들레헴 자동으로 찾기</button>
          <div class="note">찾은 번역본을 체크하고 [선택한 번역본 가져오기]를 누르면 끝입니다. 나중에 설정 → 성경 데이터에서도 할 수 있습니다.</div></li>
      </ol>
      <div class="row-flex" style="justify-content:flex-end;margin-top:14px">
        <label class="tc-toggle"><input type="checkbox" id="gNever"> 다시 보지 않기</label>
        <button id="gLater">다음에 하기</button>
      </div></div>`);
    const done = async () => { if ($('#gNever')?.checked) await cmd('updateSettings', { patch: { guide: { bethlehemDone: true } } }); };
    $('#gOpen').onclick = openBethlehemSetup;
    $('#gFind').onclick = async () => { await done(); closeModal(); window.BCSettings.open('data'); setTimeout(() => $('#bhFind')?.click(), 50); };
    $('#gLater').onclick = async () => { await done(); closeModal(); };
  }
  app.showBethlehemGuide = showBethlehemGuide;

  function showWelcome() {
    $('#resultTitle').textContent = '시작하기';
    $('#resultInfo').textContent = '';
    $('#results').innerHTML = `<div class="welcome">
      성경 데이터가 아직 없습니다.<br>
      <b>베들레헴 성경</b>(bethlehembible.org)을 설치했다면 <b>설정 → 성경 데이터 → 자동으로 찾기</b>로 개역개정 등을 한 번에 가져올 수 있습니다.<br>
      그 밖에 사용 허가를 확인한 번역본 파일(JSON · CSV · Zefania XML · .bdb)도 가져올 수 있습니다.<br><br>
      <button id="goImport">성경 데이터 가져오기</button></div>`;
    $('#goImport').onclick = () => window.BCSettings.open('data');
  }

  // ---------------- 책·장 목록 ----------------
  function renderBooks() {
    const f = $('#bookFilter').value.trim();
    const list = app.structure.filter(b => !f || b.name.includes(f) || b.short.startsWith(f));
    let html = '';
    let lastT = '';
    for (const b of list) {
      if (b.testament !== lastT) { html += `<div class="grp">${b.testament === 'OT' ? '구약' : '신약'}</div>`; lastT = b.testament; }
      html += `<button data-book="${b.id}" class="${app.selectedBook === b.id ? 'on' : ''}">${esc(b.name)}<span class="ab">${esc(b.short)}</span></button>`;
    }
    $('#bookList').innerHTML = html || '<div class="grp">없음</div>';
  }

  function selectBook(id, focusGrid) {
    const b = app.structure.find(x => x.id === id);
    if (!b) return;
    app.selectedBook = id;
    renderBooks();
    $('#chapterBox').hidden = false;
    $('#chapterTitle').textContent = `${b.name} (${b.chapters.length}장)`;
    $('#chapterGrid').innerHTML = b.chapters.map((n, i) => `<button data-ch="${i + 1}" title="${i + 1}장 · ${n}절">${i + 1}</button>`).join('');
    if (focusGrid) $('#chapterGrid button')?.focus();
  }

  $('#bookList').addEventListener('click', e => {
    const btn = e.target.closest('button[data-book]');
    if (btn) selectBook(+btn.dataset.book, true);
  });
  $('#bookFilter').addEventListener('input', renderBooks);
  $('#bookFilter').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = $('#bookList button[data-book]');
      if (first) selectBook(+first.dataset.book, true);
      e.preventDefault();
    }
  });
  $('#chapterGrid').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-ch]');
    if (!btn) return;
    const b = app.structure.find(x => x.id === app.selectedBook);
    const r = await cmd('getChapter', { bookId: app.selectedBook, chapter: +btn.dataset.ch });
    if (!r.ok) return showMsg(r.error, 'error');
    $('#q').value = `${b.short}${btn.dataset.ch}`;
    // 장은 절 목록만 띄운다 — 미리보기는 절을 눌렀을 때
    showPassageList(r.result.passage);
    // 격자·전체 보기·주석이었으면 절이 보이는 '목록' 으로
    if (window.BCGrid && window.BCGrid.mode() !== 'list') window.BCGrid.set('list');
    if (!$('#cmView').hidden) $('#centerTabs [data-c=text]').click();
  });
  $('#chapterGrid').addEventListener('keydown', e => {
    const btns = [...$('#chapterGrid').querySelectorAll('button')];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    const cols = Math.max(1, Math.round($('#chapterGrid').clientWidth / (btns[0].offsetWidth + 4)));
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (d) { btns[Math.max(0, Math.min(btns.length - 1, i + d))].focus(); e.preventDefault(); }
  });

  // ---------------- 미리보기 ----------------
  /** 미디어 패널 등: 슬라이드를 미리보기 없이 바로 송출 */
  app.sendSlidesLive = async (title, slides, index = 0) => {
    if (window.BCLib) window.BCLib.audio.onVisualSend();
    return cmd('sendLive', { passage: passageMeta({ title, verses: [] }, title), slides, index });
  };
  function passageMeta(p, query) {
    const v = p.verses || [];
    const cue = app.preview && app.preview.passage === p ? app.preview.cue : null;
    const cueMeta = cue ? { cueId: cue.id, cueIndex: cue.index, itemTitle: cue.title, note: cue.note || '', itemType: cue.type || '', credit: cue.credit || '', ...(cue.auto ? { auto: cue.auto } : {}) } : {};
    const tpl = app.preview && app.preview.passage === p && app.preview.tpl ? { tpl: app.preview.tpl } : {};
    if (!v.length) return { title: p.title, versionId: '', versionName: p.versionName || '', book: null, query: query || p.title, first: null, last: null, ...cueMeta, ...tpl };
    return {
      ...cueMeta, ...tpl,
      title: p.title, versionId: p.versionId, versionName: p.versionName, book: p.book, query: query || p.title,
      first: { chapter: v[0].chapter, verse: v[0].verse }, last: { chapter: v[v.length - 1].chapter, verse: v[v.length - 1].verse },
    };
  }

  function splitOpts(over = pvOver()) {
    const s = settings();
    return { mode: s.split.mode, count: s.split.count, templates: [tplFor('main', over), tplFor('overlay', over)] };
  }

  /** 본문을 미리보기로 불러온다 (Live 영향 없음) */
  /** 병행 번역본이 정해져 있으면 같은 범위의 다른 번역을 절마다 붙인다 */
  async function withParallel(passage) {
    const pv = settings().parallelVersionId;
    if (!pv || pv === passage.versionId || passage.parallel === pv || !passage.book || !passage.verses.length) return passage;
    const a = passage.verses[0], b = passage.verses[passage.verses.length - 1];
    const r = await cmd('parallelVerses', { versionId: pv, bookId: passage.book.id, sc: a.chapter, sv: a.verse, ec: b.chapter, ev: b.verse });
    if (!r.ok) return passage;
    const map = new Map(r.result.verses.map(v => [v.chapter * 1000 + v.verse, v.text]));
    return { ...passage, parallel: pv, versionName: `${passage.versionName} · ${r.result.versionName}`, verses: passage.verses.map(v => ({ ...v, text2: map.get(v.chapter * 1000 + v.verse) || '' })) };
  }
  app.withParallel = withParallel;

  async function loadPassage(passage, { query = '', focus = null, index = 0, keepList = false, tpl = null, bg = '', post = null } = {}) {
    passage = await withParallel(passage);
    let slides = withBg(SL.build(passage, splitOpts(tpl)), bg);
    if (post) slides = post(slides); // 큐시트 순서: 덧붙인 슬라이드·건너뛰기·꾸미기
    if (focus) index = SL.indexOfVerse(slides, focus.chapter, focus.verse);
    app.preview = { passage, slides, index: Math.min(index, slides.length - 1), query, tpl, bg, post };
    renderPreview();
    if (!keepList && (app.results.type !== 'text' || !focus)) showPassageList(passage);
    else markResults();
    const r = await cmd('setPreview', { passage: passageMeta(passage, query), slides, index: app.preview.index });
    if (!r.ok) showMsg(r.error, 'error');
    else await directSend();
  }
  app.loadPassage = loadPassage;
  /** 순서별 배경 이미지를 글자 슬라이드에 */
  function withBg(slides, bg) { if (bg) slides.forEach(x => { x.bg = bg; }); return slides; }

  /**
   * 미리 만든 슬라이드를 미리보기로 (큐시트의 가사·공지·제목·이미지 항목)
   * rebuild: 템플릿이 바뀌었을 때 다시 나누는 함수
   */
  async function loadSlides(pseudo, slides, { query = '', index = 0, cue = null, rebuild = null, tpl = null } = {}) {
    app.preview = { passage: pseudo, slides, index: Math.max(0, Math.min(index, slides.length - 1)), query, cue, rebuild, tpl };
    renderPreview();
    const r = await cmd('setPreview', { passage: passageMeta(pseudo, query), slides, index: app.preview.index });
    if (!r.ok) showMsg(r.error, 'error');
    else await directSend();
  }
  app.loadSlides = loadSlides;

  // ---------------- 미리보기 끔 (바로 송출) ----------------
  // OBS 의 스튜디오 모드 끄기처럼, 사용자가 클릭·키로 고른 본문·순서·슬라이드를 바로 송출한다.
  // (프로그램을 켤 때 등 사용자가 조작하지 않은 미리보기는 송출하지 않는다)
  let lastUserAct = 0;
  ['pointerdown', 'keydown'].forEach(t => window.addEventListener(t, () => { lastUserAct = Date.now(); }, true));
  const directMode = () => !!(app.state && app.state.settings.previewMode === false);
  async function directSend() {
    if (directMode() && !app.holdDirect && Date.now() - lastUserAct < 2500) await sendPreview(); // 큐시트 목록에서 고른 것은 송출하지 않음
  }
  /** 슬라이드 단추 글: '3. 후렴' (이름이 번호와 같으면 번호만) */
  const chipLabel = (i, t) => (t && String(t) !== String(i + 1) ? `${i + 1}. ${t}` : String(i + 1));
  /** 슬라이드 단추 그룹 색 (1절 파랑 · 후렴 빨강 …) */
  const chipStyle = label => { const c = window.BCGroup && window.BCGroup.color(label); return c ? ` style="--gc:${c}"` : ''; };
  function renderStudio() {
    const b = $('#btnStudio');
    if (!b || !app.state) return;
    const on = !directMode();
    b.textContent = on ? '미리보기 켜짐' : '미리보기 끔 · 바로 송출';
    b.classList.toggle('on', on);
    b.classList.toggle('off', !on);
  }
  app.renderStudio = renderStudio;
  $('#btnStudio').onclick = async () => {
    const next = directMode(); // 지금 끔이면 켠다
    const r = await cmd('updateSettings', { patch: { previewMode: next } });
    if (!r.ok) return showMsg(r.error, 'error');
    if (window.BCDock) { if (next) window.BCDock.show('preview'); else window.BCDock.hide('preview'); }
    renderStudio();
    showMsg(next ? '미리보기를 켰습니다. 고른 본문은 미리보기에 놓이고 F9 로 송출합니다.' : '미리보기를 껐습니다. 이제 클릭한 본문·순서·슬라이드가 바로 송출됩니다.', next ? 'ok' : 'info', 3500);
  };
  app.splitOpts = over => splitOpts(over === undefined ? pvOver() : over);

  /** 템플릿·분할 설정이 바뀌면 미리보기를 다시 분할 (Live 는 그대로) */
  function rebuildPreview() {
    if (!app.preview) { renderPreview(); return; }
    const cur = app.preview.slides[app.preview.index]?.parts[0];
    if (app.preview.rebuild) { // 가사·공지 등: 그 항목의 방식으로 다시 나눔
      const keep = app.preview.index;
      app.preview.slides = app.preview.rebuild();
      app.preview.index = Math.min(keep, app.preview.slides.length - 1);
      renderPreview();
      cmd('setPreview', { passage: passageMeta(app.preview.passage, app.preview.query), slides: app.preview.slides, index: app.preview.index });
      return;
    }
    let slides = withBg(SL.build(app.preview.passage, splitOpts()), app.preview.bg);
    if (app.preview.post) slides = app.preview.post(slides);
    app.preview.slides = slides;
    app.preview.index = cur ? SL.indexOfVerse(slides, cur.chapter, cur.verse) : 0;
    renderPreview();
    markResults();
    cmd('setPreview', { passage: passageMeta(app.preview.passage, app.preview.query), slides, index: app.preview.index });
  }

  app.setPreviewIndex = i => setPreviewIndex(i);
  /** 미리보기 한 장 앞·뒤로. 큐시트 순서의 끝(처음)이면 다음(이전) 순서로 — '순서의 끝에서 다음 순서로' 설정을 따른다 */
  function stepPreview(d) {
    const p = app.preview;
    if (!p) return;
    const ni = p.index + d;
    if (ni >= 0 && ni < p.slides.length) return setPreviewIndex(ni);
    if (p.cue && settings().cueAdvance !== false && window.BCCue && window.BCCue.previewStep) return window.BCCue.previewStep(d);
  }
  app.stepPreview = stepPreview;
  function setPreviewIndex(i) {
    if (!app.preview) return;
    const n = app.preview.slides.length;
    const ni = Math.max(0, Math.min(n - 1, i));
    if (ni === app.preview.index) return;
    app.preview.index = ni;
    renderPreview();
    markResults();
    cmd('setPreviewIndex', { index: ni }).then(r => { if (r.ok) directSend(); });
  }

  function slideSnippet(s) {
    if (s.kind === 'title') return [s.ref, s.subtitle].filter(Boolean).join(' · ');
    if (s.kind === 'image') return '이미지';
    if (s.kind === 'video') return '🎬 영상';
    if (s.kind === 'blank') return s.mode === 'background' ? '배경만' : '검은 화면';
    let t = s.parts.map(p => (window.BCGroup ? window.BCGroup.stripFmt(p.text) : p.text)).join(' ');
    if (window.BCGroup) t = window.BCGroup.stripChords(t).replace(/\s{2,}/g, ' ');
    return t.length > 46 ? t.slice(0, 46) + '…' : t;
  }

  // 미리보기의 카메라는 잠시만 산 영상으로 보여 주고, 그 뒤엔 마지막 장면(정지 그림)으로 바꿔 카메라를 놓는다
  // (미리보기에 카메라 순서를 골라 두면 조작 PC 에서 카메라가 계속 켜져 있던 문제). 송출 중이면 LIVE 칸이 계속 쓴다
  const CAM_PREVIEW_MS = 20000;
  let camFreezeTimer = 0;
  function freezePreviewCams(scr) {
    clearTimeout(camFreezeTimer);
    if (!scr.querySelector('video[data-cam]')) return;
    camFreezeTimer = setTimeout(() => {
      if (!scr.isConnected) return;
      scr.querySelectorAll('video[data-cam]').forEach(v => {
        const c = document.createElement('canvas');
        c.width = v.videoWidth || 16; c.height = v.videoHeight || 9;
        try { c.getContext('2d').drawImage(v, 0, 0); } catch { /* 아직 영상 없음 */ }
        const box = document.createElement('div');
        box.className = 'bc-cam-frozen';
        box.title = '카메라 미리보기를 멈추고 카메라를 놓았습니다 (조작 PC 카메라 불 끄기). 누르면 다시 봅니다';
        box.style.cssText = v.style.cssText;
        c.style.cssText = `width:100%;height:100%;object-fit:${v.style.objectFit || 'cover'}`;
        box.append(c, Object.assign(document.createElement('span'), { className: 'bc-cam-frozen-tag', textContent: '📷 정지 화면 — 누르면 다시 보기' }));
        box.onclick = e => { e.stopPropagation(); renderPreview(); };
        v.replaceWith(box);
      });
    }, window.WC_CAM_PREVIEW_MS || CAM_PREVIEW_MS); // 시험(e2e)에서는 짧게
  }

  function renderPreview() {
    const scr = $('#pvScreen');
    if (!app.state) return;
    const tpl = tplFor(app.view.pv, pvOver());
    const p = app.preview;
    if (!p) {
      R.renderInto(scr, null, tpl, { checker: true, overlays: overlaysFor(app.view.pv) });
      scr.insertAdjacentHTML('beforeend', '<div class="ph">검색한 본문이 여기에 표시됩니다</div>');
      $('#pvInfo').textContent = '';
      $('#pvCount').textContent = '';
      $('#pvNextHint').textContent = '';
      $('#pvSlides').innerHTML = '';
      return;
    }
    const slide = p.slides[p.index];
    R.renderInto(scr, slide, tpl, { checker: true, versionName: p.passage.versionName, overlays: overlaysFor(app.view.pv) });
    freezePreviewCams(scr);
    $('#pvInfo').textContent = [p.passage.title, p.passage.versionName].filter(Boolean).join(' · ');
    $('#pvCount').textContent = `${p.index + 1} / ${p.slides.length}`;
    const nx = p.slides[p.index + 1];
    $('#pvNextHint').innerHTML = nx ? `다음: <b>${esc(nx.ref)}</b> ${esc(slideSnippet(nx))}` : '<span>마지막 슬라이드</span>';
    $('#pvSlides').innerHTML = p.slides.map((s, i) => `<button data-i="${i}" class="${i === p.index ? 'on' : ''}"${s.kind !== 'bible' ? chipStyle(s.label) : ''} title="${esc(slideSnippet(s))}">${esc(chipLabel(i, s.label || shortRef(s.ref) || slideSnippet(s).slice(0, 12)))}</button>`).join('');
    $('#pvSlides button.on')?.scrollIntoView({ block: 'nearest' });
    updateCommentary();
    if (window.BCGrid) window.BCGrid.update();
  }

  function shortRef(ref) {
    return ref.replace(/^\S+\s/, '');
  }

  $('#pvSlides').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (b) setPreviewIndex(+b.dataset.i);
  });
  // 미리보기 슬라이드 번호를 더블클릭하면 그 슬라이드를 바로 송출
  $('#pvSlides').addEventListener('dblclick', e => {
    const b = e.target.closest('button[data-i]');
    if (b) { setPreviewIndex(+b.dataset.i); sendPreview(); }
  });
  $('#pvPrev').onclick = () => setPreviewIndex((app.preview?.index ?? 0) - 1);
  $('#pvNext').onclick = () => setPreviewIndex((app.preview?.index ?? 0) + 1);

  // ---------------- Live 모니터 ----------------
  function renderLive() {
    if (!app.state) return;
    const live = app.state.live;
    const tpl = tplFor(app.view.lv, lvOver());
    const pane = $('.pane.live');
    pane.classList.toggle('is-hidden', live.hasLive && !live.visible);
    $('#lvHidden').hidden = !(live.hasLive && !live.visible);
    if (!live.hasLive) {
      R.renderInto($('#lvScreen'), null, tpl, { checker: true, overlays: overlaysFor(app.view.lv), layers: app.state.layers });
      renderLayerButtons();
      $('#lvScreen').insertAdjacentHTML('beforeend', '<div class="ph">송출 중인 본문 없음</div>');
      $('#lvInfo').textContent = '';
      $('#lvCount').textContent = '';
      $('#lvNextHint').textContent = '';
      $('#lvSlides').innerHTML = '';
      return;
    }
    R.renderInto($('#lvScreen'), live.slide, tpl, { checker: true, hidden: !live.visible, versionName: live.passage.versionName, overlays: overlaysFor(app.view.lv), layers: app.state.layers });
    app.lvTpl = tpl;
    if (window.BCDraw) window.BCDraw.paintLive(); // 화면에 그린 것
    $('#lvInfo').textContent = [live.passage.cueIndex >= 0 && live.slide.kind !== 'bible' ? live.passage.itemTitle || live.slide.ref : live.slide.ref, live.passage.versionName].filter(Boolean).join(' · ');
    $('#lvCount').textContent = `${live.index + 1} / ${live.count}`;
    const nx = live.nextSlide;
    const hasJump = liveLabels();
    $('#lvNextHint').title = hasJump ? '찬양 바로 가기: 1~9 = 절 · C = 후렴 · B = 브릿지 · E = 엔딩' : '';
    $('#lvNextHint').innerHTML = (hasJump ? '<span class="jump-hint">⌨ 1~9·C·B</span> ' : '') + (nx ? `다음: <b>${esc(nx.ref)}</b> ${esc(slideSnippet(nx))}`
      : settings().navMode === 'continuous' ? '범위 끝 — F6을 누르면 다음 절로 이어갑니다' : '마지막 슬라이드');
    $('#lvSlides').innerHTML = live.slides.map((ref, i) => `<button data-i="${i}" class="${i === live.index ? 'on' : ''}"${ref.startsWith('¶') ? chipStyle(ref.slice(1)) : ''}>${esc(chipLabel(i, ref.startsWith('¶') ? ref.slice(1) : shortRef(ref)))}</button>`).join('');
    $('#lvSlides button.on')?.scrollIntoView({ block: 'nearest' });
    renderVideoBar();
    renderLayerButtons();
    if (window.BCGrid) window.BCGrid.update();
  }
  // ---------------- 영상 재생 조작 (LIVE 아래) ----------------
  const fmtT = t => (isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00');
  function renderVideoBar() {
    const live = app.state.live;
    const on = !!(live.hasLive && live.slide && live.slide.kind === 'video' && live.video);
    const bar = $('#lvVideo');
    if (bar.hidden === on && window.BCDock) requestAnimationFrame(() => window.BCDock.fitScreens()); // 막대가 생기거나 사라지면 화면 크기 다시 맞춤
    bar.hidden = !on;
    if (!on) return;
    bar.querySelector('[data-v=toggle]').textContent = live.video.playing ? '❚❚' : '▶';
    // LIVE 모니터의 영상도 같은 위치로 (소리 없음)
    const v = $('#lvScreen video.bc-play');
    if (v) R.syncVideo(v, live.video, { sound: false, loop: !!(live.slide.video && live.slide.video.loop) });
  }
  setInterval(() => {
    const bar = $('#lvVideo');
    if (!bar || bar.hidden) return;
    const v = $('#lvScreen video.bc-play');
    const st = app.state.live.video;
    if (!v || !st) return;
    const pos = st.offset + (st.playing ? (Date.now() - (Date.now() - (st.now || Date.now())) - st.at) / 1000 : 0);
    const dur = v.duration || 0;
    const seek = bar.querySelector('[data-seek]');
    if (!seek.matches(':active')) seek.value = dur ? Math.min(1, pos / dur) : 0;
    bar.querySelector('[data-time]').textContent = `${fmtT(Math.min(pos, dur || pos))} / ${fmtT(dur)}`;
  }, 250);
  $('#lvVideo').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) cmd('videoControl', { action: b.dataset.v }); });
  $('#lvVideo [data-seek]').addEventListener('change', e => {
    const v = $('#lvScreen video.bc-play');
    if (v && v.duration) cmd('videoControl', { action: 'seek', time: e.target.value * v.duration });
  });

  // LIVE 슬라이드 단추: 한 번 누르면 그 슬라이드로 (이미 송출 중인 것 안에서 이동)
  $('#lvSlides').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (b) cmd('gotoSlide', { index: +b.dataset.i });
  });

  // 미리보기/Live 화면 보기 전환 (예배당 / OBS 템플릿)
  document.querySelectorAll('.view-tabs').forEach(vt => vt.addEventListener('click', e => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    app.view[vt.dataset.pane] = b.dataset.view;
    vt.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    vt.dataset.pane === 'pv' ? renderPreview() : renderLive();
  }));

  const ro = new ResizeObserver(() => { renderPreview(); renderLive(); });
  ro.observe($('#panelPreview')); ro.observe($('#panelLive'));

  // ---------------- 주석 (조작 화면 참고용) ----------------
  const cm = { tab: 'text', key: '', items: [], timer: null };
  $('#centerTabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-c]');
    if (!b) return;
    cm.tab = b.dataset.c;
    $('#centerTabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('#results').hidden = cm.tab !== 'text';
    $('#cmView').hidden = cm.tab !== 'cm';
    if (cm.tab === 'cm') renderCommentary();
    if (window.BCGrid) window.BCGrid.update();
  });

  /** 미리보기 본문이 바뀌면 그 범위의 주석을 불러온다 */
  function updateCommentary() {
    clearTimeout(cm.timer);
    cm.timer = setTimeout(async () => {
      if (!app.state || !(app.state.commentaries || []).length || !app.preview) { cm.items = []; $('#cmCount').textContent = ''; renderCommentary(); return; }
      const v = app.preview.passage.verses || [];
      if (!v.length) { cm.items = []; cm.key = ''; $('#cmCount').textContent = ''; renderCommentary(); return; }
      const a = v[0], b = v[v.length - 1];
      const key = `${a.book}:${a.chapter}:${a.verse}-${b.chapter}:${b.verse}`;
      if (key !== cm.key) {
        cm.key = key;
        const r = await cmd('commentaryFor', { book: a.book, sc: a.chapter, sv: a.verse, ec: b.chapter, ev: b.verse });
        cm.items = r.ok ? r.result : [];
      }
      $('#cmCount').textContent = cm.items.length ? `(${cm.items.length})` : '';
      renderCommentary();
    }, 120);
  }

  function renderCommentary() {
    const el = $('#cmView');
    if (cm.tab !== 'cm') return;
    if (!(app.state.commentaries || []).length) {
      el.innerHTML = '<div class="empty">설치된 주석이 없습니다.<br>설정 → 성경 데이터에서 주석서(EPUB)를 가져오세요.</div>';
      return;
    }
    if (!app.preview) { el.innerHTML = '<div class="empty">본문을 검색하면 그 범위의 주석이 여기에 나옵니다.</div>'; return; }
    if (!cm.items.length) { el.innerHTML = '<div class="empty">이 범위에 해당하는 주석 항목이 없습니다.</div>'; return; }
    const slide = app.preview.slides[app.preview.index];
    const sKeys = slide ? slide.parts.map(p => p.chapter * 1000 + p.verse) : [];
    const sMin = Math.min(...sKeys), sMax = Math.max(...sKeys);
    const span = it => it.sc === it.ec ? (it.sv === it.ev ? `${it.sc}:${it.sv}` : `${it.sc}:${it.sv}-${it.ev}`) : `${it.sc}:${it.sv}-${it.ec}:${it.ev}`;
    let lastName = '';
    el.innerHTML = cm.items.map((it, i) => {
      const hit = it.s <= sMax && it.e >= sMin;
      const head = it.cname !== lastName ? `<div class="heading">${esc(it.cname)} · 조작 화면 참고용 (송출되지 않음)</div>` : '';
      lastName = it.cname;
      return head + `<div class="cm-item ${it.kind} ${hit ? 'hit' : ''}" data-i="${i}">
        <div class="cm-ref">${it.kind === 'article' ? '📘 ' : ''}${span(it)}${it.title ? ` <b>${esc(it.title)}</b>` : ''}</div>
        <div class="cm-text">${esc(it.text)}</div></div>`;
    }).join('');
    el.querySelector('.cm-item.hit')?.scrollIntoView({ block: 'nearest' });
  }
  $('#cmView').addEventListener('click', e => {
    const it = e.target.closest('.cm-item');
    if (it) it.classList.toggle('open'); // 긴 글 펼치기/접기
  });

  // ---------------- 결과 목록 ----------------
  function showPassageList(passage) {
    app.results = { type: 'passage', items: passage.verses, sel: -1, passage, anchor: null, range: null };
    $('#resultTitle').textContent = passage.title;
    $('#resultInfo').textContent = `${passage.verses.length}절 · ${passage.versionName}`;
    const hmap = new Map();
    for (const h of passage.headings || []) hmap.set(h.chapter * 1000 + h.verse, h.text);
    let lastCh = null;
    const multiCh = passage.verses[0].chapter !== passage.verses[passage.verses.length - 1].chapter;
    $('#results').innerHTML = passage.verses.map((v, i) => {
      let pre = '';
      if (multiCh && v.chapter !== lastCh) pre += `<div class="heading">${v.chapter}장</div>`;
      lastCh = v.chapter;
      const h = hmap.get(v.chapter * 1000 + v.verse);
      if (h) pre += `<div class="heading">${esc(h)}</div>`;
      return pre + `<div class="row prow" data-i="${i}" data-c="${v.chapter}" data-v="${v.verse}"><span class="vn">${multiCh ? v.chapter + ':' : ''}${v.verse}</span>${esc(v.text)}</div>`;
    }).join('');
    markResults();
  }

  function highlight(text, terms) {
    let html = esc(text);
    for (const t of terms) {
      const chars = [...t.replace(/\s+/g, '')].map(c => esc(c).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      if (!chars.length) continue;
      html = html.replace(new RegExp(chars.join('\\s*'), 'g'), m => `<mark>${m}</mark>`);
    }
    return html;
  }

  function showTextResults(r, query) {
    app.results = { type: 'text', items: r.results, sel: r.results.length ? 0 : -1, terms: r.terms, query };
    $('#resultTitle').textContent = `“${query}” 본문 검색`;
    $('#resultInfo').textContent = `${r.results.length}${r.truncated ? '+' : ''}건`;
    if (!r.results.length) {
      $('#results').innerHTML = '<div class="empty">검색 결과가 없습니다.<br>다른 단어나 더 짧은 단어로 검색해 보세요.</div>';
      return;
    }
    $('#results').innerHTML = r.results.map((x, i) =>
      `<div class="row" data-i="${i}"><span class="ref">${esc(x.bookShort)}${x.chapter}:${x.verse}</span>${highlight(x.text, r.terms)}</div>`).join('')
      + (r.truncated ? '<div class="empty">결과가 많아 일부만 표시합니다. 검색어를 더 구체적으로 입력하세요.</div>' : '');
    markResults();
  }

  /** 미리보기 중인 절, 송출 중인 절, 선택 행 표시 */
  function markResults() {
    const rows = document.querySelectorAll('#results .row');
    if (!rows.length) return;
    const pvSlide = app.preview?.slides[app.preview.index];
    const pvKeys = new Set(pvSlide ? pvSlide.parts.map(p => `${p.book}:${p.chapter}:${p.verse}`) : []);
    const live = app.state?.live;
    const lvKeys = new Set(live?.hasLive && live.visible ? live.slide.parts.map(p => `${p.book}:${p.chapter}:${p.verse}`) : []);
    rows.forEach(row => {
      const i = +row.dataset.i;
      const it = app.results.items[i];
      const key = `${it.book}:${it.chapter}:${it.verse}`;
      row.classList.toggle('in-pv', pvKeys.has(key));
      row.classList.toggle('on-air', lvKeys.has(key));
      row.classList.toggle('sel', i === app.results.sel);
      const rg = app.results.range;
      row.classList.toggle('in-range', !!rg && i >= rg[0] && i <= rg[1]);
    });
    if (app.results.type === 'passage') {
      const rg = app.results.range;
      const p = app.results.passage;
      $('#resultInfo').textContent = rg
        ? `선택 ${rg[1] - rg[0] + 1}절 (${app.preview?.passage.title.replace(/^\S+\s/, '') || ''}) · Shift+클릭으로 범위 조정`
        : `${p.verses.length}절 · ${p.versionName}`;
    }
    if (app.results.type === 'passage' && pvSlide) {
      const first = document.querySelector('#results .row.in-pv');
      if (first && document.activeElement !== $('#results')) first.scrollIntoView({ block: 'nearest' });
    }
  }

  function selectResult(i, { preview = false } = {}) {
    const n = app.results.items.length;
    if (!n) return;
    app.results.sel = Math.max(0, Math.min(n - 1, i));
    markResults();
    document.querySelector(`#results .row[data-i="${app.results.sel}"]`)?.scrollIntoView({ block: 'nearest' });
    if (preview) return activateResult(app.results.sel);
  }

  // ---- Shift 범위 지정: 목록은 그대로 두고, 고른 절들만 미리보기로 ----
  function rangePassage(full, a, b) {
    const verses = full.verses.slice(a, b + 1);
    const keys = new Set(verses.map(v => v.chapter * 1000 + v.verse));
    const f = verses[0], l = verses[verses.length - 1];
    const span = f.chapter === l.chapter
      ? (f.verse === l.verse ? `${f.chapter}:${f.verse}` : `${f.chapter}:${f.verse}-${l.verse}`)
      : `${f.chapter}:${f.verse}-${l.chapter}:${l.verse}`;
    return {
      ...full, verses, title: `${full.book.name} ${span}`, short: `${full.book.short}${span}`,
      headings: (full.headings || []).filter(h => keys.has(h.chapter * 1000 + h.verse)),
      ranges: [{ sc: f.chapter, sv: f.verse, ec: l.chapter, ev: l.verse }],
    };
  }

  async function selectRange(i) {
    const R = app.results;
    if (R.type !== 'passage') return selectResult(i, { preview: true });
    const n = R.items.length;
    i = Math.max(0, Math.min(n - 1, i));
    if (R.anchor == null) R.anchor = R.sel >= 0 ? R.sel : i;
    R.range = [Math.min(R.anchor, i), Math.max(R.anchor, i)];
    R.sel = i;
    const sub = rangePassage(R.passage, R.range[0], R.range[1]);
    $('#q').value = sub.short;
    document.querySelector(`#results .row[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
    await loadPassage(sub, { query: sub.short, keepList: true });
    return true;
  }

  /** 범위 지정을 풀고 목록 전체를 다시 미리보기로 (그 절이 들어 있는 슬라이드) */
  async function clearRange(it) {
    const R = app.results;
    R.range = null;
    $('#q').value = R.passage.title;
    await loadPassage(R.passage, { query: R.passage.title, focus: it, keepList: true });
  }

  async function activateResult(i) {
    const it = app.results.items[i];
    if (!it) return false;
    if (app.results.type === 'passage') {
      const inPreview = !!app.preview && app.preview.passage.verses.some(v => v.book === it.book && v.chapter === it.chapter && v.verse === it.verse);
      if (!inPreview) { await clearRange(it); return true; }
      setPreviewIndex(SL.indexOfVerse(app.preview.slides, it.chapter, it.verse));
      return true;
    }
    // 본문 검색 결과 → 그 절을 미리보기
    const r = await cmd('getRange', { bookId: it.book, sc: it.chapter, sv: it.verse, ec: it.chapter, ev: it.verse });
    if (!r.ok) { showMsg(r.error, 'error'); return false; }
    await loadPassage(r.result.passage, { query: `${it.bookShort}${it.chapter}:${it.verse}`, focus: it });
    return true;
  }

  // 한 번 클릭: 미리보기 / 더블클릭: 그 절이 들어 있는 슬라이드를 바로 송출
  let lastActivate = Promise.resolve(true);
  // Shift+클릭: 처음 클릭한 절부터 여기까지를 범위로 미리보기
  $('#results').addEventListener('click', e => {
    const row = e.target.closest('.row[data-i]');
    if (!row) return;
    const i = +row.dataset.i;
    const R = app.results;
    if (e.shiftKey && R.type === 'passage') { lastActivate = selectRange(i); return; }
    if (R.type === 'passage') {
      R.anchor = i;
      // 범위 밖을 클릭하면 범위 해제, 범위 안이면 범위 유지(더블클릭 송출 포함)
      if (R.range && (i < R.range[0] || i > R.range[1])) { R.sel = i; lastActivate = clearRange(R.items[i]); return; }
    }
    lastActivate = selectResult(i, { preview: true });
  });
  $('#results').addEventListener('dblclick', async e => {
    const row = e.target.closest('.row[data-i]');
    if (!row) return;
    window.getSelection()?.removeAllRanges(); // 더블클릭으로 선택된 글자 해제
    await lastActivate; // 클릭으로 시작한 미리보기 불러오기가 끝난 뒤
    if (await activateResult(+row.dataset.i)) await sendPreview();
  });
  $('#results').addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    // Shift+↑/↓: 범위 늘리기·줄이기
    if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && app.results.type === 'passage') {
      const R = app.results;
      if (R.sel < 0) R.sel = 0;
      if (R.anchor == null) R.anchor = R.sel;
      selectRange(R.sel + (e.key === 'ArrowDown' ? 1 : -1));
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (app.results.type === 'passage') app.results.anchor = null; // 일반 이동은 범위 기준점 초기화
    }
    if (e.key === 'ArrowDown') { selectResult(app.results.sel + 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') {
      if (app.results.sel <= 0) { $('#q').focus(); } else selectResult(app.results.sel - 1);
      e.preventDefault();
    } else if (e.key === 'Enter') { activateResult(app.results.sel); e.preventDefault(); }
  });

  // ---------------- 검색 ----------------
  /** @returns {Promise<boolean>} 미리보기를 불러왔으면 true */
  async function doSearch() {
    hideSuggest();
    const q = $('#q').value.trim();
    if (!q) return false;
    if (!settings().versionId) { showMsg('성경 데이터가 없습니다. 설정에서 가져오세요.', 'error'); return false; }
    const mode = settings().searchMode;
    if (mode === 'reference' || (mode === 'auto' && /\d/.test(q))) {
      const r = await cmd('searchReference', { query: q });
      if (r.ok) {
        await loadPassage(r.result.passage, { query: q });
        return true;
      }
      if (r.ambiguous) { showCandidates(r); return false; }
      if (r.incomplete && r.book) { selectBook(r.book.id, false); showMsg(r.error, 'info'); return false; }
      if (mode === 'reference' || r.book) { showMsg(r.error + ' — 현재 송출 화면은 그대로 유지됩니다.', 'error', 6000); return false; }
      // 책 이름이 아니면 본문 검색으로
    }
    const t = await cmd('searchText', { query: q });
    if (!t.ok) { showMsg(t.error, 'error'); return false; }
    showTextResults(t.result, q);
    if (t.result.results.length) $('#results').focus();
    return false;
  }

  function showCandidates(r) {
    const items = r.candidates.map(c => ({ label: `${c.name}`, sub: `${c.short}${r.rest || ''}`, act: () => { $('#q').value = c.short + (r.rest || ''); doSearch(); } }));
    openSuggest(items, r.error);
  }

  // 입력 중 후보 제시
  let sugTimer = null;
  let sugSeq = 0;
  $('#q').addEventListener('input', () => {
    clearTimeout(sugTimer);
    sugTimer = setTimeout(updateSuggest, 120);
  });

  async function updateSuggest() {
    const q = $('#q').value.trim();
    const seq = ++sugSeq;
    if (!q || !app.state || !settings().versionId) return hideSuggest();
    const mode = settings().searchMode;
    const items = [];
    if (mode === 'text') {
      items.push({ label: `본문 검색: “${q}”`, act: doSearch });
    } else if (/\d/.test(q)) {
      const r = await cmd('searchReference', { query: q });
      if (seq !== sugSeq) return;
      if (r.ok) {
        const p = r.result.passage;
        items.push({ label: `↵ ${p.title}`, sub: p.verses[0].text, act: doSearch });
      } else if (r.ambiguous) {
        for (const c of r.candidates) items.push({ label: c.name, sub: c.short + (r.rest || ''), act: () => { $('#q').value = c.short + (r.rest || ''); doSearch(); } });
      } else if (r.book) {
        items.push({ label: r.error, err: true });
      } else if (mode === 'auto') {
        items.push({ label: `본문 검색: “${q}”`, act: doSearch });
      } else items.push({ label: r.error, err: true });
    } else {
      const k = q.replace(/\s+/g, '');
      const bs = app.structure.filter(b => b.name.startsWith(k) || b.short === k || b.short.startsWith(k)).slice(0, 6);
      for (const b of bs) items.push({ label: `${b.name}`, sub: `${b.short} · ${b.chapters.length}장 — 장 번호를 이어서 입력`, act: () => { $('#q').value = b.short; selectBook(b.id, false); $('#q').focus(); } });
      if (mode === 'auto') items.push({ label: `본문 검색: “${q}”`, act: doSearch });
    }
    openSuggest(items);
    // 통합 검색: 찬양·찬송가·이미지·영상·음악도 함께 (고르면 큐시트의 고른 순서 다음에 넣기)
    const lib = await libraryHits(q);
    if (seq !== sugSeq || !lib.length) return;
    openSuggest([...items, { hdr: true, label: '라이브러리 — 고르면 큐시트에 넣기' }, ...lib]);
  }

  async function libraryHits(q) {
    if (q.length < 1 || !window.BCCue) return [];
    const [songs, hymns, imgs, auds] = await Promise.all([
      cmd('listSongs', { query: q }), cmd('searchHymns', { query: q }),
      cmd('searchLibFiles', { kind: 'image', query: q }), cmd('searchLibFiles', { kind: 'audio', query: q }),
    ]);
    const out = [];
    const add = (type, extra, label) => () => { window.BCCue.addItem(type, extra); showMsg(`'${label}' 을(를) 큐시트에 넣었습니다.`, 'ok', 1500); };
    for (const s of (songs.ok ? songs.result : []).slice(0, 4)) out.push({ label: '🎵 ' + s.title, sub: s.first, act: async () => { const r = await cmd('getSong', { id: s.id }); if (r.ok) add('song', { songId: s.id, title: r.result.title, lyrics: r.result.lyrics }, s.title)(); } });
    for (const h of (hymns.ok ? hymns.result : []).slice(0, 4)) {
      if (h.bethlehem) { out.push({ label: '🎼 ' + (h.label || h.title), sub: h.folder, act: async () => { const d = await window.BCCue.addBethlehem(h); if (d) showMsg(`'${d.title}' 을(를) 큐시트에 넣었습니다.`, 'ok', 1500); } }); continue; }
      const title = h.number != null && !/^교독문/.test(h.title) ? `${h.number}장 ${h.title}` : h.title;
      out.push({ label: '🎼 ' + title, sub: h.folder, act: add('hymn', { title, file: h.file, number: h.number, background: 'default' }, title) });
    }
    if (q.length >= 2) {
      for (const f of (imgs.ok ? imgs.result : []).slice(0, 3)) out.push({ label: (f.video ? '🎬 ' : '🖼 ') + f.name, sub: f.folder, act: f.video ? add('video', { file: f.url, title: f.name, sound: true, volume: 1, loop: false, endAction: 'hold' }, f.name) : add('image', { image: f.url, title: f.name }, f.name) });
      for (const f of (auds.ok ? auds.result : []).slice(0, 2)) out.push({ label: '🔊 ' + f.name, sub: f.folder, act: add('audio', { file: f.url, title: f.name, volume: 1, fadeOnLeave: true }, f.name) });
    }
    return out;
  }

  function openSuggest(items, header) {
    app.suggest = { items, sel: -1 };
    const el = $('#suggest');
    if (!items.length) return hideSuggest();
    let no = 0;
    el.innerHTML = (header ? `<div class="item err">${esc(header)}</div>` : '')
      + items.map((it, i) => (it.hdr || it.err ? it : (it.no = ++no, it))).map((it, i) => it.hdr ? `<div class="item hdr">${esc(it.label)}</div>` : `<div class="item${it.err ? ' err' : ''}" data-i="${i}"><span class="k">${it.err ? "" : it.no}</span><span>${esc(it.label)}</span>${it.sub ? `<span class="s">${esc(it.sub)}</span>` : ''}</div>`).join('');
    el.hidden = false;
  }
  function hideSuggest() { $('#suggest').hidden = true; app.suggest = { items: [], sel: -1 }; }
  function moveSuggest(d) {
    const its = app.suggest.items;
    if (!its.length) return false;
    let i = app.suggest.sel;
    do { i += d; } while (i >= 0 && i < its.length && (its[i].err || its[i].hdr));
    if (i < 0 || i >= its.length) return false;
    app.suggest.sel = i;
    document.querySelectorAll('#suggest .item[data-i]').forEach(x => x.classList.toggle('on', +x.dataset.i === i));
    return true;
  }
  $('#suggest').addEventListener('mousedown', e => {
    const it = e.target.closest('.item[data-i]');
    if (!it) return;
    e.preventDefault();
    const s = app.suggest.items[+it.dataset.i];
    if (s && s.act) { hideSuggest(); s.act(); }
  });
  $('#q').addEventListener('blur', () => setTimeout(hideSuggest, 150));

  $('#q').addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey) return; // 단축키는 전역 처리기에서
    if (e.key === 'Enter') {
      e.preventDefault();
      const s = app.suggest.items[app.suggest.sel];
      if (!$('#suggest').hidden && s && s.act) { hideSuggest(); s.act(); } else doSearch();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if ($('#suggest').hidden || !moveSuggest(1)) { hideSuggest(); if (app.results.items.length) { $('#results').focus(); if (app.results.sel < 0) selectResult(0); } }
    } else if (e.key === 'ArrowUp') {
      if (!$('#suggest').hidden) { e.preventDefault(); moveSuggest(-1); }
    } else if (e.key === 'Escape') {
      if (!$('#suggest').hidden) hideSuggest(); else $('#q').select();
    }
  });

  // ---------------- 송출 ----------------
  app.sendPreview = (...a) => sendPreview(...a);
  async function sendPreview() {
    const p = app.preview;
    if (!p) { showMsg('송출할 미리보기 본문이 없습니다. 먼저 검색하세요.', 'error'); return; }
    if (window.BCLib) window.BCLib.audio.onVisualSend(); // '다른 화면을 송출하면 페이드아웃' 음악
    const r = await cmd('sendLive', { passage: passageMeta(p.passage, p.query), slides: p.slides, index: p.index });
    if (!r.ok) showMsg('송출 실패: ' + r.error, 'error');
  }

  async function sendNow() {
    // 결과 목록에서 선택 중이면 그 항목, 아니면 검색창 입력을 미리보기로 만든 뒤 송출
    const inResults = document.activeElement === $('#results');
    if (inResults && app.results.type === 'text') {
      if (!(await activateResult(app.results.sel))) return;
    } else if (!inResults) {
      const q = $('#q').value.trim();
      if (q && (!app.preview || app.preview.query !== q)) {
        if (!(await doSearch())) return; // 검색 실패·본문 검색이면 송출하지 않음
      }
    }
    await sendPreview();
  }

  async function liveMove(d) {
    const r = await cmd(d > 0 ? 'nextSlide' : 'previousSlide');
    if (r.ok === false && r.reason && settings().navMode === 'range') {
      if (r.reason === 'no-live') showMsg('송출 중인 본문이 없습니다.', 'info', 2000);
      else showMsg(d > 0 ? '선택한 범위의 마지막 슬라이드입니다.' : '선택한 범위의 첫 슬라이드입니다.', 'info', 2000);
    }
  }

  /** 연속 탐색: 코어가 범위 끝에 닿았다고 알려 오면 다음(이전) 절 슬라이드를 만들어 붙인다 */
  let extending = false;
  async function handleExtend({ dir, version }) {
    if (extending) return;
    extending = true;
    try {
      const st = await cmd('getState');
      if (!st.ok) return;
      const live = st.result.live;
      if (!live.hasLive || !live.passage?.book) return;
      const pass = live.passage;
      const edge = dir > 0 ? pass.last : pass.first;
      const r = await cmd('adjacentVerse', { versionId: pass.versionId, book: pass.book.id, chapter: edge.chapter, verse: edge.verse, dir });
      if (!r.ok) { showMsg(r.error + ' 더 이동하지 않습니다.', 'info', 2500); return; }
      const np = r.result.passage;
      const slides = SL.build(np, splitOpts(lvOver()));
      const v = np.verses[0];
      const first = dir > 0 ? pass.first : { chapter: v.chapter, verse: v.verse };
      const last = dir > 0 ? { chapter: v.chapter, verse: v.verse } : pass.last;
      const title = first.chapter === last.chapter
        ? `${pass.book.name} ${first.chapter}:${first.verse}-${last.verse}`
        : `${pass.book.name} ${first.chapter}:${first.verse}-${last.chapter}:${last.verse}`;
      const ex = await cmd('extendLive', { dir, slides, expectVersion: version, passage: { ...pass, title, first, last } });
      if (!ex.ok && ex.reason !== 'stale') showMsg(ex.error || '이동 실패', 'error');
    } finally {
      extending = false;
    }
  }

  async function previewAdjacentVerse(dir) {
    const p = app.preview;
    if (!p || !p.passage.book) return;
    const s = p.slides[p.index];
    const edge = dir > 0 ? s.parts[s.parts.length - 1] : s.parts[0];
    const r = await cmd('adjacentVerse', { versionId: p.passage.versionId, book: edge.book, chapter: edge.chapter, verse: edge.verse, dir });
    if (!r.ok) return showMsg(r.error, 'info', 2000);
    const np = r.result.passage;
    const v = np.verses[0];
    $('#q').value = `${np.book.short}${v.chapter}:${v.verse}`;
    loadPassage(np, { query: $('#q').value });
  }

  async function previewChapterStart() {
    const p = app.preview;
    if (!p || !p.passage.book) return;
    const part = p.slides[p.index].parts[0];
    const r = await cmd('getChapter', { versionId: p.passage.versionId, bookId: part.book, chapter: part.chapter });
    if (!r.ok) return showMsg(r.error, 'error');
    $('#q').value = `${r.result.passage.book.short}${part.chapter}`;
    loadPassage(r.result.passage, { query: $('#q').value, index: 0 });
  }

  // ---------------- 버튼 ----------------
  $('#bPrev').onclick = () => liveMove(-1);
  $('#bNext').onclick = () => liveMove(1);
  $('#bSend').onclick = sendPreview;
  $('#bClear').onclick = () => cmd('toggleLive');
  // 화면 지우기 단추 (켜진 상태는 색으로)
  $('#bBg').onclick = () => cmd('toggleBackground');
  $('#bOvOff').onclick = () => cmd('toggleOverlaysOff');
  $('#bLogo').onclick = () => cmd('toggleLogoScreen');
  $('#bAudio').onclick = () => { if (window.BCLib) window.BCLib.audio.fadeOut(2500); };
  $('#bAll').onclick = () => { cmd('clearAll'); if (window.BCLib) window.BCLib.audio.fadeOut(2000); };
  // 지우기 ▾ : 자주 안 쓰는 지우기 단추를 메뉴로
  $('#bMore').onclick = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const b = id => ({ label: ($('#' + id).classList.contains('active') ? '■ ' : '') + $('#' + id).textContent, run: () => $('#' + id).click() });
    window.BCCtx.show(r.left, r.top - 4, [{ head: '화면 지우기' }, b('bBg'), b('bOvOff'), b('bLogo'), b('bAudio'),
      ...(app.state && app.state.layers && app.state.layers.media ? ['-', { label: `송출 배경 끄기 (${app.state.layers.media.label || '미디어'})`, run: () => window.BCLib && window.BCLib.liveMedia(null) }] : [])]);
  };
  function renderLayerButtons() {
    const L = app.state.layers || {};
    $('#bBg').classList.toggle('active', !!L.hideBg); $('#bBg').textContent = L.hideBg ? '배경 다시 켜기' : '배경 끄기';
    $('#bOvOff').classList.toggle('active', !!L.overlaysOff); $('#bOvOff').textContent = L.overlaysOff ? '오버레이 다시 켜기' : '오버레이 끄기';
    $('#bLogo').classList.toggle('active', !!L.logo); $('#bLogo').textContent = L.logo ? '로고 화면 끄기' : '로고 화면';
    const more = [L.hideBg && '배경 꺼짐', L.overlaysOff && '오버레이 꺼짐', L.logo && '로고 화면'].filter(Boolean);
    $('#bMore').classList.toggle('active', more.length > 0);
    $('#bMore').textContent = more.length ? `${more.join(' · ')} ▾` : '지우기 ▾';
  }
  // ---------------- 지금 화면 (층마다 끄기) ----------------
  const LY_ICON = { camera: 'camera', video: 'clapperboard', image: 'image', color: 'palette' }; // 배경 종류 → 아이콘
  const LY_SRC = { media: '송출 배경', slide: '순서 배경', template: '템플릿 배경' };
  const LY_KIND = { text: 'text', video: 'clapperboard', camera: 'camera', image: 'image', score: 'music-2', blank: 'square', slideshow: 'images', title: 'tag' };
  let lyHtml = '';
  function renderScreenLayers() {
    const box = $('#lvLayers');
    if (!box || !app.state) return;
    const S = app.state.screen || {};
    const chip = (act, cls, text, btn, title, ic) => `<button type="button" class="ly ly-${cls}" data-ly="${act}" title="${esc(title)}">${ic ? `<span class="ly-ic">${window.BCIcon(ic)}</span>` : ''}<span class="ly-t">${esc(text)}</span><span class="ly-x">${esc(btn)}</span></button>`;
    const out = [];
    const c = S.content;
    if (c) {
      const name = `${c.title || ''}${c.count > 1 ? ` ${c.index + 1}/${c.count}` : ''}`;
      const ic = LY_KIND[c.kind] || 'text';
      out.push(c.visible ? chip(c.kind === 'video' ? 'video' : 'content', 'on', name, '✕', c.kind === 'video' ? '영상 멈추고 지우기' : '슬라이드 지우기 (F10)', ic) : chip('content', 'off', `${name} · 숨김`, '보이기', '슬라이드 다시 보이기 (F10)', ic));
    }
    for (const b of S.bgs || []) if (b.src === 'media') out.push(chip('media', 'on', `${LY_SRC.media}${b.label ? ': ' + b.label : ''}`, '✕', '송출 배경 끄기 (카메라는 닫힘)', LY_ICON[b.type] || 'image'));
    const other = (S.bgs || []).filter(b => b.src !== 'media');
    if (S.bgHidden) out.push(chip('bgon', 'off', '배경 꺼짐', '다시 켜기', '배경(순서·템플릿 배경)을 다시 켭니다', 'image'));
    else for (const b of other) out.push(chip(b.src === 'slide' ? 'bgitem' : 'bgtpl', 'on', `${LY_SRC[b.src]}${b.src === 'template' && b.label ? ': ' + b.label : ''}`, '✕', b.src === 'slide' ? '이 순서에서 배경 빼기' : '템플릿 배경 빼기 (단색으로, 이 템플릿을 쓰는 모든 순서)', LY_ICON[b.type] || 'image'));
    if (S.overlays && S.overlays.length) out.push(chip('ov', 'on', S.overlays.join(', '), '✕', '오버레이 끄기', 'layers'));
    if (S.logo) out.push(chip('logo', 'on', '로고 화면', '✕', '로고 화면 끄기', 'flag'));
    if (S.draw) out.push(chip('draw', 'on', '그리기', '✕', '그린 것 지우기', 'brush'));
    const au = window.BCLib && window.BCLib.audio && window.BCLib.audio.info ? window.BCLib.audio.info() : null;
    if (au && au.url && !au.paused) out.push(chip('audio', 'on', au.title || '음악', '✕', '음악 줄이며 멈춤', 'volume-2'));
    const html = `<span class="ly-h">지금 화면</span>${out.length ? out.join('') : '<span class="muted ly-empty">비어 있음</span>'}`;
    if (html === lyHtml) return;
    lyHtml = html;
    box.innerHTML = html;
  }
  app.renderScreenLayers = renderScreenLayers;
  setInterval(renderScreenLayers, 1000); // 조작 PC 음악 (재생·멈춤)
  $('#lvLayers').addEventListener('click', e => {
    const b = e.target.closest('[data-ly]');
    if (!b) return;
    const act = b.dataset.ly;
    if (act === 'content') cmd('toggleLive');
    else if (act === 'video') cmd('videoControl', { action: 'stop' });
    else if (act === 'media') cmd('setBackgroundMedia', { media: null });
    else if (act === 'bgitem') removeLiveItemBg();
    else if (act === 'bgtpl') { const lv = app.state.live && app.state.live.passage; app.removeTemplateBg(tplFor('main', lv && lv.tpl)); }
    else if (act === 'bgon') cmd('toggleBackground', { on: false });
    else if (act === 'ov') cmd('toggleOverlaysOff');
    else if (act === 'logo') cmd('toggleLogoScreen', { on: false });
    else if (act === 'draw') cmd('drawClear');
    else if (act === 'audio' && window.BCLib) window.BCLib.audio.fadeOut(1500);
    setTimeout(renderScreenLayers, 300);
  });

  $('#btnSettings').onclick = () => window.BCSettings.open();
  $('#mode').onchange = e => cmd('updateSettings', { patch: { searchMode: e.target.value } });
  $('#navMode').onchange = e => cmd('updateSettings', { patch: { navMode: e.target.value } });
  // ---------------- 빠른 설정 패널 ----------------
  // 선택한 출력(예배당/OBS 자막)의 템플릿을 바로 고친다. 바꾸는 즉시 미리보기·LIVE 모니터·실제 출력에 반영된다.
  const quick = { out: 'main', tpl: null, lastLocal: 0, saveTimer: null, viewTimer: null };
  const tplKey = t => JSON.stringify({ ...t, preset: undefined });

  function renderQuick(force) {
    if (!app.state) return;
    const t = tplFor(quick.out);
    const sel = $('#qTpl');
    sel.innerHTML = settings().templates.map(x => `<option value="${esc(x.id)}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    // 직접 조작 중이거나 내용이 같으면 다시 그리지 않는다 (슬라이더를 끄는 중 끊기지 않도록)
    if (!force && quick.tpl && quick.tpl.id === t.id && (Date.now() - quick.lastLocal < 1500 || tplKey(t) === tplKey(quick.tpl))) return;
    quick.tpl = structuredClone(t);
    window.BCTplControls.render($('#qControls'), quick.tpl, onQuickChange, { basic: true });
  }

  /** 빠른 설정에서 막 바꾼 템플릿이 아직 저장 중이면, 서버에서 온 이전 값으로 화면이 되돌아가지 않게 한다 */
  function keepLocalTemplate() {
    if (!quick.tpl || Date.now() - quick.lastLocal > 1500) return;
    const list = app.state.settings.templates;
    const i = list.findIndex(x => x.id === quick.tpl.id);
    if (i >= 0) list[i] = structuredClone(quick.tpl);
  }

  function onQuickChange(t, { final }) {
    quick.lastLocal = Date.now();
    // 화면 표시용으로 먼저 반영
    const list = settings().templates;
    const i = list.findIndex(x => x.id === t.id);
    if (i >= 0) list[i] = structuredClone(t);
    clearTimeout(quick.viewTimer);
    quick.viewTimer = setTimeout(() => { rebuildPreview(); renderLive(); }, final ? 0 : 80);
    // 저장(실제 출력 반영)은 잠깐 모아서
    clearTimeout(quick.saveTimer);
    quick.saveTimer = setTimeout(async () => {
      const r = await cmd('saveTemplate', { template: t });
      if (!r.ok) return showMsg(r.error, 'error');
      $('#qSaved').textContent = `'${t.name}' 저장됨 ✓`;
      setTimeout(() => { $('#qSaved').textContent = ''; }, 1500);
    }, final ? 60 : 180);
  }
  app.renderQuick = renderQuick;

  $('#qTarget').addEventListener('click', e => {
    const b = e.target.closest('button[data-out]');
    if (!b) return;
    quick.out = b.dataset.out;
    $('#qTarget').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    renderQuick(true);
  });
  $('#qTpl').onchange = async e => {
    const r = await cmd('setTemplate', { output: quick.out, templateId: e.target.value });
    if (!r.ok) showMsg(r.error, 'error');
  };
  const setQuickCollapsed = c => {
    $('#quick').classList.toggle('collapsed', c);
    $('#qToggle').textContent = c ? '펴기 ▴' : '접기 ▾';
    try { localStorage.setItem('bc.quickCollapsed', c ? '1' : ''); } catch { /* 무시 */ }
  };
  $('#qToggle').onclick = () => setQuickCollapsed(!$('#quick').classList.contains('collapsed'));
  // 자세히: 지금 고른 출력의 템플릿을 편집기에서 연다 / 테마: 테마 고르기
  $('#qMore').onclick = () => window.BCSettings.open('templates', { templateId: tplFor(quick.out).id });
  $('#qTheme').onclick = () => window.BCSettings.open('themes');
  try { if (localStorage.getItem('bc.quickCollapsed')) setQuickCollapsed(true); } catch { /* 무시 */ }
  $('#splitMode').onchange = e => {
    const v = e.target.value;
    cmd('updateSettings', { patch: { split: v === 'auto' ? { mode: 'auto' } : { mode: 'count', count: +v } } });
  };
  $('#version2').onchange = async e => {
    await cmd('updateSettings', { patch: { parallelVersionId: e.target.value } });
    app.state.settings.parallelVersionId = e.target.value;
    showMsg(e.target.value ? '병행 번역본: 성경 본문 아래에 두 번째 번역이 함께 나갑니다.' : '병행 번역을 껐습니다.', 'info', 2500);
    // 미리보기 중인 성경 본문을 다시 (Live 는 그대로)
    if (app.preview && app.preview.passage && app.preview.passage.book) {
      const r = await cmd('searchReference', { query: app.preview.passage.title });
      if (r.ok) loadPassage(r.result.passage, { query: app.preview.query, index: app.preview.index, tpl: app.preview.tpl, bg: app.preview.bg });
    }
  };
  $('#version').onchange = async e => {
    await cmd('updateSettings', { patch: { versionId: e.target.value } });
    await loadStructure();
    // 같은 장절을 새 번역본으로 다시 미리보기 (Live 는 그대로)
    if (app.preview) {
      const r = await cmd('searchReference', { query: app.preview.passage.title });
      if (r.ok) loadPassage(r.result.passage, { query: app.preview.query });
    }
  };

  // ---------------- 송출 기록 ----------------
  function openHistory() {
    const h = settings().history;
    const fmt = t => new Date(t).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    openModal('송출 기록', h.length
      ? `<div class="note">항목을 선택하고 Enter(또는 클릭)를 누르면 미리보기로 불러옵니다. 바로 송출되지는 않습니다.</div>
         <div class="history-list" tabindex="0">${h.map((x, i) => `<div class="row" data-i="${i}"><span class="t">${fmt(x.at)}</span><b>${esc(x.title)}</b><span class="muted">${esc(x.versionName)}</span></div>`).join('')}</div>
         <div class="row-flex" style="margin-top:10px"><button id="histClear">기록 지우기</button></div>`
      : '<div class="note">송출 기록이 없습니다.</div>');
    const list = $('.history-list');
    if (!list) return;
    let sel = 0;
    const mark = () => list.querySelectorAll('.row').forEach(r => r.classList.toggle('sel', +r.dataset.i === sel));
    const load = async i => {
      const it = h[i];
      closeModal();
      const r = await cmd('searchReference', { query: it.title, versionId: it.versionId });
      if (!r.ok) return showMsg(r.error, 'error');
      $('#q').value = it.query || it.title;
      loadPassage(r.result.passage, { query: $('#q').value });
    };
    mark();
    list.focus();
    list.onclick = e => { const r = e.target.closest('.row'); if (r) load(+r.dataset.i); };
    list.onkeydown = e => {
      if (e.key === 'ArrowDown') { sel = Math.min(h.length - 1, sel + 1); mark(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(); e.preventDefault(); }
      else if (e.key === 'Enter') load(sel);
      list.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' });
    };
    $('#histClear').onclick = async () => { if (confirm('송출 기록을 모두 지울까요?')) { await cmd('clearHistory'); closeModal(); } };
  }

  // ---------------- 모달 ----------------
  function openModal(title, html) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modal').hidden = false;
  }
  function closeModal() {
    $('#modal').hidden = true;
    $('#modalBody').innerHTML = '';
    app.capturing = null;
    if (window.BCSettings) window.BCSettings.closed();
    $('#q').focus();
  }
  app.openModal = openModal;
  app.closeModal = closeModal;
  $('#modalClose').onclick = closeModal;
  $('#modal').addEventListener('mousedown', e => { if (e.target === $('#modal')) closeModal(); });

  // ---------------- 보조 화면(예배당 모니터) 출력 켜기·끄기 ----------------
  async function toggleOutputWindow() {
    const r = await cmd('toggleOutputWindow');
    if (!r.ok) return showMsg(r.error, 'error');
    const st = r.result;
    if (st.enabled && !st.valid) showMsg('연결된 보조 모니터가 없습니다. 모니터를 연결하거나 설정 → 출력에서 모니터를 고르세요.', 'error', 6000);
    else showMsg(st.enabled ? `보조 화면 출력을 켰습니다: ${st.displayLabel}` : (settings().output.linkObs !== false ? '보조 화면 출력을 껐습니다. OBS 화면도 숨겼습니다.' : '보조 화면 출력을 껐습니다.'), st.enabled ? 'ok' : 'info', 2500);
  }
  $('#bOutput').onclick = toggleOutputWindow;

  function renderOutputButton() {
    const d = app.state.outputs && app.state.outputs.desktop;
    const btn = $('#bOutput');
    btn.hidden = !d; // 브라우저에서 열었을 때는 모니터 출력 창이 없으므로 숨김
    if (!d) return;
    const on = d.enabled && d.valid;
    btn.classList.toggle('on', on);
    btn.classList.toggle('err', d.enabled && !d.valid);
    $('#bOutputState').textContent = on ? '켜짐' : d.enabled ? '모니터 없음' : '꺼짐';
    $('#bOutputKey').textContent = settings().shortcuts.toggleOutputWindow || '';
    $('#bOutputKey').hidden = !settings().shortcuts.toggleOutputWindow;
  }

  // ---------------- 상태 표시 ----------------
  function renderStatus() {
    renderOutputButton();
    const st = app.state;
    const live = st.live;
    const o = st.outputs || { clients: [] };
    const parts = [];
    const d = o.desktop;
    if (d) {
      const cls = !d.enabled ? 'off' : d.valid ? (d.visible ? 'ok' : 'warn') : 'err';
      const txt = !d.enabled ? '예배당 화면 꺼짐' : d.valid ? `예배당 화면: ${esc(d.displayLabel)}` : '예배당 모니터 연결 안 됨';
      parts.push(`<span class="st" title="전체 화면 출력 창 (${esc(st.settings.shortcuts.toggleOutputWindow)})"><span class="dot ${cls}"></span>${txt}</span>`);
    }
    for (const out of ['main', 'overlay']) {
      const cs = o.clients.filter(c => c.output === out && c.kind !== 'window');
      const name = out === 'main' ? 'OBS 전체' : 'OBS 자막';
      if (!cs.length) { parts.push(`<span class="st" title="/outputs/${out} 에 연결된 브라우저 소스 없음"><span class="dot off"></span><span>${name}</span> 연결 없음</span>`); continue; }
      const synced = cs.every(c => c.ack && c.ack.version === live.version);
      parts.push(`<span class="st" title="연결 ${cs.length}개 · 출력 화면이 보고한 상태 버전과 송출 버전을 비교합니다"><span class="dot ${synced ? 'ok' : 'warn'}"></span><span>${name}</span> ${cs.length}개 ${synced ? '동기화됨' : '갱신 대기'}</span>`);
    }
    const win = o.clients.filter(c => c.kind === 'window');
    if (win.length && d && d.visible) { // 숨겨진 출력 창은 표시하지 않음
      const synced = win.every(c => c.ack && c.ack.version === live.version);
      parts.push(`<span class="st"><span class="dot ${synced ? 'ok' : 'warn'}"></span>출력 창 ${synced ? '반영됨' : '갱신 대기'}</span>`);
    }
    // 송출 배경(카메라·그림·영상)이 켜져 있으면: 눌러서 끄기
    const md = st.layers && st.layers.media;
    if (md) parts.unshift(`<span class="st st-media" data-media-off title="눌러서 송출 배경 끄기"><span class="dot err"></span>${window.BCIcon(LY_ICON[md.type] || 'image')} 송출 배경: ${esc(md.label || '')} ✕</span>`);
    // 업데이트: 새 버전이 있을 때만
    const u = app.update;
    if (u && (u.state === 'ready' || u.state === 'available' || (u.state === 'downloading' && u.version))) {
      const txt = u.state === 'ready' ? `⬆ 새 버전 ${esc(u.version)} — 끌 때 설치` : u.state === 'available' ? `⬆ 새 버전 ${esc(u.version)} — 받기` : `⬆ 새 버전 ${esc(u.version)} 받는 중${u.percent ? ' ' + u.percent + '%' : ''}`;
      parts.push(`<span class="st st-update" data-update="${u.state}" title="자동 업데이트 (설정 → 정보)"><span class="dot ok"></span>${txt}</span>`);
    }
    $('#status').innerHTML = parts.join('');
  }
  $('#status').addEventListener('click', e => {
    if (e.target.closest('[data-media-off]')) { cmd('setBackgroundMedia', { media: null }); return; }
    const b = e.target.closest('[data-update]');
    if (!b) return;
    if (b.dataset.update === 'available') cmd('updateAction', { action: 'open' });
    else if (window.BCSettings) window.BCSettings.open('about');
  });

  // ---------------- 단축키 ----------------
  function comboOf(e) {
    let k = e.code;
    if (!k || k === 'Unidentified') return '';
    if (/^(Control|Shift|Alt|Meta)(Left|Right)$/.test(k)) return '';
    if (k.startsWith('Key')) k = k.slice(3);
    else if (k.startsWith('Digit')) k = k.slice(5);
    else if (k === 'NumpadEnter') k = 'Enter';
    const mods = [];
    const mac = /Mac/.test(navigator.platform); // 맥은 ⌘ 를 Ctrl 로 (설정은 같고 화면에는 ⌘ 로 보임)
    if (e.ctrlKey || (mac && e.metaKey)) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey && !mac) mods.push('Meta');
    return [...mods, k].join('+');
  }
  app.comboOf = comboOf;

  const actions = {
    focusSearch: () => { $('#q').focus(); $('#q').select(); },
    sendNow,
    prevSlide: () => liveMove(-1),
    nextSlide: () => liveMove(1),
    sendPreview,
    toggleClear: () => cmd('toggleLive'),
    openBooks: () => { window.BCCue && window.BCCue.showSide('books'); $('#bookFilter').focus(); $('#bookFilter').select(); },
    cuePrev: () => window.BCCue && window.BCCue.move(-1),
    cueNext: () => window.BCCue && window.BCCue.move(1),
    cueEdit: () => window.BCCue && window.BCCue.edit(),
    toggleEditor: () => window.BCCue && window.BCCue.toggleEditor(),
    openHistory: () => openHistory(),
    webLyrics: () => window.BCCue && window.BCCue.webLyrics(),
    quickText: () => window.BCQuick && window.BCQuick.toggle(),
    previewPrevSlide: () => stepPreview(-1),
    previewNextSlide: () => stepPreview(1),
    previewPrevVerse: () => previewAdjacentVerse(-1),
    previewNextVerse: () => previewAdjacentVerse(1),
    previewChapterStart,
    toggleOutputWindow: () => toggleOutputWindow(),
    outputOff: async () => {
      const d = app.state.outputs && app.state.outputs.desktop;
      if (!d || !d.enabled) return;
      const r = await cmd('outputOff');
      if (r.ok) showMsg('보조 화면 출력을 껐습니다. 다시 송출하면 자동으로 켜집니다.', 'info', 2500);
    },
  };
  app.runAction = name => actions[name] && actions[name]();
  // 모달이 열려 있어도 동작해야 하는 송출 관련 기능
  const LIVE_ACTIONS = new Set(['prevSlide', 'nextSlide', 'sendPreview', 'toggleClear']);

  // ---------------- 찬양 중 바로 가기 키 ----------------
  // 송출 중인 슬라이드에 이름표(1절·후렴…)가 있으면: 1~9 = 그 절, C(ㅊ) = 후렴, B(ㅠ) = 브릿지, E(ㄷ) = 엔딩
  // (글을 입력하는 칸에 있을 때와 창이 열려 있을 때는 동작하지 않음)
  const JUMP = { c: ['후렴', 'chorus'], 'ㅊ': ['후렴', 'chorus'], b: ['브릿지', '브리지', 'bridge'], 'ㅠ': ['브릿지', '브리지', 'bridge'], e: ['엔딩', '마무리', 'ending'], 'ㄷ': ['엔딩', '마무리', 'ending'], p: ['전주', 'pre'], 'ㅔ': ['전주', 'pre'] };
  function liveLabels() {
    const live = app.state.live;
    if (!live.hasLive) return null;
    // 번호만 있는 이름표(이름표 없는 이어지는 칸)는 앞 이름표에 붙인다
    let prev = '';
    const labels = live.slides.map(x => {
      const l = x.startsWith('¶') ? x.slice(1).replace(/-\d+$/, '') : '';
      if (!l || /^\d+$/.test(l)) return prev;
      prev = l;
      return l;
    });
    // 찬양 이름표(절·후렴·브릿지…)가 있을 때만
    return labels.some(l => /절|후렴|브릿지|브리지|엔딩|전주|마무리|chorus|bridge|verse/i.test(l)) ? labels : null;
  }
  function jumpKey(e) {
    if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return false;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return false;
    if (!$('#modal').hidden) return false;
    const labels = liveLabels();
    if (!labels) return false;
    const k = e.key.toLowerCase();
    const cur = app.state.live.index;
    const norm = s => s.replace(/\s/g, '').toLowerCase();
    let want = null;
    if (/^[1-9]$/.test(k)) want = l => norm(l) === k + '절' || norm(l).startsWith(k + '절');
    else if (JUMP[k]) want = l => JUMP[k].some(n => norm(l).startsWith(n));
    if (!want) return false;
    // 같은 이름표 묶음의 첫 슬라이드: 지금 위치 다음부터 찾고, 없으면 처음부터
    const starts = labels.map((l, i) => (l && want(l) && (i === 0 || labels[i - 1] !== l) ? i : -1)).filter(i => i >= 0);
    if (!starts.length) { showMsg(`'${e.key}' 에 맞는 부분이 이 찬양에 없습니다.`, 'info', 1500); e.preventDefault(); return true; }
    const target = starts.find(i => i > cur) ?? starts[0];
    e.preventDefault();
    cmd('gotoSlide', { index: target });
    return true;
  }
  app.liveLabels = liveLabels;

  window.addEventListener('keydown', e => {
    if (!app.state) return;
    if (window.BCCtx && window.BCCtx.isOpen()) return; // 오른쪽 클릭 메뉴가 키를 받는다 (Esc 로 보조 화면이 꺼지지 않게)
    const combo = comboOf(e);
    if (!combo) return;
    if (app.capturing) { e.preventDefault(); e.stopPropagation(); app.capturing(combo); return; }
    // Esc 는 열린 창·후보 목록을 먼저 닫고, 닫을 것이 없을 때만 단축키(보조 화면 끄기)로 쓴다
    const editing = window.BCSlideEdit && window.BCSlideEdit.isOpen(); // 슬라이드 편집기: 창처럼 다룬다
    if (combo === 'Escape') {
      if (!$('#modal').hidden) { closeModal(); e.preventDefault(); return; }
      if (editing) return; // 편집기가 닫음
      if (window.BCDraw && window.BCDraw.isOn()) { window.BCDraw.off(); e.preventDefault(); return; } // 그리기 끝 (보조 화면은 그대로)
      if (!$('#suggest').hidden) return; // 검색창 처리기가 후보 목록을 닫음
      if (window.BCQuick && window.BCQuick.isOpen()) { window.BCQuick.close(); e.preventDefault(); return; } // 즉석 자막 칸 닫기 (보조 화면은 그대로)
    }
    const sc = settings().shortcuts;
    const action = Object.keys(sc).find(a => sc[a] === combo);
    if (action) {
      const modalOpen = !$('#modal').hidden || editing;
      if (modalOpen && !LIVE_ACTIONS.has(action)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat && !['prevSlide', 'nextSlide', 'previewPrevSlide', 'previewNextSlide'].includes(action)) return;
      actions[action]();
      return;
    }
    if (e.key === 'Escape' && !$('#modal').hidden) { closeModal(); e.preventDefault(); return; }
    if (!editing && jumpKey(e)) return;
    // ← → : 미리보기 슬라이드 이동 (글 쓰는 칸·슬라이드 격자·장 고르기처럼 방향키를 따로 쓰는 곳 밖에서)
    if (!editing && $('#modal').hidden && (combo === 'ArrowLeft' || combo === 'ArrowRight') && app.preview && app.preview.slides) {
      const t = e.target;
      const own = t && t.closest && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || t.closest('#slideGrid, #chapterGrid, .ctx-menu, .dv-tabs-container'));
      if (!own) { e.preventDefault(); actions[combo === 'ArrowLeft' ? 'previewPrevSlide' : 'previewNextSlide'](); return; }
    }
    // Enter: 화살표로 고른 미리보기 슬라이드를 송출 (글 쓰는 칸·단추·목록처럼 Enter 를 따로 쓰는 곳 밖에서)
    if (!editing && $('#modal').hidden && combo === 'Enter' && !e.repeat && app.preview && app.preview.slides) {
      const t = e.target;
      const own = t && t.closest && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName) || t.isContentEditable || t.closest('#slideGrid, #results, #cueList, #chapterGrid, #bookList, .ctx-menu, .mb-drop, .dv-tabs-container'));
      if (!own) { e.preventDefault(); sendPreview(); return; }
    }
    // 브라우저 기본 동작 중 송출 화면에 위험한 키 차단 (새로 고침 등)
    if (combo === 'F5' || combo === 'Ctrl+R' || combo === 'Ctrl+Shift+R') e.preventDefault();
  }, true);

  // 코어 연결은 모든 스크립트(독·메뉴·편집기…)가 다 읽힌 뒤에.
  // 먼저 연결하면 첫 상태가 dock.js 보다 먼저 와서 화면 배치를 못 만들고 빈 화면이 될 수 있다
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connect, { once: true });
  else connect();
})();
