"""업무 보드 아침 다이제스트 → 텔레그램.

Firestore(boards/{uid})의 state를 읽어 '오늘 챙길 일'을 한 통으로 보낸다.
앱을 안 열어도 마감·일정을 놓치지 않게 하는 용도(앱 안 토스트의 보완).

필요한 환경변수(=GitHub Secrets)
  FIREBASE_SA          서비스 계정 JSON 전문
  TELEGRAM_BOT_TOKEN   봇 토큰 (@dsrkrbot 재사용)
  TELEGRAM_CHAT_ID     받을 채널/채팅 id
  BOARD_EMAIL          보드 소유자 이메일 (기본 yoo7337@gmail.com)
"""
import datetime as dt
import json
import os
import sys

import firebase_admin
import requests
from firebase_admin import auth as fb_auth
from firebase_admin import credentials, firestore

KST = dt.timezone(dt.timedelta(hours=9))
DOW = ["월", "화", "수", "목", "금", "토", "일"]
PRIO_MARK = {"high": "🔴", "med": "🟡", "low": "🔵"}
SOON_DAYS = 3          # 일정은 3일 앞까지
STALE_DAYS = 7         # 이보다 오래 지난 일정은 제외(앱의 schedIsStale과 동일)
MAX_ROWS = 8           # 구역별 최대 표시


def esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def dday(date_str, today):
    return (dt.date.fromisoformat(date_str) - today).days


def build(state, today):
    cards = state.get("cards") or []
    boards = {b["id"]: b for b in (state.get("projects") or []) if b.get("id")}
    groups = {g["id"]: g for g in (state.get("groups") or []) if g.get("id")}

    def where(c):
        b = boards.get(c.get("project") or "")
        g = groups.get((b or {}).get("group") or "")
        return (g or {}).get("name") or ""

    open_cards = [c for c in cards if c.get("status") != "done"]
    over = sorted([c for c in open_cards if c.get("due") and c["due"] < today.isoformat()],
                  key=lambda c: c["due"])
    today_due = [c for c in open_cards if c.get("due") == today.isoformat()]
    doing = [c for c in open_cards if c.get("status") == "doing"]

    scheds = []
    for s in (state.get("schedules") or []):
        if not s.get("date"):
            continue
        d = dday(s["date"], today)
        if -STALE_DAYS <= d <= SOON_DAYS:
            scheds.append((d, s))
    scheds.sort(key=lambda x: x[0])

    if not (over or today_due or scheds or doing):
        return None

    L = [f"<b>📋 오늘의 업무</b>  {today.month}/{today.day}({DOW[today.weekday()]})"]

    def card_row(c):
        mark = PRIO_MARK.get(c.get("priority") or "", "⚪")
        w = where(c)
        return f"{mark} {esc(c.get('title'))}" + (f" <i>({esc(w)})</i>" if w else "")

    if over:
        L.append(f"{chr(10)}<b>🔥 마감 지남 {len(over)}건</b>")
        for c in over[:MAX_ROWS]:
            L.append(f"{card_row(c)} — {-dday(c['due'], today)}일 지남")
        if len(over) > MAX_ROWS:
            L.append(f"…외 {len(over) - MAX_ROWS}건")
    if today_due:
        L.append(f"{chr(10)}<b>📅 오늘 마감 {len(today_due)}건</b>")
        for c in today_due[:MAX_ROWS]:
            L.append(card_row(c))
    if scheds:
        L.append(f"{chr(10)}<b>📌 일정 {len(scheds)}건</b>")
        for d, s in scheds[:MAX_ROWS]:
            g = groups.get(s.get("group") or "")
            when = "오늘" if d == 0 else (f"D-{d}" if d > 0 else f"{-d}일 지남")
            tm = f" {s['time']}" if s.get("time") else ""
            L.append(f"• {esc(s.get('title'))}{tm} — {when}" + (f" <i>({esc(g.get('name'))})</i>" if g else ""))
    if doing:
        L.append(f"{chr(10)}<b>▶ 진행 중 {len(doing)}건</b>")
        for c in doing[:MAX_ROWS]:
            L.append(card_row(c))
        if len(doing) > MAX_ROWS:
            L.append(f"…외 {len(doing) - MAX_ROWS}건")

    L.append(f'{chr(10)}<a href="https://yoo7337-web.github.io/career-board/">업무 보드 열기</a>')
    return chr(10).join(L)


def main():
    missing = [k for k in ("FIREBASE_SA", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID")
               if not (os.environ.get(k) or "").strip()]
    if missing:
        sys.exit("필수 시크릿이 비어 있습니다: " + ", ".join(missing))

    cred = credentials.Certificate(json.loads(os.environ["FIREBASE_SA"]))
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    email = (os.environ.get("BOARD_EMAIL") or "yoo7337@gmail.com").strip()
    uid = fb_auth.get_user_by_email(email).uid

    snap = db.collection("boards").document(uid).get()
    if not snap.exists:
        sys.exit(f"boards/{uid} 문서가 없습니다.")
    state = (snap.to_dict() or {}).get("state") or {}

    today = dt.datetime.now(KST).date()
    msg = build(state, today)
    if not msg:
        print("보낼 항목 없음 — 발송 생략")
        return
    r = requests.post(
        f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN'].strip()}/sendMessage",
        json={"chat_id": os.environ["TELEGRAM_CHAT_ID"].strip(), "text": msg,
              "parse_mode": "HTML", "disable_web_page_preview": True},
        timeout=30)
    if r.status_code >= 400:
        sys.exit(f"텔레그램 발송 실패 {r.status_code}: {r.text[:300]}")
    print("발송 완료:", len(msg), "자")


if __name__ == "__main__":
    main()
