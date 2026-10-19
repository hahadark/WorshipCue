/* 슬라이드 썸네일 격자 (ProPresenter·FreeShow 방식)
 * - 가운데 패널의 '목록 | 격자' 단추로 전환 (선택은 이 PC 에 기억)
 * - 미리보기 중인 순서의 슬라이드를 실제 화면 모양 썸네일로: 클릭 = 그 슬라이드 미리보기, 더블클릭 = 바로 송출
 * - 초록 테두리 = 미리보기 중, 빨간 테두리 = 송출 중
 * - '전체' (ProPresenter 방식): 큐시트의 모든 순서 슬라이드를 순서별 줄로. 큐시트에서 순서를 누르면 그 줄로 이동
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const R = window.BCRender;
  let mode = 'list'; // 'list' | 'grid' | 'all' (전체 격자) | 'alllist' (전체 목록)
  try { const v = localStorage.getItem('wc-slide-grid'); mode = v === '1' ? 'grid' : ['all', 'alllist'].includes(v) ? v : 'list'; } catch { /* 저장 안 됨 */ }
  const isAll = () => mode === 'all' || mode === 'alllist';
  let on = mode !== 'list';
  let drawnKey = '';

  function init() {
    const head = $('.center-head');
    head.insertAdjacentHTML('beforeend', `<span class="view-tabs" id="slideView" title="슬라이드 보기 방식"><button data-sv="list">목록</button><button data-sv="grid">격자</button><button data-sv="all" title="큐시트의 모든 순서 슬라이드를 한 화면에 썸네일로 (ProPresenter 방식)">전체 격자</button><button data-sv="alllist" title="큐시트의 모든 순서 슬라이드를 한 화면에 글 목록으로">전체 목록</button></span>
      <label class="tc-toggle sg-size" title="썸네일 크기"><input type="range" id="sgSize" min="150" max="420" step="10" value="${size()}"></label>`);
    $('#results').insertAdjacentHTML('afterend', '<div id="slideGrid" class="slide-grid" tabindex="0" hidden></div><div id="cueGrid" class="cue-grid" tabindex="0" hidden></div>');
    $('#slideView').onclick = e => { const b = e.target.closest('[data-sv]'); if (b) set(b.dataset.sv); };
    $('#sgSize').oninput = e => { $('#slideGrid').style.setProperty('--sg', e.target.value + 'px'); $('#cueGrid').style.setProperty('--sg', e.target.value + 'px'); try { localStorage.setItem('wc-slide-grid-size', e.target.value); } catch { /* 무시 */ } };
    $('#slideGrid').style.setProperty('--sg', size() + 'px');
    $('#cueGrid').style.setProperty('--sg', size() + 'px');
    initAll();
    const grid = $('#slideGrid');
    grid.addEventListener('click', e => {
      const c = e.target.closest('.sg-cell');
      if (!c) return;
      if (e.target.closest('.sg-edit')) { if (window.BCSlideEdit) window.BCSlideEdit.openPreviewSlide(+c.dataset.k); return; }
      if (e.target.closest('.sg-add')) { if (window.BCSlideEdit) window.BCSlideEdit.quickOp(+c.dataset.k, 'add'); return; }
      if (e.target.closest('.sg-del')) { if (window.BCSlideEdit) window.BCSlideEdit.quickOp(+c.dataset.k, 'del'); return; }
      app.setPreviewIndex(+c.dataset.k);
    });
    grid.addEventListener('dblclick', e => { const c = e.target.closest('.sg-cell'); if (c && !e.target.closest('.sg-edit, .sg-ops')) { app.setPreviewIndex(+c.dataset.k); app.sendPreview(); } });
    grid.addEventListener('keydown', e => {
      if (!app.preview) return;
      const cols = Math.max(1, Math.floor(grid.clientWidth / (size() + 12)));
      const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
      if (d) { app.setPreviewIndex(app.preview.index + d); e.preventDefault(); }
      else if (e.key === 'Enter') { app.sendPreview(); e.preventDefault(); }
    });
    set(mode);
  }
  function size() { try { return +(localStorage.getItem('wc-slide-grid-size') || 240); } catch { return 240; } }

  function set(v) {
    mode = v === true ? 'grid' : v === false ? 'list' : ['list', 'grid', 'all', 'alllist'].includes(v) ? v : 'list';
    on = mode !== 'list';
    try { localStorage.setItem('wc-slide-grid', mode === 'grid' ? '1' : isAll() ? mode : '0'); } catch { /* 무시 */ }
    $('#slideView').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.sv === mode));
    $('#sgSize').parentNode.hidden = !on || mode === 'alllist';
    allKey = '';
    drawnKey = '';
    update();
  }

  /** 미리보기·송출이 바뀔 때마다 (control.js 에서 부름) */
  function update() {
    const grid = $('#slideGrid');
    if (!grid) return;
    const textSearch = app.results && app.results.type === 'text';
    const cmTab = $('#cmView') && !$('#cmView').hidden;
    // 전체 보기: 큐시트가 열려 있고, 미리보기가 큐시트 순서이거나 비어 있을 때 (검색한 성경 본문은 보통 격자로)
    const cueOpen = window.BCCue && window.BCCue.cueInfo && window.BCCue.cueInfo();
    const allShow = isAll() && cueOpen && (!app.preview || app.preview.cue) && !textSearch && !cmTab;
    $('#cueGrid').hidden = !allShow;
    if (allShow) { grid.hidden = true; $('#results').hidden = true; drawAll(); return; }
    const show = on && app.preview && !textSearch && !cmTab;
    grid.hidden = !show;
    $('#results').hidden = !!show || cmTab;
    if (!show) return;
    const p = app.preview;
    const tpl = app.tplFor('main', p.tpl || null);
    const key = JSON.stringify([p.cue ? p.cue.id + ':' + p.cue.index : '', p.slides.length, p.passage && p.passage.title, p.passage && p.passage.versionName, tpl.id, p.slides.map(s => s.ref + s.label + (s.parts[0] ? s.parts[0].text.slice(0, 20) : '') + (s.image || '') + (s.bg || '') + (s.footer || '') + (s.edit ? JSON.stringify(s.edit) : ''))]);
    if (key !== drawnKey) {
      drawnKey = key;
      const it = p.cue && window.BCCue && window.BCCue.item(p.cue.index);
      const ops = it && it.type !== 'audio' ? '<span class="sg-ops"><button class="sg-add" title="이 다음에 새 슬라이드">＋</button><button class="sg-del" title="이 슬라이드 지우기 (성경·찬송가·그림 등은 건너뛰기)">✕</button></span>' : '';
      grid.innerHTML = p.slides.map((s, k) => `<div class="sg-cell" data-k="${k}"${s.kind !== 'bible' && window.BCGroup && window.BCGroup.color(s.label) ? ` style="--gc:${window.BCGroup.color(s.label)}"` : ''}><div class="screen sg-screen"></div><button class="sg-edit" title="이 슬라이드 편집 (Ctrl+E)">✎</button>${ops}<div class="sg-label"><b>${k + 1}</b> ${esc(s.label && !/^\d+$/.test(s.label) ? s.label : s.kind === 'bible' ? (s.ref || '') : '')}</div></div>`).join('');
      grid.querySelectorAll('.sg-cell').forEach(c => {
        const s = p.slides[+c.dataset.k];
        R.renderInto(c.querySelector('.sg-screen'), s, tpl, { checker: true, versionName: p.passage.versionName });
      });
    }
    // 미리보기·송출 표시
    const live = app.state.live;
    // 송출 중인 것이 이 순서(같은 큐시트 순서, 또는 같은 본문)이면 그 슬라이드 번호
    const lp = live.hasLive ? live.passage : null;
    const same = lp && (p.cue ? lp.cueId === p.cue.id && lp.cueIndex === p.cue.index : lp.cueIndex < 0 && lp.title === p.passage.title && live.count === p.slides.length);
    const liveIdx = same ? live.index : -1;
    grid.querySelectorAll('.sg-cell').forEach(c => {
      const k = +c.dataset.k;
      c.classList.toggle('in-pv', k === p.index);
      c.classList.toggle('on-air', k === liveIdx);
    });
    grid.querySelector('.sg-cell.in-pv')?.scrollIntoView({ block: 'nearest' });
  }

  // ---------- 전체 보기 (ProPresenter 방식) ----------
  let allKey = '', allToken = 0, lastPv = '', io = null;
  const secSlides = new Map(); // 순서 번호 → 슬라이드
  const TYPE = { hymn: '🎼', bible: '📖', song: '🎵', text: '📢', title: '🏷', image: '🖼', video: '🎬', audio: '🔊', blank: '⬛', slideshow: '🎞', camera: '📷' };
  function initAll() {
    const g = $('#cueGrid');
    const at = e => { const c = e.target.closest('.sg-cell'); return c ? { i: +c.dataset.i, k: +c.dataset.k, c } : null; };
    g.addEventListener('click', async e => {
      const h = e.target.closest('.cg-head');
      if (h) { window.BCCue.previewAt(+h.dataset.i, 0); return; }
      const x = at(e);
      if (!x) return;
      const op = e.target.closest('.sg-edit') ? 'edit' : e.target.closest('.sg-add') ? 'add' : e.target.closest('.sg-del') ? 'del' : '';
      if (!(await window.BCCue.previewAt(x.i, x.k))) return;
      if (op === 'edit') window.BCSlideEdit.openPreviewSlide(x.k);
      else if (op) window.BCSlideEdit.quickOp(x.k, op);
    });
    g.addEventListener('dblclick', async e => {
      const x = at(e);
      if (!x || e.target.closest('.sg-edit, .sg-ops')) return;
      if (await window.BCCue.previewAt(x.i, x.k)) app.sendPreview();
    });
    // 보이는 칸만 그린다 (순서가 많아도 가볍게)
    io = new IntersectionObserver(list => list.forEach(en => {
      if (!en.isIntersecting) return;
      const c = en.target;
      io.unobserve(c);
      const s = (secSlides.get(+c.dataset.i) || [])[+c.dataset.k];
      if (s) R.renderInto(c.querySelector('.sg-screen'), s, app.tplFor('main', window.BCCue.tplOf(+c.dataset.i)), { checker: true });
    }), { root: g, rootMargin: '300px' });
  }
  async function drawAll() {
    const g = $('#cueGrid');
    const info = window.BCCue.cueInfo();
    const tplKey = JSON.stringify(app.tplFor('main'));
    const key = JSON.stringify([mode, info.id, info.items, tplKey.length, tplKey.slice(0, 400)]);
    g.classList.toggle('cg-list', mode === 'alllist');
    if (key !== allKey) {
      allKey = key;
      const token = ++allToken;
      secSlides.clear();
      g.innerHTML = info.items.map((it, i) => `<section class="cg-sec" data-i="${i}"><div class="cg-head" data-i="${i}" title="이 순서 미리보기"><b>${i + 1}</b> <span class="cg-ico">${TYPE[it.type] || ''}</span> ${esc(it.title || '')} <span class="muted cg-n" data-n="${i}"></span></div><div class="cg-row" data-row="${i}"><div class="muted cg-wait">…</div></div></section>`).join('');
      for (let i = 0; i < info.items.length; i++) {
        let slides = [];
        let err = '';
        try { slides = await window.BCCue.slidesFor(i); } catch (e) { err = e.message || String(e); }
        if (token !== allToken) return; // 그 사이 바뀜
        secSlides.set(i, slides);
        const row = g.querySelector(`[data-row="${i}"]`);
        const it = info.items[i];
        g.querySelector(`[data-n="${i}"]`).textContent = slides.length ? `· 슬라이드 ${slides.length}장` : '';
        const ops = it.type !== 'audio' ? '<span class="sg-ops"><button class="sg-add" title="이 다음에 새 슬라이드">＋</button><button class="sg-del" title="이 슬라이드 지우기 (성경·찬송가·그림 등은 건너뛰기)">✕</button></span>' : '';
        row.innerHTML = slides.length && mode === 'alllist' ? slides.map((s, k) => listRow(s, k, i)).join('')
          : slides.length ? slides.map((s, k) => `<div class="sg-cell" data-i="${i}" data-k="${k}"${s.kind !== 'bible' && window.BCGroup && window.BCGroup.color(s.label) ? ` style="--gc:${window.BCGroup.color(s.label)}"` : ''}><div class="screen sg-screen"></div><button class="sg-edit" title="이 슬라이드 편집 (Ctrl+E)">✎</button>${ops}<div class="sg-label"><b>${k + 1}</b> ${esc(s.label && !/^\d+$/.test(s.label) ? s.label : s.kind === 'bible' ? (s.ref || '') : '')}</div></div>`).join('')
          : `<div class="muted cg-empty">${err ? esc(err) : it.type === 'audio' ? '🔊 음악 · 화면은 바뀌지 않습니다' : '(슬라이드 없음)'}</div>`;
        // 화면 크기를 먼저 잡아 두고(빈 화면) 보일 때 그린다
        if (mode !== 'alllist') row.querySelectorAll('.sg-cell').forEach(c => { const sc = c.querySelector('.sg-screen'); const t = app.tplFor('main', window.BCCue.tplOf(i)); sc.style.aspectRatio = `${t.width} / ${t.height}`; io.observe(c); });
        markAll();
      }
    }
    markAll();
  }
  /** 전체 목록: 한 줄에 번호 · 이름(1절·후렴…) · 글 */
  function slideText(s) {
    const G2 = window.BCGroup;
    const plain = t => (G2 ? G2.stripFmt(G2.stripChords(t)) : t);
    if (s.kind === 'title') return [s.ref, s.subtitle].filter(Boolean).join(' · ');
    if (s.kind === 'image' || s.kind === 'score') return s.caption || (s.kind === 'score' ? '🎼 악보' : '🖼 이미지');
    if (s.kind === 'video') return '🎬 영상';
    if (s.kind === 'camera') return '📷 카메라';
    if (s.kind === 'blank') return s.mode === 'background' ? '⬛ 배경·로고만' : '⬛ 검은 화면';
    return (s.parts || []).map(p => (s.kind === 'text' ? '' : p.verse + ' ') + plain(p.text)).join(s.kind === 'text' ? '\n' : ' ').trim();
  }
  function listRow(s, k, i) {
    const lbl = s.label && !/^\d+$/.test(s.label) ? s.label : s.kind === 'bible' || !s.kind ? (s.ref || '') : '';
    const gc = window.BCGroup && s.kind !== 'bible' ? window.BCGroup.color(s.label) : '';
    return `<div class="sg-cell cg-line" data-i="${i}" data-k="${k}"${gc ? ` style="--gc:${gc}"` : ''}><b class="cg-k">${k + 1}</b>${lbl ? `<span class="cg-lbl">${esc(lbl)}</span>` : ''}<span class="cg-txt">${esc(slideText(s))}</span><button class="sg-edit" title="이 슬라이드 편집 (Ctrl+E)">✎</button></div>`;
  }

  /** 미리보기(초록)·송출(빨강) 표시와, 미리보기 순서가 바뀌면 그 줄로 이동 */
  function markAll() {
    const g = $('#cueGrid');
    const info = window.BCCue.cueInfo();
    if (!info) return;
    const p = app.preview;
    const pvI = p && p.cue && p.cue.id === info.id ? p.cue.index : -1;
    const live = app.state.live;
    const lp = live.hasLive ? live.passage : null;
    const lvI = lp && lp.cueId === info.id ? lp.cueIndex : -1;
    g.querySelectorAll('.sg-cell').forEach(c => {
      const i = +c.dataset.i, k = +c.dataset.k;
      c.classList.toggle('in-pv', i === pvI && k === p.index);
      c.classList.toggle('on-air', i === lvI && k === live.index);
    });
    g.querySelectorAll('.cg-sec').forEach(s => { const i = +s.dataset.i; s.classList.toggle('pv', i === pvI); s.classList.toggle('air', i === lvI); });
    const now = pvI + ':' + info.id;
    if (pvI >= 0 && now !== lastPv) {
      lastPv = now;
      g.querySelector(`.cg-sec[data-i="${pvI}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else if (pvI >= 0) g.querySelector('.sg-cell.in-pv')?.scrollIntoView({ block: 'nearest' });
  }

  window.BCGrid = { init, update, set, isOn: () => on, mode: () => mode };
})();
