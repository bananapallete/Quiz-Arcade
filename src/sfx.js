// 효과음: 파일 없이 WebAudio로 합성한 8비트풍 소리. 평타·투척·궁극기 소리를 내고, 나와 멀수록 작아져 일정 거리 밖은 안 들린다.
// 빔프로젝터(screen)는 궁극기 소리만 낸다. 폰은 처음 화면을 터치한 뒤부터 소리가 난다 (브라우저 정책).
const KEY = 'quiz_sfx_muted';
let ctx = null, master = null, voices = 0, muted = false;
try { muted = localStorage.getItem(KEY) === '1'; } catch { /* 저장 불가 */ }
const lastAt = {};

// ---------- 실제 동물 울음소리 (public/sfx/animal/*.mp3|ogg|wav) ----------
// 파일이 없으면 null로 두고 합성음을 그대로 씀. 캐릭터 → [파일 이름, 음높이]
const ANIMAL = { puppy: ['dog', 1.3], labrador: ['dog', 0.9], shiba: ['dog', 1.05], cat: ['cat', 1], frog: ['frog', 1], pig: ['pig', 1], hippo: ['hippo', 1], chicken: ['chicken', 1], chick: ['chick', 1] };
const cries = {}; // 이름 → AudioBuffer | null(없음) | 'loading'
async function loadCry(name) {
  if (cries[name] !== undefined) return; cries[name] = 'loading';
  for (const ext of ['mp3', 'ogg', 'wav']) {
    try { const r = await fetch(`/sfx/animal/${name}.${ext}`); if (!r.ok || !/audio|ogg|mpeg|wav|octet/.test(r.headers.get('content-type') || '')) continue; cries[name] = await ctx.decodeAudioData(await r.arrayBuffer()); return; } catch { /* 다음 확장자 */ }
  }
  cries[name] = null;
}
function cry(name, vol, rate) {
  const b = cries[name]; if (!b || b === 'loading') return false;
  const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; s.playbackRate.value = rate * (0.95 + Math.random() * 0.1); g.gain.value = vol;
  s.connect(g); g.connect(master); s.start(); done(b.duration / s.playbackRate.value); return true;
}

export const isMuted = () => muted;
export function setMuted(m) { muted = !!m; try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* 저장 불가 */ } }

/** 첫 터치/클릭 때 호출: 오디오를 깨움 */
export function unlockAudio() {
  try {
    if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.32; master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
    for (const [name] of Object.values(ANIMAL)) loadCry(name); // 동물 소리 파일 미리 불러오기 (없으면 건너뜀)
  } catch { ctx = null; }
}
['pointerdown', 'keydown', 'touchend'].forEach((ev) => addEventListener(ev, unlockAudio, { passive: true }));

// ---------- 소리 재료 ----------
function env(g, t0, dur, vol, attack = 0.005) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); }
let stretch = 1; // 궁극기 소리는 꼬리를 길게 (감쇠 시간 × stretch)
function done(dur) { voices++; setTimeout(() => { voices--; }, dur * 1000 + 60); }
/** 음 하나: f0→f1 Hz로 미끄러짐 */
function tone(f0, f1, dur, type, vol, delay = 0, vib = 0) {
  dur *= stretch;
  const t0 = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 22; lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(t0); l.stop(t0 + dur); }
  env(g, t0, dur, vol); o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02); done(dur + delay);
}
/** 잡음: 필터 주파수가 f0→f1로 변함 (휙 · 쾅) */
function noise(dur, f0, f1, vol, delay = 0, type = 'bandpass') {
  dur *= stretch;
  const t0 = ctx.currentTime + delay, n = Math.max(1, Math.floor(ctx.sampleRate * dur)), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = type; f.Q.value = 1.2; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
  env(g, t0, dur, vol, 0.01); s.connect(f); f.connect(g); g.connect(master); s.start(t0); done(dur + delay);
}

// ---------- 평타 · 투척 ----------
const BASIC = {
  swing: (v, p) => { noise(0.14, 900 * p, 3200 * p, 0.5 * v); },
  thump: (v, p) => { tone(150 * p, 55, 0.16, 'sine', 0.8 * v); noise(0.06, 500, 200, 0.3 * v); },
  smash: (v, p) => { tone(110 * p, 40, 0.3, 'sine', 1 * v); noise(0.22, 700, 120, 0.6 * v); },
  punch: (v, p) => { tone(220 * p, 80, 0.1, 'square', 0.4 * v); noise(0.05, 1500, 600, 0.35 * v); },
  twang: (v, p) => { tone(900 * p, 260 * p, 0.12, 'triangle', 0.5 * v); noise(0.05, 3000, 1500, 0.2 * v); },
  magic: (v, p) => { tone(420 * p, 980 * p, 0.22, 'sine', 0.5 * v, 0, 40); tone(840 * p, 1500 * p, 0.18, 'triangle', 0.2 * v, 0.04); },
  spark: (v, p) => { tone(1200 * p, 1900 * p, 0.09, 'square', 0.25 * v); tone(1900 * p, 1000 * p, 0.07, 'square', 0.15 * v, 0.07); },
  throw: (v, p) => { noise(0.22, 500 * p, 2200 * p, 0.45 * v); tone(220 * p, 520 * p, 0.2, 'sine', 0.25 * v); },
  whirr: (v, p) => { tone(300 * p, 700 * p, 0.3, 'sawtooth', 0.22 * v, 0, 60); },
  tongue: (v, p) => { tone(500 * p, 160, 0.09, 'sine', 0.6 * v); noise(0.05, 2000, 800, 0.25 * v); },
  zap: (v, p) => { for (let i = 0; i < 3; i++) tone((1400 + i * 300) * p, 400, 0.07, 'sawtooth', 0.3 * v, i * 0.045); },
  boom: (v, p) => { tone(120 * p, 40, 0.28, 'sine', 0.9 * v); noise(0.3, 1400, 120, 0.55 * v); },
  coin: (v, p) => { tone(988 * p, 988 * p, 0.07, 'square', 0.22 * v); tone(1319 * p, 1319 * p, 0.16, 'square', 0.22 * v, 0.07); },
  heal: (v) => { [523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.01, 0.2, 'sine', 0.3 * v, i * 0.07)); },
  speed: (v) => { noise(0.3, 600, 4000, 0.4 * v); tone(300, 900, 0.3, 'square', 0.2 * v); },
  pop: (v, p) => { tone(600 * p, 200, 0.07, 'sine', 0.5 * v); },
};

// ---------- 궁극기 (type별 발동음) ----------
const ULT = {
  chain: (v) => { for (let i = 0; i < 5; i++) tone(1500 + i * 120, 300, 0.09, 'sawtooth', 0.4 * v, i * 0.18); tone(200, 60, 0.3, 'sine', 0.8 * v, 0.9); },
  zone: (v) => { noise(0.9, 500, 2500, 0.45 * v); tone(300, 700, 0.5, 'sine', 0.3 * v); },
  snipe: (v) => { tone(300, 1800, 0.7, 'sine', 0.3 * v); tone(2200, 150, 0.25, 'sawtooth', 0.6 * v, 0.8); noise(0.2, 4000, 800, 0.5 * v, 0.8); },
  blackhole: (v) => { tone(500, 40, 1.2, 'sawtooth', 0.4 * v); noise(1, 3000, 80, 0.35 * v); tone(80, 30, 0.5, 'sine', 0.8 * v, 1.2); },
  channel: (v) => { noise(0.7, 400, 2600, 0.45 * v); tone(260, 520, 0.7, 'sawtooth', 0.2 * v, 0, 30); },
  slam: (v) => { for (let i = 0; i < 3; i++) { tone(120, 38, 0.3, 'sine', 0.9 * v, 0.35 + i * 0.5); noise(0.25, 800, 100, 0.5 * v, 0.35 + i * 0.5); } },
  charm: (v) => { [660, 830, 990, 1320].forEach((f, i) => tone(f, f * 1.01, 0.28, 'triangle', 0.35 * v, i * 0.1)); },
  flurry: (v) => { for (let i = 0; i < 6; i++) { tone(240, 80, 0.07, 'square', 0.35 * v, i * 0.12); noise(0.04, 1500, 600, 0.3 * v, i * 0.12); } },
  boomerang: (v) => { tone(300, 900, 0.5, 'sawtooth', 0.25 * v, 0, 80); tone(300, 900, 0.5, 'sawtooth', 0.2 * v, 0.5, 80); },
  wall: (v) => { noise(0.6, 300, 90, 0.6 * v); tone(90, 40, 0.5, 'sine', 0.9 * v); },
  buff: (v) => { [330, 440, 550, 880].forEach((f, i) => tone(f, f * 1.5, 0.18, 'square', 0.28 * v, i * 0.07)); },
  wave: (v) => { noise(0.9, 200, 1800, 0.6 * v); tone(80, 160, 0.8, 'sine', 0.7 * v); },
  magnet: (v) => { tone(200, 1400, 0.7, 'sine', 0.35 * v, 0, 50); noise(0.5, 800, 3500, 0.25 * v); },
  tether: (v) => { tone(900, 200, 0.18, 'sawtooth', 0.4 * v); tone(200, 900, 0.18, 'sine', 0.3 * v, 0.18); },
  burst: (v) => { tone(100, 30, 0.6, 'sine', 1 * v); noise(0.6, 900, 80, 0.7 * v); },
  brood: (v) => { for (let i = 0; i < 7; i++) tone(500 + Math.random() * 400, 250, 0.06, 'square', 0.25 * v, i * 0.07); },
  phoenix: (v) => { noise(1.1, 300, 2400, 0.55 * v); tone(200, 900, 1.0, 'sawtooth', 0.3 * v, 0, 40); tone(110, 35, 0.5, 'sine', 0.9 * v, 1.1); },
  stage: (v) => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.3 * v, i * 0.1)); },
  rally: (v) => { [523, 659, 784].forEach((f, i) => tone(f, f * 1.02, 0.4, 'sine', 0.35 * v, i * 0.12)); },
  rush: (v) => { noise(0.4, 400, 3000, 0.5 * v); tone(150, 600, 0.35, 'sawtooth', 0.3 * v); },
  barrage: (v) => { for (let i = 0; i < 6; i++) tone(900, 250, 0.08, 'triangle', 0.3 * v, i * 0.08); },
  meteor: (v) => { noise(0.8, 2500, 200, 0.5 * v); tone(90, 35, 0.5, 'sine', 0.9 * v, 0.7); },
  pull: (v) => { tone(200, 1200, 0.5, 'sine', 0.35 * v); },
  orbit: (v) => { tone(400, 800, 0.6, 'sawtooth', 0.2 * v, 0, 60); },
};

const ATK_GAP = 45, ULT_GAP = 120, BOOM_GAP = 60; // 같은 종류 소리의 최소 간격(ms): 한꺼번에 몰려도 시끄럽지 않게
const gate = (k, gap) => { const t = performance.now(); if (t - (lastAt[k] || 0) < gap) return false; lastAt[k] = t; return true; };
const pitchOf = (id) => { let h = 0; for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 0.85 + (h % 41) / 100; }; // 캐릭터마다 0.85~1.25배 음높이
/** 나와의 거리 d(칸)에 따른 음량: 3칸 안은 그대로, 16칸이 넘으면 안 들림 */
export const loudness = (d) => (d <= 3 ? 1 : Math.max(0, 1 - (d - 3) / 13) ** 2);

/** 월드 이벤트 하나를 소리로. ctx2: { mine, screen, x, y, fx, fy, charId } (좌표는 칸 단위) */
export function sfxEvent(e, c) {
  if (muted || !ctx || ctx.state !== 'running' || voices > 28) return;
  const isUlt = e.e === 'ult';
  if (c.screen && !isUlt) return; // 빔프로젝터는 궁극기 소리만
  let v = 1;
  if (!c.screen && !c.mine && c.fx != null && c.x != null) v = loudness(Math.hypot(c.x - c.fx, c.y - c.fy)); // 멀리 있는 사람 소리는 작게
  if (v < 0.04) return;
  const p = pitchOf(c.charId), an = ANIMAL[c.charId];
  if (an && (isUlt || e.e === 'atk') && gate('c' + e.id, isUlt ? 300 : 1100)) cry(an[0], Math.min(1, v) * (isUlt ? 0.9 : 0.6), an[1]); // 동물 캐릭터: 궁극기엔 확실히, 평타엔 가끔 울음
  if (isUlt) { const f = ULT[e.t]; if (f && gate('u' + e.id, ULT_GAP)) { stretch = 1.7; try { f(Math.min(1, v * (c.mine ? 1 : 0.9))); } finally { stretch = 1; } } return; }
  let k = null;
  if (e.e === 'atk') {
    if (e.kind === 'melee') k = e.fx === 'smash' ? 'smash' : e.fx === 'bump' ? 'thump' : e.fx === 'punch' ? 'punch' : 'swing';
    else if (e.kind === 'ranged') k = e.fx === 'tongue' ? 'tongue' : 'spark';
    else if (e.kind === 'proj') k = e.fx === 'chain' ? 'zap' : e.lob ? 'throw' : e.art === 'boomerang' ? 'whirr' : /arrow/.test(e.art || '') ? 'twang' : e.art === 'orb' ? 'magic' : e.art ? 'throw' : 'spark';
    if (k && gate('a' + (c.mine ? 'm' : 'o'), ATK_GAP)) BASIC[k](v * (c.mine ? 1 : 0.8), p);
  } else if (e.e === 'boom' && gate('b', BOOM_GAP)) BASIC.boom(v * 0.8, 1);
  else if (e.e === 'coinGet' && gate('coin' + (c.mine ? 'm' : 'o'), 55)) BASIC.coin(v * (c.mine ? 1 : 0.6), 1 + Math.random() * 0.12); // 동전 줍는 소리 (음높이를 살짝 흔들어 단조롭지 않게)
  else if (e.e === 'itemGet') { if (e.k === 'heart' && gate('heal' + (c.mine ? 'm' : 'o'), 150)) BASIC.heal(v * (c.mine ? 1 : 0.6)); else if (e.k === 'shoe' && gate('shoe', 150)) BASIC.speed(v * (c.mine ? 1 : 0.6)); } // 체력 회복(하트·회복 효과) / 신발
}
