'use strict';
/**
 * 장비 직접 제어 (Companion 없이): Behringer X32·M32 음향 콘솔(OSC, UDP 10023) · PTZ 카메라(VISCA over IP)
 * 순서를 송출할 때 '⚡ 송출할 때 자동으로 → 장비' 에 적은 동작을 보낸다. ATEM 등 나머지는 Companion 단추로.
 *
 * X32 동작 (쉼표로 여러 개):  ch1 on · ch1 off · ch5 fader 0.75 · bus2 off · main off · main fader 0.8 · scene 3 · dca1 off
 * PTZ 동작: 프리셋 번호 (0~254) 또는 home
 * 장비 설정: settings.devices = [{ id, name, kind: 'x32' | 'visca', host, port, proto: 'sony' | 'raw' }]
 */
const dgram = require('dgram');

// ---------------- OSC (X32) ----------------
const pad4 = b => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) || 4)]);
const oscStr = s => pad4(Buffer.from(String(s), 'ascii'));
function oscMessage(address, args = []) {
  const tags = ',' + args.map(a => a.t).join('');
  const body = args.map(a => { const b = Buffer.alloc(4); if (a.t === 'i') b.writeInt32BE(a.v); else b.writeFloatBE(a.v); return b; });
  return Buffer.concat([oscStr(address), oscStr(tags), ...body]);
}

/** "ch1 on, ch5 fader 0.75, scene 3" → [{ address, args, text }] (모르는 말이면 오류) */
function parseX32(text) {
  const out = [];
  for (const raw of String(text || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean)) {
    const s = raw.toLowerCase().replace(/\s+/g, ' ');
    let m;
    if ((m = /^scene (\d{1,2})$/.exec(s))) { out.push({ address: '/-action/goscene', args: [{ t: 'i', v: +m[1] }], text: raw }); continue; }
    if ((m = /^(ch|bus|dca|mtx|auxin|fxrtn|main)\s?(\d{0,2}) (on|off|mute|unmute|fader (\d(?:\.\d+)?))$/.exec(s))) {
      const [, kind, numS, act, lvl] = m;
      const num = Number(numS);
      const lim = { ch: 32, bus: 16, dca: 8, mtx: 6, auxin: 8, fxrtn: 8 }[kind];
      if (kind !== 'main' && (!num || num > lim)) throw new Error(`X32: '${raw}' — ${kind} 번호는 1~${lim}`);
      const base = kind === 'main' ? '/main/st' : kind === 'dca' ? `/dca/${num}` : `/${kind}/${String(num).padStart(2, '0')}`;
      const mixOn = kind === 'dca' ? `${base}/on` : `${base}/mix/on`;
      const fader = kind === 'dca' ? `${base}/fader` : `${base}/mix/fader`;
      if (act === 'on' || act === 'unmute') out.push({ address: mixOn, args: [{ t: 'i', v: 1 }], text: raw });
      else if (act === 'off' || act === 'mute') out.push({ address: mixOn, args: [{ t: 'i', v: 0 }], text: raw });
      else { const v = Number(lvl); if (!(v >= 0 && v <= 1)) throw new Error(`X32: '${raw}' — fader 는 0~1`); out.push({ address: fader, args: [{ t: 'f', v }], text: raw }); }
      continue;
    }
    throw new Error(`X32: '${raw}' 를 알아듣지 못했습니다 (예: ch1 on · ch5 fader 0.75 · main off · scene 3)`);
  }
  return out;
}

// ---------------- VISCA (PTZ 카메라) ----------------
/** 프리셋 불러오기 / 처음 자리 (VISCA 명령 바이트) */
function viscaCommand(action) {
  const s = String(action || '').trim().toLowerCase();
  if (s === 'home') return Buffer.from([0x81, 0x01, 0x06, 0x04, 0xff]);
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 254) throw new Error('PTZ: 프리셋 번호는 0~254 (또는 home)');
  return Buffer.from([0x81, 0x01, 0x04, 0x3f, 0x02, n, 0xff]);
}
/** Sony VISCA over IP 머리글 (명령 0x0100 · 길이 · 순번) */
function viscaPacket(cmd, seq, proto = 'sony') {
  if (proto === 'raw') return cmd;
  const h = Buffer.alloc(8);
  h.writeUInt16BE(0x0100, 0); h.writeUInt16BE(cmd.length, 2); h.writeUInt32BE(seq >>> 0, 4);
  return Buffer.concat([h, cmd]);
}

// ---------------- 보내기 ----------------
let seq = 1;
function sendUdp(host, port, packets) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    sock.on('error', e => { try { sock.close(); } catch { /* 무시 */ } reject(e); });
    let i = 0;
    const next = () => {
      if (i >= packets.length) { sock.close(); resolve(packets.length); return; }
      sock.send(packets[i++], port, host, e => (e ? (sock.close(), reject(e)) : setTimeout(next, 15)));
    };
    next();
  });
}

const DEFAULT_PORT = { x32: 10023, visca: 52381 };

function findDevice(core, id) {
  const d = (core.settings.get().devices || []).find(x => x.id === id);
  if (!d) throw new Error('장비를 찾을 수 없습니다. 도구 → 장비 에서 다시 고르세요.');
  return d;
}

/** 한 장비에 동작 보내기: X32 는 동작 글, PTZ 는 프리셋 번호 */
async function run(core, { device, action } = {}) {
  const d = findDevice(core, device);
  const port = Number(d.port) || DEFAULT_PORT[d.kind];
  let packets;
  if (d.kind === 'x32') packets = parseX32(action).map(c => oscMessage(c.address, c.args));
  else if (d.kind === 'visca') packets = [viscaPacket(viscaCommand(action), seq++, d.proto)];
  else throw new Error('알 수 없는 장비 종류입니다.');
  if (!packets.length) throw new Error('보낼 동작이 없습니다.');
  try { await sendUdp(d.host, port, packets); } catch (e) { throw new Error(`${d.name}: 보내지 못했습니다 (${d.host}:${port}) — ${e.message}`); }
  core.logger.info(`장비 '${d.name}': ${String(action).slice(0, 120)}`);
  return { sent: packets.length };
}

/** 설정 정리 */
function normalizeDevice(x) {
  const kind = x && ['x32', 'visca'].includes(x.kind) ? x.kind : null;
  if (!kind) throw new Error('장비 종류를 고르세요 (X32 · PTZ 카메라).');
  const host = String(x.host || '').trim();
  if (!/^[\w.-]{1,200}$/.test(host)) throw new Error('장비 IP 주소를 입력하세요 (예: 192.168.1.50).');
  const name = String(x.name || '').trim().slice(0, 40) || (kind === 'x32' ? 'X32' : 'PTZ 카메라');
  const port = x.port ? Math.max(1, Math.min(65535, Math.round(Number(x.port)) || DEFAULT_PORT[kind])) : DEFAULT_PORT[kind];
  return { id: /^[a-z0-9]{3,30}$/i.test(x.id || '') ? x.id : 'dv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), /* 같은 순간에 둘 더해도 겹치지 않게 */ name, kind, host, port, ...(kind === 'visca' ? { proto: x.proto === 'raw' ? 'raw' : 'sony' } : {}) };
}

module.exports = { run, parseX32, oscMessage, viscaCommand, viscaPacket, normalizeDevice, DEFAULT_PORT };
