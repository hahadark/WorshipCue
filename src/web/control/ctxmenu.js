/* 오른쪽 클릭 메뉴: 누른 곳에 맞는 기능을 모아 보여 준다
 * - 큐시트 순서 · 큐시트 빈 곳 · 슬라이드(격자·목록) · 성경 검색 결과 · 미리보기 · LIVE · 라이브러리 · 슬라이드 편집기
 * - 글 입력칸은 잘라내기·복사·붙여넣기 (데스크톱 프로그램의 기본 메뉴)
 * 항목: { label, key, run, disabled, danger } · '-' (구분선) · { head } (작은 제목)
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const Cue = () => window.BCCue;
  const act = name => () => app.runAction && app.runAction(name);
  const click = sel => () => { const el = $(sel); if (el) el.click(); };
  const TYPES = [['hymn', '🎼 찬송가·PPT'], ['bible', '📖 성경'], ['song', '🎵 찬양'], ['text', '📢 공지'], ['title', '🏷 제목'], ['image', '🖼 이미지'], ['video', '🎬 영상'], ['slideshow', '🎞 슬라이드쇼'], ['camera', '📷 카메라'], ['audio', '🔊 음악'], ['blank', '⬛ 빈 화면']];
  const EDITABLE = ['song', 'text', 'title'];
  let el = null;
  let items = [];
  let focus = -1;

  // ---------------- 메뉴 그리기 ----------------
  function show(x, y, list) {
    items = list.filter((it, k, a) => it !== '-' || (k > 0 && a[k - 1] !== '-' && k < a.length - 1)); // 앞뒤·겹친 구분선 정리
    if (!items.length) return;
    if (!el) {
      el = document.createElement('div');
      el.className = 'ctx';
      el.setAttribute('role', 'menu');
      document.body.appendChild(el);
      el.addEventListener('mousedown', e => e.preventDefault()); // 입력칸 초점 유지
      el.addEventListener('click', e => {
        const b = e.target.closest('.ctx-item');
        if (!b || b.disabled) return;
        const it = items[+b.dataset.k];
        hide();
        try { const r = it.run(); if (r && r.catch) r.catch(err => app.showMsg(err.message, 'error')); } catch (err) { app.showMsg(err.message, 'error'); }
      });
      el.addEventListener('mousemove', e => { const b = e.target.closest('.ctx-item'); if (b) setFocus(+b.dataset.k); });
    }
    el.innerHTML = items.map((it, k) => it === '-' ? '<div class="ctx-sep"></div>'
      : it.head ? `<div class="ctx-head">${esc(it.head)}</div>`
        : `<button type="button" class="ctx-item ${it.danger ? 'danger' : ''}" data-k="${k}" ${it.disabled ? 'disabled' : ''} role="menuitem"><span>${esc(it.label)}</span>${it.key ? `<kbd>${esc(it.key)}</kbd>` : ''}</button>`).join('');
    el.hidden = false;
    el.style.left = '0px'; el.style.top = '0px';
    const r = el.getBoundingClientRect();
    const W = innerWidth, H = innerHeight;
    el.style.left = Math.max(4, Math.min(x, W - r.width - 4)) + 'px';
    el.style.top = Math.max(4, y + r.height > H - 4 ? Math.max(4, y - r.height) : y) + 'px';
    focus = -1;
  }
  function hide() { if (el) el.hidden = true; items = []; }
  const isOpen = () => el && !el.hidden;
  function setFocus(k) {
    focus = k;
    el.querySelectorAll('.ctx-item').forEach(b => b.classList.toggle('focus', +b.dataset.k === k));
  }
  function moveFocus(d) {
    const ks = items.map((it, k) => (it !== '-' && !it.head && !it.disabled ? k : -1)).filter(k => k >= 0);
    if (!ks.length) return;
    const i = ks.indexOf(focus);
    setFocus(ks[(i + d + ks.length) % ks.length] ?? ks[0]);
  }

  // ---------------- 곳마다 메뉴 ----------------
  function cueItemMenu(i) {
    const it = Cue().item(i);
    if (!it) return [];
    const A = a => () => Cue().itemAction(i, a);
    const can = EDITABLE.includes(it.type);
    return [
      { head: `${i + 1}. ${it.title}` },
      { label: '미리보기', key: '클릭', run: A('preview') },
      { label: '▶ 송출', key: '더블클릭', run: A('send') },
      '-',
      { label: '✎ 편집칸에서 고치기', key: 'F2', run: A('edit') },
      { label: '✎ 슬라이드 편집', key: 'Ctrl+E', run: () => window.BCSlideEdit && window.BCSlideEdit.open(i), disabled: !can },
      { label: '제목 바꾸기…', run: A('rename') },
      { label: `메모${it.note ? ' 고치기' : ' 달기'}…`, run: A('note') },
      ...(Cue().timesOn() ? [{ label: '예정 시간…', run: A('duration') }] : []),
      ...(it.type === 'song' && !it.songId ? [{ label: '📚 찬양 라이브러리에 저장', run: A('tolib') }] : []),
      '-',
      { label: '위로', key: 'Alt+↑', run: A('up'), disabled: i === 0 },
      { label: '아래로', key: 'Alt+↓', run: A('down') },
      { label: '맨 위로', run: A('top'), disabled: i === 0 },
      { label: '맨 아래로', run: A('bottom') },
      { label: '복제', run: A('dup') },
      { label: '지우기', key: 'Delete', run: A('del'), danger: true },
      '-',
      { head: '이 다음에 넣기' },
      ...TYPES.map(([t, l]) => ({ label: l, run: () => Cue().itemAction(i, 'addAfter', t) })),
    ];
  }
  function cueEmptyMenu() {
    return [
      { head: '순서 넣기' },
      ...TYPES.map(([t, l]) => ({ label: l, run: click(`#cueAdd [data-add="${t}"]`) })),
      '-',
      { label: '🤖 주보로 큐시트 만들기…', run: () => window.BCAI && window.BCAI.open() },
      { label: '큐시트 관리 (새로·복제·내보내기)…', run: click('#cueMenu') },
    ];
  }
  /** 미리보기 중인 순서의 k 번째 슬라이드 (격자·목록) */
  function slideMenu(k) {
    const p = app.preview;
    if (!p) return [];
    const s = p.slides[k];
    const it = p.cue && Cue() && Cue().item(p.cue.index);
    return [
      { head: `슬라이드 ${k + 1}${s && s.label && !/^\d+$/.test(s.label) ? ' · ' + s.label : ''}` },
      { label: '미리보기', key: '클릭', run: () => app.setPreviewIndex(k) },
      { label: '▶ 바로 송출', key: '더블클릭', run: async () => { app.setPreviewIndex(k); await app.sendPreview(); } },
      '-',
      { label: '✎ 이 슬라이드 편집', key: 'Ctrl+E', run: () => window.BCSlideEdit.openPreviewSlide(k), disabled: !(it && EDITABLE.includes(it.type)) },
      ...(it ? [{ label: '✎ 이 순서 편집칸', key: 'F2', run: () => Cue().itemAction(p.cue.index, 'edit') }] : []),
      { label: window.BCGrid && window.BCGrid.isOn() ? '목록으로 보기' : '격자로 보기', run: click(`#slideView [data-sv="${window.BCGrid && window.BCGrid.isOn() ? 'list' : 'grid'}"]`) },
    ];
  }
  /** 성경 검색 결과 한 줄 */
  function verseMenu(row) {
    const pick = async () => { row.click(); await new Promise(r => setTimeout(r, 250)); };
    return [
      { head: row.querySelector('.ref') ? row.querySelector('.ref').textContent : `${($('#resultTitle') || {}).textContent || '성경'}${row.querySelector('.vn') ? ' · ' + row.querySelector('.vn').textContent + '절' : ''}` },
      { label: '미리보기', key: 'Enter', run: () => row.click() },
      { label: '▶ 바로 송출', key: 'Ctrl+Enter', run: () => row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) },
      '-',
      { label: '📖 이 본문을 큐시트에 넣기 (고른 순서 다음)', run: async () => {
        await pick();
        const ps = app.preview && app.preview.passage;
        if (!ps || !ps.title) return app.showMsg('본문을 먼저 미리보기에 띄우세요.', 'info');
        Cue().addItem('bible', { title: '성경봉독', ref: ps.title });
        app.showMsg(`'${ps.title}' 을(를) 큐시트에 넣었습니다.`, 'ok', 1800);
      } },
      { label: '장절·본문 복사', run: async () => {
        const ref = row.querySelector('.ref') ? row.querySelector('.ref').textContent.trim() : '';
        const text = row.textContent.replace(ref, '').replace(/\s+/g, ' ').trim();
        await navigator.clipboard.writeText(`${ref} ${text}`.trim());
        app.showMsg('복사했습니다.', 'ok', 1200);
      } },
    ];
  }
  function clearItems() {
    return [
      { label: '글자 숨김·복원', key: 'F10', run: act('toggleClear') },
      { label: $('#bBg') ? $('#bBg').textContent : '배경 지우기', run: click('#bBg') },
      { label: $('#bOvOff') ? $('#bOvOff').textContent : '오버레이 끄기', run: click('#bOvOff') },
      { label: '음악 멈춤', run: click('#bAudio') },
      { label: $('#bLogo') ? $('#bLogo').textContent : '로고 화면', run: click('#bLogo') },
      { label: '모두 지우기', run: click('#bAll'), danger: true },
      ...(app.state && app.state.layers && app.state.layers.media ? [{ label: `송출 배경 끄기 (${app.state.layers.media.label || '미디어'})`, run: () => window.BCLib && window.BCLib.liveMedia(null) }] : [{ label: '📷 송출 배경 (카메라·미디어)…', run: () => { window.BCDock && window.BCDock.show('library'); setTimeout(() => window.BCLib && window.BCLib.show('cameras'), 120); } }]),
    ];
  }
  function previewMenu() {
    return [
      { head: '미리보기' },
      { label: '▶ 송출', key: 'F9', run: act('sendPreview') },
      { label: '이전 슬라이드', key: 'PageUp', run: act('previewPrevSlide') },
      { label: '다음 슬라이드', key: 'PageDown', run: act('previewNextSlide') },
      '-',
      { label: '다음 순서 미리보기', key: 'Ctrl+↓', run: act('cueNext') },
      { label: '이전 순서 미리보기', key: 'Ctrl+↑', run: act('cuePrev') },
      ...(app.preview && app.preview.cue ? [{ label: '✎ 이 슬라이드 편집', key: 'Ctrl+E', run: () => window.BCSlideEdit.openPreviewSlide(app.preview.index) }] : []),
      '-',
      { label: '미리보기 끄기 (바로 송출)', run: click('#btnStudio') },
    ];
  }
  function liveMenu() {
    return [
      { head: 'LIVE (송출 중)' },
      { label: '다음 슬라이드', key: 'F6', run: act('nextSlide') },
      { label: '이전 슬라이드', key: 'F5', run: act('prevSlide') },
      '-',
      ...clearItems(),
      '-',
      { label: $('#bOutput') && !$('#bOutput').hidden ? `보조 화면 ${$('#bOutputState') ? ($('#bOutputState').textContent === '켜짐' ? '끄기' : '켜기') : '켜기·끄기'}` : '보조 화면 켜기·끄기', key: 'Ctrl+Shift+F', run: act('toggleOutputWindow') },
      { label: '🖥 무대 화면 창 열기', run: () => window.open('/outputs/stage?window=1', 'wc-stage', 'width=1280,height=720') },
      { label: '송출 기록', key: 'Ctrl+H', run: act('openHistory') },
      '-',
      { label: window.BCDraw && window.BCDraw.isOn() ? '✎ 그리기 끝' : '✎ 화면에 그리기·강조', run: () => window.BCDraw && window.BCDraw.toggle() },
      { label: '그린 것 지우기', run: () => app.cmd('drawClear'), disabled: !(app.drawState && ((app.drawState.strokes || []).length || app.drawState.spot)) },
    ];
  }
  /** 라이브러리: 더블클릭(넣기) + 그 줄의 단추들 */
  function libraryMenu(node) {
    const tab = window.BCLib && window.BCLib.tab ? window.BCLib.tab() : '';
    const name = (node.querySelector('b') || node.querySelector('span') || node).textContent.trim().slice(0, 40);
    const list = [{ head: name || '라이브러리' }];
    if (['songs', 'hymns', 'images', 'audio'].includes(tab) && !node.classList.contains('ov-row')) {
      list.push({ label: '큐시트에 넣기 (고른 순서 다음)', key: '더블클릭', run: () => node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) });
    }
    const btns = [...node.querySelectorAll('button')].filter(b => !b.hidden && (b.textContent.trim() || b.title));
    if (btns.length) list.push('-');
    btns.forEach(b => {
      const t = b.textContent.trim();
      const label = t.length > 2 ? t : (b.title || t); // ✕ ▶ 같은 기호 단추는 설명(title)으로
      list.push({ label, run: () => b.click(), danger: /지우기|삭제/.test(label) || b.classList.contains('danger') });
    });
    const sw = node.querySelector('.ov-switch input');
    if (sw) list.splice(1, 0, { label: sw.checked ? '끄기' : '켜기', run: () => sw.click() });
    return list;
  }

  /** 누른 곳 → 메뉴 */
  function menuFor(t) {
    if (window.BCSlideEdit && window.BCSlideEdit.isOpen()) return window.BCSlideEdit.menuFor ? window.BCSlideEdit.menuFor(t) : [];
    if (!$('#modal').hidden) return null; // 창 안에서는 메뉴 없음
    const row = t.closest('#cueList .cue-item');
    if (row) return cueItemMenu(+row.dataset.i);
    if (t.closest('#cueList')) return cueEmptyMenu();
    const cell = t.closest('#slideGrid .sg-cell, #results .srow');
    if (cell) return slideMenu(+cell.dataset.k);
    const verse = t.closest('#results .row[data-i]');
    if (verse) return verseMenu(verse);
    if (t.closest('#panelPreview')) return previewMenu();
    if (t.closest('#panelLive')) return liveMenu();
    const lib = t.closest('#panelLibrary .lib-row, #panelLibrary .lib-cell, #panelLibrary .lib-tcell');
    if (lib) return libraryMenu(lib);
    if (t.closest('footer.bottom')) return [{ head: '화면 지우기' }, ...clearItems()];
    return null;
  }

  function init() {
    document.addEventListener('contextmenu', e => {
      const t = e.target;
      // 글 입력칸: 잘라내기·복사·붙여넣기 (데스크톱 기본 메뉴)
      if (t.closest('input, textarea, [contenteditable="true"]') && !t.closest('#seHandles')) { hide(); return; }
      const list = menuFor(t);
      if (!list || !list.length) { hide(); return; }
      e.preventDefault();
      show(e.clientX, e.clientY, list);
    });
    document.addEventListener('mousedown', e => { if (isOpen() && !el.contains(e.target)) hide(); }, true);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
    document.addEventListener('scroll', e => { if (isOpen() && !el.contains(e.target)) hide(); }, true);
    window.addEventListener('keydown', e => {
      if (!isOpen()) return;
      if (e.key === 'Escape') { hide(); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { moveFocus(e.key === 'ArrowDown' ? 1 : -1); e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'Enter' && focus >= 0) { const b = el.querySelector(`.ctx-item[data-k="${focus}"]`); if (b) b.click(); e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  window.BCCtx = { init, show, hide, isOpen };
})();
