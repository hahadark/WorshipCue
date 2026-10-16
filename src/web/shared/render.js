/* WorshipCue 공용 렌더러
 * 미리보기·Live 모니터·전체 화면 창·OBS 출력이 모두 같은 코드로 그린다.
 * 모든 크기는 템플릿 해상도(width×height) 기준이며, 화면에는 transform: scale 로 맞춘다.
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function hexToRgba(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex || 'transparent';
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /** 안전영역·여백을 반영한 본문 영역 (px) */
  function contentRect(t) {
    const sx = t.width * (t.safeArea || 0) / 100;
    const sy = t.height * (t.safeArea || 0) / 100;
    const p = t.padding;
    return { left: sx + p.left, top: sy + p.top, width: t.width - 2 * sx - p.left - p.right, height: t.height - 2 * sy - p.top - p.bottom };
  }

  function textStyle(t) {
    const f = t.font;
    const css = [
      `font-family:${f.family}`, `font-weight:${f.weight}`, `color:${f.color}`,
      `line-height:${f.lineHeight}`, `letter-spacing:${f.letterSpacing || 0}px`,
    ];
    const shadows = [];
    if (t.shadow && t.shadow.enabled) shadows.push(`${t.shadow.x}px ${t.shadow.y}px ${t.shadow.blur}px ${t.shadow.color}`);
    if (shadows.length) css.push(`text-shadow:${shadows.join(',')}`);
    if (t.stroke && t.stroke.width > 0) css.push(`-webkit-text-stroke:${t.stroke.width * 2}px ${t.stroke.color}`, 'paint-order:stroke fill');
    return css.join(';');
  }

  // 'hanging' = 왼쪽 정렬 + 내어쓰기 (절 번호를 왼쪽 칸에 두고 본문 줄을 맞춘다)
  const isHanging = t => t.align === 'hanging';
  const textAlign = a => (a === 'hanging' ? 'left' : a);

  /** 장절 글자: 슬라이드별 범위 또는 전체 범위(고정) */
  function refText(slide, t) {
    return t.reference.mode === 'passage' && slide.title ? slide.title : slide.ref;
  }

  function refHtml(slide, t, pos) {
    const r = t.reference;
    if (!r.show || r.position !== pos || !refText(slide, t)) return '';
    return `<div class="bc-ref" style="font-size:${r.size}px;color:${r.color};font-weight:${r.weight};text-align:${textAlign(r.align || t.align)}">${esc(refText(slide, t))}</div>`;
  }

  /** 화면 위/아래 가장자리에 고정된 장절 (본문 길이와 상관없이 같은 자리) */
  function fixedRefHtml(slide, t, rect) {
    const r = t.reference;
    if (!r.show || !String(r.position).startsWith('fixed') || !refText(slide, t)) return '';
    const off = Number(r.offset ?? 60);
    const sy = t.height * (t.safeArea || 0) / 100;
    // 본문 영역(area) 기준 좌표로 바꿔 배치
    const vpos = r.position === 'fixed-top'
      ? `top:${sy + off - rect.top}px`
      : `bottom:${sy + off - (t.height - rect.top - rect.height)}px`;
    return `<div class="bc-ref bc-ref-fixed" style="position:absolute;left:0;right:0;${vpos};margin:0;font-size:${r.size}px;color:${r.color};font-weight:${r.weight};text-align:${textAlign(r.align || t.align)};${textStyle(t).replace(/font-weight:[^;]+;?/, '').replace(/color:[^;]+;?/, '')}">${esc(refText(slide, t))}</div>`;
  }

  /** 내어쓰기: 절마다 [번호 칸 | 본문] 두 칸. 줄이 바뀌어도 본문 시작 위치가 맞는다 */
  function hangingHtml(slide, t) {
    const vn = t.verseNumbers;
    const digits = Math.max(1, ...slide.parts.map(p => String(p.verse).length));
    const numW = vn.show ? `calc(${(digits * 0.6 * vn.scale).toFixed(2)}em + 0.1em)` : '0px';
    return slide.parts.map(p => {
      let h = '';
      if (p.heading && t.headings.show && (!p.partIndex || p.partIndex === 1)) {
        h += `<div class="bc-heading" style="font-size:${t.headings.size}px;color:${t.headings.color}">${esc(p.heading)}</div>`;
      }
      const showNum = vn.show && (!p.partIndex || p.partIndex === 1);
      const pre = p.partIndex > 1 ? '… ' : '';
      const post = p.partIndex && p.partIndex < p.partCount ? ' …' : '';
      h += `<div class="bc-hang" style="grid-template-columns:${numW} 1fr;column-gap:${vn.show ? '0.35em' : '0'}">`
        + `<span class="bc-hn" style="color:${vn.color};font-size:${vn.scale}em">${showNum ? p.verse : ''}</span>`
        + `<span class="bc-ht">${esc(pre + p.text + post)}</span></div>`;
      return h;
    }).join('');
  }

  function partsHtml(slide, t) {
    if (isHanging(t)) return hangingHtml(slide, t);
    if (slide.kind === 'text') {
      return slide.parts.map(p => `<span class="bc-verse bc-pre">${esc(p.text)}</span>`).join('');
    }
    const vn = t.verseNumbers;
    return slide.parts.map(p => {
      let h = '';
      if (p.heading && t.headings.show && (!p.partIndex || p.partIndex === 1)) {
        h += `<span class="bc-heading" style="font-size:${t.headings.size}px;color:${t.headings.color}">${esc(p.heading)}</span>`;
      }
      const showNum = vn.show && (!p.partIndex || p.partIndex === 1);
      const pre = p.partIndex > 1 ? '… ' : '';
      const post = p.partIndex && p.partIndex < p.partCount ? ' …' : '';
      h += `<span class="bc-verse${t.verseBreak ? ' bc-break' : ''}">`
        + (showNum ? `<span class="bc-vn" style="color:${vn.color};font-size:${vn.scale}em">${p.verse}</span>` : '')
        + esc(pre + p.text + post) + '</span>';
      return h;
    }).join(t.verseBreak ? '' : ' ');
  }

  /** 슬라이드 본문 DOM 생성 (아직 크기 맞춤 전) */
  /** 이 출력에서 PPT·찬송가 슬라이드를 가사 글자만으로 보이는가 */
  function lyricsOnly(t) {
    return t.pptMode ? t.pptMode === 'lyrics' : !!(t.background && t.background.type === 'transparent');
  }

  function buildContent(slide, t, versionName) {
    const rect = contentRect(t);
    const area = document.createElement('div');
    area.className = 'bc-area';
    let kind = slide.kind || 'bible';
    const asLyrics = lyricsOnly(t);
    // PPT·찬송가 그림 슬라이드 → 가사만 (예: OBS 하단 자막). 가사가 없으면 아무것도 안 보인다
    if (asLyrics && (kind === 'score' || kind === 'image') && typeof slide.caption === 'string') {
      if (!slide.caption.trim()) { area.style.cssText = `left:0;top:0;width:${t.width}px;height:${t.height}px;`; return area; }
      slide = { kind: 'text', ref: '', label: slide.label, parts: [{ book: 0, chapter: 0, verse: 0, text: slide.caption.trim() }] };
      kind = 'text';
    }
    // 이미지·빈 화면: 화면 전체를 쓴다
    if (kind === 'image' || kind === 'blank' || kind === 'score') {
      area.style.cssText = `left:0;top:0;width:${t.width}px;height:${t.height}px;`;
      if (kind === 'score') {
        // 찬송가: (배경) + 투명 악보 그림을 화면에 맞춰 겹친다
        const sbg = !slide.bg ? '' : slide.bg.startsWith('#') ? `<div class="bc-score-bg" style="background:${esc(slide.bg)}"></div>` : `<img class="bc-score-bg" alt="" src="${encodeURI(slide.bg)}">`;
        area.innerHTML = `<div class="bc-block bc-score">${sbg}<img class="bc-score-img" alt="" src="${encodeURI(slide.image || '')}"></div>`;
      } else {
        area.innerHTML = kind === 'image'
          ? `<div class="bc-block bc-imgslide"><img alt="" src="${encodeURI(slide.image || '')}"></div>`
          : `<div class="bc-block bc-blank ${slide.mode === 'background' ? '' : 'bc-black'}"></div>`;
      }
      return area;
    }
    // 슬라이드 자체 배경 (예: 교독문의 원래 배경): 화면 전체에 깔고 그 위에 글자
    const slideBg = slide.bg && !asLyrics ? `<div class="bc-slidebg" style="left:${-rect.left}px;top:${-rect.top}px;width:${t.width}px;height:${t.height}px;background:${slide.bg.startsWith('#') ? esc(slide.bg) : `#000 url('${encodeURI(slide.bg)}') center/cover no-repeat`}"></div>` : '';
    const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[t.valign] || 'center';
    area.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;justify-content:${justify};`;
    const b = t.box;
    const boxCss = b.enabled ? `background:${b.gradient ? b.gradient : hexToRgba(b.color, b.opacity)};border-radius:${b.radius}px;padding:${b.padding}px;` : '';
    const ver = t.versionLabel.show && versionName
      ? `<div class="bc-version" style="font-size:${t.versionLabel.size}px;color:${t.versionLabel.color};text-align:${textAlign(t.align)}">${esc(versionName)}</div>` : '';
    if (kind === 'title') {
      // 제목 카드: 큰 제목 + 부제 (장절 표시 없음)
      area.innerHTML = slideBg + `<div class="bc-block" style="${boxCss}text-align:${textAlign(t.align)};${textStyle(t)}">`
        + `<div class="bc-text bc-titlecard" style="font-size:${t.font.size}px"><div class="bc-t1">${esc(slide.ref)}</div>`
        + (slide.subtitle ? `<div class="bc-t2" style="color:${t.reference.color}">${esc(slide.subtitle)}</div>` : '') + '</div></div>';
      return area;
    }
    area.innerHTML = slideBg + `<div class="bc-block" style="${boxCss}text-align:${textAlign(t.align)};${textStyle(t)}">`
      + refHtml(slide, t, 'top')
      + `<div class="bc-text" style="font-size:${t.font.size}px">${partsHtml(slide, t)}</div>`
      + refHtml(slide, t, 'bottom') + ver + '</div>'
      + fixedRefHtml(slide, t, rect);
    return area;
  }

  function overflows(area) {
    const block = area.querySelector('.bc-block');
    return block.offsetHeight > area.clientHeight + 0.5 || block.scrollWidth > area.clientWidth + 0.5;
  }

  /**
   * 글꼴 크기 맞춤. area 는 문서에 붙어 있어야 한다.
   * autoFit 이면 설정 크기에서 최소 크기까지 줄여 가며 들어가는 가장 큰 크기를 찾는다.
   */
  function fit(area, t, fixedSize) {
    const text = area.querySelector('.bc-text');
    if (!text) return { size: 0, fits: true }; // 이미지·빈 화면
    const set = s => { text.style.fontSize = s + 'px'; };
    if (fixedSize) { set(fixedSize); return { size: fixedSize, fits: !overflows(area) }; }
    set(t.font.size);
    if (!overflows(area)) return { size: t.font.size, fits: true };
    if (!t.font.autoFit) return { size: t.font.size, fits: false };
    let lo = t.font.minSize, hi = t.font.size;
    set(lo);
    if (overflows(area)) return { size: lo, fits: false };
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      set(mid);
      if (overflows(area)) hi = mid; else lo = mid;
    }
    set(lo);
    return { size: lo, fits: true };
  }

  function backgroundCss(t) {
    const bg = t.background;
    if (bg.type === 'transparent') return 'background:transparent;';
    if (bg.type === 'gradient' && bg.gradient) return `background:${bg.gradient};`;
    if (bg.type === 'image' && bg.image) {
      return `background:${bg.color || '#000'} url("${encodeURI(bg.image)}") center/${bg.imageFit || 'cover'} no-repeat;`;
    }
    return `background:${bg.color || '#000'};`;
  }

  /** 템플릿 해상도의 무대(stage) 생성: 배경층 + 본문층 */
  function buildStage(t) {
    const stage = document.createElement('div');
    stage.className = 'bc-stage';
    stage.style.width = t.width + 'px';
    stage.style.height = t.height + 'px';
    const bg = document.createElement('div');
    bg.className = 'bc-bg';
    bg.style.cssText = backgroundCss(t);
    if (t.background.type === 'image' && t.background.dim > 0) {
      bg.innerHTML = `<div class="bc-dim" style="background:rgba(0,0,0,${t.background.dim})"></div>`;
    }
    // 로고: 배경층에 함께 둬서 본문이 바뀌어도 그대로 보인다
    const lg = t.logo;
    if (lg && lg.show && lg.image) {
      const m = Number(lg.margin ?? 40);
      const pos = {
        'top-left': `top:${m}px;left:${m}px`, 'top-center': `top:${m}px;left:50%;transform:translateX(-50%)`, 'top-right': `top:${m}px;right:${m}px`,
        'bottom-left': `bottom:${m}px;left:${m}px`, 'bottom-center': `bottom:${m}px;left:50%;transform:translateX(-50%)`, 'bottom-right': `bottom:${m}px;right:${m}px`,
      }[lg.position] || `top:${m}px;right:${m}px`;
      bg.insertAdjacentHTML('beforeend', `<img class="bc-logo" alt="" src="${encodeURI(lg.image)}" style="position:absolute;${pos};height:${Number(lg.size) || 120}px;opacity:${lg.opacity ?? 1}">`);
    }
    stage.appendChild(bg);
    return stage;
  }

  /** 컨테이너 크기에 맞춰 stage 를 축소/확대 */
  function scaleStage(stage, container, t) {
    const cw = container.clientWidth, ch = container.clientHeight;
    if (!cw || !ch) return 1;
    const s = Math.min(cw / t.width, ch / t.height);
    stage.style.transform = `translate(${(cw - t.width * s) / 2}px, ${(ch - t.height * s) / 2}px) scale(${s})`;
    return s;
  }

  // ---------- 측정 (슬라이드 분할용) ----------
  const measurers = new Map();
  function measurer(t) {
    const key = JSON.stringify(t);
    let m = measurers.get(key);
    if (!m) {
      const host = document.createElement('div');
      host.className = 'bc-measure';
      host.setAttribute('aria-hidden', 'true');
      const stage = buildStage(t);
      host.appendChild(stage);
      document.body.appendChild(host);
      m = { host, stage };
      measurers.set(key, m);
      if (measurers.size > 12) {
        const [k0, m0] = measurers.entries().next().value;
        m0.host.remove(); measurers.delete(k0);
      }
    }
    return m;
  }

  /** slide 가 템플릿 t 에서 size(px) 글꼴로 넘치지 않는가 */
  function fitsAt(slide, t, size, versionName) {
    const m = measurer(t);
    const area = buildContent(slide, t, versionName);
    m.stage.appendChild(area);
    const r = fit(area, t, size);
    area.remove();
    return r.fits;
  }

  // ---------- 오버레이 층 (로고·시계·카운트다운·배너·글자) ----------
  const pad2 = n => String(n).padStart(2, '0');
  function clockText(o, now = new Date()) {
    let h = now.getHours();
    const ap = o.format === '12' ? (h < 12 ? '오전 ' : '오후 ') : '';
    if (o.format === '12') h = h % 12 || 12;
    return ap + pad2(h) + ':' + pad2(now.getMinutes()) + (o.showSeconds ? ':' + pad2(now.getSeconds()) : '');
  }
  /** 카운트다운 남은 시간: target "HH:MM" = 오늘 그 시각까지, 숫자 = 켠 뒤 그 분만큼 */
  function countdownText(o, now = Date.now()) {
    let end = 0;
    const m = /^(\d{1,2}):(\d{2})$/.exec(o.target || '');
    if (m) { const d = new Date(now); d.setHours(+m[1], +m[2], 0, 0); end = d.getTime(); }
    else end = (o.startedAt || now) + (Number(o.target) || 5) * 60000;
    const left = Math.max(0, Math.ceil((end - now) / 1000));
    if (!left && o.doneText) return o.doneText;
    const h = Math.floor(left / 3600), mm = Math.floor(left / 60) % 60, ss = left % 60;
    return (h ? h + ':' + pad2(mm) : pad2(mm)) + ':' + pad2(ss);
  }
  function ovPosCss(o) {
    const m = Number(o.margin) || 0;
    const [v, h] = o.position === 'center' ? ['middle', 'center'] : String(o.position).split('-');
    const css = [];
    const tr = [];
    if (v === 'top') css.push(`top:${m}px`); else if (v === 'bottom') css.push(`bottom:${m}px`); else { css.push('top:50%'); tr.push('translateY(-50%)'); }
    if (o.full) css.push(`left:${m}px`, `right:${m}px`);
    else if (h === 'left') css.push(`left:${m}px`); else if (h === 'right') css.push(`right:${m}px`); else { css.push('left:50%'); tr.push('translateX(-50%)'); }
    if (tr.length) css.push('transform:' + tr.join(' '));
    return css.join(';');
  }
  function buildOverlays(list, t) {
    const layer = document.createElement('div');
    layer.className = 'bc-ovl';
    for (const o of list || []) {
      const box = o.bg ? `background:${esc(o.bg)};padding:${Math.round(o.size * 0.35)}px ${Math.round(o.size * 0.6)}px;border-radius:${Math.round(o.size * 0.25)}px;` : '';
      const font = `font-family:${t.font.family};font-size:${o.size}px;color:${esc(o.color)};font-weight:700;${o.bg ? '' : 'text-shadow:0 2px 8px rgba(0,0,0,.85);'}`;
      const base = `position:absolute;${ovPosCss(o)};opacity:${o.opacity ?? 1};`;
      let html;
      if (o.type === 'logo') html = o.image ? `<img class="bc-ov" alt="" src="${encodeURI(o.image)}" style="${base}height:${o.size}px">` : '';
      else if (o.type === 'clock') html = `<div class="bc-ov" data-ov="clock" data-o='${esc(JSON.stringify({ format: o.format, showSeconds: o.showSeconds }))}' style="${base}${font}${box}white-space:nowrap">${esc(clockText(o))}</div>`;
      else if (o.type === 'countdown') html = `<div class="bc-ov" data-ov="countdown" data-o='${esc(JSON.stringify({ target: o.target, startedAt: o.startedAt, doneText: o.doneText }))}' style="${base}${font}${box}white-space:nowrap">${esc(countdownText(o))}</div>`;
      else html = `<div class="bc-ov" style="${base}${font}${box}${o.full ? 'text-align:center;' : 'max-width:90%;'}white-space:pre-line;line-height:1.35">${esc(o.text)}</div>`;
      layer.insertAdjacentHTML('beforeend', html);
    }
    startTicking();
    return layer;
  }
  let ticking = null;
  function startTicking() {
    if (ticking) return;
    ticking = setInterval(() => {
      for (const el of document.querySelectorAll('.bc-ov[data-ov]')) {
        let o = {};
        try { o = JSON.parse(el.dataset.o || '{}'); } catch { /* 무시 */ }
        const txt = el.dataset.ov === 'clock' ? clockText(o) : countdownText(o);
        if (el.textContent !== txt) el.textContent = txt;
      }
    }, 250);
  }

  /** 미리보기/모니터용: 컨테이너에 슬라이드를 즉시 그린다 */
  function renderInto(container, slide, t, opts = {}) {
    const prev = [...container.children];
    const stage = buildStage(t);
    if (opts.checker && t.background.type === 'transparent') stage.classList.add('bc-checker');
    if (opts.hidden && t.clearHidesBackground) stage.firstChild.style.opacity = '0';
    container.appendChild(stage);
    let result = { size: 0, fits: true };
    if (slide) {
      const area = buildContent(slide, t, opts.versionName);
      if (opts.hidden) area.style.opacity = '0';
      stage.appendChild(area);
      result = fit(area, t);
    }
    if (opts.overlays && opts.overlays.length) stage.appendChild(buildOverlays(opts.overlays, t));
    scaleStage(stage, container, t);
    // 이전 화면은 새 화면의 그림이 준비될 때까지 뒤에 둔다
    const imgs = [...stage.querySelectorAll('img')].filter(i => !i.complete);
    if (!imgs.length) prev.forEach(n => n.remove());
    else {
      stage.style.visibility = 'hidden';
      const swap = () => { stage.style.visibility = ''; prev.forEach(n => n.remove()); };
      Promise.race([Promise.all(imgs.map(i => (i.decode ? i.decode() : Promise.resolve()).catch(() => {}))), new Promise(r => setTimeout(r, 1000))]).then(swap);
    }
    return { stage, ...result };
  }

  global.BCRender = { esc, lyricsOnly, buildOverlays, clockText, countdownText, buildContent, buildStage, scaleStage, fit, fitsAt, renderInto, backgroundCss, contentRect };
})(window);
