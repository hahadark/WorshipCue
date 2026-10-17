/* 조작 화면 테마 · 글자 크기 (보기 → 화면 테마)
 * 송출 화면의 디자인(빠른 설정 → 테마)과는 따로, 이 조작 화면의 색과 글자 크기만 바꾼다
 * 설정(ui)에 저장하고, 다음 실행 때 깜빡이지 않게 이 PC 에도 기억한다
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const app = window.BC;
  const THEMES = [
    { id: 'dark', name: '어둡게', desc: '기본. 어두운 방송실에서 눈부시지 않게', c: ['#121519', '#1a1e25', '#eef1f6', '#4f8cff', '#e5484d'] },
    { id: 'contrast', name: '고대비', desc: '검은 바탕에 흰 글자, 진한 테두리. 가장 또렷하게', c: ['#000000', '#0a0a0a', '#ffffff', '#3d9bff', '#ff4d55'] },
    { id: 'light', name: '밝게', desc: '낮 예배·밝은 사무실. 흰 바탕에 짙은 글자', c: ['#e9edf3', '#ffffff', '#182030', '#2f6fe0', '#d22f36'] },
    { id: 'warm', name: '따뜻하게', desc: '푸른 빛을 줄인 갈색. 오래 볼 때 눈이 편함', c: ['#191612', '#211d18', '#f4ebde', '#e3963d', '#e65a4f'] },
    { id: 'navy', name: '푸른 밤', desc: '짙은 남색 바탕', c: ['#0e1524', '#142035', '#ebf1fd', '#5b9bff', '#ee4f57'] },
  ];
  const SCALES = [[90, '작게'], [100, '보통'], [110, '크게'], [120, '아주 크게']];

  function apply(ui) {
    const t = THEMES.some(x => x.id === (ui && ui.theme)) ? ui.theme : 'dark';
    const sc = SCALES.some(([v]) => v === Number(ui && ui.scale)) ? Number(ui.scale) : 100;
    const h = document.documentElement;
    if (t === 'dark') delete h.dataset.theme; else h.dataset.theme = t;
    if (sc === 100) delete h.dataset.scale; else h.dataset.scale = String(sc);
    try { localStorage.setItem('wc-ui', JSON.stringify({ theme: t, scale: sc })); } catch { /* 무시 */ }
    // 화면 크기에 맞춘 미리보기·LIVE 다시 맞추기
    if (window.BCDock) setTimeout(() => window.BCDock.fitScreens(), 50);
  }
  const cur = () => (app.state && app.state.settings.ui) || { theme: 'dark', scale: 100 };

  async function save(patch) {
    const ui = { ...cur(), ...patch };
    apply(ui);
    if (app.state) app.state.settings.ui = ui;
    const r = await app.cmd('updateSettings', { patch: { ui } });
    if (!r.ok) app.showMsg(r.error, 'error');
  }

  /** 테마 고르기 창: 테마마다 작은 조작 화면 모형 */
  function open() {
    const draw = () => {
      const u = cur();
      $('#uiThemeBody').innerHTML = `<div class="uit-grid">${THEMES.map(t => `<button type="button" class="uit-card ${t.id === (u.theme || 'dark') ? 'on' : ''}" data-theme="${t.id}">
          <span class="uit-mock" style="background:${t.c[0]}">
            <i style="background:${t.c[1]}"><b style="background:${t.c[2]}"></b><b style="background:${t.c[2]};width:60%"></b><b style="background:${t.c[3]};width:40%"></b></i>
            <i style="background:${t.c[1]}"><em style="border-color:${t.c[3]}"></em><em style="border-color:${t.c[4]}"></em></i>
          </span>
          <span class="uit-name">${t.id === (u.theme || 'dark') ? '✓ ' : ''}${t.name}</span><span class="uit-desc">${t.desc}</span></button>`).join('')}</div>
        <div class="uit-scale"><b>글자 크기</b><span class="view-tabs">${SCALES.map(([v, l]) => `<button type="button" data-scale="${v}" class="${v === Number(u.scale || 100) ? 'on' : ''}">${l}</button>`).join('')}</span>
        <span class="muted">조작 화면 전체를 키웁니다 (Ctrl+Shift+= / Ctrl+Shift+-)</span></div>
        <p class="note">송출 화면(예배당·OBS)의 글꼴·색은 '빠른 설정 → 테마' 에서 따로 고릅니다.</p>`;
    };
    app.openModal('🎨 화면 테마 · 글자 크기', '<div id="uiThemeBody" class="uit"></div>');
    draw();
    $('#uiThemeBody').onclick = async e => {
      const c = e.target.closest('[data-theme]');
      const s = e.target.closest('[data-scale]');
      if (c) await save({ theme: c.dataset.theme });
      else if (s) await save({ scale: Number(s.dataset.scale) });
      else return;
      draw();
    };
  }

  function stepScale(d) {
    const list = SCALES.map(([v]) => v);
    const i = Math.max(0, Math.min(list.length - 1, list.indexOf(Number(cur().scale || 100)) + d));
    save({ scale: list[i] });
    app.showMsg(`글자 크기: ${SCALES[i][1]}`, 'info', 1200);
  }

  function init() {
    apply(cur());
    window.addEventListener('keydown', e => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); stepScale(1); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); stepScale(-1); }
    }, true);
  }

  window.BCUiTheme = { init, open, apply, themes: THEMES, setTheme: id => save({ theme: id }), stepScale };
})();
