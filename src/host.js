// 진행자(관리자) 화면: 문제 큐 · 현재 문제 컨트롤 · 실시간 응답 · 현실 퀴즈 점수 · 참가자/팀/점수 수정
import { io } from 'socket.io-client';
import { fmtScore, PHASE } from '../shared/constants.js';

const $ = (s) => document.querySelector(s);
const socket = io();
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'quiz_host_key', getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const TEAMC = ['#ccc', '#ff6b6b', '#4a86d9', '#4fd16a', '#f2c230', '#9a62d6', '#ff9a3c', '#4fc9c9', '#c0c0c0'];
const phaseName = { [PHASE.LOBBY]: '대기', [PHASE.READING]: '읽는 중', [PHASE.MOVING]: '응답 중', [PHASE.HOLD]: '시간 종료 · 공개 대기', [PHASE.REAL]: '현실 퀴즈', [PHASE.REVEAL]: '정답 공개됨' };
let info = { questions: [], teamCount: 0, log: [] }, curId = null, st = null, askId = null, doneIds = new Set(), rankOn = false;
const emit = (ev, d) => socket.emit(ev, d || {});

function auth(key) {
  socket.emit('host:auth', key, (res) => {
    if (!res?.ok) { $('#auth').hidden = false; $('#app').hidden = true; $('#aerr').textContent = key ? '키가 맞지 않아요' : ''; return; }
    try { localStorage.setItem(KEY, key); } catch { /* 저장 불가 */ }
    ['#auth'].forEach((s) => { $(s).hidden = true; }); ['#app', '#topbar', '#log'].forEach((s) => { $(s).hidden = false; });
    setInfo(res);
  });
}
socket.on('connect', () => auth(getKey()));
$('#login').addEventListener('click', () => auth($('#key').value.trim()));
socket.on('host:info', setInfo);

function setInfo(i) { info = i; renderQuestions(); renderHistory(); $('#t-n').value = i.teamCount || $('#t-n').value; $('#log').innerHTML = (i.log || []).slice(0, 6).map((l) => `<span>${new Date(l.t).toTimeString().slice(0, 8)} ${esc(l.text)}</span>`).join('') || '<span style="opacity:.6">기록 없음</span>'; }

// ---------- 문제 큐 ----------
function renderQuestions() {
  $('#qlist').innerHTML = info.questions.map((q) => `
    <div class="q ${q.id === curId ? 'cur' : q.id === askId ? 'sel' : doneIds.has(q.id) ? 'done' : ''}">
      <i></i><span title="${esc(q.text)}">${q.id}. ${esc(q.text)}</span>
      <button class="chip ${q.mode === '팀' || q.mode === '대난투' || q.mode === '달력' ? 'c-team' : q.mode === '현실' ? 'c-real' : 'c-ind'}" data-mode="${q.id}" style="cursor:pointer;font-size:11px">${esc(q.mode)}</button>
      <button class="btn sm go" data-pick="${q.id}">${q.id === askId ? '✓ 선택됨' : '선택'}</button>
    </div>`).join('');
}
$('#qlist').addEventListener('click', (e) => {
  const m = e.target.closest('[data-mode]'), p = e.target.closest('[data-pick]');
  if (m) { const q = info.questions.find((x) => x.id === Number(m.dataset.mode)); if (q && q.type !== 'real' && q.type !== 'brawl' && q.type !== 'calendar') emit('host:setMode', { id: q.id, mode: q.mode === '팀' ? '개인' : '팀' }); }
  if (p) { askId = Number(p.dataset.pick); renderCurrent(); renderQuestions(); }
});
function renderCurrent() {
  const id = st?.q?.id && st.phase !== PHASE.LOBBY ? st.q.id : askId, q = info.questions.find((x) => x.id === id);
  $('#c-no').textContent = q ? `Q${q.id}` : '-'; $('#c-mode').textContent = q ? q.mode : '-'; $('#c-text').textContent = q ? q.text + (q.options ? '  ' + q.options.map((o, i) => `${i + 1}.${o}`).join(' ') : '') : '문제를 선택해 출제하세요';
  const nx = info.questions.find((x) => x.id === askId), live = st?.q?.id && st.phase !== PHASE.LOBBY; $('#c-next').hidden = !(live && nx && nx.id !== st.q.id); if (nx) $('#c-next').textContent = `다음 ▶ Q${nx.id} ${nx.text.slice(0, 24)}`;
  $('#ask').textContent = askId ? `▶ Q${askId} 출제` : '▶ 출제';
  const im = $('#c-img'); im.hidden = !q?.image; if (q?.image) im.style.backgroundImage = `url("${q.image}")`;
}
$('#ask').addEventListener('click', () => { if (!askId) return; emit('host:ask', { id: askId }); const ids = info.questions.map((q) => q.id), i = ids.indexOf(askId); askId = ids[i + 1] ?? askId; renderQuestions(); }); // 출제하면 다음 문제가 자동 선택됨
$('#gather2').addEventListener('click', () => emit('host:gather'));
$('#cal-fin').addEventListener('click', () => { if (confirm('지금 상태로 정산하고 끝낼까요?')) emit('host:calFinish'); });
$('#lobby').addEventListener('click', () => { const live = [PHASE.READING, PHASE.MOVING, PHASE.HOLD, PHASE.REAL].includes(st?.phase); if (!live || confirm('진행 중인 문제를 닫고 대기실로 갈까요? (점수 변화 없음)')) emit('host:lobby'); });
$('#end').addEventListener('click', () => emit('host:end'));
$('#hideans').addEventListener('click', () => emit('host:hideAns', { on: !st?.ha }));
$('#t-god').addEventListener('click', () => emit('host:god', { on: !st?.gd }));
$('#t-noatk').addEventListener('click', () => emit('host:noAtk', { on: !st?.ca }));
$('#t-noult').addEventListener('click', () => emit('host:noUlt', { on: !st?.cu }));
$('#rank').addEventListener('click', () => emit('host:rank', { on: !rankOn }));
$('#gather').addEventListener('click', () => emit('host:gather'));
$('#coin').addEventListener('click', () => emit('host:spawnCoin'));
$('#sbots').addEventListener('click', () => emit('host:addBot', { mode: 'wander', charId: 'random', count: 8 })); // 문제를 풀고 점수를 받는 봇
$('#abots').addEventListener('click', () => { emit('host:botAttack', { on: true }); emit('host:addBot', { mode: 'aggro', charId: 'random', count: 15 }); });
$('#b-clear').addEventListener('click', () => emit('host:clearBots'));
$('#sb-add').addEventListener('click', () => emit('host:addSandbags'));
$('#sb-del').addEventListener('click', () => emit('host:clearSandbags'));
$('#reset').addEventListener('click', () => { if (confirm('점수와 동전을 모두 초기화할까요?')) emit('host:reset'); });
$('#q-add').addEventListener('click', () => {
  const text = $('#q-text').value.trim(), type = $('#q-type').value; if (!text) return;
  const raw = $('#q-ans').value.trim().toUpperCase();
  emit('host:addQuestion', { type, text, mode: $('#q-mode').value, options: $('#q-opts').value.split(',').map((x) => x.trim()).filter(Boolean), answer: type === 'ox' ? raw : Number(raw), pts: type === 'brawl' ? Number(raw) : undefined, time: Number($('#q-time').value), image: $('#q-img').value.trim() });
  $('#q-text').value = ''; $('#q-img').value = '';
});

// ---------- 참가자 · 팀 · 점수 ----------
$('#t-auto').addEventListener('click', () => emit('host:teams', { n: Number($('#t-n').value) }));
$('#plist').addEventListener('click', (e) => { const b = e.target.closest('[data-adj]'); if (b) emit('host:adjust', { id: b.dataset.id, delta: Number(b.dataset.adj) }); });
$('#plist').addEventListener('change', (e) => { const s = e.target.closest('[data-team]'); if (s) emit('host:setTeam', { id: s.dataset.team, team: Number(s.value) }); });
$('#aw-go').addEventListener('click', () => {
  const who = $('#aw-who').value, n = Number($('#aw-n').value); if (!who || !n) return;
  if (who.startsWith('t:')) { for (const p of humans) if (String(p.tm) === who.slice(2)) emit('host:adjust', { id: p.id, delta: n }); } else emit('host:adjust', { id: who, delta: n });
});

// 점수 그리드 ±단계
$('#sgrid').addEventListener('click', (e) => { const b = e.target.closest('[data-sg]'); if (b) emit('host:adjust', { id: b.dataset.id, delta: Number(b.dataset.sg) * (Number($('#adj-step').value) || 1) }); });
// 팀 끌어놓기
let extraTeams = 0, dragging = false, dirtyBoard = false;
$('#t-add').addEventListener('click', () => { extraTeams++; renderBoard(); });
$('#tboard').addEventListener('dragstart', (e) => { const c = e.target.closest('[data-drag]'); if (!c) return; dragging = true; e.dataTransfer.setData('text/plain', c.dataset.drag); });
$('#tboard').addEventListener('dragend', () => { dragging = false; if (dirtyBoard) renderBoard(); });
$('#tboard').addEventListener('dragover', (e) => { const z = e.target.closest('[data-drop]'); if (z) { e.preventDefault(); z.classList.add('over'); } });
$('#tboard').addEventListener('dragleave', (e) => { e.target.closest('[data-drop]')?.classList.remove('over'); });
$('#tboard').addEventListener('drop', (e) => { const z = e.target.closest('[data-drop]'); if (!z) return; e.preventDefault(); z.classList.remove('over'); dragging = false; emit('host:setTeam', { id: e.dataTransfer.getData('text/plain'), team: Number(z.dataset.drop) }); });
function renderBoard() {
  if (dragging) { dirtyBoard = true; return; } dirtyBoard = false;
  const n = Math.min(8, Math.max(st?.teams?.length || 0, 2) + extraTeams), cols = Array.from({ length: n + 1 }, (_, t) => t);
  $('#tboard').innerHTML = cols.map((t) => `<div class="tc" data-drop="${t}" style="${t ? `border-color:${TEAMC[t]}` : ''}"><h4>${t ? `${t}팀` : '미배정'}</h4>${humans.filter((p) => (p.tm || 0) === t).map((p) => `<span class="chip" draggable="true" data-drag="${p.id}">${esc(p.n)}</span>`).join('')}</div>`).join('');
}
// 기록
function renderHistory() {
  const hs = [...(info.history || [])].reverse(); $('#hist-n').textContent = hs.length ? `${hs.length}건` : '';
  $('#hist').innerHTML = hs.map((h) => {
    const rows = [...h.rows].sort((a, b) => b.gain - a.gain), got = rows.filter((r) => r.gain), miss = rows.length - got.length;
    return `<details class="${h.undone ? 'un' : ''}"><summary>#${h.n} ${esc(h.title)} <small>${new Date(h.t).toTimeString().slice(0, 8)}${h.undone ? ' · 취소' : ''}</small></summary><div class="rw">${got.map((r) => `<span>${r.team ? `<i class="tm" style="background:${TEAMC[r.team]}"></i>` : ''}${esc(r.name)} <b>${r.gain > 0 ? '+' : ''}${fmtScore(r.gain)}</b></span>`).join('') || '<span style="opacity:.6">득점 없음</span>'}${miss > 0 && h.kind !== 'adj' ? `<span style="opacity:.6">0점 ${miss}명</span>` : ''}</div></details>`;
  }).join('') || '<div style="opacity:.6">기록 없음</div>';
}

// ---------- 현실 퀴즈 ----------
$('#realok').addEventListener('click', () => emit('host:realConfirm'));
$('#realrev').addEventListener('click', () => emit('host:realReveal'));
$('#real').addEventListener('change', (e) => { const i = e.target.closest('[data-real]'); if (i) emit('host:realSet', { id: i.dataset.real, pts: Number(i.value) || 0 }); });
$('#realteams').addEventListener('click', (e) => { const b = e.target.closest('[data-rt]'); if (b) { const pts = Number(prompt(`${b.dataset.rt}팀 전원에게 줄 점수`, '1')); if (pts) emit('host:realTeam', { team: Number(b.dataset.rt), pts }); } });

// 진행 도구
$('#t-pause').addEventListener('click', () => emit('host:pause', { on: !st?.tp }));
$('#t-m10').addEventListener('click', () => emit('host:addTime', { sec: -10 }));
$('#t-p10').addEventListener('click', () => emit('host:addTime', { sec: 10 }));
$('#t-undo').addEventListener('click', () => emit('host:undo'));
$('#t-x2').addEventListener('click', () => emit('host:x2', { on: st?.x2 !== 2 }));
$('#t-freeze').addEventListener('click', () => emit('host:freeze', { on: !st?.fz }));
$('#t-qr').addEventListener('click', () => emit('host:qr', { on: !st?.qr }));
$('#c-rain').addEventListener('click', () => emit('host:coinRain', { n: 24 }));
$('#q-cancel').addEventListener('click', () => { if (confirm('출제를 취소하고 대기실로 돌아갈까요? (점수 변화 없음)')) emit('host:cancel'); });
const step = (d) => { const ids = info.questions.map((q) => q.id); const i = ids.indexOf(askId ?? curId); askId = ids[Math.min(ids.length - 1, Math.max(0, (i < 0 ? 0 : i) + d))]; renderCurrent(); renderQuestions(); };
$('#q-next').addEventListener('click', () => step(1));
$('#q-prev').addEventListener('click', () => step(-1));
document.querySelectorAll('[data-screen]').forEach((b) => b.addEventListener('click', () => emit('host:screen', { mode: b.dataset.screen })));
$('#nt-go').addEventListener('click', () => { emit('host:announce', { text: $('#nt-text').value, sec: Number($('#nt-sec').value) }); });
$('#nt-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#nt-go').click(); });
$('#plist').addEventListener('click', (e) => {
  const n = e.target.closest('[data-name]'), k = e.target.closest('[data-kick]');
  if (n) { const v = prompt('새 이름', n.dataset.nm); if (v) emit('host:rename', { id: n.dataset.name, name: v }); }
  if (k && confirm(`${k.dataset.nm} 님을 내보낼까요?`)) emit('host:kick', { id: k.dataset.kick });
});

let humans = [], lastKey = '', realKey = '';
socket.on('state', (s) => {
  st = s; rankOn = !!s.rank;
  humans = s.players.filter((p) => p.ct); // 사람 + 점수 받는 테스트 봇
  $('#s-players').textContent = `${humans.length}명 접속`; $('#s-phase').textContent = (phaseName[s.phase] || '-') + (s.bw ? ` · ⚔ ${s.bw.p}명` : '') + (s.cal ? ` · 📅 ${s.cal.r}차 생존 ${s.cal.a}명` : '');
  $('#end').textContent = s.q?.type === 'calendar' ? '✓ 채점하기' : s.q?.type === 'brawl' ? '✓ 종료' : '✓ 정답 공개'; $('#cal-fin').hidden = !s.cal; $('#s-left').textContent = s.left > 0 ? `⏱ ${Math.ceil(s.left)}초` : '-';
  for (const [id, on] of [['hideans', s.ha], ['rank', rankOn], ['t-pause', s.tp], ['t-qr', s.qr], ['t-x2', s.x2 === 2], ['t-freeze', s.fz], ['t-god', s.gd], ['t-noatk', s.ca], ['t-noult', s.cu]]) $('#' + id).classList.toggle('on', !!on); // 스위치
  $('#t-undo').disabled = !s.ud;
  document.querySelectorAll('[data-screen]').forEach((b) => b.classList.toggle('on', b.dataset.screen === s.sm));
  $('#tools-state').textContent = [s.tp ? '타이머 정지됨' : '', s.x2 === 2 ? '점수 ×2' : '', s.gd ? '전원 무적' : '', s.ca ? '공격 금지' : '', s.cu ? '궁극기 금지' : '', s.fz ? '비상 정지 중' : ''].filter(Boolean).join(' · ');
  const prevCur = curId, prevDone = doneIds.size;
  if (s.q && s.phase !== PHASE.LOBBY) curId = s.q.id; else if (s.phase === PHASE.LOBBY) curId = null;
  if (s.phase === PHASE.REVEAL && s.q) doneIds.add(s.q.id);
  if (prevCur !== curId || prevDone !== doneIds.size) renderQuestions();
  $('#end').disabled = !(s.phase === PHASE.READING || s.phase === PHASE.MOVING || s.phase === PHASE.HOLD);
  $('#ask').disabled = s.phase === PHASE.READING || s.phase === PHASE.MOVING || s.phase === PHASE.HOLD;
  const total = s.q?.time || 15; $('#c-bar').style.width = s.phase === PHASE.MOVING ? `${(s.left / total) * 100}%` : '0%';
  renderCurrent();
  // 실시간 응답
  const dist = s.dist || (s.reveal && s.reveal.dist) || null, keys = s.q?.type === 'choice' ? [1, 2, 3, 4].slice(0, s.q.options?.length || 4) : ['O', 'X'], tot = Math.max(1, humans.length);
  $('#distbox').hidden = !s.q || s.q.type === 'real' || s.q.type === 'brawl' || s.q.type === 'calendar' || s.phase === PHASE.LOBBY;
  if (dist) { const sum = Object.values(dist).reduce((a, b) => a + b, 0), na = humans.length - (sum - (dist['-'] || 0)); $('#d-n').textContent = `${humans.length - na + (dist['-'] ? 0 : 0)} / ${humans.length}명 구역에 있음`;
    $('#dist').innerHTML = [...keys, '-'].map((k) => `<div class="dist"><b style="color:${k === 'O' || k === 1 ? '#4a86d9' : k === 'X' || k === 2 ? '#e5483c' : '#666'}">${k === '-' ? '—' : k}</b><div class="t"><i style="width:${((dist[k] || 0) / tot) * 100}%;background:${k === 'O' || k === 1 ? '#4a86d9' : k === 'X' || k === 2 ? '#e5483c' : k === 3 ? '#4fae55' : k === 4 ? '#e0902a' : '#8b8b8b'}"></i></div><span>${dist[k] || 0}</span></div>`).join(''); }
  // 현실 퀴즈 패널
  const real = s.phase === PHASE.REAL; $('#realbox').hidden = !real;
  if (real) {
    const k = humans.map((p) => p.id).join(), pend = Object.fromEntries((s.real?.pending || []).map((x) => [x.id, x.pts]));
    if (k !== realKey) { realKey = k; $('#real').innerHTML = humans.map((p) => `<div><span>${esc(p.n)}</span><input class="inp" type="number" step="0.5" data-real="${p.id}" value="${pend[p.id] ?? ''}" style="padding:3px 6px"></div>`).join(''); }
    $('#realteams').innerHTML = Array.from({ length: s.teams?.length || 0 }, (_, i) => `<button class="btn sm" data-rt="${i + 1}">${i + 1}팀 전원 +</button>`).join('');
    $('#realok').disabled = false; $('#realrev').disabled = !s.real?.confirmed; $('#realok').textContent = s.real?.confirmed ? '확인됨 ✓' : '확인';
  }
  // 참가자 표
  const lb = [...humans].sort((a, b) => b.sc - a.sc), key = JSON.stringify([lb.map((p) => [p.id, p.n, p.tm, p.sc, p.cn]), s.teams]);
  if (key !== lastKey) {
    lastKey = key; const tc = s.teams?.length || 0;
    $('#plist').innerHTML = lb.map((p, i) => `<div class="pl"><span>${i + 1}</span><span data-name="${p.id}" data-nm="${esc(p.n)}" style="cursor:pointer">${esc(p.n)} <small style="opacity:.6">🪙${p.cn}</small></span><select data-team="${p.id}">${['—', ...Array.from({ length: Math.max(tc, 3) }, (_, k) => `${k + 1}`)].map((t, k) => `<option value="${k}" ${p.tm === k ? 'selected' : ''}>${t}</option>`).join('')}</select><span>${fmtScore(p.sc)}</span><div class="stp"><b class="m" data-id="${p.id}" data-adj="-1">−</b><b class="p" data-id="${p.id}" data-adj="1">＋</b><b data-kick="${p.id}" data-nm="${esc(p.n)}" title="퇴장">✕</b></div></div>`).join('') || '<div style="opacity:.6">접속한 참가자가 없어요</div>';
    $('#sgrid').innerHTML = lb.map((p, i) => `<div class="sc" style="border-color:${p.tm ? TEAMC[p.tm] : 'var(--navy)'}"><span class="nm">${i + 1}. ${esc(p.n)}</span><b class="m" data-id="${p.id}" data-sg="-1">−</b><span class="pt">${fmtScore(p.sc)}</span><b class="p" data-id="${p.id}" data-sg="1">＋</b></div>`).join('') || '<div style="opacity:.6">접속한 참가자가 없어요</div>';
    renderBoard();
    $('#tt').innerHTML = (s.teams || []).map((t) => `<span class="pill" style="background:${TEAMC[t.t]}99">${t.t}팀 ${fmtScore(t.score)}</span>`).join('');
    $('#p-teams').textContent = tc ? `${tc}팀` : '팀 없음';
    $('#aw-who').innerHTML = `${(s.teams || []).map((t) => `<option value="t:${t.t}">${t.t}팀 전원</option>`).join('')}${lb.map((p) => `<option value="${p.id}">${esc(p.n)}</option>`).join('')}`;
  }
});
