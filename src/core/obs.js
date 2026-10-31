'use strict';
/**
 * OBS 원격 조작 (obs-websocket 5 — OBS 28 이상에 들어 있음, 기본 포트 4455)
 * 송출·녹화를 이 프로그램이 직접 하지 않고, 교회가 이미 쓰는 OBS 를 조종한다:
 *   방송 시작·끝 · 녹화 시작·끝 · 장면 바꾸기 · 상태(방송 중·녹화 중·끊김) 보기.
 * 설정: settings.obs = { enabled, host, port, passwordEnc | password }. 켜져 있으면 연결하고, 끊기면 다시 붙는다.
 * 상태가 바뀌면 core 'obs' 이벤트 (조작 화면 상태줄·메뉴).
 */
const crypto = require('crypto');

const OP = { Hello: 0, Identify: 1, Identified: 2, Event: 5, Request: 6, RequestResponse: 7 };
const SUBS = 1 | 4 | 64; // General · Scenes · Outputs 이벤트
const sha = s => crypto.createHash('sha256').update(s).digest('base64');

/** obs-websocket 5 인증 문자열 */
function authString(password, salt, challenge) {
  return sha(sha(String(password) + salt) + challenge);
}

class ObsLink {
  constructor(core, { WebSocketImpl } = {}) {
    this.core = core;
    this.WS = WebSocketImpl || globalThis.WebSocket;
    this.ws = null;
    this.pending = new Map();
    this.seq = 0;
    this.retry = null;
    this.backoff = 3000;
    this.st = { enabled: false, connected: false, connecting: false, error: '', version: '', scene: '', scenes: [], streaming: false, recording: false, streamTime: '', congestion: 0 };
    this.poll = null;
  }

  conf() {
    const o = this.core.settings.get().obs || {};
    let password = o.password || '';
    if (o.passwordEnc && this.core.desktop && this.core.desktop.decrypt) { try { password = this.core.desktop.decrypt(o.passwordEnc); } catch { password = ''; } }
    return { enabled: !!o.enabled, host: o.host || '127.0.0.1', port: Number(o.port) || 4455, password };
  }

  status() { return { ...this.st, host: this.conf().host, port: this.conf().port }; }
  emit() { this.core.emit('obs', this.status()); }
  set(p) { Object.assign(this.st, p); this.emit(); }

  /** 설정이 바뀌면: 켜져 있으면 (다시) 연결, 꺼지면 끊기 */
  sync() {
    const c = this.conf();
    this.st.enabled = c.enabled;
    this.close();
    if (c.enabled) this.connect(); else this.set({ connected: false, connecting: false, error: '' });
  }

  close() {
    clearTimeout(this.retry); this.retry = null;
    clearInterval(this.poll); this.poll = null;
    if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch { /* 무시 */ } this.ws = null; }
    for (const p of this.pending.values()) p.reject(new Error('OBS 연결이 끊겼습니다.'));
    this.pending.clear();
  }

  connect() {
    const c = this.conf();
    if (!this.WS) { this.set({ error: '이 환경에서는 OBS 에 연결할 수 없습니다 (WebSocket 없음).' }); return; }
    this.set({ connecting: true, error: '' });
    let ws;
    try { ws = new this.WS(`ws://${c.host}:${c.port}`); } catch (e) { this.fail(e.message); return; }
    this.ws = ws;
    ws.onmessage = ev => this.onMessage(ev.data, c);
    ws.onerror = () => { /* onclose 에서 처리 */ };
    ws.onclose = ev => {
      const was = this.st.connected;
      this.ws = null;
      clearInterval(this.poll); this.poll = null;
      for (const p of this.pending.values()) p.reject(new Error('OBS 연결이 끊겼습니다.'));
      this.pending.clear();
      const why = ev && ev.code === 4009 ? 'OBS 비밀번호가 맞지 않습니다.' : ev && ev.code === 4008 ? 'OBS 에 비밀번호가 필요합니다.' : was ? 'OBS 연결이 끊겼습니다.' : `OBS 에 연결하지 못했습니다 (${c.host}:${c.port}).`;
      this.fail(why, ev && (ev.code === 4009 || ev.code === 4008));
      if (was) this.core.logger.warn('OBS: ' + why);
    };
  }

  fail(error, noRetry = false) {
    this.set({ connected: false, connecting: false, error, streaming: false, recording: false });
    if (noRetry || !this.conf().enabled) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => { if (this.conf().enabled && !this.ws) this.connect(); }, this.backoff);
    if (this.retry.unref) this.retry.unref();
    this.backoff = Math.min(30000, this.backoff * 2);
  }

  send(op, d) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ op, d })); }

  async onMessage(raw, c) {
    let m;
    try { m = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')); } catch { return; }
    if (m.op === OP.Hello) {
      const d = { rpcVersion: 1, eventSubscriptions: SUBS };
      const a = m.d && m.d.authentication;
      if (a) d.authentication = authString(c.password, a.salt, a.challenge);
      this.st.version = (m.d && m.d.obsWebSocketVersion) || '';
      this.send(OP.Identify, d);
    } else if (m.op === OP.Identified) {
      this.backoff = 3000;
      this.set({ connected: true, connecting: false, error: '' });
      this.core.logger.info(`OBS 연결됨 (obs-websocket ${this.st.version})`);
      await this.refresh().catch(() => {});
      clearInterval(this.poll);
      this.poll = setInterval(() => { if (this.st.streaming || this.st.recording) this.refreshOutputs().catch(() => {}); }, 5000);
      if (this.poll.unref) this.poll.unref();
    } else if (m.op === OP.RequestResponse) {
      const p = this.pending.get(m.d.requestId);
      if (!p) return;
      this.pending.delete(m.d.requestId);
      const s = m.d.requestStatus || {};
      if (s.result) p.resolve(m.d.responseData || {}); else p.reject(new Error(s.comment || `OBS 요청 실패 (${m.d.requestType} ${s.code || ''})`));
    } else if (m.op === OP.Event) {
      const { eventType: t, eventData: e = {} } = m.d || {};
      if (t === 'CurrentProgramSceneChanged') this.set({ scene: e.sceneName || '' });
      else if (t === 'SceneListChanged') this.refresh().catch(() => {});
      else if (t === 'StreamStateChanged') { this.set({ streaming: !!e.outputActive }); this.core.logger.info(`OBS 방송 ${e.outputActive ? '시작' : '끝'} (${e.outputState || ''})`); }
      else if (t === 'RecordStateChanged') { this.set({ recording: !!e.outputActive }); this.core.logger.info(`OBS 녹화 ${e.outputActive ? '시작' : '끝'}`); }
      else if (t === 'ExitStarted') this.fail('OBS 가 꺼졌습니다.');
    }
  }

  request(requestType, requestData) {
    if (!this.st.connected) return Promise.reject(new Error(this.st.error || 'OBS 에 연결돼 있지 않습니다. 도구 → OBS 원격 조작에서 연결하세요.'));
    const requestId = 'r' + (++this.seq);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(requestId); reject(new Error('OBS 가 응답하지 않습니다.')); }, 8000);
      if (t.unref) t.unref();
      this.pending.set(requestId, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } });
      this.send(OP.Request, { requestType, requestId, ...(requestData ? { requestData } : {}) });
    });
  }

  async refresh() {
    const sl = await this.request('GetSceneList');
    this.st.scenes = (sl.scenes || []).slice().sort((a, b) => (b.sceneIndex ?? 0) - (a.sceneIndex ?? 0)).map(s => s.sceneName); // OBS 화면과 같은 순서 (위에서 아래)
    this.st.scene = sl.currentProgramSceneName || '';
    await this.refreshOutputs();
  }

  async refreshOutputs() {
    const [s, r] = await Promise.all([this.request('GetStreamStatus').catch(() => ({})), this.request('GetRecordStatus').catch(() => ({}))]);
    this.set({ streaming: !!s.outputActive, streamTime: s.outputTimecode || '', congestion: Number(s.outputCongestion) || 0, recording: !!r.outputActive });
  }

  /** 조작: scene(장면 이름) · stream/record(on: true 시작 · false 끝 · 없으면 바꾸기) */
  async action({ action, scene, on } = {}) {
    if (action === 'refresh') { await this.refresh(); return this.status(); }
    if (action === 'scene') {
      const name = String(scene || '');
      if (!name) throw new Error('장면 이름이 없습니다.');
      await this.request('SetCurrentProgramScene', { sceneName: name });
      this.set({ scene: name });
      return this.status();
    }
    if (action === 'stream' || action === 'record') {
      const cur = action === 'stream' ? this.st.streaming : this.st.recording;
      const want = typeof on === 'boolean' ? on : !cur;
      if (want === cur) return this.status();
      const type = (want ? 'Start' : 'Stop') + (action === 'stream' ? 'Stream' : 'Record');
      await this.request(type);
      this.set(action === 'stream' ? { streaming: want } : { recording: want });
      return this.status();
    }
    throw new Error('알 수 없는 OBS 동작: ' + action);
  }
}

module.exports = { ObsLink, authString };
