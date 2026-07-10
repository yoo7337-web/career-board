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
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      render();
      applyingRemote = false;
      if (ensureDevlog()) { save(); render(); }
      pushSnapshot();
    } else {
      ensureDevlog();
      db.collection('boards').doc(uid).set({ state, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
  }, err => console.warn('snapshot error', err));
}
function authErr(e) {
  const c = e.code || '';
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
function boardFilterActive() { return Array.isArray(state.sel.boardFilter) && state.sel.boardFilter.length > 0; }
function boardGroupVisible(gid) { return !boardFilterActive() || state.sel.boardFilter.includes(gid || ''); }
function boardFilterBar() {
  const groups = state.groups || [];
  if (!groups.length) return '';
  const sel = state.sel.boardFilter, active = boardFilterActive();
  const pill = (gid, name, color) => `<button class="fpill ${active && sel.includes(gid) ? 'on c-' + color : ''}" data-action="board-filter" data-gid="${gid}">${esc(name)}</button>`;
  return `<div class="cal-filter"><span class="fl-label">프로젝트별 보기</span>
    <button class="fpill ${!active ? 'on' : ''}" data-action="board-filter" data-gid="__all">전체</button>
    ${groups.map(g => pill(g.id, '📁 ' + g.name, g.color)).join('')}
    ${pill('', '미분류', 'gray')}
  </div>`;
}
function renderBoardView() {
  const groups = state.groups || [];
  const sections = [];
  groups.forEach(g => {
    if (!boardGroupVisible(g.id)) return;
    const items = orderedBoardsIn(g.id);
    sections.push(`<div class="group-sec" data-group="${g.id}">
      <div class="group-head"><span class="gname c-${g.color}" data-action="group-edit" data-id="${g.id}" title="클릭=프로젝트 이름·삭제">📁 ${esc(g.name)}</span><span class="gcnt">보드 ${items.length}</span><button class="mini-btn" data-action="proj-add" data-group="${g.id}">+ 보드</button></div>
      ${items.length ? `<div class="boards">${items.map(({ board, depth }) => panelHtml(board, depth)).join('')}</div>` : '<div class="empty droptip">여기로 보드를 끌어오면 이 프로젝트 소속 · 또는 [+ 보드]</div>'}
    </div>`);
  });
  if (boardGroupVisible('')) {
    const un = orderedBoardsIn(null);
    sections.push(`<div class="group-sec" data-group="">
      ${groups.length ? `<div class="group-head"><span class="gname plain">📄 미분류</span><span class="gcnt">보드 ${un.length}</span></div>` : ''}
      ${un.length ? `<div class="boards">${un.map(({ board, depth }) => panelHtml(board, depth)).join('')}</div>`
        : `<div class="empty droptip">${groups.length ? '여기로 끌어오면 미분류(프로젝트 없음)로 이동' : '보드가 없어요 — [+ 보드 추가]'}</div>`}
    </div>`);
  }
  const inbox = state.cards.filter(c => !c.project && c.status !== 'done');
  const inboxHtml = `<section class="inbox">
    <div class="group-head"><span class="gname c-amber">📥 미배정 · 예정</span><span class="gcnt">${inbox.length}</span><span class="dash-sub">보드에 넣기 전 임시 보관 — 카드를 보드로 드래그</span></div>
    <div class="col inbox-col" data-status="todo" data-inbox="1">
      ${inbox.map(cardHtml).join('')}
      <form class="quick" data-project="__inbox"><input name="t" placeholder="+ 예정 할 일 추가하고 Enter" autocomplete="off"></form>
    </div>
  </section>`;
  return legendHtml()
    + boardFilterBar()
    + `<div class="addbar"><button class="pill" data-action="group-add">📁 + 프로젝트 추가</button><button class="pill" data-action="proj-add">+ 보드 추가</button><span class="board-hint">보드 드래그: 다른 보드 위=앞 순서 / 가운데=하위로 / 아래=뒤 순서 · 프로젝트 영역=편입 · 왼쪽=분리 · 오른쪽=삭제</span></div>`
    + inboxHtml
    + sections.join('')
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
  return `<section class="dash-sec ${o.full ? 'full' : ''}" ${o.id ? `id="${o.id}"` : ''}>
    <div class="dash-sec-head"><h2>${title} <span class="cnt">${cards.length}</span></h2><span class="dash-sub">${sub}</span></div>
    <div class="dash-list">${body}</div>
  </section>`;
}
function dashOffDay(off) { const [y, m, d] = todayStr().split('-').map(Number); return dstr(new Date(y, m - 1, d + off)); }
function trendHtml() {
  const days = [];
  let max = 1;
  for (let i = 6; i >= 0; i--) {
    const ds = dashOffDay(-i);
    const reg = state.cards.filter(c => c.createdAt === ds).length;
    const done = state.cards.filter(c => c.doneAt === ds).length;
    max = Math.max(max, reg, done);
    days.push({ ds, reg, done, isToday: i === 0 });
  }
  const dows = ['일', '월', '화', '수', '목', '금', '토'];
  const bar = (n, cls) => `<div class="tb ${cls}" style="height:${Math.round(n / max * 100)}%">${n ? `<i>${n}</i>` : ''}</div>`;
  const cols = days.map(d => {
    const [y, m, dd] = d.ds.split('-').map(Number);
    const dow = dows[new Date(y, m - 1, dd).getDay()];
    return `<div class="trend-day ${d.isToday ? 'today' : ''}">
      <div class="tb-area">${bar(d.reg, 'tb-reg')}${bar(d.done, 'tb-done')}</div>
      <div class="tb-lbl">${dow}<br>${m}/${dd}</div>
    </div>`;
  }).join('');
  return `<section class="dash-sec trend">
    <div class="dash-sec-head"><h2>📈 주간 등록·완수 추이</h2>
      <span class="trend-legend"><span class="tl"><i class="tb-reg"></i>등록</span><span class="tl"><i class="tb-done"></i>완수</span></span></div>
    <div class="trend-chart">${cols}</div>
  </section>`;
}
function recentRegHtml(cards) {
  if (!cards.length) return '<div class="empty">최근 3일간 등록된 업무가 없어요</div>';
  const today = todayStr();
  const label = ds => ds === today ? '오늘' : ds === dashOffDay(-1) ? '어제' : '그제';
  let html = '', last = null;
  cards.forEach(c => {
    if (c.createdAt !== last) { last = c.createdAt; html += `<div class="dash-day-div">${label(c.createdAt)} · ${fmtDate(c.createdAt)}</div>`; }
    html += dashRow(c);
  });
  return html;
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
  return `<section class="dash-sec"><div class="dash-sec-head"><h2>📝 최근 기록 <span class="cnt">${notes.length}</span></h2><span class="dash-sub">기록 탭 최신 3건</span></div>
    <div class="dash-list">${notes.length ? notes.map(row).join('') : '<div class="empty">기록 탭에서 인터뷰·진행상황을 남겨보세요</div>'}</div>
  </section>`;
}
function renderDash() {
  const today = todayStr();
  const cards = state.cards;
  const incomplete = cards.filter(c => c.status !== 'done');
  const doing = cards.filter(c => c.status === 'doing');
  const urgent = incomplete.filter(isUrgent).sort(dueSort);
  const registeredToday = cards.filter(c => c.createdAt === today);
  const d2 = dashOffDay(-2);
  const registeredRecent = cards.filter(c => c.createdAt && c.createdAt >= d2)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const recentDone = cards.filter(c => c.status === 'done' && c.doneAt).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  const upcoming = incomplete.filter(c => c.due && dday(c.due) > 3).sort((a, b) => a.due.localeCompare(b.due));
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
  return `<div class="dash">
    <div class="dash-kpis">
      ${kpi('오늘 등록', registeredToday.length, 'k-new', 'sec-new')}
      ${kpi('진행 중', doing.length, 'k-doing', 'sec-doing')}
      ${kpi('급한 일', urgent.length, 'k-urgent', 'sec-urgent')}
      ${kpi('이번 주 완수', weekDone(), 'k-done', 'sec-done')}
      ${kpi('전체 미완료', incomplete.length, '', 'sec-urgent')}
    </div>
    ${trendHtml()}
    ${dashSection('🔥 급한 업무', '마감 임박·지남 또는 중요도 높음', urgent, '급한 업무가 없어요 👍', 12, { full: true, id: 'sec-urgent' })}
    <div class="dash-grid">
      ${dashSection('▶ 진행 중', '지금 하고 있는 일', doing, '진행 중인 업무가 없어요', 12, { id: 'sec-doing' })}
      ${dashSection('🆕 최근 3일 등록', '등록일 기준', registeredRecent, '', 0, { id: 'sec-new', rowsHtml: recentRegHtml(registeredRecent) })}
      ${dashSection('✓ 최근 완수', '최근 완료한 업무', recentDone, '완료 내역이 없어요', 10, { id: 'sec-done' })}
      ${dashSection('📅 예정', '마감일이 남은 업무', upcoming, '예정된 업무가 없어요', 10)}
      ${recentNotesSec()}
      ${gpRows.length ? `<section class="dash-sec"><div class="dash-sec-head"><h2>📊 프로젝트 진행률 <span class="cnt">${gpRows.length}</span></h2><span class="dash-sub">완수/전체</span></div><div class="dash-list">${gpRows.join('')}</div></section>` : ''}
    </div>
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
  return `<div class="note-item" data-action="note-edit" data-id="${n.id}" data-text="${searchText}">
    <div class="note-head">
      ${noteTypeBadge(n.type)}
      <span class="note-date">${n.date ? fmtDate(n.date) : ''}</span>
      <span class="note-title">${esc(n.title)}</span>
      ${n.who ? `<span class="note-who">🎤 ${esc(n.who)}</span>` : ''}
      <button class="mini-btn note-todo-btn" data-action="note-todo" data-id="${n.id}" title="이 기록에서 할 일 만들기">→ To-do</button>
    </div>
    ${n.body ? `<div class="note-body">${esc(n.body)}</div>` : ''}
  </div>`;
}
function renderNotes() {
  const groups = state.groups || [];
  const gid = currentNoteGroup();
  const g = gid ? groupById(gid) : null;
  const gname = g ? g.name : '미분류';
  const pills = groups.map(x => `<button class="fpill ${gid === x.id ? 'on c-' + x.color : ''}" data-action="note-group" data-gid="${x.id}">📁 ${esc(x.name)}</button>`).join('')
    + `<button class="fpill ${gid === '' ? 'on c-gray' : ''}" data-action="note-group" data-gid="">미분류</button>`;
  const overview = g ? (g.overview || '') : (state.unGroupOverview || '');
  const tsel = state.sel.noteType || '';
  const typePills = `<button class="fpill ${!tsel ? 'on' : ''}" data-action="note-type" data-t="">전체</button>`
    + Object.entries(NOTE_TYPES).map(([k, v]) => `<button class="fpill ${tsel === k ? 'on c-' + v.color : ''}" data-action="note-type" data-t="${k}">${v.icon} ${v.label}</button>`).join('');
  const notes = (state.notes || [])
    .filter(n => (n.group || '') === gid && (!tsel || n.type === tsel))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  return `<div class="notes">
    <div class="cal-filter"><span class="fl-label">프로젝트</span>${pills}</div>
    <div class="note-overview" data-action="overview-edit" title="클릭해서 수정">
      <div class="no-head">📌 ${esc(gname)} 개요</div>
      ${overview ? `<div class="no-body">${esc(overview)}</div>` : '<div class="no-empty">프로젝트 핵심 현황·컨택포인트·주의사항을 적어두세요 (클릭)</div>'}
    </div>
    <div class="note-toolbar">
      ${typePills}
      <input type="search" id="note-q" placeholder="🔍 기록 검색" autocomplete="off">
      <button class="pill" data-action="note-add">+ 기록 추가</button>
    </div>
    <div class="note-list">${notes.length ? notes.map(noteItemHtml).join('') : '<div class="empty">아직 기록이 없어요 — [+ 기록 추가]로 인터뷰·회의·진행상황을 남겨보세요</div>'}</div>
  </div>`;
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
    <label>내용<textarea id="m-nbody" rows="6" placeholder="들은 내용, 확인한 사항, 다음 단계 등">${n ? esc(n.body || '') : ''}</textarea></label>
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
  const nav = vbtn('dash', '현황') + vbtn('map', '구조도') + vbtn('board', '보드') + vbtn('notes', '기록') + vbtn('cal', '달력') + (isAdmin() ? vbtn('devlog', '개발일지') : '');
  document.getElementById('app').classList.toggle('wide', view === 'map');
  document.getElementById('app').innerHTML = `
    <header>
      <h1>업무 보드</h1>
      <nav class="views">${nav}</nav>
      <span class="week-count">이번 주 ${weekDone()}개 완료</span>
    </header>
    ${view === 'map' ? renderMap() : view === 'cal' ? renderCal() : view === 'devlog' ? renderDevlog() : view === 'dash' ? renderDash() : view === 'notes' ? renderNotes() : renderBoardView()}
    <footer>
      <button data-action="restore-open">🛟 백업·복원</button>
      <button data-action="export">JSON 내보내기</button>
      <button data-action="import">가져오기</button>
      <button data-action="ics" title="Google Calendar에서 '설정 > 가져오기'로 등록">.ics 내보내기</button>
      <button data-action="samples">샘플 불러오기</button>
      ${CLOUD && authUser ? `<span class="sync-badge" title="${esc(authUser.email || '')}">☁ 동기화 중</span><button data-action="logout">로그아웃</button>` : ''}
    </footer>`;
  save();
  if (view === 'map') initMap();
  if (view === 'cal') markCalOverflow();
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
  else if (act === 'signup') { doAuth('signup'); }
  else if (act === 'logout') { if (window.firebase) firebase.auth().signOut(); }
  else if (act === 'view') { state.sel.view = el.dataset.view; render(); }
  else if (act === 'map-arrange') { autoLayout(); render(); }
  else if (act === 'kpi-go') {
    const sec = document.getElementById(el.dataset.target);
    if (sec) { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); sec.classList.add('flash'); setTimeout(() => sec.classList.remove('flash'), 1500); }
  }
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
  else if (act === 'note-group') { state.sel.noteGroup = el.dataset.gid; render(); }
  else if (act === 'note-type') { state.sel.noteType = el.dataset.t; render(); }
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
  else if (act === 'board-filter') {
    const gid = el.dataset.gid;
    if (gid === '__all') state.sel.boardFilter = [];
    else {
      let f = Array.isArray(state.sel.boardFilter) ? state.sel.boardFilter.slice() : [];
      f.includes(gid) ? (f = f.filter(x => x !== gid)) : f.push(gid);
      state.sel.boardFilter = f;
    }
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
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
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
  const again = inbox ? document.querySelector('.inbox-col .quick input') : document.querySelector(`.board-panel[data-board="${form.dataset.project}"] .quick input`);
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
  const chip = e.target.closest('.chip');
  if (chip && chip.dataset.id) { dragItem = { kind: 'cal', id: chip.dataset.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'cal'); return; }
  const c = e.target.closest('.card');
  if (c) { dragItem = { kind: 'card', id: c.dataset.id }; e.dataTransfer.setData('text/plain', c.dataset.id); return; }
  const bd = e.target.closest('.board-drag');
  if (bd) { dragItem = { kind: 'board', id: bd.dataset.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'board'); document.body.classList.add('dragging-board'); }
});
document.addEventListener('dragend', () => { dragItem = null; document.body.classList.remove('dragging-board'); clearDropHints(); });
document.addEventListener('dragover', e => {
  if (dragItem && dragItem.kind === 'cal') {
    const day = e.target.closest('.cal-day');
    if (day) { e.preventDefault(); day.classList.add('cal-drop'); }
    return;
  }
  if (dragItem && dragItem.kind === 'board') {
    const lane = e.target.closest('.detach-lane,.delete-lane');
    if (lane) { e.preventDefault(); lane.classList.add('over'); return; }
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
  const day = e.target.closest('.cal-day');
  if (day && !day.contains(e.relatedTarget)) day.classList.remove('cal-drop');
  const lane = e.target.closest('.detach-lane,.delete-lane');
  if (lane && !lane.contains(e.relatedTarget)) lane.classList.remove('over');
  const sec = e.target.closest('.group-sec');
  if (sec && !sec.contains(e.relatedTarget)) sec.classList.remove('drop-into');
  const panel = e.target.closest('.board-panel');
  if (panel && !panel.contains(e.relatedTarget)) panel.classList.remove('drop-before', 'drop-after', 'drop-nest');
});
document.addEventListener('drop', e => {
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
    if (e.target.closest('.detach-lane')) {
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
  if (e.target.id === 'm-ntype') {
    const wrap = document.getElementById('m-who-wrap');
    if (wrap) wrap.style.display = e.target.value === 'interview' ? 'block' : 'none';
  }
});

/* ---------- bootstrap ---------- */
if (CLOUD) {
  document.getElementById('app').innerHTML = '<div class="gate"><p class="gate-sub">연결 중…</p></div>';
  initCloud();
} else {
  render();
}
