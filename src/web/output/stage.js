/* 무대 화면 (설교자·찬양팀 모니터): 지금 슬라이드(크게) · 다음 슬라이드 · 시계 · 설교 타이머 · 전달 메시지 · 순서 메모
 * 템플릿과 상관없이 읽기 쉬운 검은 화면에 흰 글씨. OBS·다른 PC 브라우저에서도 /outputs/stage 로 열 수 있다.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let last = null;
  const pad = n => String(n).padStart(2, '0');

  /** 슬라이드를 글로 */
  function slideText(s) {
    if (!s) return '';
    if (s.kind === 'title') return [s.ref, s.subtitle].filter(Boolean).join('\n');
    if (s.kind === 'blank') return s.mode === 'background' ? '(배경 화면)' : '(검은 화면)';
    if (s.kind === 'video') return '🎬 영상';
    if (s.kind === 'image' || s.kind === 'score') return (s.caption || '').trim() || (s.kind === 'score' ? '🎼 악보' : '🖼 이미지');
    return (s.parts || []).map(p => (p.verse ? p.verse + ' ' : '') + p.text).join(s.kind === 'bible' ? '\n' : ' ').trim();
  }

  function fit() {
    const box = $('cur'), t = $('text');
    let fs = 8;
    t.style.setProperty('--fs', fs + 'vh');
    box.style.setProperty('--fs', fs + 'vh');
    while (fs > 2.4 && (t.scrollHeight > box.clientHeight - 30 || t.scrollWidth > box.clientWidth - 20)) {
      fs -= 0.4;
      box.style.setProperty('--fs', fs + 'vh');
    }
  }

  function render(p) {
    last = p;
    $('title').textContent = p.title || '';
    $('count').textContent = p.hasLive ? `${p.index + 1} / ${p.count}` : '';
    $('ref').textContent = p.slide && p.slide.kind === 'bible' ? (p.slide.ref || '') : (p.slide && p.slide.label ? p.slide.label : '');
    $('text').textContent = p.hasLive ? slideText(p.slide) : '송출 중인 화면 없음';
    $('cur').classList.toggle('hidden', p.hasLive && !p.visible);
    $('badge').textContent = p.hasLive && !p.visible ? '숨김 중' : 'LIVE';
    $('next').textContent = p.nextSlide ? slideText(p.nextSlide) : (p.hasLive ? '(이 순서의 마지막 슬라이드)' : '');
    $('note').textContent = p.note ? '📝 ' + p.note : '';
    $('msg').textContent = p.message || '';
    $('msg').classList.toggle('on', !!p.message);
    fit();
    tick();
  }

  function tick() {
    const d = new Date();
    $('clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const t = last && last.timer;
    const el = $('timer');
    if (!t || (!t.running && !t.duration)) { el.className = 'timer off'; return; }
    const skew = Date.now() - (t.now || Date.now());
    const left = t.running ? t.remaining - (Date.now() - skew - t.now) : t.remaining;
    const neg = left < 0;
    const s = Math.floor(Math.abs(left) / 1000) + (neg ? 0 : (Math.abs(left) % 1000 ? 1 : 0));
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
    el.textContent = (neg ? '+' : '') + (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(ss) + (t.running ? '' : ' ❚❚');
    el.className = 'timer' + (neg ? ' over' : left < 5 * 60000 ? ' warn' : '');
  }
  setInterval(tick, 250);
  window.addEventListener('resize', fit);

  function connect() {
    const es = new EventSource('/events?client=stage');
    es.addEventListener('render', e => { $('conn').classList.remove('on'); try { render(JSON.parse(e.data)); } catch (err) { console.error(err); } });
    es.onerror = () => $('conn').classList.add('on');
  }
  document.body.classList.toggle('nocursor', new URLSearchParams(location.search).has('window'));
  connect();
})();
