/* 장비 직접 제어 (도구 → 장비 (X32 · PTZ 카메라)…)
 * Companion 없이 바로: Behringer X32·M32 음향 콘솔(OSC) · PTZ 카메라 프리셋(VISCA over IP).
 * 장비를 등록해 두면 순서마다 '⚡ 송출할 때 자동으로 → 장비' 에 동작을 적을 수 있다. ATEM 은 Companion 단추로.
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const KIND = { x32: 'X32 · M32 음향', visca: 'PTZ 카메라 (VISCA)' };
  const HINT = { x32: 'ch1 on · ch5 fader 0.75 · main off · scene 3', visca: '프리셋 번호 (예: 2) · home' };
  const list = () => (app.state && app.state.settings.devices) || [];

  async function run(device, action, quiet) {
    const r = await app.cmd('deviceRun', { device, action });
    if (!r.ok) { app.showMsg(r.error, 'error', 5000); return false; }
    if (!quiet) app.showMsg('보냈습니다.', 'ok', 1500);
    return true;
  }

  function draw() {
    const box = $('#dvBox');
    if (!box) return;
    box.innerHTML = `<div class="dv">
      <div class="note">X32·M32 음향 콘솔과 PTZ 카메라를 바로 움직입니다 (같은 네트워크). 등록하면 순서 편집칸 '⚡ 송출할 때 자동으로 → 장비' 에 동작을 적을 수 있습니다. ATEM 스위처 · 조명 등은 Companion 단추로 (도구 → 스트림덱·외부 단추).</div>
      <div class="dv-list">${list().map(d => `<div class="dv-row"><b>${esc(d.name)}</b><span class="muted">${esc(KIND[d.kind])} · ${esc(d.host)}:${esc(d.port)}${d.kind === 'visca' ? ' · ' + (d.proto === 'raw' ? 'VISCA 그대로' : 'Sony VISCA over IP') : ''}</span>
        <input type="text" data-test="${esc(d.id)}" placeholder="${esc(HINT[d.kind])}" style="flex:1" spellcheck="false"><button data-run="${esc(d.id)}">보내기</button><button data-del="${esc(d.id)}" class="icon-btn" title="지우기">✕</button></div>`).join('') || '<div class="muted">등록한 장비가 없습니다.</div>'}</div>
      <h4>장비 더하기</h4>
      <div class="row-flex"><select id="dvKind"><option value="x32">${KIND.x32}</option><option value="visca">${KIND.visca}</option></select>
        <input type="text" id="dvName" placeholder="이름 (예: 본당 X32 · 강대상 카메라)" style="flex:1"></div>
      <div class="row-flex"><input type="text" id="dvHost" placeholder="IP 주소 (예: 192.168.1.50)" style="width:200px" spellcheck="false"><input type="number" id="dvPort" placeholder="포트" style="width:90px">
        <select id="dvProto" hidden><option value="sony">Sony VISCA over IP (UDP 52381)</option><option value="raw">VISCA 그대로 (PTZOptics 등 UDP 1259)</option></select><button id="dvAdd" class="primary">더하기</button></div>
      <div class="note">포트를 비우면 X32 는 10023, PTZ 는 52381. PTZOptics 처럼 머리글 없는 VISCA 는 'VISCA 그대로' + 포트 1259.</div>
    </div>`;
    const kindSync = () => { $('#dvProto').hidden = $('#dvKind').value !== 'visca'; };
    $('#dvKind').onchange = kindSync; kindSync();
    $('#dvProto').onchange = () => { if (!$('#dvPort').value && $('#dvProto').value === 'raw') $('#dvPort').value = 1259; };
    $('#dvAdd').onclick = async () => {
      const r = await app.cmd('saveDevice', { device: { kind: $('#dvKind').value, name: $('#dvName').value, host: $('#dvHost').value, port: $('#dvPort').value, proto: $('#dvProto').value } });
      if (!r.ok) return app.showMsg(r.error, 'error');
      app.state.settings.devices = [...list().filter(x => x.id !== r.result.id), r.result];
      app.showMsg(`'${r.result.name}' 을(를) 더했습니다.`, 'ok', 2000);
      draw();
    };
    box.querySelectorAll('[data-run]').forEach(b => { b.onclick = () => run(b.dataset.run, box.querySelector(`[data-test="${b.dataset.run}"]`).value); });
    box.querySelectorAll('[data-del]').forEach(b => { b.onclick = async () => { if (!confirm('이 장비를 지울까요? 순서에 적어 둔 동작은 동작하지 않게 됩니다.')) return; await app.cmd('deleteDevice', { id: b.dataset.del }); app.state.settings.devices = list().filter(x => x.id !== b.dataset.del); draw(); }; });
  }

  function open() { app.openModal('장비 (X32 · PTZ 카메라)', '<div id="dvBox"></div>'); draw(); }

  /** 순서 편집칸 '⚡ 송출할 때 자동으로' 의 장비 줄 */
  function actionHtml(a) {
    const devs = list();
    if (!devs.length) return `<label>장비</label><div class="ce-row"><button data-act="devopen" class="ghost">X32 · PTZ 카메라 등록…</button><span class="note">음향 콘솔 · 카메라 프리셋을 순서마다</span></div>`;
    const cur = id => ((a.dev || []).find(x => x.device === id) || {}).action || '';
    return devs.map((d, k) => `<label>${k ? '' : '장비'}</label><div class="ce-row"><span class="dv-name">${esc(d.name)}</span><input type="text" data-dev="${esc(d.id)}" value="${esc(cur(d.id))}" placeholder="${esc(HINT[d.kind])}" style="flex:1" spellcheck="false"><button data-devtest="${esc(d.id)}" class="ghost">보내 보기</button></div>`).join('');
  }
  function summary(a) {
    return (a.dev || []).map(x => { const d = list().find(y => y.id === x.device); return d ? `${d.name}: ${x.action}` : ''; }).filter(Boolean).join(' · ');
  }

  window.BCDevices = { open, run, actionHtml, summary };
})();
