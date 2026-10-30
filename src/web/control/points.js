/* 설교 포인트 슬라이드 (큐시트 → 설교 포인트 슬라이드…)
 * 설교 원고·자막 → 대지 3~4개와 핵심 문장 → 고쳐 보고 → 큐시트에 '제목' 순서 하나로 (장마다 카드 한 장)
 *  - 대지 찾기 (AI 없이): '첫째·둘째', '1. 2.' 같은 표시로  · 채팅 AI 의 답(JSON)을 원고 칸에 붙여 넣어도 된다
 *  - AI 로 뽑기: 오픈라우터 키 (주보 AI 와 같은 키·모델)
 *  - 채팅 AI: 프롬프트(원고 포함) 복사 → ChatGPT·Claude·Gemini → 답 붙여 넣기
 * 데이터 모양은 설교쇼츠 편집기의 '설교 요약' 과 같다: { title, verse, speaker, theme, points:[{heading, body}], application }
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const cmd = (...a) => app.cmd(...a);
  const ic = (n, c) => (window.BCIcon ? window.BCIcon(n, c) : '');
  const CHATS = [['ChatGPT', 'https://chatgpt.com/'], ['Claude', 'https://claude.ai/new'], ['Gemini', 'https://gemini.google.com/app']];
  const DRAFT = 'wc-points-draft';
  const OPTS = 'wc-points-opts';
  let data = null; // { title, verse, speaker, theme, points, application }
  let opts = { numbering: 'word', theme: true, application: true };
  try { opts = { ...opts, ...JSON.parse(localStorage.getItem(OPTS) || '{}') }; } catch { /* 처음 */ }

  /** 열린 큐시트의 순서들 */
  function cueItems() {
    const out = [];
    if (!window.BCCue) return out;
    for (let i = 0; i < 500; i++) { const it = window.BCCue.item(i); if (!it) break; out.push(it); }
    return out;
  }
  /** '설교' 순서 (넣을 자리 · 제목·설교자 미리 채우기) */
  const isSermon = it => it && it.type === 'title' && /^(설교|말씀)(\s|$)/.test(String(it.title || '').trim()) && !/설교 포인트/.test(it.note || '');
  function guessMeta() {
    const items = cueItems();
    const meta = { title: '', verse: '', speaker: '' };
    const si = items.findIndex(isSermon);
    if (si >= 0) {
      const sub = String(items[si].subtitle || '');
      const q = sub.match(/[“"'‘「『]([^”"'’」』]+)[”"'’」』]\s*[·,\-–]?\s*(.*)$/);
      if (q) { meta.title = q[1].trim(); meta.speaker = q[2].trim(); } else if (sub) meta.title = sub.trim();
    }
    // 본문: 설교 앞의 가장 가까운 성경 순서 (없으면 처음 성경 순서)
    const before = si >= 0 ? items.slice(0, si).reverse() : items;
    const b = before.find(it => it.type === 'bible' && it.ref) || items.find(it => it.type === 'bible' && it.ref);
    if (b) meta.verse = String(b.ref);
    return { meta, sermonIndex: si };
  }

  function open() {
    const { meta, sermonIndex } = guessMeta();
    let draft = '';
    try { draft = localStorage.getItem(DRAFT) || ''; } catch { /* 무시 */ }
    data = null;
    app.openModal('설교 포인트 슬라이드', `<div class="pts form">
      <div class="note full">설교 원고(또는 자막)에서 대지 3~4개와 핵심 문장을 뽑아, 큐시트에 제목 순서 하나로 넣습니다. 송출 중에는 F6 으로 한 장씩 넘깁니다.</div>
      <label>설교 제목</label><input type="text" id="ptTitle" value="${esc(meta.title)}" placeholder="예: 복음을 부끄러워하지 않는 삶">
      <label>본문 · 설교자</label><div class="row-flex"><input type="text" id="ptVerse" value="${esc(meta.verse)}" placeholder="예: 롬 1:16-17" style="flex:1"><input type="text" id="ptSpeaker" value="${esc(meta.speaker)}" placeholder="설교자 (선택)" style="flex:1"></div>
      <label>설교 원고</label><textarea id="ptText" rows="9" spellcheck="false" placeholder="원고를 붙여 넣거나 파일을 불러오세요 — 예: 첫째, 복음은 하나님의 능력입니다. 둘째, …">${esc(draft)}</textarea>
      <span></span><div class="row-flex"><button id="ptFile">${ic('folder-open')}원고 파일…</button><span class="muted">hwp · hwpx · docx · txt · 자막(srt · vtt)</span></div>
      <span></span><div class="row-flex pts-go">
        <button id="ptFind" class="primary">${ic('list-checks')}대지 찾기 (AI 없이)</button>
        <button id="ptAI">${ic('sparkles')}AI 로 뽑기</button>
        <button id="ptChat">${ic('clipboard-copy')}채팅 AI 프롬프트 복사</button>
        <span id="ptMsg" class="muted"></span>
      </div>
      <div id="ptChatBox" class="full pts-chat" hidden>
        <div class="row-flex"><span class="muted">프롬프트를 복사했습니다. 채팅 AI 에 붙여 넣고, 답을 아래에 붙여 넣으세요.</span>${CHATS.map(([n, u]) => `<button data-chat="${esc(u)}">${esc(n)} 열기</button>`).join('')}</div>
        <textarea id="ptAnswer" rows="4" spellcheck="false" placeholder="AI 의 답을 통째로 붙여 넣으세요 (json 코드 블록이 섞여 있어도 됩니다)"></textarea>
        <div class="row-flex"><button id="ptImport" class="primary">${ic('check')}답 불러오기</button></div>
      </div>
      <div id="ptResult" class="full"></div>
    </div>`);
    const save = () => { try { localStorage.setItem(DRAFT, $('#ptText').value.slice(0, 200000)); } catch { /* 무시 */ } };
    $('#ptText').oninput = save;
    $('#ptFile').onclick = pickFile;
    $('#ptFind').onclick = () => run('sermonPointsFind');
    $('#ptAI').onclick = () => run('sermonPointsAI');
    $('#ptChat').onclick = copyPrompt;
    $('#ptImport').onclick = importAnswer;
    document.querySelectorAll('.pts [data-chat]').forEach(b => b.onclick = () => cmd('openLink', { url: b.dataset.chat }));
    $('#ptResult').dataset.sermon = String(sermonIndex);
    ($('#ptText').value ? $('#ptFind') : $('#ptText')).focus();
  }

  const meta = () => ({ title: $('#ptTitle').value.trim(), verse: $('#ptVerse').value.trim(), speaker: $('#ptSpeaker').value.trim() });
  const msg = (t, err) => { $('#ptMsg').innerHTML = err ? `<span class="err-text">${esc(t)}</span>` : esc(t); };

  function pickFile() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.hwp,.hwpx,.docx,.txt,.md,.srt,.vtt';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      if (f.size > 30 * 1024 * 1024) return msg('파일이 너무 큽니다.', true);
      msg(`${f.name} 읽는 중…`);
      let text = '';
      if (/\.(txt|md|srt|vtt)$/i.test(f.name)) text = (await f.text()).replace(/^\ufeff/, '');
      else {
        const r = await fetch('/api/readtext', { method: 'POST', headers: { 'X-WorshipCue': '1', 'X-Filename': encodeURIComponent(f.name), 'Content-Type': 'application/octet-stream' }, body: f }).then(x => x.json()).catch(e => ({ ok: false, error: e.message }));
        if (!r.ok) return msg(r.error, true);
        text = r.result.text;
      }
      $('#ptText').value = text;
      try { localStorage.setItem(DRAFT, text.slice(0, 200000)); } catch { /* 무시 */ }
      msg(`${f.name} 을(를) 불러왔습니다 (${text.length.toLocaleString()}자)`);
    };
    inp.click();
  }

  async function run(name) {
    const text = $('#ptText').value;
    if (!text.trim()) return msg('설교 원고를 붙여 넣거나 파일을 불러오세요.', true);
    const btn = name === 'sermonPointsAI' ? $('#ptAI') : $('#ptFind');
    btn.disabled = true;
    const t0 = Date.now();
    const tick = name === 'sermonPointsAI' ? setInterval(() => msg(`AI 가 원고를 읽는 중… ${Math.round((Date.now() - t0) / 1000)}초`), 500) : null;
    if (tick) msg('AI 가 원고를 읽는 중…');
    let r;
    try { r = await cmd(name, { text, meta: meta() }); } finally { if (tick) clearInterval(tick); btn.disabled = false; }
    if (!r.ok) return msg(r.error, true);
    msg(name === 'sermonPointsAI' ? `AI 로 뽑았습니다${r.result.model ? ` (${r.result.model})` : ''} — 고쳐 보고 넣으세요` : r.result.data.found === 'json' ? 'AI 답을 읽었습니다 — 고쳐 보고 넣으세요' : `대지 ${r.result.data.points.length}개를 찾았습니다 — 고쳐 보고 넣으세요`);
    setData(r.result.data);
  }

  async function copyPrompt() {
    const text = $('#ptText').value;
    if (!text.trim()) return msg('설교 원고를 먼저 붙여 넣으세요.', true);
    const r = await cmd('sermonPointsPrompt', { text, meta: meta() });
    if (!r.ok) return msg(r.error, true);
    try { await navigator.clipboard.writeText(r.result.prompt); } catch (e) { return msg('복사하지 못했습니다: ' + e.message, true); }
    $('#ptChatBox').hidden = false;
    msg('프롬프트(원고 포함)를 복사했습니다');
    $('#ptAnswer').focus();
  }

  async function importAnswer() {
    const text = $('#ptAnswer').value;
    if (!text.trim()) return msg('AI 의 답을 붙여 넣으세요.', true);
    const r = await cmd('sermonPointsImport', { text, meta: meta() });
    if (!r.ok) return msg(r.error, true);
    msg('AI 답을 읽었습니다 — 고쳐 보고 넣으세요');
    setData(r.result.data);
  }

  // ---------------- 고치기 · 미리보기 · 넣기 ----------------
  function setData(d) {
    data = { title: d.title || '', verse: d.verse || '', speaker: d.speaker || '', theme: d.theme || '', points: (d.points || []).map(p => ({ heading: p.heading || '', body: p.body || '' })), application: d.application || '' };
    if (data.title && !$('#ptTitle').value.trim()) $('#ptTitle').value = data.title;
    if (data.verse && !$('#ptVerse').value.trim()) $('#ptVerse').value = data.verse;
    if (data.speaker && !$('#ptSpeaker').value.trim()) $('#ptSpeaker').value = data.speaker;
    draw();
  }

  const LAB = { word: ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째'], num: ['1.', '2.', '3.', '4.', '5.', '6.'] };
  const label = i => (opts.numbering === 'none' ? '' : LAB[opts.numbering][i] + (opts.numbering === 'word' ? ',' : ''));

  function draw() {
    const box = $('#ptResult');
    if (!box || !data) return;
    const si = Number(box.dataset.sermon);
    box.innerHTML = `<h4>설교 포인트 <span class="muted">칸을 고치면 바로 반영됩니다</span></h4>
      <div class="pts-edit">
        <label class="pts-row"><span class="pts-k"><input type="checkbox" data-o="theme" ${opts.theme ? 'checked' : ''}> 핵심</span><input type="text" data-f="theme" value="${esc(data.theme)}" placeholder="설교 전체의 핵심 한 문장 (비우면 넣지 않음)"></label>
        ${data.points.map((p, i) => `<div class="pts-row pts-pt"><span class="pts-k pts-num">${esc(label(i)) || i + 1}</span>
          <input type="text" data-p="${i}" data-k="heading" value="${esc(p.heading)}" placeholder="대지 제목 (큰 글)">
          <input type="text" data-p="${i}" data-k="body" value="${esc(p.body)}" placeholder="핵심 문장 (작은 글, 선택)">
          <button class="icon-btn ghost" data-del="${i}" title="이 대지 빼기">${ic('x')}</button></div>`).join('')}
        <div class="pts-row"><span class="pts-k"></span><button data-add>${ic('plus')}대지 더하기</button>
          <span class="pts-opt">번호 <select data-o="numbering"><option value="word" ${opts.numbering === 'word' ? 'selected' : ''}>첫째, 둘째,</option><option value="num" ${opts.numbering === 'num' ? 'selected' : ''}>1. 2.</option><option value="none" ${opts.numbering === 'none' ? 'selected' : ''}>없음</option></select></span></div>
        <label class="pts-row"><span class="pts-k"><input type="checkbox" data-o="application" ${opts.application ? 'checked' : ''}> 적용</span><input type="text" data-f="application" value="${esc(data.application)}" placeholder="이번 주 적용 한 문장 (비우면 넣지 않음)"></label>
      </div>
      <div class="pts-cards" id="ptCards"></div>
      <div class="row-flex pts-insert"><button id="ptInsert" class="primary">${ic('plus')}큐시트에 넣기</button><span class="muted" id="ptWhere">${si >= 0 ? `'${esc(cueItems()[si].title)}' 순서 다음에 넣습니다` : '고른 순서 다음 (없으면 맨 끝)에 넣습니다'}</span></div>`;
    cards();
    box.oninput = e => {
      const t = e.target;
      if (t.dataset.f) data[t.dataset.f] = t.value;
      else if (t.dataset.p !== undefined) data.points[+t.dataset.p][t.dataset.k] = t.value;
      cards();
    };
    box.onchange = e => {
      const o = e.target.dataset.o;
      if (!o) return;
      opts[o] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      try { localStorage.setItem(OPTS, JSON.stringify(opts)); } catch { /* 무시 */ }
      if (o === 'numbering') draw(); else cards();
    };
    box.onclick = e => {
      const del = e.target.closest('[data-del]');
      if (del) { data.points.splice(+del.dataset.del, 1); draw(); return; }
      if (e.target.closest('[data-add]')) { if (data.points.length >= 6) return app.showMsg('대지는 6개까지입니다.', 'info'); data.points.push({ heading: '', body: '' }); draw(); const ins = box.querySelectorAll('[data-k="heading"]'); ins[ins.length - 1].focus(); return; }
      if (e.target.closest('#ptInsert')) insert();
    };
  }

  /** 지금 칸 값 + 위의 제목·본문·설교자 */
  const current = () => ({ ...data, title: $('#ptTitle').value.trim() || data.title, verse: $('#ptVerse').value.trim() || data.verse, speaker: $('#ptSpeaker').value.trim() || data.speaker, points: data.points.filter(p => p.heading.trim()) });

  /** 카드 미리보기 (송출 화면의 제목 카드처럼: 큰 글 + 작은 글) */
  function cards() {
    const d = current();
    const pages = [[d.title || '설교', [d.verse, d.speaker].filter(Boolean).join(' · ')]];
    if (opts.theme && d.theme.trim()) pages.push([d.theme, '오늘의 핵심']);
    d.points.forEach((p, i) => pages.push([`${label(i) ? label(i) + ' ' : ''}${p.heading}`, p.body]));
    if (opts.application && d.application.trim()) pages.push([d.application, '이번 주 적용']);
    $('#ptCards').innerHTML = pages.map(([a, b], k) => `<div class="pts-card"><i>${k + 1}</i><b>${esc(a)}</b>${b ? `<span>${esc(b)}</span>` : ''}</div>`).join('');
  }

  async function insert() {
    const d = current();
    if (!d.points.length) return app.showMsg('대지를 하나 이상 넣으세요.', 'info');
    if (!window.BCCue || !window.BCCue.currentId()) return app.showMsg('큐시트를 먼저 여세요 (큐시트 패널에서 고르거나 새로 만들기).', 'error');
    const r = await cmd('sermonPointsItem', { data: d, opts });
    if (!r.ok) return app.showMsg(r.error, 'error');
    // '설교' 순서가 있으면 그 다음에, 아니면 고른 순서 다음에
    const si = cueItems().findIndex(isSermon);
    if (si >= 0) window.BCCue.selectQuiet(si);
    window.BCCue.addItem('title', r.result.item);
    try { localStorage.removeItem(DRAFT); } catch { /* 무시 */ }
    app.closeModal();
    app.showMsg(`설교 포인트 ${r.result.item.note.replace(/\D+/g, '')}장을 큐시트에 넣었습니다. 미리보기로 확인하고 F9 로 송출하세요.`, 'ok', 3500);
  }

  window.BCPoints = { open };
})();
