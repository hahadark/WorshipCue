-- WorshipCue 익명 사용 통계 (D1)
CREATE TABLE IF NOT EXISTS pings (
  day TEXT NOT NULL,      -- YYYY-MM-DD (UTC)
  id TEXT NOT NULL,       -- 무작위 설치 번호
  version TEXT, lang TEXT, os TEXT, build TEXT, kind TEXT,
  PRIMARY KEY (day, id)
);
CREATE TABLE IF NOT EXISTS installs (
  id TEXT PRIMARY KEY,
  first TEXT NOT NULL     -- 처음 신호를 보낸 날
);
CREATE INDEX IF NOT EXISTS idx_installs_first ON installs(first);
