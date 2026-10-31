/* 무대 화면 (설교자·찬양팀 모니터): 지금 슬라이드(크게) · 다음 슬라이드 · 시계 · 설교 타이머 · 전달 메시지 · 순서 메모
 * 템플릿과 상관없이 읽기 쉬운 검은 화면에 흰 글씨. OBS·다른 PC 브라우저에서도 /outputs/stage 로 열 수 있다.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let last = null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 코드 보이기 (주소에 ?chords=0 이면 숨김)
  const showChords = new URLSearchParams(location.search).get('chords') !== '0';
  const pad = n => String(n).padStart(2, '0');

  /** 슬라이드를 글로 */
  function slideText(s) {
    if (!s) return '';
    if (s.kind === 'title') return [s.ref, s.subtitle].filter(Boolean).join('\n');
    if (s.kind === 'blank') return s.mode === 'background' ? '(배경 화면)' : '(검은 화면)';
    if (s.kind === 'video') return '🎬 영상';
    if (s.kind === 'image' || s.kind === 'score') return (s.caption || '').trim() || (s.kind === 'score' ? '🎼 악보' : '🖼 이미지');
    const plain = x => (window.BCGroup && window.BCGroup.stripFmt ? window.BCGroup.stripFmt(x) : x);
    return (s.parts || []).map(p => (p.verse ? p.verse + ' ' : '') + plain(p.text) + (p.text2 ? '\n> ' + p.text2 : '')).join(s.kind === 'bible' ? '\n' : ' ').trim();
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
    $('ref').textContent = p.slide && p.slide.kind === 'bible' ? (p.slide.ref || '') : (p.slide && p.slide.label && !/^\d+$/.test(p.slide.label) ? p.slide.label : '');
    // 그룹 색 (1절 파랑 · 후렴 빨강 · 브릿지 보라 …)
    const gcol = p.slide && p.slide.kind !== 'bible' && window.BCGroup ? window.BCGroup.color(p.slide.label) : '';
    $('ref').style.cssText = gcol ? `background:${gcol};color:#fff;padding:2px 12px;border-radius:6px` : '';
    const txt = p.hasLive ? slideText(p.slide) : '송출 중인 화면 없음';
    const G = window.BCGroup;
    const noCh = t => (G ? G.stripChords(t) : t);
    // 줄마다: '>' 번역 줄(병행 번역 포함)은 작게, 코드는 글자 위에
    $('text').innerHTML = txt.split('\n').map(l => /^\s*>/.test(l) ? `<div class="trl">${esc(noCh(l.replace(/^\s*>\s?/, '')))}</div>`
      : G && showChords && G.hasChords(l) ? G.chordHtml(l, esc) : `<div class="cl">${esc(noCh(l)) || '&nbsp;'}</div>`).join('');
    $('cur').classList.toggle('hidden', p.hasLive && !p.visible);
    $('badge').textContent = p.hasLive && !p.visible ? '숨김 중' : 'LIVE';
    $('next').textContent = p.nextSlide ? noCh(slideText(p.nextSlide)).replace(/^\s*>\s?/gm, '') : (p.hasLive ? '(이 순서의 마지막 슬라이드)' : '');
    $('next').dataset.label = '';
    // 무대 화면 고정: 큰 칸에 순서표·고정 글, 아래 작은 칸에 지금 화면
    const pin = p.pin;
    document.body.classList.toggle('pinned', !!pin);
    if (pin) {
      $('badge').textContent = '고정' + (pin.name ? ': ' + pin.name : '');
      $('ref').textContent = pin.mode === 'order' ? (pin.cueName || '') : '';
      $('ref').style.cssText = '';
      $('cur').classList.remove('hidden');
      if (pin.mode === 'order') {
        $('text').innerHTML = pin.items.length ? `<ol class="order">${pin.items.map((it, i) => `<li class="${i === pin.current ? 'now' : i === pin.current + 1 ? 'nx' : i < pin.current ? 'done' : ''}" ${i === pin.current ? 'id="orderNow"' : ''}><span class="on">${i + 1}</span><span class="ot">${esc(it.title)}</span>${it.note ? `<span class="onote">${esc(it.note)}</span>` : ''}</li>`).join('')}</ol>` : '<div class="cl">열린 큐시트가 없습니다</div>';
      } else $('text').innerHTML = String(pin.text || '').split('\n').map(l => `<div class="cl">${esc(l) || '&nbsp;'}</div>`).join('');
      $('next').dataset.label = '지금 화면';
      $('next').textContent = p.hasLive ? (p.visible ? '' : '(숨김) ') + noCh(slideText(p.slide)).replace(/^\s*>\s?/gm, '') : '송출 중인 화면 없음';
    }
    $('note').textContent = p.note ? '📝 ' + p.note : '';
    $('msg').textContent = p.message || '';
    $('msg').classList.toggle('on', !!p.message);
    if (pin && pin.mode === 'order') { $('text').style.setProperty('--fs', '4.4vh'); const n = document.getElementById('orderNow'); if (n) n.scrollIntoView({ block: 'center' }); }
    else fit();
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
