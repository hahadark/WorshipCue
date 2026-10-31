'use strict';
// 찬양 가져오기: 다른 프로그램의 찬양 파일 → 찬양 라이브러리 형식 { title, lyrics, credit, arrangement }
//   OpenLyrics XML (OpenLP 내보내기 .xml) · ChordPro (.cho .chordpro .chopro .crd) · ProPresenter 6 (.pro6)
//   PowerPoint (.pptx · .ppt · .pps · .ppsx 의 글자) · 글 (.txt)
// 가사 형식: 빈 줄 = 슬라이드, [1절] [후렴] 이름표 줄, 코드는 [G] 처럼 (워십프리젠터 와 같음)

const fs = require('fs');
const path = require('path');

const xmlText = s => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const base = file => path.basename(file).replace(/\.[^.]+$/, '');
const clean = t => String(t || '').replace(/\r/g, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

/** 이름표: v1 → 1절, c → 후렴, b → 브릿지 … (OpenLyrics·ProPresenter·ChordPro 공통) */
function labelOf(name) {
  const n = String(name || '').trim();
  let m;
  if ((m = /^(?:v|verse|절)\s*(\d+)?[a-z]?$/i.exec(n))) return (m[1] || '1') + '절';
  if ((m = /^verse\s+(\d+)/i.exec(n))) return m[1] + '절';
  if ((m = /^(\d+)\s*절$/.exec(n))) return m[1] + '절';
  if (/^(c|chorus|refrain|후렴)\s*\d*[a-z]?$/i.test(n) || /^chorus/i.test(n)) return '후렴';
  if (/^(b|bridge|브릿지|브리지)\s*\d*$/i.test(n) || /^bridge/i.test(n)) return '브릿지';
  if (/^(p|pre-?chorus|프리코러스)\s*\d*$/i.test(n)) return '프리코러스';
  if (/^(i|intro|인트로|전주)\s*\d*$/i.test(n)) return '전주';
  if (/^(e|o|ending|outro|tag|엔딩|마무리)\s*\d*$/i.test(n)) return '엔딩';
  return n.slice(0, 20);
}

// ---------------- OpenLyrics (OpenLP) ----------------
function parseOpenLyrics(xml, file) {
  const tag = (re) => { const m = re.exec(xml); return m ? xmlText(m[1]).trim() : ''; };
  const title = tag(/<title[^>]*>([\s\S]*?)<\/title>/i) || base(file);
  const authors = [...xml.matchAll(/<author[^>]*>([\s\S]*?)<\/author>/gi)].map(m => xmlText(m[1]).trim()).filter(Boolean);
  const copyright = tag(/<copyright>([\s\S]*?)<\/copyright>/i);
  const ccli = tag(/<ccliNo>([\s\S]*?)<\/ccliNo>/i);
  const names = new Map(); // v1 → 1절 (OpenLyrics 이름 → 우리 이름표)
  const blocks = [];
  for (const m of xml.matchAll(/<verse\b([^>]*)>([\s\S]*?)<\/verse>/gi)) {
    const nm = (/name="([^"]*)"/i.exec(m[1]) || [])[1] || '';
    const label = labelOf(nm);
    names.set(nm.toLowerCase(), label);
    const parts = [...m[2].matchAll(/<lines\b[^>]*>([\s\S]*?)<\/lines>/gi)].map(x => clean(xmlText(x[1].replace(/<chord\s+name="([^"]+)"\s*\/>/gi, '[$1]'))));
    const slides = parts.filter(Boolean);
    if (!slides.length) continue;
    blocks.push(`[${label}]\n${slides.join('\n\n')}`);
  }
  // 같은 이름표가 두 번 이상이면 (v1a·v1b 처럼 나뉜 것) 이름표는 처음만
  const seen = new Set();
  const lyrics = blocks.map(b => { const l = b.split('\n')[0]; if (seen.has(l)) return b.split('\n').slice(1).join('\n'); seen.add(l); return b; }).join('\n\n');
  const order = tag(/<verseOrder>([\s\S]*?)<\/verseOrder>/i).split(/\s+/).filter(Boolean).map(t => names.get(t.toLowerCase()) || labelOf(t));
  const arrangement = order.filter((t, k) => !(k > 0 && t === order[k - 1] && /절$/.test(t))).join(' ');
  return [{ title, lyrics: clean(lyrics), credit: [authors.join(', '), copyright, ccli && `CCLI ${ccli}`].filter(Boolean).join(' · '), arrangement }];
}

// ---------------- ChordPro ----------------
function parseChordPro(text, file) {
  let title = '', artist = '', copyright = '', ccli = '';
  const out = [];
  let verseNo = 0;
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const d = /^\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}$/i.exec(line.trim());
    if (d) {
      const k = d[1].toLowerCase(), v = (d[2] || '').trim();
      if (k === 'title' || k === 't') title = v;
      else if (['artist', 'composer', 'lyricist', 'subtitle', 'st'].includes(k)) artist = artist ? artist + ', ' + v : v;
      else if (k === 'copyright') copyright = v;
      else if (k === 'ccli') ccli = v;
      else if (['start_of_chorus', 'soc'].includes(k)) out.push('', `[${v ? labelOf(v) : '후렴'}]`);
      else if (['start_of_verse', 'sov'].includes(k)) out.push('', `[${v ? labelOf(v) : ++verseNo + '절'}]`);
      else if (['start_of_bridge', 'sob'].includes(k)) out.push('', '[브릿지]');
      else if (['comment', 'c', 'comment_italic', 'ci', 'comment_box', 'cb'].includes(k) && v) {
        const l = labelOf(v);
        if (/절$|후렴|브릿지|전주|엔딩|프리코러스/.test(l)) { if (/절$/.test(l)) verseNo = parseInt(l, 10) || verseNo; out.push('', `[${l}]`); }
      } else if (['chorus'].includes(k)) out.push('', '[후렴]');
      continue; // 그 밖의 지시어(키·카포·끝 표시)는 버림
    }
    if (/^#/.test(line.trim())) continue; // 주석
    out.push(line);
  }
  return [{ title: title || base(file), lyrics: clean(out.join('\n')), credit: [artist, copyright, ccli && `CCLI ${ccli}`].filter(Boolean).join(' · '), arrangement: '' }];
}

// ---------------- ProPresenter 6 (.pro6, XML + RTF/글) ----------------
function rtfToText(rtf) {
  let s = String(rtf);
  s = s.replace(/\\par[d]?\b ?/g, '\n').replace(/\\line\b ?/g, '\n').replace(/\\tab\b ?/g, ' ');
  s = s.replace(/\\u(-?\d+)\??/g, (m, n) => { let c = +n; if (c < 0) c += 65536; return String.fromCharCode(c); });
  s = s.replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
  // 글꼴·색 표 같은 머리 그룹 지우기
  s = s.replace(/\{\\(?:fonttbl|colortbl|stylesheet|\*)[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '');
  s = s.replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
  return s.replace(/\n{2,}/g, '\n').trim();
}
function parsePro6(xml, file) {
  const attr = (re) => { const m = re.exec(xml); return m ? xmlText(m[1]).trim() : ''; };
  const title = attr(/CCLISongTitle="([^"]*)"/) || base(file);
  const credit = [attr(/CCLIAuthor="([^"]*)"/), attr(/CCLIPublisher="([^"]*)"/), attr(/CCLISongNumber="([^"]*)"/) && 'CCLI ' + attr(/CCLISongNumber="([^"]*)"/)].filter(Boolean).join(' · ');
  const blocks = [];
  for (const g of xml.matchAll(/<RVSlideGrouping\b([^>]*)>([\s\S]*?)<\/RVSlideGrouping>/g)) {
    const label = labelOf(xmlText((/name="([^"]*)"/.exec(g[1]) || [])[1] || ''));
    const slides = [];
    for (const sl of g[2].matchAll(/<RVDisplaySlide\b[\s\S]*?<\/RVDisplaySlide>/g)) {
      const texts = [];
      for (const te of sl[0].matchAll(/<RVTextElement\b([^>]*)>([\s\S]*?)<\/RVTextElement>/g)) {
        const plain = /PlainText="([^"]*)"/.exec(te[1]) || /<NSString[^>]*rvXMLIvarName="PlainText"[^>]*>([^<]*)</.exec(te[2]);
        const rtf = /RTFData="([^"]*)"/.exec(te[1]) || /<NSString[^>]*rvXMLIvarName="RTFData"[^>]*>([^<]*)</.exec(te[2]);
        let t = '';
        try { if (plain && plain[1]) t = Buffer.from(plain[1], 'base64').toString('utf8'); else if (rtf && rtf[1]) t = rtfToText(Buffer.from(rtf[1], 'base64').toString('latin1')); } catch { /* 넘김 */ }
        if (t.trim()) texts.push(t.trim());
      }
      if (texts.length) slides.push(clean(texts.join('\n')));
    }
    if (slides.length) blocks.push(`[${label}]\n${slides.join('\n\n')}`);
  }
  if (!blocks.length) throw new Error('ProPresenter 파일에서 가사를 찾지 못했습니다 (ProPresenter 7 의 .pro 는 아직 못 읽습니다 — 텍스트·ChordPro 로 내보내 주세요).');
  return [{ title, lyrics: clean(blocks.join('\n\n')), credit, arrangement: '' }];
}

// ---------------- PowerPoint (글자만) ----------------
function parsePowerPoint(file) {
  let texts = [];
  if (/\.(pptx|ppsx)$/i.test(file)) texts = require('./pptrender').extractPptx(file).texts;
  else texts = require('./ppt').extractPps(file).texts;
  const slides = texts.map(t => clean((Array.isArray(t) ? t : [t]).join('\n'))).filter(Boolean);
  if (!slides.length) throw new Error('PPT 안에 글자가 없습니다 (악보 그림만 있는 PPT 는 찬송가·PPT 폴더로 쓰세요).');
  // 첫 장이 제목 한 줄이면 제목으로
  let title = base(file).replace(/^\d+\s*[._-]?\s*/, '') || base(file);
  if (slides.length > 1 && !slides[0].includes('\n') && slides[0].length <= 40) title = slides.shift();
  return [{ title, lyrics: slides.join('\n\n'), credit: '', arrangement: '' }];
}

/**
 * 붙여넣은 글 → 찬양 목록. '# 제목' 줄마다 새 곡 (없으면 한 곡: 첫 줄이 짧으면 제목)
 * 가사에 [1절] 같은 이름표가 없으면 되풀이를 찾아 구간·슬라이드로 정리 (lines 줄씩)
 */
function parseSongText(text, { title: fallback = '', lines = 2 } = {}) {
  const { arrange } = require('./lyricsweb');
  const src = String(text || '').replace(/\r/g, '');
  const parts = [];
  if (/^#\s*\S/m.test(src)) {
    for (const chunk of src.split(/^(?=#\s*\S)/m)) {
      const m = /^#\s*(.+)\n?([\s\S]*)$/.exec(chunk.trim());
      if (m) parts.push({ title: m[1].trim(), body: m[2] });
    }
  } else {
    const ls = src.trim().split('\n');
    let title = fallback;
    if (!title && ls.length > 2 && ls[0].trim().length <= 40 && !ls[1].trim()) title = ls.shift().trim();
    parts.push({ title: title || (ls.find(l => l.trim()) || '').trim().slice(0, 40), body: ls.join('\n') });
  }
  return parts.map(x => { const r = arrange(x.body, { lines }); return { title: x.title.slice(0, 200), lyrics: r.lyrics, credit: '', arrangement: r.arrangement }; }).filter(x => x.title && x.lyrics.trim());
}

/** 파일 하나 → 찬양 목록 (보통 한 곡) */
function parseSongFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (['.pptx', '.ppsx', '.ppt', '.pps'].includes(ext)) return parsePowerPoint(file);
  const buf = fs.readFileSync(file);
  if (buf.length > 5 * 1024 * 1024) throw new Error('파일이 너무 큽니다.');
  let text = buf.toString('utf8').replace(/^﻿/, '');
  if (text.includes('�')) { try { text = new TextDecoder('euc-kr').decode(buf); } catch { /* 그대로 */ } }
  if (ext === '.pro6' || /<RVPresentationDocument/.test(text)) return parsePro6(text, file);
  if (ext === '.pro') throw new Error('ProPresenter 7 (.pro) 파일은 아직 못 읽습니다. ProPresenter 에서 텍스트나 ChordPro 로 내보내 주세요.');
  if (ext === '.xml' || /<song\b[^>]*openlyrics/i.test(text)) {
    if (!/<song\b/i.test(text)) throw new Error('OpenLyrics(OpenLP) 형식의 XML 이 아닙니다.');
    return parseOpenLyrics(text, file);
  }
  if (['.cho', '.chordpro', '.chopro', '.crd'].includes(ext) || /^\{\s*(title|t|soc|start_of_chorus)\b/im.test(text)) return parseChordPro(text, file);
  if (ext === '.txt') return /^#\s*\S/m.test(text) ? parseSongText(text) : [{ title: base(file), lyrics: clean(text), credit: '', arrangement: '' }]; // '# 제목' 이 있으면 여러 곡
  throw new Error('읽을 수 없는 형식입니다 (OpenLP .xml · ChordPro .cho · ProPresenter 6 .pro6 · PPT · .txt).');
}

const SONG_EXT = /\.(xml|cho|chordpro|chopro|crd|pro6|pro|pptx|ppsx|ppt|pps|txt)$/i;

module.exports = { parseSongFile, parseSongText, parseOpenLyrics, parseChordPro, parsePro6, rtfToText, labelOf, SONG_EXT };
