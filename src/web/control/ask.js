/* 글 한 줄 묻기 (window.prompt 대신): Electron 은 prompt() 를 지원하지 않아 예외가 난다.
 * app.ask(질문, 기본값) → Promise<string | null>  (취소 = null). 열린 창(모달) 위에 뜨고, Enter = 확인 · Esc = 취소.
 */
(function () {
  'use strict';
  const app = window.BC;
  let box = null;
  let done = null;

  function build() {
    box = document.createElement('div');
    box.className = 'ask-wrap';
    box.hidden = true;
    box.innerHTML = '<div class="ask-box" role="dialog" aria-modal="true"><div class="ask-q"></div><input type="text" class="ask-in" spellcheck="false"><div class="ask-go"><button class="ask-cancel">취소</button><button class="ask-ok primary">확인</button></div></div>';
    document.body.appendChild(box);
    const inp = box.querySelector('.ask-in');
    box.querySelector('.ask-ok').onclick = () => finish(inp.value);
    box.querySelector('.ask-cancel').onclick = () => finish(null);
    box.addEventListener('mousedown', e => { if (e.target === box) finish(null); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); finish(inp.value); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
    });
  }
  function finish(v) {
    if (!box || box.hidden) return;
    box.hidden = true;
    const f = done; done = null;
    if (f) f(v);
  }

  function ask(question, def = '') {
    if (!box) build();
    if (done) finish(null);
    box.querySelector('.ask-q').textContent = question;
    const inp = box.querySelector('.ask-in');
    inp.value = def == null ? '' : String(def);
    box.hidden = false;
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
    return new Promise(res => { done = res; });
  }
  const isOpen = () => !!box && !box.hidden;

  app.ask = ask;
  window.BCAsk = { ask, isOpen, finish };
})();
