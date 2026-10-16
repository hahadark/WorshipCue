'use strict';
// 테스트용 합성 성경 데이터 (실제 본문 아님)
const { BOOKS } = require('../src/core/books');
const SPECIAL = {
  '43:3:16': '하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니',
  '44:5:29': '베드로와 사도들이 대답하여 가로되 사람보다 하나님을 순종하는 것이 마땅하니라',
  '45:8:28': '하나님을 사랑하는 자 곧 그 뜻대로 부르심을 입은 자들에게는 모든 것이 합력하여 선을 이루느니라',
};
function makeFixture(versesPerChapter = 40) {
  const verses = [];
  for (const b of BOOKS) for (let c = 1; c <= b.chapters; c++) for (let v = 1; v <= versesPerChapter; v++) {
    verses.push({ book: b.id, chapter: c, verse: v, text: SPECIAL[`${b.id}:${c}:${v}`] || `${b.name} ${c}장 ${v}절 테스트 본문입니다.` });
  }
  return { version: { id: 'test', name: '테스트역', language: 'ko', copyright: '없음', license: '테스트 전용', source: 'tests/fixture.js' }, verses, headings: [{ book: 1, chapter: 1, verse: 1, text: '천지 창조' }] };
}
module.exports = { makeFixture };
