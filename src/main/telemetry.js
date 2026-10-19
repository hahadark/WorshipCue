'use strict';
// 익명 사용 통계: 몇 대에서 쓰는지 세려고 하루 한 번 작은 신호를 보낸다
//  - 보내는 것: 무작위 설치 번호 · 버전 · 화면 언어 · OS · 판(한국어/영어/개인용) · 설치 방식 — 이름·교회·성경·큐시트 내용은 보내지 않음
//  - 설정 → 정보 '익명 사용 통계 보내기' 로 끈다 (settings.telemetry = false)
//  - 개발 실행(npm start)에서는 보내지 않는다
const { app } = require('electron');
const crypto = require('crypto');

const URL = 'https://worshipcue-usage.hahadark-media.workers.dev/ping';

function buildInfo() {
  let pkg = {};
  try { pkg = require('../../package.json'); } catch { /* 없음 */ }
  const build = pkg.worshipcuePersonal ? 'personal' : pkg.worshipcueLang === 'en' ? 'en' : 'ko';
  const kind = process.platform === 'darwin' ? 'mac' : process.env.PORTABLE_EXECUTABLE_DIR ? 'portable' : process.platform === 'win32' ? 'installer' : process.platform;
  return { build, kind };
}

function setupTelemetry(core) {
  if (!app.isPackaged && !process.env.WC_TELEMETRY_DEV) return;
  const s0 = core.settings.get();
  if (!s0.telemetryId) core.settings.update(d => { d.telemetryId = crypto.randomBytes(12).toString('hex'); });
  let lastDay = '';
  const send = async () => {
    const s = core.settings.get();
    if (s.telemetry === false) return;
    const day = new Date().toISOString().slice(0, 10);
    if (day === lastDay || s.telemetryDay === day) { lastDay = day; return; }
    try {
      const r = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.telemetryId, v: app.getVersion(), lang: s.uiLang || 'ko', os: `${process.platform}-${process.arch}`, ...buildInfo() }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) { lastDay = day; core.settings.update(d => { d.telemetryDay = day; }); }
    } catch { /* 인터넷이 없으면 다음에 */ }
  };
  setTimeout(send, 60 * 1000); // 켜고 1분 뒤
  setInterval(send, 3 * 60 * 60 * 1000); // 켜 둔 채 날이 바뀌면
}

module.exports = { setupTelemetry };
