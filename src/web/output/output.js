/* 출력 화면 (전체 화면 창 / OBS 브라우저 소스 공용)
 * - SSE 로 Live 상태를 받아 그린다. 연결이 끊겨도 마지막 화면을 그대로 유지하고,
 *   재연결되면 서버가 최신 상태를 다시 보내준다.
 * - 본문 전환은 두 층을 교차 페이드해 깜빡임이나 이전 본문 노출이 없도록 한다.
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
    stage.style.setProperty('--bc-fade', (t.animation.type === 'fade' ? t.animation.duration : 0) + 'ms');
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

  function fadeMs() { return tpl && tpl.animation.type === 'fade' ? tpl.animation.duration : 0; }

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

    // 기존 본문 페이드아웃
    if (current) {
      const old = current;
      old.style.opacity = '0';
      removeLater(old);
      current = null;
    }
    if (show) {
      const area = R.buildContent(p.slide, tpl, p.versionName);
      area.style.opacity = '0';
      stage.appendChild(area);
      R.fit(area, tpl);
      // 다음 프레임에서 페이드인 (레이아웃 확정 후)
      requestAnimationFrame(() => requestAnimationFrame(() => { area.style.opacity = '1'; }));
      current = area;
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
