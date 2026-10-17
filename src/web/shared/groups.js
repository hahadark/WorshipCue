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
  // ---------- 글 서식 (편집칸·슬라이드 편집에서 넣는 간단한 표시) ----------
  //  **굵게**   {크기:150}크게{/크기} (150 = 1.5배)   {색:#e63946}빨강{/색}
  const FMT = /\*\*|\{색:(#[0-9a-fA-F]{3,8})\}|\{\/색\}|\{크기:(\d{2,3})\}|\{\/크기\}/g;
  /** 서식 표시를 뺀 글 (무대 화면·리모컨·목록) */
  function stripFmt(t) { return String(t ?? '').replace(FMT, ''); }
  const hasFmt = t => FMT.test(String(t ?? '')) && !(FMT.lastIndex = 0);
  /** 서식 표시 → HTML (esc 로 글을 안전하게). 닫지 않은 것은 끝에서 닫고, 짝 없는 닫기는 무시 */
  function fmtHtml(t, esc) {
    t = String(t ?? '');
    let out = '', last = 0, m;
    const open = []; // [{kind, html}]
    const tag = o => o.kind === 'b' ? '<b>' : o.kind === 'c' ? `<span style="color:${o.v}">` : `<span style="font-size:${o.v / 100}em">`;
    const closeTag = o => (o.kind === 'b' ? '</b>' : '</span>');
    const toggle = (kind, v) => {
      const at = open.map(o => o.kind).lastIndexOf(kind);
      if (v != null || at < 0) { if (v == null && kind !== 'b') return; const o = { kind, v }; open.push(o); out += tag(o); return; }
      const rest = open.splice(at); // 닫을 것 위에 열린 것은 닫았다가 다시 연다
      out += rest.slice().reverse().map(closeTag).join('');
      rest.slice(1).forEach(o => { open.push(o); out += tag(o); });
    };
    FMT.lastIndex = 0;
    while ((m = FMT.exec(t))) {
      out += esc(t.slice(last, m.index));
      last = FMT.lastIndex;
      const s = m[0];
      if (s === '**') { if (open.some(o => o.kind === 'b')) toggle('b'); else toggle('b', 1); }
      else if (m[1]) toggle('c', m[1]);
      else if (s === '{/색}') toggle('c');
      else if (m[2]) toggle('s', Math.max(30, Math.min(400, +m[2])));
      else toggle('s');
    }
    out += esc(t.slice(last));
    return out + open.slice().reverse().map(closeTag).join('');
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

  global.BCGroup = { color, group, key, stripChords, chordHtml, hasChords, isChordOnly, stripFmt, fmtHtml, hasFmt };
})(window);
