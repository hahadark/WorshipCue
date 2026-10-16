'use strict';
// 큐시트(예배 순서) 항목 정의와 검증
//   bible  성경      { ref, versionId? }
//   song   찬양      { lyrics, showTitle?, credit? }   가사는 빈 줄로 슬라이드 구분, [1절] 같은 줄은 표시하지 않음
//   text   공지·글    { body }                         --- 줄로 슬라이드 구분
//   title  제목 카드  { subtitle }                     예: 대표기도 / 홍길동 집사
//   image  이미지     { image }
//   blank  빈 화면    { mode: 'black' | 'background' }
// 공통: id, type, title, note(조작자 메모)

const TYPES = ['bible', 'song', 'text', 'title', 'image', 'blank', 'hymn', 'audio'];
const TYPE_NAMES = { bible: '성경', song: '찬양', text: '공지', title: '제목', image: '이미지', blank: '빈 화면', hymn: '찬송가', audio: '음악' };

const str = (v, max = 20000) => String(v ?? '').slice(0, max);

function newId(prefix = 'i') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalizeItem(x) {
  if (!x || !TYPES.includes(x.type)) throw new Error('알 수 없는 항목 종류입니다.');
  const it = { id: /^[a-z0-9]{4,40}$/i.test(x.id || '') ? x.id : newId(), type: x.type, title: str(x.title, 200).trim(), note: str(x.note, 1000) };
  switch (x.type) {
    case 'bible': it.ref = str(x.ref, 200).trim(); it.versionId = str(x.versionId, 40); break;
    case 'song': it.lyrics = str(x.lyrics); it.showTitle = !!x.showTitle; it.credit = str(x.credit, 300); it.songId = str(x.songId, 60); break;
    case 'audio': it.file = str(x.file, 1500); it.volume = Math.max(0, Math.min(1, Number(x.volume ?? 1) || 0)); it.loop = !!x.loop; it.fadeOnLeave = x.fadeOnLeave !== false; break;
    case 'text': it.body = str(x.body); break;
    case 'title': it.subtitle = str(x.subtitle, 300); break;
    case 'image': it.image = str(x.image, 300); break;
    case 'blank': it.mode = x.mode === 'background' ? 'background' : 'black'; break;
    case 'hymn':
      it.file = str(x.file, 1000); it.number = Number.isFinite(+x.number) ? +x.number : null;
      it.background = str(x.background, 300) || 'default'; // default(설정 기본값) | original | template | 이미지 주소
      it.obsLyrics = str(x.obsLyrics); // OBS 자막(가사만) 직접 입력: 슬라이드마다 빈 줄로 구분. 비우면 자동
      break;
  }
  // 순서별 배경 이미지·템플릿 (글자 순서)
  if (['song', 'text', 'title', 'bible'].includes(x.type)) it.bg = str(x.bg, 1500);
  it.tplMain = str(x.tplMain, 80);
  it.tplOverlay = str(x.tplOverlay, 80);
  if (!it.title) it.title = TYPE_NAMES[x.type];
  return it;
}

function normalizeCue(c) {
  if (!c || !String(c.name || '').trim()) throw new Error('큐시트 이름을 입력하세요.');
  return {
    id: /^[a-z0-9]{4,40}$/i.test(c.id || '') ? c.id : newId('c'),
    name: str(c.name, 200).trim(),
    serviceDate: /^\d{4}-\d{2}-\d{2}$/.test(c.serviceDate || '') ? c.serviceDate : '',
    items: (Array.isArray(c.items) ? c.items : []).slice(0, 500).map(normalizeItem),
  };
}

/** 새 큐시트 기본 순서 (구세군 성결예배 예시) */
function sampleItems() {
  return [
    { type: 'title', title: '예배로 부름', subtitle: '' },
    { type: 'song', title: '찬양', lyrics: '' },
    { type: 'title', title: '대표기도', subtitle: '' },
    { type: 'bible', title: '성경 봉독', ref: '시 23' },
    { type: 'title', title: '설교', subtitle: '' },
    { type: 'text', title: '광고', body: '' },
    { type: 'title', title: '축도', subtitle: '' },
    { type: 'blank', title: '빈 화면', mode: 'background' },
  ].map(x => ({ ...x, id: newId() }));
}

module.exports = { TYPES, TYPE_NAMES, normalizeItem, normalizeCue, newId, sampleItems };
