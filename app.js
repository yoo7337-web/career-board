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
const TBOX_COLORS = [
  { bg: '#F5A88A', fg: '#5A1F0C' },   // Big 1 — coral
  { bg: '#F7CE6B', fg: '#5A3406' },   // Big 2 — amber
  { bg: '#9FD0F0', fg: '#0C3A66' },   // Big 3 — blue
];
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
function seedDevlogDone() { return DEVLOG_SEED.map(([date, title, desc]) => ({ id: uid(), date, title, desc })); }
function ensureDevlog() {
  if (isAdmin() && !state.devlog) { state.devlog = { done: seedDevlogDone(), future: [] }; return true; }
  return false;
}

/* ---------- backups (separate cloud doc + local, protects against overwrite) ---------- */
const SNAP_KEY = 'board-v2-snaps', SNAP_MAX = 30, SNAP_LOCAL_MAX = 12, SNAP_MIN_MS = 90000;
let backupSnaps = [], unsubBackup = null, lastSnapHash = '', lastSnapTime = 0;
function localSnaps() { try { return JSON.parse(localStorage.getItem(SNAP_KEY) || '[]'); } catch (e) { return []; } }
function stateHash(s) { try { return JSON.stringify([s.projects, s.cards, s.devlog]); } catch (e) { return 't' + Date.now(); } }
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
  try { const l = localSnaps(); l.push(snap); localStorage.setItem(SNAP_KEY, JSON.stringify(l.slice(-SNAP_LOCAL_MAX))); } catch (e) { /* quota */ }
  if (CLOUD && db && authUser) {
    backupSnaps = backupSnaps.concat([snap]).slice(-SNAP_MAX);
    db.collection('backups').doc(authUser.uid).set({ snaps: backupSnaps }).catch(e => console.warn('backup write failed', e));
  }
}
function subscribeBackups(uid) {
  if (unsubBackup) unsubBackup();
  unsubBackup = db.collection('backups').doc(uid).onSnapshot(s => {
    const d = s.data(); backupSnaps = (d && d.snaps) || [];
  }, e => console.warn('backup sub failed', e));
}

function save() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  if (CLOUD && db && authUser && !applyingRemote) {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      db.collection('boards').doc(authUser.uid)
        .set({ state, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
        .catch(e => console.warn('sync write failed', e));
      pushSnapshot();
    }, 600);
  } else if (!CLOUD) {
    pushSnapshot();
  }
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
function subscribeBoard(uid) {
  render();
  if (unsubDoc) unsubDoc();
  unsubDoc = db.collection('boards').doc(uid).onSnapshot(snap => {
    if (snap.metadata.hasPendingWrites) return;
    const data = snap.data();
    if (data && data.state) {
      applyingRemote = true;
      state = data.state;
      state.sel = state.sel || { view: 'board' };
      state.groups = state.groups || [];
      state.notes = state.notes || [];
      state.timebox = state.timebox || {};
      state.journal = state.journal || {};
      state.settings = state.settings || {};
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      render();
      applyingRemote = false;
      if (ensureDevlog()) { save(); render(); }
      if (journalFreeze()) save();
      pushSnapshot();
    } else {
      ensureDevlog();
      db.collection('boards').doc(uid).set({ state, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
  }, err => console.warn('snapshot error', err));
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
function cardHtml(c) {
  const pr = PRIORITIES[c.priority] || PRIORITIES.none;
  const style = pr.bg ? `style="background:${pr.bg};color:${pr.fg};border-color:transparent"` : '';
  const tags = [];
  if (c.status !== 'done' && c.due) tags.push(dueBadge(c.due));
  if (c.status === 'done' && c.doneAt) tags.push(`<span class="tag">${fmtDate(c.doneAt)} 완료</span>`);
  const overlay = c.status === 'done' ? '<span class="stamp">완료</span>'
    : c.status === 'doing' ? '<span class="doing-badge">진행중</span>' : '';
  const note = c.note ? `<span class="card-note" data-note="${esc(c.note)}">💬</span>` : '';
  return `<div class="card ${c.status}" ${style} draggable="true" data-id="${c.id}" data-action="card">
    ${overlay}<div class="t">${esc(c.title)}${note}</div>
    ${tags.length ? `<div class="meta">${tags.join('')}</div>` : ''}
  </div>`;
}

function panelHtml(b, depth) {
  const parent = b.parent ? boardById(b.parent) : null;
  const todo = cardsOf(b.id, 'todo');
  const doing = cardsOf(b.id, 'doing');
  const done = cardsOf(b.id, 'done').sort((a, c) => (c.doneAt || '').localeCompare(a.doneAt || ''));
  return `<section class="board-panel" data-board="${b.id}" style="margin-left:${depth * 22}px">
    <div class="panel-head">
      <span class="bname board-drag c-${b.color}" draggable="true" data-action="board-edit" data-id="${b.id}" title="클릭=설정 · 끌어서 다른 보드 위/아래에 놓으면 상하 구조">${esc(b.name)}</span>
      ${parent ? `<span class="bcrumb">▸ 상위 ${esc(parent.name)}</span>` : ''}
    </div>
    <div class="panel-cols">
      <div class="col" data-status="todo">
        <h3>To-do <span class="cnt">${todo.length}</span></h3>
        ${todo.map(cardHtml).join('')}
        <form class="quick" data-project="${b.id}"><input name="t" placeholder="+ 포스트잇 추가하고 Enter" autocomplete="off"></form>
      </div>
      <div class="col doing-col" data-status="doing">
        <h3>진행 중 <span class="cnt">${doing.length}</span></h3>
        ${doing.map(cardHtml).join('') || '<div class="empty">지금 할 1~3장을 여기로 끌어오세요</div>'}
      </div>
      <div class="col done-col" data-status="done">
        <h3>완수 <span class="cnt">${done.length}</span></h3>
        ${done.slice(0, 20).map(cardHtml).join('') || '<div class="empty">끝내면 여기로!</div>'}
      </div>
    </div>
  </section>`;
}

function legendHtml() {
  const sw = PRIO_ORDER.filter(k => k !== 'none').map(k => `<span class="lg"><i style="background:${PRIORITIES[k].bg}"></i>${PRIORITIES[k].label}</span>`).join('');
  return `<div class="legend">중요도 <span class="lg"><i class="plain"></i>없음</span>${sw}</div>`;
}

function groupById(id) { return (state.groups || []).find(g => g.id === id); }
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
    ? `<div class="group-head"><span class="gname c-${g.color}" data-action="group-edit" data-id="${g.id}" title="클릭=프로젝트 이름·삭제">📁 ${esc(g.name)}</span><span class="gcnt">보드 ${items.length}</span><button class="mini-btn" data-action="proj-add" data-group="${g.id}">+ 보드</button></div>`
    : ((state.groups || []).length ? `<div class="group-head"><span class="gname plain">📄 미분류</span><span class="gcnt">보드 ${items.length}</span></div>` : ''));
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
  const bCount = gid => state.projects.filter(b => (b.group || '') === gid).length;
  const side = `<aside class="notes-side">
    <div class="side-h">프로젝트</div>
    <div class="side-item ${sel === '__all' ? 'on c-gray' : ''}" data-action="board-group" data-gid="__all"><span class="side-dot c-gray"></span><span class="side-name">전체</span><span class="side-cnt">${state.projects.length || ''}</span></div>
    ${groups.map(g => `<div class="side-item ${sel === g.id ? 'on c-' + g.color : ''}" data-action="board-group" data-gid="${g.id}"><span class="side-dot c-${g.color}"></span><span class="side-name">${esc(g.name)}</span><span class="side-cnt">${bCount(g.id) || ''}</span></div>`).join('')}
    <div class="side-item ${sel === '' ? 'on c-gray' : ''}" data-action="board-group" data-gid=""><span class="side-dot c-gray"></span><span class="side-name">미분류</span><span class="side-cnt">${bCount('') || ''}</span></div>
    <div class="side-actions">
      <button class="pill" data-action="group-add">📁 + 프로젝트</button>
      <button class="pill" data-action="proj-add" ${sel !== '__all' && sel !== '' ? `data-group="${sel}"` : ''}>+ 보드</button>
    </div>
  </aside>`;
  const inbox = state.cards.filter(c => !c.project && c.status !== 'done');
  const inboxHtml = `<section class="inbox">
    <div class="group-head"><span class="gname c-amber">📥 미배정 · 예정</span><span class="gcnt">${inbox.length}</span><span class="dash-sub">보드에 넣기 전 임시 보관 — 카드를 보드로 드래그</span></div>
    <div class="col inbox-col" data-status="todo" data-inbox="1">
      ${inbox.map(cardHtml).join('')}
      <form class="quick" data-project="__inbox"><input name="t" placeholder="+ 예정 할 일 추가하고 Enter" autocomplete="off"></form>
    </div>
  </section>`;
  let page;
  if (sel === '__all') {
    page = groups.map(g => groupSecHtml(g.id)).join('') + groupSecHtml('');
  } else {
    const g = sel ? groupById(sel) : null;
    const gname = g ? g.name : '미분류';
    const gBoards = state.projects.filter(b => (b.group || '') === sel);
    const bIds = new Set(gBoards.map(b => b.id));
    const gCards = state.cards.filter(c => c.project && bIds.has(c.project));
    const doneCnt = gCards.filter(c => c.status === 'done').length;
    const periods = (g && g.periods && g.periods.length) ? g.periods : null;
    const periodTxt = periods ? `${fmtDate(periods[0].start)} ~ ${fmtDate(periods[periods.length - 1].end)}${periods.length > 1 ? ` 외 ${periods.length - 1}` : ''}` : '기간 미설정';
    page = `<div class="page-head"><span class="page-icon c-${g ? g.color : 'gray'}">📁</span><h2 class="page-title">${esc(gname)}</h2>
        ${g ? `<button class="mini-btn" data-action="group-edit" data-id="${g.id}">설정</button>` : ''}
        <button class="mini-btn" data-action="proj-add" ${sel ? `data-group="${sel}"` : ''}>+ 보드</button></div>
      <div class="prop-bar">
        <span class="prop-chip" ${g ? `data-action="group-edit" data-id="${g.id}" title="클릭해서 기간 수정"` : ''}>📅 ${periodTxt}</span>
        <span class="prop-chip">🗂 보드 ${gBoards.length}</span>
        <span class="prop-chip">✅ 진행 ${doneCnt}/${gCards.length}</span>
      </div>` + groupSecHtml(sel, true);
  }
  return legendHtml()
    + `<div class="board-wrap">${side}<div class="board-page">
        <div class="addbar"><span class="board-hint">보드 드래그: 다른 보드 위=앞 순서 / 가운데=하위로 / 아래=뒤 순서 · 왼쪽 사이드바 프로젝트=편입 · 왼쪽 끝=분리 · 오른쪽 끝=삭제</span></div>
        ${inboxHtml}
        ${page}
      </div></div>`
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
  const COLW = 175, ROWH = 110, PADY = 60;
  let offX = 40;
  const layout = (members) => {
    const ids = new Set(members.map(b => b.id));
    const byParent = {};
    members.forEach(b => { const p = (b.parent && ids.has(b.parent)) ? b.parent : 'root'; (byParent[p] = byParent[p] || []).push(b); });
    const xOf = {}, depthOf = {}, visited = new Set();
    let leaf = 0;
    const assign = (id, depth) => {
      if (visited.has(id)) return; visited.add(id);
      depthOf[id] = depth;
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
    members.forEach(b => {
      b.x = offX + (xOf[b.id] || 0) * COLW;
      b.y = PADY + (depthOf[b.id] || 0) * ROWH;
    });
    offX += Math.max(1, leaf) * COLW + 70;   // 다음 프로젝트 구역은 오른쪽에
  };
  (state.groups || []).forEach(g => {
    const ms = state.projects.filter(b => (b.group || null) === g.id);
    if (ms.length) layout(ms);
  });
  const un = state.projects.filter(b => !b.group);
  if (un.length) layout(un);
  save();
}
let focusBoard = null;   // board to scroll to in board view after nav
let pendingMapPos = null; // {x,y,group} for add-board-at-click
function regionRects() {
  return (state.groups || []).map(g => {
    const ms = state.projects.filter(b => (b.group || null) === g.id);
    if (!ms.length) return null;
    const xs = ms.map(b => b.x), ys = ms.map(b => b.y);
    const x = Math.min(...xs) - 18, y = Math.min(...ys) - 36;
    return { gid: g.id, name: g.name, color: g.color, x, y, w: Math.max(...xs) + 150 - x + 18, h: Math.max(...ys) + 44 - y + 18 };
  }).filter(Boolean);
}
function renderMap() {
  ensurePositions();
  const regions = regionRects().map(r =>
    `<div class="map-region c-${r.color}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"><span class="map-region-label">📁 ${esc(r.name)}</span></div>`).join('');
  const nodes = state.projects.map(b => {
    const cs = state.cards.filter(c => c.project === b.id);
    const done = cs.filter(c => c.status === 'done').length;
    const doing = cs.filter(c => c.status === 'doing').length;
    const badge = doing > 0 ? `<span class="node-badge doing">▶${doing}</span>`
      : (cs.length && done === cs.length) ? '<span class="node-badge done">✓</span>' : '';
    const prog = cs.length ? `<div class="node-prog"><div class="node-prog-fill" style="width:${Math.round(done / cs.length * 100)}%"></div></div>` : '';
    const stat = cs.length ? ` — 완수 ${done}/${cs.length}${doing ? ` · 진행중 ${doing}` : ''}` : '';
    return `
    <div class="mapnode c-${b.color}" data-id="${b.id}" style="left:${b.x}px;top:${b.y}px" title="${esc(b.name)}${stat}">
      <div class="mp mp-top" data-id="${b.id}" data-role="top" title="상위 연결점 — 여기서 부모 보드로 끌기"></div>
      ${badge}<div class="mapnode-name">${esc(b.name)}</div>${prog}
      <div class="mp mp-bot" data-id="${b.id}" data-role="bot" title="하위 연결점 — 여기서 자식 보드로 끌기"></div>
    </div>`;
  }).join('');
  const h = Math.max(640, state.projects.reduce((m, b) => Math.max(m, b.y || 0), 0) + 140);
  return `<div class="map-toolbar">
      <button class="pill" data-action="map-arrange" title="프로젝트별 구역으로 나눠 상위→하위 자동 배치">⟲ 자동정렬</button>
      <span class="maphint">색 구역 = 프로젝트 · 노드를 구역 안으로 끌면 그 프로젝트 소속 · 빈 곳 클릭 = 보드 추가 · 더블클릭 = 보드로 이동</span>
    </div>
    <div class="map" id="map" style="height:${h}px">${regions}<svg class="maplines" id="maplines"></svg>${nodes}</div>`;
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

  map.addEventListener('pointerdown', e => {
    const cut = e.target.closest('.mapcut');
    if (cut) { mode = 'cut'; cutId = cut.dataset.child; e.preventDefault(); return; }
    const cp = e.target.closest('.mp');
    if (cp) { mode = 'link'; id = cp.dataset.id; role = cp.dataset.role; map.setPointerCapture(e.pointerId); e.preventDefault(); return; }
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
    } else if (mode === 'link') {
      const r = map.querySelector(`.mapnode[data-id="${id}"]`).getBoundingClientRect();
      const y1 = role === 'top' ? r.top - mr.top : r.top - mr.top + r.height;
      drawLines({ x1: r.left - mr.left + r.width / 2, y1, x2: px, y2: py });
    }
  });

  map.addEventListener('pointerup', e => {
    const mr = map.getBoundingClientRect();
    if (mode === 'cut') {
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
    } else if (mode === 'pending') {
      const nid = id, now = Date.now();
      if (lastId === nid && now - lastTime < CLICK_MS) {   // double click → go to board
        clearTimeout(clickTimer); clickTimer = null; lastId = null;
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
function openAddBoardAt(x, y) {
  const hit = regionRects().find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  pendingMapPos = { x: Math.max(0, x - 75), y: Math.max(0, y - 22), group: hit ? hit.gid : null };
  showModal(`
    <h3>여기에 보드 추가${hit ? ` — 📁 ${esc(hit.name)}` : ''}</h3>
    <label>이름<input type="text" id="m-title" placeholder="예: Issue log"></label>
    ${hit ? `<p class="restore-note">'${esc(hit.name)}' 프로젝트 구역이라 자동으로 그 소속이 됩니다.</p>` : ''}
    <div class="m-actions">
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="mapadd-save">추가</button>
    </div>`);
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
function calFilterActive() { return Array.isArray(state.sel.calFilter) && state.sel.calFilter.length > 0; }
function calCardVisible(c) {
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
  if (!groups.length) return '';
  const sel = state.sel.calFilter, active = calFilterActive();
  const pill = (gid, name, color) => `<button class="fpill ${active && sel.includes(gid) ? 'on c-' + color : ''}" data-action="cal-filter" data-gid="${gid}">${esc(name)}</button>`;
  return `<div class="cal-filter"><span class="fl-label">프로젝트</span>
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
  const cardsByDate = {};
  state.cards.forEach(c => {
    if (!calCardVisible(c)) return;
    const d = c.due || (c.status === 'done' ? c.doneAt : null);
    if (d) (cardsByDate[d] = cardsByDate[d] || []).push(c);
  });
  const periodItems = [];
  state.projects.filter(b => b.start && b.end && b.start <= b.end).forEach(b => {
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
      cells += `<div class="cal-day ${inMonth ? '' : 'out'} ${ds === today ? 'today' : ''}" data-action="cal-add" data-date="${ds}" title="클릭하면 이 날짜로 할 일 추가">
        <div class="cal-scroll"><span class="dnum ${d === 0 ? 'sun' : ''}">${dt.getDate()}</span>${chips}</div></div>`;
    }
    weeksHtml += `<div class="cal-week">
      ${laneCnt ? `<div class="cal-bars" style="height:${laneCnt * 19 + 2}px">${bars.join('')}</div>` : ''}
      <div class="cal-days">${cells}</div>
    </div>`;
  }
  return `<div class="cal-head">
      <span class="cal-title">${y}년 ${m}월</span>
      <button class="pill" data-action="cal-prev">◀</button>
      <button class="pill" data-action="cal-today">오늘</button>
      <button class="pill" data-action="cal-next">▶</button>
      <span class="cal-hint">날짜 클릭 = 할 일 추가 · 칩을 다른 날로 드래그 = 날짜 변경 · 막대 = 수행기간</span>
      <span class="cal-status-legend"><span class="sl"><i class="bdot"></i>계획</span><span class="sl"><i class="chip-mk doing">▶</i>진행 중</span><span class="sl done"><i class="chip-mk done">✓</i>완수</span></span>
    </div>
    ${calFilterBar()}
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
function dashRow(c) {
  const b = boardById(c.project);
  const g = b && b.group ? groupById(b.group) : null;
  const pr = PRIORITIES[c.priority] || PRIORITIES.none;
  const proj = g ? `<span class="drow-proj c-${g.color}">${esc(g.name)}</span>` : '';
  const board = b ? `<span class="drow-board">${esc(b.name)}</span>` : '';
  const note = c.note ? `<span class="card-note" data-note="${esc(c.note)}">💬</span>` : '';
  const tag = c.status === 'done'
    ? (c.doneAt ? `<span class="tag">${fmtDate(c.doneAt)} 완수</span>` : '')
    : (c.due ? dueBadge(c.due) : '');
  const stPill = c.status === 'doing' ? '<span class="st-pill doing">진행중</span>'
    : c.status === 'done' ? '<span class="st-pill done">완수</span>'
      : '<span class="st-pill todo">예정</span>';
  const overdue = c.status !== 'done' && c.due && dday(c.due) < 0 ? ' overdue' : '';
  return `<div class="drow${overdue}" data-action="card" data-id="${c.id}">
    <span class="drow-prio" style="${pr.bg ? `background:${pr.bg}` : ''}"></span>
    ${stPill}<span class="drow-title">${esc(c.title)}</span>${note}
    <span class="drow-meta">${proj}${board}${tag}</span>
  </div>`;
}
function dashSection(title, sub, cards, emptyMsg, limit, opts) {
  const o = opts || {};
  const shown = limit ? cards.slice(0, limit) : cards;
  const more = limit && cards.length > limit ? `<div class="dash-more">+${cards.length - limit}건 더</div>` : '';
  const body = o.rowsHtml !== undefined ? o.rowsHtml : (shown.length ? shown.map(dashRow).join('') + more : `<div class="empty">${emptyMsg}</div>`);
  return `<section class="dash-sec ${o.full ? 'full' : ''} ${o.stage ? 'stage-' + o.stage : ''}" ${o.id ? `id="${o.id}"` : ''}>
    <div class="dash-sec-head"><h2>${title} <span class="cnt">${cards.length}</span></h2><span class="dash-sub">${sub}</span></div>
    <div class="dash-list">${body}</div>
  </section>`;
}
function doneWeekSection(cards, offset, start, end) {
  const limit = 15;
  const shown = cards.slice(0, limit);
  const more = cards.length > limit ? `<div class="dash-more">+${cards.length - limit}건 더</div>` : '';
  const body = shown.length ? shown.map(dashRow).join('') + more : '<div class="empty">이 주에 완료한 업무가 없어요</div>';
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
    <div class="dash-list">${body}</div>
  </section>`;
}
function recentNotesSec() {
  const notes = (state.notes || []).slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 3);
  const row = n => {
    const g = n.group ? groupById(n.group) : null;
    return `<div class="drow" data-action="dash-note-go" data-id="${n.id}">
      ${noteTypeBadge(n.type)}
      <span class="drow-title">${esc(n.title)}</span>
      <span class="drow-meta">${g ? `<span class="drow-proj c-${g.color}">${esc(g.name)}</span>` : ''}<span class="tag">${n.date ? fmtDate(n.date) : ''}</span></span>
    </div>`;
  };
  return `<section class="dash-sec full"><div class="dash-sec-head"><h2>📝 최근 기록 <span class="cnt">${notes.length}</span></h2><span class="dash-sub">기록 탭 최신 3건</span></div>
    <div class="dash-list">${notes.length ? notes.map(row).join('') : '<div class="empty">기록 탭에서 인터뷰·진행상황을 남겨보세요</div>'}</div>
  </section>`;
}
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
  // 프로젝트별 진행률
  const gpRows = [];
  const gpRow = (name, color, done, total) => {
    const pct = total ? Math.round(done / total * 100) : 0;
    return `<div class="gp-row"><span class="drow-proj c-${color}">${esc(name)}</span>
      <div class="gp-track"><div class="gp-fill c-${color}" style="width:${pct}%"></div></div>
      <span class="gp-num">${done}/${total} · ${pct}%</span></div>`;
  };
  (state.groups || []).forEach(g => {
    const bids = new Set(state.projects.filter(b => (b.group || null) === g.id).map(b => b.id));
    const cs = cards.filter(c => bids.has(c.project));
    if (cs.length) gpRows.push(gpRow(g.name, g.color, cs.filter(c => c.status === 'done').length, cs.length));
  });
  {
    const bids = new Set(state.projects.filter(b => !b.group).map(b => b.id));
    const cs = cards.filter(c => bids.has(c.project));
    if ((state.groups || []).length && cs.length) gpRows.push(gpRow('미분류', 'gray', cs.filter(c => c.status === 'done').length, cs.length));
  }
  const td = (state.timebox || {})[today];
  const hasBig3 = td && td.big3 && td.big3.some(Boolean);
  const big3Strip = `<div class="dash-big3" data-action="dash-big3-go" title="타임박스로 이동">
    <span class="db3-label">🎯 오늘의 Big 3</span>
    ${hasBig3
      ? [0, 1, 2].map(i => { const b = td.big3[i], c = TBOX_COLORS[i], bd = tbDone(b);
          return b ? `<span class="db3 ${bd ? 'done' : ''}" style="background:${c.bg};color:${c.fg}">${bd ? '✓ ' : ''}${esc(b.title)}</span>`
                   : `<span class="db3 empty">Big ${i + 1}</span>`; }).join('')
      : '<span class="db3 empty">타임박스에서 오늘의 Big 3를 정해보세요 →</span>'}
  </div>`;
  return `<div class="dash">
    ${big3Strip}
    <div class="dash-kpis">
      ${kpi('📅 예정', todo.length, 'k-todo', 'sec-todo')}
      ${kpi('▶ 진행 중', doing.length, 'k-doing', 'sec-doing')}
      ${kpi('✓ 이번 주 완수', weekDone(), 'k-done', 'sec-done')}
      ${kpi('🔥 급한 일', urgent.length, 'k-urgent', 'sec-urgent')}
    </div>
    ${gpRows.length ? `<section class="dash-sec full"><div class="dash-sec-head"><h2>📊 프로젝트 진행률 <span class="cnt">${gpRows.length}</span></h2><span class="dash-sub">완수/전체</span></div><div class="dash-list gp-grid">${gpRows.join('')}</div></section>` : ''}
    ${dashSection('🔥 급한 업무', '마감 임박·지남 또는 중요도 높음', urgent, '급한 업무가 없어요 👍', 8, { full: true, id: 'sec-urgent' })}
    <div class="dash-flow">
      ${dashSection('📅 예정', '마감 임박순', todo, '예정 업무가 없어요', 10, { id: 'sec-todo', stage: 'todo' })}
      ${dashSection('▶ 진행 중', '지금 하고 있는 일', doing, '진행 중인 업무가 없어요', 10, { id: 'sec-doing', stage: 'doing' })}
      ${doneWeekSection(recentDone, doneWeekOffset, dw.start, dw.end)}
    </div>
    ${recentNotesSec()}
  </div>`;
}

/* ---------- notes (프로젝트 기록) ---------- */
function noteTypeBadge(t) {
  const nt = NOTE_TYPES[t] || NOTE_TYPES.memo;
  return `<span class="note-type c-${nt.color}">${nt.icon} ${nt.label}</span>`;
}
function currentNoteGroup() {
  const groups = state.groups || [];
  let gid = state.sel.noteGroup;
  if (gid === undefined || (gid !== '' && !groupById(gid))) gid = groups.length ? groups[0].id : '';
  state.sel.noteGroup = gid;
  return gid;
}
function noteItemHtml(n) {
  const searchText = esc((n.title + ' ' + (n.body || '') + ' ' + (n.who || '')).toLowerCase());
  const nt = NOTE_TYPES[n.type] || NOTE_TYPES.memo;
  return `<div class="note-item" data-action="note-edit" data-id="${n.id}" data-text="${searchText}">
    <span class="tl-dot c-${nt.color}"></span>
    <div class="note-head">
      ${noteTypeBadge(n.type)}
      <span class="note-date">${n.date ? fmtDate(n.date) : ''}</span>
      <span class="note-title">${esc(n.title)}</span>
      ${n.who ? `<span class="note-who">🎤 ${esc(n.who)}</span>` : ''}
      <button class="note-pin-btn ${n.pinned ? 'on' : ''}" data-action="note-pin" data-id="${n.id}" title="${n.pinned ? '고정 해제' : '상단에 고정'}">📌</button>
      <button class="mini-btn note-todo-btn" data-action="note-todo" data-id="${n.id}" title="이 기록에서 할 일 만들기">→ To-do</button>
    </div>
    ${n.body ? `<div class="note-body clamp">${esc(n.body)}</div><button class="note-more" data-action="note-expand" style="display:none">더보기 ▾</button>` : ''}
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
  const gid = currentNoteGroup();
  const g = gid ? groupById(gid) : null;
  const gname = g ? g.name : '미분류';
  const notesOf = xgid => (state.notes || []).filter(n => (n.group || '') === xgid).length;
  const sideItems = groups.map(x => `<div class="side-item ${gid === x.id ? 'on c-' + x.color : ''}" data-action="note-group" data-gid="${x.id}">
      <span class="side-dot c-${x.color}"></span><span class="side-name">${esc(x.name)}</span><span class="side-cnt">${notesOf(x.id) || ''}</span>
    </div>`).join('')
    + `<div class="side-item ${gid === '' ? 'on c-gray' : ''}" data-action="note-group" data-gid="">
      <span class="side-dot c-gray"></span><span class="side-name">미분류</span><span class="side-cnt">${notesOf('') || ''}</span></div>`;
  // 속성 바 (B)
  const gBoards = state.projects.filter(b => (b.group || '') === gid);
  const bIds = new Set(gBoards.map(b => b.id));
  const gCards = state.cards.filter(c => c.project && bIds.has(c.project));
  const doneCnt = gCards.filter(c => c.status === 'done').length;
  const periods = (g && g.periods && g.periods.length) ? g.periods : null;
  const periodTxt = periods ? `${fmtDate(periods[0].start)} ~ ${fmtDate(periods[periods.length - 1].end)}${periods.length > 1 ? ` 외 ${periods.length - 1}` : ''}` : '기간 미설정';
  const gNotes = (state.notes || []).filter(n => (n.group || '') === gid);
  const lastNote = gNotes.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const propBar = `<div class="prop-bar">
    <span class="prop-chip" ${g ? `data-action="group-edit" data-id="${g.id}" title="클릭해서 기간 수정"` : ''}>📅 ${periodTxt}</span>
    <span class="prop-chip">🗂 보드 ${gBoards.length}</span>
    <span class="prop-chip">✅ 진행 ${doneCnt}/${gCards.length}</span>
    <span class="prop-chip">🕐 최근 기록 ${lastNote && lastNote.date ? fmtDate(lastNote.date) : '없음'}</span>
  </div>`;
  const overview = g ? (g.overview || '') : (state.unGroupOverview || '');
  const tsel = state.sel.noteType || '';
  const typePills = `<button class="fpill ${!tsel ? 'on' : ''}" data-action="note-type" data-t="">전체</button>`
    + Object.entries(NOTE_TYPES).map(([k, v]) => `<button class="fpill ${tsel === k ? 'on c-' + v.color : ''}" data-action="note-type" data-t="${k}">${v.icon} ${v.label}</button>`).join('');
  const notes = gNotes
    .filter(n => !tsel || n.type === tsel)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  // 피드: 📌 고정 → 날짜 그룹 (D·F)
  const today = todayStr();
  const pinned = notes.filter(n => n.pinned);
  const rest = notes.filter(n => !n.pinned);
  let feed = '';
  if (pinned.length) feed += `<div class="note-group-h">📌 고정됨</div>` + pinned.map(noteItemHtml).join('');
  let lastGrp = null;
  rest.forEach(n => {
    const grp = noteDateGroup(n.date, today);
    if (grp !== lastGrp) { lastGrp = grp; feed += `<div class="note-group-h">${grp}</div>`; }
    feed += noteItemHtml(n);
  });
  if (!feed) feed = '<div class="empty">아직 기록이 없어요 — [+ 기록 추가]로 인터뷰·회의·진행상황을 남겨보세요</div>';
  return `<div class="notes-wrap">
    <aside class="notes-side">
      <div class="side-h">프로젝트</div>
      ${sideItems}
    </aside>
    <div class="notes-page">
      <div class="page-head"><span class="page-icon c-${g ? g.color : 'gray'}">📁</span><h2 class="page-title">${esc(gname)}</h2></div>
      ${propBar}
      <div class="note-overview callout" data-action="overview-edit" title="클릭해서 수정">
        <span class="co-icon">💡</span>
        <div class="co-body">${overview ? `<div class="no-body">${esc(overview)}</div>` : '<div class="no-empty">프로젝트 핵심 현황·컨택포인트·주의사항을 적어두세요 (클릭)</div>'}</div>
      </div>
      <div class="note-toolbar">
        ${typePills}
        <input type="search" id="note-q" placeholder="🔍 기록 검색" autocomplete="off">
        <button class="pill" data-action="note-add">+ 기록 추가</button>
      </div>
      <div class="note-list timeline">${feed}</div>
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
function openNoteModal(id) {
  const n = id ? (state.notes || []).find(x => x.id === id) : null;
  const type = n ? n.type : 'memo';
  showModal(`
    <h3>${n ? '기록 수정' : '기록 추가'}</h3>
    <div class="two">
      <label>유형<select id="m-ntype">${noteTypeOptions(type)}</select></label>
      <label>날짜<input type="date" id="m-ndate" value="${n ? (n.date || '') : todayStr()}"></label>
    </div>
    <label>제목<input type="text" id="m-ntitle" value="${n ? esc(n.title) : ''}" placeholder="예: 경리팀장 인터뷰 / 중간감사 진행상황"></label>
    <label id="m-who-wrap" style="display:${type === 'interview' ? 'block' : 'none'}">대상자 (누구와)<input type="text" id="m-nwho" value="${n ? esc(n.who || '') : ''}" placeholder="예: 경리팀장 김OO"></label>
    <label>내용<textarea id="m-nbody" rows="7" ${n ? '' : 'data-new="1"'} placeholder="들은 내용, 확인한 사항, 다음 단계 등">${n ? esc(n.body || '') : esc(NOTE_TEMPLATES[type] || '')}</textarea></label>
    <div class="m-actions">
      ${n ? `<button class="danger" data-action="note-del" data-id="${n.id}">삭제</button>` : ''}
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="note-save" data-id="${n ? n.id : ''}">저장</button>
    </div>`);
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
// Big3 항목의 완수 여부는 실제 카드 상태를 진실의 원천으로 사용 → 어느 날짜에서 완료해도 모든 날에 반영
function tbDone(b) {
  if (!b) return false;
  if (b.cardId) { const c = state.cards.find(x => x.id === b.cardId); if (c) return c.status === 'done'; }
  return !!b.done;
}
function tbShift(n) {
  const [y, m, dd] = (state.sel.tboxDate || todayStr()).split('-').map(Number);
  state.sel.tboxDate = dstr(new Date(y, m - 1, dd + n));
  tbSel = null; render();
}
function renderTbox() {
  const date = state.sel.tboxDate || todayStr();
  state.sel.tboxDate = date;
  const d = tbData(date);
  const isToday = date === todayStr();
  const offset = dday(date);                                   // 0=오늘, 양수=미래, 음수=과거
  const inPlanWindow = offset >= 0 && offset <= TB_PLAN_DAYS - 1;   // 오늘 ~ 오늘+4
  const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(date + 'T00:00:00').getDay()];
  const rows = [0, 1, 2].map(i => {
    const b = d.big3[i], c = TBOX_COLORS[i];
    if (!b) return `<div class="tb-big3-row empty" data-idx="${i}"><span class="tb-chip" style="background:${c.bg}"></span><span class="tb-empty-txt">Brain Dump에서 여기로 드래그</span></div>`;
    const sum = tbSum(d, i);
    const hasActual = b.actual !== undefined && b.actual !== null && b.actual !== '';
    const diff = hasActual ? Math.round((b.actual - sum) * 100) / 100 : null;
    const diffHtml = !hasActual ? '' :
      diff > 0 ? `<span class="tb-diff over">+${diff}h 초과</span>` :
      diff < 0 ? `<span class="tb-diff under">${diff}h 단축</span>` :
      `<span class="tb-diff even">정확</span>`;
    const done = tbDone(b);
    return `<div class="tb-big3-row ${tbSel === i ? 'sel' : ''} ${done ? 'done' : ''}" data-idx="${i}" data-action="tb-select" title="클릭=선택 후 시간 칸 드래그로 배정">
      <span class="tb-chip" style="background:${c.bg}"></span>
      <input type="checkbox" data-action="tb-check" data-idx="${i}" ${done ? 'checked' : ''} title="완수 처리 (보드에도 반영)">
      <span class="tb-title">${esc(b.title)}</span>
      <span class="tb-sum">${sum ? '계획 ' + sum + 'h' : ''}</span>
      <span class="tb-actual-wrap" title="실제 소요 시간 기록">실제 <input type="number" class="tb-actual-input" data-idx="${i}" step="0.5" min="0" placeholder="-" value="${hasActual ? b.actual : ''}">h</span>
      ${diffHtml}
      <button class="tb-x" data-action="tb-remove" data-idx="${i}" title="Big3에서 빼기 (배정 시간도 삭제)">✕</button>
    </div>`;
  }).join('');
  let dumpHtml;
  if (inPlanWindow) {
    const dump = state.cards.filter(c => c.status !== 'done');
    const sub = isToday ? '미완료 To-do 전체 — Big3로 드래그' : `D+${offset} · ${offset}일 뒤 계획 — 현재 미완료 To-do를 미리 배치`;
    dumpHtml = `<div class="tb-sec-h" style="margin-top:16px">Brain Dump <span class="cnt">${dump.length}</span><span class="dash-sub">${sub}</span></div>
      <div class="tb-dump">${dump.map(c => {
        const b = c.project ? boardById(c.project) : null;
        const g = b && b.group ? groupById(b.group) : null;
        const pr = PRIORITIES[c.priority] || PRIORITIES.none;
        const inBig = d.big3.some(x => x && x.cardId === c.id);
        return `<div class="tb-dump-item ${inBig ? 'in-big' : ''}" draggable="true" data-id="${c.id}" title="${esc((g ? g.name + ' · ' : '') + (b ? b.name : '미배정'))}">
          <span class="drow-prio" style="${pr.bg ? 'background:' + pr.bg : ''}"></span>
          ${g ? `<span class="drow-proj c-${g.color}">${esc(g.name)}</span>` : ''}
          <span class="tb-dump-t">${esc(c.title)}</span>${inBig ? '<span class="tb-star">★</span>' : ''}
        </div>`;
      }).join('') || '<div class="empty">미완료 할 일이 없어요 👍</div>'}
      </div>
      <form class="quick" data-project="__inbox"><input name="t" placeholder="+ 쏟아내기 — 미배정 할 일로 추가" autocomplete="off"></form>`;
  } else {
    const msg = offset > 0
      ? `📅 ${TB_PLAN_DAYS}일 이후 날짜입니다 · 가까운 날짜에서 계획하세요`
      : '📖 지난 날짜의 타임박스입니다';
    dumpHtml = `<div class="tb-note-past">${msg} · <button class="mini-btn" data-action="tbox-today">오늘로 이동</button></div>`;
  }
  let grid = '<div class="tb-grid" id="tb-grid"><div class="tb-grid-h"><span></span><span>:00</span><span>:30</span></div>';
  for (let h = 6; h < 24; h++) {
    const cell = half => {
      const k = h + '.' + half;
      const v = d.slots[k];
      return `<div class="tb-cell" data-slot="${k}" ${v !== undefined ? `style="background:${TBOX_COLORS[v].bg};color:${TBOX_COLORS[v].fg}"` : ''}>${v !== undefined ? v + 1 : ''}</div>`;
    };
    grid += `<div class="tb-row"><span class="tb-hour">${h}</span>${cell(0)}${cell(5)}</div>`;
  }
  grid += '</div>';
  const selB = tbSel !== null ? d.big3[tbSel] : null;
  const hint = selB ? `<b>${esc(selB.title)}</b> 배정 중 — 시간 칸을 드래그하세요 (칠한 칸 다시 드래그=지우기)` : 'Big 3 행을 클릭해 선택 → 오른쪽 시간 칸을 드래그해 배정';
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
  if (tbPaint.erase) {
    if (d.slots[k] === tbSel) { delete d.slots[k]; cell.style.background = ''; cell.style.color = ''; cell.textContent = ''; }
  } else {
    d.slots[k] = tbSel;
    cell.style.background = TBOX_COLORS[tbSel].bg;
    cell.style.color = TBOX_COLORS[tbSel].fg;
    cell.textContent = tbSel + 1;
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
      big3.push({ title: b.title, done: tbDone(b), plan, actual });
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
  pushMonth(today);
  feed += jrDayCard(today, journalDerive(today), state.journal[today], true);
  shown.forEach(d => { pushMonth(d); feed += jrDayCard(d, state.journal[d].auto, state.journal[d], false); });
  const moreBtn = pastDates.length > limit ? `<button class="pill jr-more" data-action="jr-more">+ 이전 일지 더 보기 (${pastDates.length - limit}일)</button>` : '';
  const keyBtn = `<button class="jr-mini jr-key-btn" data-action="jr-key">🔑 AI 키 ${geminiKey() ? '✓' : '설정'}</button>`;
  return `<div class="journal">
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

/* ---------- render ---------- */
function render() {
  let view = state.sel.view || 'board';
  if (view === 'devlog' && !isAdmin()) view = 'board';
  const vbtn = (k, label) => `<button class="${view === k ? 'on' : ''}" data-action="view" data-view="${k}">${label}</button>`;
  const nav = vbtn('dash', '현황') + vbtn('map', '구조도') + vbtn('board', '보드') + vbtn('tbox', '타임박스') + vbtn('notes', '기록') + vbtn('journal', '일지') + vbtn('cal', '달력') + (isAdmin() ? vbtn('devlog', '개발일지') : '');
  document.getElementById('app').classList.toggle('wide', view === 'map');
  document.getElementById('app').innerHTML = `
    <header>
      <h1>업무 보드</h1>
      <nav class="views">${nav}</nav>
      <span class="week-count">이번 주 ${weekDone()}개 완료</span>
    </header>
    ${view === 'map' ? renderMap() : view === 'cal' ? renderCal() : view === 'devlog' ? renderDevlog() : view === 'dash' ? renderDash() : view === 'notes' ? renderNotes() : view === 'journal' ? renderJournal() : view === 'tbox' ? renderTbox() : renderBoardView()}
    <footer>
      <button data-action="restore-open">🛟 백업·복원</button>
      <button data-action="export">JSON 내보내기</button>
      <button data-action="import">가져오기</button>
      <button data-action="ics" title="Google Calendar에서 '설정 > 가져오기'로 등록">.ics 내보내기</button>
      <button data-action="samples">샘플 불러오기</button>
      ${CLOUD && authUser && GCAL_OK ? `<button data-action="gcal-sync" title="마감일 카드·프로젝트 기간을 구글 '업무 보드' 캘린더로 push">📅 구글 캘린더 동기화</button>` : ''}
      ${CLOUD && authUser ? `<span class="sync-badge" title="${esc(authUser.email || '')}">☁ 동기화 중</span><button data-action="logout">로그아웃</button>` : ''}
    </footer>`;
  save();
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
function openCardModal(id) {
  const c = state.cards.find(x => x.id === id);
  if (!c) return;
  showModal(`
    <h3>포스트잇 수정</h3>
    ${c.createdAt ? `<div class="reg-date">🗓 등록일 ${fmtDate(c.createdAt)}</div>` : ''}
    <label>내용<input type="text" id="m-title" value="${esc(c.title)}"></label>
    <label>중요도${prioPicker(c.priority || 'med')}</label>
    <label>💬 메모 · FU (별도로 확인·기억할 것)<textarea id="m-note" rows="3" placeholder="예: 팀장 리뷰 후 재확인 / 자료 요청 대기중">${esc(c.note || '')}</textarea></label>
    <label>마감일 (선택)<input type="date" id="m-due" value="${c.due || ''}"></label>
    ${c.due ? `<a class="gcal-link" href="${gcalUrl((boardById(c.project) ? boardById(c.project).name + ' - ' : '') + c.title, c.due, nextDay(c.due))}" target="_blank" rel="noopener">＋ Google Calendar에 등록 (${fmtDate(c.due)} 종일)</a>` : ''}
    <div class="m-actions">
      <button class="danger" data-action="card-del" data-id="${c.id}">삭제</button>
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
    <div class="m-actions">
      ${only ? '' : `<button class="danger" data-action="board-del" data-id="${b.id}">보드 삭제</button>`}
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="board-save" data-id="${b.id}">저장</button>
    </div>`);
}
function openCalAddModal(date) {
  const opts = state.projects.map(b => `<option value="${b.id}" ${state.sel.lastBoard === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  showModal(`
    <h3>${fmtDate(date)} 할 일 추가</h3>
    <label>내용<input type="text" id="m-title" placeholder="예: 감사조서 리뷰"></label>
    <label>보드<select id="m-board">${opts}</select></label>
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
function groupOptions(selId, cur) {
  const opts = ['<option value="">— 미분류 —</option>']
    .concat((state.groups || []).map(g => `<option value="${g.id}" ${cur === g.id ? 'selected' : ''}>${esc(g.name)}</option>`));
  return `<select id="${selId}">${opts.join('')}</select>`;
}
function openProjModal(preGroup) {
  showModal(`
    <h3>보드 추가</h3>
    <label>이름<input type="text" id="m-title" placeholder="예: Issue log / 결산 지원"></label>
    <label>프로젝트 (분류)${groupOptions('m-group', preGroup || null)}</label>
    <div class="m-actions">
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="proj-save">추가</button>
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
  else if (act === 'caladd-save') {
    const t = document.getElementById('m-title').value.trim();
    if (t) {
      const board = document.getElementById('m-board').value;
      state.sel.lastBoard = board;
      state.cards.push({ id: uid(), project: board, title: t, status: 'todo', priority: document.getElementById('m-prio').dataset.val || 'med', due: el.dataset.date, doneAt: null, note: null, createdAt: todayStr() });
    }
    closeModal(); render();
  }
  else if (act === 'gcal-sync') syncGCal();
  else if (act === 'ics') icsExport();
  else if (act === 'samples') { if (confirm('회계 업무 샘플 보드 3개와 카드들을 추가할까요? (기존 데이터는 유지)')) loadSamples(); }
  else if (act === 'proj-add') openProjModal(el.dataset.group || null);
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
        c.status = b.done ? 'done' : 'todo'; c.doneAt = b.done ? todayStr() : null;
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
    render();
  }
  else if (act === 'dash-big3-go') { state.sel.view = 'tbox'; state.sel.tboxDate = todayStr(); render(); }
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
  else if (act === 'note-group') { state.sel.noteGroup = el.dataset.gid; render(); }
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
  else if (act === 'note-add') openNoteModal();
  else if (act === 'note-edit') openNoteModal(el.dataset.id);
  else if (act === 'note-todo') openNoteTodoModal(el.dataset.id);
  else if (act === 'note-save') {
    const title = document.getElementById('m-ntitle').value.trim();
    if (title) {
      const type = document.getElementById('m-ntype').value;
      const data = {
        type, title,
        date: document.getElementById('m-ndate').value || todayStr(),
        who: type === 'interview' ? (document.getElementById('m-nwho').value.trim() || null) : null,
        body: document.getElementById('m-nbody').value.trim() || null,
      };
      const id = el.dataset.id;
      if (id) { const n = state.notes.find(x => x.id === id); if (n) Object.assign(n, data); }
      else state.notes.push({ id: uid(), group: currentNoteGroup(), createdAt: todayStr(), ...data });
    }
    closeModal(); render();
  }
  else if (act === 'note-del') {
    state.notes = (state.notes || []).filter(x => x.id !== el.dataset.id);
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
  else if (act === 'dash-note-go') {
    const n = (state.notes || []).find(x => x.id === el.dataset.id);
    if (n) {
      state.sel.view = 'notes'; state.sel.noteGroup = n.group || ''; state.sel.noteType = '';
      render();
      const item = document.querySelector(`.note-item[data-id="${n.id}"]`);
      if (item) { item.scrollIntoView({ behavior: 'smooth', block: 'center' }); item.classList.add('flash'); setTimeout(() => item.classList.remove('flash'), 1500); }
    }
  }
  else if (act === 'board-group') { state.sel.boardGroup = el.dataset.gid; render(); }
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
    }
    closeModal(); render();
  }
  else if (act === 'card-del') {
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
    }
    closeModal(); render();
  }
  else if (act === 'board-del') {
    const id = el.dataset.id;
    state.projects.forEach(x => { if (x.parent === id) x.parent = boardById(id).parent || null; });
    state.projects = state.projects.filter(x => x.id !== id);
    state.cards = state.cards.filter(c => c.project !== id);
    closeModal(); render();
  }
  else if (act === 'proj-save') {
    const t = document.getElementById('m-title').value.trim();
    if (t) {
      const i = state.projects.length;
      const grp = document.getElementById('m-group') ? (document.getElementById('m-group').value || null) : null;
      state.projects.push({ id: 'p-' + uid(), name: t, color: RAMP[i % RAMP.length], parent: null, group: grp, x: 30 + (i % 4) * 180, y: 30 + Math.floor(i / 4) * 120 });
    }
    closeModal(); render();
  }
  else if (act === 'mapadd-save') {
    const t = document.getElementById('m-title').value.trim();
    if (t && pendingMapPos) {
      const i = state.projects.length;
      state.projects.push({ id: 'p-' + uid(), name: t, color: RAMP[i % RAMP.length], parent: null, group: pendingMapPos.group || null, x: pendingMapPos.x, y: pendingMapPos.y });
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
  else if (act === 'backup-now') { pushSnapshot(true); openRestoreModal(); }
  else if (act === 'restore-apply') {
    const ts = el.dataset.ts;
    const src = (CLOUD && authUser) ? backupSnaps : localSnaps();
    const snap = src.find(s => s.ts === ts);
    if (snap && confirm('이 시점 상태로 되돌릴까요?\n(현재 상태도 백업에 남아 다시 되돌릴 수 있어요)')) {
      pushSnapshot(true);                       // 현재 상태 먼저 백업
      state = JSON.parse(JSON.stringify(snap.state));
      state.sel = state.sel || { view: 'board' };
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
    if (confirm('현재 보드를 가져온 파일로 완전히 교체할까요?')) { data.sel = data.sel || { view: 'board' }; state = data; render(); }
  }).catch(() => alert('올바른 보드 JSON 파일이 아닙니다.'));
  e.target.value = '';
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
  document.querySelectorAll('.dragover,.over,.cal-drop').forEach(el => el.classList.remove('dragover', 'over', 'cal-drop'));
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
  const td = e.target.closest('.tb-dump-item');
  if (td) { dragItem = { kind: 'tbdump', id: td.dataset.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'tb'); return; }
  const chip = e.target.closest('.chip');
  if (chip && chip.dataset.id) { dragItem = { kind: 'cal', id: chip.dataset.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'cal'); return; }
  const c = e.target.closest('.card');
  if (c) { dragItem = { kind: 'card', id: c.dataset.id }; e.dataTransfer.setData('text/plain', c.dataset.id); return; }
  const bd = e.target.closest('.board-drag');
  if (bd) { dragItem = { kind: 'board', id: bd.dataset.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'board'); document.body.classList.add('dragging-board'); }
});
document.addEventListener('dragend', () => { dragItem = null; document.body.classList.remove('dragging-board'); clearDropHints(); });
document.addEventListener('dragover', e => {
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
  if (col) { e.preventDefault(); col.classList.add('dragover'); }
});
document.addEventListener('dragleave', e => {
  const col = e.target.closest('.col');
  if (col) col.classList.remove('dragover');
  const row = e.target.closest('.tb-big3-row');
  if (row && !row.contains(e.relatedTarget)) row.classList.remove('drop-into');
  const day = e.target.closest('.cal-day');
  if (day && !day.contains(e.relatedTarget)) day.classList.remove('cal-drop');
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
      if (confirm(`'${dragged.name}' 보드를 삭제할까요?${cardCnt ? `\n(포스트잇 ${cardCnt}개도 함께 삭제)` : ''}`)) {
        state.projects.forEach(x => { if (x.parent === draggedId) x.parent = dragged.parent || null; });
        state.projects = state.projects.filter(x => x.id !== draggedId);
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
  if (!col) return;
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
function gcalDesiredItems() {
  const items = {};   // key -> {title, start, end(exclusive)}
  state.cards.filter(c => c.status !== 'done' && c.due && c.project).forEach(c => {
    const b = boardById(c.project);
    items['c:' + c.id] = { title: `[${b ? b.name : ''}] ${c.title}`, start: c.due, end: nextDay(c.due) };
  });
  state.cards.filter(c => c.status !== 'done' && c.due && !c.project).forEach(c => {
    items['c:' + c.id] = { title: `[미배정] ${c.title}`, start: c.due, end: nextDay(c.due) };
  });
  (state.groups || []).forEach(g => (g.periods || []).forEach((p, i) => {
    if (p.start && p.end && p.start <= p.end) items[`g:${g.id}:${i}`] = { title: `📁 ${g.name}`, start: p.start, end: nextDay(p.end) };
  }));
  state.projects.filter(b => b.start && b.end && b.start <= b.end).forEach(b => {
    items['b:' + b.id] = { title: `[기간] ${b.name}`, start: b.start, end: nextDay(b.end) };
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
      const h = gcalHash(it.title + '|' + it.start + '|' + it.end);
      const cur = map[key];
      const payload = { summary: it.title, start: { date: it.start }, end: { date: it.end } };
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
  if (e.target.id === 'm-ntype') {
    const wrap = document.getElementById('m-who-wrap');
    if (wrap) wrap.style.display = e.target.value === 'interview' ? 'block' : 'none';
    // 신규 기록: 본문이 비었거나 다른 유형의 템플릿 그대로면 새 유형 템플릿으로 교체 (작성 내용은 보존)
    const body = document.getElementById('m-nbody');
    if (body && body.dataset.new === '1') {
      const cur = body.value.trim();
      const tpls = Object.values(NOTE_TEMPLATES).map(t => t.trim()).filter(Boolean);
      if (!cur || tpls.includes(cur)) body.value = NOTE_TEMPLATES[e.target.value] || '';
    }
  }
});

/* ---------- bootstrap ---------- */
if (CLOUD) {
  document.getElementById('app').innerHTML = '<div class="gate"><p class="gate-sub">연결 중…</p></div>';
  initCloud();
} else {
  render();
}
