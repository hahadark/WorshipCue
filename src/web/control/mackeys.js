/* 맥: 화면에 보이는 단축키 표시를 맥 모양으로 (Ctrl+E → ⌘E, Alt+ → ⌥, Shift+ → ⇧)
 * 단축키 자체는 control.js 의 comboOf 가 ⌘ 를 Ctrl 로 받아서 윈도우와 같은 설정을 쓴다
 */
(function () {
  'use strict';
  if (!/Mac/.test(navigator.platform)) return;
  const RE = /\b(Ctrl|Alt|Shift)\+/;
  const MAP = s => s.replace(/\bCtrl\+/g, '⌘').replace(/\bAlt\+/g, '⌥').replace(/\bShift\+/g, '⇧');
  const SKIP = 'textarea, input, .screen, [data-noi18n]';
  const doText = n => { const v = n.nodeValue; if (v && RE.test(v) && !(n.parentElement && n.parentElement.closest(SKIP))) n.nodeValue = MAP(v); };
  const doAttr = el => { const v = el.getAttribute && el.getAttribute('title'); if (v && RE.test(v)) el.setAttribute('title', MAP(v)); };
  function walk(node) {
    if (node.nodeType === 3) return doText(node);
    if (node.nodeType !== 1) return;
    doAttr(node);
    const w = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let x;
    while ((x = w.nextNode())) { if (x.nodeType === 3) doText(x); else doAttr(x); }
  }
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(walk);
      else if (m.type === 'characterData') doText(m.target);
      else doAttr(m.target);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title'] });
  document.addEventListener('DOMContentLoaded', () => walk(document.body));
})();
