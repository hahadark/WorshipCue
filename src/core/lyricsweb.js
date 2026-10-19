'use strict';
// 웹에서 가사 찾기: 벅스 · 지니 · 멜론의 검색 결과와 곡 페이지에서 가사를 읽는다
// - 사용자가 검색하고 고른 곡만 한 곡씩 (여러 곡을 자동으로 모으지 않음)
// - 사이트 구조가 바뀌면 못 읽을 수 있다 → 그때는 가사를 복사해 붙여넣기
// - 받은 가사(줄만 있거나 연이 나뉜 글)를 [1절] [후렴] 구간과 슬라이드로 정리하는 arrange() 도 여기에

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SITES = { bugs: '벅스', genie: '지니', melon: '멜론' };

const decode = s => String(s || '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');
const one = s => decode(s).replace(/\s+/g, ' ').trim();
const pick = (s, re) => { const m = re.exec(s); return m ? one(m[1]) : ''; };

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.text();
}

// ---------------- 검색 ----------------
const searchers = {
  async bugs(q) {
    const html = await get(`https://music.bugs.co.kr/search/track?q=${encodeURIComponent(q)}`);
    const out = [];
    for (const row of html.split('<tr ').slice(1)) {
      if (!/rowType="track"/.test(row)) continue;
      const id = pick(row, /trackId="(\d+)"/);
      const title = pick(row, /<p class="title"[\s\S]*?title="([^"]*)"/);
      if (id && title) out.push({ site: 'bugs', id, title, artist: pick(row, /<p class="artist">[\s\S]*?title="([^"]*)"/), album: pick(row, /class="album" title="([^"]*)"/) });
    }
    return out;
  },
  async genie(q) {
    const html = await get(`https://www.genie.co.kr/search/searchSong?query=${encodeURIComponent(q)}`);
    const out = [];
    for (const row of html.split('<tr class="list" songid="').slice(1)) {
      const id = pick(row, /^(\d+)"/);
      const title = pick(row, /class="title ellipsis" title="([^"]*)"/);
      if (id && title) out.push({ site: 'genie', id, title, artist: pick(row, /class="artist ellipsis"[^>]*>([\s\S]*?)<\/a>/), album: pick(row, /class="albumtitle ellipsis"[^>]*>([\s\S]*?)<\/a>/) });
    }
    return out;
  },
  async melon(q) {
    const html = await get(`https://www.melon.com/search/song/index.htm?q=${encodeURIComponent(q)}`);
    const out = [];
    for (const row of html.split('<tr').slice(1)) {
      const id = pick(row, /name="input_check" value="(\d+)"/);
      const title = pick(row, /class="fc_gray" title="([^"]*)"/);
      if (id && title) out.push({ site: 'melon', id, title, artist: pick(row, /goArtistDetail[^"]*" title="([^"]*?) - 페이지 이동"/), album: pick(row, /goAlbumDetail[^"]*" title="([^"]*?) - 페이지 이동"/) });
    }
    return out;
  },
};

/** 검색 → [{ site, siteName, id, title, artist, album }] (사이트마다 앞에서 15곡) · errors: 못 읽은 사이트 */
async function search(query, sites = Object.keys(SITES)) {
  const q = String(query || '').trim().slice(0, 100);
  if (!q) return { results: [], errors: [] };
  const list = sites.filter(s => searchers[s]);
  const settled = await Promise.allSettled(list.map(s => searchers[s](q)));
  const results = [], errors = [];
  settled.forEach((r, k) => {
    // 반주(MR·Inst.) 곡은 가사가 없으므로 뺀다
    if (r.status === 'fulfilled') results.push(...r.value.filter(x => !/[([]\s*(mr|inst\.?|instrumental|반주)\s*[)\]]/i.test(x.title)).slice(0, 15).map(x => ({ ...x, siteName: SITES[x.site] })));
    else errors.push(`${SITES[list[k]]}: ${r.reason && r.reason.message || r.reason}`);
  });
  return { results, errors };
}

// ---------------- 가사 ----------------
const readers = {
  async bugs(id) {
    const html = await get(`https://music.bugs.co.kr/track/${id}`);
    const m = /<div class="lyricsContainer">[\s\S]*?<xmp>([\s\S]*?)<\/xmp>/.exec(html);
    return m ? m[1] : '';
  },
  async genie(id) {
    const html = await get(`https://www.genie.co.kr/detail/songInfo?xgnm=${id}`);
    const m = /<pre id="pLyrics">[\s\S]*?<p>([\s\S]*?)<\/p>/.exec(html);
    return m ? decode(m[1]) : '';
  },
  async melon(id) {
    const html = await get(`https://www.melon.com/song/detail.htm?songId=${id}`);
    const m = /<div class="lyric" id="d_video_summary">([\s\S]*?)<\/div>/.exec(html);
    return m ? decode(m[1]) : '';
  },
};

/** 고른 곡의 가사 → 줄 글 ('' 이면 그 사이트에 가사 없음) */
async function lyrics(site, id) {
  if (!readers[site] || !/^\d{1,12}$/.test(String(id))) throw new Error('잘못된 곡입니다.');
  const text = String(await readers[site](String(id))).replace(/\r/g, '').split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return /^가사 정보가 없습니다/.test(text) ? '' : text;
}

// ---------------- 구간·슬라이드로 정리 ----------------
const keyOf = l => l.replace(/[\s.,!?~'"“”‘’()-]/g, '').toLowerCase();

/**
 * 가사 글 → { lyrics: '[1절]\n…\n\n[후렴]\n…', arrangement: '1절 후렴 2절 후렴' }
 * - 빈 줄(연)이 있으면 그 경계를 지키고, 없으면 되풀이되는 줄 묶음으로 구간을 나눈다
 * - 두 번 이상 나오는 구간 = 후렴(가장 많이), 그 앞에 늘 붙는 것 = 프리코러스, 나머지 되풀이 = 후렴2…
 * - 한 번만 나오는 구간 = 1절 2절 … · 슬라이드는 lines 줄씩 (고르게)
 */
function arrange(text, { lines: per = 2 } = {}) {
  const raw = String(text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+/g, ' ').trim());
  // 이미 [이름표] 가 있는 가사는 그대로
  if (raw.some(l => /^\[[^\]]{1,20}\]$/.test(l))) return { lyrics: raw.join('\n').replace(/\n{3,}/g, '\n\n').trim(), arrangement: '' };
  const L = [], forced = new Set();
  let gap = true;
  for (const l of raw) {
    if (!l) { gap = true; continue; }
    if (/^<.*>$/.test(l)) continue; // '< 곡 제목 >' 같은 머리줄
    if (gap) forced.add(L.length);
    gap = false;
    L.push(l);
  }
  if (!L.length) return { lyrics: '', arrangement: '' };
  const n = L.length, K = L.map(keyOf);
  // p[i]: 같은 줄이 앞에 나온 마지막 자리 (2줄 이상 이어서 되풀이될 때만 '되풀이'로 본다)
  const last = new Map(), p0 = K.map((k, i) => { const j = last.has(k) ? last.get(k) : -1; last.set(k, i); return j; });
  const p = p0.map((j, i) => (j >= 0 && ((i + 1 < n && p0[i + 1] === j + 1) || (i > 0 && p0[i - 1] === j - 1)) ? j : -1));
  const cut = new Set(forced);
  cut.add(0);
  const blocksOf = () => {
    const starts = [];
    for (let i = 0; i < n; i++) {
      const c = cut.has(i) || i === 0 || ((p[i] < 0) !== (p[i - 1] < 0)) || (p[i] >= 0 && p[i] !== p[i - 1] + 1);
      if (c) starts.push(i);
    }
    return starts.map((s, k) => [s, (starts[k + 1] ?? n) - 1]);
  };
  // 되풀이 구간의 시작·끝을 원래 자리에도 자르고, 원래 자리의 자름을 되풀이에도 옮긴다 (바뀌지 않을 때까지)
  for (let round = 0; round < 12; round++) {
    const before = cut.size;
    for (const [s, e] of blocksOf()) { cut.add(s); if (e + 1 < n) cut.add(e + 1); }
    for (let i = 0; i < n; i++) {
      if (p[i] < 0) continue;
      if (cut.has(i)) cut.add(p[i]);
      if (cut.has(p[i])) cut.add(i);
      if ((i + 1 === n || cut.has(i + 1)) && p[i] + 1 < n) cut.add(p[i] + 1); // 되풀이의 끝(곡 끝 포함) → 원래 자리의 끝
      if (i + 1 < n && p[i] + 1 < n && cut.has(p[i] + 1)) cut.add(i + 1);
    }
    if (cut.size === before) break;
  }
  let blocks = blocksOf().map(([s, e]) => L.slice(s, e + 1));
  // 한 연 안에서 두 줄 이상 묶음이 바로 되풀이되면 (A A) 나눠 둔다
  blocks = blocks.flatMap(b => {
    for (let len = 2; len <= b.length / 2; len++) { // 한 줄 되풀이(할렐루야 할렐루야)는 그대로
      if (b.length % len) continue;
      const unit = b.slice(0, len).map(keyOf).join('|');
      if (b.every((l, i) => keyOf(l) === keyOf(b[i % len])) && unit) return Array.from({ length: b.length / len }, () => b.slice(0, len));
    }
    return [b];
  });
  // 한 번만 나오는 묶음이 이어지면 한 절로 합친다 (지니처럼 두 줄마다 빈 줄인 가사) — 묶음은 슬라이드 경계로 남긴다
  const bKey = b => b.map(keyOf).join('|');
  const bCount = new Map();
  for (const b of blocks) bCount.set(bKey(b), (bCount.get(bKey(b)) || 0) + 1);
  const groups = [];
  for (const b of blocks) {
    const g = groups[groups.length - 1];
    if (bCount.get(bKey(b)) === 1 && g && g.once) g.parts.push(b);
    else groups.push({ once: bCount.get(bKey(b)) === 1, parts: [b] });
  }
  const seq = groups.map(g => g.parts.map(bKey).join('||'));
  const uniq = [...new Set(seq)];
  const count = new Map(uniq.map(k => [k, seq.filter(x => x === k).length]));
  const textOf = new Map(seq.map((k, i) => [k, groups[i].parts]));
  // 이름표
  const label = new Map();
  const rep = uniq.filter(k => count.get(k) > 1).sort((a, b) => count.get(b) - count.get(a) || seq.indexOf(a) - seq.indexOf(b));
  if (rep.length) {
    const chorus = rep[0];
    label.set(chorus, '후렴');
    let extra = 1;
    for (const k of rep.slice(1)) {
      // 늘 후렴 바로 앞에 오면 프리코러스
      const idx = seq.map((x, i) => (x === k ? i : -1)).filter(i => i >= 0);
      const nextOther = i => { let j = i + 1; while (j < seq.length && seq[j] === k) j++; return seq[j]; };
      const pre = idx.every(i => nextOther(i) === chorus) && ![...label.values()].includes('프리코러스');
      label.set(k, pre ? '프리코러스' : `후렴${++extra}`);
    }
  }
  // 마지막 후렴 뒤에 한 번만 나오는 짧은 끝맺음(두 줄 이하) = 엔딩
  const lastK = seq[seq.length - 1];
  if (rep.length && count.get(lastK) === 1 && seq.lastIndexOf(rep[0]) < seq.length - 1 && textOf.get(lastK).flat().length <= 2) label.set(lastK, '엔딩');
  let v = 0;
  for (const k of uniq) if (!label.has(k)) label.set(k, `${++v}절`);
  // 슬라이드: per 줄씩 고르게, 한 줄만 남으면 앞 슬라이드에 붙인다 (2줄씩: 3줄 → 3 · 5줄 → 3·2)
  const slides = ls => {
    const m = Math.max(1, ls.length % per === 1 && ls.length > per ? Math.floor(ls.length / per) : Math.ceil(ls.length / per));
    const out = [];
    let at = 0;
    for (let k = 0; k < m; k++) { const take = Math.ceil((ls.length - at) / (m - k)); out.push(ls.slice(at, at + take).join('\n')); at += take; }
    return out;
  };
  const lyricsText = uniq.map(k => `[${label.get(k)}]\n${textOf.get(k).flatMap(slides).join('\n\n')}`).join('\n\n');
  const order = seq.map(k => label.get(k));
  const plain = order.join(' ') === uniq.map(k => label.get(k)).join(' ');
  return { lyrics: lyricsText, arrangement: plain ? '' : order.join(' ') };
}

module.exports = { search, lyrics, arrange, SITES };
