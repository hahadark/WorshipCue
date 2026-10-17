/* 글 서식 도구: 편집칸·슬라이드 편집기의 글 칸 (data-fmt 가 붙은 textarea)
 * 고른 글을 **굵게** · {크기:150}…{/크기} · {색:#e63946}…{/색} 로 감싼다 (화면에서는 서식으로 보임)
 * Ctrl+B = 굵게 · Ctrl+Shift+> / < = 크게·작게 · 도구 줄의 단추·색
 */
(function () {
  'use strict';
  const COLORS = ['#ffffff', '#ffd166', '#ff6b6b', '#e63946', '#4cc9f0', '#80ed99', '#c77dff', '#000000'];
  const SIZES = [[70, '작게'], [85, '조금 작게'], [130, '크게'], [160, '아주 크게'], [200, '두 배']];

  /** 이 단추·도구 줄이 다룰 글 칸 */
  const taFor = el => {
    const box = el.closest('.fmt-scope') || el.closest('#cueEditor, #seProps, .se-handles') || document;
    return box.querySelector('textarea[data-fmt]');
  };
  function changed(ta) { ta.dispatchEvent(new Event('input', { bubbles: true })); if (!ta.classList.contains('se-inline')) ta.dispatchEvent(new Event('change', { bubbles: true })); }

  /** 고른 글을 a … b 로 감싼다 (이미 감싸져 있으면 벗긴다) */
  function wrap(ta, a, b, unwrapRe) {
    const v = ta.value;
    let s = ta.selectionStart, e = ta.selectionEnd;
    if (s === e) { // 고른 것이 없으면 그 줄 전체
      s = v.lastIndexOf('\n', s - 1) + 1;
      const n = v.indexOf('\n', e);
      e = n < 0 ? v.length : n;
    }
    if (s === e) return;
    const sel = v.slice(s, e);
    const before = v.slice(0, s), after = v.slice(e);
    // 이미 같은 종류로 감싸여 있으면 벗기기 (굵게 두 번 = 해제)
    const m = unwrapRe && before.match(unwrapRe.open);
    if (m && after.startsWith(b)) {
      ta.focus();
      ta.setRangeText(sel, s - m[0].length, e + b.length, 'select');
      return changed(ta);
    }
    ta.focus();
    ta.setRangeText(a + sel + b, s, e, 'end');
    ta.setSelectionRange(s + a.length, s + a.length + sel.length);
    changed(ta);
  }
  const bold = ta => wrap(ta, '**', '**', { open: /\*\*$/ });
  const size = (ta, n) => wrap(ta, `{크기:${n}}`, '{/크기}', { open: /\{크기:\d{2,3}\}$/ });
  const color = (ta, c) => wrap(ta, `{색:${c}}`, '{/색}', { open: /\{색:#[0-9a-fA-F]{3,8}\}$/ });
  /** 고른 글(없으면 그 줄)의 서식 표시 지우기 */
  function clear(ta) {
    const v = ta.value;
    let s = ta.selectionStart, e = ta.selectionEnd;
    if (s === e) { s = v.lastIndexOf('\n', s - 1) + 1; const n = v.indexOf('\n', e); e = n < 0 ? v.length : n; }
    const strip = window.BCGroup.stripFmt(v.slice(s, e));
    ta.focus();
    ta.setRangeText(strip, s, e, 'select');
    changed(ta);
  }

  /** 도구 줄 HTML (글 칸 아래 안내 줄에 넣는다) */
  function bar() {
    return `<span class="fmt-bar" title="글을 고른 뒤 누르세요 (고르지 않으면 그 줄 전체)">`
      + `<button type="button" data-fmt-b title="굵게 (Ctrl+B)"><b>B</b></button>`
      + `<select data-fmt-size title="글자 크기 (Ctrl+Shift+> 크게 · Ctrl+Shift+< 작게)"><option value="">크기</option>${SIZES.map(([n, l]) => `<option value="${n}">${l} (${n}%)</option>`).join('')}</select>`
      + COLORS.map(c => `<button type="button" class="fmt-sw" data-fmt-color="${c}" style="background:${c}" title="글자 색 ${c}"></button>`).join('')
      + `<input type="color" data-fmt-pick value="#ffd166" title="다른 색">`
      + `<button type="button" data-fmt-clear title="서식 지우기">서식 지우기</button></span>`;
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('.fmt-bar button');
    if (!b) return;
    const ta = taFor(b);
    if (!ta) return;
    e.preventDefault();
    if (b.hasAttribute('data-fmt-b')) bold(ta);
    else if (b.dataset.fmtColor) color(ta, b.dataset.fmtColor);
    else if (b.hasAttribute('data-fmt-clear')) clear(ta);
  });
  // 단추를 눌러도 글 칸의 고른 범위가 풀리지 않게
  document.addEventListener('mousedown', e => { if (e.target.closest('.fmt-bar button')) e.preventDefault(); });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('.fmt-bar [data-fmt-size]') && t.value) { const ta = taFor(t); if (ta) size(ta, +t.value); t.value = ''; }
    else if (t.matches('.fmt-bar [data-fmt-pick]')) { const ta = taFor(t); if (ta) color(ta, t.value); }
  });
  // Ctrl+B 등: 다른 단축키(성경 책 찾기 등)보다 먼저 받는다 — 이 파일은 control.js 보다 먼저 읽힌다
  window.addEventListener('keydown', e => {
    const ta = e.target;
    if (!(ta instanceof HTMLTextAreaElement) || !ta.hasAttribute('data-fmt') || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    let done = true;
    if (e.code === 'KeyB' && !e.shiftKey) bold(ta);
    else if (e.shiftKey && e.code === 'Period') size(ta, 130);
    else if (e.shiftKey && e.code === 'Comma') size(ta, 80);
    else done = false;
    if (done) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  window.BCFmt = { bar, bold, size, color, clear };
})();
