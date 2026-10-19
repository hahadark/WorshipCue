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
    if (f.style) css.push(`font-style:${f.style}`);
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
        + `<span class="bc-ht">${esc(pre + p.text + post)}${p.text2 ? `<span class="bc-par">${esc(p.text2)}</span>` : ''}</span></div>`;
      return h;
    }).join('');
  }

  function partsHtml(slide, t) {
    if (isHanging(t)) return hangingHtml(slide, t);
    if (slide.kind === 'text') {
      const strip = global.BCGroup ? global.BCGroup.stripChords : (t => t);
      return slide.parts.map(p => {
        const t = strip(p.text);
        const fmt = s => (global.BCGroup && global.BCGroup.fmtHtml ? global.BCGroup.fmtHtml(s, esc) : esc(s)); // **굵게** · {크기:…} · {색:…}
        if (!/^\s*>/m.test(t)) return `<span class="bc-verse bc-pre">${fmt(t)}</span>`;
        // 번역 줄 ('> Amazing grace') 은 원래 줄 밑에 작게
        return `<span class="bc-verse">${t.split('\n').map(l => /^\s*>/.test(l) ? `<span class="bc-tr">${fmt(l.replace(/^\s*>\s?/, ''))}</span>` : `<span class="bc-line">${fmt(l) || '&nbsp;'}</span>`).join('')}</span>`;
      }).join('');
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
        + esc(pre + p.text + post) + (p.text2 ? `<span class="bc-par">${esc(p.text2)}</span>` : '') + '</span>';
      return h;
    }).join(t.verseBreak ? '' : ' ');
  }

  /** 슬라이드 본문 DOM 생성 (아직 크기 맞춤 전) */
  /** 주소를 한 번만 인코딩 (/lib/file?p=%3A… 처럼 이미 인코딩된 주소는 그대로) */
  function safeUrl(u) { u = String(u || ''); return /%[0-9A-Fa-f]{2}/.test(u) ? u : encodeURI(u); }

  /** 영상 파일 주소인가 (/lib/file?p=…mp4 등) */
  function isVideo(url) {
    if (!url) return false;
    let u = String(url);
    try { u = decodeURIComponent(u); } catch { /* 그대로 */ }
    return /\.(mp4|m4v|webm|mov)$/i.test(u.split('#')[0]);
  }
  /** 소리 없이 반복 재생하는 배경 영상 */
  const videoTag = (url, cls, style = '', fit = 'cover') => `<video class="${cls}" src="${safeUrl(url)}" autoplay muted loop playsinline preload="auto" style="object-fit:${fit};${style}"></video>`;

  /** 이 출력에서 PPT·찬송가 슬라이드를 가사 글자만으로 보이는가 */
  function lyricsOnly(t) {
    return t.pptMode ? t.pptMode === 'lyrics' : !!(t.background && t.background.type === 'transparent');
  }

  /**
   * 슬라이드 편집(slide.edit) 을 이 출력에 적용: 글상자 위치·꾸미기를 반영한 템플릿과 영역
   * 투명 배경(OBS 자막) 출력에는 '모든 출력에 적용' 일 때만 (글 내용은 늘 반영)
   */
  function editFor(slide, t) {
    const e = slide.edit;
    if (!e || (!e.allOutputs && lyricsOnly(t))) return null;
    const k = t.height / 1080;
    const s = e.style || {};
    const t2 = { ...t, font: { ...t.font }, box: { ...t.box } };
    if (s.size) { t2.font.size = Math.round(s.size * k); t2.font.minSize = Math.min(t.font.minSize, t2.font.size); }
    if (typeof s.autoFit === 'boolean') t2.font.autoFit = s.autoFit;
    if (s.color) t2.font.color = s.color;
    if (typeof s.bold === 'boolean') t2.font.weight = s.bold ? 700 : 400;
    if (s.italic) t2.font.style = 'italic';
    if (s.lineHeight) t2.font.lineHeight = s.lineHeight;
    if (s.align) t2.align = s.align;
    if (s.valign) t2.valign = s.valign;
    if (s.boxColor) t2.box = { ...t.box, enabled: true, gradient: '', color: s.boxColor, opacity: s.boxOpacity ?? 0.6, radius: s.radius ?? t.box.radius ?? 12, padding: s.padding ?? t.box.padding ?? 24 };
    if (s.shadow === false) t2.shadow = { ...(t.shadow || {}), enabled: false };
    const b = e.box;
    const rect = b ? { left: b.x * t.width / 100, top: b.y * t.height / 100, width: b.w * t.width / 100, height: b.h * t.height / 100 } : contentRect(t);
    return { t: t2, rect, e };
  }

  /** 덧붙인 글상자·그림·도형 (본문 영역 기준 좌표로) */
  function editItemsHtml(items, t, rect, below) {
    const k = t.height / 1080;
    return (items || []).filter(x => !!x.below === below).map(x => {
      const pos = `position:absolute;left:${x.x * t.width / 100 - rect.left}px;top:${x.y * t.height / 100 - rect.top}px;width:${x.w * t.width / 100}px;height:${x.h * t.height / 100}px;opacity:${x.opacity ?? 1};border-radius:${x.type === 'shape' && x.ellipse ? '50%' : (x.radius || 0) + 'px'};overflow:hidden;box-sizing:border-box;`;
      if (x.type === 'image') return x.src ? (isVideo(x.src) ? videoTag(x.src, 'bc-eitem', pos, x.fit || 'cover') : `<img class="bc-eitem" alt="" src="${safeUrl(x.src)}" style="${pos}object-fit:${x.fit || 'cover'}">`) : '';
      if (x.type === 'shape') return `<div class="bc-eitem" style="${pos}background:${esc(x.fill || '#1d3557')}"></div>`;
      if (x.type === 'camera') return camTag(x.deviceId, x.fit, pos + 'background:#000', 'bc-eitem');
      const just = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[x.valign] || 'center';
      const shadow = t.shadow && t.shadow.enabled && !x.fill ? `text-shadow:${t.shadow.x}px ${t.shadow.y}px ${t.shadow.blur}px ${t.shadow.color};` : '';
      return `<div class="bc-eitem bc-etext" style="${pos}display:flex;flex-direction:column;justify-content:${just};padding:${(x.padding ?? 12) * k}px;${x.fill ? `background:${esc(x.fill)};` : ''}font-family:${t.font.family};font-size:${(x.size || 60) * k}px;color:${esc(x.color || '#fff')};font-weight:${x.bold ? 700 : 400};${x.italic ? 'font-style:italic;' : ''}line-height:1.3;text-align:${x.align || 'center'};white-space:pre-wrap;${shadow}">${esc(x.text || '')}</div>`;
    }).join('');
  }

  /** 슬라이드쇼 카운트다운: '예배 시작까지 04:59' (화면 오른쪽 아래) */
  function countdownHtml(slide, t) {
    const c = slide.countdown;
    if (!c || !c.target) return '';
    const s = Math.round(t.height / 1080 * 100) / 100;
    startTicking();
    return `<div class="bc-cd" style="position:absolute;right:${60 * s}px;bottom:${50 * s}px;padding:${14 * s}px ${26 * s}px;border-radius:${16 * s}px;background:rgba(0,0,0,.62);color:#fff;font-family:${t.font.family};text-align:center;z-index:5">`
      + (c.label ? `<div style="font-size:${30 * s}px;opacity:.85">${esc(c.label)}</div>` : '')
      + `<div class="bc-ov" data-ov="countdown" data-o='${esc(JSON.stringify({ target: c.target, doneText: c.doneText || '' }))}' style="font-size:${78 * s}px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1">${esc(countdownText({ target: c.target }))}</div></div>`;
  }

  /** 카메라 영상 자리 (만든 뒤 attachCameras 로 연결) */
  function camTag(deviceId, fit, style, cls = '') {
    return `<video class="bc-camv ${cls}" data-cam="${esc(deviceId || '')}" muted autoplay playsinline style="object-fit:${fit === 'contain' ? 'contain' : 'cover'};${style}"></video>`;
  }
  function attachCameras(root) { root.querySelectorAll('video[data-cam]').forEach(v => attachCamera(v, v.dataset.cam)); }

  function buildContent(slide, t, versionName, opts = {}) {
    const area = buildContentInner(slide, t, versionName, opts);
    // 글 없는 슬라이드: 덧붙인 글상자·그림·도형·카메라를 화면 전체 기준으로
    const ed = slide.edit;
    if (ed && ed.items && ed.items.length && ['image', 'score', 'video', 'camera', 'blank'].includes(slide.kind) && (ed.allOutputs || !lyricsOnly(t))) {
      const full = { left: 0, top: 0, width: t.width, height: t.height };
      area.insertAdjacentHTML('beforeend', editItemsHtml(ed.items, t, full, true) + editItemsHtml(ed.items, t, full, false));
    }
    attachCameras(area);
    const cd = countdownHtml(slide, t);
    if (cd) {
      // 화면 기준 위치로 (본문 영역 안쪽 좌표 → 화면 전체)
      const wrap = document.createElement('div');
      wrap.style.cssText = `position:absolute;left:${-parseFloat(area.style.left || 0)}px;top:${-parseFloat(area.style.top || 0)}px;width:${t.width}px;height:${t.height}px;pointer-events:none`;
      wrap.innerHTML = cd;
      area.appendChild(wrap);
    }
    return area;
  }

  function buildContentInner(slide, t, versionName, opts = {}) {
    let rect = contentRect(t);
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
    // 영상 재생: 화면 전체 (소리·재생 위치는 출력 화면이 syncVideo 로 맞춘다)
    if (kind === 'video') {
      area.style.cssText = `left:0;top:0;width:${t.width}px;height:${t.height}px;`;
      area.innerHTML = `<div class="bc-block bc-imgslide"><video class="bc-play" src="${safeUrl(slide.image || '')}" playsinline preload="auto" muted style="width:100%;height:100%;object-fit:contain;background:#000;display:block"></video></div>`;
      return area;
    }
    // 카메라 슬라이드: 화면 가득
    if (kind === 'camera') {
      const c = slide.camera || {};
      area.style.cssText = `left:0;top:0;width:${t.width}px;height:${t.height}px;`;
      area.innerHTML = `<div class="bc-block bc-imgslide" style="background:#000">${camTag(c.deviceId, c.fit, 'position:absolute;inset:0;width:100%;height:100%')}</div>`;
      return area;
    }
    // 이미지·빈 화면: 화면 전체를 쓴다
    if (kind === 'image' || kind === 'blank' || kind === 'score') {
      area.style.cssText = `left:0;top:0;width:${t.width}px;height:${t.height}px;`;
      if (kind === 'score') {
        // 찬송가: (배경) + 투명 악보 그림을 화면에 맞춰 겹친다
        const sbg = !slide.bg ? '' : slide.bg.startsWith('#') ? `<div class="bc-score-bg" style="background:${esc(slide.bg)}"></div>` : `<img class="bc-score-bg" alt="" src="${safeUrl(slide.bg)}">`;
        area.innerHTML = `<div class="bc-block bc-score">${sbg}<img class="bc-score-img" alt="" src="${safeUrl(slide.image || '')}"></div>`;
      } else {
        area.innerHTML = kind === 'image'
          ? (isVideo(slide.image) ? `<div class="bc-block bc-imgslide">${videoTag(slide.image, 'bc-vid', 'width:100%;height:100%;display:block', 'contain')}</div>` : `<div class="bc-block bc-imgslide"><img alt="" src="${safeUrl(slide.image || '')}"></div>`)
          : `<div class="bc-block bc-blank ${slide.mode === 'background' ? '' : 'bc-black'}"></div>`;
      }
      return area;
    }
    // 슬라이드 편집: 글상자 위치·꾸미기, 덧붙인 글·그림·도형
    const ed = editFor(slide, t);
    let below = '', above = '';
    if (ed) {
      t = ed.t; rect = ed.rect;
      area.bcT = t; // 크기 맞춤(fit)도 이 꾸미기로
      below = editItemsHtml(ed.e.items, t, rect, true);
      above = editItemsHtml(ed.e.items, t, rect, false);
      if (ed.e.hideMain) area.classList.add('bc-hidemain');
    }
    // 슬라이드 자체 배경 (예: 교독문의 원래 배경): 화면 전체에 깔고 그 위에 글자
    const bgVid = slide.bg && !asLyrics && isVideo(slide.bg);
    const bgCam = slide.bg && !asLyrics && String(slide.bg).startsWith('camera:');
    const slideBg = bgCam ? camTag(String(slide.bg).slice(7), 'cover', `position:absolute;left:${-rect.left}px;top:${-rect.top}px;width:${t.width}px;height:${t.height}px;background:#000`, 'bc-slidebg')
      : bgVid ? (opts.videoBgLayer ? '' : videoTag(slide.bg, 'bc-slidebg', `left:${-rect.left}px;top:${-rect.top}px;width:${t.width}px;height:${t.height}px;background:#000`))
      : slide.bg && !asLyrics ? `<div class="bc-slidebg" style="left:${-rect.left}px;top:${-rect.top}px;width:${t.width}px;height:${t.height}px;background:${slide.bg.startsWith('#') ? esc(slide.bg) : `#000 url('${safeUrl(slide.bg)}') center/cover no-repeat`}"></div>` : '';
    const justify = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[t.valign] || 'center';
    area.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;justify-content:${justify};`;
    const b = t.box;
    const boxCss = b.enabled ? `background:${b.gradient ? b.gradient : hexToRgba(b.color, b.opacity)};border-radius:${b.radius}px;padding:${b.padding}px;` : '';
    const ver = t.versionLabel.show && versionName
      ? `<div class="bc-version" style="font-size:${t.versionLabel.size}px;color:${t.versionLabel.color};text-align:${textAlign(t.align)}">${esc(versionName)}</div>` : '';
    if (kind === 'title') {
      // 제목 카드: 큰 제목 + 부제 (장절 표시 없음)
      area.innerHTML = slideBg + below + `<div class="bc-block" style="${boxCss}text-align:${textAlign(t.align)};${textStyle(t)}">`
        + `<div class="bc-text bc-titlecard" style="font-size:${t.font.size}px"><div class="bc-t1">${esc(slide.ref)}</div>`
        + (slide.subtitle ? `<div class="bc-t2" style="color:${t.reference.color}">${esc(slide.subtitle)}</div>` : '') + '</div></div>' + above;
      return area;
    }
    const footer = slide.footer && !lyricsOnly(t)
      ? `<div class="bc-footer" style="position:absolute;left:${t.width * 0.04 - rect.left}px;right:${rect.left + rect.width - t.width * 0.96}px;bottom:${(rect.top + rect.height) - t.height * 0.965}px;font-family:${t.font.family};font-size:${Math.round(t.height * 0.024)}px;color:${t.font.color};opacity:.78;text-align:${textAlign(t.align === 'right' ? 'right' : 'left')};${t.shadow && t.shadow.enabled ? `text-shadow:0 1px 4px rgba(0,0,0,.9);` : ''}">${esc(slide.footer)}</div>` : '';
    area.innerHTML = slideBg + below + `<div class="bc-block" style="${boxCss}text-align:${textAlign(t.align)};${textStyle(t)}">`
      + refHtml(slide, t, 'top')
      + `<div class="bc-text" style="font-size:${t.font.size}px">${partsHtml(slide, t)}</div>`
      + refHtml(slide, t, 'bottom') + ver + '</div>'
      + fixedRefHtml(slide, t, rect) + above + footer;
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
    if (area.bcT) { t = area.bcT; fixedSize = 0; } // 슬라이드 편집 꾸미기
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
    if (bg.type === 'video' || bg.type === 'camera') return `background:${bg.color || '#000'};`;
    if (bg.type === 'gradient' && bg.gradient) return `background:${bg.gradient};`;
    if (bg.type === 'image' && bg.image) {
      return `background:${bg.color || '#000'} url("${safeUrl(bg.image)}") center/${bg.imageFit || 'cover'} no-repeat;`;
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
    if (t.background.type === 'video' && t.background.video) {
      bg.innerHTML = videoTag(t.background.video, 'bc-bgvid', 'position:absolute;inset:0;width:100%;height:100%', t.background.imageFit || 'cover');
    }
    if (t.background.type === 'camera') {
      // 카메라 (웹캠·캡처보드): 같은 화면 안에서는 한 번 연 것을 같이 쓴다
      const v = document.createElement('video');
      v.className = 'bc-cam';
      v.muted = true; v.autoplay = true; v.playsInline = true;
      v.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:${t.background.imageFit || 'cover'}`;
      bg.appendChild(v);
      attachCamera(v, (t.background.camera || {}).deviceId || '');
    }
    if ((t.background.type === 'image' || t.background.type === 'video' || t.background.type === 'camera') && t.background.dim > 0) {
      bg.insertAdjacentHTML('beforeend', `<div class="bc-dim" style="background:rgba(0,0,0,${t.background.dim})"></div>`);
    }
    // 로고: 배경층에 함께 둬서 본문이 바뀌어도 그대로 보인다
    const lg = t.logo;
    if (lg && lg.show && lg.image) {
      const m = Number(lg.margin ?? 40);
      const pos = {
        'top-left': `top:${m}px;left:${m}px`, 'top-center': `top:${m}px;left:50%;transform:translateX(-50%)`, 'top-right': `top:${m}px;right:${m}px`,
        'bottom-left': `bottom:${m}px;left:${m}px`, 'bottom-center': `bottom:${m}px;left:50%;transform:translateX(-50%)`, 'bottom-right': `bottom:${m}px;right:${m}px`,
      }[lg.position] || `top:${m}px;right:${m}px`;
      bg.insertAdjacentHTML('beforeend', `<img class="bc-logo" alt="" src="${safeUrl(lg.image)}" style="position:absolute;${pos};height:${Number(lg.size) || 120}px;opacity:${lg.opacity ?? 1}">`);
    }
    stage.appendChild(bg);
    return stage;
  }

  // ---------- 카메라 배경 ----------
  const cams = new Map(); // deviceId → Promise<MediaStream>
  // 카메라 세부 설정 (설정 → cameras): 해상도·프레임은 열 때, 밝기·대비·채도·좌우 반전은 화면에서
  let camPrefs = {};
  const RES = { 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], 2160: [3840, 2160] };
  const camKey = id => { const p = camPrefs[id] || {}; return JSON.stringify([p.res || 'auto', p.fps || 0, !!p.exact]); };
  const opened = new Map(); // deviceId → 열 때 쓴 설정 키
  function camConstraints(deviceId, strict) {
    const p = camPrefs[deviceId] || {};
    const [w, h] = RES[p.res] || RES[1080];
    const want = (v, exact) => (exact ? { ideal: v, min: v } : { ideal: v });
    const strictOn = strict && p.exact && p.res && p.res !== 'auto';
    return {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: want(w, strictOn), height: want(h, strictOn),
      ...(p.fps ? { frameRate: want(p.fps, strict && p.exact) } : { frameRate: { ideal: 30 } }),
      resizeMode: 'none', // 브라우저가 줄여서 늘리지 않게: 카메라가 실제로 내보내는 화질 그대로
    };
  }
  function cameraStream(deviceId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('카메라를 쓸 수 없는 화면입니다.'));
    if (!cams.has(deviceId)) {
      // '꼭 맞추기' 가 안 되는 카메라면 가까운 화질로 다시
      const p = navigator.mediaDevices.getUserMedia({ video: camConstraints(deviceId, true), audio: false })
        .catch(e => (e && e.name === 'OverconstrainedError' ? navigator.mediaDevices.getUserMedia({ video: camConstraints(deviceId, false), audio: false }) : Promise.reject(e)));
      p.catch(() => cams.delete(deviceId));
      cams.set(deviceId, p);
      opened.set(deviceId, camKey(deviceId));
    }
    return cams.get(deviceId);
  }
  // 쓰는 곳(화면의 video[data-cam])이 없어진 카메라는 4초 뒤 닫는다
  // (디졸브·순서 넘김처럼 잠깐 빠졌다 다시 쓰는 경우는 그대로 이어서)
  const camIdle = new Map(); // deviceId → 처음 안 쓰인 시각
  function closeCamera(id) {
    const p = cams.get(id);
    cams.delete(id);
    opened.delete(id);
    camIdle.delete(id);
    if (p) p.then(s => s.getTracks().forEach(t => t.stop())).catch(() => {});
  }
  if (typeof setInterval === 'function' && typeof document !== 'undefined') setInterval(() => {
    for (const id of [...opened.keys()]) {
      const used = [...document.querySelectorAll('video[data-cam]')].some(v => v.dataset.cam === id && v.isConnected && !v.closest('.bc-measure') && !(v.closest('.bc-stage.hide-bg') && v.closest('.bc-bg, .bc-slidebg, .bc-medialayer')));
      if (used) { camIdle.delete(id); continue; }
      if (!camIdle.has(id)) camIdle.set(id, Date.now());
      else if (Date.now() - camIdle.get(id) > 4000) closeCamera(id);
    }
  }, 1000);
  /** 열려 있는 카메라 (시험·상태 확인용) */
  function openCameras() { return [...opened.keys()]; }
  /** 지금 받는 화질과 카메라가 낼 수 있는 최대 */
  async function cameraInfo(deviceId) {
    const s = await cameraStream(deviceId);
    const tr = s.getVideoTracks()[0];
    const st = tr.getSettings ? tr.getSettings() : {};
    const cap = tr.getCapabilities ? tr.getCapabilities() : {};
    return { width: st.width, height: st.height, fps: st.frameRate, maxWidth: cap.width && cap.width.max, maxHeight: cap.height && cap.height.max, maxFps: cap.frameRate && cap.frameRate.max };
  }
  /** 카메라 설정을 받는다 (조작 화면·출력 화면). 해상도·프레임이 바뀐 카메라는 다시 연다 */
  function setCameraPrefs(prefs) {
    camPrefs = prefs && typeof prefs === 'object' ? prefs : {};
    // 밝기·대비·채도·좌우 반전: 화면의 모든 그 카메라 영상에
    let css = '';
    for (const [id, p] of Object.entries(camPrefs)) {
      const f = [p.brightness !== 100 && p.brightness ? `brightness(${p.brightness / 100})` : '', p.contrast !== 100 && p.contrast ? `contrast(${p.contrast / 100})` : '', p.saturation !== 100 && p.saturation != null ? `saturate(${p.saturation / 100})` : ''].filter(Boolean).join(' ');
      if (f || p.mirror) css += `video[data-cam="${CSS.escape(id)}"]{${f ? `filter:${f};` : ''}${p.mirror ? 'transform:scaleX(-1);' : ''}}\n`;
    }
    let st = document.getElementById('bc-cam-style');
    if (!st) { st = document.createElement('style'); st.id = 'bc-cam-style'; document.head.appendChild(st); }
    if (st.textContent !== css) st.textContent = css;
    for (const [id, key] of [...opened]) {
      if (camKey(id) === key) continue;
      const old = cams.get(id);
      // 예전 스트림을 완전히 닫은 뒤에 새 화질로 연다 (열려 있으면 카메라가 예전 화질을 그대로 준다)
      const closed = (old || Promise.resolve(null)).then(s => { if (s) s.getTracks().forEach(t => t.stop()); }).catch(() => {}).then(() => new Promise(r => setTimeout(r, 250)));
      const next = closed.then(() => { cams.delete(id); return cameraStream(id); });
      next.catch(() => {});
      cams.set(id, next); // 그 사이에 찾는 곳도 새 스트림을 기다린다
      opened.set(id, camKey(id));
      document.querySelectorAll('video[data-cam]').forEach(v => { if (v.dataset.cam === id) { v.srcObject = null; next.then(s => { v.srcObject = s; v.play().catch(() => {}); }).catch(() => {}); } });
    }
  }
  function attachCamera(v, deviceId) {
    if (!v.dataset.cam) v.dataset.cam = deviceId || '';
    // 크기 재기용 숨은 무대에는 붙이지 않는다
    setTimeout(() => {
      if (!v.isConnected || v.closest('.bc-measure')) return;
      cameraStream(deviceId).then(s => { v.srcObject = s; v.play().catch(() => {}); }).catch(() => { v.replaceWith(Object.assign(document.createElement('div'), { className: 'bc-cam-off', textContent: '📷 카메라 없음' })); });
    }, 0);
  }

  /** 배경 미디어 층: 카메라 · 그림 · 영상 (템플릿 배경 바로 위, 글자 아래) */
  function buildMediaLayer(m) {
    const el = document.createElement('div');
    el.className = 'bc-medialayer';
    el.dataset.key = JSON.stringify([m.type, m.deviceId, m.url, m.fit]);
    const st = 'position:absolute;inset:0;width:100%;height:100%';
    el.innerHTML = m.type === 'camera' ? camTag(m.deviceId, m.fit, st)
      : m.type === 'video' ? videoTag(m.url, 'bc-mvid', st, m.fit)
        : `<img alt="" src="${safeUrl(m.url)}" style="${st};object-fit:${m.fit === 'contain' ? 'contain' : 'cover'}">`;
    attachCameras(el);
    return el;
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
      if (o.type === 'logo') html = o.image ? `<img class="bc-ov" alt="" src="${safeUrl(o.image)}" style="${base}height:${o.size}px">` : '';
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

  /**
   * 영상 재생 상태 맞추기: st = { playing, offset, at, now } (코어 기준 시각)
   * 소리는 sound=true 인 곳(예배당 전체화면 창)에서만
   */
  function syncVideo(v, st, { sound = false, volume = 1, loop = false } = {}) {
    if (!v || !st) return;
    v.loop = loop;
    v.muted = !sound;
    v.volume = Math.max(0, Math.min(1, volume));
    const skew = Date.now() - (st.now || Date.now()); // 코어와 이 화면의 시계 차이
    const target = st.offset + (st.playing ? (Date.now() - skew - st.at) / 1000 : 0);
    const dur = v.duration || 0;
    const want = dur && !loop ? Math.min(target, Math.max(0, dur - 0.05)) : dur && loop ? target % dur : target;
    if (Math.abs((v.currentTime || 0) - want) > 0.5 && (v.readyState >= 1)) { try { v.currentTime = want; } catch { /* 아직 불러오는 중 */ } }
    if (st.playing && v.paused && !(dur && !loop && target >= dur)) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    if (!st.playing && !v.paused) v.pause();
  }

  /** '로고 화면': 검은 바탕 가운데 큰 로고 (모든 것 위에) */
  function buildLogoScreen(image) {
    const el = document.createElement('div');
    el.className = 'bc-logoscreen';
    el.innerHTML = `<img alt="" src="${safeUrl(image)}">`;
    return el;
  }

  /** 미리보기/모니터용: 컨테이너에 슬라이드를 즉시 그린다 */
  function renderInto(container, slide, t, opts = {}) {
    const prev = [...container.children].filter(n => !n.classList.contains('bc-keep')); // 그리기 받는 층 등은 그대로
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
    if (opts.layers && opts.layers.media) stage.insertBefore(buildMediaLayer(opts.layers.media), stage.children[1] || null);
    if (opts.layers && opts.layers.hideBg) { stage.classList.add('hide-bg'); stage.firstChild.style.opacity = '0'; stage.querySelectorAll('.bc-slidebg, .bc-medialayer').forEach(x => { x.style.opacity = '0'; }); }
    if (opts.layers && opts.layers.logo) stage.appendChild(buildLogoScreen(opts.layers.logoImage));
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

  /** 그리기·강조 층 (stage 맨 위). d = { strokes: [{pts:[[x,y]], color, width, alpha}], spot: {x,y,r} } */
  function paintDraw(stage, d, t) {
    if (!stage) return;
    let svg = stage.querySelector(':scope > .bc-draw');
    const has = d && ((d.strokes && d.strokes.length) || d.spot);
    if (!has) { if (svg) svg.remove(); return; }
    const W = t.width, H = t.height;
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'bc-draw');
      stage.appendChild(svg);
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;z-index:50`;
    const sp = d.spot;
    const spot = sp ? `<defs><mask id="bcSpot"><rect width="${W}" height="${H}" fill="#fff"/><circle cx="${sp.x * W}" cy="${sp.y * H}" r="${sp.r * H}" fill="#000"/></mask></defs><rect width="${W}" height="${H}" fill="rgba(0,0,0,.66)" mask="url(#bcSpot)"/>` : '';
    const lines = (d.strokes || []).filter(s => s.pts && s.pts.length).map(s => {
      const pts = s.pts.map(p => `${(p[0] * W).toFixed(1)},${(p[1] * H).toFixed(1)}`);
      const w = s.width * H;
      return s.pts.length === 1
        ? `<circle cx="${s.pts[0][0] * W}" cy="${s.pts[0][1] * H}" r="${w / 2}" fill="${esc(s.color)}" fill-opacity="${s.alpha}"/>`
        : `<polyline points="${pts.join(' ')}" fill="none" stroke="${esc(s.color)}" stroke-opacity="${s.alpha}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('');
    svg.innerHTML = spot + lines;
  }

  global.BCRender = { buildMediaLayer, attachCameras, cameraStream, cameraInfo, setCameraPrefs, openCameras, closeCamera, paintDraw, editFor, esc, buildLogoScreen, syncVideo, safeUrl, isVideo, lyricsOnly, buildOverlays, clockText, countdownText, buildContent, buildStage, scaleStage, fit, fitsAt, renderInto, backgroundCss, contentRect };
})(window);
