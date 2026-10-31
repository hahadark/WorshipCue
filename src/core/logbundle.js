'use strict';
/**
 * 로그 묶음 (도움말 → 로그 묶음 저장): 문제를 알릴 때 보낼 글 파일 하나.
 * 버전 · 컴퓨터 · 연결 점검 결과 · 출력 상태 · 설정(열쇠·PIN·AI 키는 가림) · 최근 며칠 로그.
 * 큐시트 내용·찬양 가사·성경 본문은 넣지 않는다 (로그에 남은 송출 제목 정도만).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SECRET = /(key|pin|token|password|secret|apikey|keyEnc)$/i;

/** 설정에서 비밀(열쇠·PIN·AI 키)을 가리고, 긴 글(그림 데이터 등)은 길이만 */
function redact(v, k = '') {
  if (v == null) return v;
  if (typeof v === 'string') {
    if (SECRET.test(k) && v) return '(숨김)';
    return v.length > 300 ? `(글 ${v.length}자)` : v;
  }
  if (Array.isArray(v)) return v.length > 30 ? [`(항목 ${v.length}개)`] : v.map(x => redact(x, k));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, SECRET.test(kk) && vv ? '(숨김)' : redact(vv, kk)]));
  return v;
}

/** 최근 days 일 로그 (오래된 것부터), 합쳐서 maxBytes 를 넘으면 앞을 자른다 */
function recentLogs(dir, days = 7, maxBytes = 400 * 1024) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort().slice(-days); } catch { return '(로그 폴더를 읽지 못했습니다)'; }
  let text = files.map(f => { try { return `===== ${f} =====\n` + fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return `===== ${f} (읽기 실패) =====\n`; } }).join('\n');
  if (Buffer.byteLength(text) > maxBytes) text = '(앞부분 생략)\n' + text.slice(-Math.floor(maxBytes / 2));
  return text || '(로그 없음)';
}

function logBundle(core, { days = 7, port, cueId } = {}) {
  const pad = n => String(n).padStart(2, '0');
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  let version = '';
  try { version = require('../../package.json').version; } catch { /* 무시 */ }
  let diag = null;
  try { diag = require('./diagnose').diagnose(core, { port, cueId }); } catch (e) { diag = { error: e.message }; }
  const out = core.outputStatus();
  const lines = [
    `워십프리젠터 로그 묶음 — ${d.toLocaleString('ko-KR')}`,
    `버전 ${version} · ${os.platform()} ${os.release()} (${os.arch()}) · Node ${process.versions.node}${process.versions.electron ? ' · Electron ' + process.versions.electron : ''}`,
    `메모리 ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB · CPU ${os.cpus().length}개 · 데이터 폴더 ${core.dataDir}`,
    '',
    '## 연결 점검',
    ...(diag && diag.items ? diag.items.map(x => `[${x.status}] ${x.title}: ${x.detail}${x.fix && x.fix.length ? '\n    - ' + x.fix.join('\n    - ') : ''}`) : [String(diag && diag.error)]),
    '',
    '## 출력 상태',
    JSON.stringify({ desktop: out.desktop, clients: out.clients.map(c => ({ output: c.output, kind: c.kind, connectedAt: c.connectedAt })) , update: core.update || null }, null, 1),
    '',
    '## 설정 (열쇠·PIN·AI 키는 가림)',
    JSON.stringify(redact(core.settings.get()), null, 1),
    '',
    `## 최근 ${days}일 로그`,
    recentLogs(core.logger.dir, days),
  ];
  return { name: `워십프리젠터-로그-${stamp}.txt`, text: lines.join('\n') };
}

module.exports = { logBundle, redact, recentLogs };
