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


JOURNAL_PROPS = {
    "제목": {"type": "title", "title": {}},
    "날짜": {"type": "date", "date": {}},
    "완수": {"type": "number", "number": {}},
    "기록": {"type": "number", "number": {}},
    "회고": {"type": "checkbox", "checkbox": {}},
}


def ensure_data_source(integ, key, title, icon, props, desc):
    """integrations.{key}.dataSourceId가 살아있으면 재사용, 없으면 DB를 새로 만든다."""
    dsid = (integ.get(key) or {}).get("dataSourceId")
    if dsid:
        try:
            notion("GET", f"/data_sources/{dsid}")
            return dsid, None
        except RuntimeError as e:
            print(f"저장된 data source({title})를 못 찾음 → 새로 생성합니다:", e, file=sys.stderr)
    parent = (os.environ.get("NOTION_PARENT_PAGE_ID") or "").strip().strip('"')
    if not parent:
        sys.exit("NOTION_PARENT_PAGE_ID 가 없습니다. DB를 만들 부모 페이지를 통합에 공유하고 id를 넣어주세요.")
    db = notion("POST", "/databases", json={
        "parent": {"type": "page_id", "page_id": parent},
        "title": [{"type": "text", "text": {"content": title}}],
        "description": [{"type": "text", "text": {"content": desc}}],
        "icon": {"type": "emoji", "emoji": icon},
        "is_inline": False,
        "initial_data_source": {"properties": props},
    })
    dsid = db["data_sources"][0]["id"]
    print(f"Notion DB 생성됨({title}): {db.get('url')}")
    return dsid, db["id"]


DONE_PROPS = {
    "제목": {"type": "title", "title": {}},
    "완수일": {"type": "date", "date": {}},
    "프로젝트": {"type": "select", "select": {}},
    "보드": {"type": "select", "select": {}},
    "중요도": {"type": "select", "select": {}},
    "FU회차": {"type": "number", "number": {}},
    "카드ID": {"type": "rich_text", "rich_text": {}},
}
PRIO_KO = {"high": "높음", "med": "보통", "low": "낮음", "none": "없음"}

DOW = ["월", "화", "수", "목", "금", "토", "일"]


def done_payload(card, gname, bname):
    """완수 카드 → Notion 속성 + 본문(메모·FU 이력)."""
    title = (card.get("title") or "").strip() or "(제목 없음)"
    props = {
        "제목": {"title": [{"type": "text", "text": {"content": title[:1900]}}]},
        "완수일": {"date": {"start": card["doneAt"]}},
        "프로젝트": {"select": {"name": gname}} if gname else {"select": None},
        "보드": {"select": {"name": bname}} if bname else {"select": None},
        "중요도": {"select": {"name": PRIO_KO.get(card.get("priority") or "none", "없음")}},
        "FU회차": {"number": card.get("fuCount") or 0},
        "카드ID": {"rich_text": [{"type": "text", "text": {"content": card.get("id", "")}}]},
    }
    NL = chr(10)
    L = []
    if card.get("note"):
        L.append(str(card["note"]))
    hist = card.get("fuHistory") or []
    if hist:
        chain = " → ".join(list(hist) + [card["doneAt"]])
        L.append(f"↩ FU 이력: {chain}")
    return props, (NL + NL).join(L)[:MD_LIMIT]


def journal_markdown(entry):
    """journal[date] = {auto:{done,created,big3,planH,actualH,notes}, memo, ai} -> 마크다운 본문."""
    NL = chr(10)
    a = entry.get("auto") or {}
    L = []
    done = a.get("done") or []
    if done:
        rows = [f"- {d.get('title', '')}" + (f" ({' · '.join(x for x in [d.get('proj'), d.get('board')] if x)})" if (d.get('proj') or d.get('board')) else "") for d in done]
        L.append(f"## ✅ 완수 {len(done)}건" + NL + NL.join(rows))
    big3 = a.get("big3") or []
    if big3:
        rows = []
        for b in big3:
            meta = []
            if b.get("plan"):
                meta.append(f"계획 {b['plan']}h")
            if b.get("actual") is not None:
                meta.append(f"실제 {b['actual']}h")
            mark = "✓" if b.get("done") else "○"
            rows.append(f"- {mark} {b.get('title', '')}" + (f" ({' · '.join(meta)})" if meta else ""))
        L.append(f"## 🎯 Big3 {sum(1 for b in big3 if b.get('done'))}/{len(big3)}" + NL + NL.join(rows))
    if a.get("planH") or a.get("actualH"):
        L.append("## ⏱ 시간" + NL + f"계획 {a.get('planH') or 0}h · 실제 {a.get('actualH') or 0}h")
    notes = a.get("notes") or []
    if notes:
        rows = [f"- {NOTE_TYPES.get(n.get('type'), '💡 메모')} {n.get('title', '')}" for n in notes]
        L.append(f"## 📝 기록 {len(notes)}건" + NL + NL.join(rows))
    if a.get("created"):
        L.append(f"➕ 새 할 일 등록 {a['created']}건")
    if entry.get("memo"):
        L.append("## 💭 한 줄 회고" + NL + str(entry["memo"]))
    if entry.get("ai"):
        L.append("## ✨ AI 정리" + NL + str(entry["ai"]))
    return (NL + NL).join(L)[:MD_LIMIT]


def journal_payload(date, entry):
    a = entry.get("auto") or {}
    dt = None
    try:
        import datetime as _dt
        dt = _dt.date.fromisoformat(date)
    except Exception:
        pass
    title = f"{date} ({DOW[dt.weekday()]})" if dt else date
    props = {
        "제목": {"title": [{"type": "text", "text": {"content": title}}]},
        "날짜": {"date": {"start": date}},
        "완수": {"number": len(a.get("done") or [])},
        "기록": {"number": len(a.get("notes") or [])},
        "회고": {"checkbox": bool(entry.get("memo"))},
    }
    return props, journal_markdown(entry)


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
    bmeta = {b["id"]: b for b in (state.get("projects") or []) if b.get("id")}

    integ_ref = db.collection("integrations").document(uid)
    integ = integ_ref.get().to_dict() or {}
    dsid, new_db_id = ensure_data_source(integ, "notion", "업무 기록", "📝", PROPS,
                                         "업무 보드의 '기록' 탭이 자동 동기화됩니다. (앱 → Notion 단방향)")
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
        # 본문 갱신: children append API는 markdown을 안 받음(실측 400) → 구본을 휴지통으로 보내고 재생성
        if prev:
            try:
                notion("PATCH", f"/pages/{prev['pageId']}", json={"in_trash": True})
            except RuntimeError as e:
                print("구본 보관 실패(무시):", e, file=sys.stderr)
        body = {"parent": {"data_source_id": dsid}, "properties": props}
        if md:
            body["markdown"] = md
        page = notion("POST", "/pages", json=body)
        pages[nid] = {"pageId": page["id"], "hash": h}
        if prev:
            updated += 1
        else:
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
    print(f"기록 동기화 완료 — 신규 {created} · 수정 {updated} · 보관 {archived} · 전체 {len(pages)}건")

    # ── 일지 → '업무 일지' DB (확정된 과거 스냅샷 auto + 회고 memo + AI 정리) ──
    journal = state.get("journal") or {}
    jdsid, j_new_db = ensure_data_source(integ, "journal", "업무 일지", "📔", JOURNAL_PROPS,
                                         "업무 보드의 '일지' 탭이 자동 동기화됩니다. (앱 → Notion 단방향, 확정된 날짜만)")
    jpages = dict(((integ.get("journal") or {}).get("pages") or {}))
    jc = ju = 0
    for date in sorted(journal.keys()):
        entry = journal.get(date) or {}
        if not isinstance(entry, dict):
            continue
        if not (entry.get("auto") or entry.get("memo") or entry.get("ai")):
            continue
        props, md = journal_payload(date, entry)
        h = hashlib.sha1(json.dumps([props, md], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        prev = jpages.get(date)
        if prev and prev.get("hash") == h:
            continue
        if prev:
            try:
                notion("PATCH", f"/pages/{prev['pageId']}", json={"in_trash": True})
            except RuntimeError as e:
                print("구본 보관 실패(무시):", e, file=sys.stderr)
        body = {"parent": {"data_source_id": jdsid}, "properties": props}
        if md:
            body["markdown"] = md
        page = notion("POST", "/pages", json=body)
        jpages[date] = {"pageId": page["id"], "hash": h}
        if prev:
            ju += 1
        else:
            jc += 1
    jpayload = {"journal": {"dataSourceId": jdsid, "pages": jpages, "syncedAt": int(time.time())}}
    if j_new_db:
        jpayload["journal"]["databaseId"] = j_new_db
    integ_ref.set(jpayload, merge=True)
    print(f"일지 동기화 완료 — 신규 {jc} · 수정 {ju} · 전체 {len(jpages)}일")

    # ── 완수 아카이브 → '완수 기록' DB ──
    done_cards = [c for c in (state.get("cards") or [])
                  if c.get("status") == "done" and c.get("doneAt") and c.get("id")]
    ddsid, d_new_db = ensure_data_source(integ, "done", "완수 기록", "✅", DONE_PROPS,
                                         "업무 보드에서 완수한 할 일이 자동 동기화됩니다. (앱 → Notion 단방향)")
    dpages = dict(((integ.get("done") or {}).get("pages") or {}))
    dc = du = da = 0
    for c in done_cards:
        b = bmeta.get(c.get("project") or "")
        props, md = done_payload(c, gname.get((b or {}).get("group") or ""), (b or {}).get("name") or "")
        h = hashlib.sha1(json.dumps([props, md], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        prev = dpages.get(c["id"])
        if prev and prev.get("hash") == h:
            continue
        if prev:
            try:
                notion("PATCH", f"/pages/{prev['pageId']}", json={"in_trash": True})
            except RuntimeError as e:
                print("구본 보관 실패(무시):", e, file=sys.stderr)
        body = {"parent": {"data_source_id": ddsid}, "properties": props}
        if md:
            body["markdown"] = md
        page = notion("POST", "/pages", json=body)
        dpages[c["id"]] = {"pageId": page["id"], "hash": h}
        if prev:
            du += 1
        else:
            dc += 1
    live_done = {c["id"] for c in done_cards}
    for cid in [k for k in dpages if k not in live_done]:   # 삭제되거나 FU로 재개된 건 보관
        try:
            notion("PATCH", f"/pages/{dpages[cid]['pageId']}", json={"in_trash": True})
            da += 1
        except RuntimeError as e:
            print("보관 실패(무시):", e, file=sys.stderr)
        dpages.pop(cid, None)
    dpayload = {"done": {"dataSourceId": ddsid, "pages": dpages, "syncedAt": int(time.time())}}
    if d_new_db:
        dpayload["done"]["databaseId"] = d_new_db
    integ_ref.set(dpayload, merge=True)
    print(f"완수 동기화 완료 — 신규 {dc} · 수정 {du} · 보관 {da} · 전체 {len(dpages)}건")


if __name__ == "__main__":
    main()
