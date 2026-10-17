/* 슬라이드 편집기 (FreeShow 방식)
 * - 왼쪽: 이 순서의 슬라이드 목록 (맨 위 '공통' = 모든 슬라이드에 적용)
 * - 가운데: 실제 화면 모양 캔버스. 글상자를 끌어 옮기고 모서리로 크기 조절, 더블클릭으로 글 고치기
 * - 오른쪽: 고른 글상자·그림·도형의 꾸미기 (크기·색·정렬·상자·위치), 슬라이드 배경
 * - 글 내용을 고치면 순서의 가사·공지 글에 그대로 반영 (라이브러리 찬양이면 라이브러리에도)
 * 편집 내용은 큐시트 순서의 edits 에 저장된다 (코어 slideedit.js 참고)
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const R = window.BCRender;
  const SL = window.BCSlides;
  const Cue = () => window.BCCue;
  const EDITABLE = ['song', 'text', 'title'];
  const r1 = n => Math.round(n * 10) / 10;

  const S = { i: -1, key: '*', out: 'main', sel: 'main', undo: [], redo: [], dirty: false, timer: 0, drag: null, editing: null };
  const item = () => Cue() && Cue().item(S.i);
  const tpl = () => app.tplFor(S.out, Cue().tplOf(S.i));

  // ---------------- 슬라이드 목록 (원래 가사·글 덩어리) ----------------
  function sources() {
    const it = item();
    if (!it) return [];
    if (it.type === 'title') return [{ key: '0', label: '제목', slide: { kind: 'title', ref: it.title, subtitle: it.subtitle || '', label: '제목', parts: [], src: 0 } }];
    const ref = it.type === 'text' || it.showTitle ? it.title : '';
    const chunks = it.type === 'song' ? SL.lyricsChunks(it.lyrics) : SL.textChunks(it.body);
    let group = '';
    return chunks.map(c => {
      if (c.label) group = c.label;
      const label = c.label || (group ? group + ' (이어서)' : String(c.src + 1));
      return { key: String(c.src), label, slide: { kind: 'text', ref, title: ref, label, parts: [{ book: 0, chapter: 0, verse: 0, text: c.text }], src: c.src } };
    });
  }
  /** 화면에 그릴 슬라이드 (공통·이 슬라이드 편집 합침) */
  function effSlide(src, key) {
    const it = item();
    const e = SL.mergeEdit(it.edits, key === '*' ? null : key);
    const s = { ...src.slide, bg: it.bg || '' };
    if (e) { if (e.bg) s.bg = e.bg; delete e.bg; s.edit = e; }
    return s;
  }
  const curSource = () => { const list = sources(); return list.find(x => x.key === S.key) || list[0]; };
  const effEdit = () => SL.mergeEdit(item().edits, S.key === '*' ? null : S.key) || {};
  /** 지금 고르고 있는 슬라이드의 편집 (없으면 만든다) */
  function raw(create = true) {
    const it = item();
    if (!it.edits) { if (!create) return {}; it.edits = {}; }
    if (!it.edits[S.key]) { if (!create) return {}; it.edits[S.key] = {}; }
    return it.edits[S.key];
  }
  /** 비어 있는 편집 정리 */
  function clean() {
    const it = item();
    if (!it.edits) return;
    for (const k of Object.keys(it.edits)) {
      const e = it.edits[k];
      if (e.style && !Object.keys(e.style).length) delete e.style;
      if (e.items && !e.items.length) delete e.items;
      if (!e.bg) delete e.bg;
      if (!e.hideMain) delete e.hideMain;
      if (!e.allOutputs) delete e.allOutputs;
      if (!e.box) delete e.box;
      if (!Object.keys(e).length) delete it.edits[k];
    }
    if (!Object.keys(it.edits).length) delete it.edits;
  }

  // ---------------- 실행 취소 · 저장 ----------------
  function snapshot() { const it = item(); return JSON.stringify({ edits: it.edits || null, lyrics: it.lyrics, body: it.body, title: it.title, subtitle: it.subtitle }); }
  function begin() { S.undo.push(snapshot()); if (S.undo.length > 100) S.undo.shift(); S.redo = []; }
  function restore(snap) {
    const it = item();
    const o = JSON.parse(snap);
    if (o.edits) it.edits = o.edits; else delete it.edits;
    for (const k of ['lyrics', 'body', 'title', 'subtitle']) if (o[k] !== undefined) it[k] = o[k];
    commit({ lyrics: true, list: true });
  }
  function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); }
  function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); }
  /** 저장(모아서) + 다시 그리기 */
  function commit({ lyrics = false, list = true } = {}) {
    clean();
    S.lyricsDirty = S.lyricsDirty || lyrics;
    clearTimeout(S.timer);
    S.timer = setTimeout(flush, 300);
    draw({ list });
  }
  function flush() {
    clearTimeout(S.timer);
    if (S.i < 0 || !item()) return;
    Cue().updateItem(S.i, () => {}, { lyrics: S.lyricsDirty });
    S.lyricsDirty = false;
  }

  // ---------------- 그리기 ----------------
  function draw({ list = true } = {}) {
    if ($('#se').hidden || !item()) return;
    if (list) drawList();
    drawCanvas();
    drawProps();
  }

  function drawList() {
    const it = item();
    const list = sources();
    const own = k => !!(it.edits && it.edits[k]);
    $('#seList').innerHTML = `<div class="se-slide ${S.key === '*' ? 'on' : ''}" data-key="*"><div class="screen se-thumb"></div><div class="se-cap"><b>공통</b> 모든 슬라이드${own('*') ? ' <span class="se-dot" title="꾸민 것 있음">●</span>' : ''}</div></div>`
      + list.map((x, n) => `<div class="se-slide ${S.key === x.key ? 'on' : ''}" data-key="${x.key}"${window.BCGroup && window.BCGroup.color(x.label) ? ` style="--gc:${window.BCGroup.color(x.label)}"` : ''}><div class="screen se-thumb"></div><div class="se-cap"><b>${n + 1}</b> ${esc(x.label)}${own(x.key) ? ' <span class="se-dot" title="이 슬라이드만 꾸민 것 있음">●</span>' : ''}</div></div>`).join('');
    const t = tpl();
    $('#seList').querySelectorAll('.se-slide').forEach(c => {
      const k = c.dataset.key;
      const src = k === '*' ? list[0] : list.find(x => x.key === k);
      if (src) R.renderInto(c.querySelector('.se-thumb'), effSlide(src, k), t, { checker: true });
    });
  }

  /** 본문 글상자 위치 (화면 %) */
  function mainRect(t, e) {
    if (e.box) return { ...e.box };
    const c = R.contentRect(t);
    return { x: c.left / t.width * 100, y: c.top / t.height * 100, w: c.width / t.width * 100, h: c.height / t.height * 100 };
  }

  function drawCanvas() {
    const t = tpl();
    const wrap = $('#seWrap');
    const center = $('#seCenter');
    const s = Math.max(0.1, Math.min((center.clientWidth - 40) / t.width, (center.clientHeight - 70) / t.height));
    S.scale = s;
    wrap.style.width = Math.round(t.width * s) + 'px';
    wrap.style.height = Math.round(t.height * s) + 'px';
    const src = curSource();
    if (!src) { $('#seRender').innerHTML = ''; $('#seHandles').innerHTML = ''; $('#seHint').textContent = '이 순서에는 아직 내용이 없습니다. 편집칸에서 가사·내용을 먼저 쓰세요.'; return; }
    R.renderInto($('#seRender'), effSlide(src, S.key), t, { checker: true });
    // 손잡이: 본문 + 덧붙인 것 (공통 것은 '공통' 에서만 고칠 수 있음)
    const e = effEdit();
    const common = new Set(S.key !== '*' && item().edits && item().edits['*'] ? (item().edits['*'].items || []).map(x => x.id) : []);
    const box = (id, r, label, cls) => `<div class="se-box ${cls} ${S.sel === id ? 'sel' : ''}" data-id="${esc(id)}" style="left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%"><span class="se-tag">${esc(label)}</span>`
      + (S.sel === id && !cls.includes('locked') ? ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(h => `<i class="se-h" data-h="${h}"></i>`).join('') : '') + '</div>';
    const items = e.items || [];
    $('#seHandles').innerHTML = items.filter(x => x.below).map(x => box(x.id, x, NAMES[x.type], common.has(x.id) ? 'locked' : '')).join('')
      + box('main', mainRect(t, e), e.hideMain ? '본문 (숨김)' : '본문', 'main' + (e.hideMain ? ' hid' : ''))
      + items.filter(x => !x.below).map(x => box(x.id, x, NAMES[x.type], common.has(x.id) ? 'locked' : '')).join('')
      + '<div class="se-guide v" hidden></div><div class="se-guide h" hidden></div>';
    const obsNote = S.out === 'overlay' && R.lyricsOnly(t) && !e.allOutputs;
    $('#seHint').innerHTML = obsNote ? '⚠ OBS 자막(투명) 출력에는 글 내용만 반영됩니다. 위치·꾸미기도 쓰려면 오른쪽 \'OBS 자막에도 적용\' 을 켜세요.'
      : S.key === '*' ? '공통: 여기서 바꾼 위치·꾸미기는 모든 슬라이드에 적용됩니다 (슬라이드에서 따로 바꾼 것이 우선)'
        : '끌어서 옮기기 · 모서리로 크기 · 더블클릭: 글 고치기 · Delete: 지우기 · 방향키: 미세 이동 · Ctrl+Z: 되돌리기';
  }
  const NAMES = { text: '글상자', image: '그림', shape: '도형', camera: '카메라' };

  // ---------------- 오른쪽 속성 ----------------
  const field = (label, html) => `<label>${label}</label><div class="se-row">${html}</div>`;
  const numIn = (p, v, a, b, step = 1, w = 70) => `<input type="number" data-p="${p}" value="${v}" min="${a}" max="${b}" step="${step}" style="width:${w}px">`;
  const colIn = (p, v) => `<input type="color" data-p="${p}" value="${/^#[0-9a-f]{6}$/i.test(v || '') ? v : '#ffffff'}">`;
  const tog = (p, on, label, title = '') => `<button type="button" class="se-tog ${on ? 'on' : ''}" data-tog="${p}" title="${title}">${label}</button>`;
  const seg = (p, cur, opts) => `<span class="view-tabs">${opts.map(([v, l]) => `<button type="button" data-set="${p}" data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</span>`;
  const posFields = r => field('위치 (%)', `X ${numIn('pos.x', r1(r.x), -50, 150, 0.5, 62)} Y ${numIn('pos.y', r1(r.y), -50, 150, 0.5, 62)}`) + field('크기 (%)', `너비 ${numIn('pos.w', r1(r.w), 1, 200, 0.5, 62)} 높이 ${numIn('pos.h', r1(r.h), 1, 200, 0.5, 62)}`);

  function drawProps() {
    const it = item();
    const t = tpl();
    const e = effEdit();
    const own = raw(false);
    const src = curSource();
    const k = t.height / 1080;
    let h = `<h4>${S.key === '*' ? '공통 (모든 슬라이드)' : `슬라이드: ${esc(src ? src.label : '')}`}</h4><div class="form se-form">`
      + field('배경', `${own.bg ? `<span class="se-bgname" title="${esc(own.bg)}">${own.bg.startsWith('#') ? `<i class="se-sw" style="background:${esc(own.bg)}"></i>` : '🖼'}</span>` : `<span class="muted">${S.key !== '*' && e.bg ? '공통 배경' : it.bg ? '순서 배경' : '템플릿'}</span>`}<button type="button" data-a="bgpick">그림·영상…</button>${colIn('bgcolor', own.bg && own.bg.startsWith('#') ? own.bg : '#000000')}${own.bg ? '<button type="button" data-a="bgclear">지우기</button>' : ''}`)
      + field('', `<label class="tc-toggle"><input type="checkbox" data-chk="hideMain" ${own.hideMain ? 'checked' : ''}> 본문 글 숨기기</label>`)
      + field('', `<label class="tc-toggle"><input type="checkbox" data-chk="allOutputs" ${own.allOutputs ? 'checked' : ''}> OBS 자막(투명)에도 위치·꾸미기 적용</label>`)
      + '</div>';
    if (S.sel === 'main') {
      const st = e.style || {};
      const size = st.size || Math.round(t.font.size / k);
      const boxOn = !!st.boxColor;
      h += `<h4>본문 글상자</h4><div class="form se-form">`;
      if (S.key !== '*' && src) {
        h += it.type === 'title'
          ? field('제목', `<input type="text" data-content="title" value="${esc(it.title)}">`) + field('부제', `<input type="text" data-content="subtitle" value="${esc(it.subtitle || '')}">`)
          : field('글', `<textarea data-content="text" rows="5">${esc(src.slide.parts[0].text)}</textarea>`);
      } else h += field('글', '<span class="muted">글은 각 슬라이드에서 고칩니다</span>');
      h += field('글자 크기', `${numIn('style.size', size, 8, 400, 1)} px <label class="tc-toggle" title="상자에 안 들어가면 글자를 줄입니다"><input type="checkbox" data-chk="style.autoFit" ${st.autoFit === false ? '' : 'checked'}> 넘치면 줄이기</label>`)
        + field('글자', `${colIn('style.color', st.color || t.font.color)}${tog('style.bold', st.bold ?? Number(t.font.weight) >= 600, '<b>굵게</b>')}${tog('style.italic', !!st.italic, '<i>기울임</i>')}${tog('style.shadow', st.shadow ?? !!(t.shadow && t.shadow.enabled), '그림자')}`)
        + field('가로 정렬', seg('style.align', st.align || (t.align === 'hanging' ? 'left' : t.align), [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']]))
        + field('세로 정렬', seg('style.valign', st.valign || t.valign, [['top', '위'], ['middle', '가운데'], ['bottom', '아래']]))
        + field('줄 간격', numIn('style.lineHeight', st.lineHeight || t.font.lineHeight, 0.8, 3, 0.05))
        + field('글 상자', `<label class="tc-toggle"><input type="checkbox" data-chk="boxOn" ${boxOn ? 'checked' : ''}> 색 상자</label>${boxOn ? `${colIn('style.boxColor', st.boxColor)} 투명도 <input type="range" data-p="style.boxOpacity" min="0" max="1" step="0.05" value="${st.boxOpacity ?? 0.6}"> 모서리 ${numIn('style.radius', st.radius ?? 12, 0, 400, 1, 56)}` : ''}`)
        + posFields(mainRect(t, e))
        + field('', `<button type="button" data-a="mainreset" title="위치를 템플릿 본문 영역으로">템플릿 위치로</button><button type="button" data-a="stylereset" title="글자·정렬·상자 꾸미기를 템플릿대로">꾸미기 초기화</button>`)
        + '</div>';
    } else {
      const x = (e.items || []).find(z => z.id === S.sel);
      if (x) {
        const mine = (own.items || []).some(z => z.id === x.id);
        h += `<h4>${NAMES[x.type]}${mine ? '' : ' <span class="muted">(공통 — \'공통\' 에서 고치세요)</span>'}</h4><div class="form se-form ${mine ? '' : 'se-locked'}">`;
        if (x.type === 'text') {
          h += field('글', `<textarea data-p="item.text" rows="4">${esc(x.text)}</textarea>`)
            + field('글자 크기', `${numIn('item.size', x.size, 8, 400)} px`)
            + field('글자', `${colIn('item.color', x.color)}${tog('item.bold', x.bold, '<b>굵게</b>')}${tog('item.italic', x.italic, '<i>기울임</i>')}`)
            + field('가로 정렬', seg('item.align', x.align, [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']]))
            + field('세로 정렬', seg('item.valign', x.valign, [['top', '위'], ['middle', '가운데'], ['bottom', '아래']]))
            + field('바탕 색', `<label class="tc-toggle"><input type="checkbox" data-chk="item.fillOn" ${x.fill ? 'checked' : ''}> 색 칠하기</label>${x.fill ? colIn('item.fill', x.fill) : ''}`);
        } else if (x.type === 'camera') {
          h += field('카메라', `📷 ${esc(x.label || '')}`)
            + field('맞춤', seg('item.fit', x.fit, [['cover', '꽉 채우기'], ['contain', '전체 보이기']]));
        } else if (x.type === 'image') {
          h += field('그림', `<button type="button" data-a="imgpick">🖼 ${x.src ? '바꾸기' : '고르기'}…</button>`)
            + field('맞춤', seg('item.fit', x.fit, [['cover', '꽉 채우기'], ['contain', '전체 보이기']]));
        } else {
          h += field('채우기', `${colIn('item.fill', x.fill)}<label class="tc-toggle"><input type="checkbox" data-chk="item.ellipse" ${x.ellipse ? 'checked' : ''}> 타원</label>`);
        }
        h += field('투명도', `<input type="range" data-p="item.opacity" min="0.05" max="1" step="0.05" value="${x.opacity}">`)
          + (x.type !== 'shape' || !x.ellipse ? field('모서리', numIn('item.radius', x.radius, 0, 1000)) : '')
          + posFields(x)
          + field('', `<button type="button" data-a="layer">${x.below ? '본문 글 앞으로' : '본문 글 뒤로'}</button><button type="button" data-a="dupitem">복제 (Ctrl+D)</button><button type="button" data-a="delitem" class="danger">지우기</button>`)
          + '</div>';
      }
    }
    h += `<div class="se-foot">${S.key !== '*' ? '<button type="button" data-a="tocommon" title="이 슬라이드의 위치·꾸미기를 공통으로 옮겨 모든 슬라이드에 적용">이 꾸미기를 모든 슬라이드에</button>' : ''}<button type="button" data-a="reset" class="danger">${S.key === '*' ? '공통 꾸미기 지우기' : '이 슬라이드 초기화'}</button></div>`;
    $('#seProps').innerHTML = h;
  }

  // ---------------- 값 바꾸기 ----------------
  function target() {
    if (S.sel === 'main') return null;
    return (raw(false).items || []).find(z => z.id === S.sel) || null;
  }
  /** 속성 경로(p) 에 값 넣기: style.* / item.* / pos.* */
  function setProp(p, v) {
    const [grp, key] = p.split('.');
    if (grp === 'style') { const e = raw(); e.style = e.style || {}; if (v === null) delete e.style[key]; else e.style[key] = v; return; }
    if (grp === 'item') { const x = target(); if (x) { if (v === null) delete x[key]; else x[key] = v; } return; }
    if (grp === 'pos') {
      if (S.sel === 'main') { const e = raw(); e.box = e.box || mainRect(tpl(), effEdit()); e.box[key] = v; } else { const x = target(); if (x) x[key] = v; }
    }
  }
  function readVal(el) {
    if (el.type === 'number' || el.type === 'range') { const n = parseFloat(el.value); return Number.isFinite(n) ? n : null; }
    return el.value;
  }

  // ---------------- 글 고치기 (가사·공지 글에 반영) ----------------
  function setText(text) {
    const it = item();
    const src = curSource();
    if (!src || S.key === '*') return;
    if (!String(text).trim()) { app.showMsg('빈 슬라이드는 만들 수 없습니다. 슬라이드를 없애려면 가사·내용에서 지우세요.', 'info', 3000); return; }
    begin();
    if (it.type === 'song') it.lyrics = SL.setLyricsChunk(it.lyrics, src.slide.src, text);
    else if (it.type === 'text') it.body = SL.setTextChunk(it.body, src.slide.src, text);
    else { const [a, ...b] = String(text).split('\n'); it.title = a.trim() || it.title; it.subtitle = b.join(' ').trim(); }
    commit({ lyrics: true });
  }
  /** 캔버스 위에서 바로 고치기 */
  function inlineEdit(id) {
    const it = item();
    const e = effEdit();
    const t = tpl();
    const k = t.height / 1080;
    let r, text, size, align;
    if (id === 'main') {
      if (S.key === '*') return app.showMsg('글은 각 슬라이드에서 고칩니다 (왼쪽 목록에서 슬라이드를 고르세요).', 'info', 2500);
      const src = curSource();
      r = mainRect(t, e);
      text = it.type === 'title' ? [it.title, it.subtitle || ''].filter(Boolean).join('\n') : src.slide.parts[0].text;
      size = ((e.style && e.style.size) || t.font.size / k) * k;
      align = (e.style && e.style.align) || (t.align === 'hanging' ? 'left' : t.align);
    } else {
      const x = target();
      if (!x || x.type !== 'text') return;
      r = x; text = x.text; size = x.size * k; align = x.align;
    }
    const ta = document.createElement('textarea');
    ta.className = 'se-inline';
    ta.value = text;
    ta.style.cssText = `left:${r.x}%;top:${r.y}%;width:${r.w}%;height:${r.h}%;font-size:${Math.max(11, size * S.scale)}px;text-align:${align};font-family:${t.font.family}`;
    $('#seHandles').appendChild(ta);
    S.editing = ta;
    ta.focus();
    ta.select();
    const done = ok => {
      if (S.editing !== ta) return;
      S.editing = null;
      const v = ta.value;
      ta.remove();
      if (!ok || v === text) return draw({ list: false });
      if (id === 'main') setText(v);
      else { begin(); target().text = v; commit(); }
    };
    ta.addEventListener('blur', () => done(true));
    ta.addEventListener('keydown', ev => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); done(true); }
    });
  }

  // ---------------- 덧붙이기 ----------------
  const newId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  function addItem(type, extra = {}) {
    begin();
    const e = raw();
    e.items = e.items || [];
    const x = { id: newId(), type, x: 30, y: 35, w: 40, h: 20, opacity: 1, radius: 0, below: type === 'shape', ...extra };
    if (type === 'text') Object.assign(x, { text: '새 글상자', size: 60, color: '#ffffff', fill: '', bold: true, italic: false, align: 'center', valign: 'middle', padding: 12 });
    if (type === 'image') Object.assign(x, { src: '', fit: 'contain', x: 35, y: 25, w: 30, h: 40 });
    if (type === 'shape') Object.assign(x, { fill: '#1d3557', ellipse: false, x: 0, y: 72, w: 100, h: 28, opacity: 0.85 });
    Object.assign(x, extra); // 놓은 자리·고른 그림이 기본값보다 우선
    e.items.push(x);
    S.sel = x.id;
    commit();
    return x;
  }
  function delSelected() {
    const e = raw(false);
    if (S.sel === 'main' || !e.items || !e.items.some(z => z.id === S.sel)) return;
    begin();
    e.items = e.items.filter(z => z.id !== S.sel);
    S.sel = 'main';
    commit();
  }
  function dupSelected() {
    const x = target();
    if (!x) return;
    begin();
    const c = { ...structuredClone(x), id: newId(), x: x.x + 2, y: x.y + 2 };
    raw().items.push(c);
    S.sel = c.id;
    commit();
  }

  // ---------------- 끌기 (옮기기·크기) ----------------
  const SNAP = 1.2; // %
  function snap(v, guides) { for (const g of guides) if (Math.abs(v - g) < SNAP) return { v: g, g }; return { v, g: null }; }
  function onPointerDown(ev) {
    if (S.editing) return;
    const boxEl = ev.target.closest('.se-box');
    if (!boxEl) { if (ev.target.closest('#seWrap')) { S.sel = 'main'; draw({ list: false }); } return; }
    const id = boxEl.dataset.id;
    if (boxEl.classList.contains('locked')) { S.sel = id; draw({ list: false }); return; }
    if (S.sel !== id) { S.sel = id; draw({ list: false }); }
    const handle = ev.target.closest('.se-h');
    const t = tpl();
    const e = effEdit();
    const start = id === 'main' ? mainRect(t, e) : { ...(e.items || []).find(z => z.id === id) };
    const wrapR = $('#seWrap').getBoundingClientRect();
    S.drag = { id, h: handle ? handle.dataset.h : '', x0: ev.clientX, y0: ev.clientY, start, W: wrapR.width, H: wrapR.height, moved: false };
    ev.preventDefault();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  }
  function onPointerMove(ev) {
    const d = S.drag;
    if (!d) return;
    const dx = (ev.clientX - d.x0) / d.W * 100, dy = (ev.clientY - d.y0) / d.H * 100;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 0.4) return;
    if (!d.moved) { d.moved = true; begin(); }
    let { x, y, w, h } = d.start;
    let gv = null, gh = null;
    if (!d.h) {
      x += dx; y += dy;
      if (!ev.altKey) { // 가운데·가장자리에 붙이기 (Alt 누르면 안 붙음)
        const sx = [snap(x, [0, 50]), snap(x + w / 2, [50]), snap(x + w, [50, 100])].find(s => s.g !== null);
        if (sx) { x = sx.g === 50 && Math.abs(x + w / 2 - 50) < SNAP ? 50 - w / 2 : Math.abs(x - sx.g) < SNAP ? sx.g : sx.g - w; gv = sx.g; }
        const sy = [snap(y, [0, 50]), snap(y + h / 2, [50]), snap(y + h, [50, 100])].find(s => s.g !== null);
        if (sy) { y = sy.g === 50 && Math.abs(y + h / 2 - 50) < SNAP ? 50 - h / 2 : Math.abs(y - sy.g) < SNAP ? sy.g : sy.g - h; gh = sy.g; }
      }
    } else {
      if (d.h.includes('e')) w = Math.max(2, w + dx);
      if (d.h.includes('s')) h = Math.max(2, h + dy);
      if (d.h.includes('w')) { const nw = Math.max(2, w - dx); x += w - nw; w = nw; }
      if (d.h.includes('n')) { const nh = Math.max(2, h - dy); y += h - nh; h = nh; }
      if (ev.shiftKey && d.start.w && d.start.h) { const ratio = d.start.w / d.start.h; h = w / ratio; } // Shift: 비율 유지
    }
    const r = { x: r1(x), y: r1(y), w: r1(w), h: r1(h) };
    if (d.id === 'main') raw().box = r; else Object.assign(target() || {}, r);
    drawCanvas();
    const v = $('#seHandles .se-guide.v'), hz = $('#seHandles .se-guide.h');
    if (v) { v.hidden = gv === null; if (gv !== null) v.style.left = gv + '%'; }
    if (hz) { hz.hidden = gh === null; if (gh !== null) hz.style.top = gh + '%'; }
  }
  function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove);
    const d = S.drag;
    S.drag = null;
    if (d && d.moved) commit({ list: true });
  }

  // ---------------- 열기·닫기 ----------------
  function open(i, key) {
    const it = Cue() && Cue().item(i);
    if (!it) return app.showMsg('큐시트에서 순서를 먼저 고르세요.', 'info', 2000);
    if (!EDITABLE.includes(it.type)) return app.showMsg('슬라이드 편집은 찬양·공지·제목 순서에서 쓸 수 있습니다.', 'info', 3000);
    S.i = i; S.undo = []; S.redo = []; S.sel = 'main';
    const list = sources();
    S.key = key != null && (key === '*' || list.some(x => x.key === String(key))) ? String(key) : (list[0] ? list[0].key : '*');
    const el = $('#se');
    el.style.top = (document.querySelector('.menubar')?.getBoundingClientRect().bottom || 0) + 'px';
    el.hidden = false;
    $('#seTitle').textContent = `슬라이드 편집 — ${i + 1}. ${it.title}`;
    draw();
    el.focus();
  }
  /** 미리보기의 k 번째 슬라이드를 편집 (격자·목록에서) */
  function openPreviewSlide(k) {
    const p = app.preview;
    if (!p || !p.cue) return app.showMsg('큐시트 순서의 슬라이드만 편집할 수 있습니다.', 'info', 2500);
    const s = p.slides[k];
    open(p.cue.index, s && s.src != null ? s.src : undefined);
  }
  function close() {
    if (S.editing) S.editing.blur();
    flush();
    $('#se').hidden = true;
  }

  function init() {
    document.body.insertAdjacentHTML('beforeend', `<div id="se" class="se" tabindex="-1" hidden>
      <div class="se-top"><b id="seTitle">슬라이드 편집</b>
        <span class="se-tools"><button data-add="text" title="글상자 덧붙이기">＋ 글상자</button><button data-add="image" title="그림·영상 덧붙이기">＋ 그림</button><button data-add="shape" title="색 도형 (띠·상자) 덧붙이기">＋ 도형</button><button data-add="camera" title="카메라 화면 상자 (예: 설교자 화면 + 자막)">＋ 카메라</button>
        <span class="sep"></span><button data-a="undo" title="되돌리기 (Ctrl+Z)">↶</button><button data-a="redo" title="다시 하기 (Ctrl+Y)">↷</button>
        <span class="sep"></span><span class="view-tabs" id="seOut" title="어느 출력 모양으로 보며 편집할지"><button data-out="main" class="on">예배당</button><button data-out="overlay">OBS 자막</button></span></span>
        <span class="grow"></span><button data-a="close" class="primary" title="저장하고 닫기 (Esc)">완료</button></div>
      <div class="se-body">
        <aside id="seList" class="se-list"></aside>
        <main id="seCenter" class="se-center"><div id="seWrap" class="se-wrap"><div id="seRender" class="se-render"></div><div id="seHandles" class="se-handles"></div></div><div id="seHint" class="se-hint"></div></main>
        <aside id="seProps" class="se-props"></aside>
      </div></div>`);
    const el = $('#se');
    el.addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.add) {
        if (b.dataset.add === 'image') { if (window.BCLib) window.BCLib.pickImage(url => addItem('image', { src: url })); }
        else if (b.dataset.add === 'camera') { if (window.BCCue) window.BCCue.pickCam(c => addItem('camera', { deviceId: c.deviceId, label: c.label, x: 55, y: 8, w: 40, h: 40, fit: 'cover' })); }
        else addItem(b.dataset.add);
        return;
      }
      if (b.dataset.out) { S.out = b.dataset.out; $('#seOut').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); draw(); return; }
      if (b.dataset.tog) { begin(); const [g, k] = b.dataset.tog.split('.'); const cur = b.classList.contains('on'); setProp(`${g}.${k}`, !cur); commit({ list: false }); return; }
      if (b.dataset.set) { begin(); setProp(b.dataset.set, b.dataset.v); commit({ list: false }); return; }
      const e = () => raw();
      switch (b.dataset.a) {
        case 'close': close(); break;
        case 'undo': undo(); break;
        case 'redo': redo(); break;
        case 'bgpick': if (window.BCLib) window.BCLib.pickImage(url => { begin(); e().bg = url; commit(); }); break;
        case 'bgclear': begin(); delete e().bg; commit(); break;
        case 'imgpick': if (window.BCLib) window.BCLib.pickImage(url => { begin(); const x = target(); if (x) x.src = url; commit(); }); break;
        case 'mainreset': begin(); delete e().box; commit(); break;
        case 'stylereset': begin(); delete e().style; commit(); break;
        case 'layer': { begin(); const x = target(); if (x) x.below = !x.below; commit(); break; }
        case 'dupitem': dupSelected(); break;
        case 'delitem': delSelected(); break;
        case 'tocommon': {
          begin();
          const it = item();
          const mine = it.edits && it.edits[S.key];
          if (!mine) break;
          const c = it.edits['*'] = it.edits['*'] || {};
          if (mine.box) c.box = mine.box;
          if (mine.style) c.style = { ...(c.style || {}), ...mine.style };
          if (mine.allOutputs) c.allOutputs = true;
          delete mine.box; delete mine.style;
          commit();
          app.showMsg('이 꾸미기를 모든 슬라이드에 적용했습니다.', 'ok', 1800);
          break;
        }
        case 'reset': begin(); if (item().edits) delete item().edits[S.key]; S.sel = 'main'; commit(); break;
      }
    });
    // 속성 입력: 바꾸는 동안 캔버스만, 다 바꾸면 저장
    el.addEventListener('input', ev => {
      const t = ev.target;
      if (!t.dataset.p && !t.dataset.content) return;
      if (t.dataset.content) return; // 글은 change 때
      if (!S.dirty) { begin(); S.dirty = true; }
      const p = t.dataset.p;
      if (p === 'bgcolor') { raw().bg = t.value; }
      else setProp(p, readVal(t));
      drawCanvas();
    });
    el.addEventListener('change', ev => {
      const t = ev.target;
      if (t.dataset.content) {
        if (t.dataset.content === 'text') setText(t.value);
        else { begin(); item()[t.dataset.content] = t.value; commit({ lyrics: false }); }
        return;
      }
      if (t.dataset.chk) {
        begin();
        const c = t.dataset.chk;
        if (c === 'hideMain' || c === 'allOutputs') raw()[c] = t.checked;
        else if (c === 'boxOn') setProp('style.boxColor', t.checked ? '#000000' : null);
        else if (c === 'item.fillOn') setProp('item.fill', t.checked ? '#000000' : '');
        else setProp(c, t.checked);
        commit({ list: false });
        return;
      }
      if (t.dataset.p) { S.dirty = false; commit({ list: t.dataset.p === 'bgcolor' }); }
    });
    $('#seList').addEventListener('click', ev => {
      const c = ev.target.closest('.se-slide');
      if (!c) return;
      S.key = c.dataset.key; S.sel = 'main';
      draw();
    });
    $('#seWrap').addEventListener('pointerdown', onPointerDown);
    $('#seWrap').addEventListener('dblclick', ev => { const b = ev.target.closest('.se-box'); if (b && !b.classList.contains('locked')) inlineEdit(b.dataset.id); });
    el.addEventListener('keydown', ev => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
      const ctrl = ev.ctrlKey || ev.metaKey;
      if (ev.key === 'Escape' && !typing) { ev.preventDefault(); close(); return; }
      if (ctrl && ev.key.toLowerCase() === 'z' && !typing) { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
      if (ctrl && ev.key.toLowerCase() === 'y' && !typing) { ev.preventDefault(); redo(); return; }
      if (typing) return;
      if (ctrl && ev.key.toLowerCase() === 'd') { ev.preventDefault(); dupSelected(); return; }
      if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); delSelected(); return; }
      if (ev.key === 'Enter' || ev.key === 'F2') { ev.preventDefault(); inlineEdit(S.sel); return; }
      if (ev.key === 'PageDown' || ev.key === 'PageUp') {
        ev.preventDefault();
        const keys = ['*', ...sources().map(x => x.key)];
        const n = keys.indexOf(S.key) + (ev.key === 'PageDown' ? 1 : -1);
        if (n >= 0 && n < keys.length) { S.key = keys[n]; S.sel = 'main'; draw(); }
        return;
      }
      const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
      if (arrow) {
        ev.preventDefault();
        const step = ev.shiftKey ? 5 : 0.5;
        begin();
        if (S.sel === 'main') { const e = raw(); e.box = e.box || mainRect(tpl(), effEdit()); e.box.x = r1(e.box.x + arrow[0] * step); e.box.y = r1(e.box.y + arrow[1] * step); }
        else { const x = target(); if (x) { x.x = r1(x.x + arrow[0] * step); x.y = r1(x.y + arrow[1] * step); } }
        commit({ list: false });
      }
      ev.stopPropagation();
    });
    // 다른 단축키가 편집기 밖으로 새지 않게 (F6·F9 등은 그대로 둔다)
    window.addEventListener('keydown', ev => {
      if (!$('#se').hidden || !(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== 'e' || ev.shiftKey || ev.altKey) return;
      // Ctrl+E: 고른 순서의 지금 미리보기 슬라이드 편집
      ev.preventDefault();
      const p = app.preview;
      if (p && p.cue) openPreviewSlide(p.index);
      else if (Cue() && Cue().selIndex() >= 0) open(Cue().selIndex());
      else app.showMsg('큐시트에서 찬양·공지·제목 순서를 고르세요.', 'info', 2000);
    }, true);
    window.addEventListener('resize', () => { if (!$('#se').hidden) draw({ list: false }); });
  }

  /** 바깥에서 끌어다 놓은 그림·영상: 놓은 자리에 덧붙이기 */
  function dropImage(url, cx, cy) {
    const r = $('#seWrap').getBoundingClientRect();
    const inside = cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    const w = 30, h = 30;
    const x = inside ? Math.max(0, Math.min(100 - w, (cx - r.left) / r.width * 100 - w / 2)) : 35;
    const y = inside ? Math.max(0, Math.min(100 - h, (cy - r.top) / r.height * 100 - h / 2)) : 35;
    addItem('image', { src: url, x: r1(x), y: r1(y), w, h });
  }
  /** 오른쪽 클릭 메뉴 (ctxmenu.js 가 부른다) */
  function menuFor(t) {
    const btn = a => () => { const b = $(`#se [data-a="${a}"]`); if (b) b.click(); };
    const add = [
      { label: '＋ 글상자', run: () => addItem('text') },
      { label: '＋ 그림…', run: () => window.BCLib && window.BCLib.pickImage(url => addItem('image', { src: url })) },
      { label: '＋ 도형 (띠·상자)', run: () => addItem('shape') },
    ];
    const history = [{ label: '되돌리기', key: 'Ctrl+Z', run: undo, disabled: !S.undo.length }, { label: '다시 하기', key: 'Ctrl+Y', run: redo, disabled: !S.redo.length }];
    const slide = t.closest('#seList .se-slide');
    if (slide) {
      S.key = slide.dataset.key; S.sel = 'main'; draw();
      return [{ head: S.key === '*' ? '공통 (모든 슬라이드)' : '슬라이드' },
        { label: '이 꾸미기를 모든 슬라이드에', run: btn('tocommon'), disabled: S.key === '*' || !raw(false).box && !raw(false).style },
        { label: S.key === '*' ? '공통 꾸미기 지우기' : '이 슬라이드 초기화', run: btn('reset'), danger: true }];
    }
    const box = t.closest('#seHandles .se-box');
    if (box && !box.classList.contains('locked')) {
      const id = box.dataset.id;
      if (S.sel !== id) { S.sel = id; draw({ list: false }); }
      if (id === 'main') {
        return [{ head: '본문 글상자' },
          { label: '글 고치기', key: 'Enter · 더블클릭', run: () => inlineEdit('main'), disabled: S.key === '*' },
          { label: '템플릿 위치로', run: btn('mainreset') },
          { label: '꾸미기 초기화', run: btn('stylereset') },
          '-', ...add, '-', ...history];
      }
      const x = target();
      return [{ head: NAMES[x ? x.type : 'text'] },
        ...(x && x.type === 'text' ? [{ label: '글 고치기', key: 'Enter · 더블클릭', run: () => inlineEdit(id) }] : []),
        ...(x && x.type === 'image' ? [{ label: '그림 바꾸기…', run: btn('imgpick') }] : []),
        { label: '복제', key: 'Ctrl+D', run: dupSelected },
        { label: x && x.below ? '본문 글 앞으로' : '본문 글 뒤로', run: btn('layer') },
        { label: '지우기', key: 'Delete', run: delSelected, danger: true },
        '-', ...history];
    }
    if (t.closest('#seCenter')) return [{ head: '덧붙이기' }, ...add, '-', ...history, '-', { label: '완료 (닫기)', key: 'Esc', run: close }];
    return [];
  }
  window.BCSlideEdit = { init, open, openPreviewSlide, close, dropImage, menuFor, isOpen: () => !$('#se').hidden };
})();
