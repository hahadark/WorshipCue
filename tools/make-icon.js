'use strict';
// 앱 아이콘 만들기: build/icon.svg → build/icon.png (1024) · build/icon-256.png
//   npx electron tools/make-icon.js
// electron-builder 가 build/icon.png 로 윈도우 ico · 맥 icns 를 만든다 (package.json win.icon / mac.icon)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(ROOT, 'build', 'icon.svg'), 'utf8');

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  for (const size of [1024, 256]) {
    const w = new BrowserWindow({ width: size, height: size, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden"><style>svg{display:block}</style>${svg.replace(/width="1024" height="1024"/, `width="${size}" height="${size}"`)}</body></html>`));
    await new Promise(r => setTimeout(r, 400));
    const img = await w.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    const out = path.join(ROOT, 'build', size === 1024 ? 'icon.png' : `icon-${size}.png`);
    fs.writeFileSync(out, img.toPNG());
    console.log(out, img.getSize());
    w.destroy();
  }
  app.quit();
});
