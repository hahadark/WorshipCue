/* 큐시트(예배 순서) 패널
 * - 예배 순서를 미리 만들어 두고, 항목을 고르면 미리보기 / 더블클릭·F9 로 송출
 * - 항목의 마지막 슬라이드에서 F6 → 다음 순서의 첫 슬라이드를 송출 (코어가 'cue-next' 로 알려 줌)
 */
(function () {
  'use strict';
  const app = window.BC;
  const SL = window.BCSlides;
  const esc = window.BCRender.esc;
  const $ = s => document.querySelector(s);
  const cmd = app.cmd;

  const ICON = { bible: '📖', song: '🎵', text: '📢', title: '🏷', image: '🖼', blank: '⬛' };
  const TYPE = { bible: '성경', song: '찬양', text: '공지', title: '제목', image: '이미지', blank: '빈 화면' };
  const st = { list: [], cue: null, sel: -1, dragFrom: -1, saving: null, lastSave: 0 };

  // ---------------- 불러오기·저장 ----------------
  async function init() {
    await refreshList();
    let id = app.state.settings.activeCueId;
    if (!st.list.some(c => c.id === id)) id = st.list[0] && st.list[0].id;
    if (!id) {
      const r = await cmd('newCue', {});
      if (r.ok) { await refreshList(); id = r.result.id; }
    }
    if (id) await openCue(id);
  }

  async function refreshList() {
    const r = await cmd('listCues');
    st.list = r.ok ? r.result : [];
    const sel = $('#cueSel');
    sel.innerHTML = st.list.map(c => `<option value="${esc(c.id)}">${esc(c.name)} (${c.count})</option>`).join('') || '<option value="">(큐시트 없음)</option>';
    if (st.cue) sel.value = st.cue.id;
  }

  async function openCue(id) {
    const r = await cmd('getCue', { id });
    if (!r.ok) return app.showMsg(r.error, 'error');
    st.cue = r.result;
    st.sel = Math.min(st.sel, st.cue.items.length - 1);
    $('#cueSel').value = id;
    cmd('setActiveCue', { id });
    render();
  }

  /** 바뀐 내용을 곧바로 저장 (연속 변경은 모아서) */
  function save() {
    clearTimeout(st.saving);
    st.saving = setTimeout(async () => {
      st.lastSave = Date.now();
      const r = await cmd('saveCue', { cue: st.cue });
      if (!r.ok) return app.showMsg(r.error, 'error');
      st.cue = r.result;
      refreshList();
    }, 150);
    render();
  }

  // ---------------- 목록 그리기 ----------------
  function detail(it) {
    switch (it.type) {
      case 'bible': return it.ref;
      case 'song': return (it.lyrics || '').split('\n').find(l => l.trim() && !/^\[.*\]$/.test(l.trim())) || '(가사 없음)';
      case 'text': return (it.body || '').split('\n').find(l => l.trim()) || '(내용 없음)';
      case 'title': return it.subtitle || '';
      case 'image': return '이미지';
      case 'blank': return it.mode === 'background' ? '배경·로고만' : '검은 화면';
    }
    return '';
  }

  function render() {
    const el = $('#cueList');
    if (!st.cue) { el.innerHTML = ''; return; }
    const live = app.state.live;
    const airIdx = live.hasLive && live.passage && live.passage.cueId === st.cue.id ? live.passage.cueIndex : -1;
    const pvIdx = app.preview && app.preview.cue && app.preview.cue.id === st.cue.id ? app.preview.cue.index : -1;
    el.innerHTML = st.cue.items.length ? st.cue.items.map((it, i) => `
      <div class="cue-item ${i === st.sel ? 'sel' : ''} ${i === pvIdx ? 'pv' : ''} ${i === airIdx ? 'air' : ''} ${i === airIdx && !live.visible ? 'hid' : ''}" draggable="true" data-i="${i}">
        <span class="cue-no">${i + 1}</span>
        <span class="cue-ico" title="${TYPE[it.type]}">${ICON[it.type]}</span>
        <span class="cue-body"><b>${esc(it.title)}</b><span class="cue-detail">${esc(detail(it))}</span>${it.note ? `<span class="cue-note">📝 ${esc(it.note)}</span>` : ''}</span>
        <button class="cue-edit" data-edit="${i}" title="편집 (F2)">✎</button>
      </div>`).join('') : '<div class="empty">아래 버튼으로 예배 순서를 추가하세요.</div>';
    el.querySelector('.cue-item.sel')?.scrollIntoView({ block: 'nearest' });
  }

  // ---------------- 미리보기·송출 ----------------
  function textPseudo(it) { return { title: it.title, versionName: '', verses: [], book: null }; }

  /** 항목 → 미리보기. fromEnd 면 마지막 슬라이드에 둔다 */
  async function previewItem(i, { fromEnd = false } = {}) {
    if (!st.cue || i < 0 || i >= st.cue.items.length) return false;
    const it = st.cue.items[i];
    st.sel = i;
    const cue = { id: st.cue.id, index: i, title: it.title };
    if (it.type === 'bible') {
      const r = await cmd('searchReference', { query: it.ref, versionId: it.versionId || undefined });
      if (!r.ok) { app.showMsg(`${i + 1}번 '${it.title}': ${r.error}`, 'error', 5000); render(); return false; }
      const passage = r.result.passage;
      const count = SL.build(passage, app.splitOpts()).length;
      await app.loadPassage(passage, { query: it.ref, index: fromEnd ? count - 1 : 0 });
      app.preview.cue = cue;
      $('#resultTitle').textContent = `${i + 1}. ${it.title} — ${passage.title}`;
    } else {
      const build = () => buildSlides(it);
      const slides = build();
      await app.loadSlides(textPseudo(it), slides, { query: it.title, index: fromEnd ? slides.length - 1 : 0, cue, rebuild: build });
      showSlideList(i, it);
    }
    render();
    return true;
  }

  function buildSlides(it) {
    const opts = app.splitOpts();
    let slides = [];
    if (it.type === 'song') slides = SL.buildText({ title: it.title, showTitle: it.showTitle, chunks: SL.lyricsChunks(it.lyrics) }, opts);
    else if (it.type === 'text') slides = SL.buildText({ title: it.title, showTitle: true, chunks: SL.textChunks(it.body) }, opts);
    else if (it.type === 'image') slides = [{ kind: 'image', image: it.image, ref: it.title, label: '이미지', parts: [] }];
    else if (it.type === 'blank') slides = [{ kind: 'blank', mode: it.mode, ref: it.title, label: it.mode === 'background' ? '배경' : '검은 화면', parts: [] }];
    // 제목 카드, 또는 가사·내용이 비어 있으면 제목만
    if (!slides.length) slides = [{ kind: 'title', ref: it.title, subtitle: it.subtitle || '', label: '제목', parts: [] }];
    return slides;
  }

  /** 가운데: 이 항목의 슬라이드 목록 (클릭: 그 슬라이드 미리보기 · 더블클릭: 송출) */
  function showSlideList(i, it) {
    app.results = { type: 'none', items: [], sel: -1 };
    $('#resultTitle').textContent = `${i + 1}. ${it.title}`;
    $('#resultInfo').textContent = `${TYPE[it.type]} · 슬라이드 ${app.preview.slides.length}장`;
    $('#results').innerHTML = app.preview.slides.map((s, k) => `<div class="srow ${k === app.preview.index ? 'in-pv' : ''}" data-k="${k}">
      <span class="vn">${esc(s.label || String(k + 1))}</span><span class="stext">${esc(s.kind === 'text' ? s.parts[0].text : s.kind === 'title' ? [s.ref, s.subtitle].filter(Boolean).join('\n') : s.kind === 'image' ? '🖼 이미지' : '⬛ ' + (s.mode === 'background' ? '배경·로고만' : '검은 화면'))}</span></div>`).join('');
  }
  $('#results').addEventListener('click', e => {
    const r = e.target.closest('.srow');
    if (!r || !app.preview) return;
    app.setPreviewIndex(+r.dataset.k);
    document.querySelectorAll('#results .srow').forEach(x => x.classList.toggle('in-pv', x === r));
  });
  $('#results').addEventListener('dblclick', e => {
    const r = e.target.closest('.srow');
    if (r && app.preview) { app.setPreviewIndex(+r.dataset.k); app.sendPreview(); }
  });

  async function sendItem(i) {
    if (await previewItem(i)) await app.sendPreview();
  }

  /** 송출 중 항목의 끝에서 F6/F5 → 다음/이전 순서 */
  async function onCueNext({ dir, version, cueId, index }) {
    if (!st.cue || st.cue.id !== cueId) { await openCue(cueId); }
    const next = index + dir;
    if (next < 0 || next >= st.cue.items.length) { app.showMsg(dir > 0 ? '큐시트의 마지막 순서입니다.' : '큐시트의 첫 순서입니다.', 'info', 2000); return; }
    if (app.state.live.version !== version) return; // 그 사이 다른 송출이 있었으면 무시
    if (await previewItem(next, { fromEnd: dir < 0 })) await app.sendPreview();
  }

  // ---------------- 목록 조작 ----------------
  const list = $('#cueList');
  list.addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { openEditor(+ed.dataset.edit); return; }
    const row = e.target.closest('.cue-item');
    if (row) previewItem(+row.dataset.i);
  });
  list.addEventListener('dblclick', e => {
    if (e.target.closest('[data-edit]')) return;
    const row = e.target.closest('.cue-item');
    if (row) { window.getSelection()?.removeAllRanges(); sendItem(+row.dataset.i); }
  });
  list.addEventListener('keydown', e => {
    if (!st.cue || e.ctrlKey || e.metaKey) return;
    const n = st.cue.items.length;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { // Alt+↑↓: 순서 옮기기
      const to = st.sel + (e.key === 'ArrowUp' ? -1 : 1);
      if (st.sel >= 0 && to >= 0 && to < n) { moveItem(st.sel, to); st.sel = to; }
      e.preventDefault(); return;
    }
    if (e.key === 'ArrowDown') { st.sel = Math.min(n - 1, st.sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { st.sel = Math.max(0, st.sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { previewItem(st.sel); e.preventDefault(); }
    else if (e.key === 'Delete' && st.sel >= 0) { removeItem(st.sel); e.preventDefault(); }
  });
  // 끌어서 순서 바꾸기
  list.addEventListener('dragstart', e => { const r = e.target.closest('.cue-item'); if (r) { st.dragFrom = +r.dataset.i; e.dataTransfer.effectAllowed = 'move'; } });
  list.addEventListener('dragover', e => { const r = e.target.closest('.cue-item'); if (r) { e.preventDefault(); list.querySelectorAll('.cue-item').forEach(x => x.classList.toggle('drop', x === r)); } });
  list.addEventListener('drop', e => {
    const r = e.target.closest('.cue-item');
    if (!r || st.dragFrom < 0) return;
    e.preventDefault();
    moveItem(st.dragFrom, +r.dataset.i);
    st.dragFrom = -1;
  });
  list.addEventListener('dragend', () => { st.dragFrom = -1; list.querySelectorAll('.drop').forEach(x => x.classList.remove('drop')); });

  function moveItem(from, to) {
    const items = st.cue.items;
    const [it] = items.splice(from, 1);
    items.splice(to, 0, it);
    if (st.sel === from) st.sel = to;
    save();
  }

  function removeItem(i) {
    const it = st.cue.items[i];
    if (!confirm(`${i + 1}번 '${it.title}' 순서를 지울까요?`)) return;
    st.cue.items.splice(i, 1);
    st.sel = Math.min(st.sel, st.cue.items.length - 1);
    save();
  }

  $('#cueSel').onchange = e => openCue(e.target.value);
  $('#cueAdd').addEventListener('click', e => {
    const b = e.target.closest('button[data-add]');
    if (b) openEditor(-1, b.dataset.add);
  });
  // 왼쪽 탭: 큐시트 / 성경 책
  function showSide(which) {
    $('#sideTabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.s === which));
    $('#cuePanel').hidden = which !== 'cue';
    $('#booksPanel').hidden = which !== 'books';
  }
  $('#sideTabs').addEventListener('click', e => { const b = e.target.closest('button[data-s]'); if (b) showSide(b.dataset.s); });

  // ---------------- 항목 편집 ----------------
  /** i<0 이면 새 항목(type) — 선택한 항목 다음에 넣는다 */
  function openEditor(i, type) {
    const isNew = i < 0;
    const it = isNew ? { type, title: '', note: '' } : structuredClone(st.cue.items[i]);
    const vs = app.state.versions;
    const field = {
      bible: `<label>장절 *</label><div><input type="text" id="eRef" value="${esc(it.ref || '')}" placeholder="예: 롬 8:18-25 · 요3:16 · 시 23"><div id="eRefMsg" class="note"></div></div>
        <label>번역본</label><select id="eVer"><option value="">현재 선택된 번역본</option>${vs.map(v => `<option value="${esc(v.id)}" ${it.versionId === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>`,
      song: `<label>가사</label><div><textarea id="eLyrics" rows="14" placeholder="[1절]\n첫째 줄\n둘째 줄\n\n[후렴]\n…">${esc(it.lyrics || '')}</textarea>
          <div class="note">빈 줄로 슬라이드를 나눕니다. [1절] · [후렴] 처럼 대괄호만 있는 줄은 화면에 나오지 않고 슬라이드 이름이 됩니다. 길면 화면에 맞게 자동으로 더 나눕니다.</div></div>
        <label></label><label class="tc-toggle"><input type="checkbox" id="eShowTitle" ${it.showTitle ? 'checked' : ''}> 화면에 찬양 제목 표시</label>`,
      text: `<label>내용</label><div><textarea id="eBody" rows="12" placeholder="광고 내용…\n---\n다음 장">${esc(it.body || '')}</textarea>
          <div class="note">'---' 만 있는 줄로 슬라이드를 나눕니다. 제목이 화면 위에 함께 나옵니다.</div></div>`,
      title: `<label>부제</label><input type="text" id="eSub" value="${esc(it.subtitle || '')}" placeholder="예: 홍길동 집사 · 설교 제목 · 본문">`,
      image: `<label>이미지 *</label><div class="row-flex"><button id="eImgBtn">🖼 이미지 고르기</button><span id="eImgName" class="note">${it.image ? '선택됨' : ''}</span></div>
        <label></label><div id="eImgPrev" class="cue-imgprev">${it.image ? `<img src="${esc(it.image)}">` : ''}</div>`,
      blank: `<label>화면</label><select id="eMode"><option value="black" ${it.mode !== 'background' ? 'selected' : ''}>검은 화면 (로고도 숨김)</option><option value="background" ${it.mode === 'background' ? 'selected' : ''}>배경·로고만 보이기</option></select>`,
    }[it.type];
    app.openModal(`${ICON[it.type]} ${TYPE[it.type]} ${isNew ? '추가' : '편집'}`, `<div class="form cue-form">
      <label>제목 *</label><input type="text" id="eTitle" value="${esc(it.title || '')}" placeholder="${{ bible: '예: 성경 봉독', song: '예: 주 하나님 지으신 모든 세계', text: '예: 광고', title: '예: 대표기도', image: '예: 표어', blank: '예: 빈 화면' }[it.type]}">
      ${field}
      <label>메모</label><input type="text" id="eNote" value="${esc(it.note || '')}" placeholder="조작자만 보는 메모 (예: 설교 후 바로)">
      <span></span><div class="row-flex"><button id="eSave" class="big send">${isNew ? '추가' : '저장'}</button><button id="eCancel">취소</button>${isNew ? '' : '<span class="grow"></span><button id="eDel">이 순서 지우기</button>'}<span id="eMsg" class="err-text"></span></div>
    </div>`);
    $('#eTitle').focus();
    if (it.type === 'bible') {
      let tm = null;
      const check = () => { clearTimeout(tm); tm = setTimeout(async () => {
        const q = $('#eRef').value.trim();
        if (!q) { $('#eRefMsg').textContent = ''; return; }
        const r = await cmd('searchReference', { query: q, versionId: $('#eVer').value || undefined });
        $('#eRefMsg').innerHTML = r.ok ? `<span class="ok-text">✓ ${esc(r.result.passage.title)} (${r.result.passage.verses.length}절)</span>` : `<span class="err-text">${esc(r.error)}</span>`;
        if (r.ok && !$('#eTitle').value.trim()) $('#eTitle').placeholder = r.result.passage.title;
      }, 200); };
      $('#eRef').oninput = check; $('#eVer').onchange = check; check();
    }
    if (it.type === 'image') {
      $('#eImgBtn').onclick = () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp,image/gif';
        inp.onchange = async () => {
          const f = inp.files[0]; if (!f) return;
          const ext = (f.name.match(/\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase();
          const r = await fetch('/api/media', { method: 'POST', headers: { 'X-WorshipCue': '1', 'X-Filename': 'slide' + ext }, body: f }).then(x => x.json()).catch(err => ({ ok: false, error: err.message }));
          if (!r.ok) return app.showMsg(r.error, 'error');
          it.image = r.url;
          $('#eImgName').textContent = f.name;
          $('#eImgPrev').innerHTML = `<img src="${esc(r.url)}">`;
          if (!$('#eTitle').value.trim()) $('#eTitle').value = f.name.replace(/\.[^.]+$/, '');
        };
        inp.click();
      };
    }
    $('#eCancel').onclick = () => app.closeModal();
    if (!isNew) $('#eDel').onclick = () => { app.closeModal(); removeItem(i); };
    $('#eSave').onclick = () => {
      it.title = $('#eTitle').value.trim();
      it.note = $('#eNote').value.trim();
      if (it.type === 'bible') { it.ref = $('#eRef').value.trim(); it.versionId = $('#eVer').value; if (!it.title) it.title = $('#eTitle').placeholder.startsWith('예:') ? '성경' : $('#eTitle').placeholder; }
      if (it.type === 'song') { it.lyrics = $('#eLyrics').value; it.showTitle = $('#eShowTitle').checked; }
      if (it.type === 'text') it.body = $('#eBody').value;
      if (it.type === 'title') it.subtitle = $('#eSub').value.trim();
      if (it.type === 'blank') it.mode = $('#eMode').value;
      if (!it.title && it.type !== 'bible') { $('#eMsg').textContent = '제목을 입력하세요.'; return; }
      if (it.type === 'bible' && !it.ref) { $('#eMsg').textContent = '장절을 입력하세요.'; return; }
      if (it.type === 'image' && !it.image) { $('#eMsg').textContent = '이미지를 고르세요.'; return; }
      if (isNew) { const at = st.sel >= 0 ? st.sel + 1 : st.cue.items.length; st.cue.items.splice(at, 0, it); st.sel = at; }
      else st.cue.items[i] = it;
      app.closeModal();
      save();
      // 편집한 항목이 미리보기 중이면 새 내용으로 다시 미리보기
      if (!isNew && app.preview && app.preview.cue && app.preview.cue.index === i) setTimeout(() => previewItem(i), 250);
    };
  }

  // ---------------- 큐시트 관리 (⋯) ----------------
  $('#cueMenu').onclick = () => {
    const c = st.cue;
    app.openModal('큐시트 관리', `<div class="form">
      <h4>지금 큐시트</h4>
      <label>이름</label><input type="text" id="mName" value="${esc(c ? c.name : '')}">
      <label>예배 날짜</label><input type="date" id="mDate" value="${esc(c ? c.serviceDate : '')}">
      <span></span><div class="row-flex"><button id="mSave">이름·날짜 저장</button><button id="mDup">복제 (다음 주 순서 만들기)</button><button id="mExport">파일로 내보내기</button><button id="mDel">삭제</button></div>
      <h4>새 큐시트</h4>
      <span></span><div class="row-flex"><button id="mNew">기본 순서로 새로 만들기</button><button id="mNewEmpty">빈 큐시트</button><button id="mImport">파일에서 가져오기 (.json)</button></div>
      <span></span><div class="note">기본 순서: 예배로 부름 · 찬양 · 대표기도 · 성경 봉독 · 설교 · 광고 · 축도 · 빈 화면 (자유롭게 고치세요)</div>
    </div>`);
    $('#mSave').onclick = async () => { c.name = $('#mName').value.trim() || c.name; c.serviceDate = $('#mDate').value; app.closeModal(); save(); };
    $('#mDup').onclick = async () => { const r = await cmd('duplicateCue', { id: c.id }); app.closeModal(); if (r.ok) { await refreshList(); openCue(r.result.id); } };
    $('#mDel').onclick = async () => {
      if (!confirm(`'${c.name}' 큐시트를 삭제할까요? 되돌릴 수 없습니다.`)) return;
      await cmd('deleteCue', { id: c.id }); app.closeModal(); st.cue = null; await refreshList();
      if (st.list[0]) openCue(st.list[0].id); else init();
    };
    $('#mNew').onclick = async () => { const r = await cmd('newCue', {}); app.closeModal(); if (r.ok) { await refreshList(); openCue(r.result.id); } };
    $('#mNewEmpty').onclick = async () => { const r = await cmd('newCue', { empty: true }); app.closeModal(); if (r.ok) { await refreshList(); openCue(r.result.id); } };
    $('#mExport').onclick = () => {
      const blob = new Blob([JSON.stringify({ worshipcue: 1, name: c.name, serviceDate: c.serviceDate, items: c.items }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${c.name.replace(/[\\/:*?"<>|]/g, '_')}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      app.showMsg('큐시트를 파일로 내보냈습니다 (다운로드 폴더).', 'ok', 2500);
    };
    $('#mImport').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = async () => {
        try {
          const d = JSON.parse(await inp.files[0].text());
          const r = await cmd('saveCue', { cue: { name: d.name || '가져온 큐시트', serviceDate: d.serviceDate || '', items: (d.items || []).map(x => ({ ...x, id: '' })) } });
          if (!r.ok) throw new Error(r.error);
          app.closeModal(); await refreshList(); openCue(r.result.id);
          app.showMsg('큐시트를 가져왔습니다.', 'ok', 2000);
        } catch (err) { app.showMsg('가져오기 실패: ' + err.message, 'error'); }
      };
      inp.click();
    };
  };

  // ---------------- 단축키에서 부르는 기능 ----------------
  function move(d) {
    if (!st.cue || !st.cue.items.length) return;
    showSide('cue');
    const i = Math.max(0, Math.min(st.cue.items.length - 1, (st.sel < 0 ? -1 : st.sel) + d));
    previewItem(i);
  }

  window.BCCue = {
    init, render, onCueNext, move, showSide,
    edit: () => { if (st.cue && st.sel >= 0) openEditor(st.sel); },
    onLive: () => render(),
    // 다른 곳(다른 창·외부 연동)에서 바뀐 큐시트는 다시 불러온다. 방금 내가 저장한 것은 제외
    onCues: d => { refreshList(); if (st.cue && d && d.id === st.cue.id && Date.now() - st.lastSave > 1500) openCue(st.cue.id); },
  };
})();
