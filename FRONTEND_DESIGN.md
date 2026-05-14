# 현재 프론트엔드 구성 요소

## 공통

- 공통 스타일 파일: `styles.css`
- 학생용 스크립트: `dashboard.js`
- 관리용 스크립트: `management.js`
- 기본 배경색: `--canvas`
- 기본 글자색: `--ink`
- 기본 폰트: `Inter`, `Apple SD Gothic Neo`, `Malgun Gothic`, `system-ui`, `sans-serif`

## 색상 변수

- `--ink`: 본문 글자색
- `--muted`: 보조 글자색
- `--line`: 테두리 색
- `--panel`: 카드/패널 배경색
- `--canvas`: 페이지 배경색
- `--navy`: 진한 남색
- `--green`: 주요 강조색
- `--mint`: 배지 배경색
- `--gold`: hero 영역의 작은 강조 텍스트
- `--rose`: 일부 링크/강조 항목 색
- `--blue`: 보조 색상
- `--shadow`: 카드 그림자

## 학생 대시보드 페이지

파일: `index.html`

### Body

- `body.tv-screen`

### Header

- `header.hero`
- `nav.topbar`
- `div.hero-grid`
- `section.hero-copy`
- `section.teacher-card`

### Topbar 링크

- 오늘 일정
- 주번
- 청소
- 학급 정보
- 관리

### Hero 텍스트

- `p.eyebrow`: 미림마이스터고
- `h1`: 2반 학급 대시보드
- `p.hero-text`
- `div.hero-meta`
- `#live-date`
- `#school-day`

### 담임 선생님 카드

- `section.teacher-card`
- `p.section-kicker`
- `h2`: 김지훈 선생님
- 담당 교과
- 교무실
- 연락처
- Instagram

### Main

- `main.tv-main`

### 빠른 링크

- `section.quick-links`
- `a.quick-link`
- 자기 성찰
- 건의함
- 익명상담 게시판

### 오늘/예정/주번 영역

- `section#today.dashboard-grid.tv-top`
- `article.panel`
- `#today-list.task-list`
- `#upcoming-list.compact-list`
- `article#duties.panel`
- `#duty-card.duty-card`

표시 제목:

- 오늘의 일정
- 예정된 항목
- 주번

### 청소 분담 영역

- `section#cleaning.dashboard-grid.secondary.tv-middle`
- `article.panel.wide`
- `#cleaning-period.badge.muted`
- `#cleaning-grid.assignment-grid`
- `.assignment`

표시 제목:

- 청소 분담

### 학급 정보 영역

- `section#class-info.dashboard-grid.secondary.tv-bottom`
- `#roster-list.roster-list`

표시 제목:

- 우리반 학생

### Footer

- `footer`
- 안내 문구
- 관리 페이지 링크

## 관리 페이지

파일: `management.html`

### Body

- `body.management-screen`

### Header

- `header.hero`
- `nav.topbar`
- `div.hero-grid`
- `section.hero-copy`

### Hero 텍스트

- `p.eyebrow`: 관리 시스템
- `h1`: 주간 업무 관리
- `p.hero-text`

### Main

- `main`
- `section.content-band`
- `article.panel`

### 업로드/선택 영역

- `div.manager-head`
- `#weekly-pdf-input`
- `#plan-select`

### 저장 영역

- `div.manager-actions`
- `#save-plan-btn`
- `#published-plan-label`

### 안내/상태/업무 목록

- `p.manager-help`
- `#plan-status.plan-status`
- `#plan-tasks.plan-tasks`
- `.plan-day`
- `.plan-item`
- `.empty-day`

### Footer

- `footer`
- 안내 문구
- 대시보드 링크

## 주요 CSS 클래스

### 레이아웃

- `.hero`
- `.topbar`
- `.hero-grid`
- `.dashboard-grid`
- `.secondary`
- `.wide`
- `.content-band`
- `.tv-main`
- `.tv-top`
- `.tv-middle`
- `.tv-bottom`

### 카드/패널

- `.teacher-card`
- `.panel`
- `.quick-link`
- `.panel-head`
- `.section-title`

### 텍스트/배지

- `.eyebrow`
- `.section-kicker`
- `.hero-text`
- `.hero-meta`
- `.badge`
- `.muted`
- `.task-time`

### 목록

- `.task-list`
- `.compact-list`
- `.duty-card`
- `.duty-pair`
- `.assignment-grid`
- `.assignment`
- `.roster-list`

### 관리 페이지

- `.manager-head`
- `.manager-help`
- `.manager-actions`
- `.plan-status`
- `.plan-tasks`
- `.plan-day`
- `.plan-item`
- `.empty-day`

## 반응형 규칙

### `max-width: 920px`

- `.hero-grid`, `.dashboard-grid`, `.quick-links`가 1열로 변경됨
- `.wide`가 일반 1열 요소로 변경됨
- `.assignment-grid`가 2열로 변경됨
- `.plan-tasks`가 2열로 변경됨
- `body.tv-screen`의 고정 높이와 숨김 overflow가 해제됨
- TV용 리스트/그리드의 숨김 overflow가 해제됨

### `max-width: 620px`

- `.assignment-grid`가 1열로 변경됨
- `.manager-head`, `.plan-tasks`가 1열로 변경됨
- `.panel` padding 감소
- `body.tv-screen .teacher-card` 숨김

## 현재 자동 스크롤 대상

파일: `dashboard.js`

- `#today-list`
- `#upcoming-list`
- `#cleaning-grid`
- `#roster-list`

`920px` 이하에서는 자동 스크롤이 실행되지 않음.

