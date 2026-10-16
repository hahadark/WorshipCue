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
};
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

function startServer(core, { webDir, port, host = '127.0.0.1' }) {
  const clients = new Map(); // id → { res, client }
  let seq = 0;

  function send(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function broadcastLive() {
    for (const c of clients.values()) {
      if (c.client === 'control') send(c.res, 'state', core.getState());
      else send(c.res, 'render', core.outputPayload(c.client));
    }
  }
  function broadcastControl(event, data) {
    for (const c of clients.values()) if (c.client === 'control') send(c.res, event, data);
  }

  core.on('live', broadcastLive);
  core.on('settings', what => broadcastControl('settings', { what, state: core.getState() }));
  core.on('preview', () => broadcastControl('preview', core.getState().preview));
  core.on('extend-request', d => broadcastControl('extend-request', d));
  core.on('cue-next', d => broadcastControl('cue-next', d));
  core.on('cues', d => broadcastControl('cues', d));
  core.on('songs', d => broadcastControl('songs', d));
  core.on('song-downloaded', d => broadcastControl('song-downloaded', d));
  core.on('song-inbox', d => broadcastControl('song-inbox', d));
  core.on('outputs', () => broadcastControl('outputs', core.outputStatus()));

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
    const resolved = path.resolve(file);
    if (!resolved.startsWith(path.resolve(base) + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(resolved, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
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

  const server = http.createServer((req, res) => {
    if (!okHost(req)) { res.writeHead(421); return res.end('Misdirected'); }
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const p = decodeURIComponent(url.pathname);

    if (req.method === 'GET') {
      if (p === '/' || p === '/control') { res.writeHead(302, { Location: '/control/' }); return res.end(); }
      if (p === '/outputs/main' || p === '/outputs/overlay') return serveFile(res, path.join(webDir, 'output', 'index.html'), webDir);
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
      if (p === '/api/state') return json(res, 200, core.getState());
      if (p === '/api/live') return json(res, 200, core.presentation.getLiveState());
      if (p === '/events') {
        const client = ['main', 'overlay', 'control'].includes(url.searchParams.get('client')) ? url.searchParams.get('client') : 'main';
        const kind = url.searchParams.get('window') ? 'window' : /OBS/i.test(req.headers['user-agent'] || '') ? 'obs' : 'browser';
        const id = ++seq;
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 1000\n\n'); // 끊기면 1초 후 자동 재연결
        clients.set(id, { res, client });
        core.outputClients.set(id, { client, kind, connectedAt: Date.now(), ack: null });
        // 접속(재접속) 즉시 최신 상태 전송
        if (client === 'control') send(res, 'state', core.getState());
        else send(res, 'render', core.outputPayload(client));
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

    if (req.method === 'POST') {
      // 다른 웹사이트에서의 요청 차단: 사용자 정의 헤더는 교차 출처 요청에 붙일 수 없다
      if (req.headers['x-worshipcue'] !== '1') { res.writeHead(403); return res.end('Forbidden'); }
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
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      server.on('error', e => core.logger.error('서버 오류: ' + e.message));
      core.logger.info(`로컬 서버 시작: http://${host}:${port}`);
      resolve({
        server, port,
        close: () => new Promise(r => { clearInterval(heartbeat); for (const c of clients.values()) c.res.end(); server.close(() => r()); server.closeAllConnections(); }),
      });
    });
  });
}

module.exports = { startServer };
