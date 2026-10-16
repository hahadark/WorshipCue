'use strict';
// PowerPoint 97-2003 (.ppt / .pps) 읽기 — 그림(악보·배경)과 슬라이드 글자만 꺼낸다.
// 파일은 OLE 복합 문서(CFB): 'Pictures' 스트림에 그림, 'PowerPoint Document' 스트림에 글자가 있다.

const fs = require('fs');

// ---------- OLE 복합 문서(CFB) 읽기 ----------
const FREESECT = 0xFFFFFFFF, ENDOFCHAIN = 0xFFFFFFFE;

function readCfb(buf) {
  if (buf.readUInt32LE(0) !== 0xE011CFD0 || buf.readUInt32LE(4) !== 0xE11AB1A1) throw new Error('PowerPoint 97-2003(.ppt/.pps) 파일이 아닙니다.');
  const secSize = 1 << buf.readUInt16LE(30);
  const miniSize = 1 << buf.readUInt16LE(32);
  const dirStart = buf.readUInt32LE(48);
  const miniCutoff = buf.readUInt32LE(56);
  const miniFatStart = buf.readUInt32LE(60);
  const difatStart = buf.readUInt32LE(68);
  const sector = n => buf.subarray(512 + n * secSize, 512 + (n + 1) * secSize);

  // FAT 섹터 목록 (헤더의 109개 + DIFAT 체인)
  const fatSecs = [];
  for (let i = 0; i < 109; i++) { const s = buf.readUInt32LE(76 + i * 4); if (s !== FREESECT) fatSecs.push(s); }
  for (let d = difatStart, guard = 0; d !== ENDOFCHAIN && d !== FREESECT && guard < 10000; guard++) {
    const sec = sector(d);
    for (let i = 0; i < secSize / 4 - 1; i++) { const s = sec.readUInt32LE(i * 4); if (s !== FREESECT) fatSecs.push(s); }
    d = sec.readUInt32LE(secSize - 4);
  }
  const fat = [];
  for (const s of fatSecs) { const sec = sector(s); for (let i = 0; i < secSize / 4; i++) fat.push(sec.readUInt32LE(i * 4)); }
  const chain = (start, table) => {
    const out = [];
    for (let s = start, guard = 0; s !== ENDOFCHAIN && s !== FREESECT && s < table.length && guard < 1e6; guard++) { out.push(s); s = table[s]; }
    return out;
  };
  const readChain = (start, size) => {
    const parts = chain(start, fat).map(sector);
    return Buffer.concat(parts).subarray(0, size ?? undefined);
  };

  // 디렉터리
  const dirBuf = readChain(dirStart);
  const entries = [];
  for (let o = 0; o + 128 <= dirBuf.length; o += 128) {
    const nameLen = dirBuf.readUInt16LE(o + 64);
    const name = dirBuf.subarray(o, o + Math.max(0, nameLen - 2)).toString('utf16le');
    entries.push({ name, type: dirBuf[o + 66], start: dirBuf.readUInt32LE(o + 116), size: dirBuf.readUInt32LE(o + 120) });
  }
  const root = entries[0];
  const miniStream = root ? readChain(root.start, root.size) : Buffer.alloc(0);
  const miniFat = [];
  if (miniFatStart !== ENDOFCHAIN) {
    const mf = readChain(miniFatStart);
    for (let i = 0; i < mf.length / 4; i++) miniFat.push(mf.readUInt32LE(i * 4));
  }
  return {
    names: entries.filter(e => e.type === 2).map(e => e.name),
    stream(name) {
      const e = entries.find(x => x.type === 2 && x.name === name);
      if (!e) return null;
      if (e.size < miniCutoff) {
        return Buffer.concat(chain(e.start, miniFat).map(s => miniStream.subarray(s * miniSize, (s + 1) * miniSize))).subarray(0, e.size);
      }
      return readChain(e.start, e.size);
    },
  };
}

// ---------- 그림 ----------
const BLIP = { 0xF01E: 'png', 0xF01D: 'jpg', 0xF02A: 'jpg' };
const SIG = { png: Buffer.from([0x89, 0x50, 0x4E, 0x47]), jpg: Buffer.from([0xFF, 0xD8, 0xFF]) };

function pictures(cfb) {
  const pics = cfb.stream('Pictures');
  const out = [];
  if (!pics) return out;
  for (let off = 0; off + 8 <= pics.length;) {
    const type = pics.readUInt16LE(off + 2);
    const len = pics.readUInt32LE(off + 4);
    const body = pics.subarray(off + 8, off + 8 + len);
    const ext = BLIP[type];
    if (ext) {
      const k = body.indexOf(SIG[ext]);
      if (k >= 0 && k < 64) out.push({ ext, data: body.subarray(k) });
    }
    off += 8 + len;
  }
  return out;
}

/** PNG 가로·세로 (머리 IHDR) */
function pngSize(data) {
  return data.length > 24 ? { w: data.readUInt32BE(16), h: data.readUInt32BE(20) } : { w: 0, h: 0 };
}

// ---------- 슬라이드 글자 ----------
// 'PowerPoint Document' 의 SlideListWithText(슬라이드용) 안에서 SlidePersistAtom 마다 글자 상자들을 모은다
function slideTexts(cfb) {
  const doc = cfb.stream('PowerPoint Document');
  if (!doc) return [];
  const slides = [];
  const walk = (start, end, inSlideList) => {
    for (let o = start; o + 8 <= end;) {
      const verInst = doc.readUInt16LE(o);
      const type = doc.readUInt16LE(o + 2);
      const len = doc.readUInt32LE(o + 4);
      const ver = verInst & 0xF, inst = verInst >> 4;
      const body = o + 8, next = body + len;
      if (next > end) break;
      if (type === 0x0FF0 && ver === 0xF) {
        if (inst === 0) walk(body, next, true); // 슬라이드 목록 (0: 슬라이드, 1: 마스터, 2: 노트)
      } else if (inSlideList && type === 0x03F3) {
        slides.push([]);
      } else if (inSlideList && (type === 0x0FA0 || type === 0x0FA8) && slides.length) {
        const t = type === 0x0FA0 ? doc.subarray(body, next).toString('utf16le') : doc.subarray(body, next).toString('latin1');
        const clean = t.replace(/\r/g, '\n').replace(/\u000b/g, '\n').trim();
        if (clean) slides[slides.length - 1].push(clean);
      } else if (ver === 0xF && !inSlideList) {
        walk(body, next, false);
      }
      o = next;
    }
  };
  walk(0, doc.length, false);
  if (slides.some(s => s.length)) return slides;

  // 새 PowerPoint 로 저장한 파일: 글자가 각 슬라이드(SlideContainer)의 도형 안에 있다
  const bySlide = [];
  const collect = (start, end, acc) => {
    for (let o = start; o + 8 <= end;) {
      const verInst = doc.readUInt16LE(o);
      const type = doc.readUInt16LE(o + 2);
      const len = doc.readUInt32LE(o + 4);
      const body = o + 8, next = body + len;
      if (next > end) break;
      if ((verInst & 0xF) === 0xF) collect(body, next, acc);
      else if (type === 0x0FA0 || type === 0x0FA8) {
        const t = type === 0x0FA0 ? doc.subarray(body, next).toString('utf16le') : doc.subarray(body, next).toString('latin1');
        const clean = t.replace(/\r/g, '\n').replace(/\u000b/g, '\n').trim();
        if (clean) acc.push(clean);
      }
      o = next;
    }
  };
  const top = (start, end) => {
    for (let o = start; o + 8 <= end;) {
      const verInst = doc.readUInt16LE(o);
      const type = doc.readUInt16LE(o + 2);
      const len = doc.readUInt32LE(o + 4);
      const body = o + 8, next = body + len;
      if (next > end) break;
      if (type === 0x03EE && (verInst & 0xF) === 0xF) { const acc = []; collect(body, next, acc); bySlide.push(acc); } // SlideContainer
      o = next;
    }
  };
  top(0, doc.length);
  return bySlide.length ? bySlide : slides;
}

/**
 * .pps/.ppt → { background, scores[], texts[][] }
 * 찬송가 파일: 첫 그림 = 배경(4:3), 나머지 = 투명 악보(16:9) 순서대로
 * 교독문 파일: 그림 1장 = 배경, 글자는 슬라이드마다
 */
function extractPps(file) {
  const cfb = readCfb(fs.readFileSync(file));
  const pics = pictures(cfb);
  const texts = slideTexts(cfb);
  let background = null;
  let scores = pics;
  if (pics.length >= 1) {
    const first = pngSize(pics[0].data);
    const opaqueBg = pics[0].ext === 'jpg' || (first.w && first.w / first.h < 1.5); // 4:3 배경
    if (pics.length === 1 || opaqueBg) { background = pics[0]; scores = pics.slice(1); }
  }
  return { background, scores, texts };
}

module.exports = { readCfb, extractPps, slideTexts, pictures };
