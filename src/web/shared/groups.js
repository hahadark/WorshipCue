/* 슬라이드 그룹 색 (FreeShow 방식): 이름표(1절·후렴·브릿지…)마다 같은 색
 * 조작 화면(격자·목록·LIVE 단추)·무대 화면·휴대폰 리모컨이 함께 쓴다
 */
(function (global) {
  'use strict';
  const GROUPS = [
    { re: /^(후렴|chorus|refrain|c)\d*$/i, color: '#e5484d', name: '후렴' },
    { re: /^(브릿지|브리지|bridge|b)\d*$/i, color: '#a35bff', name: '브릿지' },
    { re: /^(전주|인트로|intro|pre|prechorus|간주|interlude)\d*$/i, color: '#2fb5a5', name: '전주·간주' },
    { re: /^(엔딩|마무리|ending|end|outro|태그|tag|코다|coda)\d*$/i, color: '#e3963d', name: '엔딩' },
    { re: /^(\d+)절$|^(verse|v)\s*\d+$/i, color: '#4f8cff', name: '절' },
    { re: /^(제목|title)$/i, color: '#8b93a3', name: '제목' },
  ];
  /** 이름표 → 그룹 이름 ('1절-2', '후렴 (이어서)' 도) */
  const key = label => String(label || '').replace(/\s*\(이어서\)\s*$/, '').replace(/-\d+$/, '').replace(/\s+/g, '').trim();
  function group(label) {
    const k = key(label);
    if (!k || /^\d+$/.test(k)) return null;
    return GROUPS.find(g => g.re.test(k)) || { color: '#8a8fa0', name: k };
  }
  /** 이름표의 색 ('' = 색 없음) */
  function color(label) { const g = group(label); return g ? g.color : ''; }
  // ---------------- 코드 (찬양팀용) ----------------
  // 가사 안의 [G] [Am7] [D/F#] 같은 코드. 예배당·OBS 에는 지우고, 무대 화면에서만 가사 위에 보인다
  const CHORD = /\[([A-G](?:#|b|♯|♭)?(?:maj|min|m|M|sus|dim|aug|add|°|ø)?\d{0,2}(?:(?:sus|add|maj|b|#|\+|-)\d{1,2})*(?:\/[A-G](?:#|b|♯|♭)?)?)\]/g;
  const hasChords = t => { CHORD.lastIndex = 0; return CHORD.test(String(t || '')); };
  /** 코드 지우기 (코드만 있던 줄은 없앤다) */
  function stripChords(t) {
    if (!hasChords(t)) return String(t ?? '');
    return String(t).split('\n').map(l => { const had = hasChords(l); const s = l.replace(CHORD, '').replace(/[ \t]{2,}/g, ' ').trimEnd(); return had && !s.trim() ? null : s; }).filter(l => l !== null).join('\n');
  }
  /** 코드가 있는 가사 → 코드를 글자 위에 얹은 HTML (무대 화면) */
  function chordHtml(t, esc) {
    return String(t).split('\n').map(line => {
      if (!hasChords(line)) return `<div class="cl">${esc(line) || '&nbsp;'}</div>`;
      const out = [];
      let last = 0, chord = '';
      CHORD.lastIndex = 0;
      let m;
      while ((m = CHORD.exec(line))) {
        const seg = line.slice(last, m.index);
        if (seg || chord) out.push(`<span class="cs">${chord ? `<b class="ch">${esc(chord)}</b>` : ''}${esc(seg) || '&nbsp;'}</span>`);
        chord = m[1]; last = CHORD.lastIndex;
      }
      out.push(`<span class="cs">${chord ? `<b class="ch">${esc(chord)}</b>` : ''}${esc(line.slice(last)) || '&nbsp;'}</span>`);
      return `<div class="cl chords">${out.join('')}</div>`;
    }).join('');
  }
  /** '[G]' 처럼 코드 하나만 있는 줄인가 (이름표 [1절] 과 구별) */
  const isChordOnly = line => { const s = String(line).trim(); return !!s && !stripChords(s).trim() && hasChords(s); };

  global.BCGroup = { color, group, key, stripChords, chordHtml, hasChords, isChordOnly };
})(window);
