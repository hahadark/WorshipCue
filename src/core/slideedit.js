'use strict';
// 슬라이드 편집 (FreeShow 방식): 슬라이드마다 글상자 위치·꾸미기, 덧붙인 글상자·그림·도형, 배경
//   큐시트 항목의 edits = { '*': 공통, '0': 첫 슬라이드, '1': … }  (키 = 원래 가사·글 덩어리 번호)
//   edit = {
//     box: { x, y, w, h }            본문 글상자 위치 (화면 %) — 없으면 템플릿 위치
//     style: { size, autoFit, color, bold, italic, align, valign, lineHeight, boxColor, boxOpacity, radius, padding, shadow }
//                                    size 는 1080 줄 화면 기준 px (화면 해상도에 맞춰 늘고 줄어든다)
//     hideMain: 본문 숨기기, allOutputs: 투명(OBS 자막) 출력에도 위치·꾸미기 적용
//     bg: 이 슬라이드 배경 (그림·영상 주소 또는 #색)
//     items: [{ id, type: text|image|shape, x, y, w, h, text, src, fit, fill, color, size, bold, italic, align, valign,
//               radius, opacity, padding, below }]   below = 본문 글자 뒤
//   }

const num = (v, a, b, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; };
const str = (v, max) => String(v ?? '').slice(0, max);
const color = v => (/^#[0-9a-f]{3,8}$/i.test(String(v || '')) ? String(v) : '');
const pick = (v, list) => (list.includes(v) ? v : '');

function rect(r) {
  if (!r || typeof r !== 'object') return null;
  const x = num(r.x, -50, 150, 0), y = num(r.y, -50, 150, 0);
  return { x, y, w: num(r.w, 1, 200, 50), h: num(r.h, 1, 200, 20) };
}

function style(s) {
  if (!s || typeof s !== 'object') return {};
  const o = {};
  if (s.size != null && s.size !== '') o.size = num(s.size, 8, 400, 72);
  if (typeof s.autoFit === 'boolean') o.autoFit = s.autoFit;
  if (color(s.color)) o.color = color(s.color);
  if (typeof s.bold === 'boolean') o.bold = s.bold;
  if (typeof s.italic === 'boolean') o.italic = s.italic;
  if (pick(s.align, ['left', 'center', 'right'])) o.align = s.align;
  if (pick(s.valign, ['top', 'middle', 'bottom'])) o.valign = s.valign;
  if (s.lineHeight != null && s.lineHeight !== '') o.lineHeight = num(s.lineHeight, 0.8, 3, 1.4);
  if (color(s.boxColor)) o.boxColor = color(s.boxColor);
  if (s.boxOpacity != null) o.boxOpacity = num(s.boxOpacity, 0, 1, 0.6);
  if (s.radius != null) o.radius = num(s.radius, 0, 400, 12);
  if (s.padding != null) o.padding = num(s.padding, 0, 300, 24);
  if (typeof s.shadow === 'boolean') o.shadow = s.shadow;
  return o;
}

function item(x, i) {
  if (!x || !['text', 'image', 'shape'].includes(x.type)) return null;
  const r = rect(x) || { x: 10, y: 10, w: 30, h: 20 };
  const o = {
    id: /^[a-z0-9]{2,30}$/i.test(x.id || '') ? x.id : 'e' + i + Math.random().toString(36).slice(2, 7),
    type: x.type, ...r,
    opacity: num(x.opacity, 0.05, 1, 1),
    radius: num(x.radius, 0, 1000, 0),
    below: !!x.below,
  };
  if (x.type === 'text') {
    Object.assign(o, {
      text: str(x.text, 2000), size: num(x.size, 8, 400, 60), color: color(x.color) || '#ffffff', fill: color(x.fill),
      bold: !!x.bold, italic: !!x.italic, align: pick(x.align, ['left', 'center', 'right']) || 'center',
      valign: pick(x.valign, ['top', 'middle', 'bottom']) || 'middle', padding: num(x.padding, 0, 300, 12),
    });
  } else if (x.type === 'image') {
    Object.assign(o, { src: str(x.src, 1500), fit: x.fit === 'contain' ? 'contain' : 'cover' });
  } else {
    Object.assign(o, { fill: color(x.fill) || '#1d3557', ellipse: !!x.ellipse });
  }
  return o;
}

/** 한 슬라이드의 편집 정리 (빈 편집이면 null) */
function normalizeEdit(e) {
  if (!e || typeof e !== 'object') return null;
  const o = {};
  const b = rect(e.box);
  if (b) o.box = b;
  const s = style(e.style);
  if (Object.keys(s).length) o.style = s;
  if (e.hideMain) o.hideMain = true;
  if (e.allOutputs) o.allOutputs = true;
  if (e.bg) o.bg = str(e.bg, 1500);
  const items = (Array.isArray(e.items) ? e.items : []).slice(0, 30).map(item).filter(Boolean);
  if (items.length) o.items = items;
  return Object.keys(o).length ? o : null;
}

/** 항목의 모든 슬라이드 편집 정리: 키는 '*' 또는 숫자 */
function normalizeEdits(edits) {
  if (!edits || typeof edits !== 'object' || Array.isArray(edits)) return undefined;
  const out = {};
  for (const k of Object.keys(edits).slice(0, 300)) {
    if (k !== '*' && !/^\d{1,4}$/.test(k)) continue;
    const e = normalizeEdit(edits[k]);
    if (e) out[k] = e;
  }
  return Object.keys(out).length ? out : undefined;
}

/** 공통('*') + 슬라이드별 편집 합치기 (슬라이드별이 우선, 덧붙인 것은 공통 → 슬라이드 순) */
function mergeEdit(edits, key) {
  if (!edits) return null;
  const a = edits['*'], b = key == null ? null : edits[String(key)];
  if (!a && !b) return null;
  if (!a || !b) return structuredClone(a || b);
  const o = { ...structuredClone(a), ...structuredClone(b) };
  o.style = { ...(a.style || {}), ...(b.style || {}) };
  o.items = [...(a.items || []), ...(b.items || [])];
  return o;
}

module.exports = { normalizeEdit, normalizeEdits, mergeEdit };
