/* 슬라이드 자동 분할 (FR-05)
 * - 문장이 화면 밖으로 잘리지 않도록 실제 렌더링으로 측정한다.
 * - 글꼴은 최소 크기 이하로 줄이지 않는다.
 * - 한 절을 나누면 같은 절 번호와 (1/2) 표시로 연속성을 유지한다.
 * - 전체 화면·OBS 두 출력 템플릿 모두에 들어가도록 분할한다.
 */
(function (global) {
  'use strict';
  const R = global.BCRender;

  function refLabel(bookName, parts) {
    const a = parts[0], b = parts[parts.length - 1];
    if (a.chapter === b.chapter && a.verse === b.verse) {
      return `${bookName} ${a.chapter}:${a.verse}` + (a.partCount > 1 ? ` (${a.partIndex}/${a.partCount})` : '');
    }
    if (a.chapter === b.chapter) return `${bookName} ${a.chapter}:${a.verse}-${b.verse}`;
    return `${bookName} ${a.chapter}:${a.verse}-${b.chapter}:${b.verse}`;
  }

  function makeSlide(bookName, parts) {
    return { ref: refLabel(bookName, parts), parts };
  }

  /**
   * @param passage {book:{name}, verses:[{book,chapter,verse,text}], headings:[{chapter,verse,text}], versionName}
   * @param opts {mode:'auto'|'count', count, templates:[tpl...]}
   */
  function build(passage, opts) {
    const templates = opts.templates.filter(Boolean);
    const bookName = passage.book.name;
    // 모든 슬라이드에 전체 범위 제목을 함께 담는다 (장절 '전체 범위 고정' 표시용)
    const mk = ps => ({ ...makeSlide(bookName, ps), title: passage.title });
    const ver = passage.versionName;
    const headingMap = new Map();
    for (const h of passage.headings || []) {
      const k = h.chapter * 1000 + h.verse;
      headingMap.set(k, (headingMap.has(k) ? headingMap.get(k) + ' · ' : '') + h.text);
    }
    const parts = passage.verses.map(v => ({
      book: v.book, chapter: v.chapter, verse: v.verse, text: v.text,
      heading: headingMap.get(v.chapter * 1000 + v.verse) || '',
      ...(v.text2 ? { text2: v.text2 } : {}), // 병행 번역
    }));

    // fits(parts, 'pref'|'min'): 모든 출력 템플릿에서 넘치지 않는가
    const fits = (ps, which) => {
      const slide = mk(ps);
      return templates.every(t => {
        const size = which === 'pref' || !t.font.autoFit ? t.font.size : t.font.minSize;
        return R.fitsAt(slide, t, size, ver);
      });
    };

    const slides = [];
    const pack = group => {
      // 화면 공간에 맞춰 여러 절을 묶는다
      let cur = [];
      for (const p of group) {
        if (cur.length && fits([...cur, p], 'pref')) { cur.push(p); continue; }
        if (cur.length) { slides.push(mk(cur)); cur = []; }
        if (fits([p], 'pref')) { cur = [p]; continue; }
        if (fits([p], 'min')) { slides.push(mk([p])); continue; } // 혼자 두고 글꼴을 줄여 맞춤
        for (const piece of splitVerse(p)) slides.push(mk([piece]));
      }
      if (cur.length) slides.push(mk(cur));
    };

    const splitVerse = p => {
      // 어절 단위로 나누되, 가능하면 문장 부호에서 끊는다
      const words = p.text.split(/\s+/).filter(Boolean);
      const pieces = [];
      let start = 0;
      let guard = 0;
      while (start < words.length && guard++ < 200) {
        const probe = k => fits([{ ...p, text: words.slice(start, start + k).join(' '), partIndex: 2, partCount: 9 }], 'min');
        let lo = 1, hi = words.length - start;
        if (probe(hi)) { pieces.push(words.slice(start).join(' ')); break; }
        if (!probe(1)) { pieces.push(words[start]); start += 1; continue; } // 한 어절도 안 들어가면 그대로(글꼴 최소)
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (probe(mid)) lo = mid; else hi = mid; }
        let k = lo;
        for (let j = lo; j >= Math.ceil(lo * 0.6); j--) {
          if (/[.,;:?!」』”’)]$/.test(words[start + j - 1])) { k = j; break; }
        }
        pieces.push(words.slice(start, start + k).join(' '));
        start += k;
      }
      return pieces.map((text, i) => ({ ...p, text, partIndex: i + 1, partCount: pieces.length, heading: i === 0 ? p.heading : '', text2: i === pieces.length - 1 ? p.text2 : '' }));
    };

    if (opts.mode === 'count') {
      const n = Math.max(1, opts.count || 1);
      for (let i = 0; i < parts.length; i += n) {
        const group = parts.slice(i, i + n);
        if (fits(group, 'min')) slides.push(mk(group));
        else pack(group);
      }
    } else {
      pack(parts);
    }
    return slides;
  }

  /** 슬라이드 번호 찾기: 해당 장·절이 들어 있는 첫 슬라이드 */
  function indexOfVerse(slides, chapter, verse) {
    const i = slides.findIndex(s => s.parts.some(p => p.chapter === chapter && p.verse === verse));
    return i < 0 ? 0 : i;
  }

  /**
   * 가사·공지 글 → 슬라이드. chunks 는 [{label, text}] (빈 줄·--- 로 미리 나눈 덩어리).
   * 한 덩어리가 최소 글꼴로도 안 들어가면 줄 단위로 더 나눈다.
   */
  function buildText({ title = '', showTitle = false, chunks = [] }, opts) {
    const templates = opts.templates.filter(Boolean);
    const ref = showTitle ? title : '';
    let src;
    const mk = (text, label) => ({ kind: 'text', ref, title: ref, label, ...(src != null ? { src } : {}), parts: [{ book: 0, chapter: 0, verse: 0, text }] });
    const fits = s => templates.every(t => R.fitsAt(s, t, t.font.autoFit ? t.font.minSize : t.font.size, ''));
    const slides = [];
    chunks.forEach((c, ci) => {
      const label = c.label || String(ci + 1);
      src = c.src;
      const text = c.text.trim();
      if (!text) return;
      if (fits(mk(text, label))) { slides.push(mk(text, label)); return; }
      const lines = text.split('\n');
      let cur = [];
      let n = 0;
      const flush = () => { if (cur.length) { slides.push(mk(cur.join('\n'), `${label}-${++n}`)); cur = []; } };
      for (const line of lines) {
        if (cur.length && !fits(mk([...cur, line].join('\n'), label))) flush();
        cur.push(line);
      }
      flush();
    });
    return slides;
  }

  /** 가사: 빈 줄로 슬라이드 구분, "[1절]" 처럼 대괄호만 있는 줄은 표시하지 않고 이름표로 쓴다 */
  function lyricsChunks(lyrics) {
    return String(lyrics || '').replace(/\r/g, '').split(/\n\s*\n/).map(block => {
      const lines = block.split('\n');
      let label = '';
      const kept = lines.filter(l => { const m = l.trim().match(/^\[(.{1,20})\]$/); if (m && !(global.BCGroup && global.BCGroup.isChordOnly(l))) { label = m[1]; return false; } return true; });
      return { label, text: kept.join('\n').trim() };
    }).filter(c => c.text).map((c, k) => ({ ...c, src: k }));
  }

  /** 가사의 k 번째 덩어리 글을 바꾼다 ([1절] 같은 이름표 줄은 그대로) */
  function setLyricsChunk(lyrics, k, text) {
    const blocks = String(lyrics || '').replace(/\r/g, '').split(/\n\s*\n/);
    let n = -1;
    const out = blocks.map(block => {
      const lines = block.split('\n');
      const isLabel = l => /^\[(.{1,20})\]$/.test(l.trim()) && !(global.BCGroup && global.BCGroup.isChordOnly(l));
      if (!lines.filter(l => !isLabel(l)).join('\n').trim()) return block;
      if (++n !== k) return block;
      return [...lines.filter(isLabel), ...String(text).replace(/\r/g, '').split('\n')].join('\n');
    });
    return out.join('\n\n');
  }

  /**
   * 슬라이드 단위로 글 고치기 (FreeShow 의 슬라이드 넣기·복제·지우기·옮기기)
   * kind: 'song' (빈 줄로 나눔, [1절] 이름표 줄) | 'text' ('---' 줄로 나눔)
   * op: 'add' (k 다음에 새 슬라이드) | 'dup' (k 복제) | 'del' (k 지우기) | 'up' | 'down'
   * → 바뀐 글. k 는 슬라이드(덩어리) 번호 (lyricsChunks·textChunks 의 src)
   */
  function slideOp(kind, text, op, k, newText = '새 슬라이드') {
    const song = kind === 'song';
    const parts = String(text || '').replace(/\r/g, '').split(song ? /\n\s*\n/ : /\n\s*-{3,}\s*\n/);
    const isLabel = l => song && /^\[(.{1,20})\]$/.test(l.trim()) && !(global.BCGroup && global.BCGroup.isChordOnly(l));
    const content = b => b.split('\n').some(l => l.trim() && !isLabel(l));
    const idx = parts.map((b, i) => (content(b) ? i : -1)).filter(i => i >= 0); // 슬라이드 k → parts 의 자리
    const at = idx[k];
    const labelsOf = b => b.split('\n').filter(isLabel);
    const bodyOf = b => b.split('\n').filter(l => !isLabel(l)).join('\n').trim();
    if (op === 'add' || op === 'dup') {
      const pos = at === undefined ? parts.length : at + 1;
      parts.splice(pos, 0, op === 'dup' && at !== undefined ? bodyOf(parts[at]) : newText);
    } else if (op === 'del') {
      if (at === undefined) return text;
      const labels = labelsOf(parts[at]);
      const next = idx[k + 1];
      // 이름표가 붙은 슬라이드를 지우면, 바로 뒤 같은 묶음 슬라이드에 이름표를 넘긴다
      if (labels.length && next === at + 1 && !labelsOf(parts[next]).length) parts[next] = [...labels, parts[next]].join('\n');
      parts.splice(at, 1);
    } else if (op === 'up' || op === 'down') {
      const other = idx[k + (op === 'up' ? -1 : 1)];
      if (at === undefined || other === undefined) return text;
      [parts[at], parts[other]] = [parts[other], parts[at]];
    }
    return parts.map(p => p.trim()).filter(p => p !== '').join(song ? '\n\n' : '\n---\n');
  }
  /** 슬라이드 편집(edits) 의 번호를 같이 옮긴다 ('*' 공통은 그대로) */
  function slideOpEdits(edits, op, k) {
    if (!edits) return edits;
    const out = {};
    for (const [key, v] of Object.entries(edits)) {
      if (key === '*') { out[key] = v; continue; }
      const n = Number(key);
      if (op === 'add' || op === 'dup') out[n > k ? n + 1 : n] = v;
      else if (op === 'del') { if (n === k) continue; out[n > k ? n - 1 : n] = v; }
      else if (op === 'up' || op === 'down') { const o = op === 'up' ? k - 1 : k + 1; out[n === k ? o : n === o ? k : n] = v; }
      else out[n] = v;
    }
    if (op === 'dup' && edits[k]) out[k + 1] = JSON.parse(JSON.stringify(edits[k])); // 복제는 꾸민 것도 함께
    return Object.keys(out).length ? out : undefined;
  }

  /** 공지 글의 k 번째 장 글을 바꾼다 */
  function setTextChunk(body, k, text) {
    const parts = String(body || '').replace(/\r/g, '').split(/\n\s*-{3,}\s*\n/);
    let n = -1;
    return parts.map(p => (p.trim() && ++n === k ? String(text).replace(/\r/g, '') : p)).join('\n---\n');
  }

  /** 공통('*') + 슬라이드별 편집 합치기 (코어 slideedit.js 의 mergeEdit 과 같음) */
  function mergeEdit(edits, key) {
    if (!edits) return null;
    const a = edits['*'], b = key == null ? null : edits[String(key)];
    if (!a && !b) return null;
    if (!a || !b) return JSON.parse(JSON.stringify(a || b));
    const o = { ...JSON.parse(JSON.stringify(a)), ...JSON.parse(JSON.stringify(b)) };
    o.style = { ...(a.style || {}), ...(b.style || {}) };
    o.items = [...(a.items || []), ...(b.items || [])];
    return o;
  }

  /**
   * 가사 묶음: [1절] [후렴] 같은 이름표부터 다음 이름표 전까지를 한 묶음으로
   * → [{ label, chunks: [...] }]
   */
  function lyricGroups(chunks) {
    const groups = [];
    for (const c of chunks) {
      if (c.label || !groups.length) groups.push({ label: c.label, chunks: [c] });
      else groups[groups.length - 1].chunks.push({ ...c, label: c.label || '' });
    }
    return groups;
  }
  const normLabel = s => String(s || '').replace(/[\s\[\]()]/g, '').toLowerCase();
  /** 부를 순서의 낱말 → 이름표 (1 → 1절, C·후 → 후렴, B·브 → 브릿지, P·전 → 전주 …) */
  function aliasOf(tok) {
    const t = normLabel(tok);
    if (/^\d+$/.test(t)) return [t + '절', t];
    if (/^(c|ch|chorus|후|후렴)$/.test(t)) return ['후렴', 'chorus', 'c'];
    if (/^(b|br|bridge|브|브릿지)$/.test(t)) return ['브릿지', '브리지', 'bridge', 'b'];
    if (/^(p|pre|prechorus|전|전주)$/.test(t)) return ['전주', 'prechorus', 'pre'];
    if (/^(e|end|ending|엔|엔딩|마무리)$/.test(t)) return ['엔딩', '마무리', 'ending', 'end'];
    if (/^(i|intro|인트로)$/.test(t)) return ['인트로', 'intro'];
    if (/^(t|tag|태그)$/.test(t)) return ['태그', 'tag'];
    return [t];
  }
  /**
   * 부를 순서(편곡): "1절 후렴 2절 후렴 후렴" (또는 "1 C 2 C C") 대로 가사 묶음을 늘어놓는다
   * → { chunks, missing: [찾지 못한 낱말] }. 순서가 비면 가사 순서 그대로
   */
  function arrange(chunks, order) {
    const toks = String(order || '').split(/[\s,·>→/|]+/).filter(Boolean);
    if (!toks.length) return { chunks, missing: [] };
    const groups = lyricGroups(chunks);
    const out = [];
    const missing = [];
    for (const tok of toks) {
      const names = aliasOf(tok);
      const g = groups.find(x => names.includes(normLabel(x.label))) || groups.find(x => x.label && names.some(n => normLabel(x.label).startsWith(n)));
      if (g) out.push(...g.chunks); else missing.push(tok);
    }
    return { chunks: out.length ? out : chunks, missing };
  }

  /** 공지 글: '---' 만 있는 줄로 슬라이드 구분 */
  function textChunks(body) {
    return String(body || '').replace(/\r/g, '').split(/\n\s*-{3,}\s*\n/).map(t => ({ label: '', text: t.trim() })).filter(c => c.text).map((c, k) => ({ ...c, src: k }));
  }

  global.BCSlides = { build, refLabel, indexOfVerse, buildText, lyricsChunks, textChunks, lyricGroups, arrange, setLyricsChunk, setTextChunk, mergeEdit, slideOp, slideOpEdits };
})(window);
