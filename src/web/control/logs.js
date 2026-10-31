/* 로그 묶음 저장 (도움말 → 로그 묶음 저장 · 연결 점검 창)
 * 버전 · 연결 점검 결과 · 출력 상태 · 설정(열쇠·PIN·AI 키는 가림) · 최근 7일 로그를 글 파일 하나로 받는다 (다운로드 폴더).
 * 문제를 알릴 때(도움말 → 문제 알리기) 이 파일을 붙이면 원인을 찾기 쉽다.
 */
(function () {
  'use strict';
  const app = window.BC;

  async function save() {
    const r = await app.cmd('logBundle', { days: 7, port: Number(location.port) || 37528, cueId: window.BCCue ? window.BCCue.currentId() : '' });
    if (!r.ok) { app.showMsg(r.error, 'error'); return null; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + r.result.text], { type: 'text/plain;charset=utf-8' }));
    a.download = r.result.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    app.showMsg(`'${r.result.name}' 을(를) 다운로드 폴더에 저장했습니다. 문제를 알릴 때 붙여 주세요 (열쇠·PIN·AI 키는 가렸습니다).`, 'info', 5000);
    return r.result;
  }

  window.BCLogs = { save };
})();
