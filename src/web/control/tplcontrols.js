/* 템플릿을 직관적으로 바꾸는 공용 조작 부품
 * - 메인 화면 '빠른 설정' 패널과 설정 → 템플릿 편집기에서 함께 쓴다.
 * - 글꼴(글꼴 모양 그대로 보이는 목록), 크기 슬라이더, 색 견본, 9칸 위치 판, 내어쓰기, 여백 슬라이더, 표시 항목
 * render(container, tpl, onChange): tpl 은 직접 수정되고, 바뀔 때마다 onChange(tpl, {final}) 호출
 *   final=false 는 슬라이더를 끄는 중(미리보기만), final=true 는 확정(저장)
 */
(function () {
  'use strict';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const BASE_FONTS = ['맑은 고딕', '나눔고딕', '나눔명조', '나눔스퀘어', '바탕', '돋움', '굴림', '궁서', 'Pretendard', 'Noto Sans KR', 'Noto Serif KR', 'Arial', 'Georgia', 'Times New Roman', 'Segoe UI'];
  let fontList = null;
  let fontPromise = null;
  function loadFonts() {
    if (fontList) return Promise.resolve(fontList);
    if (!fontPromise) {
      fontPromise = (async () => {
        let names = [];
        try { if (window.queryLocalFonts) names = [...new Set((await window.queryLocalFonts()).map(f => f.family))]; } catch { /* 권한 없음 */ }
        // 설치되지 않은 기본 후보는 빼고, 실제 설치 글꼴을 앞에(한글 글꼴 우선) 정렬
        const base = names.length ? BASE_FONTS.filter(n => names.includes(n) || n === '맑은 고딕') : BASE_FONTS;
        const ko = n => /[가-힣]/.test(n) ? 0 : 1;
        fontList = [...new Set([...base, ...names])].sort((a, b) => ko(a) - ko(b) || a.localeCompare(b, 'ko'));
        return fontList;
      })();
    }
    return fontPromise;
  }

  const fontName = family => ((String(family).match(/^\s*['"]?([^'",]+)/) || [])[1] || '').trim();
  const fontFamily = name => `'${name.replace(/'/g, '')}', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif`;

  const TEXT_COLORS = ['#ffffff', '#fff3c4', '#ffd479', '#9ec5ff', '#b8f2c8', '#000000'];
  const REF_COLORS = ['#ffd479', '#ffffff', '#9ec5ff', '#ff9b9e', '#cccccc', '#000000'];
  const BG_COLORS = ['transparent', '#000000', '#0b1d3a', '#13261b', '#2a1414', '#1f1f1f', '#ffffff'];

  const VALIGNS = [['top', '위'], ['middle', '가운데'], ['bottom', '아래']];
  const ALIGNS = [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']];

  function swatches(name, colors, current, allowTransparent) {
    return `<div class="tc-swatches" data-sw="${name}">`
      + colors.map(c => c === 'transparent'
        ? (allowTransparent ? `<button type="button" class="tc-sw tc-sw-t ${current === 'transparent' ? 'on' : ''}" data-c="transparent" title="투명 (OBS 합성용)"></button>` : '')
        : `<button type="button" class="tc-sw ${String(current).toLowerCase() === c ? 'on' : ''}" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')
      + `<label class="tc-sw tc-sw-pick" title="다른 색 고르기"><input type="color" data-pick="${name}" value="${/^#[0-9a-f]{6}$/i.test(current) ? current : '#ffffff'}">+</label></div>`;
  }

  function slider(path, label, value, min, max, step = 1, unit = 'px') {
    return `<div class="tc-row"><span class="tc-label">${label}</span>
      <button type="button" class="tc-step" data-step="${path}" data-d="-${step}">−</button>
      <input type="range" data-range="${path}" min="${min}" max="${max}" step="${step}" value="${value}">
      <button type="button" class="tc-step" data-step="${path}" data-d="${step}">+</button>
      <span class="tc-val" data-val="${path}">${value}${unit}</span></div>`;
  }

  function toggle(path, label, on) {
    return `<label class="tc-toggle"><input type="checkbox" data-tog="${path}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
  }

  const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
  const set = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

  function render(container, t, onChange, opts = {}) {
    const hanging = t.align === 'hanging';
    const colAlign = hanging ? 'left' : t.align;
    const bg = t.background.type === 'transparent' ? 'transparent' : t.background.type === 'color' ? t.background.color : '';
    const sideMargin = Math.round((t.padding.left + t.padding.right) / 2);
    const fname = fontName(t.font.family);

    // ---- 부분 조각 ----
    const fontRow = `<div class="tc-row"><span class="tc-label">글꼴</span>
            <select class="tc-font" data-font data-noi18n><option value="${esc(fname)}" style="font-family:${esc(t.font.family)}">${esc(fname)}</option></select></div>`;
    const posBlock = `<div class="tc-posrow">
            <div class="tc-pos" title="본문이 놓일 위치를 누르세요">
              ${VALIGNS.map(([v, vl]) => ALIGNS.map(([a, al]) => `<button type="button" data-pos="${v}|${a}" class="${t.valign === v && colAlign === a ? 'on' : ''}" title="${vl} · ${al}"><i class="tc-pos-${a}"></i></button>`).join('')).join('')}
            </div>
            <div class="tc-poshelp">
              <button type="button" class="tc-hang ${hanging ? 'on' : ''}" data-hang title="절 번호를 왼쪽 칸에 두고, 줄이 바뀌어도 본문 시작 위치에 맞춥니다">
                <span class="tc-hang-ico"><b>1</b><i></i><i class="s"></i><b>2</b><i></i></span>내어쓰기 ${hanging ? '켜짐' : '꺼짐'}</button>
              <div class="tc-note">${VALIGNS.find(x => x[0] === t.valign)?.[1]} · ${hanging ? '왼쪽 + 내어쓰기' : ALIGNS.find(x => x[0] === colAlign)?.[1]}</div>
            </div>
          </div>`;
    const REF_POS = opts.basic
      ? [['top', '위'], ['bottom', '아래'], ['fixed-top', '위 고정'], ['fixed-bottom', '아래 고정']]
      : [['top', '본문 위'], ['bottom', '본문 아래'], ['fixed-top', '화면 위 고정'], ['fixed-bottom', '화면 아래 고정']];
    const refPosSeg = `<div class="tc-row"><span class="tc-label">장절 위치</span><div class="tc-seg tc-seg-sm" data-seg="reference.position">${REF_POS.map(([v, l]) => `<button type="button" data-v="${v}" class="${t.reference.position === v ? 'on' : ''}" title="${v.startsWith('fixed') ? '본문 길이와 상관없이 화면 가장자리의 같은 자리에 표시' : '본문에 붙어서 표시'}">${l}</button>`).join('')}</div></div>`;
    const refModeSeg = `<div class="tc-row"><span class="tc-label">장절 내용</span><div class="tc-seg tc-seg-sm" data-seg="reference.mode">${[['slide', '슬라이드별 (8:18-20)'], ['passage', '전체 범위 고정 (8:18-25)']].map(([v, l]) => `<button type="button" data-v="${v}" class="${(t.reference.mode || 'slide') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
    const refOffset = String(t.reference.position).startsWith('fixed') ? slider('reference.offset', '가장자리 거리', t.reference.offset ?? 60, 0, Math.round(t.height * 0.4), 5) : '';

    // 배경: [테마 그라데이션] 단색 견본 · 투명 · [이미지 올리기] (+ 이미지면 어둡게·맞춤)
    const isImg = t.background.type === 'image' && t.background.image;
    const isGrad = t.background.type === 'gradient';
    const gradBtn = t.background.gradient
      ? `<button type="button" class="tc-sw tc-sw-grad ${isGrad ? 'on' : ''}" data-bgmode="gradient" title="테마 배경 (그라데이션)" style="background:${esc(t.background.gradient)}"></button>` : '';
    const isVid = t.background.type === 'video' && t.background.video;
    const vidBtn = `<button type="button" class="tc-imgbtn ${isVid ? 'on' : ''}" data-pickvid title="라이브러리의 영상을 배경으로 (소리 없이 반복 재생)">🎞 ${isVid ? '영상 바꾸기' : '영상'}</button>`;
    const isCam = t.background.type === 'camera';
    const camBtn = `<button type="button" class="tc-imgbtn ${isCam ? 'on' : ''}" data-pickcam title="웹캠·캡처보드 화면을 배경으로 (예배당 화면 · 이 PC 의 출력에서만, OBS 는 OBS 의 카메라 소스를 쓰세요)">📷 ${isCam ? esc((t.background.camera || {}).label || '카메라') : '카메라'}</button>`;
    const imgBtn = camBtn + vidBtn + `<button type="button" class="tc-imgbtn ${isImg ? 'on' : ''}" data-pickimg="background" title="배경 이미지 올리기 (png · jpg · webp)">${isImg ? `<img src="${esc(t.background.image)}" alt="">` : '🖼'} ${isImg ? '이미지 바꾸기' : '이미지'}</button>`;
    const bgBlock = `<div class="tc-row"><span class="tc-label">배경</span>${gradBtn}${swatches('background', BG_COLORS, bg, true)}${imgBtn}</div>`
      + (isImg || isVid || isCam ? slider('background.dim', isCam ? '카메라 어둡게' : isVid ? '영상 어둡게' : '이미지 어둡게', t.background.dim || 0, 0, 0.85, 0.05, '')
        + `<div class="tc-row"><span class="tc-label">이미지 맞춤</span><div class="tc-seg tc-seg-sm" data-seg="background.imageFit">${[['cover', '화면 채우기'], ['contain', '전체 보이기']].map(([v, l]) => `<button type="button" data-v="${v}" class="${(t.background.imageFit || 'cover') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>` : '');

    // 로고: 없음 · 레드 쉴드 · 크레스트 · 내 로고 올리기 (+ 위치·크기)
    const LOGOS = [['', '없음'], ['/shared/assets/sa-shield.png', '레드 쉴드'], ['/shared/assets/sa-crest.png', '크레스트']];
    const LOGO_POS = [['top-left', '↖'], ['top-center', '↑'], ['top-right', '↗'], ['bottom-left', '↙'], ['bottom-center', '↓'], ['bottom-right', '↘']];
    const lg = t.logo || {};
    const curLogo = lg.show && lg.image ? lg.image : '';
    const customLogo = curLogo && !LOGOS.some(l => l[0] === curLogo);
    const logoBlock = `<div class="tc-row"><span class="tc-label">로고</span><div class="tc-seg tc-seg-sm">${LOGOS.map(([v, l]) => `<button type="button" data-logo="${v}" class="${curLogo === v ? 'on' : ''}">${l}</button>`).join('')}<button type="button" data-pickimg="logo" class="${customLogo ? 'on' : ''}" title="교회 로고 등 이미지 올리기 (투명 배경 png 권장)">${customLogo ? `<img class="tc-logo-th" src="${esc(curLogo)}" alt=""> 내 로고` : '내 로고 올리기…'}</button></div></div>`
      + (curLogo ? `<div class="tc-row"><span class="tc-label">로고 위치</span><div class="tc-seg tc-seg-sm" data-seg="logo.position">${LOGO_POS.map(([v, l]) => `<button type="button" data-v="${v}" class="${(lg.position || 'top-right') === v ? 'on' : ''}" title="${v}">${l}</button>`).join('')}</div></div>`
        + slider('logo.size', '로고 크기', lg.size || 120, 40, 400, 5)
        + (opts.basic ? '' : slider('logo.opacity', '로고 진하기', lg.opacity ?? 1, 0.1, 1, 0.05, '') + slider('logo.margin', '가장자리 거리', lg.margin ?? 40, 0, 200, 5)) : '');

    // 전환: 디졸브 / 컷 (+ 디졸브 시간)
    const animType = ['dissolve', 'fade'].includes(t.animation && t.animation.type) ? 'dissolve' : 'cut';
    const fxBlock = `<div class="tc-row"><span class="tc-label">전환</span><div class="tc-seg tc-seg-sm" data-seg="animation.type">${[['dissolve', '디졸브'], ['cut', '컷']].map(([v, l]) => `<button type="button" data-v="${v}" class="${animType === v ? 'on' : ''}" title="${v === 'cut' ? '바로 바뀝니다' : '새 화면이 이전 화면 위로 서서히 겹쳐 나타납니다'}">${l}</button>`).join('')}</div></div>`
      + (animType === 'dissolve' ? slider('animation.duration', '디졸브 시간', t.animation.duration ?? 400, 100, 2000, 50, 'ms') : '');
    // PPT·찬송가 슬라이드: 그림 그대로 / 가사만 (OBS 하단 자막)
    const pptMode = t.pptMode || (t.background.type === 'transparent' ? 'lyrics' : 'image');
    const pptBlock = `<div class="tc-row"><span class="tc-label">PPT 슬라이드</span><div class="tc-seg tc-seg-sm" data-seg="pptMode">${[['image', '그림 그대로'], ['lyrics', '가사만']].map(([v, l]) => `<button type="button" data-v="${v}" class="${pptMode === v ? 'on' : ''}" title="${v === 'lyrics' ? 'PPT·찬송가를 그림 대신 가사 글자만 이 템플릿의 위치·글꼴로 (OBS 하단 자막용)' : 'PPT 화면을 그대로'}">${l}</button>`).join('')}</div></div>`;

    if (opts.basic) {
      // 빠른 설정: 예배 중 자주 바꾸는 것만
      container.innerHTML = `
      <div class="tc tc-basic">
        <section class="tc-sec">
          ${fontRow}
          ${slider('font.size', '글자 크기', t.font.size, 20, 200, 2)}
          <div class="tc-row"><span class="tc-label">본문 색</span>${swatches('font.color', TEXT_COLORS, t.font.color)}</div>
          ${bgBlock}
        </section>
        <section class="tc-sec">
          ${posBlock}
          ${refPosSeg}
          <div class="tc-row"><span class="tc-label"></span>${toggle('reference.show', '장절 표시', t.reference.show)}${toggle('reference.mode', '전체 범위 고정', t.reference.mode === 'passage')}${toggle('verseNumbers.show', '절 번호', t.verseNumbers.show)}</div>
          ${logoBlock}
          ${fxBlock}
          ${pptBlock}
        </section>
      </div>`;
    } else {
      container.innerHTML = `
      <div class="tc">
        <section class="tc-sec">
          <h5>글꼴</h5>
          ${fontRow}
          ${slider('font.size', '글자 크기', t.font.size, 20, 200, 2)}
          <div class="tc-row"><span class="tc-label">굵기</span>
            <div class="tc-seg" data-seg="font.weight">${[[400, '보통'], [500, '중간'], [700, '굵게']].map(([v, l]) => `<button type="button" data-v="${v}" class="${+t.font.weight === v ? 'on' : ''}" style="font-weight:${v}">${l}</button>`).join('')}</div></div>
          ${slider('font.lineHeight', '줄 간격', t.font.lineHeight, 1, 2.2, 0.05, '배')}
          <div class="tc-row">${toggle('font.autoFit', '화면에 맞게 자동 축소', t.font.autoFit)}</div>
        </section>

        <section class="tc-sec">
          <h5>색</h5>
          <div class="tc-row"><span class="tc-label">본문</span>${swatches('font.color', TEXT_COLORS, t.font.color)}</div>
          <div class="tc-row"><span class="tc-label">장절</span>${swatches('reference.color', REF_COLORS, t.reference.color)}</div>
          <div class="tc-row"><span class="tc-label">절 번호</span>${swatches('verseNumbers.color', REF_COLORS, t.verseNumbers.color)}</div>
        </section>

        <section class="tc-sec">
          <h5>배경</h5>
          ${bgBlock}
        </section>

        <section class="tc-sec">
          <h5>로고</h5>
          ${logoBlock}
        </section>

        <section class="tc-sec">
          <h5>위치·정렬</h5>
          ${posBlock}
          ${slider('padding.top', '위 여백', t.padding.top, 0, Math.round(t.height * 0.8), 10)}
          ${slider('padding.bottom', '아래 여백', t.padding.bottom, 0, Math.round(t.height * 0.8), 10)}
          ${slider('padding.side', '좌우 여백', sideMargin, 0, Math.round(t.width * 0.35), 10)}
        </section>

        <section class="tc-sec">
          <h5>장절</h5>
          <div class="tc-row">${toggle('reference.show', '장절 표시', t.reference.show)}</div>
          ${refPosSeg}
          ${refModeSeg}
          ${refOffset}
          ${slider('reference.size', '장절 크기', t.reference.size, 14, 120, 2)}
        </section>

        <section class="tc-sec">
          <h5>전환 · PPT</h5>
          ${fxBlock}
          ${pptBlock}
        </section>

        <section class="tc-sec">
          <h5>표시</h5>
          <div class="tc-toggles">
            ${toggle('verseNumbers.show', '절 번호', t.verseNumbers.show)}
            ${toggle('verseBreak', '절마다 줄바꿈', t.verseBreak || hanging)}
            ${toggle('versionLabel.show', '번역본 이름', t.versionLabel.show)}
            ${toggle('box.enabled', '본문 뒤 상자', t.box.enabled)}
            ${toggle('shadow.enabled', '그림자', t.shadow.enabled)}
          </div>
        </section>
      </div>`;
    }

    const root = container.firstElementChild;
    const emit = final => onChange(t, { final });
    const fill = list => {
      const sel = root.querySelector('[data-font]');
      if (!sel) return;
      const names = list.includes(fname) || !fname ? list : [fname, ...list];
      sel.innerHTML = names.map(n => `<option value="${esc(n)}" style="font-family:${esc(fontFamily(n))}" ${n === fname ? 'selected' : ''}>${esc(n)}</option>`).join('');
      sel.style.fontFamily = t.font.family;
    };
    loadFonts().then(fill);

    const setValLabel = (path, v) => {
      const el = root.querySelector(`[data-val="${path}"]`);
      if (el) el.textContent = v + (path === 'font.lineHeight' ? '배' : /dim|opacity/.test(path) ? '' : 'px');
    };
    const applyRange = (path, v, final) => {
      v = Number(v);
      if (path.startsWith('logo.') && !t.logo) t.logo = {};
      if (path === 'padding.side') { t.padding.left = v; t.padding.right = v; } else set(t, path, v);
      if (path === 'font.size' && t.font.minSize > v) t.font.minSize = v;
      setValLabel(path, path === 'font.lineHeight' || /dim|opacity/.test(path) ? v.toFixed(2) : v);
      const r = root.querySelector(`[data-range="${path}"]`);
      if (r && +r.value !== v) r.value = v;
      emit(final);
    };

    root.addEventListener('input', e => {
      const el = e.target;
      if (el.dataset.range) applyRange(el.dataset.range, el.value, false);
      else if (el.dataset.pick) applyColor(el.dataset.pick, el.value, false);
    });
    root.addEventListener('change', e => {
      const el = e.target;
      if (el.dataset.range) applyRange(el.dataset.range, el.value, true);
      else if (el.dataset.pick) applyColor(el.dataset.pick, el.value, true);
      else if (el.dataset.font !== undefined) { t.font.family = fontFamily(el.value); el.style.fontFamily = t.font.family; emit(true); }
      else if (el.dataset.tog) {
        const p = el.dataset.tog;
        if (p === 'verseBreak' && !el.checked && t.align === 'hanging') { el.checked = true; return; } // 내어쓰기는 항상 절마다 줄바꿈
        if (p === 'reference.mode') t.reference.mode = el.checked ? 'passage' : 'slide';
        else if (p === 'logo.show') { t.logo = t.logo || {}; t.logo.show = el.checked; }
        else set(t, p, el.checked);
        emit(true);
      }
    });

    function applyColor(path, c, final) {
      if (path === 'background') {
        if (c === 'transparent') { t.background.type = 'transparent'; t.clearHidesBackground = true; }
        else { t.background.type = 'color'; t.background.color = c; }
      } else set(t, path, c);
      root.querySelectorAll(`[data-sw="${path}"] .tc-sw[data-c]`).forEach(b => b.classList.toggle('on', b.dataset.c.toLowerCase() === String(c).toLowerCase()));
      emit(final);
      if (path === 'background' && final) render(container, t, onChange, opts);
    }

    /** 이미지 올리기 (배경 / 로고) */
    function pickImage(kind) {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        const ext = (f.name.match(/\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase();
        const r = await fetch('/api/media', { method: 'POST', headers: { 'X-WorshipCue': '1', 'X-Filename': kind + ext, 'Content-Type': 'application/octet-stream' }, body: f })
          .then(x => x.json()).catch(err => ({ ok: false, error: err.message }));
        if (!r.ok) { alert(r.error || '이미지를 올리지 못했습니다.'); return; }
        if (kind === 'background') {
          t.background.type = 'image'; t.background.image = r.url;
          if (t.background.dim == null) t.background.dim = 0;
          t.background.imageFit = t.background.imageFit || 'cover';
        } else {
          t.logo = { position: 'top-right', size: 120, margin: 40, opacity: 1, ...(t.logo || {}), image: r.url, show: true };
        }
        emit(true);
        render(container, t, onChange, opts);
      };
      inp.click();
    }

    root.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.c) { applyColor(b.closest('[data-sw]').dataset.sw, b.dataset.c, true); return; }
      if (b.dataset.pickimg) { pickImage(b.dataset.pickimg); return; }
      if (b.dataset.pickcam !== undefined) {
        pickCamera(dev => {
          t.background.type = 'camera'; t.background.camera = { deviceId: dev.deviceId, label: dev.label };
          if (t.background.dim == null) t.background.dim = 0;
          emit(true);
          render(container, t, onChange, opts);
        });
        return;
      }
      if (b.dataset.pickvid !== undefined) {
        if (!window.BCLib) return;
        window.BCLib.pickVideo(url => {
          t.background.type = 'video'; t.background.video = url;
          if (t.background.dim == null) t.background.dim = 0;
          emit(true);
          render(container, t, onChange, opts);
        });
        return;
      }
      if (b.dataset.bgmode === 'gradient') { t.background.type = 'gradient'; emit(true); render(container, t, onChange, opts); return; }
      if (b.dataset.logo !== undefined) {
        if (!b.dataset.logo) t.logo = { ...(t.logo || {}), show: false };
        else t.logo = { position: 'top-right', size: 120, margin: 40, opacity: 1, ...(t.logo || {}), image: b.dataset.logo, show: true };
        emit(true); render(container, t, onChange, opts); return;
      }
      if (b.dataset.step) {
        const p = b.dataset.step;
        const r = root.querySelector(`[data-range="${p}"]`);
        const v = Math.min(+r.max, Math.max(+r.min, Math.round((+r.value + Number(b.dataset.d)) * 100) / 100));
        applyRange(p, v, true);
        return;
      }
      if (b.dataset.pos) {
        const [v, a] = b.dataset.pos.split('|');
        t.valign = v;
        // 내어쓰기 중에 왼쪽 칸을 누르면 내어쓰기 유지, 다른 칸이면 일반 정렬로
        t.align = t.align === 'hanging' && a === 'left' ? 'hanging' : a;
        t.reference.align = a;
        emit(true);
        render(container, t, onChange, opts);
        return;
      }
      if (b.dataset.hang !== undefined) {
        if (t.align === 'hanging') { t.align = 'left'; }
        else { t.align = 'hanging'; t.reference.align = 'left'; t.verseNumbers.show = true; }
        emit(true);
        render(container, t, onChange, opts);
        return;
      }
      const seg = b.closest('[data-seg]');
      if (seg) {
        const p = seg.dataset.seg;
        if (p.startsWith('logo.') && !t.logo) t.logo = {};
        set(t, p, p === 'font.weight' ? Number(b.dataset.v) : b.dataset.v);
        seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        emit(true);
        if (p === 'reference.position' && !opts.basic) render(container, t, onChange, opts); // 고정이면 '가장자리 거리' 표시
        if (p === 'animation.type') render(container, t, onChange, opts); // 디졸브면 시간 조절 표시
      }
    });
  }

  window.BCTplControls = { render, loadFonts, fontName, fontFamily };
  /** 카메라 고르기: 연결된 카메라 목록 + 미리보기 */
  async function pickCamera(done) {
    const app = window.BC;
    let devs = [];
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); // 이름을 보려면 한 번 허락이 필요
      s.getTracks().forEach(x => x.stop());
      devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    } catch (e) { return app.showMsg('카메라를 찾지 못했습니다: ' + e.message, 'error', 5000); }
    if (!devs.length) return app.showMsg('연결된 카메라(웹캠·캡처보드)가 없습니다.', 'error', 4000);
    app.openModal('📷 배경으로 쓸 카메라', `<div class="cam-pick">
      <div class="note">웹캠이나 캡처보드(찬양팀 카메라 등)의 화면을 배경으로 깔고 그 위에 가사를 띄웁니다. 예배당 화면(이 PC 의 출력)에서만 보이고, OBS 에서는 OBS 의 카메라 소스 위에 'OBS 자막'을 겹치세요.</div>
      <div class="cam-list">${devs.map((d, k) => `<button type="button" class="cam-item" data-k="${k}"><video muted autoplay playsinline data-dev="${d.deviceId}"></video><span>${(d.label || '카메라 ' + (k + 1)).replace(/[<>&]/g, '')}</span></button>`).join('')}</div></div>`);
    const streams = [];
    document.querySelectorAll('.cam-item video').forEach(v => window.BCRender.cameraStream(v.dataset.dev).then(s => { v.srcObject = s; streams.push(s); }).catch(() => { v.replaceWith(Object.assign(document.createElement('div'), { className: 'cam-err', textContent: '열 수 없음' })); }));
    document.querySelectorAll('.cam-item').forEach(b => b.onclick = () => { const d = devs[+b.dataset.k]; app.closeModal(); done({ deviceId: d.deviceId, label: d.label || '카메라' }); });
  }
})();
