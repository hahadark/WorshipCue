'use strict';
// Electron 없이 핵심 기능(로컬 서버·검색·송출)만 실행한다.
// 조작 화면은 브라우저에서 http://127.0.0.1:37528/control/ 로 연다.
//   node src/headless.js [--data <폴더>] [--port <포트>]
const path = require('path');
const os = require('os');
const { WorshipCueCore } = require('./core/core');
const { startServer } = require('./core/server');

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const dataDir = arg('--data') || path.join(process.env.APPDATA || os.homedir(), 'WorshipCue', 'data');
const core = new WorshipCueCore({ dataDir, logEcho: true, seedDb: path.join(__dirname, '..', 'data', 'bible.db') });
const port = Number(arg('--port')) || core.settings.get().port;
startServer(core, { webDir: path.join(__dirname, 'web'), port }).then(({ port }) => {
  console.log(`WorshipCue 실행 중: http://127.0.0.1:${port}/control/`);
}).catch(e => { console.error('서버 시작 실패:', e.message); process.exit(1); });
process.on('SIGINT', () => { core.settings.saveNow(); core.store.close(); process.exit(0); });
