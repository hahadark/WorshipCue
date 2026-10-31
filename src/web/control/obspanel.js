/* OBS 원격 조작 (도구 → OBS 원격 조작 · 송출 메뉴 → OBS ▸ · 상태줄)
 * 연결 설정(주소 · 포트 · 비밀번호) · 방송 시작·끝 · 녹화 시작·끝 · 장면 바꾸기.
 * 순서마다 '송출할 때 자동으로 → OBS 장면 · 방송 · 녹화' 도 여기 상태를 쓴다.
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const ic = n => (window.BCIcon ? window.BCIcon(n) : '');
  const st = () => (app.state && app.state.obs) || { enabled: false, connected: false, scenes: [] };

  async function act(a, quiet) {
    const r = await app.cmd('obsAction', a);
    if (!r.ok) { app.showMsg('OBS: ' + r.error, 'error', 4000); return null; }
    if (!quiet) {
      const msg = a.action === 'scene' ? `OBS 장면: ${a.scene}` : a.action === 'stream' ? (r.result.streaming ? 'OBS 방송을 시작했습니다.' : 'OBS 방송을 끝냈습니다.') : a.action === 'record' ? (r.result.recording ? 'OBS 녹화를 시작했습니다.' : 'OBS 녹화를 끝냈습니다.') : '';
      if (msg) app.showMsg(msg, 'info', 2500);
    }
    return r.result;
  }

  /** 방송 끝은 실수하면 안 되니 한 번 묻는다 */
  async function stream(on) {
    if (on === false || (on === undefined && st().streaming)) { if (!confirm('OBS 방송을 끝낼까요? 유튜브 방송도 끝납니다.')) return; return act({ action: 'stream', on: false }); }
    return act({ action: 'stream', on: true });
  }
  const record = on => act({ action: 'record', ...(typeof on === 'boolean' ? { on } : {}) });
  const scene = name => act({ action: 'scene', scene: name });

  function draw() {
    const box = $('#obsBox');
    if (!box) return;
    const s = st();
    const c = (app.state.settings.obs || {});
    const dot = s.connected ? 'ok' : s.enabled ? 'err' : 'off';
    box.innerHTML = `<div class="form">
      <label>연결</label><div class="row-flex"><label class="tc-toggle"><input type="checkbox" id="obsOn" ${c.enabled ? 'checked' : ''}> OBS 원격 조작 쓰기</label>
        <span class="st"><span class="dot ${dot}"></span>${s.connected ? `연결됨 ${s.version ? '(obs-websocket ' + esc(s.version) + ')' : ''}` : s.connecting ? '연결하는 중…' : s.enabled ? esc(s.error || '연결 안 됨') : '꺼짐'}</span></div>
      <label>주소 · 포트</label><div class="row-flex"><input type="text" id="obsHost" value="${esc(c.host || '127.0.0.1')}" style="width:180px" spellcheck="false"> : <input type="number" id="obsPort" value="${esc(c.port || 4455)}" min="1" max="65535" style="width:90px"><span class="note">같은 PC 면 127.0.0.1</span></div>
      <label>비밀번호</label><div class="row-flex"><input type="password" id="obsPw" placeholder="${c.passwordEnc || c.password ? '(저장됨 — 바꿀 때만 입력)' : 'OBS 에 비밀번호를 켰다면'}" style="width:260px" autocomplete="off"><button id="obsSave" class="primary">${ic('refresh-cw')}저장하고 연결</button></div>
      <span></span><div class="note">OBS 28 이상 → 도구 → <b>WebSocket 서버 설정</b> → 'WebSocket 서버 사용' 켜기 → 포트·비밀번호를 여기에 똑같이. 비밀번호는 이 PC 에만 암호화해서 저장합니다.</div>
      ${s.connected ? `<label>방송 · 녹화</label><div class="row-flex">
          <button id="obsStream" class="${s.streaming ? 'danger' : 'primary'}">${ic('radio')}${s.streaming ? '방송 끝내기' : '방송 시작'}</button>
          <button id="obsRecord" class="${s.recording ? 'danger' : ''}">${ic('video')}${s.recording ? '녹화 끝내기' : '녹화 시작'}</button>
          <span class="muted">${s.streaming ? `방송 중 ${esc(s.streamTime ? s.streamTime.split('.')[0] : '')}${s.congestion > 0.3 ? ' · 인터넷이 느립니다' : ''}` : ''}${s.recording ? ' · 녹화 중' : ''}</span></div>
        <label>장면</label><div class="obs-scenes">${(s.scenes || []).map(n => `<button data-scene="${esc(n)}" class="${n === s.scene ? 'on' : ''}">${esc(n)}</button>`).join('') || '<span class="muted">장면이 없습니다</span>'}</div>
        <span></span><div class="note">순서마다 편집칸의 '⚡ 송출할 때 자동으로' 에서 OBS 장면 · 방송 · 녹화를 정해 두면, 그 순서를 송출할 때 OBS 가 같이 움직입니다.</div>` : ''}
    </div>`;
    $('#obsSave').onclick = async () => {
      const a = { enabled: true, host: $('#obsHost').value, port: Number($('#obsPort').value) };
      if ($('#obsPw').value) a.password = $('#obsPw').value;
      $('#obsOn').checked = true;
      const r = await app.cmd('setObs', a);
      if (!r.ok) app.showMsg(r.error, 'error');
    };
    $('#obsOn').onchange = e => app.cmd('setObs', { enabled: e.target.checked });
    if ($('#obsStream')) $('#obsStream').onclick = () => stream();
    if ($('#obsRecord')) $('#obsRecord').onclick = () => record();
    box.querySelectorAll('[data-scene]').forEach(b => { b.onclick = () => scene(b.dataset.scene); });
  }

  function open() {
    app.openModal('OBS 원격 조작', '<div id="obsBox" class="obs-box"></div>');
    draw();
  }

  /** 상태줄 조각 (control.js renderStatus 가 부른다) */
  function statusHtml() {
    const s = st();
    if (!s.enabled) return '';
    if (!s.connected) return `<span class="st" data-obs title="${esc(s.error || 'OBS 연결 안 됨')} — 누르면 OBS 원격 조작"><span class="dot err"></span>OBS 원격 끊김</span>`;
    const on = [s.streaming && '방송 중', s.recording && '녹화 중'].filter(Boolean).join(' · ');
    return `<span class="st" data-obs title="OBS 장면: ${esc(s.scene)} — 누르면 OBS 원격 조작"><span class="dot ${on ? 'err' : 'ok'}"></span>OBS ${on ? esc(on) : '대기'}${s.scene ? ' · ' + esc(s.scene) : ''}</span>`;
  }

  /** 송출 메뉴 → OBS ▸ */
  function menu() {
    const s = st();
    if (!s.enabled || !s.connected) return [{ ic: 'settings', label: s.enabled ? 'OBS 연결 안 됨 — 설정 열기…' : 'OBS 원격 조작 켜기…', run: open }];
    return [
      { ic: 'radio', label: s.streaming ? '방송 끝내기' : '방송 시작', run: () => stream() },
      { ic: 'video', label: s.recording ? '녹화 끝내기' : '녹화 시작', run: () => record() },
      '-',
      ...(s.scenes || []).map(n => ({ label: (n === s.scene ? '● ' : '　') + n, run: () => scene(n) })),
      '-',
      { ic: 'settings', label: 'OBS 원격 조작…', run: open },
    ];
  }

  window.BCObs = { open, draw, statusHtml, menu, stream, record, scene, act, state: st };
})();
