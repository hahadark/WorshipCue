'use strict';
// 오류·송출 이벤트 로그 (개인정보는 기록하지 않음). 일자별 파일, 30일 보관.

const fs = require('fs');
const path = require('path');

class Logger {
  constructor(dir, { echo = false } = {}) {
    this.dir = dir;
    this.echo = echo;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const cutoff = Date.now() - 30 * 86400e3;
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (f.endsWith('.log') && fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      }
    } catch { /* 로그 폴더 문제로 프로그램이 멈추면 안 된다 */ }
  }

  write(level, msg) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const line = `${day} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} [${level}] ${msg}\n`;
    if (this.echo) process.stdout.write(line);
    try { fs.appendFileSync(path.join(this.dir, `${day}.log`), line); } catch { /* 무시 */ }
  }

  info(m) { this.write('INFO', m); }
  warn(m) { this.write('WARN', m); }
  error(m) { this.write('ERROR', m); }
  event(m) { this.write('LIVE', m); }
}

module.exports = { Logger };
