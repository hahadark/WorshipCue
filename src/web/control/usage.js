/* 사용 기록 (저작권 보고): 날짜별로 어떤 찬양·찬송·본문을 띄웠는지 · 제목별 횟수 · CSV 저장 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const cmd = (...a) => app.cmd(...a);
  const KIND = { song: '🎵 찬양', hymn: '🎼 찬송가', bible: '📖 성경', text: '📢 공지', title: '🏷 제목', image: '🖼 이미지', video: '🎬 영상', slideshow: '🎞 슬라이드쇼', camera: '📷 카메라', blank: '⬛ 빈 화면', other: '기타' };
  const KINDS = ['song', 'hymn', 'bible', 'text', 'title', 'image', 'video', 'slideshow', 'camera', 'blank', 'other'];
  let view = 'summary';
  let kinds = new Set(['song', 'hymn']);

  const day = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const t = s => { const d = new Date(s); return `${day(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  function open() {
    const now = new Date();
    const from = day(new Date(now.getFullYear(), now.getMonth(), 1));
    app.openModal('📊 사용 기록 (저작권 보고)', `<div class="form ai-form usage">
      <span></span><div class="note">송출한 찬양·찬송가·본문을 날짜별로 남깁니다 (같은 것을 5분 안에 다시 띄우면 한 번으로). CCLI 같은 저작권 보고나 "지난달에 부른 곡" 확인에 쓰세요.</div>
      <label>기간</label><div class="row-flex"><input type="date" id="ugFrom" value="${from}"><span>~</span><input type="date" id="ugTo" value="${day(now)}">
        <button data-range="month">이번 달</button><button data-range="prev">지난달</button><button data-range="year">올해</button><button data-range="all">전체</button></div>
      <label>종류</label><div class="row-flex" style="flex-wrap:wrap">${KINDS.map(k => `<label class="tc-toggle"><input type="checkbox" data-kind="${k}" ${kinds.has(k) ? 'checked' : ''}> ${KIND[k]}</label>`).join('')}</div>
      <label>보기</label><div class="row-flex"><span class="view-tabs" id="ugView"><button data-v="summary" class="${view === 'summary' ? 'on' : ''}">제목별 횟수</button><button data-v="rows" class="${view === 'rows' ? 'on' : ''}">날짜별 전체</button></span>
        <input type="text" id="ugQ" placeholder="제목으로 찾기" style="flex:1"><button id="ugCsv" class="primary">💾 CSV 저장 (엑셀)</button><button id="ugClear">오래된 기록 지우기…</button></div>
      <span></span><div id="ugList" class="usage-list"></div>
    </div>`);
    const q = () => ({ from: $('#ugFrom').value, to: $('#ugTo').value, kinds: [...kinds], q: $('#ugQ').value.trim() });
    const draw = async () => {
      const r = await cmd('usageLog', q());
      if (!r.ok) return app.showMsg(r.error, 'error');
      const { rows, summary } = r.result;
      if (view === 'summary') {
        $('#ugList').innerHTML = summary.length ? `<table class="list"><tr><th>종류</th><th>제목</th><th>저작권·출처</th><th>횟수</th><th>처음</th><th>마지막</th></tr>
          ${summary.map(s => `<tr><td>${esc(KIND[s.kind] || s.kind)}</td><td><b>${esc(s.title)}</b></td><td class="muted">${esc(s.credit)}</td><td><b>${s.count}</b></td><td>${esc(s.first.slice(0, 10))}</td><td>${esc(s.last.slice(0, 10))}</td></tr>`).join('')}</table>
          <div class="note">${summary.length}개 제목 · ${rows.length}번 송출</div>` : '<div class="empty">이 기간에 기록이 없습니다.</div>';
      } else {
        let last = '';
        $('#ugList').innerHTML = rows.length ? `<table class="list"><tr><th>날짜</th><th>시각</th><th>종류</th><th>제목</th><th>저작권·출처</th><th>큐시트</th></tr>
          ${rows.map(x => { const d = t(x.at); const nd = d.slice(0, 10) !== last; last = d.slice(0, 10); return `<tr class="${nd ? 'day' : ''}"><td>${nd ? esc(last) : ''}</td><td>${esc(d.slice(11))}</td><td>${esc(KIND[x.kind] || x.kind)}</td><td><b>${esc(x.title)}</b></td><td class="muted">${esc(x.credit)}</td><td class="muted">${esc(x.cue)}</td></tr>`; }).join('')}</table>
          <div class="note">${rows.length}번 송출</div>` : '<div class="empty">이 기간에 기록이 없습니다.</div>';
      }
    };
    document.querySelectorAll('.usage [data-range]').forEach(b => b.onclick = () => {
      const n = new Date();
      const r = b.dataset.range;
      if (r === 'month') { $('#ugFrom').value = day(new Date(n.getFullYear(), n.getMonth(), 1)); $('#ugTo').value = day(n); }
      if (r === 'prev') { $('#ugFrom').value = day(new Date(n.getFullYear(), n.getMonth() - 1, 1)); $('#ugTo').value = day(new Date(n.getFullYear(), n.getMonth(), 0)); }
      if (r === 'year') { $('#ugFrom').value = `${n.getFullYear()}-01-01`; $('#ugTo').value = day(n); }
      if (r === 'all') { $('#ugFrom').value = ''; $('#ugTo').value = ''; }
      draw();
    });
    document.querySelectorAll('.usage [data-kind]').forEach(c => c.onchange = () => { if (c.checked) kinds.add(c.dataset.kind); else kinds.delete(c.dataset.kind); draw(); });
    document.querySelectorAll('#ugView button').forEach(b => b.onclick = () => { view = b.dataset.v; document.querySelectorAll('#ugView button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
    $('#ugFrom').onchange = draw; $('#ugTo').onchange = draw;
    $('#ugQ').oninput = () => { clearTimeout(open.t); open.t = setTimeout(draw, 250); };
    $('#ugCsv').onclick = async () => {
      const r = await cmd('usageCsv', { ...q(), mode: view });
      if (!r.ok) return app.showMsg(r.error, 'error');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([r.result.csv], { type: 'text/csv;charset=utf-8' }));
      a.download = r.result.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      app.showMsg(`'${r.result.name}' 을(를) 저장했습니다.`, 'ok', 2500);
    };
    $('#ugClear').onclick = async () => {
      const before = await app.ask('이 날짜 전의 기록을 지웁니다 (YYYY-MM-DD). 비우면 모두 지웁니다.', `${now.getFullYear() - 1}-01-01`);
      if (before === null) return;
      if (!confirm(before ? `${before} 전의 사용 기록을 지울까요?` : '사용 기록을 모두 지울까요?')) return;
      const r = await cmd('clearUsageLog', { before: before.trim() });
      if (r.ok) { app.showMsg(`${r.result.removed}개를 지웠습니다.`, 'ok', 2000); draw(); }
    };
    draw();
  }
  window.BCUsage = { open };
})();
