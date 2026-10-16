/* 출력 화면 (전체 화면 창 / OBS 브라우저 소스 공용)
 * - SSE 로 Live 상태를 받아 그린다. 연결이 끊겨도 마지막 화면을 그대로 유지하고,
 *   재연결되면 서버가 최신 상태를 다시 보내준다.
 * - 전환: 디졸브(새 층이 이전 층 위로 서서히 나타난 뒤 이전 층을 지움) / 컷(바로 바꿈)
 */
(function () {
  'use strict';
  const R = window.BCRender;
  const output = location.pathname.endsWith('/overlay') ? 'overlay' : 'main';
  const params = new URLSearchParams(location.search);
  const isWindow = params.has('window');
  const screenEl = document.getElementById('screen');

  let clientId = null;
  let stage = null;
  let tplKey = '';
  let tpl = null;
  let current = null; // 현재 보이는 본문층
  let lastKey = '';
  let lastPayload = null;

  function setupStage(t) {
    const key = JSON.stringify(t);
    if (key === tplKey && stage) return false;
    tplKey = key;
    tpl = t;
    screenEl.innerHTML = '';
    stage = R.buildStage(t);
    stage.style.setProperty('--bc-fade', fadeMs() + 'ms');
    screenEl.appendChild(stage);
    current = null;
    // 투명 템플릿이 아니고 OBS 가 아닌 창이면 여백(레터박스)을 검게
    document.body.classList.toggle('opaque', t.background.type !== 'transparent' && isWindow);
    rescale();
    return true;
  }

  function rescale() {
    if (stage && tpl) R.scaleStage(stage, screenEl, tpl);
  }
  window.addEventListener('resize', rescale);

  function fadeMs() { return tpl && tpl.animation && ['dissolve', 'fade'].includes(tpl.animation.type) ? Math.max(0, Number(tpl.animation.duration) || 0) : 0; }

  function removeLater(el) {
    const ms = fadeMs();
    if (!ms) { el.remove(); return; }
    setTimeout(() => el.remove(), ms + 50);
  }

  function render(p) {
    lastPayload = p;
    document.body.classList.toggle('nocursor', p.cursorHidden !== false);
    const stageChanged = setupStage(p.template);
    const show = p.hasLive && p.visible && p.slide;
    const key = show ? JSON.stringify([p.slide, p.versionName]) : '';
    const bg = stage.firstChild;
    bg.style.opacity = (!show && p.template.clearHidesBackground) ? '0' : '1';

    if (!stageChanged && key === lastKey) { ack(p); return; }
    lastKey = key;

    const ms = fadeMs();
    const old = current;
    current = null;
    if (show) {
      const area = R.buildContent(p.slide, tpl, p.versionName);
      if (ms) area.style.opacity = '0';
      stage.appendChild(area); // 이전 층 위에 쌓인다
      R.fit(area, tpl);
      current = area;
      if (!ms) { if (old) old.remove(); }
      else {
        // 다음 프레임에서 서서히 나타남 (레이아웃 확정 후). 이전 층은 그대로 두었다가 다 덮으면 지운다
        requestAnimationFrame(() => requestAnimationFrame(() => { area.style.opacity = '1'; }));
        if (old) { old.style.transition = 'none'; setTimeout(() => old.remove(), ms + 50); }
      }
    } else if (old) {
      // 숨김: 디졸브면 서서히 사라짐
      if (ms) { old.style.opacity = '0'; removeLater(old); } else old.remove();
    }
    ack(p);
  }

  function ack(p) {
    if (!clientId || !p) return;
    fetch('/api/ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WorshipCue': '1' },
      body: JSON.stringify({ id: clientId, version: p.version, width: innerWidth, height: innerHeight, visible: !!(p.visible && p.hasLive) }),
    }).catch(() => {});
  }

  function connect() {
    const es = new EventSource(`/events?client=${output}${isWindow ? '&window=1' : ''}`);
    es.addEventListener('render', e => {
      try { render(JSON.parse(e.data)); } catch (err) { console.error(err); }
    });
    es.addEventListener('hello', e => {
      clientId = JSON.parse(e.data).id;
      ack(lastPayload);
    });
    // 오류 시 EventSource 가 자동 재연결한다. 화면은 마지막 상태를 유지한다.
    es.onerror = () => { clientId = null; };
  }

  // 글꼴 로딩 후 크기 맞춤이 정확해지도록 다시 그림
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { if (lastPayload) { lastKey = ''; tplKey = ''; render(lastPayload); } });
  }
  connect();
})();
