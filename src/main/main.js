'use strict';
// Electron 데스크톱 셸: 조작 창 + 예배당 전체 화면 창(Output Manager) + 전역 단축키

const path = require('path');
const { app, BrowserWindow, screen, globalShortcut, dialog, Menu, powerSaveBlocker, session, shell } = require('electron');
const { WorshipCueCore } = require('../core/core');
const { startServer } = require('../core/server');

const WEB_DIR = path.join(__dirname, '..', 'web');
const GLOBAL_ACTIONS = { prevSlide: 'previousSlide', nextSlide: 'nextSlide', sendPreview: null, toggleClear: 'toggleLive' };

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let core = null;
  let port = 0;
  let controlWin = null;
  let outputWin = null;
  let globalStatus = { available: true, enabled: false, registered: [], failed: [] };

  app.on('second-instance', () => {
    if (controlWin) { if (controlWin.isMinimized()) controlWin.restore(); controlWin.focus(); }
  });

  // ---------- 모니터 ----------
  function displayLabel(d, i) {
    const primary = d.id === screen.getPrimaryDisplay().id;
    return `디스플레이 ${i + 1} — ${d.size.width}×${d.size.height}${d.scaleFactor !== 1 ? ` (배율 ${Math.round(d.scaleFactor * 100)}%)` : ''}${primary ? ' · 주 모니터' : ''}${d.label ? ' · ' + d.label : ''}`;
  }
  function listDisplays() {
    return screen.getAllDisplays().map((d, i) => ({ id: d.id, label: displayLabel(d, i), bounds: d.bounds, primary: d.id === screen.getPrimaryDisplay().id }));
  }
  function findDisplay(id) {
    return screen.getAllDisplays().find(d => d.id === id) || null;
  }
  function defaultOutputDisplay() {
    const all = screen.getAllDisplays();
    const ctrl = controlWin ? screen.getDisplayMatching(controlWin.getBounds()) : screen.getPrimaryDisplay();
    return all.find(d => d.id !== ctrl.id) || null;
  }

  function status() {
    const s = core.settings.get().output;
    const d = s.displayId != null ? findDisplay(s.displayId) : null;
    const all = screen.getAllDisplays();
    const ctrl = controlWin ? screen.getDisplayMatching(controlWin.getBounds()) : null;
    return {
      enabled: s.enabled,
      displayId: s.displayId,
      valid: !!d,
      visible: !!(outputWin && !outputWin.isDestroyed() && outputWin.isVisible()),
      displayLabel: d ? displayLabel(d, all.findIndex(x => x.id === d.id)) : '',
      sameAsControl: !!(d && ctrl && d.id === ctrl.id),
    };
  }

  /** 출력 창을 설정에 맞게 만들고/옮기고/숨긴다. 유효하지 않은 모니터로는 절대 출력하지 않는다. */
  function syncOutputWindow() {
    const s = core.settings.get().output;
    const d = s.enabled && s.displayId != null ? findDisplay(s.displayId) : null;
    if (!d) {
      if (outputWin && !outputWin.isDestroyed()) outputWin.hide();
      core.emit('outputs');
      return;
    }
    if (!outputWin || outputWin.isDestroyed()) {
      outputWin = new BrowserWindow({
        x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
        frame: false, show: false, skipTaskbar: true, resizable: false, movable: false, minimizable: false,
        fullscreenable: true, backgroundColor: '#000000', title: 'WorshipCue 출력', focusable: false,
        webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
      });
      outputWin.setMenu(null);
      outputWin.loadURL(`http://127.0.0.1:${port}/outputs/main?window=1`);
      outputWin.on('closed', () => { outputWin = null; core.emit('outputs'); });
      outputWin.webContents.on('render-process-gone', () => {
        core.logger.error('출력 창 렌더러가 종료되어 다시 불러옵니다.');
        setTimeout(() => { if (outputWin && !outputWin.isDestroyed()) outputWin.reload(); }, 500);
      });
      outputWin.once('ready-to-show', () => placeOutput(d));
    } else {
      placeOutput(d);
    }
    core.emit('outputs');
  }

  function placeOutput(d) {
    if (!outputWin || outputWin.isDestroyed()) return;
    outputWin.setFullScreen(false);
    outputWin.setBounds(d.bounds);
    const ctrl = controlWin ? screen.getDisplayMatching(controlWin.getBounds()) : null;
    // 조작 화면과 다른 모니터일 때만 항상 위에 (조작 화면을 가리지 않도록)
    outputWin.setAlwaysOnTop(!(ctrl && ctrl.id === d.id), 'screen-saver');
    outputWin.showInactive();
    outputWin.setFullScreen(true);
    core.emit('outputs');
  }

  function setOutput({ enabled, displayId }) {
    core.settings.update(s => {
      if (typeof enabled === 'boolean') s.output.enabled = enabled;
      if (displayId != null && findDisplay(Number(displayId))) s.output.displayId = Number(displayId);
      if (s.output.enabled && s.output.displayId == null) {
        const d = defaultOutputDisplay();
        if (d) s.output.displayId = d.id;
      }
    });
    syncOutputWindow();
    return status();
  }

  // ---------- 전역 단축키 ----------
  function toAccelerator(combo) {
    return combo.split('+').map(k => ({ ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Ctrl: 'Control', Meta: 'Super' }[k] || k)).join('+');
  }
  function applyGlobalShortcuts() {
    globalShortcut.unregisterAll();
    const s = core.settings.get();
    globalStatus = { available: true, enabled: s.globalShortcuts, registered: [], failed: [] };
    if (!s.globalShortcuts) return;
    for (const action of Object.keys(GLOBAL_ACTIONS)) {
      const combo = s.shortcuts[action];
      if (!combo) continue;
      let ok = false;
      try {
        ok = globalShortcut.register(toAccelerator(combo), () => runGlobal(action));
      } catch { ok = false; }
      (ok ? globalStatus.registered : globalStatus.failed).push(action);
    }
    if (globalStatus.failed.length) core.logger.warn('전역 단축키 등록 실패: ' + globalStatus.failed.join(', '));
  }
  function runGlobal(action) {
    if (action === 'sendPreview') {
      const p = core.presentation.preview;
      if (p) core.command('sendLive', {});
      return;
    }
    core.command(GLOBAL_ACTIONS[action]);
  }

  // ---------- 시작 ----------
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    // 데이터 폴더: --data <폴더> 또는 BIBLECAST_DATA 로 바꿀 수 있다 (테스트·휴대용 실행)
    const argi = process.argv.indexOf('--data');
    const dataDir = argi > 0 ? path.resolve(process.argv[argi + 1]) : process.env.BIBLECAST_DATA || path.join(app.getPath('appData'), 'WorshipCue', 'data');
    try {
      // 기본 포함 성경 DB: 설치본은 resources/bible.db, 개발 실행은 data/bible.db
      const seedDb = app.isPackaged ? path.join(process.resourcesPath, 'bible.db') : path.join(__dirname, '..', '..', 'data', 'bible.db');
      core = new WorshipCueCore({ dataDir, seedDb });
    } catch (e) {
      dialog.showErrorBox('WorshipCue', '데이터를 열 수 없습니다: ' + e.message);
      app.exit(1);
      return;
    }
    // 설정한 포트가 사용 중이면 다음 포트로 시작하고 알린다 (OBS 주소가 달라지므로 경고)
    const wanted = core.settings.get().port;
    let lastErr = null;
    for (let p = wanted; p < wanted + 10 && !port; p++) {
      try {
        await startServer(core, { webDir: WEB_DIR, port: p });
        port = p;
      } catch (e) { lastErr = e; }
    }
    if (!port) {
      dialog.showErrorBox('WorshipCue', `로컬 서버를 시작할 수 없습니다 (포트 ${wanted}~${wanted + 9}).\n\n${lastErr && lastErr.message}`);
      app.exit(1);
      return;
    }
    core.activePort = port;
    if (port !== wanted) {
      core.logger.warn(`포트 ${wanted} 사용 중 → ${port} 사용`);
      core.portWarning = `설정한 포트 ${wanted}을(를) 다른 프로그램이 사용 중이어서 ${port} 포트로 실행했습니다. OBS 주소가 달라졌으니 설정 → 출력에서 확인하세요.`;
    }

    core.desktop = {
      listDisplays, status, setOutput,
      globalShortcutStatus: () => globalStatus,
      // 폴더 고르기 창 (찬송가 폴더 등)
      pickFolder: async title => {
        const r = await dialog.showOpenDialog(controlWin, { title, properties: ['openDirectory'] });
        return r.canceled || !r.filePaths.length ? '' : r.filePaths[0];
      },
      downloadsDir: app.getPath('downloads'),
      documentsDir: app.getPath('documents'),
      // 찬양 PPT 온라인 검색: 기본 브라우저로 연다 (http/https 만)
      openUrl: url => {
        if (!/^https?:\/\//i.test(url)) throw new Error('열 수 없는 주소입니다.');
        shell.openExternal(url);
        return true;
      },
      // 안내 페이지를 기본 브라우저로 연다 (허용한 주소만)
      openExternal: url => {
        if (!/^https:\/\/(www\.)?bethlehembible\.org\//.test(url)) throw new Error('열 수 없는 주소입니다.');
        shell.openExternal(url);
        return true;
      },
    };
    core.on('settings', what => { if (what === 'shortcuts' || what === 'settings') applyGlobalShortcuts(); });

    // 글꼴 목록(Local Font Access) 권한 허용
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'local-fonts' || permission === 'clipboard-sanitized-write'));
    session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'local-fonts' || permission === 'clipboard-sanitized-write');

    controlWin = new BrowserWindow({
      width: 1500, height: 920, minWidth: 1100, minHeight: 700, backgroundColor: '#14171c', title: 'WorshipCue',
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    controlWin.loadURL(`http://127.0.0.1:${port}/control/`);
    controlWin.once('ready-to-show', () => { controlWin.maximize(); controlWin.show(); });
    controlWin.webContents.on('render-process-gone', () => {
      core.logger.error('조작 화면 렌더러가 종료되어 다시 불러옵니다. (Live 출력은 유지됨)');
      setTimeout(() => controlWin && !controlWin.isDestroyed() && controlWin.reload(), 500);
    });
    // 외부 링크·새 창 차단
    controlWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    controlWin.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${port}/`)) e.preventDefault(); });
    // 송출 중에 닫으려 하면 한 번 확인한다 (예배 중 실수로 닫아 화면이 사라지는 것 방지)
    controlWin.on('close', e => {
      const live = core.presentation.getLiveState();
      if (live.hasLive && live.visible) {
        const r = dialog.showMessageBoxSync(controlWin, { type: 'warning', buttons: ['종료', '취소'], defaultId: 1, cancelId: 1, title: 'WorshipCue', message: '본문을 송출 중입니다. 종료하면 예배당 화면과 OBS 출력이 사라집니다. 종료할까요?' });
        if (r !== 0) e.preventDefault();
      }
    });
    // 조작 창이 닫히면 프로그램 전체(출력 창·로컬 서버 포함)를 종료한다
    controlWin.on('closed', () => {
      controlWin = null;
      if (outputWin && !outputWin.isDestroyed()) outputWin.destroy();
      app.quit();
      setTimeout(() => app.exit(0), 3000).unref(); // 종료가 지연되면 강제 종료
    });

    // 모니터 연결·해제·해상도 변경
    screen.on('display-removed', (e, d) => {
      if (core.settings.get().output.displayId === d.id) core.logger.warn('출력 모니터 연결 해제됨 — 출력 창을 숨깁니다.');
      syncOutputWindow();
    });
    screen.on('display-added', () => syncOutputWindow());
    screen.on('display-metrics-changed', () => syncOutputWindow());

    powerSaveBlocker.start('prevent-display-sleep');
    applyGlobalShortcuts();
    // 시작할 때는 보조 화면 출력을 항상 꺼 둔다 (선택한 모니터는 기억). 하단 [보조 화면] 버튼으로 켠다.
    core.settings.update(s => { s.output.enabled = false; });
    syncOutputWindow();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (core) { core.settings.saveNow(); core.logger.info('WorshipCue 종료'); core.store.close(); }
  });
  process.on('uncaughtException', e => { try { core && core.logger.error('예외: ' + (e && e.stack || e)); } catch { /* 무시 */ } });
  app.on('window-all-closed', () => app.quit());
}
