'use strict';
// 본문 정리와 검색용 정규화.

/** 표시용 본문 정리: HTML/XML 태그만 제거하고 맞춤법·구두점은 보존한다. */
function cleanDisplayText(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-zA-Z][^<>]*>/g, '') // 태그 형태만 제거 (부등호 단독 문자는 보존)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** 검색용 정규화: 구두점 제거, 공백 정리, 소문자화 */
function searchNormalize(s) {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 띄어쓰기 차이를 무시한 검색용 문자열 */
function compact(s) {
  return searchNormalize(s).replace(/\s+/g, '');
}

module.exports = { cleanDisplayText, searchNormalize, compact };
