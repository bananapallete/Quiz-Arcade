import { io } from 'socket.io-client';
import QRCode from 'qrcode';
import { fmtScore, isCombat, MAP, PHASE } from '../shared/constants.js';
import { BU, startWorld } from './world.js';
import { mountScreenUi, renderScreenUi } from './screenUi.js';

const $ = (s) => document.querySelector(s);
const { scene } = startWorld('game', { screen: true });
const socket = io();
import { mountFade } from './fade.js'; mountFade(socket);
const sq = mountScreenUi();

socket.on('connect', () => { socket.emit('screen:join'); $('#conn').textContent = ''; });
socket.on('disconnect', () => { $('#conn').textContent = '연결 끊김'; });

// 입장 QR: 폰이 접속할 수 있는 주소여야 한다 (localhost로 열었으면 같은 와이파이 주소로 대체)
fetch('/api/info').then((r) => r.json()).then(async (info) => {
  let origin = info.publicUrl || location.origin;
  if (!info.publicUrl && /^(localhost|127\.)/.test(location.hostname) && info.lanOrigin) origin = info.lanOrigin;
  const url = `${origin}/play`;
  $('#joinurl').textContent = url;
  $('#qr').src = await QRCode.toDataURL(url, { margin: 1, width: 400 });
});

// ---------- 중계 카메라: 전투 모드에선 유령이 아닌 1등을 따라가고, 진행자가 고른 참가자가 있으면 그 사람을 ----------
let last = null, castId = null;
const castTag = document.createElement('div'); castTag.id = 'castTag'; castTag.hidden = true;
castTag.style.cssText = 'position:fixed;left:2vw;bottom:13vh;z-index:14;pointer-events:none;background:#14122bd0;color:#fff;border:.4vh solid #ffd54a;border-radius:99px;padding:.6vh 1.6vw;font:900 2.6vh system-ui,"Noto Sans KR",sans-serif';
document.body.append(castTag);
function castTarget(s) {
  if (!s || s.rank || s.sm === 'map') return null;
  const ps = s.players.filter((p) => p.ct), c = s.cs || {};
  if (c.m === 'id') { const p = ps.find((x) => x.id === c.id); if (p) return p; } // 진행자가 고른 사람 (관전 중이면 자동으로)
  if (c.m === 'off' || !isCombat(s.q) || !(s.phase === PHASE.READING || s.phase === PHASE.MOVING)) return null;
  const alive = ps.filter((p) => !p.gh); if (!alive.length) return null;
  const top = Math.max(...alive.map((p) => p.sc)), cur = alive.find((p) => p.id === castId);
  return cur && cur.sc === top ? cur : alive.find((p) => p.sc === top); // 공동 1등이면 지금 보던 사람 유지 (카메라가 왔다 갔다 하지 않게)
}
scene.onFrame = (sc, dt) => {
  const cam = sc.cameras.main, t = castTarget(last), v = t && sc.views.get(t.id), big = !!last?.mp;
  castId = v ? t.id : null; castTag.hidden = !v; if (v) castTag.textContent = `📺 ${t.n}`;
  const tz = v ? 1.3 : big ? 0.5 : 1, tx = v ? v.x : (big ? last.mp[0] : MAP.w) * BU / 2, ty = v ? v.y - 0.5 * BU : (big ? last.mp[1] : MAP.h) * BU / 2;
  const k = 1 - Math.exp(-(dt / 1000) * 5), m = cam.midPoint; // 부드럽게 따라감
  cam.setZoom(cam.zoom + (tz - cam.zoom) * k); cam.centerOn(m.x + (tx - m.x) * k, m.y + (ty - m.y) * k);
};

socket.on('state', (s) => {
  last = s;
  scene.applyState(s);
  hud(s);
  renderScreenUi(sq, s);
});

function hud(s) {
  const banner = $('#banner'), timer = $('#timer'), reveal = $('#reveal'), lb = $('#lb');
  $('#join').hidden = s.phase !== PHASE.LOBBY || s.rank || !s.qr;

  if (s.q && s.phase !== PHASE.LOBBY) {
    banner.hidden = false;
    banner.querySelector('.qn').textContent = `문제 ${s.q.id}`;
    banner.querySelector('.qt').textContent = s.q.text;
    banner.querySelector('.opts').textContent = s.q.type === 'choice' ? s.q.options.map((o, i) => `${i + 1}. ${o}`).join('   ') : '';
  } else banner.hidden = true;

  const counting = s.phase === PHASE.READING || s.phase === PHASE.MOVING;
  timer.hidden = !counting;
  if (counting) { timer.textContent = Math.ceil(s.left); timer.classList.toggle('low', s.phase === PHASE.MOVING && s.left <= 3); }

  if (s.phase === PHASE.REVEAL && s.reveal) {
    reveal.hidden = false;
    if (s.reveal.cal) { reveal.innerHTML = `달력 종료 · 생존 ${s.reveal.survivors}명`; return; }
    if (s.reveal.coin) { reveal.innerHTML = `동전 모으기 · 1등 ${s.reveal.results[0]?.name ?? '-'} 🪙${s.reveal.results[0]?.got ?? 0}`; return; }
    if (s.reveal.brawl) { reveal.innerHTML = `대난투 우승 · ${s.reveal.winners.map((w) => (w.team ? `${w.team}팀` : w.names.join(', '))).join(', ') || '없음'}`; return; }
    const ans = s.q.type === 'choice' ? `${s.reveal.answer}번` : s.reveal.answer;
    const winners = s.reveal.results.filter((r) => r.correct).sort((a, b) => a.rank - b.rank);
    const top = winners.slice(0, 3).map((r) => `${r.rank}등 ${r.name} +${r.gain}`).join('  ');
    reveal.innerHTML = `정답 ${ans} · ${winners.length}명<small>${top}</small>`;
  } else reveal.hidden = true;

  const rk = $('#rank');
  rk.hidden = !s.rank;
  if (s.rank) {
    const html = (s.lb || []).slice(0, 10).map((r, i) => `<div><b>${i + 1}</b><span>${esc(r.name)}</span><i>${fmtScore(r.score)}</i></div>`).join('');
    if (rk.innerHTML !== html) rk.innerHTML = html;
  }

  const rows = (s.lb || []).slice(0, 5);
  lb.hidden = !rows.length || s.rank;
  lb.innerHTML = rows.map((r, i) => `<span>${i + 1}. ${esc(r.name)}<b>${fmtScore(r.score)}</b></span>`).join('');
}

function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
window.__world = scene; // 디버그/테스트용
