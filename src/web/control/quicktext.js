/* 즉석 자막 (송출 → 즉석 자막…, 아래 송출 줄 '즉석 자막', Ctrl+T)
 * 예배 중 갑자기 필요한 한 줄(설교 중 문장 · 광고 고침 · 안내)을 써서 Enter 로 바로 송출한다.
 * 보낸 글은 이 PC 에 최근 목록으로 남아 다시 누르면 또 나가고, '큐시트에 넣기' 로 공지 순서로 남길 수도 있다.
 * 미리보기를 거치지 않고, 열려 있어도 F5·F6·F9·F10 같은 송출 키는 그대로 쓴다 (모달이 아님).
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const ic = n => (window.BCIcon ? window.BCIcon(n) : '');
  const KEY = 'wc-quick-texts';
  const MAX = 12;
  let box = null;

  function recent() {
    try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.trim()).slice(0, MAX) : []; } catch { return []; }
  }
  function remember(text) {
    const a = [text, ...recent().filter(x => x !== text)].slice(0, MAX);
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* 무시 */ }
  }
  function forget(text) {
    try { localStorage.setItem(KEY, JSON.stringify(recent().filter(x => x !== text))); } catch { /* 무시 */ }
  }

  /** 글 → 송출 슬라이드 (공지와 같은 글자 슬라이드, 길면 자동으로 나눔) */
  function slidesOf(text) {
    const SL = window.BCSlides;
    return SL.buildText({ title: '', showTitle: false, chunks: SL.textChunks(text) }, app.splitOpts());
  }

  async function send(text) {
    text = String(text || '').replace(/\r/g, '').trim();
    if (!text) { app.showMsg('송출할 글을 쓰세요.', 'warn', 2000); return false; }
    let slides;
    try { slides = slidesOf(text); } catch (e) { app.showMsg('즉석 자막을 만들지 못했습니다: ' + e.message, 'error'); return false; }
    if (!slides.length) return false;
    const r = await app.sendSlidesLive('즉석 자막', slides, 0);
    if (!r.ok) { app.showMsg(r.error, 'error'); return false; }
    remember(text);
    renderList();
    app.showMsg(slides.length > 1 ? `즉석 자막을 송출했습니다 (${slides.length}장 — F6 으로 넘김)` : '즉석 자막을 송출했습니다.', 'info', 2000);
    return true;
  }

  function toCue(text) {
    text = String(text || '').replace(/\r/g, '').trim();
    if (!text) { app.showMsg('큐시트에 넣을 글을 쓰세요.', 'warn', 2000); return; }
    if (!window.BCCue || !window.BCCue.addItem) return;
    if (!window.BCCue.currentId()) { app.showMsg('먼저 큐시트를 여세요.', 'warn', 2500); return; }
    const first = text.split('\n')[0].trim();
    window.BCCue.addItem('text', { title: first.length > 20 ? first.slice(0, 20) + '…' : first, body: text });
    remember(text);
    renderList();
    app.showMsg('고른 순서 다음에 공지 순서로 넣었습니다.', 'info', 2500);
  }

  function renderList() {
    if (!box) return;
    const a = recent();
    $('#qtList').innerHTML = a.length
      ? a.map((t, i) => `<div class="qt-item" data-i="${i}"><button class="qt-send" data-i="${i}" title="누르면 이 글을 다시 송출">${esc(t.replace(/\n/g, ' / '))}</button><button class="icon-btn qt-edit" data-i="${i}" title="입력칸으로 가져와 고치기">${ic('pencil')}</button><button class="icon-btn qt-del" data-i="${i}" title="목록에서 지우기">${ic('x')}</button></div>`).join('')
      : '<div class="muted qt-empty">보낸 글이 여기에 남습니다. 누르면 다시 송출합니다.</div>';
  }

  function build() {
    box = document.createElement('div');
    box.id = 'quickText';
    box.className = 'quick-text';
    box.hidden = true;
    box.innerHTML = `<div class="qt-head"><b>${ic('text')}즉석 자막</b><span class="muted">Enter 송출 · Shift+Enter 줄 바꿈 · Esc 닫기</span><button class="icon-btn" id="qtClose" title="닫기 (Esc)">${ic('x')}</button></div>
      <textarea id="qtInput" rows="3" spellcheck="false" placeholder="예: 예배 후 전 교인 식사가 있습니다"></textarea>
      <div class="qt-actions"><button id="qtSend" class="primary">${ic('play')}송출 <kbd>Enter</kbd></button><button id="qtCue" class="ghost" title="고른 순서 다음에 '공지' 순서로 넣습니다">${ic('plus')}큐시트에 넣기</button></div>
      <div class="qt-sub muted">최근에 보낸 글</div>
      <div id="qtList" class="qt-list"></div>`;
    document.body.appendChild(box);
    const input = $('#qtInput');
    $('#qtClose').onclick = close;
    $('#qtSend').onclick = async () => { if (await send(input.value)) { input.value = ''; input.focus(); } };
    $('#qtCue').onclick = () => toCue(input.value);
    input.addEventListener('keydown', async e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        if (await send(input.value)) input.value = '';
      }
    });
    $('#qtList').addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const t = recent()[+b.dataset.i];
      if (t == null) return;
      if (b.classList.contains('qt-send')) send(t);
      else if (b.classList.contains('qt-edit')) { input.value = t; input.focus(); }
      else if (b.classList.contains('qt-del')) { forget(t); renderList(); }
    });
  }

  function place() {
    const btn = $('#bQuick');
    const foot = $('footer.bottom');
    const r = btn && btn.offsetParent ? btn.getBoundingClientRect() : null;
    const bottom = foot ? window.innerHeight - foot.getBoundingClientRect().top + 8 : 64;
    box.style.bottom = bottom + 'px';
    const w = box.offsetWidth || 420;
    // 단추 오른쪽 끝에 맞춰 왼쪽으로 펼친다 — 오른쪽의 LIVE 화면을 가리지 않게
    box.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r ? r.right - w : 8)) + 'px';
  }

  function open(text) {
    if (!box) build();
    box.hidden = false;
    renderList();
    place();
    const input = $('#qtInput');
    if (typeof text === 'string') input.value = text;
    input.focus();
    input.select();
    const b = $('#bQuick'); if (b) b.classList.add('on');
  }
  function close() {
    if (!box || box.hidden) return;
    box.hidden = true;
    const b = $('#bQuick'); if (b) b.classList.remove('on');
  }
  const isOpen = () => !!box && !box.hidden;
  const toggle = () => (isOpen() ? close() : open());

  window.addEventListener('resize', () => { if (isOpen()) place(); });
  const btn = $('#bQuick');
  if (btn) btn.onclick = toggle;

  window.BCQuick = { open, close, toggle, isOpen, send, slidesOf, recent };
})();
