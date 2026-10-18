'use strict';
// 자동 업데이트 (GitHub Releases)
//  - 윈도우 설치판: 켤 때(그리고 6시간마다) 조용히 확인·내려받기 → 프로그램을 끌 때 설치. 예배 중에 저절로 재시작하지 않는다.
//  - 포터블 · 맥 · 개발 실행: 스스로 바꿀 수 없으므로 새 버전이 있으면 알리기만 (받기 = 릴리스 페이지)
//  설정: autoUpdate (기본 켬). 상태는 core.update 에 두고 'update' 이벤트로 조작 화면에 알린다.
const { app, shell } = require('electron');
const https = require('https');

const REPO = 'hahadark/WorshipCue';
const PAGE = `https://github.com/${REPO}/releases/latest`;

function newer(a, b) { // a > b ?
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
}

function latestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': 'WorshipCue', Accept: 'application/vnd.github+json' }, timeout: 15000 }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => { try { const j = JSON.parse(body); if (!j.tag_name) throw new Error('no tag'); resolve(j); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

function setupUpdater(core) {
  const current = app.getVersion();
  // 설치판(NSIS)만 스스로 업데이트할 수 있다. 포터블은 electron-builder 가 PORTABLE_EXECUTABLE_DIR 을 준다
  const canInstall = app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR;
  const set = patch => { core.update = { current, mode: canInstall ? 'auto' : 'notify', page: PAGE, ...(core.update || {}), ...patch }; core.emit('update', core.update); };
  set({ state: 'idle' });
  const enabled = () => core.settings.get().autoUpdate !== false;

  let updater = null;
  if (canInstall) {
    try {
      updater = require('electron-updater').autoUpdater;
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = true; // 끌 때 조용히 설치
      updater.logger = { info: m => core.logger.info('업데이트: ' + m), warn: m => core.logger.warn('업데이트: ' + m), error: m => core.logger.error('업데이트: ' + m), debug: () => {} };
      updater.on('checking-for-update', () => set({ state: 'checking' }));
      updater.on('update-not-available', () => set({ state: 'latest', checkedAt: Date.now() }));
      updater.on('update-available', i => set({ state: 'downloading', version: i.version, checkedAt: Date.now() }));
      updater.on('download-progress', p => set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
      updater.on('update-downloaded', i => set({ state: 'ready', version: i.version }));
      updater.on('error', e => set({ state: 'error', error: String(e && e.message || e).slice(0, 200) }));
    } catch (e) { core.logger.warn('자동 업데이트를 쓸 수 없습니다: ' + e.message); updater = null; }
  }

  async function check({ manual = false } = {}) {
    if (!app.isPackaged && !manual) return core.update;
    if (!enabled() && !manual) return core.update;
    if (updater) { try { await updater.checkForUpdates(); } catch (e) { set({ state: 'error', error: e.message }); } return core.update; }
    // 알림만: GitHub 의 최신 릴리스 번호와 비교
    set({ state: 'checking' });
    try {
      const r = await latestRelease();
      set(newer(r.tag_name, current) ? { state: 'available', version: r.tag_name.replace(/^v/, ''), checkedAt: Date.now() } : { state: 'latest', checkedAt: Date.now() });
    } catch (e) { set({ state: 'error', error: e.message }); }
    return core.update;
  }

  // 조작 화면에서: 지금 확인 · 받기(릴리스 페이지) · 지금 다시 시작해서 설치
  core.updateActions = {
    check: () => check({ manual: true }),
    open: () => shell.openExternal(PAGE),
    installNow: () => { if (updater && core.update.state === 'ready') setImmediate(() => updater.quitAndInstall(true, true)); },
  };
  setTimeout(() => check(), 15000); // 켜고 조금 뒤 (시작을 늦추지 않게)
  setInterval(() => check(), 6 * 3600 * 1000).unref?.();
}

module.exports = { setupUpdater, newer };
