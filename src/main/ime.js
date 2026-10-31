'use strict';
/**
 * 한글 입력 자동 전환 (윈도우): 가사·공지·즉석 자막 칸에 들어가면 입력기를 한글로.
 * 따로 네이티브 모듈 없이, 처음 쓸 때 PowerShell 도우미 하나를 띄워 두고 (C# 몇 줄을 한 번 컴파일)
 * 창의 기본 IME 창에 WM_IME_CONTROL(IMC_SETCONVERSIONMODE) 를 보낸다 — 다른 프로세스 창에도 되는 방식.
 * 도우미는 한 줄에 "hwnd mode" 를 받고 "ok <이전 모드>" / "err ..." 를 돌려준다.
 */
const { spawn } = require('child_process');

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class WpIme {
  [DllImport("imm32.dll")] public static extern IntPtr ImmGetDefaultIMEWnd(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  public static string Set(long hwnd, int mode) {
    IntPtr ime = ImmGetDefaultIMEWnd(new IntPtr(hwnd));
    if (ime == IntPtr.Zero) return "err no-ime-window";
    IntPtr before = SendMessage(ime, 0x283, new IntPtr(0x001), IntPtr.Zero); // IMC_GETCONVERSIONMODE
    SendMessage(ime, 0x283, new IntPtr(0x002), new IntPtr(mode));          // IMC_SETCONVERSIONMODE
    IntPtr after = SendMessage(ime, 0x283, new IntPtr(0x001), IntPtr.Zero);
    return "ok " + before.ToInt64() + " " + after.ToInt64();
  }
}
"@
[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = $line.Trim().Split(' ')
  try { [Console]::Out.WriteLine([WpIme]::Set([long]$p[0], [int]$p[1])) } catch { [Console]::Out.WriteLine('err ' + $_.Exception.Message) }
}
`;

class ImeHelper {
  constructor(logger) { this.logger = logger; this.proc = null; this.queue = []; this.buf = ''; this.ready = null; }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const enc = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64'); // 표준 입력은 명령 주고받기에 쓴다
      const p = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true });
      this.proc = p;
      let started = false;
      const t = setTimeout(() => { if (!started) reject(new Error('한글 입력 도우미가 시작되지 않았습니다.')); }, 20000);
      p.stdout.setEncoding('utf8');
      p.stdout.on('data', d => {
        this.buf += d;
        let i;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i).trim();
          this.buf = this.buf.slice(i + 1);
          if (!started) { if (line === 'ready') { started = true; clearTimeout(t); resolve(); } continue; }
          const q = this.queue.shift();
          if (q) q(line);
        }
      });
      p.on('error', e => { clearTimeout(t); reject(e); });
      p.on('exit', () => { this.proc = null; this.ready = null; for (const q of this.queue.splice(0)) q('err exited'); });
    });
    this.ready.catch(e => { this.logger && this.logger.warn('한글 입력 도우미: ' + e.message); this.ready = null; });
    return this.ready;
  }

  /** hwnd(숫자 문자열) 의 입력기를 mode 로: 1 = 한글(NATIVE), 0 = 영문 */
  async set(hwnd, mode = 1) {
    if (process.platform !== 'win32') return 'skip';
    await this.start();
    return new Promise(resolve => {
      const t = setTimeout(() => resolve('err timeout'), 5000);
      this.queue.push(line => { clearTimeout(t); resolve(line); });
      this.proc.stdin.write(`${hwnd} ${mode}\n`);
    });
  }

  stop() { if (this.proc) { try { this.proc.stdin.end(); this.proc.kill(); } catch { /* 무시 */ } this.proc = null; this.ready = null; } }
}

/** BrowserWindow → hwnd 숫자 문자열 */
function hwndOf(win) {
  const b = win.getNativeWindowHandle();
  return b.length >= 8 ? b.readBigUInt64LE(0).toString() : String(b.readUInt32LE(0));
}

module.exports = { ImeHelper, hwndOf, PS_SCRIPT };
