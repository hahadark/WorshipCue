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
  let drawState = null; // 화면에 그리기·강조

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
    stage.insertBefore(layer, mediaEl && mediaEl.isConnected ? mediaEl.nextSibling : (stage.children[1] || null)); // 템플릿 배경(·배경 미디어) 바로 위, 글자 아래
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
    const o = { ...(p.slide.video || {}) };
    if (p.video.volume != null) o.volume = p.video.volume; // 미디어 패널에서 바꾼 소리 크기
    if (p.video.loop != null) o.loop = p.video.loop;
    R.syncVideo(v, p.video, { sound: soundHere && o.sound, volume: o.volume ?? 1, loop: !!o.loop });
    // 페이드아웃: 소리와 화면을 서서히
    clearInterval(v._fadeT);
    if (p.video.fade) {
      const f = p.video.fade, skew = Date.now() - (p.video.now || Date.now()), base = v.volume;
      const step = () => { const k = Math.max(0, 1 - (Date.now() - skew - f.at) / f.ms); v.volume = base * k; if (current) current.style.opacity = String(k); if (k <= 0) clearInterval(v._fadeT); };
      step(); v._fadeT = setInterval(step, 50);
    } else if (current) current.style.opacity = '';
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

  // ---------- 배경 숨김 · 로고 화면 ----------
  let logoEl = null;
  let mediaEl = null;
  /** 배경 미디어 층 바꾸기 (같은 것이면 그대로 — 카메라·영상이 끊기지 않게) */
  function applyMedia(m) {
    const key = m ? JSON.stringify([m.type, m.deviceId, m.url, m.fit]) : '';
    if (mediaEl && mediaEl.dataset.key === key && mediaEl.isConnected) return;
    const old = mediaEl;
    mediaEl = null;
    if (old) { old.style.opacity = '0'; setTimeout(() => old.remove(), 450); }
    if (!m) return;
    const el = R.buildMediaLayer(m);
    el.style.opacity = '0';
    stage.insertBefore(el, stage.children[1] || null); // 템플릿 배경 바로 위
    mediaEl = el;
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1'; }));
  }
  function applyLayers(p) {
    const L = p.layers || {};
    stage.classList.toggle('hide-bg', !!L.hideBg);
    applyMedia(L.media || null);
    const want = L.logo ? L.logoImage : '';
    if (logoEl && (!want || logoEl.dataset.img !== want)) { const old = logoEl; logoEl = null; old.style.opacity = '0'; setTimeout(() => old.remove(), 450); }
    if (want && !logoEl) {
      logoEl = R.buildLogoScreen(want);
      logoEl.dataset.img = want;
      logoEl.style.opacity = '0';
      stage.appendChild(logoEl);
      requestAnimationFrame(() => requestAnimationFrame(() => { if (logoEl) logoEl.style.opacity = '1'; }));
    }
    if (logoEl && logoEl !== stage.lastChild) stage.appendChild(logoEl); // 늘 맨 위
  }

  /** OBS 자막: 글 없는 그림·악보 슬라이드를 우상단에 작게 (예배당 화면 모양 그대로) */
  let pipKey = '';
  function applyPip(p, show) {
    let el = document.getElementById('bcPip');
    const want = p.pip && show && (p.slide.kind === 'image' || p.slide.kind === 'score');
    if (!want) { if (el) el.remove(); pipKey = ''; return; }
    if (!el) { el = document.createElement('div'); el.id = 'bcPip'; el.className = 'bc-pip'; document.body.appendChild(el); }
    const t = p.pip.template;
    el.style.aspectRatio = `${t.width} / ${t.height}`;
    const k = JSON.stringify([p.slide.image, p.slide.bg, p.slide.edit || null, t.id, t.width]);
    if (k === pipKey) return;
    pipKey = k;
    el.innerHTML = '';
    R.renderInto(el, { ...p.slide, caption: '' }, t);
  }
  function render(p) {
    if (p.cameras) R.setCameraPrefs(p.cameras); // 카메라 해상도·프레임·밝기 (조작 화면과 같게)
    queueMicrotask(() => { if (stage && tpl && drawState) R.paintDraw(stage, drawState, tpl); }); // 그리기 층은 늘 맨 위
    lastPayload = p;
    document.body.classList.toggle('nocursor', p.cursorHidden !== false);
    document.body.classList.toggle('held', !!p.held); // 보조 화면을 꺼서 OBS 화면도 숨김
    // 그림 우상단을 켰으면, 자막(가사만) 화면에서는 그림을 크게 그리지 않고 우상단에만 (가사가 있으면 가사는 아래에)
    if (p.pip && p.slide && (p.slide.kind === 'image' || p.slide.kind === 'score') && typeof p.slide.caption !== 'string') p = { ...p, slide: { ...p.slide, caption: '' } };
    const stageChanged = setupStage(p.template);
    const show = p.hasLive && p.visible && p.slide;
    applyPip(p, show);
    const key = show ? JSON.stringify([p.slide, p.versionName]) : '';
    const bg = stage.firstChild;
    bg.style.opacity = (!show && p.template.clearHidesBackground) ? '0' : '1';

    renderOverlays(p, stageChanged);
    if (stageChanged) { logoEl = null; mediaEl = null; }
    applyLayers(p);
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
    es.addEventListener('draw', e => {
      try { drawState = JSON.parse(e.data); if (stage && tpl) R.paintDraw(stage, drawState, tpl); } catch (err) { console.error(err); }
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
