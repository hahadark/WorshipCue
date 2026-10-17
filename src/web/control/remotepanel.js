/* 📱 휴대폰 리모컨 (메뉴 도구 → 휴대폰 리모컨): 켜기·끄기, 주소·QR 코드·PIN, PIN 바꾸기
 * 같은 Wi-Fi 의 휴대폰 브라우저로 QR 을 찍거나 주소를 열고 PIN 을 넣으면 된다
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const cmd = (...a) => app.cmd(...a);
  let status = { enabled: false, running: false, urls: [], pin: '' };
  let modalOpen = false;

  /** QR 코드 (SVG) */
  function qrSvg(text) {
    if (!window.qrcode) return '';
    const q = window.qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }

  function body() {
    const s = status;
    if (!s.enabled) {
      return `<div class="rm-off"><div class="rm-big">📱</div>
        <p>같은 Wi-Fi 의 휴대폰·태블릿 브라우저로 <b>다음·이전·숨김, 찬양 절·후렴 바로 가기, 큐시트 순서 송출, 무대 메시지·타이머</b>를 할 수 있습니다.</p>
        <button id="rmOnBtn" class="primary">📱 리모컨 켜기</button>
        <p class="note">켜면 이 PC 의 네트워크 주소로 리모컨 기능만 여는 작은 서버가 시작됩니다 (PIN 6자리 필요). 처음 켤 때 Windows 방화벽 창이 뜨면 '개인 네트워크' 를 허용하세요.</p></div>`;
    }
    if (!s.running) return `<div class="err-text">${esc(s.error || '리모컨을 시작하지 못했습니다.')}</div><div class="row-flex" style="margin-top:10px"><button id="rmOffBtn">끄기</button></div>`;
    const url = s.urls[0] || '';
    return `<div class="rm-on">
      <div class="rm-qr">${url ? qrSvg(url) : ''}</div>
      <div class="rm-info">
        <div class="rm-step">① 휴대폰 카메라로 QR 을 찍거나 주소를 여세요</div>
        ${s.urls.map(u => `<div class="rm-url">${esc(u)}</div>`).join('') || '<div class="err-text">네트워크 주소를 찾지 못했습니다 (Wi-Fi·랜 연결 확인)</div>'}
        <div class="rm-step">② PIN 을 입력하세요</div>
        <div class="rm-pin">${esc(s.pin)}</div>
        <div class="row-flex"><button id="rmNewPin" title="새 PIN 으로 바꾸면 연결된 휴대폰은 다시 입력해야 합니다">PIN 바꾸기</button><button id="rmCopy">주소 복사</button><button id="rmOffBtn" class="danger">리모컨 끄기</button></div>
        <div class="note">휴대폰이 <b>같은 Wi-Fi</b> 에 있어야 합니다. 안 열리면 Windows 방화벽에서 WorshipCue 의 '개인 네트워크' 허용을 확인하세요. PIN 을 5번 틀리면 30초 잠깁니다.</div>
      </div></div>`;
  }

  function draw() {
    const box = $('#rmBody');
    if (!box) return;
    box.innerHTML = body();
    const on = $('#rmOnBtn'); if (on) on.onclick = () => setEnabled(true);
    const off = $('#rmOffBtn'); if (off) off.onclick = () => setEnabled(false);
    const np = $('#rmNewPin'); if (np) np.onclick = async () => { const r = await cmd('setRemote', { newPin: true }); if (r.ok) onStatus(r.result); };
    const cp = $('#rmCopy'); if (cp) cp.onclick = () => navigator.clipboard.writeText(status.urls[0] || '').then(() => app.showMsg('리모컨 주소를 복사했습니다.', 'ok', 1500));
  }

  async function setEnabled(v) {
    const r = await cmd('setRemote', { enabled: v });
    if (!r.ok) return app.showMsg(r.error, 'error');
    onStatus(r.result);
    app.showMsg(v ? '휴대폰 리모컨을 켰습니다.' : '휴대폰 리모컨을 껐습니다.', v ? 'ok' : 'info', 1800);
  }

  async function open() {
    const r = await cmd('remoteStatus');
    if (r.ok) status = r.result;
    app.openModal('📱 휴대폰 리모컨', '<div id="rmBody" class="rm"></div>');
    modalOpen = true;
    draw();
  }

  /** 상태가 바뀌면 (SSE 'remote' 포함): 창·메뉴바 표시 갱신 */
  function onStatus(s) {
    if (!s) return;
    status = s;
    if (modalOpen && $('#rmBody')) draw(); else modalOpen = false;
    const b = [...document.querySelectorAll('.mb-top')].find(x => x.dataset.remote);
    if (b) b.classList.toggle('rm-live', !!(s.enabled && s.running));
  }

  async function init() {
    const r = await cmd('remoteStatus');
    if (r.ok) onStatus(r.result);
  }

  window.BCRemote = { init, open, onStatus, toggle: () => setEnabled(!status.enabled), newPin: async () => { const r = await cmd('setRemote', { newPin: true }); if (r.ok) { onStatus(r.result); app.showMsg('PIN 을 바꿨습니다: ' + r.result.pin, 'ok', 3000); } }, status: () => status };
})();
