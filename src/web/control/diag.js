/* 연결 점검 (도움말 → 연결 점검 · 예배 전 점검)
 * 코어가 점검한 것(예배당 화면 · OBS · 내부망 · 리모컨 · 데이터 · 오늘 큐시트 · 동기화 · 저장 공간)에
 * 이 화면만 알 수 있는 카메라를 덧붙여, 항목마다 무엇이 문제인지와 고치는 순서를 보여 준다.
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = window.BC;
  const ic = n => (window.BCIcon ? window.BCIcon(n) : '');
  const MARK = { ok: ['check', '괜찮음'], warn: ['circle-help', '확인 필요'], fail: ['circle-x', '문제'], info: ['info', '참고'] };
  let last = null;

  /** 카메라: 이 화면(브라우저)에서만 알 수 있다 */
  async function cameraCheck() {
    const cams = (window.BCCue && window.BCCue.cueInfo && window.BCCue.cueInfo()) ? window.BCCue.cueInfo().items.filter(it => it.type === 'camera' && it.deviceId) : [];
    let devs = [];
    try { devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch { /* 무시 */ }
    if (!cams.length) return { id: 'camera', title: '카메라', status: 'info', detail: devs.length ? `카메라 ${devs.length}대가 보입니다 (큐시트에 카메라 순서는 없음).` : '큐시트에 카메라 순서가 없습니다.', fix: [] };
    const ids = new Set(devs.map(d => d.deviceId));
    const gone = cams.filter(c => !ids.has(c.deviceId));
    if (!gone.length) return { id: 'camera', title: '카메라', status: 'ok', detail: `큐시트의 카메라 ${cams.length}대 모두 연결됨`, fix: [] };
    return { id: 'camera', title: '카메라', status: 'fail', detail: `큐시트의 카메라 ${gone.length}대를 찾지 못했습니다: ${gone.map(c => c.label || c.title).join(', ')}`, fix: ['USB·캡처보드 연결을 확인하고 프로그램을 다시 시작해 보세요.', '다른 프로그램(OBS·줌)이 카메라를 쓰고 있으면 함께 못 쓸 수 있습니다.', '카메라를 바꿨다면 그 순서의 편집칸에서 \'바꾸기…\' 로 다시 고르세요.'] };
  }

  function row(x) {
    const [icon, word] = MARK[x.status] || MARK.info;
    return `<div class="dg-row dg-${x.status}"><span class="dg-ico" title="${esc(word)}">${ic(icon)}</span><div class="dg-body"><div class="dg-title"><b>${esc(x.title)}</b><span class="dg-word">${esc(word)}</span></div><div class="dg-detail">${esc(x.detail)}</div>${x.fix && x.fix.length ? `<ol class="dg-fix">${x.fix.map(f => `<li>${esc(f)}</li>`).join('')}</ol>` : ''}</div></div>`;
  }

  async function run() {
    $('#dgList').innerHTML = `<div class="muted">${ic('refresh-cw')} 점검하는 중…</div>`;
    const r = await app.cmd('diagnose', { port: Number(location.port) || 37528, cueId: window.BCCue ? window.BCCue.currentId() : '' });
    if (!r.ok) { $('#dgList').innerHTML = `<div class="dg-row dg-fail"><div class="dg-body">${esc(r.error)}</div></div>`; return; }
    const items = r.result.items.slice();
    try { items.splice(1, 0, await cameraCheck()); } catch { /* 무시 */ }
    last = { at: r.result.at, items };
    const order = { fail: 0, warn: 1, ok: 2, info: 3 };
    const sorted = items.slice().sort((a, b) => order[a.status] - order[b.status]);
    const fail = items.filter(x => x.status === 'fail').length, warn = items.filter(x => x.status === 'warn').length;
    $('#dgSum').className = 'dg-sum ' + (fail ? 'dg-fail' : warn ? 'dg-warn' : 'dg-ok');
    $('#dgSum').innerHTML = fail ? `${ic('circle-x')}문제 ${fail}개${warn ? ` · 확인 필요 ${warn}개` : ''} — 아래 순서대로 고쳐 보세요` : warn ? `${ic('circle-help')}확인 필요 ${warn}개 — 예배에는 대개 지장이 없지만 한 번 보세요` : `${ic('check')}모두 괜찮습니다`;
    $('#dgList').innerHTML = sorted.map(row).join('');
  }

  /** 문의할 때 붙여 넣을 글 */
  function asText() {
    if (!last) return '';
    const v = (app.state && app.state.version) || '';
    return [`워십프리젠터 연결 점검 ${v ? 'v' + v + ' ' : ''}(${new Date(last.at).toLocaleString()})`, ...last.items.map(x => `[${(MARK[x.status] || MARK.info)[1]}] ${x.title}: ${x.detail}${x.fix && x.fix.length ? '\n  - ' + x.fix.join('\n  - ') : ''}`)].join('\n');
  }

  function open() {
    app.openModal('연결 점검', `<div class="dg">
      <div class="note">예배 전에 한 번 눌러 보세요. 예배당 화면 · OBS · 내부망 출력 · 리모컨 · 카메라 · 성경·찬송가 데이터 · 오늘 큐시트의 파일과 장절을 차례로 확인하고, 문제가 있으면 고치는 순서를 알려 줍니다.</div>
      <div id="dgSum" class="dg-sum"></div>
      <div id="dgList" class="dg-list"></div>
      <div class="row-flex dg-go"><button id="dgRun" class="primary">${ic('refresh-cw')}다시 점검</button><button id="dgCopy" class="ghost" title="문의할 때 붙여 넣을 수 있게 점검 결과를 글로 복사">${ic('clipboard-copy')}결과 복사</button>${window.BCLogs ? `<button id="dgLogs" class="ghost" title="로그·설정·버전을 묶어 저장 (문제 알릴 때)">${ic('download')}로그 묶음 저장…</button>` : ''}</div>
    </div>`);
    $('#dgRun').onclick = run;
    $('#dgCopy').onclick = async () => { try { await navigator.clipboard.writeText(asText()); app.showMsg('점검 결과를 복사했습니다.', 'info', 2000); } catch (e) { app.showMsg('복사하지 못했습니다: ' + e.message, 'error'); } };
    if ($('#dgLogs')) $('#dgLogs').onclick = () => window.BCLogs.save();
    run();
  }

  window.BCDiag = { open, run, asText };
})();
