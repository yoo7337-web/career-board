'use strict';

const LS_KEY = 'board-v2';
const RAMP = ['blue', 'teal', 'coral', 'pink', 'purple', 'green', 'amber', 'red', 'gray'];

const PRIORITIES = {
  high: { label: '높음', bg: '#F5A88A', fg: '#5A1F0C' },
  med: { label: '보통', bg: '#F7CE6B', fg: '#5A3406' },
  low: { label: '낮음', bg: '#9FD0F0', fg: '#0C3A66' },
  none: { label: '없음', bg: '', fg: '' },
};
const PRIO_ORDER = ['high', 'med', 'low', 'none'];
const PRIO_RANK = { high: 3, med: 2, low: 1, none: 0 };
const NOTE_TEMPLATES = {
  interview: '[대상]\n\n[확인사항]\n\n[답변]\n\n[후속 조치]\n',
  meeting: '[참석]\n\n[논의]\n\n[결정]\n\n[Action Item]\n',
  progress: '[진행 내용]\n\n[다음 단계]\n',
  issue: '[이슈]\n\n[영향]\n\n[대응]\n',
  memo: '',
};
// Big3 색: 차분한 뮤트 주얼톤(전문적·톤 통일). To-do 중요도(coral/amber/blue)와도 구분
const TBOX_COLORS = [
  { bg: '#8592C9', fg: '#262E52' },   // indigo
  { bg: '#6FB393', fg: '#123A2A' },   // jade
  { bg: '#CE93A9', fg: '#48212F' },   // rose
  { bg: '#6FADB8', fg: '#123840' },   // teal
  { bg: '#AC93C9', fg: '#35244B' },   // amethyst
  { bg: '#B98BB3', fg: '#3E2440' },   // plum
  { bg: '#8AA9A0', fg: '#203833' },   // sage
  { bg: '#9C9AC0', fg: '#2B2A4D' },   // periwinkle
];
function tbColor(i) { return TBOX_COLORS[((i % TBOX_COLORS.length) + TBOX_COLORS.length) % TBOX_COLORS.length]; }
const TB_PLAN_DAYS = 5;   // 타임박스 계획 창: 오늘 포함 5일 (오늘 ~ 오늘+4)
const NOTE_TYPES = {
  interview: { label: '인터뷰', icon: '🎤', color: 'purple' },
  meeting: { label: '회의', icon: '📋', color: 'blue' },
  progress: { label: '진행', icon: '📈', color: 'teal' },
  issue: { label: '이슈', icon: '⚠️', color: 'red' },
  memo: { label: '메모', icon: '💡', color: 'gray' },
};

const SEED = {
  projects: [
    { id: 'work-main', name: '회사 업무', color: 'blue', parent: null, x: 40, y: 40 },
  ],
  groups: [],
  cards: [],
  notes: [],
  timebox: {},
  schedules: [],
  sel: { view: 'board' },
};

function uid() { return Math.random().toString(36).slice(2, 10); }
function esc(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dday(due) {
  const [y, m, d] = due.split('-').map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - t) / 864e5);
}
function fmtDate(s) { const [, m, d] = s.split('-'); return `${Number(m)}/${Number(d)}`; }
function dstr(dt) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; }
function nextDay(s) { const [y, m, d] = s.split('-').map(Number); return dstr(new Date(y, m - 1, d + 1)); }
function gcalUrl(title, start, endEx, details) {
  const f = x => x.replace(/-/g, '');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${f(start)}/${f(endEx)}&details=${encodeURIComponent(details || '업무 보드에서 추가')}`;
}

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      s.sel = s.sel || {};
      if (!s.sel.view) s.sel.view = 'board';
      s.groups = s.groups || [];
      s.notes = s.notes || [];
      s.timebox = s.timebox || {};
      s.journal = s.journal || {};
      s.settings = s.settings || {};
      s.schedules = s.schedules || [];
      return s;
    }
  } catch (e) { /* corrupt storage -> reseed */ }
  return JSON.parse(JSON.stringify(SEED));
}
let state = load();

/* ---------- cloud sync (Firebase, optional) ---------- */
const CLOUD = !!(window.firebaseConfig && window.firebaseConfig.apiKey && !/PASTE|YOUR_/.test(window.firebaseConfig.apiKey));
let db = null, authUser = null, applyingRemote = false, writeTimer = null, unsubDoc = null;

/* ---------- admin-only dev log ---------- */
const ADMIN_EMAIL = 'yoo7337@gmail.com';
function isAdmin() { return !!(authUser && authUser.email && authUser.email.toLowerCase() === ADMIN_EMAIL); }
const DEVLOG_SEED = [
  ['2026-07-06', '프로젝트 시작 · 칸반 보드 MVP', 'To-do/Done 드래그 보드, localStorage 저장'],
  ['2026-07-06', '회사 업무 전용으로 단순화', '초기 프로젝트 연동·오늘 뷰 제거'],
  ['2026-07-06', '보드 이름 변경·삭제', 'pill 더블클릭으로 편집'],
  ['2026-07-06', '여러 보드 한 화면 + 구조도 탭', '보드 상하관계를 드래그로 연결, 중요도 색상 포스트잇'],
  ['2026-07-06', '3단 레인 전환', '마일스톤 제거 → To-do / 진행 중 / 완수'],
  ['2026-07-06', '달력 탭 + Google Calendar 연동', '월 그리드, 보드 수행기간 막대, 원클릭 등록 링크·.ics 내보내기'],
  ['2026-07-06', 'UX 개선', '탭 순서 조정, 달력 날짜 클릭으로 추가, 진행 중/완수 시각 표시'],
  ['2026-07-07', '클라우드 동기화 + 로그인', 'Firebase Firestore+Auth, 전 기기 실시간 동기화'],
  ['2026-07-07', '외부 배포', 'GitHub Pages 배포 + git 자동 배포 설정'],
  ['2026-07-07', '개발일지 탭', '관리자 전용 개발 이력·향후 계획 관리'],
];
// 2026-07-07 이후 개발 내역 (기존 개발일지에 1회 백필, 신규 설치는 시드에 포함)
const DEVLOG_BACKFILL_V = 2;
const DEVLOG_BACKFILL = [
  ['2026-07-11', 'Google 로그인 + 구글 캘린더 동기화', '구글 계정 로그인, 마감일·수행기간을 전용 캘린더로 단방향 push'],
  ['2026-07-11', '자동 백업·복원', '변경 시 스냅샷 적재(클라우드+기기 이중), 시점 복원'],
  ['2026-07-12', '보드 탭 노션 스타일 개편', '좌측 프로젝트 사이드바 + 프로젝트 페이지(헤더·속성바)'],
  ['2026-07-12', '기록 탭 (프로젝트별)', '타임라인 피드·유형·핀 고정·본문 템플릿·개요 콜아웃'],
  ['2026-07-12', '현황(대시보드) 탭', 'KPI·프로젝트 진행률·오늘의 Big3·최근 기록 요약'],
  ['2026-07-12', '타임박스 탭 (일일 Time Box)', 'Big3 + Brain Dump + 06~24시 시간칸 배정, 실제 소요시간 비교'],
  ['2026-07-13', '일지 탭 (자동 일일 기록)', '완수·타임박스·기록 기반 자동 요약 + 한 줄 회고 + 선택적 Gemini 윤문'],
  ['2026-07-13', '타임박스 강화', '5일 계획 창, Big3 순서 드래그·수동 추가, 완수 카드 기준 동기화'],
  ['2026-07-13', '구조도 2단 개편', '미배정 할 일 드래그 배정, 자동정렬 2D 줄바꿈, 프로젝트 구역 통째 이동'],
  ['2026-07-14', '멀티기기 데이터 유실 방지', 'union 병합 동기화 + 잠자던 탭 복원 시 재동기화, 백업 판정 강화'],
  ['2026-07-15', '프로젝트 일정(마감) 기능', '프로젝트별 마감일·시간, 달력·타임박스·현황·D-day 연동'],
  ['2026-07-15', '현황 탭 전면 정돈', '이번 주 스트립·프로젝트 D-day 배지·구역 높이/스크롤/디자인 통일'],
  ['2026-07-16', '완수 아카이브', '프로젝트·보드별 완수 내역 관리 + FU 원클릭 생성 + 완수 레인 접기'],
  ['2026-07-16', '라이트/다크 테마 토글', '헤더 스위치로 전환·기기별 저장'],
  ['2026-07-17', '안정화 (버그 수정)', '복원 크래시 방지·백업 용량 상한·지난 일정 자동 정리 등'],
  ['2026-07-18', '휴지통', '삭제한 할 일·보드·일정·기록 보관 후 복원(30일·50개)'],
  ['2026-07-21', '기록 리치 텍스트 에디터', '굵게·목록·형광펜 등 노션식 서식 + 실시간 저장·커서 유지'],
  ['2026-07-22', '기록 → Notion 자동 동기화', 'GitHub Actions가 2시간마다 기록을 Notion DB로 반영(프로젝트·보드·유형 속성)'],
  ['2026-07-22', '메뉴 개편 + 상단 고정', '용도별 그룹 구분선, 현황→대시보드·달력 독립 탭, 스크롤해도 메뉴바 고정'],
  ['2026-07-22', '달력 개선', '일정/할 일 타입 필터 + 날짜 클릭 시 할 일·일정 선택 추가(프로젝트 지정)'],
  ['2026-07-22', '트리 탭 신설', '프로젝트→보드→할 일·기록 가로 트리, 기록 본문 인라인 확장'],
  ['2026-07-22', 'FU 개편', '완수 카드를 다시 진행중으로 — 회차 배지(↩ FU ①②③)와 완수 이력 누적'],
  ['2026-07-22', '구조도 개선', '보드 hover 말풍선(진행·완수 목록) + 보드 완료 시 구역 오른쪽 선반에 모음'],
  ['2026-07-22', '사이드바·가독성 개선', '프로젝트 트리 누적 펼침, 미완료 To-do 수 표시, 기록 전체 보기, 밝은 테마 대비 강화'],
];
function seedDevlogDone() { return DEVLOG_SEED.concat(DEVLOG_BACKFILL).map(([date, title, desc]) => ({ id: uid(), date, title, desc })); }
function ensureDevlog() {
  if (isAdmin() && !state.devlog) { state.devlog = { done: seedDevlogDone(), future: [], backfillV: DEVLOG_BACKFILL_V }; return true; }
  return false;
}
function backfillDevlog() {   // 기존 개발일지에 누락된 최신 개발 내역 1회 추가 (중복·재삭제 방지)
  if (!isAdmin() || !state.devlog) return false;
  if ((state.devlog.backfillV || 0) >= DEVLOG_BACKFILL_V) return false;
  state.devlog.done = state.devlog.done || [];
  const has = (d, t) => state.devlog.done.some(e => e.date === d && e.title === t);
  DEVLOG_BACKFILL.forEach(([date, title, desc]) => { if (!has(date, title)) state.devlog.done.push({ id: uid(), date, title, desc }); });
  state.devlog.backfillV = DEVLOG_BACKFILL_V;
  return true;
}

/* ---------- backups (separate cloud doc + local, protects against overwrite) ---------- */
const SNAP_KEY = 'board-v2-snaps', SNAP_MAX = 20, SNAP_LOCAL_MAX = 12, SNAP_MIN_MS = 90000;
const SNAP_CLOUD_BYTES = 900000, SNAP_LOCAL_BYTES = 4000000, SNAP_MIN_KEEP = 5;   // Firestore 문서 1MiB·localStorage 쿼터 보호
function trimSnapsBySize(arr, maxBytes) {
  while (arr.length > SNAP_MIN_KEEP && JSON.stringify(arr).length > maxBytes) arr.shift();
  return arr;
}
let backupSnaps = [], unsubBackup = null, lastSnapHash = '', lastSnapTime = 0;
function localSnaps() { try { return JSON.parse(localStorage.getItem(SNAP_KEY) || '[]'); } catch (e) { return []; } }
function stateHash(s) { try { return JSON.stringify([s.projects, s.cards, s.groups, s.notes, s.schedules, s.timebox, s.journal, s.devlog]); } catch (e) { return 't' + Date.now(); } }
function snapSummary(st) {
  const p = st && st.projects ? st.projects.length : 0;
  const c = st && st.cards ? st.cards.length : 0;
  return `보드 ${p} · 카드 ${c}`;
}
function pushSnapshot(force) {
  const h = stateHash(state), now = Date.now();
  if (!force && (h === lastSnapHash || now - lastSnapTime < SNAP_MIN_MS)) return;
  lastSnapHash = h; lastSnapTime = now;
  const snap = { ts: new Date().toISOString(), state: JSON.parse(JSON.stringify(state)) };
  try { const l = trimSnapsBySize(localSnaps().concat([snap]).slice(-SNAP_LOCAL_MAX), SNAP_LOCAL_BYTES); localStorage.setItem(SNAP_KEY, JSON.stringify(l)); } catch (e) { /* quota */ }
  if (CLOUD && db && authUser) {
    backupSnaps = trimSnapsBySize(backupSnaps.concat([snap]).slice(-SNAP_MAX), SNAP_CLOUD_BYTES);
    db.collection('backups').doc(authUser.uid).set({ snaps: backupSnaps }).catch(e => console.warn('backup write failed', e));
  }
}
function subscribeBackups(uid) {
  if (unsubBackup) unsubBackup();
  unsubBackup = db.collection('backups').doc(uid).onSnapshot(s => {
    const d = s.data(); backupSnaps = (d && d.snaps) || [];
  }, e => console.warn('backup sub failed', e));
}

// 이 탭이 직접 올린 write의 savedAt 목록 — 서버 에코가 되돌아왔을 때 "내가 쓴 옛 상태"로 최신 로컬을 덮는 사고 방지
const ownWrites = new Set();
function doCloudWrite() {
  if (!(CLOUD && db && authUser)) return;
  if (state.savedAt) { ownWrites.add(state.savedAt); if (ownWrites.size > 50) ownWrites.delete(ownWrites.values().next().value); }
  db.collection('boards').doc(authUser.uid)
    .set({ state, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
    .catch(e => console.warn('sync write failed', e));
  pushSnapshot();
}
function save() {
  if (!applyingRemote) state.savedAt = Date.now();   // 로컬 편집 시각 스탬프 — 로드 시 클라우드보다 최신인지 판별용
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  if (CLOUD && db && authUser && !applyingRemote && boardLoaded) {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => { writeTimer = null; doCloudWrite(); }, 600);
  } else if (!CLOUD) {
    pushSnapshot();
  }
}
function flushWrite() {   // 대기 중인 디바운스 write를 즉시 반영 (탭 닫힘·백그라운드 전환 시 유실 방지)
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; doCloudWrite(); }
}
// 클라우드 로드 판정: 로컬 캐시가 클라우드보다 확실히 최신이면(마지막 편집이 미동기화) 로컬 유지
function localCacheNewer(localCached, remote) {
  if (!localCached) return false;
  const lt = localCached.savedAt || 0, rt = (remote && remote.savedAt) || 0;
  return lt > rt + 1500;   // 1.5s 여유(시계 오차 방지)
}
let boardLoaded = false;   // 첫 클라우드 스냅샷 수신 전에는 클라우드 쓰기 금지 → 스테일 상태가 최신을 덮어쓰는 사고 방지
function mergeById(local, cloud) {
  const byId = new Map();
  (cloud || []).forEach(x => { if (x && x.id) byId.set(x.id, x); });
  (local || []).forEach(x => { if (x && x.id) byId.set(x.id, x); });   // 같은 id는 로컬(최신) 우선, 한쪽에만 있는 항목은 모두 보존
  return [...byId.values()];
}
// 타임박스 하루 병합: 빈(방금 열어서 생긴) 항목이 채워진 항목을 덮지 않도록 항목별·칸별 병합
function mergeTimeboxDay(loc, cld) {
  if (!loc) return cld;
  if (!cld) return loc;
  const n = Math.max((loc.big3 || []).length, (cld.big3 || []).length, 3);
  const big3 = [];
  for (let i = 0; i < n; i++) big3.push((loc.big3 && loc.big3[i]) || (cld.big3 && cld.big3[i]) || null);
  return { big3, slots: Object.assign({}, cld.slots, loc.slots) };
}
function mergeByDate(locMap, cldMap, dayFn) {
  const out = {};
  const keys = new Set([...Object.keys(cldMap || {}), ...Object.keys(locMap || {})]);
  keys.forEach(k => { out[k] = dayFn((locMap || {})[k], (cldMap || {})[k]); });
  return out;
}
// 유실 방지 병합(union): 로컬·클라우드 어느 쪽에만 있는 항목도 모두 살림
function mergeStates(local, cloud) {
  const m = Object.assign({}, cloud, local);
  m.projects = mergeById(local.projects, cloud.projects);
  m.cards = mergeById(local.cards, cloud.cards);
  m.groups = mergeById(local.groups, cloud.groups);
  m.notes = mergeById(local.notes, cloud.notes);
  m.schedules = mergeById(local.schedules, cloud.schedules);
  m.trash = mergeById(local.trash, cloud.trash);
  m.timebox = mergeByDate(local.timebox, cloud.timebox, mergeTimeboxDay);
  m.journal = mergeByDate(local.journal, cloud.journal, (l, c) => Object.assign({}, c, l));   // 날짜별 필드 병합(auto/memo/ai 보존)
  m.settings = Object.assign({}, cloud.settings, local.settings);
  m.devlog = (local.devlog && cloud.devlog)
    ? { done: mergeById(local.devlog.done, cloud.devlog.done), future: mergeById(local.devlog.future, cloud.devlog.future) }
    : (local.devlog || cloud.devlog);
  m.sel = local.sel || cloud.sel;
  return m;
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushWrite();
    else if (document.visibilityState === 'visible') resyncOnWake();   // 잠자던 탭 복원 → 서버 최신 확인 전 쓰기 잠금
  });
  window.addEventListener('pagehide', flushWrite);
  window.addEventListener('pageshow', e => { if (e.persisted) resyncOnWake(); });   // bfcache 복원 대응
}

function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
async function initCloud() {
  const V = '10.12.2', base = `https://www.gstatic.com/firebasejs/${V}/`;
  try {
    await loadScript(base + 'firebase-app-compat.js');
    await Promise.all([loadScript(base + 'firebase-auth-compat.js'), loadScript(base + 'firebase-firestore-compat.js')]);
    firebase.initializeApp(window.firebaseConfig);
    db = firebase.firestore();
    firebase.auth().onAuthStateChanged(user => {
      authUser = user;
      if (user) { subscribeBoard(user.uid); subscribeBackups(user.uid); }
      else { if (unsubDoc) { unsubDoc(); unsubDoc = null; } if (unsubBackup) { unsubBackup(); unsubBackup = null; } showAuthGate(); }
    });
  } catch (e) {
    console.warn('cloud init failed → 로컬 모드', e);
    render();
  }
}
function normalizeState() {
  state.sel = state.sel || { view: 'board' };
  state.groups = state.groups || [];
  state.notes = state.notes || [];
  state.timebox = state.timebox || {};
  state.journal = state.journal || {};
  state.settings = state.settings || {};
  state.schedules = state.schedules || [];
  state.trash = state.trash || [];
}
/* ---------- 휴지통: 삭제 내역 보관·복원 ---------- */
const TRASH_MAX = 50, TRASH_DAYS = 30;
function toTrash(kind, payload) {
  state.trash = state.trash || [];
  state.trash.push(Object.assign({ id: 't-' + uid(), kind, deletedAt: new Date().toISOString() }, payload));
  const cutoff = new Date(Date.now() - TRASH_DAYS * 864e5).toISOString();
  state.trash = state.trash.filter(t => t.deletedAt >= cutoff).slice(-TRASH_MAX);
}
// 클라우드 상태 적용(모든 수신 공통): 로컬에 미동기화 편집이 있으면 union 병합, 아니면 교체
function applyCloudState(remote) {
  if (remote.savedAt && state.savedAt === remote.savedAt) { boardLoaded = true; return; }   // 동일 상태 에코 → 재렌더 불필요
  // 내가 올린 write가 뒤늦게 에코로 돌아온 경우: 그 사이 로컬에서 더 편집했다면 롤백이 되므로 무시
  if (remote.savedAt && ownWrites.has(remote.savedAt) && (state.savedAt || 0) > remote.savedAt) { boardLoaded = true; return; }
  const keepSel = state.sel;   // 화면 선택(탭·필터·달력 월)은 기기별 UI 상태 — 클라우드가 덮어쓰지 않음
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { cached = null; }
  if (cached && cached.groups && localCacheNewer(cached, remote)) {
    console.warn('로컬이 클라우드보다 최신 → 병합(union) 후 재동기화 (양쪽 데이터 보존)');
    state = mergeStates(cached, remote);
    if (keepSel) state.sel = keepSel;
    normalizeState();
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    render();
    boardLoaded = true;
    pushSnapshot(true);   // 병합 결과 스냅샷
    doCloudWrite();       // 병합본을 클라우드로 밀어올림
    return;
  }
  applyingRemote = true;
  state = remote;
  if (keepSel) state.sel = keepSel;
  normalizeState();
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  render();
  applyingRemote = false;
  boardLoaded = true;
  if (ensureDevlog() || backfillDevlog()) { save(); render(); }
  if (journalFreeze()) save();
  pushSnapshot();
}
function subscribeBoard(uid) {
  render();
  if (unsubDoc) unsubDoc();
  unsubDoc = db.collection('boards').doc(uid).onSnapshot(snap => {
    if (snap.metadata.hasPendingWrites) return;
    const data = snap.data();
    if (data && data.state) {
      applyCloudState(data.state);
    } else {
      boardLoaded = true;   // 신규 사용자: 문서 없음 → 쓰기 허용
      ensureDevlog();
      db.collection('boards').doc(uid).set({ state, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
  }, err => console.warn('snapshot error', err));
}
// 탭이 깨어날 때(모바일 탭 복원 등): 쓰기를 잠그고 서버 최신본을 강제로 받아 병합 후 재개
// — 잠자던 탭의 옛 상태가 다른 기기의 새 데이터를 덮어쓰는 사고 방지
function resyncOnWake() {
  if (!(CLOUD && db && authUser)) return;
  boardLoaded = false;                       // 동기화 확인 전까지 클라우드 쓰기 금지 (로컬 저장은 계속됨)
  clearTimeout(writeTimer); writeTimer = null;   // 잠들기 전 예약된 옛 상태 쓰기 폐기
  db.collection('boards').doc(authUser.uid).get()
    .then(snap => {
      const data = snap.data();
      if (data && data.state) applyCloudState(data.state);
      else boardLoaded = true;
    })
    .catch(() => { /* 오프라인: 쓰기 잠금 유지 — 편집은 로컬에 쌓이고 다음 동기화 때 병합됨 */ });
}
function authErr(e) {
  const c = e.code || '';
  if (c.includes('popup-closed-by-user') || c.includes('cancelled-popup-request')) return '로그인 창이 닫혔어요. 다시 시도해 주세요.';
  if (c.includes('popup-blocked')) return '팝업이 차단됐어요. 브라우저에서 팝업을 허용해 주세요.';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return '이메일 또는 비밀번호가 맞지 않아요.';
  if (c.includes('email-already-in-use')) return '이미 가입된 이메일이에요. 로그인하세요.';
  if (c.includes('weak-password')) return '비밀번호는 6자 이상이어야 해요.';
  if (c.includes('invalid-email')) return '이메일 형식이 올바르지 않아요.';
  return e.message || '오류가 발생했어요.';
}
function doAuth(kind) {
  const email = document.getElementById('g-email').value.trim();
  const pass = document.getElementById('g-pass').value;
  const fn = kind === 'signup' ? 'createUserWithEmailAndPassword' : 'signInWithEmailAndPassword';
  firebase.auth()[fn](email, pass).catch(e => { const m = document.getElementById('g-msg'); if (m) m.textContent = authErr(e); });
}
function showAuthGate(msg) {
  document.getElementById('app').innerHTML = `
    <div class="gate">
      <h1>업무 보드</h1>
      <p class="gate-sub">로그인하면 폰·PC 어디서든 같은 데이터를 씁니다.</p>
      <button type="button" class="gbtn" data-action="google-login">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
        Google로 로그인
      </button>
      <div class="gate-or"><span>또는 이메일로</span></div>
      <form class="gateform">
        <input type="email" id="g-email" placeholder="이메일" autocomplete="username">
        <input type="password" id="g-pass" placeholder="비밀번호 (6자 이상)" autocomplete="current-password">
        <div class="gate-msg" id="g-msg">${msg || ''}</div>
        <div class="gate-actions">
          <button type="submit" class="primary" data-action="login">로그인</button>
          <button type="button" class="ghost" data-action="signup">회원가입</button>
        </div>
      </form>
      <p class="gate-foot">처음이면 회원가입 → 이후 모든 기기에서 이 계정으로 로그인</p>
    </div>`;
}

function boardById(id) { return state.projects.find(p => p.id === id); }
function cardsOf(pid, status) { return state.cards.filter(c => c.project === pid && c.status === status); }

function weekDone() {
  const now = new Date();
  const mon = new Date(now); mon.setHours(0, 0, 0, 0);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return state.cards.filter(c => c.doneAt && new Date(c.doneAt + 'T00:00:00') >= mon).length;
}
function mondayOf(d) {
  const dt = new Date(d); dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return dt;
}
function doneWeekRange(offset) {
  const start = mondayOf(new Date());
  start.setDate(start.getDate() + offset * 7);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  return { start, end, startStr: dstr(start), endStr: dstr(end) };
}
function doneWeekLabel(offset, start, end) {
  const f = dt => `${dt.getMonth() + 1}/${dt.getDate()}`;
  const rel = offset === 0 ? '이번 주' : offset === -1 ? '지난 주' : offset === 1 ? '다음 주'
    : offset < 0 ? `${-offset}주 전` : `${offset}주 후`;
  return `${f(start)} ~ ${f(end)} · ${rel}`;
}

function orderedBoards() {
  const byParent = {};
  state.projects.forEach(b => { const p = b.parent || 'root'; (byParent[p] = byParent[p] || []).push(b); });
  const out = [], seen = new Set();
  (function walk(pid, depth) {
    (byParent[pid] || []).forEach(b => { if (seen.has(b.id)) return; seen.add(b.id); out.push({ board: b, depth }); walk(b.id, depth + 1); });
  })('root', 0);
  state.projects.forEach(b => { if (!seen.has(b.id)) { seen.add(b.id); out.push({ board: b, depth: 0 }); } });
  return out;
}

function descendantsOf(id) {
  const set = new Set([id]);
  let added = true;
  while (added) {
    added = false;
    state.projects.forEach(b => { if (b.parent && set.has(b.parent) && !set.has(b.id)) { set.add(b.id); added = true; } });
  }
  return set;
}
function isAncestor(ancId, nodeId) {
  let cur = boardById(nodeId), guard = 0;
  while (cur && cur.parent && guard++ < 100) { if (cur.parent === ancId) return true; cur = boardById(cur.parent); }
  return false;
}
// 상하 연결 + 프로젝트 통일: 연결된 트리는 같은 프로젝트 소속이 되도록
// (부모 쪽 트리에 프로젝트가 있으면 그걸로, 없는데 자식이 갖고 있으면 트리 전체가 자식의 프로젝트로 편입)
function setParent(childId, parentId) {
  const child = boardById(childId), parent = boardById(parentId);
  if (!child || !parent) return;
  const childG = child.group || null;
  child.parent = parentId;
  let root = parent, guard = 0;
  while (root.parent && boardById(root.parent) && guard++ < 100) root = boardById(root.parent);
  const g = root.group || childG || null;
  descendantsOf(root.id).forEach(id => { const b = boardById(id); if (b) b.group = g; });
}
function setGroupDeep(boardId, gid) {
  descendantsOf(boardId).forEach(id => { const b = boardById(id); if (b) b.group = gid; });
}

/* ---------- cards (post-its) ---------- */
function dueBadge(due) {
  const diff = dday(due);
  if (diff < 0) return `<span class="tag over">${-diff}일 지남</span>`;
  if (diff === 0) return '<span class="tag warn">D-day</span>';
  if (diff <= 3) return `<span class="tag warn">D-${diff}</span>`;
  return `<span class="tag">~ ${fmtDate(due)}</span>`;
}
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const fuNum = n => CIRCLED[n - 1] || String(n);
// FU 뱃지: 완수 후 다시 꺼낸 카드에 몇 차 후속인지 + 지난 완수 이력을 툴팁으로
function fuBadgeHtml(c) {
  if (!c.fuCount) return '';
  const hist = (c.fuHistory || []).map((d, i) => `${i + 1}차 완수 ${fmtDate(d)}`).join(' · ');
  return `<span class="fu-badge" title="${esc(hist ? hist + ' → 재개' : '완수 후 다시 진행')}">↩ FU ${fuNum(c.fuCount)}</span>`;
}
function cardHtml(c) {
  const pr = PRIORITIES[c.priority] || PRIORITIES.none;
  const style = pr.bg ? `style="background:${pr.bg};color:${pr.fg};border-color:transparent"` : '';
  const tags = [];
  if (c.status !== 'done' && c.due) tags.push(dueBadge(c.due));
  if (c.status === 'done' && c.doneAt) tags.push(`<span class="tag">${fmtDate(c.doneAt)} 완료</span>`);
  // 진행중은 인라인 칩(카드 밖으로 튀어나오면 레인 스크롤에 잘림), 완수만 워터마크 스탬프
  const overlay = c.status === 'done' ? '<span class="stamp">완료</span>' : '';
  if (c.status === 'doing') tags.unshift('<span class="doing-chip">진행중</span>');
  const note = c.note ? `<span class="card-note" data-note="${esc(c.note)}">💬</span>` : '';
  // 제목과 배지를 한 줄에 (2단 → 1단, 높이 절반)
  return `<div class="card ${c.status} ${c.fuCount ? 'is-fu' : ''}" ${style} draggable="true" data-id="${c.id}" data-action="card" title="${esc(c.title)}">
    ${overlay}<div class="t">${fuBadgeHtml(c)}<span class="ct">${esc(c.title)}</span>${note}</div>
    ${tags.length ? `<div class="meta">${tags.join('')}</div>` : ''}
  </div>`;
}

const openDoneLanes = new Set();   // 완수 레인 펼침 상태 (세션 한정 — 기본 접힘)
const openSideGroups = new Set();  // 보드 탭 사이드바에서 보드 목록 펼친 프로젝트 (세션 한정)
let pastSchedOpen = false;         // 일정 패널 '지난 일정' 그룹 펼침 (세션 한정)
const openPanels = new Set();      // 일정·완수 아카이브 패널 펼침 (세션 한정, 기본 접힘 — 화면 점유 축소)
const panelOpen = k => openPanels.has(k);
const panelCaret = k => `<span class="pn-caret">${panelOpen(k) ? '▾' : '▸'}</span>`;
function panelHtml(b, depth) {
  const parent = b.parent ? boardById(b.parent) : null;
  // 묶음 보드: 칸반 없이 얇은 머리글만 — 하위 보드들이 들여쓰기로 이어짐
  if (b.folder) {
    return `<section class="board-panel folder-panel" data-board="${b.id}" style="margin-left:${depth * 22}px">
      <span class="bname board-drag c-${b.color}" draggable="true" data-action="board-edit" data-id="${b.id}" title="묶음 보드 — 클릭=설정">📚 ${esc(b.name)}</span>
      <span class="folder-sub">묶음</span>
    </section>`;
  }
  const todo = cardsOf(b.id, 'todo');
  const doing = cardsOf(b.id, 'doing');
  const done = cardsOf(b.id, 'done').sort((a, c) => (c.doneAt || '').localeCompare(a.doneAt || ''));
  const doneOpen = openDoneLanes.has(b.id);
  // 미완료가 없는 보드는 한 줄 컴팩트 바로 — 입력하면 카드 생성과 함께 자동으로 전체 칸반 복귀
  if (!todo.length && !doing.length && !doneOpen) {
    return `<section class="board-panel compact-panel" data-board="${b.id}" style="margin-left:${depth * 22}px">
      <span class="bname board-drag c-${b.color}" draggable="true" data-action="board-edit" data-id="${b.id}" title="클릭=설정 · 끌어서 상하 구조">${esc(b.name)}</span>
      ${parent ? `<span class="bcrumb">▸ ${esc(parent.name)}</span>` : ''}
      ${done.length ? `<button class="mini-btn" data-action="lane-toggle" data-board="${b.id}" title="완수 내역 펼치기">✓ 완수 ${done.length} ▸</button>` : '<span class="cp-empty">할 일 없음</span>'}
      <form class="quick cp-quick" data-project="${b.id}"><input name="t" placeholder="+ 할 일 추가하고 Enter" autocomplete="off"></form>
    </section>`;
  }
  return `<section class="board-panel" data-board="${b.id}" style="margin-left:${depth * 22}px">
    <div class="panel-head">
      <span class="bname board-drag c-${b.color}" draggable="true" data-action="board-edit" data-id="${b.id}" title="클릭=설정 · 끌어서 다른 보드 위/아래에 놓으면 상하 구조">${esc(b.name)}</span>
      ${parent ? `<span class="bcrumb">▸ 상위 ${esc(parent.name)}</span>` : ''}
    </div>
    <div class="panel-cols">
      <div class="col" data-status="todo">
        <h3>To-do <span class="cnt">${todo.length}</span></h3>
        <div class="col-body slim-scroll">${todo.map(cardHtml).join('')}</div>
        <form class="quick" data-project="${b.id}"><input name="t" placeholder="+ 포스트잇 추가하고 Enter" autocomplete="off"></form>
      </div>
      <div class="col doing-col" data-status="doing">
        <h3>진행 중 <span class="cnt">${doing.length}</span></h3>
        <div class="col-body slim-scroll">${doing.map(cardHtml).join('') || '<div class="empty">지금 할 1~3장을 여기로 끌어오세요</div>'}</div>
      </div>
      ${doneOpen
        ? `<div class="col done-col" data-status="done">
        <h3 data-action="lane-toggle" data-board="${b.id}" title="접기">완수 <span class="cnt">${done.length}</span> <span class="lane-arrow">▾</span></h3>
        <div class="col-body slim-scroll">${done.slice(0, 20).map(cardHtml).join('') || '<div class="empty">끝내면 여기로!</div>'}</div>
      </div>`
        : `<div class="col done-col col-collapsed" data-status="done">
        <h3 data-action="lane-toggle" data-board="${b.id}" title="펼치기">완수 <span class="cnt">${done.length}</span> <span class="lane-arrow">▸</span></h3>
        <div class="drop-strip">카드를 여기로 끌면 완수</div>
      </div>`}
    </div>
  </section>`;
}
/* ✅ 완수 아카이브 (프로젝트 페이지): 보드별 그룹핑 + 월 필터 + 검색 + FU */
function archivePanelHtml(gid) {
  const gBoards = orderedBoardsIn(gid || null).map(x => x.board);
  const mSel = state.sel.archMonth || '';
  const ym = todayStr().slice(0, 7);
  const lastYm = (() => { const [y, m] = ym.split('-').map(Number); return dstr(new Date(y, m - 2, 1)).slice(0, 7); })();
  const inMonth = c => !mSel || (c.doneAt || '').slice(0, 7) === mSel;
  let total = 0, body = '';
  gBoards.forEach(b => {
    const done = state.cards.filter(c => c.project === b.id && c.status === 'done' && c.doneAt && inMonth(c))
      .sort((a, c) => (c.doneAt || '').localeCompare(a.doneAt || ''));
    if (!done.length) return;
    total += done.length;
    body += `<div class="arch-board-h"><span class="drow-proj c-${b.color}">${esc(b.name)}</span><span class="gcnt">${done.length}</span></div>`;
    body += done.map(c => `<div class="arch-row" data-action="card" data-id="${c.id}" data-text="${esc(c.title.toLowerCase())}" title="클릭=수정">
        <span class="arch-date">✓ ${fmtDate(c.doneAt)}</span>
        <span class="arch-t">${fuBadgeHtml(c)}${esc(c.title)}${(c.fuHistory || []).length ? `<span class="arch-fu">↩ ${(c.fuHistory || []).map(d => fmtDate(d)).join(' → ')} → ${fmtDate(c.doneAt)}</span>` : ''}</span>
        ${c.note ? `<span class="card-note" data-note="${esc(c.note)}">💬</span>` : ''}
        <button class="mini-btn fu-btn" data-action="card-fu" data-id="${c.id}" title="완수 이력을 남기고 다시 진행중으로">↩ FU</button>
      </div>`).join('');
  });
  const pill = (v, label) => `<button class="fpill ${mSel === v ? 'on' : ''}" data-action="arch-month" data-m="${v}">${label}</button>`;
  const aOpen = panelOpen('arch');
  return `<section class="sched-panel arch-panel ${aOpen ? '' : 'collapsed'}">
    <div class="group-head" data-action="panel-toggle" data-k="arch" title="${aOpen ? '접기' : '펼치기'}">${panelCaret('arch')}<span class="gname">✅ 완수 아카이브</span><span class="gcnt">${total}</span>
      ${!aOpen ? '' : `<span class="arch-filter">${pill('', '전체')}${pill(ym, '이번 달')}${pill(lastYm, '지난 달')}</span>
      <input type="search" id="arch-q" placeholder="🔍 완수 내역 검색" autocomplete="off">`}
    </div>
    ${!aOpen ? '' : (total ? `<div class="arch-list slim-scroll">${body}</div>` : `<div class="empty">${mSel ? '이 달에 완수한 내역이 없어요' : '아직 완수한 내역이 없어요'}</div>`)}
  </section>`;
}

function legendHtml() {
  const sw = PRIO_ORDER.filter(k => k !== 'none').map(k => `<span class="lg"><i style="background:${PRIORITIES[k].bg}"></i>${PRIORITIES[k].label}</span>`).join('');
  return `<div class="legend">중요도 <span class="lg"><i class="plain"></i>없음</span>${sw}</div>`;
}

function groupById(id) { return (state.groups || []).find(g => g.id === id); }
/* ---------- 프로젝트 일정(마감) ---------- */
function schedById(id) { return (state.schedules || []).find(s => s.id === id); }
function schedulesOf(gid) { return (state.schedules || []).filter(s => (s.group || '') === (gid || '')); }
function schedIsStale(s) { return !s.done && s.date && dday(s.date) < -7; }   // 7일 이상 지난 일정 — 현황·D-day에서 제외(달력·패널 기록용 유지)
function schedSort(a, b) {   // 미완료 먼저 → 마감일 오름차순 → 완료는 뒤(최신 완료 위)
  if (!!a.done !== !!b.done) return a.done ? 1 : -1;
  if (a.done) return (b.doneAt || '').localeCompare(a.doneAt || '');
  return (a.date || '').localeCompare(b.date || '');
}
function schedRow(s, hideProj) {
  const g = s.group ? groupById(s.group) : null;
  const badge = s.done ? `<span class="tag">${s.doneAt ? fmtDate(s.doneAt) + ' 완료' : '완료'}</span>` : dueBadge(s.date);
  return `<div class="sched-row ${s.done ? 'done' : ''}" data-action="sched-edit" data-id="${s.id}" title="클릭해서 수정·삭제">
    <span class="sched-pin">📌</span>
    ${!hideProj && g ? `<span class="drow-proj c-${g.color}">${esc(g.name)}</span>` : ''}
    <span class="sched-t">${esc(s.title)}</span>
    ${s.time ? `<span class="sched-time">🕐 ${s.time}</span>` : ''}
    ${s.note ? '<span class="card-note" data-note="' + esc(s.note) + '">💬</span>' : ''}
    ${badge}
  </div>`;
}
function schedProjOrder(s) {
  const key = s.group || '';
  if (key === '') return 99999;                       // 미분류는 뒤
  const i = (state.groups || []).findIndex(g => g.id === key);
  return i < 0 ? 99998 : i;
}
function schedGroupHeader(gid) {
  const g = gid ? groupById(gid) : null;
  return `<div class="dash-grp">${g ? `<span class="drow-proj c-${g.color}">${esc(g.name)}</span>` : '📄 미분류'}</div>`;
}
function schedRowsGrouped(list) {   // 프로젝트별 그룹 헤더 + 그 안에서 마감일순
  const sorted = list.slice().sort((a, b) => {
    const pa = schedProjOrder(a), pb = schedProjOrder(b);
    if (pa !== pb) return pa - pb;
    return schedSort(a, b);
  });
  let html = '', last = '__init';
  sorted.forEach(s => {
    const k = s.group || '';
    if (k !== last) { last = k; html += schedGroupHeader(k); }
    html += schedRow(s, true);
  });
  return html;
}
function openSchedModal(id, groupPrefill) {
  const s = id ? schedById(id) : null;
  const gid = s ? (s.group || '') : (groupPrefill || '');
  showModal(`
    <h3>${s ? '일정 수정' : '일정 추가'}</h3>
    <label>내용<input type="text" id="m-stitle" value="${s ? esc(s.title) : ''}" placeholder="예: 반기검토 보고서 제출 / 감사보고서 마감"></label>
    <div class="two">
      <label>마감일<input type="date" id="m-sdate" value="${s ? (s.date || '') : todayStr()}"></label>
      <label title="입력하면 타임박스 해당 시간칸에 표시됩니다">시간 (선택)<input type="time" id="m-stime" value="${s ? (s.time || '') : ''}"></label>
    </div>
    <label>프로젝트<select id="m-sgroup">
      ${(state.groups || []).map(g => `<option value="${g.id}" ${gid === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
      <option value="" ${gid === '' ? 'selected' : ''}>미분류</option>
    </select></label>
    <label>메모 (선택)<input type="text" id="m-snote" value="${s ? esc(s.note || '') : ''}" placeholder="예: 팀장 검토 후 제출"></label>
    <div class="m-actions">
      ${s ? `<button class="danger" data-action="sched-del" data-id="${s.id}">삭제</button>` : ''}
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="sched-save" data-id="${s ? s.id : ''}">저장</button>
    </div>`);
}
function orderedBoardsIn(gid) {
  const members = state.projects.filter(b => (b.group || null) === gid);
  const ids = new Set(members.map(b => b.id));
  const byParent = {};
  members.forEach(b => { const p = (b.parent && ids.has(b.parent)) ? b.parent : 'root'; (byParent[p] = byParent[p] || []).push(b); });
  const out = [], seen = new Set();
  (function walk(pid, depth) {
    (byParent[pid] || []).forEach(b => { if (seen.has(b.id)) return; seen.add(b.id); out.push({ board: b, depth }); walk(b.id, depth + 1); });
  })('root', 0);
  members.forEach(b => { if (!seen.has(b.id)) { seen.add(b.id); out.push({ board: b, depth: 0 }); } });
  return out;
}
function groupSecHtml(gid, hideHead) {
  const g = gid ? groupById(gid) : null;
  const items = orderedBoardsIn(gid || null);
  const head = hideHead ? '' : (g
    ? `<div class="group-head"><span class="gname c-${g.color}" data-action="group-edit" data-id="${g.id}" title="클릭=프로젝트 이름·삭제">📁 ${esc(g.name)}</span><span class="gcnt">보드 ${items.filter(x => !x.board.folder).length}</span><button class="mini-btn" data-action="proj-add" data-group="${g.id}">+ 보드</button></div>`
    : ((state.groups || []).length ? `<div class="group-head"><span class="gname plain">📄 미분류</span><span class="gcnt">보드 ${items.filter(x => !x.board.folder).length}</span></div>` : ''));
  const empty = g ? '여기로 보드를 끌어오면 이 프로젝트 소속 · 또는 [+ 보드]' : '여기로 끌어오면 미분류(프로젝트 없음)로 이동';
  return `<div class="group-sec" data-group="${gid}">
    ${head}
    ${items.length ? `<div class="boards">${items.map(({ board, depth }) => panelHtml(board, depth)).join('')}</div>` : `<div class="empty droptip">${empty}</div>`}
  </div>`;
}
function renderBoardView() {
  const groups = state.groups || [];
  let sel = state.sel.boardGroup;
  if (sel === undefined || (sel !== '__all' && sel !== '' && !groupById(sel))) sel = '__all';
  state.sel.boardGroup = sel;
  const bCount = gid => state.projects.filter(b => (b.group || '') === gid && !b.folder).length;
  // 사이드바 숫자 = 미완료 To-do 수 (보드 개수 대신)
  const openTodos = bid => state.cards.filter(c => c.project === bid && c.status !== 'done').length;
  const openTodosGroup = gid => state.projects.filter(b => (b.group || '') === gid).reduce((s, b) => s + openTodos(b.id), 0);
  const openTodosAll = state.cards.filter(c => c.project && c.status !== 'done').length;
  // 프로젝트 행 + (펼침 시) 그 소속 보드 하위 목록. 선택된 프로젝트는 자동 펼침.
  const sideGroupRow = (gid, name, color, dot) => {
    const boards = orderedBoardsIn(gid || null);
    const expanded = openSideGroups.has(gid);   // 펼침은 오직 openSideGroups로 — 선택과 무관하게 독립 토글·누적
    const caret = boards.length ? `<button class="side-caret" data-action="side-toggle" data-gid="${gid}" title="보드 ${expanded ? '접기' : '펼치기'}">${expanded ? '▾' : '▸'}</button>` : '<span class="side-caret sp"></span>';
    let html = `<div class="side-item ${sel === gid ? 'on c-' + color : ''}" data-action="board-group" data-gid="${gid}">${caret}<span class="side-dot c-${dot || color}"></span><span class="side-name">${esc(name)}</span><span class="side-cnt" title="미완료 To-do">${openTodosGroup(gid) || ''}</span></div>`;
    if (expanded && boards.length) {
      html += `<div class="side-sub">` + boards.map(({ board, depth }) => `<div class="side-sub-item ${focusBoard === board.id ? 'on' : ''} ${board.folder ? 'is-folder' : ''}" data-action="side-board" data-bid="${board.id}" style="padding-left:${8 + depth * 13}px" title="${board.folder ? '묶음 보드' : '이 보드로 이동'}"><span class="side-dot c-${board.color}"></span><span class="side-name">${board.folder ? '📚 ' : ''}${esc(board.name)}</span><span class="side-cnt" title="미완료 To-do">${openTodos(board.id) || ''}</span></div>`).join('') + `</div>`;
    }
    return html;
  };
  const side = `<aside class="notes-side">
    <div class="side-h">프로젝트</div>
    <div class="side-item ${sel === '__all' ? 'on c-gray' : ''}" data-action="board-group" data-gid="__all"><span class="side-caret sp"></span><span class="side-dot c-gray"></span><span class="side-name">전체</span><span class="side-cnt" title="미완료 To-do">${openTodosAll || ''}</span></div>
    ${groups.map(g => sideGroupRow(g.id, g.name, g.color, g.color)).join('')}
    ${sideGroupRow('', '미분류', 'gray', 'gray')}
    <div class="side-actions">
      <button class="pill" data-action="group-add">📁 + 프로젝트</button>
      <button class="pill" data-action="folder-add" ${sel !== '__all' && sel !== '' ? `data-group="${sel}"` : ''} title="하위 보드를 묶는 분류용 보드">📚 + 묶음</button>
      <button class="pill" data-action="proj-add" ${sel !== '__all' && sel !== '' ? `data-group="${sel}"` : ''}>🗂 + 보드</button>
    </div>
  </aside>`;
  const inbox = state.cards.filter(c => !c.project && c.status !== 'done');
  const inboxHtml = `<section class="inbox top-panel">
    <div class="tp-head"><span class="tp-title">📥 미배정 · 예정</span><span class="tp-cnt">${inbox.length}</span></div>
    <p class="tp-sub">보드에 넣기 전 임시 보관 · 카드를 보드로 드래그</p>
    <div class="col inbox-col" data-status="todo" data-inbox="1">
      ${inbox.map(cardHtml).join('')}
      <form class="quick" data-project="__inbox"><input name="t" placeholder="+ 예정 할 일 추가" autocomplete="off"></form>
    </div>
  </section>`;
  // 상단 2단: 좌=미배정 예정 / 우=미분류 보드 — 전체·개별 프로젝트 공통
  // (사이드바에서 '미분류'를 고른 경우엔 본문이 곧 미분류라 중복 방지 위해 미배정만)
  const unassignedPanel = `<section class="top-panel">
      <div class="tp-head"><span class="tp-title">📄 미분류 보드</span><span class="tp-cnt">${bCount('')}</span></div>
      <p class="tp-sub">프로젝트에 속하지 않은 보드 · 사이드바 프로젝트로 끌어 편입</p>
      ${groupSecHtml('', true)}
    </section>`;
  const splitTop = `<div class="board-top">${inboxHtml}${unassignedPanel}</div>`;
  let page, topArea = sel === '' ? inboxHtml : splitTop;
  if (sel === '__all') {
    const allScheds = (state.schedules || []).slice().sort(schedSort);
    const sOpen = panelOpen('sched');
    const schedPanel = `<section class="sched-panel ${sOpen ? '' : 'collapsed'}">
        <div class="group-head" data-action="panel-toggle" data-k="sched" title="${sOpen ? '접기' : '펼치기'}">${panelCaret('sched')}<span class="gname">📌 일정 · 마감 (전체)</span><span class="gcnt">${allScheds.length}</span><button class="mini-btn" data-action="sched-add">+ 일정 추가</button></div>
        ${!sOpen ? '' : (allScheds.length ? `<div class="sched-list">${schedRowsGrouped(allScheds)}</div>` : '<div class="empty">보고서 제출·마감 등 프로젝트 일정을 추가하세요 (추가 시 프로젝트 선택)</div>')}
      </section>`;
    page = schedPanel + groups.map(g => groupSecHtml(g.id)).join('');   // 미분류는 상단으로 이동
  } else {
    const g = sel ? groupById(sel) : null;
    const gname = g ? g.name : '미분류';
    const gBoards = state.projects.filter(b => (b.group || '') === sel);
    const bIds = new Set(gBoards.map(b => b.id));
    const gCards = state.cards.filter(c => c.project && bIds.has(c.project));
    const doneCnt = gCards.filter(c => c.status === 'done').length;
    const periods = (g && g.periods && g.periods.length) ? g.periods : null;
    const periodTxt = periods ? `${fmtDate(periods[0].start)} ~ ${fmtDate(periods[periods.length - 1].end)}${periods.length > 1 ? ` 외 ${periods.length - 1}` : ''}` : '기간 미설정';
    const schedsAll = schedulesOf(sel).slice().sort(schedSort);
    const scheds = schedsAll.filter(s => !schedIsStale(s));
    const pastScheds = schedsAll.filter(schedIsStale).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const nextSched = scheds.find(s => !s.done);
    const dd = nextSched ? dday(nextSched.date) : 0;
    const schedChip = nextSched ? `<span class="prop-chip sched-chip" data-action="sched-edit" data-id="${nextSched.id}" title="다가오는 일정">📌 ${esc(nextSched.title)} · ${dd < 0 ? -dd + '일 지남' : dd === 0 ? 'D-day' : 'D-' + dd}</span>` : '';
    const sOpen = panelOpen('sched');
    const schedPanel = `<section class="sched-panel ${sOpen ? '' : 'collapsed'}">
        <div class="group-head" data-action="panel-toggle" data-k="sched" title="${sOpen ? '접기' : '펼치기'}">${panelCaret('sched')}<span class="gname">📌 일정 · 마감</span><span class="gcnt">${scheds.length}</span>${nextSched ? `<span class="pn-peek">다음 ${esc(nextSched.title)} · ${dd < 0 ? -dd + '일 지남' : dd === 0 ? 'D-day' : 'D-' + dd}</span>` : ''}<button class="mini-btn" data-action="sched-add" data-group="${sel}">+ 일정 추가</button></div>
        ${!sOpen ? '' : `${scheds.length ? `<div class="sched-list">${scheds.map(s => schedRow(s, true)).join('')}</div>` : '<div class="empty">보고서 제출·마감 등 이 프로젝트의 일정을 추가하세요</div>'}
        ${pastScheds.length ? `<button class="mini-btn past-toggle" data-action="sched-past-toggle">지난 일정 ${pastScheds.length} ${pastSchedOpen ? '▾' : '▸'}</button>${pastSchedOpen ? `<div class="sched-list sched-past">${pastScheds.map(s => schedRow(s, true)).join('')}</div>` : ''}` : ''}`}
      </section>`;
    page = `<div class="page-head"><span class="page-icon c-${g ? g.color : 'gray'}">📁</span><h2 class="page-title">${esc(gname)}</h2>
        ${g ? `<button class="mini-btn" data-action="group-edit" data-id="${g.id}">설정</button>` : ''}
        <button class="mini-btn" data-action="proj-add" ${sel ? `data-group="${sel}"` : ''}>+ 보드</button></div>
      <div class="prop-bar">
        <span class="prop-chip" ${g ? `data-action="group-edit" data-id="${g.id}" title="클릭해서 기간 수정"` : ''}>📅 ${periodTxt}</span>
        <span class="prop-chip">🗂 보드 ${gBoards.filter(b => !b.folder).length}</span>
        <span class="prop-chip">✅ 진행 ${doneCnt}/${gCards.length}</span>
        ${schedChip}
      </div>` + schedPanel + archivePanelHtml(sel) + groupSecHtml(sel, true);
  }
  return legendHtml()
    + `<div class="board-wrap">${side}<div class="board-page">
        <div class="addbar"><span class="board-hint">보드 드래그: 다른 보드 위=앞 순서 / 가운데=하위로 / 아래=뒤 순서 · 왼쪽 사이드바 프로젝트=편입 · 왼쪽 끝=분리 · 오른쪽 끝=삭제</span></div>
        ${topArea}
        ${page}
      </div></div>`
    + `<div class="unassign-hint">📥 보드 밖에 놓으면 <b>미배정</b>으로 이동</div>`
    + `<div class="detach-lane"><span>◀<br>여기에 놓으면<br>보드 분리<br>(독립)</span></div>`
    + `<div class="delete-lane"><span>🗑<br>여기에 놓으면<br>보드 삭제</span></div>`;
}

/* ---------- structure map ---------- */
function ensurePositions() {
  let i = 0;
  state.projects.forEach(b => {
    if (typeof b.x !== 'number' || typeof b.y !== 'number') {
      b.x = 30 + (i % 4) * 180; b.y = 30 + Math.floor(i / 4) * 120;
    }
    i++;
  });
}
function autoLayout() {
  const COLW = 175, ROWH = 110, GAPX = 50, GAPY = 80, STARTX = 30, STARTY = 46;
  const mapEl = document.getElementById('map');
  const MAXW = Math.max(700, (mapEl ? mapEl.clientWidth : 1100) - 30);
  let curX = STARTX, curY = STARTY, rowH = 0, placedAny = false;
  const place = (members) => {   // 한 프로젝트(구역)를 내부 트리로 배치 → 블록으로 반환
    const ids = new Set(members.map(b => b.id));
    const byParent = {};
    members.forEach(b => { const p = (b.parent && ids.has(b.parent)) ? b.parent : 'root'; (byParent[p] = byParent[p] || []).push(b); });
    const xOf = {}, depthOf = {}, visited = new Set();
    let leaf = 0, maxDepth = 0;
    const assign = (id, depth) => {
      if (visited.has(id)) return; visited.add(id);
      depthOf[id] = depth; if (depth > maxDepth) maxDepth = depth;
      const kids = byParent[id] || [];
      if (!kids.length) { xOf[id] = leaf++; }
      else {
        kids.forEach(k => assign(k.id, depth + 1));
        const xs = kids.map(k => xOf[k.id]).filter(v => typeof v === 'number');
        xOf[id] = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : leaf++;
      }
    };
    (byParent.root || []).forEach(r => assign(r.id, 0));
    members.forEach(b => { if (!visited.has(b.id)) assign(b.id, 0); });
    const blockW = Math.max(1, leaf) * COLW;
    const blockH = (maxDepth + 1) * ROWH;
    if (placedAny && curX > STARTX && curX + blockW > MAXW) { curX = STARTX; curY += rowH + GAPY; rowH = 0; }   // 폭 넘치면 다음 줄로
    members.forEach(b => {
      b.x = curX + (xOf[b.id] || 0) * COLW;
      b.y = curY + (depthOf[b.id] || 0) * ROWH;
    });
    curX += blockW + GAPX; rowH = Math.max(rowH, blockH); placedAny = true;
  };
  (state.groups || []).forEach(g => {
    const ms = state.projects.filter(b => (b.group || null) === g.id && !b.done);   // 완료 보드는 선반에 있으므로 제외
    if (ms.length) place(ms);
  });
  const un = state.projects.filter(b => !b.group && !b.done);
  if (un.length) place(un);
  save();
}
let focusBoard = null;   // board to scroll to in board view after nav
let pendingMapPos = null; // {x,y,group} for add-board-at-click
// 완료 보드 선반(구역 오른쪽에 작게 모아두는 영역) 치수
const SHELF_W = 132, CHIP_H = 22, CHIP_GAP = 4, SHELF_TOP = 34;
const SHELF_MAX = 8;                     // 이보다 많으면 '+N개 더'로 접음(구역이 세로로 길어지는 것 방지)
const shelfExpanded = new Set();          // 선반을 펼쳐 본 프로젝트(세션 한정)
const shelfH = (n, gid) => {
  // 표시 줄 수: 접힘=최대 8+'+N' 1줄 / 펼침=전체+'접기' 1줄 / 8 이하=그대로
  const rows = n > SHELF_MAX ? (shelfExpanded.has(gid) ? n + 1 : SHELF_MAX + 1) : n;
  return SHELF_TOP + rows * (CHIP_H + CHIP_GAP) + 10;
};
function regionRects() {
  return (state.groups || []).map(g => {
    const all = state.projects.filter(b => (b.group || null) === g.id);
    const ms = all.filter(b => !b.done);      // 진행 중 보드만 배치 대상
    const dn = all.filter(b => b.done);       // 완료 보드는 오른쪽 선반에 모음
    if (!ms.length) {
      if (!dn.length) {   // 빈 프로젝트: 지도에서 만든 경우 저장된 위치에 빈 구역으로 표시
        if (typeof g.mapX === 'number' && typeof g.mapY === 'number')
          return { gid: g.id, name: g.name, color: g.color, x: g.mapX, y: g.mapY, w: 220, h: 110, empty: true, done: [] };
        return null;
      }
      // 완료 보드만 남은 프로젝트 — 선반만 있는 작은 구역
      const bx = typeof g.mapX === 'number' ? g.mapX : Math.min(...dn.map(b => b.x || 30)) - 18;
      const by = typeof g.mapY === 'number' ? g.mapY : Math.min(...dn.map(b => b.y || 30)) - 36;
      return { gid: g.id, name: g.name, color: g.color, x: bx, y: by, w: SHELF_W + 20, h: Math.max(110, shelfH(dn.length, g.id)), done: dn, onlyDone: true };
    }
    const xs = ms.map(b => b.x), ys = ms.map(b => b.y);
    const x = Math.min(...xs) - 18, y = Math.min(...ys) - 36;
    let w = Math.max(...xs) + 150 - x + 18, h = Math.max(...ys) + 44 - y + 18;
    if (dn.length) { w += SHELF_W; h = Math.max(h, shelfH(dn.length, g.id)); }
    return { gid: g.id, name: g.name, color: g.color, x, y, w, h, done: dn };
  }).filter(Boolean);
}
// 완료 보드 칩 — 구역 오른쪽 선반에 세로로 쌓아 배치
function doneChipsHtml(r) {
  if (!r.done || !r.done.length) return '';
  const left = r.x + r.w - SHELF_W + 6;
  const shown = shelfExpanded.has(r.gid) ? r.done : r.done.slice(0, SHELF_MAX);
  const rest = r.done.length - shown.length;
  const label = `<div class="map-shelf-label" style="left:${left}px;top:${r.y + 12}px">✓ 완료 ${r.done.length}</div>`;
  const chips = shown.map((b, i) =>
    `<div class="mapdone c-${b.color}" data-id="${b.id}" style="left:${left}px;top:${r.y + SHELF_TOP + i * (CHIP_H + CHIP_GAP)}px"
      title="${esc(b.name)}${b.doneAt ? ' · 완료 ' + fmtDate(b.doneAt) : ''} — 클릭하면 보드 설정">${esc(b.name)}</div>`).join('');
  const more = (rest > 0 || shelfExpanded.has(r.gid))
    ? `<div class="mapdone more" data-gid="${r.gid}" style="left:${left}px;top:${r.y + SHELF_TOP + shown.length * (CHIP_H + CHIP_GAP)}px"
        title="완료 보드 ${rest > 0 ? '더 보기' : '접기'}">${rest > 0 ? `+${rest}개 더` : '접기'}</div>` : '';
  return label + chips + more;
}
function renderMap() {
  ensurePositions();
  const rects = regionRects();
  const regions = rects.map(r =>
    `<div class="map-region c-${r.color} ${r.empty ? 'empty' : ''}" data-gid="${r.gid}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"><span class="map-region-label" data-gid="${r.gid}" title="드래그하면 프로젝트 전체 이동">📁 ${esc(r.name)}</span>${r.empty ? '<span class="region-empty-hint">빈 곳 클릭 → 보드 추가</span>' : ''}</div>`).join('');
  const doneChips = rects.map(doneChipsHtml).join('')
    + state.projects.filter(b => b.done && !b.group).map(b =>   // 미분류 완료 보드는 제자리에 칩으로
      `<div class="mapdone c-${b.color}" data-id="${b.id}" style="left:${b.x}px;top:${b.y}px" title="${esc(b.name)}${b.doneAt ? ' · 완료 ' + fmtDate(b.doneAt) : ''} — 클릭하면 보드 설정">${esc(b.name)}</div>`).join('');
  const nodes = state.projects.filter(b => !b.done).map(b => {
    const cs = state.cards.filter(c => c.project === b.id);
    const done = cs.filter(c => c.status === 'done').length;
    const doing = cs.filter(c => c.status === 'doing').length;
    const badge = doing > 0 ? `<span class="node-badge doing">▶${doing}</span>`
      : (cs.length && done === cs.length) ? '<span class="node-badge done">✓</span>' : '';
    const prog = cs.length ? `<div class="node-prog"><div class="node-prog-fill" style="width:${Math.round(done / cs.length * 100)}%"></div></div>` : '';
    const stat = cs.length ? ` — 완수 ${done}/${cs.length}${doing ? ` · 진행중 ${doing}` : ''}` : '';
    return `
    <div class="mapnode c-${b.color} ${b.folder ? 'folder' : ''}" data-id="${b.id}" style="left:${b.x}px;top:${b.y}px" data-stat="${esc(b.name)}${b.folder ? ' — 묶음 보드' : stat}">
      <div class="mp mp-top" data-id="${b.id}" data-role="top" title="상위 연결점 — 여기서 부모 보드로 끌기"></div>
      ${badge}<div class="mapnode-name">${b.folder ? '📚 ' : ''}${esc(b.name)}</div>${b.folder ? '' : prog}
      <div class="mp mp-bot" data-id="${b.id}" data-role="bot" title="하위 연결점 — 여기서 자식 보드로 끌기"></div>
    </div>`;
  }).join('');
  const h = Math.max(640,
    state.projects.filter(b => !b.done).reduce((m, b) => Math.max(m, b.y || 0), 0) + 140,
    rects.reduce((m, r) => Math.max(m, r.y + r.h), 0) + 40);   // 완료 선반이 아래로 넘치지 않게
  const unassigned = state.cards.filter(c => c.status !== 'done' && !c.project);
  const todoItems = unassigned.map(c => {
    const pr = PRIORITIES[c.priority] || PRIORITIES.none;
    return `<div class="map-todo-item" draggable="true" data-id="${c.id}" title="왼쪽 보드로 끌어 배정 · 클릭=수정">
      <span class="drow-prio" style="${pr.bg ? 'background:' + pr.bg : ''}"></span>
      <span class="mt-t">${esc(c.title)}</span>
    </div>`;
  }).join('') || '<div class="empty">미배정 할 일이 없어요 👍</div>';
  return `<div class="map-split">
    <div class="map-toolbar">
      <button class="pill" data-action="map-arrange" title="프로젝트별 구역으로 나눠 상위→하위 자동 배치">⟲ 자동정렬</button>
      <span class="maphint">색 구역 = 프로젝트 · 노드를 구역 안으로 끌면 소속 · 빈 곳 클릭 = 보드 추가 · 더블클릭 = 보드로 이동</span>
    </div>
    <div class="map" id="map" style="height:${h}px">${regions}${doneChips}<svg class="maplines" id="maplines"></svg>${nodes}</div>
    <aside class="map-todos">
      <div class="side-h">📥 미배정 할 일 <span class="gcnt">${unassigned.length}</span></div>
      <p class="maphint2">할 일을 왼쪽 보드로 끌어 배정 · 클릭해 수정</p>
      <div class="map-todo-list">${todoItems}</div>
      <form class="quick" data-project="__inbox"><input name="t" placeholder="+ 할 일 추가하고 Enter" autocomplete="off"></form>
    </aside>
  </div>`;
}
// 구조도 노드 hover 말풍선: 그 보드의 진행 중·완수 항목을 실제 제목으로 보여줌
const MAP_POP_MAX = 6;   // 구역별 최대 표시 건수 (넘치면 '+N건 더')
function mapPopHtml(bid) {
  const b = boardById(bid);
  if (!b) return '';
  const g = b.group ? groupById(b.group) : null;
  const cs = state.cards.filter(c => c.project === bid);
  const doing = cs.filter(c => c.status === 'doing');
  const done = cs.filter(c => c.status === 'done')
    .sort((a, b2) => (b2.doneAt || '').localeCompare(a.doneAt || ''));
  const todo = cs.filter(c => c.status !== 'doing' && c.status !== 'done');
  const sec = (cls, icon, label, items, meta) => {
    if (!items.length) return '';
    const rows = items.slice(0, MAP_POP_MAX).map(c =>
      `<li><span class="mpop-t">${esc(c.title)}</span>${meta(c)}</li>`).join('');
    const more = items.length > MAP_POP_MAX ? `<li class="mpop-more">+${items.length - MAP_POP_MAX}건 더</li>` : '';
    return `<div class="mpop-sec ${cls}"><div class="mpop-h">${icon} ${label} <span class="mpop-n">${items.length}</span></div><ul>${rows}${more}</ul></div>`;
  };
  const body =
    sec('doing', '▶', '진행 중', doing, c => c.due ? `<span class="mpop-d">${fmtDate(c.due)}</span>` : '') +
    sec('done', '✓', '완수', done, c => c.doneAt ? `<span class="mpop-d">${fmtDate(c.doneAt)}</span>` : '');
  const foot = todo.length ? `<div class="mpop-foot">📅 예정 ${todo.length}건</div>` : '';
  return `<div class="mpop-head">${g ? `<span class="mpop-proj c-${g.color}">${esc(g.name)}</span>` : ''}<span class="mpop-name">${esc(b.name)}</span></div>
    ${body || '<div class="mpop-empty">진행 중·완수한 할 일이 아직 없어요</div>'}${foot}`;
}
function mapPopEl() {
  let el = document.getElementById('map-pop');
  if (!el) { el = document.createElement('div'); el.id = 'map-pop'; el.className = 'map-pop'; document.body.appendChild(el); }
  return el;
}
function hideMapPop() { const el = document.getElementById('map-pop'); if (el) el.classList.remove('on'); }
function showMapPop(node) {
  const el = mapPopEl();
  el.innerHTML = mapPopHtml(node.dataset.id);
  el.classList.add('on');
  const r = node.getBoundingClientRect(), pr = el.getBoundingClientRect(), GAP = 10;
  let left = r.right + GAP, side = 'left';           // 기본은 노드 오른쪽(말풍선 꼬리는 왼쪽)
  if (left + pr.width > innerWidth - 8) { left = r.left - GAP - pr.width; side = 'right'; }
  if (left < 8) { left = Math.min(Math.max(8, r.left), innerWidth - pr.width - 8); side = 'none'; }
  let top = r.top + r.height / 2 - pr.height / 2;
  top = Math.max(8, Math.min(top, innerHeight - pr.height - 8));
  el.style.left = left + 'px'; el.style.top = top + 'px';
  el.dataset.side = side;
}
function drawLines(temp) {
  const map = document.getElementById('map');
  if (!map) return;
  const svg = document.getElementById('maplines');
  const mr = map.getBoundingClientRect();
  const anchor = id => {
    const el = map.querySelector(`.mapnode[data-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { cx: r.left - mr.left + r.width / 2, top: r.top - mr.top, bottom: r.top - mr.top + r.height };
  };
  let paths = '', cuts = '';
  state.projects.forEach(b => {
    if (!b.parent) return;
    const p = anchor(b.parent), c = anchor(b.id);
    if (p && c) {
      paths += `<path class="mapline" d="M ${p.cx} ${p.bottom} C ${p.cx} ${p.bottom + 36}, ${c.cx} ${c.top - 36}, ${c.cx} ${c.top}"/>`;
      const mx = (p.cx + c.cx) / 2, my = (p.bottom + c.top) / 2;
      cuts += `<g class="mapcut" data-child="${b.id}" transform="translate(${mx},${my})"><title>연결 끊기</title><circle r="9"></circle><text>✕</text></g>`;
    }
  });
  if (temp) paths += `<path class="mapline temp" d="M ${temp.x1} ${temp.y1} L ${temp.x2} ${temp.y2}"/>`;
  svg.innerHTML = paths + cuts;
}
function initMap() {
  const map = document.getElementById('map');
  if (!map) return;
  drawLines();
  const CLICK_MS = 300, THRESH = 4;
  let mode = null, id = null, role = null, offx = 0, offy = 0, sx = 0, sy = 0;
  let clickTimer = null, lastId = null, lastTime = 0, cutId = null;
  let regionGid = null, regionStart = null;   // 구역 드래그: gid + 멤버 시작좌표
  let moreGid = null;                          // 완료 선반 '+N개 더/접기' 칩

  // hover 말풍선 — 드래그·연결·스크롤 중에는 방해되지 않게 숨김
  let popTimer = null;
  const popCancel = () => { clearTimeout(popTimer); popTimer = null; hideMapPop(); };
  map.addEventListener('mouseover', e => {
    const node = e.target.closest('.mapnode');
    if (!node || mode) return;
    clearTimeout(popTimer);
    popTimer = setTimeout(() => { if (!mode) showMapPop(node); }, 180);   // 지나가다 스치는 건 무시
  });
  map.addEventListener('mouseout', e => {
    const node = e.target.closest('.mapnode');
    if (node && !node.contains(e.relatedTarget)) popCancel();
  });
  map.addEventListener('scroll', popCancel, { passive: true });
  map.addEventListener('mouseleave', popCancel);

  map.addEventListener('pointerdown', e => {
    popCancel();
    const cut = e.target.closest('.mapcut');
    if (cut) { mode = 'cut'; cutId = cut.dataset.child; e.preventDefault(); return; }
    const cp = e.target.closest('.mp');
    if (cp) { mode = 'link'; id = cp.dataset.id; role = cp.dataset.role; map.classList.add('linking'); map.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    const rl = e.target.closest('.map-region-label');
    if (rl) {   // 프로젝트 구역 라벨 드래그 → 소속 보드 전체 이동
      mode = 'region'; regionGid = rl.dataset.gid; sx = e.clientX; sy = e.clientY;
      regionStart = {};
      state.projects.forEach(b => { if ((b.group || null) === regionGid) regionStart[b.id] = { x: b.x, y: b.y }; });
      map.setPointerCapture(e.pointerId); e.preventDefault();
      return;
    }
    const chip = e.target.closest('.mapdone');
    if (chip) { mode = 'donechip'; id = chip.dataset.id || null; moreGid = chip.dataset.gid || null; e.preventDefault(); return; }   // 완료 칩 = 클릭만(드래그·빈곳추가 방지)
    const node = e.target.closest('.mapnode');
    if (node) {
      mode = 'pending'; id = node.dataset.id; sx = e.clientX; sy = e.clientY;
      const b = boardById(id), mr = map.getBoundingClientRect();
      offx = (e.clientX - mr.left) - b.x; offy = (e.clientY - mr.top) - b.y;
      map.setPointerCapture(e.pointerId);
      return;
    }
    mode = 'empty'; sx = e.clientX; sy = e.clientY;
  });

  map.addEventListener('pointermove', e => {
    if (!mode) return;
    const mr = map.getBoundingClientRect();
    const px = e.clientX - mr.left, py = e.clientY - mr.top;
    if (mode === 'pending' && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > THRESH) {
      mode = 'move';
      map.querySelector(`.mapnode[data-id="${id}"]`).classList.add('dragging');
    }
    if (mode === 'move') {
      const b = boardById(id);
      b.x = Math.max(0, Math.min(px - offx, map.clientWidth - 60));
      b.y = Math.max(0, Math.min(py - offy, map.clientHeight - 30));
      const el = map.querySelector(`.mapnode[data-id="${id}"]`);
      el.style.left = b.x + 'px'; el.style.top = b.y + 'px';
      drawLines();
    } else if (mode === 'region') {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      Object.keys(regionStart).forEach(bid => {
        const b = boardById(bid);
        if (!b) return;
        b.x = Math.max(0, regionStart[bid].x + dx);
        b.y = Math.max(0, regionStart[bid].y + dy);
        const el = map.querySelector(`.mapnode[data-id="${bid}"]`);
        if (el) { el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; }
      });
      const rg = map.querySelector(`.map-region[data-gid="${regionGid}"]`);
      if (rg) {   // 구역 박스도 함께 이동 (다음 render에서 정확히 재계산)
        const rr = regionRects().find(r => r.gid === regionGid);
        if (rr) { rg.style.left = rr.x + 'px'; rg.style.top = rr.y + 'px'; }
      }
      drawLines();
    } else if (mode === 'link') {
      const r = map.querySelector(`.mapnode[data-id="${id}"]`).getBoundingClientRect();
      const y1 = role === 'top' ? r.top - mr.top : r.top - mr.top + r.height;
      drawLines({ x1: r.left - mr.left + r.width / 2, y1, x2: px, y2: py });
    }
  });

  map.addEventListener('pointerup', e => {
    const mr = map.getBoundingClientRect();
    map.classList.remove('linking');
    if (mode === 'donechip') {
      const bid = id, mg = moreGid; mode = null; id = null; moreGid = null;
      if (mg) { shelfExpanded.has(mg) ? shelfExpanded.delete(mg) : shelfExpanded.add(mg); render(); }   // +N개 더 / 접기
      else if (bid) openBoardModal(bid);
      return;
    } else if (mode === 'cut') {
      const b = boardById(cutId);
      if (b) { b.parent = null; save(); render(); }   // 연결선 끊기 → 상위 해제
    } else if (mode === 'link') {
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const tnode = t && t.closest ? t.closest('.mapnode') : null;
      if (tnode && tnode.dataset.id !== id) {
        const other = tnode.dataset.id;
        const parentId = role === 'bot' ? id : other;
        const childId = role === 'bot' ? other : id;
        if (!isAncestor(childId, parentId)) { setParent(childId, parentId); save(); }
      }
      render();
    } else if (mode === 'move') {
      map.querySelector(`.mapnode[data-id="${id}"]`)?.classList.remove('dragging');
      const b = boardById(id), cur = b.group || null;
      const cx = b.x + 75, cy = b.y + 22;
      const hit = regionRects().filter(r => r.gid !== cur).find(r => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
      if (hit) { setGroupDeep(id, hit.gid); render(); }   // 다른 프로젝트 구역 안에 놓으면 소속 변경(하위 포함)
      else { save(); drawLines(); }
    } else if (mode === 'region') {
      regionGid = null; regionStart = null;
      save(); render();   // 구역·좌표 확정 저장
    } else if (mode === 'pending') {
      const nid = id, now = Date.now();
      if (lastId === nid && now - lastTime < CLICK_MS) {   // double click → go to board (해당 프로젝트 선택 + 포커스)
        clearTimeout(clickTimer); clickTimer = null; lastId = null;
        const bd = boardById(nid);
        state.sel.boardGroup = bd && bd.group ? bd.group : '';
        focusBoard = nid; state.sel.view = 'board'; render();
      } else {                                              // single click → settings (delayed to allow dblclick)
        lastId = nid; lastTime = now;
        clickTimer = setTimeout(() => { clickTimer = null; openBoardModal(nid); }, CLICK_MS);
      }
    } else if (mode === 'empty' && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) <= THRESH) {
      openAddBoardAt(e.clientX - mr.left, e.clientY - mr.top);
    }
    mode = null; id = null; role = null;
  });
}
function mapAddHint(type, hit) {
  if (type === 'project') return '새 프로젝트(분류)를 만듭니다. 이 위치에 빈 구역으로 표시되고, 그 안을 클릭해 보드를 넣을 수 있어요.';
  if (type === 'folder') return `'별도'처럼 하위 보드를 묶는 분류용 보드입니다. 할 일은 담지 않고, 프로젝트 탭에서 머리글로만 보여요.${hit ? ` (📁 ${esc(hit.name)} 소속)` : ''}`;
  return hit ? `'${esc(hit.name)}' 프로젝트 소속 보드로 추가됩니다.` : '어느 프로젝트에도 속하지 않는 보드로 추가됩니다.';
}
function openAddBoardAt(x, y) {
  const hit = regionRects().find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  pendingMapPos = { x: Math.max(0, x - 75), y: Math.max(0, y - 22), rawX: Math.max(0, x), rawY: Math.max(0, y), group: hit ? hit.gid : null };
  const def = hit ? 'board' : 'project';   // 구역 안=보드, 빈 곳=프로젝트 기본
  showModal(`
    <h3>구조도에 추가${hit ? ` — 📁 ${esc(hit.name)}` : ''}</h3>
    <div class="seg" id="m-addtype" data-val="${def}">
      <button type="button" class="seg-btn ${def === 'project' ? 'sel' : ''}" data-action="mapadd-type" data-t="project">📁 프로젝트</button>
      <button type="button" class="seg-btn" data-action="mapadd-type" data-t="folder">📚 묶음</button>
      <button type="button" class="seg-btn ${def === 'board' ? 'sel' : ''}" data-action="mapadd-type" data-t="board">🗂 보드</button>
    </div>
    <label>이름<input type="text" id="m-title" placeholder="이름 입력 후 Enter"></label>
    <p class="restore-note" id="m-addhint">${mapAddHint(def, hit)}</p>
    <div class="m-actions">
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="mapadd-save">추가</button>
    </div>`);
  setTimeout(() => { const i = document.getElementById('m-title'); if (i) i.focus(); }, 30);
}

/* ---------- calendar ---------- */
function chipHtml(c) {
  const pr = PRIORITIES[c.priority] || PRIORITIES.none;
  const b = boardById(c.project);
  const g = b && b.group ? groupById(b.group) : null;
  const style = pr.bg ? `background:${pr.bg};color:${pr.fg}` : 'background:var(--bg);color:var(--muted)';
  const mark = c.status === 'done' ? '<i class="chip-mk done">✓</i>'
    : c.status === 'doing' ? '<i class="chip-mk doing">▶</i>'
      : '<i class="bdot" style="background:currentColor;opacity:.55"></i>';
  const stName = c.status === 'done' ? '완수' : c.status === 'doing' ? '진행 중' : '계획';
  const projTop = g ? `<span class="chip-proj-top c-${g.color}">${esc(g.name)}</span>` : '';
  const title = (g ? '📁' + g.name + ' · ' : '') + (b ? b.name + ' · ' : '') + `[${stName}] ` + c.title + (c.note ? '\n💬 ' + c.note : '');
  return `<span class="chip ${c.status}" style="${style}" draggable="true" data-action="card" data-id="${c.id}" title="${esc(title)}">${projTop}<span class="chip-task">${mark}${esc(c.title)}</span></span>`;
}
function schedChipHtml(s) {
  const g = s.group ? groupById(s.group) : null;
  const over = !s.done && dday(s.date) < 0;
  const title = (g ? '📁' + g.name + ' · ' : '') + '[일정] ' + s.title + (s.note ? '\n💬 ' + s.note : '');
  return `<span class="chip chip-sched c-${g ? g.color : 'gray'} ${s.done ? 'done' : ''} ${over ? 'over' : ''}" data-action="sched-edit" data-id="${s.id}" title="${esc(title)}">${g ? `<span class="chip-proj-top">📁 ${esc(g.name)}</span>` : ''}<span class="chip-task">📌 ${s.time ? s.time + ' ' : ''}${esc(s.title)}</span></span>`;
}
function calFilterActive() { return Array.isArray(state.sel.calFilter) && state.sel.calFilter.length > 0; }
function calShowType(kind) { const t = state.sel.calType || 'all'; return t === 'all' || t === kind; }   // kind: 'todo' | 'sched'
function calCardVisible(c) {
  if (!calShowType('todo')) return false;
  if (!calFilterActive()) return true;
  const b = boardById(c.project);
  return state.sel.calFilter.includes(b ? (b.group || '') : '');
}
function calPeriodVisible(gid) {
  if (!calFilterActive()) return true;
  return state.sel.calFilter.includes(gid || '');
}
function calFilterBar() {
  const groups = state.groups || [];
  const t = state.sel.calType || 'all';
  const tpill = (v, label, title) => `<button class="fpill ${t === v ? 'on' : ''}" data-action="cal-type" data-t="${v}" title="${title}">${label}</button>`;
  const typeRow = `<div class="cal-filter"><span class="fl-label">표시</span>
    ${tpill('all', '전체', '일정 · 할 일 모두 표시')}${tpill('sched', '📌 일정', '프로젝트 일정·마감만')}${tpill('todo', '✅ 할 일', 'To-do 카드만')}<span class="fl-note">프로젝트 수행기간 막대는 항상 표시</span>
  </div>`;
  if (!groups.length) return typeRow;
  const sel = state.sel.calFilter, active = calFilterActive();
  const pill = (gid, name, color) => `<button class="fpill ${active && sel.includes(gid) ? 'on c-' + color : ''}" data-action="cal-filter" data-gid="${gid}">${esc(name)}</button>`;
  return typeRow + `<div class="cal-filter"><span class="fl-label">프로젝트</span>
    <button class="fpill ${!active ? 'on' : ''}" data-action="cal-filter" data-gid="__all">전체</button>
    ${groups.map(g => pill(g.id, '📁 ' + g.name, g.color)).join('')}
    ${pill('', '미분류', 'gray')}
    <button class="fpill fclear ${active && sel.includes('__none__') ? 'on' : ''}" data-action="cal-filter" data-gid="__none" title="아무 프로젝트도 표시 안 함">전체 해제</button>
  </div>`;
}
function renderCal() {
  const ym = state.sel.calYm || todayStr().slice(0, 7);
  state.sel.calYm = ym;
  const [y, m] = ym.split('-').map(Number);
  const startDow = new Date(y, m - 1, 1).getDay();
  const today = todayStr();
  // 칸 안 칩 정렬: 프로젝트 순(사이드바와 같은 순서, 미분류는 뒤) → 보드 → 제목
  const cardProjOrder = c => {
    const b = c.project ? boardById(c.project) : null;
    return schedProjOrder({ group: b ? (b.group || '') : '' });
  };
  const cardBoardName = c => { const b = c.project ? boardById(c.project) : null; return b ? b.name : ''; };
  const byProject = (a, b) => {
    const pa = cardProjOrder(a), pb = cardProjOrder(b);
    if (pa !== pb) return pa - pb;
    const ba = cardBoardName(a), bb = cardBoardName(b);
    if (ba !== bb) return ba.localeCompare(bb);
    return (a.title || '').localeCompare(b.title || '');
  };
  const cardsByDate = {};
  state.cards.forEach(c => {
    if (!calCardVisible(c)) return;
    const d = c.due || (c.status === 'done' ? c.doneAt : null);
    if (d) (cardsByDate[d] = cardsByDate[d] || []).push(c);
  });
  Object.values(cardsByDate).forEach(list => list.sort(byProject));
  const schedByDate = {};
  (state.schedules || []).forEach(s => {
    if (!s.date || !calShowType('sched') || !calPeriodVisible(s.group || '')) return;
    (schedByDate[s.date] = schedByDate[s.date] || []).push(s);
  });
  Object.values(schedByDate).forEach(list => list.sort((a, b) => {
    const pa = schedProjOrder(a), pb = schedProjOrder(b);
    if (pa !== pb) return pa - pb;
    return (a.time || '').localeCompare(b.time || '') || (a.title || '').localeCompare(b.title || '');
  }));
  const periodItems = [];
  state.projects.filter(b => b.start && b.end && b.start <= b.end).forEach(b => {   // 프로젝트 수행기간 막대는 타입 필터와 무관하게 항상 표시
    if (calPeriodVisible(b.group || '')) periodItems.push({ name: b.name, color: b.color, start: b.start, end: b.end, kind: 'board', id: b.id });
  });
  (state.groups || []).forEach(g => (g.periods || []).forEach(p => {
    if (p.start && p.end && p.start <= p.end && calPeriodVisible(g.id)) periodItems.push({ name: '📁 ' + g.name, color: g.color, start: p.start, end: p.end, kind: 'group', id: g.id });
  }));
  let weeksHtml = '';
  for (let w = 0; w < 6; w++) {
    const wStart = new Date(y, m - 1, 1 - startDow + w * 7);
    const wEnd = new Date(y, m - 1, 1 - startDow + w * 7 + 6);
    const ws = dstr(wStart), we = dstr(wEnd);
    // period bars with greedy lane stacking
    const lanes = [];
    const bars = [];
    periodItems.filter(it => it.start <= we && it.end >= ws).forEach(it => {
      const sIdx = it.start <= ws ? 0 : (new Date(it.start + 'T00:00:00') - wStart) / 864e5;
      const eIdx = it.end >= we ? 6 : (new Date(it.end + 'T00:00:00') - wStart) / 864e5;
      let lane = lanes.findIndex(endIdx => endIdx < sIdx);
      if (lane === -1) { lanes.push(eIdx); lane = lanes.length - 1; } else lanes[lane] = eIdx;
      if (lane > 2) return;
      bars.push(`<span class="cal-bar c-${it.color}" style="left:${sIdx / 7 * 100}%;width:${(eIdx - sIdx + 1) / 7 * 100}%;top:${lane * 19}px" data-action="${it.kind === 'group' ? 'group-edit' : 'board-edit'}" data-id="${it.id}" title="${esc(it.name)} ${fmtDate(it.start)}~${fmtDate(it.end)}">${esc(it.name)}</span>`);
    });
    const laneCnt = Math.min(lanes.length, 3);
    let cells = '';
    for (let d = 0; d < 7; d++) {
      const dt = new Date(y, m - 1, 1 - startDow + w * 7 + d);
      const ds = dstr(dt);
      const inMonth = dt.getMonth() === m - 1;
      const dayCards = cardsByDate[ds] || [];
      const chips = dayCards.map(chipHtml).join('');
      const schedChips = (schedByDate[ds] || []).map(schedChipHtml).join('');
      cells += `<div class="cal-day ${inMonth ? '' : 'out'} ${ds === today ? 'today' : ''}" data-action="cal-add" data-date="${ds}" title="클릭하면 이 날짜로 할 일 추가">
        <div class="cal-scroll slim-scroll"><span class="dnum ${d === 0 ? 'sun' : ''}">${dt.getDate()}</span>${schedChips}${chips}</div></div>`;
    }
    weeksHtml += `<div class="cal-week">
      ${laneCnt ? `<div class="cal-bars" style="height:${laneCnt * 19 + 2}px">${bars.join('')}</div>` : ''}
      <div class="cal-days">${cells}</div>
    </div>`;
  }
  return `<div class="cal-sticky">
    <div class="cal-head">
      <span class="cal-title">${y}년 ${m}월</span>
      <button class="pill" data-action="cal-prev">◀</button>
      <button class="pill" data-action="cal-today">오늘</button>
      <button class="pill" data-action="cal-next">▶</button>
      <span class="cal-hint">날짜 클릭 = 할 일 추가 · 칩 드래그 = 날짜 변경 · 막대 = 수행기간 · <b>맨 아래/위에서 휠 = 다음·이전 달</b></span>
      <span class="cal-status-legend"><span class="sl"><i class="bdot"></i>계획</span><span class="sl"><i class="chip-mk doing">▶</i>진행 중</span><span class="sl done"><i class="chip-mk done">✓</i>완수</span></span>
    </div>
    ${calFilterBar()}
    </div>
    <div class="cal">
      <div class="cal-dow">${['일', '월', '화', '수', '목', '금', '토'].map((n, i) => `<span class="${i === 0 ? 'sun' : ''}">${n}</span>`).join('')}</div>
      ${weeksHtml}
    </div>`;
}
function markCalOverflow() {
  document.querySelectorAll('.cal-scroll').forEach(sc => {
    sc.parentElement.classList.toggle('has-more', sc.scrollHeight > sc.clientHeight + 2);
  });
}
// 달력: 페이지 스크롤이 끝(맨 아래/맨 위)에 닿은 상태에서 한 번 더 굴리면 달 이동
let calWheelAt = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('wheel', e => {
    if ((state.sel.view || '') !== 'cal') return;
    if (e.target.closest && e.target.closest('.modal, .alert-toast')) return;
    const dy = e.deltaY;
    if (!dy) return;
    // 칸 안 칩 목록은 '실제로 더 스크롤할 수 있을 때만' 양보 (칸 전체가 .cal-scroll이라 무조건 막으면 달 이동이 안 됨)
    const sc = e.target.closest && e.target.closest('.cal-scroll');
    if (sc && sc.scrollHeight > sc.clientHeight + 2) {
      const scAtEnd = dy > 0 ? (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) : (sc.scrollTop <= 2);
      if (!scAtEnd) return;
    }
    const doc = document.documentElement;
    const atBottom = window.scrollY + window.innerHeight >= doc.scrollHeight - 4;
    const atTop = window.scrollY <= 4;
    if (!((dy > 0 && atBottom) || (dy < 0 && atTop))) return;   // 아직 스크롤할 곳이 남았으면 평소대로
    const now = Date.now();
    if (now - calWheelAt < 320) return;                          // 관성 스크롤로 여러 달 넘어가지 않게
    calWheelAt = now;
    calShift(dy > 0 ? 1 : -1);
    if (dy > 0) window.scrollTo(0, 0);                           // 다음 달은 위에서부터 보도록
  }, { passive: true });
}
function calShift(n) {
  const [y, m] = (state.sel.calYm || todayStr().slice(0, 7)).split('-').map(Number);
  const dt = new Date(y, m - 1 + n, 1);
  state.sel.calYm = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  render();
}

/* ---------- dashboard (현황) ---------- */
function isUrgent(c) {
  if (c.status === 'done') return false;
  if (c.priority === 'high') return true;
  return !!(c.due && dday(c.due) <= 3);
}
function dueSort(a, b) {
  const da = a.due ? dday(a.due) : 99999, db = b.due ? dday(b.due) : 99999;
  if (da !== db) return da - db;
  return (PRIO_RANK[b.priority] || 0) - (PRIO_RANK[a.priority] || 0);
}
function cardProjKey(c) {
  const b = boardById(c.project);
  return b ? (b.group || '') : '__inbox';
}
function projOrder(key) {
  if (key === '__inbox') return 100000;
  if (key === '') return 99999;                       // 미분류 보드는 프로젝트들 뒤
  const i = (state.groups || []).findIndex(g => g.id === key);
  return i < 0 ? 99998 : i;
}
function byProject(secondary) {
  return (a, b) => {
    const pa = projOrder(cardProjKey(a)), pb = projOrder(cardProjKey(b));
    if (pa !== pb) return pa - pb;
    return secondary(a, b);
  };
}
function doneSort(a, b) { return (b.doneAt || '').localeCompare(a.doneAt || ''); }
function dashRow(c, hidePill) {
  const b = boardById(c.project);
  const g = b && b.group ? groupById(b.group) : null;
  const pr = PRIORITIES[c.priority] || PRIORITIES.none;
  const board = b ? `<span class="drow-board">${esc(b.name)}</span>` : '';   // 프로젝트는 그룹 헤더에 있으므로 행에는 보드명만
  const note = c.note ? `<span class="card-note" data-note="${esc(c.note)}">💬</span>` : '';
  const tag = c.status === 'done'
    ? (c.doneAt ? `<span class="tag">${fmtDate(c.doneAt)} 완수</span>` : '')
    : (c.due ? dueBadge(c.due) : '');
  const stPill = hidePill ? '' : (c.status === 'doing' ? '<span class="st-pill doing">진행중</span>'
    : c.status === 'done' ? '<span class="st-pill done">완수</span>'
      : '<span class="st-pill todo">예정</span>');
  const overdue = c.status !== 'done' && c.due && dday(c.due) < 0 ? ' overdue' : '';
  const metaInner = `${board}${tag}`;
  const meta = metaInner ? `<div class="drow-meta">${metaInner}</div>` : '';
  return `<div class="drow${overdue}" data-kind="card" data-id="${c.id}" title="클릭=수정 · 더블클릭=보드로 이동">
    <span class="drow-prio" style="${pr.bg ? `background:${pr.bg}` : ''}"></span>
    <div class="drow-body">
      <div class="drow-l1">${stPill}${fuBadgeHtml(c)}<span class="drow-title">${esc(c.title)}</span>${note}</div>
      ${meta}
    </div>
  </div>`;
}
function dashGroupHeader(key) {
  const g = (key && key !== '__inbox') ? groupById(key) : null;
  const label = g ? `<span class="drow-proj c-${g.color}">${esc(g.name)}</span>` : (key === '' ? '📄 미분류 보드' : '📥 미배정');
  return `<div class="dash-grp">${label}</div>`;
}
function dashRowsGrouped(cards, hidePill) {   // 프로젝트별 그룹 헤더 + 행 (Brain Dump 방식)
  let html = '', last = '__init';
  cards.forEach(c => {
    const k = cardProjKey(c);
    if (k !== last) { last = k; html += dashGroupHeader(k); }
    html += dashRow(c, hidePill);
  });
  return html;
}
function dashSection(title, sub, cards, emptyMsg, limit, opts) {   // limit은 폐기 — 전량 렌더+내부 스크롤
  const o = opts || {};
  const body = o.rowsHtml !== undefined ? o.rowsHtml : (cards.length ? dashRowsGrouped(cards, o.hidePill) : `<div class="empty">${emptyMsg}</div>`);
  return `<section class="dash-sec ${o.full ? 'full' : ''} ${o.stage ? 'stage-' + o.stage : ''}" ${o.id ? `id="${o.id}"` : ''}>
    <div class="dash-sec-head"><h2>${title} <span class="cnt">${cards.length}</span></h2><span class="dash-sub">${sub}</span></div>
    <div class="dash-list slim-scroll">${body}</div>
  </section>`;
}
function doneWeekSection(cards, offset, start, end) {
  const body = cards.length ? dashRowsGrouped(cards, true) : '<div class="empty">이 주에 완료한 업무가 없어요</div>';
  return `<section class="dash-sec stage-done" id="sec-done">
    <div class="dash-sec-head">
      <h2>✓ 최근 완수 <span class="cnt">${cards.length}</span></h2>
      <span class="dash-sub">${doneWeekLabel(offset, start, end)}</span>
      <div class="dash-week-nav">
        <button class="mini-btn" data-action="done-week-prev" title="지난 주">◀</button>
        ${offset !== 0 ? `<button class="mini-btn" data-action="done-week-today" title="이번 주로">이번 주</button>` : ''}
        <button class="mini-btn" data-action="done-week-next" title="다음 주">▶</button>
      </div>
    </div>
    <div class="dash-list slim-scroll">${body}</div>
  </section>`;
}
// 탭 안에서 두 화면을 오가는 세그먼트 (헤더 탭 수를 줄이려고 도입 — data-action='view'를 그대로 재사용)
function pageSeg(cur, items) {
  return `<div class="seg page-seg">${items.map(([v, label]) =>
    `<button type="button" class="seg-btn ${cur === v ? 'sel' : ''}" data-action="view" data-view="${v}">${label}</button>`).join('')}</div>`;
}
function journalSeg(cur) { return isAdmin() ? pageSeg(cur, [['journal', '📔 일지'], ['devlog', '🛠 개발일지']]) : ''; }
function renderDash() {
  const today = todayStr();
  const cards = state.cards;
  const incomplete = cards.filter(c => c.status !== 'done');
  const todo = cards.filter(c => c.status === 'todo').sort(byProject(dueSort));
  const doing = cards.filter(c => c.status === 'doing').sort(byProject(dueSort));
  const urgent = incomplete.filter(isUrgent).sort(byProject(dueSort));
  const doneWeekOffset = state.sel.doneWeekOffset || 0;
  const dw = doneWeekRange(doneWeekOffset);
  const recentDone = cards.filter(c => c.status === 'done' && c.doneAt && c.doneAt >= dw.startStr && c.doneAt <= dw.endStr).sort(byProject(doneSort));
  const kpi = (label, val, cls, target) => `<div class="kpi ${cls || ''}" data-action="kpi-go" data-target="${target}"><div class="kpi-val">${val}</div><div class="kpi-lbl">${label}</div></div>`;
  // 프로젝트별 진행률 + 다음 마감 D-day
  const nextSchedOf = gid => (state.schedules || []).filter(s => (s.group || '') === gid && !s.done && !schedIsStale(s))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0] || null;
  const gpRows = [];
  const gpRow = (name, color, done, total, ns) => {
    const pct = total ? Math.round(done / total * 100) : 0;
    let dd = '';
    if (ns) {
      const n = dday(ns.date);
      const cls = n < 0 ? 'over' : n <= 3 ? 'warn' : '';
      const lbl = n < 0 ? `${-n}일 지남` : n === 0 ? 'D-day' : `D-${n}`;
      dd = `<span class="gp-dday ${cls}" data-action="sched-edit" data-id="${ns.id}" title="다음 마감: ${esc(ns.title)} (${ns.date})">📌 ${lbl}</span>`;
    }
    return `<div class="gp-row"><span class="drow-proj c-${color}">${esc(name)}</span>
      <div class="gp-track"><div class="gp-fill c-${color}" style="width:${pct}%"></div></div>
      <span class="gp-num">${done}/${total} · ${pct}%</span>${dd}</div>`;
  };
  (state.groups || []).forEach(g => {
    const bids = new Set(state.projects.filter(b => (b.group || null) === g.id).map(b => b.id));
    const cs = cards.filter(c => bids.has(c.project));
    if (cs.length) gpRows.push(gpRow(g.name, g.color, cs.filter(c => c.status === 'done').length, cs.length, nextSchedOf(g.id)));
  });
  {
    const bids = new Set(state.projects.filter(b => !b.group).map(b => b.id));
    const cs = cards.filter(c => bids.has(c.project));
    if ((state.groups || []).length && cs.length) gpRows.push(gpRow('미분류', 'gray', cs.filter(c => c.status === 'done').length, cs.length, nextSchedOf('')));
  }
  // 이번 주 스트립 (월~일): 요일별 마감 카드·📌일정
  const mon = mondayOf(new Date());
  const weekCells = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(mon); dt.setDate(mon.getDate() + i);
    const ds = dstr(dt);
    const dueCnt = cards.filter(c => c.status !== 'done' && c.due === ds).length;
    const schedCnt = (state.schedules || []).filter(s => !s.done && s.date === ds).length;
    const cls = [ds === today ? 'today' : '', ds < today ? 'past' : '', i === 6 ? 'sun' : ''].filter(Boolean).join(' ');
    weekCells.push(`<div class="dw-cell ${cls}" data-action="dash-week-go" title="${ds} · 마감 ${dueCnt} · 일정 ${schedCnt}">
      <span class="dw-day">${['월', '화', '수', '목', '금', '토', '일'][i]} <b>${dt.getDate()}</b></span>
      <span class="dw-marks">${dueCnt ? `<span class="dw-badge">${dueCnt}</span>` : ''}${schedCnt ? `<span class="dw-sched">📌${schedCnt}</span>` : ''}</span>
    </div>`);
  }
  const weekStrip = `<div class="dash-week">${weekCells.join('')}</div>`;
  const td = (state.timebox || {})[today];
  const hasBig3 = td && td.big3 && td.big3.some(Boolean);
  const big3Strip = `<div class="dash-big3" data-action="dash-big3-go" title="타임박스로 이동">
    <span class="db3-label">🎯 오늘의 Big 3</span>
    ${hasBig3
      ? [0, 1, 2].map(i => { const b = td.big3[i], c = tbColor(i), bd = tbDone(b);
          return b ? `<span class="db3 ${bd ? 'done' : ''}" style="background:${c.bg};color:${c.fg}">${bd ? '✓ ' : ''}${esc(tbTitle(b))}</span>`
                   : `<span class="db3 empty">Big ${i + 1}</span>`; }).join('')
      : '<span class="db3 empty">타임박스에서 오늘의 Big 3를 정해보세요 →</span>'}
  </div>`;
  return `<div class="dash">
    ${big3Strip}
    ${weekStrip}
    <div class="dash-kpis">
      ${kpi('📅 예정', todo.length, 'k-todo', 'sec-todo')}
      ${kpi('▶ 진행 중', doing.length, 'k-doing', 'sec-doing')}
      ${kpi('✓ 이번 주 완수', weekDone(), 'k-done', 'sec-done')}
      ${kpi('🔥 급한 일', urgent.length, 'k-urgent', 'sec-urgent')}
    </div>
    ${gpRows.length
      ? `<div class="dash-top">
          <section class="dash-sec"><div class="dash-sec-head"><h2>📊 프로젝트 진행률 <span class="cnt">${gpRows.length}</span></h2><span class="dash-sub">완수/전체 · 📌 다음 마감</span></div><div class="dash-list slim-scroll gp-list">${gpRows.join('')}</div></section>
          ${dashSection('🔥 급한 업무', '마감 임박·지남 또는 중요도 높음', urgent, '급한 업무가 없어요 👍', null, { id: 'sec-urgent' })}
        </div>`
      : dashSection('🔥 급한 업무', '마감 임박·지남 또는 중요도 높음', urgent, '급한 업무가 없어요 👍', null, { full: true, id: 'sec-urgent' })}
    <div class="dash-flow">
      ${dashSection('📅 예정', '마감 임박순', todo, '예정 업무가 없어요', null, { id: 'sec-todo', stage: 'todo', hidePill: true })}
      ${dashSection('▶ 진행 중', '지금 하고 있는 일', doing, '진행 중인 업무가 없어요', null, { id: 'sec-doing', stage: 'doing', hidePill: true })}
      ${doneWeekSection(recentDone, doneWeekOffset, dw.start, dw.end)}
    </div>
  </div>`;
}

/* ---------- notes (프로젝트 기록) ---------- */
function noteTypeBadge(t) {
  const nt = NOTE_TYPES[t] || NOTE_TYPES.memo;
  return `<span class="note-type c-${nt.color}">${nt.icon} ${nt.label}</span>`;
}
// 기록 사이드바 선택값: '__all'(전체) | 프로젝트 id | ''(미분류)
function noteViewGroup() {
  const groups = state.groups || [];
  let gid = state.sel.noteGroup;
  if (gid === undefined) gid = '__all';
  if (gid !== '__all' && gid !== '' && !groupById(gid)) gid = groups.length ? '__all' : '';
  state.sel.noteGroup = gid;
  return gid;
}
// 새 기록이 소속될 프로젝트 — '전체' 보기에서는 첫 프로젝트를 기본값으로(에디터에서 변경 가능)
function currentNoteGroup() {
  const gid = noteViewGroup();
  if (gid !== '__all') return gid;
  const groups = state.groups || [];
  return groups.length ? groups[0].id : '';
}
function noteItemHtml(n) {
  const searchText = esc((n.title + ' ' + noteBodyPlain(n.body) + ' ' + (n.who || '')).toLowerCase());
  const nt = NOTE_TYPES[n.type] || NOTE_TYPES.memo;
  const nb = n.board ? boardById(n.board) : null;
  return `<div class="note-item" data-action="note-edit" data-id="${n.id}" data-text="${searchText}">
    <span class="tl-dot c-${nt.color}"></span>
    <div class="note-head">
      ${noteTypeBadge(n.type)}
      ${nb ? `<span class="note-board">🗂 ${esc(nb.name)}</span>` : ''}
      <span class="note-date">${n.date ? fmtDate(n.date) : ''}</span>
      <span class="note-title">${esc(n.title)}</span>
      ${n.who ? `<span class="note-who">🎤 ${esc(n.who)}</span>` : ''}
      <button class="note-pin-btn ${n.pinned ? 'on' : ''}" data-action="note-pin" data-id="${n.id}" title="${n.pinned ? '고정 해제' : '상단에 고정'}">📌</button>
      <button class="mini-btn note-todo-btn" data-action="note-todo" data-id="${n.id}" title="이 기록에서 할 일 만들기">→ To-do</button>
    </div>
    ${n.body ? `<div class="note-body clamp rich">${noteBodyForFeed(n.body)}</div><button class="note-more" data-action="note-expand" style="display:none">더보기 ▾</button>` : ''}
  </div>`;
}
function noteDateGroup(dateStr, today) {
  if (!dateStr) return '이전';
  if (dateStr === today) return '오늘';
  if (dateStr === nextDay(dateStr) && false) return '';   // noop
  const [y, m, d] = today.split('-').map(Number);
  const yesterday = dstr(new Date(y, m - 1, d - 1));
  const weekAgo = dstr(new Date(y, m - 1, d - 6));
  if (dateStr === yesterday) return '어제';
  if (dateStr >= weekAgo && dateStr < today) return '이번 주';
  return '이전';
}
function renderNotes() {
  const groups = state.groups || [];
  const gid = noteViewGroup();
  const isAll = gid === '__all';
  const g = (!isAll && gid) ? groupById(gid) : null;
  const gname = isAll ? '전체' : (g ? g.name : '미분류');
  const allNotes = state.notes || [];
  const gNotes = isAll ? allNotes.slice() : allNotes.filter(n => (n.group || '') === gid);
  const gBoards = isAll ? [] : state.projects.filter(b => (b.group || '') === gid);
  let bsel = isAll ? '' : (state.sel.noteBoard || '');
  if (bsel && bsel !== '__common' && !gBoards.some(b => b.id === bsel)) { bsel = ''; state.sel.noteBoard = ''; }
  const selBoard = (bsel && bsel !== '__common') ? boardById(bsel) : null;
  const notesOf = xgid => (state.notes || []).filter(n => (n.group || '') === xgid).length;
  const cntBoard = bid => gNotes.filter(n => (bid === '__common' ? !n.board : n.board === bid)).length;
  // 사이드바: 프로젝트 목록 + 선택된 프로젝트 아래 보드 트리(아코디언)
  // 펼침은 openSideGroups로만 판단 → 프로젝트별 독립 토글·누적(보드 탭과 동일, Set 공유)
  // 프로젝트 탭 사이드바와 동일 구조: 보드 상하관계 들여쓰기 + 📚 묶음 보드 구분
  const subTree = xgid => {
    if (!openSideGroups.has(xgid)) return '';
    const xNotes = allNotes.filter(n => (n.group || '') === xgid);
    const cntB = bid => xNotes.filter(n => (bid === '__common' ? !n.board : n.board === bid)).length;
    const sub = (label, bid, cnt, color, depth, folder) => `<div class="side-sub-item ${(gid === xgid && bsel === bid) ? 'on' : ''} ${folder ? 'is-folder' : ''}" data-action="note-board-nav" data-gid="${xgid}" data-bid="${bid}" style="padding-left:${8 + (depth || 0) * 13}px">
        <span class="side-dot ${color ? 'c-' + color : 'plain'}"></span><span class="side-name">${folder ? '📚 ' : ''}${label}</span><span class="side-cnt">${cnt || ''}</span></div>`;
    return `<div class="side-sub">
      ${sub('전체', '', xNotes.length, null, 0)}
      ${sub('공통', '__common', cntB('__common'), null, 0)}
      ${orderedBoardsIn(xgid || null).map(({ board, depth }) => sub(esc(board.name), board.id, cntB(board.id), board.color, depth, board.folder)).join('')}
    </div>`;
  };
  const noteRow = (xgid, name, color) => {
    const expanded = openSideGroups.has(xgid);
    const caret = `<button class="side-caret" data-action="side-toggle" data-gid="${xgid}" title="보드 ${expanded ? '접기' : '펼치기'}">${expanded ? '▾' : '▸'}</button>`;
    return `<div class="side-item ${gid === xgid ? 'on c-' + color : ''}" data-action="note-group" data-gid="${xgid}">${caret}<span class="side-dot c-${color}"></span><span class="side-name">${esc(name)}</span><span class="side-cnt">${notesOf(xgid) || ''}</span></div>${subTree(xgid)}`;
  };
  const sideItems = `<div class="side-item ${isAll ? 'on c-gray' : ''}" data-action="note-group" data-gid="__all"><span class="side-caret sp"></span><span class="side-dot c-gray"></span><span class="side-name">전체</span><span class="side-cnt">${allNotes.length || ''}</span></div>`
    + groups.map(x => noteRow(x.id, x.name, x.color)).join('')
    + noteRow('', '미분류', 'gray');
  // 헤더: 보드 선택 시 보드 맥락, 아니면 프로젝트 맥락
  let pageHead, propBar;
  if (isAll) {
    const last = gNotes.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    const withNotes = new Set(gNotes.map(n => n.group || ''));
    pageHead = `<div class="page-head"><span class="page-icon c-gray">📚</span><h2 class="page-title">전체 기록</h2></div>`;
    propBar = `<div class="prop-bar">
      <span class="prop-chip">📁 프로젝트 ${withNotes.size}</span>
      <span class="prop-chip">📝 기록 ${gNotes.length}</span>
      <span class="prop-chip">🕐 최근 기록 ${last && last.date ? fmtDate(last.date) : '없음'}</span>
    </div>`;
  } else if (selBoard) {
    const bCards = state.cards.filter(c => c.project === selBoard.id);
    const bDone = bCards.filter(c => c.status === 'done').length;
    const bPeriod = (selBoard.start && selBoard.end) ? `${fmtDate(selBoard.start)} ~ ${fmtDate(selBoard.end)}` : null;
    pageHead = `<div class="page-head"><span class="page-icon c-${g ? g.color : 'gray'}">📁</span><h2 class="page-title"><span class="pt-parent">${esc(gname)}</span> <span class="pt-sep">›</span> 🗂 ${esc(selBoard.name)}</h2></div>`;
    propBar = `<div class="prop-bar">
      ${bPeriod ? `<span class="prop-chip">📅 ${bPeriod}</span>` : ''}
      <span class="prop-chip">✅ 진행 ${bDone}/${bCards.length}</span>
      <span class="prop-chip">📝 기록 ${cntBoard(selBoard.id)}</span>
    </div>`;
  } else {
    const bIds = new Set(gBoards.map(b => b.id));
    const gCards = state.cards.filter(c => c.project && bIds.has(c.project));
    const doneCnt = gCards.filter(c => c.status === 'done').length;
    const periods = (g && g.periods && g.periods.length) ? g.periods : null;
    const periodTxt = periods ? `${fmtDate(periods[0].start)} ~ ${fmtDate(periods[periods.length - 1].end)}${periods.length > 1 ? ` 외 ${periods.length - 1}` : ''}` : '기간 미설정';
    const lastNote = gNotes.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    const ns = (state.schedules || []).filter(s => (s.group || '') === gid && !s.done).sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0];
    let nsChip = '';
    if (ns) {
      const n = dday(ns.date);
      nsChip = `<span class="prop-chip sched-chip ${n < 0 ? 'over' : ''}" data-action="sched-edit" data-id="${ns.id}" title="${esc(ns.title)}">📌 ${esc(ns.title)} · ${n < 0 ? -n + '일 지남' : n === 0 ? 'D-day' : 'D-' + n}</span>`;
    }
    pageHead = `<div class="page-head"><span class="page-icon c-${g ? g.color : 'gray'}">📁</span><h2 class="page-title">${esc(gname)}</h2></div>`;
    propBar = `<div class="prop-bar">
      <span class="prop-chip" ${g ? `data-action="group-edit" data-id="${g.id}" title="클릭해서 기간 수정"` : ''}>📅 ${periodTxt}</span>
      <span class="prop-chip">🗂 보드 ${gBoards.filter(b => !b.folder).length}</span>
      <span class="prop-chip">✅ 진행 ${doneCnt}/${gCards.length}</span>
      <span class="prop-chip">🕐 최근 기록 ${lastNote && lastNote.date ? fmtDate(lastNote.date) : '없음'}</span>
      ${nsChip}
    </div>`;
  }
  const overview = g ? (g.overview || '') : (state.unGroupOverview || '');
  const tsel = state.sel.noteType || '';
  const typePills = `<button class="fpill ${!tsel ? 'on' : ''}" data-action="note-type" data-t="">전체</button>`
    + Object.entries(NOTE_TYPES).map(([k, v]) => `<button class="fpill ${tsel === k ? 'on c-' + v.color : ''}" data-action="note-type" data-t="${k}">${v.icon} ${v.label}</button>`).join('');
  const notes = gNotes
    .filter(n => !tsel || n.type === tsel)
    .filter(n => !bsel || (bsel === '__common' ? !n.board : n.board === bsel))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const today = todayStr();
  let feed = '';
  if (isAll) {
    // 전체 보기: 프로젝트별로 묶고, 그 안에서 📌고정 → 최신순
    const order = groups.map(x => x.id).concat(['']);
    order.forEach(k => {
      const ns = notes.filter(n => (n.group || '') === k);
      if (!ns.length) return;
      const gx = k ? groupById(k) : null;
      feed += `<div class="note-group-h proj"><span class="ngh-dot c-${gx ? gx.color : 'gray'}"></span>${esc(gx ? gx.name : '미분류')}<span class="ngh-cnt">${ns.length}</span></div>`;
      feed += ns.filter(n => n.pinned).map(noteItemHtml).join('') + ns.filter(n => !n.pinned).map(noteItemHtml).join('');
    });
  } else {
    // 프로젝트 보기: 📌 고정 → 날짜 그룹 (D·F)
    const pinned = notes.filter(n => n.pinned);
    const rest = notes.filter(n => !n.pinned);
    if (pinned.length) feed += `<div class="note-group-h">📌 고정됨</div>` + pinned.map(noteItemHtml).join('');
    let lastGrp = null;
    rest.forEach(n => {
      const grp = noteDateGroup(n.date, today);
      if (grp !== lastGrp) { lastGrp = grp; feed += `<div class="note-group-h">${grp}</div>`; }
      feed += noteItemHtml(n);
    });
  }
  if (!feed) feed = '<div class="empty">아직 기록이 없어요 — [+ 기록 추가]로 인터뷰·회의·진행상황을 남겨보세요</div>';
  const overviewHtml = !isAll && !selBoard && bsel !== '__common' ? `<div class="note-overview callout" data-action="overview-edit" title="클릭해서 수정">
        <span class="co-icon">💡</span>
        <div class="co-body">${overview ? `<div class="no-body">${esc(overview)}</div>` : '<div class="no-empty">프로젝트 핵심 현황·컨택포인트·주의사항을 적어두세요 (클릭)</div>'}</div>
      </div>` : '';
  return `<div class="notes-wrap">
    <aside class="notes-side">
      <div class="side-h">프로젝트</div>
      ${sideItems}
    </aside>
    <div class="notes-page">
      ${pageHead}
      ${propBar}
      ${overviewHtml}
      <div class="note-toolbar">
        ${typePills}
        <input type="search" id="note-q" placeholder="🔍 기록 검색" autocomplete="off">
        <button class="pill primary-pill" data-action="note-add">+ 기록 추가</button>
      </div>
      <div class="note-list timeline ${selBoard ? 'board-scoped' : ''}">${feed}</div>
    </div>
  </div>`;
}
function markNoteOverflow() {
  document.querySelectorAll('.note-item .note-body.clamp').forEach(b => {
    const more = b.nextElementSibling;
    if (more && more.classList.contains('note-more') && b.scrollHeight > b.clientHeight + 2) more.style.display = '';
  });
}
function noteTypeOptions(cur) {
  return Object.entries(NOTE_TYPES).map(([k, v]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('');
}
/* 기록 전체화면 에디터 (노션 페이지식) */
let noteEditing = undefined;   // undefined=미편집, null=신규, 문자열=수정할 id (state에 안 넣음 — 동기화·영속 방지)
let noteDraft = null;          // 원격 재렌더 시 작성 중 내용 보존
function captureNoteDraft() {
  const body = document.getElementById('m-nbody');
  if (noteEditing === undefined || !body || !document.querySelector('.note-editor')) return;
  noteDraft = {
    title: (document.getElementById('m-ntitle') || {}).value || '',
    group: (document.getElementById('m-ngroup') || {}).value || '',
    type: (document.getElementById('m-ntype') || {}).value || 'memo',
    date: (document.getElementById('m-ndate') || {}).value || '',
    board: (document.getElementById('m-nboard') || {}).value || '',
    who: (document.getElementById('m-nwho') || {}).value || '',
    body: sanitizeHtml(body.innerHTML), isNew: body.dataset.new === '1',
  };
}
// 기록 에디터 실시간 저장: 입력할 때마다 state.notes에 반영(+디바운스 클라우드 저장). render() 호출 안 함 → 커서 유지
function liveSaveNote() {
  const body = document.getElementById('m-nbody');
  if (noteEditing === undefined || !body) return;
  const type = (document.getElementById('m-ntype') || {}).value || 'memo';
  const gSel = document.getElementById('m-ngroup');
  const data = {
    type,
    ...(gSel ? { group: gSel.value } : {}),   // 프로젝트 변경(=기록 이동)도 반영
    title: (document.getElementById('m-ntitle') || {}).value.trim(),
    date: (document.getElementById('m-ndate') || {}).value || todayStr(),
    who: type === 'interview' ? ((document.getElementById('m-nwho') || {}).value.trim() || null) : null,
    board: (document.getElementById('m-nboard') || {}).value || null,
    body: readNoteBody(),
  };
  if (noteEditing) {                                   // 기존 기록 수정
    const n = (state.notes || []).find(x => x.id === noteEditing);
    if (n) Object.assign(n, data);
  } else {                                             // 신규: 제목·본문 중 하나라도 있으면 생성
    if (!data.title && !data.body) return;
    const id = uid();
    (state.notes = state.notes || []).push(Object.assign({ id, group: currentNoteGroup(), createdAt: todayStr() }, data));
    noteEditing = id;
    body.removeAttribute('data-new');                  // 이후 유형 변경 시 템플릿 자동교체 방지
  }
  save();
}
/* ---------- 기록 리치 텍스트(노션식 서식) ---------- */
function noteBodyIsHtml(s) { return typeof s === 'string' && /<(b|strong|i|em|u|s|strike|br|div|p|ul|ol|li|h[1-6]|span|font)[\s>\/]/i.test(s); }
function sanitizeHtml(html) {   // 위험 요소 제거(개인용 최소 정화) — 서식 태그는 보존
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '');
  tmp.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,svg').forEach(el => el.remove());
  tmp.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(a => {
      const nm = a.name.toLowerCase();
      if (nm.startsWith('on')) el.removeAttribute(a.name);
      else if ((nm === 'href' || nm === 'src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    });
  });
  return tmp.innerHTML;
}
function noteBodyToHtml(body, type) {   // 에디터에 넣을 초기 HTML (기존 평문은 HTML로 변환)
  if (body === undefined || body === null) body = (NOTE_TEMPLATES[type] || '');
  if (noteBodyIsHtml(body)) return sanitizeHtml(body);
  return esc(body).replace(/\n/g, '<br>');   // 평문·템플릿 → 줄바꿈 보존
}
function noteBodyForFeed(body) { return noteBodyIsHtml(body) ? sanitizeHtml(body) : esc(body || '').replace(/\n/g, '<br>'); }
function noteBodyPlain(body) { return noteBodyIsHtml(body) ? String(body).replace(/<[^>]*>/g, ' ') : String(body || ''); }
function readNoteBody() {   // 에디터 본문 값 읽기 (텍스트 있으면 HTML 저장, 없으면 null)
  const b = document.getElementById('m-nbody');
  if (!b) return null;
  const html = sanitizeHtml(b.innerHTML);
  return html.replace(/<[^>]*>/g, '').trim() ? html : null;
}
function caretOffset(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return 0;
  const r = sel.getRangeAt(0).cloneRange();
  const pre = document.createRange(); pre.selectNodeContents(el); pre.setEnd(r.endContainer, r.endOffset);
  return pre.toString().length;
}
function setCaretOffset(el, off) {
  const range = document.createRange(); const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  let n, chars = off, done = false;
  while ((n = walker.nextNode())) { const len = n.textContent.length; if (chars <= len) { range.setStart(n, chars); done = true; break; } chars -= len; }
  if (!done) { range.selectNodeContents(el); range.collapse(false); } else range.collapse(true);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
}
function renderNoteEditor() {
  const n = noteEditing ? (state.notes || []).find(x => x.id === noteEditing) : null;
  const d = noteDraft;
  const type = d ? d.type : (n ? n.type : 'memo');
  const gid = d && d.group !== undefined ? d.group : (n ? (n.group || '') : currentNoteGroup());
  const g = gid ? groupById(gid) : null;
  const gBoards = state.projects.filter(b => (b.group || '') === gid);
  const curBoard = d ? d.board : (n ? (n.board || '') : ((state.sel.noteBoard && state.sel.noteBoard !== '__common') ? state.sel.noteBoard : ''));
  const boardOpts = `<option value="">— 프로젝트 공통 —</option>` + orderedBoardsIn(gid || null)
    .filter(({ board }) => !board.folder || board.id === curBoard)
    .map(({ board }) => `<option value="${board.id}" ${curBoard === board.id ? 'selected' : ''}>${esc(boardPathLabel(board))}</option>`).join('');
  const groupOpts = (state.groups || []).map(x => `<option value="${x.id}" ${gid === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')
    + `<option value="" ${gid === '' ? 'selected' : ''}>미분류</option>`;
  const isNew = !n;
  const rawBody = d ? d.body : (n ? n.body : undefined);   // undefined면 템플릿
  const bodyHtml = noteBodyToHtml(rawBody, type);
  const dataNew = d ? (d.isNew ? 'data-new="1"' : '') : (isNew ? 'data-new="1"' : '');
  const fmt = (cmd, label, arg, title) => `<button type="button" class="ne-fmt" data-action="ne-fmt" data-cmd="${cmd}"${arg ? ` data-arg="${arg}"` : ''} title="${title}">${label}</button>`;
  const toolbar = `<div class="ne-toolbar">
    ${fmt('bold', '<b>B</b>', '', '굵게')}${fmt('italic', '<i>I</i>', '', '기울임')}${fmt('underline', '<u>U</u>', '', '밑줄')}${fmt('strikeThrough', '<s>S</s>', '', '취소선')}
    <span class="ne-sep"></span>
    ${fmt('formatBlock', '제목', 'H4', '제목(큰 글씨)')}${fmt('formatBlock', '본문', 'DIV', '본문으로')}
    <span class="ne-sep"></span>
    ${fmt('insertUnorderedList', '• 목록', '', '글머리 목록')}${fmt('insertOrderedList', '1. 목록', '', '번호 목록')}
    <span class="ne-sep"></span>
    ${fmt('hiliteColor', '🖍', '#ffe58a', '형광펜')}${fmt('foreColor', '<span style="color:#d64545">A</span>', '#d64545', '빨강 글자')}${fmt('foreColor', '<span style="color:#2b7fd0">A</span>', '#2b7fd0', '파랑 글자')}
    <span class="ne-sep"></span>
    ${fmt('removeFormat', '✕ 서식', '', '서식 지우기')}
  </div>`;
  return `<div class="note-editor">
    <div class="ne-top">
      <button class="pill" data-action="ne-cancel">← 목록으로</button>
      <span class="ne-ctx">📁 ${esc(g ? g.name : '미분류')}</span>
      <span class="ne-autosave">✓ 자동 저장됨</span>
      <span class="ne-spacer"></span>
      ${n ? `<button class="ne-del" data-action="note-del" data-id="${n.id}">삭제</button>` : ''}
      <button class="ne-save" data-action="note-save" data-id="${n ? n.id : ''}">완료</button>
    </div>
    <input type="text" class="ne-title" id="m-ntitle" value="${d ? esc(d.title) : (n ? esc(n.title) : '')}" placeholder="제목">
    <div class="ne-props">
      <label class="ne-prop">프로젝트<select id="m-ngroup">${groupOpts}</select></label>
      <label class="ne-prop">유형<select id="m-ntype">${noteTypeOptions(type)}</select></label>
      <label class="ne-prop">날짜<input type="date" id="m-ndate" value="${d ? d.date : (n ? (n.date || '') : todayStr())}"></label>
      <label class="ne-prop">보드<select id="m-nboard">${boardOpts}</select></label>
      <label class="ne-prop" id="m-who-wrap" style="display:${type === 'interview' ? '' : 'none'}">대상자<input type="text" id="m-nwho" value="${d ? esc(d.who) : (n ? esc(n.who || '') : '')}" placeholder="경리팀장 김OO"></label>
    </div>
    ${toolbar}
    <div class="ne-body rich" id="m-nbody" contenteditable="true" ${dataNew} data-ph="들은 내용, 확인한 사항, 다음 단계 등을 자유롭게 적어보세요">${bodyHtml}</div>
  </div>`;
}
function openNoteTodoModal(noteId) {
  const n = (state.notes || []).find(x => x.id === noteId);
  if (!n) return;
  const boards = state.projects.filter(b => (b.group || '') === (n.group || ''));
  const opts = boards.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('') + `<option value="__inbox">📥 미배정</option>`;
  showModal(`
    <h3>기록에서 할 일 만들기</h3>
    <p class="restore-note">"${esc(n.title)}" 기록을 바탕으로 To-do를 만듭니다.</p>
    <label>할 일 내용<input type="text" id="m-ttitle" value="${esc(n.title)}"></label>
    <label>보드<select id="m-tboard">${opts}</select></label>
    <label>중요도${prioPicker('med')}</label>
    <div class="m-actions">
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="note-todo-save">만들기</button>
    </div>`);
}
function openOverviewModal() {
  const gid = currentNoteGroup();
  const g = gid ? groupById(gid) : null;
  const cur = g ? (g.overview || '') : (state.unGroupOverview || '');
  showModal(`
    <h3>📌 ${esc(g ? g.name : '미분류')} 개요</h3>
    <label>프로젝트 핵심 현황·컨택포인트·주의사항<textarea id="m-overview" rows="7" placeholder="예: 감사반: 나+A매니저 / 회사 담당: 경리팀장 김OO (내선 1234)&#10;7월 말까지 중간감사, 재고실사 8/20 예정&#10;⚠ 전기 감사인 의견 확인 필요">${esc(cur)}</textarea></label>
    <div class="m-actions">
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="overview-save">저장</button>
    </div>`);
}

/* ---------- 타임박스 (일론 머스크식 Time Box) ---------- */
let tbSel = null;    // 선택된 Big3 인덱스 (칠하기 대상)
let tbPaint = null;  // { erase } — 드래그 칠하기 진행 중
function tbData(date) {
  state.timebox = state.timebox || {};
  if (!state.timebox[date]) state.timebox[date] = { big3: [null, null, null], slots: {} };
  const d = state.timebox[date];
  d.big3 = d.big3 || [null, null, null];
  d.slots = d.slots || {};
  return d;
}
function tbSum(d, idx) { return Object.values(d.slots).filter(v => v === idx).length * 0.5; }
// 카드가 삭제되면(보드 삭제 포함) 모든 날짜의 Big3에서도 제거 + 배정 시간칸 정리
function purgeTimeboxCards(cardIds) {
  const ids = new Set(cardIds);
  if (!ids.size) return;
  Object.values(state.timebox || {}).forEach(d => {
    if (!d || !d.big3) return;
    d.big3.forEach((b, i) => {
      if (!b || !ids.has(b.cardId)) return;
      d.big3[i] = null;
      Object.keys(d.slots || {}).forEach(k => { if (d.slots[k] === i) delete d.slots[k]; });
    });
    while (d.big3.length > 3 && d.big3[d.big3.length - 1] == null) d.big3.pop();
  });
  tbSel = null;
}
// Big3 항목의 완수 여부는 실제 카드 상태를 진실의 원천으로 사용 → 어느 날짜에서 완료해도 모든 날에 반영
function tbDone(b) {
  if (!b) return false;
  if (b.cardId) { const c = state.cards.find(x => x.id === b.cardId); if (c) return c.status === 'done'; }
  return !!b.done;
}
// Big3 제목은 원본 카드에서 실시간으로 읽음 — 카드 내용을 고치면 Big3에도 바로 반영(직접 입력 항목은 저장된 title 사용)
function tbTitle(b) {
  if (!b) return '';
  if (b.cardId) { const c = state.cards.find(x => x.id === b.cardId); if (c) return c.title; }
  return b.title || '';
}
function tbShift(n) {
  const [y, m, dd] = (state.sel.tboxDate || todayStr()).split('-').map(Number);
  state.sel.tboxDate = dstr(new Date(y, m - 1, dd + n));
  tbSel = null; render();
}
// Big3 순서 변경: from → to. 배정된 시간칸(slots의 인덱스)도 함께 재매핑
function tbMoveBig3(from, to) {
  const d = tbData(state.sel.tboxDate || todayStr());
  const n = d.big3.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
  const order = d.big3.map((_, i) => i);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  const oldToNew = {};
  order.forEach((oldIdx, newIdx) => { oldToNew[oldIdx] = newIdx; });
  d.big3 = order.map(oldIdx => d.big3[oldIdx]);
  const newSlots = {};
  Object.keys(d.slots).forEach(k => { newSlots[k] = oldToNew[d.slots[k]]; });
  d.slots = newSlots;
  if (tbSel !== null && oldToNew[tbSel] !== undefined) tbSel = oldToNew[tbSel];
  save(); render();
}
/* ---------- 트리 (프로젝트 세부 내역: 보드 › 할일·기록) ---------- */
const treeClosed = new Set();     // 접은 노드 키 (기본은 펼침)
const treeSeeded = new Set();     // 기본 접힘으로 시드한 키(완수 묶음)
const treeNoteOpen = new Set();   // 본문을 펼친 기록
function treeOpen(key, defClosed) {
  if (defClosed && !treeSeeded.has(key)) { treeSeeded.add(key); treeClosed.add(key); }
  return !treeClosed.has(key);
}
function treeGroupId() {
  const groups = state.groups || [];
  let gid = state.sel.treeGroup;
  if (gid === undefined || (gid !== '' && !groupById(gid))) gid = groups.length ? groups[0].id : '';
  state.sel.treeGroup = gid;
  return gid;
}
function trCaret(key, has, open) {
  if (!has) return '<span class="tr-caret sp"></span>';
  return `<button class="tr-caret" data-action="tree-toggle" data-key="${esc(key)}" title="${open ? '접기' : '펼치기'}">${open ? '▾' : '▸'}</button>`;
}
function trLi(node, children) {
  return `<li>${node}${children ? `<ul class="tr-children">${children}</ul>` : ''}</li>`;
}
function renderTree() {
  const groups = state.groups || [];
  const gid = treeGroupId();
  const g = gid ? groupById(gid) : null;
  const color = g ? g.color : 'gray';
  const pills = groups.map(x => `<button class="fpill ${gid === x.id ? 'on c-' + x.color : ''}" data-action="tree-group" data-gid="${x.id}">📁 ${esc(x.name)}</button>`).join('')
    + `<button class="fpill ${gid === '' ? 'on c-gray' : ''}" data-action="tree-group" data-gid="">미분류</button>`;

  const boards = state.projects.filter(b => (b.group || '') === gid);
  const bIds = new Set(boards.map(b => b.id));
  const byParent = {};
  boards.forEach(b => { const p = (b.parent && bIds.has(b.parent)) ? b.parent : '__root'; (byParent[p] = byParent[p] || []).push(b); });
  const gNotes = (state.notes || []).filter(n => (n.group || '') === gid);

  // 개별 항목 노드
  const cardLeaf = c => {
    const mark = c.status === 'done' ? '<span class="tr-mk done">✓</span>' : c.status === 'doing' ? '<span class="tr-mk doing">▶</span>' : '<span class="tr-mk">□</span>';
    const due = (c.status !== 'done' && c.due) ? `<span class="tr-sub">${fmtDate(c.due)}</span>` : (c.doneAt ? `<span class="tr-sub">${fmtDate(c.doneAt)}</span>` : '');
    return trLi(`<div class="tr-node item ${c.status}" data-action="card" data-id="${c.id}" title="클릭하면 수정">
      <span class="tr-caret sp"></span>${mark}${fuBadgeHtml(c)}<span class="tr-t">${esc(c.title)}</span>${due}</div>`);
  };
  const noteLeaf = n => {
    const nt = NOTE_TYPES[n.type] || NOTE_TYPES.memo;
    const open = treeNoteOpen.has(n.id);
    // 본문은 토글 영역 밖(형제)으로 — 본문 클릭·드래그로 접히지 않게
    const body = open ? `<div class="tr-note-body">${noteBodyForFeed(n.body) || '<span class="tr-sub">내용 없음</span>'}</div>` : '';
    return trLi(`<div class="tr-node note ${open ? 'open' : ''}">
      <div class="tr-note-head" data-action="tree-note" data-id="${n.id}" title="클릭하면 본문 펼치기"><span class="tr-caret">${open ? '▾' : '▸'}</span><span class="tr-mk">${nt.icon}</span><span class="tr-t">${esc(n.title || '(제목 없음)')}</span>${n.date ? `<span class="tr-sub">${fmtDate(n.date)}</span>` : ''}
        <button class="tr-go" data-action="tree-gonote" data-id="${n.id}" title="기록 편집">✎</button></div>${body}</div>`);
  };
  // 보드 노드(하위 보드 재귀 + 할일/기록 묶음)
  const boardNode = b => {
    const kids = byParent[b.id] || [];
    const cs = state.cards.filter(c => c.project === b.id);
    const live = cs.filter(c => c.status !== 'done').sort((a, c) => (a.status === 'doing' ? -1 : 0) - (c.status === 'doing' ? -1 : 0));
    const done = cs.filter(c => c.status === 'done').sort((a, c) => (c.doneAt || '').localeCompare(a.doneAt || ''));
    const ns = gNotes.filter(n => n.board === b.id).sort((a, c) => (c.date || '').localeCompare(a.date || ''));
    const bKey = 'b:' + b.id, bOpen = treeOpen(bKey);
    let sub = '';
    if (bOpen) {
      if (cs.length) {
        const tKey = 't:' + b.id, tOpen = treeOpen(tKey);
        const dKey = 'd:' + b.id, dOpen = treeOpen(dKey, true);   // 완수 묶음은 기본 접힘
        let items = tOpen ? live.map(cardLeaf).join('') : '';
        if (tOpen && done.length) {
          items += trLi(`<div class="tr-node grp done-grp" data-action="tree-toggle" data-key="${dKey}">
            ${trCaret(dKey, true, dOpen)}<span class="tr-t">✓ 완수</span><span class="tr-cnt">${done.length}</span></div>`,
            dOpen ? done.map(cardLeaf).join('') : '');
        }
        sub += trLi(`<div class="tr-node grp" data-action="tree-toggle" data-key="${tKey}">
          ${trCaret(tKey, true, tOpen)}<span class="tr-t">✅ 할 일</span><span class="tr-cnt">${cs.length}</span></div>`, items);
      }
      if (ns.length) {
        const nKey = 'n:' + b.id, nOpen = treeOpen(nKey);
        sub += trLi(`<div class="tr-node grp" data-action="tree-toggle" data-key="${nKey}">
          ${trCaret(nKey, true, nOpen)}<span class="tr-t">📝 기록</span><span class="tr-cnt">${ns.length}</span></div>`, nOpen ? ns.map(noteLeaf).join('') : '');
      }
      sub += kids.map(boardNode).join('');
    }
    const hasKids = !!(cs.length || ns.length || kids.length);
    const doneMark = b.done ? '<span class="tr-sub">✓ 완료</span>' : '';
    return trLi(`<div class="tr-node board c-${b.color} ${b.done ? 'is-done' : ''}">
      ${trCaret(bKey, hasKids, bOpen)}<span class="tr-t">${b.folder ? '📚' : '🗂'} ${esc(b.name)}</span>${doneMark}
      <button class="tr-go" data-action="tree-goboard" data-bid="${b.id}" title="이 보드로 이동">↗</button></div>`, sub);
  };

  let lvl2 = (byParent.__root || []).map(boardNode).join('');
  const common = gNotes.filter(n => !n.board);
  if (common.length) {
    const cKey = 'c:' + gid, cOpen = treeOpen(cKey);   // 프로젝트별 키 — 접힘 상태가 서로 섞이지 않게
    lvl2 += trLi(`<div class="tr-node board plain" data-action="tree-toggle" data-key="${cKey}">
      ${trCaret(cKey, true, cOpen)}<span class="tr-t">📄 프로젝트 공통</span><span class="tr-cnt">${common.length}</span></div>`,
      cOpen ? common.sort((a, c) => (c.date || '').localeCompare(a.date || '')).map(noteLeaf).join('') : '');
  }
  const scheds = (state.schedules || []).filter(s => (s.group || '') === gid).sort(schedSort);
  if (scheds.length) {
    const sKey = 's:' + gid, sOpen = treeOpen(sKey);
    const rows = scheds.map(s => trLi(`<div class="tr-node item" data-action="sched-edit" data-id="${s.id}" title="클릭하면 수정">
      <span class="tr-caret sp"></span><span class="tr-mk">📌</span><span class="tr-t">${esc(s.title)}</span><span class="tr-sub">${s.date ? fmtDate(s.date) : ''}${s.time ? ' ' + s.time : ''}</span></div>`)).join('');
    lvl2 += trLi(`<div class="tr-node board plain" data-action="tree-toggle" data-key="${sKey}">
      ${trCaret(sKey, true, sOpen)}<span class="tr-t">📌 일정 · 마감</span><span class="tr-cnt">${scheds.length}</span></div>`, sOpen ? rows : '');
  }

  const cardCnt = state.cards.filter(c => c.project && bIds.has(c.project)).length;
  const rootLabel = `<div class="tr-node root c-${color}">
      <span class="tr-t">📁 ${esc(g ? g.name : '미분류')}</span>
      <span class="tr-cnt">🗂 ${boards.length} · ✅ ${cardCnt} · 📝 ${gNotes.length}</span></div>`;
  const body = lvl2
    ? `<div class="tr-root">${rootLabel}<ul class="tr-children">${lvl2}</ul></div>`
    : `<div class="tr-root">${rootLabel}</div><div class="empty">이 프로젝트에는 아직 보드·기록이 없어요</div>`;
  return `<div class="tree-wrap">
    <div class="cal-filter"><span class="fl-label">프로젝트</span>${pills}
      <button class="fpill" data-action="tree-all" data-v="open" title="모든 노드 펼치기">⊞ 모두 펼치기</button>
      <button class="fpill" data-action="tree-all" data-v="close" title="보드만 남기고 접기">⊟ 모두 접기</button>
      <span class="fl-note">보드 클릭=펼치기 · 기록 클릭=본문 · 할 일 클릭=수정 · ↗=보드로 이동</span></div>
    <div class="tree-canvas slim-scroll">${body}</div>
  </div>`;
}

function renderTbox() {
  const date = state.sel.tboxDate || todayStr();
  state.sel.tboxDate = date;
  const d = tbData(date);
  const isToday = date === todayStr();
  const offset = dday(date);                                   // 0=오늘, 양수=미래, 음수=과거
  const inPlanWindow = offset >= 0 && offset <= TB_PLAN_DAYS - 1;   // 오늘 ~ 오늘+4
  const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(date + 'T00:00:00').getDay()];
  const slotCount = Math.max(3, d.big3.length);
  const rows = Array.from({ length: slotCount }, (_, i) => {
    const b = d.big3[i], c = tbColor(i);
    if (!b) return `<div class="tb-big3-row empty" data-idx="${i}"><span class="tb-chip" style="background:${c.bg}"></span><span class="tb-empty-txt">Brain Dump에서 여기로 드래그</span>${i >= 3 ? `<button class="tb-x" data-action="tb-remove" data-idx="${i}" title="빈 우선순위 삭제">✕</button>` : ''}</div>`;
    const sum = tbSum(d, i);
    const hasActual = b.actual !== undefined && b.actual !== null && b.actual !== '';
    const diff = hasActual ? Math.round((b.actual - sum) * 100) / 100 : null;
    const diffHtml = !hasActual ? '' :
      diff > 0 ? `<span class="tb-diff over">+${diff}h 초과</span>` :
      diff < 0 ? `<span class="tb-diff under">${diff}h 단축</span>` :
      `<span class="tb-diff even">정확</span>`;
    const done = tbDone(b);
    const bcard = b.cardId ? state.cards.find(x => x.id === b.cardId) : null;
    const bboard = bcard && bcard.project ? boardById(bcard.project) : null;
    const bgroup = bboard && bboard.group ? groupById(bboard.group) : null;
    const projBadge = bgroup ? `<span class="drow-proj c-${bgroup.color}" title="${esc(bgroup.name)}${bboard ? ' · ' + esc(bboard.name) : ''}">${esc(bgroup.name)}</span>` : '';
    const boardBadge = bboard ? `<span class="tb-board-badge" title="보드">🗂 ${esc(bboard.name)}</span>` : '';
    return `<div class="tb-big3-row ${tbSel === i ? 'sel' : ''} ${done ? 'done' : ''}" data-idx="${i}" data-action="tb-select" title="클릭=선택 후 시간 칸 드래그로 배정">
      <span class="tb-grip" draggable="true" data-idx="${i}" title="드래그로 순서 변경">⠿</span>
      <span class="tb-chip" style="background:${c.bg}"></span>
      <input type="checkbox" data-action="tb-check" data-idx="${i}" ${done ? 'checked' : ''} title="완수 처리 (보드에도 반영)">
      ${projBadge}${boardBadge}<span class="tb-title">${esc(tbTitle(b))}</span>
      <span class="tb-sum">${sum ? '계획 ' + sum + 'h' : ''}</span>
      <span class="tb-actual-wrap" title="실제 소요 시간 기록">실제 <input type="number" class="tb-actual-input" data-idx="${i}" step="0.5" min="0" placeholder="-" value="${hasActual ? b.actual : ''}">h</span>
      ${diffHtml}
      <button class="tb-x" data-action="tb-remove" data-idx="${i}" title="빼기 (배정 시간도 삭제)">✕</button>
    </div>`;
  }).join('') + `<button class="tb-add" data-action="tb-add" title="우선순위 항목 추가">＋ 우선순위 추가</button>`;
  let dumpHtml;
  if (inPlanWindow) {
    const dump = state.cards.filter(c => c.status !== 'done').sort(byProject(dueSort));
    const sub = isToday ? '미완료 To-do 전체 · 클릭=수정 / 더블클릭=보드 / 드래그=Big3' : `D+${offset} · ${offset}일 뒤 계획 — 현재 미완료 To-do를 미리 배치`;
    const dumpItem = c => {
      const b = c.project ? boardById(c.project) : null;
      const g = b && b.group ? groupById(b.group) : null;
      const pr = PRIORITIES[c.priority] || PRIORITIES.none;
      const inBig = d.big3.some(x => x && x.cardId === c.id);
      return `<div class="tb-dump-item ${inBig ? 'in-big' : ''}" draggable="true" data-id="${c.id}" title="클릭=수정 · 더블클릭=보드로 이동">
        <span class="drow-prio" style="${pr.bg ? 'background:' + pr.bg : ''}"></span>
        <span class="tb-dump-t">${esc(c.title)}</span>${b ? `<span class="drow-board">${esc(b.name)}</span>` : ''}${inBig ? '<span class="tb-star">★</span>' : ''}
      </div>`;
    };
    // 프로젝트별 그룹핑
    let dumpBody = '';
    if (dump.length) {
      let lastKey = '__init';
      dump.forEach(c => {
        const key = cardProjKey(c);
        if (key !== lastKey) {
          lastKey = key;
          const g = (key && key !== '__inbox') ? groupById(key) : null;
          const label = g ? `<span class="drow-proj c-${g.color}">${esc(g.name)}</span>` : (key === '' ? '📄 미분류 보드' : '📥 미배정');
          dumpBody += `<div class="tb-dump-grp">${label}</div>`;
        }
        dumpBody += dumpItem(c);
      });
    } else dumpBody = '<div class="empty">미완료 할 일이 없어요 👍</div>';
    dumpHtml = `<div class="tb-sec-h" style="margin-top:16px">Brain Dump <span class="cnt">${dump.length}</span><span class="dash-sub">${sub}</span></div>
      <div class="tb-dump">${dumpBody}</div>
      <form class="quick" data-project="__inbox"><input name="t" placeholder="+ 쏟아내기 — 미배정 할 일로 추가" autocomplete="off"></form>`;
  } else {
    const msg = offset > 0
      ? `📅 ${TB_PLAN_DAYS}일 이후 날짜입니다 · 가까운 날짜에서 계획하세요`
      : '📖 지난 날짜의 타임박스입니다';
    dumpHtml = `<div class="tb-note-past">${msg} · <button class="mini-btn" data-action="tbox-today">오늘로 이동</button></div>`;
  }
  // 이 날짜의 시간 지정 일정 → 해당 시간칸에 📌 표시
  const schedBySlot = {};
  (state.schedules || []).forEach(s => {
    if (s.date !== date || !s.time) return;
    const [hh, mm] = s.time.split(':').map(Number);
    if (hh < 6 || hh >= 24) return;
    const k = hh + '.' + (mm >= 30 ? 5 : 0);
    (schedBySlot[k] = schedBySlot[k] || []).push(s);
  });
  let grid = '<div class="tb-grid" id="tb-grid"><div class="tb-grid-h"><span></span><span>:00</span><span>:30</span></div>';
  for (let h = 6; h < 24; h++) {
    const cell = half => {
      const k = h + '.' + half;
      const v = d.slots[k];
      const doneSlot = v !== undefined && tbDone(d.big3[v]);
      const ss = schedBySlot[k];
      const mark = ss ? `<span class="tb-sched-mark" title="${esc(ss.map(x => x.time + ' ' + x.title).join('\n'))}">📌 ${esc(ss[0].title)}${ss.length > 1 ? ` 외 ${ss.length - 1}` : ''}</span>` : '';
      const num = v !== undefined ? `<span class="tb-cell-num">${v + 1}</span>` : '';
      return `<div class="tb-cell${doneSlot ? ' done-slot' : ''}${ss ? ' has-sched' : ''}" data-slot="${k}" ${v !== undefined ? `style="background-color:${tbColor(v).bg};color:${tbColor(v).fg}"` : ''}>${num}${mark}</div>`;
    };
    grid += `<div class="tb-row"><span class="tb-hour">${h}</span>${cell(0)}${cell(5)}</div>`;
  }
  grid += '</div>';
  const selB = tbSel !== null ? d.big3[tbSel] : null;
  const hint = selB ? `<b>${esc(tbTitle(selB))}</b> 배정 중 — 시간 칸을 드래그하세요 (칠한 칸 다시 드래그=지우기)` : 'Big 3 행을 클릭해 선택 → 오른쪽 시간 칸을 드래그해 배정';
  return `<div class="cal-head">
      <span class="cal-title">⏱ ${date} (${dow})${isToday ? ' · 오늘' : ''}</span>
      <button class="pill" data-action="tbox-prev">◀</button>
      <button class="pill" data-action="tbox-today">오늘</button>
      <button class="pill" data-action="tbox-next">▶</button>
      <span class="cal-hint">${hint}</span>
    </div>
    <div class="tbox-wrap">
      <div class="tb-left">
        <div class="tb-sec-h">Top Priorities — Big 3</div>
        ${rows}
        ${dumpHtml}
      </div>
      <div class="tb-right">${grid}</div>
    </div>`;
}
function tbApplyCell(cell) {
  const d = tbData(state.sel.tboxDate || todayStr());
  const k = cell.dataset.slot;
  // 숫자는 전용 span만 갱신 → 같은 칸의 📌 일정 마크가 페인트 중에도 보존됨
  const setNum = txt => {
    let n = cell.querySelector('.tb-cell-num');
    if (!txt) { if (n) n.remove(); return; }
    if (!n) { n = document.createElement('span'); n.className = 'tb-cell-num'; cell.prepend(n); }
    n.textContent = txt;
  };
  if (tbPaint.erase) {
    if (d.slots[k] === tbSel) { delete d.slots[k]; cell.style.backgroundColor = ''; cell.style.color = ''; setNum(''); cell.classList.remove('done-slot'); }
  } else {
    d.slots[k] = tbSel;
    cell.style.backgroundColor = tbColor(tbSel).bg;
    cell.style.color = tbColor(tbSel).fg;
    setNum(String(tbSel + 1));
    cell.classList.toggle('done-slot', tbDone(d.big3[tbSel]));
  }
}
document.addEventListener('pointerdown', e => {
  const cell = e.target.closest && e.target.closest('.tb-cell');
  if (!cell || tbSel === null) return;
  const d = tbData(state.sel.tboxDate || todayStr());
  tbPaint = { erase: d.slots[cell.dataset.slot] === tbSel };
  tbApplyCell(cell);
  e.preventDefault();
});
document.addEventListener('pointermove', e => {
  if (!tbPaint) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const cell = el && el.closest ? el.closest('.tb-cell') : null;
  if (cell) tbApplyCell(cell);
});
document.addEventListener('pointerup', () => {
  if (tbPaint) { tbPaint = null; save(); render(); }
});
// Brain Dump 항목: 한 번 클릭=내용 수정 / 더블클릭=보드로 이동 (드래그는 그대로)
let tbDumpClickTimer = null;
document.addEventListener('click', e => {
  const it = e.target.closest && e.target.closest('.tb-dump-item');
  if (!it) return;
  if (tbDumpClickTimer) { clearTimeout(tbDumpClickTimer); tbDumpClickTimer = null; return; }   // 더블클릭 첫 클릭 무시
  const id = it.dataset.id;
  tbDumpClickTimer = setTimeout(() => { tbDumpClickTimer = null; openCardModal(id); }, 250);
});
document.addEventListener('dblclick', e => {
  const it = e.target.closest && e.target.closest('.tb-dump-item');
  if (!it) return;
  if (tbDumpClickTimer) { clearTimeout(tbDumpClickTimer); tbDumpClickTimer = null; }
  const c = state.cards.find(x => x.id === it.dataset.id);
  if (c && c.project) { const b = boardById(c.project); focusBoard = c.project; state.sel.boardGroup = b && b.group ? b.group : ''; }
  else state.sel.boardGroup = '';
  state.sel.view = 'board'; render();
});
// 구조도 미배정 할 일: 클릭 = 수정 (드래그는 배정)
document.addEventListener('click', e => {
  const it = e.target.closest && e.target.closest('.map-todo-item');
  if (it) openCardModal(it.dataset.id);
});
// 현황 To-do/일정 행: 한 번 클릭 = 수정 / 더블클릭 = 해당 보드로 이동
let dashClickTimer = null;
function dashGoBoard(kind, id) {
  if (kind === 'card') {
    const c = state.cards.find(x => x.id === id);
    if (c && c.project) { const b = boardById(c.project); focusBoard = c.project; state.sel.boardGroup = b && b.group ? b.group : ''; }
    else state.sel.boardGroup = '';
  } else if (kind === 'sched') {
    const s = schedById(id); state.sel.boardGroup = s ? (s.group || '') : '__all';
  }
  state.sel.view = 'board'; render();
}
document.addEventListener('click', e => {
  if (e.target.closest('input,button,a')) return;   // 체크박스 등은 그대로
  const row = e.target.closest('.dash .drow[data-kind]');
  if (!row) return;
  if (dashClickTimer) { clearTimeout(dashClickTimer); dashClickTimer = null; return; }   // 더블클릭 첫 클릭 무시
  const kind = row.dataset.kind, id = row.dataset.id;
  dashClickTimer = setTimeout(() => { dashClickTimer = null; kind === 'card' ? openCardModal(id) : openSchedModal(id); }, 250);
});
document.addEventListener('dblclick', e => {
  const row = e.target.closest('.dash .drow[data-kind]');
  if (!row) return;
  if (dashClickTimer) { clearTimeout(dashClickTimer); dashClickTimer = null; }
  dashGoBoard(row.dataset.kind, row.dataset.id);
});

/* ---------- 일지 (To-do·타임박스 기반 자동 일일 기록) ---------- */
function journalDerive(date) {
  const done = state.cards.filter(c => c.status === 'done' && c.doneAt === date).map(c => {
    const b = c.project ? boardById(c.project) : null;
    const g = b && b.group ? groupById(b.group) : null;
    return { title: c.title, proj: g ? g.name : '', color: g ? g.color : '', board: b ? b.name : '' };
  });
  const created = state.cards.filter(c => c.createdAt === date).length;
  const td = (state.timebox || {})[date];
  const big3 = []; let planH = 0, actualH = 0;
  if (td && td.big3) {
    td.big3.forEach((b, i) => {
      if (!b) return;
      const plan = tbSum(td, i);
      const actual = (b.actual !== undefined && b.actual !== null && b.actual !== '') ? b.actual : null;
      planH += plan; if (actual !== null) actualH += actual;
      big3.push({ title: tbTitle(b), done: tbDone(b), plan, actual });
    });
  }
  const notes = (state.notes || []).filter(n => n.date === date).map(n => ({ type: n.type, title: n.title }));
  if (!done.length && !big3.length && !notes.length && !created) return null;
  return { done, created, big3, planH: Math.round(planH * 100) / 100, actualH: Math.round(actualH * 100) / 100, notes };
}
function journalFreeze() {   // 어제까지의 미확정 일지를 스냅샷으로 저장 (원본 삭제에도 보존)
  state.journal = state.journal || {};
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const y = new Date(t); y.setDate(y.getDate() - 1);
  const yStr = dstr(y);
  let startStr = state.journalUpto ? nextDay(state.journalUpto) : null;
  if (!startStr) {
    const dates = [];
    state.cards.forEach(c => { if (c.doneAt) dates.push(c.doneAt); if (c.createdAt) dates.push(c.createdAt); });
    Object.keys(state.timebox || {}).forEach(k => dates.push(k));
    (state.notes || []).forEach(n => { if (n.date) dates.push(n.date); });
    startStr = dates.length ? dates.reduce((a, b) => a < b ? a : b) : null;
  }
  let changed = false;
  if (startStr && startStr <= yStr) {
    let cur = startStr, guard = 0;
    while (cur <= yStr && guard++ < 400) {
      if (!(state.journal[cur] && state.journal[cur].auto)) {
        const a = journalDerive(cur);
        if (a) { state.journal[cur] = Object.assign({}, state.journal[cur], { auto: a }); changed = true; }
      }
      cur = nextDay(cur);
    }
  }
  if (state.journalUpto !== yStr) { state.journalUpto = yStr; changed = true; }
  return changed;
}
// 한국어 조사 자동 선택(받침 유무)
function josa(w, pair) {
  const [a, b] = pair.split('|');
  if (!w) return b;
  const code = w.charCodeAt(w.length - 1);
  if (code < 0xAC00 || code > 0xD7A3) return b;
  return ((code - 0xAC00) % 28 !== 0) ? a : b;
}
function joinKo(arr) {
  if (!arr.length) return '';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return arr[0] + josa(arr[0], '과|와') + ' ' + arr[1];
  return arr.slice(0, -1).join(', ') + ', 그리고 ' + arr[arr.length - 1];
}
// 파생 데이터 → 서술형 한 문단(일기체, AI 없이)
function journalProse(a) {
  const s = [];
  if (a.done.length) {
    const byP = {};
    a.done.forEach(d => { const k = d.proj || ''; (byP[k] = byP[k] || []).push(d.title); });
    const parts = [];
    Object.keys(byP).forEach(k => {
      const titles = byP[k], joined = joinKo(titles), last = titles[titles.length - 1];
      parts.push(k ? `${k}에서 ${joined}${josa(last, '을|를')} 마무리했다` : `미배정 업무로 ${joined}${josa(last, '을|를')} 처리했다`);
    });
    s.push(parts.join('. ') + '.');
  }
  if (a.big3.length) {
    const done = a.big3.filter(b => b.done).length, tot = a.big3.length;
    s.push(done === tot ? `오늘 정한 핵심 ${tot}가지를 모두 해냈다.`
      : done > 0 ? `핵심 ${tot}가지 중 ${done}가지를 달성했다.`
      : `핵심 ${tot}가지는 아직 마무리하지 못했다.`);
  }
  if (a.planH || a.actualH) {
    if (a.actualH) {
      const diff = Math.round((a.actualH - a.planH) * 100) / 100;
      s.push(diff > 0 ? `타임박스에 ${a.planH}시간을 계획했지만 실제로는 ${a.actualH}시간이 걸렸다(+${diff}시간).`
        : diff < 0 ? `타임박스에 ${a.planH}시간을 계획했고 실제로는 ${a.actualH}시간 만에 끝냈다(${diff}시간).`
        : `타임박스 계획대로 ${a.planH}시간을 썼다.`);
    } else s.push(`타임박스에 ${a.planH}시간을 계획했다.`);
  }
  if (a.notes.length) {
    const titles = a.notes.map(n => n.title);
    s.push(`${joinKo(titles)}${josa(titles[titles.length - 1], '을|를')} 기록으로 남겼다.`);
  }
  if (a.created) s.push(`새 할 일 ${a.created}건도 등록했다.`);
  return s.join(' ');
}
// 파생 데이터 → 구조화 마크다운(문장 요약 + 카테고리별 불렛). AI 없이.
function journalMarkdown(a) {
  const L = [journalProse(a), ''];
  if (a.done.length) {
    L.push('✅ **완수**');
    const byP = {};
    a.done.forEach(d => { const k = d.proj || '미배정'; (byP[k] = byP[k] || []).push(d.title); });
    Object.keys(byP).forEach(k => L.push(`- ${k}: ${byP[k].join(', ')}`));
  }
  if (a.big3.length) {
    L.push('🎯 **핵심 Big3**');
    a.big3.forEach(b => {
      const meta = [b.plan ? `계획 ${b.plan}h` : '', (b.actual != null ? `실제 ${b.actual}h` : '')].filter(Boolean).join('·');
      L.push(`- ${b.done ? '✓' : '○'} ${b.title}${meta ? ` (${meta})` : ''}`);
    });
  }
  if (a.planH || a.actualH) {
    const diff = Math.round((a.actualH - a.planH) * 100) / 100;
    L.push('⏱ **시간**', `- 계획 ${a.planH}h${a.actualH ? ` → 실제 ${a.actualH}h (${diff > 0 ? '+' : ''}${diff}h)` : ''}`);
  }
  if (a.notes.length) {
    L.push('📝 **기록**');
    a.notes.forEach(n => { const nt = NOTE_TYPES[n.type] || NOTE_TYPES.memo; L.push(`- [${nt.label}] ${n.title}`); });
  }
  if (a.created) L.push('➕ **신규 등록**', `- 새 할 일 ${a.created}건`);
  return L.join('\n');
}
// 마크다운(불렛·**굵게**) → HTML. 기본 요약·AI 출력 공통 렌더.
function jrRichText(md) {
  const lines = String(md).split('\n');
  let html = '', inUl = false;
  const bold = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const closeUl = () => { if (inUl) { html += '</ul>'; inUl = false; } };
  lines.forEach(line => {
    const t = line.trim();
    if (!t) { closeUl(); return; }
    const m = t.match(/^[-*•]\s+(.*)$/);
    if (m) { if (!inUl) { html += '<ul class="jr-ul">'; inUl = true; } html += `<li>${bold(m[1])}</li>`; return; }
    closeUl();
    html += `<div class="jr-line">${bold(t)}</div>`;
  });
  closeUl();
  return html;
}

// ---- 선택적 Gemini 윤문 (클릭 시에만 호출, 그 하루 데이터만 전송) ----
const jrAiBusy = new Set();
function jrSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function buildJrPrompt(date, a) {
  const lines = [];
  if (a.done.length) lines.push('완수: ' + a.done.map(d => (d.proj ? `[${d.proj}] ` : '') + d.title).join(', '));
  if (a.big3.length) lines.push('오늘의 핵심 Big3: ' + a.big3.map(b => `${b.title}(${b.done ? '달성' : '미달성'}${b.plan ? `, 계획 ${b.plan}h` : ''}${b.actual != null ? `, 실제 ${b.actual}h` : ''})`).join(' / '));
  if (a.planH || a.actualH) lines.push(`시간: 계획 ${a.planH}h, 실제 ${a.actualH}h`);
  if (a.notes.length) lines.push('남긴 기록: ' + a.notes.map(n => n.title).join(', '));
  if (a.created) lines.push(`새로 등록한 할 일: ${a.created}건`);
  return `당신은 회계사(외부감사·내부회계관리제도 감사 업무)의 하루 업무 일지를 대신 정리합니다.
아래 '오늘 한 일' 데이터만 근거로(과장·지어내기 금지), 다음 형식의 한국어 일지를 작성하세요.

1) 첫 부분: 오늘 하루를 돌아보는 자연스러운 1인칭 서술 2~3문장("~했다" 체).
2) 빈 줄 뒤: 카테고리별 불렛 정리. 아래 중 데이터가 있는 것만 소제목으로 쓰고, 각 항목은 "- "로 시작.
   소제목은 반드시 이 표기 그대로: ✅ **완수** / 🎯 **핵심 Big3** / ⏱ **시간** / 📝 **기록**
   - 완수는 프로젝트별로 묶고, 시간은 계획 대비 실제를 짚을 것.
데이터에 없는 내용은 절대 만들지 마세요.

[${date}] 오늘 한 일
${lines.join('\n')}`;
}
async function callGeminiJr(prompt, key) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  for (let attempt = 0; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },   // 키는 헤더로(URL 노출 방지, 신형 AQ. 키 호환)
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.6, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } } })
    });
    if (res.ok) {
      const data = await res.json();
      const cand = data.candidates && data.candidates[0];
      const txt = (cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text).join('') : '').trim();
      return txt || '(AI 응답이 비어 있어요. 다시 시도해 주세요.)';
    }
    const errText = await res.text();
    if ((res.status === 429 || res.status === 503) && attempt < 3) { await jrSleep(2000 * (attempt + 1)); continue; }
    if (res.status === 429) throw new Error('무료 사용량 한도를 초과했어요. 잠시 후 다시 시도해 주세요.');
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 120)}`);
  }
}
function geminiKey() {
  return (state.settings && state.settings.geminiKey) || localStorage.getItem('gemini_key') || '';
}
function saveGeminiKey(k) {
  state.settings = state.settings || {};
  if (k) { state.settings.geminiKey = k; localStorage.setItem('gemini_key', k); }
  else { delete state.settings.geminiKey; localStorage.removeItem('gemini_key'); }
}
async function runJrAi(date) {
  let key = geminiKey();
  if (!key) {
    key = (window.prompt('Gemini API 키를 입력하세요.\n(aistudio.google.com에서 무료 발급 · 계정 클라우드에 저장되어 모든 기기에서 쓰입니다)') || '').trim();
    if (!key) return;
    saveGeminiKey(key);
  }
  const a = date === todayStr() ? journalDerive(date) : ((state.journal[date] || {}).auto);
  if (!a) { alert('이 날짜엔 정리할 활동이 없어요.'); return; }
  jrAiBusy.add(date); render();
  try {
    const txt = await callGeminiJr(buildJrPrompt(date, a), key);
    state.journal = state.journal || {};
    const e = state.journal[date] || {}; e.ai = txt; state.journal[date] = e;
  } catch (err) {
    alert('AI 다듬기 실패: ' + (err.message || err));
  } finally { jrAiBusy.delete(date); render(); }
}

function jrDayCard(date, a, entry, live) {
  entry = entry || {};
  const memo = entry.memo, aiText = entry.ai;
  const dowName = ['일', '월', '화', '수', '목', '금', '토'][new Date(date + 'T00:00:00').getDay()];
  const chips = [];
  if (a) {
    if (a.done.length) chips.push(`<span class="prop-chip">✅ 완수 ${a.done.length}</span>`);
    if (a.big3.length) chips.push(`<span class="prop-chip">🎯 Big3 ${a.big3.filter(b => b.done).length}/${a.big3.length}</span>`);
    if (a.planH || a.actualH) {
      const diff = Math.round((a.actualH - a.planH) * 100) / 100;
      chips.push(`<span class="prop-chip">⏱ 계획 ${a.planH}h${a.actualH ? ` → 실제 ${a.actualH}h (${diff > 0 ? '+' : ''}${diff}h)` : ''}</span>`);
    }
    if (a.notes.length) chips.push(`<span class="prop-chip">📝 기록 ${a.notes.length}</span>`);
    if (a.created) chips.push(`<span class="prop-chip">➕ 등록 ${a.created}</span>`);
  }
  const busy = jrAiBusy.has(date);
  let bodyHtml, actions = '';
  if (busy) {
    bodyHtml = `<div class="jr-body jr-loading">✨ AI가 하루를 정리하는 중…</div>`;
  } else if (aiText) {
    bodyHtml = `<div class="jr-body jr-rich jr-ai">${jrRichText(aiText)}</div>`;
    actions = `<button class="jr-mini" data-action="jr-ai" data-date="${date}" title="다시 생성">↺ 다시</button>
      <button class="jr-mini" data-action="jr-ai-clear" data-date="${date}" title="기본 요약으로">기본</button>`;
  } else if (a) {
    bodyHtml = `<div class="jr-body jr-rich">${jrRichText(journalMarkdown(a))}</div>`;
    actions = `<button class="jr-mini" data-action="jr-ai" data-date="${date}" title="Gemini로 자연스럽게 다듬기">✨ AI로 다듬기</button>`;
  } else {
    bodyHtml = `<div class="empty">${live ? '아직 오늘 활동이 없어요 — 완수·타임박스·기록이 자동으로 쌓입니다' : '기록 없음'}</div>`;
  }
  return `<section class="jr-day ${live ? 'live' : ''}">
    <div class="jr-head"><span class="jr-date">${fmtDate(date)} (${dowName})</span>${live ? '<span class="jr-live">오늘 · 실시간</span>' : ''}<div class="jr-chips">${chips.join('')}</div></div>
    ${bodyHtml}
    ${actions ? `<div class="jr-actions">${actions}</div>` : ''}
    <div class="jr-memo" data-action="jr-memo" data-date="${date}" title="클릭해서 회고 쓰기">${memo ? `💭 ${esc(memo)}` : '<span class="jr-memo-ph">💭 클릭해 한 줄 회고 남기기</span>'}</div>
  </section>`;
}
// 주간 요약: 월요일 시작 주의 일지들을 합산
function jrWeekSummary(mondayStr, entries) {
  let done = 0, plan = 0, actual = 0, notes = 0, b3done = 0, b3tot = 0, memos = 0;
  const byProj = {};
  entries.forEach(({ a, entry }) => {
    if (!a) return;
    (a.done || []).forEach(d => { done++; const k = d.proj || '미분류'; byProj[k] = (byProj[k] || 0) + 1; });
    plan += a.planH || 0; actual += a.actualH || 0;
    notes += (a.notes || []).length;
    (a.big3 || []).forEach(b => { b3tot++; if (b.done) b3done++; });
    if (entry && entry.memo) memos++;
  });
  if (!done && !b3tot && !notes) return '';
  const end = new Date(mondayStr + 'T00:00:00'); end.setDate(end.getDate() + 6);
  const top = Object.entries(byProj).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const maxV = top.length ? top[0][1] : 1;
  const bars = top.map(([n, v]) => `<div class="jw-row"><span class="jw-n">${esc(n)}</span>
      <span class="jw-bar"><i style="width:${Math.round(v / maxV * 100)}%"></i></span><span class="jw-v">${v}</span></div>`).join('');
  const diff = Math.round((actual - plan) * 10) / 10;
  return `<div class="jr-week">
    <div class="jw-head">📊 주간 요약 <span class="jw-range">${fmtDate(mondayStr)} ~ ${fmtDate(dstr(end))}</span></div>
    <div class="jw-kpis">
      <span class="jw-kpi"><b>${done}</b>완수</span>
      ${b3tot ? `<span class="jw-kpi"><b>${b3done}/${b3tot}</b> Big3</span>` : ''}
      ${(plan || actual) ? `<span class="jw-kpi"><b>${actual}h</b> 실제<i class="jw-diff ${diff > 0 ? 'over' : diff < 0 ? 'under' : ''}">${plan ? `계획 ${plan}h${diff ? (diff > 0 ? ` · +${diff}` : ` · ${diff}`) : ''}` : ''}</i></span>` : ''}
      ${notes ? `<span class="jw-kpi"><b>${notes}</b>기록</span>` : ''}
      ${memos ? `<span class="jw-kpi"><b>${memos}</b>회고</span>` : ''}
    </div>
    ${bars ? `<div class="jw-bars">${bars}</div>` : ''}
  </div>`;
}
function renderJournal() {
  journalFreeze();   // 열 때 과거 확정 (render 끝의 save()가 영속화)
  const today = todayStr();
  const limit = state.sel.jrLimit || 30;
  const pastDates = Object.keys(state.journal || {})
    .filter(d => d < today && (state.journal[d].auto || state.journal[d].memo))
    .sort().reverse();
  const shown = pastDates.slice(0, limit);
  let feed = '', lastMonth = null;
  const pushMonth = date => {
    const m = date.slice(0, 7);
    if (m !== lastMonth) { lastMonth = m; const [yy, mm] = m.split('-'); feed += `<div class="note-group-h">${yy}년 ${Number(mm)}월</div>`; }
  };
  const monOf = d => { const t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return dstr(t); };
  const weekBuf = [];   // 같은 주의 일지를 모아 주가 바뀔 때 요약 카드 삽입
  let curWeek = null;
  const flushWeek = () => { if (curWeek && weekBuf.length) feed += jrWeekSummary(curWeek, weekBuf.splice(0)); weekBuf.length = 0; };
  pushMonth(today);
  feed += jrDayCard(today, journalDerive(today), state.journal[today], true);
  curWeek = monOf(today);
  weekBuf.push({ a: journalDerive(today), entry: state.journal[today] });
  shown.forEach(d => {
    const w = monOf(d);
    if (w !== curWeek) { flushWeek(); curWeek = w; }
    pushMonth(d);
    feed += jrDayCard(d, state.journal[d].auto, state.journal[d], false);
    weekBuf.push({ a: state.journal[d].auto, entry: state.journal[d] });
  });
  flushWeek();
  const moreBtn = pastDates.length > limit ? `<button class="pill jr-more" data-action="jr-more">+ 이전 일지 더 보기 (${pastDates.length - limit}일)</button>` : '';
  const keyBtn = `<button class="jr-mini jr-key-btn" data-action="jr-key">🔑 AI 키 ${geminiKey() ? '✓' : '설정'}</button>`;
  return `<div class="journal">
    ${journalSeg('journal')}
    <div class="jr-intro">📔 완수한 To-do·타임박스·기록을 토대로 하루가 자동 정리됩니다. 지난 날짜는 확정 저장되어 원본을 지워도 남아요.${keyBtn}</div>
    ${feed}${moreBtn}
  </div>`;
}
function openJrKeyModal() {
  const cur = geminiKey();
  const masked = cur ? cur.slice(0, 4) + '••••••••' + cur.slice(-4) : '';
  showModal(`
    <h3>🔑 Gemini AI 키</h3>
    <p class="restore-note">일지 'AI로 다듬기'에 쓰이는 무료 키입니다. <b>본인 계정 클라우드에 저장</b>되어 로그인된 모든 기기에서 자동으로 쓰여요. (공개 코드에는 저장되지 않음)<br>키 발급: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> (무료)</p>
    ${cur ? `<p class="restore-note">현재 등록됨: <code>${esc(masked)}</code></p>` : ''}
    <label>API 키<input type="text" id="m-gkey" placeholder="AIza…" value="" autocomplete="off"></label>
    <div class="m-actions">
      ${cur ? `<button class="danger" data-action="jr-key-del">삭제</button>` : ''}
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="jr-key-save">저장</button>
    </div>`);
}
function openJrMemoModal(date) {
  const cur = ((state.journal || {})[date] || {}).memo || '';
  showModal(`
    <h3>💭 회고 — ${fmtDate(date)}</h3>
    <label>하루를 한 줄로<textarea id="m-jrmemo" rows="4" placeholder="예: 실사 준비로 하루가 다 갔다. 내일은 조서 정리 먼저.">${esc(cur)}</textarea></label>
    <div class="m-actions">
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="jr-memo-save" data-date="${date}">저장</button>
    </div>`);
}

/* ---------- dev log (admin only) ---------- */
function renderDevlog() {
  const dl = state.devlog || { done: [], future: [] };
  const done = (dl.done || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const future = dl.future || [];
  const doneItem = e => `<li class="dl-item" data-action="dl-edit-done" data-id="${e.id}">
      <span class="dl-date">${e.date || ''}</span>
      <div class="dl-body"><div class="dl-title">${esc(e.title)}</div>${e.desc ? `<div class="dl-desc">${esc(e.desc)}</div>` : ''}</div>
    </li>`;
  const futureItem = e => `<li class="dl-item" data-action="dl-edit-future" data-id="${e.id}">
      <div class="dl-body"><div class="dl-title">${esc(e.title)}</div>${e.desc ? `<div class="dl-desc">${esc(e.desc)}</div>` : ''}</div>
    </li>`;
  return `<div class="devlog">
    ${journalSeg('devlog')}
    <p class="dl-note"><i class="lock">🔒</i> 관리자(${ADMIN_EMAIL}) 전용 — 다른 사용자에게는 이 탭이 보이지 않습니다.</p>
    <section>
      <div class="dl-head"><h2>완료된 개발 <span class="cnt">${done.length}</span></h2><button class="pill" data-action="dl-add-done">+ 이력 추가</button></div>
      <ol class="dl-list">${done.map(doneItem).join('') || '<li class="empty">아직 없음</li>'}</ol>
    </section>
    <section>
      <div class="dl-head"><h2>향후 개발 계획 <span class="cnt">${future.length}</span></h2><button class="pill" data-action="dl-add-future">+ 계획 추가</button></div>
      <ol class="dl-list">${future.map(futureItem).join('') || '<li class="empty">여기에 앞으로 개발할 내용을 추가하세요</li>'}</ol>
    </section>
  </div>`;
}
function openDevlogModal(kind, id) {
  const dl = state.devlog || { done: [], future: [] };
  const e = id ? (dl[kind] || []).find(x => x.id === id) : null;
  const isDone = kind === 'done';
  showModal(`
    <h3>${e ? '수정' : '추가'} — ${isDone ? '개발 이력' : '향후 계획'}</h3>
    ${isDone ? `<label>날짜<input type="date" id="dl-date" value="${e ? (e.date || '') : todayStr()}"></label>` : ''}
    <label>제목<input type="text" id="dl-title" value="${e ? esc(e.title) : ''}" placeholder="${isDone ? '예: 달력 탭 추가' : '예: 알림 기능 추가'}"></label>
    <label>설명 (선택)<input type="text" id="dl-desc" value="${e ? esc(e.desc || '') : ''}"></label>
    <div class="m-actions">
      ${e ? `<button class="danger" data-action="dl-del" data-kind="${kind}" data-id="${e.id}">삭제</button>` : ''}
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="dl-save" data-kind="${kind}" data-id="${e ? e.id : ''}">저장</button>
    </div>`);
}

/* ---------- 급한 일 알림 토스트 (우하단, 하루 1회) ---------- */
let alertsShown = false;
function maybeShowAlerts() {
  if (alertsShown) return;
  if (CLOUD && !boardLoaded) return;                      // 클라우드 데이터 수신 전에는 판단 보류
  const key = 'alerts-shown-' + todayStr();
  try { if (sessionStorage.getItem(key)) { alertsShown = true; return; } } catch (e) { }
  const today = todayStr();
  const over = state.cards.filter(c => c.status !== 'done' && c.due && c.due < today)
    .sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  const dueToday = state.cards.filter(c => c.status !== 'done' && c.due === today);
  const scheds = (state.schedules || []).filter(s => s.date && !schedIsStale(s))
    .filter(s => { const d = dday(s.date); return d <= 1; })                     // 지남(7일 내)~내일
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  alertsShown = true;
  if (!over.length && !dueToday.length && !scheds.length) return;
  try { sessionStorage.setItem(key, '1'); } catch (e) { }
  const projOf = c => { const b = c.project ? boardById(c.project) : null; const g = b && b.group ? groupById(b.group) : null; return g ? g.name : ''; };
  const cardRow = c => `<div class="at-row" data-action="alert-card" data-id="${c.id}">
      <span class="at-t">${esc(c.title)}</span>${projOf(c) ? `<span class="at-p">${esc(projOf(c))}</span>` : ''}${dueBadge(c.due)}</div>`;
  const schedRowT = s => { const g = s.group ? groupById(s.group) : null; return `<div class="at-row" data-action="alert-sched" data-id="${s.id}">
      <span class="at-t">📌 ${esc(s.title)}</span>${g ? `<span class="at-p">${esc(g.name)}</span>` : ''}${dueBadge(s.date)}</div>`; };
  const sec = (label, items, rowFn) => items.length
    ? `<div class="at-sec">${label} ${items.length}건</div>` + items.slice(0, 4).map(rowFn).join('')
      + (items.length > 4 ? `<div class="at-more">+${items.length - 4}건 더 — 대시보드에서 확인</div>` : '')
    : '';
  const el = document.createElement('div');
  el.className = 'alert-toast';
  el.innerHTML = `<div class="at-head">⏰ 챙길 일이 있어요<button class="at-x" data-action="alert-close" title="닫기">✕</button></div>
    ${sec('🔥 마감 지남', over, cardRow)}
    ${sec('📅 오늘 마감', dueToday, cardRow)}
    ${sec('📌 임박 일정', scheds, schedRowT)}`;
  document.body.appendChild(el);
}

/* ---------- 고정 헤더 ---------- */
// 헤더 높이를 CSS 변수로 노출 (기록 에디터 툴바가 헤더 아래에 붙도록) + 스크롤 시 그림자
function syncHeaderH() {
  const h = document.querySelector('header');
  if (h) document.documentElement.style.setProperty('--hdr-h', Math.round(h.getBoundingClientRect().height) + 'px');
}
if (typeof window !== 'undefined') {
  const onScroll = () => {
    const was = document.documentElement.classList.contains('scrolled');
    const now = window.scrollY > 4;
    if (was !== now) { document.documentElement.classList.toggle('scrolled', now); syncHeaderH(); }   // 헤더가 줄면 --hdr-h도 갱신(달력 고정바가 헤더에 딱 붙도록)
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', syncHeaderH);
}

/* ---------- render ---------- */
function render() {
  let view = state.sel.view || 'board';
  if (view === 'devlog' && !isAdmin()) view = 'board';
  captureNoteDraft();   // 에디터 작성 중 재렌더(원격 동기화 등) 시 초안 보존
  hideMapPop();         // 구조도 말풍선은 body에 붙어 있어 재렌더로 자동 제거되지 않음
  // 편집 중 포커스·커서 위치 기억 → 재렌더(원격 동기화 등)로 커서가 사라지지 않게 복원
  let caret = null;
  const ae = document.activeElement;
  if (ae && ae.id && ae.closest && ae.closest('.note-editor')) {
    caret = { id: ae.id };
    if (ae.isContentEditable) { caret.ce = true; caret.off = caretOffset(ae); }
    else if (typeof ae.selectionStart === 'number') { caret.start = ae.selectionStart; caret.end = ae.selectionEnd; }
  }
  // 개발일지만 일지 탭 안 세그먼트 → 나머지는 독립 헤더 버튼
  const navOwner = { devlog: 'journal' };
  const vbtn = (k, label) => `<button class="${(navOwner[view] || view) === k ? 'on' : ''}" data-action="view" data-view="${k}">${label}</button>`;
  const vsep = '<span class="vsep"></span>';
  const nav = vbtn('dash', '대시보드') + vbtn('cal', '달력') + vsep + vbtn('map', '구조도') + vbtn('tree', '트리') + vbtn('board', '프로젝트') + vbtn('tbox', '타임박스') + vbtn('notes', '기록') + vsep + vbtn('journal', '일지');
  document.getElementById('app').classList.toggle('wide', view === 'map' || view === 'tree');
  document.getElementById('app').innerHTML = `
    <header>
      <h1>업무 보드</h1>
      <nav class="views">${nav}</nav>
      <span class="week-count">이번 주 ${weekDone()}개 완료</span>
      <button class="theme-toggle" data-action="theme-toggle" title="${document.documentElement.dataset.theme === 'dark' ? '밝은 테마로 전환' : '어두운 테마로 전환'}">${document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙'}</button>
    </header>
    ${view === 'map' ? renderMap() : view === 'tree' ? renderTree() : view === 'cal' ? renderCal() : view === 'devlog' ? renderDevlog() : view === 'dash' ? renderDash() : view === 'notes' ? (noteEditing !== undefined ? renderNoteEditor() : renderNotes()) : view === 'journal' ? renderJournal() : view === 'tbox' ? renderTbox() : renderBoardView()}
    <footer>
      <button data-action="restore-open">🛟 백업·복원</button>
      <button data-action="trash-open">🗑 휴지통${(state.trash && state.trash.length) ? ' ' + state.trash.length : ''}</button>
      <button data-action="export">JSON 내보내기</button>
      <button data-action="import">가져오기</button>
      <button data-action="ics" title="Google Calendar에서 '설정 > 가져오기'로 등록">.ics 내보내기</button>
      <button data-action="samples">샘플 불러오기</button>
      ${CLOUD && authUser && GCAL_OK ? `<button data-action="gcal-sync" title="마감일 카드·프로젝트 기간을 구글 '업무 보드' 캘린더로 push">📅 구글 캘린더 동기화</button>` : ''}
      ${CLOUD && authUser ? `<span class="sync-badge" title="${esc(authUser.email || '')}">☁ 동기화 중</span><button data-action="logout">로그아웃</button>` : ''}
    </footer>`;
  save();
  if (caret) {   // 커서 복원 (원격 재렌더로도 커서 유지)
    const el = document.getElementById(caret.id);
    if (el) {
      el.focus();
      if (caret.ce) { try { setCaretOffset(el, caret.off); } catch (e) { } }
      else if (typeof caret.start === 'number') { try { el.setSelectionRange(caret.start, caret.end); } catch (e) { } }
    }
  }
  syncHeaderH();
  maybeShowAlerts();
  if (view === 'map') initMap();
  if (view === 'cal') markCalOverflow();
  if (view === 'notes') markNoteOverflow();
  if (view === 'board' && focusBoard) {
    const el = document.querySelector(`.board-panel[data-board="${focusBoard}"]`);
    focusBoard = null;
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500); }
  }
}

/* ---------- modal ---------- */
function showModal(inner) {
  closeModal();
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal">${inner}</div>`;
  ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });
  document.body.appendChild(ov);
  const first = ov.querySelector('input');
  if (first) first.focus();
}
function closeModal() { const ov = document.querySelector('.overlay'); if (ov) ov.remove(); }

function prioPicker(val) {
  return `<div class="prio-pick" id="m-prio" data-val="${val}">
    ${PRIO_ORDER.map(k => `<button type="button" class="swatch ${val === k ? 'sel' : ''}" data-prio="${k}" style="${PRIORITIES[k].bg ? `background:${PRIORITIES[k].bg};color:${PRIORITIES[k].fg}` : ''}">${PRIORITIES[k].label}</button>`).join('')}
  </div>`;
}
// 카드 모달의 보드 select — 선택된 프로젝트 소속 보드만(+미배정)
// 보드 선택지 라벨: 상위 보드(📚 묶음 포함) 경로를 앞에 붙여 어디 소속인지 보이게
function boardPathLabel(b) {
  const parts = [];
  const seen = new Set([b.id]);
  let cur = b.parent ? boardById(b.parent) : null;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.unshift((cur.folder ? '📚 ' : '') + cur.name);
    cur = cur.parent ? boardById(cur.parent) : null;
  }
  return parts.concat((b.folder ? '📚 ' : '') + b.name).join(' › ');
}
function cardBoardOptions(gid, curBid) {
  const opts = orderedBoardsIn(gid || null)
    .filter(({ board }) => !board.folder || board.id === curBid)   // 묶음 보드는 할 일 대상에서 제외(이미 속해 있으면 표시)
    .map(({ board }) => `<option value="${board.id}" ${curBid === board.id ? 'selected' : ''}>${esc(boardPathLabel(board))}</option>`);
  return `<option value="" ${!curBid ? 'selected' : ''}>📥 미배정</option>` + opts.join('');
}
function openCardModal(id) {
  const c = state.cards.find(x => x.id === id);
  if (!c) return;
  const cb = boardById(c.project);
  const gid = cb ? (cb.group || '') : '';
  showModal(`
    <h3>포스트잇 수정</h3>
    ${c.createdAt ? `<div class="reg-date">🗓 등록일 ${fmtDate(c.createdAt)}</div>` : ''}
    <label>내용<input type="text" id="m-title" value="${esc(c.title)}"></label>
    <div class="two">
      <label>프로젝트${groupOptions('m-cgroup', gid || null)}</label>
      <label>보드<select id="m-cboard">${cardBoardOptions(gid, c.project || '')}</select></label>
    </div>
    <label>중요도${prioPicker(c.priority || 'med')}</label>
    <label>💬 메모 · FU (별도로 확인·기억할 것)<textarea id="m-note" rows="3" placeholder="예: 팀장 리뷰 후 재확인 / 자료 요청 대기중">${esc(c.note || '')}</textarea></label>
    <label>마감일 (선택)<input type="date" id="m-due" value="${c.due || ''}"></label>
    ${c.due ? `<a class="gcal-link" href="${gcalUrl((boardById(c.project) ? boardById(c.project).name + ' - ' : '') + c.title, c.due, nextDay(c.due))}" target="_blank" rel="noopener">＋ Google Calendar에 등록 (${fmtDate(c.due)} 종일)</a>` : ''}
    ${c.fuCount ? `<p class="restore-note">↩ ${fuNum(c.fuCount)} 후속 진행 중${(c.fuHistory || []).length ? ` — ${(c.fuHistory || []).map((d, i) => `${i + 1}차 완수 ${fmtDate(d)}`).join(' · ')}` : ''}</p>` : ''}
    <div class="m-actions">
      <button class="danger" data-action="card-del" data-id="${c.id}">삭제</button>
      ${c.status === 'done' ? `<button class="ghost" data-action="card-fu" data-id="${c.id}" title="완수 이력을 남기고 다시 진행중으로">↩ FU (다시 진행)</button>` : ''}
      ${c.status !== 'done' && c.fuCount ? `<button class="ghost" data-action="card-fu-undo" data-id="${c.id}" title="FU를 취소하고 직전 완수 상태로 되돌립니다">⤺ FU 취소 (완수로 복귀)</button>` : ''}
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="card-save" data-id="${c.id}">저장</button>
    </div>`);
}
function openBoardModal(id) {
  const b = boardById(id);
  if (!b) return;
  const blocked = descendantsOf(id);
  const opts = ['<option value="">— 없음 (최상위) —</option>']
    .concat(state.projects.filter(x => !blocked.has(x.id)).map(x => `<option value="${x.id}" ${b.parent === x.id ? 'selected' : ''}>${esc(x.name)}</option>`));
  const only = state.projects.length <= 1;
  showModal(`
    <h3>보드 설정</h3>
    <label>이름<input type="text" id="m-title" value="${esc(b.name)}"></label>
    <label>프로젝트 (분류)${groupOptions('m-bgroup', b.group || null)}</label>
    <label>상위 보드<select id="m-parent">${opts.join('')}</select></label>
    <div class="two">
      <label>수행 시작일<input type="date" id="m-start" value="${b.start || ''}"></label>
      <label>수행 종료일<input type="date" id="m-end" value="${b.end || ''}"></label>
    </div>
    ${b.start && b.end ? `<a class="gcal-link" href="${gcalUrl('[기간] ' + b.name, b.start, nextDay(b.end))}" target="_blank" rel="noopener">＋ Google Calendar에 등록 (${fmtDate(b.start)}~${fmtDate(b.end)})</a>` : ''}
    <label class="folder-check" title="'별도'처럼 하위 보드를 묶는 분류용 보드 — 프로젝트 탭에서 칸반 없이 머리글로만 표시되고 보드 수·할 일 대상에서 빠집니다">
      <input type="checkbox" id="m-folder" ${b.folder ? 'checked' : ''}> 📚 묶음 보드 (할 일 없이 하위 보드를 묶는 용도)
    </label>
    ${b.folder && state.cards.some(c => c.project === b.id) ? `<p class="restore-note">⚠ 이 보드에 할 일 ${state.cards.filter(c => c.project === b.id).length}건이 남아 있어요 — 묶음 보드에서는 안 보이니 하위 보드로 옮겨주세요.</p>` : ''}
    ${b.done ? `<p class="restore-note">✅ 완료된 보드입니다${b.doneAt ? ` (완료 ${fmtDate(b.doneAt)})` : ''} — 구조도에서는 프로젝트 오른쪽 선반에 작게 모여 있어요.</p>` : ''}
    <div class="m-actions">
      ${only ? '' : `<button class="danger" data-action="board-del" data-id="${b.id}">보드 삭제</button>`}
      <button class="ghost" data-action="board-done" data-id="${b.id}" title="구조도에서 프로젝트 오른쪽 선반으로 모읍니다">${b.done ? '↩ 완료 취소' : '✅ 보드 완료'}</button>
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="board-save" data-id="${b.id}">저장</button>
    </div>`);
}
// 달력 날짜 클릭 → 할 일 / 일정 선택해서 추가 (일정 폼은 openSchedModal과 동일한 id·저장 액션 재사용)
function openCalAddModal(date, type, keepTitle) {
  const t = type || 'todo';
  const kt = esc(keepTitle || '');
  const seg = `<div class="seg">
      <button type="button" class="seg-btn ${t === 'todo' ? 'sel' : ''}" data-action="caladd-type" data-t="todo" data-date="${date}">✅ 할 일</button>
      <button type="button" class="seg-btn ${t === 'sched' ? 'sel' : ''}" data-action="caladd-type" data-t="sched" data-date="${date}">📌 일정</button>
    </div>`;
  if (t === 'sched') {
    showModal(`
      <h3>${fmtDate(date)} 추가</h3>
      ${seg}
      <label>내용<input type="text" id="m-stitle" value="${kt}" placeholder="예: 반기검토 보고서 제출 / 감사보고서 마감"></label>
      <div class="two">
        <label>마감일<input type="date" id="m-sdate" value="${date}"></label>
        <label title="입력하면 타임박스 해당 시간칸에 표시됩니다">시간 (선택)<input type="time" id="m-stime" value=""></label>
      </div>
      <label>프로젝트<select id="m-sgroup">
        ${(state.groups || []).map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}
        <option value="">미분류</option>
      </select></label>
      <label>메모 (선택)<input type="text" id="m-snote" placeholder="예: 팀장 검토 후 제출"></label>
      <div class="m-actions">
        <button class="ghost" data-action="modal-close">취소</button>
        <button class="primary" data-action="sched-save" data-id="">저장</button>
      </div>`);
    return;
  }
  const last = state.sel.lastBoard ? boardById(state.sel.lastBoard) : null;
  const gid = last ? (last.group || '') : '';
  showModal(`
    <h3>${fmtDate(date)} 추가</h3>
    ${seg}
    <label>내용<input type="text" id="m-title" value="${kt}" placeholder="예: 감사조서 리뷰"></label>
    <div class="two">
      <label>프로젝트${groupOptions('m-cgroup', gid || null)}</label>
      <label>보드<select id="m-cboard">${cardBoardOptions(gid, last ? last.id : '')}</select></label>
    </div>
    <label>중요도${prioPicker('med')}</label>
    <div class="m-actions">
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="caladd-save" data-date="${date}">추가</button>
    </div>`);
}
function openRestoreModal() {
  const src = (CLOUD && authUser) ? backupSnaps : localSnaps();
  const list = src.slice().reverse(); // newest first
  const fmt = ts => { try { return new Date(ts).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ts; } };
  const rows = list.map(s => `<div class="snap-row">
      <div><div class="snap-ts">${fmt(s.ts)}</div><div class="snap-sum">${snapSummary(s.state)}</div></div>
      <button class="ghost" data-action="restore-apply" data-ts="${s.ts}">복원</button>
    </div>`).join('') || '<div class="empty">아직 백업이 없어요. 잠시 사용하면 자동으로 쌓입니다.</div>';
  showModal(`
    <h3>백업 · 복원</h3>
    <p class="restore-note">변경 시 자동으로 백업됩니다(최근 ${SNAP_MAX}개, 클라우드+기기 이중 보관). 특정 시점으로 되돌리거나 지금 즉시 백업할 수 있어요.</p>
    <div class="snap-list">${rows}</div>
    <div class="m-actions">
      <button class="ghost" data-action="backup-now">지금 백업</button>
      <button class="ghost" data-action="export">JSON 파일로</button>
      <button class="primary" data-action="modal-close">닫기</button>
    </div>`);
}
function openTrashModal() {
  const list = (state.trash || []).slice().reverse();   // 최신 먼저
  const fmt = ts => { try { return new Date(ts).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ts; } };
  const KIND = { card: ['🗒', '할 일'], board: ['🗂', '보드'], schedule: ['📌', '일정'], note: ['📝', '기록'] };
  const label = t => t.kind === 'card' ? t.card.title
    : t.kind === 'board' ? `${t.board.name}${t.cards && t.cards.length ? ` (+카드 ${t.cards.length})` : ''}`
    : t.kind === 'schedule' ? t.sched.title : t.note.title;
  const rows = list.map(t => `<div class="snap-row">
      <div><div class="snap-ts">${KIND[t.kind][0]} ${esc(label(t))}</div><div class="snap-sum">${KIND[t.kind][1]} · ${fmt(t.deletedAt)} 삭제</div></div>
      <div class="trash-btns">
        <button class="ghost" data-action="trash-restore" data-id="${t.id}">복원</button>
        <button class="ghost trash-x" data-action="trash-purge" data-id="${t.id}" title="완전 삭제">✕</button>
      </div>
    </div>`).join('') || '<div class="empty">휴지통이 비어 있어요. 삭제한 할 일·보드·일정·기록이 여기 보관됩니다.</div>';
  showModal(`
    <h3>🗑 휴지통</h3>
    <p class="restore-note">삭제된 항목을 최근 ${TRASH_MAX}개·${TRASH_DAYS}일까지 보관합니다. 복원하면 원래 자리로 돌아가요.</p>
    <div class="snap-list">${rows}</div>
    <div class="m-actions">
      ${list.length ? '<button class="danger" data-action="trash-empty">휴지통 비우기</button>' : ''}
      <button class="primary" data-action="modal-close">닫기</button>
    </div>`);
}
function restoreFromTrash(t) {
  if (t.kind === 'card') {
    const c = t.card;
    if (c.project && !boardById(c.project)) c.project = null;   // 보드가 사라졌으면 미배정으로
    state.cards.push(c);
  } else if (t.kind === 'board') {
    const b = t.board;
    if (b.group && !groupById(b.group)) b.group = null;
    if (b.parent && !boardById(b.parent)) b.parent = null;
    state.projects.push(b);
    (t.cards || []).forEach(c => { if (!state.cards.some(x => x.id === c.id)) state.cards.push(c); });
  } else if (t.kind === 'schedule') {
    const s = t.sched;
    if (s.group && !groupById(s.group)) s.group = '';
    state.schedules.push(s);
  } else if (t.kind === 'note') {
    const n = t.note;
    if (n.group && !groupById(n.group)) n.group = '';
    if (n.board && !boardById(n.board)) n.board = null;
    state.notes.push(n);
  }
}
function groupOptions(selId, cur) {
  const opts = ['<option value="">— 미분류 —</option>']
    .concat((state.groups || []).map(g => `<option value="${g.id}" ${cur === g.id ? 'selected' : ''}>${esc(g.name)}</option>`));
  return `<select id="${selId}">${opts.join('')}</select>`;
}
function openProjModal(preGroup, folder) {
  showModal(`
    <h3>${folder ? '묶음 보드 추가' : '보드 추가'}</h3>
    <label>이름<input type="text" id="m-title" placeholder="${folder ? '예: 별도 / 연결' : '예: Issue log / 결산 지원'}"></label>
    <label>프로젝트 (분류)${groupOptions('m-group', preGroup || null)}</label>
    ${folder ? `<p class="restore-note">📚 하위 보드를 묶는 분류용 보드입니다. 할 일은 담지 않고, 프로젝트 탭에서 머리글로만 표시돼요. (추가 후 보드 설정에서 상위 보드를 지정하면 그 아래로 들어갑니다)</p>` : ''}
    <div class="m-actions">
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="proj-save" ${folder ? 'data-folder="1"' : ''}>추가</button>
    </div>`);
}
function periodRowHtml(s, e) {
  return `<div class="period-row"><input type="date" class="p-start" value="${s || ''}"><span class="p-tilde">~</span><input type="date" class="p-end" value="${e || ''}" ${s ? `min="${nextDay(s)}"` : ''}><button type="button" class="period-del" data-action="period-del" title="이 기간 삭제">✕</button></div>`;
}
function openGroupModal(id) {
  const g = id ? groupById(id) : null;
  const periods = (g && g.periods) ? g.periods : [];
  showModal(`
    <h3>${g ? '프로젝트 설정' : '프로젝트 추가'}</h3>
    <p class="restore-note">프로젝트는 보드를 묶는 분류 폴더예요 (To-do 없음). 여러 수행기간을 넣으면 달력에 표시됩니다.</p>
    <label>이름<input type="text" id="m-title" value="${g ? esc(g.name) : ''}" placeholder="예: AK18호 / 하림지주"></label>
    <div class="periods-lbl">수행기간 (여러 개 가능 — 예: 이번 주 5일 + 다다음 주 5일)</div>
    <div id="m-periods">${periods.map(p => periodRowHtml(p.start, p.end)).join('')}</div>
    <button type="button" class="ghost addperiod" data-action="period-add">+ 기간 추가</button>
    <div class="m-actions">
      ${g ? `<button class="danger" data-action="group-del" data-id="${g.id}">삭제</button>` : ''}
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="group-save" data-id="${g ? g.id : ''}">저장</button>
    </div>`);
}

/* ---------- ics export & samples ---------- */
function icsEsc(s) { return String(s).replace(/[\\;,]/g, m => '\\' + m); }
function icsExport() {
  const f = x => x.replace(/-/g, '');
  const ev = [];
  state.cards.filter(c => c.due).forEach(c => {
    const b = boardById(c.project);
    ev.push(`BEGIN:VEVENT\r\nUID:${c.id}@work-board\r\nDTSTART;VALUE=DATE:${f(c.due)}\r\nDTEND;VALUE=DATE:${f(nextDay(c.due))}\r\nSUMMARY:${icsEsc((b ? b.name + ' - ' : '') + c.title)}\r\nEND:VEVENT`);
  });
  state.projects.filter(b => b.start && b.end).forEach(b => {
    ev.push(`BEGIN:VEVENT\r\nUID:${b.id}@work-board\r\nDTSTART;VALUE=DATE:${f(b.start)}\r\nDTEND;VALUE=DATE:${f(nextDay(b.end))}\r\nSUMMARY:${icsEsc('[기간] ' + b.name)}\r\nEND:VEVENT`);
  });
  if (!ev.length) { alert('마감일 있는 카드나 기간 있는 보드가 없어 내보낼 일정이 없습니다.'); return; }
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//work-board//KR\r\n${ev.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = `work-board-${todayStr()}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function loadSamples() {
  const t = new Date();
  const d = off => { const x = new Date(t); x.setDate(t.getDate() + off); return dstr(x); };
  const nb = state.projects.length;
  const mkBoard = (name, color, start, end, i) => {
    const b = { id: 'p-' + uid(), name, color, parent: null, x: 30 + ((nb + i) % 4) * 180, y: 30 + Math.floor((nb + i) / 4) * 120, start: start || null, end: end || null };
    state.projects.push(b); return b.id;
  };
  const mkCard = (project, title, priority, due, status, doneOff) => {
    state.cards.push({ id: uid(), project, title, status: status || 'todo', priority, due: due || null, doneAt: status === 'done' ? d(doneOff ?? -1) : null, note: null, createdAt: todayStr() });
  };
  const audit = mkBoard('외부감사 (A사)', 'coral', d(-10), d(50), 0);
  mkCard(audit, '사전 위험평가·감사계획 수립', 'high', d(-3), 'done', -4);
  mkCard(audit, '중간감사 내부통제 테스트', 'high', d(7), 'doing');
  mkCard(audit, '기말 재고실사 입회 계획 수립', 'med', d(20));
  mkCard(audit, '감사조서 작성·리뷰', 'med', d(35));
  mkCard(audit, '감사보고서 초안 작성', 'high', d(45));
  const icfr = mkBoard('내부회계 감사 (B사)', 'teal', d(0), d(40), 1);
  mkCard(icfr, '설계평가(D&I) 테스트', 'med', d(10));
  mkCard(icfr, '운영평가(TOE) 표본 테스트', 'high', d(21));
  mkCard(icfr, '미비점 종합 평가', 'med', d(30));
  mkCard(icfr, 'ICFR 감사보고서 발행', 'high', d(38));
  const adv = mkBoard('회계 용역', 'purple', null, null, 2);
  mkCard(adv, '반기 결산 지원', 'med', d(14));
  mkCard(adv, '회계이슈 검토보고서 작성', 'med', d(9), 'doing');
  mkCard(adv, '밸류에이션 검토', 'low', d(25));
  const work = state.projects.find(p => p.name === '회사 업무') || state.projects[0];
  if (work) {
    const fri = (5 - t.getDay() + 7) % 7 || 7;
    mkCard(work.id, '주간 업무보고 작성', 'med', d(fri));
    mkCard(work.id, '타임시트 입력', 'low', d(1));
    mkCard(work.id, '보수교육 이수', 'low', d(28));
    mkCard(work.id, '품질관리 셀프리뷰', 'med', null);
  }
  render();
}

/* ---------- actions ---------- */
function moveCard(id, status, boardId) {
  const c = state.cards.find(x => x.id === id);
  if (!c) return;
  if (boardId) c.project = boardId;
  if (c.status !== status) { c.status = status; c.doneAt = status === 'done' ? todayStr() : null; }
  render();
}

document.addEventListener('click', e => {
  if (e.target.closest('.tb-actual-input')) return;
  const sw = e.target.closest('.swatch');
  if (sw) {
    const box = document.getElementById('m-prio');
    box.dataset.val = sw.dataset.prio;
    box.querySelectorAll('.swatch').forEach(x => x.classList.toggle('sel', x === sw));
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const act = el.dataset.action;
  if (act === 'login') { doAuth('login'); }
  else if (act === 'google-login') {
    firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider())
      .catch(err => { const m = document.getElementById('g-msg'); if (m) m.textContent = authErr(err); });
  }
  else if (act === 'signup') { doAuth('signup'); }
  else if (act === 'logout') { if (window.firebase) firebase.auth().signOut(); }
  else if (act === 'view') { state.sel.view = el.dataset.view; render(); }
  else if (act === 'map-arrange') { autoLayout(); render(); }
  else if (act === 'kpi-go') {
    const sec = document.getElementById(el.dataset.target);
    if (sec) { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); sec.classList.add('flash'); setTimeout(() => sec.classList.remove('flash'), 1500); }
  }
  else if (act === 'done-week-prev') { state.sel.doneWeekOffset = (state.sel.doneWeekOffset || 0) - 1; render(); }
  else if (act === 'done-week-next') { state.sel.doneWeekOffset = (state.sel.doneWeekOffset || 0) + 1; render(); }
  else if (act === 'done-week-today') { state.sel.doneWeekOffset = 0; render(); }
  else if (act === 'cal-prev') calShift(-1);
  else if (act === 'cal-next') calShift(1);
  else if (act === 'cal-today') { state.sel.calYm = todayStr().slice(0, 7); render(); }
  else if (act === 'cal-add') openCalAddModal(el.dataset.date);
  else if (act === 'caladd-type') {
    // 탭 전환 시 입력 중이던 제목은 이어받음(모달을 다시 그리므로)
    const cur = document.getElementById('m-title') || document.getElementById('m-stitle');
    openCalAddModal(el.dataset.date, el.dataset.t, cur ? cur.value : '');
  }
  else if (act === 'caladd-save') {
    const t = document.getElementById('m-title').value.trim();
    if (t) {
      const board = document.getElementById('m-cboard').value || null;
      if (board) state.sel.lastBoard = board;
      state.cards.push({ id: uid(), project: board, title: t, status: 'todo', priority: document.getElementById('m-prio').dataset.val || 'med', due: el.dataset.date, doneAt: null, note: null, createdAt: todayStr() });
    }
    closeModal(); render();
  }
  else if (act === 'gcal-sync') syncGCal();
  else if (act === 'ics') icsExport();
  else if (act === 'samples') { if (confirm('회계 업무 샘플 보드 3개와 카드들을 추가할까요? (기존 데이터는 유지)')) loadSamples(); }
  else if (act === 'proj-add') openProjModal(el.dataset.group || null);
  else if (act === 'folder-add') openProjModal(el.dataset.group || null, true);
  else if (act === 'group-add') openGroupModal();
  else if (act === 'group-edit') openGroupModal(el.dataset.id);
  else if (act === 'period-add') { const box = document.getElementById('m-periods'); box.insertAdjacentHTML('beforeend', periodRowHtml('', '')); }
  else if (act === 'period-del') { el.closest('.period-row').remove(); }
  else if (act === 'group-save') {
    const t = document.getElementById('m-title').value.trim();
    if (t) {
      const periods = [...document.querySelectorAll('#m-periods .period-row')]
        .map(r => ({ start: r.querySelector('.p-start').value || null, end: r.querySelector('.p-end').value || null }))
        .filter(p => p.start && p.end && p.start <= p.end);
      const g = el.dataset.id ? groupById(el.dataset.id) : null;
      if (g) { g.name = t; g.periods = periods; }
      else state.groups.push({ id: 'g-' + uid(), name: t, color: RAMP[state.groups.length % RAMP.length], periods });
    }
    closeModal(); render();
  }
  else if (act === 'sched-add') openSchedModal(null, el.dataset.group || '');
  else if (act === 'sched-edit') openSchedModal(el.dataset.id);
  else if (act === 'sched-save') {
    const t = document.getElementById('m-stitle').value.trim();
    const date = document.getElementById('m-sdate').value || null;
    if (t && date) {
      const grp = document.getElementById('m-sgroup').value;
      const time = document.getElementById('m-stime').value || null;
      const note = document.getElementById('m-snote').value.trim() || null;
      const s = el.dataset.id ? schedById(el.dataset.id) : null;
      if (s) { s.title = t; s.date = date; s.time = time; s.group = grp; s.note = note; }
      else state.schedules.push({ id: 's-' + uid(), group: grp, title: t, date, time, done: false, doneAt: null, note });
    }
    closeModal(); render();
  }
  else if (act === 'sched-del') {
    const victim = schedById(el.dataset.id);
    if (victim) toTrash('schedule', { sched: JSON.parse(JSON.stringify(victim)) });
    state.schedules = state.schedules.filter(s => s.id !== el.dataset.id);
    closeModal(); render();
  }
  else if (act === 'tbox-prev') tbShift(-1);
  else if (act === 'tbox-next') tbShift(1);
  else if (act === 'tbox-today') { state.sel.tboxDate = todayStr(); tbSel = null; render(); }
  else if (act === 'tb-select') { const i = +el.dataset.idx; tbSel = tbSel === i ? null : i; render(); }
  else if (act === 'tb-check') {
    const i = +el.dataset.idx;
    const d = tbData(state.sel.tboxDate || todayStr());
    const b = d.big3[i];
    if (b) {
      b.done = el.checked;
      const c = state.cards.find(x => x.id === b.cardId);
      if (c) {
        // 체크 해제 시 원래 상태로 복귀(FU로 진행중이던 카드가 '예정'으로 떨어지지 않게)
        if (b.done) { c.prevStatus = c.status === 'done' ? (c.prevStatus || 'todo') : c.status; c.status = 'done'; c.doneAt = todayStr(); }
        else { c.status = c.prevStatus || 'todo'; c.doneAt = null; }
        // 같은 카드가 담긴 모든 날짜의 Big3 완수 표시를 동기화(미래 계획 포함)
        Object.values(state.timebox || {}).forEach(day => (day.big3 || []).forEach(x => { if (x && x.cardId === c.id) x.done = b.done; }));
      }
    }
    render();
  }
  else if (act === 'tb-remove') {
    const i = +el.dataset.idx;
    const d = tbData(state.sel.tboxDate || todayStr());
    d.big3[i] = null;
    Object.keys(d.slots).forEach(k => { if (d.slots[k] === i) delete d.slots[k]; });
    if (tbSel === i) tbSel = null;
    while (d.big3.length > 3 && d.big3[d.big3.length - 1] == null) d.big3.pop();   // 뒤쪽 빈 슬롯 정리
    render();
  }
  else if (act === 'tb-add') {
    const d = tbData(state.sel.tboxDate || todayStr());
    d.big3.push(null);   // 빈 우선순위 슬롯 추가 → Brain Dump에서 드래그
    render();
  }
  else if (act === 'dash-big3-go') { state.sel.view = 'tbox'; state.sel.tboxDate = todayStr(); render(); }
  else if (act === 'dash-week-go') { state.sel.view = 'cal'; state.sel.calYm = todayStr().slice(0, 7); render(); }
  else if (act === 'theme-toggle') {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('board-theme', next); } catch (e) { }
    render();
  }
  else if (act === 'jr-memo') openJrMemoModal(el.dataset.date);
  else if (act === 'jr-memo-save') {
    const v = document.getElementById('m-jrmemo').value.trim();
    state.journal = state.journal || {};
    const je = state.journal[el.dataset.date] || {};
    if (v) je.memo = v; else delete je.memo;
    if (je.memo || je.auto) state.journal[el.dataset.date] = je; else delete state.journal[el.dataset.date];
    closeModal(); render();
  }
  else if (act === 'jr-more') { state.sel.jrLimit = (state.sel.jrLimit || 30) + 30; render(); }
  else if (act === 'jr-key') openJrKeyModal();
  else if (act === 'jr-key-save') {
    const v = document.getElementById('m-gkey').value.trim();
    if (v) { saveGeminiKey(v); closeModal(); render(); }
    else closeModal();
  }
  else if (act === 'jr-key-del') { saveGeminiKey(''); closeModal(); render(); }
  else if (act === 'jr-ai') runJrAi(el.dataset.date);
  else if (act === 'jr-ai-clear') {
    const d = el.dataset.date, e = (state.journal || {})[d];
    if (e) { delete e.ai; if (!e.memo && !e.auto) delete state.journal[d]; }
    render();
  }
  else if (act === 'note-group') {
    const gid = el.dataset.gid;
    state.sel.noteGroup = gid; state.sel.noteBoard = '';
    if (gid !== '__all') openSideGroups.has(gid) ? openSideGroups.delete(gid) : openSideGroups.add(gid);   // 선택 + 보드 펼침 토글(누적)
    render();
  }
  else if (act === 'note-type') { state.sel.noteType = el.dataset.t; render(); }
  else if (act === 'note-pin') {
    const n = (state.notes || []).find(x => x.id === el.dataset.id);
    if (n) { n.pinned = !n.pinned; render(); }
  }
  else if (act === 'note-expand') {
    const body = el.previousElementSibling;
    const open = body.classList.toggle('clamp');   // clamp 제거=펼침
    el.textContent = open ? '더보기 ▾' : '접기 ▴';
  }
  else if (act === 'note-add') { noteEditing = null; noteDraft = null; render(); const t = document.getElementById('m-ntitle'); if (t) t.focus(); }
  else if (act === 'note-edit') { noteEditing = el.dataset.id; noteDraft = null; render(); }
  else if (act === 'ne-cancel') { noteEditing = undefined; noteDraft = null; render(); }
  else if (act === 'note-board-nav') {
    if (el.dataset.gid !== undefined) state.sel.noteGroup = el.dataset.gid;   // 다른(펼쳐둔) 프로젝트의 보드를 눌러도 그 프로젝트로 전환
    state.sel.noteBoard = el.dataset.bid; render();
  }
  else if (act === 'lane-toggle') { const bid = el.dataset.board; openDoneLanes.has(bid) ? openDoneLanes.delete(bid) : openDoneLanes.add(bid); render(); }
  else if (act === 'arch-month') { state.sel.archMonth = el.dataset.m; render(); }
  else if (act === 'panel-toggle') {
    const k = el.dataset.k;
    openPanels.has(k) ? openPanels.delete(k) : openPanels.add(k);
    render();
  }
  else if (act === 'sched-past-toggle') { pastSchedOpen = !pastSchedOpen; render(); }
  // FU 취소: 직전 완수 상태로 복귀 (fuHistory 마지막 날짜 복원, 회차 -1)
  else if (act === 'card-fu-undo') {
    const c = state.cards.find(x => x.id === el.dataset.id);
    if (c && c.fuCount) {
      c.doneAt = (c.fuHistory && c.fuHistory.length) ? c.fuHistory.pop() : todayStr();
      c.status = 'done';
      c.fuCount = c.fuCount - 1 || undefined;
      if (c.fuHistory && !c.fuHistory.length) c.fuHistory = undefined;
      if (!c.fuCount) c.prevStatus = undefined;
    }
    closeModal(); render();
  }
  // FU: 완수된 카드를 다시 진행중으로 — 완수 이력을 남겨 '몇 차 후속인지' 표시
  else if (act === 'card-fu') {
    const c = state.cards.find(x => x.id === el.dataset.id);
    if (c) {
      c.fuCount = (c.fuCount || 0) + 1;
      if (c.doneAt) c.fuHistory = (c.fuHistory || []).concat([c.doneAt]);
      c.status = 'doing';
      c.doneAt = null;
      // 완료 처리된 보드에 다시 일이 생긴 것 → 그 보드의 완료도 자동 해제(구조도 선반에서 복귀)
      const b = boardById(c.project);
      if (b && b.done) { b.done = false; b.doneAt = null; }
    }
    closeModal(); render();
  }
  else if (act === 'note-todo') openNoteTodoModal(el.dataset.id);
  else if (act === 'ne-fmt') {   // 리치 서식 적용 (선택 영역에)
    const body = document.getElementById('m-nbody');
    if (body) {
      body.focus();
      try { document.execCommand('styleWithCSS', false, true); } catch (e) { }
      try { document.execCommand(el.dataset.cmd, false, el.dataset.arg || undefined); } catch (e) { }
      liveSaveNote();
    }
  }
  else if (act === 'note-save') {   // '완료' — 실시간 저장돼 있으므로 반영 후 목록으로
    liveSaveNote();
    noteEditing = undefined; noteDraft = null;
    closeModal(); render();
  }
  else if (act === 'note-del') {
    const victim = (state.notes || []).find(x => x.id === el.dataset.id);
    if (victim) toTrash('note', { note: JSON.parse(JSON.stringify(victim)) });
    state.notes = (state.notes || []).filter(x => x.id !== el.dataset.id);
    noteEditing = undefined; noteDraft = null;
    closeModal(); render();
  }
  else if (act === 'note-todo-save') {
    const t = document.getElementById('m-ttitle').value.trim();
    if (t) {
      const bsel = document.getElementById('m-tboard').value;
      const inbox = bsel === '__inbox';
      state.cards.push({ id: uid(), project: inbox ? null : bsel, title: t, status: 'todo', priority: document.getElementById('m-prio').dataset.val || 'med', due: inbox ? null : todayStr(), doneAt: null, note: null, createdAt: todayStr() });
    }
    closeModal(); render();
  }
  else if (act === 'overview-edit') openOverviewModal();
  else if (act === 'overview-save') {
    const v = document.getElementById('m-overview').value.trim();
    const gid = currentNoteGroup();
    const g = gid ? groupById(gid) : null;
    if (g) g.overview = v || null; else state.unGroupOverview = v || null;
    closeModal(); render();
  }
  else if (act === 'board-group') {
    const gid = el.dataset.gid;
    state.sel.boardGroup = gid;
    if (gid !== '__all') openSideGroups.has(gid) ? openSideGroups.delete(gid) : openSideGroups.add(gid);   // 프로젝트 클릭 = 선택 + 보드 펼침 토글(누적)
    render();
  }
  else if (act === 'side-toggle') { const gid = el.dataset.gid; openSideGroups.has(gid) ? openSideGroups.delete(gid) : openSideGroups.add(gid); render(); }
  else if (act === 'side-board') {
    const b = boardById(el.dataset.bid);
    if (b) { state.sel.boardGroup = b.group || ''; focusBoard = b.id; render(); }
  }
  else if (act === 'alert-close') { document.querySelector('.alert-toast')?.remove(); }
  else if (act === 'alert-card') openCardModal(el.dataset.id);
  else if (act === 'alert-sched') openSchedModal(el.dataset.id);
  else if (act === 'tree-group') { state.sel.treeGroup = el.dataset.gid; render(); }
  else if (act === 'tree-toggle') {
    const k = el.dataset.key;
    treeClosed.has(k) ? treeClosed.delete(k) : treeClosed.add(k);
    treeSeeded.add(k); render();
  }
  else if (act === 'tree-note') {
    const id = el.dataset.id;
    treeNoteOpen.has(id) ? treeNoteOpen.delete(id) : treeNoteOpen.add(id);
    render();
  }
  else if (act === 'tree-all') {
    const gid = treeGroupId();
    const boards = state.projects.filter(b => (b.group || '') === gid);
    const keys = ['c:' + gid, 's:' + gid].concat(boards.flatMap(b => ['b:' + b.id, 't:' + b.id, 'n:' + b.id, 'd:' + b.id]));
    if (el.dataset.v === 'open') { keys.forEach(k => { treeClosed.delete(k); treeSeeded.add(k); }); }
    else { treeClosed.clear(); treeNoteOpen.clear(); keys.filter(k => !k.startsWith('b:')).forEach(k => treeClosed.add(k)); }
    render();
  }
  else if (act === 'tree-gonote') {
    const n = (state.notes || []).find(x => x.id === el.dataset.id);
    if (n) { state.sel.view = 'notes'; state.sel.noteGroup = n.group || ''; state.sel.noteBoard = ''; noteEditing = n.id; noteDraft = null; render(); }
  }
  else if (act === 'tree-goboard') {
    const b = boardById(el.dataset.bid);
    if (b) { state.sel.boardGroup = b.group || ''; focusBoard = b.id; state.sel.view = 'board'; render(); }
  }
  else if (act === 'cal-type') {
    state.sel.calType = el.dataset.t || 'all';
    render();
  }
  else if (act === 'cal-filter') {
    const gid = el.dataset.gid;
    if (gid === '__all') state.sel.calFilter = [];
    else if (gid === '__none') state.sel.calFilter = ['__none__'];
    else {
      let f = (Array.isArray(state.sel.calFilter) ? state.sel.calFilter : []).filter(x => x !== '__none__');
      f.includes(gid) ? (f = f.filter(x => x !== gid)) : f.push(gid);
      state.sel.calFilter = f;
    }
    render();
  }
  else if (act === 'group-del') {
    const id = el.dataset.id;
    state.projects.forEach(b => { if (b.group === id) b.group = null; });
    state.groups = state.groups.filter(g => g.id !== id);
    closeModal(); render();
  }
  else if (act === 'board-edit') openBoardModal(el.dataset.id);
  else if (act === 'board-done') {
    const b = boardById(el.dataset.id);
    if (b) {
      if (b.done) { b.done = false; b.doneAt = null; }
      else { b.done = true; b.doneAt = todayStr(); }
    }
    closeModal(); render();
  }
  else if (act === 'card') openCardModal(el.dataset.id);
  else if (act === 'modal-close') closeModal();
  else if (act === 'unlink') { boardById(el.dataset.id).parent = null; render(); }
  else if (act === 'card-save') {
    const c = state.cards.find(x => x.id === el.dataset.id);
    if (c) {
      const t = document.getElementById('m-title').value.trim();
      if (t) c.title = t;
      c.priority = document.getElementById('m-prio').dataset.val || 'med';
      c.note = document.getElementById('m-note').value.trim() || null;
      c.due = document.getElementById('m-due').value || null;
      const bs = document.getElementById('m-cboard');
      if (bs) c.project = bs.value || null;   // 프로젝트·보드 이동 (빈 값 = 미배정)
    }
    closeModal(); render();
  }
  else if (act === 'card-del') {
    const victim = state.cards.find(x => x.id === el.dataset.id);
    if (victim) toTrash('card', { card: JSON.parse(JSON.stringify(victim)) });
    purgeTimeboxCards([el.dataset.id]);
    state.cards = state.cards.filter(x => x.id !== el.dataset.id);
    closeModal(); render();
  }
  else if (act === 'board-save') {
    const b = boardById(el.dataset.id);
    if (b) {
      const t = document.getElementById('m-title').value.trim();
      if (t) b.name = t;
      setGroupDeep(b.id, document.getElementById('m-bgroup').value || null);
      const par = document.getElementById('m-parent').value || null;
      if (par !== b.id && !isAncestor(b.id, par)) {
        if (par) setParent(b.id, par); else b.parent = null;
      }
      b.start = document.getElementById('m-start').value || null;
      b.end = document.getElementById('m-end').value || null;
      const fc = document.getElementById('m-folder');
      if (fc) b.folder = fc.checked || undefined;   // 묶음(분류용) 보드 플래그
    }
    closeModal(); render();
  }
  else if (act === 'board-del') {
    const id = el.dataset.id;
    const bd = boardById(id);
    if (bd) toTrash('board', { board: JSON.parse(JSON.stringify(bd)), cards: JSON.parse(JSON.stringify(state.cards.filter(c => c.project === id))) });
    state.projects.forEach(x => { if (x.parent === id) x.parent = bd.parent || null; });
    state.projects = state.projects.filter(x => x.id !== id);
    purgeTimeboxCards(state.cards.filter(c => c.project === id).map(c => c.id));   // Big3에서도 제거
    state.cards = state.cards.filter(c => c.project !== id);
    closeModal(); render();
  }
  else if (act === 'proj-save') {
    const t = document.getElementById('m-title').value.trim();
    if (t) {
      const i = state.projects.length;
      const grp = document.getElementById('m-group') ? (document.getElementById('m-group').value || null) : null;
      const nb = { id: 'p-' + uid(), name: t, color: RAMP[i % RAMP.length], parent: null, group: grp, x: 30 + (i % 4) * 180, y: 30 + Math.floor(i / 4) * 120 };
      if (el.dataset.folder) nb.folder = true;
      state.projects.push(nb);
    }
    closeModal(); render();
  }
  else if (act === 'mapadd-type') {
    const box = document.getElementById('m-addtype');
    box.dataset.val = el.dataset.t;
    box.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('sel', b === el));
    const hint = document.getElementById('m-addhint');
    if (hint) hint.innerHTML = mapAddHint(el.dataset.t, pendingMapPos && pendingMapPos.group ? groupById(pendingMapPos.group) : null);
  }
  else if (act === 'mapadd-save') {
    const t = document.getElementById('m-title').value.trim();
    const box = document.getElementById('m-addtype');
    const type = box ? box.dataset.val : 'board';
    if (t && pendingMapPos) {
      if (type === 'project') {
        state.groups.push({ id: 'g-' + uid(), name: t, color: RAMP[state.groups.length % RAMP.length], periods: [], mapX: pendingMapPos.rawX, mapY: pendingMapPos.rawY });
      } else {
        const i = state.projects.length;
        const nb = { id: 'p-' + uid(), name: t, color: RAMP[i % RAMP.length], parent: null, group: pendingMapPos.group || null, x: pendingMapPos.x, y: pendingMapPos.y };
        if (type === 'folder') nb.folder = true;
        state.projects.push(nb);
      }
    }
    pendingMapPos = null;
    closeModal(); render();
  }
  else if (act === 'dl-add-done') openDevlogModal('done');
  else if (act === 'dl-add-future') openDevlogModal('future');
  else if (act === 'dl-edit-done') openDevlogModal('done', el.dataset.id);
  else if (act === 'dl-edit-future') openDevlogModal('future', el.dataset.id);
  else if (act === 'dl-save') {
    const kind = el.dataset.kind;
    state.devlog = state.devlog || { done: [], future: [] };
    const list = state.devlog[kind];
    const title = document.getElementById('dl-title').value.trim();
    if (title) {
      const desc = document.getElementById('dl-desc').value.trim();
      const dateEl = document.getElementById('dl-date');
      const date = kind === 'done' ? (dateEl && dateEl.value || todayStr()) : undefined;
      const id = el.dataset.id;
      if (id) {
        const e = list.find(x => x.id === id);
        if (e) { e.title = title; e.desc = desc; if (kind === 'done') e.date = date; }
      } else {
        const e = { id: uid(), title, desc };
        if (kind === 'done') e.date = date;
        list.push(e);
      }
    }
    closeModal(); render();
  }
  else if (act === 'dl-del') {
    const kind = el.dataset.kind;
    if (state.devlog && state.devlog[kind]) state.devlog[kind] = state.devlog[kind].filter(x => x.id !== el.dataset.id);
    closeModal(); render();
  }
  else if (act === 'export') {
    const clean = JSON.parse(JSON.stringify(state));
    if (clean.settings) delete clean.settings.geminiKey;   // 공유 파일에 API 키 유출 방지
    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `board-export-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  else if (act === 'import') document.getElementById('import-file').click();
  else if (act === 'restore-open') openRestoreModal();
  else if (act === 'trash-open') openTrashModal();
  else if (act === 'trash-restore') {
    const t = (state.trash || []).find(x => x.id === el.dataset.id);
    if (t) { restoreFromTrash(t); state.trash = state.trash.filter(x => x.id !== t.id); }
    openTrashModal(); render();
  }
  else if (act === 'trash-purge') {
    state.trash = (state.trash || []).filter(x => x.id !== el.dataset.id);
    openTrashModal(); render();
  }
  else if (act === 'trash-empty') {
    if (confirm('휴지통을 비울까요? 보관된 항목은 더 이상 복원할 수 없습니다.')) { state.trash = []; openTrashModal(); render(); }
  }
  else if (act === 'backup-now') { pushSnapshot(true); openRestoreModal(); }
  else if (act === 'restore-apply') {
    const ts = el.dataset.ts;
    const src = (CLOUD && authUser) ? backupSnaps : localSnaps();
    const snap = src.find(s => s.ts === ts);
    if (snap && confirm('이 시점 상태로 되돌릴까요?\n(현재 상태도 백업에 남아 다시 되돌릴 수 있어요)')) {
      pushSnapshot(true);                       // 현재 상태 먼저 백업
      state = JSON.parse(JSON.stringify(snap.state));
      normalizeState();                          // 구버전 스냅샷(누락 필드) 정규화 — 복원 후 크래시 방지
      lastSnapHash = '';                         // 복원 결과도 곧 백업되도록
      closeModal(); render();
    }
  }
});

document.getElementById('import-file').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  f.text().then(txt => {
    const data = JSON.parse(txt);
    if (!data.projects || !data.cards) throw new Error('bad file');
    if (confirm('현재 보드를 가져온 파일로 완전히 교체할까요?')) { state = data; normalizeState(); lastSnapHash = ''; render(); }
  }).catch(() => alert('올바른 보드 JSON 파일이 아닙니다.'));
  e.target.value = '';
});

// 모달 키보드: 입력창에서 Enter=저장(기본 버튼), Esc=닫기 (textarea·검색창 제외)
document.addEventListener('keydown', e => {
  const ov = document.querySelector('.overlay');
  if (!ov) return;
  if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'search') {
    const primary = ov.querySelector('.m-actions .primary[data-action]');
    if (primary) { e.preventDefault(); primary.click(); }
  }
});
document.addEventListener('submit', e => {
  if (e.target.closest('.gateform')) { e.preventDefault(); doAuth('login'); return; }
  const form = e.target.closest('.quick');
  if (!form) return;
  e.preventDefault();
  const input = form.querySelector('input');
  const t = input.value.trim();
  if (!t) return;
  const inbox = form.dataset.project === '__inbox';
  state.cards.push({ id: uid(), project: inbox ? null : form.dataset.project, title: t, status: 'todo', priority: 'med', due: inbox ? null : todayStr(), doneAt: null, note: null, createdAt: todayStr() });
  render();
  const again = inbox ? document.querySelector('.quick[data-project="__inbox"] input') : document.querySelector(`.board-panel[data-board="${form.dataset.project}"] .quick input`);
  if (again) again.focus();
});

/* ---------- drag & drop: cards(columns) + boards(순서/계층) + 달력 칩(날짜) ---------- */
let dragItem = null; // { kind:'card'|'board'|'cal', id }
function clearDropHints() {
  document.querySelectorAll('.dragover,.over,.cal-drop,.drop-assign,.tb-reorder-over').forEach(el => el.classList.remove('dragover', 'over', 'cal-drop', 'drop-assign', 'tb-reorder-over'));
  document.querySelectorAll('.drop-before,.drop-after,.drop-nest,.drop-into').forEach(el => el.classList.remove('drop-before', 'drop-after', 'drop-nest', 'drop-into'));
}
function reorderBoard(draggedId, targetId, after) {
  const dragged = boardById(draggedId), target = boardById(targetId);
  if (!dragged || !target || draggedId === targetId || isAncestor(draggedId, targetId)) return;
  dragged.parent = target.parent || null;          // target과 같은 레벨(형제)
  setGroupDeep(draggedId, target.group || null);   // target과 같은 프로젝트(하위 포함)
  const arr = state.projects;
  arr.splice(arr.findIndex(b => b.id === draggedId), 1);
  const ti = arr.findIndex(b => b.id === targetId);
  arr.splice(after ? ti + 1 : ti, 0, dragged);
}
document.addEventListener('dragstart', e => {
  const grip = e.target.closest('.tb-grip');
  if (grip) { dragItem = { kind: 'big3', idx: +grip.dataset.idx }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'big3'); return; }
  const mt = e.target.closest('.map-todo-item');
  if (mt) { dragItem = { kind: 'maptodo', id: mt.dataset.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'maptodo'); return; }
  const td = e.target.closest('.tb-dump-item');
  if (td) { dragItem = { kind: 'tbdump', id: td.dataset.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'tb'); return; }
  const chip = e.target.closest('.chip');
  if (chip && chip.dataset.id) { dragItem = { kind: 'cal', id: chip.dataset.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'cal'); return; }
  const c = e.target.closest('.card');
  if (c) {
    dragItem = { kind: 'card', id: c.dataset.id };
    e.dataTransfer.setData('text/plain', c.dataset.id);
    const cc = state.cards.find(x => x.id === c.dataset.id);
    if (state.sel.view === 'board' && cc && cc.project) document.body.classList.add('dragging-card');   // '밖에 놓으면 미배정' 힌트
    return;
  }
  const bd = e.target.closest('.board-drag');
  if (bd) { dragItem = { kind: 'board', id: bd.dataset.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'board'); document.body.classList.add('dragging-board'); }
});
document.addEventListener('dragend', () => { dragItem = null; document.body.classList.remove('dragging-board', 'dragging-card'); clearDropHints(); });
document.addEventListener('dragover', e => {
  if (dragItem && dragItem.kind === 'big3') {
    const row = e.target.closest('.tb-big3-row');
    if (row && +row.dataset.idx !== dragItem.idx) { e.preventDefault(); row.classList.add('tb-reorder-over'); }
    return;
  }
  if (dragItem && dragItem.kind === 'maptodo') {
    const node = e.target.closest('.mapnode');
    const nb = node ? boardById(node.dataset.id) : null;
    if (node && !(nb && nb.folder)) { e.preventDefault(); node.classList.add('drop-assign'); }   // 묶음 보드엔 배정 불가
    return;
  }
  if (dragItem && dragItem.kind === 'tbdump') {
    const row = e.target.closest('.tb-big3-row');
    if (row) { e.preventDefault(); row.classList.add('drop-into'); }
    return;
  }
  if (dragItem && dragItem.kind === 'cal') {
    const day = e.target.closest('.cal-day');
    if (day) { e.preventDefault(); day.classList.add('cal-drop'); }
    return;
  }
  if (dragItem && dragItem.kind === 'board') {
    const lane = e.target.closest('.detach-lane,.delete-lane');
    if (lane) { e.preventDefault(); lane.classList.add('over'); return; }
    const sideIt = e.target.closest('.side-item[data-action="board-group"]');
    if (sideIt && sideIt.dataset.gid !== '__all') { e.preventDefault(); sideIt.classList.add('drop-into'); return; }
    const panel = e.target.closest('.board-panel');
    if (panel) {
      if (panel.dataset.board !== dragItem.id) {
        e.preventDefault();
        const r = panel.getBoundingClientRect();
        const rel = (e.clientY - r.top) / r.height;   // 위=앞순서 / 가운데=하위 / 아래=뒤순서
        panel.classList.remove('drop-before', 'drop-after', 'drop-nest');
        panel.classList.add(rel < 0.28 ? 'drop-before' : rel > 0.72 ? 'drop-after' : 'drop-nest');
      }
      return;
    }
    const sec = e.target.closest('.group-sec');
    if (sec) { e.preventDefault(); sec.classList.add('drop-into'); }
    return;
  }
  const col = e.target.closest('.col');
  if (col) { e.preventDefault(); col.classList.add('dragover'); return; }
  const cp = e.target.closest('.compact-panel');
  if (cp) { e.preventDefault(); cp.classList.add('dragover'); return; }   // 컴팩트 보드에 드롭 = To-do로
  // 보드 영역 밖(패널 사이 여백·하단 힌트 바)에 놓으면 미배정
  if (dragItem && dragItem.kind === 'card' && document.body.classList.contains('dragging-card')
      && !e.target.closest('.board-panel') && !e.target.closest('.notes-side')
      && (e.target.closest('.board-page') || e.target.closest('.unassign-hint'))) {
    e.preventDefault();
    document.querySelector('.unassign-hint')?.classList.add('hot');
  } else document.querySelector('.unassign-hint')?.classList.remove('hot');
});
document.addEventListener('dragleave', e => {
  const col = e.target.closest('.col');
  if (col) col.classList.remove('dragover');
  const cp = e.target.closest('.compact-panel');
  if (cp && !cp.contains(e.relatedTarget)) cp.classList.remove('dragover');
  const row = e.target.closest('.tb-big3-row');
  if (row && !row.contains(e.relatedTarget)) row.classList.remove('drop-into', 'tb-reorder-over');
  const day = e.target.closest('.cal-day');
  if (day && !day.contains(e.relatedTarget)) day.classList.remove('cal-drop');
  const mnode = e.target.closest('.mapnode');
  if (mnode && !mnode.contains(e.relatedTarget)) mnode.classList.remove('drop-assign');
  const lane = e.target.closest('.detach-lane,.delete-lane');
  if (lane && !lane.contains(e.relatedTarget)) lane.classList.remove('over');
  const sec = e.target.closest('.group-sec');
  if (sec && !sec.contains(e.relatedTarget)) sec.classList.remove('drop-into');
  const sideIt = e.target.closest('.side-item');
  if (sideIt && !sideIt.contains(e.relatedTarget)) sideIt.classList.remove('drop-into');
  const panel = e.target.closest('.board-panel');
  if (panel && !panel.contains(e.relatedTarget)) panel.classList.remove('drop-before', 'drop-after', 'drop-nest');
});
document.addEventListener('drop', e => {
  if (dragItem && dragItem.kind === 'big3') {        // Big3 순서 변경
    e.preventDefault();
    const row = e.target.closest('.tb-big3-row');
    const from = dragItem.idx;
    dragItem = null; clearDropHints();
    if (row) tbMoveBig3(from, +row.dataset.idx); else render();
    return;
  }
  if (dragItem && dragItem.kind === 'maptodo') {     // 구조도: 미배정 할 일 → 보드에 배정
    e.preventDefault();
    const node = e.target.closest('.mapnode');
    const nb = node ? boardById(node.dataset.id) : null;
    if (node && !(nb && nb.folder)) { const c = state.cards.find(x => x.id === dragItem.id); if (c) c.project = node.dataset.id; }   // 묶음 보드 제외
    dragItem = null; clearDropHints(); render();
    return;
  }
  if (dragItem && dragItem.kind === 'tbdump') {      // Brain Dump → Big 3
    e.preventDefault();
    const row = e.target.closest('.tb-big3-row');
    if (row) {
      const c = state.cards.find(x => x.id === dragItem.id);
      if (c) {
        const d = tbData(state.sel.tboxDate || todayStr());
        const i = +row.dataset.idx;
        d.big3[i] = { cardId: c.id, title: c.title, done: c.status === 'done' };
      }
    }
    dragItem = null; clearDropHints(); render();
    return;
  }
  if (dragItem && dragItem.kind === 'cal') {         // 달력 칩 → 다른 날짜로
    e.preventDefault();
    const day = e.target.closest('.cal-day');
    if (day && day.dataset.date) {
      const c = state.cards.find(x => x.id === dragItem.id);
      if (c) { if (c.status === 'done') c.doneAt = day.dataset.date; else c.due = day.dataset.date; }
    }
    dragItem = null; clearDropHints(); render();
    return;
  }
  if (dragItem && dragItem.kind === 'board') {
    e.preventDefault();
    const draggedId = dragItem.id, dragged = boardById(draggedId);
    const sideIt = e.target.closest('.side-item[data-action="board-group"]');
    if (sideIt && sideIt.dataset.gid !== '__all') {          // 사이드바 프로젝트에 드롭 → 편입
      dragged.parent = null;
      setGroupDeep(draggedId, sideIt.dataset.gid || null);
    } else if (e.target.closest('.detach-lane')) {
      dragged.parent = null;
    } else if (e.target.closest('.delete-lane')) {
      const cardCnt = state.cards.filter(c => c.project === draggedId).length;
      if (confirm(`'${dragged.name}' 보드를 삭제할까요?${cardCnt ? `\n(포스트잇 ${cardCnt}개도 함께 삭제)` : ''}\n삭제해도 휴지통에서 복원할 수 있어요.`)) {
        toTrash('board', { board: JSON.parse(JSON.stringify(dragged)), cards: JSON.parse(JSON.stringify(state.cards.filter(c => c.project === draggedId))) });
        state.projects.forEach(x => { if (x.parent === draggedId) x.parent = dragged.parent || null; });
        state.projects = state.projects.filter(x => x.id !== draggedId);
        purgeTimeboxCards(state.cards.filter(c => c.project === draggedId).map(c => c.id));   // Big3에서도 제거
        state.cards = state.cards.filter(c => c.project !== draggedId);
      }
    } else {
      const panel = e.target.closest('.board-panel');
      if (panel && panel.dataset.board !== draggedId) {
        const target = boardById(panel.dataset.board);
        const r = panel.getBoundingClientRect();
        const rel = (e.clientY - r.top) / r.height;
        if (rel < 0.28) reorderBoard(draggedId, target.id, false);        // 위 → 앞으로(순서)
        else if (rel > 0.72) reorderBoard(draggedId, target.id, true);    // 아래 → 뒤로(순서)
        else if (!isAncestor(draggedId, target.id)) setParent(draggedId, target.id);  // 가운데 → 하위로
      } else if (!panel) {
        const sec = e.target.closest('.group-sec');
        if (sec) { dragged.parent = null; setGroupDeep(draggedId, sec.dataset.group || null); }
      }
    }
    dragItem = null; document.body.classList.remove('dragging-board'); clearDropHints(); render();
    return;
  }
  const col = e.target.closest('.col');
  if (!col) {
    const cp = e.target.closest('.compact-panel');
    if (cp) { e.preventDefault(); moveCard(e.dataTransfer.getData('text/plain'), 'todo', cp.dataset.board); return; }
    if (dragItem && dragItem.kind === 'card' && document.body.classList.contains('dragging-card')
        && !e.target.closest('.board-panel') && !e.target.closest('.notes-side')
        && (e.target.closest('.board-page') || e.target.closest('.unassign-hint'))) {
      e.preventDefault();
      const c = state.cards.find(x => x.id === e.dataTransfer.getData('text/plain'));
      if (c) { c.project = null; if (c.status === 'done') { c.status = 'todo'; c.doneAt = null; } }   // 인박스 드롭과 동일 규칙
      document.body.classList.remove('dragging-card');
      render();
    }
    return;
  }
  e.preventDefault();
  const cid = e.dataTransfer.getData('text/plain');
  if (col.dataset.inbox) {                                  // 보드 카드 → 미배정으로 되돌리기
    const c = state.cards.find(x => x.id === cid);
    if (c) { c.project = null; if (c.status === 'done') { c.status = 'todo'; c.doneAt = null; } }
    render();
  } else {
    const panel = col.closest('.board-panel');
    moveCard(cid, col.dataset.status, panel ? panel.dataset.board : null);
  }
});

/* ---------- Google Calendar 단방향 동기화 (앱 → 구글) ---------- */
const GCAL_OK = !!(window.gcalClientId && !/PASTE|YOUR_/.test(window.gcalClientId));
let gcalToken = null, gcalTokenExp = 0;
function gcalHash(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return String(h); }
function getGcalToken() {
  return new Promise((resolve, reject) => {
    if (gcalToken && Date.now() < gcalTokenExp - 60000) return resolve(gcalToken);
    const start = () => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: window.gcalClientId,
        scope: 'https://www.googleapis.com/auth/calendar',
        hint: (authUser && authUser.email) || undefined,
        callback: r => {
          if (r && r.access_token) { gcalToken = r.access_token; gcalTokenExp = Date.now() + (r.expires_in || 3600) * 1000; resolve(gcalToken); }
          else reject(new Error('토큰을 받지 못했어요'));
        },
        error_callback: e => reject(new Error(e && e.type === 'popup_closed' ? '동의 창이 닫혔어요' : '구글 인증 실패')),
      });
      tc.requestAccessToken();
    };
    if (window.google && google.accounts) start();
    else loadScript('https://accounts.google.com/gsi/client').then(start).catch(() => reject(new Error('구글 스크립트 로드 실패')));
  });
}
async function gapi(path, method, body, token) {
  const res = await fetch('https://www.googleapis.com/calendar/v3' + path, {
    method: method || 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return { __404: true };
  if (!res.ok) throw new Error('구글 API 오류 ' + res.status);
  return res.status === 204 ? {} : res.json();
}
// 프로젝트(그룹) 색 → 구글 캘린더 colorId (1~11). 프로젝트마다 다른 색으로 구분되도록.
const GCAL_COLOR = { purple: '3', teal: '7', coral: '6', pink: '4', gray: '8', blue: '9', green: '10', amber: '5', red: '11' };
function gcalColorOf(gid) { const g = gid ? groupById(gid) : null; return g ? (GCAL_COLOR[g.color] || '8') : '8'; }
function gcalDesiredItems() {
  const items = {};   // key -> {title, start, end(exclusive), color(colorId)}
  state.cards.filter(c => c.status !== 'done' && c.due && c.project).forEach(c => {
    const b = boardById(c.project);
    items['c:' + c.id] = { title: `[${b ? b.name : ''}] ${c.title}`, start: c.due, end: nextDay(c.due), color: gcalColorOf(b ? b.group : null) };
  });
  state.cards.filter(c => c.status !== 'done' && c.due && !c.project).forEach(c => {
    items['c:' + c.id] = { title: `[미배정] ${c.title}`, start: c.due, end: nextDay(c.due), color: '8' };
  });
  (state.groups || []).forEach(g => (g.periods || []).forEach((p, i) => {
    if (p.start && p.end && p.start <= p.end) items[`g:${g.id}:${i}`] = { title: `📁 ${g.name}`, start: p.start, end: nextDay(p.end), color: gcalColorOf(g.id) };
  }));
  state.projects.filter(b => b.start && b.end && b.start <= b.end).forEach(b => {
    items['b:' + b.id] = { title: `[기간] ${b.name}`, start: b.start, end: nextDay(b.end), color: gcalColorOf(b.group) };
  });
  // 프로젝트 일정(마감)도 프로젝트 색으로 반영
  (state.schedules || []).filter(s => s.date).forEach(s => {
    const g = s.group ? groupById(s.group) : null;
    items['s:' + s.id] = { title: `📌 ${g ? '[' + g.name + '] ' : ''}${s.title}${s.time ? ' ' + s.time : ''}`, start: s.date, end: nextDay(s.date), color: gcalColorOf(s.group) };
  });
  return items;
}
async function syncGCal() {
  const btn = document.querySelector('[data-action="gcal-sync"]');
  const setBtn = t => { if (btn) btn.textContent = t; };
  try {
    setBtn('⏳ 인증 중…');
    const token = await getGcalToken();
    setBtn('⏳ 캘린더 확인…');
    state.gcal = state.gcal || {};
    if (state.gcal.calId) {
      const chk = await gapi('/calendars/' + encodeURIComponent(state.gcal.calId), 'GET', null, token);
      if (chk.__404) state.gcal.calId = null;
    }
    if (!state.gcal.calId) {
      const cal = await gapi('/calendars', 'POST', { summary: '업무 보드' }, token);
      state.gcal.calId = cal.id;
    }
    const calPath = '/calendars/' + encodeURIComponent(state.gcal.calId) + '/events';
    const desired = gcalDesiredItems();
    const map = state.gcal.map = state.gcal.map || {};
    let ins = 0, upd = 0, del = 0, fail = 0, skip = 0;
    for (const [key, it] of Object.entries(desired)) {
      const h = gcalHash(it.title + '|' + it.start + '|' + it.end + '|' + (it.color || ''));
      const cur = map[key];
      const payload = { summary: it.title, start: { date: it.start }, end: { date: it.end }, colorId: it.color || '8' };
      try {
        if (!cur) {
          const ev = await gapi(calPath, 'POST', payload, token);
          map[key] = { id: ev.id, h }; ins++;
        } else if (cur.h !== h) {
          const r = await gapi(calPath + '/' + encodeURIComponent(cur.id), 'PUT', payload, token);
          if (r.__404) { const ev = await gapi(calPath, 'POST', payload, token); map[key] = { id: ev.id, h }; ins++; }
          else { cur.h = h; upd++; }
        } else skip++;
      } catch (e) { fail++; }
    }
    for (const key of Object.keys(map)) {
      if (!desired[key]) {
        try { await gapi(calPath + '/' + encodeURIComponent(map[key].id), 'DELETE', null, token); } catch (e) { fail++; }
        delete map[key]; del++;
      }
    }
    save();
    setBtn('📅 구글 캘린더 동기화');
    alert(`구글 캘린더 동기화 완료\n생성 ${ins} · 갱신 ${upd} · 삭제 ${del} · 변화없음 ${skip}${fail ? ` · 실패 ${fail}` : ''}\n\n('업무 보드' 캘린더에서 확인하세요)`);
  } catch (e) {
    setBtn('📅 구글 캘린더 동기화');
    alert('동기화 실패: ' + (e.message || e));
  }
}

/* ---------- fancy note bubble (hover) ---------- */
let noteBubbleEl = null;
function showNoteBubble(target, text) {
  if (!noteBubbleEl) { noteBubbleEl = document.createElement('div'); noteBubbleEl.className = 'note-bubble'; document.body.appendChild(noteBubbleEl); }
  noteBubbleEl.innerHTML = `<div class="nb-head">💬 메모 · FU</div><div class="nb-body">${esc(text)}</div>`;
  noteBubbleEl.style.display = 'block';
  const r = target.getBoundingClientRect();
  const bw = noteBubbleEl.offsetWidth, bh = noteBubbleEl.offsetHeight;
  let left = Math.max(8, Math.min(r.left + r.width / 2 - bw / 2, window.innerWidth - bw - 8));
  let top = r.top - bh - 10, below = false;
  if (top < 8) { top = r.bottom + 10; below = true; }
  noteBubbleEl.style.left = left + 'px';
  noteBubbleEl.style.top = top + 'px';
  noteBubbleEl.classList.toggle('below', below);
  noteBubbleEl.style.setProperty('--tail-x', (r.left + r.width / 2 - left) + 'px');
}
function hideNoteBubble() { if (noteBubbleEl) noteBubbleEl.style.display = 'none'; }
// 서식 버튼 클릭 시 에디터의 선택 영역이 풀리지 않게(포커스 이동 방지)
document.addEventListener('mousedown', e => {
  if (e.target.closest && e.target.closest('.ne-fmt')) e.preventDefault();
});
document.addEventListener('mouseover', e => {
  const n = e.target.closest && e.target.closest('.card-note');
  if (n && n.dataset.note) showNoteBubble(n, n.dataset.note);
});
document.addEventListener('mouseout', e => {
  if (e.target.closest && e.target.closest('.card-note')) hideNoteBubble();
});

/* 프로젝트 기간: 시작일 입력 시 종료일은 시작일 다음날부터만 */
document.addEventListener('input', e => {
  if (e.target.id === 'note-q') {                 // 기록 검색 — render 없이 필터(포커스 유지)
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.note-item').forEach(it => {
      it.style.display = !q || (it.dataset.text || '').includes(q) ? '' : 'none';
    });
    return;
  }
  if (e.target.id === 'arch-q') {                 // 완수 아카이브 검색 — 동일 패턴
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.arch-row').forEach(it => {
      it.style.display = !q || (it.dataset.text || '').includes(q) ? '' : 'none';
    });
    return;
  }
  if (e.target.closest && e.target.closest('.note-editor')) { liveSaveNote(); return; }   // 기록 실시간 저장
  const s = e.target.closest && e.target.closest('.p-start');
  if (!s) return;
  const end = s.closest('.period-row').querySelector('.p-end');
  if (s.value) {
    const nd = nextDay(s.value);
    end.min = nd;
    if (!end.value || end.value < nd) end.value = nd;
  } else {
    end.removeAttribute('min');
  }
});

/* 기록 모달: 유형이 인터뷰일 때만 대상자 필드 표시 */
document.addEventListener('change', e => {
  const ai = e.target.closest && e.target.closest('.tb-actual-input');
  if (ai) {
    const i = +ai.dataset.idx;
    const d = tbData(state.sel.tboxDate || todayStr());
    const b = d.big3[i];
    if (b) {
      const v = ai.value.trim();
      b.actual = v === '' ? null : Math.max(0, parseFloat(v));
    }
    render();
    return;
  }
  if (e.target.id === 'm-cgroup') {   // 카드 모달: 프로젝트 변경 → 그 프로젝트의 보드로 목록 교체
    const bs = document.getElementById('m-cboard');
    if (bs) bs.innerHTML = cardBoardOptions(e.target.value || '', '');
    return;
  }
  if (e.target.id === 'm-ngroup') {   // 소속 프로젝트 변경 → 보드 목록이 달라지므로 보드 초기화 후 재렌더
    const nb = document.getElementById('m-nboard');
    if (nb) nb.value = '';
    liveSaveNote();
    captureNoteDraft();
    if (noteDraft) noteDraft.board = '';
    render();
    return;
  }
  if (e.target.id === 'm-ntype') {
    const wrap = document.getElementById('m-who-wrap');
    if (wrap) wrap.style.display = e.target.value === 'interview' ? '' : 'none';
    // 신규 기록: 본문이 비었거나 다른 유형의 템플릿 그대로면 새 유형 템플릿으로 교체 (작성 내용은 보존)
    const body = document.getElementById('m-nbody');
    if (body && body.isContentEditable && body.dataset.new === '1') {
      const cur = (body.innerText || '').trim();
      const tpls = Object.values(NOTE_TEMPLATES).map(t => t.trim()).filter(Boolean);
      if (!cur || tpls.includes(cur)) body.innerHTML = noteBodyToHtml(undefined, e.target.value);
    }
  }
  if (e.target.closest && e.target.closest('.note-editor')) liveSaveNote();   // 유형·날짜·보드 변경도 실시간 저장
});

/* ---------- bootstrap ---------- */
if (CLOUD) {
  document.getElementById('app').innerHTML = '<div class="gate"><p class="gate-sub">연결 중…</p></div>';
  initCloud();
} else {
  render();
}
