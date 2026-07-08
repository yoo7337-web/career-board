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

const SEED = {
  projects: [
    { id: 'work-main', name: '회사 업무', color: 'blue', parent: null, x: 40, y: 40 },
  ],
  cards: [],
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

function save() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  if (CLOUD && db && authUser && !applyingRemote) {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      db.collection('boards').doc(authUser.uid)
        .set({ state, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
        .catch(e => console.warn('sync write failed', e));
    }, 600);
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
      if (user) subscribeBoard(user.uid);
      else { if (unsubDoc) { unsubDoc(); unsubDoc = null; } showAuthGate(); }
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
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      render();
      applyingRemote = false;
      if (ensureDevlog()) { save(); render(); }
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
  const check = c.status === 'done' ? '<span class="done-check">✓</span>' : '';
  return `<div class="card ${c.status}" ${style} draggable="true" data-id="${c.id}" data-action="card">
    <div class="t">${check}${esc(c.title)}</div>
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
      <span class="bname c-${b.color}" data-action="board-edit" data-id="${b.id}" title="클릭하면 이름·상위·삭제">${esc(b.name)}</span>
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

function renderBoardView() {
  const items = orderedBoards();
  return legendHtml()
    + `<div class="addbar"><button class="pill" data-action="proj-add">+ 보드 추가</button></div>`
    + `<div class="boards">${items.map(({ board, depth }) => panelHtml(board, depth)).join('')}</div>`;
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
function renderMap() {
  ensurePositions();
  const nodes = state.projects.map(b => `
    <div class="mapnode c-${b.color}" data-id="${b.id}" style="left:${b.x}px;top:${b.y}px">
      <div class="mapnode-name" data-action="board-edit" data-id="${b.id}">${esc(b.name)}</div>
      ${b.parent ? `<button class="mapnode-unlink" data-action="unlink" data-id="${b.id}" title="상위 연결 해제">×</button>` : ''}
      <div class="maphandle" data-id="${b.id}" title="여기서 다른 보드로 끌어 하위로 연결"></div>
    </div>`).join('');
  return `<div class="maphint">노드를 끌어 배치하고, 노드 아래쪽 파란 점을 다른 보드로 끌어놓으면 그 보드가 하위로 연결됩니다. 연결은 보드 뷰의 들여쓰기에 반영돼요.</div>
    <div class="map" id="map"><svg class="maplines" id="maplines"></svg>${nodes}</div>`;
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
  let paths = '';
  state.projects.forEach(b => {
    if (!b.parent) return;
    const p = anchor(b.parent), c = anchor(b.id);
    if (p && c) paths += `<path class="mapline" d="M ${p.cx} ${p.bottom} C ${p.cx} ${p.bottom + 36}, ${c.cx} ${c.top - 36}, ${c.cx} ${c.top}"/>`;
  });
  if (temp) paths += `<path class="mapline temp" d="M ${temp.x1} ${temp.y1} L ${temp.x2} ${temp.y2}"/>`;
  svg.innerHTML = paths;
}
function initMap() {
  const map = document.getElementById('map');
  if (!map) return;
  drawLines();
  let mode = null, id = null, offx = 0, offy = 0;
  map.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.maphandle');
    if (handle) { mode = 'link'; id = handle.dataset.id; map.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    if (e.target.closest('[data-action]')) return;
    const node = e.target.closest('.mapnode');
    if (node) {
      mode = 'move'; id = node.dataset.id;
      const b = boardById(id), mr = map.getBoundingClientRect();
      offx = (e.clientX - mr.left) - b.x; offy = (e.clientY - mr.top) - b.y;
      node.classList.add('dragging');
      map.setPointerCapture(e.pointerId);
    }
  });
  map.addEventListener('pointermove', e => {
    if (!mode) return;
    const mr = map.getBoundingClientRect();
    const px = e.clientX - mr.left, py = e.clientY - mr.top;
    if (mode === 'move') {
      const b = boardById(id);
      b.x = Math.max(0, Math.min(px - offx, map.clientWidth - 60));
      b.y = Math.max(0, Math.min(py - offy, map.clientHeight - 30));
      const el = map.querySelector(`.mapnode[data-id="${id}"]`);
      el.style.left = b.x + 'px'; el.style.top = b.y + 'px';
      drawLines();
    } else {
      const el = map.querySelector(`.mapnode[data-id="${id}"]`).getBoundingClientRect();
      drawLines({ x1: el.left - mr.left + el.width / 2, y1: el.top - mr.top + el.height, x2: px, y2: py });
    }
  });
  map.addEventListener('pointerup', e => {
    if (mode === 'link') {
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const tnode = t && t.closest ? t.closest('.mapnode') : null;
      if (tnode && tnode.dataset.id !== id) {
        const childId = tnode.dataset.id, parentId = id;
        if (!isAncestor(childId, parentId)) { boardById(childId).parent = parentId; }
      }
      render();
    } else if (mode === 'move') {
      const el = map.querySelector(`.mapnode[data-id="${id}"]`);
      if (el) el.classList.remove('dragging');
      save(); drawLines();
    }
    mode = null; id = null;
  });
}

/* ---------- calendar ---------- */
function chipHtml(c) {
  const pr = PRIORITIES[c.priority] || PRIORITIES.none;
  const b = boardById(c.project);
  const style = pr.bg ? `background:${pr.bg};color:${pr.fg}` : 'background:var(--bg);color:var(--muted)';
  const mark = c.status === 'done' ? '<i class="chk">✓</i>' : '<i class="bdot" style="background:currentColor;opacity:.55"></i>';
  return `<span class="chip ${c.status}" style="${style}" data-action="card" data-id="${c.id}" title="${esc((b ? b.name + ' · ' : '') + c.title)}">${mark}${esc(c.title)}</span>`;
}
function renderCal() {
  const ym = state.sel.calYm || todayStr().slice(0, 7);
  state.sel.calYm = ym;
  const [y, m] = ym.split('-').map(Number);
  const startDow = new Date(y, m - 1, 1).getDay();
  const today = todayStr();
  const cardsByDate = {};
  state.cards.forEach(c => {
    const d = c.due || (c.status === 'done' ? c.doneAt : null);
    if (d) (cardsByDate[d] = cardsByDate[d] || []).push(c);
  });
  const periodBoards = state.projects.filter(b => b.start && b.end && b.start <= b.end);
  let weeksHtml = '';
  for (let w = 0; w < 6; w++) {
    const wStart = new Date(y, m - 1, 1 - startDow + w * 7);
    const wEnd = new Date(y, m - 1, 1 - startDow + w * 7 + 6);
    const ws = dstr(wStart), we = dstr(wEnd);
    // period bars with greedy lane stacking
    const lanes = [];
    const bars = [];
    periodBoards.filter(b => b.start <= we && b.end >= ws).forEach(b => {
      const sIdx = b.start <= ws ? 0 : (new Date(b.start + 'T00:00:00') - wStart) / 864e5;
      const eIdx = b.end >= we ? 6 : (new Date(b.end + 'T00:00:00') - wStart) / 864e5;
      let lane = lanes.findIndex(endIdx => endIdx < sIdx);
      if (lane === -1) { lanes.push(eIdx); lane = lanes.length - 1; } else lanes[lane] = eIdx;
      if (lane > 2) return;
      bars.push(`<span class="cal-bar c-${b.color}" style="left:${sIdx / 7 * 100}%;width:${(eIdx - sIdx + 1) / 7 * 100}%;top:${lane * 19}px" data-action="board-edit" data-id="${b.id}" title="${esc(b.name)} ${fmtDate(b.start)}~${fmtDate(b.end)}">${esc(b.name)}</span>`);
    });
    const laneCnt = Math.min(lanes.length, 3);
    let cells = '';
    for (let d = 0; d < 7; d++) {
      const dt = new Date(y, m - 1, 1 - startDow + w * 7 + d);
      const ds = dstr(dt);
      const inMonth = dt.getMonth() === m - 1;
      const dayCards = cardsByDate[ds] || [];
      const chips = dayCards.slice(0, 3).map(chipHtml).join('');
      const more = dayCards.length > 3 ? `<span class="more">+${dayCards.length - 3}</span>` : '';
      cells += `<div class="cal-day ${inMonth ? '' : 'out'} ${ds === today ? 'today' : ''}" data-action="cal-add" data-date="${ds}" title="클릭하면 이 날짜로 할 일 추가">
        <span class="dnum ${d === 0 ? 'sun' : ''}">${dt.getDate()}</span>${chips}${more}</div>`;
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
      <span class="cal-hint">날짜 클릭 = 할 일 추가 · 막대 = 보드 수행기간(보드 설정) · 칩 = 마감일 포스트잇</span>
    </div>
    <div class="cal">
      <div class="cal-dow">${['일', '월', '화', '수', '목', '금', '토'].map((n, i) => `<span class="${i === 0 ? 'sun' : ''}">${n}</span>`).join('')}</div>
      ${weeksHtml}
    </div>`;
}
function calShift(n) {
  const [y, m] = (state.sel.calYm || todayStr().slice(0, 7)).split('-').map(Number);
  const dt = new Date(y, m - 1 + n, 1);
  state.sel.calYm = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  render();
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
  const nav = vbtn('map', '구조도') + vbtn('board', '보드') + vbtn('cal', '달력') + (isAdmin() ? vbtn('devlog', '개발일지') : '');
  document.getElementById('app').innerHTML = `
    <header>
      <h1>업무 보드</h1>
      <nav class="views">${nav}</nav>
      <span class="week-count">이번 주 ${weekDone()}개 완료</span>
    </header>
    ${view === 'map' ? renderMap() : view === 'cal' ? renderCal() : view === 'devlog' ? renderDevlog() : renderBoardView()}
    <footer>
      <button data-action="export">JSON 내보내기</button>
      <button data-action="import">가져오기</button>
      <button data-action="ics" title="Google Calendar에서 '설정 > 가져오기'로 등록">.ics 내보내기</button>
      <button data-action="samples">샘플 불러오기</button>
      ${CLOUD && authUser ? `<span class="sync-badge" title="${esc(authUser.email || '')}">☁ 동기화 중</span><button data-action="logout">로그아웃</button>` : ''}
    </footer>`;
  save();
  if (view === 'map') initMap();
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
    <label>내용<input type="text" id="m-title" value="${esc(c.title)}"></label>
    <label>중요도${prioPicker(c.priority || 'none')}</label>
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
    <label>중요도${prioPicker('none')}</label>
    <div class="m-actions">
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="caladd-save" data-date="${date}">추가</button>
    </div>`);
}
function openProjModal() {
  showModal(`
    <h3>보드 추가</h3>
    <label>이름<input type="text" id="m-title" placeholder="예: A프로젝트 / a 업무"></label>
    <div class="m-actions">
      <button class="ghost" data-action="modal-close">취소</button>
      <button class="primary" data-action="proj-save">추가</button>
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
    state.cards.push({ id: uid(), project, title, status: status || 'todo', priority, due: due || null, doneAt: status === 'done' ? d(doneOff ?? -1) : null });
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
  else if (act === 'cal-prev') calShift(-1);
  else if (act === 'cal-next') calShift(1);
  else if (act === 'cal-today') { state.sel.calYm = todayStr().slice(0, 7); render(); }
  else if (act === 'cal-add') openCalAddModal(el.dataset.date);
  else if (act === 'caladd-save') {
    const t = document.getElementById('m-title').value.trim();
    if (t) {
      const board = document.getElementById('m-board').value;
      state.sel.lastBoard = board;
      state.cards.push({ id: uid(), project: board, title: t, status: 'todo', priority: document.getElementById('m-prio').dataset.val || 'none', due: el.dataset.date, doneAt: null });
    }
    closeModal(); render();
  }
  else if (act === 'ics') icsExport();
  else if (act === 'samples') { if (confirm('회계 업무 샘플 보드 3개와 카드들을 추가할까요? (기존 데이터는 유지)')) loadSamples(); }
  else if (act === 'proj-add') openProjModal();
  else if (act === 'board-edit') openBoardModal(el.dataset.id);
  else if (act === 'card') openCardModal(el.dataset.id);
  else if (act === 'modal-close') closeModal();
  else if (act === 'unlink') { boardById(el.dataset.id).parent = null; render(); }
  else if (act === 'card-save') {
    const c = state.cards.find(x => x.id === el.dataset.id);
    if (c) {
      const t = document.getElementById('m-title').value.trim();
      if (t) c.title = t;
      c.priority = document.getElementById('m-prio').dataset.val || 'none';
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
      const par = document.getElementById('m-parent').value || null;
      if (par !== b.id && !isAncestor(b.id, par)) b.parent = par;
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
      state.projects.push({ id: 'p-' + uid(), name: t, color: RAMP[i % RAMP.length], parent: null, x: 30 + (i % 4) * 180, y: 30 + Math.floor(i / 4) * 120 });
    }
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
  state.cards.push({ id: uid(), project: form.dataset.project, title: t, status: 'todo', priority: 'none', due: null, doneAt: null });
  render();
  const again = document.querySelector(`.board-panel[data-board="${form.dataset.project}"] .quick input`);
  if (again) again.focus();
});

/* ---------- card drag & drop (across boards + columns) ---------- */
document.addEventListener('dragstart', e => {
  const c = e.target.closest('.card');
  if (c) e.dataTransfer.setData('text/plain', c.dataset.id);
});
document.addEventListener('dragover', e => {
  const col = e.target.closest('.col');
  if (col) { e.preventDefault(); col.classList.add('dragover'); }
});
document.addEventListener('dragleave', e => {
  const col = e.target.closest('.col');
  if (col) col.classList.remove('dragover');
});
document.addEventListener('drop', e => {
  const col = e.target.closest('.col');
  if (!col) return;
  e.preventDefault();
  const panel = col.closest('.board-panel');
  moveCard(e.dataTransfer.getData('text/plain'), col.dataset.status, panel ? panel.dataset.board : null);
});

/* ---------- bootstrap ---------- */
if (CLOUD) {
  document.getElementById('app').innerHTML = '<div class="gate"><p class="gate-sub">연결 중…</p></div>';
  initCloud();
} else {
  render();
}
