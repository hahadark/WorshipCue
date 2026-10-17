/* 휴대폰 리모컨: PIN 으로 연결 → 1초마다 상태를 받아 보여 주고, 단추로 조작 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let pin = '';
  try { pin = sessionStorage.getItem('wc-pin') || ''; } catch { /* 저장 안 됨 */ }
  let timer = null;
  let lastCue = '';

  function showLogin(err) {
    clearInterval(timer);
    $('login').hidden = false; $('main').hidden = true; $('bar').hidden = true;
    $('loginErr').textContent = err || '';
    $('pin').focus();
  }

  async function poll() {
    let r;
    try { r = await fetch('/r/state?pin=' + encodeURIComponent(pin)).then(x => x.json()); } catch { $('title').textContent = '연결 끊김 — 같은 Wi-Fi 인지 확인하세요'; return; }
    if (!r.ok) { try { sessionStorage.removeItem('wc-pin'); } catch { /* 무시 */ } return showLogin(r.error); }
    $('login').hidden = true; $('main').hidden = false; $('bar').hidden = false;
    const L = r.live;
    $('badge').textContent = !L.has ? '송출 없음' : L.visible ? 'LIVE' : '숨김 중';
    $('badge').className = 'badge' + (L.has && L.visible ? '' : ' off');
    $('count').textContent = L.has ? `${L.index + 1} / ${L.count}` : '';
    $('title').textContent = L.title || '송출 중인 화면 없음';
    $('text').textContent = L.text || '';
    $('next').textContent = L.next ? '다음: ' + L.next : '';
    $('xHide').textContent = L.visible ? '숨김' : '보이기';
    $('noctl').hidden = r.control;
    // 이름표(1절·후렴…) 바로 가기
    const groups = [];
    L.labels.forEach((l, i) => { const k = l.replace(/-\d+$/, ''); if (k && !/^\d+$/.test(k) && (i === 0 || L.labels[i - 1].replace(/-\d+$/, '') !== k)) groups.push({ k, i }); });
    const gc = k => (window.BCGroup ? window.BCGroup.color(k) : '');
    $('labels').innerHTML = groups.map(g => `<button data-goto="${g.i}" class="${L.index >= g.i && (groups.find(x => x.i > g.i)?.i ?? 1e9) > L.index ? 'on' : ''}" style="${gc(g.k) ? `border-left:5px solid ${gc(g.k)}` : ''}">${esc(g.k)}</button>`).join('');
    // 큐시트
    const cueKey = JSON.stringify([r.cue, L.cueIndex]);
    if (cueKey !== lastCue) {
      lastCue = cueKey;
      $('cueName').textContent = r.cue ? r.cue.name : '(열린 큐시트 없음)';
      $('cue').innerHTML = r.cue ? r.cue.items.map((it, i) => `<button data-cue="${i}" class="${i === L.cueIndex ? 'on' : ''}"><span class="n">${i + 1}</span><span>${esc(it.title)}</span></button>`).join('') : '';
    }
  }

  async function act(body) {
    const r = await fetch('/r/do', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, ...body }) }).then(x => x.json()).catch(() => ({ ok: false, error: '연결 끊김' }));
    if (!r.ok) alert(r.error);
    setTimeout(poll, 150);
  }

  function start() {
    try { sessionStorage.setItem('wc-pin', pin); } catch { /* 무시 */ }
    clearInterval(timer);
    poll();
    timer = setInterval(poll, 1000);
  }

  $('go').onclick = () => { pin = $('pin').value.trim(); start(); };
  $('pin').onkeydown = e => { if (e.key === 'Enter') $('go').onclick(); };
  $('bNext').onclick = $('xNext').onclick = () => act({ action: 'next' });
  $('bPrev').onclick = $('xPrev').onclick = () => act({ action: 'prev' });
  $('xHide').onclick = () => act({ action: 'toggle' });
  $('labels').onclick = e => { const b = e.target.closest('[data-goto]'); if (b) act({ action: 'goto', index: +b.dataset.goto }); };
  $('cue').onclick = e => { const b = e.target.closest('[data-cue]'); if (b) act({ action: 'cue', index: +b.dataset.cue }); };
  $('msgSend').onclick = () => act({ action: 'message', text: $('msg').value });
  $('msgClear').onclick = () => { $('msg').value = ''; act({ action: 'message', text: '' }); };
  document.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => { $('msg').value = b.dataset.msg; act({ action: 'message', text: b.dataset.msg }); });
  document.querySelectorAll('[data-tm]').forEach(b => b.onclick = () => act({ action: 'timer', op: 'start', minutes: +b.dataset.tm }));
  document.querySelectorAll('[data-op]').forEach(b => b.onclick = () => act({ action: 'timer', op: b.dataset.op }));

  if (pin) start(); else showLogin();
})();
