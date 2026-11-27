// 플레이어 화면 상단 UI: 좌상단 1~3등 · 문제(+이미지 썸네일, 탭하면 크게) · 제한시간 링 · 맨 위 시간 게이지. 폰 크기에 맞춰 vw/vh로 늘고 줄어든다.
import { isCombat, PHASE, READ_SEC } from '../shared/constants.js';
import { renderTopRank } from './topRank.js';

const CSS = `
#qtop{position:fixed;left:0;right:0;top:0;z-index:15;pointer-events:none;color:#5a3a24;font-family:system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
#qtop .tg{position:absolute;left:1.4vw;right:1.4vw;top:0;height:1.6vh;background:#14122b66;border-radius:0 0 99px 99px;overflow:hidden}
#qtop .tg i{display:block;height:100%;width:0;background:linear-gradient(#ffe27a,#f2c230);transition:width .25s linear}
#qtop .tg.low i{background:linear-gradient(#ff8f84,#e5483c)}#qtop .tg.ok i{background:linear-gradient(#9af0a4,#4fd16a)}
#qtop .row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:1.2vw;align-items:start;padding:2.5vh calc(1.4vw + 84px) 0 max(1.4vw,env(safe-area-inset-left,0px))}
#qtop #toprank{position:static;pointer-events:none}
#qtop #toprank div{grid-template-columns:auto minmax(0,6.5em) auto;font-size:calc(.9vw + 7px)}
#qtop .q{background:#f6e6c8;border:3px solid #14122b;border-radius:14px;box-shadow:0 3px 0 #14122b66;padding:2vh 1.4vw;display:grid;grid-template-columns:auto 1fr auto;gap:1vw;align-items:center;pointer-events:auto}
#qtop .q[hidden],#qtop .tm[hidden]{display:none}
#qtop .no{font-weight:900;color:#fff;background:#f0a000;border:2px solid #14122b;border-radius:8px;padding:1px 7px;font-size:calc(1.4vw + 5px);white-space:nowrap}
#qtop .no.end{background:#e5483c}#qtop .no.ans{background:#6e9a3a}#qtop .no.real{background:#9a62d6}
#qtop .q p{margin:0;font-weight:900;line-height:1.25;font-size:calc(1.65vw + 5px);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:keep-all}
#qtop .th{width:16vh;height:12vh;border-radius:8px;border:2px solid #14122b;background:#e9f7ff center/cover;position:relative}
#qtop .th::after{content:"⤢";position:absolute;right:2px;bottom:-1px;font-size:3.5vh;color:#14122b;text-shadow:0 0 3px #fff}
#qtop .tm .ring{width:13vh;height:13vh;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--c,#f2c230) calc(var(--p,0)*1%),#14122b44 0);border:3px solid #14122b;position:relative}
#qtop .tm .ring::before{content:"";position:absolute;inset:18%;background:#f6e6c8;border-radius:50%}
#qtop .tm b{position:relative;font-size:5.5vh;font-weight:900;color:#14122b}
#qnt{position:fixed;left:50%;top:22%;transform:translateX(-50%);z-index:30;max-width:84vw;background:#14122bf0;color:#fff;border:3px solid #ffd54a;border-radius:14px;padding:12px 16px;font-weight:900;font-size:calc(2vw + 12px);text-align:center;word-break:keep-all;pointer-events:none}#qnt[hidden]{display:none}
#qx2{position:fixed;left:max(10px,env(safe-area-inset-left,0px));bottom:48px;z-index:30;background:#e5483c;color:#fff;border:3px solid #14122b;border-radius:10px;padding:2px 9px;font-weight:900;font-size:14px;pointer-events:none}#qx2[hidden]{display:none}
#qfz{position:fixed;inset:0;z-index:60;background:#14122baa;color:#fff;display:grid;place-items:center;font-weight:900;font-size:26px;pointer-events:none}#qfz[hidden]{display:none}
@media (orientation:portrait){#qtop .row{grid-template-columns:minmax(0,1fr) auto;gap:2vw}#qtop #toprank{grid-column:1/-1;grid-row:2;justify-self:start}#qtop .tm .ring{width:15vw;height:15vw}#qtop .tm b{font-size:6.4vw}#qtop .q{padding:1.2vh 2.4vw;gap:2vw;border-radius:12px}#qtop .no{font-size:calc(3vw + 4px)}#qtop .q p{font-size:calc(3vw + 3px);-webkit-line-clamp:3}#qtop .th{width:22vw;height:16vw}#qtop #toprank div{font-size:calc(2.4vw + 4px)}}
#qtop .q{cursor:pointer}
#qpop{position:fixed;inset:0;z-index:40;background:#14122b99;display:grid;place-items:center;padding:16px;transition:background .3s}#qpop[hidden]{display:none}
#qpop .c{box-sizing:border-box;width:min(640px,92vw);max-height:86vh;overflow:auto;background:#f6e6c8;border:4px solid #14122b;border-radius:18px;box-shadow:0 6px 0 #14122b88;padding:18px 20px;display:grid;gap:12px;color:#5a3a24;transition:transform .32s cubic-bezier(.5,0,.75,0),opacity .32s;transform-origin:50% 0}
#qpop .c .no{justify-self:start;font-size:18px;font-weight:900;color:#fff;background:#f0a000;border:2px solid #14122b;border-radius:8px;padding:1px 8px}
#qpop .c p{margin:0;font-weight:900;font-size:clamp(20px,5.2vw,30px);line-height:1.3;word-break:keep-all}
#qpop .c ol{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:8px}#qpop .c li{background:#fff;border:3px solid #14122b;border-radius:12px;padding:8px 10px;font-weight:900;font-size:clamp(15px,3.8vw,20px)}#qpop .c li b{color:#d98a00;margin-right:6px}
#qpop .c img{max-width:100%;max-height:34vh;justify-self:center;border:3px solid #14122b;border-radius:12px;background:#fff}
#qpop .h{font-size:14px;font-weight:800;color:#7a4e32;text-align:center;opacity:0;transition:opacity .3s}#qpop .h.on{opacity:1}
#qpop.out{background:#14122b00}#qpop.out .c{transform:translateY(-42vh) scale(.25);opacity:0}
#qprep{position:fixed;left:50%;top:44%;transform:translate(-50%,-50%);z-index:35;pointer-events:none;display:grid;justify-items:center;gap:4px;text-align:center}#qprep[hidden]{display:none}
#qprep b{font-size:min(30vw,30vh);line-height:1;font-weight:900;color:#fff;-webkit-text-stroke:6px #14122b;paint-order:stroke fill}
#qprep i{font-style:normal;font-size:clamp(22px,6vw,40px);font-weight:900;color:#ffd54a;-webkit-text-stroke:4px #14122b;paint-order:stroke fill}
#qprep small{font-size:clamp(13px,3.4vw,18px);font-weight:900;color:#fff;background:#14122bcc;border-radius:99px;padding:4px 12px}
#qteam{position:fixed;left:max(10px,env(safe-area-inset-left,0px));bottom:58px;z-index:16;pointer-events:none;color:#fff;border:3px solid #14122b;border-radius:99px;padding:2px 10px;font-weight:900;font-size:14px;box-shadow:0 3px 0 #14122b66}#qteam[hidden]{display:none}
#qres{position:fixed;left:50%;top:34%;transform:translate(-50%,-50%);z-index:36;pointer-events:none;text-align:center;font-weight:900;color:#fff;-webkit-text-stroke:5px #14122b;paint-order:stroke fill;font-size:clamp(30px,9vw,64px);line-height:1.1;animation:qres .25s cubic-bezier(.2,1.6,.4,1)}#qres small{display:block;font-size:.45em;-webkit-text-stroke:3px #14122b}#qres[hidden]{display:none}#qres.ok{color:#ffe27a}#qres.bad{color:#ff9aa8}
@keyframes qres{from{transform:translate(-50%,-50%) scale(.4);opacity:0}to{transform:translate(-50%,-50%) scale(1);opacity:1}}
#qwatch{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:16;pointer-events:none;background:#14122bd8;color:#fff;border:3px solid #ffd54a;border-radius:12px;padding:6px 14px;font-weight:900;font-size:15px;white-space:nowrap}#qwatch[hidden]{display:none}
#qbig{position:fixed;inset:0;z-index:70;background:#14122bcc;display:grid;place-items:center}#qbig[hidden]{display:none}
#qbig img{max-width:80vw;max-height:80vh;border:4px solid #14122b;border-radius:16px;background:#fff}
`;

export function mountQuizTop() {
  if (!document.getElementById('qtop-css')) { const st = document.createElement('style'); st.id = 'qtop-css'; st.textContent = CSS; document.head.append(st); }
  let el = document.getElementById('qtop');
  if (!el) {
    el = document.createElement('div'); el.id = 'qtop';
    el.innerHTML = '<div class="tg"><i></i></div><div class="row"><div id="toprank"></div><div class="q"><span class="no"></span><p></p><div class="th" hidden></div></div><div class="tm"><div class="ring"><b></b></div></div></div>';
    document.body.append(el);
    const big = document.createElement('div'); big.id = 'qbig'; big.hidden = true; big.innerHTML = '<img alt="">'; document.body.append(big);
    const pop = document.createElement('div'); pop.id = 'qpop'; pop.hidden = true; pop.innerHTML = '<div class="c"><span class="no"></span><p></p><ol></ol><img alt="" hidden><div class="h">아무 곳이나 누르면 팝업이 닫힙니다.</div></div>'; document.body.append(pop);
    pop.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (pop.dataset.at && performance.now() - Number(pop.dataset.at) < 3000) return; closePop(); }); // 처음 뜬 팝업은 3초 뒤부터 닫힘
    const prep = document.createElement('div'); prep.id = 'qprep'; prep.hidden = true; prep.innerHTML = '<b></b><i>전투 준비!</i><small>공격·궁극기·달리기 불가</small>'; document.body.append(prep);
    for (const [id, tx] of [['qnt', ''], ['qx2', '점수 ×2'], ['qfz', '잠시 멈춤'], ['qteam', ''], ['qres', ''], ['qwatch', '']]) { const d = document.createElement('div'); d.id = id; d.hidden = true; d.textContent = tx; document.body.append(d); }
    big.addEventListener('click', () => { big.hidden = true; });
    el.querySelector('.q').addEventListener('click', (e) => { if (!e.target.closest('.th')) openPop(false); }); // 줄어든 문제를 누르면 다시 크게
    el.querySelector('.th').addEventListener('click', () => { const u = el.querySelector('.th').dataset.url; if (u) { big.querySelector('img').src = u; big.hidden = false; } });
  }
  return el;
}

// ---------- 퀴즈 팝업: 문제가 시작되면 10초 동안 크게, 닫으면 맨 위로 줄어듦 ----------
let popKey = null, popQ = null, popAuto = false;
function fillPop(q) {
  const pop = document.getElementById('qpop'), c = pop.querySelector('.c');
  c.querySelector('.no').textContent = `Q${q.id}`; c.querySelector('p').textContent = q.text;
  const ol = c.querySelector('ol'); ol.hidden = !(q.type === 'choice' && q.options); ol.innerHTML = q.type === 'choice' && q.options ? q.options.map((o, i) => `<li><b>${i + 1}</b>${String(o).replace(/[<>&]/g, '')}</li>`).join('') : '';
  const im = c.querySelector('img'); im.hidden = !q.image; if (q.image) im.src = q.image;
}
function openPop(auto) {
  const pop = document.getElementById('qpop'); if (!popQ || !pop) return;
  fillPop(popQ); popAuto = auto; pop.classList.remove('out'); pop.hidden = false;
  if (auto) { pop.dataset.at = performance.now(); pop.querySelector('.h').classList.remove('on'); setTimeout(() => { if (popAuto && !pop.hidden) pop.querySelector('.h').classList.add('on'); }, 3000); }
  else { delete pop.dataset.at; pop.querySelector('.h').classList.remove('on'); }
}
function closePop() {
  const pop = document.getElementById('qpop'); if (!pop || pop.hidden || pop.classList.contains('out')) return;
  popAuto = false; pop.classList.add('out'); setTimeout(() => { if (pop.classList.contains('out')) { pop.hidden = true; pop.classList.remove('out'); } }, 330);
}

// ---------- 내 팀 · 결과 알림 · 관전 안내 ----------
const TEAMC = ['', '#ff6b6b', '#4a86d9'];
let resKey = null, resTimer = 0;
function myResult(r, meId) { // 결과 알림 문구 [큰 글자, 작은 글자, 좋은 결과?]
  const m = r.results?.find((x) => x.id === meId); if (!m) return null;
  if (r.coin) return [`🪙 ${m.got}개`, m.gain ? `${m.rank}등 +${m.gain}` : `${m.rank}등`, m.gain > 0];
  if (r.tour) return m.correct ? ['우승!', `+${m.gain}`, true] : m.gain ? ['준우승', `+${m.gain}`, true] : ['아쉬워요', '', false];
  if (r.brawl) return m.correct ? ['승리!', `+${m.gain}`, true] : ['패배', '', false];
  if (r.cal) return m.correct ? ['생존!', `+${m.gain}`, true] : ['탈락', '', false];
  if (r.real) return m.gain ? [`+${m.gain}`, '', m.gain > 0] : null;
  return m.correct ? ['정답!', `+${m.gain}${m.rank ? ` · ${m.rank}등` : ''}`, true] : [m.zone == null ? '무응답' : '오답', '💥', false];
}
function renderMine(s, rows, meId) {
  const me = s.players.find((p) => p.id === meId), row = rows.find((r) => r.id === meId), tm = me?.tm || row?.team || 0;
  const te = document.getElementById('qteam'); te.hidden = !tm; if (tm) { te.textContent = `${tm}팀`; te.style.background = TEAMC[tm]; }
  const res = document.getElementById('qres'), key = s.phase === PHASE.REVEAL && s.reveal ? `${s.q?.id}:${s.q?.text}:${(s.reveal.results || []).length}` : null;
  if (key && key !== resKey) { resKey = key; const m = myResult(s.reveal, meId); if (m) { res.innerHTML = `${m[0]}${m[1] ? `<small>${m[1]}</small>` : ''}`; res.className = m[2] ? 'ok' : 'bad'; res.hidden = false; clearTimeout(resTimer); resTimer = setTimeout(() => { res.hidden = true; }, 2800); } }
  if (!key) resKey = null;
  const w = document.getElementById('qwatch'), watching = !!s.tr && !me && !!row; // 토너먼트: 내가 경기에 안 나가면 관전
  w.hidden = !watching; if (watching) w.textContent = `👀 관전 중 · ${s.tr.r}R ${s.tr.m?.[0]}팀 vs ${s.tr.m?.[1]}팀`;
}

/** s: 서버 상태, rows: [{id,name,score}] 점수순, meId: 내 id */
export function renderQuizTop(el, s, rows, meId) {
  const nt = document.getElementById('qnt'); if (nt) { nt.hidden = !s.nt; if (s.nt) nt.textContent = s.nt; document.getElementById('qx2').hidden = s.x2 !== 2; document.getElementById('qfz').hidden = !s.fz; }
  renderTopRank(el.querySelector('#toprank'), rows, meId);
  renderMine(s, rows, meId);
  { // 퀴즈 모드: 문제 시작 때 팝업 (10초 뒤 자동으로 줄어듦) · 전투 모드: 큰 준비 카운트다운
    const live = !!s.q && (s.phase === PHASE.READING || s.phase === PHASE.MOVING), quiz = live && !isCombat(s.q) && s.q.type !== 'real';
    popQ = s.q && s.phase !== PHASE.LOBBY && !isCombat(s.q) ? s.q : null;
    if (!popQ) closePop();
    const key = quiz ? `${s.q.id}:${s.q.text}` : null;
    if (quiz && s.pl > 0 && key !== popKey) { popKey = key; openPop(true); }
    if (!live) popKey = null;
    if (popAuto && !(s.pl > 0)) closePop();
    const prep = document.getElementById('qprep'), on = live && isCombat(s.q) && s.pl > 0;
    prep.hidden = !on; if (on) prep.querySelector('b').textContent = Math.ceil(s.pl);
  }
  const q = s.q, show = !!q && s.phase !== PHASE.LOBBY, qb = el.querySelector('.q'), tm = el.querySelector('.tm'), tg = el.querySelector('.tg');
  qb.hidden = !show || (q.type === 'brawl' && s.phase === PHASE.MOVING); tm.hidden = !show; tg.style.visibility = show ? 'visible' : 'hidden';
  if (!show) return;
  const no = qb.querySelector('.no'), p = qb.querySelector('p'), th = qb.querySelector('.th');
  const ans = s.reveal && s.reveal.answer != null && !s.ha ? (q.type === 'choice' ? `${s.reveal.answer}번` : s.reveal.answer) : '';
  no.className = `no${s.phase === PHASE.HOLD ? ' end' : s.phase === PHASE.REVEAL ? ' ans' : s.phase === PHASE.REAL ? ' real' : ''}`;
  no.textContent = s.phase === PHASE.HOLD ? '종료' : s.phase === PHASE.REVEAL ? (s.reveal?.real ? '공개' : s.reveal?.brawl || s.reveal?.cal || s.reveal?.coin ? '결과' : ans ? `정답 ${ans}` : '종료') : s.phase === PHASE.REAL ? '현실' : `Q${q.id}`;
  p.textContent = q.text + (q.type === 'calendar' && s.cal ? `  📅 ${s.cal.l.month ? `${s.cal.l.month}월 · ` : ''}${s.cal.r}차 · 생존 ${s.cal.a}명 · 안전칸 ${s.cal.f}/${s.cal.s}` : '') + (q.type === 'coin' && s.cr ? `  🪙 ${s.cr.find((r) => r[0] === meId)?.[2] ?? 0} · 1등 ${s.cr[0]?.[2] ?? 0}` : '') + (s.tr?.m ? `  🏆 ${s.tr.r}R ${s.tr.m[0]}팀 vs ${s.tr.m[1]}팀` : '') + (q.type === 'brawl' && s.bw ? `  ⚔ ${s.bw.tm.map(([t, al, n]) => `${t}팀 ${al}/${n}`).join(' · ')}` : '') + (q.type === 'choice' && q.options ? '  ' + q.options.map((o, i) => `${i + 1}.${o}`).join(' ') : '');
  th.hidden = !q.image; if (q.image) { th.style.backgroundImage = `url("${q.image}")`; th.dataset.url = q.image; }
  const reading = s.phase === PHASE.READING, moving = s.phase === PHASE.MOVING, total = reading ? READ_SEC : q.time || 15, f = (moving || reading) ? Math.max(0, Math.min(1, s.left / total)) : 0;
  tm.hidden = !(reading || moving || s.phase === PHASE.HOLD);
  const col = s.phase === PHASE.HOLD ? '#e5483c' : reading ? '#4a86d9' : f > 0.5 ? '#4fd16a' : f > 0.25 ? '#f2c230' : '#e5483c';
  const ring = tm.querySelector('.ring'); ring.style.setProperty('--p', Math.round(f * 100)); ring.style.setProperty('--c', col); tm.querySelector('b').textContent = (reading || moving) ? Math.ceil(s.left) : 0;
  tg.className = `tg${s.phase === PHASE.HOLD || (moving && f <= 0.25) ? ' low' : moving && f > 0.5 ? ' ok' : ''}`; tg.firstChild.style.width = `${f * 100}%`;
}
