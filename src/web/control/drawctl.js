/* 화면에 그리기 · 강조 (LIVE 화면 위에서)
 * - '✎ 그리기' 를 켜고 LIVE 화면에 끌면 예배당·OBS 화면에 같은 선이 그려진다 (밑줄·동그라미·화살표)
 * - 형광펜(반투명 굵은 선), 🔦 강조(한 곳만 밝게, 휠로 크기), 되돌리기, 모두 지우기
 * - 슬라이드가 바뀌면 코어가 저절로 지운다
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const app = window.BC;
  const R = window.BCRender;
  const COLORS = [['#ff3b30', '빨강'], ['#ffd60a', '노랑'], ['#ffffff', '흰색'], ['#4fc3ff', '하늘'], ['#34c759', '초록']];
  const WIDTHS = [['0.004', '가늘게'], ['0.008', '보통'], ['0.016', '굵게']];
  const S = { on: false, color: '#ff3b30', width: 0.008, marker: false, spot: false, spotR: 0.18, stroke: null, timer: 0 };

  function bar() {
    return `<div id="drawBar" class="draw-bar" hidden>
      ${COLORS.map(([c, n]) => `<button class="dw-col" data-col="${c}" title="${n}" style="--c:${c}"></button>`).join('')}
      <span class="sep"></span>${WIDTHS.map(([w, n]) => `<button data-w="${w}">${n}</button>`).join('')}
      <button data-mk title="반투명 굵은 선 (글자 위에 칠하기)">형광펜</button>
      <span class="sep"></span><button data-spot title="한 곳만 밝게, 나머지는 어둡게 (휠로 크기)">🔦 강조</button>
      <span class="sep"></span><button data-undo title="마지막 선 지우기 (Ctrl+Z)">↶</button><button data-clear title="그린 것 모두 지우기">지우기</button>
      <span class="grow"></span><button data-off class="primary" title="그리기 끝 (Esc)">완료</button>
    </div>`;
  }
  function sync() {
    const b = $('#drawBar');
    if (!b) return;
    b.hidden = !S.on;
    $('#drawBtn').classList.toggle('on', S.on);
    b.querySelectorAll('[data-col]').forEach(x => x.classList.toggle('on', !S.spot && x.dataset.col === S.color));
    b.querySelectorAll('[data-w]').forEach(x => x.classList.toggle('on', !S.spot && !S.marker && Number(x.dataset.w) === S.width));
    b.querySelector('[data-mk]').classList.toggle('on', !S.spot && S.marker);
    b.querySelector('[data-spot]').classList.toggle('on', S.spot);
    const cap = $('#drawCap');
    if (cap) { cap.hidden = !S.on; cap.style.cursor = S.spot ? 'zoom-in' : 'crosshair'; }
  }
  function set(on) {
    S.on = !!on;
    if (!S.on && S.spot) { S.spot = false; app.cmd('drawSpot', { on: false }); }
    sync();
  }

  /** 마우스 위치 → 화면 비율 (LIVE 화면 속 실제 무대 기준) */
  function norm(e) {
    const st = [...document.querySelectorAll('#lvScreen .bc-stage')].pop();
    if (!st) return null;
    const r = st.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) / r.width * 10000) / 10000, Math.round((e.clientY - r.top) / r.height * 10000) / 10000];
  }
  function send(final) {
    clearTimeout(S.timer);
    const s = S.stroke;
    if (!s) return;
    const go = () => app.cmd('drawStroke', { stroke: s });
    if (final) go(); else S.timer = setTimeout(go, 60);
  }

  function init() {
    const tools = $('#panelLive .pane-tools');
    if (!tools) return;
    tools.insertAdjacentHTML('beforeend', '<button id="drawBtn" title="LIVE 화면에 그리기·강조 — 예배당·OBS 화면에 같이 보입니다">✎ 그리기</button>');
    tools.insertAdjacentHTML('afterend', bar());
    $('#lvScreen').insertAdjacentHTML('beforeend', '<div id="drawCap" class="draw-cap bc-keep" hidden></div>');
    $('#drawBtn').onclick = () => set(!S.on);
    $('#drawBar').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.col) { S.color = b.dataset.col; S.spot = false; }
      else if (b.dataset.w) { S.width = Number(b.dataset.w); S.marker = false; S.spot = false; }
      else if (b.hasAttribute('data-mk')) { S.marker = !S.marker; S.spot = false; }
      else if (b.hasAttribute('data-spot')) { S.spot = !S.spot; if (!S.spot) app.cmd('drawSpot', { on: false }); }
      else if (b.hasAttribute('data-undo')) app.cmd('drawUndo');
      else if (b.hasAttribute('data-clear')) { S.spot = false; app.cmd('drawClear'); }
      else if (b.hasAttribute('data-off')) return set(false);
      sync();
    });
    const cap = $('#drawCap');
    cap.addEventListener('pointerdown', e => {
      const p = norm(e);
      if (!p) return;
      try { cap.setPointerCapture(e.pointerId); } catch { /* 흉내 낸 입력 등 */ }
      if (S.spot) { app.cmd('drawSpot', { on: true, x: p[0], y: p[1], r: S.spotR }); S.dragSpot = true; return; }
      S.stroke = { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), pts: [p], color: S.color, width: S.marker ? 0.035 : S.width, alpha: S.marker ? 0.38 : 1 };
      send(false);
    });
    cap.addEventListener('pointermove', e => {
      if (S.dragSpot) { const p = norm(e); if (p) { clearTimeout(S.timer); S.timer = setTimeout(() => app.cmd('drawSpot', { on: true, x: p[0], y: p[1], r: S.spotR }), 30); } return; }
      if (!S.stroke) return;
      const p = norm(e);
      const last = S.stroke.pts[S.stroke.pts.length - 1];
      if (p && Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.002) { S.stroke.pts.push(p); send(false); }
    });
    const end = () => { if (S.stroke) send(true); S.stroke = null; S.dragSpot = false; };
    cap.addEventListener('pointerup', end);
    cap.addEventListener('pointercancel', end);
    cap.addEventListener('wheel', e => {
      if (!S.spot) return;
      e.preventDefault();
      S.spotR = Math.max(0.05, Math.min(0.5, S.spotR * (e.deltaY < 0 ? 1.12 : 0.89)));
      const d = app.drawState && app.drawState.spot;
      if (d) app.cmd('drawSpot', { on: true, x: d.x, y: d.y, r: S.spotR });
    }, { passive: false });
    window.addEventListener('keydown', e => {
      if (!S.on) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) { e.preventDefault(); e.stopPropagation(); app.cmd('drawUndo'); }
    }, true);
    sync();
  }

  /** 코어에서 그리기 상태가 오면 (LIVE 화면에도 그린다) */
  function onDraw(d) {
    app.drawState = d;
    paintLive();
  }
  function paintLive() {
    const st = [...document.querySelectorAll('#lvScreen .bc-stage')].pop();
    const t = app.lvTpl;
    if (st && t) R.paintDraw(st, app.drawState, t);
  }

  window.BCDraw = { init, onDraw, paintLive, isOn: () => S.on, off: () => set(false), toggle: () => set(!S.on) };
})();
