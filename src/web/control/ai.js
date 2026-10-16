/* AI 주보 → 큐시트 (오픈라우터)
 * 주보 파일(hwp·hwpx·docx·pdf·사진·txt)이나 붙여 넣은 글 → AI 가 예배 순서를 읽어 큐시트로
 * 찬송가 번호는 찬송가 폴더의 PPT 로, 장절은 성경 DB 로 확인한다
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const cmd = (...a) => app.cmd(...a);
  let file = null;

  async function open() {
    const r = await cmd('aiSettings');
    const s = r.ok ? r.result : { hasKey: false, model: '', models: [] };
    file = null;
    app.openModal('🤖 주보로 큐시트 만들기 (AI)', `<div class="form ai-form">
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
    const { cue, warnings, usage, model } = r.result;
    $('#aiMsg').textContent = `완료 (${Math.round((Date.now() - t0) / 1000)}초${usage && usage.cost ? ` · 약 $${Number(usage.cost).toFixed(4)}` : ''} · ${model || ''})`;
    $('#aiResult').innerHTML = `<div class="ai-done"><b>✓ '${esc(cue.name)}' 큐시트를 만들었습니다 (${cue.items.length}개 순서)</b>
      <ol>${cue.items.map(it => `<li>${esc(it.title)}${it.subtitle ? ` <span class="muted">— ${esc(it.subtitle)}</span>` : ''}${it.ref ? ` <span class="muted">— ${esc(it.ref)}</span>` : ''}</li>`).join('')}</ol>
      ${warnings.length ? `<div class="warn-text">확인할 것: ${warnings.map(esc).join(' · ')}</div>` : ''}
      <div class="row-flex"><button id="aiOpen" class="primary">이 큐시트 열기</button></div>
      <div class="note">AI 가 만든 결과이니 송출 전에 순서·장절·찬송가를 한 번 확인하세요.</div></div>`;
    $('#aiOpen').onclick = () => { app.closeModal(); if (window.BCCue) window.BCCue.openCue(cue.id); };
    if (window.BCCue) window.BCCue.onCues({ id: cue.id });
  }

  window.BCAI = { open };
})();
