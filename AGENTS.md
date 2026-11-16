# AGENTS.md

Canvas Studio — Lean Canvas / Business Model Canvas 실시간 공동 편집 앱. 코딩 에이전트(Codex, Claude Code 등)를 위한 작업 지침입니다.

## 명령
- 설치: `npm install`
- 실행: `export $(grep -v '^#' .env | xargs) && npm start` (기본 http://localhost:3000)
- 개발(자동 재시작): `npm run dev`
- 테스트: `npm test` (`node --test test/*.test.js`, 서버를 임의 포트로 띄워 WebSocket까지 검증)

## 구조
- `server/index.js` — HTTP(정적 파일·REST), WebSocket 룸, AI 프록시 라우트
- `server/store.js` — 캔버스당 JSON 파일 저장 (`DATA_DIR`)
- `server/ai.js` — Gemini 호출. 키가 없으면 `public/js/shared/report.js`의 규칙 기반 결과로 대체
- `public/js/shared/` — **서버와 브라우저가 함께 import 하는 순수 모듈**: `templates`(블록 정의), `ops`(편집 연산), `markdown`, `report`
- `public/js/` — 프론트엔드(빌드 없음, ES 모듈): `app`(라우터), `session`(WS), `panel`(코멘트/AI/Markdown), `google`(Drive), `slides`, `modals`, `views/`

## 핵심 규칙
- **상태 변경은 모두 `shared/ops.js`의 `applyOp`을 통과**한다. 새 편집 기능은 op 타입을 추가하고 서버·클라이언트가 같은 함수를 쓰게 한다. 클라이언트는 낙관적 적용 없이 서버가 확정한 순서대로만 적용한다(수렴 보장).
- `final` 상태에서는 `canvas.reopen`, `report.set` 외 op를 서버가 거부한다.
- 템플릿 블록을 추가·변경하면 `templates.js`만 고치면 UI, Markdown, AI 프롬프트, 슬라이드가 따라온다. 블록 `id`는 저장된 데이터와 Markdown 스키마(`{#id}`)에 쓰이므로 함부로 바꾸지 않는다.
- Markdown 포맷(`canvas-studio/v1`)은 기계가 읽는 계약이다. 형식을 바꾸면 `SCHEMA` 버전을 올리고 `parseCanvasMarkdown`과 테스트를 함께 고친다.
- 프론트엔드는 프레임워크·번들러 없이 `h()` 헬퍼(`dom.js`)로 DOM을 만든다. 의존성 추가는 최소화한다(서버 런타임 의존성은 `ws` 하나).
- UI 문구는 한국어.

## 보안·비밀
- `.env`, `data/`는 절대 커밋하지 않는다. API 키·OAuth 토큰을 코드·로그·채팅에 쓰지 않는다.
- Google OAuth 토큰은 브라우저에서만 사용하고 서버로 보내지 않는다.
- 사용자 입력은 `ops.js`에서 길이·형식을 검증한다. 새 op에도 동일하게 적용한다.
- AI 라우트는 IP당 분당 20회로 제한된다. 새 외부 호출 경로를 만들면 비슷한 제한을 둔다.

## 검증 현황 (알아둘 점)
- Gemini 실호출, Google Drive 저장, Google Slides 내보내기는 자격 증명이 필요해 자동 테스트에 포함되지 않았다. 변경 시 수동 확인이 필요하다 (`README.md`의 Google 설정 참고).
- 서버는 룸 상태를 메모리에 두므로 인스턴스 1개로만 운영한다.
