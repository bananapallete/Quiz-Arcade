import { autoReload } from './autoReload.js';
// 진행자(관리자) 화면: 문제 큐 · 현재 문제 컨트롤 · 실시간 응답 · 현실 퀴즈 점수 · 참가자/팀/점수 수정
import { io } from 'socket.io-client';
import { fmtScore, PHASE } from '../shared/constants.js';

const $ = (s) => document.querySelector(s);
const socket = io();
autoReload(socket);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'quiz_host_key', getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const TEAMC = ['#ccc', '#ff6b6b', '#4a86d9', '#4fd16a', '#f2c230', '#9a62d6', '#ff9a3c', '#4fc9c9', '#c0c0c0'];
const phaseName = { [PHASE.LOBBY]: '대기', [PHASE.READING]: '읽는 중', [PHASE.MOVING]: '응답 중', [PHASE.HOLD]: '시간 종료 · 공개 대기', [PHASE.REAL]: '현실 퀴즈', [PHASE.REVEAL]: '정답 공개됨' };
let info = { questions: [], teamCount: 0, log: [] }, curId = null, st = null, askId = null, doneIds = new Set();
const emit = (ev, d) => socket.emit(ev, d || {});

function auth(key) {
  socket.emit('host:auth', key, (res) => {
    if (!res?.ok) { $('#auth').hidden = false; $('#app').hidden = true; $('#aerr').textContent = key ? '키가 맞지 않아요' : ''; return; }
    try { localStorage.setItem(KEY, key); } catch { /* 저장 불가 */ }
    ['#auth'].forEach((s) => { $(s).hidden = true; }); ['#app', '#topbar', '#log', '#steps'].forEach((s) => { $(s).hidden = false; });
    setInfo(res);
  });
}
socket.on('connect', () => auth(getKey()));
$('#login').addEventListener('click', () => auth($('#key').value.trim()));
socket.on('host:info', setInfo);

function setInfo(i) { info = i; renderQuestions(); renderHistory(); renderRounds(); $('#log').innerHTML = (i.log || []).slice(0, 6).map((l) => `<span>${new Date(l.t).toTimeString().slice(0, 8)} ${esc(l.text)}</span>`).join('') || '<span style="opacity:.6">기록 없음</span>'; }

// ---------- 문제 큐 ----------
function renderQuestions() {
  $('#qlist').innerHTML = info.questions.map((q) => `
    <div class="q ${q.id === curId ? 'cur' : q.id === askId ? 'sel' : doneIds.has(q.id) ? 'done' : ''}">
      <i></i><span title="${esc(q.text)}">${q.id}. ${esc(q.text)}</span>
      ${q.type === 'coin' ? `<button class="chip c-team" data-coinmode="${q.id}" title="개인전 ↔ 팀전" style="font-size:11px;cursor:pointer">${esc(q.mode)} ⇄</button>` : `<span class="chip ${q.mode === '현실' ? 'c-real' : q.mode === '개인' || q.mode === '팀' ? 'c-ind' : 'c-team'}" style="font-size:11px">${esc(q.mode === '팀' ? '개인' : q.mode)}</span>`}
      <button class="btn sm go" data-pick="${q.id}">${q.id === askId ? '✓ 선택됨' : '선택'}</button>
    </div>`).join('');
}
$('#qlist').addEventListener('click', (e) => {
  const cm = e.target.closest('[data-coinmode]'); if (cm) { const q = info.questions.find((x) => x.id === Number(cm.dataset.coinmode)); emit('host:setMode', { id: q.id, mode: q.mode === '동전 팀' ? '개인' : '팀' }); return; } // 동전 모으기: 개인전 ↔ 팀전
  const p = e.target.closest('[data-pick]');
  if (p) { askId = Number(p.dataset.pick); renderCurrent(); renderQuestions(); }
});
function renderCurrent() {
  const id = st?.q?.id && st.phase !== PHASE.LOBBY ? st.q.id : askId, q = info.questions.find((x) => x.id === id);
  $('#c-no').textContent = q ? `Q${q.id}` : '-'; $('#c-mode').textContent = q ? q.mode : '-'; $('#c-text').textContent = q ? q.text + (q.options ? '  ' + q.options.map((o, i) => `${i + 1}.${o}`).join(' ') : '') : '문제를 선택해 출제하세요';
  const nx = info.questions.find((x) => x.id === askId), live = st?.q?.id && st.phase !== PHASE.LOBBY; $('#c-next').hidden = !(live && nx && nx.id !== st.q.id); if (nx) $('#c-next').textContent = `다음 ▶ Q${nx.id} ${nx.text.slice(0, 24)}`;
  $('#ask').textContent = askId ? `▶ Q${askId} 출제` : '▶ 출제';
  { const sel = info.questions.find((x) => x.id === askId); $('#qt-v').textContent = sel ? `${sel.time}초` : '-'; $('#qt-m').disabled = $('#qt-p').disabled = !sel || sel.type === 'real'; } // 고른 문제의 제한시간
  $('#premap').disabled = !askId; $('#premap').textContent = askId ? `🗺 Q${askId} 맵으로` : '🗺 맵으로 이동';
  const im = $('#c-img'); im.hidden = !q?.image; if (q?.image) im.style.backgroundImage = `url("${q.image}")`;
}
$('#ask').addEventListener('click', () => { if (!askId) return; if (st?.phase === PHASE.REAL && st.real?.pending?.length && !confirm('입력한 현실 퀴즈 점수가 사라져요. 출제할까요?')) return; emit('host:ask', { id: askId }); const ids = info.questions.map((q) => q.id), i = ids.indexOf(askId); askId = ids[i + 1] ?? askId; renderQuestions(); }); // 출제하면 다음 문제가 자동 선택됨
$('#premap').addEventListener('click', () => { if (!askId) return; const live = [PHASE.READING, PHASE.MOVING, PHASE.HOLD, PHASE.REAL].includes(st?.phase); if (!live || confirm('진행 중인 문제를 닫고 맵을 옮길까요? (점수 변화 없음)')) emit('host:previewMap', { id: askId }); }); // 선택한 문제의 맵으로 (대기실 상태)
const qt = (d) => { const q = info.questions.find((x) => x.id === askId); if (q) emit('host:setTime', { id: q.id, sec: q.time + d }); }; // 출제 전 제한시간 ±10초
$('#qt-m').addEventListener('click', () => qt(-10)); $('#qt-p').addEventListener('click', () => qt(10));
$('#vote').addEventListener('click', () => { const live = [PHASE.READING, PHASE.MOVING, PHASE.HOLD, PHASE.REAL].includes(st?.phase); if (!live || confirm('진행 중인 문제를 닫고 투표할까요?')) emit('host:vote', { sec: 15 }); }); // 다음 문제 투표
$('#cal-fin').addEventListener('click', () => { if (confirm('지금 상태로 정산하고 끝낼까요?')) emit('host:calFinish'); });
$('#lobby').addEventListener('click', () => { const live = [PHASE.READING, PHASE.MOVING, PHASE.HOLD, PHASE.REAL].includes(st?.phase); if (!live || confirm('진행 중인 문제를 닫고 대기실로 갈까요? (점수 변화 없음)')) emit('host:lobby'); });
$('#end').addEventListener('click', () => emit('host:end'));
$('#hideans').addEventListener('click', () => emit('host:hideAns', { on: !st?.ha }));
$('#t-god').addEventListener('click', () => emit('host:god', { on: !st?.gd }));
$('#t-noatk').addEventListener('click', () => emit('host:noAtk', { on: !st?.ca }));
$('#t-noult').addEventListener('click', () => emit('host:noUlt', { on: !st?.cu }));
$('#gather').addEventListener('click', () => emit('host:gather'));
$('#sbots').addEventListener('click', () => emit('host:addBot', { mode: 'wander', charId: 'random', count: 8 })); // 문제를 풀고 점수를 받는 봇
$('#abots').addEventListener('click', () => { emit('host:botAttack', { on: true }); emit('host:addBot', { mode: 'aggro', charId: 'random', count: 15 }); });
$('#b-clear').addEventListener('click', () => emit('host:clearBots'));
$('#sb-add').addEventListener('click', () => emit('host:addSandbags'));
$('#sb-del').addEventListener('click', () => emit('host:clearSandbags'));
$('#reset-coins').addEventListener('click', () => { if (confirm('모두의 획득 동전을 0으로 할까요? (동전 점수도 빠짐)')) emit('host:resetCoins'); });
$('#reset').addEventListener('click', () => { if (confirm('점수와 동전을 모두 초기화할까요?')) emit('host:reset'); });
$('#q-cteam').addEventListener('click', () => { const b = $('#q-cteam'); b.classList.toggle('on'); b.textContent = b.classList.contains('on') ? '팀전' : '개인전'; });
$('#q-type').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (!b) return; $('#q-type').dataset.v = b.dataset.t; $('#q-type').querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === b)); const t = b.dataset.t; $('#q-cteam').hidden = t !== 'coin'; $('#q-time').value = { brawl: 240, tourney: 90, coin: 60 }[t] ?? 15; $('#q-ans').placeholder = ['brawl', 'tourney', 'coin'].includes(t) ? '점수' : t === 'real' ? '-' : '정답 (O/X · 1~4)'; }); // 방식마다 기본 제한시간(초)
$('#q-add').addEventListener('click', () => {
  const text = $('#q-text').value.trim(), type = $('#q-type').dataset.v; if (!text) return;
  const raw = $('#q-ans').value.trim().toUpperCase();
  emit('host:addQuestion', { type, text, team: type === 'coin' && $('#q-cteam').classList.contains('on'), options: $('#q-opts').value.split(',').map((x) => x.trim()).filter(Boolean), answer: type === 'ox' ? raw : Number(raw), pts: ['brawl', 'tourney', 'coin'].includes(type) ? Number(raw) || undefined : undefined, time: Number($('#q-time').value) || undefined, image: $('#q-img').value.trim() });
  $('#q-text').value = ''; $('#q-img').value = '';
});

// ---------- 참가자 · 팀 · 점수 ----------
$('#t-auto').addEventListener('click', () => { if (confirm('2팀으로 무작위로 다시 섞을까요?')) emit('host:teams', {}); });
$('#aw-go').addEventListener('click', () => {
  const who = awWho, n = Number($('#aw-n').value); if (!who || !n) return;
  if (who.startsWith('t:')) emit('host:adjustTeam', { team: Number(who.slice(2)), delta: n }); else emit('host:adjust', { id: who, delta: n });
});

// 점수 그리드 ±단계
document.querySelectorAll('[data-cast]').forEach((b) => b.addEventListener('click', () => emit('host:cast', { m: b.dataset.cast })));
$('#cast-list').addEventListener('click', (e) => { const b = e.target.closest('[data-cid]'); if (b) emit('host:cast', st?.cs?.id === b.dataset.cid ? { m: 'auto' } : { id: b.dataset.cid }); }); // 고른 참가자를 빔프로젝터로 중계
$('#sgrid').addEventListener('click', (e) => { const c = e.target.closest('[data-castid]'); if (c) { emit('host:cast', st?.cs?.id === c.dataset.castid ? { m: 'auto' } : { id: c.dataset.castid }); return; } const b = e.target.closest('[data-sg]'); if (b) emit('host:adjust', { id: b.dataset.id, delta: Number(b.dataset.sg) * (Number($('#adj-step').value) || 1) }); });
// 팀 끌어놓기
let dragging = false, dirtyBoard = false;
$('#tboard').addEventListener('click', (e) => { const c = e.target.closest('[data-drag]'); if (c && !dragging) emit('host:rep', { id: c.dataset.drag }); }); // 눌러서 토너먼트 대표 ★
$('#tboard').addEventListener('dragstart', (e) => { const c = e.target.closest('[data-drag]'); if (!c) return; dragging = true; e.dataTransfer.setData('text/plain', c.dataset.drag); });
$('#tboard').addEventListener('dragend', () => { dragging = false; if (dirtyBoard) renderBoard(); });
$('#tboard').addEventListener('dragover', (e) => { const z = e.target.closest('[data-drop]'); if (z) { e.preventDefault(); z.classList.add('over'); } });
$('#tboard').addEventListener('dragleave', (e) => { e.target.closest('[data-drop]')?.classList.remove('over'); });
$('#tboard').addEventListener('drop', (e) => { const z = e.target.closest('[data-drop]'); if (!z) return; e.preventDefault(); z.classList.remove('over'); dragging = false; emit('host:setTeam', { id: e.dataTransfer.getData('text/plain'), team: Number(z.dataset.drop) }); });
function renderBoard() {
  if (dragging) { dirtyBoard = true; return; } dirtyBoard = false;
  const cols = humans.some((p) => !p.tm) ? [1, 2, 0] : [1, 2]; // 항상 2팀 (팀 없는 사람이 있을 때만 미배정 칸)
  $('#tboard').innerHTML = cols.map((t) => { const ms = humans.filter((p) => (p.tm || 0) === t); return `<div class="tc" data-drop="${t}" style="${t ? `border-color:${TEAMC[t]}` : ''}"><h4>${t ? `${t}팀 · ${ms.length}명 · ★${ms.filter((p) => p.rep).length}/2` : '미배정'}</h4>${ms.map((p) => `<span class="chip${p.rep ? ' rep' : ''}" draggable="true" data-drag="${p.id}">${p.rep ? '★ ' : ''}${esc(p.n)}</span>`).join('')}</div>`; }).join('');
}
// 기록
function renderHistory() {
  const hs = [...(info.history || [])].reverse(); $('#hist-n').textContent = hs.length ? `${hs.length}건` : '';
  $('#hist').innerHTML = hs.map((h) => {
    const rows = [...h.rows].sort((a, b) => b.gain - a.gain), got = rows.filter((r) => r.gain), miss = rows.length - got.length;
    return `<details class="${h.undone ? 'un' : ''}"><summary>#${h.n} ${esc(h.title)} <small>${new Date(h.t).toTimeString().slice(0, 8)}${h.undone ? ' · 취소' : ''}</small></summary><div class="rw">${got.map((r) => `<span>${r.team ? `<i class="tm" style="background:${TEAMC[r.team]}"></i>` : ''}${esc(r.name)} <b>${r.gain > 0 ? '+' : ''}${fmtScore(r.gain)}</b></span>`).join('') || '<span style="opacity:.6">득점 없음</span>'}${miss > 0 && h.kind !== 'adj' ? `<span style="opacity:.6">0점 ${miss}명</span>` : ''}</div></details>`;
  }).join('') || '<div style="opacity:.6">기록 없음</div>';
}

// ---------- 진행 단계 (IA): 입장 → 팀 → 문제 → 진행 → 결과, 지금 단계와 '할 일' 버튼 ----------
const STEPS = ['입장', '팀', '문제', '진행', '결과'];
let stepKey = '';
function renderSteps(s) {
  const live = [PHASE.READING, PHASE.MOVING, PHASE.HOLD, PHASE.REAL].includes(s.phase), t1 = humans.filter((p) => p.tm === 1).length, t2 = humans.filter((p) => p.tm === 2).length;
  const now = s.phase === PHASE.REVEAL ? 4 : live ? 3 : s.sm === 'title' || !humans.length ? 0 : askId ? 2 : 1;
  const q = info.questions.find((x) => x.id === askId), cur = st?.q;
  const sub = [`${humans.length}명`, `${t1} : ${t2}`, q ? `Q${q.id} ${q.mode}` : '고르기', live ? (phaseName[s.phase] || '') : '', s.phase === PHASE.REVEAL ? `Q${cur?.id ?? ''}` : ''];
  const todo = [
    ['QR로 입장시키기', [['t-qr2', s.qr ? 'QR 끄기' : 'QR 켜기'], ['go-quiz', '화면: 퀴즈로']]],
    ['팀 확인 · 토너먼트면 ★ 대표 고르기', [['t-auto', '🔀 2팀 섞기']]],
    [q ? `Q${q.id} 출제 준비` : '문제 선택', q ? [['vote', '🗳 투표'], ['premap', '🗺 맵 미리 보기'], ['ask', `▶ Q${q.id} 출제`]] : [['vote', '🗳 투표']]],
    [phaseName[s.phase] || '진행 중', [['t-p10', '＋10초'], ['end', $('#end').textContent]]],
    ['결과 확인 후 다음 문제', [['scr-rank', '화면: 순위'], ['vote', '🗳 투표'], ['ask', askId ? `▶ Q${askId} 출제` : '▶ 출제']]],
  ][now];
  const key = JSON.stringify([now, sub, todo, $('#end').disabled, $('#ask').disabled]);
  if (key === stepKey) return; stepKey = key;
  $('#steps').innerHTML = `<ol>${STEPS.map((n, i) => `<li class="${i < now ? 'done' : i === now ? 'now' : ''}"><b>${i < now ? '✓' : i + 1}</b>${n}${sub[i] ? ` <small>${esc(sub[i])}</small>` : ''}</li>`).join('')}</ol><div class="todo"><span>${esc(todo[0])}</span>${todo[1].map(([id, label]) => `<button class="btn sm ${id === 'ask' || id === 'end' ? 'go' : ''}" data-do="${id}" ${(id === 'end' && $('#end').disabled) || (id === 'ask' && $('#ask').disabled) ? 'disabled' : ''}>${esc(label)}</button>`).join('')}</div>`;
}
$('#steps').addEventListener('click', (e) => { // 할 일 버튼은 아래 원래 버튼을 그대로 누름
  const b = e.target.closest('[data-do]'); if (!b) return; const id = b.dataset.do;
  if (id === 'go-quiz') return emit('host:screen', { mode: 'quiz' });
  if (id === 'scr-rank') return emit('host:screen', { mode: 'rank' });
  if (id === 't-qr2') return $('#t-qr').click();
  $('#' + id)?.click();
});

// 라운드 기록 (대난투·토너먼트 팀 점수)
function renderRounds() {
  const rs = (info.rounds || []).slice(-12), ts = [...new Set(rs.flatMap((r) => Object.keys(r.teams).map(Number)))].sort((a, b) => a - b);
  $('#rdbox').hidden = !rs.length || !ts.length; if ($('#rdbox').hidden) return;
  const tot = (t) => rs.reduce((a, r) => a + (r.teams[t] || 0), 0);
  $('#rd').innerHTML = `<div class="h"><span></span>${rs.map((r) => `<span title="${esc(r.title)}">${r.kind === 'tour' ? '🏆' : `R${r.n}`}</span>`).join('')}<span>합</span></div>${ts.map((t) => `<div><span style="color:${TEAMC[t]}">${t}팀</span>${rs.map((r) => `<i class="${r.teams[t] ? 'w' : ''}">${r.teams[t] ? fmtScore(r.teams[t]) : '·'}</i>`).join('')}<span>${fmtScore(tot(t))}</span></div>`).join('')}`;
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

let humans = [], lastKey = '', realKey = '', awWho = '', voteSeen = '';
$('#aw-who').addEventListener('click', (e) => { const b = e.target.closest('[data-aw]'); if (!b) return; awWho = b.dataset.aw; $('#aw-who').querySelectorAll('[data-aw]').forEach((x) => x.classList.toggle('on', x === b)); $('#aw-sel').textContent = b.textContent; }); // 점수 부여 대상: 버튼으로 고름
$('#reload-me').addEventListener('click', () => location.reload());
$('#reload-all').addEventListener('click', () => { if (confirm('빔프로젝터·참가자 폰 화면을 모두 새로고침할까요? (점수·접속은 유지)')) emit('host:reloadAll'); });
socket.on('state', (s) => {
  st = s;
  humans = (s.lb || []).map((r) => ({ id: r.id, n: r.name, tm: r.team, sc: r.score, cn: r.coins, rep: r.rep, watch: !s.players.some((p) => p.id === r.id) })); // 사람 + 점수 받는 테스트 봇 (순위표 기준 → 토너먼트 관전자도 빠지지 않음)
  $('#s-players').textContent = `${humans.length}명 접속`; $('#s-phase').textContent = (phaseName[s.phase] || '-') + (s.bw ? ` · ⚔ ${s.bw.p}명` : '') + (s.cal ? ` · 📅 ${s.cal.r}차 생존 ${s.cal.a}명` : '') + (s.tr?.m ? ` · 🏆 ${s.tr.r}R ${s.tr.m[0]}팀 vs ${s.tr.m[1]}팀` : '') + (s.cr ? ` · 🪙 1등 ${s.cr[0]?.[1] ?? '-'} ${s.cr[0]?.[2] ?? 0}` : '');
  $('#end').textContent = s.q?.type === 'calendar' ? '✓ 채점하기' : s.tr ? '✓ 경기 종료' : s.q?.type === 'brawl' || s.q?.type === 'coin' ? '✓ 종료' : '✓ 정답 공개'; $('#cal-fin').hidden = !s.cal; $('#s-left').textContent = s.left > 0 ? `⏱ ${Math.ceil(s.left)}초` : '-';
  for (const [id, on] of [['hideans', s.ha], ['t-pause', s.tp], ['t-qr', s.qr], ['t-x2', s.x2 === 2], ['t-freeze', s.fz], ['t-god', s.gd], ['t-noatk', s.ca], ['t-noult', s.cu]]) $('#' + id).classList.toggle('on', !!on); // 스위치
  $('#t-undo').disabled = !s.ud;
  document.querySelectorAll('[data-screen]').forEach((b) => b.classList.toggle('on', b.dataset.screen === s.sm));
  document.querySelectorAll('[data-cast]').forEach((b) => b.classList.toggle('on', b.dataset.cast === s.cs?.m));
  { const k = JSON.stringify([humans.map((p) => [p.id, p.n, p.tm]), s.cs]); if ($('#cast-list').dataset.k !== k) { $('#cast-list').dataset.k = k; $('#cast-list').innerHTML = [...humans].sort((a, b) => (a.tm - b.tm) || a.n.localeCompare(b.n)).map((p) => `<button class="btn sm${s.cs?.id === p.id ? ' on' : ''}" data-cid="${p.id}" style="border-color:${TEAMC[p.tm] || 'var(--navy)'}">${esc(p.n)}</button>`).join(''); } } // 중계: 참가자 버튼 (다시 누르면 자동)
  $('#tools-state').textContent = [s.tp ? '타이머 정지됨' : '', s.x2 === 2 ? '점수 ×2' : '', s.gd ? '전원 무적' : '', s.ca ? '공격 금지' : '', s.cu ? '궁극기 금지' : '', s.fz ? '비상 정지 중' : ''].filter(Boolean).join(' · ');
  const prevCur = curId, prevDone = doneIds.size;
  if (s.q && s.phase !== PHASE.LOBBY) curId = s.q.id; else if (s.phase === PHASE.LOBBY) curId = null;
  if (s.phase === PHASE.REVEAL && s.q && !s.q.vote) doneIds.add(s.q.id);
  if (s.reveal?.vote && voteSeen !== s.reveal.winner + ':' + s.q?.text) { voteSeen = s.reveal.winner + ':' + s.q?.text; askId = s.reveal.winner; renderQuestions(); } // 투표로 뽑힌 문제를 다음 문제로 선택
  if (prevCur !== curId || prevDone !== doneIds.size) renderQuestions();
  const special = ['brawl', 'calendar', 'coin'].includes(s.q?.type); // 읽는 중엔 끝낼 판정이 없음
  $('#end').disabled = !((s.phase === PHASE.READING && !special) || s.phase === PHASE.MOVING || s.phase === PHASE.HOLD);
  $('#ask').disabled = s.phase === PHASE.READING || s.phase === PHASE.MOVING || s.phase === PHASE.HOLD;
  const total = s.q?.time || 15; $('#c-bar').style.width = s.phase === PHASE.MOVING ? `${(s.left / total) * 100}%` : '0%';
  renderCurrent(); renderSteps(s);
  // 실시간 응답
  const dist = s.dist || (s.reveal && s.reveal.dist) || null, keys = s.q?.type === 'choice' ? [1, 2, 3, 4].slice(0, s.q.options?.length || 4) : ['O', 'X'], tot = Math.max(1, humans.length);
  $('#distbox').hidden = !s.q || s.q.type === 'real' || s.q.type === 'brawl' || s.q.type === 'calendar' || s.q.type === 'coin' || s.phase === PHASE.LOBBY;
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
  const lb = [...humans].sort((a, b) => b.sc - a.sc), key = JSON.stringify([lb.map((p) => [p.id, p.n, p.tm, p.sc, p.cn, p.watch, p.rep]), s.teams, s.cs, s.off]);
  if (key !== lastKey) {
    lastKey = key; const tc = s.teams?.length || 0;
    $('#plist').innerHTML = lb.map((p, i) => `<div class="pl"><span>${i + 1}</span><span data-name="${p.id}" data-nm="${esc(p.n)}" style="cursor:pointer">${esc(p.n)} <small style="opacity:.6">🪙${p.cn}</small></span><span>${fmtScore(p.sc)}</span><div class="stp"><b data-kick="${p.id}" data-nm="${esc(p.n)}" title="퇴장">✕</b></div></div>`).join('') + (s.off || []).map(([id, n]) => `<div class="pl" style="opacity:.6"><span>-</span><span>${esc(n)} <small>끊김</small></span><span></span><div class="stp"><b data-kick="${id}" data-nm="${esc(n)}" title="퇴장">✕</b></div></div>`).join('') || '<div style="opacity:.6">접속한 참가자가 없어요</div>';
    $('#sgrid').innerHTML = lb.map((p, i) => `<div class="sc" style="border-color:${p.tm ? TEAMC[p.tm] : 'var(--navy)'}"><span class="nm"><i data-castid="${p.id}" class="${s.cs?.id === p.id ? 'on' : ''}" title="빔프로젝터로 중계">📺</i><span>${i + 1}. ${esc(p.n)}${p.watch ? ' <small style="opacity:.6">관전</small>' : ''}</span></span><b class="m" data-id="${p.id}" data-sg="-1">−</b><span class="pt">${fmtScore(p.sc)}</span><b class="p" data-id="${p.id}" data-sg="1">＋</b></div>`).join('') || '<div style="opacity:.6">접속한 참가자가 없어요</div>';
    renderBoard();
    $('#tt').innerHTML = (s.teams || []).map((t) => `<span class="pill" style="background:${TEAMC[t.t]}99">${t.t}팀 ${fmtScore(t.score)}</span>`).join('');
    $('#p-teams').textContent = tc ? `${tc}팀` : '팀 없음';
    $('#aw-who').innerHTML = `${(s.teams || []).map((t) => `<button class="btn sm${awWho === `t:${t.t}` ? ' on' : ''}" data-aw="t:${t.t}" style="border-color:${TEAMC[t.t]}">${t.t}팀 전원</button>`).join('')}${lb.map((p) => `<button class="btn sm${awWho === p.id ? ' on' : ''}" data-aw="${p.id}">${esc(p.n)}</button>`).join('')}`;
  }
});
