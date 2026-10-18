/* 화면 언어 (한국어 / English)
 * 영어일 때만 서버가 이 파일과 사전(i18n-en.js)을 페이지에 넣는다 (<html data-lang="en">).
 * 화면의 글(태그 사이 글 · title · placeholder 등)을 사전에서 찾아 바꾼다. 사용자가 쓴 가사·본문·제목은
 * 사전과 똑같은 글이 아니면 그대로 둔다. 슬라이드 화면(.screen 등)과 글 칸 안은 건드리지 않는다.
 */
(function () {
  'use strict';
  const root = document.documentElement;
  const lang = root.dataset.lang || 'ko';
  const HANGUL = /[가-힣]/;
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  const SKIP = '.screen, .bc-stage, .bc-area, .se-render, [data-noi18n], script, style, textarea, code, pre';
  const cache = new Map();
  let pats = null;

  /** 사전에서 찾기 (앞뒤 빈칸은 그대로) */
  function t(s) {
    if (lang !== 'en' || s == null) return s;
    s = String(s);
    if (!HANGUL.test(s)) return s;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    const r = tr(m[2].replace(/[ \t]+/g, ' '));
    return r == null ? s : m[1] + r + m[3];
  }
  function tr(core) {
    const D = window.BCI18N_EN;
    if (!D || !core) return null;
    if (cache.has(core)) return cache.get(core);
    let out = Object.prototype.hasOwnProperty.call(D.strings, core) ? D.strings[core] : null;
    // '✓ 편집칸 보이기' · '■ 송출 배경 끄기' 처럼 앞에 표시가 붙은 글
    const mk = out == null && /^([✓■●▶◀⚡]\s*)([\s\S]+)$/.exec(core);
    if (mk) { const r = tr(mk[2]); if (r != null) out = mk[1] + r; }
    // 이어 붙인 글: 'A · B' · 'A: B' · 'A — B' · 'A (B)' · '1. A' → 나눠서 각각 (한국어 조각이 모두 사전에 있을 때만)
    if (out == null) out = composite(core);
    if (out == null) {
      if (!pats) pats = D.patterns.map(([src, en, order]) => {
        const lits = src.slice(1, -1).split('([\\s\\S]*?)').map(x => x.replace(/\\(.)/g, '$1'));
        return { re: new RegExp(src), en, order, lit: lits.reduce((a, b) => (b.length > a.length ? b : a), '') };
      });
      for (const p of pats) {
        if (p.lit && !core.includes(p.lit)) continue;
        const m = p.re.exec(core);
        if (!m) continue;
        // 자리에 들어간 글도 사전에 있으면 바꾼다 (예: '켜짐')
        out = p.en.replace(/\{(\d)\}/g, (_, k) => { const v = m[p.order.indexOf(+k) + 1] ?? ''; const w = /^(\s*)([\s\S]*?)(\s*)$/.exec(v); const x = HANGUL.test(w[2]) ? tr(w[2]) : null; return x == null ? v : w[1] + x + w[3]; });
        break;
      }
    }
    if (cache.size > 5000) cache.clear();
    cache.set(core, out);
    return out;
  }

  function composite(s) {
    const all = parts => { const r = parts.map(p => (HANGUL.test(p) ? tr(p.trim()) : p)); return r.every(x => x != null) ? r : null; };
    for (const sep of [' · ', ': ', ' — ']) {
      if (!s.includes(sep)) continue;
      const r = all(s.split(sep));
      if (r) return r.join(sep);
    }
    let m = /^([\s\S]+?) \(([^()]+)\)$/.exec(s);
    if (m) { const r = all([m[1], m[2]]); if (r) return `${r[0]} (${r[1]})`; }
    m = /^(\d+\.\s*|— )([\s\S]+)$/.exec(s);
    if (m) { const r = all([m[2]]); if (r) return m[1] + r[0]; }
    return null;
  }

  const skip = el => !!(el && el.closest && el.closest(SKIP) && !el.closest('.ph'));
  function doText(n) {
    const v = n.nodeValue;
    if (!v || !HANGUL.test(v) || skip(n.parentElement)) return;
    const r = t(v);
    if (r !== v) n.nodeValue = r;
  }
  function doAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && HANGUL.test(v)) { const r = t(v); if (r !== v) el.setAttribute(a, r); }
    }
    if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && HANGUL.test(el.value)) el.value = t(el.value);
  }
  function walk(node) {
    if (node.nodeType === 3) return doText(node);
    if (node.nodeType !== 1) return;
    if (node.matches('textarea, input')) return doAttrs(node); // 글 칸: 안내(placeholder)·title 만
    if (skip(node)) return;
    doAttrs(node);
    const w = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: x => (x.nodeType === 1 && x.matches(SKIP) && !x.matches('textarea') && !x.querySelector('.ph') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let x;
    while ((x = w.nextNode())) { if (x.nodeType === 3) doText(x); else if (!x.matches(SKIP) || x.matches('textarea')) doAttrs(x); }
  }

  if (lang === 'en') {
    root.lang = 'en';
    new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'childList') m.addedNodes.forEach(walk);
        else if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes' && (!skip(m.target) || m.target.matches('textarea, input'))) doAttrs(m.target);
      }
    }).observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS, 'value'] });
    if (document.body) walk(document.body);
    walk(document.head || root);
    // 확인·알림 창
    const wrap = fn => function (msg, ...rest) { return fn.call(window, t(msg), ...rest.map(x => (typeof x === 'string' ? t(x) : x))); };
    window.alert = wrap(window.alert);
    window.confirm = wrap(window.confirm);
    window.prompt = wrap(window.prompt);
  }

  /** 설정의 언어가 바뀌면 다시 불러온다 (서버가 새 언어로 페이지를 준다) */
  function sync(next) {
    next = next === 'en' ? 'en' : 'ko';
    if (next !== lang) location.reload();
  }
  window.BCI18n = { lang, t, sync };
})();
