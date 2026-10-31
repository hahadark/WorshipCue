/* '무대' 패널: 무대 화면(설교자·찬양팀 모니터) 열기 · 설교 타이머 · 전달 메시지 · 작은 미리보기 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const cmd = (...a) => app.cmd(...a);
  const PRESETS = [5, 10, 20, 30, 40];
  const QUICK_MSG = ['5분 남았습니다', '마무리해 주세요', '마이크 확인해 주세요', '천천히 말씀해 주세요'];

  function init() {
    const el = $('#panelStage');
    const url = `${location.origin}/outputs/stage`;
    el.innerHTML = `<div class="stg">
      <div class="stg-row"><b>무대 화면</b><span class="muted">설교자·찬양팀 모니터용: 지금·다음 슬라이드, 시계, 타이머, 메시지, 순서 메모</span></div>
      <div class="stg-row"><button id="stOpen" class="primary">${window.BCIcon('monitor')}무대 화면 창 열기</button><input type="text" readonly value="${esc(url)}" id="stUrl" style="flex:1" title="이 PC 의 브라우저나 OBS 브라우저 소스로도 열 수 있습니다 (다른 기기에서는 휴대폰 리모컨을 쓰세요)"><button id="stCopy">주소 복사</button></div>
      <div class="stg-row" id="stMonRow"><span>무대 화면 모니터</span><select id="stMon"><option value="">모니터 고르기…</option></select><button id="stMonGo">전체 화면으로 띄우기</button><span id="stMonSt" class="muted"></span></div>
      <h4>설교 타이머</h4>
      <div class="stg-row"><span id="stTime" class="stg-time">--:--</span>
        ${PRESETS.map(m => `<button data-min="${m}">${m}분</button>`).join('')}
        <input type="number" id="stMin" min="1" max="300" value="35" style="width:64px"><button id="stStart">시작</button></div>
      <div class="stg-row"><button id="stPause">❚❚ 일시정지</button><button id="stResume">▶ 계속</button><button data-add="1">+1분</button><button data-add="-1">−1분</button><button id="stReset">지우기</button></div>
      <h4>무대에 메시지</h4>
      <div class="stg-row"><input type="text" id="stMsg" placeholder="예: 5분 남았습니다" style="flex:1"><button id="stSend" class="primary">보내기</button><button id="stClear">지우기</button></div>
      <div class="stg-row">${QUICK_MSG.map(m => `<button data-msg="${esc(m)}">${esc(m)}</button>`).join('')}</div>
      <h4>무대 화면 고정</h4>
      <div class="stg-row note">지금 슬라이드와 상관없이 무대 화면에 계속 보이게 합니다 (지금 화면은 아래 작은 칸에). 찬양팀에게 전체 순서표, 설교자에게 고정 메모를 줄 때.</div>
      <div class="stg-row" id="stPins"></div>
      <div class="stg-row"><textarea id="stPinText" rows="2" placeholder="고정할 글 (예: 결단 찬양은 2절까지 · 헌금 후 바로 광고)" style="flex:1"></textarea></div>
      <div class="stg-row"><button id="stPinTextGo">글 고정</button><input type="text" id="stPinName" placeholder="프리셋 이름" style="width:140px"><select id="stPinMode"><option value="text">고정 글</option><option value="order">순서표</option></select><button id="stPinSave">프리셋으로 저장</button></div>
      <div class="stg-prev"><iframe id="stFrame" title="무대 화면 미리보기" src="/outputs/stage"></iframe></div>
      <h4>📱 휴대폰 리모컨</h4>
      <div class="stg-row"><button id="rmOpen">${window.BCIcon('smartphone')}리모컨 열기 (QR · 주소 · PIN)…</button><span class="muted">메뉴 도구 → 📱 휴대폰 리모컨 에서도 열 수 있습니다</span></div>
    </div>`;
    $('#stOpen').onclick = () => window.open('/outputs/stage?window=1', 'wc-stage', 'width=1280,height=720');
    $('#stCopy').onclick = () => { navigator.clipboard.writeText(url).then(() => app.showMsg('무대 화면 주소를 복사했습니다.', 'ok', 1500)); };
    const timer = (action, minutes) => cmd('stageTimer', { action, minutes }).then(r => { if (!r.ok) app.showMsg(r.error, 'error'); });
    el.querySelectorAll('[data-min]').forEach(b => b.onclick = () => timer('start', +b.dataset.min));
    $('#stStart').onclick = () => timer('start', +$('#stMin').value);
    $('#stPause').onclick = () => timer('pause');
    $('#stResume').onclick = () => timer('resume');
    $('#stReset').onclick = () => timer('reset');
    el.querySelectorAll('[data-add]').forEach(b => b.onclick = () => timer('add', +b.dataset.add));
    const send = text => cmd('stageMessage', { text }).then(r => { if (r.ok) app.showMsg(text ? '무대에 메시지를 보냈습니다.' : '무대 메시지를 지웠습니다.', 'ok', 1200); });
    $('#stSend').onclick = () => send($('#stMsg').value.trim());
    $('#stMsg').onkeydown = e => { if (e.key === 'Enter') send($('#stMsg').value.trim()); };
    $('#stClear').onclick = () => { $('#stMsg').value = ''; send(''); };
    el.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => { $('#stMsg').value = b.dataset.msg; send(b.dataset.msg); });
    // 미리보기 iframe 을 칸 너비에 맞게 축소
    const prev = el.querySelector('.stg-prev');
    new ResizeObserver(() => prev.style.setProperty('--s', String(prev.clientWidth / 1280))).observe(prev);
    // 무대 화면을 모니터에 (전체 화면)
    const monFill = async () => {
      const r = await cmd('getDisplays');
      if (!r.ok || !r.result.available) { $('#stMonRow').hidden = true; return; }
      const ss = (app.state.outputs && app.state.outputs.stage) || {};
      $('#stMon').innerHTML = '<option value="">모니터 고르기…</option>' + r.result.displays.map(d => `<option value="${d.id}" ${ss.displayId === d.id ? 'selected' : ''}>${esc(d.label)}${d.primary ? ' (주 모니터)' : ''}</option>`).join('');
      drawMon();
    };
    $('#stMon').onfocus = monFill;
    $('#stMonGo').onclick = async () => {
      const ss = (app.state.outputs && app.state.outputs.stage) || {};
      const on = !ss.enabled;
      const id = $('#stMon').value;
      if (on && !id) return app.showMsg('무대 화면을 띄울 모니터를 고르세요.', 'warn', 2500);
      const r = await cmd('setStageWindow', on ? { enabled: true, displayId: Number(id) } : { enabled: false });
      if (!r.ok) return app.showMsg(r.error, 'error');
      if (app.state.outputs) app.state.outputs.stage = r.result;
      drawMon();
    };
    $('#stMon').onchange = async () => { const ss = (app.state.outputs && app.state.outputs.stage) || {}; if (ss.enabled && $('#stMon').value) { const r = await cmd('setStageWindow', { enabled: true, displayId: Number($('#stMon').value) }); if (r.ok && app.state.outputs) { app.state.outputs.stage = r.result; drawMon(); } } };
    monFill();
    // 무대 화면 고정
    const pin = a => cmd('stagePinSet', a).then(r => { if (!r.ok) app.showMsg(r.error, 'error'); else { drawPins(r.result); app.showMsg(r.result ? '무대 화면을 고정했습니다.' : '무대 화면을 지금 화면으로 돌렸습니다.', 'ok', 1500); } });
    $('#stPins').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.pin === 'live') pin(null);
      else if (b.dataset.pin === 'order') pin({ mode: 'order', name: '순서표' });
      else if (b.dataset.preset) pin({ preset: b.dataset.preset });
      else if (b.dataset.del && confirm('이 프리셋을 지울까요?')) cmd('deleteStagePreset', { id: b.dataset.del }).then(() => setTimeout(() => drawPins(), 300));
    });
    $('#stPinTextGo').onclick = () => { const t = $('#stPinText').value.trim(); if (!t) return app.showMsg('고정할 글을 쓰세요.', 'warn', 2000); pin({ mode: 'text', text: t, name: $('#stPinName').value.trim() }); };
    $('#stPinSave').onclick = async () => {
      const mode = $('#stPinMode').value, name = $('#stPinName').value.trim(), text = $('#stPinText').value.trim();
      if (mode === 'text' && !text) return app.showMsg('고정할 글을 쓰세요.', 'warn', 2000);
      const r = await cmd('saveStagePreset', { preset: { mode, name, text } });
      if (!r.ok) return app.showMsg(r.error, 'error');
      app.showMsg(`무대 화면 프리셋 '${name}' 을(를) 저장했습니다.`, 'ok', 2000); setTimeout(() => drawPins(), 300);
    };
    drawPins();
    setInterval(tick, 250);
    $('#rmOpen').onclick = () => window.BCRemote && window.BCRemote.open();
  }

  /** 고정 단추들: 지금 화면 · 순서표 · 저장한 프리셋 (지금 고정된 것은 강조) */
  function drawPins(cur) {
    const box = $('#stPins');
    if (!box) return;
    const now = cur !== undefined ? cur : (app.state && app.state.stage && app.state.stage.pin) || null;
    const on = k => (k === 'live' ? !now : now && (k === 'order' ? now.mode === 'order' && !now.id : now.id === k)) ? 'on' : '';
    const list = (app.state && app.state.settings.stagePresets) || [];
    box.innerHTML = `<button data-pin="live" class="${on('live')}">지금 화면 (기본)</button><button data-pin="order" class="${on('order')}">순서표</button>` +
      list.map(p => `<span class="stg-preset"><button data-preset="${esc(p.id)}" class="${on(p.id)}" title="${esc(p.mode === 'order' ? '순서표' : p.text)}">${esc(p.name)}</button><button data-del="${esc(p.id)}" class="icon-btn" title="프리셋 지우기">✕</button></span>`).join('');
  }

  function drawMon() {
    const b = $('#stMonGo'), t = $('#stMonSt');
    if (!b) return;
    const ss = (app.state && app.state.outputs && app.state.outputs.stage) || {};
    b.textContent = ss.enabled ? '무대 화면 끄기' : '전체 화면으로 띄우기';
    b.className = ss.enabled ? 'danger' : '';
    t.textContent = ss.enabled ? (ss.valid ? `켜짐 — ${ss.displayLabel} (그 화면을 누르고 Esc 로 끄기)` : '모니터를 찾지 못했습니다') : '';
  }
  let monKey = '';
  let pinKey = '';
  function tick() {
    const st = app.state && app.state.stage;
    const pk = JSON.stringify([st && st.pin && [st.pin.mode, st.pin.id || ''], ((app.state && app.state.settings.stagePresets) || []).map(p => p.id + p.name)]);
    if (pk !== pinKey) { pinKey = pk; drawPins(); }
    const mk = JSON.stringify(app.state && app.state.outputs && app.state.outputs.stage);
    if (mk !== monKey) { monKey = mk; drawMon(); }
    const el = $('#stTime');
    if (!el || !st) return;
    const t = st.timer;
    if (!t.running && !t.duration) { el.textContent = '--:--'; el.className = 'stg-time'; return; }
    const skew = Date.now() - (t.now || Date.now());
    const left = t.running ? t.remaining - (Date.now() - skew - t.now) : t.remaining;
    const neg = left < 0, s = Math.ceil(Math.abs(left) / 1000);
    el.textContent = `${neg ? '+' : ''}${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}${t.running ? '' : ' ❚❚'}`;
    el.className = 'stg-time' + (neg ? ' over' : left < 300000 ? ' warn' : '');
  }

  window.BCStage = { init, drawPins };
})();
