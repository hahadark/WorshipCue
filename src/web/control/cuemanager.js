/* 큐시트 관리 (큐시트 ⋯ · 파일 메뉴)
 * - 왼쪽: 찾기 · 보기(전체·고정·서식·휴지통) · 정렬 · 목록 (여러 개 고르기)
 * - 오른쪽: 고른 큐시트의 이름·날짜·메모·고정·서식, 순서 미리보기, 열기·복제(다음 주)·순서지 복사·내보내기·휴지통
 * - 위: 새 큐시트(기본 순서·빈·서식에서·AI) · 가져오기 · 고른 것 내보내기·휴지통 · 예배 진행 시계 켜기/끄기
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const cmd = (...a) => app.cmd(...a);
  const ICON = { camera: '📷', slideshow: '🎞', video: '🎬', audio: '🔊', hymn: '🎼', bible: '📖', song: '🎵', text: '📢', title: '🏷', image: '🖼', blank: '⬛' };
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const S = { view: 'all', sort: 'date', q: '', sel: '', checked: new Set(), list: [], trash: [] };
  try { Object.assign(S, JSON.parse(localStorage.getItem('wc-cuemgr') || '{}'), { checked: new Set(), sel: '' }); } catch { /* 처음 */ }
  const remember = () => { try { localStorage.setItem('wc-cuemgr', JSON.stringify({ view: S.view, sort: S.sort })); } catch { /* 무시 */ } };

  const dayOf = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? DAYS[new Date(d + 'T00:00:00').getDay()] : '');
  const ago = iso => {
    if (!iso) return '';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return '방금'; if (m < 60) return m + '분 전'; if (m < 1440) return Math.round(m / 60) + '시간 전';
    if (m < 43200) return Math.round(m / 1440) + '일 전';
    return iso.slice(0, 10);
  };
  const current = () => (window.BCCue && window.BCCue.currentId ? window.BCCue.currentId() : '');

  async function load() {
    const [a, b] = await Promise.all([cmd('listCues'), cmd('listCues', { trash: true })]);
    S.list = a.ok ? a.result : [];
    S.trash = b.ok ? b.result : [];
  }
  function rows() {
    let l = S.view === 'trash' ? S.trash : S.list;
    if (S.view === 'pinned') l = l.filter(c => c.pinned);
    if (S.view === 'template') l = l.filter(c => c.template);
    const q = S.q.trim().replace(/\s+/g, '').toLowerCase();
    if (q) l = l.filter(c => (c.name + c.serviceDate + c.memo + c.preview.map(p => p.title + p.sub).join('')).replace(/\s+/g, '').toLowerCase().includes(q));
    const by = { date: (x, y) => (y.serviceDate || '').localeCompare(x.serviceDate || '') || (y.updatedAt || '').localeCompare(x.updatedAt || ''),
      name: (x, y) => x.name.localeCompare(y.name, 'ko'), updated: (x, y) => (y.updatedAt || '').localeCompare(x.updatedAt || '') };
    l = [...l].sort((x, y) => (S.view !== 'trash' && y.pinned - x.pinned) || by[S.sort](x, y));
    return l;
  }

  async function open(selectId) {
    await load();
    S.sel = selectId || current() || (S.list[0] && S.list[0].id) || '';
    S.checked = new Set();
    app.openModal('📋 큐시트 관리', '<div id="cm" class="cm"></div>');
    draw();
  }

  function draw() {
    const box = $('#cm');
    if (!box) return;
    const list = rows();
    const all = S.view === 'trash' ? S.trash : S.list;
    if (!all.some(c => c.id === S.sel)) S.sel = list[0] ? list[0].id : '';
    const c = all.find(x => x.id === S.sel);
    const n = k => ({ all: S.list.length, pinned: S.list.filter(x => x.pinned).length, template: S.list.filter(x => x.template).length, trash: S.trash.length })[k];
    const checked = [...S.checked].filter(id => all.some(x => x.id === id));
    const templates = S.list.filter(x => x.template);
    const timesOn = window.BCCue && window.BCCue.timesOn ? window.BCCue.timesOn() : true;
    box.innerHTML = `<div class="cm-top">
        <span class="cm-new"><button data-a="new" class="primary">＋ 새 큐시트</button><button data-a="newEmpty">빈 큐시트</button>${templates.length ? `<select data-a="fromTpl"><option value="">📄 서식에서…</option>${templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select>` : ''}<button data-a="ai">🤖 주보로 (AI)</button><button data-a="import">📂 가져오기…</button></span>
        <span class="grow"></span>
        <label class="tc-toggle" title="큐시트 위 ⏰ 시작 시각 · 순서별 예정 시간 · 몇 분 늦음"><input type="checkbox" data-a="times" ${timesOn ? 'checked' : ''}> ⏰ 예배 진행 시계</label>
      </div>
      <div class="cm-body">
        <div class="cm-left">
          <input type="text" data-a="q" value="${esc(S.q)}" placeholder="이름 · 날짜 · 메모 · 순서 제목으로 찾기">
          <div class="cm-views view-tabs">${[['all', '전체'], ['pinned', '📌 고정'], ['template', '📄 서식'], ['trash', '🗑 휴지통']].map(([k, l]) => `<button data-view="${k}" class="${S.view === k ? 'on' : ''}">${l} <small>${n(k)}</small></button>`).join('')}</div>
          <div class="cm-sort"><select data-a="sort">${[['date', '예배 날짜순'], ['updated', '최근 고친 순'], ['name', '이름순']].map(([k, l]) => `<option value="${k}" ${S.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <label class="tc-toggle"><input type="checkbox" data-a="checkAll" ${list.length && list.every(x => S.checked.has(x.id)) ? 'checked' : ''}> 모두</label>
            ${checked.length ? `<span class="cm-bulk"><b>${checked.length}개</b>${S.view === 'trash' ? '<button data-a="restoreSel">되살리기</button><button data-a="purgeSel" class="danger">아주 지우기</button>' : '<button data-a="exportSel">내보내기</button><button data-a="trashSel" class="danger">휴지통</button>'}</span>` : ''}</div>
          <div class="cm-list">${list.map(x => `<div class="cm-row ${x.id === S.sel ? 'sel' : ''} ${x.id === current() ? 'cur' : ''}" data-id="${esc(x.id)}">
              <input type="checkbox" data-chk="${esc(x.id)}" ${S.checked.has(x.id) ? 'checked' : ''}>
              <span class="cm-name"><span class="cm-l1">${x.pinned ? '<i>📌</i>' : ''}${x.template ? '<i>📄</i>' : ''}<b data-noi18n>${esc(x.name)}</b>${x.id === current() ? '<span class="cm-open">열림</span>' : ''}</span><small>${x.serviceDate ? `${esc(x.serviceDate)} (${dayOf(x.serviceDate)})` : '날짜 없음'} · ${x.count}개 순서${x.memo ? ' · 📝' : ''}</small></span>
              <span class="cm-when muted">${S.view === 'trash' ? '지운 지 ' + ago(x.deletedAt) : ago(x.updatedAt)}</span></div>`).join('') || `<div class="empty">${S.view === 'trash' ? '휴지통이 비어 있습니다.' : S.q ? '찾는 큐시트가 없습니다.' : '큐시트가 없습니다.'}</div>`}</div>
        </div>
        <div class="cm-right">${c ? detail(c) : '<div class="empty">왼쪽에서 큐시트를 고르세요.</div>'}</div>
      </div>`;
  }

  function detail(c) {
    const trash = !!c.deletedAt;
    return `<div class="form cm-form">
        <label>이름</label><input type="text" data-m="name" value="${esc(c.name)}" ${trash ? 'disabled' : ''}>
        <label>예배 날짜</label><div class="row-flex"><input type="date" data-m="serviceDate" value="${esc(c.serviceDate)}" ${trash ? 'disabled' : ''}><span class="muted">${c.serviceDate ? dayOf(c.serviceDate) + '요일' : ''}</span></div>
        <label>메모</label><textarea data-m="memo" rows="2" placeholder="예: 성찬 주일 · 찬양팀 B · 순서지 인쇄 완료" ${trash ? 'disabled' : ''}>${esc(c.memo)}</textarea>
        ${trash ? '' : `<span></span><div class="row-flex"><label class="tc-toggle"><input type="checkbox" data-m="pinned" ${c.pinned ? 'checked' : ''}> 📌 맨 위에 고정</label><label class="tc-toggle" title="새 큐시트를 만들 때 바탕으로 고를 수 있습니다 (예: 주일 낮 예배 · 수요 예배 · 새벽 예배 순서)"><input type="checkbox" data-m="template" ${c.template ? 'checked' : ''}> 📄 서식으로 쓰기</label></div>`}
      </div>
      <div class="cm-acts">${trash
        ? '<button data-a="restore" class="primary">↶ 되살리기</button><button data-a="purge" class="danger">아주 지우기</button><span class="muted">휴지통의 큐시트는 30일 뒤 저절로 지워집니다</span>'
        : `<button data-a="open" class="primary">열기</button><button data-a="dupNext" title="날짜를 7일 뒤로 바꾼 복사본 (이름 속 날짜도)">⧉ 다음 주 순서로 복제</button><button data-a="dup">⧉ 그대로 복제</button>
           <button data-a="text" title="순서지를 글로 복사 (단톡방·문서에 붙이기)">📋 순서지 복사</button><button data-a="export">💾 내보내기</button><button data-a="trash" class="danger">🗑 휴지통</button>`}</div>
      <div class="cm-prev"><b>순서 ${c.count}개</b>${c.startTime && (window.BCCue && window.BCCue.timesOn()) ? ` <span class="muted">· 시작 ${esc(c.startTime)}</span>` : ''}
        <ol>${c.preview.map(p => `<li><span class="cm-ico">${ICON[p.type] || '·'}</span>${esc(p.title)}${p.sub ? ` <span class="muted">— ${esc(p.sub)}</span>` : ''}</li>`).join('')}${c.count > c.preview.length ? `<li class="muted">… ${c.count - c.preview.length}개 더</li>` : ''}</ol></div>`;
  }

  // ---------------- 동작 ----------------
  const reopen = async id => { await load(); if (id) S.sel = id; draw(); };
  const openCue = async id => { app.closeModal(); if (window.BCCue) await window.BCCue.openCue(id); };
  function download(name, data) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = name.replace(/[\\/:*?"<>|]/g, '_') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  async function act(a, el) {
    const id = S.sel;
    const c = [...S.list, ...S.trash].find(x => x.id === id);
    const r = (x, msg) => { if (!x.ok) { app.showMsg(x.error, 'error'); return false; } if (msg) app.showMsg(msg, 'ok', 1800); return true; };
    switch (a) {
      case 'new': { const x = await cmd('newCue', {}); if (r(x)) openCue(x.result.id); break; }
      case 'newEmpty': { const x = await cmd('newCue', { empty: true }); if (r(x)) openCue(x.result.id); break; }
      case 'fromTpl': {
        if (!el.value) break;
        const t = S.list.find(x => x.id === el.value);
        const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        const x = await cmd('duplicateCue', { id: el.value, name: `${today} ${t ? t.name.replace(/^\d{4}-\d{2}-\d{2}\s*/, '') : '예배'}`, serviceDate: today });
        if (r(x)) openCue(x.result.id);
        break;
      }
      case 'ai': app.closeModal(); if (window.BCAI) window.BCAI.open(); break;
      case 'import': {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json,application/json'; inp.multiple = true;
        inp.onchange = async () => {
          let n = 0, first = '';
          for (const f of inp.files) {
            try { const x = await cmd('importCues', { data: JSON.parse(await f.text()) }); if (x.ok) { n += x.result.count; first = first || x.result.ids[0]; } else app.showMsg(`${f.name}: ${x.error}`, 'error'); } catch (e) { app.showMsg(`${f.name}: ${e.message}`, 'error'); }
          }
          if (n) { app.showMsg(`큐시트 ${n}개를 가져왔습니다.`, 'ok', 2000); S.view = 'all'; reopen(first); }
        };
        inp.click();
        break;
      }
      case 'open': if (c) openCue(c.id); break;
      case 'dupNext': { const x = await cmd('duplicateCue', { id, nextWeek: true }); if (r(x, `'${x.ok ? x.result.name : ''}' 를 만들었습니다.`)) reopen(x.result.id); break; }
      case 'dup': { const x = await cmd('duplicateCue', { id }); if (r(x, '복제했습니다.')) reopen(x.result.id); break; }
      case 'text': { const x = await cmd('cueText', { id }); if (r(x)) { await navigator.clipboard.writeText(x.result.text); app.showMsg('순서지를 글로 복사했습니다 — 단톡방·문서에 붙여 넣으세요.', 'ok', 2500); } break; }
      case 'export': { const x = await cmd('exportCues', { ids: [id] }); if (r(x)) { download(c.name, x.result); app.showMsg('내보냈습니다 (다운로드 폴더).', 'ok', 2000); } break; }
      case 'exportSel': { const ids = [...S.checked]; const x = await cmd('exportCues', { ids }); if (r(x)) { download(`큐시트 ${ids.length}개 (${new Date().toISOString().slice(0, 10)})`, x.result); app.showMsg(`큐시트 ${ids.length}개를 파일 하나로 내보냈습니다.`, 'ok', 2500); } break; }
      case 'trash': if (c && confirm(`'${c.name}' 을(를) 휴지통으로 옮길까요? (30일 안에 되살릴 수 있습니다)`)) { const x = await cmd('trashCues', { ids: [id] }); if (r(x, '휴지통으로 옮겼습니다.')) { await afterRemove([id]); } } break;
      case 'trashSel': { const ids = [...S.checked]; if (!confirm(`고른 큐시트 ${ids.length}개를 휴지통으로 옮길까요?`)) break; const x = await cmd('trashCues', { ids }); if (r(x, `${ids.length}개를 휴지통으로 옮겼습니다.`)) { S.checked.clear(); await afterRemove(ids); } break; }
      case 'restore': { const x = await cmd('restoreCues', { ids: [id] }); if (r(x, '되살렸습니다.')) { S.view = 'all'; remember(); reopen(id); } break; }
      case 'restoreSel': { const ids = [...S.checked]; const x = await cmd('restoreCues', { ids }); if (r(x, `${ids.length}개를 되살렸습니다.`)) { S.checked.clear(); reopen(); } break; }
      case 'purge': if (confirm('아주 지울까요? 되돌릴 수 없습니다.')) { const x = await cmd('purgeCues', { ids: [id] }); if (r(x, '아주 지웠습니다.')) reopen(); } break;
      case 'purgeSel': { const ids = [...S.checked]; if (!confirm(`${ids.length}개를 아주 지울까요? 되돌릴 수 없습니다.`)) break; const x = await cmd('purgeCues', { ids }); if (r(x)) { S.checked.clear(); reopen(); } break; }
    }
  }
  /** 열려 있던 큐시트를 지웠으면 다른 것을 연다 */
  async function afterRemove(ids) {
    await reopen();
    if (ids.includes(current()) && window.BCCue) { const next = S.list[0]; if (next) await window.BCCue.openCue(next.id); else window.BCCue.init(); }
    else if (window.BCCue) window.BCCue.openCue(current());
  }

  // 이벤트 (창 안)
  document.addEventListener('click', e => {
    const box = e.target.closest('#cm');
    if (!box) return;
    const v = e.target.closest('[data-view]');
    if (v) { S.view = v.dataset.view; S.checked.clear(); remember(); draw(); return; }
    if (e.target.matches('[data-chk]')) { const id = e.target.dataset.chk; if (e.target.checked) S.checked.add(id); else S.checked.delete(id); draw(); return; }
    const row = e.target.closest('.cm-row');
    if (row) { S.sel = row.dataset.id; draw(); return; }
    const b = e.target.closest('button[data-a]');
    if (b) act(b.dataset.a, b);
  });
  document.addEventListener('dblclick', e => { const row = e.target.closest('#cm .cm-row'); if (row && S.view !== 'trash') openCue(row.dataset.id); });
  document.addEventListener('input', e => { if (e.target.closest('#cm') && e.target.dataset.a === 'q') { S.q = e.target.value; const pos = e.target.selectionStart; draw(); const q = $('#cm [data-a=q]'); q.focus(); q.setSelectionRange(pos, pos); } });
  document.addEventListener('change', async e => {
    const t = e.target;
    if (!t.closest('#cm')) return;
    if (t.dataset.a === 'sort') { S.sort = t.value; remember(); draw(); return; }
    if (t.dataset.a === 'fromTpl') { act('fromTpl', t); return; }
    if (t.dataset.a === 'times') { if (window.BCCue) await window.BCCue.setTimes(t.checked); draw(); return; }
    if (t.dataset.a === 'checkAll') { rows().forEach(x => (t.checked ? S.checked.add(x.id) : S.checked.delete(x.id))); draw(); return; }
    if (t.dataset.m) {
      const k = t.dataset.m;
      const v = t.type === 'checkbox' ? t.checked : t.value;
      const x = await cmd('updateCueMeta', { id: S.sel, [k]: v });
      if (!x.ok) return app.showMsg(x.error, 'error');
      await reopen(S.sel);
      if (S.sel === current() && window.BCCue) window.BCCue.openCue(S.sel); // 열린 큐시트면 이름·날짜 반영
    }
  });

  window.BCCueMgr = { open };
})();
