# WorshipCue — 이어서 작업하는 에이전트를 위한 핸드오프

교회 예배 순서(큐시트) 통합 송출 프로그램. Electron 44 + node:sqlite, 조작 화면은 바닐라 JS. 저장소 `hahadark/WorshipCue`.
사용자(hahadark)는 한국어로 대화하고, 설명·커밋 메시지·주석도 한국어로 쓴다. 데모 데이터는 홍길동·○○교회처럼 가상으로.

## 지키는 규칙 (꼭)

- **커밋 작성자**: `git -c user.name=hahadark -c user.email=29118505+hahadark@users.noreply.github.com commit …`
  커밋 메시지 끝에 `Co-Authored-By: Claude <모델명> <noreply@anthropic.com>` 한 줄. PR 본문 끝에는 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **빌드·릴리스·푸시는 사용자가 시킬 때만.** 커밋은 작업 단위마다 해도 된다.
- **GitHub 에 절대 올리지 않는 것**: `data-personal/`(저작권 있는 번역본·찬송가 `.hdb`/`.cmp`), 개인용 빌드, `telemetry/.stats-key`. 모두 `.gitignore` 에 있다. 새찬송가 악보(`.cmp`, 100MB 넘음)도 저작권 때문에 저장소·공개 릴리스에 넣지 않는다.
- **개인용 빌드는 빌드할 때마다** `D:\OneDrive - The Salvation Army Korea Territory\첨부 파일\` 에 복사한다 (`WorshipCue-<버전>-개인용-Setup.exe` · `…-Portable.exe`). 옛 버전은 지우지 않는다. 이 폴더는 작업 폴더 밖이라 앱의 reveal_path 로 열리지 않는다.
- 사용자가 띄워 둔 WorshipCue 를 죽이지 않는다 (점검은 다른 포트·임시 데이터 폴더로).
- 사용자에게 보내는 파일(SendUserFile)은 30MB 미만.
- 줄 끝: 저장소 파일은 LF(일부 CRLF). 편집은 Edit 도구나 `\r\n` 을 보존하는 스크립트로. `sed` 로 `\n` 이스케이프가 든 JS 를 고치면 망가진다.

## 자주 쓰는 명령

| 할 일 | 명령 |
|---|---|
| 단위 테스트 (45개) | `npm test` (~1분) |
| 실제 프로그램 점검 (18개, 숨은 창) | `npm run test:e2e` (~3분, `tests/e2e/run.js` → `smoke.js`, 결과 `tests/e2e/out/`) |
| 영어 사전 | 문구 추가는 `i18n/en.json` 맨 앞(`{` 다음)에 넣는 스크립트로, 그 뒤 `node tools/i18n-build.js` → `src/web/shared/i18n-en.js`. 빠진 문구는 `node tools/i18n-extract.js` → `tools/i18n-missing.json` |
| 공개 릴리스 | `npm version X.Y.Z --no-git-tag-version` → 커밋 "X.Y.Z" → `git push` → `gh workflow run release.yml -f tag=vX.Y.Z -f ref=main` → `gh run watch <id>` → 초안 확인 → `gh release edit vX.Y.Z --draft=false --latest --notes-file <노트>` |
| 개인용 빌드 | `npx electron-builder --win --config build-personal.json --publish never` → `dist-personal/` → 원드라이브 첨부 파일 폴더로 복사 |
| 스크린샷 (디자인 점검) | `tests/e2e/run.js` 와 같은 방식: 임시 데이터 폴더로 앱을 띄우고 두 번째 Electron 에서 `offscreen` 창에 `/control/` 을 열어 `capturePage()` |

릴리스 워크플로(`.github/workflows/release.yml`)는 windows job 에서 `npm test` → `npm run test:e2e` → 한국어·영어 빌드, mac job 에서 dmg 를 만들어 **초안** 릴리스에 올린다. `gh release view` 에는 `isLatest` 가 없으니 `gh release list` 로 확인.

## 구조 한눈에

- `src/main/main.js` — Electron 메인 (창·보조 화면·업데이트·텔레메트리·동기화 시작·종료 시 `core.sync.stop()`)
- `src/core/core.js` — 코어. `core.commands` 는 객체 리터럴(`this` = core), 보조 함수는 모듈 수준에. 명령은 `/cmd` 로 조작 화면이 부른다(`window.BC.cmd(name, args)`).
  주요 모듈: `bulletin.js`(주보 → 큐시트 규칙 파서 `parseOrderText` · `planToCue`), `sermonpoints.js`(설교 원고 → 대지 → '제목' 순서, 규칙·오픈라우터·채팅 AI — 화면은 `control/points.js`), `preservice.js`(예배 전 화면 자동 만들기: 말씀카드 폴더 최근 묶음 · 설교쇼츠 '홈페이지 묶음' cardLine · QT 첫날 본문 → 슬라이드쇼, 화면은 `control/preservice.js`. `BCCue.addItem(type, { …, _at: 0 })` 으로 맨 앞에), `homefeed.js`(홈페이지 주보 JSON → 큐시트·광고 슬라이드, 화면은 `control/home.js`. 대구사랑교회 홈페이지 저장소 `sarmydglove/daegu-sarang-church` 의 `site/src/pages/bulletin/feed.json.ts` 가 그 JSON 을 낸다 — https://구세군대구사랑교회.kr/bulletin/feed.json), `usagelog.js`(사용 기록, 저작권 보고), `sync.js`(여러 PC 동기화 `WorshipCue-sync.json` · 하루 1회 백업·되돌리기), `hymnal.js`(베들레헴 찬송가 가사·악보), `presentation.js`, `server.js`(127.0.0.1:37528, SSE)
- DB: `bible.db` 하나에 성경 + 찬양 + 큐시트 + 사용 기록 (WAL). `data/`(공개) · `data-personal/`(개인)
- `src/web/control/` — 조작 화면. `index.html` 기본 틀, `dock.js`(dockview 패널 배치·작업공간), `menubar.js`(상단 메뉴), `ctxmenu.js`(오른쪽 클릭), `cue.js`(큐시트·편집칸·실행 취소), `library.js`, `settings.js`, `usage.js`, `ai.js`(주보 붙여 넣기 · AI), `control.css`
- `src/web/shared/` — `render.js`(슬라이드 그리기·카메라), `icons.js`(**Lucide 아이콘 92개**, `BCIcon('name')` · `BCIcon.type('bible')` · 정적 HTML 은 `<i data-icon="…">`), `i18n.js`(영어 화면 런타임: `[data-noi18n]` 은 번역 안 함, 따옴표 안 자리(“{1}”)는 사용자 글로 두고 번역 안 함)
- `src/web/output/`(예배당·OBS·무대 화면) · `src/web/remote/`(휴대폰 리모컨) · `src/web/splash/`
- `tests/core.test.js` · `tests/e2e/` · `tools/`(가져오기·i18n·아이콘 `make-icon.js`)
- 문서: `README.md`(한국어) · `README.en.md` · `docs/사용자설명서.md` · `docs/OBS설정가이드.md`. 메뉴를 바꾸면 README·설명서의 "메뉴 한눈에" 표도 같이 고친다.

## 디자인 규칙 (1.11.0 에서 정한 것)

- 아이콘은 이모지 대신 Lucide 선 아이콘 한 벌 (`src/web/shared/icons.js`). 새 아이콘이 필요하면 lucide 의 svg 안쪽을 PATHS 에 추가. 메뉴 항목은 `{ ic, label, key, run, sub }`.
- `control.css` 끝의 "조작 화면 디자인 정돈 (1.11)" 블록이 공통 규칙: 토큰(`--radius`, `--shadow`, `--ctl-h: 34px`), 단추 등급(`.primary` 파랑 채움 · `.ghost` · `.icon-btn`), 얇은 스크롤바, `.hgroup`(선택칸 묶음), 메뉴·오른쪽 클릭 메뉴는 `18px 아이콘 | 글 | 단축키` 세 칸.
- 메뉴 6개: 파일(문서·가져오기·기록·동기화·백업·설정) · 큐시트(실행 취소 · 순서 넣기 · 고른 순서) · 송출 · 보기 · 도구(라이브러리·리모컨·스트림덱) · 도움말. 같은 기능은 한 곳에만.
- 라이브러리 머리: 밑줄 탭 한 줄 + 오른쪽 ⌃ 로 검색·단추 줄 접기(`localStorage wc-lib-bar`), 520px 보다 좁으면 아이콘만.
- 화면 테마 6개(만나로·어둡게·고대비·밝게·따뜻하게·푸른 밤)는 :root 토큰으로만 색을 쓴다. 새 색을 직접 쓰지 말 것.
- **만나로 테마(1.12, 골라 쓰는 밝은 테마 — 사용자가 써 보고 눈이 아프다고 해서 기본은 다시 어둡게)**: control.css 맨 끝 블록. 만나로 스튜디오·설교쇼츠 편집기(F:\aside\sermon-shorts-app)와 같은 모양 — 바탕 #f2f3f7 · 흰 카드(독 그룹 16px 둥글게, 사이 10px 는 dock.js dockTheme()) · 남색 머리 줄(.menubar+.top 안에서는 밝은 글자 토큰으로 바꿔 씀, 안의 .suggest·.mb-drop 은 다시 밝은 토큰) · 파란 그라데이션 .primary · 분절 탭 고른 것은 남색. 넓은 요소 규칙(utton, 입력칸)은 :where() 로 우선순위를 낮춰 클래스 규칙을 덮지 않게 했다.
- 종류별 아이콘 색: --tc 를 [data-t](큐시트 .cue-ico) · [data-add](순서 넣기) · [data-tab](라이브러리 탭)에 준다. 큐 아이콘은 연한 색 바탕 칩.
- 글꼴: Pretendard Variable (src/web/shared/fonts/, OFL) — 모든 테마의 조작 화면. 송출 화면 글꼴과는 별개.

## 최근 흐름 (2026-10-29 기준)

- v1.9.0: 주보 순서 붙여 넣기(AI 없이) · 영어 화면에서 사용자 글 보호 · 카메라 안 닫히던 문제 · e2e 점검 추가
- v1.10.0: 앱 아이콘 · 📊 사용 기록(저작권 보고 CSV) · 여러 PC 동기화 · 자동 백업·되돌리기 · 큐 편집 Ctrl+Z/Y · 개인용에 악보(.cmp)
- v1.11.0: 조작 화면 디자인 정돈 (Lucide 아이콘 · 메뉴 재배치 · 상단/아래 줄/메뉴/오른쪽 클릭 모양 통일 · 라이브러리 머리 접기)
- (다음 판, 아직 릴리스 전) 만나로 테마 추가(기본은 어둡게 그대로 — 밝은 화면은 눈이 아프다는 사용자 판단) · Pretendard 글꼴 · 만나로에서 종류별 색 아이콘 · 남은 이모지 일부 정리 · 소스 실행 때도 창 아이콘

### 아직 실제로 확인하지 못한 것 / 다음 후보

- 여러 PC 동기화·백업은 한 PC 안에서 두 데이터 폴더로만 시험했다. 실제 두 PC + 원드라이브에서 검증 필요.
- 카메라는 가짜 카메라(`--use-fake-device-for-media-stream`)로만 점검했다.
- (1.12 에서 편집칸 배경 단추·카메라 표시·더보기 메뉴·무대 화면·리모컨·강조 단추는 아이콘으로 바꿈) 아직 이모지가 남은 곳: 빠른 설정의 배경 단추(`tplcontrols.js`), 오버레이 종류(`library.js OV_TYPES`), 오른쪽 클릭 메뉴의 테마 목록 `🌹`, 설정 화면 일부. 같은 아이콘 규칙으로 바꾸면 더 정돈된다.
- 연결 계획(쇼츠편집기 채팅에서 받은 목록, 사용자가 1번부터 차례로 하라고 함): ① 설교 포인트 슬라이드(완료, 다음 판) ② 광고·주보 연동(완료, 다음 판: 홈페이지 /bulletin/feed.json → 큐시트·광고) ③ 예배 전 대기 화면(완료, 다음 판: 큐시트 → 순서 넣기 → 예배 전 화면 자동 만들기) ④ 실시간 자막 ⑤ 예배 녹음·자동 정리 ⑥ 실시간 통역(낮음).
- 큐시트 패널의 "큐시트 · 성경 책" 독 탭 안에 다시 "큐시트(예배 순서) | 성경 책" 분절 탭이 있어 머리가 두 줄 — 하나로 합칠 여지.
- 사용자가 1.11.0 을 써 보고 눈에 걸리는 곳을 말해 줄 예정 — 그 피드백을 먼저 반영.
