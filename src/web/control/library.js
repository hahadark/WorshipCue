/* 라이브러리 패널 (독 패널) — 찬양 · 찬송가·PPT · 이미지 · 음악 · 오버레이 · 템플릿
 * - 더블클릭(또는 Enter) = 큐시트의 고른 순서 다음에 넣기, 끌어서 큐시트에 놓기
 * - 음악은 조작 PC 에서 재생 (재생목록·볼륨·페이드)
 * - 오버레이는 슬라이드와 따로 출력 위에 겹치는 층을 켜고 끈다
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const cmd = (...a) => app.cmd(...a);
  const R = window.BCRender;

  const TABS = [['songs', '찬양'], ['hymns', '찬송가·PPT'], ['images', '이미지·영상'], ['cameras', '📷 카메라'], ['audio', '음악'], ['overlays', '오버레이'], ['templates', '템플릿']];
  const st = { tab: 'songs', q: {}, rows: [], sel: 0, folder: { image: '', audio: '' } };
  let searchTimer = null;

  function root() { return $('#panelLibrary'); }

  function init() {
    const el = root();
    el.innerHTML = `<div class="lib-tabs view-tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === st.tab ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="lib-bar"></div>
      <div class="lib-body" tabindex="0"></div>
      <div class="lib-player" hidden></div>`;
    el.querySelector('.lib-tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); };
    el.querySelector('.lib-body').addEventListener('keydown', onKey);
    show(st.tab);
    audio.render();
  }

  function show(tab) {
    st.tab = tab;
    root().querySelectorAll('.lib-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    ({ songs: drawSongs, hymns: drawHymns, cameras: drawCameras, images: () => drawFiles('image'), audio: () => drawFiles('audio'), overlays: drawOverlays, templates: drawTemplates })[tab]();
  }

  // ---------------- 공통: 검색줄·목록·끌기 ----------------
  function bar(html) { root().querySelector('.lib-bar').innerHTML = html; }
  function body(html) { const b = root().querySelector('.lib-body'); b.innerHTML = html; return b; }
  function searchInput(placeholder, onSearch) {
    const inp = root().querySelector('.lib-bar input[data-q]');
    if (!inp) return;
    inp.value = st.q[st.tab] || '';
    inp.placeholder = placeholder;
    inp.oninput = () => { st.q[st.tab] = inp.value; clearTimeout(searchTimer); searchTimer = setTimeout(onSearch, 150); };
    inp.onkeydown = e => {
      if (e.key === 'ArrowDown') { root().querySelector('.lib-body').focus(); moveSel(1); e.preventDefault(); }
      else if (e.key === 'Enter') { activate(st.sel); e.preventDefault(); }
    };
  }
  /** 끌어서 큐시트에 넣을 수 있게 */
  function draggable(el, item) {
    el.draggable = true;
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-wc-item', JSON.stringify(item)); e.dataTransfer.effectAllowed = 'copy'; });
  }
  function moveSel(d) {
    const rows = [...root().querySelectorAll('.lib-body [data-k]')];
    if (!rows.length) return;
    st.sel = Math.max(0, Math.min(rows.length - 1, st.sel + d));
    rows.forEach(r => r.classList.toggle('sel', +r.dataset.k === st.sel));
    rows[st.sel].scrollIntoView({ block: 'nearest' });
  }
  function onKey(e) {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowDown') { moveSel(1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { moveSel(-1); e.preventDefault(); }
    else if (e.key === 'Enter') { activate(st.sel); e.preventDefault(); }
  }
  let activate = () => {};
  /** 목록 행 공통 이벤트 */
  function bindRows(b, onPick, itemOf) {
    st.sel = 0;
    b.querySelectorAll('[data-k]').forEach(r => {
      const k = +r.dataset.k;
      r.onclick = () => { st.sel = k; b.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('sel', x === r)); };
      r.ondblclick = () => onPick(k);
      if (itemOf) draggable(r, itemOf(k));
    });
    activate = onPick;
  }
  function addToCue(type, extra, label) {
    if (!window.BCCue || !window.BCCue.selected && !window.BCCue.addItem) return;
    window.BCCue.addItem(type, extra);
    app.showMsg(`'${label}' 을(를) 큐시트에 넣었습니다.`, 'ok', 1500);
  }

  // ---------------- 찬양 ----------------
  async function drawSongs() {
    bar(`<input type="text" data-q style="flex:1"><button data-new title="새 찬양 가사 입력">＋ 새 찬양</button><button data-web title="벅스 · 지니 · 멜론에서 가사를 찾아 찬양 슬라이드로 (한 곡씩)">🌐 가사 찾기</button><button data-import title="파일 · 폴더 통째로 · 여러 곡 붙여넣기 (파일·폴더를 이 탭에 끌어다 놓아도 됩니다)">📥 가져오기 ▾</button>`);
    root().querySelector('[data-new]').onclick = () => editSong(null);
    root().querySelector('[data-web]').onclick = () => webLyrics(st.q.songs || '');
    root().querySelector('[data-import]').onclick = e => {
      const r = e.currentTarget.getBoundingClientRect();
      window.BCCtx.show(r.left, r.bottom + 2, [
        { label: '📄 파일 고르기… (OpenLP · ChordPro · ProPresenter 6 · PPT · txt)', run: pickImport },
        { label: '📁 폴더 통째로… (하위 폴더까지)', run: pickImportFolder },
        { label: '📋 여러 곡 붙여넣기…', run: pasteSongs },
      ]);
    };
    searchInput('찬양 제목·가사로 찾기', drawSongs);
    const r = await cmd('listSongs', { query: st.q.songs || '' });
    st.rows = r.ok ? r.result : [];
    if (st.tab !== 'songs') return;
    const b = body(st.rows.length ? st.rows.map((s, k) => `<div class="lib-row" data-k="${k}"><span class="lib-ico">🎵</span><span class="lib-t"><b>${esc(s.title)}</b><span class="muted">${esc(s.first)}</span></span><button data-edit="${k}" title="가사 고치기">고치기</button></div>`).join('')
      : `<div class="empty">${st.q.songs ? '찾는 찬양이 없습니다.' : '저장한 찬양이 없습니다.<br>＋ 새 찬양 으로 가사를 입력하거나, 큐시트의 찬양 순서에서 \'📚 라이브러리에 저장\'을 누르세요.'}</div>`);
    const pick = k => { const s = st.rows[k]; if (s) addSong(s.id); };
    bindRows(b, pick, k => ({ type: 'song', extra: { songId: st.rows[k].id, title: st.rows[k].title } }));
    b.querySelectorAll('[data-edit]').forEach(x => x.onclick = e => { e.stopPropagation(); editSong(st.rows[+x.dataset.edit].id); });
  }
  // ---------------- 찬양 가져오기 (다른 프로그램 · PPT · txt) ----------------
  function pickImport() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true;
    inp.accept = '.xml,.cho,.chordpro,.chopro,.crd,.pro6,.pro,.pptx,.ppsx,.ppt,.pps,.txt';
    inp.onchange = () => {
      const pathOf = window.wcDesktop && window.wcDesktop.pathOf;
      const paths = pathOf ? [...inp.files].map(f => pathOf(f)).filter(Boolean) : [];
      if (!paths.length) return app.showMsg('가져오기는 WorshipCue 데스크톱 프로그램에서 됩니다.', 'info');
      importSongs(paths);
    };
    inp.click();
  }
  async function pickImportFolder() {
    const r = await cmd('pickFolder', { title: '찬양 파일이 있는 폴더 (하위 폴더까지 읽습니다)' });
    if (!r.ok) return app.showMsg(r.error, 'error');
    if (r.result) importSongs([r.result]);
  }
  /** 📋 여러 곡 붙여넣기: '# 제목' 줄마다 새 곡, 가사는 되풀이를 찾아 구간·슬라이드로 */
  function pasteSongs() {
    app.openModal('📋 여러 곡 붙여넣기', `<div class="form">
      <span></span><div class="note">곡마다 맨 위에 <b># 제목</b> 줄을 넣고 가사를 붙여넣으세요. 한 곡이면 제목 줄 없이 붙여넣어도 됩니다 (첫 줄이 짧으면 제목).<br>
        [1절] [후렴] 이름표가 없으면 되풀이되는 부분을 찾아 1절 · 후렴 등으로 나누고 슬라이드를 만듭니다.</div>
      <label>가사</label><textarea id="psText" rows="16" placeholder="# 주님의 은혜 넘치네&#10;주 신실하심 놀라워&#10;…&#10;&#10;# 은혜&#10;내가 누려왔던 모든 것들이&#10;…"></textarea>
      <label>슬라이드</label><div class="row-flex"><select id="psLines">${[1, 2, 3, 4].map(n => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${n}줄씩</option>`).join('')}</select><span class="grow"></span><button id="psGo" class="primary">다음: 곡 확인</button></div>
    </div>`);
    $('#psText').focus();
    $('#psGo').onclick = async () => {
      const text = $('#psText').value;
      if (!text.trim()) return app.showMsg('가사를 붙여넣으세요.', 'info');
      const r = await cmd('parseSongText', { text, lines: +$('#psLines').value });
      if (!r.ok) return app.showMsg(r.error, 'error');
      if (!r.result.songs.length) return app.showMsg('곡을 찾지 못했습니다. 곡마다 # 제목 줄을 넣어 보세요.', 'error', 5000);
      showImport(r.result);
    };
  }
  /** 파일·폴더 경로 → 미리 보기 → 저장 */
  async function importSongs(paths) {
    app.showMsg('찬양 파일을 읽는 중… (폴더가 크면 시간이 걸립니다)', 'info', 3000);
    const r = await cmd('importSongs', { paths });
    if (!r.ok) return app.showMsg(r.error, 'error');
    showImport(r.result);
  }
  function showImport({ songs, errors }) {
    if (!songs.length) return app.showMsg(`가져올 찬양이 없습니다. ${errors.map(e => `${e.file}: ${e.error}`).join(' / ')}`, 'error', 7000);
    const dups = songs.filter(s => s.dup).length;
    app.openModal(`📥 찬양 가져오기 — ${songs.length}곡`, `<div class="imp">
      <div class="note">고른 곡을 찬양 라이브러리에 저장합니다. 가사는 미리 보고 저장한 뒤에도 고칠 수 있습니다.</div>
      <div class="imp-list">${songs.map((s, k) => `<label class="imp-row"><input type="checkbox" data-k="${k}" ${s.dup ? '' : 'checked'}><span class="imp-t"><b>${esc(s.title)}</b>${s.dup ? ' <span class="warn-text">· 같은 제목 있음</span>' : ''}<span class="muted">${esc(s.source)}${s.credit ? ' · ' + esc(s.credit) : ''}${s.arrangement ? ' · 순서: ' + esc(s.arrangement) : ''}</span></span><span class="imp-first muted">${esc(s.lyrics.split('\n').find(l => l.trim() && !/^\[.*\]$/.test(l.trim())) || '')}</span></label>`).join('')}</div>
      ${errors.length ? `<div class="err-text">못 읽은 파일 ${errors.length}개: ${errors.slice(0, 8).map(e => esc(`${e.file} (${e.error})`)).join(' · ')}</div>` : ''}
      <div class="row-flex" style="margin-top:10px">${dups ? `같은 제목: <select id="impDup"><option value="skip">건너뛰기</option><option value="replace">덮어쓰기</option><option value="new">새로 하나 더</option></select>` : ''}
        <span class="grow"></span><button id="impAll">모두 고르기</button><button id="impGo" class="primary">✓ 고른 곡 저장</button></div></div>`);
    $('#impAll').onclick = () => document.querySelectorAll('.imp-row input').forEach(c => { c.checked = true; });
    $('#impGo').onclick = async () => {
      const pick = [...document.querySelectorAll('.imp-row input:checked')].map(c => songs[+c.dataset.k]);
      if (!pick.length) return app.showMsg('저장할 곡을 고르세요.', 'info');
      const s = await cmd('saveImportedSongs', { songs: pick, dup: $('#impDup') ? $('#impDup').value : 'skip' });
      if (!s.ok) return app.showMsg(s.error, 'error');
      app.closeModal();
      app.showMsg(`찬양 ${s.result.saved}곡을 라이브러리에 저장했습니다${s.result.skipped ? ` (같은 제목 ${s.result.skipped}곡 건너뜀)` : ''}.`, 'ok', 4000);
      show('songs');
    };
  }

  // ---------------- 🌐 웹에서 가사 찾기 (벅스 · 지니 · 멜론, 한 곡씩) ----------------
  const LW = { results: [], cur: null, raw: '', apply: null };
  /** opts.apply(d): 큐시트 순서에 넣기 (d = { title, lyrics, arrangement, credit, songId }) · opts.target: 넣을 순서 이름 */
  function webLyrics(query, opts = {}) {
    LW.apply = typeof opts.apply === 'function' ? opts.apply : null;
    app.openModal('🌐 웹에서 가사 찾기', `<div class="lw">
      <div class="row-flex"><input type="text" id="lwQ" placeholder="찬양 제목 (가수를 함께 쓰면 더 정확합니다)" style="flex:1" value="${esc(query)}"><button id="lwGo" class="primary">찾기</button>
        <label class="tc-toggle"><input type="checkbox" data-site="bugs" checked>벅스</label><label class="tc-toggle"><input type="checkbox" data-site="genie" checked>지니</label><label class="tc-toggle"><input type="checkbox" data-site="melon" checked>멜론</label></div>
      <div class="lw-body">
        <div class="lw-list" id="lwList"><div class="empty">찬양 제목으로 찾으세요.</div></div>
        <div class="lw-edit form" id="lwEdit">
          <label>제목</label><input type="text" id="lwTitle">
          <label>가사</label><textarea id="lwLyrics" rows="14" placeholder="왼쪽에서 곡을 고르면 가사를 가져와 1절 · 후렴 등으로 나눕니다."></textarea>
          <label>부를 순서</label><input type="text" id="lwArr" placeholder="비우면 가사 순서대로 · 예: 1절 후렴 2절 후렴">
          <label>출처</label><input type="text" id="lwCredit">
          <label>슬라이드</label><div class="row-flex"><select id="lwLines">${[1, 2, 3, 4].map(n => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${n}줄씩</option>`).join('')}</select><span class="note" id="lwInfo"></span></div>
          <span></span><div class="row-flex">${LW.apply ? `<button id="lwAdd" class="primary" disabled title="${esc(opts.target || '고른 순서 다음에 새 찬양 순서로')}">${opts.target ? '✓ 이 순서에 넣기' : '✓ 큐시트에 넣기'}</button><label class="tc-toggle"><input type="checkbox" id="lwLib" checked> 라이브러리에도 저장</label>` : '<button id="lwSave" class="primary" disabled>라이브러리에 저장</button><button id="lwAdd" disabled>저장하고 큐시트에 넣기</button>'}</div>
        </div>
      </div>
      <div class="note">검색하고 고른 곡만 한 곡씩 가져옵니다. 사이트 구조가 바뀌면 못 읽을 수 있습니다 — 그때는 가사를 복사해 '📋 여러 곡 붙여넣기'로. 가사의 저작권은 권리자에게 있으니 예배 송출은 저작권 단체의 이용 조건을 확인하세요.</div>
    </div>`);
    const q = $('#lwQ');
    q.focus(); q.select();
    q.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); lwSearch(); } };
    $('#lwGo').onclick = lwSearch;
    $('#lwList').onclick = e => { const r = e.target.closest('[data-i]'); if (r) lwPick(+r.dataset.i); };
    $('#lwLines').onchange = async () => {
      if (!LW.raw) return;
      const r = await cmd('lyricsArrange', { text: LW.raw, lines: +$('#lwLines').value });
      if (r.ok) { $('#lwLyrics').value = r.result.lyrics; $('#lwArr').value = r.result.arrangement; }
    };
    const save = async () => {
      const r = await cmd('saveSong', { song: { title: $('#lwTitle').value.trim(), lyrics: $('#lwLyrics').value, credit: $('#lwCredit').value, arrangement: $('#lwArr').value, tags: '' } });
      if (!r.ok) { app.showMsg(r.error, 'error'); return null; }
      return r.result;
    };
    if ($('#lwSave')) $('#lwSave').onclick = async () => { const s = await save(); if (s) { app.showMsg(`'${s.title}' 을(를) 찬양 라이브러리에 저장했습니다. 다른 곡도 찾을 수 있습니다.`, 'ok', 3000); if (st.tab === 'songs') drawSongs(); } };
    $('#lwAdd').onclick = async () => {
      if (LW.apply) {
        const d = { title: $('#lwTitle').value.trim(), lyrics: $('#lwLyrics').value, arrangement: $('#lwArr').value.trim(), credit: $('#lwCredit').value, songId: '' };
        if ($('#lwLib').checked) { const s = await save(); if (!s) return; d.songId = s.id; d.song = s; if (st.tab === 'songs') drawSongs(); }
        app.closeModal();
        LW.apply(d);
        return;
      }
      const s = await save(); if (s) { app.closeModal(); addToCue('song', { songId: s.id, title: s.title, lyrics: s.lyrics }, s.title); if (st.tab === 'songs') drawSongs(); }
    };
    if (query.trim()) lwSearch();
  }
  async function lwSearch() {
    const query = $('#lwQ').value.trim();
    if (!query) return;
    const sites = [...document.querySelectorAll('.lw [data-site]:checked')].map(x => x.dataset.site);
    $('#lwList').innerHTML = '<div class="empty">찾는 중…</div>';
    const r = await cmd('lyricsSearch', { query, sites });
    if (!$('#lwList')) return;
    if (!r.ok) { $('#lwList').innerHTML = `<div class="err-text">${esc(r.error)}</div>`; return; }
    LW.results = r.result.results;
    $('#lwList').innerHTML = (LW.results.length ? LW.results.map((x, i) => `<div class="lw-row" data-i="${i}"><span class="lw-site lw-${x.site}">${esc(x.siteName)}</span><span class="lw-t"><b>${esc(x.title)}</b><span class="muted">${esc(x.artist)}${x.album ? ' · ' + esc(x.album) : ''}</span></span></div>`).join('')
      : '<div class="empty">찾는 곡이 없습니다. 제목을 줄여 보세요.</div>')
      + (r.result.errors.length ? `<div class="warn-text note">못 읽은 사이트: ${esc(r.result.errors.join(' · '))}</div>` : '');
  }
  async function lwPick(i) {
    const x = LW.results[i];
    if (!x) return;
    document.querySelectorAll('#lwList .lw-row').forEach(r => r.classList.toggle('sel', +r.dataset.i === i));
    $('#lwInfo').textContent = '가사를 가져오는 중…';
    const r = await cmd('lyricsGet', { site: x.site, id: x.id, lines: +$('#lwLines').value });
    if (!$('#lwInfo')) return;
    if (!r.ok) { $('#lwInfo').innerHTML = `<span class="err-text">${esc(r.error)}</span>`; return; }
    if (!r.result.text) { $('#lwInfo').innerHTML = '<span class="warn-text">이 곡은 가사가 없습니다. 다른 사이트의 같은 곡을 눌러 보세요.</span>'; return; }
    LW.raw = r.result.text;
    LW.cur = x;
    $('#lwTitle').value = x.title.replace(/\s*\((feat|Feat|FEAT)\.?[^)]*\)\s*$/, '').trim();
    $('#lwLyrics').value = r.result.lyrics;
    $('#lwArr').value = r.result.arrangement;
    $('#lwCredit').value = [x.artist, x.siteName + ' 가사'].filter(Boolean).join(' · ');
    $('#lwInfo').textContent = `${x.siteName} · 구간 ${(r.result.lyrics.match(/^\[/gm) || []).length}개 · 고친 뒤 저장하세요`;
    $('#lwAdd').disabled = false;
    if ($('#lwSave')) $('#lwSave').disabled = false;
  }

  async function addSong(id) {
    const r = await cmd('getSong', { id });
    if (!r.ok) return app.showMsg(r.error, 'error');
    addToCue('song', { songId: id, title: r.result.title, lyrics: r.result.lyrics }, r.result.title);
  }
  async function editSong(id) {
    let s = { title: '', lyrics: '', credit: '', tags: '', arrangement: '' };
    if (id) { const r = await cmd('getSong', { id }); if (r.ok) s = r.result; }
    app.openModal(id ? '찬양 고치기' : '새 찬양', `<div class="form">
      <label>제목</label><input type="text" id="sgTitle" value="${esc(s.title)}">
      <label>가사</label><textarea id="sgLyrics" rows="14" placeholder="[1절]&#10;첫째 줄&#10;둘째 줄&#10;&#10;[후렴]&#10;…">${esc(s.lyrics)}</textarea>
      <span></span><div class="note">빈 줄 = 다음 슬라이드 · [1절] [후렴] 같은 줄은 슬라이드 이름 (화면에는 안 나옴). 고치면 이 찬양을 쓰는 모든 큐시트에 반영됩니다.</div>
      <label>부를 순서</label><input type="text" id="sgArr" value="${esc(s.arrangement || '')}" placeholder="비우면 가사 순서대로 · 예: 1절 후렴 2절 후렴 후렴">
      <label>저작권·출처</label><input type="text" id="sgCredit" value="${esc(s.credit)}" placeholder="예: 작사·작곡 / CCLI 번호">
      <label>분류</label><input type="text" id="sgTags" value="${esc(s.tags)}" placeholder="예: 경배, 성탄, 감사">
      <span></span><div class="row-flex"><button id="sgSave" class="primary">저장</button>${id ? '<button id="sgAdd">저장하고 큐시트에 넣기</button><button id="sgDel">삭제</button>' : '<button id="sgAdd">저장하고 큐시트에 넣기</button>'}</div>
    </div>`);
    const save = async () => {
      const r = await cmd('saveSong', { song: { id: s.id, title: $('#sgTitle').value, lyrics: $('#sgLyrics').value, credit: $('#sgCredit').value, tags: $('#sgTags').value, arrangement: $('#sgArr').value } });
      if (!r.ok) { app.showMsg(r.error, 'error'); return null; }
      return r.result;
    };
    $('#sgSave').onclick = async () => { if (await save()) { app.closeModal(); app.showMsg('찬양을 저장했습니다.', 'ok', 1500); drawSongs(); } };
    $('#sgAdd').onclick = async () => { const r = await save(); if (r) { app.closeModal(); addToCue('song', { songId: r.id, title: r.title, lyrics: r.lyrics }, r.title); drawSongs(); } };
    if ($('#sgDel')) $('#sgDel').onclick = async () => {
      if (!confirm(`'${s.title}' 찬양을 라이브러리에서 지울까요? (이미 넣은 큐시트의 가사는 남습니다)`)) return;
      await cmd('deleteSong', { id: s.id }); app.closeModal(); drawSongs();
    };
    $('#sgTitle').focus();
  }

  // ---------------- 찬송가·PPT ----------------
  async function drawHymns() {
    bar(`<input type="text" data-q style="flex:1"><button data-set title="찬송가 폴더·기본 배경·온라인에서 찾기">설정·온라인…</button>`);
    root().querySelector('[data-set]').onclick = () => window.BCCue && window.BCCue.openHymnPicker({});
    searchInput('번호 또는 제목 (예: 10, 전능왕)', drawHymns);
    const r = await cmd('searchHymns', { query: st.q.hymns || '' });
    st.rows = r.ok ? r.result : [];
    if (st.tab !== 'hymns') return;
    const b = body(st.rows.length ? st.rows.map((h, k) => `<div class="lib-row" data-k="${k}"><span class="lib-no">${h.number ?? ''}</span><span class="lib-t"><b>${esc(h.title)}</b></span><span class="muted">${esc(h.folder)}</span></div>`).join('')
      : `<div class="empty">찾는 찬송가·PPT 가 없습니다.<br><span class="muted">'설정·온라인…' 에서 폴더를 등록하거나 온라인에서 찾을 수 있습니다.</span></div>`);
    const item = k => { const h = st.rows[k]; const title = h.number != null && !/^교독문/.test(h.title) ? `${h.number}장 ${h.title}` : h.title; return { type: 'hymn', extra: { title, file: h.file, number: h.number, background: 'default' } }; };
    bindRows(b, k => { const it = item(k); addToCue(it.type, it.extra, it.extra.title); }, item);
  }

  // ---------------- 이미지 · 음악 (폴더) ----------------
  async function drawFiles(kind) {
    const name = kind === 'audio' ? '음악' : '이미지·영상';
    const fr = await cmd('listLibFolders', { kind });
    const folders = fr.ok ? fr.result : [];
    bar(`<select data-folder><option value="">전체 폴더</option>${folders.map(f => `<option value="${esc(f.path)}" ${st.folder[kind] === f.path ? 'selected' : ''}>${esc(f.name)} (${f.count})</option>`).join('')}</select>
      <input type="text" data-q style="flex:1"><button data-folders title="${name} 폴더 등록·빼기">폴더…</button>${kind === 'image' ? '<button data-upload title="파일 하나 올리기">올리기…</button>' : ''}`);
    root().querySelector('[data-folder]').onchange = e => { st.folder[kind] = e.target.value; drawFiles(kind); };
    root().querySelector('[data-folders]').onclick = () => manageFolders(kind);
    const up = root().querySelector('[data-upload]');
    if (up) up.onclick = () => window.BCCue && window.BCCue.pickImage(url => addToCue('image', { image: url, title: '이미지' }, '이미지'));
    searchInput(`${name} 파일 이름으로 찾기`, () => drawFiles(kind));
    if (!folders.length) { body(`<div class="empty">등록한 ${name} 폴더가 없습니다.<br><button data-add-folder class="primary">📁 ${name} 폴더 등록</button></div>`); root().querySelector('[data-add-folder]').onclick = () => addFolder(kind); return; }
    const r = await cmd('searchLibFiles', { kind, query: st.q[st.tab] || '', folder: st.folder[kind] });
    st.rows = r.ok ? r.result : [];
    if (st.tab !== (kind === 'audio' ? 'audio' : 'images')) return;
    if (kind === 'image') {
      const b = body(`<div class="lib-grid">${st.rows.map((f, k) => `<div class="lib-cell ${f.video ? 'is-video' : ''}" data-k="${k}" title="${esc(f.name)}">${thumb(f)}<span>${f.video ? '🎞 ' : ''}${esc(f.name)}</span>
        <div class="lib-cell-act"><button data-live="${k}" class="primary" title="지금 송출 화면의 배경으로 바로 (슬라이드와 따로, 다른 순서로 넘어가도 그대로)">▶ 송출 배경</button><button data-bg="${k}" title="고른 순서의 배경으로">배경</button><button data-tb="${k}" title="빠른 설정에서 고른 출력(예배당/OBS)의 템플릿 배경으로">전체 배경</button>${f.video ? '' : `<button data-lg="${k}" title="이 그림을 로고 오버레이로">로고</button>`}</div></div>`).join('') || '<div class="empty">찾는 그림·영상이 없습니다.</div>'}</div>`);
      const item = k => (st.rows[k].video
        ? { type: 'video', extra: { file: st.rows[k].url, title: st.rows[k].name, sound: true, volume: 1, loop: false, endAction: 'hold' } }
        : { type: 'image', extra: { image: st.rows[k].url, title: st.rows[k].name } });
      b.querySelectorAll('[data-tb]').forEach(x => x.onclick = e => { e.stopPropagation(); setTemplateBg(st.rows[+x.dataset.tb]); });
      b.querySelectorAll('[data-live]').forEach(x => x.onclick = e => { e.stopPropagation(); const f = st.rows[+x.dataset.live]; liveMedia({ type: f.video ? 'video' : 'image', url: f.url, label: f.name }); });
      bindRows(b, k => { const it = item(k); addToCue(it.type, it.extra, st.rows[k].name); }, item);
      b.querySelectorAll('[data-bg]').forEach(x => x.onclick = e => { e.stopPropagation(); setItemBg(st.rows[+x.dataset.bg].url); });
      b.querySelectorAll('[data-lg]').forEach(x => x.onclick = e => { e.stopPropagation(); editOverlay({ type: 'logo', image: st.rows[+x.dataset.lg].url, name: st.rows[+x.dataset.lg].name, size: 140 }); });
    } else {
      const b = body(st.rows.map((f, k) => `<div class="lib-row" data-k="${k}"><button data-play="${k}" class="lib-play" title="바로 재생 (조작 PC)">▶</button><span class="lib-t"><b>${esc(f.name)}</b></span><span class="muted">${esc(f.folder)}</span></div>`).join('') || '<div class="empty">찾는 음악이 없습니다.</div>');
      const item = k => ({ type: 'audio', extra: { file: st.rows[k].url, title: st.rows[k].name, volume: 1, fadeOnLeave: true } });
      bindRows(b, k => addToCue('audio', item(k).extra, st.rows[k].name), item);
      b.querySelectorAll('[data-play]').forEach(x => x.onclick = e => { e.stopPropagation(); const k = +x.dataset.play; audio.play({ url: st.rows[k].url, title: st.rows[k].name, list: st.rows, index: k }); });
    }
  }
  // ---------------- 📷 카메라 (웹캠 · 캡처보드 · OBS 가상 카메라) ----------------
  /** 송출 배경 층에 바로 (같은 것을 다시 누르면 끄기) */
  async function liveMedia(m) {
    const cur = app.state && app.state.layers && app.state.layers.media;
    const same = cur && m && cur.type === m.type && (cur.deviceId || '') === (m.deviceId || '') && (cur.url || '') === (m.url || '');
    const r = await cmd('setBackgroundMedia', { media: same ? null : m });
    if (!r.ok) return app.showMsg(r.error, 'error');
    app.showMsg(same || !m ? '송출 배경을 껐습니다.' : `송출 배경: ${m.label || (m.type === 'camera' ? '카메라' : '미디어')}`, 'ok', 1800);
    if (st.tab === 'cameras') drawCameras();
  }
  async function drawCameras() {
    bar(`<span class="muted" style="flex:1">웹캠·캡처보드를 누르면 송출 화면의 배경으로 바로 나갑니다 (슬라이드는 그 위에)</span><button data-refresh title="카메라를 새로 꽂았을 때">새로 찾기</button><button data-off class="danger" title="송출 배경 끄기">배경 끄기</button>`);
    root().querySelector('[data-refresh]').onclick = () => drawCameras();
    root().querySelector('[data-off]').onclick = () => liveMedia(null);
    let devs = [];
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); // 이름을 보려면 한 번 허락이 필요
      s.getTracks().forEach(x => x.stop());
      devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    } catch (e) {
      if (st.tab === 'cameras') body(`<div class="empty">카메라를 찾지 못했습니다.<br><span class="muted">${esc(e.message)} — 웹캠·캡처보드를 꽂고 '새로 찾기' 를 누르세요.</span></div>`);
      return;
    }
    if (st.tab !== 'cameras') return;
    st.cams = devs;
    const cur = app.state && app.state.layers && app.state.layers.media;
    const on = d => cur && cur.type === 'camera' && cur.deviceId === d.deviceId;
    const b = body(devs.length ? `<div class="lib-grid">${devs.map((d, k) => `<div class="lib-cell cam-cell ${on(d) ? 'live' : ''}" data-k="${k}" title="${esc(d.label)}"><video muted autoplay playsinline data-cam="${esc(d.deviceId)}"></video><span>📷 ${esc(d.label || '카메라 ' + (k + 1))}${on(d) ? ' · <b class="live-dot">LIVE 배경</b>' : ''}</span>
        <div class="lib-cell-act"><button data-live="${k}" class="primary">${on(d) ? '■ 배경 끄기' : '▶ 송출 배경'}</button><button data-add="${k}" title="카메라 화면 가득 나오는 순서로 큐시트에 넣기">순서로</button><button data-bg="${k}" title="고른 순서(찬양·공지 등)의 배경으로">순서 배경</button><button data-tb="${k}" title="예배당 화면 템플릿 배경으로 (모든 화면)">전체 배경</button><button data-camset="${k}" title="해상도 · 프레임 · 밝기 · 좌우 반전">⚙ 화질</button></div><span class="cam-q muted" data-q="${k}"></span></div>`).join('')}</div>`
      : '<div class="empty">연결된 카메라가 없습니다.<br><span class="muted">USB 웹캠을 꽂거나, HDMI 카메라는 캡처보드로 연결하세요. OBS 의 \'가상 카메라 시작\' 도 여기 나옵니다.</span></div>');
    b.querySelectorAll('video[data-cam]').forEach(v => window.BCRender.cameraStream(v.dataset.cam).then(s => { v.srcObject = s; }).catch(() => { v.replaceWith(Object.assign(document.createElement('div'), { className: 'cam-err', textContent: '열 수 없음 (다른 프로그램이 쓰는 중?)' })); }));
    showCamQuality(b, devs);
    b.querySelectorAll('[data-camset]').forEach(x => x.onclick = e => { e.stopPropagation(); camSettings(dev(x.dataset.camset)); });
    const dev = k => devs[+k];
    const camItem = k => ({ type: 'camera', extra: { deviceId: dev(k).deviceId, label: dev(k).label, title: '📷 ' + (dev(k).label || '카메라') } });
    bindRows(b, k => liveMedia({ type: 'camera', deviceId: dev(k).deviceId, label: dev(k).label }), camItem);
    b.querySelectorAll('[data-live]').forEach(x => x.onclick = e => { e.stopPropagation(); liveMedia({ type: 'camera', deviceId: dev(x.dataset.live).deviceId, label: dev(x.dataset.live).label }); });
    b.querySelectorAll('[data-add]').forEach(x => x.onclick = e => { e.stopPropagation(); const it = camItem(x.dataset.add); addToCue(it.type, it.extra, it.extra.title); });
    b.querySelectorAll('[data-bg]').forEach(x => x.onclick = e => { e.stopPropagation(); setItemBg('camera:' + dev(x.dataset.bg).deviceId); });
    b.querySelectorAll('[data-tb]').forEach(x => x.onclick = async e => {
      e.stopPropagation();
      const d = dev(x.dataset.tb);
      const t = structuredClone(app.tplFor('main'));
      t.background.type = 'camera'; t.background.camera = { deviceId: d.deviceId, label: d.label };
      if (t.background.dim == null) t.background.dim = 0;
      const r = await cmd('saveTemplate', { template: t });
      app.showMsg(r.ok ? `예배당 화면 템플릿 배경을 '${d.label}' 카메라로 바꿨습니다.` : r.error, r.ok ? 'ok' : 'error', 2500);
    });
  }
  /** 카메라 칸 아래: 지금 받는 화질 */
  function showCamQuality(b, devs) {
    devs.forEach((d, k) => {
      const el = b.querySelector(`[data-q="${k}"]`);
      if (!el) return;
      window.BCRender.cameraInfo(d.deviceId).then(i => { el.textContent = qualityText(i); }).catch(() => {});
    });
  }
  const qualityText = i => `${i.width || '?'}×${i.height || '?'} · ${i.fps ? Math.round(i.fps) : '?'}fps`;

  /** 카메라 세부 설정: 해상도 · 프레임 · 꼭 맞추기 · 좌우 반전 · 밝기 · 대비 · 채도 */
  function camSettings(d) {
    const cur = (app.state.settings.cameras || {})[d.deviceId] || {};
    const p = { label: d.label, res: 'auto', fps: 0, exact: false, mirror: false, brightness: 100, contrast: 100, saturation: 100, ...cur };
    const opt = (v, l, c) => `<option value="${v}" ${String(c) === String(v) ? 'selected' : ''}>${l}</option>`;
    const slider = (k, lo, hi, l) => `<label>${l}</label><div class="row-flex"><input type="range" data-p="${k}" min="${lo}" max="${hi}" step="1" value="${p[k]}" style="flex:1"><span data-v="${k}" style="width:48px;text-align:right">${p[k]}%</span></div>`;
    app.openModal(`⚙ 카메라 화질 — ${d.label || '카메라'}`, `<div class="camset">
      <div class="camset-prev"><video muted autoplay playsinline data-cam="${esc(d.deviceId)}"></video></div>
      <div class="camset-info" id="csInfo">화질 확인 중…</div>
      <div class="form">
        <label>해상도</label><select data-p="res">${opt('auto', '자동 (1080p 우선)', p.res)}${opt('720', '720p (1280×720)', p.res)}${opt('1080', '1080p (1920×1080)', p.res)}${opt('1440', '1440p (2560×1440)', p.res)}${opt('2160', '4K (3840×2160)', p.res)}</select>
        <label>프레임</label><select data-p="fps">${opt(0, '자동 (30fps 우선)', p.fps)}${opt(24, '24fps', p.fps)}${opt(25, '25fps', p.fps)}${opt(30, '30fps', p.fps)}${opt(50, '50fps', p.fps)}${opt(60, '60fps', p.fps)}</select>
        <span></span><label class="tc-toggle"><input type="checkbox" data-p="exact" ${p.exact ? 'checked' : ''}> 고른 해상도·프레임을 꼭 맞추기 (카메라가 못 내면 가장 가까운 화질)</label>
        <span></span><label class="tc-toggle"><input type="checkbox" data-p="mirror" ${p.mirror ? 'checked' : ''}> 좌우 반전 (거울)</label>
        ${slider('brightness', 50, 200, '밝기')}${slider('contrast', 50, 200, '대비')}${slider('saturation', 0, 200, '채도')}
      </div>
      <div class="note">조작 화면 · 예배당 화면 창에 같이 적용됩니다. 화질이 낮으면: 캡처보드는 USB 3.0(파란 단자)에 꽂고, 1080p · 30fps 를 먼저 맞춰 보세요. 카메라 앱·OBS 가 같은 카메라를 쓰고 있으면 화질이 떨어지거나 열리지 않을 수 있습니다.</div>
      <div class="row-flex" style="justify-content:flex-end;margin-top:10px"><button data-reset>기본값으로</button><button data-close class="primary">완료</button></div>
    </div>`);
    const box = document.querySelector('#modalBody .camset');
    const v = box.querySelector('video');
    const info = () => window.BCRender.cameraInfo(d.deviceId).then(i => {
      box.querySelector('#csInfo').innerHTML = `지금 받는 화질: <b>${qualityText(i)}</b>${i.maxWidth ? ` <span class="muted">· 이 카메라 최대 ${i.maxWidth}×${i.maxHeight}${i.maxFps ? ' · ' + Math.round(i.maxFps) + 'fps' : ''}</span>` : ''}`;
    }).catch(e => { box.querySelector('#csInfo').textContent = '카메라를 열 수 없습니다: ' + (e && e.message || e); });
    const attach = () => window.BCRender.cameraStream(d.deviceId).then(s => { v.srcObject = s; v.play().catch(() => {}); info(); }).catch(() => info());
    attach();
    let t = 0;
    const save = (reopen) => {
      clearTimeout(t);
      t = setTimeout(async () => {
        await app.cmd('setCameraPrefs', { deviceId: d.deviceId, prefs: p });
        if (reopen) setTimeout(attach, 600); // 새 화질로 다시 연 뒤
      }, reopen ? 50 : 250);
    };
    box.addEventListener('input', e => {
      const k = e.target.dataset.p;
      if (!k || e.target.type !== 'range') return;
      p[k] = +e.target.value;
      box.querySelector(`[data-v="${k}"]`).textContent = p[k] + '%';
      // 바로 보이게 (저장은 조금 뒤)
      window.BCRender.setCameraPrefs({ ...(app.state.settings.cameras || {}), [d.deviceId]: p });
      save(false);
    });
    box.addEventListener('change', e => {
      const k = e.target.dataset.p;
      if (!k || e.target.type === 'range') return;
      p[k] = e.target.type === 'checkbox' ? e.target.checked : k === 'fps' ? +e.target.value : e.target.value;
      save(k === 'res' || k === 'fps' || k === 'exact');
    });
    box.querySelector('[data-reset]').onclick = async () => { await app.cmd('setCameraPrefs', { deviceId: d.deviceId, prefs: null }); app.closeModal(); camSettings(d); };
    box.querySelector('[data-close]').onclick = () => app.closeModal();
  }

  /** 송출 배경이 바뀌면 카메라 탭 표시 갱신 */
  function onLayers() { if (st.tab === 'cameras' && root()) { const cur = JSON.stringify((app.state.layers || {}).media || null); if (cur !== st.lastMedia) { st.lastMedia = cur; drawCameras(); } } }

  /** 썸네일: 영상은 첫 장면 (소리 없음) */
  function thumb(f) {
    return f.video ? `<video muted preload="metadata" src="${esc(f.url)}#t=1"></video>` : `<img loading="lazy" src="${esc(f.url)}" alt="">`;
  }
  /** 빠른 설정에서 고른 출력의 템플릿 배경을 이 그림·영상으로 */
  async function setTemplateBg(f) {
    const out = (document.querySelector('#qTarget .on') || {}).dataset?.out || 'main';
    const t = structuredClone(app.tplFor(out));
    if (f.video) { t.background.type = 'video'; t.background.video = f.url; } else { t.background.type = 'image'; t.background.image = f.url; t.background.imageFit = t.background.imageFit || 'cover'; }
    if (t.background.dim == null) t.background.dim = 0;
    const r = await cmd('saveTemplate', { template: t });
    if (!r.ok) return app.showMsg(r.error, 'error');
    app.showMsg(`${out === 'main' ? '예배당 화면' : 'OBS 자막'} 템플릿 배경을 '${f.name}' (으)로 바꿨습니다.`, 'ok', 2500);
  }
  function setItemBg(url) {
    const ok = window.BCCue && window.BCCue.updateSelected(it => {
      if (!['song', 'text', 'title', 'bible'].includes(it.type)) throw new Error('글자 순서(찬양·공지·제목·성경)를 먼저 고르세요.');
      it.bg = url;
    });
    if (ok) app.showMsg('고른 순서의 배경으로 정했습니다.', 'ok', 1500);
    else app.showMsg('큐시트에서 배경을 바꿀 순서를 먼저 고르세요.', 'info', 2500);
  }
  async function addFolder(kind) {
    const r = await cmd('pickFolder', { title: kind === 'audio' ? '음악 폴더 고르기' : '이미지 폴더 고르기' });
    if (!r.ok) return app.showMsg(r.error, 'error');
    if (!r.result) return;
    const a = await cmd('addLibFolder', { kind, path: r.result });
    if (!a.ok) return app.showMsg(a.error, 'error');
    app.showMsg(`'${a.result.name}' 폴더를 등록했습니다 (${a.result.count}개).`, 'ok', 2000);
    drawFiles(kind);
  }
  async function manageFolders(kind) {
    const name = kind === 'audio' ? '음악' : '이미지';
    const r = await cmd('listLibFolders', { kind });
    const fs = r.ok ? r.result : [];
    app.openModal(`${name} 폴더`, `<div class="form">
      <label>등록한 폴더</label><div>${fs.map(f => `<div class="row-flex"><b>${esc(f.name)}</b><span class="muted">${esc(f.path)} · ${f.count}개</span>${f.exists ? '' : '<span class="err-text">폴더 없음</span>'}<button data-rm="${esc(f.path)}">빼기</button></div>`).join('') || '<span class="muted">없음</span>'}</div>
      <label>폴더 추가</label><div class="row-flex"><button id="lfPick">📁 폴더 고르기…</button><input type="text" id="lfPath" placeholder="또는 경로 입력" style="flex:1"><button id="lfAdd">추가</button></div>
      <span></span><div class="note">${kind === 'audio' ? 'mp3 · wav · m4a · ogg · flac' : 'png · jpg · webp · gif'} 파일을 읽습니다 (한 단계 아래 폴더까지). 원본 파일은 옮기거나 바꾸지 않습니다.</div>
    </div>`);
    document.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { await cmd('removeLibFolder', { kind, path: b.dataset.rm }); app.closeModal(); manageFolders(kind); drawFiles(kind); });
    $('#lfPick').onclick = async () => { app.closeModal(); await addFolder(kind); };
    $('#lfAdd').onclick = async () => {
      const a = await cmd('addLibFolder', { kind, path: $('#lfPath').value.trim() });
      if (!a.ok) return app.showMsg(a.error, 'error');
      app.closeModal(); drawFiles(kind);
    };
  }

  /** 고르기 창 (큐시트 편집칸의 '이미지 고르기…', '음악 고르기…') */
  async function pickFile(kind, done, opts = {}) {
    const name = kind === 'audio' ? '음악' : opts.video === 'only' ? '영상' : opts.video === false ? '이미지' : '이미지·영상';
    const fr = await cmd('listLibFolders', { kind });
    app.openModal(`${name} 고르기`, `<div class="lib-pick">
      <div class="row-flex"><input type="text" id="lpQ" placeholder="파일 이름으로 찾기" style="flex:1"><button id="lpFolders">폴더…</button>${kind === 'image' ? '<button id="lpUp">내 PC 에서 올리기…</button>' : ''}</div>
      <div id="lpList" class="${kind === 'image' ? 'lib-grid' : ''}"></div></div>`);
    const draw = async () => {
      if (!fr.ok || !fr.result.length) { $('#lpList').innerHTML = `<div class="empty">등록한 ${name} 폴더가 없습니다. '폴더…' 로 등록하세요.</div>`; return; }
      const r = await cmd('searchLibFiles', { kind, query: $('#lpQ').value });
      const rows = r.ok ? r.result : [];
      $('#lpList').innerHTML = kind === 'image'
        ? rows.filter(f => (opts.video === 'only' ? f.video : opts.video === false ? !f.video : true)).map((f, k, arr) => { rows._shown = arr; return `<div class="lib-cell" data-k="${k}">${thumb(f)}<span>${f.video ? '🎞 ' : ''}${esc(f.name)}</span></div>`; }).join('')
        : rows.map((f, k) => `<div class="lib-row" data-k="${k}"><span class="lib-ico">🔊</span><span class="lib-t"><b>${esc(f.name)}</b></span><span class="muted">${esc(f.folder)}</span></div>`).join('');
      const shown = kind === 'image' ? (rows._shown || []) : rows;
      $('#lpList').querySelectorAll('[data-k]').forEach(x => x.onclick = () => { app.closeModal(); done(shown[+x.dataset.k]); });
    };
    let t = null;
    $('#lpQ').oninput = () => { clearTimeout(t); t = setTimeout(draw, 150); };
    $('#lpFolders').onclick = () => { app.closeModal(); manageFolders(kind); };
    if ($('#lpUp')) $('#lpUp').onclick = () => { app.closeModal(); window.BCCue.pickImage(url => done({ url, name: '이미지' })); };
    draw();
    $('#lpQ').focus();
  }

  // ---------------- 음악 재생 (조작 PC) ----------------
  const audio = (() => {
    const el = new Audio();
    el.preload = 'auto';
    const cur = { url: '', title: '', list: null, index: -1, fadeOnLeave: false, base: 1, fading: null, startedAt: 0 };
    let continuous = false;
    function fade(to, ms, then) {
      clearInterval(cur.fading);
      const from = el.volume, steps = Math.max(1, Math.round(ms / 50));
      let n = 0;
      cur.fading = setInterval(() => {
        n++;
        el.volume = Math.max(0, Math.min(1, from + (to - from) * (n / steps)));
        if (n >= steps) { clearInterval(cur.fading); cur.fading = null; if (then) then(); }
      }, 50);
    }
    function play({ url, title, volume = 1, loop = false, fadeOnLeave = false, list = null, index = -1 }) {
      clearInterval(cur.fading);
      Object.assign(cur, { url, title, list, index, fadeOnLeave, base: volume, startedAt: Date.now() });
      el.src = url; el.loop = loop; el.volume = 0;
      el.play().then(() => fade(volume, 600)).catch(err => app.showMsg('재생할 수 없습니다: ' + err.message, 'error'));
      render();
    }
    function stop() { clearInterval(cur.fading); el.pause(); el.currentTime = 0; cur.url = ''; render(); }
    function fadeOut(ms = 2500) { if (!cur.url || el.paused) return; fade(0, ms, () => { el.pause(); cur.url = ''; render(); }); }
    el.addEventListener('ended', () => {
      if (continuous && cur.list && cur.index + 1 < cur.list.length) { const n = cur.list[cur.index + 1]; play({ url: n.url, title: n.name, list: cur.list, index: cur.index + 1, volume: cur.base }); }
      else { cur.url = ''; render(); }
    });
    el.addEventListener('timeupdate', () => tick());
    el.addEventListener('play', render); el.addEventListener('pause', render);
    const fmt = t => (isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00');
    function tick() {
      const p = root() && root().querySelector('.lib-player');
      if (!p || p.hidden) return;
      const bar = p.querySelector('[data-seek]');
      if (bar && !bar.matches(':active')) bar.value = el.duration ? el.currentTime / el.duration : 0;
      const tm = p.querySelector('[data-time]');
      if (tm) tm.textContent = `${fmt(el.currentTime)} / ${fmt(el.duration)}`;
    }
    function render() {
      const p = root() && root().querySelector('.lib-player');
      if (!p) return;
      p.hidden = !cur.url;
      if (!cur.url) return;
      p.innerHTML = `<span class="lib-now">🔊 <b>${esc(cur.title)}</b></span>
        <button data-pp>${el.paused ? '▶' : '❚❚'}</button><button data-stop title="정지">■</button><button data-fo title="3초 동안 줄이며 끄기">페이드아웃</button>
        <input type="range" data-seek min="0" max="1" step="0.001" value="0" style="flex:1"><span data-time class="muted"></span>
        <span title="소리 크기">🔈</span><input type="range" data-vol min="0" max="1" step="0.05" value="${cur.base}" style="width:90px">
        <label class="tc-toggle" title="끝나면 목록의 다음 곡"><input type="checkbox" data-cont ${continuous ? 'checked' : ''}> 이어서</label>`;
      p.querySelector('[data-pp]').onclick = () => (el.paused ? el.play() : el.pause());
      p.querySelector('[data-stop]').onclick = stop;
      p.querySelector('[data-fo]').onclick = () => fadeOut(3000);
      p.querySelector('[data-seek]').oninput = e => { if (el.duration) el.currentTime = e.target.value * el.duration; };
      p.querySelector('[data-vol]').oninput = e => { clearInterval(cur.fading); cur.base = +e.target.value; el.volume = cur.base; };
      p.querySelector('[data-cont]').onchange = e => { continuous = e.target.checked; };
      tick();
    }
    return {
      play, stop, fadeOut, render,
      /** 다른 화면을 송출할 때: '페이드아웃' 표시된 음악이면 줄이며 끄기 */
      onVisualSend() { if (cur.url && cur.fadeOnLeave && !el.paused && Date.now() - cur.startedAt > 2000) fadeOut(2500); }, // 방금(F6 으로) 시작한 음악은 그대로
      setVolumeIf(url, v) { if (cur.url === url) { cur.base = v; el.volume = v; render(); } },
      // 미디어 패널
      toggle() { if (!cur.url) return; if (el.paused) el.play(); else el.pause(); },
      seek(frac) { if (el.duration) el.currentTime = Math.max(0, Math.min(1, frac)) * el.duration; },
      setVolume(v) { clearInterval(cur.fading); cur.base = v; el.volume = v; render(); },
      setLoop(on) { el.loop = !!on; },
      info: () => ({ url: cur.url, title: cur.title, paused: el.paused, currentTime: el.currentTime, duration: el.duration || 0, volume: cur.base, loop: el.loop }),
      state: () => ({ playing: !!cur.url && !el.paused, title: cur.title, url: cur.url, volume: el.volume }),
    };
  })();

  // ---------------- 오버레이 ----------------
  const OV_TYPES = [['logo', '🖼 로고'], ['clock', '🕒 시계'], ['countdown', '⏳ 카운트다운'], ['banner', '📣 배너'], ['text', '🅰 글자']];
  const POS = [['top-left', '↖'], ['top-center', '↑'], ['top-right', '↗'], ['middle-left', '←'], ['center', '·'], ['middle-right', '→'], ['bottom-left', '↙'], ['bottom-center', '↓'], ['bottom-right', '↘']];
  function ovSummary(o) {
    if (o.type === 'clock') return R.clockText(o);
    if (o.type === 'countdown') return /:/.test(o.target) ? `${o.target} 까지` : `${o.target || 5}분`;
    if (o.type === 'logo') return o.image ? '그림' : '(그림 없음)';
    return o.text || '';
  }
  function drawOverlays() {
    bar(`<span class="muted" style="flex:1">켜면 슬라이드와 상관없이 출력 위에 겹쳐 보입니다</span>${OV_TYPES.map(([t, l]) => `<button data-newov="${t}">${l}</button>`).join('')}`);
    root().querySelectorAll('[data-newov]').forEach(b => b.onclick = () => editOverlay({ type: b.dataset.newov }));
    const list = app.state.settings.overlays || [];
    const b = body(list.length ? list.map(o => `<div class="lib-row ov-row ${o.on ? 'on' : ''}" data-id="${esc(o.id)}">
        <label class="ov-switch" title="켜기·끄기"><input type="checkbox" data-tog ${o.on ? 'checked' : ''}><span></span></label>
        <span class="lib-t"><b>${esc(o.name)}</b><span class="muted">${esc(OV_TYPES.find(x => x[0] === o.type)?.[1] || '')} · ${esc(ovSummary(o))} · ${o.outputs.map(x => (x === 'main' ? '예배당' : 'OBS')).join('·') || '출력 없음'}</span></span>
        <button data-edit>고치기</button><button data-del title="지우기">✕</button></div>`).join('')
      : '<div class="empty">오버레이가 없습니다.<br>위의 단추로 로고·시계·카운트다운(예배 시작까지)·배너(공지)를 만드세요.</div>');
    b.querySelectorAll('.ov-row').forEach(r => {
      const id = r.dataset.id;
      r.querySelector('[data-tog]').onchange = e => cmd('toggleOverlay', { id, on: e.target.checked });
      r.querySelector('[data-edit]').onclick = () => editOverlay(list.find(o => o.id === id));
      r.querySelector('[data-del]').onclick = async () => { if (confirm('이 오버레이를 지울까요?')) { await cmd('deleteOverlay', { id }); } };
    });
    activate = () => {};
  }
  function editOverlay(o0) {
    const o = { outputs: ['main', 'overlay'], position: o0.type === 'banner' ? 'bottom-center' : o0.type === 'logo' ? 'top-right' : 'top-right', margin: 40, size: o0.type === 'logo' ? 140 : o0.type === 'banner' ? 40 : 44, color: '#ffffff', bg: o0.type === 'banner' ? 'rgba(20,30,60,0.85)' : '', opacity: 1, format: '24', showSeconds: true, target: o0.type === 'countdown' ? '11:00' : '', doneText: '', text: '', image: '', full: o0.type === 'banner', ...o0 };
    const t = o.type;
    app.openModal(o.id ? '오버레이 고치기' : '오버레이 만들기', `<div class="form ov-form">
      <label>이름</label><input type="text" id="ovName" value="${esc(o.name || '')}" placeholder="${esc(OV_TYPES.find(x => x[0] === t)[1].slice(2))}">
      ${t === 'logo' ? `<label>그림</label><div class="row-flex">${o.image ? `<img class="ce-thumb" id="ovImgTh" src="${esc(o.image)}" alt="">` : '<span id="ovImgTh" class="muted">(없음)</span>'}<button id="ovImg">🖼 그림 고르기…</button></div>` : ''}
      ${t === 'banner' || t === 'text' ? `<label>글</label><textarea id="ovText" rows="3" placeholder="${t === 'banner' ? '예: 예배가 곧 시작됩니다 · 휴대폰은 무음으로' : '화면에 겹쳐 보일 글'}">${esc(o.text)}</textarea>` : ''}
      ${t === 'countdown' ? `<label>언제까지</label><div class="row-flex"><input type="text" id="ovTarget" value="${esc(o.target)}" style="width:110px"><span class="note">"11:00" = 오늘 11시까지 · "5" = 켠 뒤 5분</span></div>
        <label>끝나면</label><input type="text" id="ovDone" value="${esc(o.doneText)}" placeholder="비우면 00:00 · 예: 예배를 시작합니다">` : ''}
      ${t === 'clock' ? `<label>표시</label><div class="row-flex"><select id="ovFmt"><option value="24" ${o.format !== '12' ? 'selected' : ''}>24시간 (13:05)</option><option value="12" ${o.format === '12' ? 'selected' : ''}>오전/오후 (오후 01:05)</option></select><label class="tc-toggle"><input type="checkbox" id="ovSec" ${o.showSeconds ? 'checked' : ''}> 초 표시</label></div>` : ''}
      <label>위치</label><div class="tc-seg tc-seg-sm" id="ovPos">${POS.map(([v, l]) => `<button type="button" data-v="${v}" class="${o.position === v ? 'on' : ''}" title="${v}">${l}</button>`).join('')}</div>
      ${t === 'banner' ? `<label>너비</label><label class="tc-toggle"><input type="checkbox" id="ovFull" ${o.full ? 'checked' : ''}> 화면 너비 가득</label>` : ''}
      <label>${t === 'logo' ? '높이' : '글자 크기'}</label><div class="row-flex"><input type="range" id="ovSize" min="${t === 'logo' ? 40 : 16}" max="${t === 'logo' ? 500 : 160}" value="${o.size}" style="flex:1"><span id="ovSizeV">${o.size}px</span></div>
      <label>가장자리 거리</label><div class="row-flex"><input type="range" id="ovMargin" min="0" max="300" value="${o.margin}" style="flex:1"><span id="ovMarginV">${o.margin}px</span></div>
      ${t !== 'logo' ? `<label>글자 색</label><input type="color" id="ovColor" value="${/^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#ffffff'}">
        <label>상자</label><div class="row-flex"><label class="tc-toggle"><input type="checkbox" id="ovBoxOn" ${o.bg ? 'checked' : ''}> 뒤에 상자</label><input type="color" id="ovBg" value="${/^#[0-9a-f]{6}$/i.test(o.bg) ? o.bg : '#141e3c'}"><span class="note">상자는 85% 진하기</span></div>` : ''}
      <label>진하기</label><div class="row-flex"><input type="range" id="ovOp" min="0.1" max="1" step="0.05" value="${o.opacity}" style="flex:1"></div>
      <label>보일 곳</label><div class="row-flex"><label class="tc-toggle"><input type="checkbox" id="ovMain" ${o.outputs.includes('main') ? 'checked' : ''}> 예배당 화면</label><label class="tc-toggle"><input type="checkbox" id="ovObs" ${o.outputs.includes('overlay') ? 'checked' : ''}> OBS 자막</label></div>
      <span></span><div class="row-flex"><button id="ovSave" class="primary">저장${o.id ? '' : '하고 켜기'}</button></div>
    </div>`);
    let image = o.image;
    let pos = o.position;
    $('#ovPos').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; pos = b.dataset.v; $('#ovPos').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
    $('#ovSize').oninput = e => { $('#ovSizeV').textContent = e.target.value + 'px'; };
    $('#ovMargin').oninput = e => { $('#ovMarginV').textContent = e.target.value + 'px'; };
    if ($('#ovImg')) $('#ovImg').onclick = () => pickFile('image', f => { image = f.url; editOverlay({ ...collect(), image }); }, { video: false });
    const hexA = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
    const collect = () => ({
      ...o, name: $('#ovName').value.trim(), image, position: pos,
      text: $('#ovText') ? $('#ovText').value : o.text,
      target: $('#ovTarget') ? $('#ovTarget').value.trim() : o.target,
      doneText: $('#ovDone') ? $('#ovDone').value : o.doneText,
      format: $('#ovFmt') ? $('#ovFmt').value : o.format,
      showSeconds: $('#ovSec') ? $('#ovSec').checked : o.showSeconds,
      full: $('#ovFull') ? $('#ovFull').checked : o.full,
      size: +$('#ovSize').value, margin: +$('#ovMargin').value, opacity: +$('#ovOp').value,
      color: $('#ovColor') ? $('#ovColor').value : o.color,
      bg: $('#ovBoxOn') ? ($('#ovBoxOn').checked ? hexA($('#ovBg').value, 0.85) : '') : '',
      outputs: [$('#ovMain').checked && 'main', $('#ovObs').checked && 'overlay'].filter(Boolean),
    });
    $('#ovSave').onclick = async () => {
      const n = collect();
      if (!n.id) n.on = true;
      const r = await cmd('saveOverlay', { overlay: n });
      if (!r.ok) return app.showMsg(r.error, 'error');
      app.closeModal();
      if (st.tab !== 'overlays') show('overlays');
      app.showMsg(`'${r.result.name}' 오버레이를 저장했습니다.`, 'ok', 1500);
    };
  }

  // ---------------- 템플릿 ----------------
  function drawTemplates() {
    bar(`<span class="muted" style="flex:1">출력에 적용하거나, 큐시트의 고른 순서에만 쓰게 할 수 있습니다</span><button data-themes>테마…</button><button data-edit-all>템플릿 편집…</button>`);
    root().querySelector('[data-themes]').onclick = () => window.BCSettings && window.BCSettings.open('themes');
    root().querySelector('[data-edit-all]').onclick = () => window.BCSettings && window.BCSettings.open('templates');
    const s = app.state.settings;
    const sample = app.preview ? app.preview.slides[app.preview.index] : { ref: '요한복음 3:16', title: '요한복음 3:16', parts: [{ book: 43, chapter: 3, verse: 16, text: '하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니' }] };
    const b = body(`<div class="lib-grid lib-tgrid">${s.templates.map(t => `<div class="lib-tcell" data-id="${esc(t.id)}">
        <div class="screen" data-pv></div>
        <b>${esc(t.name)}</b>${s.activeTemplates.main === t.id ? '<span class="ok-text">예배당</span>' : ''}${s.activeTemplates.overlay === t.id ? '<span class="ok-text">OBS</span>' : ''}
        <div class="row-flex"><button data-apply="main" title="예배당 화면에 적용">예배당</button><button data-apply="overlay" title="OBS 자막에 적용">OBS</button><button data-item="main" title="큐시트의 고른 순서만 (예배당)">순서에·예배당</button><button data-item="overlay" title="큐시트의 고른 순서만 (OBS)">순서에·OBS</button><button data-ed title="이 템플릿 편집">편집</button></div>
      </div>`).join('')}</div>`);
    b.querySelectorAll('.lib-tcell').forEach(c => {
      const t = s.templates.find(x => x.id === c.dataset.id);
      R.renderInto(c.querySelector('[data-pv]'), sample, t, { checker: true, versionName: '개역개정' });
      c.querySelectorAll('[data-apply]').forEach(x => x.onclick = async () => {
        const out = x.dataset.apply;
        const r = await cmd('setTemplate', { output: out, templateId: t.id });
        if (!r.ok) return app.showMsg(r.error, 'error');
        app.showMsg(`${out === 'main' ? '예배당 화면' : 'OBS 자막'}에 '${t.name}' 을(를) 적용했습니다.`, 'ok', 1500);
      });
      c.querySelectorAll('[data-item]').forEach(x => x.onclick = () => {
        const k = x.dataset.item === 'main' ? 'tplMain' : 'tplOverlay';
        const ok = window.BCCue && window.BCCue.updateSelected(it => { it[k] = t.id; });
        app.showMsg(ok ? `고른 순서에 '${t.name}' 을(를) 정했습니다.` : '큐시트에서 순서를 먼저 고르세요.', ok ? 'ok' : 'info', 2000);
      });
      c.querySelector('[data-ed]').onclick = () => window.BCSettings && window.BCSettings.open('templates', { templateId: t.id });
    });
    activate = () => {};
  }

  window.BCLib = {
    init, show, audio, tab: () => st.tab, liveMedia: m => liveMedia(m), onLayers: () => onLayers(), importSongs: paths => importSongs(paths), webLyrics: (q, opts) => webLyrics(q || '', opts), pasteSongs: () => pasteSongs(),
    pickImage: done => pickFile('image', f => done(f.url)),
    pickVideo: done => pickFile('image', f => done(f.url), { video: 'only' }),
    pickAudio: done => pickFile('audio', done),
    onOverlays: () => { if (st.tab === 'overlays') drawOverlays(); },
    onSettings: what => { if (what === 'templates' && st.tab === 'templates') drawTemplates(); if (what === 'settings' && (st.tab === 'images' || st.tab === 'audio' || st.tab === 'hymns')) show(st.tab); },
    onSongs: () => { if (st.tab === 'songs') drawSongs(); },
    addToCue: (type, extra, label) => addToCue(type, extra, label),
    onCameraPrefs: () => { if (st.tab === 'cameras' && root()) setTimeout(() => showCamQuality(root(), st.cams || []), 800); },
  };
})();
