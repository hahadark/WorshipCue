'use strict';
// 개신교 성경 66권 정의. chapters 값은 개역 계열 표준 장 수(가져오기 검증 시 경고용).

const RAW = [
  // id, 정식 명칭, 표준 약어, 추가 별칭, OSIS, 영문명, 장 수
  [1, '창세기', '창', ['창세'], 'Gen', 'Genesis', 50],
  [2, '출애굽기', '출', ['출애굽'], 'Exod', 'Exodus', 40],
  [3, '레위기', '레', ['레위'], 'Lev', 'Leviticus', 27],
  [4, '민수기', '민', ['민수'], 'Num', 'Numbers', 36],
  [5, '신명기', '신', ['신명'], 'Deut', 'Deuteronomy', 34],
  [6, '여호수아', '수', [], 'Josh', 'Joshua', 24],
  [7, '사사기', '삿', ['사사'], 'Judg', 'Judges', 21],
  [8, '룻기', '룻', [], 'Ruth', 'Ruth', 4],
  [9, '사무엘상', '삼상', ['사무엘상서'], '1Sam', '1 Samuel', 31],
  [10, '사무엘하', '삼하', ['사무엘하서'], '2Sam', '2 Samuel', 24],
  [11, '열왕기상', '왕상', [], '1Kgs', '1 Kings', 22],
  [12, '열왕기하', '왕하', [], '2Kgs', '2 Kings', 25],
  [13, '역대상', '대상', ['역대기상'], '1Chr', '1 Chronicles', 29],
  [14, '역대하', '대하', ['역대기하'], '2Chr', '2 Chronicles', 36],
  [15, '에스라', '스', [], 'Ezra', 'Ezra', 10],
  [16, '느헤미야', '느', [], 'Neh', 'Nehemiah', 13],
  [17, '에스더', '에', [], 'Esth', 'Esther', 10],
  [18, '욥기', '욥', [], 'Job', 'Job', 42],
  [19, '시편', '시', [], 'Ps', 'Psalms', 150],
  [20, '잠언', '잠', [], 'Prov', 'Proverbs', 31],
  [21, '전도서', '전', [], 'Eccl', 'Ecclesiastes', 12],
  [22, '아가', '아', ['아가서'], 'Song', 'Song of Songs', 8],
  [23, '이사야', '사', [], 'Isa', 'Isaiah', 66],
  [24, '예레미야', '렘', [], 'Jer', 'Jeremiah', 52],
  [25, '예레미야애가', '애', ['애가'], 'Lam', 'Lamentations', 5],
  [26, '에스겔', '겔', [], 'Ezek', 'Ezekiel', 48],
  [27, '다니엘', '단', [], 'Dan', 'Daniel', 12],
  [28, '호세아', '호', [], 'Hos', 'Hosea', 14],
  [29, '요엘', '욜', [], 'Joel', 'Joel', 3],
  [30, '아모스', '암', [], 'Amos', 'Amos', 9],
  [31, '오바댜', '옵', [], 'Obad', 'Obadiah', 1],
  [32, '요나', '욘', [], 'Jonah', 'Jonah', 4],
  [33, '미가', '미', [], 'Mic', 'Micah', 7],
  [34, '나훔', '나', [], 'Nah', 'Nahum', 3],
  [35, '하박국', '합', [], 'Hab', 'Habakkuk', 3],
  [36, '스바냐', '습', [], 'Zeph', 'Zephaniah', 3],
  [37, '학개', '학', [], 'Hag', 'Haggai', 2],
  [38, '스가랴', '슥', [], 'Zech', 'Zechariah', 14],
  [39, '말라기', '말', [], 'Mal', 'Malachi', 4],
  [40, '마태복음', '마', ['마태'], 'Matt', 'Matthew', 28],
  [41, '마가복음', '막', ['마가'], 'Mark', 'Mark', 16],
  [42, '누가복음', '눅', ['누가'], 'Luke', 'Luke', 24],
  [43, '요한복음', '요', [], 'John', 'John', 21],
  [44, '사도행전', '행', ['사도'], 'Acts', 'Acts', 28],
  [45, '로마서', '롬', [], 'Rom', 'Romans', 16],
  [46, '고린도전서', '고전', [], '1Cor', '1 Corinthians', 16],
  [47, '고린도후서', '고후', [], '2Cor', '2 Corinthians', 13],
  [48, '갈라디아서', '갈', [], 'Gal', 'Galatians', 6],
  [49, '에베소서', '엡', [], 'Eph', 'Ephesians', 6],
  [50, '빌립보서', '빌', [], 'Phil', 'Philippians', 4],
  [51, '골로새서', '골', [], 'Col', 'Colossians', 4],
  [52, '데살로니가전서', '살전', [], '1Thess', '1 Thessalonians', 5],
  [53, '데살로니가후서', '살후', [], '2Thess', '2 Thessalonians', 3],
  [54, '디모데전서', '딤전', [], '1Tim', '1 Timothy', 6],
  [55, '디모데후서', '딤후', [], '2Tim', '2 Timothy', 4],
  [56, '디도서', '딛', [], 'Titus', 'Titus', 3],
  [57, '빌레몬서', '몬', [], 'Phlm', 'Philemon', 1],
  [58, '히브리서', '히', [], 'Heb', 'Hebrews', 13],
  [59, '야고보서', '약', [], 'Jas', 'James', 5],
  [60, '베드로전서', '벧전', [], '1Pet', '1 Peter', 5],
  [61, '베드로후서', '벧후', [], '2Pet', '2 Peter', 3],
  [62, '요한일서', '요일', ['요한1서'], '1John', '1 John', 5],
  [63, '요한이서', '요이', ['요한2서'], '2John', '2 John', 1],
  [64, '요한삼서', '요삼', ['요한3서'], '3John', '3 John', 1],
  [65, '유다서', '유', [], 'Jude', 'Jude', 1],
  [66, '요한계시록', '계', ['계시록'], 'Rev', 'Revelation', 22],
];

const BOOKS = RAW.map(([id, name, short, aliases, osis, en, chapters]) => ({
  id, name, short, aliases, osis, en, chapters,
  testament: id <= 39 ? 'OT' : 'NT',
  singleChapter: chapters === 1,
}));

const byId = new Map(BOOKS.map(b => [b.id, b]));

function key(s) {
  return String(s).normalize('NFC').toLowerCase().replace(/[\s.]+/g, '');
}

// 정확히 일치하는 이름(정식 명칭·표준 약어·별칭·OSIS·영문명) → 책
const exact = new Map();
for (const b of BOOKS) {
  for (const n of [b.name, b.short, ...b.aliases, b.osis, b.en]) {
    const k = key(n);
    if (!exact.has(k)) exact.set(k, b);
  }
}

/**
 * 책 이름 해석.
 * 표준 약어/정식 명칭이 정확히 일치하면 그 책, 아니면 접두어로 후보를 찾는다.
 * 후보가 여럿이면 임의로 고르지 않고 candidates 로 돌려준다.
 */
function resolveBook(input) {
  const k = key(input);
  if (!k) return { book: null, candidates: [] };
  if (exact.has(k)) return { book: exact.get(k), candidates: [] };
  const seen = new Set();
  const candidates = [];
  for (const b of BOOKS) {
    const names = [b.name, b.short, ...b.aliases, b.en, b.osis].map(key);
    if (names.some(n => n.startsWith(k)) && !seen.has(b.id)) {
      seen.add(b.id);
      candidates.push(b);
    }
  }
  if (candidates.length === 1) return { book: candidates[0], candidates: [] };
  return { book: null, candidates };
}

function getBook(id) {
  return byId.get(Number(id)) || null;
}

module.exports = { BOOKS, resolveBook, getBook, bookKey: key };
