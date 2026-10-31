/* 매크로 (도구 → 매크로 · Alt+1~9 · 외부 단추 /api/trigger/macro?name=… · 예약 실행)
 * 순서의 '⚡ 송출할 때 자동으로' 와 같은 동작 묶음에 이름을 붙여 두고 단추 하나로 실행한다.
 * 예: '예배 시작' = 로고 끄기 + OBS 방송 시작 + 장면 '예배' + 무대 순서표 고정.
 * 만들기: 순서 편집칸의 동작을 정한 뒤 '이 동작을 매크로로 저장…'.
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const ic = n => (window.BCIcon ? window.BCIcon(n) : '');
  const list = () => (app.state && app.state.settings.macros) || [];
  const COLORS = ['', '#3d7bff', '#2e9e57', '#e0a21b', '#e04b4b', '#9b59d0', '#20a6b8'];

  /** 실행 (depth: 매크로 안의 매크로는 한 번까지) */
  function run(idOrName, depth = 0) {
    const m = list().find(x => x.id === idOrName) || list().find(x => x.name === idOrName);
    if (!m) { app.showMsg('매크로를 찾을 수 없습니다: ' + idOrName, 'error'); return false; }
    if (depth > 1) return false;
    if (window.BCCue && window.BCCue.runActions) window.BCCue.runActions({ title: m.name, actions: m.actions || {}, music: m.music || '', musicVolume: m.musicVolume }, depth + 1);
    return true;
  }

  /** 순서 편집칸에서: 지금 순서의 동작 묶음을 매크로로 */
  async function saveFrom(it) {
    const a = it.actions || {};
    if (!Object.keys(a).length && !it.music) return app.showMsg('먼저 ⚡ 송출할 때 자동으로 에서 동작을 정하세요.', 'warn', 3000);
    const name = await app.ask('매크로 이름 (예: 예배 시작 · 설교 · 축도 후)', it.title || '');
    if (!name) return;
    const r = await app.cmd('saveMacro', { macro: { name, actions: a, music: it.music, musicVolume: it.musicVolume } });
    if (!r.ok) return app.showMsg(r.error, 'error');
    app.showMsg(`매크로 '${name}' 을(를) 저장했습니다. 도구 → 매크로 · Alt+${list().length + 1 <= 9 ? list().length + 1 : '?'} 로 실행합니다.`, 'ok', 3500);
  }

  function summary(m) { return window.BCCue && window.BCCue.actSummary ? window.BCCue.actSummary({ title: m.name, actions: m.actions || {}, music: m.music }) : ''; }

  function draw() {
    const box = $('#mcBox'); if (!box) return;
    const ms = list();
    box.innerHTML = `<div class="mc">
      <div class="note">순서의 '⚡ 송출할 때 자동으로' 와 같은 동작 묶음을 이름 붙여 단추 하나로 실행합니다. 만들기: 순서 편집칸에서 동작을 정한 뒤 <b>이 동작을 매크로로 저장…</b>. 앞의 9개는 <b>Alt+1~9</b>, 스트림덱은 도구 → 스트림덱·외부 단추의 '매크로 실행' 주소.</div>
      <div class="mc-grid">${ms.map((m, k) => `<div class="mc-card" style="${m.color ? `--mc:${m.color}` : ''}">
          <button class="mc-run" data-run="${esc(m.id)}" title="${esc(summary(m))}">${k < 9 ? `<kbd>Alt+${k + 1}</kbd>` : ''}<b>${esc(m.name)}</b><span>${esc(summary(m))}</span></button>
          <div class="mc-tools"><select data-color="${esc(m.id)}" title="색">${COLORS.map(c => `<option value="${c}" ${m.color === c ? 'selected' : ''}>${c ? '●' : '색 없음'}</option>`).join('')}</select>
            <label class="tc-toggle" title="프로그램을 켜면 한 번 실행"><input type="radio" name="mcStart" data-start="${esc(m.id)}" ${m.startup ? 'checked' : ''}> 켤 때</label>
            <button class="icon-btn" data-ren="${esc(m.id)}" title="이름 바꾸기">${ic('pencil')}</button><button class="icon-btn" data-del="${esc(m.id)}" title="지우기">${ic('x')}</button></div></div>`).join('') || '<div class="muted">아직 매크로가 없습니다.</div>'}</div>
      ${ms.some(m => m.startup) ? `<div class="row-flex"><button id="mcNoStart" class="ghost">켤 때 실행 안 함</button></div>` : ''}
      <h4>${ic('clock')}예약 실행</h4>
      <div class="note">정한 요일·시각이 되면 매크로를 실행합니다 (프로그램이 켜져 있을 때). 예: 주일 10:55 '예배 전 화면' · 11:00 '방송 시작'.</div>
      <div id="scList" class="sc-list"></div>
      <div class="row-flex"><button id="scAdd" ${ms.length ? '' : 'disabled'}>${ic('plus')}예약 더하기</button>${ms.length ? '' : '<span class="muted">매크로를 먼저 만드세요</span>'}</div>
    </div>`;
    drawSchedule();
    const save = (m, patch) => app.cmd('saveMacro', { macro: { ...m, ...patch } }).then(r => { if (!r.ok) app.showMsg(r.error, 'error'); setTimeout(draw, 250); });
    box.querySelectorAll('[data-run]').forEach(b => { b.onclick = () => { run(b.dataset.run); app.showMsg(`매크로 '${(list().find(x => x.id === b.dataset.run) || {}).name}' 실행`, 'info', 1500); }; });
    box.querySelectorAll('[data-color]').forEach(s => { s.onchange = () => save(list().find(x => x.id === s.dataset.color), { color: s.value }); });
    box.querySelectorAll('[data-start]').forEach(r => { r.onchange = () => save(list().find(x => x.id === r.dataset.start), { startup: true }); });
    box.querySelectorAll('[data-ren]').forEach(b => { b.onclick = async () => { const m = list().find(x => x.id === b.dataset.ren); const n = await app.ask('새 이름', m.name); if (n) save(m, { name: n }); }; });
    box.querySelectorAll('[data-del]').forEach(b => { b.onclick = async () => { const m = list().find(x => x.id === b.dataset.del); if (!confirm(`매크로 '${m.name}' 을(를) 지울까요?`)) return; await app.cmd('deleteMacro', { id: m.id }); setTimeout(draw, 250); }; });
    if ($('#mcNoStart')) $('#mcNoStart').onclick = () => { const m = list().find(x => x.startup); if (m) save(m, { startup: false }); };
    bindSchedule();
  }

  // ---- 예약 실행 ----
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  let sched = null; // 고치는 중인 목록 (저장 전)
  function drawSchedule() {
    const box = $('#scList'); if (!box) return;
    sched = sched || JSON.parse(JSON.stringify((app.state.settings.schedule) || []));
    box.innerHTML = sched.map((e, k) => `<div class="sc-row" data-k="${k}"><label class="tc-toggle"><input type="checkbox" data-f="enabled" ${e.enabled !== false ? 'checked' : ''}></label>
      <span class="sc-days">${DAYS.map((d, i) => `<label class="${(e.days || []).includes(i) ? 'on' : ''}"><input type="checkbox" data-day="${i}" ${(e.days || []).includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</span>
      <input type="time" data-f="time" value="${esc(e.time || '')}">
      <select data-f="macroId">${list().map(m => `<option value="${esc(m.id)}" ${e.macroId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
      <button class="icon-btn" data-scdel="${k}" title="지우기">${ic('x')}</button></div>`).join('') || '<div class="muted">예약이 없습니다.</div>';
  }
  async function saveSchedule() {
    const r = await app.cmd('saveSchedule', { list: sched });
    if (!r.ok) return app.showMsg(r.error, 'error');
    sched = r.result; drawSchedule();
  }
  function bindSchedule() {
    const box = $('#scList'); if (!box) return;
    box.addEventListener('change', e => {
      const row = e.target.closest('.sc-row'); if (!row) return;
      const it = sched[+row.dataset.k];
      if (e.target.dataset.day != null) { const d = +e.target.dataset.day; it.days = e.target.checked ? [...new Set([...(it.days || []), d])] : (it.days || []).filter(x => x !== d); }
      else if (e.target.dataset.f === 'enabled') it.enabled = e.target.checked;
      else it[e.target.dataset.f] = e.target.value;
      saveSchedule();
    });
    box.addEventListener('click', e => { const b = e.target.closest('[data-scdel]'); if (b) { sched.splice(+b.dataset.scdel, 1); saveSchedule(); } });
    $('#scAdd').onclick = () => { if (!list().length) return; sched.push({ days: [0], time: '10:55', macroId: list()[0].id, enabled: true }); saveSchedule(); };
  }

  function open() { sched = null; app.openModal('매크로', '<div id="mcBox"></div>'); draw(); }
  function refresh() { if ($('#mcBox')) draw(); }

  /** 켤 때 실행: 이 창(프로그램)이 처음 연결될 때 한 번 */
  function startup() {
    try { if (sessionStorage.getItem('wp-startup-macro')) return; sessionStorage.setItem('wp-startup-macro', '1'); } catch { /* 무시 */ }
    const m = list().find(x => x.startup);
    if (m) { run(m.id); app.showMsg(`켤 때 매크로 '${m.name}' 을(를) 실행했습니다.`, 'info', 3000); }
  }

  window.BCMacro = { open, run, saveFrom, refresh, startup, list };
})();
