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
      <div class="stg-row"><button id="stOpen" class="primary">🖥 무대 화면 창 열기</button><input type="text" readonly value="${esc(url)}" id="stUrl" style="flex:1" title="다른 PC·태블릿 브라우저나 OBS 브라우저 소스로도 열 수 있습니다"><button id="stCopy">주소 복사</button></div>
      <h4>설교 타이머</h4>
      <div class="stg-row"><span id="stTime" class="stg-time">--:--</span>
        ${PRESETS.map(m => `<button data-min="${m}">${m}분</button>`).join('')}
        <input type="number" id="stMin" min="1" max="300" value="35" style="width:64px"><button id="stStart">시작</button></div>
      <div class="stg-row"><button id="stPause">❚❚ 일시정지</button><button id="stResume">▶ 계속</button><button data-add="1">+1분</button><button data-add="-1">−1분</button><button id="stReset">지우기</button></div>
      <h4>무대에 메시지</h4>
      <div class="stg-row"><input type="text" id="stMsg" placeholder="예: 5분 남았습니다" style="flex:1"><button id="stSend" class="primary">보내기</button><button id="stClear">지우기</button></div>
      <div class="stg-row">${QUICK_MSG.map(m => `<button data-msg="${esc(m)}">${esc(m)}</button>`).join('')}</div>
      <div class="stg-prev"><iframe id="stFrame" title="무대 화면 미리보기" src="/outputs/stage"></iframe></div>
      <h4>📱 휴대폰 리모컨</h4>
      <div class="stg-row"><label class="tc-toggle"><input type="checkbox" id="rmOn"> 켜기 (같은 Wi-Fi 의 휴대폰·태블릿에서 다음·이전·숨김·순서 송출·무대 메시지)</label></div>
      <div id="rmInfo" class="stg-remote"></div>
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
    setInterval(tick, 250);
    $('#rmOn').onchange = async e => { const r = await cmd('setRemote', { enabled: e.target.checked }); if (!r.ok) app.showMsg(r.error, 'error'); drawRemote(r.ok ? r.result : null); };
    cmd('remoteStatus').then(r => r.ok && drawRemote(r.result));
  }

  /** 리모컨 상태: 주소·PIN */
  function drawRemote(s) {
    const box = $('#rmInfo');
    if (!box || !s) return;
    $('#rmOn').checked = !!s.enabled;
    if (!s.enabled) { box.innerHTML = '<span class="muted">꺼져 있음</span>'; return; }
    if (!s.running) { box.innerHTML = `<span class="err-text">${esc(s.error || '시작하지 못했습니다.')}</span>`; return; }
    box.innerHTML = `<div>휴대폰 브라우저에서 이 주소를 여세요:</div>${s.urls.map(u => `<div class="stg-url">${esc(u)}</div>`).join('') || '<span class="err-text">네트워크 주소를 찾지 못했습니다 (Wi-Fi·랜 연결 확인)</span>'}
      <div>PIN <b class="stg-pin">${esc(s.pin)}</b> <button id="rmNewPin" title="새 PIN 으로 바꾸면 연결된 휴대폰은 다시 입력해야 합니다">PIN 바꾸기</button></div>
      <div class="muted">처음 켤 때 Windows 방화벽 창이 뜨면 '개인 네트워크' 를 허용하세요.</div>`;
    $('#rmNewPin').onclick = async () => { const r = await cmd('setRemote', { newPin: true }); if (r.ok) drawRemote(r.result); };
  }

  function tick() {
    const st = app.state && app.state.stage;
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

  window.BCStage = { init, drawRemote };
})();
