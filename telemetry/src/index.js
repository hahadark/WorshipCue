// WorshipCue 익명 사용 통계 (Cloudflare Worker + D1)
// - POST /ping : 프로그램이 하루 한 번 보내는 신호 { id, v, lang, os, build, kind }
//   무작위 설치 번호 · 버전 · 언어 · OS · 판 종류만 받는다 (IP·이름·교회·내용은 저장하지 않음)
// - GET /stats?key=… : 집계 화면 (일간·주간·월간 활성 설치, 버전·언어·OS·판 종류, 새 설치)
// - GET /stats.json?key=… : 같은 내용 JSON

const ok = (body, type = 'text/plain; charset=utf-8', status = 200) => new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
const clip = (v, n) => String(v ?? '').replace(/[^\w.\-+ ]/g, '').slice(0, n);
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/ping') return ping(req, env);
    if (req.method === 'GET' && (url.pathname === '/stats' || url.pathname === '/stats.json')) {
      if (!env.STATS_KEY || url.searchParams.get('key') !== env.STATS_KEY) return ok('forbidden', 'text/plain', 403);
      const s = await stats(env);
      return url.pathname === '/stats.json' ? ok(JSON.stringify(s, null, 1), 'application/json') : ok(page(s), 'text/html; charset=utf-8');
    }
    if (url.pathname === '/') return ok('WorshipCue usage counter');
    return ok('not found', 'text/plain', 404);
  },
};

async function ping(req, env) {
  let b;
  try { b = await req.json(); } catch { return ok('bad', 'text/plain', 400); }
  const id = String(b.id || '');
  if (!/^[a-z0-9]{16,40}$/.test(id)) return ok('bad id', 'text/plain', 400);
  const day = today();
  await env.DB.prepare(`INSERT INTO pings (day, id, version, lang, os, build, kind) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ON CONFLICT(day, id) DO UPDATE SET version = ?3, lang = ?4, os = ?5, build = ?6, kind = ?7`)
    .bind(day, id, clip(b.v, 20), clip(b.lang, 5), clip(b.os, 20), clip(b.build, 12), clip(b.kind, 12)).run();
  await env.DB.prepare('INSERT OR IGNORE INTO installs (id, first) VALUES (?1, ?2)').bind(id, day).run();
  return new Response(null, { status: 204 });
}

async function stats(env) {
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a).all().then(r => r.results);
  const one = async (sql, ...a) => ((await q(sql, ...a))[0] || {}).n || 0;
  const d30 = daysAgo(29);
  const by = col => q(`SELECT ${col} AS k, COUNT(DISTINCT id) AS n FROM pings WHERE day >= ?1 GROUP BY ${col} ORDER BY n DESC`, d30);
  return {
    at: new Date().toISOString(),
    today: await one('SELECT COUNT(*) AS n FROM pings WHERE day = ?1', today()),
    week: await one('SELECT COUNT(DISTINCT id) AS n FROM pings WHERE day >= ?1', daysAgo(6)),
    month: await one('SELECT COUNT(DISTINCT id) AS n FROM pings WHERE day >= ?1', d30),
    total: await one('SELECT COUNT(*) AS n FROM installs'),
    daily: await q('SELECT day, COUNT(*) AS n FROM pings WHERE day >= ?1 GROUP BY day ORDER BY day', daysAgo(59)),
    fresh: await q('SELECT first AS day, COUNT(*) AS n FROM installs WHERE first >= ?1 GROUP BY first ORDER BY first', daysAgo(59)),
    version: await by('version'), lang: await by('lang'), os: await by('os'), build: await by('build'), kind: await by('kind'),
  };
}

function page(s) {
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const max = Math.max(1, ...s.daily.map(d => d.n));
  const fresh = new Map(s.fresh.map(d => [d.day, d.n]));
  const table = (title, rows) => `<section><h3>${title}</h3><table>${rows.map(r => `<tr><td>${esc(r.k || '(없음)')}</td><td class="n">${r.n}</td></tr>`).join('') || '<tr><td>없음</td></tr>'}</table></section>`;
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WorshipCue 사용 통계</title>
<style>:root{color-scheme:light dark}body{font-family:system-ui,'Malgun Gothic',sans-serif;margin:0;padding:16px;max-width:900px;margin:auto}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.card{border:1px solid #8884;border-radius:10px;padding:12px}.card b{font-size:30px;display:block}
.bars{display:flex;align-items:flex-end;gap:2px;height:160px;border-bottom:1px solid #8886;margin-top:8px}.bars div{flex:1;background:#3d7bff;min-height:1px;position:relative}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}table{width:100%;border-collapse:collapse}td{padding:3px 6px;border-bottom:1px solid #8883}.n{text-align:right;font-variant-numeric:tabular-nums}.muted{opacity:.6;font-size:12px}</style>
<h2>WorshipCue 사용 통계</h2><p class="muted">설치마다 하루 한 번 보내는 익명 신호를 셉니다 (같은 PC 는 하루 1). ${esc(s.at)} 기준 · 날짜는 UTC</p>
<div class="cards"><div class="card">오늘<b>${s.today}</b></div><div class="card">최근 7일<b>${s.week}</b></div><div class="card">최근 30일<b>${s.month}</b></div><div class="card">지금까지 설치<b>${s.total}</b></div></div>
<h3>날짜별 사용 (최근 60일)</h3><div class="bars">${s.daily.map(d => `<div style="height:${Math.round(d.n / max * 100)}%" title="${d.day}: ${d.n}대${fresh.get(d.day) ? ' · 새 설치 ' + fresh.get(d.day) : ''}"></div>`).join('')}</div>
<p class="muted">막대에 마우스를 올리면 날짜·대수</p>
<div class="grid">${table('버전 (30일)', s.version)}${table('언어', s.lang)}${table('OS', s.os)}${table('판', s.build)}${table('설치 방식', s.kind)}</div></html>`;
}
