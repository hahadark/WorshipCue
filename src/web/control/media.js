/* 🎬 미디어 패널: 영상·음악을 큐시트에 넣지 않고 바로 송출·재생, 재생바 한 곳에
 * - 위: 지금 재생 중 (송출 중인 영상 또는 조작 PC 에서 재생 중인 음악)
 *   재생/일시정지 · 처음부터 · 정지 · 페이드아웃 · 위치 · 시간(남은 시간) · 소리 크기 · 반복
 * - 아래: 라이브러리의 영상 / 음악 (찾기) → ▶ 송출(영상: 예배당 화면 가득, 소리는 예배당 화면 창) / ▶ 재생(음악) / ＋ 큐시트
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const cmd = (c, a) => app.cmd(c, a);
  const st = { tab: 'video', q: '', rows: [], nowKey: '', probe: null, volT: 0 };
  const root = () => $('#panelMedia');
  const fmt = t => (isFinite(t) && t >= 0 ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00');

  function init() {
    const el = root();
    if (!el) return;
    el.innerHTML = `<div class="md">
      <div class="md-now" id="mdNow"></div>
      <div class="md-bar"><span class="view-tabs" id="mdTabs"><button data-mt="video" class="on">🎬 영상</button><button data-mt="audio">🔊 음악</button></span>
        <input type="text" id="mdQ" placeholder="파일 이름으로 찾기" style="flex:1"><button id="mdFolders" title="라이브러리 폴더 등록·빼기">폴더…</button></div>
      <div class="md-list" id="mdList"></div></div>`;
    $('#mdTabs').onclick = e => { const b = e.target.closest('[data-mt]'); if (!b) return; st.tab = b.dataset.mt; $('#mdTabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); load(); };
    let qt = 0;
    $('#mdQ').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { st.q = e.target.value.trim(); load(); }, 200); };
    $('#mdFolders').onclick = () => { if (window.BCDock) window.BCDock.show('library'); setTimeout(() => window.BCLib && window.BCLib.show(st.tab === 'video' ? 'images' : 'audio'), 150); };
    $('#mdList').addEventListener('click', e => {
      const b = e.target.closest('[data-go], [data-cue]');
      const row = e.target.closest('.md-row');
      if (!row) return;
      const f = st.rows[+row.dataset.k];
      if (b && b.dataset.cue != null) return addCue(f);
      go(f, +row.dataset.k);
    });
    $('#mdNow').addEventListener('click', onNowClick);
    $('#mdNow').addEventListener('input', onNowInput);
    $('#mdNow').addEventListener('change', onNowChange);
    load();
    setInterval(tick, 250);
  }

  async function load() {
    const kind = st.tab === 'video' ? 'image' : 'audio';
    const r = await cmd('searchLibFiles', { kind, query: st.q, folder: '' });
    let rows = r.ok ? r.result : [];
    if (st.tab === 'video') rows = rows.filter(f => f.video);
    st.rows = rows;
    const list = $('#mdList');
    if (!list) return;
    list.innerHTML = rows.length ? rows.map((f, k) => `<div class="md-row" data-k="${k}" title="${esc(f.name)}"><button data-go="${k}" class="primary">${st.tab === 'video' ? '▶ 송출' : '▶ 재생'}</button><span class="md-t"><b>${esc(f.name)}</b> <span class="muted">${esc(f.folder || '')}</span></span><button data-cue="${k}" title="큐시트에 넣기 (고른 순서 다음)">＋ 큐시트</button></div>`).join('')
      : `<div class="empty">${st.q ? '찾는 파일이 없습니다.' : st.tab === 'video' ? '라이브러리에 영상이 없습니다. \'폴더…\' 로 영상이 있는 폴더를 등록하세요.' : '라이브러리에 음악이 없습니다. \'폴더…\' 로 음악 폴더를 등록하세요.'}</div>`;
  }

  /** ▶ 송출 (영상) · ▶ 재생 (음악) */
  async function go(f, k) {
    if (st.tab === 'audio') return window.BCLib && window.BCLib.audio.play({ url: f.url, title: f.name, list: st.rows, index: k });
    const slide = { kind: 'video', image: f.url, ref: f.name, label: '영상', parts: [], caption: '', video: { volume: 1, sound: true, loop: false, endAction: 'hold' } };
    const r = await app.sendSlidesLive(f.name, [slide]);
    if (r && !r.ok) app.showMsg(r.error, 'error');
  }
  function addCue(f) {
    if (!window.BCLib || !window.BCLib.addToCue) return;
    if (st.tab === 'video') window.BCLib.addToCue('video', { file: f.url, title: f.name, sound: true, volume: 1, loop: false, endAction: 'hold' }, f.name);
    else window.BCLib.addToCue('audio', { file: f.url, title: f.name, volume: 1, fadeOnLeave: true }, f.name);
  }

  // ---------- 지금 재생 중 ----------
  function liveVideo() {
    const live = app.state && app.state.live;
    // 정지·페이드아웃 뒤(숨김 + 멈춤)에는 '재생 중 없음'
    return live && live.hasLive && live.slide && live.slide.kind === 'video' && live.video && (live.visible || live.video.playing) ? live : null;
  }
  function audioInfo() { return window.BCLib && window.BCLib.audio.info ? window.BCLib.audio.info() : null; }
  /** 영상 길이: LIVE 모니터의 영상, 없으면 숨은 영상으로 읽는다 */
  function videoDuration(url) {
    const v = document.querySelector('#lvScreen video.bc-play');
    if (v && v.duration) return v.duration;
    if (!st.probe || st.probe.dataset.url !== url) {
      st.probe = Object.assign(document.createElement('video'), { preload: 'metadata', muted: true });
      st.probe.dataset.url = url;
      st.probe.src = url;
    }
    return st.probe.duration || 0;
  }
  function drawNow() {
    const box = $('#mdNow');
    if (!box) return;
    const lv = liveVideo();
    const au = audioInfo();
    const kind = lv ? 'video' : au && au.url ? 'audio' : '';
    const key = kind === 'video' ? 'v' + lv.video.key : kind === 'audio' ? 'a' + au.url : '';
    if (key === st.nowKey) return;
    st.nowKey = key;
    if (!kind) { box.innerHTML = '<div class="md-idle muted">재생 중인 미디어 없음 — 아래 목록에서 ▶ 를 누르세요</div>'; return; }
    const title = kind === 'video' ? (lv.passage && (lv.passage.itemTitle || lv.passage.title)) || lv.slide.ref || '' : au.title;
    const vol = kind === 'video' ? (lv.video.volume ?? (lv.slide.video && lv.slide.video.volume) ?? 1) : au.volume;
    const loop = kind === 'video' ? !!(lv.video.loop ?? (lv.slide.video && lv.slide.video.loop)) : !!au.loop;
    box.innerHTML = `<div class="md-head"><span class="md-kind">${kind === 'video' ? '🎬 송출 중' : '🔊 재생 중 (이 PC)'}</span> <b>${esc(title)}</b></div>
      <div class="md-ctl"><button data-a="pp" class="md-pp">❚❚</button><button data-a="restart" title="처음부터">⟲</button><button data-a="stop" title="정지${kind === 'video' ? ' (화면도 숨김)' : ''}">■</button><button data-a="fade" title="3초 동안 줄이며 끄기">페이드아웃</button>
        <label class="tc-toggle" title="끝나면 처음부터 다시"><input type="checkbox" data-loop ${loop ? 'checked' : ''}> 🔁 반복</label></div>
      <div class="md-seek"><input type="range" data-seek min="0" max="1" step="0.001" value="0"><span data-time class="muted"></span></div>
      <div class="md-vol"><span title="소리 크기">🔈</span><input type="range" data-vol min="0" max="1" step="0.05" value="${vol}"><span data-volv class="muted">${Math.round(vol * 100)}%</span>${kind === 'video' ? '<span class="muted md-note">소리는 예배당 화면 창에서</span>' : ''}</div>`;
    tick();
  }
  function tick() {
    drawNow();
    const box = $('#mdNow');
    if (!box || !st.nowKey) return;
    let pos = 0, dur = 0, playing = false;
    const lv = liveVideo();
    if (st.nowKey[0] === 'v' && lv) {
      const v = lv.video;
      pos = v.offset + (v.playing ? (Date.now() - (Date.now() - (v.now || Date.now())) - v.at) / 1000 : 0);
      dur = videoDuration(lv.slide.image);
      playing = v.playing;
      if (dur && (lv.video.loop ?? (lv.slide.video && lv.slide.video.loop))) pos = pos % dur;
      else if (dur) pos = Math.min(pos, dur);
    } else {
      const au = audioInfo();
      if (!au) return;
      pos = au.currentTime; dur = au.duration; playing = !au.paused;
    }
    const seek = box.querySelector('[data-seek]');
    if (seek && !seek.matches(':active')) seek.value = dur ? Math.min(1, pos / dur) : 0;
    const tm = box.querySelector('[data-time]');
    if (tm) tm.textContent = `${fmt(pos)} / ${fmt(dur)}${dur ? `  (−${fmt(dur - pos)})` : ''}`;
    const pp = box.querySelector('.md-pp');
    if (pp) pp.textContent = playing ? '❚❚' : '▶';
  }
  function onNowClick(e) {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (st.nowKey[0] === 'v') {
      const map = { pp: { action: 'toggle' }, restart: { action: 'restart' }, stop: { action: 'stop' }, fade: { action: 'fadeout', ms: 3000 } };
      cmd('videoControl', map[a]);
    } else {
      const A = window.BCLib.audio;
      if (a === 'pp') A.toggle();
      else if (a === 'restart') A.seek(0);
      else if (a === 'stop') A.stop();
      else if (a === 'fade') A.fadeOut(3000);
    }
    setTimeout(tick, 120);
  }
  function onNowInput(e) {
    const t = e.target;
    if (t.matches('[data-vol]')) {
      const v = +t.value;
      $('#mdNow [data-volv]').textContent = Math.round(v * 100) + '%';
      if (st.nowKey[0] === 'v') { clearTimeout(st.volT); st.volT = setTimeout(() => cmd('videoControl', { action: 'volume', value: v }), 120); }
      else window.BCLib.audio.setVolume(v);
    }
  }
  function onNowChange(e) {
    const t = e.target;
    if (t.matches('[data-seek]')) {
      if (st.nowKey[0] === 'v') { const lv = liveVideo(); const dur = lv ? videoDuration(lv.slide.image) : 0; if (dur) cmd('videoControl', { action: 'seek', time: +t.value * dur }); }
      else window.BCLib.audio.seek(+t.value);
    } else if (t.matches('[data-loop]')) {
      if (st.nowKey[0] === 'v') cmd('videoControl', { action: 'loop', on: t.checked });
      else window.BCLib.audio.setLoop(t.checked);
    }
  }

  window.BCMedia = { init, refresh: () => load() };
})();
