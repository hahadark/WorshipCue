'use strict';
// 실제 프로그램을 띄워서 화면까지 점검 (npm run test:e2e)
//   1) 임시 데이터 폴더(공개 성경 DB 만)에 WorshipCue 를 띄운다
//   2) 또 하나의 Electron 으로 smoke.js 를 돌려 조작 화면을 숨은 창에 띄우고 점검한다
//   3) 결과 JSON (tests/e2e/out/smoke.json) · 실패가 있으면 종료 코드 1
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const electron = require('electron'); // node 에서 require 하면 실행 파일 경로

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
const PORT = 37590;
const wait = ms => new Promise(r => setTimeout(r, ms));

function get(url) {
  return new Promise((resolve, reject) => { http.get(url, res => { res.resume(); resolve(res.statusCode); }).on('error', reject); });
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-e2e-'));
  fs.copyFileSync(path.join(ROOT, 'data', 'bible.db'), path.join(dir, 'bible.db'));
  const settings = { port: PORT, output: { autoOnSend: false, enabled: false }, previewMode: true, remote: { enabled: false, pin: '482916', port: 37591, host: '127.0.0.1' }, telemetry: false };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings));
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const env = { ...process.env, ELECTRON_ENABLE_LOGGING: '', WC_E2E: '1' };
  const app = spawn(electron, ['.', '--data', dir], { cwd: ROOT, env, stdio: 'ignore' });
  let port = 0;
  for (let i = 0; i < 60 && !port; i++) {
    await wait(500);
    for (let p = PORT; p < PORT + 10 && !port; p++) {
      try { if ((await get(`http://127.0.0.1:${p}/control/`)) < 500) port = p; } catch { /* 아직 */ }
    }
    if (app.exitCode !== null) break;
  }
  if (!port) { app.kill(); throw new Error('WorshipCue 가 뜨지 않았습니다.'); }
  console.log(`WorshipCue: 127.0.0.1:${port} (데이터 ${dir})`);

  const t = spawn(electron, [path.join(__dirname, 'smoke.js'), String(port), OUT], { cwd: ROOT, env, stdio: ['ignore', 'inherit', 'inherit'] });
  const code = await new Promise(r => { const k = setTimeout(() => { t.kill(); r(-1); }, 180000); t.on('exit', c => { clearTimeout(k); r(c); }); });
  app.kill();
  await wait(500);
  fs.rmSync(dir, { recursive: true, force: true });
  const file = path.join(OUT, 'smoke.json');
  const R = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { fails: ['결과 파일 없음 (점검이 끝나지 않음)'] };
  for (const l of R.log || []) console.log('  ' + l);
  if (R.fails && R.fails.length) { console.error(`\n실패 ${R.fails.length}개:\n` + R.fails.map(f => ' ✖ ' + f).join('\n')); process.exit(1); }
  if (code !== 0) { console.error(`점검 프로그램 종료 코드 ${code}`); process.exit(1); }
  console.log(`\n모두 통과 (${(R.log || []).length}개 점검)`);
}

main().catch(e => { console.error(e); process.exit(1); });
