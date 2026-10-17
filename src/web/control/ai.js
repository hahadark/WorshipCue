/* AI 주보 → 큐시트
 * - 'API 키로': 주보 파일(hwp·hwpx·docx·pdf·사진·txt)이나 붙여 넣은 글 → 오픈라우터 AI 가 예배 순서를 읽어 큐시트로
 * - '채팅 AI로 (키 없이)': 프롬프트·샘플 파일을 주고, ChatGPT·Claude·Gemini 등에서 만든 답(또는 파일)을 불러온다
 * 어느 쪽이든 찬송가 번호는 찬송가 폴더의 PPT 로, 장절은 성경 DB 로 확인한다
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const cmd = (...a) => app.cmd(...a);
  let file = null;
  let mode = '';
  try { mode = localStorage.getItem('wc-ai-mode') || ''; } catch { /* 무시 */ }

  /** 채팅 AI 바로 가기 */
  const CHATS = [['ChatGPT', 'https://chatgpt.com/'], ['Claude', 'https://claude.ai/new'], ['Gemini', 'https://gemini.google.com/app']];

  async function open(want) {
    const r = await cmd('aiSettings');
    const s = r.ok ? r.result : { hasKey: false, model: '', models: [] };
    file = null;
    if (want) mode = want;
    if (!mode) mode = s.hasKey ? 'api' : 'chat'; // 처음: 키가 없으면 채팅 AI 부터
    const tabs = `<div class="ai-tabs view-tabs"><button data-mode="api" class="${mode === 'api' ? 'on' : ''}">🔑 API 키로 (자동)</button><button data-mode="chat" class="${mode === 'chat' ? 'on' : ''}">💬 채팅 AI로 (키 없이)</button></div>`;
    if (mode === 'chat') return openChat(tabs);
    app.openModal('🤖 주보로 큐시트 만들기 (AI)', tabs + `<div class="form ai-form">
      <label>오픈라우터 키</label><div class="row-flex"><input type="password" id="aiKey" placeholder="${s.hasKey ? '저장됨 — 바꿀 때만 입력' : 'sk-or-… (openrouter.ai 에서 발급)'}" style="flex:1" autocomplete="off"><button id="aiKeySave">저장</button>${s.hasKey ? '<button id="aiKeyDel" title="저장한 키 지우기">지우기</button>' : ''}<button id="aiKeyGet" title="오픈라우터 키 발급 페이지 열기">키 발급…</button></div>
      <span></span><div class="note">${s.hasKey ? (s.encrypted ? '✓ 키가 저장되어 있습니다 (Windows 보호 기능으로 암호화).' : '✓ 키가 저장되어 있습니다.') : '키는 이 PC 에만 저장되고, 주보를 보낼 때만 오픈라우터로 전송됩니다.'}</div>
      <label>AI 모델</label><div class="row-flex"><select id="aiModel" style="flex:1">${s.models.map(m => `<option value="${esc(m.id)}" ${m.id === s.model ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}${s.models.some(m => m.id === s.model) ? '' : `<option value="${esc(s.model)}" selected>${esc(s.model)}</option>`}<option value="__custom">직접 입력…</option></select></div>
      <h4>주보</h4>
      <label>파일</label><div class="row-flex"><button id="aiPick" class="primary">📄 주보 파일 고르기…</button><span id="aiFile" class="muted">hwp · hwpx · docx · pdf · 사진(jpg·png) · txt</span></div>
      <label>또는 글</label><textarea id="aiText" rows="6" placeholder="주보의 예배 순서 부분을 붙여 넣어도 됩니다"></textarea>
      <label>추가 요청</label><input type="text" id="aiExtra" placeholder="예: 오후 예배 순서로 · 찬양팀 곡은 '은혜 아니면' · 광고는 3장으로">
      <span></span><div class="row-flex"><button id="aiGo" class="primary">🤖 큐시트 만들기</button><span id="aiMsg" class="muted"></span></div>
      <span></span><div id="aiResult"></div>
    </div>`);
    $('#aiKeySave').onclick = async () => {
      const k = $('#aiKey').value.trim();
      if (!k) return app.showMsg('키를 입력하세요.', 'info');
      const r = await cmd('setAi', { apiKey: k });
      if (r.ok) { app.showMsg('오픈라우터 키를 저장했습니다.', 'ok', 1500); open(); }
    };
    if ($('#aiKeyDel')) $('#aiKeyDel').onclick = async () => { await cmd('setAi', { apiKey: '' }); open(); };
    $('#aiKeyGet').onclick = () => cmd('openLink', { url: 'https://openrouter.ai/settings/keys' });
    $('#aiModel').onchange = async e => {
      let m = e.target.value;
      if (m === '__custom') { m = prompt('오픈라우터 모델 이름 (예: anthropic/claude-haiku-5.5)', '') || ''; if (!m) { e.target.value = s.model; return; } }
      await cmd('setAi', { model: m });
      app.showMsg('AI 모델을 바꿨습니다.', 'ok', 1200);
    };
    $('#aiPick').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.hwp,.hwpx,.docx,.pdf,.txt,.png,.jpg,.jpeg,.webp';
      inp.onchange = () => { file = inp.files[0] || null; $('#aiFile').textContent = file ? `${file.name} (${Math.round(file.size / 1024)}KB)` : ''; };
      inp.click();
    };
    $('#aiGo').onclick = run;
    bindTabs();
  }

  function bindTabs() {
    document.querySelectorAll('.ai-tabs [data-mode]').forEach(b => b.onclick = () => {
      mode = b.dataset.mode;
      try { localStorage.setItem('wc-ai-mode', mode); } catch { /* 무시 */ }
      open();
    });
  }

  // ---------------- 채팅 AI (키 없이) ----------------
  async function openChat(tabs) {
    app.openModal('🤖 주보로 큐시트 만들기 (AI)', tabs + `<div class="ai-chat ai-form">
      <div class="note">API 키 없이, 이미 쓰는 채팅 AI(ChatGPT · Claude · Gemini 등)로 만듭니다. 아래 순서대로 하세요.</div>
      <div class="ai-step"><b class="ai-no">1</b><div>
        <div class="ai-st">프롬프트와 샘플 파일 준비</div>
        <div class="row-flex"><input type="text" id="acExtra" placeholder="추가 요청 (선택) — 예: 오후 예배 순서로 · 광고는 3장으로" style="flex:1"></div>
        <div class="row-flex"><button id="acCopy" class="primary">📋 프롬프트 복사</button><button id="acSample">💾 샘플 파일 저장</button><span id="acMsg1" class="muted"></span></div>
      </div></div>
      <div class="ai-step"><b class="ai-no">2</b><div>
        <div class="ai-st">채팅 AI 에 주보와 샘플 파일을 올리고, 프롬프트를 붙여 넣기 (Ctrl+V)</div>
        <div class="row-flex">${CHATS.map(([n, u]) => `<button data-chat="${esc(u)}">${esc(n)} 열기</button>`).join('')}</div>
        <div class="note">주보는 <b>PDF 나 사진(캡처)</b> 으로 올리세요. hwp 는 채팅 AI 가 잘 못 읽습니다 (한글에서 'PDF로 저장'). 샘플 파일을 못 올려도 프롬프트에 형식이 들어 있어 됩니다.</div>
      </div></div>
      <div class="ai-step"><b class="ai-no">3</b><div>
        <div class="ai-st">AI 의 답을 붙여 넣거나, AI 가 만든 파일을 불러오기</div>
        <textarea id="acAnswer" rows="8" placeholder="AI 의 답을 통째로 붙여 넣으세요 (설명이나 json 코드 블록이 섞여 있어도 됩니다)"></textarea>
        <div class="row-flex"><button id="acGo" class="primary">✓ 큐시트 만들기</button><button id="acFile">📂 결과 파일 불러오기…</button><span id="acMsg" class="muted">결과 파일(.json · .txt)을 이 창에 끌어다 놓아도 됩니다</span></div>
      </div></div>
      <div id="aiResult"></div>
    </div>`);
    bindTabs();
    const prompt = async () => { const r = await cmd('chatAiPrompt', { extra: $('#acExtra').value.trim() }); if (!r.ok) throw new Error(r.error); return r.result; };
    $('#acCopy').onclick = async () => {
      try {
        const pr = await prompt();
        await navigator.clipboard.writeText(pr.prompt);
        $('#acMsg1').textContent = '✓ 복사했습니다 — 채팅 AI 에 붙여 넣으세요';
        app.showMsg('프롬프트를 복사했습니다.', 'ok', 1500);
      } catch (e) { app.showMsg('복사하지 못했습니다: ' + e.message, 'error'); }
    };
    $('#acSample').onclick = async () => {
      const pr = await prompt();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([pr.sample], { type: 'application/json' }));
      a.download = pr.sampleName;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      $('#acMsg1').textContent = `'${pr.sampleName}' 저장 — 채팅 AI 에 주보와 함께 올리세요`;
    };
    document.querySelectorAll('.ai-chat [data-chat]').forEach(b => b.onclick = () => cmd('openLink', { url: b.dataset.chat }));
    $('#acFile').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json,.txt,.md';
      inp.onchange = () => inp.files[0] && loadAnswerFile(inp.files[0]);
      inp.click();
    };
    $('#acGo').onclick = importAnswer;
  }

  async function loadAnswerFile(f) {
    if (f.size > 2000000) return app.showMsg('파일이 너무 큽니다.', 'error');
    $('#acAnswer').value = await f.text();
    $('#acMsg').textContent = `📂 ${f.name} 을(를) 불러왔습니다`;
    importAnswer();
  }

  async function importAnswer() {
    const text = $('#acAnswer').value;
    if (!text.trim()) return app.showMsg('AI 의 답을 붙여 넣거나 결과 파일을 불러오세요.', 'info');
    const r = await cmd('chatAiImport', { text });
    if (!r.ok) { $('#acMsg').innerHTML = `<span class="err-text">${esc(r.error)}</span>`; return; }
    $('#acMsg').textContent = '';
    showResult(r.result);
  }

  async function run() {
    const text = $('#aiText').value.trim();
    const extra = $('#aiExtra').value.trim();
    if (!file && !text) return app.showMsg('주보 파일을 고르거나 글을 붙여 넣으세요.', 'info');
    $('#aiGo').disabled = true;
    const t0 = Date.now();
    const tick = setInterval(() => { $('#aiMsg').textContent = `AI 가 주보를 읽는 중… ${Math.round((Date.now() - t0) / 1000)}초`; }, 500);
    let r;
    try {
      if (file) {
        r = await fetch('/api/bulletin', { method: 'POST', headers: { 'X-WorshipCue': '1', 'X-Filename': encodeURIComponent(file.name), 'X-Extra': encodeURIComponent(extra), 'Content-Type': 'application/octet-stream' }, body: file }).then(x => x.json());
      } else r = await cmd('aiMakeCue', { text, extra });
    } catch (e) { r = { ok: false, error: e.message }; }
    clearInterval(tick);
    if (!$('#aiGo')) return; // 창을 닫음
    $('#aiGo').disabled = false;
    if (!r.ok) { $('#aiMsg').innerHTML = `<span class="err-text">${esc(r.error)}</span>`; return; }
    const { usage, model } = r.result;
    $('#aiMsg').textContent = `완료 (${Math.round((Date.now() - t0) / 1000)}초${usage && usage.cost ? ` · 약 ${Number(usage.cost).toFixed(4)}` : ''} · ${model || ''})`;
    showResult(r.result);
  }

  function showResult({ cue, warnings }) {
    $('#aiResult').innerHTML = `<div class="ai-done"><b>✓ '${esc(cue.name)}' 큐시트를 만들었습니다 (${cue.items.length}개 순서)</b>
      <ol>${cue.items.map(it => `<li>${esc(it.title)}${it.subtitle ? ` <span class="muted">— ${esc(it.subtitle)}</span>` : ''}${it.ref ? ` <span class="muted">— ${esc(it.ref)}</span>` : ''}</li>`).join('')}</ol>
      ${warnings.length ? `<div class="warn-text">확인할 것: ${warnings.map(esc).join(' · ')}</div>` : ''}
      <div class="row-flex"><button id="aiOpen" class="primary">이 큐시트 열기</button></div>
      <div class="note">AI 가 만든 결과이니 송출 전에 순서·장절·찬송가를 한 번 확인하세요.</div></div>`;
    $('#aiOpen').onclick = () => { app.closeModal(); if (window.BCCue) window.BCCue.openCue(cue.id); };
    if (window.BCCue) window.BCCue.onCues({ id: cue.id });
  }

  /** 끌어다 놓은 파일: 채팅 AI 쪽이면 결과 파일, 아니면 주보 파일 */
  function setFile(f) {
    if (!f) return;
    if (document.querySelector('#acAnswer')) {
      if (!/\.(json|txt|md)$/i.test(f.name)) return app.showMsg('채팅 AI 가 만든 결과 파일(.json · .txt)을 놓으세요. 주보는 채팅 AI 에 올립니다.', 'info', 3500);
      loadAnswerFile(f);
      return;
    }
    if (!document.querySelector('#aiFile')) return;
    file = f;
    document.querySelector('#aiFile').textContent = `${f.name} (${Math.round(f.size / 1024)}KB)`;
  }
  window.BCAI = { open, setFile };
})();
