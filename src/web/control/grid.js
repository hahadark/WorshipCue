/* 슬라이드 썸네일 격자 (ProPresenter·FreeShow 방식)
 * - 가운데 패널의 '목록 | 격자' 단추로 전환 (선택은 이 PC 에 기억)
 * - 미리보기 중인 순서의 슬라이드를 실제 화면 모양 썸네일로: 클릭 = 그 슬라이드 미리보기, 더블클릭 = 바로 송출
 * - 초록 테두리 = 미리보기 중, 빨간 테두리 = 송출 중
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const R = window.BCRender;
  let on = false;
  try { on = localStorage.getItem('wc-slide-grid') === '1'; } catch { /* 저장 안 됨 */ }
  let drawnKey = '';

  function init() {
    const head = $('.center-head');
    head.insertAdjacentHTML('beforeend', `<span class="view-tabs" id="slideView" title="슬라이드 보기 방식"><button data-sv="list">목록</button><button data-sv="grid">격자</button></span>
      <label class="tc-toggle sg-size" title="썸네일 크기"><input type="range" id="sgSize" min="150" max="420" step="10" value="${size()}"></label>`);
    $('#results').insertAdjacentHTML('afterend', '<div id="slideGrid" class="slide-grid" tabindex="0" hidden></div>');
    $('#slideView').onclick = e => { const b = e.target.closest('[data-sv]'); if (b) set(b.dataset.sv === 'grid'); };
    $('#sgSize').oninput = e => { $('#slideGrid').style.setProperty('--sg', e.target.value + 'px'); try { localStorage.setItem('wc-slide-grid-size', e.target.value); } catch { /* 무시 */ } };
    $('#slideGrid').style.setProperty('--sg', size() + 'px');
    const grid = $('#slideGrid');
    grid.addEventListener('click', e => {
      const c = e.target.closest('.sg-cell');
      if (!c) return;
      if (e.target.closest('.sg-edit')) { if (window.BCSlideEdit) window.BCSlideEdit.openPreviewSlide(+c.dataset.k); return; }
      app.setPreviewIndex(+c.dataset.k);
    });
    grid.addEventListener('dblclick', e => { const c = e.target.closest('.sg-cell'); if (c && !e.target.closest('.sg-edit')) { app.setPreviewIndex(+c.dataset.k); app.sendPreview(); } });
    grid.addEventListener('keydown', e => {
      if (!app.preview) return;
      const cols = Math.max(1, Math.floor(grid.clientWidth / (size() + 12)));
      const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
      if (d) { app.setPreviewIndex(app.preview.index + d); e.preventDefault(); }
      else if (e.key === 'Enter') { app.sendPreview(); e.preventDefault(); }
    });
    set(on);
  }
  function size() { try { return +(localStorage.getItem('wc-slide-grid-size') || 240); } catch { return 240; } }

  function set(v) {
    on = v;
    try { localStorage.setItem('wc-slide-grid', v ? '1' : '0'); } catch { /* 무시 */ }
    $('#slideView').querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.sv === 'grid') === v));
    $('#sgSize').parentNode.hidden = !v;
    drawnKey = '';
    update();
  }

  /** 미리보기·송출이 바뀔 때마다 (control.js 에서 부름) */
  function update() {
    const grid = $('#slideGrid');
    if (!grid) return;
    const textSearch = app.results && app.results.type === 'text';
    const cmTab = $('#cmView') && !$('#cmView').hidden;
    const show = on && app.preview && !textSearch && !cmTab;
    grid.hidden = !show;
    $('#results').hidden = !!show || cmTab;
    if (!show) return;
    const p = app.preview;
    const tpl = app.tplFor('main', p.tpl || null);
    const key = JSON.stringify([p.slides.length, p.passage && p.passage.title, tpl.id, p.slides.map(s => s.ref + s.label + (s.parts[0] ? s.parts[0].text.slice(0, 20) : '') + (s.image || '') + (s.bg || '') + (s.edit ? JSON.stringify(s.edit) : ''))]);
    if (key !== drawnKey) {
      drawnKey = key;
      grid.innerHTML = p.slides.map((s, k) => `<div class="sg-cell" data-k="${k}"><div class="screen sg-screen"></div><button class="sg-edit" title="이 슬라이드 편집 (Ctrl+E)">✎</button><div class="sg-label"><b>${k + 1}</b> ${esc(s.label && !/^\d+$/.test(s.label) ? s.label : s.kind === 'bible' ? (s.ref || '') : '')}</div></div>`).join('');
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

  window.BCGrid = { init, update, isOn: () => on };
})();
