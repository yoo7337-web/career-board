"""업무 보드 '기록' → Notion 단방향 동기화.

Firestore(boards/{uid})의 state.notes를 읽어 Notion 데이터베이스 1개에
'기록 1건 = 페이지 1개'로 반영한다. 프로젝트·보드는 속성(select)으로 들어가므로
Notion에서 프로젝트별 보드뷰·필터·검색이 자유롭다.

브라우저는 CORS 때문에 Notion API를 직접 못 부른다 → GitHub Actions가 중계한다.

필요한 환경변수(=GitHub Secrets)
  FIREBASE_SA            서비스 계정 JSON 전문
  NOTION_TOKEN           Notion 내부 통합(Internal integration) 시크릿
  NOTION_PARENT_PAGE_ID  DB를 만들 부모 페이지 id (최초 1회만 사용)
  BOARD_EMAIL            보드 소유자 이메일 (기본 yoo7337@gmail.com)

동기화 상태(생성한 DB id, 기록↔페이지 매핑)는 Firestore `integrations/{uid}` 에
따로 저장한다. 앱이 통째로 덮어쓰는 boards/{uid} 문서는 건드리지 않는다.
"""
import hashlib
import json
import os
import re
import sys
import time

import firebase_admin
import requests
from firebase_admin import auth as fb_auth
from firebase_admin import credentials, firestore
from markdownify import markdownify

NOTION_VERSION = "2026-03-11"
API = "https://api.notion.com/v1"
MD_LIMIT = 40000          # 페이지 본문 상한(과도한 요청 방지)
PAUSE = 0.35              # Notion 레이트리밋 3req/s 여유

NOTE_TYPES = {
    "interview": "🎤 인터뷰",
    "meeting": "📋 회의",
    "progress": "📈 진행",
    "issue": "⚠️ 이슈",
    "memo": "💡 메모",
}
PROPS = {
    "제목": {"type": "title", "title": {}},
    "프로젝트": {"type": "select", "select": {}},
    "보드": {"type": "select", "select": {}},
    "유형": {"type": "select", "select": {}},
    "작성일": {"type": "date", "date": {}},
    "기록ID": {"type": "rich_text", "rich_text": {}},
}

session = requests.Session()


def notion(method, path, **kw):
    r = session.request(
        method, API + path,
        headers={
            "Authorization": "Bearer " + (os.environ.get("NOTION_TOKEN") or "").strip(),
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        },
        timeout=30, **kw)
    time.sleep(PAUSE)
    if r.status_code >= 400:
        raise RuntimeError(f"Notion {method} {path} -> {r.status_code} {r.text[:500]}")
    return r.json() if r.text else {}


def is_html(s):
    return bool(re.search(r"<(b|strong|i|em|u|s|strike|br|div|p|ul|ol|li|h[1-6]|span|font)[\s>/]", s or "", re.I))


def body_markdown(note):
    body = note.get("body") or ""
    md = markdownify(body, heading_style="ATX") if is_html(body) else body
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    return md[:MD_LIMIT]


def note_payload(note, gname, bname):
    """Notion 속성 dict + 본문 마크다운."""
    title = (note.get("title") or "").strip() or "(제목 없음)"
    props = {
        "제목": {"title": [{"type": "text", "text": {"content": title[:1900]}}]},
        "유형": {"select": {"name": NOTE_TYPES.get(note.get("type"), "💡 메모")}},
        "기록ID": {"rich_text": [{"type": "text", "text": {"content": note.get("id", "")}}]},
    }
    props["프로젝트"] = {"select": {"name": gname}} if gname else {"select": None}
    props["보드"] = {"select": {"name": bname}} if bname else {"select": None}
    d = note.get("createdAt")
    props["작성일"] = {"date": {"start": d}} if d else {"date": None}
    return props, body_markdown(note)


def ensure_data_source(integ):
    """저장된 data source가 있으면 재사용, 없으면 DB를 새로 만든다."""
    dsid = (integ.get("notion") or {}).get("dataSourceId")
    if dsid:
        try:
            notion("GET", f"/data_sources/{dsid}")
            return dsid, None
        except RuntimeError as e:
            print("저장된 data source를 못 찾음 → 새로 생성합니다:", e, file=sys.stderr)
    parent = (os.environ.get("NOTION_PARENT_PAGE_ID") or "").strip().strip('"')
    if not parent:
        sys.exit("NOTION_PARENT_PAGE_ID 가 없습니다. DB를 만들 부모 페이지를 통합에 공유하고 id를 넣어주세요.")
    db = notion("POST", "/databases", json={
        "parent": {"type": "page_id", "page_id": parent},
        "title": [{"type": "text", "text": {"content": "업무 기록"}}],
        "description": [{"type": "text", "text": {"content": "업무 보드의 '기록' 탭이 자동 동기화됩니다. (앱 → Notion 단방향)"}}],
        "icon": {"type": "emoji", "emoji": "📝"},
        "is_inline": False,
        "initial_data_source": {"properties": PROPS},
    })
    dsid = db["data_sources"][0]["id"]
    print(f"Notion DB 생성됨: {db.get('url')}")
    return dsid, db["id"]


def clear_children(page_id):
    while True:
        res = notion("GET", f"/blocks/{page_id}/children?page_size=100")
        blocks = res.get("results", [])
        for b in blocks:
            notion("DELETE", f"/blocks/{b['id']}")
        if not res.get("has_more"):
            return


def main():
    missing = [k for k in ("FIREBASE_SA", "NOTION_TOKEN") if not (os.environ.get(k) or "").strip()]
    if missing:
        sys.exit("필수 시크릿이 비어 있습니다: " + ", ".join(missing) + " (repo Settings → Secrets and variables → Actions 에 등록)")
    cred = credentials.Certificate(json.loads(os.environ["FIREBASE_SA"]))
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    # 미등록 시크릿은 '없음'이 아니라 빈 문자열로 들어오므로 or 로 기본값 처리
    email = (os.environ.get("BOARD_EMAIL") or "yoo7337@gmail.com").strip()
    uid = fb_auth.get_user_by_email(email).uid

    snap = db.collection("boards").document(uid).get()
    if not snap.exists:
        sys.exit(f"boards/{uid} 문서가 없습니다.")
    state = (snap.to_dict() or {}).get("state") or {}
    notes = state.get("notes") or []
    gname = {g["id"]: g.get("name", "") for g in (state.get("groups") or []) if g.get("id")}
    bname = {b["id"]: b.get("name", "") for b in (state.get("projects") or []) if b.get("id")}

    integ_ref = db.collection("integrations").document(uid)
    integ = integ_ref.get().to_dict() or {}
    dsid, new_db_id = ensure_data_source(integ)
    saved = ((integ.get("notion") or {}).get("pages") or {})

    pages = dict(saved)
    created = updated = archived = 0

    for n in notes:
        nid = n.get("id")
        if not nid:
            continue
        props, md = note_payload(n, gname.get(n.get("group") or ""), bname.get(n.get("board") or ""))
        h = hashlib.sha1(json.dumps([props, md], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        prev = pages.get(nid)
        if prev and prev.get("hash") == h:
            continue
        if prev:
            notion("PATCH", f"/pages/{prev['pageId']}", json={"properties": props, "in_trash": False})
            clear_children(prev["pageId"])
            if md:
                notion("PATCH", f"/blocks/{prev['pageId']}/children", json={"markdown": md})
            pages[nid] = {"pageId": prev["pageId"], "hash": h}
            updated += 1
        else:
            body = {"parent": {"data_source_id": dsid}, "properties": props}
            if md:
                body["markdown"] = md
            page = notion("POST", "/pages", json=body)
            pages[nid] = {"pageId": page["id"], "hash": h}
            created += 1

    live = {n.get("id") for n in notes if n.get("id")}
    for nid in [k for k in pages if k not in live]:
        try:
            notion("PATCH", f"/pages/{pages[nid]['pageId']}", json={"in_trash": True})
            archived += 1
        except RuntimeError as e:
            print("보관 실패(무시):", e, file=sys.stderr)
        pages.pop(nid, None)

    payload = {"notion": {"dataSourceId": dsid, "pages": pages, "syncedAt": int(time.time())}}
    if new_db_id:
        payload["notion"]["databaseId"] = new_db_id
    integ_ref.set(payload, merge=True)
    print(f"동기화 완료 — 신규 {created} · 수정 {updated} · 보관 {archived} · 전체 {len(pages)}건")


if __name__ == "__main__":
    main()
