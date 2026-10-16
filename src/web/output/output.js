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
    vUrl = ''; vLayer = null;
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

  let renderSeq = 0;

  // ---------- 순서 배경 영상 층 ----------
  let vUrl = '';
  let vLayer = null;
  function setVideoBg(url) {
    if (url === vUrl) return;
    vUrl = url;
    const old = vLayer;
    vLayer = null;
    const ms = Math.max(300, fadeMs());
    if (old) { old.style.transition = `opacity ${ms}ms ease`; old.style.opacity = '0'; setTimeout(() => old.remove(), ms + 60); }
    if (!url) return;
    const layer = document.createElement('div');
    layer.className = 'bc-vlayer';
    layer.style.opacity = '0';
    layer.innerHTML = `<video src="${R.safeUrl(url)}" autoplay muted loop playsinline preload="auto"></video>`;
    stage.insertBefore(layer, stage.children[1] || null); // 템플릿 배경 바로 위, 글자 아래
    const v = layer.querySelector('video');
    const show = () => { layer.style.transition = `opacity ${ms}ms ease`; layer.style.opacity = '1'; };
    if (v.readyState >= 2) requestAnimationFrame(show); else { v.addEventListener('loadeddata', show, { once: true }); setTimeout(show, 1500); }
    vLayer = layer;
  }

  function fadeIn(el, ms, delay) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = `opacity ${ms}ms ease ${delay}ms`;
      el.style.opacity = '1';
    }));
  }

  function fadeOut(els, ms, delay) {
    for (const el of els) {
      if (!ms) { el.remove(); continue; }
      el.style.transition = `opacity ${ms}ms ease ${delay}ms`;
      el.style.opacity = '0';
      setTimeout(() => el.remove(), ms + delay + 50);
    }
  }

  /** 이 슬라이드가 화면을 꽉 채우는(불투명한) 그림인가 */
  function coversScreen(slide) {
    if (R.lyricsOnly(tpl) && typeof slide.caption === 'string') return false; // 가사만 출력
    if (slide.kind === 'score') return !!slide.bg;
    if (slide.kind === 'image' || slide.kind === 'video') return true;
    if (slide.kind === 'blank') return slide.mode !== 'background';
    return false;
  }

  /** 층 안의 그림과 슬라이드 배경 그림을 다 불러올 때까지 (최대 1.5초) */
  function whenReady(area, slide) {
    const jobs = [...area.querySelectorAll('img')].map(img => (img.decode ? img.decode() : Promise.resolve()).catch(() => {}));
    if (slide && slide.bg && !slide.bg.startsWith('#')) {
      const im = new Image();
      im.src = slide.bg;
      jobs.push((im.decode ? im.decode() : Promise.resolve()).catch(() => {}));
    }
    if (!jobs.length) return Promise.resolve();
    return Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 1500))]);
  }

  // 오버레이 층: 슬라이드 전환과 따로, 내용이 바뀔 때만 다시 그린다
  let ovKey = '';
  let ovLayer = null;
  function renderOverlays(p, force) {
    const list = p.overlays || [];
    const key = JSON.stringify(list);
    if (!force && key === ovKey && ovLayer && ovLayer.isConnected) return;
    ovKey = key;
    if (ovLayer) ovLayer.remove();
    ovLayer = list.length ? R.buildOverlays(list, tpl) : null;
    if (ovLayer) stage.appendChild(ovLayer);
  }

  // ---------- 영상 재생 슬라이드 ----------
  // 소리: 예배당 전체화면 창(?window=1 의 main)에서만 (OBS 브라우저 소스는 소리 없음 → 이중 재생 방지)
  const soundHere = output === 'main' && isWindow;
  let endedKey = '';
  function applyVideo(p) {
    const v = current && current.querySelector('video.bc-play');
    if (!v || !p.video || !p.slide || p.slide.kind !== 'video') return;
    const o = p.slide.video || {};
    R.syncVideo(v, p.video, { sound: soundHere && o.sound, volume: o.volume ?? 1, loop: !!o.loop });
    if (!v.dataset.bound) {
      v.dataset.bound = '1';
      v.addEventListener('loadedmetadata', () => { if (lastPayload) R.syncVideo(v, lastPayload.video, { sound: soundHere && o.sound, volume: o.volume ?? 1, loop: !!o.loop }); });
      v.addEventListener('ended', () => {
        const key = lastPayload && lastPayload.video && lastPayload.video.key;
        if (!key || key === endedKey) return;
        endedKey = key;
        fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WorshipCue': '1' }, body: JSON.stringify({ cmd: 'videoEnded', args: { key, duration: v.duration } }) }).catch(() => {});
      });
    }
  }

  function render(p) {
    lastPayload = p;
    document.body.classList.toggle('nocursor', p.cursorHidden !== false);
    const stageChanged = setupStage(p.template);
    const show = p.hasLive && p.visible && p.slide;
    const key = show ? JSON.stringify([p.slide, p.versionName]) : '';
    const bg = stage.firstChild;
    bg.style.opacity = (!show && p.template.clearHidesBackground) ? '0' : '1';

    renderOverlays(p, stageChanged);
    if (!stageChanged && key === lastKey) { applyVideo(p); ack(p); return; }
    lastKey = key;

    const token = ++renderSeq;
    // 지금 무대에 있는 본문층은 모두 '이전 층' (전환 중에 또 넘겨도 남는 층이 없게)
    const olds = [...stage.querySelectorAll(':scope > .bc-area')];
    current = null;
    if (!show) {
      // 숨김: 디졸브면 서서히 사라짐
      if (p.template.clearHidesBackground || !p.hasLive) setVideoBg('');
      fadeOut(olds, fadeMs(), 0);
      ack(p);
      return;
    }
    // 순서 배경이 영상이면 영상 층에서 재생 (가사 화면 등 글자 슬라이드)
    const wantVid = p.slide.bg && R.isVideo(p.slide.bg) && !(R.lyricsOnly(tpl) && typeof p.slide.caption === 'string') ? p.slide.bg : '';
    setVideoBg(wantVid);
    const area = R.buildContent(p.slide, tpl, p.versionName, { videoBgLayer: true });
    area.style.transition = 'none';
    area.style.opacity = '0';
    stage.appendChild(area); // 이전 층 위에 쌓인다
    R.fit(area, tpl);
    current = area;
    applyVideo(p);
    // 그림(악보·PPT·배경)을 다 불러온 뒤에 바꾼다 → 빈 화면이 잠깐 보이는 깜빡임 방지
    whenReady(area, p.slide).then(() => {
      if (token !== renderSeq) return; // 그 사이 다음 슬라이드가 왔으면 그쪽이 처리
      const ms = fadeMs();
      if (!ms) { area.style.opacity = '1'; olds.forEach(o => o.remove()); return; }
      if (coversScreen(p.slide)) {
        // 화면을 꽉 채우는 그림: 이전 화면 위로 새 화면이 서서히 덮는다 (진짜 디졸브)
        fadeIn(area, ms, 0);
        olds.forEach(o => { o.style.transition = 'none'; });
        setTimeout(() => olds.forEach(o => o.remove()), ms + 50);
      } else {
        // 글자(배경이 비치는 층): 이전 글이 먼저 사라지고 새 글이 나타난다 → 두 글이 겹쳐 보이지 않음
        const half = Math.round(ms / 2);
        fadeOut(olds, half, 0);
        fadeIn(area, ms - half, olds.length ? half : 0);
      }
    });
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
