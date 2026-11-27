// 효과음: 파일 없이 WebAudio로 합성한 8비트풍 소리. 평타·투척·궁극기 소리를 내고, 나와 멀수록 작아져 일정 거리 밖은 안 들린다.
// 빔프로젝터(screen)는 궁극기 소리만 낸다. 폰은 처음 화면을 터치한 뒤부터 소리가 난다 (브라우저 정책).
const KEY = 'quiz_sfx_muted';
let ctx = null, master = null, muffle = null, muffled = false, voices = 0, muted = false;
try { muted = localStorage.getItem(KEY) === '1'; } catch { /* 저장 불가 */ }
const lastAt = {};

// ---------- 실제 동물 울음소리 (public/sfx/animal/*.mp3|ogg|wav) ----------
// 파일이 없으면 null로 두고 합성음을 그대로 씀. 캐릭터 → [파일 이름, 음높이]
const ANIMAL = { puppy: ['dog', 1.3], labrador: ['dog', 0.9], shiba: ['dog', 1.05], cat: ['cat', 1], frog: ['frog', 1], pig: ['pig', 1], hippo: ['hippo', 1], chicken: ['chicken', 1], chick: ['chick', 1] };
const cries = {}; // 경로 → AudioBuffer | null(없음) | 'loading'
const CLIPS = { animal: ['dog', 'cat', 'frog', 'pig', 'hippo', 'chicken', 'chick'], ult: [] }; // 불러올 파일 (public/sfx/<폴더>/<이름>.mp3|ogg|wav)
const DIVA_ULT = ['diva1', 'diva2', 'diva3']; // 크림슨 디바 궁극기: 셋 중 하나를 무작위로
async function loadClip(path) { // 예: 'animal/dog', 'ult/diva1'
  if (cries[path] !== undefined) return; cries[path] = 'loading';
  for (const ext of ['mp3', 'ogg', 'wav']) {
    try { const r = await fetch(`/sfx/${path}.${ext}`); if (!r.ok || !/audio|ogg|mpeg|wav|octet/.test(r.headers.get('content-type') || '')) continue; cries[path] = await ctx.decodeAudioData(await r.arrayBuffer()); return; } catch { /* 다음 확장자 */ }
  }
  cries[path] = null;
}
const clip = (path) => { const b = cries[path]; return b && b !== 'loading' ? b : null; };
function cry(name, vol, rate) { // 동물 울음소리(평타용 짧은 소리)
  const b = clip('animal/' + name); if (!b) return false;
  const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; s.playbackRate.value = rate * (0.95 + Math.random() * 0.1); g.gain.value = vol;
  s.connect(g); g.connect(master); s.start(); done(b.duration / s.playbackRate.value); return true;
}

// ---------- 궁극기 소리 관리: 동시에 최대 2개, 넘치면 가장 먼저 시작한 것부터 바로 끔, 끝날 땐 페이드아웃 ----------
const MAX_ULT = 2, FADE_OUT = 0.45;
const ultVoices = []; // { id, bus, t0, end }
let bus = null, busLen = 0; // 지금 만드는 궁극기 소리의 묶음 / 합성 소리의 길이
function cutNow(o, sec = 0.03) { const t = ctx.currentTime; o.bus.gain.cancelScheduledValues(t); o.bus.gain.setValueAtTime(o.bus.gain.value, t); o.bus.gain.linearRampToValueAtTime(0, t + sec); setTimeout(() => { try { o.bus.disconnect(); } catch { /* 이미 끊김 */ } }, sec * 1000 + 80); }
/** 가장 먼저 시작한 궁극기 소리부터 즉시 끄고, 새 소리가 들어갈 자리를 만든다 */
function makeRoom() { // 보호된 소리(크림슨 디바)는 다른 궁극기 소리 때문에 꺼지지 않음 → 보호 안 된 것 중 가장 오래된 것을 끔. 끌 게 없으면 false
  const now = ctx.currentTime; for (let i = ultVoices.length - 1; i >= 0; i--) if (ultVoices[i].end <= now) ultVoices.splice(i, 1);
  while (ultVoices.length >= MAX_ULT) { const i = ultVoices.findIndex((o) => !o.keep); if (i < 0) return false; cutNow(ultVoices.splice(i, 1)[0]); }
  return true;
}
/** 궁극기 소리 하나 시작. play()는 소리를 bus에 만들고 길이(초)를 돌려줌. 궁극기 지속시간(dur)보다 길면 그때 페이드아웃으로 끝냄 */
function playUlt(id, dur, play, keep = false) {
  if (!makeRoom() && !keep) return; // 자리가 없고(모두 보호된 소리) 이 소리도 보호 대상이 아니면 재생 안 함
  const b = ctx.createGain(), t0 = ctx.currentTime; b.connect(master); bus = b; busLen = 0;
  let len = 0; try { len = play() || busLen; } finally { bus = null; }
  const end = dur > 0 && len > dur ? dur : len; // 궁극기가 끝나는 때(소리가 더 짧으면 소리 끝)
  b.gain.setValueAtTime(1, t0 + Math.max(0, end - FADE_OUT)); b.gain.linearRampToValueAtTime(0, t0 + end + 0.02); // 끝날 땐 페이드아웃
  ultVoices.push({ id, bus: b, t0, end: t0 + end, keep });
  setTimeout(() => { try { b.disconnect(); } catch { /* 이미 끊김 */ } }, (end + 0.3) * 1000);
}
/** 궁극기 시전자가 쓰러지는 등 도중에 끊기면 그 소리를 부드럽게 끔 */
export function stopUltOf(id, sec = 0.25) { if (!ctx) return; for (let i = ultVoices.length - 1; i >= 0; i--) if (ultVoices[i].id === id) { cutNow(ultVoices[i], sec); ultVoices.splice(i, 1); } }
export const _ultVoiceCount = () => ultVoices.filter((o) => o.end > ctx.currentTime).length; // 시험용
function ultClip(path, vol) { // 파일로 된 궁극기 소리를 bus에 올림, 길이 반환
  const b = clip(path); if (!b) return 0;
  const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; g.gain.value = vol; s.connect(g); g.connect(bus); s.start(); done(b.duration); return b.duration;
}

/** 죽은 상태의 소리: 저역통과 필터(low-pass)로 고음을 깎아 "문 너머에서 들리는 클럽 소리"처럼 먹먹하게 (머플드 / 오클루전 효과) */
export function setMuffled(on) {
  if (!ctx || !muffle || muffled === !!on) return; muffled = !!on; const t = ctx.currentTime;
  muffle.frequency.cancelScheduledValues(t); muffle.frequency.setTargetAtTime(on ? 520 : 22000, t, on ? 0.12 : 0.2); // 천천히 먹먹해지고, 살아나면 서서히 맑아짐
  master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(on ? 0.26 : 0.32, t, 0.15);
}
export const _muffleFreq = () => (muffle ? muffle.frequency.value : null); // 시험용
export const isMuted = () => muted;
export function setMuted(m) { muted = !!m; try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* 저장 불가 */ } }

/** 첫 터치/클릭 때 호출: 오디오를 깨움 */
export function unlockAudio() {
  try {
    if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.32; muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.Q.value = 0.7; muffle.frequency.value = 22000; master.connect(muffle); muffle.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
    for (const n of CLIPS.animal) { loadClip('animal/' + n); loadClip('animal/' + n + '_ult'); } DIVA_ULT.forEach((n) => loadClip('ult/' + n)); // 소리 파일 미리 불러오기 (없으면 건너뜀)
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
  env(g, t0, dur, vol); o.connect(g); g.connect(bus || master); o.start(t0); o.stop(t0 + dur + 0.02); done(dur + delay); busLen = Math.max(busLen, dur + delay);
}
/** 잡음: 필터 주파수가 f0→f1로 변함 (휙 · 쾅) */
function noise(dur, f0, f1, vol, delay = 0, type = 'bandpass') {
  dur *= stretch;
  const t0 = ctx.currentTime + delay, n = Math.max(1, Math.floor(ctx.sampleRate * dur)), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = type; f.Q.value = 1.2; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
  env(g, t0, dur, vol, 0.01); s.connect(f); f.connect(g); g.connect(bus || master); s.start(t0); done(dur + delay); busLen = Math.max(busLen, dur + delay);
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
  // 궁극기 타격음 (다단히트 한 대 한 대): 짧게 끝나야 연달아 나도 뭉치지 않음
  hitArrow: (v, p) => { tone(1500 * p, 600 * p, 0.05, 'triangle', 0.4 * v); noise(0.03, 3500, 1800, 0.2 * v); },
  hitFire: (v, p) => { noise(0.1, 2600 * p, 900, 0.4 * v); tone(260 * p, 120, 0.08, 'sawtooth', 0.15 * v); },
  hitThump: (v, p) => { tone(190 * p, 70, 0.09, 'square', 0.4 * v); noise(0.04, 1400, 500, 0.3 * v); },
  hitZap: (v, p) => { tone(1800 * p, 500, 0.06, 'sawtooth', 0.35 * v); noise(0.03, 5000, 2500, 0.2 * v); },
  hitSmash: (v, p) => { tone(120 * p, 45, 0.22, 'sine', 0.9 * v); noise(0.14, 900, 160, 0.5 * v); },
  hitTick: (v, p) => { tone(700 * p, 420 * p, 0.04, 'square', 0.25 * v); },
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
  if (c.screen && !isUlt && !(e.e === 'hit' && e.u) && !['stun', 'ghost', 'channelEnd'].includes(e.e)) return; // 빔프로젝터는 궁극기 소리(발동·타격)만 (끊김 신호는 받음)
  let v = 1;
  if (!c.screen && !c.mine && c.fx != null && c.x != null) v = loudness(Math.hypot(c.x - c.fx, c.y - c.fy)); // 멀리 있는 사람 소리는 작게
  if (v < 0.04) return;
  const p = pitchOf(c.charId), an = ANIMAL[c.charId];
  if (e.e === 'stun' || e.e === 'ghost' || e.e === 'channelEnd') { stopUltOf(e.id, e.e === 'channelEnd' ? FADE_OUT : 0.25); return; } // 궁극기 도중 쓰러지거나 끊기면 그 소리도 부드럽게 끔
  if (an && e.e === 'atk' && gate('c' + e.id, 1100)) cry(an[0], Math.min(1, v) * 0.6, an[1]); // 동물 캐릭터는 평타 때 가끔 울음
  if (isUlt) {
    if (!gate('u' + e.id, ULT_GAP)) return;
    const vol = Math.min(1, v * (c.mine ? 1 : 0.9)), dur = (e.sec || 0) + (e.intro || 0);
    const path = c.charId === 'gaga' ? 'ult/' + DIVA_ULT[Math.floor(Math.random() * DIVA_ULT.length)] : an ? `animal/${an[0]}_ult` : null; // 디바: 세 곡 중 무작위 · 동물: 전용 궁극기 소리
    if (path && clip(path)) playUlt(e.id, dur, () => ultClip(path, vol * (c.charId === 'gaga' ? 0.85 : 0.9)), c.charId === 'gaga'); // 디바 소리는 다른 궁극기 소리에 끊기지 않음
    else { const f = ULT[e.t]; if (f) { stretch = 1.7; try { playUlt(e.id, dur, () => { f(vol); return busLen; }); } finally { stretch = 1; } } } // 파일이 없으면 합성음
    return;
  }
  let k = null;
  if (e.e === 'atk') {
    if (e.kind === 'melee') k = e.fx === 'smash' ? 'smash' : e.fx === 'bump' ? 'thump' : e.fx === 'punch' ? 'punch' : 'swing';
    else if (e.kind === 'ranged') k = e.fx === 'tongue' ? 'tongue' : 'spark';
    else if (e.kind === 'proj') k = e.fx === 'chain' ? 'zap' : e.lob ? 'throw' : e.art === 'boomerang' ? 'whirr' : /arrow/.test(e.art || '') ? 'twang' : e.art === 'orb' ? 'magic' : e.art ? 'throw' : 'spark';
    if (k && gate('a' + (c.mine ? 'm' : 'o'), ATK_GAP)) BASIC[k](v * (c.mine ? 1 : 0.8), p);
  } else if (e.e === 'hit') { // 궁극기로 맞은 타격은 한 대마다 소리 (파란티 번개, 궁수 화살비, 흑발·강아지·시바 회전, 격투가 난타, 오크 강타, 부메랑, 닭 쪼기 …)
    if (!e.u || e.fx === 'note' || !gate('h' + (c.mine ? 'm' : 'o'), 40)) return; // 디바 무대의 음표 틱은 곡이 있으니 제외
    const fx = String(e.fx || ''), big = e.dmg >= 12, k = big || /smash/.test(fx) ? 'hitSmash' : /arrow|rain|boomerang/.test(fx) ? 'hitArrow' : /fire|flame|burn|crescent|bottle/.test(fx) ? 'hitFire' : /spark|chain|zap|beam/.test(fx) ? 'hitZap' : /peck/.test(fx) ? 'hitTick' : 'hitThump'; // 기본(펀치·회전·할퀴기)은 퍽 하는 소리
    BASIC[k](v * (c.mine ? 0.85 : 0.6), p * (0.95 + Math.random() * 0.1));
  } else if (e.e === 'regen') { if (c.mine && gate('regen', 400)) BASIC.heal(0.45); } // 자동 회복: 내 것만 작게
  else if (e.e === 'boom' && gate('b', BOOM_GAP)) BASIC.boom(v * 0.8, 1);
  else if (e.e === 'coinGet' && gate('coin' + (c.mine ? 'm' : 'o'), 55)) BASIC.coin(v * (c.mine ? 1 : 0.6), 1 + Math.random() * 0.12); // 동전 줍는 소리 (음높이를 살짝 흔들어 단조롭지 않게)
  else if (e.e === 'itemGet') { if (e.k === 'heart' && gate('heal' + (c.mine ? 'm' : 'o'), 150)) BASIC.heal(v * (c.mine ? 1 : 0.6)); else if (e.k === 'shoe' && gate('shoe', 150)) BASIC.speed(v * (c.mine ? 1 : 0.6)); } // 체력 회복(하트·회복 효과) / 신발
}
export const _loaded = () => Object.entries(cries).filter(([, v]) => v && v !== 'loading').map(([k]) => k); // 시험용: 불러온 소리 파일
export const _ultIds = () => ultVoices.filter((o) => o.end > ctx.currentTime).map((o) => o.id + (o.keep ? '*' : '')); // 시험용
