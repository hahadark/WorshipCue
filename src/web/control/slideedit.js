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
  const EDITABLE = ['song', 'text', 'title', 'bible', 'hymn', 'image', 'video', 'slideshow', 'camera', 'blank'];
  const CHUNK = ['song', 'text', 'title']; // 글 덩어리로 슬라이드가 나뉘는 순서 (글을 바로 고친다)
  const NOTEXT = ['image', 'score', 'video', 'camera', 'blank']; // 본문 글상자가 없는 슬라이드
  const r1 = n => Math.round(n * 10) / 10;

  const S = { i: -1, key: '*', out: 'main', sel: '', base: null, undo: [], redo: [], dirty: false, timer: 0, drag: null, editing: null, multi: new Set(), anchor: '', prev: null, prevKey: null, lasso: null };
  const item = () => Cue() && Cue().item(S.i);
  const tpl = () => app.tplFor(S.out, Cue().tplOf(S.i));

  // ---------------- 슬라이드 목록 (원래 가사·글 덩어리) ----------------
  function sources() {
    const it = item();
    if (!it) return [];
    if (it.type === 'title') return SL.titlePages(it).map((p, k) => { const s = SL.titleSlide(p, k); return { key: String(k), label: s.label, slide: s }; });
    if (!CHUNK.includes(it.type)) {
      if (!S.base) return [];
      return Cue().decorate(it, S.base.map(s => ({ ...s })), { withSkipped: true, noEdits: true }).map(s => ({
        key: s.ekey, slide: s, xid: s.xid || '', base: s.base, skipped: !!s.skipped,
        label: s.xid ? '＋ ' + (s.ref || '덧붙임') : (s.label && !/^\d+$/.test(s.label) ? s.label : '') || s.ref || String(s.base + 1),
      }));
    }
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
    const s = { ...src.slide, bg: src.slide.bg || it.bg || '' };
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
  function snapshot() { const it = item(); return JSON.stringify({ edits: it.edits || null, lyrics: it.lyrics, body: it.body, title: it.title, subtitle: it.subtitle, more: it.more, extra: it.extra || null, skip: it.skip || null }); }
  function begin() { S.undo.push(snapshot()); if (S.undo.length > 100) S.undo.shift(); S.redo = []; }
  function restore(snap) {
    const it = item();
    const o = JSON.parse(snap);
    if (o.edits) it.edits = o.edits; else delete it.edits;
    for (const k of ['lyrics', 'body', 'title', 'subtitle', 'more']) if (o[k] !== undefined) it[k] = o[k];
    for (const k of ['extra', 'skip']) { if (o[k]) it[k] = o[k]; else delete it[k]; }
    commit({ lyrics: true, list: true });
  }
  function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); }
  function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); }
  /** 저장(모아서) + 다시 그리기 */
  // ---------------- 여러 장 고르기: 고른 슬라이드 모두에 같은 꾸미기 ----------------
  const others = () => [...S.multi].filter(k => k !== S.key && k !== '*');
  const multiOn = () => S.key !== '*' && S.multi.size > 1;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** 기준 슬라이드에서 바뀐 것(before → after)만 다른 고른 슬라이드에 그대로 */
  function propagate(before, after) {
    const it = item();
    const ks = others();
    if (!ks.length || !it) return;
    const b = before || {}, a = after || {};
    const fields = new Set([...Object.keys(b), ...Object.keys(a)]);
    for (const k of ks) {
      it.edits = it.edits || {};
      const e = it.edits[k] = it.edits[k] || {};
      for (const f of fields) {
        const bv = b[f], av = a[f];
        if (same(bv, av)) continue;
        if (f === 'items') { // 글상자·그림·도형: id 별로 넣기·바꾸기·빼기
          const bi = new Map((bv || []).map(x => [x.id, x])), ai = new Map((av || []).map(x => [x.id, x]));
          let list = e.items || [];
          for (const id of bi.keys()) if (!ai.has(id)) list = list.filter(x => x.id !== id);
          for (const [id, x] of ai) {
            if (bi.has(id) && same(bi.get(id), x)) continue;
            const j = list.findIndex(y => y.id === id);
            if (j >= 0) list[j] = structuredClone(x); else list.push(structuredClone(x));
          }
          e.items = list;
          continue;
        }
        if ((f === 'style' || f === 'box') && av && typeof av === 'object') { // 바뀐 항목만
          e[f] = e[f] || {};
          for (const s of new Set([...Object.keys(bv || {}), ...Object.keys(av)])) {
            if (same((bv || {})[s], av[s])) continue;
            if (av[s] === undefined) delete e[f][s]; else e[f][s] = structuredClone(av[s]);
          }
          continue;
        }
        if (av === undefined) delete e[f]; else e[f] = structuredClone(av);
      }
    }
  }
  function commit({ lyrics = false, list = true } = {}) {
    if (multiOn() && S.prevKey === S.key) {
      const cur = item().edits ? item().edits[S.key] : undefined;
      if (!same(S.prev, cur)) { propagate(S.prev, cur); list = true; }
    }
    clean();
    S.prev = item() && item().edits && item().edits[S.key] ? structuredClone(item().edits[S.key]) : null;
    S.prevKey = S.key;
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

  /** 목록에서 고르기: one = 한 장 · range = 기준(anchor)부터 여기까지 · toggle = 더하기/빼기 */
  function pickSlides(key, how) {
    S.sel = '';
    if (key === '*') { S.multi.clear(); S.key = '*'; return draw(); }
    const keys = sources().map(x => x.key);
    if (how === 'range' && S.anchor && keys.includes(S.anchor)) {
      const a = keys.indexOf(S.anchor), b = keys.indexOf(key);
      S.multi = new Set(keys.slice(Math.min(a, b), Math.max(a, b) + 1));
      S.key = key;
    } else if (how === 'toggle' && S.key !== '*') {
      const m = new Set(S.multi.size ? S.multi : [S.key]);
      if (m.has(key) && m.size > 1) { m.delete(key); S.multi = m; if (S.key === key) S.key = [...m][0]; }
      else { m.add(key); S.multi = m; S.key = key; }
    } else { S.multi = new Set([key]); S.anchor = key; S.key = key; }
    draw();
  }

  // ---------------- 그리기 ----------------
  function draw({ list = true } = {}) {
    if ($('#se').hidden || !item()) return;
    if (S.key === '*') S.multi.clear();
    else if (!S.multi.has(S.key)) { S.multi = new Set([S.key]); S.anchor = S.key; }
    if (S.prevKey !== S.key) { const e = item().edits && item().edits[S.key]; S.prev = e ? structuredClone(e) : null; S.prevKey = S.key; }
    if (list) drawList();
    drawCanvas();
    drawProps();
  }

  function drawList() {
    const it = item();
    const list = sources();
    const own = k => !!(it.edits && it.edits[k]);
    $('#seList').innerHTML = `<div class="se-slide ${S.key === '*' ? 'on' : ''}" data-key="*"><div class="screen se-thumb bc-nocam"></div><div class="se-cap"><b>공통</b> 모든 슬라이드${own('*') ? ' <span class="se-dot" title="꾸민 것 있음">●</span>' : ''}</div></div>`
      + list.map((x, n) => `<div class="se-slide ${S.key === x.key ? 'on' : ''}${S.multi.size > 1 && S.multi.has(x.key) ? ' msel' : ''}${x.skipped ? ' skipped' : ''}" data-key="${x.key}"${window.BCGroup && window.BCGroup.color(x.label) ? ` style="--gc:${window.BCGroup.color(x.label)}"` : ''}><div class="screen se-thumb bc-nocam"></div><div class="se-cap"><b>${n + 1}</b> ${esc(x.label)}${x.skipped ? ' <span class="muted">(건너뜀)</span>' : ''}${own(x.key) ? ' <span class="se-dot" title="이 슬라이드만 꾸민 것 있음">●</span>' : ''}</div>`
        + (canOps() ? opsHtml(x) : '') + '</div>').join('')
      + (canOps() ? '<button type="button" class="se-addslide" data-op="add" title="고른 슬라이드 다음에 새 슬라이드 (Ctrl+Shift+N)">＋ 슬라이드</button>' : '');
    const t = tpl();
    $('#seList').querySelectorAll('.se-slide').forEach(c => {
      const k = c.dataset.key;
      const src = k === '*' ? list[0] : list.find(x => x.key === k);
      if (src) R.renderInto(c.querySelector('.se-thumb'), effSlide(src, k), t, { checker: true });
    });
  }

  // ---------------- 슬라이드 넣기·복제·지우기·옮기기 (FreeShow 방식) ----------------
  const canOps = () => !!item();
  const chunky = () => CHUNK.includes(item().type);
  /** 목록 단추: 글 순서 = 모두, 그 밖 = 원래 슬라이드는 건너뛰기만, 덧붙인 슬라이드는 모두 */
  function opsHtml(x) {
    if (chunky() || x.xid) return `<span class="se-ops"><button data-op="up" title="위로">▲</button><button data-op="down" title="아래로">▼</button><button data-op="dup" title="복제 (꾸민 것도)">⧉</button><button data-op="del" title="지우기">✕</button></span>`;
    return `<span class="se-ops"><button data-op="del" title="${x.skipped ? '되살리기 (다시 보이기)' : '건너뛰기 (송출에서 빼기, 원래 내용은 그대로)'}">${x.skipped ? '↺' : '⊘'}</button></span>`;
  }
  /** 성경·찬송가·그림 등: 사이에 덧붙인 제목 카드(extra) 넣기·복제·지우기·옮기기, 원래 슬라이드 건너뛰기 */
  function extraOp(op, key) {
    const it = item();
    const list = sources();
    const cur = list.find(x => x.key === (key == null ? S.key : String(key))) || (op === 'add' ? list[list.length - 1] : null);
    if (!cur && op !== 'add') return;
    const ex = (it.extra || []).map(e => ({ ...e }));
    const moveEdits = (from, to) => { if (it.edits && it.edits[from]) { it.edits[to] = structuredClone(it.edits[from]); } };
    if (op === 'del' && !cur.xid) { // 원래 슬라이드: 건너뛰기 ↔ 되살리기
      if (!cur.skipped && list.filter(x => !x.skipped && !x.xid).length <= 1 && !ex.length) return app.showMsg('모든 슬라이드를 건너뛸 수는 없습니다.', 'info', 2500);
      begin();
      const sk = new Set(it.skip || []);
      if (sk.has(cur.base)) sk.delete(cur.base); else sk.add(cur.base);
      if (sk.size) it.skip = [...sk].sort((a, b) => a - b); else delete it.skip;
      return commit({ lyrics: true });
    }
    if ((op === 'up' || op === 'down') && !cur.xid) return app.showMsg('원래 슬라이드(성경·찬송가·그림…)의 순서는 바꿀 수 없습니다. 덧붙인 슬라이드만 옮길 수 있습니다.', 'info', 3000);
    if (op === 'dup' && !cur.xid) return app.showMsg('원래 슬라이드는 복제할 수 없습니다. ＋ 슬라이드로 사이에 새 슬라이드를 넣으세요.', 'info', 3000);
    begin();
    const mkId = () => Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 6);
    // 지금 순서(덧붙인 것 포함)를 바꾼 뒤 각 덧붙임의 at(앞 원래 슬라이드 번호) 를 다시 매긴다
    let seq = list.map(x => x.xid ? { xid: x.xid } : { base: x.base });
    let pick = null;
    const pos = cur ? seq.findIndex(z => (cur.xid ? z.xid === cur.xid : z.base === cur.base)) : seq.length - 1;
    if (op === 'add' || op === 'dup') {
      const id = mkId();
      const src = op === 'dup' ? ex.find(e => e.id === cur.xid) : null;
      ex.push({ id, at: 0, text: src ? src.text : '새 슬라이드' });
      if (src) moveEdits('x' + src.id, 'x' + id);
      seq.splice(pos + 1, 0, { xid: id });
      pick = 'x' + id;
    } else if (op === 'del') {
      seq = seq.filter(z => z.xid !== cur.xid);
      ex.splice(ex.findIndex(e => e.id === cur.xid), 1);
      if (it.edits) delete it.edits['x' + cur.xid];
      const nb = list[Math.max(0, list.indexOf(cur) - 1)];
      pick = nb && nb !== cur ? nb.key : null;
    } else {
      const to = pos + (op === 'up' ? -1 : 1);
      if (to < 0 || to >= seq.length) { S.undo.pop(); return; }
      [seq[pos], seq[to]] = [seq[to], seq[pos]];
      pick = cur.key;
    }
    let at = -1;
    const order = [];
    for (const z of seq) { if (z.xid) { const e = ex.find(y => y.id === z.xid); if (e) { e.at = at; order.push(e); } } else at = z.base; }
    if (order.length) it.extra = order; else delete it.extra;
    S.key = pick || '*';
    S.sel = '';
    commit({ lyrics: true });
    if (op === 'add' && !S.quick) setTimeout(() => inlineEdit('main'), 80);
  }
  function slideOp(op, key) {
    const it = item();
    if (!canOps()) return;
    if (!chunky()) return extraOp(op, key);
    const list = sources();
    const k = key == null || key === '*' ? (S.key === '*' ? list.length - 1 : Number(S.key)) : Number(key);
    if (op !== 'add' && !(k >= 0)) return;
    if (op === 'del' && list.length <= 1) return app.showMsg('마지막 슬라이드는 지울 수 없습니다. 순서 자체를 지우세요.', 'info', 2500);
    if (op === 'del' && !S.noConfirm && !confirm(`${k + 1}번 슬라이드를 지울까요? (가사·내용에서도 지워집니다)`)) return;
    begin();
    if (it.type === 'title') {
      // 제목 순서: 장들을 '---' 글로 이어 같은 방법으로 고친 뒤 제목·부제·추가 슬라이드 칸으로 되돌린다
      const text = SL.slideOp('text', SL.titlePages(it).join('\n---\n'), op, k, '새 슬라이드');
      Object.assign(it, SL.fromTitlePages(SL.textChunks(text).map(c => c.text)));
    } else {
      const field = it.type === 'song' ? 'lyrics' : 'body';
      it[field] = SL.slideOp(it.type, it[field], op, k);
    }
    const e = SL.slideOpEdits(it.edits, op, k);
    if (e) it.edits = e; else delete it.edits;
    const after = sources();
    const pick = op === 'add' || op === 'dup' ? k + 1 : op === 'up' ? k - 1 : op === 'down' ? k + 1 : Math.min(k, after.length - 1);
    S.key = String(Math.max(0, Math.min(after.length - 1, pick)));
    S.sel = '';
    commit({ lyrics: true });
    if (op === 'add' && !S.quick) setTimeout(() => inlineEdit('main'), 80); // 새 슬라이드는 바로 글 쓰기
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
      + (hasMain() ? box('main', mainRect(t, e), e.hideMain ? '본문 (숨김)' : '본문', 'main' + (e.hideMain ? ' hid' : '')) : '')
      + items.filter(x => !x.below).map(x => box(x.id, x, NAMES[x.type], common.has(x.id) ? 'locked' : '')).join('')
      + '<div class="se-guide v" hidden></div><div class="se-guide h" hidden></div>';
    const obsNote = S.out === 'overlay' && R.lyricsOnly(t) && !e.allOutputs;
    $('#seHint').innerHTML = obsNote ? '⚠ OBS 자막(투명) 출력에는 글 내용만 반영됩니다. 위치·꾸미기도 쓰려면 오른쪽 \'OBS 자막에도 적용\' 을 켜세요.'
      : S.key === '*' ? '공통: 여기서 바꾼 위치·꾸미기는 모든 슬라이드에 적용됩니다 (슬라이드에서 따로 바꾼 것이 우선)'
        : curSource() && curSource().skipped ? '⊘ 이 슬라이드는 건너뜁니다 (송출 목록에 안 나옴). 왼쪽 ↺ 로 되살립니다.'
          : '끌어서 옮기기 · 모서리로 크기 · 더블클릭: 글 고치기 · ←→↑↓: 슬라이드 이동 (상자를 고르면 미세 이동) · Ctrl+Z: 되돌리기';
  }
  /** 이 슬라이드에 본문 글상자가 있나 (그림·영상·카메라·빈 화면은 없음) */
  function hasMain() {
    if (S.key === '*') return sources().some(x => !NOTEXT.includes(x.slide.kind));
    const s = curSource();
    return !!s && !NOTEXT.includes(s.slide.kind);
  }
  /** 본문 글을 여기서 고칠 수 있나 (성경·찬송가 본문은 원래 그대로) */
  function textEditable() {
    const s = curSource();
    return !!s && S.key !== '*' && (chunky() || !!s.xid);
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
    let h = `<h4>${S.key === '*' ? '공통 (모든 슬라이드)' : multiOn() ? `고른 슬라이드 ${S.multi.size}장` : `슬라이드: ${esc(src ? src.label : '')}`}</h4>${multiOn() ? `<div class="note se-multi-note">여기서 바꾸는 꾸미기·글상자·배경이 고른 ${S.multi.size}장에 함께 적용됩니다 (Esc: 한 장만)</div>` : ''}<div class="form se-form">`
      + field('배경', `${own.bg ? `<span class="se-bgname" title="${esc(own.bg)}">${own.bg.startsWith('#') ? `<i class="se-sw" style="background:${esc(own.bg)}"></i>` : '🖼'}</span>` : `<span class="muted">${S.key !== '*' && e.bg ? '공통 배경' : it.bg ? '순서 배경' : '템플릿'}</span>`}<button type="button" data-a="bgpick">그림·영상…</button>${colIn('bgcolor', own.bg && own.bg.startsWith('#') ? own.bg : '#000000')}${own.bg ? '<button type="button" data-a="bgclear">지우기</button>' : ''}`)
      + field('', `<label class="tc-toggle"><input type="checkbox" data-chk="hideMain" ${own.hideMain ? 'checked' : ''}> 본문 글 숨기기</label>`)
      + field('', `<label class="tc-toggle"><input type="checkbox" data-chk="allOutputs" ${own.allOutputs ? 'checked' : ''}> OBS 자막(투명)에도 위치·꾸미기 적용</label>`)
      + '</div>';
    if ((S.sel === 'main' || !S.sel) && hasMain()) {
      const st = e.style || {};
      const size = st.size || Math.round(t.font.size / k);
      const boxOn = !!st.boxColor;
      h += `<h4>본문 글상자</h4><div class="form se-form">`;
      if (S.key !== '*' && src && !textEditable()) h += field('글', `<span class="muted">${it.type === 'bible' ? '성경 본문' : '원래 내용'} 그대로 (위치·꾸미기만 바꿉니다)</span>`);
      else if (S.key !== '*' && src && src.xid) h += field('글', `<textarea data-content="text" rows="3" placeholder="첫 줄 = 제목, 둘째 줄 = 부제">${esc((item().extra || []).find(x => x.id === src.xid)?.text || '')}</textarea>`);
      else if (S.key !== '*' && src) {
        h += it.type === 'title' && src.slide.src === 0
          ? field('제목', `<input type="text" data-content="title" value="${esc(it.title)}">`) + field('부제', `<input type="text" data-content="subtitle" value="${esc(it.subtitle || '')}">`)
          : it.type === 'title' ? field('글', `<textarea data-content="text" rows="3" placeholder="첫 줄 = 제목, 둘째 줄 = 부제">${esc(SL.titlePages(it)[src.slide.src] || '')}</textarea>`)
          : field('글', `<textarea data-content="text" data-fmt rows="5">${esc(src.slide.parts[0].text)}</textarea>`) + field('', window.BCFmt ? window.BCFmt.bar() : '');
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
    } else if (S.sel && S.sel !== 'main') {
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
    if (S.sel === 'main' || !S.sel) return null;
    return (raw(false).items || []).find(z => z.id === S.sel) || null;
  }
  /** 속성 경로(p) 에 값 넣기: style.* / item.* / pos.* */
  function setProp(p, v) {
    const [grp, key] = p.split('.');
    if (grp === 'style') { const e = raw(); e.style = e.style || {}; if (v === null) delete e.style[key]; else e.style[key] = v; return; }
    if (grp === 'item') { const x = target(); if (x) { if (v === null) delete x[key]; else x[key] = v; } return; }
    if (grp === 'pos') {
      if (S.sel === 'main' || !S.sel) { const e = raw(); e.box = e.box || mainRect(tpl(), effEdit()); e.box[key] = v; } else { const x = target(); if (x) x[key] = v; }
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
    if (!textEditable()) return;
    begin();
    if (src.xid) { const x = (it.extra || []).find(z => z.id === src.xid); if (x) x.text = text; return commit({ lyrics: true }); }
    if (it.type === 'song') it.lyrics = SL.setLyricsChunk(it.lyrics, src.slide.src, text);
    else if (it.type === 'text') it.body = SL.setTextChunk(it.body, src.slide.src, text);
    else { const pages = SL.titlePages(it); pages[src.slide.src] = text; Object.assign(it, SL.fromTitlePages(pages)); }
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
      if (!hasMain()) return;
      if (!textEditable()) return app.showMsg('성경·찬송가 본문은 여기서 고치지 않습니다. 위치·꾸미기만 바꿀 수 있습니다.', 'info', 2500);
      const src = curSource();
      r = mainRect(t, e);
      text = src.xid ? ((it.extra || []).find(z => z.id === src.xid) || {}).text || '' : it.type === 'title' ? SL.titlePages(it)[src.slide.src] || '' : src.slide.parts[0].text;
      size = ((e.style && e.style.size) || t.font.size / k) * k;
      align = (e.style && e.style.align) || (t.align === 'hanging' ? 'left' : t.align);
    } else {
      const x = target();
      if (!x || x.type !== 'text') return;
      r = x; text = x.text; size = x.size * k; align = x.align;
    }
    const ta = document.createElement('textarea');
    ta.className = 'se-inline';
    if (id === 'main' && chunky()) ta.setAttribute('data-fmt', ''); // Ctrl+B 굵게 등
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
    if (S.sel === 'main' || !S.sel || !e.items || !e.items.some(z => z.id === S.sel)) return;
    begin();
    e.items = e.items.filter(z => z.id !== S.sel);
    S.sel = '';
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
    if (!boxEl) { if (ev.target.closest('#seWrap')) { S.sel = ''; draw({ list: false }); } return; }
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
  async function open(i, key, keys) {
    const it = Cue() && Cue().item(i);
    if (!it) return app.showMsg('큐시트에서 순서를 먼저 고르세요.', 'info', 2000);
    if (!EDITABLE.includes(it.type)) return app.showMsg('음악 순서는 슬라이드가 없어 편집할 수 없습니다.', 'info', 3000);
    S.base = null;
    if (!CHUNK.includes(it.type)) {
      S.base = await Cue().editorBase(i);
      if (!S.base.length) return app.showMsg(it.type === 'bible' ? '성경 구절을 찾을 수 없습니다. 편집칸에서 구절을 확인하세요.' : '이 순서에는 아직 슬라이드가 없습니다. 편집칸에서 내용을 먼저 고르세요.', 'info', 3000);
    }
    S.i = i; S.undo = []; S.redo = []; S.sel = '';
    const list = sources();
    S.key = key != null && (key === '*' || list.some(x => x.key === String(key))) ? String(key) : (list[0] ? list[0].key : '*');
    const pre = (keys || []).map(String).filter(k => list.some(x => x.key === k));
    if (pre.length > 1 && pre.includes(S.key)) { S.multi = new Set(pre); S.anchor = pre[0]; } else S.multi = new Set();
    const el = $('#se');
    el.style.top = (document.querySelector('.menubar')?.getBoundingClientRect().bottom || 0) + 'px';
    el.hidden = false;
    $('#seTitle').textContent = `슬라이드 편집 — ${i + 1}. ${it.title}`;
    draw();
    el.focus();
  }
  /** 미리보기의 k 번째 슬라이드를 편집 (격자·목록에서) */
  const keyOf = s => (s ? (s.ekey ?? (s.src != null ? String(s.src) : undefined)) : undefined);
  function openPreviewSlide(k) {
    const p = app.preview;
    if (!p || !p.cue) return app.showMsg('큐시트 순서의 슬라이드만 편집할 수 있습니다.', 'info', 2500);
    const s = p.slides[k];
    const many = selValid() && M.ks.size > 1 && M.ks.has(k);
    const keys = many ? [...new Set([...M.ks].sort((a, b) => a - b).map(x => keyOf(p.slides[x])).filter(x => x != null))] : null;
    open(p.cue.index, keyOf(s), keys);
  }

  // ---------------- 본문·편집 창(목록·격자)에서 여러 장 고르기 ----------------
  // 클릭 = 그 슬라이드 미리보기 (한 장) · Shift+클릭 = 범위 · Ctrl+클릭 = 더하기/빼기 · 끌기 = 영역
  const M = { i: -1, cue: '', ks: new Set(), anchor: -1, drag: null };
  const selValid = () => { const p = app.preview; return !!(p && p.cue && p.cue.index === M.i && p.cue.id === M.cue); };
  function selReset(k) { const p = app.preview; M.i = p && p.cue ? p.cue.index : -1; M.cue = p && p.cue ? p.cue.id : ''; M.ks = new Set(k == null ? [] : [k]); M.anchor = k == null ? -1 : k; }
  const selMany = () => selValid() && M.ks.size > 1;
  /** 목록·격자 클릭: true = 여러 장 고르기로 썼음 (미리보기 바꾸지 않기) */
  function selClick(k, ev) {
    if (M.drag && M.drag.moved) return true; // 끌어서 고른 직후의 클릭
    if (!app.preview || !app.preview.cue) return false;
    if (!selValid()) selReset(app.preview.index);
    if (ev && ev.shiftKey) { const a = Math.min(M.anchor >= 0 ? M.anchor : k, k), b = Math.max(M.anchor >= 0 ? M.anchor : k, k); M.ks = new Set(Array.from({ length: b - a + 1 }, (_, n) => a + n)); paintSel(); return true; }
    if (ev && (ev.ctrlKey || ev.metaKey)) { if (M.ks.has(k) && M.ks.size > 1) M.ks.delete(k); else M.ks.add(k); paintSel(); return true; }
    selReset(k); paintSel();
    return false;
  }
  function paintSel() {
    const many = selMany();
    document.querySelectorAll('#slideGrid .sg-cell, #results .srow').forEach(c => c.classList.toggle('msel', many && M.ks.has(+c.dataset.k)));
    document.querySelectorAll('#cueGrid .sg-cell').forEach(c => c.classList.toggle('msel', many && +c.dataset.i === M.i && M.ks.has(+c.dataset.k)));
    let bar = document.getElementById('mselBar');
    if (!many) { if (bar) bar.hidden = true; return; }
    if (!bar) {
      document.querySelector('#panelMain .center-head').insertAdjacentHTML('beforeend', '<div id="mselBar" class="msel-bar"></div>');
      bar = document.getElementById('mselBar');
      bar.addEventListener('click', e => { const b = e.target.closest('[data-ms]'); if (b) selAction(b.dataset.ms); });
    }
    const it = Cue() && Cue().item(M.i);
    const del = it && CHUNK.includes(it.type) ? '✕ 지우기' : '⊘ 건너뛰기';
    bar.hidden = false;
    bar.innerHTML = `<b>고른 슬라이드 ${M.ks.size}장</b><button data-ms="edit" class="primary" title="고른 슬라이드를 함께 꾸미기 (Ctrl+E)">✎ 고른 ${M.ks.size}장 편집</button><button data-ms="del" title="${del} (Delete)">${del}</button><button data-ms="clear" title="한 장만 (Esc)">해제</button><span class="muted">Shift+클릭 범위 · Ctrl+클릭 더하기/빼기 · 끌어서 고르기</span>`;
  }
  async function selAction(a) {
    if (!selMany()) return;
    const p = app.preview;
    if (a === 'clear') { selReset(p.index); return paintSel(); }
    if (a === 'edit') return openPreviewSlide([...M.ks].sort((x, y) => x - y)[0]);
    if (a === 'del') {
      const it = Cue().item(p.cue.index);
      if (!it || !EDITABLE.includes(it.type)) return;
      const keys = [...new Set([...M.ks].map(k => keyOf(p.slides[k])).filter(k => k != null))];
      const chunk = CHUNK.includes(it.type);
      if (chunk && !confirm(`고른 슬라이드 ${keys.length}장을 지울까요? (가사·내용에서도 지워집니다)`)) return;
      if (!$('#se').hidden) close();
      S.i = p.cue.index; S.undo = []; S.redo = []; S.sel = ''; S.base = null;
      if (!chunk) { S.base = await Cue().editorBase(S.i); if (!S.base.length) return; }
      // 뒤에서부터 (앞을 지워도 뒤 번호가 밀리지 않게)
      keys.sort((x, y) => (Number(String(y).replace(/\D/g, '')) || 0) - (Number(String(x).replace(/\D/g, '')) || 0));
      S.quick = true; S.noConfirm = true;
      try { for (const k of keys) { S.key = String(k); slideOp('del', String(k)); } } finally { S.quick = false; S.noConfirm = false; }
      flush();
      selReset(null);
      paintSel();
      app.showMsg(chunk ? `슬라이드 ${keys.length}장을 지웠습니다.` : `슬라이드 ${keys.length}장을 건너뛰기 (송출에서 빠짐) 했습니다.`, 'ok', 2500);
    }
  }
  /** 끌어서 영역 고르기 (목록·격자) */
  function attachSel(box, sel) {
    box.addEventListener('dragstart', ev => { if (ev.target.closest(sel)) ev.preventDefault(); }); // 썸네일 그림이 끌려가지 않게
    box.addEventListener('pointerdown', ev => {
      if (ev.button !== 0 || ev.target.closest('button, input, .sg-ops, .sg-edit')) { M.drag = null; return; }
      const c = ev.target.closest(sel);
      const sameItem = x => x.dataset.i == null || (app.preview && app.preview.cue && +x.dataset.i === app.preview.cue.index);
      M.drag = c && app.preview && app.preview.cue && sameItem(c) ? { from: +c.dataset.k, moved: false } : null;
    });
    box.addEventListener('pointermove', ev => {
      if (!M.drag || !(ev.buttons & 1)) return;
      // 가장자리로 끌면 저절로 넘김
      const br = box.getBoundingClientRect();
      if (ev.clientY > br.bottom - 30) box.scrollTop += 18; else if (ev.clientY < br.top + 30) box.scrollTop -= 18;
      const c = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(sel);
      if (!c || (c.dataset.i != null && !(app.preview && app.preview.cue && +c.dataset.i === app.preview.cue.index)) || (!M.drag.moved && +c.dataset.k === M.drag.from)) return;
      if (!M.drag.moved) { selReset(M.drag.from); M.drag.moved = true; }
      const a = Math.min(M.drag.from, +c.dataset.k), b = Math.max(M.drag.from, +c.dataset.k);
      M.ks = new Set(Array.from({ length: b - a + 1 }, (_, n) => a + n));
      paintSel();
    });
  }
  document.addEventListener('pointerup', () => { if (!M.drag) return; if (!M.drag.moved) M.drag = null; else setTimeout(() => { M.drag = null; }, 0); });
  /** 전체 격자·전체 목록 클릭: 미리보기 중인 순서의 칸에서 Shift·Ctrl·끌기면 고르기 (true = 썼음) */
  function selClickAll(i, k, ev) {
    if (M.drag && M.drag.moved) return true;
    const p = app.preview;
    if (!p || !p.cue || p.cue.index !== i) return false;
    return selClick(k, ev);
  }
  /** 목록·격자 키: Delete = 고른 것 지우기 · Esc = 해제 · Ctrl+A = 모두 */
  function selKey(ev) {
    if (!app.preview || !app.preview.cue) return false;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a') { selReset(app.preview.index); M.ks = new Set(app.preview.slides.map((_, k) => k)); paintSel(); return true; }
    if (!selMany()) return false;
    if (ev.key === 'Escape') { selReset(app.preview.index); paintSel(); return true; }
    if (ev.key === 'Delete') { selAction('del'); return true; }
    return false;
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
        case 'reset': begin(); if (item().edits) { delete item().edits[S.key]; for (const k of others()) delete item().edits[k]; } S.prev = null; S.sel = ''; commit(); break;
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
      const opb = ev.target.closest('[data-op]');
      if (opb) { ev.stopPropagation(); const c0 = opb.closest('.se-slide'); slideOp(opb.dataset.op, c0 ? c0.dataset.key : null); return; }
      const c = ev.target.closest('.se-slide');
      if (!c) return;
      if (S.lasso && S.lasso.moved) { S.lasso = null; return; } // 끌어서 고른 직후의 클릭
      pickSlides(c.dataset.key, ev.shiftKey ? 'range' : (ev.ctrlKey || ev.metaKey) ? 'toggle' : 'one');
    });
    // 끌어서 여러 장 고르기 (영역 선택)
    $('#seList').addEventListener('pointerdown', ev => {
      if (ev.button !== 0 || ev.target.closest('[data-op], button')) return;
      const c = ev.target.closest('.se-slide');
      if (!c || c.dataset.key === '*') { S.lasso = null; return; }
      S.lasso = { from: c.dataset.key, moved: false };
    });
    $('#seList').addEventListener('pointermove', ev => {
      if (!S.lasso || !(ev.buttons & 1)) return;
      const lr = $('#seList').getBoundingClientRect();
      if (ev.clientY > lr.bottom - 30) $('#seList').scrollTop += 18; else if (ev.clientY < lr.top + 30) $('#seList').scrollTop -= 18;
      const c = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('#seList .se-slide');
      if (!c || c.dataset.key === '*' || (!S.lasso.moved && c.dataset.key === S.lasso.from)) return;
      S.lasso.moved = true;
      S.anchor = S.lasso.from;
      pickSlides(c.dataset.key, 'range');
    });
    // 놓을 때: 끌어서 골랐으면 바로 뒤 클릭 하나만 무시 (목록을 다시 그려 클릭이 안 올 수도 있으니 곧 풀어 둔다)
    document.addEventListener('pointerup', () => { if (!S.lasso) return; if (!S.lasso.moved) S.lasso = null; else setTimeout(() => { S.lasso = null; }, 0); });
    $('#seWrap').addEventListener('pointerdown', onPointerDown);
    $('#seWrap').addEventListener('dblclick', ev => { const b = ev.target.closest('.se-box'); if (b && !b.classList.contains('locked')) inlineEdit(b.dataset.id); });
    el.addEventListener('keydown', ev => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
      const ctrl = ev.ctrlKey || ev.metaKey;
      if (ev.key === 'Escape' && !typing) { ev.preventDefault(); if (S.sel) { S.sel = ''; draw({ list: false }); } else if (multiOn()) { S.multi = new Set([S.key]); draw(); } else close(); return; }
      if (ctrl && ev.key.toLowerCase() === 'a' && !typing && !S.sel) { ev.preventDefault(); const ks = sources().filter(x => !x.skipped).map(x => x.key); if (ks.length) { S.multi = new Set(ks); if (!S.multi.has(S.key)) S.key = ks[0]; draw(); } return; }
      if (ctrl && ev.key.toLowerCase() === 'z' && !typing) { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
      if (ctrl && ev.key.toLowerCase() === 'y' && !typing) { ev.preventDefault(); redo(); return; }
      if (typing) return;
      if (ctrl && ev.shiftKey && ev.key.toLowerCase() === 'n') { ev.preventDefault(); slideOp('add'); return; }
      if (ctrl && ev.key.toLowerCase() === 'd') { ev.preventDefault(); dupSelected(); return; }
      if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); delSelected(); return; }
      if (ev.key === 'Enter' || ev.key === 'F2') { ev.preventDefault(); inlineEdit(S.sel || 'main'); return; }
      const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
      const fromList = ev.target.closest && ev.target.closest('#seList');
      if (ev.key === 'PageDown' || ev.key === 'PageUp' || ev.key === 'Home' || ev.key === 'End' || (arrow && (!S.sel || fromList || ev.altKey))) {
        // 슬라이드 이동: ←↑ 이전 · →↓ 다음 (글상자를 고르지 않았을 때), PageUp/PageDown · Home/End 는 언제나
        ev.preventDefault();
        const keys = ['*', ...sources().map(x => x.key)];
        const cur = keys.indexOf(S.key);
        const n = ev.key === 'Home' ? 1 : ev.key === 'End' ? keys.length - 1 : cur + (['PageDown', 'ArrowRight', 'ArrowDown'].includes(ev.key) ? 1 : -1);
        if (n >= 0 && n < keys.length && n !== cur) {
          S.key = keys[n]; S.sel = '';
          draw();
          const on = $('#seList .se-slide.on');
          if (on) on.scrollIntoView({ block: 'nearest' });
        }
        return;
      }
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
      S.key = slide.dataset.key; S.sel = ''; draw();
      const cur = curSource();
      const ops = canOps() && S.key !== '*' && !chunky() ? [
        { label: '＋ 다음에 새 슬라이드 (제목 카드)', key: 'Ctrl+Shift+N', run: () => slideOp('add') },
        ...(cur && cur.xid ? [
          { label: '⧉ 이 슬라이드 복제', run: () => slideOp('dup') },
          { label: '▲ 위로', run: () => slideOp('up') },
          { label: '▼ 아래로', run: () => slideOp('down') },
          { label: '✕ 이 슬라이드 지우기', run: () => slideOp('del'), danger: true }]
          : [{ label: cur && cur.skipped ? '↺ 되살리기 (다시 보이기)' : '⊘ 건너뛰기 (송출에서 빼기)', run: () => slideOp('del') }]), '-']
        : canOps() && S.key !== '*' ? [
        { label: '＋ 다음에 새 슬라이드', key: 'Ctrl+Shift+N', run: () => slideOp('add') },
        { label: '⧉ 이 슬라이드 복제', run: () => slideOp('dup') },
        { label: '▲ 위로', run: () => slideOp('up'), disabled: S.key === '0' },
        { label: '▼ 아래로', run: () => slideOp('down'), disabled: Number(S.key) >= sources().length - 1 },
        { label: '✕ 이 슬라이드 지우기', run: () => slideOp('del'), danger: true }, '-'] : [];
      return [{ head: S.key === '*' ? '공통 (모든 슬라이드)' : '슬라이드' }, ...ops,
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
  /**
   * 미리보기 k 번째 슬라이드에 바로: 'add' (다음에 새 슬라이드 → 편집기에서 바로 글 쓰기) · 'del' (지우기 / 원래 슬라이드는 건너뛰기) · 'dup'
   * 썸네일(격자)·목록의 ＋ ✕ 단추와 오른쪽 클릭 메뉴가 부른다
   */
  async function quickOp(k, op) {
    const p = app.preview;
    if (!p || !p.cue) return app.showMsg('큐시트 순서의 슬라이드에서만 넣고 지울 수 있습니다.', 'info', 2500);
    const s = p.slides[k];
    const i = p.cue.index;
    const it = Cue().item(i);
    if (!s || !it || !EDITABLE.includes(it.type)) return;
    if (!$('#se').hidden) close();
    S.i = i; S.undo = []; S.redo = []; S.sel = ''; S.base = null;
    if (!CHUNK.includes(it.type)) { S.base = await Cue().editorBase(i); if (!S.base.length) return; }
    const key = s.ekey ?? String(s.src ?? 0);
    S.key = key;
    S.quick = true;
    try { slideOp(op, key); } finally { S.quick = false; }
    flush();
    if (op === 'add') { // 새 슬라이드: 편집기에서 바로 글 쓰기
      await open(i, S.key);
      setTimeout(() => inlineEdit('main'), 120);
    }
  }
  // 가운데 목록(순서의 슬라이드 줄)에서도 끌기·키
  { const res = document.getElementById('results'); if (res) { attachSel(res, '.srow'); res.addEventListener('keydown', e => { if (app.results && app.results.type === 'none' && selKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true); } }
  window.BCSlideEdit = { init, open, openPreviewSlide, close, dropImage, menuFor, quickOp, isOpen: () => !$('#se').hidden,
    selClick, selClickAll, paintSel, attachSel, selKey, selAction, selMany, selCount: () => (selMany() ? M.ks.size : 0) };
})();
