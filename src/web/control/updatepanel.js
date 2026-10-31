/* 새 버전 창 (아래 상태줄의 '새 버전' · 설정 → 정보 → 바뀐 점 보기)
 * 예배 중에 저절로 뜨지 않는다. 누르면: 바뀐 점(릴리스 설명) · 지금 설치 / 끌 때 설치 / 받기 · 이번 버전 건너뛰기.
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const ic = n => (window.BCIcon ? window.BCIcon(n) : '');

  /** 릴리스 설명(마크다운)을 읽기 좋은 글로: 제목·목록·굵게만 */
  function notesHtml(md) {
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    const out = [];
    let list = false;
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1');
    for (const l of lines) {
      const m = /^\s*[-*]\s+(.*)$/.exec(l);
      if (m) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(m[1])}</li>`); continue; }
      if (list) { out.push('</ul>'); list = false; }
      const h = /^#{1,6}\s+(.*)$/.exec(l);
      if (h) out.push(`<h4>${inline(h[1])}</h4>`);
      else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
    }
    if (list) out.push('</ul>');
    return out.join('');
  }

  async function act(action, extra = {}) {
    const r = await app.cmd('updateAction', { action, ...extra });
    if (!r.ok) { app.showMsg(r.error, 'error'); return null; }
    app.update = r.result;
    return r.result;
  }

  function open() {
    const u = app.update || {};
    if (!u.version) { if (window.BCSettings) window.BCSettings.open('about'); return; }
    const state = {
      ready: `새 버전 ${u.version} 을 받아 두었습니다. 그대로 두면 <b>프로그램을 끌 때</b> 설치됩니다 (예배 중에는 다시 시작하지 않음).`,
      available: `새 버전 ${u.version} 이 나왔습니다. 이 판(포터블·맥·영어판)은 스스로 바꿀 수 없어 받는 곳을 엽니다.`,
      downloading: `새 버전 ${u.version} 을 받는 중입니다${u.percent ? ` (${u.percent}%)` : ''}. 다 받으면 끌 때 설치됩니다.`,
    }[u.state] || `새 버전 ${u.version}`;
    app.openModal(`새 버전 ${u.version}`, `<div class="upd">
      <div class="upd-head"><span class="muted">지금 ${esc(u.current || '')}</span> → <b>${esc(u.version)}</b>${u.publishedAt ? ` <span class="muted">(${esc(String(u.publishedAt).slice(0, 10))})</span>` : ''}${u.skipped ? ' <span class="upd-skip">건너뛰기로 한 버전</span>' : ''}</div>
      <div class="note">${state.replace(/<(?!\/?b>)/g, '&lt;')}</div>
      <h4>${ic('sparkles')}바뀐 점</h4>
      <div class="upd-notes">${u.notes ? notesHtml(u.notes) : '<span class="muted">설명을 불러오지 못했습니다. 릴리스 페이지에서 볼 수 있습니다.</span>'}</div>
      <div class="row-flex upd-go">
        ${u.state === 'ready' ? `<button id="updNowM" class="primary">${ic('refresh-cw')}지금 다시 시작해서 설치</button><button id="updLater" class="ghost">끌 때 설치 (그대로 두기)</button>` : ''}
        ${u.state === 'available' ? `<button id="updOpenM" class="primary">${ic('external-link')}받기…</button>` : ''}
        ${u.skipped ? `<button id="updUnskip" class="ghost">${ic('undo-2')}건너뛰기 취소</button>` : `<button id="updSkip" class="ghost" title="이 버전은 알리지 않고 설치하지 않습니다. 다음 버전이 나오면 다시 알립니다.">${ic('bell-off')}이번 버전 건너뛰기</button>`}
        <span class="grow"></span><a href="#" id="updPage">릴리스 페이지</a>
      </div>
    </div>`);
    const on = (id, f) => { const b = $(id); if (b) b.onclick = f; };
    on('#updNowM', () => { if (confirm('지금 프로그램을 끄고 새 버전을 설치한 뒤 다시 켭니다. 송출 중이면 화면이 잠시 꺼집니다. 진행할까요?')) act('installNow'); });
    on('#updLater', () => app.closeModal());
    on('#updOpenM', () => act('open'));
    on('#updSkip', async () => { if (await act('skip', { version: u.version })) { app.closeModal(); app.showMsg(`${u.version} 은 건너뜁니다. 다음 버전이 나오면 다시 알립니다 (설정 → 정보 에서 취소).`, 'info', 4000); if (app.renderStatus) app.renderStatus(); } });
    on('#updUnskip', async () => { if (await act('unskip')) { open(); if (app.renderStatus) app.renderStatus(); } });
    on('#updPage', e => { e.preventDefault(); app.cmd('openLink', { url: u.notesUrl || u.page || 'https://github.com/hahadark/WorshipCue/releases/latest' }); });
  }

  window.BCUpdate = { open, notesHtml };
})();
