/* 설정 화면: 출력 · 템플릿 · 분할/탐색 · 단축키 · 성경 데이터 · 정보 */
(function () {
  'use strict';
  const app = window.BC;
  const R = window.BCRender;
  const esc = R.esc;
  const $ = s => document.querySelector(s);
  const cmd = app.cmd;

  const TABS = [
    ['themes', '테마'], ['output', '출력'], ['templates', '템플릿'], ['behavior', '검색·분할'], ['shortcuts', '단축키'], ['data', '성경 데이터'], ['about', '정보·라이선스'],
  ];
  let tab = 'output';
  let isOpen = false;
  let tplEdit = null;   // 편집 중인 템플릿 사본
  let tplDirty = false;
  let keyDraft = null;  // 편집 중인 단축키
  let importState = null;
  let fontList = null;
  let tplAdvOpen = false; // 고급 설정 펼침 상태 기억

  const S = () => app.state.settings;

  function open(which, o = {}) {
    tab = which || tab;
    isOpen = true;
    tplEdit = null; tplDirty = false; keyDraft = null; importState = null;
    if (o.templateId) { const x = S().templates.find(t => t.id === o.templateId); if (x) tplEdit = structuredClone(x); }
    app.openModal('설정', '<div class="tabs" id="setTabs"></div><div id="setBody"></div>');
    draw();
  }

  function draw() {
    $('#setTabs').innerHTML = TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('');
    $('#setTabs').onclick = e => {
      const b = e.target.closest('button[data-t]');
      if (!b) return;
      if (tplDirty && !confirm('저장하지 않은 템플릿 변경 사항이 있습니다. 버리고 이동할까요?')) return;
      tab = b.dataset.t; tplEdit = null; tplDirty = false; keyDraft = null;
      $('#modalBody').scrollTop = 0;
      draw();
    };
    ({ themes: drawThemes, output: drawOutput, templates: drawTemplates, behavior: drawBehavior, shortcuts: drawShortcuts, data: drawData, about: drawAbout })[tab]();
  }

  function onState(what) {
    if (!isOpen || !$('#setBody')) return;
    if (tab === 'output' && (what === 'outputs' || what === 'templates' || what === 'settings')) drawOutput();
    if (tab === 'data' && what === 'versions' && !importState) drawData();
    if (tab === 'templates' && what === 'templates' && !tplDirty) {
      const id = tplEdit && tplEdit.id;
      const x = id && S().templates.find(t => t.id === id);
      tplEdit = x ? structuredClone(x) : null;
      drawTemplates();
    }
    if (tab === 'themes' && what === 'templates') drawThemes();
  }

  function closed() { isOpen = false; }

  // ---------------- 테마 ----------------
  let themeCache = null;
  async function drawThemes() {
    if (!themeCache) {
      const r = await cmd('listThemes');
      themeCache = r.ok ? r.result : [];
    }
    if (tab !== 'themes' || !$('#setBody')) return;
    const act = S().activeTemplates;
    const groups = [...new Set(themeCache.map(th => th.group || '구세군'))];
    const GROUP_NOTE = {
      '구세군': '구세군 레드 쉴드·크레스트 로고와 상징색으로 만든 테마',
      '방송 스타일': '국내 여러 교회 예배 영상의 자막 화면 구성(위치·상자·색 계열)을 참고해 만든 테마. 로고·글꼴은 들어 있지 않습니다',
    };
    const card = th => {
        const onMain = act.main === th.main.id, onOver = act.overlay === th.overlay.id;
        return `<div class="theme-card ${onMain || onOver ? 'on' : ''}" data-th="${esc(th.id)}">
          <div class="theme-head"><b>${esc(th.name)}</b>${onMain && onOver ? '<span class="ok-text">사용 중</span>' : onMain ? '<span class="ok-text">예배당 사용 중</span>' : onOver ? '<span class="ok-text">OBS 사용 중</span>' : ''}</div>
          <div class="note">${esc(th.desc)}</div>
          <div class="theme-prev"><div class="screen" data-pv="main"></div><div class="screen" data-pv="overlay"></div></div>
          <div class="row-flex"><button data-apply="all">두 화면 모두 적용</button><button data-apply="main">예배당만</button><button data-apply="overlay">OBS 자막만</button></div>
        </div>`;
    };
    $('#setBody').innerHTML = `<div class="note" style="margin-bottom:10px">테마마다 <b>예배당 화면</b>과 <b>OBS 자막</b> 디자인이 짝으로 들어 있습니다.
        적용한 뒤 빠른 설정이나 템플릿에서 글꼴·크기 등을 고칠 수 있고, 테마를 다시 적용하면 처음 모양으로 돌아갑니다.</div>`
      + groups.map(g => `<h4 class="theme-group">${esc(g)} <span class="muted">— ${esc(GROUP_NOTE[g] || '')}</span></h4>
        <div class="theme-grid">${themeCache.filter(th => (th.group || '구세군') === g).map(card).join('')}</div>`).join('');
    const sample = app.preview ? app.preview.slides[app.preview.index] : {
      ref: '요한복음 3:16', title: '요한복음 3:16', parts: [{ book: 43, chapter: 3, verse: 16, text: '하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니 이는 그를 믿는 자마다 멸망하지 않고 영생을 얻게 하려 하심이라' }],
    };
    for (const th of themeCache) {
      const card = $(`.theme-card[data-th="${th.id}"]`);
      R.renderInto(card.querySelector('[data-pv=main]'), sample, th.main, { checker: true, versionName: '개역개정' });
      R.renderInto(card.querySelector('[data-pv=overlay]'), sample, th.overlay, { checker: true, versionName: '개역개정' });
      card.querySelectorAll('[data-apply]').forEach(b => b.onclick = async () => {
        const outputs = b.dataset.apply === 'all' ? ['main', 'overlay'] : [b.dataset.apply];
        const r = await cmd('applyTheme', { id: th.id, outputs });
        if (!r.ok) return app.showMsg(r.error, 'error');
        app.showMsg(`'${th.name}' 테마를 적용했습니다.`, 'ok', 2000);
      });
    }
  }

  // ---------------- 출력 ----------------
  async function drawOutput() {
    const body = $('#setBody');
    const s = S();
    const port = app.state.port;
    const d = await cmd('getDisplays');
    if (tab !== 'output' || !$('#setBody')) return;
    const info = d.ok ? d.result : { available: false, displays: [] };
    const tplOpts = sel => s.templates.map(t => `<option value="${esc(t.id)}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    const st = info.status || {};
    body.innerHTML = `
      <div class="form">
        <h4>예배당 전체 화면 (모니터 출력)</h4>
        ${info.available ? `
          <label>출력 모니터</label>
          <div class="row-flex">
            <select id="oDisplay">${info.displays.map(x => `<option value="${x.id}" ${x.id === st.displayId ? 'selected' : ''}>${esc(x.label)}</option>`).join('') || '<option>모니터 없음</option>'}</select>
            <label><input type="checkbox" id="oEnabled" ${s.output.enabled ? 'checked' : ''}> 전체 화면 출력 켜기</label>
          </div>
          <span></span>
          <div class="note">${st.enabled ? (st.valid ? `<span class="ok-text">출력 중: ${esc(st.displayLabel)}</span>` : '<span class="err-text">지정한 모니터가 연결되어 있지 않아 출력 창을 숨겼습니다. 모니터를 다시 연결하면 자동으로 복구됩니다.</span>') : '꺼짐'}
            ${st.sameAsControl ? '<br><span class="warn-text">조작 화면과 같은 모니터입니다. 조작 화면이 가려질 수 있습니다.</span>' : ''}</div>
        ` : `<span></span><div class="note">브라우저에서 실행 중이므로 모니터 출력 창을 직접 만들 수 없습니다.<br>출력 화면 주소를 다른 창에서 열어 전체 화면(F11)으로 사용할 수 있습니다.</div>`}
        <label><input type="checkbox" id="oCursor" ${s.output.cursorHidden ? 'checked' : ''}> 마우스 커서 숨김</label><span></span>
        <label><input type="checkbox" id="oAuto" ${s.output.autoOnSend !== false ? 'checked' : ''}> 송출하면 보조 화면 자동 켜기</label><span class="note">Esc 로 보조 화면을 끕니다 (단축키 설정에서 변경 가능)</span>
        <span></span><label><input type="checkbox" id="oLinkObs" ${s.output.linkObs !== false ? 'checked' : ''}> 보조 화면을 끄면 OBS 화면도 숨기기 (다시 켜거나 송출하면 다시 보임)</label>

        <h4>출력별 템플릿</h4>
        <label>예배당 전체 화면 / OBS 전체</label><select id="oTplMain">${tplOpts(s.activeTemplates.main)}</select>
        <label>OBS 투명 자막</label><select id="oTplOverlay">${tplOpts(s.activeTemplates.overlay)}</select>
        <span></span><div class="note">두 출력은 같은 본문을 표시하되 디자인은 각각 적용됩니다. 템플릿을 바꾸면 송출 중인 화면에 즉시 반영됩니다.</div>

        <h4>OBS 브라우저 소스 주소</h4>
        <label>전체 화면</label><div class="row-flex"><span class="url">http://127.0.0.1:${port}/outputs/main</span><button data-copy="http://127.0.0.1:${port}/outputs/main">복사</button></div>
        <label>투명 자막</label><div class="row-flex"><span class="url">http://127.0.0.1:${port}/outputs/overlay</span><button data-copy="http://127.0.0.1:${port}/outputs/overlay">복사</button></div>
        <label>OBS 도킹 (조작판)</label><div class="row-flex"><span class="url">http://127.0.0.1:${port}/dock</span><button data-copy="http://127.0.0.1:${port}/dock">복사</button></div>
        <span></span><span class="note">OBS → 도킹 → 사용자 지정 브라우저 도킹 → 이름 WorshipCue, 주소 붙여넣기. OBS 화면 한쪽에서 지금·다음 슬라이드, 이전·다음·숨김, 큐시트 순서 송출, 무대 메시지를 쓸 수 있습니다.</span>
        <span></span><div class="note">OBS → 소스 추가 → 브라우저 → URL 입력, 너비/높이는 템플릿 해상도(기본 1920×1080). 본문이 바뀌면 자동으로 갱신되며 새로 고침이 필요 없습니다.</div>
        <label>로컬 서버 포트</label>
        <div class="row-flex"><input type="number" id="oPort" min="1024" max="65535" value="${s.port}" style="width:110px"><button id="oPortSave">저장</button>
          <span class="note">변경하면 프로그램을 다시 시작해야 하며, OBS 주소도 바꿔야 합니다.</span></div>
        <h4>출력 연결 상태</h4>
        <div class="full">${outputClientsTable()}</div>
      </div>`;
    body.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); app.showMsg('주소를 복사했습니다.', 'ok', 1500); });
    if (info.available) {
      const apply = async () => {
        const r = await cmd('setOutputWindow', { enabled: $('#oEnabled').checked, displayId: Number($('#oDisplay').value) });
        if (!r.ok) app.showMsg(r.error, 'error');
        drawOutput();
      };
      $('#oDisplay').onchange = apply;
      $('#oEnabled').onchange = apply;
    }
    $('#oCursor').onchange = e => cmd('updateSettings', { patch: { output: { cursorHidden: e.target.checked } } });
    $('#oAuto').onchange = e => cmd('updateSettings', { patch: { output: { autoOnSend: e.target.checked } } });
    $('#oLinkObs').onchange = e => cmd('updateSettings', { patch: { output: { linkObs: e.target.checked } } });
    $('#oTplMain').onchange = e => cmd('setTemplate', { output: 'main', templateId: e.target.value });
    $('#oTplOverlay').onchange = e => cmd('setTemplate', { output: 'overlay', templateId: e.target.value });
    $('#oPortSave').onclick = async () => {
      const r = await cmd('updateSettings', { patch: { port: +$('#oPort').value } });
      if (r.ok) app.showMsg('포트를 저장했습니다. 프로그램을 다시 시작하면 적용됩니다.', 'ok');
    };
  }

  function outputClientsTable() {
    const o = app.state.outputs;
    const live = app.state.live;
    if (!o || !o.clients.length) return '<div class="note">연결된 출력 화면이 없습니다.</div>';
    const kind = { window: '예배당 출력 창', obs: 'OBS 브라우저 소스', browser: '브라우저' };
    return `<table class="list"><tr><th>출력</th><th>종류</th><th>화면 크기</th><th>수신 상태</th></tr>${o.clients.map(c => `<tr>
      <td>${c.output === 'main' ? '전체 화면' : '투명 자막'}</td><td>${kind[c.kind] || c.kind}</td>
      <td>${c.ack ? `${c.ack.width}×${c.ack.height}` : '-'}</td>
      <td>${c.ack ? (c.ack.version === live.version ? '<span class="ok-text">최신 상태 표시 중</span>' : `<span class="warn-text">갱신 대기 (v${c.ack.version} / v${live.version})</span>`) : '응답 없음'}</td></tr>`).join('')}</table>`;
  }

  // ---------------- 템플릿 ----------------
  const FIELDS = [
    ['h', '기본'],
    ['name', '템플릿 이름', 'text'],
    ['res', '해상도', 'res'],
    ['safeArea', '안전영역 (%)', 'number', 0.5],
    ['h', '배경'],
    ['background.type', '배경 종류', 'select', [['color', '단색'], ['gradient', '그라데이션'], ['transparent', '투명 (OBS 합성용)'], ['image', '이미지']]],
    ['background.gradient', '그라데이션 (CSS)', 'text'],
    ['background.color', '배경 색', 'color'],
    ['background.image', '배경 이미지', 'image'],
    ['background.imageFit', '이미지 맞춤', 'select', [['cover', '화면 채우기'], ['contain', '전체 보이기']]],
    ['background.dim', '이미지 어둡게 (0~1)', 'number', 0.05],
    ['clearHidesBackground', '숨김(Clear) 시 배경도 숨김', 'checkbox'],
    ['h', '본문 글꼴'],
    ['font.family', '글꼴', 'font'],
    ['font.size', '글꼴 크기 (px)', 'number', 1],
    ['font.autoFit', '화면에 맞춰 자동 축소', 'checkbox'],
    ['font.minSize', '최소 글꼴 크기 (px)', 'number', 1],
    ['font.weight', '굵기', 'select', [[400, '보통'], [500, '중간'], [700, '굵게']]],
    ['font.color', '글자 색', 'color'],
    ['font.lineHeight', '줄 간격 (배)', 'number', 0.05],
    ['font.letterSpacing', '자간 (px)', 'number', 0.5],
    ['h', '배치'],
    ['align', '가로 정렬', 'select', [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽'], ['hanging', '왼쪽 + 내어쓰기 (절 번호 앞, 본문 줄 맞춤)']]],
    ['valign', '세로 배치', 'select', [['top', '위'], ['middle', '가운데'], ['bottom', '아래']]],
    ['padding.top', '여백 위 (px)', 'number', 1],
    ['padding.bottom', '여백 아래 (px)', 'number', 1],
    ['padding.left', '여백 왼쪽 (px)', 'number', 1],
    ['padding.right', '여백 오른쪽 (px)', 'number', 1],
    ['h', '장절·절 번호'],
    ['reference.show', '장절 표시', 'checkbox'],
    ['reference.position', '장절 위치', 'select', [['top', '본문 위'], ['bottom', '본문 아래'], ['fixed-top', '화면 위 고정'], ['fixed-bottom', '화면 아래 고정']]],
    ['reference.mode', '장절 내용', 'select', [['slide', '슬라이드별 범위'], ['passage', '전체 범위 고정']]],
    ['reference.offset', '고정 장절의 가장자리 거리 (px)', 'number', 5],
    ['reference.align', '장절 정렬', 'select', [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']]],
    ['reference.size', '장절 크기 (px)', 'number', 1],
    ['reference.color', '장절 색', 'color'],
    ['verseNumbers.show', '절 번호 표시', 'checkbox'],
    ['verseNumbers.color', '절 번호 색', 'color'],
    ['verseBreak', '절마다 줄바꿈', 'checkbox'],
    ['versionLabel.show', '번역본 이름 표시', 'checkbox'],
    ['versionLabel.size', '번역본 이름 크기', 'number', 1],
    ['versionLabel.color', '번역본 이름 색', 'color'],
    ['headings.show', '단락 표제 표시', 'checkbox'],
    ['headings.color', '단락 표제 색', 'color'],
    ['h', '자막 상자·효과'],
    ['box.enabled', '본문 뒤 상자', 'checkbox'],
    ['box.color', '상자 색', 'color'],
    ['box.opacity', '상자 불투명도 (0~1)', 'number', 0.05],
    ['box.radius', '모서리 둥글기 (px)', 'number', 1],
    ['box.padding', '상자 안쪽 여백 (px)', 'number', 1],
    ['stroke.width', '외곽선 두께 (px)', 'number', 0.5],
    ['stroke.color', '외곽선 색', 'color'],
    ['shadow.enabled', '그림자', 'checkbox'],
    ['shadow.blur', '그림자 흐림 (px)', 'number', 1],
    ['shadow.y', '그림자 세로 위치 (px)', 'number', 1],
    ['shadow.color', '그림자 색 (CSS)', 'text'],
    ['h', '로고'],
    ['logo.show', '로고 표시', 'checkbox'],
    ['logo.image', '로고 이미지', 'logo'],
    ['logo.position', '로고 위치', 'select', [['top-left', '왼쪽 위'], ['top-center', '가운데 위'], ['top-right', '오른쪽 위'], ['bottom-left', '왼쪽 아래'], ['bottom-center', '가운데 아래'], ['bottom-right', '오른쪽 아래']]],
    ['logo.size', '로고 높이 (px)', 'number', 5],
    ['logo.opacity', '로고 불투명도 (0~1)', 'number', 0.05],
    ['logo.margin', '로고 가장자리 거리 (px)', 'number', 5],
    ['h', '전환'],
    ['animation.type', '전환 효과', 'select', [['dissolve', '디졸브'], ['cut', '컷']]],
    ['animation.duration', '전환 시간 (ms)', 'number', 50],
  ];
  const RES = [[1920, 1080, 'Full HD 1920×1080'], [3840, 2160, '4K 3840×2160'], [1280, 720, 'HD 1280×720']];

  const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
  const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

  async function loadFonts() {
    if (fontList) return fontList;
    const base = ['맑은 고딕', 'Malgun Gothic', '바탕', 'Batang', '굴림', 'Gulim', '돋움', 'Dotum', '궁서', 'Gungsuh', 'Noto Sans KR', 'Noto Serif KR', 'Pretendard', 'NanumGothic', 'NanumMyeongjo', 'NanumSquare', 'Apple SD Gothic Neo', 'AppleMyungjo', 'AppleGothic'];
    let names = [];
    try {
      if (window.queryLocalFonts) names = [...new Set((await window.queryLocalFonts()).map(f => f.family))];
    } catch { /* 권한 없음 */ }
    fontList = [...new Set([...base, ...names])].sort((a, b) => a.localeCompare(b, 'ko'));
    return fontList;
  }

  function fieldHtml([path, label, type, opt], t) {
    if (path === 'h') return `<h4>${esc(label)}</h4>`;
    const v = path === 'res' ? null : getPath(t, path);
    let input;
    if (type === 'text') input = `<input type="text" data-f="${path}" value="${esc(v)}">`;
    else if (type === 'number') input = `<input type="number" data-f="${path}" value="${v}" step="${opt || 1}" style="width:120px">`;
    else if (type === 'color') input = `<div class="row-flex"><input type="color" data-f="${path}" value="${esc(v)}"><span class="muted">${esc(v)}</span></div>`;
    else if (type === 'checkbox') input = `<input type="checkbox" data-f="${path}" ${v ? 'checked' : ''}>`;
    else if (type === 'select') input = `<select data-f="${path}">${opt.map(([k, l]) => `<option value="${k}" ${String(k) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    else if (type === 'font') {
      const first = (String(v).match(/^\s*['"]?([^'",]+)/) || [])[1] || '';
      input = `<div class="row-flex"><input type="text" list="fontNames" data-font value="${esc(first)}" style="width:220px"><span class="note" style="font-family:${esc(v)}">가나다 ABC 123</span></div><datalist id="fontNames"></datalist>`;
    } else if (type === 'image') {
      input = `<div class="row-flex"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-img>${v ? `<span class="muted">${esc(v)}</span><button data-imgclear>제거</button>` : ''}</div>`;
    } else if (type === 'logo') {
      const opts2 = [['', '(없음)'], ['/shared/assets/sa-shield.png', '구세군 레드 쉴드'], ['/shared/assets/sa-crest.png', '구세군 크레스트(문장)']];
      if (v && !opts2.some(o => o[0] === v)) opts2.push([v, '올린 이미지']);
      input = `<div class="row-flex"><select data-f="logo.image">${opts2.map(([k, l]) => `<option value="${esc(k)}" ${k === (v || '') ? 'selected' : ''}>${l}</option>`).join('')}</select><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-logoimg title="다른 로고 이미지 올리기"></div>`;
    } else if (type === 'res') {
      const k = `${t.width}x${t.height}`;
      input = `<div class="row-flex"><select data-res>${RES.map(([w, h, l]) => `<option value="${w}x${h}" ${k === `${w}x${h}` ? 'selected' : ''}>${l}</option>`).join('')}<option value="custom" ${RES.some(([w, h]) => k === `${w}x${h}`) ? '' : 'selected'}>사용자 지정</option></select>
        <input type="number" data-f="width" value="${t.width}" style="width:90px"> × <input type="number" data-f="height" value="${t.height}" style="width:90px"></div>`;
    }
    return `<label>${esc(label)}</label>${input}`;
  }

  function drawTemplates() {
    const s = S();
    if (!tplEdit) {
      const id = (tplEdit && tplEdit.id) || s.activeTemplates.main;
      tplEdit = structuredClone(s.templates.find(t => t.id === id) || s.templates[0]);
    }
    const t = tplEdit;
    const usedBy = Object.entries(s.activeTemplates).filter(([, id]) => id === t.id).map(([o]) => o === 'main' ? '전체 화면' : 'OBS 자막');
    $('#setBody').innerHTML = `
      <div class="row-flex" style="margin-bottom:12px">
        <select id="tSel">${s.templates.map(x => `<option value="${esc(x.id)}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name)}${x.preset ? ' (기본)' : ''}</option>`).join('')}</select>
        <button id="tSave">저장</button><button id="tDup">복제</button><button id="tNew">새 템플릿</button><button id="tDel">삭제</button>
        <span class="note">${usedBy.length ? '사용 중: ' + usedBy.join(', ') : ''}</span>
        <span id="tDirty" class="warn-text"></span>
      </div>
      <div class="tpl-layout">
        <div>
          <div class="tpl-name row-flex"><span class="muted">템플릿 이름</span><input type="text" id="tName" value="${esc(t.name)}" style="flex:1"></div>
          <div id="tVisual"></div>
          <details class="tc-adv"${tplAdvOpen ? ' open' : ''}><summary>고급 설정 — 해상도·안전영역·배경 이미지·외곽선·전환 효과 등 모든 항목</summary>
            <div class="form" id="tForm">${FIELDS.map(f => fieldHtml(f, t)).join('')}</div>
          </details>
        </div>
        <div class="tpl-preview"><div class="note">미리보기 (저장 전)</div><div id="tPrev" class="screen"></div>
          <div class="note" id="tFitInfo"></div>
          <div class="note">저장하면 이 템플릿을 쓰는 출력 화면에 즉시 반영됩니다. 송출 중인 본문의 슬라이드 분할은 다시 송출할 때 새 설정으로 계산됩니다.</div></div>
      </div>`;
    loadFonts().then(list => { const dl = $('#fontNames'); if (dl) dl.innerHTML = list.map(n => `<option value="${esc(n)}">`).join(''); });
    drawTplPreview();
    const form = $('#tForm');
    const setDirty = () => { tplDirty = true; $('#tDirty').textContent = '저장하지 않은 변경 사항'; drawTplPreview(); };
    // 위쪽 그림 조작 부품 ↔ 아래 고급 설정 양식을 서로 맞춰 준다
    const renderVisual = () => window.BCTplControls.render($('#tVisual'), t, () => {
      setDirty();
      form.innerHTML = FIELDS.map(f => fieldHtml(f, t)).join('');
      loadFonts().then(list => { const dl = $('#fontNames'); if (dl) dl.innerHTML = list.map(n => `<option value="${esc(n)}">`).join(''); });
    });
    renderVisual();
    const markDirty = () => { setDirty(); renderVisual(); };
    $('#tName').addEventListener('input', e => { t.name = e.target.value; setDirty(); });
    $('.tc-adv').addEventListener('toggle', e => { tplAdvOpen = e.target.open; });
    form.addEventListener('input', e => {
      const el = e.target;
      if (el.dataset.f) {
        const f = FIELDS.find(x => x[0] === el.dataset.f);
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (el.type === 'number') v = Number(v);
        if (f && f[2] === 'select' && typeof f[3][0][0] === 'number') v = Number(v);
        setPath(t, el.dataset.f, v);
        if (el.type === 'color') el.nextElementSibling.textContent = v;
      } else if (el.dataset.font !== undefined) {
        const name = el.value.trim();
        t.font.family = name ? `'${name.replace(/'/g, '')}', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif` : "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
        el.nextElementSibling.style.fontFamily = t.font.family;
      } else if (el.dataset.res !== undefined && el.value !== 'custom') {
        const [w, h] = el.value.split('x').map(Number);
        t.width = w; t.height = h;
        form.querySelector('[data-f=width]').value = w;
        form.querySelector('[data-f=height]').value = h;
      }
      markDirty();
    });
    form.addEventListener('change', async e => {
      if (e.target.dataset.img !== undefined && e.target.files[0]) {
        const f = e.target.files[0];
        const r = await fetch('/api/media', { method: 'POST', headers: { 'X-WorshipCue': '1', 'X-Filename': encodeURIComponent(f.name).replace(/%/g, '') || 'image.png', 'Content-Type': 'application/octet-stream' }, body: f }).then(x => x.json()).catch(err => ({ ok: false, error: err.message }));
        if (!r.ok) return app.showMsg(r.error, 'error');
        t.background.image = r.url;
        t.background.type = 'image';
        tplDirty = true;
        drawTemplatesKeep();
      }
    });
    form.addEventListener('change', async e => {
      if (e.target.dataset.logoimg === undefined || !e.target.files[0]) return;
      const f = e.target.files[0];
      const r = await fetch('/api/media', { method: 'POST', headers: { 'X-WorshipCue': '1', 'X-Filename': encodeURIComponent(f.name).replace(/%/g, '') || 'logo.png', 'Content-Type': 'application/octet-stream' }, body: f }).then(x => x.json()).catch(err => ({ ok: false, error: err.message }));
      if (!r.ok) return app.showMsg(r.error, 'error');
      t.logo.image = r.url; t.logo.show = true; tplDirty = true;
      drawTemplatesKeep();
    });
    form.addEventListener('click', e => {
      if (e.target.dataset.imgclear !== undefined) { t.background.image = ''; if (t.background.type === 'image') t.background.type = 'color'; tplDirty = true; drawTemplatesKeep(); }
    });
    $('#tSel').onchange = e => {
      if (tplDirty && !confirm('저장하지 않은 변경 사항을 버릴까요?')) { e.target.value = t.id; return; }
      tplEdit = structuredClone(s.templates.find(x => x.id === e.target.value)); tplDirty = false; drawTemplates();
    };
    $('#tSave').onclick = async () => {
      const r = await cmd('saveTemplate', { template: t });
      if (!r.ok) return app.showMsg(r.error, 'error');
      tplDirty = false; tplEdit = structuredClone(r.result);
      app.showMsg(`'${t.name}' 템플릿을 저장했습니다.`, 'ok', 2000);
      drawTemplates();
    };
    $('#tDup').onclick = async () => {
      const name = prompt('복제할 템플릿 이름', t.name + ' 복사본');
      if (!name) return;
      const r = await cmd('duplicateTemplate', { id: t.id, name });
      if (!r.ok) return app.showMsg(r.error, 'error');
      tplEdit = structuredClone(r.result); tplDirty = false; drawTemplates();
    };
    $('#tNew').onclick = async () => {
      const name = prompt('새 템플릿 이름', '새 템플릿');
      if (!name) return;
      const r = await cmd('saveTemplate', { template: { name } });
      if (!r.ok) return app.showMsg(r.error, 'error');
      tplEdit = structuredClone(r.result); tplDirty = false; drawTemplates();
    };
    $('#tDel').onclick = async () => {
      if (!confirm(`'${t.name}' 템플릿을 삭제할까요?`)) return;
      const r = await cmd('deleteTemplate', { id: t.id });
      if (!r.ok) return app.showMsg(r.error, 'error');
      tplEdit = null; tplDirty = false; drawTemplates();
    };
  }

  function drawTemplatesKeep() {
    const dirty = tplDirty;
    drawTemplates();
    tplDirty = dirty;
    if (dirty) $('#tDirty').textContent = '저장하지 않은 변경 사항';
  }

  function drawTplPreview() {
    const t = tplEdit;
    const p = app.preview;
    const slide = p ? p.slides[p.index] : {
      ref: '요한복음 3:16', parts: [{ book: 43, chapter: 3, verse: 16, text: '(예시 본문) 검색한 본문이 있으면 그 본문으로 미리 봅니다. 글꼴·크기·색상·배치를 바꾸면 이 화면에 바로 보입니다.' }],
    };
    const r = R.renderInto($('#tPrev'), slide, t, { checker: true, versionName: p ? p.passage.versionName : '번역본' });
    $('#tFitInfo').innerHTML = r.fits ? `적용 글꼴 크기: ${r.size}px` : `<span class="err-text">최소 글꼴 크기로도 화면에 들어가지 않습니다. 실제 송출 시 자동으로 슬라이드를 나눕니다.</span>`;
  }

  // ---------------- 검색·분할 ----------------
  function drawBehavior() {
    const s = S();
    $('#setBody').innerHTML = `<div class="form">
      <h4 data-noi18n>화면 언어 · Language</h4>
      <label data-noi18n>언어 · Language</label>
      <select id="bLang" data-noi18n><option value="ko">한국어</option><option value="en">English</option></select>
      <h4>검색</h4>
      <label>기본 검색 방식</label>
      <select id="bMode"><option value="auto">자동 (숫자가 있으면 장절, 없으면 본문)</option><option value="reference">장절만</option><option value="text">본문 단어만</option></select>
      <span></span><div class="note">Enter: 검색 후 미리보기 · Ctrl+Enter: 미리보기 후 즉시 송출. 장절 형식 예) 요3:16 · 요한복음 3장 16절 · 행5:27-32 · 롬 8 · 창1:1-2:3 · 롬8:1,28<br>본문 검색: 여러 단어는 모두 포함하는 구절, "따옴표"는 구문 검색. 띄어쓰기 차이는 무시합니다.</div>
      <h4>슬라이드 분할</h4>
      <label>분할 방식</label>
      <div class="row-flex"><select id="bSplit"><option value="auto">화면 공간에 맞춰 자동</option><option value="count">지정한 절 수만큼</option></select>
        <input type="number" id="bCount" min="1" max="20" value="${s.split.count}" style="width:80px"> 절씩</div>
      <span></span><div class="note">어느 방식이든 글자가 화면 밖으로 잘리지 않도록, 최소 글꼴 크기에서도 넘치면 자동으로 더 나눕니다. 한 절이 길면 같은 절 번호로 (1/2), (2/2)처럼 이어서 표시합니다.</div>
      <h4>슬라이드 이동 (F5 / F6)</h4>
      <label>범위 끝에서</label>
      <select id="bNav"><option value="range">선택한 범위 안에서만 이동</option><option value="continuous">다음(이전) 절로 계속 이어가기</option></select>
      <span></span><div class="note">‘계속 이어가기’는 장이 끝나면 다음 장으로 넘어가고, 책의 처음·끝에서는 멈춥니다.</div>
      <h4>큐시트</h4>
      <label>순서의 끝에서</label>
      <label class="tc-toggle"><input type="checkbox" id="bCueAdv" ${s.cueAdvance !== false ? 'checked' : ''}> F6 을 누르면 다음 순서로 넘어가 바로 송출 (F5 는 이전 순서의 마지막 슬라이드)</label>
      <label class="tc-toggle"><input type="checkbox" id="bCueTimes" ${s.cueTimes === true ? 'checked' : ''}> ⏰ 예배 진행 시계 쓰기 (예배 시작 시각 · 순서별 예정 시간 · 몇 분 늦음)</label>
    </div>`;
    $('#bMode').value = s.searchMode;
    $('#bLang').value = s.uiLang === 'en' ? 'en' : 'ko';
    $('#bLang').onchange = e => cmd('updateSettings', { patch: { uiLang: e.target.value } });
    $('#bSplit').value = s.split.mode;
    $('#bNav').value = s.navMode;
    $('#bMode').onchange = e => cmd('updateSettings', { patch: { searchMode: e.target.value } });
    $('#bSplit').onchange = e => cmd('updateSettings', { patch: { split: { mode: e.target.value } } });
    $('#bCount').onchange = e => cmd('updateSettings', { patch: { split: { count: +e.target.value } } });
    $('#bNav').onchange = e => cmd('updateSettings', { patch: { navMode: e.target.value } });
    $('#bCueAdv').onchange = e => cmd('updateSettings', { patch: { cueAdvance: e.target.checked } });
    $('#bCueTimes').onchange = e => window.BCCue && window.BCCue.setTimes(e.target.checked);
  }

  // ---------------- 단축키 ----------------
  async function drawShortcuts() {
    const s = S();
    if (!keyDraft) keyDraft = { ...s.shortcuts };
    const labels = app.state.shortcutLabels;
    const defs = app.state.defaultShortcuts;
    const reserved = s.reservedKeys.split(',').map(x => x.trim()).filter(Boolean);
    const counts = {};
    for (const k of Object.values(keyDraft)) if (k) counts[k] = (counts[k] || 0) + 1;
    const gs = await cmd('getGlobalShortcutStatus');
    if (tab !== 'shortcuts' || !$('#setBody')) return;
    const gStat = gs.ok ? gs.result : { available: false };
    $('#setBody').innerHTML = `
      <table class="list"><tr><th>기능</th><th>단축키</th><th>기본값</th><th></th></tr>
      ${Object.keys(labels).map(a => {
        const k = keyDraft[a] || '';
        const dup = k && counts[k] > 1;
        const resv = k && reserved.includes(k);
        const gFail = gStat.failed && gStat.failed.includes(a);
        return `<tr><td>${esc(labels[a])}</td>
          <td><button class="keycap ${dup ? 'dup' : ''}" data-a="${a}">${esc(k || '(사용 안 함)')}</button>
            ${dup ? '<div class="err-text note">중복된 단축키</div>' : ''}${resv ? '<div class="warn-text note">다른 프로그램 단축키와 겹침</div>' : ''}${gFail ? '<div class="warn-text note">전역 등록 실패 (다른 프로그램이 사용 중)</div>' : ''}</td>
          <td class="muted">${esc(defs[a])}</td><td><button data-clear="${a}">지우기</button></td></tr>`;
      }).join('')}</table>
      <div class="row-flex" style="margin-top:12px"><button id="kSave">단축키 저장</button><button id="kReset">기본값으로</button><span id="kMsg" class="note"></span></div>
      <div class="form" style="margin-top:16px">
        <h4>충돌 방지</h4>
        <label>다른 프로그램 단축키</label>
        <input type="text" id="kReserved" value="${esc(s.reservedKeys)}" placeholder="예: F1, Ctrl+Shift+S (OBS·다른 예배 프로그램에서 쓰는 키)">
        <span></span><div class="note">여기에 적은 키와 겹치면 경고를 표시합니다. 단독 글자키(A, 1 등)와 Enter는 검색창 입력과 겹치므로 등록할 수 없습니다.</div>
        <label>전역 단축키</label>
        <label><input type="checkbox" id="kGlobal" ${s.globalShortcuts ? 'checked' : ''} ${gStat.available ? '' : 'disabled'}> 다른 프로그램(OBS 등)에 초점이 있어도 송출 단축키(이전·다음·송출·숨김) 사용</label>
        <span></span><div class="note">${gStat.available ? '기본값은 꺼짐입니다. 켜면 해당 키가 다른 모든 프로그램에서 WorshipCue 로 전달되므로, OBS 단축키와 겹치지 않는지 확인하세요.' : '데스크톱 프로그램에서만 사용할 수 있습니다.'}</div>
      </div>`;
    const body = $('#setBody');
    body.querySelectorAll('.keycap').forEach(b => b.onclick = () => {
      body.querySelectorAll('.keycap').forEach(x => x.classList.remove('capturing'));
      b.classList.add('capturing');
      b.textContent = '키를 누르세요… (Esc 취소)';
      app.capturing = combo => {
        app.capturing = null;
        if (combo !== 'Escape') keyDraft[b.dataset.a] = combo;
        drawShortcuts();
      };
    });
    body.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => { keyDraft[b.dataset.clear] = ''; drawShortcuts(); });
    $('#kSave').onclick = async () => {
      const r = await cmd('setShortcuts', { shortcuts: keyDraft });
      if (!r.ok) { $('#kMsg').innerHTML = `<span class="err-text">${esc(r.error)}</span>`; return; }
      keyDraft = null;
      app.showMsg('단축키를 저장했습니다.', 'ok', 2000);
      drawShortcuts();
    };
    $('#kReset').onclick = () => { keyDraft = { ...defs }; drawShortcuts(); };
    $('#kReserved').onchange = async e => { await cmd('updateSettings', { patch: { reservedKeys: e.target.value } }); drawShortcuts(); };
    $('#kGlobal').onchange = async e => { await cmd('updateSettings', { patch: { globalShortcuts: e.target.checked } }); setTimeout(drawShortcuts, 300); };
  }

  // ---------------- 성경 데이터 ----------------
  function drawData() {
    const vs = app.state.versions;
    const r = importState;
    $('#setBody').innerHTML = `
      <h4 style="margin-top:0;color:var(--hl)">베들레헴 성경에서 가져오기</h4>
      <div class="note">개역개정·쉬운성경·우리말·현대인·ESV·NIV 등은 <b>베들레헴 성경</b>을 설치한 뒤 그 데이터를 가져와 쓸 수 있습니다.
        설치 방법: <button id="bhSetup">베들레헴 설치 안내 페이지 열기</button> → 받은 압축을 풀어 <b>BethlehemWin</b> 폴더를 C 드라이브 등의 맨 위(예: C:\\BethlehemWin)에 복사</div>
      <div class="row-flex" style="margin:8px 0"><button id="bhFind">자동으로 찾기</button>
        <input type="text" id="bhDir" placeholder="또는 폴더 경로 직접 입력 (예: D:\\BethlehemWin)" style="width:340px"><button id="bhFindDir">이 폴더에서 찾기</button><span id="bhMsg" class="note"></span></div>
      <div id="bhList"></div>
      <h4 style="color:var(--hl)">설치된 번역본</h4>
      ${vs.length ? `<table class="list"><tr><th>ID</th><th>이름</th><th>구절 수</th><th>저작권</th><th>사용 허가</th><th>출처</th><th></th></tr>
        ${vs.map(v => `<tr><td>${esc(v.id)}</td><td><b>${esc(v.name)}</b></td><td>${v.verse_count.toLocaleString()}</td><td>${esc(v.copyright)}</td><td>${esc(v.license)}</td><td>${esc(v.source)}</td>
          <td><button data-del="${esc(v.id)}">삭제</button></td></tr>`).join('')}</table>` : '<div class="note">설치된 번역본이 없습니다.</div>'}
      <h4 style="color:var(--hl)">성경 데이터 가져오기</h4>
      <div class="note">지원 형식: JSON · CSV(책,장,절,본문) · Zefania XML · 베들레헴 성경(.bdb). 같은 ID로 가져오면 기존 데이터를 교체합니다.<br>
        <b class="warn-text">사용 허가를 확인한 번역본만 가져오세요.</b> 개역개정·새번역 등 보호 대상 번역본은 권리자(대한성서공회 등)의 허가가 필요합니다.</div>
      <div class="row-flex" style="margin:10px 0"><input type="file" id="dFile" accept=".json,.csv,.tsv,.txt,.xml,.bdb"><span id="dBusy" class="note"></span></div>
      <div id="dReport"></div>
      <h4 style="color:var(--hl);margin-top:22px">주석서 (조작 화면 참고용 · 송출되지 않음)</h4>
      ${(app.state.commentaries || []).length ? `<table class="list"><tr><th>ID</th><th>이름</th><th>항목 수</th><th>출처</th><th></th></tr>
        ${app.state.commentaries.map(c => `<tr><td>${esc(c.id)}</td><td><b>${esc(c.name)}</b></td><td>${c.entry_count.toLocaleString()}</td><td>${esc(c.source)}</td><td><button data-cdel="${esc(c.id)}">삭제</button></td></tr>`).join('')}</table>` : '<div class="note">설치된 주석서가 없습니다.</div>'}
      <div class="note" style="margin-top:6px">EPUB 주석서를 가져오면 본문 속 "1:1 태초에." 같은 절 표시를 찾아 절 단위로 나눕니다. 스캔본을 글자로 바꾼 책은 오타·단 섞임이 남을 수 있습니다.</div>
      <div class="row-flex" style="margin:10px 0"><input type="file" id="cFile" accept=".epub"><span id="cBusy" class="note"></span></div>
      <div id="cReport"></div>`;
    $('#setBody').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm(`'${b.dataset.del}' 번역본을 삭제할까요? 되돌릴 수 없습니다.`)) return;
      const x = await cmd('deleteVersion', { id: b.dataset.del });
      if (!x.ok) app.showMsg(x.error, 'error');
    });
    $('#dFile').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      $('#dBusy').textContent = '파일을 분석하는 중…';
      const x = await fetch('/api/import', { method: 'POST', headers: { 'X-WorshipCue': '1', 'X-Filename': encodeURIComponent(f.name).replace(/%/g, '') || 'import', 'Content-Type': 'application/octet-stream' }, body: f })
        .then(res => res.json()).catch(err => ({ ok: false, error: err.message }));
      $('#dBusy').textContent = '';
      if (!x.ok) return app.showMsg(x.error, 'error');
      importState = x.result;
      importState.fileName = f.name;
      drawReport();
    };
    if (r) drawReport();
    const findBh = async dir => {
      $('#bhMsg').textContent = '찾는 중…';
      const r = await cmd('findBethlehem', dir ? { dir } : {});
      $('#bhMsg').textContent = '';
      if (!r.ok) return app.showMsg(r.error, 'error');
      if (!r.result.length) { $('#bhList').innerHTML = '<div class="warn-text note">BethlehemWin 폴더를 찾지 못했습니다. 베들레헴을 설치했다면 폴더 경로를 직접 입력하세요.</div>'; return; }
      const installed = new Set(app.state.versions.map(v => v.id));
      $('#bhList').innerHTML = r.result.map((g, gi) => `<div class="report" style="margin-bottom:8px"><div><b>${esc(g.dir)}</b></div>
        <div class="row-flex" style="flex-wrap:wrap;margin:6px 0">${g.bibles.map(b => `<label class="tc-toggle" style="min-width:150px"><input type="checkbox" data-g="${gi}" value="${esc(b.file)}" ${b.known ? 'checked' : ''}>${esc(b.name)}${installed.has(b.id) ? ' <span class="muted">(설치됨·교체)</span>' : ''}</label>`).join('')}</div>
        <button data-bhgo="${gi}">선택한 번역본 가져오기</button> <span class="note" id="bhRes${gi}"></span></div>`).join('');
      $('#bhList').querySelectorAll('[data-bhgo]').forEach(btn => btn.onclick = async () => {
        const gi = +btn.dataset.bhgo;
        const files = [...$('#bhList').querySelectorAll(`input[data-g="${gi}"]:checked`)].map(x => x.value);
        if (!files.length) return;
        btn.disabled = true;
        $('#bhRes' + gi).textContent = `${files.length}개 가져오는 중… (번역본마다 1~2초)`;
        const x = await cmd('importBethlehem', { dir: r.result[gi].dir, files });
        btn.disabled = false;
        if (!x.ok) { $('#bhRes' + gi).innerHTML = `<span class="err-text">${esc(x.error)}</span>`; return; }
        const ok = x.result.filter(y => y.ok), bad = x.result.filter(y => !y.ok);
        app.showMsg(`베들레헴에서 ${ok.length}개 번역본을 가져왔습니다.`, 'ok');
        drawData();
        if (bad.length) setTimeout(() => app.showMsg('가져오지 못한 파일: ' + bad.map(y => `${y.file} (${y.error})`).join(', '), 'error', 8000), 300);
      });
    };
    $('#bhSetup').onclick = () => app.openBethlehemSetup();
    $('#bhFind').onclick = () => findBh('');
    $('#bhFindDir').onclick = () => findBh($('#bhDir').value.trim());
    $('#setBody').querySelectorAll('[data-cdel]').forEach(b => b.onclick = async () => {
      if (!confirm(`'${b.dataset.cdel}' 주석서를 삭제할까요?`)) return;
      const x = await cmd('deleteCommentary', { id: b.dataset.cdel });
      if (!x.ok) app.showMsg(x.error, 'error'); else drawData();
    });
    $('#cFile').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      $('#cBusy').textContent = '주석서를 분석하는 중… (책이 크면 몇 초 걸립니다)';
      const x = await fetch('/api/import', { method: 'POST', headers: { 'X-WorshipCue': '1', 'X-Filename': (encodeURIComponent(f.name).replace(/%/g, '') || 'book') + '.epub', 'Content-Type': 'application/octet-stream' }, body: f })
        .then(res => res.json()).catch(err => ({ ok: false, error: err.message }));
      $('#cBusy').textContent = '';
      if (!x.ok) return app.showMsg(x.error, 'error');
      const a = x.result;
      $('#cReport').innerHTML = `<div class="report">
        <div>제목: <b>${esc(a.title)}</b> · 주석 항목 <b>${a.entries.toLocaleString()}</b> · 상자 글 ${a.articles} · 주석이 있는 책 ${a.books}권</div>
        ${a.weak.length ? `<div class="warn-text">범위가 적거나 찾지 못한 책: ${esc(a.weak.join(', '))}</div>` : ''}
      </div>
      <div class="form" style="margin-top:8px">
        <label>주석 ID *</label><input type="text" id="cId" value="ivp-bg" placeholder="영문 (예: ivp-bg)">
        <label>주석 이름 *</label><input type="text" id="cName" value="${esc(a.title)}">
        <label>출처</label><input type="text" id="cSrc" value="${esc(f.name)}">
        <span></span><div class="row-flex"><button id="cGo">가져오기</button><button id="cCancel">취소</button><span id="cMsg"></span></div>
      </div>`;
      $('#cCancel').onclick = () => { $('#cReport').innerHTML = ''; $('#cFile').value = ''; };
      $('#cGo').onclick = async () => {
        const meta = { id: $('#cId').value.trim(), name: $('#cName').value.trim(), source: $('#cSrc').value.trim(), license: '개인 소장본 (조작 화면 참고용)' };
        const y = await cmd('commitCommentary', { token: a.token, meta });
        if (!y.ok) { $('#cMsg').innerHTML = `<span class="err-text">${esc(y.error)}</span>`; return; }
        app.showMsg(`${meta.name}: 주석 ${y.result.entries.toLocaleString()}항목을 가져왔습니다.`, 'ok');
        drawData();
      };
    };
  }

  function drawReport() {
    const r = importState.report;
    const m = importState.meta || {};
    const ok = !r.errors.length;
    const list = (title, arr, cls) => arr.length ? `<div class="${cls}"><b>${title} (${arr.length})</b><ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
    $('#dReport').innerHTML = `<div class="report">
      <div>파일: <b>${esc(importState.fileName)}</b> · 형식: ${esc(r.format)} · 인코딩: ${esc(r.encoding)}</div>
      <div>구절 ${r.stats.verses?.toLocaleString() ?? 0} · 책 ${r.stats.books ?? 0}권 · 표제 ${r.stats.headings ?? 0} · 각주 ${r.stats.notes ?? 0}</div>
      ${list('오류 — 가져올 수 없습니다', r.errors, 'err-text')}
      ${list('경고', r.warnings, 'warn-text')}
      ${list('참고', r.notes, 'note')}
      ${ok ? '<div class="ok-text">검증을 통과했습니다. 번역본 정보를 입력하고 가져오세요.</div>' : ''}
    </div>
    <div class="form" style="margin-top:10px">
      <label>번역본 ID *</label><input type="text" id="mId" value="${esc(m.id || m.identifier || '')}" placeholder="영문 (예: krv)">
      <label>번역본 이름 *</label><input type="text" id="mName" value="${esc(m.name || '')}" placeholder="예: 개역한글">
      <label>언어</label><input type="text" id="mLang" value="${esc(m.language || 'ko')}">
      <label>저작권</label><input type="text" id="mCopy" value="${esc(m.copyright || '')}" placeholder="예: 저작재산권 보호기간 만료">
      <label>사용 허가 정보 *</label><input type="text" id="mLic" value="${esc(m.license || '')}" placeholder="예: 공공 영역 / 대한성서공회 허가 번호 등">
      <label>데이터 출처 *</label><input type="text" id="mSrc" value="${esc(m.source || '')}" placeholder="파일을 받은 곳">
      <span></span><div class="row-flex"><button id="mGo" ${ok ? '' : 'disabled'}>가져오기</button><button id="mCancel">취소</button><span id="mMsg"></span></div>
    </div>`;
    $('#mCancel').onclick = () => { importState = null; drawData(); };
    $('#mGo').onclick = async () => {
      const meta = { id: $('#mId').value.trim(), name: $('#mName').value.trim(), language: $('#mLang').value.trim(), copyright: $('#mCopy').value.trim(), license: $('#mLic').value.trim(), source: $('#mSrc').value.trim() };
      if (app.state.versions.some(v => v.id === meta.id) && !confirm(`'${meta.id}' 번역본을 새 데이터로 교체할까요?`)) return;
      $('#mMsg').textContent = '가져오는 중…';
      const x = await cmd('commitImport', { token: importState.token, meta });
      if (!x.ok) { $('#mMsg').innerHTML = `<span class="err-text">${esc(x.error)}</span>`; return; }
      app.showMsg(`${meta.name}: ${x.result.stats.verses.toLocaleString()}절을 가져왔습니다.`, 'ok');
      importState = null;
      drawData();
      app.cmd('getState').then(st => { if (st.ok && !document.querySelector('#results .row')) location.reload(); });
    };
  }

  // ---------------- 정보 ----------------
  function drawAbout() {
    const vs = app.state.versions;
    $('#setBody').innerHTML = `
      <h4 style="margin-top:0;color:var(--hl)">WorshipCue</h4>
      <div class="note">교회 방송실용 성경구절 실시간 송출 프로그램 · 버전 1.0.0<br>데이터 폴더: <span class="url">${esc(app.state.dataDir)}</span> (설정·성경 DB·로그)</div>
      <h4 style="color:var(--hl)">성경 데이터 출처 및 라이선스</h4>
      ${vs.length ? vs.map(v => `<div style="margin-bottom:10px"><b>${esc(v.name)}</b> (${esc(v.id)})<br>
        <span class="note">저작권: ${esc(v.copyright || '-')} · 사용 허가: ${esc(v.license || '-')} · 출처: ${esc(v.source || '-')} · 가져온 날짜: ${esc((v.imported_at || '').slice(0, 10))}</span></div>`).join('') : '<div class="note">설치된 번역본이 없습니다.</div>'}
      <h4 style="color:var(--hl)">저작권 안내</h4>
      <div class="note">프로그램은 성경 본문을 포함하지 않으며, 사용자가 사용 권한을 확인한 데이터를 가져와 사용합니다.<br>
        · 개역한글판은 대한성서공회 안내상 저작재산권 보호기간이 만료된 번역본입니다.<br>
        · 개역개정·새번역 등 보호 대상 번역본은 권리자의 사용 허가를 받은 뒤 사용하세요.<br>
        · 온라인 영상 송출, 프로그램 재배포 등 사용 범위는 각 번역본의 이용 조건을 별도로 확인하세요.</div>`;
  }

  window.BCSettings = { open, onState, closed };
})();
