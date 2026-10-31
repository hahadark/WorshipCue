'use strict';
// 로컬 웹 서버 (127.0.0.1 전용)
//  - /control/            조작 화면
//  - /outputs/main        전체 화면 출력 (예배당 모니터 창 / OBS)
//  - /outputs/overlay     투명 자막 출력 (OBS)
//  - /events              Server-Sent Events: 상태 변경 즉시 전달, 재연결 시 최신 상태 재전송
//  - /api/command         내부 명령 인터페이스 (POST, X-WorshipCue 헤더 필수)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.bmp': 'image/bmp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/ogg', '.wma': 'audio/x-ms-wma',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
};
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

/** 화면 언어: 영어면 <html data-lang="en"> 과 번역 스크립트를 넣는다 */
function withLang(buf, lang, prefix = '/shared/') {
  if (lang !== 'en') return buf;
  return Buffer.from(String(buf).replace(/<html lang="ko">/, '<html lang="en" data-lang="en">')
    .replace(/<head>/, `<head><script src="${prefix}i18n-en.js"></script><script src="${prefix}i18n.js"></script>`));
}

function startServer(core, { webDir, port, host = '127.0.0.1' }) {
  // 휴대폰 리모컨 (켜져 있으면 같이 시작)
  if (!core.remote) {
    const { RemoteServer } = require('./remote');
    core.remote = new RemoteServer(core, webDir);
    core.remote.sync();
  }
  const clients = new Map(); // id → { res, client }
  let seq = 0;

  function send(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function broadcastLive() {
    for (const c of clients.values()) {
      if (c.client === 'control') send(c.res, 'state', core.getState());
      else if (c.client === 'stage') send(c.res, 'render', core.stagePayload());
      else send(c.res, 'render', core.outputPayload(c.client));
    }
  }
  function broadcastControl(event, data) {
    for (const c of clients.values()) if (c.client === 'control') send(c.res, event, data);
  }

  core.on('live', broadcastLive);
  // 그리기·강조: 슬라이드를 다시 그리지 않고 그 층만
  core.on('draw', d => { for (const c of clients.values()) if (c.client !== 'stage') send(c.res, 'draw', d); });
  core.on('settings', what => broadcastControl('settings', { what, state: core.getState() }));
  core.on('preview', () => broadcastControl('preview', core.getState().preview));
  core.on('extend-request', d => broadcastControl('extend-request', d));
  core.on('cue-next', d => broadcastControl('cue-next', d));
  core.on('cues', d => broadcastControl('cues', d));
  core.on('songs', d => broadcastControl('songs', d));
  core.on('remote-cue', d => broadcastControl('remote-cue', d));
  core.on('remote', () => broadcastControl('remote', core.remote ? core.remote.status() : null));
  core.on('song-downloaded', d => broadcastControl('song-downloaded', d));
  core.on('song-inbox', d => broadcastControl('song-inbox', d));
  core.on('outputs', () => broadcastControl('outputs', core.outputStatus()));
  core.on('update', u => broadcastControl('update', u));
  core.on('obs', s => broadcastControl('obs', s));
  core.on('message', m => broadcastControl('message', m));

  const heartbeat = setInterval(() => {
    for (const c of clients.values()) c.res.write(': ping\n\n');
  }, 15000);
  heartbeat.unref?.();

  function okHost(req) {
    const h = String(req.headers.host || '').toLowerCase();
    return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`;
  }

  function json(res, status, obj) {
    res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  function serveFile(res, file, base) {
    const lang = core.settings.get().uiLang;
    const resolved = path.resolve(file);
    if (!resolved.startsWith(path.resolve(base) + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(resolved, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(resolved.endsWith('.html') ? withLang(buf, lang) : buf);
    });
  }

  /** 라이브러리 파일 (오디오 구간 요청 Range 지원 → 재생 위치 이동 가능) */
  function serveLibFile(req, res, file) {
    fs.stat(file, (err, st) => {
      if (err) { res.writeHead(404); return res.end(); }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m) {
        const start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
        if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
        res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes' });
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'max-age=60' });
        fs.createReadStream(file).pipe(res);
      }
    });
  }

  function readBody(req, limit, cb) {
    const chunks = [];
    let size = 0;
    req.on('data', ch => {
      size += ch.length;
      if (size > limit) { req.destroy(); return; }
      chunks.push(ch);
    });
    req.on('end', () => cb(Buffer.concat(chunks)));
  }

  // ---------- 내부망 출력 (송출 PC 의 OBS 등 다른 PC 에서 출력 화면만) ----------
  // 같은 처리기를 쓰되, 열쇠(key)가 맞고 출력 화면에 필요한 주소만 허용한다. 조작 화면·명령은 열리지 않는다.
  const crypto = require('crypto');
  const LAN_COOKIE = 'wclan';
  const safeEq = (a, b) => !!a && !!b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  function lanGate(req, res, url, p) {
    const want = (core.settings.get().lanOutput || {}).key || '';
    const fromUrl = String(url.searchParams.get('key') || '');
    const m = /(?:^|;\s*)wclan=([^;]+)/.exec(req.headers.cookie || '');
    const ok = safeEq(fromUrl, want) || safeEq(m ? decodeURIComponent(m[1]) : '', want);
    if (!ok) return false;
    // 주소에 열쇠가 있으면 기억해 두어, 화면이 부르는 그림·영상·연결도 열리게
    if (fromUrl) res.setHeader('Set-Cookie', `${LAN_COOKIE}=${encodeURIComponent(want)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    if (req.method === 'GET') {
      if (p === '/events') return ['main', 'overlay', 'stage'].includes(url.searchParams.get('client'));
      return /^\/outputs\/(main|overlay|stage)$/.test(p) || /^\/outputs\/[\w.-]+\.(js|css)$/.test(p) || p.startsWith('/shared/') || p.startsWith('/media/') || p === '/lib/file' || p.startsWith('/hymn/') || p.startsWith('/hymnal/score/');
    }
    return req.method === 'POST' && (p === '/api/ack' || p === '/api/command');
  }

  const handler = lan => (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const p = decodeURIComponent(url.pathname);
    if (lan) {
      if (!lanGate(req, res, url, p)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Worship Presenter: key required (설정 → 출력 → 내부망 출력의 주소를 그대로 쓰세요)'); }
    } else if (!okHost(req)) { res.writeHead(421); return res.end('Misdirected'); }
    req.lan = lan;

    if (req.method === 'GET') {
      if (p === '/' || p === '/control') { res.writeHead(302, { Location: '/control/' }); return res.end(); }
      if (p === '/outputs/main' || p === '/outputs/overlay') return serveFile(res, path.join(webDir, 'output', 'index.html'), webDir);
      if (p === '/outputs/stage') return serveFile(res, path.join(webDir, 'output', 'stage.html'), webDir);
      if (p.startsWith('/control/')) return serveFile(res, path.join(webDir, 'control', p.slice(9) || 'index.html'), webDir);
      if (p.startsWith('/outputs/')) return serveFile(res, path.join(webDir, 'output', p.slice(9)), webDir);
      if (p.startsWith('/shared/')) return serveFile(res, path.join(webDir, 'shared', p.slice(8)), webDir);
      if (p.startsWith('/media/')) return serveFile(res, path.join(core.mediaDir, path.basename(p)), core.mediaDir);
      if (p === '/lib/file') {
        const f = core.library.resolveFile(url.searchParams.get('p'));
        if (!f) { res.writeHead(404); return res.end(); }
        return serveLibFile(req, res, f);
      }
      if (p.startsWith('/hymn/')) {
        const [, , key, file] = p.split('/');
        const fp = core.hymns.cachePath(key, file);
        if (!fp) { res.writeHead(404); return res.end(); }
        return serveFile(res, fp, core.hymns.cacheDir);
      }
      // 베들레헴 찬송가 악보 그림
      if (p.startsWith('/hymnal/score/')) {
        const m = /^\/hymnal\/score\/([^/]+)\/(\d{1,4})\.png$/.exec(p);
        let png = null;
        try { if (m) png = core.hymnal.score(decodeURIComponent(m[1]), Number(m[2])); } catch { png = null; }
        if (!png) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
        return res.end(png);
      }
      // 스트림덱·Companion 등 외부 단추: 열쇠(key)가 맞아야 동작 (다른 웹사이트가 함부로 못 누르게)
      if (p.startsWith('/api/trigger/')) {
        const want = core.settings.get().triggerKey || '';
        const got = String(url.searchParams.get('key') || '');
        const crypto = require('crypto');
        if (!want || got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return json(res, 403, { ok: false, error: '열쇠(key)가 맞지 않습니다. 워십프리젠터 → 도구 → 스트림덱·외부 단추에서 주소를 다시 복사하세요.' });
        try {
          const result = core.trigger(p.slice('/api/trigger/'.length), Object.fromEntries(url.searchParams));
          return json(res, 200, { ok: true, result: result && result.ok === false ? result : true });
        } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
      }
      // OBS 도킹: 휴대폰 리모컨 화면을 이 PC 안에서 PIN 없이 (이 서버는 이 PC 에서만 열린다)
      if (p === '/dock' || p === '/dock/') return serveFile(res, path.join(webDir, 'remote', 'index.html'), webDir);
      if (p === '/remote.js') return serveFile(res, path.join(webDir, 'remote', 'remote.js'), webDir);
      if (p === '/groups.js') return serveFile(res, path.join(webDir, 'shared', 'groups.js'), webDir);
      if (p === '/r/state') return json(res, 200, { ok: true, dock: true, ...core.remote.stateFor() });
      if (p === '/api/state') return json(res, 200, core.getState());
      if (p === '/api/live') return json(res, 200, core.presentation.getLiveState());
      if (p === '/events') {
        const client = ['main', 'overlay', 'control', 'stage'].includes(url.searchParams.get('client')) ? url.searchParams.get('client') : 'main';
        const kind = url.searchParams.get('window') ? 'window' : /OBS/i.test(req.headers['user-agent'] || '') ? 'obs' : 'browser';
        const id = ++seq;
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 1000\n\n'); // 끊기면 1초 후 자동 재연결
        clients.set(id, { res, client });
        core.outputClients.set(id, { client, kind, connectedAt: Date.now(), ack: null });
        // 접속(재접속) 즉시 최신 상태 전송
        if (client === 'control') send(res, 'state', core.getState());
        else if (client === 'stage') send(res, 'render', core.stagePayload());
        else send(res, 'render', core.outputPayload(client));
        if (client !== 'stage' && core.draw && (core.draw.strokes.length || core.draw.spot)) send(res, 'draw', core.draw);
        core.emit('outputs');
        req.on('close', () => {
          clients.delete(id);
          core.outputClients.delete(id);
          core.emit('outputs');
        });
        send(res, 'hello', { id });
        return;
      }
      res.writeHead(404); return res.end();
    }

    if (req.method === 'POST' && p === '/r/do') {
      // 다른 웹사이트가 몰래 보내지 못하게 X-WorshipCue 머리글을 요구 (브라우저는 사전 확인에서 막힌다)
      if (req.headers['x-worshipcue'] !== '1') { res.writeHead(403); return res.end(); }
      return readBody(req, 4000, buf => {
        let a = {};
        try { a = JSON.parse(String(buf) || '{}'); } catch { return json(res, 400, { ok: false, error: '잘못된 요청' }); }
        try { json(res, 200, { ok: true, result: core.remote.act(a) }); } catch (e) { json(res, 200, { ok: false, error: e.message }); }
      });
    }
    if (req.method === 'POST') {
      // 다른 웹사이트에서의 요청 차단: 사용자 정의 헤더는 교차 출처 요청에 붙일 수 없다
      if (req.headers['x-worshipcue'] !== '1') { res.writeHead(403); return res.end('Forbidden'); }
      // AI 주보 → 큐시트: 파일을 그대로 받아 처리 (hwp · hwpx · docx · pdf · txt · 사진)
      if (p === '/api/bulletin') {
        const name = decodeURIComponent(String(req.headers['x-filename'] || 'bulletin.txt'));
        const extra = decodeURIComponent(String(req.headers['x-extra'] || ''));
        return readBody(req, 30 * 1024 * 1024, async buf => {
          try {
            const { readBulletin } = require('./bulletin');
            const input = readBulletin(buf, name);
            json(res, 200, { ok: true, result: await core.aiBulletin({ input, extra }) });
          } catch (e) { json(res, 200, { ok: false, error: e.message }); }
        });
      }
      // 설교 원고 파일 → 글 (hwp · hwpx · docx · txt · md · srt · vtt)
      if (p === '/api/readtext') {
        const name = decodeURIComponent(String(req.headers['x-filename'] || 'sermon.txt'));
        return readBody(req, 30 * 1024 * 1024, buf => {
          try {
            const ext = path.extname(name).toLowerCase();
            if (ext === '.srt' || ext === '.vtt') return json(res, 200, { ok: true, result: { text: buf.toString('utf8').replace(/^\ufeff/, '') } });
            const { readBulletin } = require('./bulletin');
            const r = readBulletin(buf, name);
            if (r.text === undefined) throw new Error('PDF·사진에서는 글을 꺼낼 수 없습니다. 원고를 복사해 붙여 넣거나 hwp·docx·txt 파일을 고르세요.');
            json(res, 200, { ok: true, result: { text: r.text } });
          } catch (e) { json(res, 200, { ok: false, error: e.message }); }
        });
      }
      if (p === '/api/media') {
        const name = String(req.headers['x-filename'] || 'image.png');
        const ext = path.extname(name).toLowerCase();
        if (!IMAGE_EXT.has(ext)) return json(res, 400, { ok: false, error: '이미지 파일(png, jpg, webp, gif)만 사용할 수 있습니다.' });
        return readBody(req, 25 * 1024 * 1024, buf => {
          const file = `bg-${Date.now().toString(36)}${ext}`;
          try {
            fs.writeFileSync(path.join(core.mediaDir, file), buf);
            json(res, 200, { ok: true, url: `/media/${file}` });
          } catch (e) { json(res, 500, { ok: false, error: e.message }); }
        });
      }
      if (p === '/api/import') {
        // 성경 데이터 파일 업로드 → 임시 저장 → 분석(검증 보고서). DB 반영은 commitImport 명령으로 따로 한다.
        const name = path.basename(String(req.headers['x-filename'] || 'import.json')).replace(/[^\w.\-가-힣]/g, '_');
        return readBody(req, 200 * 1024 * 1024, buf => {
          try {
            const dir = path.join(core.dataDir, 'import-tmp');
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, `${Date.now()}-${name}`);
            fs.writeFileSync(file, buf);
            // .epub 은 주석서, 그 밖은 성경 데이터
            const r = core.command(/\.epub$/i.test(name) ? 'analyzeCommentary' : 'analyzeImport', { path: file });
            fs.unlink(file, () => {});
            json(res, 200, r);
          } catch (e) { json(res, 500, { ok: false, error: e.message }); }
        });
      }
      return readBody(req, 8 * 1024 * 1024, buf => {
        let body;
        try { body = JSON.parse(buf.toString('utf8') || '{}'); } catch { return json(res, 400, { ok: false, error: 'JSON 형식 오류' }); }
        if (p === '/api/command') {
          if (req.lan && body.cmd !== 'videoEnded') return json(res, 403, { ok: false }); // 내부망: 출력 화면이 알리는 '영상 끝남' 만
          const t0 = performance.now();
          return Promise.resolve(core.command(String(body.cmd || ''), body.args || {})).then(r => {
            r.ms = Math.round((performance.now() - t0) * 10) / 10;
            json(res, 200, r);
          });
        }
        if (p === '/api/ack') {
          const c = core.outputClients.get(Number(body.id));
          if (c) {
            c.ack = { version: Number(body.version), at: Date.now(), width: Number(body.width) || 0, height: Number(body.height) || 0, visible: !!body.visible, latency: Number(body.latency) || 0 };
            core.emit('outputs');
          }
          return json(res, 200, { ok: true });
        }
        json(res, 404, { ok: false });
      });
    }
    res.writeHead(405); res.end();
  };
  const server = http.createServer(handler(false));

  // 설정에 맞춰 내부망 서버를 켜고 끈다
  let lanSrv = null, lanPort = 0, lanErr = '';
  const { lanAddresses } = require('./remote');
  core.lanOutput = {
    status() {
      const s = core.settings.get().lanOutput || {};
      const key = encodeURIComponent(s.key || '');
      const addrs = lanAddresses().map(a => a.address);
      const mk = path2 => addrs.map(a => `http://${a}:${lanPort}${path2}?key=${key}`);
      return { enabled: !!s.enabled, running: !!lanSrv, port: lanPort || s.port || 37550, error: lanErr, main: lanSrv ? mk('/outputs/main') : [], overlay: lanSrv ? mk('/outputs/overlay') : [], stage: lanSrv ? mk('/outputs/stage') : [] };
    },
  };
  function syncLan() {
    const s = core.settings.get().lanOutput || {};
    const want = s.enabled ? (s.port || 37550) : 0;
    if (lanSrv && (!want || want !== lanPort)) { lanSrv.close(); lanSrv.closeAllConnections?.(); lanSrv = null; lanPort = 0; core.emit('outputs'); }
    if (want && !lanSrv) {
      const srv = http.createServer(handler(true));
      srv.once('error', e => { lanErr = e.code === 'EADDRINUSE' ? `포트 ${want} 를 다른 프로그램이 쓰고 있습니다.` : e.message; lanSrv = null; core.emit('outputs'); });
      srv.listen(want, '0.0.0.0', () => { lanSrv = srv; lanPort = want; lanErr = ''; core.logger.info(`내부망 출력 서버 시작: ${want}`); core.emit('outputs'); });
    }
  }
  syncLan();
  core.on('settings', () => syncLan());

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      server.on('error', e => core.logger.error('서버 오류: ' + e.message));
      core.logger.info(`로컬 서버 시작: http://${host}:${port}`);
      resolve({
        server, port,
        close: () => new Promise(r => { clearInterval(heartbeat); if (core.remote) core.remote.stop(); if (lanSrv) { lanSrv.close(); lanSrv.closeAllConnections?.(); } for (const c of clients.values()) c.res.end(); server.close(() => r()); server.closeAllConnections(); }),
      });
    });
  });
}

module.exports = { withLang, startServer };
