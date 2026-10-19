'use strict';
// 휴대폰 리모컨: 같은 Wi-Fi 의 휴대폰·태블릿 브라우저에서 다음·이전·숨김·순서 송출·무대 메시지
// - 조작 서버(127.0.0.1 전용)와 따로, 켰을 때만 이 PC 의 네트워크 주소로 작은 서버를 연다
// - 모든 요청은 PIN 이 맞아야 하고, 틀리면 잠시 막는다 (리모컨 기능만 쓸 수 있음)

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_PORT = 37540;

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !/^169\.254\./.test(a.address)) out.push({ name, address: a.address });
    }
  }
  return out;
}

function newPin() { return String(crypto.randomInt(100000, 1000000)); }

class RemoteServer {
  constructor(core, webDir) {
    this.core = core;
    this.webDir = webDir;
    this.server = null;
    this.port = 0;
    this.fails = new Map(); // ip → { n, until }
    this.error = '';
  }

  status() {
    const r = this.core.settings.get().remote || {};
    return {
      enabled: !!r.enabled, pin: r.pin || '', port: this.port || r.port || DEFAULT_PORT, running: !!this.server, error: this.error,
      urls: this.server ? lanAddresses().map(a => `http://${a.address}:${this.port}/`) : [],
    };
  }

  /** 설정에 맞춰 켜고 끈다 */
  async sync() {
    const r = this.core.settings.get().remote || {};
    if (r.enabled && !this.server) await this.start(r.port || DEFAULT_PORT, r.host || '0.0.0.0');
    if (!r.enabled && this.server) this.stop();
  }

  /** host: 기본 0.0.0.0 (같은 네트워크의 휴대폰에서 접속). 시험할 때는 127.0.0.1 */
  start(port, host = '0.0.0.0') {
    return new Promise(resolve => {
      const srv = http.createServer((req, res) => this.handle(req, res));
      srv.once('error', e => { this.error = e.code === 'EADDRINUSE' ? `포트 ${port} 를 다른 프로그램이 쓰고 있습니다.` : e.message; this.server = null; this.core.emit('remote'); resolve(false); });
      srv.listen(port, host, () => {
        this.server = srv; this.port = port; this.error = '';
        this.core.logger && this.core.logger.info(`휴대폰 리모컨 서버 시작: ${port}`);
        this.core.emit('remote');
        resolve(true);
      });
    });
  }

  stop() {
    if (this.server) { this.server.close(); this.server.closeAllConnections?.(); }
    this.server = null;
    this.core.emit('remote');
  }

  json(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  /** PIN 확인 (틀리면 5번마다 30초 막기) */
  checkPin(req, pin) {
    const ip = req.socket.remoteAddress || '';
    const f = this.fails.get(ip) || { n: 0, until: 0 };
    if (f.until > Date.now()) return { ok: false, status: 429, error: '잠시 후 다시 시도하세요 (PIN 을 여러 번 틀렸습니다).' };
    const want = (this.core.settings.get().remote || {}).pin || '';
    const a = Buffer.from(String(pin || '')), b = Buffer.from(want);
    if (want && a.length === b.length && crypto.timingSafeEqual(a, b)) { this.fails.delete(ip); return { ok: true }; }
    f.n++;
    if (f.n % 5 === 0) f.until = Date.now() + 30000;
    this.fails.set(ip, f);
    return { ok: false, status: 401, error: 'PIN 이 맞지 않습니다.' };
  }

  stateFor() {
    const core = this.core;
    const live = core.presentation.getLiveState();
    const s = core.settings.get();
    const cue = s.activeCueId ? core.store.getCue(s.activeCueId) : null;
    const text = sl => {
      if (!sl) return '';
      if (sl.kind === 'title') return [sl.ref, sl.subtitle].filter(Boolean).join(' · ');
      if (sl.kind === 'video') return '🎬 영상';
      if (sl.kind === 'image' || sl.kind === 'score') return sl.caption || (sl.kind === 'score' ? '🎼 악보' : '🖼 이미지');
      if (sl.kind === 'blank') return '(빈 화면)';
      return (sl.parts || []).map(p => p.text).join(' ').replace(/\*\*|\{색:#[0-9a-fA-F]{3,8}\}|\{\/색\}|\{크기:\d{2,3}\}|\{\/크기\}/g, '').replace(/\[([A-G](?:#|b|♯|♭)?(?:maj|min|m|M|sus|dim|aug|add|°|ø)?\d{0,2}(?:(?:sus|add|maj|b|#|\+|-)\d{1,2})*(?:\/[A-G](?:#|b|♯|♭)?)?)\]/g, '').replace(/\s{2,}/g, ' ').slice(0, 200);
    };
    return {
      live: {
        has: live.hasLive, visible: live.visible, index: live.index, count: live.count,
        title: live.passage ? (live.passage.cueIndex >= 0 && live.passage.itemTitle ? live.passage.itemTitle : live.passage.title) : '',
        text: text(live.slide), next: text(live.nextSlide),
        // 글 없는 그림·악보 슬라이드: 도킹(이 PC)에서 그림으로 보여 준다
        image: live.slide && (live.slide.kind === 'image' || live.slide.kind === 'score') && live.slide.image ? live.slide.image : '',
        labels: live.slides.map(x => (x.startsWith('¶') ? x.slice(1) : '')),
        cueIndex: live.passage ? live.passage.cueIndex : -1,
      },
      cue: cue ? { name: cue.name, items: cue.items.map(it => ({ title: it.title, type: it.type })) } : null,
      control: [...core.outputClients.values()].some(c => c.client === 'control'),
      stage: { message: core.stage.message },
      obs: core.obsView(),
    };
  }

  handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return this.file(res, 'index.html', 'text/html; charset=utf-8');
    if (req.method === 'GET' && p === '/remote.js') return this.file(res, 'remote.js', 'text/javascript; charset=utf-8');
    if (req.method === 'GET' && p === '/groups.js') return this.file(res, '../shared/groups.js', 'text/javascript; charset=utf-8');
    if (req.method === 'GET' && (p === '/i18n.js' || p === '/i18n-en.js')) return this.file(res, '../shared' + p, 'text/javascript; charset=utf-8');
    if (req.method === 'GET' && p === '/r/state') {
      const c = this.checkPin(req, url.searchParams.get('pin'));
      if (!c.ok) return this.json(res, c.status, { ok: false, error: c.error });
      return this.json(res, 200, { ok: true, ...this.stateFor() });
    }
    if (req.method === 'POST' && p === '/r/do') {
      let body = '';
      req.on('data', ch => { body += ch; if (body.length > 4000) req.destroy(); });
      req.on('end', () => {
        let a = {};
        try { a = JSON.parse(body || '{}'); } catch { return this.json(res, 400, { ok: false, error: '잘못된 요청' }); }
        const c = this.checkPin(req, a.pin);
        if (!c.ok) return this.json(res, c.status, { ok: false, error: c.error });
        try { this.json(res, 200, { ok: true, result: this.act(a) }); } catch (e) { this.json(res, 200, { ok: false, error: e.message }); }
      });
      return;
    }
    res.writeHead(404); res.end();
  }

  file(res, name, type) {
    fs.readFile(path.join(this.webDir, 'remote', name), (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(name.endsWith('.html') ? require('./server').withLang(buf, this.core.settings.get().uiLang, '/') : buf);
    });
  }

  /** 리모컨에서 할 수 있는 일만 */
  act(a) {
    const core = this.core;
    const control = () => { if (![...core.outputClients.values()].some(c => c.client === 'control')) throw new Error('조작 화면(WorshipCue)이 열려 있어야 합니다.'); };
    switch (a.action) {
      case 'next': return core.command('nextSlide');
      case 'prev': return core.command('previousSlide');
      case 'toggle': return core.command('toggleLive');
      case 'goto': return core.command('gotoSlide', { index: Number(a.index) || 0 });
      case 'cue': control(); core.emit('remote-cue', { index: Number(a.index) || 0 }); return { sent: true };
      case 'message': return core.command('stageMessage', { text: String(a.text || '') });
      case 'obsPip': return core.command('setObsView', { pip: !core.obsView().pip });
      case 'obsFull': return core.command('setObsView', { full: !core.obsView().full });
      case 'timer': return core.command('stageTimer', { action: String(a.op || ''), minutes: Number(a.minutes) || 0 });
      default: throw new Error('알 수 없는 조작입니다.');
    }
  }
}

module.exports = { RemoteServer, lanAddresses, newPin, DEFAULT_PORT };
