# Canvas Studio

Lean Canvas / Business Model Canvas를 팀과 **실시간 공동 편집**하고, **AI 피드백**을 받고, **Markdown(Google Drive 자동 저장)** 으로 남기고, 최종 확정하면 **액션 아이템이 담긴 리포트(PDF · Google Slides)** 를 만드는 웹 앱입니다.

## 실행

```bash
npm install
cp .env.example .env   # 값 채우기 (아래 참고). 없어도 기본 기능은 동작
export $(grep -v '^#' .env | xargs) && npm start   # http://localhost:3000
npm test
```

## 기능 ↔ 구현

| 요구 | 구현 |
|---|---|
| 최초 실행 시 새 캔버스 + 공유 코드 | 시작 화면에서 템플릿(Lean / BMC) 선택 → 8자리 코드(`ABCD-EFGH`) 발급 |
| 코드·링크·이메일 공유 | 코드 입력 참여, `#/c/CODE` 링크, 이메일 초대(메일 앱 열림) |
| 실시간 공동 편집 | WebSocket. 서버가 정한 순서대로 모든 클라이언트가 같은 연산을 적용(항목 단위). 다른 사람이 편집 중인 항목은 잠겨 표시됨 |
| 코멘트 | 블록/항목/전체에 작성, 사이드 패널에서 **Resolve · Close · Reply · 다시 열기** |
| AI 피드백 → 수정 | 전체/블록별 점검, 제안을 **적용**하면 항목 추가/고쳐쓰기 |
| Markdown 실시간 변환 | 우측 Markdown 탭, `GET /api/canvas/CODE.md` (YAML front matter + `{#block}` 섹션) |
| Google Drive 저장 | 변경 3초 후 선택한 폴더의 파일 1개를 덮어쓰기 |
| 최종 확정 → 리포트 | 편집 잠금 → AI 요약·강점·리스크·**액션 아이템**·**코멘트 요약** 리포트 |
| PDF / Google Slides | PDF는 브라우저 인쇄(PDF로 저장), Slides는 새 프레젠테이션 생성 또는 입력한 URL에 슬라이드 추가 |

## 환경변수

| 변수 | 설명 |
|---|---|
| `GEMINI_API_KEY` | AI 피드백/리포트. 없으면 **규칙 기반 점검**으로 대체(UI에 표시됨) |
| `GEMINI_MODEL` | 기본 `gemini-2.5-flash` |
| `GOOGLE_CLIENT_ID` | Drive 저장·Slides 내보내기에 필요 |
| `GOOGLE_API_KEY`, `GOOGLE_APP_ID` | (선택) Drive 폴더 Picker |
| `DATA_DIR` | 캔버스 JSON 저장 위치 (영구 디스크 필요) |

### Google 설정 (한 번만)
1. Google Cloud Console에서 프로젝트 생성 → **Google Drive API**, **Google Slides API**, (Picker 사용 시) **Picker API** 활성화
2. OAuth 동의 화면 설정, 범위 `drive.file`, `presentations` 추가
3. **OAuth 클라이언트 ID(웹)** 생성 → 승인된 JavaScript 원본에 배포 주소(예: `https://canvas.example.com`, 로컬은 `http://localhost:3000`) 추가
4. 클라이언트 ID를 `GOOGLE_CLIENT_ID`에 설정

로그인 토큰은 사용자의 브라우저에서만 쓰이며 서버로 전송되지 않습니다. `drive.file` 범위라 앱이 만들었거나 Picker로 사용자가 고른 폴더/파일에만 접근합니다. (폴더 ID 직접 입력은 앱이 접근 권한을 가진 폴더일 때만 동작 — "새 폴더 만들기" 또는 Picker 권장)

## 배포

WebSocket 서버가 필요하므로 서버리스(Vercel Functions 등)가 아니라 **상시 실행 Node 호스트**에 올립니다 (Render, Fly.io, Railway, Cloud Run + 세션 유지 등).

```bash
docker build -t canvas-studio .
docker run -p 3000:3000 -v canvas-data:/data -e GEMINI_API_KEY=... -e GOOGLE_CLIENT_ID=... canvas-studio
```
- `/data` 에 영구 볼륨을 반드시 연결하세요. 서버 인스턴스는 **1개**로 운영해야 합니다(룸 상태가 메모리에 있음).
- HTTPS 뒤에서 실행하면 `wss://` 로 자동 전환됩니다.

## 보안·운영 메모
- 공유 코드를 아는 사람은 누구나 편집할 수 있습니다 (로그인 없음). 코드는 32문자^8 무작위.
- AI 호출은 IP당 분당 20회로 제한됩니다. AI 사용 시 캔버스 내용이 Google Gemini API로 전송됩니다.
- 최종 확정 상태에서는 `canvas.reopen`, `report.set` 외 모든 편집이 서버에서 거부됩니다.

## 구조
```
server/        index.js(HTTP·WS·API) store.js(파일 저장) ai.js(Gemini 프록시)
public/js/shared/  templates · ops(편집 연산, 서버·클라 공용) · markdown · report
public/js/     app(router) session(WS) panel(코멘트/AI/MD) google(Drive) slides modals views/
test/          node --test
```
