# 기록 → Notion 자동 동기화 (설정 안내)

업무 보드의 **기록 · 일지 · 완수한 할 일**을 Notion 데이터베이스 3개(`업무 기록`·`업무 일지`·`완수 기록`)에 자동 반영합니다.
일지는 **확정된 날짜만** 동기화됩니다 — 오늘 일지는 앱에서 실시간으로 만들어지는 값이라, 다음날 확정된 뒤 반영됩니다.
`기록 1건 = Notion 페이지 1개`이고, **프로젝트 · 보드 · 유형 · 작성일**이 속성으로 들어가므로
Notion에서 프로젝트별 보드뷰 / 필터 / 검색을 자유롭게 쓸 수 있습니다.

- **방향**: 앱 → Notion **단방향**. (Notion에서 고쳐도 앱으로 돌아오지 않고, 다음 동기화 때 앱 내용으로 덮어씁니다)
- **주기**: 2시간마다 + GitHub Actions 탭에서 수동 실행 가능
- **삭제**: 앱에서 기록을 지우면 Notion 페이지는 **휴지통으로 이동**(완전 삭제 아님)
- 브라우저에서 Notion API를 직접 부를 수 없어(CORS) GitHub Actions가 중계합니다.
- ⚠ 수정된 항목은 Notion 페이지를 **새로 만들어** 반영합니다(본문 갱신 API 제약) — 그 페이지의 Notion 댓글은 유지되지 않습니다.

## 📨 아침 다이제스트 (별도 워크플로 `digest.yml`)
평일 아침 7시(KST)에 **오늘 챙길 일**(마감 지남·오늘 마감·임박 일정·진행 중)을 텔레그램으로 보냅니다.
추가 Secrets 2개가 필요합니다 — `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
(deal-radar/stock-radar에서 쓰는 `@dsrkrbot` 토큰을 그대로 재사용하면 됩니다. 받을 채널 id를 `TELEGRAM_CHAT_ID`에 넣으세요.)
보낼 항목이 없으면 발송하지 않습니다. `Actions → 아침 업무 다이제스트 → Run workflow`로 즉시 테스트할 수 있습니다.

---

## 1. Notion 준비

1. <https://www.notion.so/my-integrations> → **New integration**
   - Type: **Internal**, 워크스페이스 선택, 이름 예: `업무 보드`
   - 만든 뒤 **Internal Integration Secret** 복사 → `NOTION_TOKEN`
2. Notion에서 DB를 놓을 **부모 페이지**를 하나 만듭니다 (예: `업무 보드`).
3. 그 페이지 우측 상단 `···` → **연결(Connections)** → 1번에서 만든 통합을 추가.
4. 페이지 URL 끝의 32자리 문자열이 페이지 id → `NOTION_PARENT_PAGE_ID`
   `notion.so/업무-보드-`**`1a2b3c4d5e6f7890abcdef1234567890`**

> `업무 기록` DB는 **첫 실행 때 스크립트가 알아서 생성**합니다. 직접 만들 필요 없습니다.

## 2. Firebase 서비스 계정 키

Firebase 콘솔 → `career-board-fc111` → **프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성**
→ 내려받은 **JSON 파일 전체 내용**을 `FIREBASE_SA` 값으로 붙여넣습니다.

> 이 키는 Firestore 전체 접근 권한이 있으니 GitHub Secrets 밖(채팅·코드·문서)에 절대 남기지 마세요.

## 3. GitHub Secrets 등록

repo `yoo7337-web/career-board` → **Settings → Secrets and variables → Actions → New repository secret**

| 이름 | 값 |
|---|---|
| `FIREBASE_SA` | 서비스 계정 JSON 전문 |
| `NOTION_TOKEN` | Notion 통합 시크릿 (`ntn_...`) |
| `NOTION_PARENT_PAGE_ID` | DB를 만들 부모 페이지 id |
| `BOARD_EMAIL` | (선택) 기본값 `yoo7337@gmail.com` |

## 4. 첫 실행

repo → **Actions → 기록 → Notion 동기화 → Run workflow**.
로그에 `Notion DB 생성됨: https://notion.so/...` 와 `동기화 완료 — 신규 N건`이 찍히면 성공입니다.
이후로는 2시간마다 자동으로 돕니다.

---

## 동작 메모

- 생성한 DB id와 `기록 id ↔ Notion 페이지 id` 매핑은 Firestore **`integrations/{uid}`** 문서에 저장합니다.
  앱이 통째로 덮어쓰는 `boards/{uid}` 는 건드리지 않으므로 서로 충돌하지 않습니다.
- 기록 내용 해시를 비교해 **바뀐 것만** 갱신합니다(변경 없으면 API 호출 0).
- 기록 본문의 서식(굵게·기울임·목록·제목)은 마크다운으로 변환되어 Notion 블록이 됩니다.
- `integrations/{uid}` 문서를 지우면 다음 실행 때 DB를 새로 만들고 전부 다시 올립니다(기존 DB는 그대로 남음).
