/* 큐시트(예배 순서) 패널
 * - 예배 순서를 미리 만들어 두고, 항목을 고르면 미리보기 / 더블클릭·F9 로 송출
 * - 고른 항목은 가운데 위쪽 편집칸에서 바로 고친다 (입력하면 자동 저장·미리보기 갱신)
 * - 항목의 마지막 슬라이드에서 F6 → 다음 순서의 첫 슬라이드를 송출 (코어가 'cue-next' 로 알려 줌)
 * - 🎼 찬송가: 등록한 폴더의 .pps 를 번호·제목으로 찾아 넣는다. 악보와 배경을 따로 다룬다
 */
(function () {
  'use strict';
  const app = window.BC;
  const SL = window.BCSlides;
  const esc = window.BCRender.esc;
  const $ = s => document.querySelector(s);
  const cmd = app.cmd;

  const TYPE = { camera: '카메라', slideshow: '슬라이드쇼', video: '영상', audio: '음악', hymn: '찬송가·PPT', bible: '성경', song: '찬양', text: '공지', title: '제목', image: '이미지', blank: '빈 화면' };
  const ICON = Object.fromEntries(Object.keys(TYPE).map(t => [t, window.BCIcon.type(t)])); // 종류별 아이콘 (svg)
  let editorOn = true;
  try { editorOn = localStorage.getItem('wc-cue-editor') !== '0'; } catch { /* 무시 */ }
  const st = { list: [], cue: null, sel: -1, dragFrom: -1, saving: null, lastSave: 0, editTimer: null, hymnMeta: new Map(), songs: new Map(), songTimer: null };
  /** 순서별 템플릿 { main, overlay } (없으면 null = 출력 기본) */
  const itemTpl = it => (it.tplMain || it.tplOverlay ? { main: it.tplMain || '', overlay: it.tplOverlay || '' } : null);
  // 순서별 테마: 테마의 예배당·OBS 템플릿을 이 순서에만
  let themeList = [];
  const loadThemes = async () => { if (themeList.length) return themeList; const r = await cmd('listThemes', {}); themeList = r.ok ? r.result.map(t => ({ id: t.id, name: t.name })) : []; return themeList; };
  /** 이 순서의 테마 id ('' = 기본, 'custom' = 직접 고른 템플릿) */
  const themeOf = it => {
    const m = /^theme-(.+)-main$/.exec(it.tplMain || '');
    if (m && (!it.tplOverlay || it.tplOverlay === `theme-${m[1]}-overlay`)) return m[1];
    return it.tplMain || it.tplOverlay ? 'custom' : '';
  };
  const themeName = it => { const id = themeOf(it); if (!id) return ''; if (id === 'custom') return '직접 고른 템플릿'; const t = themeList.find(x => x.id === id); return t ? t.name : id; };
  async function setItemTheme(i, id) {
    const it = st.cue && st.cue.items[i];
    if (!it) return;
    if (!id) { delete it.tplMain; delete it.tplOverlay; }
    else {
      const r = await cmd('ensureTheme', { id });
      if (!r.ok) return app.showMsg(r.error, 'error');
      it.tplMain = r.result.main; it.tplOverlay = r.result.overlay;
    }
    save(); render(); if (i === st.sel) forceEditor();
    // 지금 송출 중인 순서면 송출 화면도 (보던 슬라이드 그대로)
    const L = app.state.live;
    const onAir = L && L.hasLive && L.visible && L.passage && L.passage.cueId === st.cue.id && L.passage.cueIndex === i;
    const at = onAir ? L.index : 0;
    await previewItem(i, { keepIndex: true });
    if (onAir) { app.setPreviewIndex(at); await app.sendPreview(); }
    app.showMsg(id ? `${i + 1}번 '${it.title}': 테마 '${(themeList.find(t => t.id === id) || {}).name || id}'` : `${i + 1}번 '${it.title}': 기본 테마로`, 'ok', 1800);
  }
  const newId = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------------- 불러오기·저장 ----------------
  async function init() {
    loadThemes().then(() => { render(); });
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
    sel.innerHTML = st.list.map(c => `<option value="${esc(c.id)}">${c.pinned ? '📌 ' : ''}${c.template ? '📄 ' : ''}${esc(c.name)} (${c.count})</option>`).join('') || '<option value="">(큐시트 없음)</option>';
    if (st.cue) sel.value = st.cue.id;
  }

  async function openCue(id) {
    const r = await cmd('getCue', { id });
    if (!r.ok) return app.showMsg(r.error, 'error');
    st.cue = r.result;
    st.sel = Math.min(st.sel, st.cue.items.length - 1);
    st.snap = JSON.stringify(st.cue); st.undo = []; st.redo = []; // 실행 취소는 큐시트마다 새로
    $('#cueSel').value = id;
    cmd('setActiveCue', { id });
    render();
    renderEditor();
  }

  /** 바뀐 내용을 곧바로 저장 (연속 변경은 모아서) */
  // ---------------- 실행 취소 (Ctrl+Z · 다시 실행 Ctrl+Y) ----------------
  // 저장할 때마다 바로 전 모습을 쌓아 둔다. 큐시트를 바꾸면 비운다
  function pushUndo() {
    const now = JSON.stringify(st.cue);
    if (st.snap && st.snap !== now && st.cue && JSON.parse(st.snap).id === st.cue.id) {
      (st.undo = st.undo || []).push(st.snap);
      if (st.undo.length > 50) st.undo.shift();
      st.redo = [];
    }
    st.snap = now;
  }
  function undo(redo = false) {
    const from = redo ? st.redo : st.undo;
    if (!from || !from.length || !st.cue) return false;
    const to = redo ? st.undo : st.redo;
    to.push(JSON.stringify(st.cue));
    st.cue = JSON.parse(from.pop());
    st.snap = JSON.stringify(st.cue);
    st.sel = Math.min(st.sel, st.cue.items.length - 1);
    save(); forceEditor(); render();
    app.showMsg(redo ? '다시 실행' : `실행 취소 (${st.undo.length}번 더 가능)`, 'ok', 1200);
    return true;
  }
  window.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k !== 'z' && k !== 'y') return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return; // 글 칸은 브라우저의 되돌리기
    if (!$('#modal').hidden || (window.BCSlideEdit && window.BCSlideEdit.isOpen())) return; // 창·슬라이드 편집기는 제 것을 쓴다
    if (!st.cue) return;
    e.preventDefault();
    if (undo(k === 'y' || e.shiftKey) === false) app.showMsg(k === 'y' || e.shiftKey ? '다시 실행할 것이 없습니다.' : '되돌릴 것이 없습니다.', 'info', 1200);
  }, true);

  function save() {
    pushUndo();
    clearTimeout(st.saving);
    st.saving = setTimeout(async () => {
      st.lastSave = Date.now();
      const r = await cmd('saveCue', { cue: st.cue });
      if (!r.ok) return app.showMsg(r.error, 'error');
      // 저장 중에 더 고쳤을 수 있으니 서버 값으로 덮지 않고 id 만 맞춘다
      st.cue.id = r.result.id;
      $('#cueSaved') && ($('#cueSaved').textContent = '저장됨 ✓');
      refreshList();
    }, 300);
    render();
  }

  // ---------------- 목록 그리기 ----------------
  function detail(it) {
    switch (it.type) {
      case 'hymn': return it.number != null ? `${it.number}장` : '찬송가';
      case 'bible': return it.ref || '(장절을 입력하세요)';
      case 'song': { const strip = t => (window.BCGroup ? window.BCGroup.stripFmt(window.BCGroup.stripChords(t)) : t); return strip((it.lyrics || '').split('\n').find(l => l.trim() && !/^\[.*\]$/.test(l.trim()) && strip(l).trim()) || '').trim() || '(가사 없음)'; }
      case 'text': return window.BCGroup.stripFmt((it.body || '').split('\n').find(l => l.trim()) || '') || '(내용 없음)';
      case 'title': return it.subtitle || '';
      case 'image': return it.image ? '이미지' : '(이미지를 고르세요)';
      case 'blank': return it.mode === 'background' ? '배경·로고만' : '검은 화면';
      case 'audio': return it.file ? fileName(it.file) : '(음악을 고르세요)';
      case 'video': return it.file ? fileName(it.file) + (it.loop ? ' · 반복' : '') : '(영상을 고르세요)';
    }
    return '';
  }

  function render() {
    const el = $('#cueList');
    if (window.BCGrid) setTimeout(() => window.BCGrid.update(), 0); // 전체 보기: 큐시트가 바뀌면 다시
    if (!st.cue) { el.innerHTML = ''; return; }
    const live = app.state.live;
    const airIdx = live.hasLive && live.passage && live.passage.cueId === st.cue.id ? live.passage.cueIndex : -1;
    const pvIdx = app.preview && app.preview.cue && app.preview.cue.id === st.cue.id ? app.preview.cue.index : -1;
    const plan = planTimes();
    el.innerHTML = st.cue.items.length ? st.cue.items.map((it, i) => `
      <div class="cue-item ${i === st.sel ? 'sel' : ''} ${i === pvIdx ? 'pv' : ''} ${i === airIdx ? 'air' : ''} ${i === airIdx && !live.visible ? 'hid' : ''}" draggable="true" data-i="${i}">
        <span class="cue-no">${i + 1}</span>
        <span class="cue-ico" data-t="${it.type}" title="${TYPE[it.type]}">${ICON[it.type]}</span>
        <span class="cue-body" data-noi18n><b>${esc(it.title)}</b>${themeOf(it) ? `<span class="cue-theme" title="이 순서만 다른 테마">🎨 ${esc(themeName(it))}</span>` : ''}<span class="cue-detail">${esc(detail(it))}</span>${it.note ? `<span class="cue-note">📝 ${esc(it.note)}</span>` : ''}</span>
        ${plan[i] && timesOn() ? `<span class="cue-time" title="예정 시작${it.duration ? ' · ' + it.duration + '분' : ''}">${plan[i]}${it.duration ? `<small>${it.duration}분</small>` : ''}</span>` : ''}
        <button class="cue-edit" data-edit="${i}" title="이 순서 고치기 (F2)">${window.BCIcon('pencil')}</button>
      </div>`).join('') : '<div class="empty">아래 버튼으로 예배 순서를 추가하세요.</div>';
    el.querySelector('.cue-item.sel')?.scrollIntoView({ block: 'nearest' });
    noteLive();
    renderClock();
  }

  // ---------------- 예배 진행 시계 ----------------
  const hm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
  const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
  /** 순서마다 예정 시작 (시작 시각 + 앞 순서들의 예정 시간 합) */
  function planMinutes() {
    const start = toMin(st.cue && st.cue.startTime);
    if (start == null) return [];
    let t = start;
    return st.cue.items.map(it => { const at = t; t += Number(it.duration) || 0; return at; });
  }
  function planTimes() { return planMinutes().map(hm); }
  /** 실제로 송출을 시작한 시각 (이 PC 에 큐시트·날짜별로 기억) */
  function actualKey() { return st.cue ? `wc-actual-${st.cue.id}-${new Date().toISOString().slice(0, 10)}` : ''; }
  function actuals() { try { return JSON.parse(localStorage.getItem(actualKey()) || '{}'); } catch { return {}; } }
  let lastAirIdx = -1;
  function noteLive() {
    if (!st.cue) return;
    const live = app.state.live;
    const idx = live.hasLive && live.passage && live.passage.cueId === st.cue.id ? live.passage.cueIndex : -1;
    if (idx < 0 || idx === lastAirIdx) return;
    lastAirIdx = idx;
    const a = actuals();
    if (!a[idx]) { a[idx] = Date.now(); try { localStorage.setItem(actualKey(), JSON.stringify(a)); } catch { /* 무시 */ } }
  }
  const timesOn = () => !!(app.state && app.state.settings.cueTimes === true);
  function renderClock() {
    const el = $('#cueClock');
    if (!el || !st.cue) return;
    el.hidden = !timesOn();
    if (!timesOn()) return;
    const pm = planMinutes();
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const live = app.state.live;
    const idx = live.hasLive && live.passage && live.passage.cueId === st.cue.id ? live.passage.cueIndex : -1;
    const totalDur = st.cue.items.reduce((s, it) => s + (Number(it.duration) || 0), 0);
    let html = `<span class="cc-start" title="예배 시작 시각 (비우면 진행 시계 끔)">⏰ <input type="time" id="ccStart" value="${esc(st.cue.startTime || '')}"></span>`;
    if (pm.length) {
      html += `<span class="muted">끝 예정 ${hm(pm[0] + totalDur)}</span>`;
      if (idx >= 0) {
        const a = actuals()[idx];
        const startedMin = a ? (() => { const d = new Date(a); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; })() : nowMin;
        const dur = Number(st.cue.items[idx].duration) || 0;
        // 늦음 = (이 순서를 시작한 시각 - 예정) + (예정 시간을 넘긴 만큼)
        const delay = (startedMin - pm[idx]) + (dur ? Math.max(0, nowMin - startedMin - dur) : 0);
        const d = Math.round(delay);
        const cls = d >= 3 ? 'late' : d <= -3 ? 'early' : 'ok';
        html += `<span class="cc-now">지금 ${idx + 1}번 · 예정 ${hm(pm[idx])}</span><span class="cc-delay ${cls}">${d > 0 ? d + '분 늦음' : d < 0 ? -d + '분 이름' : '제시간'}</span>`;
      } else if (nowMin < pm[0]) {
        html += `<span class="cc-now">시작까지 ${Math.ceil(pm[0] - nowMin)}분</span>`;
      }
    } else html += '<span class="muted">예배 시작 시각과 순서마다 예정 시간(분)을 넣으면 진행 시계가 나옵니다</span>';
    if (el.dataset.html !== html) {
      if (el.contains(document.activeElement)) return; // 시각 입력 중이면 다시 그리지 않음
      el.dataset.html = html;
      el.innerHTML = html;
      $('#ccStart').onchange = e => { st.cue.startTime = e.target.value; save(); renderClock(); };
    }
  }
  setInterval(() => { noteLive(); renderClock(); }, 5000);

  // ---------------- 찬송가 ----------------
  async function hymnMeta(it) {
    if (st.hymnMeta.has(it.file)) return st.hymnMeta.get(it.file);
    const r = await cmd('loadHymn', { file: it.file });
    if (!r.ok) throw new Error(r.error);
    st.hymnMeta.set(it.file, r.result);
    return r.result;
  }

  /** 찬송가 배경: 항목 설정 → (기본값이면) 전체 설정 → 원래 배경 / 템플릿 배경('') / 이미지 */
  function hymnBg(it, meta) {
    let b = it.background || 'default';
    if (b === 'default') b = app.state.settings.hymnBackground || 'original';
    if (b === 'original') return meta.background || '';
    if (b === 'template') return '';
    return b;
  }

  /** OBS 자막(가사만)용 슬라이드별 가사: 직접 입력 → 자동(PPT 글자·새찬송가 가사 DB) */
  function hymnCaptions(it, meta) {
    if (it.obsLyrics && it.obsLyrics.trim()) return SL.lyricsChunks(it.obsLyrics).map(c => c.text);
    return meta.captions || [];
  }

  // ---------------- 미리보기·송출 ----------------
  function textPseudo(it) { return { title: it.title, versionName: '', verses: [], book: null }; }

  /** 항목 → 미리보기. fromEnd 면 마지막 슬라이드에 둔다. keepIndex 면 보던 슬라이드 유지 */
  async function previewItem(i, { fromEnd = false, keepIndex = false } = {}) {
    if (!st.cue || i < 0 || i >= st.cue.items.length) return false;
    const it = st.cue.items[i];
    const prevIdx = keepIndex && app.preview && app.preview.cue && app.preview.cue.index === i ? app.preview.index : 0;
    st.sel = i;
    const cue = { id: st.cue.id, index: i, title: it.title, note: it.note || '', type: it.type, credit: it.credit || '', ...(it.autoSec >= 2 ? { auto: { sec: it.autoSec, loop: !!it.autoLoop } } : {}) };
    const tpl = itemTpl(it);
    if (it.type === 'audio') { // 음악: 화면은 그대로, 가운데에 정보만
      showAudioInfo(i, it);
      render(); renderEditor();
      return true;
    }
    if (it.type === 'song' && it.songId) await syncSong(it);
    if (it.type === 'bible') {
      if (!it.ref) { app.showMsg('장절을 입력하세요.', 'info', 2000); render(); renderEditor(); return false; }
      const r = await cmd('searchReference', { query: it.ref, versionId: it.versionId || undefined });
      if (!r.ok) { app.showMsg(`${i + 1}번 '${it.title}': ${r.error}`, 'error', 5000); render(); renderEditor(); return false; }
      const passage = r.result.passage;
      const count = decorate(it, SL.build(passage, app.splitOpts(tpl))).length;
      await app.loadPassage(passage, { query: it.ref, index: fromEnd ? count - 1 : Math.min(prevIdx, count - 1), tpl, bg: it.bg || '', post: slides => decorate(it, slides) });
      app.preview.cue = cue; if (window.BCGrid) window.BCGrid.update(); // 큐시트 순서로 다시 (썸네일 ＋ ✕ 단추)
      $('#resultTitle').textContent = `${i + 1}. ${it.title} — ${passage.title}`;
    } else {
      let meta = null;
      if (it.type === 'hymn') {
        try { meta = await hymnMeta(it); } catch (e) { app.showMsg(`${i + 1}번 '${it.title}': ${e.message}`, 'error', 6000); render(); renderEditor(); return false; }
      }
      const build = () => buildSlides(it, meta);
      const slides = build();
      await app.loadSlides(textPseudo(it), slides, { query: it.title, index: fromEnd ? slides.length - 1 : prevIdx, cue, rebuild: build, tpl });
      showSlideList(i, it);
    }
    render();
    renderEditor();
    return true;
  }

  function buildSlides(it, meta, { withSkipped = false, raw = false } = {}) {
    const opts = app.splitOpts(itemTpl(it));
    let slides = [];
    if (it.type === 'hymn' && meta) {
      const bg = hymnBg(it, meta);
      const cap = hymnCaptions(it, meta);
      if (meta.slides && meta.slides.length) { // PowerPoint 로 만든 '화면 그대로' 슬라이드
        slides = meta.slides.map((img, k) => ({ kind: 'image', image: img, ref: it.title, label: String(k + 1), parts: [], caption: cap[k] || '' }));
      } else if (meta.scores.length) {
        slides = meta.scores.map((img, k) => ({ kind: 'score', image: img, bg, ref: it.title, label: String(k + 1), parts: [], caption: cap[k] || '' }));
      } else if (meta.texts.some(t => t.length)) { // 교독문 등 글자 슬라이드
        slides = SL.buildText({ title: it.title, showTitle: false, chunks: meta.texts.map((t, k) => ({ label: String(k + 1), text: t.join('\n') })) }, opts);
        slides.forEach(s => { s.bg = bg; });
      }
    }
    else if (it.type === 'song') slides = SL.buildText({ title: it.title, showTitle: it.showTitle, chunks: SL.arrange(SL.lyricsChunks(it.lyrics), songOrder(it)).chunks }, opts);
    else if (it.type === 'text') slides = SL.buildText({ title: it.title, showTitle: true, chunks: SL.textChunks(it.body) }, opts);
    else if (it.type === 'image' && it.image) slides = [it.score ? { kind: 'score', image: it.image, bg: it.scoreBg || '#ffffff', ref: it.title, label: '악보', parts: [] } : { kind: 'image', image: it.image, ref: it.title, label: '이미지', parts: [] }];
    else if (it.type === 'camera') slides = [{ kind: 'camera', camera: { deviceId: it.deviceId || '', label: it.label || '', fit: it.fit || 'cover' }, ref: it.title, label: '카메라', parts: [] }];
    else if (it.type === 'slideshow') {
      // 그림들 + 광고 글 (--- 로 나눔). 하나도 없으면 배경만 (카운트다운만 띄울 때)
      slides = (it.images || []).map((img, k) => ({ kind: 'image', image: img, ref: it.title, label: `그림 ${k + 1}`, parts: [] }));
      if ((it.body || '').trim()) slides.push(...SL.buildText({ title: it.title, showTitle: false, chunks: SL.textChunks(it.body) }, opts));
      if (!slides.length) slides = [{ kind: 'blank', mode: 'background', ref: it.title, label: '배경', parts: [] }];
      if (it.countdown) slides.forEach(s => { s.countdown = { target: it.countdown, label: it.countdownLabel || '예배 시작까지' }; });
    }
    else if (it.type === 'video' && it.file) slides = [{ kind: 'video', image: it.file, ref: it.title, label: '영상', parts: [], caption: '', video: { volume: it.volume ?? 1, sound: it.sound !== false, loop: !!it.loop, endAction: it.endAction || 'hold' } }];
    else if (it.type === 'blank') slides = [{ kind: 'blank', mode: it.mode, ref: it.title, label: it.mode === 'background' ? '배경' : '검은 화면', parts: [] }];
    // 제목 카드, 또는 내용이 비어 있으면 제목만
    else if (it.type === 'title') slides = SL.titlePages(it).map((p, k) => SL.titleSlide(p, k));
    if (!slides.length) slides = [{ kind: 'title', ref: it.title, subtitle: it.subtitle || '', label: '제목', parts: [], src: 0 }];
    // 순서별 배경 이미지 (글자 슬라이드)
    if (it.bg) slides.forEach(s => { if (s.kind === 'text' || s.kind === 'title') s.bg = it.bg; });
    // 곡 정보 (작사·작곡·저작권): 첫·마지막 슬라이드 아래에 작게
    if (it.type === 'song' && it.creditShow) {
      const credit = (it.credit || (it.songId && st.songs.get(it.songId) ? st.songs.get(it.songId).credit : '') || '').trim();
      const txt = slides.filter(s => s.kind === 'text');
      if (credit && txt.length) {
        if (it.creditShow === 'first' || it.creditShow === 'both') txt[0].footer = credit;
        if (it.creditShow === 'last' || it.creditShow === 'both') txt[txt.length - 1].footer = credit;
      }
    }
    return raw ? slides : decorate(it, slides, { withSkipped });
  }

  /**
   * 슬라이드 꾸미기 (모든 순서): 글상자 위치·꾸미기·덧붙인 것·슬라이드 배경
   * 찬양·공지·제목: 슬라이드 키 = 가사·글 덩어리 번호(src)
   * 그 밖(성경·찬송가·그림·영상·슬라이드쇼·카메라·빈 화면): 키 = 슬라이드 번호, 덧붙인 제목 카드 = 'x'+id, 건너뛰기(skip)
   */
  function decorate(it, slides, { withSkipped = false, noEdits = false } = {}) {
    const chunk = ['song', 'text', 'title'].includes(it.type);
    let out = slides;
    if (chunk) slides.forEach(s => { s.ekey = String(s.src ?? 0); if (s.src == null) s.src = 0; });
    else {
      slides.forEach((s, k) => { s.ekey = String(k); s.base = k; });
      const skip = new Set(it.skip || []);
      out = [];
      const extraAt = at => (it.extra || []).filter(e => e.at === at).map(e => SL.titleSlide(e.text, 1, { label: '덧붙임', ekey: 'x' + e.id, xid: e.id, src: undefined }));
      out.push(...extraAt(-1));
      slides.forEach((s, k) => {
        if (skip.has(k)) { if (withSkipped) out.push(Object.assign(s, { skipped: true })); } else out.push(s);
        out.push(...extraAt(k));
      });
      const last = slides.length - 1;
      out.push(...(it.extra || []).filter(e => e.at > last).map(e => SL.titleSlide(e.text, 1, { label: '덧붙임', ekey: 'x' + e.id, xid: e.id, src: undefined })));
      if (!out.some(s => !s.skipped) && !withSkipped) out = slides.slice(0, 1); // 다 건너뛰면 첫 장만
    }
    if (it.edits && !noEdits) out.forEach(s => {
      const e = SL.mergeEdit(it.edits, s.ekey);
      if (!e) return;
      if (e.bg) s.bg = e.bg;
      delete e.bg;
      s.edit = e;
    });
    return out;
  }
  /** 슬라이드 편집기용: 꾸미기 전 원래 슬라이드 (성경은 본문을 찾아서) */
  async function editorBase(i) {
    const it = st.cue && st.cue.items[i];
    if (!it) return [];
    if (it.type === 'bible') {
      if (!it.ref) return [];
      const r = await cmd('searchReference', { query: it.ref, versionId: it.versionId || undefined });
      if (!r.ok) return [];
      const passage = app.withParallel ? await app.withParallel(r.result.passage) : r.result.passage;
      return SL.build(passage, app.splitOpts(itemTpl(it))).map(s => (it.bg ? { ...s, bg: it.bg } : s));
    }
    let meta = null;
    if (it.type === 'hymn') { try { meta = await hymnMeta(it); } catch { return []; } }
    return buildSlides(it, meta, { raw: true });
  }

  /** 부를 순서: 이 순서에 적은 것 → (라이브러리 찬양이면) 라이브러리의 기본 순서 */
  function songOrder(it) {
    if (it.order && it.order.trim()) return it.order;
    const s = it.songId && st.songs.get(it.songId);
    return s ? s.arrangement || '' : '';
  }

  // ---------------- 찬양 라이브러리 연결 ----------------
  /** 라이브러리 찬양의 최신 가사를 이 순서에 반영 */
  async function syncSong(it) {
    if (st.songPending === it.songId) return; // 고친 가사를 라이브러리에 저장하는 중 (덮어쓰지 않음)
    const r = await cmd('getSong', { id: it.songId });
    if (st.songPending === it.songId) return;
    if (!r.ok) return;
    st.songs.set(it.songId, r.result);
    if (it.lyrics !== r.result.lyrics) { it.lyrics = r.result.lyrics; save(); }
  }
  /** 연결된 찬양의 가사를 고치면 라이브러리에도 저장 (모든 큐시트에 반영) */
  function saveLinkedSong(it) {
    clearTimeout(st.songTimer);
    st.songPending = it.songId;
    st.songTimer = setTimeout(async () => {
      const s = st.songs.get(it.songId) || {};
      const r = await cmd('saveSong', { song: { ...s, id: it.songId, title: s.title || it.title, lyrics: it.lyrics } });
      if (r.ok) st.songs.set(it.songId, r.result);
      if (st.songPending === it.songId) st.songPending = null;
    }, 600);
  }

  /** 카메라 고르기 (목록 + 미리보기) */
  async function pickCam(done) {
    let devs = [];
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      s.getTracks().forEach(x => x.stop());
      devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    } catch (e) { return app.showMsg('카메라를 찾지 못했습니다: ' + e.message, 'error', 4000); }
    if (!devs.length) return app.showMsg('연결된 카메라(웹캠·캡처보드)가 없습니다.', 'error', 3000);
    app.openModal('📷 카메라 고르기', `<div class="cam-pick"><div class="cam-list">${devs.map((d, k) => `<button type="button" class="cam-item" data-k="${k}"><video muted autoplay playsinline data-cam="${esc(d.deviceId)}"></video><span>${esc(d.label || '카메라 ' + (k + 1))}</span></button>`).join('')}</div></div>`);
    document.querySelectorAll('.cam-item video').forEach(v => window.BCRender.cameraStream(v.dataset.cam).then(s => { v.srcObject = s; }).catch(() => {}));
    document.querySelectorAll('.cam-item').forEach(b => b.onclick = () => { const d = devs[+b.dataset.k]; app.closeModal(); done({ deviceId: d.deviceId, label: d.label || '카메라' }); });
  }

  // ---------------- 송출할 때 자동으로 (⑤) ----------------
  /** 편집칸: 배경 음악 + 송출할 때 할 일 */
  function actionsHtml(it) {
    const a = it.actions || {};
    const ovs = (app.state.settings.overlays || []);
    const n = Object.keys(a).length + (it.music ? 1 : 0);
    const ovSel = (k, extra) => `<select data-a="${k}"><option value="">—</option>${extra || ''}${ovs.map(o => `<option value="${esc(o.id)}" ${a[k] === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
    return `<label>배경 음악</label><div class="ce-row">${it.music ? `🔊 ${esc(fileName(it.music))} <input type="range" data-a="musicVolume" min="0" max="1" step="0.05" value="${it.musicVolume ?? 0.8}" title="소리 크기" style="width:90px"><button data-act="musicclear">빼기</button>` : '<span class="muted">없음</span>'}<button data-act="musicpick">🔊 ${it.music ? '바꾸기' : '고르기'}…</button><span class="note">송출하면 반복 재생, 다른 화면을 송출하면 서서히 꺼짐</span></div>
      <label>자동 동작</label><div class="ce-col"><div class="ce-row"><button data-act="actmore" class="${n ? 'on' : ''}">⚡ 송출할 때 자동으로${n ? ` (${n})` : ''} ${st.actOpen ? '▴' : '▾'}</button><span class="note">${actSummary(it) || '타이머 시작 · 무대 메시지 · 로고 화면 · 배경 · 오버레이 · 음악 멈춤'}</span></div>
      ${st.actOpen ? `<div class="act-grid">
        <label>설교 타이머</label><div class="ce-row"><input type="number" data-a="timer" min="0" max="240" value="${a.timer || ''}" placeholder="0" style="width:70px"> 분 시작 <span class="note">0 = 안 함</span></div>
        <label>무대 메시지</label><div class="ce-row"><input type="text" data-a="stageMsg" value="${esc(a.stageMsg || '')}" placeholder="예: 설교 시작 — 휴대폰을 무음으로" style="flex:1"><label class="tc-toggle"><input type="checkbox" data-a="clearStage" ${a.clearStage ? 'checked' : ''}> 메시지 지우기</label></div>
        <label>로고 화면</label><div class="ce-row"><select data-a="logo"><option value="">그대로</option><option value="on" ${a.logo === 'on' ? 'selected' : ''}>켜기</option><option value="off" ${a.logo === 'off' ? 'selected' : ''}>끄기</option></select>
          배경 <select data-a="bg"><option value="">그대로</option><option value="hide" ${a.bg === 'hide' ? 'selected' : ''}>지우기</option><option value="show" ${a.bg === 'show' ? 'selected' : ''}>다시 보이기</option></select></div>
        <label>오버레이</label><div class="ce-row">켜기 ${ovSel('ovOn')} 끄기 ${ovSel('ovOff', `<option value="*" ${a.ovOff === '*' ? 'selected' : ''}>모두</option>`)}</div>
        <label>음악</label><div class="ce-row"><label class="tc-toggle"><input type="checkbox" data-a="stopMusic" ${a.stopMusic ? 'checked' : ''}> 재생 중인 음악 서서히 멈춤</label></div>
      </div>` : ''}</div>`;
  }
  function actSummary(it) {
    const a = it.actions || {};
    const ovName = id => (id === '*' ? '모두' : ((app.state.settings.overlays || []).find(o => o.id === id) || {}).name || '?');
    return [a.timer && `⏱ 타이머 ${a.timer}분`, a.stageMsg && '💬 무대 메시지', a.clearStage && '메시지 지움', a.logo && `로고 ${a.logo === 'on' ? '켜기' : '끄기'}`, a.bg && `배경 ${a.bg === 'hide' ? '지우기' : '보이기'}`,
      a.ovOn && `오버레이 켜기: ${ovName(a.ovOn)}`, a.ovOff && `오버레이 끄기: ${ovName(a.ovOff)}`, a.stopMusic && '음악 멈춤'].filter(Boolean).join(' · ');
  }
  /** 새로 송출된 순서의 자동 동작 (한 번만 · 방금 송출한 것만) */
  let lastEnter = '';
  function onEnter() {
    const L = app.state && app.state.live;
    if (!L || !L.hasLive || !L.passage || !st.cue || L.passage.cueId !== st.cue.id || L.passage.cueIndex < 0) return;
    const key = `${L.sentAt}|${L.passage.cueIndex}`;
    if (key === lastEnter) return;
    lastEnter = key;
    if (Date.now() - L.sentAt > 4000) return; // 프로그램을 다시 열었을 때 등 (오래전 송출)
    const it = st.cue.items[L.passage.cueIndex];
    if (it) runActions(it);
  }
  function runActions(it) {
    const a = it.actions || {};
    if (it.music && window.BCLib) window.BCLib.audio.play({ url: it.music, title: `${it.title} · 배경 음악`, volume: it.musicVolume ?? 0.8, loop: true, fadeOnLeave: true });
    else if (a.stopMusic && window.BCLib) window.BCLib.audio.fadeOut(2500);
    if (a.timer) cmd('stageTimer', { action: 'start', minutes: a.timer });
    if (a.stageMsg) cmd('stageMessage', { text: a.stageMsg });
    else if (a.clearStage) cmd('stageMessage', { text: '' });
    if (a.logo) cmd('toggleLogoScreen', { on: a.logo === 'on' });
    if (a.bg) cmd('toggleBackground', { on: a.bg === 'hide' });
    if (a.ovOn) cmd('toggleOverlay', { id: a.ovOn, on: true });
    if (a.ovOff === '*') (app.state.settings.overlays || []).filter(o => o.on && o.id !== a.ovOn).forEach(o => cmd('toggleOverlay', { id: o.id, on: false }));
    else if (a.ovOff) cmd('toggleOverlay', { id: a.ovOff, on: false });
    const s = actSummary(it);
    if (s || it.music) app.showMsg(`⚡ ${it.title}: ${[it.music && '배경 음악', s].filter(Boolean).join(' · ')}`, 'info', 2500);
  }

  // ---------------- 음악 순서 ----------------
  const fileName = url => decodeURIComponent(String(url).split('p=').pop()).split(/[\\/]/).pop();
  function showAudioInfo(i, it) {
    app.results = { type: 'none', items: [], sel: -1 };
    $('#resultTitle').textContent = `${i + 1}. ${it.title}`;
    $('#resultInfo').textContent = '음악 · 화면은 바뀌지 않습니다';
    $('#results').innerHTML = `<div class="empty">🔊 ${esc(it.file ? fileName(it.file) : '(음악 파일을 고르세요)')}<br>
      <span class="muted">더블클릭·F9: 재생 · 화면 송출은 그대로 · 큐시트에서 F6 으로 이 순서에 오면 재생하고 다음 화면 순서로 넘어갑니다</span><br>
      <button data-play="${i}" class="primary">▶ 재생</button> <button data-stop="1">■ 정지</button> <button data-fade="1">페이드아웃</button></div>`;
    $('#results [data-play]').onclick = () => playAudio(it);
    $('#results [data-stop]').onclick = () => window.BCLib && window.BCLib.audio.stop();
    $('#results [data-fade]').onclick = () => window.BCLib && window.BCLib.audio.fadeOut(2500);
  }
  function playAudio(it) {
    if (!it.file) return app.showMsg('음악 파일을 고르세요 (편집칸의 \'음악 고르기\').', 'info', 3000);
    if (window.BCLib) window.BCLib.audio.play({ url: it.file, title: it.title, volume: it.volume ?? 1, loop: !!it.loop, fadeOnLeave: it.fadeOnLeave !== false });
  }

  /** 가운데: 이 항목의 슬라이드 목록 (클릭: 그 슬라이드 미리보기 · 더블클릭: 송출) */
  function showSlideList(i, it) {
    app.results = { type: 'none', items: [], sel: -1 };
    $('#resultTitle').textContent = `${i + 1}. ${it.title}`;
    $('#resultInfo').textContent = `${TYPE[it.type]} · 슬라이드 ${app.preview.slides.length}장`;
    $('#results').innerHTML = app.preview.slides.map((s, k) => {
      const body = s.kind === 'score' || (s.kind === 'image' && it.type === 'hymn') ? `<span class="sboth"><img class="sthumb" src="${esc(s.image)}" alt=""><span class="scap">${s.caption ? esc(s.caption) : '<span class="muted">(가사 없음 — 편집칸의 OBS 가사에 입력)</span>'}</span></span>`
        : esc(s.kind === 'text' ? window.BCGroup.stripFmt(s.parts[0].text) : s.kind === 'title' ? [s.ref, s.subtitle].filter(Boolean).join('\n') : s.kind === 'image' ? '🖼 이미지' : s.kind === 'video' ? '🎬 영상' : '⬛ ' + (s.mode === 'background' ? '배경·로고만' : '검은 화면'));
      const gc = s.kind !== 'bible' && window.BCGroup ? window.BCGroup.color(s.label) : '';
      return `<div class="srow ${k === app.preview.index ? 'in-pv' : ''}" data-k="${k}"${gc ? ` style="--gc:${gc}"` : ''}><span class="vn">${esc(s.label || String(k + 1))}</span><span class="stext">${body}</span></div>`;
    }).join('');
    if (window.BCSlideEdit) window.BCSlideEdit.paintSel();
  }
  $('#results').addEventListener('click', e => {
    const r = e.target.closest('.srow');
    if (!r || !app.preview) return;
    if (window.BCSlideEdit && window.BCSlideEdit.selClick(+r.dataset.k, e)) return; // Shift·Ctrl·끌기: 여러 장 고르기
    app.setPreviewIndex(+r.dataset.k);
    document.querySelectorAll('#results .srow').forEach(x => x.classList.toggle('in-pv', x === r));
  });
  $('#results').addEventListener('dblclick', e => {
    const r = e.target.closest('.srow');
    if (r && app.preview) { app.setPreviewIndex(+r.dataset.k); app.sendPreview(); }
  });

  /** 큐시트 목록에서 고르기: 미리보기만 하고 예배당·OBS 화면에는 내보내지 않는다 ('미리보기 끄기' 모드여도) */
  async function quietPreview(i) {
    app.holdDirect = (app.holdDirect || 0) + 1;
    try { return await previewItem(i); } finally { app.holdDirect--; }
  }

  async function sendItem(i) {
    const it = st.cue && st.cue.items[i];
    if (it && it.type === 'audio') { st.sel = i; render(); renderEditor(); playAudio(it); return; }
    if (await previewItem(i)) await app.sendPreview();
  }

  /** 송출 중 항목의 끝에서 F6/F5 → 다음/이전 순서 */
  async function onCueNext({ dir, version, cueId, index }) {
    if (!st.cue || st.cue.id !== cueId) { await openCue(cueId); }
    let next = index + dir;
    // 음악 순서는 재생만 하고 다음 화면 순서로 (뒤로 갈 때는 건너뜀)
    while (next >= 0 && next < st.cue.items.length && st.cue.items[next].type === 'audio') {
      if (dir > 0) playAudio(st.cue.items[next]);
      next += dir;
    }
    if (next < 0 || next >= st.cue.items.length) { app.showMsg(dir > 0 ? '큐시트의 마지막 순서입니다.' : '큐시트의 첫 순서입니다.', 'info', 2000); return; }
    if (app.state.live.version !== version) return; // 그 사이 다른 송출이 있었으면 무시
    if (await previewItem(next, { fromEnd: dir < 0 })) await app.sendPreview();
  }

  // ---------------- 가운데 편집칸: 고른 순서를 바로 고친다 ----------------
  function renderEditor() {
    const box = $('#cueEditor');
    const it = st.cue && st.sel >= 0 ? st.cue.items[st.sel] : null;
    const cueTab = !$('#cuePanel').hidden;
    drawEditorToggle();
    if (!it || !cueTab || !editorOn) { box.hidden = true; box.dataset.id = ''; return; }
    // 같은 항목을 고치는 중이면 다시 그리지 않는다 (입력 중 커서가 튀지 않도록)
    if (box.dataset.id === it.id && !box.hidden && box.contains(document.activeElement)) return;
    box.hidden = false;
    box.dataset.id = it.id;
    const i = st.sel;
    const vs = app.state.versions;
    const hymnBgSel = () => {
      const b = it.background || 'default';
      const custom = !['default', 'original', 'template', '#ffffff'].includes(b);
      return `<select data-k="background">
          <option value="default" ${b === 'default' ? 'selected' : ''}>기본값 (${{ original: '원래 배경', template: '템플릿 배경', '#ffffff': '흰 배경' }[app.state.settings.hymnBackground || 'original'] || '지정 이미지'})</option>
          <option value="original" ${b === 'original' ? 'selected' : ''}>찬송가 원래 배경</option>
          <option value="#ffffff" ${b === '#ffffff' ? 'selected' : ''}>흰 배경 (악보가 가장 잘 보임)</option>
          <option value="template" ${b === 'template' ? 'selected' : ''}>템플릿 배경 (테마·빠른 설정의 배경)</option>
          ${custom ? `<option value="${esc(b)}" selected>지정한 이미지</option>` : ''}
        </select><button data-act="bgimg">🖼 다른 이미지…</button>`;
    };
    const fields = {
      hymn: `<label>파일</label><div class="ce-row"><span class="muted ce-file">${esc((it.file || '').split(/[\\/]/).pop())}</span><button data-act="rehymn">다른 찬송가로 바꾸기</button></div>
        <label>OBS 가사</label><div class="ce-col"><textarea data-k="obsLyrics" rows="3" placeholder="${esc(obsHint(it))}">${esc(it.obsLyrics || '')}</textarea>
          <div class="ce-row note">OBS 자막처럼 'PPT 슬라이드: 가사만'인 출력에 나옵니다. 슬라이드마다 빈 줄로 구분 · 비우면 자동 <button data-act="obsfill" title="자동 가사를 칸에 넣어 직접 고칠 수 있게">자동 가사 넣어 고치기</button></div></div>
        <label>배경</label><div class="ce-row">${(st.hymnMeta.get(it.file) || {}).mode === 'slides' ? '<span class="muted">PPT 화면 그대로 송출합니다 (배경 바꾸기 없음). 폴더 읽는 방식을 \'자동\'으로 바꾸면 악보·배경을 나눠 꺼낼 수 있습니다.</span>' : hymnBgSel()}</div>`,
      bible: `<label>장절</label><div class="ce-row"><input type="text" data-k="ref" value="${esc(it.ref || '')}" placeholder="예: 롬 8:18-25 · 시 23" style="flex:1"><select data-k="versionId"><option value="">현재 번역본</option>${vs.map(v => `<option value="${esc(v.id)}" ${it.versionId === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div><span></span><div id="ceRefMsg" class="note"></div>`,
      video: `<label>영상</label><div class="ce-row">${it.file ? thumbTag(it.file) : ''}<span class="muted ce-file">${esc(it.file ? fileName(it.file) : '(고르지 않음)')}</span><button data-act="videopick">🎬 영상 고르기…</button></div>
        <label>소리</label><div class="ce-row"><label class="tc-toggle"><input type="checkbox" data-k="sound" ${it.sound !== false ? 'checked' : ''}> 소리 켜기 (예배당 화면 창에서 재생)</label><input type="range" data-k="volume" min="0" max="1" step="0.05" value="${it.volume ?? 1}" style="flex:1"></div>
        <label>재생</label><div class="ce-row"><label class="tc-toggle"><input type="checkbox" data-k="loop" ${it.loop ? 'checked' : ''}> 반복</label>
          <select data-k="endAction" title="영상이 끝나면"><option value="hold" ${(it.endAction || 'hold') === 'hold' ? 'selected' : ''}>끝나면: 마지막 장면에서 멈춤</option><option value="black" ${it.endAction === 'black' ? 'selected' : ''}>끝나면: 화면 숨김</option><option value="next" ${it.endAction === 'next' ? 'selected' : ''}>끝나면: 다음 순서 송출</option></select></div>`,
      audio: `<label>음악</label><div class="ce-row"><span class="muted ce-file">${esc(it.file ? fileName(it.file) : '(고르지 않음)')}</span><button data-act="audiopick">🔊 음악 고르기…</button><button data-act="audioplay">▶</button><button data-act="audiostop">■</button></div>
        <label>소리 크기</label><div class="ce-row"><input type="range" data-k="volume" min="0" max="1" step="0.05" value="${it.volume ?? 1}" style="flex:1"><label class="tc-toggle"><input type="checkbox" data-k="loop" ${it.loop ? 'checked' : ''}> 반복</label><label class="tc-toggle"><input type="checkbox" data-k="fadeOnLeave" ${it.fadeOnLeave !== false ? 'checked' : ''}> 다른 화면을 송출하면 페이드아웃</label></div>`,
      song: `<label>웹</label><div class="ce-row"><button data-act="weblyrics" class="${(it.lyrics || '').trim() ? '' : 'primary'}" title="이 순서의 제목으로 벅스·지니·멜론에서 찾아 가사·부를 순서를 채웁니다 (Ctrl+L)">🌐 웹에서 가사 찾기</button><span class="muted">제목으로 찾아 이 순서에 바로 넣습니다</span></div>
        ${it.songId ? `<label>라이브러리</label><div class="ce-row note">📚 라이브러리 찬양과 연결됨 — 가사를 고치면 이 찬양을 쓰는 모든 큐시트에 반영 <button data-act="unlink">연결 끊기</button></div>` : `<label>라이브러리</label><div class="ce-row note"><button data-act="tolib">📚 라이브러리에 저장</button> 저장하면 다음 주에도 검색해서 바로 넣을 수 있습니다</div>`}
        <label>가사</label><textarea data-k="lyrics" data-fmt rows="7" placeholder="[1절]&#10;첫째 줄&#10;둘째 줄&#10;&#10;[후렴]&#10;…">${esc(it.lyrics || '')}</textarea>
        <span></span><div class="ce-row note"><label class="tc-toggle"><input type="checkbox" data-k="showTitle" ${it.showTitle ? 'checked' : ''}> 화면에 제목 표시</label> · 빈 줄 = 다음 슬라이드 · [1절] 줄은 슬라이드 이름</div>
        <span></span><div class="ce-row note">${window.BCFmt ? window.BCFmt.bar() : ''}</div>
        <label>곡 정보</label><div class="ce-row"><input type="text" data-k="credit" value="${esc(it.credit || '')}" placeholder="${esc((it.songId && st.songs.get(it.songId) && st.songs.get(it.songId).credit) || '작사·작곡 · 저작권 (예: 작사 홍길동 · 작곡 김철수 · CCLI 1234567)')}" style="flex:1"><select data-k="creditShow" title="곡 정보를 화면 아래에 작게 보이기"><option value="" ${!it.creditShow ? 'selected' : ''}>보이지 않기</option><option value="first" ${it.creditShow === 'first' ? 'selected' : ''}>첫 슬라이드에</option><option value="last" ${it.creditShow === 'last' ? 'selected' : ''}>마지막 슬라이드에</option><option value="both" ${it.creditShow === 'both' ? 'selected' : ''}>처음과 끝에</option></select></div>
        <label>부를 순서</label><div class="ce-col"><input type="text" data-k="order" value="${esc(it.order || '')}" placeholder="${esc(songOrder({ ...it, order: '' }) || '비우면 가사 순서대로 · 예: 1절 후렴 2절 후렴 후렴 (또는 1 C 2 C C)')}">
          <div class="ce-row ce-chips">${SL.lyricGroups(SL.lyricsChunks(it.lyrics)).filter(g => g.label).map(g => `<button type="button" data-chip="${esc(g.label)}" title="부를 순서 끝에 넣기">${esc(g.label)}</button>`).join('')}<button type="button" data-chip="" title="부를 순서 지우기 (가사 순서대로)">지우기</button><span id="ceOrderMsg" class="note"></span></div></div>`,
      text: `<label>내용</label><textarea data-k="body" data-fmt rows="6" placeholder="광고 내용…&#10;---&#10;다음 장">${esc(it.body || '')}</textarea><span></span><div class="ce-row note">${window.BCFmt ? window.BCFmt.bar() : ''}<span>'---' 줄 = 다음 슬라이드</span></div>`,
      title: `<label>부제</label><input type="text" data-k="subtitle" value="${esc(it.subtitle || '')}" placeholder="예: 홍길동 집사 · 설교 제목 · 본문">
        <label>추가 슬라이드</label><textarea data-k="more" rows="${it.more ? 3 : 1}" placeholder="다음 슬라이드 (첫 줄 = 제목, 둘째 줄 = 부제) · '---' 줄로 또 다음 · 비우면 한 장">${esc(it.more || '')}</textarea>`,
      image: `<label>이미지</label><div class="ce-row">${it.image ? thumbTag(it.image) : ''}<button data-act="image">🖼 ${it.image ? '바꾸기' : '고르기'}</button></div>`,
      camera: `<label>카메라</label><div class="ce-row"><span>${window.BCIcon('camera')} ${esc(it.label || '(고르세요)')}</span><button data-act="campick">바꾸기…</button><select data-k="fit"><option value="cover" ${it.fit !== 'contain' ? 'selected' : ''}>화면 채우기</option><option value="contain" ${it.fit === 'contain' ? 'selected' : ''}>전체 보이기</option></select><span class="note">라이브러리 '📷 카메라' 탭에서 고를 수도 있습니다</span></div>`,
      slideshow: `<label>그림</label><div class="ce-col"><div class="ss-list">${(it.images || []).map((u, k) => `<span class="ss-img" title="${esc(fileName(u))}">${thumbTag(u)}<span class="ss-act"><button data-ssleft="${k}" title="앞으로">◀</button><button data-ssdel="${k}" title="빼기">✕</button></span></span>`).join('') || '<span class="muted">아직 그림이 없습니다</span>'}</div>
          <div class="ce-row"><button data-act="ssadd">🖼 그림 추가…</button><span class="note">탐색기에서 그림 여러 장을 이 칸에 끌어다 놓아도 됩니다 (광고 PPT 는 그림으로 저장해서)</span></div></div>
        <label>광고 글</label><textarea data-k="body" rows="3" placeholder="그림 뒤에 이어서 나갈 글 (--- 줄로 다음 장) · 비워도 됩니다">${esc(it.body || '')}</textarea>
        <label>카운트다운</label><div class="ce-row"><input type="time" data-k="countdown" value="${esc(it.countdown || '')}"> 까지 <input type="text" data-k="countdownLabel" value="${esc(it.countdownLabel || '')}" placeholder="예배 시작까지" style="flex:1"><span class="note">시각을 비우면 카운트다운 없음</span></div>`,
      blank: `<label>화면</label><select data-k="mode"><option value="black" ${it.mode !== 'background' ? 'selected' : ''}>검은 화면 (로고도 숨김)</option><option value="background" ${it.mode === 'background' ? 'selected' : ''}>배경·로고만 보이기</option></select>`,
    }[it.type];
    box.innerHTML = `<div class="ce-head"><span class="ce-ico">${ICON[it.type]}</span><b>${i + 1}번 ${TYPE[it.type]}</b>
        <span class="grow"></span><span id="cueSaved" class="muted"></span>
        <button data-act="up" title="위로 (Alt+↑)">▲</button><button data-act="down" title="아래로 (Alt+↓)">▼</button>
        ${it.type !== 'audio' ? '<button data-act="slideedit" class="primary" title="슬라이드마다 글상자 위치·꾸미기, 글·그림·도형 덧붙이기 (Ctrl+E)">' + window.BCIcon('square-pen') + '슬라이드 편집</button>' : ''}
        <button data-act="dup" title="이 순서 복제">복제</button><button data-act="del" title="이 순서 지우기 (Delete)">지우기</button>
        <button data-act="close" title="편집칸 닫기">✕</button></div>
      <div class="form ce-form">
        <label>제목</label><input type="text" data-k="title" value="${esc(it.title)}">
        ${fields}
        ${['song', 'text', 'title', 'bible'].includes(it.type) ? `<label>배경</label><div class="ce-row">${it.bg ? thumbTag(it.bg) : '<span class="muted">템플릿 배경</span>'}<button data-act="itembg">${window.BCIcon('image')}이미지·영상 고르기…</button>${it.bg ? '<button data-act="itembgclear">지우기</button>' : ''}</div>` : ''}
        ${it.type !== 'audio' ? `<label>테마</label><div class="ce-row"><select data-theme title="이 순서에만 다른 테마 (예배당·OBS 템플릿을 함께 바꿈)"><option value="">기본 (전체 설정 따름)</option>${themeOf(it) === 'custom' ? '<option value="custom" selected>직접 고른 템플릿 (아래)</option>' : ''}${themeList.map(t => `<option value="${esc(t.id)}" ${themeOf(it) === t.id ? 'selected' : ''}>🎨 ${esc(t.name)}</option>`).join('')}</select></div>` : ''}
        ${it.type !== 'audio' ? `<label>템플릿</label><div class="ce-row">${tplSelect('tplMain', '예배당', it.tplMain)}${tplSelect('tplOverlay', 'OBS', it.tplOverlay)}</div>` : ''}
        ${it.type !== 'audio' && it.type !== 'video' ? `<label>자동 넘김</label><div class="ce-row"><input type="number" data-k="autoSec" min="0" max="3600" value="${it.autoSec || ''}" placeholder="0" style="width:80px"> 초마다 <label class="tc-toggle"><input type="checkbox" data-k="autoLoop" ${it.autoLoop ? 'checked' : ''}> 끝나면 처음부터 반복</label><span class="note">0 = 끔 (F6 으로 넘김) · 숨김(F10) 중에는 멈춤</span></div>` : ''}
        ${it.type !== 'audio' ? actionsHtml(it) : ''}
        ${timesOn() ? `<label>예정 시간</label><div class="ce-row"><input type="number" data-k="duration" min="0" max="600" value="${it.duration || ''}" placeholder="0" style="width:80px"> 분 <span class="note">${planTimes()[i] ? '예정 시작 ' + planTimes()[i] : '큐시트 위 ⏰ 에 예배 시작 시각을 넣으면 순서마다 예정 시각이 계산됩니다'}</span></div>` : ''}
        <label>메모</label><input type="text" data-k="note" value="${esc(it.note || '')}" placeholder="조작자만 보는 메모 (예: 설교 후 바로)">
      </div>`;
    if (it.type === 'bible') checkRef(it);
    if (it.type === 'song') showOrderMsg(it);
  }

  /** 편집칸 썸네일 (영상이면 첫 장면) */
  const thumbTag = url => (String(url).startsWith('camera:') ? '<span class="ce-thumb cam-th">📷 카메라</span>' : window.BCRender.isVideo(url) ? `<video class="ce-thumb" muted preload="metadata" src="${esc(url)}#t=1"></video>` : `<img class="ce-thumb" src="${esc(url)}" alt="">`);
  function showOrderMsg(it) {
    const m = $('#ceOrderMsg');
    if (!m) return;
    const r = SL.arrange(SL.lyricsChunks(it.lyrics), songOrder(it));
    m.innerHTML = r.missing.length ? `<span class="err-text">가사에 없는 이름: ${esc(r.missing.join(', '))}</span>` : songOrder(it) ? `<span class="ok-text">✓ 슬라이드 ${r.chunks.length}장</span>` : '';
  }
  function tplSelect(k, label, val) {
    const ts = app.state.settings.templates;
    return `<select data-k="${k}" title="이 순서에만 쓸 ${label} 템플릿"><option value="">${label}: 기본 템플릿</option>${ts.map(t => `<option value="${esc(t.id)}" ${t.id === val ? 'selected' : ''}>${label}: ${esc(t.name)}</option>`).join('')}</select>`;
  }

  let refTimer = null;
  function checkRef(it) {
    clearTimeout(refTimer);
    refTimer = setTimeout(async () => {
      const msg = $('#ceRefMsg');
      if (!msg) return;
      if (!it.ref) { msg.textContent = ''; return; }
      const r = await cmd('searchReference', { query: it.ref, versionId: it.versionId || undefined });
      msg.innerHTML = r.ok ? `<span class="ok-text">✓ ${esc(r.result.passage.title)} (${r.result.passage.verses.length}절)</span>` : `<span class="err-text">${esc(r.error)}</span>`;
    }, 250);
  }

  /** 편집칸에서 바꾼 값 반영 → 자동 저장 → (미리보기 중이면) 미리보기 갱신 */
  function editChanged(el) {
    const it = st.cue.items[st.sel];
    if (!it) return;
    const k = el.dataset.k;
    it[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? Number(el.value) : el.value;
    if (it.type === 'song' && it.songId && k === 'lyrics') saveLinkedSong(it);
    if (it.type === 'song' && k === 'order') showOrderMsg(it);
    if (it.type === 'audio' && k === 'volume' && window.BCLib) window.BCLib.audio.setVolumeIf(it.file, it.volume);
    if (k === 'background' || k === 'mode' || k === 'versionId' || k === 'showTitle') { /* 바로 */ }
    $('#cueSaved').textContent = '저장 중…';
    save();
    if (it.type === 'bible' && (k === 'ref' || k === 'versionId')) checkRef(it);
    const i = st.sel;
    clearTimeout(st.editTimer);
    st.editTimer = setTimeout(() => {
      if (app.preview && app.preview.cue && app.preview.cue.index === i) previewItem(i, { keepIndex: true });
    }, el.tagName === 'SELECT' || el.type === 'checkbox' ? 0 : 500);
  }
  $('#cueEditor').addEventListener('input', e => { if (e.target.dataset.k) editChanged(e.target); });
  $('#cueEditor').addEventListener('change', e => { if (e.target.dataset.k && (e.target.tagName === 'SELECT' || e.target.type === 'checkbox')) editChanged(e.target); });
  $('#cueEditor').addEventListener('change', e => { const s = e.target.closest('[data-theme]'); if (s && s.value !== 'custom') setItemTheme(st.sel, s.value); });
  $('#cueEditor').addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.matches('input, textarea')) { e.target.blur(); } });
  $('#cueEditor').addEventListener('click', e => {
    const it = st.cue && st.cue.items[st.sel];
    if (!it || it.type !== 'slideshow') return;
    const d = e.target.closest('[data-ssdel]'), l = e.target.closest('[data-ssleft]');
    if (!d && !l) return;
    const k = +(d || l).dataset[d ? 'ssdel' : 'ssleft'];
    const imgs = [...(it.images || [])];
    if (d) imgs.splice(k, 1); else if (k > 0) [imgs[k - 1], imgs[k]] = [imgs[k], imgs[k - 1]];
    it.images = imgs; save(); forceEditor(); previewItem(st.sel, { keepIndex: true });
  });
  // '송출할 때 자동으로' 칸 (data-a = actions 의 키)
  $('#cueEditor').addEventListener('change', e => {
    const el = e.target.closest('[data-a]');
    const it = st.cue && st.cue.items[st.sel];
    if (!el || !it) return;
    const a = { ...(it.actions || {}) };
    const k = el.dataset.a;
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    if (k === 'musicVolume') { it.musicVolume = v; save(); return; }
    if (!v) delete a[k]; else a[k] = v;
    it.actions = a; save(); forceEditor();
  });
  // 부를 순서 단추: 이름표를 순서 끝에 붙이기 / 지우기
  $('#cueEditor').addEventListener('click', e => {
    const c = e.target.closest('[data-chip]');
    if (!c) return;
    const inp = $('#cueEditor [data-k=order]');
    if (!inp) return;
    inp.value = c.dataset.chip ? (inp.value.trim() + ' ' + c.dataset.chip).trim() : '';
    editChanged(inp);
  });
  $('#cueEditor').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const i = st.sel;
    const it = st.cue.items[i];
    switch (b.dataset.act) {
      case 'close': setEditor(false); app.showMsg('편집칸을 숨겼습니다. 다시 보려면 가운데 위 ✎ 편집칸 단추 · F2 · Ctrl+Shift+E', 'info', 3500); break;
      case 'up': if (i > 0) { moveItem(i, i - 1); st.sel = i - 1; renderEditor(true); } break;
      case 'down': if (i < st.cue.items.length - 1) { moveItem(i, i + 1); st.sel = i + 1; renderEditor(true); } break;
      case 'dup': { const copy = { ...structuredClone(it), id: newId() }; st.cue.items.splice(i + 1, 0, copy); st.sel = i + 1; save(); forceEditor(); break; }
      case 'del': removeItem(i); break;
      case 'campick': pickCam(c => { it.deviceId = c.deviceId; it.label = c.label; if (!it.title || /^📷/.test(it.title) || it.title === TYPE.camera) it.title = '📷 ' + c.label; save(); forceEditor(); render(); previewItem(i, { keepIndex: true }); }); break;
      case 'ssadd': if (window.BCLib) window.BCLib.pickImage(url => { it.images = [...(it.images || []), url]; save(); forceEditor(); previewItem(i, { keepIndex: true }); }); break;
      case 'musicpick': if (window.BCLib) window.BCLib.pickAudio(f => { it.music = f.url; save(); forceEditor(); }); break;
      case 'musicclear': it.music = ''; save(); forceEditor(); break;
      case 'actmore': st.actOpen = !st.actOpen; forceEditor(); break;
      case 'slideedit': if (window.BCSlideEdit) window.BCSlideEdit.open(i); break;
      case 'chip': break;
      case 'videopick': if (window.BCLib) window.BCLib.pickVideo(url => { it.file = url; if (!it.title || it.title === TYPE.video) it.title = fileName(url).replace(/\.[^.]+$/, ''); save(); forceEditor(); render(); previewItem(i); }); break;
      case 'audiopick': if (window.BCLib) window.BCLib.pickAudio(f => { it.file = f.url; if (!it.title || it.title === TYPE.audio) it.title = f.name; save(); forceEditor(); render(); }); break;
      case 'audioplay': playAudio(it); break;
      case 'audiostop': if (window.BCLib) window.BCLib.audio.stop(); break;
      case 'itembg': if (window.BCLib) window.BCLib.pickImage(url => { it.bg = url; save(); forceEditor(); previewItem(i, { keepIndex: true }); }); break;
      case 'weblyrics': webLyrics(i); break;
      case 'itembgclear': it.bg = ''; save(); forceEditor(); previewItem(i, { keepIndex: true }); break;
      case 'tolib': {
        const r = await cmd('saveSong', { song: { title: it.title, lyrics: it.lyrics || '', credit: it.credit || '' } });
        if (!r.ok) { app.showMsg(r.error, 'error'); break; }
        it.songId = r.result.id; st.songs.set(it.songId, r.result); save(); forceEditor();
        app.showMsg(`'${it.title}' 을(를) 찬양 라이브러리에 저장했습니다.`, 'ok', 2500);
        break;
      }
      case 'unlink': it.songId = ''; save(); forceEditor(); app.showMsg('라이브러리와 연결을 끊었습니다. 이 순서의 가사는 따로 고쳐집니다.', 'info', 3000); break;
      case 'image': pickImage(url => { it.image = url; if (!it.title || it.title === TYPE.image) it.title = '이미지'; save(); forceEditor(); previewItem(i); }); break;
      case 'bgimg': pickImage(url => { it.background = url; save(); forceEditor(); previewItem(i, { keepIndex: true }); }); break;
      case 'rehymn': openHymnPicker({ replace: i }); break;
      case 'obsfill': {
        const m = st.hymnMeta.get(it.file);
        const cap = m ? m.captions || [] : [];
        if (!cap.some(Boolean)) { app.showMsg('자동으로 찾은 가사가 없습니다. 직접 입력하세요.', 'info', 3000); break; }
        it.obsLyrics = cap.map((c, k) => `[${k + 1}]\n${c || ''}`).join('\n\n');
        save(); forceEditor(); previewItem(i, { keepIndex: true });
        break;
      }
    }
  });
  function obsHint(it) {
    const m = st.hymnMeta.get(it.file);
    if (!m) return '비우면 자동';
    return m.captionSource ? `비우면 자동: ${m.captionSource}` : '자동 가사 없음 — 슬라이드마다 빈 줄로 구분해 입력하세요';
  }

  function forceEditor() { $('#cueEditor').dataset.id = ''; renderEditor(); }

  // ---------------- 편집칸 보이기·숨기기 (토글) ----------------
  function setEditor(on) {
    editorOn = !!on;
    try { localStorage.setItem('wc-cue-editor', editorOn ? '1' : '0'); } catch { /* 무시 */ }
    forceEditor();
  }
  function drawEditorToggle() {
    let b = $('#ceToggle');
    if (!b) {
      const tabs = $('#centerTabs');
      if (!tabs) return;
      tabs.insertAdjacentHTML('afterend', '<button id="ceToggle" class="ce-toggle" title="큐시트 순서 편집칸 보이기·숨기기 (Ctrl+Shift+E)">' + window.BCIcon('pencil') + '편집칸</button>');
      b = $('#ceToggle');
      b.onclick = () => { setEditor(!editorOn); if (editorOn) focusTitle(); };
    }
    b.classList.toggle('on', editorOn);
    b.hidden = !(st.cue && st.sel >= 0 && !$('#cuePanel').hidden);
  }

  function pickImage(done) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp,image/gif';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const ext = (f.name.match(/\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase();
      const r = await fetch('/api/media', { method: 'POST', headers: { 'X-WorshipCue': '1', 'X-Filename': 'slide' + ext }, body: f }).then(x => x.json()).catch(err => ({ ok: false, error: err.message }));
      if (!r.ok) return app.showMsg(r.error, 'error');
      done(r.url, f);
    };
    inp.click();
  }

  // ---------------- 목록 조작 ----------------
  const list = $('#cueList');
  list.addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]');
    const row = e.target.closest('.cue-item');
    if (!row) return;
    const i = +row.dataset.i;
    if (ed) { st.sel = i; render(); setEditor(true); focusTitle(); return; }
    quietPreview(i);
  });
  list.addEventListener('dblclick', e => {
    if (e.target.closest('[data-edit]')) return;
    const row = e.target.closest('.cue-item');
    if (row) { window.getSelection()?.removeAllRanges(); quietPreview(+row.dataset.i); } // 더블클릭도 송출하지 않는다
  });
  list.addEventListener('keydown', e => {
    if (!st.cue || e.ctrlKey || e.metaKey) return;
    const n = st.cue.items.length;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { // Alt+↑↓: 순서 옮기기
      const to = st.sel + (e.key === 'ArrowUp' ? -1 : 1);
      if (st.sel >= 0 && to >= 0 && to < n) { moveItem(st.sel, to); st.sel = to; forceEditor(); }
      e.preventDefault(); return;
    }
    if (e.key === 'ArrowDown') { st.sel = Math.min(n - 1, st.sel + 1); render(); forceEditor(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { st.sel = Math.max(0, st.sel - 1); render(); forceEditor(); e.preventDefault(); }
    else if (e.key === 'Enter') { // 이미 미리보기 중인 순서면 고른 슬라이드를 송출, 아니면 미리보기
      const pv = app.preview && app.preview.cue && app.preview.cue.id === st.cue.id && app.preview.cue.index === st.sel;
      if (pv) app.sendPreview(); else quietPreview(st.sel);
      e.preventDefault();
    }
    else if (e.key === 'Delete' && st.sel >= 0) { removeItem(st.sel); e.preventDefault(); }
  });
  // 끌어서 순서 바꾸기
  list.addEventListener('dragstart', e => { const r = e.target.closest('.cue-item'); if (r) { st.dragFrom = +r.dataset.i; e.dataTransfer.effectAllowed = 'move'; } });
  list.addEventListener('dragover', e => {
    const lib = e.dataTransfer.types.includes('application/x-wc-item');
    const r = e.target.closest('.cue-item');
    if (r || lib) { e.preventDefault(); list.querySelectorAll('.cue-item').forEach(x => x.classList.toggle('drop', x === r)); }
  });
  list.addEventListener('drop', e => {
    const r = e.target.closest('.cue-item');
    const lib = e.dataTransfer.getData('application/x-wc-item');
    if (lib) { // 라이브러리에서 끌어 온 항목: 놓은 순서 다음에 넣기
      e.preventDefault();
      list.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
      try { const d = JSON.parse(lib); if (r) st.sel = +r.dataset.i; else st.sel = st.cue.items.length - 1; addItem(d.type, d.extra || {}); } catch { /* 무시 */ }
      return;
    }
    if (!r || st.dragFrom < 0) return;
    e.preventDefault();
    moveItem(st.dragFrom, +r.dataset.i);
    st.dragFrom = -1;
    forceEditor();
  });
  list.addEventListener('dragend', () => { st.dragFrom = -1; list.querySelectorAll('.drop').forEach(x => x.classList.remove('drop')); });

  function moveItem(from, to) {
    const items = st.cue.items;
    const [it] = items.splice(from, 1);
    items.splice(to, 0, it);
    if (st.sel === from) st.sel = to;
    save();
  }

  async function itemAction(i, act, extra) {
    const it = st.cue && st.cue.items[i];
    if (!it) return;
    switch (act) {
      case 'preview': previewItem(i); break;
      case 'theme': setItemTheme(i, extra || ''); break;
      case 'send': showSide('cue'); sendItem(i); break;
      case 'edit': st.sel = i; render(); setEditor(true); focusTitle(); break;
      case 'up': if (i > 0) { moveItem(i, i - 1); render(); forceEditor(); } break;
      case 'down': if (i < st.cue.items.length - 1) { moveItem(i, i + 1); render(); forceEditor(); } break;
      case 'top': if (i > 0) { moveItem(i, 0); render(); forceEditor(); } break;
      case 'bottom': if (i < st.cue.items.length - 1) { moveItem(i, st.cue.items.length - 1); render(); forceEditor(); } break;
      case 'dup': { const copy = { ...structuredClone(it), id: newId() }; st.cue.items.splice(i + 1, 0, copy); st.sel = i + 1; save(); render(); forceEditor(); break; }
      case 'del': removeItem(i); render(); break;
      case 'note': { const v = prompt(`${i + 1}번 '${it.title}' 조작자 메모 (무대 화면에도 보임)`, it.note || ''); if (v !== null) { it.note = v.trim(); save(); render(); forceEditor(); } break; }
      case 'duration': { const v = prompt(`${i + 1}번 '${it.title}' 예정 시간 (분)`, it.duration || ''); if (v !== null) { it.duration = Math.max(0, Math.min(600, parseInt(v, 10) || 0)); save(); render(); forceEditor(); } break; }
      case 'rename': { const v = prompt('제목', it.title); if (v && v.trim()) { it.title = v.trim(); save(); render(); forceEditor(); } break; }
      case 'tolib': {
        const r = await cmd('saveSong', { song: { title: it.title, lyrics: it.lyrics || '', credit: it.credit || '' } });
        if (!r.ok) { app.showMsg(r.error, 'error'); break; }
        it.songId = r.result.id; st.songs.set(it.songId, r.result); save(); forceEditor();
        app.showMsg(`'${it.title}' 을(를) 찬양 라이브러리에 저장했습니다.`, 'ok', 2500);
        break;
      }
      case 'addAfter': st.sel = i; render(); { const b = $(`#cueAdd [data-add="${extra}"]`); if (b) b.click(); } break;
    }
  }

  function removeItem(i) {
    const it = st.cue.items[i];
    if (!confirm(`${i + 1}번 '${it.title}' 순서를 지울까요?`)) return;
    st.cue.items.splice(i, 1);
    st.sel = Math.min(i, st.cue.items.length - 1);
    save();
    forceEditor();
  }

  function focusTitle() {
    setTimeout(() => { const t = $('#cueEditor [data-k="title"]'); if (t) { t.focus(); t.select(); } }, 30);
  }

  /** 새 순서: 고른 순서 바로 다음에 넣고, 가운데 편집칸에서 바로 쓰게 한다 */
  /** 🌐 웹에서 가사 찾기: i = 찬양 순서면 그 순서에 넣고, 아니면(-1) 새 찬양 순서로 */
  function webLyrics(i = st.sel) {
    if (!window.BCLib || !window.BCLib.webLyrics) return;
    const it = st.cue && i >= 0 ? st.cue.items[i] : null;
    const song = it && it.type === 'song' ? it : null;
    const q = song && song.title && song.title !== TYPE.song ? song.title : '';
    window.BCLib.webLyrics(q, {
      target: song ? `${i + 1}번 '${song.title}'` : '',
      apply: d => {
        if (!st.cue) return;
        const fill = x => {
          x.title = d.title || x.title;
          x.lyrics = d.lyrics;
          x.order = d.arrangement || '';
          if (d.credit && !x.credit) x.credit = d.credit;
          if (d.songId) { x.songId = d.songId; if (d.song) st.songs.set(d.songId, d.song); }
        };
        const k = song ? st.cue.items.indexOf(song) : -1;
        if (k >= 0) { fill(song); st.sel = k; save(); forceEditor(); render(); previewItem(k); }
        else { addItem('song', { title: d.title || TYPE.song }); const n = st.cue.items[st.sel]; if (n) { fill(n); save(); forceEditor(); render(); previewItem(st.sel); } }
        app.showMsg(`'${d.title}' 가사를 넣었습니다.`, 'ok', 2000);
      },
    });
  }

  function addItem(type, extra = {}) {
    if (!st.cue) return;
    const it = { id: newId(), type, title: extra.title || TYPE[type], note: '', ...extra };
    if (type === 'blank') it.mode = 'background';
    if (type === 'camera' && !it.deviceId) { pickCam(c => { it.deviceId = c.deviceId; it.label = c.label; it.title = '📷 ' + c.label; save(); forceEditor(); render(); previewItem(at); }); }
    if (type === 'slideshow') Object.assign(it, { images: extra.images || [], body: extra.body || '', autoSec: 8, autoLoop: true, countdown: '', countdownLabel: '예배 시작까지', title: extra.title || '예배 전 화면' });
    const at = st.sel >= 0 ? st.sel + 1 : st.cue.items.length;
    st.cue.items.splice(at, 0, it);
    st.sel = at;
    save();
    showSide('cue');
    forceEditor();
    if (type === 'image' && !it.image) { pickImage(url => { it.image = url; save(); forceEditor(); previewItem(at); }); return; }
    if (type === 'video' && !it.file) {
      if (it.endAction === undefined) { it.sound = true; it.volume = 1; it.endAction = 'hold'; }
      if (window.BCLib) window.BCLib.pickVideo(url => { it.file = url; it.title = fileName(url).replace(/\.[^.]+$/, ''); save(); forceEditor(); render(); previewItem(at); });
      return;
    }
    if (type === 'audio') {
      if (!it.file && window.BCLib) window.BCLib.pickAudio(f => { it.file = f.url; it.title = f.name; save(); forceEditor(); render(); previewItem(at); });
      previewItem(at); return;
    }
    if (type === 'hymn') { previewItem(at).then(() => forceEditor()); return; }
    focusTitle();
    previewItem(at);
  }

  $('#cueSel').onchange = e => openCue(e.target.value);
  $('#cueAdd').addEventListener('click', e => {
    const more = e.target.closest('.cue-more');
    if (more) { // 더보기 ▾ : 자주 안 쓰는 순서 종류
      const r = more.getBoundingClientRect();
      const kinds = [...$('#cueAdd .ft-hidden').querySelectorAll('button[data-add]')];
      window.BCCtx.show(r.left, r.top - 4, [{ head: '순서 넣기' }, ...kinds.map(k => ({ ic: k.dataset.ic, label: k.textContent, run: () => k.click() }))]);
      return;
    }
    const b = e.target.closest('button[data-add]');
    if (!b) return;
    if (b.dataset.add === 'points') { if (window.BCPoints) window.BCPoints.open(); return; }
    if (b.dataset.add === 'hymn') openHymnPicker({});
    else if (b.dataset.add === 'weblyrics') webLyrics(-1);
    else addItem(b.dataset.add);
  });
  // 왼쪽 탭: 큐시트 / 성경 책
  function showSide(which) {
    $('#sideTabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.s === which));
    $('#cuePanel').hidden = which !== 'cue';
    $('#booksPanel').hidden = which !== 'books';
    renderEditor();
  }
  $('#sideTabs').addEventListener('click', e => { const b = e.target.closest('button[data-s]'); if (b) showSide(b.dataset.s); });

  // ---------------- 찬송가 고르기 ----------------
  /** replace: 바꿀 순서 번호 (없으면 새로 넣기). 창을 연 채 여러 곡을 차례로 넣을 수 있다 */
  // ---------------- 베들레헴 찬송가 (가사 슬라이드 · 악보 그림 · 교독문) ----------------
  const hymnalMode = () => { try { return localStorage.getItem('wc-hymnal-mode') === 'score' ? 'score' : 'lyrics'; } catch { return 'lyrics'; } };
  /** 찾기 결과 h({ bethlehem, book, number, kind }) → 큐시트 순서 (replace = 바꿀 순서 번호) */
  async function addBethlehem(h, { replace = -1, mode = hymnalMode() } = {}) {
    const r = await cmd('hymnalGet', { book: h.book, number: h.number });
    if (!r.ok) { app.showMsg(r.error, 'error', 4000); return false; }
    const d = r.result;
    let type, extra;
    if (d.kind === 'reading') { type = 'text'; extra = { title: d.title, body: d.body }; }
    else if (mode === 'score' && d.score) { type = 'image'; extra = { title: d.title, image: d.score, score: true }; }
    else { type = 'song'; extra = { title: d.title, lyrics: d.lyrics, order: d.order || '', credit: d.credit || '' }; }
    if (replace >= 0 && st.cue && st.cue.items[replace]) {
      const old = st.cue.items[replace];
      st.cue.items[replace] = { id: old.id, note: old.note || '', type, ...extra };
      save(); forceEditor(); render(); previewItem(replace);
    } else addItem(type, extra);
    return d;
  }
  async function openHymnPicker({ replace = -1 } = {}) {
    const s = app.state.settings;
    const bgName = b => ({ original: '찬송가 원래 배경', template: '템플릿 배경' }[b] || '지정한 이미지');
    app.openModal(replace >= 0 ? '🎼 다른 찬송가·PPT로 바꾸기' : '🎼 찬송가·찬양 PPT 넣기', `<div class="hymn-pick">
      <div class="row-flex"><select id="hFolder"></select><input type="text" id="hQ" placeholder="번호 또는 제목 (예: 10, 전능왕, 은혜 아니면)" style="flex:1;font-size:16px"><span id="hCount" class="muted"></span><button id="hOnline" title="내 폴더에 없는 찬양 PPT를 온라인에서 찾아 받기">🌐 온라인에서 찾기</button></div>
      <div class="row-flex hymnal-mode" id="hMode" hidden><span class="muted">베들레헴 찬송가 넣는 방식</span><span class="view-tabs"><button data-hm="lyrics" title="절·후렴을 글 슬라이드로 (템플릿 모양 · OBS 자막에도)">📝 가사 슬라이드</button><button data-hm="score" title="악보 그림 한 장">🎼 악보 그림</button></span><span class="muted">교독문은 인도자·회중(굵게) 글 슬라이드</span></div>
      <div id="hInbox" class="hinbox" hidden></div>
      <div id="hList" class="hymn-list" tabindex="0"></div>
      <div class="note">클릭: 고르기 · 더블클릭 또는 Enter: ${replace >= 0 ? '바꾸기' : '큐시트에 넣기 (창을 닫지 않고 여러 곡 연달아 넣을 수 있습니다)'}</div>
      <details class="tc-adv" id="hSetup"><summary>찬송가 폴더 · 기본 배경 설정</summary>
        <div class="form" style="margin-top:8px">
          <label>등록한 폴더</label><div id="hFolders"></div>
          <label>폴더 추가</label><div class="row-flex"><button id="hPick">📁 폴더 고르기…</button><input type="text" id="hPath" placeholder="또는 경로 입력 (예: D:\\자료실\\새찬송가)" style="flex:1"><button id="hAdd">추가</button></div>
          <span></span><div class="note">.pps / .ppt / .pptx 파일이 들어 있는 폴더 (새찬송가 · 구세군 찬송가 · 교독문 · 찬양 PPT 등)를 여러 개 등록할 수 있습니다.
            읽는 방식 — <b>자동</b>: 악보와 배경을 나눠 꺼냄 (배경 바꾸기 가능) · <b>화면 그대로</b>: PowerPoint 로 슬라이드를 그대로 그림으로 (PowerPoint 필요)</div>
          <label>기본 배경</label><div class="row-flex"><select id="hBg">
            <option value="original">찬송가 원래 배경</option><option value="#ffffff">흰 배경 (악보가 가장 잘 보임)</option><option value="template">템플릿 배경 (테마·빠른 설정의 배경)</option>
            ${!['original', 'template', '#ffffff'].includes(s.hymnBackground || 'original') ? `<option value="${esc(s.hymnBackground)}">지정한 이미지</option>` : ''}
          </select><button id="hBgImg">🖼 다른 이미지로…</button></div>
          <span></span><div class="note">악보는 투명 그림이라 어떤 배경 위에도 겹쳐 보입니다. 악보 글씨가 검은색이라 밝은 배경을 권합니다. 순서마다 따로 바꿀 수도 있습니다 (가운데 편집칸의 '배경').</div>
          <h4>온라인에서 찾기 (찬양 PPT)</h4>
          <label>검색 주소</label><input type="text" id="hUrl" value="${esc(s.songSearchUrl || '')}" placeholder="https://…/search/{q}">
          <span></span><div class="note">{q} 자리에 검색어가 들어갑니다. 기본 브라우저로 열리며, 로그인·비밀번호 입력·다운로드는 직접 합니다.</div>
          <label>다운로드 폴더</label><div class="row-flex"><input type="text" id="hDl" value="${esc(s.songDownloadDir || '')}" placeholder="비우면 Windows 다운로드 폴더" style="flex:1"><button id="hDlPick">📁</button></div>
          <label>받은 PPT 모으는 곳</label><div class="row-flex"><input type="text" id="hIn" value="${esc(s.songInboxDir || '')}" placeholder="비우면 문서\\WorshipCue 찬양 PPT" style="flex:1"><button id="hInPick">📁</button></div>
          <span></span><div class="note">'온라인에서 찾기'를 누르면 20분 동안 다운로드 폴더를 지켜봅니다. 새 PPT 를 받으면 위 폴더로 옮겨 큐시트(고른 순서 다음)에 바로 넣습니다. 다음부터는 이 창에서 검색만 하면 나옵니다.</div>
        </div></details>
    </div>`);
    let rows = [];
    let sel = 0;
    const folders = async () => {
      const r = await cmd('listHymnFolders');
      const fs = r.ok ? r.result : [];
      $('#hFolder').innerHTML = `<option value="">전체 폴더</option>` + fs.map(f => `<option value="${esc(f.path)}">${esc(f.name)} (${f.count})</option>`).join('');
      $('#hFolders').innerHTML = fs.length ? fs.map(f => `<div class="row-flex"><b>${esc(f.name)}</b><span class="muted">${esc(f.path)}</span>${f.exists ? '' : '<span class="err-text">폴더 없음</span>'}<select data-render="${esc(f.path)}" title="읽는 방식"><option value="auto" ${f.render !== 'slides' ? 'selected' : ''}>자동 (악보·배경 나눔)</option><option value="slides" ${f.render === 'slides' ? 'selected' : ''}>화면 그대로</option></select><button data-rm="${esc(f.path)}">빼기</button></div>`).join('') : '<span class="warn-text">등록한 폴더가 없습니다. 아래에서 추가하세요.</span>';
      $('#hFolders').querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => { await cmd('removeHymnFolder', { path: b.dataset.rm }); await folders(); search(); });
      $('#hFolders').querySelectorAll('[data-render]').forEach(b => b.onchange = async () => { await cmd('setHymnFolderRender', { path: b.dataset.render, render: b.value }); st.hymnMeta.clear(); app.showMsg('읽는 방식을 바꿨습니다.', 'ok', 1500); });
      if (!fs.length) $('#hSetup').open = true;
    };
    const search = async () => {
      const r = await cmd('searchHymns', { query: $('#hQ').value, folder: $('#hFolder').value });
      rows = r.ok ? r.result : [];
      sel = 0;
      $('#hCount').textContent = `${rows.length}${rows.length >= 300 ? '+' : ''}곡`;
      const q = $('#hQ').value.trim();
      $('#hMode').hidden = !rows.some(h => h.bethlehem);
      $('#hList').innerHTML = rows.map((h, k) => `<div class="hrow ${k === sel ? 'sel' : ''}${h.bethlehem ? ' bh' : ''}" data-k="${k}"><span class="hno">${h.kind === 'reading' ? '' : h.number ?? ''}</span><span class="htitle">${esc(h.title)}</span><span class="muted">${esc(h.folder)}</span></div>`).join('')
        || `<div class="empty">내 폴더에 '${esc(q)}' 이(가) 없습니다.${q ? `<br><button id="hOnline2" class="primary">🌐 온라인에서 '${esc(q)}' 찾기</button><div class="note">브라우저에서 PPT 를 받으면 자동으로 큐시트에 들어갑니다.</div>` : ''}</div>`;
      const b2 = $('#hOnline2'); if (b2) b2.onclick = online;
    };
    const drawMode = () => $('#hMode').querySelectorAll('[data-hm]').forEach(b => b.classList.toggle('on', b.dataset.hm === hymnalMode()));
    drawMode();
    $('#hMode').onclick = e => { const b = e.target.closest('[data-hm]'); if (!b) return; try { localStorage.setItem('wc-hymnal-mode', b.dataset.hm); } catch { /* 무시 */ } drawMode(); };
    const mark = () => { $('#hList').querySelectorAll('.hrow').forEach(x => x.classList.toggle('sel', +x.dataset.k === sel)); $('#hList .hrow.sel')?.scrollIntoView({ block: 'nearest' }); };
    const choose = async k => {
      const h = rows[k];
      if (!h) return;
      if (h.bethlehem) {
        const d = await addBethlehem(h, { replace });
        if (!d) return;
        if (replace >= 0) app.closeModal();
        else { app.showMsg(`'${d.title}' 을(를) ${st.sel + 1}번에 넣었습니다.`, 'ok', 1500); $('#hQ').focus(); $('#hQ').select(); }
        return;
      }
      const title = h.number != null && !/^교독문/.test(h.title) ? `${h.number}장 ${h.title}` : h.title;
      if (replace >= 0) {
        Object.assign(st.cue.items[replace], { title, file: h.file, number: h.number });
        st.hymnMeta.delete(h.file);
        app.closeModal(); save(); forceEditor(); previewItem(replace);
      } else {
        addItem('hymn', { title, file: h.file, number: h.number, background: 'default' });
        app.showMsg(`'${title}' 을(를) ${st.sel + 1}번에 넣었습니다.`, 'ok', 1500);
        $('#hQ').focus(); $('#hQ').select();
      }
    };
    // 온라인에서 찾기 → 브라우저 열기 + 다운로드 폴더 지켜보기
    const online = async () => {
      const q = $('#hQ').value.trim();
      if (!q) { app.showMsg('찾을 찬양 제목(또는 첫 가사)을 입력하세요.', 'info', 2000); $('#hQ').focus(); return; }
      const r = await cmd('songOnlineSearch', { query: q });
      if (!r.ok) return app.showMsg(r.error, 'error', 5000);
      st.inboxInsert = replace;
      showInbox(r.result);
    };
    $('#hOnline').onclick = online;
    const setPath = (id, key) => { $(id).onchange = () => cmd('updateSettings', { patch: { [key]: $(id).value.trim() } }); };
    setPath('#hUrl', 'songSearchUrl'); setPath('#hDl', 'songDownloadDir'); setPath('#hIn', 'songInboxDir');
    const pick = (id, title) => async () => { const r = await cmd('pickFolder', { title }); if (r.ok && r.result) { $(id).value = r.result; $(id).onchange(); } };
    $('#hDlPick').onclick = pick('#hDl', '다운로드 폴더 고르기');
    $('#hInPick').onclick = pick('#hIn', '받은 찬양 PPT 를 모을 폴더 고르기');
    const st0 = await cmd('songInboxStatus');
    if (st0.ok) showInbox(st0.result);
    await folders();
    $('#hBg').value = s.hymnBackground || 'original';
    $('#hBg').onchange = e => cmd('updateSettings', { patch: { hymnBackground: e.target.value } });
    $('#hBgImg').onclick = () => pickImage(async url => { await cmd('updateSettings', { patch: { hymnBackground: url } }); app.showMsg('찬송가 기본 배경을 바꿨습니다.', 'ok', 1500); const o = document.createElement('option'); o.value = url; o.textContent = '지정한 이미지'; $('#hBg').appendChild(o); $('#hBg').value = url; });
    $('#hPick').onclick = async () => {
      const r = await cmd('pickFolder', { title: '찬송가 폴더 고르기' });
      if (!r.ok) return app.showMsg(r.error, 'error');
      if (r.result) { $('#hPath').value = r.result; $('#hAdd').click(); }
    };
    $('#hAdd').onclick = async () => {
      const r = await cmd('addHymnFolder', { path: $('#hPath').value.trim() });
      if (!r.ok) return app.showMsg(r.error, 'error');
      app.showMsg(`'${r.result.name}' 폴더를 등록했습니다 (${r.result.count}곡).`, 'ok', 2000);
      $('#hPath').value = '';
      await folders(); search();
    };
    $('#hFolder').onchange = search;
    let t = null;
    $('#hQ').oninput = () => { clearTimeout(t); t = setTimeout(search, 120); };
    $('#hQ').onkeydown = e => {
      if (e.key === 'ArrowDown') { sel = Math.min(rows.length - 1, sel + 1); mark(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(); e.preventDefault(); }
      else if (e.key === 'Enter') { choose(sel); e.preventDefault(); }
    };
    $('#hList').onclick = e => { const r = e.target.closest('.hrow'); if (r) { sel = +r.dataset.k; mark(); } };
    $('#hList').ondblclick = e => { const r = e.target.closest('.hrow'); if (r) choose(+r.dataset.k); };
    search();
    $('#hQ').focus();
  }

  // ---------------- 큐시트 관리 (⋯) → 관리 창 (cuemanager.js) ----------------
  $('#cueMenu').onclick = () => window.BCCueMgr && window.BCCueMgr.open(st.cue ? st.cue.id : '');

  // ---------------- 온라인에서 받은 찬양 PPT ----------------
  function showInbox(s) {
    const box = $('#hInbox');
    if (!box) return;
    box.hidden = !s.watching;
    if (!s.watching) return;
    const min = Math.max(1, Math.round((s.until - Date.now()) / 60000));
    box.innerHTML = `⏳ <b>다운로드 폴더를 지켜보는 중</b> (${min}분 남음) — 브라우저에서 PPT 를 받으면 자동으로 큐시트에 들어갑니다.
      <span class="muted">${esc(s.downloads)} → ${esc(s.target)}</span> <button id="hInboxStop">그만</button>`;
    $('#hInboxStop').onclick = () => cmd('songInboxStop');
  }

  function onSongDownloaded(d) {
    if (d.error) return app.showMsg('받은 PPT 를 넣지 못했습니다 — ' + d.error, 'error', 6000);
    const title = d.number != null ? `${d.number}장 ${d.title}` : d.title;
    const rep = st.inboxInsert != null && st.inboxInsert >= 0 && st.cue && st.cue.items[st.inboxInsert] ? st.inboxInsert : -1;
    if (rep >= 0) {
      Object.assign(st.cue.items[rep], { title, file: d.file, number: d.number });
      st.inboxInsert = -1;
      save(); forceEditor(); previewItem(rep);
    } else addItem('hymn', { title, file: d.file, number: d.number, background: 'default' });
    app.showMsg(`받은 PPT '${title}' 을(를) 큐시트에 넣었습니다.`, 'ok', 4000);
    const q = $('#hQ'); if (q) q.dispatchEvent(new Event('input'));
  }

  // ---------------- 단축키에서 부르는 기능 ----------------
  function move(d) {
    if (!st.cue || !st.cue.items.length) return;
    showSide('cue');
    const i = Math.max(0, Math.min(st.cue.items.length - 1, (st.sel < 0 ? -1 : st.sel) + d));
    previewItem(i);
  }

  window.BCCue = {
    webLyrics: () => webLyrics(st.sel),
    init, render, onCueNext, move, showSide, onSongDownloaded, onSongInbox: showInbox,
    currentId: () => (st.cue ? st.cue.id : ''),
    addItem: (type, extra) => addItem(type, extra),
    sendItem: i => { showSide('cue'); return sendItem(i); },
    addBethlehem: (h, o) => addBethlehem(h, o || {}),
    openCue: async id => { await refreshList(); showSide('cue'); return openCue(id); }, openHymnPicker: o => openHymnPicker(o || {}), pickImage: done => pickImage(done),
    selected: () => (st.cue && st.sel >= 0 ? st.cue.items[st.sel] : null),
    selIndex: () => st.sel,
    timesOn: () => timesOn(),
    /** 실행 취소 · 다시 실행 (되돌릴 것이 없으면 false) */
    undo: redo => undo(!!redo),
    /** 예배 진행 시계 켜기·끄기 */
    setTimes: async on => { await cmd('updateSettings', { patch: { cueTimes: !!on } }); app.state.settings.cueTimes = !!on; render(); renderClock(); forceEditor(); app.showMsg(on ? '예배 진행 시계를 켰습니다 (⏰ 시작 시각 · 순서별 예정 시간).' : '예배 진행 시계를 껐습니다. 큐시트 관리·설정에서 다시 켤 수 있습니다.', 'info', 3000); },
    pickCam: done => pickCam(done),
    /** 고른 순서만 바꾼다 (미리보기 없이) — 끌어다 놓은 파일을 그 다음 자리에 넣을 때 */
    selectQuiet: i => { if (st.cue && i >= 0 && i < st.cue.items.length) { st.sel = i; render(); } },
    item: i => (st.cue ? st.cue.items[i] : null),
    tplOf: i => (st.cue && st.cue.items[i] ? itemTpl(st.cue.items[i]) : null),
    editorBase: i => editorBase(i),
    /** 전체 보기(격자)용: 열린 큐시트 · i 번째 순서의 슬라이드 (미리보기와 같은 순서·꾸미기) */
    cueInfo: () => (st.cue ? { id: st.cue.id, items: st.cue.items } : null),
    slidesFor: async i => {
      const it = st.cue && st.cue.items[i];
      if (!it || it.type === 'audio') return [];
      if (it.type === 'bible') return decorate(it, await editorBase(i));
      let meta = null;
      if (it.type === 'hymn') meta = await hymnMeta(it);
      return buildSlides(it, meta);
    },
    /** i 번째 순서의 k 번째 슬라이드를 미리보기로 (바로 송출 모드여도 순서를 바꿀 때 첫 장을 내보내지 않게) */
    /** 미리보기를 다음(이전) 순서로: 다음은 첫 장, 이전은 마지막 장 */
    previewStep: async d => {
      const p = app.preview;
      if (!st.cue || !p || !p.cue || p.cue.id !== st.cue.id) return false;
      const i = p.cue.index + d;
      if (i < 0) { app.showMsg('큐시트의 첫 순서입니다.', 'info', 1500); return false; }
      if (i >= st.cue.items.length) { app.showMsg('큐시트의 마지막 순서입니다.', 'info', 1500); return false; }
      return previewItem(i, { fromEnd: d < 0 });
    },
    previewAt: async (i, k) => {
      const same = app.preview && app.preview.cue && st.cue && app.preview.cue.id === st.cue.id && app.preview.cue.index === i;
      if (!same) {
        app.holdDirect = (app.holdDirect || 0) + 1;
        try { if (!(await previewItem(i))) return false; } finally { app.holdDirect--; }
      }
      app.setPreviewIndex(k);
      return true;
    },
    decorate: (it, slides, o) => decorate(it, slides, o),
    /** 슬라이드 편집기: 항목을 고치고 저장·미리보기 갱신 (가사를 고쳤으면 라이브러리 찬양에도) */
    updateItem: (i, fn, { lyrics = false } = {}) => {
      const it = st.cue && st.cue.items[i];
      if (!it) return false;
      fn(it); save();
      if (lyrics && it.type === 'song' && it.songId) saveLinkedSong(it);
      if (i === st.sel) forceEditor();
      app.holdDirect = (app.holdDirect || 0) + 1;
      previewItem(i, { keepIndex: true }).finally(() => { app.holdDirect--; });
      return true;
    },
    /** 고른 순서를 바꾸고 저장·미리보기 갱신 */
    updateSelected: fn => { const it = st.cue && st.sel >= 0 ? st.cue.items[st.sel] : null; if (!it) return false; fn(it); save(); forceEditor(); previewItem(st.sel, { keepIndex: true }); return true; },
    onSongs: d => { if (d && d.id) st.songs.delete(d.id); },
    edit: () => { if (st.cue && st.sel >= 0) { showSide('cue'); setEditor(true); focusTitle(); } },
    toggleEditor: () => { setEditor(!editorOn); if (editorOn) focusTitle(); app.showMsg(editorOn ? '편집칸을 켰습니다.' : '편집칸을 숨겼습니다.', 'info', 1200); },
    editorOn: () => editorOn,
    /** 오른쪽 클릭 메뉴용: i 번째 순서에 하는 일 */
    itemAction: (i, act, extra) => itemAction(i, act, extra),
    themes: () => themeList, themeOf: i => (st.cue && st.cue.items[i] ? themeOf(st.cue.items[i]) : ''),
    onLive: () => { render(); onEnter(); },
    // 다른 곳(다른 창·외부 연동)에서 바뀐 큐시트는 다시 불러온다. 방금 내가 저장한 것은 제외
    onCues: d => { refreshList(); if (st.cue && d && d.id === st.cue.id && Date.now() - st.lastSave > 1500) openCue(st.cue.id); },
  };
})();
