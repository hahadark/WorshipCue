/* 홈페이지 주보 → 큐시트 · 광고 슬라이드 (파일 → 홈페이지 주보로 큐시트·광고…)
 * 교회 홈페이지가 내는 주보 JSON(…/bulletin/feed.json)을 받아
 *  - 고른 예배의 순서로 큐시트를 만들고 (교회 소식 순서에 광고 슬라이드를 채움)
 *  - 또는 열린 큐시트에 광고 슬라이드만 넣는다
 * 주보를 홈페이지에 한 번 입력하면 홈페이지와 예배 화면에 같이 쓰인다.
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const cmd = (...a) => app.cmd(...a);
  const ic = n => (window.BCIcon ? window.BCIcon(n) : '');
  let feed = null;

  async function open() {
    const r = await cmd('homeFeedInfo');
    const url = r.ok ? r.result.url : '';
    feed = null;
    app.openModal('홈페이지 주보 → 큐시트 · 광고', `<div class="hf form">
      <div class="note full">교회 홈페이지에 올린 주보로 예배 큐시트를 만들고, 교회 소식(광고)을 슬라이드로 넣습니다. 주보는 홈페이지에 한 번만 입력하면 됩니다.</div>
      <label>주보 주소</label><div class="row-flex"><input type="text" id="hfUrl" value="${esc(url)}" placeholder="https://교회주소/bulletin/feed.json" style="flex:1" spellcheck="false"><button id="hfLoad" class="primary">${ic('download')}불러오기</button></div>
      <span></span><div class="note" id="hfMsg">홈페이지의 주보 JSON 주소를 넣으세요. 한 번 불러오면 이 PC 에 기억합니다.</div>
      <div id="hfBody" class="full"></div>
    </div>`);
    $('#hfLoad').onclick = load;
    $('#hfUrl').onkeydown = e => { if (e.key === 'Enter') load(); };
    if (url) load(); else $('#hfUrl').focus();
  }

  const msg = (t, err) => { const m = $('#hfMsg'); if (m) m.innerHTML = err ? `<span class="err-text">${esc(t)}</span>` : esc(t); };

  async function load() {
    const url = $('#hfUrl').value.trim();
    if (!url) return msg('주보 주소를 넣으세요.', true);
    $('#hfLoad').disabled = true;
    msg('홈페이지에서 주보를 받는 중…');
    let r;
    try { r = await cmd('homeFeed', { url }); } finally { $('#hfLoad').disabled = false; }
    if (!r.ok) { $('#hfBody').innerHTML = ''; return msg(r.error, true); }
    feed = r.result;
    msg(`${feed.church ? feed.church + ' · ' : ''}주보 ${feed.bulletins.length}개를 받았습니다`);
    draw(0, 0);
  }

  /** 열린 큐시트의 예배 날짜 */
  function cueDate() {
    const sel = $('#cueSel');
    const m = sel && sel.selectedOptions[0] && sel.selectedOptions[0].textContent.match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : '';
  }

  function draw(bi, si) {
    const b = feed.bulletins[bi];
    if (!b) return;
    const v = b.services[si] || b.services[0];
    $('#hfBody').innerHTML = `
      <div class="hf-pick">
        <label>주보</label><select id="hfB">${feed.bulletins.map((x, i) => `<option value="${i}" ${i === bi ? 'selected' : ''}>${esc(x.date || '(날짜 없음)')}${x.issue ? ' · ' + esc(x.issue) : ''}${x.sermon.title ? ' · ' + esc(x.sermon.title) : ''}</option>`).join('')}</select>
        <label>예배</label><select id="hfS">${b.services.map((x, i) => `<option value="${i}" ${i === si ? 'selected' : ''}>${esc(x.name)}${x.time ? ' · ' + esc(x.time) : ''}</option>`).join('') || '<option>예배 순서 없음</option>'}</select>
      </div>
      <div class="hf-cols">
        <div class="hf-col"><h4>${ic('list-checks')}예배 순서 <span class="muted">${v ? v.items.length + '개' : ''}</span></h4>
          <ol class="hf-order">${v ? v.items.map(x => `<li><b>${esc(x.part)}</b>${x.content ? ` <span>${esc(x.content)}</span>` : ''}${x.by ? ` <span class="muted">${esc(x.by)}</span>` : ''}${x.stand ? ' <span class="muted">*</span>' : ''}</li>`).join('') : ''}</ol>
        </div>
        <div class="hf-col"><h4>${ic('megaphone')}교회 소식 <span class="muted">넣을 것을 고르세요</span></h4>
          <div class="hf-news">${b.news.map((n, i) => `<label class="hf-n"><input type="checkbox" data-n="${i}" checked><span><b>${esc(n.title)}</b>${n.body ? `<em>${esc(n.body)}</em>` : ''}</span></label>`).join('') || '<div class="muted">이 주보에는 교회 소식이 없습니다.</div>'}
            ${b.events.length ? `<label class="hf-n"><input type="checkbox" data-ev checked><span><b>이번 주 일정 (한 장)</b><em>${b.events.map(e => esc(`${e.when} ${e.title}`)).join(' · ')}</em></span></label>` : ''}
            ${b.prayers.length ? `<label class="hf-n"><input type="checkbox" data-pr><span><b>기도 제목 (${b.prayers.length}장)</b><em>${b.prayers.map(p => esc(p.title)).join(' · ')}</em></span></label>` : ''}
          </div>
        </div>
      </div>
      <div class="row-flex hf-go">
        <button id="hfCue" class="primary" ${v ? '' : 'disabled'}>${ic('list-checks')}이 예배로 큐시트 만들기</button>
        <button id="hfNews">${ic('megaphone')}열린 큐시트에 광고만 넣기</button>
        <span class="muted" id="hfHint">큐시트의 '교회 소식' 순서에 고른 광고가 슬라이드로 들어갑니다</span>
      </div>
      <div id="hfResult"></div>`;
    $('#hfB').onchange = e => draw(+e.target.value, 0);
    $('#hfS').onchange = e => draw(bi, +e.target.value);
    $('#hfCue').onclick = () => makeCue(b, si);
    $('#hfNews').onclick = () => insertNews(b);
    // 열린 큐시트 날짜와 같은 주보가 있으면 처음에 그것을 고른다
    if (bi === 0 && si === 0 && !draw.once) {
      draw.once = true;
      const d = cueDate();
      const k = d ? feed.bulletins.findIndex(x => x.date === d) : -1;
      if (k > 0) draw(k, 0);
    }
  }

  const selection = () => ({
    news: [...document.querySelectorAll('#hfBody [data-n]')].filter(c => c.checked).map(c => +c.dataset.n),
    events: !!($('#hfBody [data-ev]') && $('#hfBody [data-ev]').checked),
    prayers: !!($('#hfBody [data-pr]') && $('#hfBody [data-pr]').checked),
  });

  async function makeCue(b, si) {
    $('#hfCue').disabled = true;
    let r;
    try { r = await cmd('homeMakeCue', { bulletin: b, service: si, news: selection() }); } finally { $('#hfCue').disabled = false; }
    if (!r.ok) return app.showMsg(r.error, 'error');
    const { cue, warnings = [], newsPlaced } = r.result;
    $('#hfResult').innerHTML = `<div class="ai-done hf-done"><b>✓ '${esc(cue.name)}' 큐시트를 만들었습니다 (${cue.items.length}개 순서)</b>
      ${newsPlaced ? '' : '<div class="muted">이 예배 순서에 \'교회 소식\'·\'광고\' 순서가 없어 광고는 넣지 않았습니다. \'열린 큐시트에 광고만 넣기\' 를 쓰세요.</div>'}
      ${warnings.length ? `<div class="hf-warn"><b>확인할 것</b><ul>${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
      <div class="row-flex"><button id="hfOpen" class="primary">${ic('folder-open')}이 큐시트 열기</button></div></div>`;
    $('#hfOpen').onclick = async () => { app.closeModal(); if (window.BCCue) await window.BCCue.openCue(cue.id); };
  }

  async function insertNews(b) {
    if (!window.BCCue || !window.BCCue.currentId()) return app.showMsg('큐시트를 먼저 여세요.', 'error');
    const r = await cmd('homeNewsItem', { bulletin: b, news: selection() });
    if (!r.ok) return app.showMsg(r.error, 'error');
    // '교회 소식'·'광고' 순서가 있으면 그 다음에, 아니면 고른 순서 다음에
    let k = -1;
    for (let i = 0; i < 500; i++) { const it = window.BCCue.item(i); if (!it) break; if (/^(교회\s*소식|광고|알림|공지)/.test(String(it.title || '').trim())) { k = i; break; } }
    if (k >= 0) window.BCCue.selectQuiet(k);
    window.BCCue.addItem('text', r.result.item);
    app.closeModal();
    const n = r.result.item.body.split('\n---\n').length;
    app.showMsg(`광고 슬라이드 ${n}장을 큐시트에 넣었습니다.`, 'ok', 2500);
  }

  window.BCHome = { open };
})();
