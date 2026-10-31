/* 🎛 스트림덱 · 외부 단추 연결 (도구 메뉴)
 * Elgato Stream Deck · Bitfocus Companion · 매크로 프로그램에서 주소(GET) 하나로 다음·숨김·로고 화면 등을 누른다
 * 주소의 열쇠(key)가 맞아야 동작하고, 이 PC 안(127.0.0.1)에서만 열린다
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;

  async function open() {
    const r = await app.cmd('triggerInfo');
    if (!r.ok) return app.showMsg(r.error, 'error');
    draw(r.result);
  }
  function url(key, id) {
    const extra = id === 'timer' ? '&min=30' : id === 'message' ? '&text=' + encodeURIComponent('5분 남았습니다') : '';
    return `${location.origin}/api/trigger/${id}?key=${encodeURIComponent(key)}${extra}`;
  }
  function draw(info) {
    app.openModal('🎛 스트림덱 · 외부 단추 연결', `<div class="trg">
      <div class="note">Stream Deck · Companion · 매크로 프로그램의 단추에 아래 주소를 넣으면, 누를 때 워십프리젠터 가 그 동작을 합니다 (HTTP GET).<br>
      이 PC 안에서만 열립니다 (Stream Deck 이 이 PC 에 꽂혀 있을 때). 주소의 열쇠를 바꾸면 예전 주소는 더 이상 동작하지 않습니다.</div>
      <div class="trg-list">${info.actions.map(a => `<div class="trg-row"><b>${esc(a.name)}</b><code>${esc(url(info.key, a.id))}</code><button data-copy="${esc(url(info.key, a.id))}">복사</button><button data-test="${esc(a.id)}" title="지금 한 번 눌러 보기">▶</button></div>`).join('')}</div>
      <h4>설정하는 법</h4>
      <ul class="trg-help">
        <li><b>Stream Deck</b>: 'Website' 동작에 주소를 넣고 <b>'GET request in background'</b>(백그라운드에서 요청)를 켭니다. 또는 'API Request' 플러그인의 GET.</li>
        <li><b>Bitfocus Companion</b>: 'Generic HTTP Requests' 연결 → 단추 동작 'GET' 에 주소. (Companion 이 같은 PC 에서 돌 때)</li>
        <li><b>그 밖</b>: 주소를 여는 것만으로 됩니다 (예: AutoHotkey, 매크로 키보드, 바로 가기).</li>
      </ul>
      <h4>반대로: 순서를 송출할 때 Companion 단추 누르기</h4>
      <div class="note">순서 편집칸의 '⚡ 송출할 때 자동으로 → Companion' 에 단추 위치(페이지/줄/칸, 예: 1/0/2)를 쓰면 그 순서를 송출할 때 Companion 단추를 누릅니다. ATEM 스위처 · PTZ 카메라 프리셋 · X32 음향 · 조명처럼 Companion 이 아는 장비가 같이 움직입니다 (Companion 3 이상).</div>
      <div class="row-flex"><span>Companion 주소</span><input type="text" id="cpHost" value="${esc((app.state.settings.companion || {}).host || '127.0.0.1')}" style="width:160px" spellcheck="false"> : <input type="number" id="cpPort" value="${esc((app.state.settings.companion || {}).port || 8000)}" style="width:80px"><button id="cpSave">저장</button></div>
      <div class="row-flex"><span>시험</span><input type="text" id="cpLoc" placeholder="1/0/2" style="width:120px" spellcheck="false"><button id="cpTest">눌러 보기</button><span class="muted" id="cpMsg"></span></div>
      <div class="row-flex"><button id="trgNew" class="danger">🔑 열쇠 바꾸기</button><span class="muted">주소가 밖으로 새어 나갔을 때</span></div>
    </div>`);
    document.querySelectorAll('.trg [data-copy]').forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => app.showMsg('주소를 복사했습니다.', 'ok', 1200)));
    document.querySelectorAll('.trg [data-test]').forEach(b => b.onclick = async () => {
      const j = await fetch(url(info.key, b.dataset.test)).then(x => x.json()).catch(e => ({ ok: false, error: e.message }));
      app.showMsg(j.ok ? '동작했습니다.' : j.error, j.ok ? 'ok' : 'error', 1800);
    });
    $('#cpSave').onclick = async () => { const r = await app.cmd('setCompanion', { host: $('#cpHost').value, port: Number($('#cpPort').value) }); app.showMsg(r.ok ? 'Companion 주소를 저장했습니다.' : r.error, r.ok ? 'ok' : 'error', 2000); };
    $('#cpTest').onclick = async () => { $('#cpMsg').textContent = '누르는 중…'; const r = await app.cmd('companionPress', { loc: $('#cpLoc').value }); $('#cpMsg').textContent = r.ok ? '눌렀습니다.' : r.error; };
    $('#trgNew').onclick = async () => {
      if (!confirm('열쇠를 바꾸면 Stream Deck 등에 넣은 주소를 모두 다시 넣어야 합니다. 바꿀까요?')) return;
      const r = await app.cmd('newTriggerKey');
      if (r.ok) draw(r.result);
    };
  }

  window.BCTrigger = { open };
})();
