'use strict';
/**
 * 연결 점검 (도움말 → 연결 점검 · 예배 전 점검)
 * 예배 전에 한 번 눌러 보면 되도록: 항목마다 상태(ok · warn · fail · info)와 '무엇이 문제인지 · 어떻게 고치는지' 를 돌려준다.
 * 화면(브라우저)만 알 수 있는 것(카메라·모니터 해상도)은 조작 화면 diag.js 가 덧붙인다.
 */
const fs = require('fs');
const path = require('path');

const item = (id, title, status, detail, fix = []) => ({ id, title, status, detail, fix });

/** 큐시트 순서가 가리키는 파일이 실제로 있는지 (없으면 경로를 돌려준다) */
function missingFile(core, ref) {
  const s = String(ref || '').trim();
  if (!s || /^(https?:|data:|blob:)/.test(s)) return null;
  if (s.startsWith('/media/')) { const f = path.join(core.mediaDir, path.basename(s.split('?')[0])); return fs.existsSync(f) ? null : f; }
  if (s.startsWith('/lib/file')) {
    let p = '';
    try { p = new URL(s, 'http://x').searchParams.get('p') || ''; } catch { /* 무시 */ }
    try { return core.library.resolveFile(p) ? null : (p || s); } catch { return p || s; }
  }
  if (s.startsWith('/')) return null; // 프로그램 안의 그림 (/shared/… · /hymn/…)
  return path.isAbsolute(s) && !fs.existsSync(s) ? s : null;
}

/** 열린(또는 지정한) 큐시트를 예배 전에 훑기: 없는 파일 · 빈 가사 · 잘못된 장절 */
function checkCue(core, cueId) {
  const id = cueId || core.settings.get().activeCueId;
  const cue = id ? core.store.getCue(id) : null;
  if (!cue) return item('cue', '오늘 큐시트', 'info', '열린 큐시트가 없습니다.', ['큐시트를 열면 순서마다 파일·가사·장절을 함께 점검합니다.']);
  const problems = [];
  cue.items.forEach((it, i) => {
    const n = `${i + 1}번 '${it.title}'`;
    for (const k of ['file', 'image', 'bg']) {
      const miss = missingFile(core, it[k]);
      if (miss) problems.push(`${n}: 파일이 없습니다 (${miss})`);
    }
    for (const img of it.images || []) { const miss = missingFile(core, img); if (miss) problems.push(`${n}: 슬라이드쇼 그림이 없습니다 (${miss})`); }
    if (it.type === 'song' && !String(it.lyrics || '').trim()) problems.push(`${n}: 찬양 가사가 비어 있습니다`);
    if (it.type === 'text' && !String(it.body || '').trim()) problems.push(`${n}: 공지 내용이 비어 있습니다`);
    if (it.type === 'bible') {
      if (!String(it.ref || '').trim()) problems.push(`${n}: 성경 장절이 비어 있습니다`);
      else {
        const r = core.command('searchReference', { query: it.ref, versionId: it.versionId || undefined });
        if (!r.ok) problems.push(`${n}: 장절을 찾지 못했습니다 (${it.ref})`);
      }
    }
    if ((it.type === 'video' || it.type === 'audio') && !it.file) problems.push(`${n}: 파일을 고르지 않았습니다`);
    if (it.type === 'camera' && !it.deviceId) problems.push(`${n}: 카메라를 고르지 않았습니다`);
  });
  if (!problems.length) return item('cue', `오늘 큐시트 · ${cue.name}`, 'ok', `순서 ${cue.items.length}개 — 파일·가사·장절 모두 괜찮습니다.`);
  return item('cue', `오늘 큐시트 · ${cue.name}`, 'warn', `고칠 곳 ${problems.length}곳`, [...problems.slice(0, 20), ...(problems.length > 20 ? [`… 외 ${problems.length - 20}곳`] : []), '순서를 눌러 편집칸에서 파일을 다시 고르거나 내용을 채우세요.']);
}

function diagnose(core, { cueId, port } = {}) {
  const s = core.settings.get();
  const out = [];

  // 1. 예배당 화면 (보조 모니터)
  if (core.desktop) {
    const ds = core.desktop.listDisplays();
    const st = core.desktop.status();
    if (ds.length < 2) out.push(item('display', '예배당 화면 (보조 모니터)', 'warn', `모니터가 ${ds.length}대만 보입니다.`, ['모니터·프로젝터 케이블(HDMI)과 전원을 확인하세요.', 'Windows 키 + P → \'확장\' 을 고르세요 (\'복제\' 면 조작 화면이 그대로 보입니다).', '연결한 뒤 설정 → 출력 에서 예배당 모니터를 고르세요.']));
    else if (st.enabled && !st.valid) out.push(item('display', '예배당 화면 (보조 모니터)', 'fail', '고른 예배당 모니터를 찾지 못했습니다.', ['설정 → 출력 에서 예배당 모니터를 다시 고르세요.', '모니터를 바꿔 꽂았으면 Windows 디스플레이 설정에서 \'확장\' 인지 확인하세요.']));
    else if (st.sameAsControl) out.push(item('display', '예배당 화면 (보조 모니터)', 'warn', '예배당 화면이 조작 화면과 같은 모니터에 있습니다.', ['설정 → 출력 에서 다른 모니터를 고르세요.']));
    else out.push(item('display', '예배당 화면 (보조 모니터)', 'ok', `모니터 ${ds.length}대 · ${st.enabled ? `출력 켜짐 (${st.displayLabel})` : '출력 꺼짐 — 송출하면 자동으로 켜집니다'}`));
  } else out.push(item('display', '예배당 화면 (보조 모니터)', 'info', '웹 화면에서는 점검할 수 없습니다 (데스크톱 프로그램에서).'));

  // 2. OBS 브라우저 소스
  const st = core.outputStatus();
  const obs = o => st.clients.filter(c => c.output === o && c.kind !== 'window').length;
  port = Number(port) || core.activePort || 37528;
  const nMain = obs('main'), nOv = obs('overlay');
  if (nMain || nOv) out.push(item('obs', 'OBS 브라우저 소스', 'ok', `연결됨 — 전체 ${nMain}개 · 하단 자막 ${nOv}개`));
  else out.push(item('obs', 'OBS 브라우저 소스', 'info', 'OBS 가 연결돼 있지 않습니다 (방송을 안 하면 괜찮습니다).', [`OBS → 소스 + → 브라우저 → 주소 http://127.0.0.1:${port}/outputs/main (전체) 또는 /outputs/overlay (하단 자막), 너비 1920 · 높이 1080.`, '이미 넣었다면 그 소스를 오른쪽 클릭 → 속성 → \'현재 페이지의 캐시를 새로 고침\'.', '자막 PC 와 송출 PC 가 따로면 아래 \'내부망 출력\' 을 켜세요.']));

  // 2-1. OBS 원격 조작 (obs-websocket)
  const oc = (s.obs || {});
  if (oc.enabled && core.obs) {
    const os_ = core.obs.status();
    if (os_.connected) out.push(item('obsws', 'OBS 원격 조작', 'ok', `연결됨 — 장면 '${os_.scene}' · ${os_.streaming ? '방송 중' : '방송 안 함'} · ${os_.recording ? '녹화 중' : '녹화 안 함'}`));
    else out.push(item('obsws', 'OBS 원격 조작', 'fail', os_.error || 'OBS 에 연결돼 있지 않습니다.', ['OBS 가 켜져 있는지 확인하세요 (OBS 28 이상).', 'OBS → 도구 → WebSocket 서버 설정 → \'WebSocket 서버 사용\' 을 켜고, 포트(기본 4455)와 비밀번호를 도구 → OBS 원격 조작에 똑같이 넣으세요.', 'OBS 가 다른 PC 에 있으면 주소에 그 PC 의 IP(192.168.x.x)를 넣고, 그 PC 방화벽에서 OBS 를 허용하세요.']));
  }

  // 3. 내부망 출력 (다른 PC 의 OBS)
  const lan = s.lanOutput || {};
  if (lan.enabled) {
    const info = core.lanOutput ? core.lanOutput.status() : { running: false, urls: [] };
    if (info.running) out.push(item('lan', '내부망 출력', 'ok', `켜짐 — ${(info.urls || [])[0] || ''}`, ['다른 PC 에서 안 열리면 Windows 방화벽에서 이 프로그램의 \'개인 네트워크\' 허용을 확인하세요.', '두 PC 가 같은 공유기(같은 192.168.x.x)에 있어야 합니다.']));
    else out.push(item('lan', '내부망 출력', 'fail', `켜 두었지만 열리지 않았습니다${info.error ? ' — ' + info.error : ''}.`, [`포트 ${lan.port || 37550} 을 다른 프로그램이 쓰고 있을 수 있습니다. 설정 → 출력 → 내부망 출력에서 껐다 켜 보세요.`, '그래도 안 되면 프로그램을 다시 시작하세요.']));
  } else out.push(item('lan', '내부망 출력', 'info', '꺼짐 (이 PC 의 OBS 만 쓸 때는 필요 없습니다).'));

  // 4. 휴대폰 리모컨
  const rm = core.remote ? core.remote.status() : null;
  if (rm && rm.enabled) out.push(rm.running ? item('remote', '휴대폰 리모컨', 'ok', `켜짐 — ${(rm.urls || [])[0] || ''}`, ['휴대폰이 같은 Wi-Fi 에 있어야 합니다. 안 열리면 방화벽의 \'개인 네트워크\' 허용을 확인하세요.']) : item('remote', '휴대폰 리모컨', 'fail', `켜 두었지만 열리지 않았습니다${rm.error ? ' — ' + rm.error : ''}.`, ['도구 → 휴대폰 리모컨 에서 껐다 켜 보세요.']));
  else out.push(item('remote', '휴대폰 리모컨', 'info', '꺼짐.'));

  // 5. 성경 · 찬송가 데이터
  const versions = core.store.listVersions();
  out.push(versions.length ? item('bible', '성경 번역본', 'ok', `${versions.length}개 — ${versions.slice(0, 4).map(v => v.name).join(' · ')}${versions.length > 4 ? ' …' : ''}`) : item('bible', '성경 번역본', 'fail', '성경 데이터가 없습니다.', ['설정 → 성경 데이터 → 베들레헴에서 가져오기, 또는 프로그램을 다시 설치하세요.']));
  const folders = (s.hymnFolders || []).filter(f => f && f.path);
  const goneHymn = folders.filter(f => !fs.existsSync(f.path));
  if (goneHymn.length) out.push(item('hymn', '찬송가 PPT 폴더', 'warn', `${goneHymn.length}개 폴더를 찾을 수 없습니다.`, [...goneHymn.map(f => `${f.name || ''} ${f.path}`.trim()), '외장 드라이브·원드라이브가 연결돼 있는지 확인하거나, 라이브러리 → 찬송가·PPT 에서 폴더를 다시 등록하세요.']));
  else out.push(item('hymn', '찬송가 PPT 폴더', folders.length ? 'ok' : 'info', folders.length ? `${folders.length}개 폴더 연결됨` : '등록한 폴더가 없습니다 (베들레헴 찬송가만 쓰면 괜찮습니다).'));
  let libGone = [];
  libGone = [...(s.imageFolders || []), ...(s.audioFolders || [])].filter(f => f && f.path && !fs.existsSync(f.path));
  if (libGone.length) out.push(item('library', '라이브러리 폴더 (그림·영상·음악)', 'warn', `${libGone.length}개 폴더를 찾을 수 없습니다.`, [...libGone.map(f => f.path), '드라이브 연결을 확인하거나 라이브러리에서 폴더를 다시 등록하세요.']));

  // 6. 오늘 큐시트
  try { out.push(checkCue(core, cueId)); } catch (e) { out.push(item('cue', '오늘 큐시트', 'warn', '점검하지 못했습니다: ' + e.message)); }

  // 7. 여러 PC 동기화
  if (s.syncDir) {
    if (!fs.existsSync(s.syncDir)) out.push(item('sync', '여러 PC 동기화', 'fail', `동기화 폴더가 없습니다: ${s.syncDir}`, ['원드라이브가 켜져 있는지, 폴더 이름이 바뀌지 않았는지 확인하세요.', '파일 → 여러 PC 동기화 에서 폴더를 다시 고르세요.']));
    else { let ok = true; try { fs.accessSync(s.syncDir, fs.constants.W_OK); } catch { ok = false; } out.push(ok ? item('sync', '여러 PC 동기화', 'ok', `폴더 연결됨 — ${s.syncDir}`) : item('sync', '여러 PC 동기화', 'fail', '동기화 폴더에 쓸 수 없습니다.', ['폴더 권한을 확인하거나 다른 폴더를 고르세요.'])); }
  }

  // 8. 저장 공간
  try {
    const sf = fs.statfsSync(core.dataDir);
    const gb = (sf.bavail * sf.bsize) / 1024 ** 3;
    out.push(gb < 1 ? item('disk', '저장 공간', 'warn', `데이터 드라이브에 ${gb.toFixed(1)}GB 남았습니다.`, ['필요 없는 파일을 지우세요. 공간이 모자라면 큐시트·백업 저장이 실패할 수 있습니다.']) : item('disk', '저장 공간', 'ok', `${gb.toFixed(0)}GB 남음`));
  } catch { /* 이 Node 에 statfs 가 없으면 건너뜀 */ }

  // 9. 업데이트
  const up = core.update || null;
  if (up && up.state === 'error') out.push(item('update', '업데이트', 'warn', '업데이트 확인에 실패했습니다' + (up.error ? ` — ${up.error}` : '') + '.', ['인터넷 연결을 확인하세요. 예배에는 지장이 없습니다.', '설정 → 정보 에서 다시 확인할 수 있습니다.']));
  else if (up && (up.state === 'ready' || up.state === 'downloaded')) out.push(item('update', '업데이트', 'info', `새 버전 ${up.version || ''} 을 받아 두었습니다 — 프로그램을 끌 때 설치됩니다.`));

  return { at: new Date().toISOString(), items: out, summary: { fail: out.filter(x => x.status === 'fail').length, warn: out.filter(x => x.status === 'warn').length } };
}

module.exports = { diagnose, checkCue, missingFile };
