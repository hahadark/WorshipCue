; WorshipCue 설치 마지막에 베들레헴 성경 설치를 안내한다 (조용한 설치(/S)에서는 건너뜀)
!macro customInstall
  IfSilent bc_bethlehem_skip
  MessageBox MB_YESNO|MB_ICONINFORMATION "WorshipCue 에는 개역한글 성경이 기본으로 들어 있습니다.$\r$\n$\r$\n개역개정 · 쉬운성경 · 우리말성경 · 현대인의성경 · ESV · NIV 등을 쓰려면$\r$\n  1. '베들레헴 성경'을 설치하고 (BethlehemWin 폴더를 C:\BethlehemWin 처럼 드라이브 맨 위에 복사)$\r$\n  2. WorshipCue 설정 → 성경 데이터 → [자동으로 찾기] 를 누르면 됩니다.$\r$\n$\r$\n베들레헴 성경 설치 안내 페이지를 지금 열까요?" IDNO bc_bethlehem_skip
  ExecShell "open" "https://bethlehembible.org/setup/#%EC%9C%88%EB%8F%84%EC%9A%B0"
  bc_bethlehem_skip:
!macroend
