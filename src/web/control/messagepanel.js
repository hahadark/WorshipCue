/* 회중 메시지 (도구 · 송출 메뉴 · Ctrl+M): 유아실 호출 · 차량 이동 같은 짧은 알림을 예배당·OBS 아래 띠로.
 * 틀의 {이름} 같은 칸만 채우면 되고, N초 뒤 저절로 숨긴다 (0 = 숨길 때까지). 슬라이드는 그대로.
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const ic = n => (window.BCIcon ? window.BCIcon(n) : '');
  const tpls = () => (app.state && app.state.settings.messageTemplates) || [];
  const fieldsOf = t => [...new Set((String(t || '').match(/\{([^}]+)\}/g) || []).map(x => x.slice(1, -1)))];
  let cur = null; // 고른 틀

  function fill() {
    let t = $('#msgText').value;
    document.querySelectorAll('#msgFields [data-f]').forEach(i => { if (i.value.trim()) t = t.split(`{${i.dataset.f}}`).join(i.value.trim()); });
    return t;
  }
  function preview() { $('#msgPrev').textContent = fill(); }

  function pick(id) {
    cur = tpls().find(t => t.id === id) || null;
    document.querySelectorAll('#msgTpls [data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === id));
    $('#msgText').value = cur ? cur.text : '';
    $('#msgSec').value = cur ? cur.seconds || 0 : 30;
    $('#msgName').value = cur ? cur.name : '';
    drawFields();
    const f = $('#msgFields [data-f]'); if (f) f.focus(); else $('#msgText').focus();
  }
  function drawFields() {
    const fs = fieldsOf($('#msgText').value);
    const old = {}; document.querySelectorAll('#msgFields [data-f]').forEach(i => { old[i.dataset.f] = i.value; });
    $('#msgFields').innerHTML = fs.map(f => `<label>${esc(f)}</label><input type="text" data-f="${esc(f)}" data-ime="ko" value="${esc(old[f] || '')}">`).join('') || '<span class="muted">채울 칸이 없습니다 (글에 {이름} 처럼 쓰면 칸이 생깁니다)</span>';
    preview();
  }

  async function show() {
    const outputs = [...document.querySelectorAll('[data-out]:checked')].map(x => x.dataset.out);
    const r = await app.cmd('showMessage', { text: fill(), seconds: Number($('#msgSec').value) || 0, outputs });
    if (!r.ok) return app.showMsg(r.error, 'error', 4000);
    app.showMsg('메시지를 보였습니다' + (r.result.until ? ` (${$('#msgSec').value}초 뒤 숨김)` : ' (숨기기 전까지)'), 'ok', 2500);
    draw();
  }
  const hide = () => app.cmd('clearMessage').then(() => { if ($('#msgState')) draw(); });

  function draw() {
    const m = app.state && app.state.message;
    $('#msgState').innerHTML = m ? `<span class="dot err"></span> 지금 보이는 중: <b>${esc(m.text)}</b> <button id="msgHide2" class="danger">${ic('eye-off')}숨기기</button>` : '<span class="muted">지금 보이는 메시지 없음</span>';
    if ($('#msgHide2')) $('#msgHide2').onclick = hide;
  }

  function open() {
    app.openModal('회중 메시지', `<div class="msgp">
      <div class="note">유아실 호출 · 차량 이동처럼 짧은 알림을 예배당 화면·OBS 아래에 띠로 보입니다. 슬라이드는 그대로이고, 정한 초가 지나면 저절로 숨깁니다.</div>
      <div id="msgState" class="msg-state"></div>
      <div id="msgTpls" class="msg-tpls">${tpls().map(t => `<button data-t="${esc(t.id)}">${esc(t.name)}</button>`).join('')}<button data-t="" class="ghost">${ic('plus')}새 글</button></div>
      <div class="form">
        <label>글</label><textarea id="msgText" rows="2" data-ime="ko" placeholder="예: {이름} 어린이 부모님, 유아실로 와 주세요"></textarea>
        <span></span><div id="msgFields" class="msg-fields"></div>
        <label>미리보기</label><div id="msgPrev" class="msg-prev"></div>
        <label>보이기</label><div class="row-flex"><input type="number" id="msgSec" min="0" max="3600" value="30" style="width:80px"> 초 뒤 숨김 <span class="note">0 = 숨길 때까지</span>
          <label class="tc-toggle"><input type="checkbox" data-out="main" checked> 예배당</label><label class="tc-toggle"><input type="checkbox" data-out="overlay" checked> OBS</label></div>
        <span></span><div class="row-flex"><button id="msgShow" class="primary">${ic('megaphone')}보이기</button><button id="msgHide">${ic('eye-off')}숨기기</button></div>
        <label>틀로 저장</label><div class="row-flex"><input type="text" id="msgName" placeholder="틀 이름" style="width:160px"><button id="msgSave">${ic('plus')}저장</button><button id="msgDel" class="ghost">지우기</button></div>
      </div>
    </div>`);
    $('#msgTpls').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) pick(b.dataset.t); });
    $('#msgText').oninput = drawFields;
    $('#msgFields').addEventListener('input', preview);
    $('#msgFields').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); show(); } });
    $('#msgShow').onclick = show;
    $('#msgHide').onclick = hide;
    $('#msgSave').onclick = async () => {
      const r = await app.cmd('saveMessageTemplate', { template: { id: cur && cur.name === $('#msgName').value.trim() ? cur.id : '', name: $('#msgName').value, text: $('#msgText').value, seconds: $('#msgSec').value } });
      if (!r.ok) return app.showMsg(r.error, 'error');
      app.showMsg('틀을 저장했습니다.', 'ok', 1500); setTimeout(open, 300);
    };
    $('#msgDel').onclick = async () => { if (!cur || !confirm(`'${cur.name}' 틀을 지울까요?`)) return; await app.cmd('deleteMessageTemplate', { id: cur.id }); setTimeout(open, 300); };
    draw();
    pick(tpls()[0] ? tpls()[0].id : '');
  }

  /** 상태줄: 보이는 중이면 '메시지 ✕' */
  function statusHtml() {
    const m = app.state && app.state.message;
    return m ? `<span class="st" data-msgoff title="회중 메시지: ${esc(m.text)} — 눌러서 숨기기"><span class="dot err"></span>메시지 ✕</span>` : '';
  }

  const refresh = () => { if ($('#msgState')) draw(); };
  window.BCMessage = { open, show, hide, statusHtml, fieldsOf, refresh };
})();
