'use strict';
/**
 * Companion 단추 누르기 (Bitfocus Companion 3 이상의 HTTP API)
 * 순서를 송출할 때 정해 둔 Companion 단추를 누르면, Companion 이 아는 장비(ATEM · PTZ 카메라 · X32 · 조명 · OBS …)가
 * 같이 움직인다. 장비마다 드라이버를 이 프로그램에 넣지 않아도 되는 방법.
 *   POST http://<주소>:<포트>/api/location/<페이지>/<줄>/<칸>/press
 * 단추 위치는 '페이지/줄/칸' (예: 1/0/2 = 1쪽 첫 줄 셋째 칸). 여러 개는 쉼표로.
 */

/** "1/0/2, 2/1/0" → [{ page, row, col }] (잘못된 것은 뺀다) */
function parseLocations(s) {
  return String(s || '').split(/[,\s]+/).map(x => /^(\d{1,3})\/(\d{1,2})\/(\d{1,2})$/.exec(x.trim())).filter(Boolean).slice(0, 10)
    .map(m => ({ page: +m[1], row: +m[2], col: +m[3] }));
}

function conf(core) {
  const c = core.settings.get().companion || {};
  return { host: String(c.host || '127.0.0.1'), port: Number(c.port) || 8000 };
}

/** 단추 누르기: 하나라도 실패하면 그 이유를 모아 알린다 */
async function press(core, locs, { fetchImpl } = {}) {
  const list = Array.isArray(locs) ? locs : parseLocations(locs);
  if (!list.length) throw new Error("Companion 단추 위치를 '페이지/줄/칸' 으로 쓰세요 (예: 1/0/2).");
  const { host, port } = conf(core);
  const f = fetchImpl || core.companionFetch || fetch;
  const errs = [];
  for (const l of list) {
    const url = `http://${host}:${port}/api/location/${l.page}/${l.row}/${l.col}/press`;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 4000);
      const r = await f(url, { method: 'POST', signal: ac.signal }).finally(() => clearTimeout(t));
      if (!r.ok) errs.push(`${l.page}/${l.row}/${l.col}: ${r.status === 404 ? '그 위치에 단추가 없거나 Companion 이 3 보다 옛 버전입니다' : 'HTTP ' + r.status}`);
    } catch (e) {
      errs.push(`${l.page}/${l.row}/${l.col}: ${e.name === 'AbortError' ? '응답이 없습니다' : `Companion 에 연결하지 못했습니다 (${host}:${port})`}`);
    }
  }
  core.logger.info(`Companion 단추: ${list.map(l => `${l.page}/${l.row}/${l.col}`).join(', ')}${errs.length ? ' — 실패 ' + errs.length : ''}`);
  if (errs.length) throw new Error(errs.join(' · '));
  return { pressed: list.length };
}

module.exports = { parseLocations, press, conf };
