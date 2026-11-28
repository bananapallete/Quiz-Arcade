// 게임 상태와 규칙. 네트워크(소켓)는 모르고, index.js가 입력을 넣고 snapshot()을 방송한다.
// 모든 판정(이동, 충돌, 공격, 구역, 점수)은 서버가 한다.

import { blockWalls, buffOf, charge, CHARGE_TAKEN, hit as ultHit, ultReady, minionsSnapshot, updateUlts, useUlt, wallsSnapshot, zonesSnapshot } from './ult.js';
import { dpsOf } from './balance.js';
import { BRAWL_MAP, BRAWL_REVIVE_SEC, brawlSpawn, inBush, inObstacle, inWater, pushOut } from '../shared/brawlMap.js';
import { calCell, calCenter, calLayout, fmtScore, isCombat, PREP_SEC, REGEN, ULT_CHARGE, RUN_DRAIN, CHAR_CD_SEC, COIN, COMBO_RESET_SEC, CRIT, CROWD, ITEM, MAP, PHASE, READ_SEC, SPRITE, zoneAt, ZONES } from '../shared/constants.js';

const KNOCK_DECAY = 12; // 밀림 속도 감쇠(1/s). 총 밀림 거리 = 처음 속도 / 감쇠
const ATTACK_ANIM_SEC = 0.25;
const BONUS = [3, 2, 1]; // 정답자 중 1~3등 추가 점수
const BASE_POINT = 1;
const MAX_PLAYERS = 40;

const r2 = (n) => Math.round(n * 100) / 100;
const rand = (a, b) => a + Math.random() * (b - a);

// 어떤 구역도 아닌 맵 안쪽 지점 (입장·모이기 위치)
const BOT_NAMES = ['민준', '서연', '지호', '하윤', '도윤', '지우', '예준', '서윤', '시우', '지민', '주원', '수아', '하준', '다은', '건우', '채원', '현우', '유나', '준서', '소율', '지훈', '예린', '우진', '나윤', '승현', '가은', '태양', '시은', '재민', '아린', '동현', '하은', '민재', '지안', '성민', '윤서', '진우', '다인', '은우', '세아', '정우', '유진', '태민', '소은', '재윤', '나은', '현서', '지율', '시현', '혜원'];
const AUTO_AIM = 10; // 자동 조준으로 상대를 잡는 거리(칸): 모든 캐릭터 공통 (실제로 맞는 거리는 각자 사거리)
const AIM_SLACK = 1.2, HIT_SLACK = 0.5; // 근접 자동 조준: 사거리보다 1.2칸 멀리서도 상대를 잡고, 자동 조준한 공격은 사거리가 0.5칸 후함 (수동 조준은 그대로)
export const SANDBAG_ATTACK = false; // 샌드백(지킴이) 공격 기능: 지금은 꺼 둠 (true면 가까이 오면 때림)
function spawnPos() {
  for (let i = 0; i < 20; i++) {
    const x = rand(2, MAP.w - 2), y = rand(2, MAP.h - 2);
    if (!zoneAt('ox', x, y) && !zoneAt('choice', x, y)) return [x, y];
  }
  return [2, 2];
}

export class Game {
  constructor(characters, quizzes) {
    this.characters = characters;
    this.questions = quizzes.map((q, i) => ({ ...q, id: i + 1, mode: q.type === 'real' ? '현실' : q.type === 'brawl' ? (q.tour ? '토너먼트' : '대난투') : q.type === 'calendar' ? '달력' : q.type === 'coin' ? '동전' : q.mode === '팀' ? '팀' : '개인' }));
    this.tour = null; // 팀 토너먼트 진행 상태
    this.coinRun = null; // 동전 모으기 진행 상태
    this.rounds = []; // 대난투·토너먼트 라운드별 팀 점수 기록 [{n, title, kind, teams:{팀:점수}}]
    this.players = new Map();
    this.t = 0; // 게임 시간(초)
    this.phase = PHASE.LOBBY;
    this.phaseEnd = 0;
    this.question = null;
    this.reveal = null;
    this.events = [];
    this.botSeq = 0;
    this.coins = new Map(); // 맵 위의 동전 id → {id,x,y,readyAt,lockUntil}
    this.coinSeq = 0;
    this.coinClock = 0;
    this.items = new Map(); // 맵 위의 하트/신발 id → {id,k,x,y}
    this.itemSeq = 0;
    this.itemClock = 0;
    this.coinsSpawned = 0; // 지금까지 생성한 동전 수 (습득된 것 포함)
    this.showRank = false; // 빔프로젝터에 순위표를 띄울지
    this.showQr = true; this.hideAns = false; this.timerPaused = false; this.frozen = false; this.multiplier = 1; this.notice = null; this.screenMode = 'quiz'; this.cal = null; this.map = MAP; this.solids = false; this._cmCache = new WeakMap(); this.noAtk = false; this.noUlt = false; this.god = false; this.scoreLog = []; this.history = []; this.histSeq = 0; // 진행자 기능
    this.locked = null; // 시간이 끝난 시점에 굳어진 판정 (정답 공개 때 점수에 반영)
    this.realPending = new Map(); // 현실 퀴즈: 진행자가 입력한 점수 id → 점수
    this.realConfirmed = false;
    this.asked = new Set(); // 이미 낸 문제 (투표 후보에서 빠짐)
    this.kicked = new Set(); // 내보낸 참가자 토큰
    this.repSeq = 0; // 토너먼트 대표 지정 순서
    this.teamCount = 2; // 팀은 항상 2팀 (들어오면 인원이 적은 팀으로)
    this.log = []; // 진행자 화면 기록
    this.projectiles = new Map(); // 날아가는 투사체 id → {...}
    this.projSeq = 0;
    this.ultDepth = 0; // 궁극기에서 나온 피해를 처리하는 동안 1 이상
    this.tasks = []; // 궁극기 예약 실행 [{at, fn}]
    this.minions = new Map(); // 궁극기로 부화한 병아리 부하 {id,owner,x,y,st,...}
    this.minionSeq = 0;
    this.zonesU = new Map(); // 궁극기 바닥 범위
    this.zoneSeq = 0;
    this.walls = new Map(); // 기사 방패 성벽 {id,owner,x,y,hx,hy,until}
    this.wallSeq = 0;
    this.map = MAP;
    this.cast = { m: 'auto', id: null }; // 빔프로젝터 중계: auto = 전투 모드에서 유령 아닌 1등을 따라감 · off = 전체 맵 · id = 진행자가 고른 참가자
    this.botsCanAttack = false; // 더미 봇은 기본적으로 공격하지 않음 (호스트 패널에서 켤 수 있음)
  }

  // ---------- 플레이어 ----------
  join({ token, name, charId }) {
    let p = token && this.players.get(token);
    if (p && !p.isBot) {
      if (p.parked) p.parkConn = true; else p.connected = true; // 재접속: 외형과 점수 유지 (관전 중이면 맵에는 다음 경기에)
      return p;
    }
    if (this.humans().length >= MAX_PLAYERS) return null;
    if (!this.characters[charId]) charId = Object.keys(this.characters)[0];
    return this._spawn({ id: token, name: String(name || '이름없음').slice(0, 10), charId, isBot: false });
  }

  /** 나와 같은 팀(팀이 있을 때만) 접속자, 나 포함 */
  /** 같은 편인가: 같은 팀이거나, 아군 봇(ally)과 사람/아군 봇 */
  _sameSide(a, b) { return !!(a.team && a.team === b.team) || !!((a.ally && (!b.isBot || b.ally)) || (b.ally && !a.isBot)); }
  _allies(p) { return [...this.players.values()].filter((o) => o === p || (o.connected && !o.stunned && this._sameSide(p, o))); }

  /** 점수·등수·팀에 들어가는 참가자: 사람 + 테스트용 봇 (샌드백·아군 봇은 제외) */
  contestants() { return [...this.players.values()].filter((p) => !p.home); }

  humans() {
    return [...this.players.values()].filter((p) => !p.isBot);
  }

  /** 캐릭터 변경(참가자 본인): 체력·게이지를 새 캐릭터로 채움 */
  setChar(id, charId) {
    const p = this.players.get(id);
    if (!p || p.isBot || !this.characters[charId] || this.charWait(id) > 0) return false;
    const lobby = this.phase === PHASE.LOBBY, ratio = p.hp / p.cfg.hp;
    p.charId = charId; p.cfg = this.characters[charId]; p.dash = null; p.baseCfg = null; this._refill(p);
    if (!lobby) { p.hp = Math.max(1, Math.ceil(p.cfg.hp * ratio)); p.charReadyAt = this.t + CHAR_CD_SEC; } // 퀴즈 중엔 체력 비율 유지(회복 꼼수 방지), 궁극기 충전은 초기화
    return true;
  }

  /** 지금 캐릭터를 바꾸려면 더 기다려야 하는 초 (대기실은 항상 0) */
  charWait(id) { const p = this.players.get(id); return !p || this.phase === PHASE.LOBBY ? 0 : Math.max(0, Math.ceil((p.charReadyAt || 0) - this.t)); }

  setConnected(id, connected) {
    const p = this.players.get(id);
    if (p?.parked) p.parkConn = connected; else if (p) p.connected = connected;
  }

  addBot(mode = 'idle', charId = 'blue') {
    if (charId === 'random') { const ids = Object.keys(this.characters); charId = ids[Math.floor(Math.random() * ids.length)]; }
    if (!this.characters[charId]) charId = Object.keys(this.characters)[0];
    const id = `bot-${++this.botSeq}`;
    const used = new Set([...this.players.values()].map((p) => p.name)), free = BOT_NAMES.filter((n) => !used.has(n));
    const name = free.length ? free[Math.floor(Math.random() * free.length)] : `${BOT_NAMES[this.botSeq % BOT_NAMES.length]}${this.botSeq}`; // 임의의 사람 이름(겹치지 않게), 다 쓰면 번호를 붙임
    return this._spawn({ id, name, charId, isBot: true, botMode: mode });
  }

  clearBots() {
    for (const [id, p] of this.players) if (p.isBot) { this.players.delete(id); this.realPending.delete(id); }
  }

  _spawn({ id, name, charId, isBot, botMode }) {
    const cfg = this.characters[charId];
    const spawn = spawnPos();
    const p = {
      id, name, charId, cfg, isBot, botMode: botMode || null, hurtAt: -99, regenT: 0,
      connected: true,
      x: spawn[0], y: spawn[1],
      team: 0, kx: 0, ky: 0, // 팀(0=없음) · 밀림 속도
      face: 1,
      input: { mx: 0, my: 0, run: false },
      tether: null, tetherStack: null, charmStack: null, charmUntil: 0, charmBy: null, channel: null, orbit: null, ult: 0, buff: null, rootUntil: 0, slowUntil: 0, slowMul: 1, shield: null, burnUntil: 0, burnBy: null, burnNext: 0, speedUntil: 0, hp: cfg.hp, stunned: false, stunUntil: 0, invUntil: 0,
      runGauge: cfg.runGauge, exhausted: false, running: false, moving: false,
      nextAttackAt: 0, attackUntil: 0, comboStep: 0, lastAttackAt: -99,
      skillReadyAt: 0, dash: null, dashPass: false,
      ammoF: cfg.ammo?.max ?? 99, // 탄창: 정수 부분이 쏠 수 있는 발수, 소수 부분은 장전 진행도
      score: 0, coins: 0, zone: null, zoneSince: 0,
      ai: { nextThink: 0, mx: 0, my: 0 },
    };
    this.players.set(id, p);
    p.team = this._smallTeam(p); // 항상 2팀: 인원이 적은 팀으로 (샌드백·아군 봇은 아래에서 0으로)
    return p;
  }

  /** 진행자: 토너먼트 대표(★) 지정/해제. 팀마다 최대 2명 — 넘치면 먼저 지정한 사람이 빠짐 */
  toggleRep(id) {
    const p = this.players.get(id); if (!p || !p.team) return false;
    if (p.rep) { p.rep = 0; return true; }
    const same = this.contestants().filter((o) => o.rep && o.team === p.team).sort((a, b) => a.rep - b.rep);
    while (same.length >= 2) same.shift().rep = 0;
    p.rep = ++this.repSeq; return true;
  }

  /** 1·2팀 중 지금 인원이 적은 팀 (같으면 무작위) */
  _smallTeam(except) {
    const n = [0, 0, 0]; for (const o of this.contestants()) if (o !== except && this._present(o) && (o.team === 1 || o.team === 2)) n[o.team]++;
    return n[1] === n[2] ? (Math.random() < 0.5 ? 1 : 2) : n[1] < n[2] ? 1 : 2;
  }

  setInput(id, i) {
    const p = this.players.get(id);
    if (!p || !i) return;
    const mx = Number(i.mx) || 0, my = Number(i.my) || 0;
    const len = Math.hypot(mx, my);
    // 방향만 사용: 조이스틱을 얼마나 밀었든 항상 같은 속도 (가속·감속 없음)
    p.input = len > 0.1 ? { mx: mx / len, my: my / len, run: !!i.run } : { mx: 0, my: 0, run: !!i.run };
    p.rawIn = p.input; // 난타처럼 입력을 덮어쓰는 동안에도 진짜 스틱 값은 남겨 둔다
  }

  // ---------- 진행 ----------
  ask(qid) {
    const q = this.questions.find((x) => x.id === qid);
    if (!q) return false;
    this.asked.add(q.id);
    return this._begin(q);
  }

  /** 다음 문제 투표: 아직 안 낸 문제 최대 4개를 객관식 4칸에 깔고, 참가자가 걸어가서 고름 (시간 끝나면 가장 많은 칸) */
  startVote(sec = 15) {
    const cands = this.questions.filter((q) => !this.asked.has(q.id)).slice(0, 4);
    if (cands.length < 2) return false;
    this._log('다음 문제 투표');
    return this._begin({ id: 0, type: 'choice', text: '다음 문제 투표! 원하는 칸으로', options: cands.map((q) => `${q.mode} · ${q.text}`.slice(0, 24)), answer: null, time: sec, mode: '투표', vote: cands.map((q) => q.id) });
  }

  _finishVote() {
    const q = this.question, d = this.locked?.dist || {}, n = q.vote.map((_, i) => d[i + 1] || 0), top = Math.max(...n);
    const best = q.vote.filter((_, i) => n[i] === top), win = best[Math.floor(Math.random() * best.length)]; // 같으면 무작위
    this.reveal = { answer: q.vote.indexOf(win) + 1, vote: true, winner: win, counts: n, results: [], dist: d };
    this.locked = null; this.phase = PHASE.REVEAL; this._log(`투표 결과: Q${win}`);
  }

  _begin(q) {
    this._unpark(); this.preview = null; this._endBrawlWorld(); this._clearUltWorld(); this.brawl = null; this.cal = null; this.tour = null; this.coinRun = null;
    this.question = q;
    this.reveal = null; this.locked = null; this.realPending = new Map(); this.realConfirmed = false;
    this.showRank = false; this.hideAns = false; this.screenMode = 'quiz'; this.timerPaused = false;
    this.phase = q.type === 'real' ? PHASE.REAL : PHASE.READING;
    this.phaseEnd = this.t + READ_SEC;
    this.prepUntil = q.type === 'real' ? 0 : this.t + PREP_SEC; // 준비 시간 (공격·궁극기 불가, 궁극기 게이지도 멈춤)
    if (!q.vote) this._log(`문제 ${q.id} 출제`);
    for (const p of this.players.values()) { p.out = false; p.ghost = false; p.stunned = false; p.stunUntil = 0; this._refill(p); } // 문제마다 체력·달리기 게이지 가득
    if (q.type === 'brawl' && q.tour) this._tourSetup();
    else if (q.type === 'brawl') this._brawlSetup();
    if (q.type === 'calendar') this._calSetup();
    if (q.type === 'coin') this._coinSetup();
    return true;
  }

  addQuestion(q) {
    const tour = q.type === 'tourney' || (q.type === 'brawl' && !!q.tour);
    const type = q.type === 'choice' ? 'choice' : q.type === 'real' ? 'real' : q.type === 'brawl' || tour ? 'brawl' : q.type === 'calendar' ? 'calendar' : q.type === 'coin' ? 'coin' : 'ox';
    const item = {
      id: this.questions.length ? Math.max(...this.questions.map((x) => x.id)) + 1 : 1,
      type,
      text: String(q.text || '').slice(0, 120),
      options: type === 'choice' ? (q.options || ['1번', '2번', '3번', '4번']).slice(0, 4) : undefined,
      answer: type === 'real' || type === 'brawl' || type === 'calendar' || type === 'coin' ? null : type === 'ox' ? (q.answer === 'X' ? 'X' : 'O') : Math.min(4, Math.max(1, Number(q.answer) || 1)),
      time: type === 'brawl' || type === 'calendar' || type === 'coin' ? Math.min(900, Math.max(20, Number(q.time) || (type === 'calendar' ? 300 : tour ? 90 : type === 'coin' ? 60 : 240))) : Math.min(60, Math.max(5, Number(q.time) || 15)),
      mode: type === 'real' ? '현실' : tour ? '토너먼트' : type === 'brawl' ? '대난투' : type === 'calendar' ? '달력' : type === 'coin' ? '동전' : q.mode === '팀' ? '팀' : '개인',
      image: q.image ? String(q.image).slice(0, 300) : undefined,
    };
    if (type === 'real') item.answer = null;
    if (type === 'brawl' || type === 'coin') item.pts = Math.max(1, Number(q.pts) || 5);
    if (tour) item.tour = true;
    if (type === 'calendar') { item.days = Math.min(31, Math.max(28, Number(q.days) || 30)); item.month = Math.min(12, Math.max(0, Number(q.month) || 0)); item.start = Math.min(6, Math.max(0, Number(q.start) || 0)); item.bad = (q.bad || []).map(Number).filter((d) => d >= 1 && d <= item.days); }
    this.questions.push(item);
    return item;
  }

  /** 진행자의 '정답 공개': 시간이 끝나길 기다리는 중이어도, 끝나서 대기 중이어도 이 시점의 판정으로 점수를 반영해 공개 */
  endQuestion() {
    if (this.brawl && this.phase === PHASE.MOVING) return this._finishBrawl(); // 대난투: 지금 상태로 바로 끝냄
    if (this.cal && this.phase === PHASE.MOVING) return this._calGrade(); // 달력: 채점하기
    if (this.coinRun && this.phase === PHASE.MOVING) return this._coinFinish(); // 동전 모으기: 지금 개수로 끝냄
    if (this.brawl || this.cal || this.coinRun) return; // 읽는 중엔 구역 판정이 없어 모두 정답 처리되던 문제 방지
    if (this.phase === PHASE.READING || this.phase === PHASE.MOVING) this._lock();
    if (this.phase === PHASE.HOLD || this.locked) this._applyLocked();
  }

  /** 문제가 바뀌면 이전 문제의 궁극기 잔재(성벽·바닥 범위·투사체·병아리)를 치움 */
  _clearUltWorld() { this.walls.clear(); this.zonesU.clear(); this.projectiles.clear(); this.minions.clear(); }

  _log(text) { this.log.unshift({ t: Date.now(), text }); this.log.length = Math.min(this.log.length, 40); }

  /** 진행자: 점수 수정(+/-) */
  adjust(id, delta) {
    const p = this.players.get(id), n = Number(delta);
    if (!p || !Number.isFinite(n)) return false;
    p.score = Math.round((p.score + n) * 10) / 10; const lab = `${p.name} ${n > 0 ? '+' : ''}${n}`; this._log(lab);
    this._pushUndo(lab, [[p.id, n]], this._hist('adj', '수동', [{ id: p.id, name: p.name, team: p.team || 0, gain: n }])); return true;
  }

  /** 진행자: 팀 전원에게 점수 (되돌리기 한 번에 전부 취소) */
  adjustTeam(team, delta) {
    const n = Number(delta), t = Number(team), ms = this.contestants().filter((p) => p.team === t && this._present(p));
    if (!Number.isFinite(n) || !n || !ms.length) return false;
    for (const p of ms) p.score = Math.round((p.score + n) * 10) / 10;
    const lab = `${t}팀 전원 ${n > 0 ? '+' : ''}${n}`; this._log(lab);
    this._pushUndo(lab, ms.map((p) => [p.id, n]), this._hist('adj', lab, ms.map((p) => ({ id: p.id, name: p.name, team: t, gain: n })))); return true;
  }

  // ---------- 진행자 도구 ----------
  /** 점수 기록(게임마다 누가 몇 점): kind q=퀴즈 real=현실 adj=수동 reset=초기화. rows = [{id,name,team,gain}] */
  _hist(kind, title, rows = []) { const h = { n: ++this.histSeq, t: Date.now(), kind, title, rows, undone: false }; this.history.push(h); if (this.history.length > 200) this.history.shift(); return h; }
  _pushUndo(label, deltas, hist) { if (deltas.length) { this.scoreLog.push({ label, deltas, hist }); if (this.scoreLog.length > 30) this.scoreLog.shift(); } }
  /** 가장 최근 점수 변경(수정·정답 공개·현실 퀴즈 공개)을 되돌린다. 떨어뜨린 동전은 되돌리지 않음 */
  undoScore() {
    const e = this.scoreLog.pop(); if (!e) return false;
    for (const [id, d] of e.deltas) { const p = this.players.get(id); if (p) p.score = Math.round((p.score - d) * 10) / 10; }
    if (e.hist) e.hist.undone = true;
    this._log(`되돌림: ${e.label}`); return true;
  }
  pauseTimer(on) { this.timerPaused = !!on; this._log(on ? '타이머 일시정지' : '타이머 재개'); return true; }
  addTime(sec) { if (this.phase !== PHASE.READING && this.phase !== PHASE.MOVING) return false; this.phaseEnd = Math.max(this.t + 1, this.phaseEnd + (Number(sec) || 0)); return true; }
  setCast(m, id) { const p = id && this.players.get(String(id)); this.cast = p ? { m: 'id', id: p.id } : { m: m === 'off' ? 'off' : 'auto', id: null }; this._log(p ? `중계: ${p.name}` : m === 'off' ? '중계 끔 (전체 맵)' : '중계: 자동 (1등)'); return true; }
  setQr(on) { this.showQr = !!on; return true; }
  setNoAtk(on) { this.noAtk = !!on; this._log(on ? '공격 금지' : '공격 허용'); return true; }
  setNoUlt(on) { this.noUlt = !!on; this._log(on ? '궁극기 금지' : '궁극기 허용'); return true; }
  setGod(on) { this.god = !!on; this._log(on ? '전원 무적' : '무적 해제'); return true; }
  setHideAns(on) { this.hideAns = !!on; return true; } // 정답 공개 후에도 화면에서 정답을 가림
  setFrozen(on) { this.frozen = !!on; this._log(on ? '비상 정지' : '정지 해제'); return true; }
  setMultiplier(n) { this.multiplier = Number(n) === 2 ? 2 : 1; this._log(this.multiplier === 2 ? '점수 2배 라운드' : '점수 2배 해제'); return true; }
  announce(text, sec = 8) { const t = String(text || '').slice(0, 80).trim(); this.notice = t ? { text: t, until: this.t + Math.min(30, Math.max(2, Number(sec) || 8)) } : null; if (t) this._log(`공지: ${t}`); return true; }
  setScreen(mode) { if (!['title', 'quiz', 'map', 'rank'].includes(mode)) return false; this.screenMode = mode; this.showRank = mode === 'rank'; return true; }
  rename(id, name) { const p = this.players.get(id), n = String(name || '').trim().slice(0, 10); if (!p || !n) return false; p.name = n; return true; }
  kick(id) { const p = this.players.get(id); if (!p) return false; this.realPending.delete(id); if (!p.isBot) this.kicked.add(id); /* 내보낸 토큰으로는 다시 못 들어옴 (닉네임부터 새로) */ this.players.delete(id); this._log(`${p.name} 퇴장`); return true; }
  /** 출제를 취소하고 대기실로 (점수 변화 없음) */
  cancelQuestion() { this._unpark(); this.preview = null; this._endBrawlWorld(); this._clearUltWorld(); this.brawl = null; this.cal = null; this.tour = null; this.coinRun = null; for (const p of this.players.values()) { if (p.ghost && p.hp <= 0) p.hp = p.cfg.hp; p.out = false; p.ghost = false; p.stunned = false; p.stunUntil = 0; } this.phase = PHASE.LOBBY; this.question = null; this.reveal = null; this.locked = null; this.realPending = new Map(); this.timerPaused = false; this._log('출제 취소'); return true; }
  /** 동전 비: n개를 sec초에 걸쳐 맵 곳곳에 떨어뜨림 (기본 동전 한도와 별개) */
  coinRain(n = 24, sec = 4) {
    for (let i = 0; i < n; i++) this.tasks.push({ at: this.t + (i / n) * sec, fn: () => { this.coinsSpawned = Math.max(0, this.coinsSpawned - 1); this.spawnCoin(); } });
    this._log('동전 비'); return true;
  }

  /** 팀 구성: n팀으로 접속자를 무작위로 균형 있게 나눔 (n=0이면 해제) */
  autoTeams() { // 항상 2팀으로 무작위로 다시 섞음
    this.teamCount = 2;
    const hs = this.contestants().filter((p) => p.connected).sort(() => Math.random() - 0.5);
    hs.forEach((p, i) => { p.team = this.teamCount ? (i % this.teamCount) + 1 : 0; });
    this._log('2팀으로 섞음'); return true;
  }

  setTeam(id, t) {
    const p = this.players.get(id); if (!p) return false; if (p.team !== (Number(t) === 2 ? 2 : 1)) p.rep = 0;
    p.team = Number(t) === 2 ? 2 : 1; return true; // 1팀 또는 2팀
  }

  setQuestionMode(qid, mode) {
    const q = this.questions.find((x) => x.id === qid); if (!q || q.type === 'real' || q.type === 'brawl' || q.type === 'calendar' || q.type === 'coin') return false;
    q.mode = mode === '팀' ? '팀' : '개인'; return true;
  }

  /** 현실 퀴즈: 점수를 입력(누적) → 확인 → 공개 */
  realSet(id, pts) { const n = Number(pts); if (this.phase !== PHASE.REAL || !this.players.has(id) || !Number.isFinite(n)) return false; this.realConfirmed = false; if (n) this.realPending.set(id, n); else this.realPending.delete(id); return true; }
  realTeam(team, pts) { for (const p of this.contestants()) if (p.team === Number(team)) this.realSet(p.id, pts); return true; }
  realConfirm() { if (this.phase !== PHASE.REAL) return false; this.realConfirmed = true; return true; }
  realReveal() {
    if (this.phase !== PHASE.REAL || !this.realConfirmed) return false;
    const results = [...this.realPending].filter(([id]) => this.players.has(id)).map(([id, gain]) => { const p = this.players.get(id), g = gain * this.multiplier; p.score = Math.round((p.score + g) * 10) / 10; return { id, name: p.name, team: p.team || 0, gain: g, correct: g > 0 }; }).sort((a, b) => b.gain - a.gain);
    this._pushUndo('현실 퀴즈 점수', results.map((r) => [r.id, r.gain]), this._hist('real', `Q${this.question?.id ?? ''} ${this.question?.text ?? '현실 퀴즈'}`, results.map((r) => ({ id: r.id, name: r.name, team: r.team, gain: r.gain }))));
    this._log(`현실 퀴즈 공개 (${results.length}명)`);
    this.reveal = { answer: null, real: true, results }; this.phase = PHASE.REVEAL; return true;
  }

  /** 진행자: 모두의 획득 동전만 0으로 (문제 점수는 그대로, 동전 점수만 빠짐) */
  resetCoins() {
    const rows = this.contestants().filter((p) => p.coins).map((p) => ({ id: p.id, name: p.name, team: p.team || 0, gain: -Math.round(p.coins * COIN.value * 10) / 10 }));
    for (const p of this.players.values()) p.coins = 0;
    if (this.coinRun) for (const id of Object.keys(this.coinRun.start)) this.coinRun.start[id] = 0;
    this._hist('adj', '동전 초기화', rows); this._log('동전 초기화'); return true;
  }

  resetScores() {
    this.asked.clear();
    this.cancelQuestion(); this.scoreLog = []; this.rounds = []; // 진행 중인 대난투·달력 정리, 초기화 이전 점수는 되돌리지 않음
    this._hist('reset', '점수 초기화'); for (const p of this.players.values()) { p.score = 0; p.coins = 0; }
    this.coins.clear(); this.minions.clear();
    this.items.clear();
    this.coinsSpawned = 0;
    this.showRank = false;
    this.phase = PHASE.LOBBY;
    this.question = null;
    this.reveal = null;
  }

  gather() {
    const ps = [...this.players.values()].filter((p) => !p.home && !p.parked), big = this.map === BRAWL_MAP;
    const half = Math.ceil(ps.length / 2);
    ps.forEach((p, i) => { // 대난투 맵이면 양쪽 끝(강·장애물 없는 곳)에 나눠 섬
      if (big) { const s = brawlSpawn(i < half ? 0 : 1, i < half ? i : i - half, i < half ? half : ps.length - half); p.x = s.x; p.y = s.y; } else [p.x, p.y] = spawnPos();
      p.kx = p.ky = 0;
    });
  }

  /** 진행자 '맵으로 이동': 대기실 그대로(문제 없음)에 맵만 그 문제의 맵으로 */
  previewMap(qid) {
    const q = this.questions.find((x) => x.id === qid); if (!q) return false;
    this.cancelQuestion();
    this.preview = q;
    if (q.type === 'brawl') { this.map = BRAWL_MAP; this.solids = true; for (const p of this.players.values()) if (p.isBot && p.connected && p.home) this._park(p); }
    this.gather();
    this._log(`Q${q.id} 맵으로 이동`); return true;
  }

  /** 대기실 왼쪽 아군 봇: 가만히 서 있고 체력이 반쯤 깎여 있어서 힐·버프·방어 스킬을 시험해 볼 수 있다 (사람과 같은 편) */
  addAllies(only) {
    const ids = only || ['blue']; // 아군 봇은 기본 남성(파란티)
    for (const [x, y] of [[3, 5], [4, 9], [3, 13], [4, 17]]) {
      const p = this.addBot('idle', ids[Math.floor(Math.random() * ids.length)]);
      p.name = '아군'; p.x = x; p.y = y; p.home = { x, y }; p.ally = true; p.team = 0; p.hp = Math.ceil(p.cfg.hp * 0.5);
    }
  }

  /** 대기실 우측 샌드백: 가만히 서 있는 봇(idle)과, 가까이 오면 때리고 구역을 벗어나면 제자리로 돌아가는 봇(guard) */
  clearSandbags() { for (const [id, p] of this.players) if (p.home && !p.ally) this.players.delete(id); }

  addSandbags(only) {
    this.clearSandbags(); // 다시 누르면 원래 자리로 새로 배치 (겹쳐서 늘어나지 않음)
    const ids = only || ['knight']; // 샌드백(적군 봇)은 기사
    const spots = [['idle', 35, 4], ['idle', 36, 8], ['idle', 35, 12], ['idle', 36, 16], ['idle', 35, 19], ['guard', 31, 6], ['guard', 32, 11], ['guard', 31, 16], ['guard', 37, 11]];
    for (const [mode, x, y] of spots) {
      const p = this.addBot(mode, ids[Math.floor(Math.random() * ids.length)]);
      p.name = '샌드백'; p.x = x; p.y = y; p.home = { x, y }; p.team = 0;
    }
  }

  _refill(p) {
    if (p.baseCfg) p.cfg = p.baseCfg; // 거대화 같은 궁극기 버프 중이었으면 원래 몸으로
    p.hp = p.cfg.hp;
    p.runGauge = p.cfg.runGauge;
    p.exhausted = false;
    p.skillReadyAt = 0; p.ult = 0; p.egg = false; p.flurry = null; p.buff = null; p.rootUntil = 0; p.baseCfg = null; p.channel = null; p.charmUntil = 0; p.orbit = null;
    p.ammoF = p.cfg.ammo?.max ?? 99;
  }

  _startMoving() {
    this.phase = PHASE.MOVING;
    this.phaseEnd = this.t + this.question.time;
    // 문제가 시작될 때 이미 구역 안에 있던 사람도 이 시각부터 센다
    for (const p of this.players.values()) {
      p.zone = zoneAt(this.question.type, p.x, p.y);
      p.zoneSince = this.t;
    }
  }

  // ---------- 대난투: 팀(없으면 개인)별로 마지막까지 살아남은 쪽이 점수 ----------
  _bKey(p) { return p.team ? `t${p.team}` : p.id; }
  _brawlAlive() { return [...this.brawl.ids].map((id) => this.players.get(id)).filter((p) => p && p.connected && !p.out && !p.ghost); }
  _unpark() { for (const p of this.players.values()) if (p.parked) { p.parked = false; p.connected = p.parkConn ?? true; p.parkConn = undefined; } }
  /** 잠시 맵에서 치움(관전): 점수·순위에는 그대로 남는다 */
  _park(p) { if (p.parked) return; p.parked = true; p.parkConn = p.connected; p.connected = false; p.input = { mx: 0, my: 0, run: false }; }
  /** 접속 중인 참가자인가 (관전으로 잠시 치워진 사람 포함) */
  _present(p) { return p.connected || !!(p.parked && p.parkConn); }

  /** 대난투 시작: 정확히 두 팀이 아니면 무작위 2팀으로 나눔 → 두 팀이 맵 양쪽 끝으로. 시작 뒤 10초는 공격·궁극기·달리기 불가 */
  _brawlSetup() {
    const hs = this.contestants().filter((p) => p.connected);
    if (new Set(hs.map((p) => p.team || 0)).size !== 2 || hs.some((p) => !p.team)) this.autoTeams(2);
    const ts = [...new Set(hs.map((p) => p.team))].sort((a, b) => a - b);
    this.map = BRAWL_MAP; this.solids = true;
    ts.slice(0, 2).forEach((t, side) => {
      const ms = hs.filter((p) => p.team === t);
      ms.forEach((p, i) => { const s = brawlSpawn(side, i, ms.length); p.x = s.x; p.y = s.y; p.face = side === 0 ? 1 : -1; p.kx = p.ky = 0; p.ghost = false; p.reviveT = 0; p.invUntil = this.t + READ_SEC; });
    });
    for (const p of this.players.values()) if (p.isBot && p.connected && p.home) { p.parked = true; p.connected = false; } // 샌드백·아군 봇만 치움 (테스트 봇은 참가)
    this.brawl = { ids: new Set(hs.map((p) => p.id)), pts: this.question.pts || 5, groups0: 2 };
  }

  /** 시작 뒤 10초(와 읽는 시간) 동안은 공격·궁극기·달리기·대쉬 불가 */
  _bLocked() { return this._prep() > 0; }
  /** 준비 시간이 몇 초 남았나 (문제 진행 중일 때만) */
  _prep() { return (this.phase === PHASE.READING || this.phase === PHASE.MOVING) && this.question ? Math.max(0, (this.prepUntil || 0) - this.t) : 0; }
  /** 달리기까지 막히는가 (전투 모드 준비 시간) */
  _runLocked() { return this._prep() > 0 && isCombat(this.question); }

  /** 유령이 된 팀원과 5초 동안 겹쳐 있으면 체력 50%로 부활 (궁극기 0%, 무적 1초) */
  _brawlRevive(dt) {
    const ps = [...this.brawl.ids].map((id) => this.players.get(id)).filter((p) => p && p.connected);
    for (const gh of ps) {
      if (!gh.ghost) { gh.reviveT = 0; continue; }
      const near = ps.some((a) => !a.ghost && a.team === gh.team && Math.hypot(a.x - gh.x, a.y - gh.y) <= a.cfg.radius + gh.cfg.radius + 0.4);
      gh.reviveT = near ? (gh.reviveT || 0) + dt : 0;
      if (gh.reviveT >= BRAWL_REVIVE_SEC) {
        gh.ghost = false; gh.reviveT = 0; gh.hurtAt = this.t; gh.hp = Math.ceil(gh.cfg.hp * 0.5); gh.ult = 0; gh.invUntil = this.t + 1; gh.stunned = false;
        this.events.push({ e: 'revive', id: gh.id, x: r2(gh.x), y: r2(gh.y) });
      }
    }
  }

  /** 대난투가 끝나거나 취소되면 기본 맵으로 돌려놓고 모두를 모음 */
  _endBrawlWorld() { if (!this.solids && this.map === MAP) return; this.map = MAP; this.solids = false; this.gather(); }

  _finishBrawl() {
    if (this.tour) return this._tourMatchEnd();
    const b = this.brawl, q = this.question, alive = this._brawlAlive(), hp = new Map();
    for (const p of alive) hp.set(this._bKey(p), (hp.get(this._bKey(p)) || 0) + p.hp); // 시간이 끝났을 때 여럿이 남았으면 남은 체력 합이 큰 쪽
    const top = Math.max(0, ...hp.values()), win = new Set([...hp].filter(([, v]) => v === top).map(([k]) => k));
    const members = [...b.ids].map((id) => this.players.get(id)).filter(Boolean), undo = [];
    const results = members.map((p) => {
      const ok = p.connected && win.has(this._bKey(p)), gain = ok ? b.pts * this.multiplier : 0;
      if (gain) { p.score = Math.round((p.score + gain) * 10) / 10; undo.push([p.id, gain]); }
      return { id: p.id, name: p.name, team: p.team || 0, correct: ok, gain, out: !!p.ghost, sp: p.cfg.sprite };
    });
    const winners = [...win].map((k) => ({ team: k.startsWith('t') ? Number(k.slice(1)) : 0, names: results.filter((r) => r.correct && (r.team ? `t${r.team}` : r.id) === k).map((r) => r.name) }));
    const tp = {}; for (const r of results) if (r.team) tp[r.team] = Math.max(tp[r.team] || 0, r.gain); // 라운드 기록: 팀별 이번 라운드 점수(1인당)
    this._round('brawl', `Q${q.id} ${q.text}`, tp);
    this.reveal = { answer: null, brawl: true, results, winners, rounds: this.rounds.slice(-12) };
    this._pushUndo(`Q${q.id} 대난투`, undo, this._hist('brawl', `Q${q.id} ${q.text}`, results.map((r) => ({ id: r.id, name: r.name, team: r.team, gain: r.gain }))));
    this._log(`대난투 종료 · ${winners.map((w) => w.team ? `${w.team}팀` : w.names.join()).join(', ') || '승자 없음'}`);
    for (const p of members) { p.out = false; p.ghost = false; p.reviveT = 0; p.stunned = false; p.stunUntil = 0; p.hp = p.cfg.hp; p.invUntil = this.t + 3; } // 끝나면 모두 일어남
    this._endBrawlWorld(); this._unpark(); this.phase = PHASE.REVEAL;
  }

  /** 라운드 기록 추가 (팀별 점수) */
  _round(kind, title, teams) { this.rounds.push({ n: this.rounds.length + 1, kind, title, teams }); if (this.rounds.length > 50) this.rounds.shift(); }

  // ---------- 팀 토너먼트: 팀마다 2명이 나와 2:2로 대진표대로 싸우고, 마지막까지 이긴 팀이 우승 ----------
  _tourSetup() {
    const hs = this.contestants().filter((p) => p.connected);
    if (new Set(hs.map((p) => p.team || 0)).size < 2 || hs.some((p) => !p.team)) this.autoTeams();
    const teams = [...new Set(hs.map((p) => p.team))].filter(Boolean).sort(() => Math.random() - 0.5);
    const reps = {}; for (const t of teams) { const ms = hs.filter((p) => p.team === t).sort(() => Math.random() - 0.5); reps[t] = [...ms.filter((p) => p.rep), ...ms.filter((p) => !p.rep)].slice(0, 2).map((p) => p.id); } // 팀마다 2명: 진행자가 ★로 고른 사람 먼저, 모자라면 무작위
    this.tour = { reps, alive: teams, round: 0, queue: [], byes: [], won: [], cur: null, log: [], place: {} };
    for (const p of this.players.values()) if (p.isBot && p.connected && p.home) this._park(p);
    this._tourNextRound();
    this._tourStartMatch(false);
  }

  /** 다음 라운드 대진: 살아남은 팀을 둘씩 짝짓고, 홀수면 한 팀은 부전승 */
  _tourNextRound() {
    const t = this.tour, a = [...t.alive]; t.round++; t.queue = []; t.byes = []; t.won = [];
    while (a.length >= 2) t.queue.push([a.shift(), a.shift()]);
    if (a.length) t.byes.push(a[0]);
  }

  /** 대진 하나 시작: 두 팀의 대표만 대난투 맵 양쪽 끝에, 나머지는 관전 */
  _tourStartMatch(read = true) {
    const t = this.tour, m = t.queue.shift(); t.cur = m;
    this._unpark(); this._clearUltWorld();
    const ids = new Set([...(t.reps[m[0]] || []), ...(t.reps[m[1]] || [])].filter((id) => this.players.get(id)?.connected));
    this.map = BRAWL_MAP; this.solids = true;
    m.forEach((team, side) => {
      const ms = [...ids].map((id) => this.players.get(id)).filter((p) => p.team === team);
      ms.forEach((p, i) => { const s = brawlSpawn(side, i, ms.length); p.x = s.x; p.y = s.y; p.face = side === 0 ? 1 : -1; p.kx = p.ky = 0; p.ghost = false; p.reviveT = 0; p.stunned = false; p.stunUntil = 0; this._refill(p); p.invUntil = this.t + READ_SEC; });
    });
    for (const p of this.players.values()) if (!ids.has(p.id) && (p.connected || p.parked)) this._park(p);
    this.brawl = { ids, pts: this.question.pts || 5, groups0: 2 };
    if (read) { this.phase = PHASE.READING; this.phaseEnd = this.t + READ_SEC; this.prepUntil = this.t + PREP_SEC; }
    this._log(`토너먼트 ${t.round}라운드 · ${m[0]}팀 vs ${m[1]}팀`);
  }

  _tourMatchEnd() {
    const t = this.tour, [a, b] = t.cur, hp = { [a]: 0, [b]: 0 }, alive = { [a]: 0, [b]: 0 };
    for (const p of this._brawlAlive()) { hp[p.team] += p.hp; alive[p.team]++; }
    const win = alive[a] !== alive[b] ? (alive[a] > alive[b] ? a : b) : hp[a] !== hp[b] ? (hp[a] > hp[b] ? a : b) : (Math.random() < 0.5 ? a : b); // 남은 인원 → 남은 체력 → 무작위
    const lose = win === a ? b : a;
    t.log.push({ r: t.round, a, b, w: win }); t.won.push(win); t.place[lose] = t.round;
    this.events.push({ e: 'tourWin', t: win });
    this._log(`토너먼트 ${t.round}라운드 · ${win}팀 승`);
    for (const id of this.brawl.ids) { const p = this.players.get(id); if (p) { p.ghost = false; p.reviveT = 0; p.stunned = false; p.hp = p.cfg.hp; } }
    if (!t.queue.length) { t.alive = [...t.won, ...t.byes].sort(() => Math.random() - 0.5); if (t.alive.length > 1) this._tourNextRound(); }
    if (t.queue.length) return this._tourStartMatch(true);
    this._tourFinish(t.alive[0]);
  }

  /** 우승팀 전원 점수, 준우승팀 전원 절반 */
  _tourFinish(champ) {
    const t = this.tour, q = this.question, last = t.log[t.log.length - 1], second = last ? (last.w === last.a ? last.b : last.a) : null, undo = [], tp = {};
    const pts = (this.question.pts || 5) * this.multiplier;
    const results = this.contestants().filter((p) => this._present(p) && p.team).map((p) => {
      const gain = p.team === champ ? pts : p.team === second ? Math.round(pts * 5) / 10 : 0;
      if (gain) { p.score = Math.round((p.score + gain) * 10) / 10; undo.push([p.id, gain]); }
      tp[p.team] = gain;
      return { id: p.id, name: p.name, team: p.team, correct: p.team === champ, gain, out: false, sp: p.cfg.sprite, rep: Object.values(t.reps).some((r) => r.includes(p.id)) };
    });
    this._round('tour', `Q${q.id} ${q.text}`, tp);
    const winners = champ ? [{ team: champ, names: (t.reps[champ] || []).map((id) => this.players.get(id)?.name).filter(Boolean) }] : [];
    this.reveal = { answer: null, brawl: true, tour: true, results, winners, second, bracket: t.log, rounds: this.rounds.slice(-12) };
    this._pushUndo(`Q${q.id} 토너먼트`, undo, this._hist('brawl', `Q${q.id} ${q.text}`, results.map((r) => ({ id: r.id, name: r.name, team: r.team, gain: r.gain }))));
    this._log(`토너먼트 우승 · ${champ}팀`);
    this.tour = null; this.brawl = null;
    this._endBrawlWorld(); this._unpark(); this.phase = PHASE.REVEAL;
  }

  // ---------- 동전 모으기: 제한시간 동안 동전이 쏟아지고, 가장 많이 주운 순서대로 점수 ----------
  _coinSetup() {
    const hs = this.contestants().filter((p) => p.connected);
    for (const p of this.players.values()) if (p.isBot && p.connected && p.home) this._park(p);
    this.coinRun = { start: Object.fromEntries(hs.map((p) => [p.id, p.coins])), clock: 0 };
  }
  _coinGot(p) { return Math.max(0, p.coins - (this.coinRun.start[p.id] ?? p.coins)); }
  _coinTick(dt) {
    const c = this.coinRun, n = this.contestants().filter((p) => p.connected).length, every = Math.max(0.15, 1.2 / Math.max(1, n)); // 사람이 많을수록 자주
    c.clock += dt;
    while (c.clock >= every) { c.clock -= every; if (this.coins.size < 40 + n * 2) { this.coinsSpawned = Math.max(0, this.coinsSpawned - 1); this.spawnCoin(); } }
  }
  _coinFinish() {
    const q = this.question, pts = (q.pts || 5) * this.multiplier, prize = [pts, Math.round(pts * 6) / 10, Math.round(pts * 2) / 10], undo = [];
    const ps = Object.keys(this.coinRun.start).map((id) => this.players.get(id)).filter((p) => p && this._present(p));
    const ranked = ps.map((p) => ({ p, got: this._coinGot(p) })).sort((a, b) => b.got - a.got);
    let rank = 0, prev = -1;
    const results = ranked.map((r, i) => {
      if (r.got !== prev) { rank = i + 1; prev = r.got; } // 같은 개수면 같은 등수
      const gain = r.got > 0 && rank <= 3 ? prize[rank - 1] : 0;
      if (gain) { r.p.score = Math.round((r.p.score + gain) * 10) / 10; undo.push([r.p.id, gain]); }
      return { id: r.p.id, name: r.p.name, team: r.p.team || 0, got: r.got, rank, correct: gain > 0, gain };
    });
    const teams = {}; for (const r of results) if (r.team) teams[r.team] = (teams[r.team] || 0) + r.got;
    this.reveal = { answer: null, coin: true, results, teams };
    this._pushUndo(`Q${q.id} 동전`, undo, this._hist('coin', `Q${q.id} ${q.text}`, results.map((r) => ({ id: r.id, name: r.name, team: r.team, gain: r.gain }))));
    this._log(`동전 모으기 종료 · 1등 ${results[0]?.name ?? '-'} ${results[0]?.got ?? 0}개`);
    this.coinRun = null; this.coins.clear(); this._unpark(); this.phase = PHASE.REVEAL;
  }

  // ---------- 달력 퀴즈: 탈락 날짜에 서 있으면 채점 때 유령, 끝까지 남은 사람들이 탈락자 수 ×2를 나눠 가짐 ----------
  _calAlive() { return [...this.cal.ids].map((id) => this.players.get(id)).filter((p) => p && p.connected && !p.ghost); }

  _calSetup() {
    const q = this.question, l = calLayout(q), bad = new Set((q.bad || []).filter((d) => d >= 1 && d <= l.days)), hs = this.contestants().filter((p) => p.connected);
    for (const p of hs) p.ghost = false;
    for (const p of this.players.values()) if (p.isBot && p.connected && p.home) { p.parked = true; p.connected = false; }
    this.cal = { ids: new Set(hs.map((p) => p.id)), l, bad, safe: l.days - bad.size, found: new Set(), rv: {}, round: 0 };
  }

  /** 채점: 지금 서 있는 칸이 탈락 날짜이거나 칸 밖이거나 이미 열린 칸이면 유령. 서 있던 칸의 정체(생존/탈락)가 모두에게 드러남 */
  _calGrade() {
    const c = this.cal, now = {}, seen = new Set(Object.keys(c.rv).map(Number)); c.round++; // seen: 앞선 채점에서 이미 열린 칸
    for (const p of this._calAlive()) {
      const d = calCell(c.l, p.x, p.y);
      if (d != null) now[d] = c.bad.has(d) ? 2 : 1;
      // 칸 밖 · 탈락 날짜 · 이미 열린 칸(안전했어도 다시 밟으면) 모두 유령
      if (d == null || c.bad.has(d) || seen.has(d)) this._quizBoom(p); else c.found.add(d); // 탈락: 제자리 폭발 → 다음 문제까지 유령
    }
    Object.assign(c.rv, now);
    const left = this._calAlive().length;
    this._log(`달력 ${c.round}차 채점 · 생존 ${left}명`);
    if (left <= 1 || c.found.size >= c.safe) this._calFinish();
  }

  _calFinish() {
    const c = this.cal, q = this.question, ids = [...c.ids].map((id) => this.players.get(id)).filter(Boolean), undo = [];
    const surv = ids.filter((p) => p.connected && !p.ghost), elim = ids.filter((p) => p.ghost).length, pool = elim * 2 * this.multiplier, each = surv.length ? Math.round((pool / surv.length) * 10) / 10 : 0;
    const results = ids.map((p) => {
      const ok = p.connected && !p.ghost, gain = ok ? each : 0;
      if (gain) { p.score = Math.round((p.score + gain) * 10) / 10; undo.push([p.id, gain]); }
      return { id: p.id, name: p.name, team: p.team || 0, correct: ok, gain, ghost: !ok };
    });
    this.reveal = { answer: null, cal: true, results, pool, elim, survivors: surv.length, each, l: c.l, bad: [...c.bad] };
    this._pushUndo(`Q${q.id} 달력`, undo, this._hist('cal', `Q${q.id} ${q.text}`, results.map((r) => ({ id: r.id, name: r.name, team: r.team, gain: r.gain }))));
    this._log(`달력 종료 · 생존 ${surv.length}명 · 탈락 ${elim}명 · 각 +${fmtScore(each)}`);
    this._unpark(); this.cal = null; this.phase = PHASE.REVEAL;
  }

  /** 진행자: 지금 상태 그대로 정산하고 끝냄 */
  calFinish() { if (!this.cal || this.phase !== PHASE.MOVING) return false; this._calFinish(); return true; }

  /** 이 순간의 위치로 판정만 굳힌다(점수·동전은 아직 건드리지 않음) */
  _lock() {
    const q = this.question;
    const ranked = [];
    for (const p of this.players.values()) {
      if (p.home || !p.connected) continue; // 샌드백·아군 봇만 빼고 봇도 점수를 받음
      const zone = zoneAt(q.type, p.x, p.y);
      ranked.push({ p, zone, correct: zone === q.answer, since: zone === p.zone ? p.zoneSince : this.t });
    }
    const winners = ranked.filter((r) => r.correct).sort((a, b) => a.since - b.since);
    winners.forEach((r, i) => { r.rank = i + 1; });
    const dist = {}; for (const r of ranked) dist[r.zone ?? '-'] = (dist[r.zone ?? '-'] || 0) + 1;
    this.locked = { ranked, dist };
  }

  _applyLocked() {
    if (this.question?.vote) return this._finishVote(); // 투표: 점수·폭발 없이 결과만
    const q = this.question, { ranked, dist } = this.locked, undo = [];
    const results = ranked.map((r) => {
      const bonus = r.correct && r.rank <= BONUS.length ? BONUS[r.rank - 1] : 0;
      const gain = r.correct ? (BASE_POINT + bonus) * this.multiplier : 0;
      r.p.score += gain; if (gain) undo.push([r.p.id, gain]);
      const dropped = !r.correct && (r.zone != null || COIN.dropOnNoAnswer || (r.p.isBot && r.p.botMode !== 'idle')) ? this._dropCoins(r.p) : 0;
      if (!r.correct) this._quizBoom(r.p); // 틀리면(무응답 포함) 그 자리에서 폭발 → 다음 문제까지 유령
      return { id: r.p.id, name: r.p.name, team: r.p.team || 0, zone: r.zone, correct: r.correct, rank: r.correct ? r.rank : null, gain, dropped };
    });
    this.reveal = { answer: q.answer, results, dist };
    this.locked = null; this._pushUndo(`문제 ${q.id} 점수`, undo, this._hist('q', `Q${q.id} ${q.text}`, results.map((r) => ({ id: r.id, name: r.name, team: r.team, gain: r.gain, correct: r.correct }))));
    this._log(`문제 ${q.id} 정답 공개`);
    this.phase = PHASE.REVEAL;
  }

  /** 퀴즈 오답: 제자리 폭발 + 즉사, 다음 문제가 시작될 때까지 유령 */
  _quizBoom(p) {
    this.events.push({ e: 'boom', x: r2(p.x), y: r2(p.y), r: 1.3 });
    p.ghost = true; p.dash = null; p.channel = null; p.flurry = null; p.stunned = false; p.hp = 0;
    this.events.push({ e: 'ghost', id: p.id, x: r2(p.x), y: r2(p.y), q: 1 });
  }

  // ---------- 공격 ----------
  attack(id, aim) {
    const p = this.players.get(id);
    if (p && !p.parked) this._tryAttack(p, aim);
  }

  _stealthed(o) { return !!(o.bushHide || (o.buff && this.t < o.buff.until && o.buff.stealth)); }

  /** 대난투 부쉬: 안에 있으면 적 팀에게 숨겨짐. 공격하거나 맞은 뒤 1.5초, 적이 2.5칸 안에 있으면 드러남 */
  _updateBush() {
    for (const p of this.players.values()) {
      let hide = false;
      if (this.brawl && this.phase === PHASE.MOVING && !p.ghost && inBush(p.x, p.y) && this.t - Math.max(p.revealAt || 0, p.hurtAt || 0) > 1.5) hide = !this._enemies(p).some((o) => Math.hypot(o.x - p.x, o.y - p.y) < 2.5);
      p.bushHide = hide;
    }
  }

  _enemies(p) {
    return [...this.players.values()].filter((o) => o !== p && o.connected && !o.out && !o.ghost && !this._sameSide(p, o)); // 같은 팀·아군 봇은 적이 아님
  }

  // 지금 공격을 하면 몇 타째인지, 그 타의 배율과 사거리
  _comboState(p) {
    const a = p.cfg.attack;
    const combo = a.combo;
    const step = combo && this.t - p.lastAttackAt <= COMBO_RESET_SEC ? p.comboStep : 0;
    const m = combo?.[step] || {};
    return { combo, step, m, range: a.range * (m.range ?? 1), arc: m.arc ?? a.arcDeg ?? 60, multi: m.multi ?? a.multi, line: m.lineW ?? a.lineW };
  }

  // 조준 방향: 직접 조준 > 사거리 안에서 가장 가까운 상대(자동 조준) > 바라보는 방향
  _aimDir(p, aim, range) {
    const ax = Number(aim?.x) || 0, ay = Number(aim?.y) || 0;
    if (Math.hypot(ax, ay) > 0.2) {
      const l = Math.hypot(ax, ay);
      return { dx: ax / l, dy: ay / l, manual: true };
    }
    let best = null, bestD = Infinity;
    const cands = this._enemies(p);
    if (p.cfg.attack?.aimAllies) for (const o of this._allies(p)) if (o !== p && o.hp < o.cfg.hp) cands.push(o); // 간호사: 다친 아군도 자동 조준
    for (const o of cands) {
      if (this._stealthed(o)) continue; // 은신 중인 상대는 자동 조준 불가
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d <= Math.max(range, AUTO_AIM) && d < bestD) { best = o; bestD = d; }
    }
    if (best) return { dx: (best.x - p.x) / bestD, dy: (best.y - p.y) / bestD, manual: false, near: best };
    return { dx: p.face, dy: 0, manual: false };
  }

  // 그 방향으로 공격했을 때 맞는 대상
  // 그 방향으로 공격했을 때 맞는 대상들 (가까운 순). 근접은 부채꼴(arcDeg, 기본 ±60°), 원거리는 직선
  _pickTargets(p, range, dx, dy, arc = p.cfg.attack.arcDeg ?? 60, lineW) {
    const a = p.cfg.attack;
    const cosMin = Math.cos((arc * Math.PI) / 180);
    const hits = [];
    for (const o of this._enemies(p)) {
      const vx = o.x - p.x, vy = o.y - p.y;
      const along = vx * dx + vy * dy; // 조준 방향으로의 거리
      const wide = a.type === 'melee' && !lineW && arc > 90; // 90°보다 넓은 부채꼴(하마 발 구르기 ±180° = 360°)은 뒤쪽도 맞음
      if (along <= 0 && !wide) continue;
      if (a.type === 'melee' && lineW) { // 직선(주먹): 앞으로 range, 폭 lineW의 길쭉한 상자
        const perp = Math.abs(vx * dy - vy * dx);
        if (along <= range && perp <= lineW / 2 + o.cfg.radius) hits.push({ o, dist: along });
      } else if (a.type === 'melee') {
        const d = Math.hypot(vx, vy) || 1e-6;
        if (d <= range + (a.bodyHit ? o.cfg.radius : 0) && along / d >= cosMin - 1e-9) hits.push({ o, dist: d }); // bodyHit: 몸이 범위 그림에 닿기만 해도 맞음
      } else {
        const perp = Math.abs(vx * dy - vy * dx);
        if (along <= range && perp <= o.cfg.radius + (a.projectile?.radius ?? a.chain?.width ?? 0)) hits.push({ o, dist: along });
      }
    }
    return hits.sort((x, y) => x.dist - y.dist);
  }

  _pickTarget(p, range, dx, dy, arc, lineW) {
    const h = this._pickTargets(p, range, dx, dy, arc, lineW)[0];
    return { target: h ? h.o : null, tDist: h ? h.dist : Infinity };
  }

  /** 조준 표시용: 지금 조준하면 어디를 향하고 누가 맞는지 (공격은 하지 않음) */
  aimPreview(id, aim) {
    const p = this.players.get(id);
    if (!p) return null;
    const { range: r0, step, arc, line } = this._comboState(p), melee = p.cfg.attack.type === 'melee', range = r0 + (p.cfg.attack.lunge?.dist ?? 0); // 돌진 공격은 달려가는 거리까지 사거리로 표시
    const dir = this._aimDir(p, aim, range + (melee ? AIM_SLACK : 0));
    const pr = p.cfg.attack.projectile;
    let { target } = this._pickTarget(p, range + (melee && !dir.manual ? HIT_SLACK : 0), dir.dx, dir.dy, arc, line);
    let lob = null;
    if (pr?.lob) { // 던지기: 착탄 지점과 폭발 범위, 그 안의 가장 가까운 상대를 조준 대상으로 표시
      const L = this._lobLanding(p, dir, range, aim);
      lob = { x: r2(L.x), y: r2(L.y), r: pr.explodeRadius };
      target = this._enemies(p).filter((o) => Math.hypot(o.x - L.x, o.y - L.y) <= pr.explodeRadius + o.cfg.radius).sort((u, v) => Math.hypot(u.x - L.x, u.y - L.y) - Math.hypot(v.x - L.x, v.y - L.y))[0] || null;
    }
    return { lob, px: r2(p.x), py: r2(p.y), dx: dir.dx, dy: dir.dy, manual: dir.manual, range, step, kind: p.cfg.attack.type, arc, radius: p.cfg.radius, line, targetId: target ? target.id : null };
  }

  _tryAttack(p, aim) {
    if (this.frozen || this.noAtk || p.ghost || this.phase === PHASE.HOLD || this._bLocked()) return; // 진행자가 공격을 막음 · 유령은 공격 못 함 · 시간 종료 후엔 공격 없음
    const a = p.cfg.attack;
    if (this.t < p.nextAttackAt || this.t < (p.silenceUntil || 0) || p.stunned || this.t < p.rootUntil || this.t < p.charmUntil || p.channel || this._dashing(p) || p.ammoF < 1) return; // 탄창이 비면 못 쏨
    if (p.running && !a.canAttackWhileRunning) return;

    if (a.burst) p.comboStep = 0; // 연타형: 한 번 누르면 항상 1타부터 n타까지
    // 콤보: 잽 → 잽 → 큰 휘두르기. 일정 시간 공격하지 않으면 1타부터 다시
    const { combo, step, m, range, arc, multi, line } = this._comboState(p);
    const melee = a.type === 'melee', dir = this._aimDir(p, aim, range + (a.lunge?.dist ?? 0) + (melee ? AIM_SLACK : 0)); // 돌진 공격은 달려갈 거리만큼, 근접은 사거리보다 멀리서도 자동 조준
    const { dx, dy, near } = dir, hr = range + (melee && !dir.manual ? HIT_SLACK : 0); // 자동 조준한 근접 공격은 사거리가 조금 후함
    if (Math.abs(dx) > 0.15) p.face = dx > 0 ? 1 : -1;
    p.nextAttackAt = this.t + a.interval / (buffOf(this, p)?.atk ?? 1);
    if (a.atkSlow) { p.atkSlowUntil = this.t + a.atkSlow.sec; p.atkSlowMul = a.atkSlow.mul; } // 원거리(투척 제외): 쏜 직후 잠깐 느려짐
    p.ammoF -= 1;
    let emp = false; // 3번째 공격마다 다음 공격이 강화 (공주 매혹 · 개구리 혀 묶기)
    if (a.charm || a.tether) { emp = !!p.empNext; p.empNext = false; if (!emp) { p.empCount = (p.empCount || 0) + 1; if (p.empCount >= (a.charm || a.tether).stacks) { p.empCount = 0; p.empNext = true; } } }
    // 공격 모션이 재생되는 동안 (이동 속도 감소가 적용되는 시간)
    p.attackUntil = this.t + (a.burst ? a.burst.gap + 0.1 : (SPRITE.attackSteps[step]?.ms ?? ATTACK_ANIM_SEC * 1000) / 1000);
    p.lastAttackAt = this.t;
    p.comboStep = combo ? (step + 1) % combo.length : 0;

    if (a.lunge) { // 돌진 공격(돼지): 먼저 앞으로 dist칸 달려가고, 도착하면 그 자리에서 타격
      const L = a.lunge;
      p.dash = { dx, dy, speed: L.dist / L.sec, until: this.t + L.sec, pass: false, hitDmg: 0, hitKnock: 0 };
      p.attackUntil += L.sec;
      this.events.push({ e: 'dash', id: p.id, dx: r2(dx), dy: r2(dy), kind: 'charge', dist: L.dist });
      this.tasks.push({ at: this.t + L.sec, fn: () => { if (p.stunned || this.t < p.rootUntil || this.t < p.charmUntil || p.channel) return; this._strike(p, hr, dx, dy, m, step, arc, multi, line); } });
      return;
    }
    if (a.chain) { // 체인 라이트닝: 맞히면 가까운 다른 적에게 최대 bounces번 튕김
      this._chain(p, a, dx, dy, range);
      this.events.push({ e: 'atk', id: p.id, dx: r2(dx), dy: r2(dy), kind: 'proj', fx: 'chain', step, len: range, emp: emp ? 1 : 0 });
      return;
    }
    if (a.projectile) { // 투사체: 날아가서 닿아야 맞는다 (피할 수 있음)
      this._shoot(p, a, aim, dx, dy, range, near, emp);
      this.events.push({ e: 'atk', id: p.id, dx: r2(dx), dy: r2(dy), kind: 'proj', art: a.projectile.art, lob: !!a.projectile.lob, step, len: range, emp: emp ? 1 : 0 });
      return;
    }
    if (a.windup) { // 예고 후 타격: 범위를 보여 주는 동안 피할 수 있다
      p.windup = { at: this.t + a.windup, range: hr, dx, dy, m, step, arc, multi, line };
      p.attackUntil += a.windup;
      this.events.push({ e: 'windup', id: p.id, dx: r2(dx), dy: r2(dy), range: r2(hr), arc, sec: a.windup, fx: a.fx });
      return;
    }
    this._strike(p, hr, dx, dy, m, step, arc, multi, line, !!a.burst, emp);
    for (let i = 1; i < (a.burst?.n ?? 1); i++) { // 나머지 타격: 탄창은 더 안 쓰고 gap 간격으로 이어서
      this.tasks.push({ at: this.t + i * a.burst.gap, fn: () => {
        if (p.stunned || this.t < p.rootUntil || this.t < p.charmUntil || p.channel) return;
        const s = this._comboState(p), d = this._aimDir(p, aim, s.range + AIM_SLACK);
        if (Math.abs(d.dx) > 0.15) p.face = d.dx > 0 ? 1 : -1;
        p.attackUntil = this.t + a.burst.gap + 0.1; p.lastAttackAt = this.t; p.comboStep = (s.step + 1) % s.combo.length;
        this._strike(p, s.range + (d.manual ? 0 : HIT_SLACK), d.dx, d.dy, s.m, s.step, s.arc, s.multi, s.line, true);
      } });
    }
  }

  _strike(p, range, dx, dy, m, step, arc, multi, line, fast = false, emp = false) {
    const a = p.cfg.attack;
    const hits = this._pickTargets(p, range, dx, dy, arc, line);
    this.events.push({ e: 'atk', id: p.id, dx: r2(dx), dy: r2(dy), kind: a.type, fx: a.fx, arc, lineW: line, fast, step, range: r2(range), len: r2(hits[0] && !(multi && a.type === 'ranged') ? hits[0].dist : range), emp: emp ? 1 : 0 });
    for (const h of multi ? hits : hits.slice(0, 1)) { this._emp = emp; this._hit(h.o, p, dx, dy, m.dmg ?? 1, m.knockback ?? 1); } // multi: 범위 안 모두
  }

  // ---------- 투사체 ----------
  // 던지기 착탄 지점: 직접 조준이면 드래그 길이(aim.m, 0~1)만큼, 자동 조준이면 상대가 있는 곳(없으면 사거리의 70%)
  _lobLanding(p, dir, range, aim) {
    let dist;
    if (dir.manual) dist = Math.max(1.5, range * Math.min(1, Number(aim?.m) || 1));
    else dist = dir.near ? Math.min(range, Math.hypot(dir.near.x - p.x, dir.near.y - p.y)) : range * 0.7;
    return { x: Math.min(this.map.w - 0.3, Math.max(0.3, p.x + dir.dx * dist)), y: Math.min(this.map.h - 0.3, Math.max(0.3, p.y + dir.dy * dist)) };
  }

  _chain(p, a, dx, dy, range) {
    const c = a.chain, first = this._pickTarget(p, range, dx, dy).target, pts = [[r2(p.x), r2(p.y)]];
    if (!first) { this.events.push({ e: 'chain', id: p.id, pts: [...pts, [r2(p.x + dx * range), r2(p.y + dy * range)]] }); return; }
    const done = new Set([first.id]); let cur = first; this._hit(first, p, dx, dy, 1, 0); pts.push([r2(first.x), r2(first.y)]);
    for (let i = 0; i < c.bounces; i++) {
      let nx = null, bd = c.radius;
      for (const o of this._enemies(p)) { if (done.has(o.id) || o.stunned || this._stealthed(o)) continue; const d = Math.hypot(o.x - cur.x, o.y - cur.y); if (d < bd) { bd = d; nx = o; } }
      if (!nx) break;
      done.add(nx.id); this._hit(nx, p, (nx.x - cur.x) / (bd || 1), (nx.y - cur.y) / (bd || 1), c.mul, 0); pts.push([r2(nx.x), r2(nx.y)]); cur = nx;
    }
    this.events.push({ e: 'chain', id: p.id, pts });
  }

  _shoot(p, a, aim, dx, dy, range, near, emp = false) {
    const pr = a.projectile;
    const base = { id: ++this.projSeq, owner: p.id, art: pr.art, dmgMin: a.dmgMin, dmgMax: a.dmgMax, knock: a.knockback, emp };
    if (pr.lob) {
      const L = this._lobLanding(p, { dx, dy, manual: !!(Math.hypot(Number(aim?.x) || 0, Number(aim?.y) || 0) > 0.2), near }, range, aim);
      const dist = Math.hypot(L.x - p.x, L.y - p.y);
      this.projectiles.set(base.id, { ...base, kind: 'lob', sx: p.x, sy: p.y, tx: L.x, ty: L.y, x: p.x, y: p.y, t0: this.t, T: Math.max(0.15, dist / pr.speed), r: pr.explodeRadius, heal: pr.heal, fire: pr.fire });
    } else {
      this.projectiles.set(base.id, { ...base, kind: 'bolt', x: p.x, y: p.y, dx, dy, vx: dx * pr.speed, vy: dy * pr.speed, speed: pr.speed, travel: 0, maxDist: range, radius: pr.radius, pierce: !!pr.pierce || !!pr.boomerang, hit: new Set(), boom: pr.boomerang ? { ph: 'out', wait: pr.boomerang.wait, until: 0 } : null });
    }
  }

  /** 투사체가 맞았을 때: 강화된 평타 여부를 알려 주고 피해 처리 */
  _projHit(q, o, owner, dmg, knock, dx, dy, art) { this._emp = !!q.emp; this._applyHit(o, owner, dmg, knock, dx, dy, art); }

  _projDamage(q) {
    return q.dmgMin + Math.floor(Math.random() * (q.dmgMax - q.dmgMin + 1));
  }

  _updateProjectiles(dt) {
    for (const q of [...this.projectiles.values()]) {
      const ownerP = this.players.get(q.owner), foes = [...this.players.values()].filter((o) => o.connected && !o.ghost && o.id !== q.owner && !(ownerP && this._sameSide(ownerP, o)));
      if (q.kind === 'lob') {
        const u = (this.t - q.t0) / q.T;
        if (u < 1) { q.x = q.sx + (q.tx - q.sx) * u; q.y = q.sy + (q.ty - q.sy) * u; continue; }
        this.projectiles.delete(q.id); // 착탄: 범위 안 모두에게 피해, 중심에서 바깥으로 밀림 (던진 사람은 안 맞음)
        this.events.push({ e: 'boom', x: r2(q.tx), y: r2(q.ty), r: q.r, art: q.art });
        if (q.fire) { const id = ++this.zoneSeq, f = q.fire; this.zonesU.set(id, { id, owner: q.owner, x: q.tx, y: q.ty, r: f.r ?? q.r * 0.8, until: this.t + f.sec, next: this.t + f.tick, tick: f.tick, dmg: f.dmg, kind: 'fire', art: 'bottle' }); } // 투척병: 떨어진 곳에 잠깐 불길
        for (const o of foes) {
          const d = Math.hypot(o.x - q.tx, o.y - q.ty);
          if (d > q.r + o.cfg.radius) continue;
          const nx = d > 1e-6 ? (o.x - q.tx) / d : 1, ny = d > 1e-6 ? (o.y - q.ty) / d : 0;
          this._projHit(q, o, this.players.get(q.owner) || { id: q.owner }, this._projDamage(q), q.knock, nx, ny, q.art);
        }
        if (q.heal && ownerP) for (const o of this._allies(ownerP)) { // 간호사: 터지는 범위 안 아군은 회복
          if (Math.hypot(o.x - q.tx, o.y - q.ty) > q.r + o.cfg.radius) continue;
          const h = Math.min(o.cfg.hp - o.hp, q.heal); if (h > 0) { o.hp += h; this.events.push({ e: 'itemGet', id: 0, k: 'heart', by: o.id, amount: h, x: r2(o.x), y: r2(o.y) }); }
        }
        continue;
      }
      if (q.boom) { // 부메랑: 최대 거리까지 → wait초 멈춤 → 주인에게 돌아옴. 나갈 때 한 번, 돌아올 때 한 번 맞힘
        const ow = this.players.get(q.owner);
        if (q.boom.ph === 'hold') { if (this.t < q.boom.until) continue; q.boom.ph = 'back'; q.hit = new Set(); }
        if (q.boom.ph === 'back') {
          if (!ow || ow.stunned) { this.projectiles.delete(q.id); continue; }
          const d = Math.hypot(ow.x - q.x, ow.y - q.y); if (d < 0.6) { this.projectiles.delete(q.id); continue; }
          q.dx = (ow.x - q.x) / d; q.dy = (ow.y - q.y) / d; q.vx = q.dx * q.speed; q.vy = q.dy * q.speed;
        }
      }
      const px = q.x, py = q.y;
      q.x += q.vx * dt; q.y += q.vy * dt; q.travel += q.speed * dt;
      if (q.carried) for (const [id, until] of q.carried) { // 휩쓸림: 묶인 동안 파도와 같은 속도로 함께 밀려감
        const o = this.players.get(id);
        if (!o || this.t >= until) { q.carried.delete(id); continue; }
        if (!o.stunned) { o.x += q.vx * dt; o.y += q.vy * dt; this._clamp(o); }
      }
      if (q.boom?.ph === 'out' && q.travel >= q.maxDist) { q.boom.ph = 'hold'; q.boom.until = this.t + q.boom.wait; q.vx = q.vy = 0; }
      let gone = (!q.boom && q.travel >= q.maxDist) || q.x < 0 || q.y < 0 || q.x > this.map.w || q.y > this.map.h;
      let blocked = !!(this.solids && inObstacle(q.x, q.y)); // 대난투 장애물은 투사체도 막음 (강은 막지 않음)
      for (const w of this.walls.values()) { // 방패 성벽은 상대의 투사체를 막는다
        const wo = this.players.get(w.owner);
        if (w.owner !== q.owner && !(wo && ownerP && this._sameSide(wo, ownerP)) && Math.abs(q.x - w.x) <= w.hx + (q.radius || 0.2) && Math.abs(q.y - w.y) <= w.hy + (q.radius || 0.2)) { blocked = true; this.events.push({ e: 'wallHit', x: r2(q.x), y: r2(q.y) }); break; }
      }
      if (blocked) { this.projectiles.delete(q.id); continue; }
      for (const o of foes) {
        const mh = q.multi && q.multiAt.get(o.id); // 다단히트(귀상어 해일): gap초마다 최대 n번
        if (q.multi ? mh && (mh.n >= q.multi.n || this.t - mh.t < q.multi.gap - 1e-6) : q.hit.has(o.id)) continue;
        // 이번 틱에 지나온 선분과 상대 사이 거리 (빠른 투사체가 통과하지 않게)
        const sx = q.x - px, sy = q.y - py, l2 = sx * sx + sy * sy;
        const k = l2 > 0 ? Math.max(0, Math.min(1, ((o.x - px) * sx + (o.y - py) * sy) / l2)) : 0;
        if (Math.hypot(o.x - (px + sx * k), o.y - (py + sy * k)) > q.radius + o.cfg.radius) continue;
        q.hit.add(o.id); if (q.multi) q.multiAt.set(o.id, { n: (mh?.n || 0) + 1, t: this.t });
        if (q.ult) ultHit(this, o, this.players.get(q.owner) || { id: q.owner }, this._projDamage(q), q.knock, q.dx, q.dy, q.art); else this._projHit(q, o, this.players.get(q.owner) || { id: q.owner }, this._projDamage(q), q.knock, q.dx, q.dy, q.art);
        if (q.root) { o.rootUntil = Math.max(o.rootUntil, this.t + q.root); if (q.carried) q.carried.set(o.id, this.t + (q.carry ?? q.root)); }
        if (!q.pierce) { gone = true; break; }
      }
      if (gone) this.projectiles.delete(q.id);
    }
  }

  _ko(target) {
    if (target.egg) { target.egg = false; this.events.push({ e: 'eggBreak', id: target.id, x: r2(target.x), y: r2(target.y) }); } // 알이 깨지면 병아리도 죽음 (아래의 보통 사망 처리: 동전이 떨어지고 부활 시간은 처음부터)
    target.hp = 0;
    target.stunned = true;
    target.stunUntil = this.t + target.cfg.stunSec;
    target.kx = target.ky = 0; // 쓰러지는 순간 미끄러지던 것도 멈춤
    this.events.push({ e: 'stun', id: target.id });
    if (this.brawl && this.phase === PHASE.MOVING && this.brawl.ids.has(target.id)) { // 대난투: 쓰러지면 유령(이동 20%) — 팀원이 5초 겹쳐 있으면 부활, 동전은 안 떨어짐
      target.stunned = false; target.stunUntil = 0; target.ghost = true; target.reviveT = 0; target.dash = null; target.channel = null; target.flurry = null; target.orbit = null; target.windup = null; target.kx = target.ky = 0;
      this.events.push({ e: 'ghost', id: target.id, x: r2(target.x), y: r2(target.y) }); return;
    }
    this._dropCoins(target); // 소닉의 링처럼 가진 동전이 전부 튀어나감
  }

  /** 테스트/호스트용: 즉시 쓰러뜨리기 */
  knockOut(id) {
    const p = this.players.get(id);
    if (p && !p.stunned) this._ko(p);
  }

  // ---------- 동전 ----------
  spawnCoin(x, y) {
    if (this.coinsSpawned >= COIN.maxTotal) return null;
    this.coinsSpawned++;
    if (x == null) {
      for (let i = 0; i < 12; i++) { // 다른 동전과 너무 가깝지 않은 곳
        x = rand(1, this.map.w - 1); y = rand(1, this.map.h - 1);
        if ([...this.coins.values()].every((c) => Math.hypot(c.x - x, c.y - y) > 3)) break;
      }
    }
    const c = { id: ++this.coinSeq, x, y, readyAt: this.t + 0.35, lockUntil: 0 };
    this.coins.set(c.id, c);
    this.events.push({ e: 'coinSpawn', id: c.id, x: r2(x), y: r2(y) });
    return c;
  }

  giveCoins(id, n) {
    const p = this.players.get(id);
    if (p) p.coins += n;
  }

  /** 가진 동전을 전부 몸에서 튀어나가게 함. 반경 안 무작위 지점으로 포물선을 그리며 떨어짐. 떨어뜨린 개수 반환 */
  _dropCoins(p) {
    const n = p.coins;
    if (!n) return 0;
    p.coins = 0;
    for (let i = 0; i < n; i++) {
      const ang = rand(0, Math.PI * 2);
      const dist = Math.max(COIN.scatterMin, COIN.scatterRadius * Math.sqrt(Math.random())); // 원 안에 고르게
      const x = Math.min(this.map.w - 0.5, Math.max(0.5, p.x + Math.cos(ang) * dist));
      const y = Math.min(this.map.h - 0.5, Math.max(0.5, p.y + Math.sin(ang) * dist));
      const flight = COIN.flightSec * rand(0.85, 1.15);
      // 떨어진 동전은 땅에 닿는 순간부터 줍을 수 있다 (줍기 금지 시간 없음)
      const c = { id: ++this.coinSeq, x, y, readyAt: this.t + flight + COIN.dropLockSec, lockUntil: this.t + COIN.dropLockSec };
      this.coins.set(c.id, c);
      this.events.push({ e: 'coinDrop', id: c.id, fx: r2(p.x), fy: r2(p.y), x: r2(x), y: r2(y), flight: r2(flight), lock: COIN.dropLockSec });
    }
    return n;
  }

  _updateCoins(dt, active) {
    if (active.some((p) => !p.isBot)) { // 참가자가 있을 때만 30초 시계가 간다
      this.coinClock += dt;
      if (this.coinClock >= COIN.spawnEverySec) { this.coinClock = 0; const c = this._crowdSpot([...this.coins.values()]); this.spawnCoin(c.x, c.y); } // 평소 동전도 사람이 몰린 곳 위주로
    }
    for (const c of [...this.coins.values()]) {
      if (this.t < c.readyAt) continue; // 생성 직후이거나, 떨어진 뒤 줍기 금지 시간 중
      let best = null, bd = Infinity;
      for (const p of active) {
        if (p.stunned) continue; // 쓰러진 캐릭터는 못 줍는다 (봇은 줍는다)
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d <= (p.cfg.pickupRadius ?? COIN.pickupRadius) * (buffOf(this, p)?.pickup ?? 1) && d < bd) { best = p; bd = d; }
      }
      if (best) {
        this.coins.delete(c.id);
        best.coins += 1;
        this.events.push({ e: 'coinGet', id: c.id, by: best.id, x: r2(c.x), y: r2(c.y) });
      }
    }
  }

  // ---------- 아이템: 하트(체력 회복) · 신발(이동 속도 증가) ----------
  /**
   * 밀집도 가중 스폰: 맵에서 후보 지점을 여러 개 뽑아, 살아 있는 참가자가 많이 몰린 곳일수록 높은 확률로 고른다.
   * 점수 = Σ exp(-거리² / 2σ²) (σ = CROWD.sigma칸). 바로 발밑(minDist칸 안)·다른 아이템/동전 근처는 제외, 아무도 없으면 고르게.
   */
  _crowdSpot(avoid = []) {
    const ps = [...this.players.values()].filter((p) => p.connected && !p.ghost && !p.home), big = this.solids, C = CROWD;
    const ok = (x, y) => !(big && (inObstacle(x, y) || inWater(x, y))) && avoid.every((o) => Math.hypot(o.x - x, o.y - y) > 2);
    const cand = [];
    for (let i = 0; i < C.samples * 3 && cand.length < C.samples; i++) {
      const x = rand(1.5, this.map.w - 1.5), y = rand(1.5, this.map.h - 1.5);
      if (!ok(x, y)) continue;
      let w = C.floor, near = false;
      for (const p of ps) { const d2 = (p.x - x) ** 2 + (p.y - y) ** 2; if (d2 < C.minDist ** 2) near = true; w += Math.exp(-d2 / (2 * C.sigma ** 2)); }
      cand.push({ x, y, w: near ? 0 : w });
    }
    const tot = cand.reduce((a, c) => a + c.w, 0);
    if (!cand.length) return { x: rand(1.5, this.map.w - 1.5), y: rand(1.5, this.map.h - 1.5) };
    if (tot <= 0) return cand[Math.floor(Math.random() * cand.length)];
    let r = Math.random() * tot; for (const c of cand) { r -= c.w; if (r <= 0) return c; } // 룰렛 휠: 점수에 비례해 고름
    return cand[cand.length - 1];
  }

  spawnItem(k, x, y) {
    if (this.items.size >= ITEM.maxOnMap) return null;
    k ??= Math.random() < 0.5 ? 'heart' : 'shoe';
    if (x == null) ({ x, y } = this._crowdSpot([...this.items.values()]));
    const it = { id: ++this.itemSeq, k, x, y };
    this.items.set(it.id, it);
    this.events.push({ e: 'itemSpawn', id: it.id, k, x: r2(x), y: r2(y) });
    return it;
  }

  /** 아이템 줍기 효과 (하트 = 회복, 신발 = 달리기 빨라짐). 래브라도 궁극기도 이걸로 흡수 */
  takeItem(p, it) {
    this.items.delete(it.id);
    let amount = 0;
    if (it.k === 'heart') { amount = Math.max(0, Math.min(p.cfg.hp - p.hp, Math.ceil(p.cfg.hp * ITEM.heart.heal))); p.hp += amount; }
    else p.speedUntil = this.t + ITEM.shoe.sec;
    this.events.push({ e: 'itemGet', id: it.id, k: it.k, by: p.id, amount, x: r2(it.x), y: r2(it.y) });
  }

  _updateItems(dt, active) {
    if (active.some((p) => !p.isBot)) {
      this.itemClock += dt;
      if (this.itemClock >= ITEM.spawnEverySec) { this.itemClock = 0; this.spawnItem(); }
    }
    for (const it of [...this.items.values()]) {
      let best = null, bd = Infinity;
      for (const p of active) {
        if (p.stunned || (it.k === 'heart' && p.hp >= p.cfg.hp)) continue; // 체력이 가득이면 하트는 남겨 둠
        const d = Math.hypot(p.x - it.x, p.y - it.y);
        if (d <= (p.cfg.pickupRadius ?? ITEM.pickupRadius) * (buffOf(this, p)?.pickup ?? 1) && d < bd) { best = p; bd = d; }
      }
      if (best) this.takeItem(best, it);
    }
  }

  _hit(target, attacker, dx, dy, dmgMul = 1, knockMul = 1) {
    const a = attacker.cfg.attack;
    const dmg = Math.round((a.dmgMin + Math.floor(Math.random() * (a.dmgMax - a.dmgMin + 1))) * dmgMul);
    this._applyHit(target, attacker, dmg, a.knockback * knockMul, dx, dy, a.fx);
  }

  /** 피해로 얻는 궁극기 충전량의 배수: DPS가 낮을수록 더 채워 줘서 캐릭터마다 궁극기 주기가 비슷해짐 (6 ÷ 내 DPS, 0.6~1.5배) */
  _chargeMul(p) {
    if (!p.cfg) return 1;
    let m = this._cmCache.get(p.cfg); if (m === undefined) { m = Math.max(0.6, Math.min(1.5, 6 / Math.max(0.1, dpsOf(p.cfg).dps))); this._cmCache.set(p.cfg, m); }
    return m;
  }

  _applyHit(target, attacker, rawDmg, knock, dx, dy, fx) {
    const emp = this._emp; this._emp = false; // 이번 타격이 '강화된 평타'인가 (한 번 쓰면 사라짐)
    if (target.ghost) return; // 유령은 맞지도 밀리지도 않음
    if (this.t < target.invUntil || (this.god && !target.isBot)) { // 무적: 피해도 밀림도 없음
      this.events.push({ e: 'block', id: target.id, x: r2(target.x), y: r2(target.y) });
      return;
    }
    const bf = attacker.cfg ? buffOf(this, attacker) : null; // 궁극기 강화
    const assassin = bf?.assassin || 0; // 은신 첫 일격
    let dmg = target.stunned && !target.egg ? 0 : Math.round(rawDmg * (bf?.dmg ?? 1) * (assassin || 1));
    if (assassin && dmg > 0) { bf.assassin = 0; bf.stealth = false; }
    const crit = dmg > 0 && (assassin || bf?.crit || Math.random() < CRIT.chance + (attacker.cfg?.attack?.critBonus ?? 0));
    if (crit) dmg = Math.round(dmg * CRIT.mul);
    const gd = target.cfg.guard; // 방패: 바라보는 쪽에서 오는 공격은 피해가 줄어듦
    const guard = !!(gd && dmg > 0 && (attacker.x - target.x) * target.face > 0);
    if (guard) dmg = Math.max(1, Math.round(dmg * (1 - gd)));
    if (target.shield && this.t < target.shield.until && dmg > 0) dmg = Math.max(1, Math.round(dmg * target.shield.mul)); // 진흙 목욕 피해 감소
    if (dmg > 0) {
      if (attacker.cfg) {
        let add = dmg * (this.ultDepth > 0 ? ULT_CHARGE.ultHit : 1);
        if (this.ultDepth > 0) { add = Math.min(add, attacker.ultRoom ?? 0); attacker.ultRoom = (attacker.ultRoom ?? 0) - add; } // 궁극기로 채우는 양은 한 번에 게이지의 5%까지 (여러 명 합쳐서)
        charge(attacker, add * this._chargeMul(attacker));
      }
      charge(target, dmg * CHARGE_TAKEN * this._chargeMul(target));
      if (target.cfg.role === 'tank' && target.cfg.ult) charge(target, target.cfg.ult.need * ULT_CHARGE.tankHit); // 탱커는 맞을 때마다 2% 더
      const cm = emp ? attacker.cfg?.attack?.charm : null; // 3번 공격할 때마다 다음 공격이 강화(공주: 매혹) — 적중하면 발동
      const tt = emp ? attacker.cfg?.attack?.tether : null; // 강화된 다음 공격(개구리): 적중하면 혀로 묶음
      if (tt) { target.tether = { by: attacker.id, until: this.t + tt.sec, len: tt.len, resist: tt.resist, pull: tt.pull }; this.events.push({ e: 'tetherStart', id: attacker.id, x: r2(target.x), y: r2(target.y), r: 1 }); }
      if (cm) { target.charmUntil = this.t + cm.sec; target.charmBy = attacker.id; this.events.push({ e: 'charm', id: attacker.id, x: r2(target.x), y: r2(target.y), r: 0.9 }); }
      target.hurtAt = this.t; target.regenT = 0; attacker.revealAt = this.t; // 맞으면 자동 회복 대기 시간이 처음부터
      target.hp = Math.max(0, target.hp - dmg);
      if (target.hp === 0) this._ko(target);
    }
    // 기절(쓰러진) 상태에서는 밀리지 않음. 그 외에는 총 거리 = knock (BU, 음수면 끌어당김)
    if (!target.stunned && !target.ghost && !target.channel?.armor) { // armor(무대 위 춤 등)는 밀리지 않음
      target.kx += dx * knock * KNOCK_DECAY;
      target.ky += dy * knock * KNOCK_DECAY;
    }
    this.events.push({ e: 'hit', id: target.id, by: attacker.id, dmg, crit, guard, fx, x: r2(target.x), y: r2(target.y), u: this.ultDepth > 0 ? 1 : 0 }); // u: 궁극기로 맞은 타격 (클라이언트가 타수마다 소리를 냄)
  }

  // ---------- 궁극기 ----------
  ult(id, aim) {
    const p = this.players.get(id);
    if (this.frozen || this.noUlt || this.phase === PHASE.HOLD || this._bLocked() || !p || p.parked || p.ghost || p.stunned || this.t < p.rootUntil || this.t < p.charmUntil || this.t < (p.silenceUntil || 0) || p.channel || this._dashing(p) || !ultReady(p)) return false;
    useUlt(this, p, aim);
    return true;
  }

  // ---------- 스킬: 돌진/도약 (달리기 캐릭터는 달리기 버튼을 누르고 있는 방식) ----------
  _dashing(p) {
    return !!(p.dash && this.t < p.dash.until);
  }

  skill(id) {
    const p = this.players.get(id);
    if (this.frozen) return;
    const sk = p?.cfg.skill;
    if (!p || p.ghost || this.phase === PHASE.HOLD || this._bLocked() || p.stunned || this.t < p.rootUntil || this.t < p.charmUntil || p.channel || sk?.type !== 'dash' || this.t < p.skillReadyAt || this._dashing(p)) return;
    const len = Math.hypot(p.input.mx, p.input.my);
    const dx = len > 0.1 ? p.input.mx / len : p.face, dy = len > 0.1 ? p.input.my / len : 0;
    p.dash = { dx, dy, speed: sk.distance / sk.duration, until: this.t + sk.duration, pass: !!sk.pass, hitDmg: sk.hitDmg || 0, hitKnock: sk.hitKnock || 0 };
    p.skillReadyAt = this.t + sk.cooldown;
    if (Math.abs(dx) > 0.15) p.face = dx > 0 ? 1 : -1;
    this.events.push({ e: 'dash', id: p.id, dx: r2(dx), dy: r2(dy), kind: sk.pass ? 'hop' : 'charge', dist: sk.distance });
  }

  // ---------- 매 틱 ----------
  update(dt) {
    if (this.frozen) return; // 비상 정지: 모든 것이 멈춤
    this.t += dt;
    if (this.timerPaused && (this.phase === PHASE.READING || this.phase === PHASE.MOVING)) this.phaseEnd += dt; // 타이머 일시정지

    if (this.phase === PHASE.READING && this.t >= this.phaseEnd) this._startMoving();
    else if (this.phase === PHASE.MOVING && this.t >= this.phaseEnd) { if (this.brawl) this._finishBrawl(); else if (this.coinRun) this._coinFinish(); else if (this.cal) { this._calGrade(); if (this.cal) this._calFinish(); } else { this._lock(); if (this.question.vote) this._finishVote(); else this.phase = PHASE.HOLD; } } // 시간이 끝나도 바로 공개하지 않고 진행자를 기다린다

    const active = [...this.players.values()].filter((p) => p.connected);

    for (const p of active) {
      if (p.isBot) { this._botThink(p); this._botUnstick(p); }
      this._step(p, dt);
    }
    if (this.phase !== PHASE.HOLD) this._collide(active.filter((p) => !p.out && !p.ghost && !p.stunned)); // 탈락자·유령·쓰러진 캐릭터는 몸이 부딪히지 않음 (쓰러져 움직여도 밀지 못함) · 시간 종료 후엔 서로 밀지도 않음
    if (!this._bLocked()) for (const p of active) if (p.cfg.ult && !p.stunned) charge(p, p.cfg.ult.need * (p.cfg.ult.chargeSec ? 1 / p.cfg.ult.chargeSec : ULT_CHARGE.auto) * dt); // 가만히 있어도 초당 3% (chargeSec가 있으면 그 시간에 가득)
    const living = active.filter((p) => !p.ghost); // 유령은 동전·아이템도 못 주움
    this._updateCoins(dt, living);
    this._updateItems(dt, living);
    this._updateProjectiles(dt);
    updateUlts(this);
    blockWalls(this, active);

    this._updateBush();
    if (this.brawl && this.phase === PHASE.MOVING) this._brawlRevive(dt);
    if (this.brawl && this.phase === PHASE.MOVING && this.brawl.groups0 >= 2 && new Set(this._brawlAlive().map((p) => this._bKey(p))).size <= 1) this._finishBrawl();
    if (this.coinRun && this.phase === PHASE.MOVING) this._coinTick(dt);
    if (this.phase === PHASE.MOVING && this.question && !this.brawl && !this.cal && !this.coinRun) {
      for (const p of active) {
        const z = zoneAt(this.question.type, p.x, p.y);
        if (z !== p.zone) { p.zone = z; p.zoneSince = this.t; }
      }
    }
  }

  _step(p, dt) {
    const c = p.cfg;
    if (p.windup && (p.stunned || this.t >= p.windup.at)) { // 예고가 끝나면 타격 (그 전에 쓰러지면 취소)
      const w = p.windup; p.windup = null;
      if (!p.stunned) this._strike(p, w.range, w.dx, w.dy, w.m, w.step, w.arc, w.multi, w.line);
    }
    if (this.t < p.charmUntil) { // 매혹: 걸은 사람 쪽으로 걸어가고 가까워지면 멈춘다
      const by = this.players.get(p.charmBy);
      if (by) { const cx = by.x - p.x, cy = by.y - p.y, d = Math.hypot(cx, cy); p.input = d > 1.2 ? { mx: cx / d, my: cy / d, run: false } : { mx: 0, my: 0, run: false }; }
    }
    if (p.channel && (p.stunned || this.t >= p.channel.until)) { p.channel = null; this.events.push({ e: 'channelEnd', id: p.id }); } // 시전 끝/끊김
    if (p.stunned && this.t >= p.stunUntil) { // 기절 해제 → 체력 회복 + 무적
      p.stunned = false; p.egg = false;
      p.hp = c.hp;
      p.invUntil = this.t + c.invincibleSec;
    }

    if (!p.stunned && !p.ghost && p.hp > 0 && p.hp < c.hp && this.t - p.hurtAt >= REGEN.delay) { // 일정 시간 맞지 않으면 자동 회복
      p.regenT += dt;
      if (p.regenT >= REGEN.every) { p.regenT -= REGEN.every; const h = Math.min(c.hp - p.hp, Math.max(1, Math.round(c.hp * REGEN.pct))); p.hp += h; this.events.push({ e: 'regen', id: p.id, amount: h, x: r2(p.x), y: r2(p.y) }); }
    } else p.regenT = 0;
    const am = c.ammo; // 탄창 장전: 쏜 직후에도 계속 차오름
    if (am) p.ammoF = Math.min(am.max, p.ammoF + dt / am.reload);
    if (p.stunned) p.dash = null;
    if (p.regen) { // 회복 효과(예: 공주 응원): 초당 rate만큼 서서히 회복
      if (this.t >= p.regen.until || p.stunned) p.regen = null;
      else { p.regen.acc += p.regen.rate * dt; const n = Math.floor(p.regen.acc); if (n >= 1) { p.regen.acc -= n; const h = Math.min(p.cfg.hp - p.hp, n); if (h > 0) { p.hp += h; this.events.push({ e: 'itemGet', id: 0, k: 'heart', by: p.id, amount: h, x: r2(p.x), y: r2(p.y) }); } } }
    }
    const dashing = this._dashing(p);
    if (!dashing) p.dash = null;
    p.dashPass = dashing && p.dash.pass;
    const runSkill = (c.skill?.type ?? 'run') === 'run';

    if (p.flurry) { // 난타 전진: 멈추지 않고 앞으로, 스틱을 밀면 그 방향으로 꺾음
      if (p.stunned || this.t >= p.flurry.until) { p.flurry = null; if (p.rawIn) p.input = p.rawIn; }
      else { const st = p.isBot ? p.input : p.rawIn || p.input, l = Math.hypot(st.mx, st.my); if (l > 0.1) { p.flurry.dx = st.mx / l; p.flurry.dy = st.my / l; } p.input = { mx: p.flurry.dx, my: p.flurry.dy, run: false }; }
    }
    let vx = 0, vy = 0, running = false;
    const len = Math.hypot(p.input.mx, p.input.my);
    const rooted = this.t < p.rootUntil; // 궁극기에 묶임: 못 움직이고 못 공격
    p.moving = !rooted && len > 0.1; // 쓰러져 있어도 느리게(30%) 움직일 수 있음
    if (rooted && !dashing) { /* 묶임 */ } else if (dashing) { // 돌진/도약 중에는 입력과 상관없이 정해진 속도로 일직선
      vx = p.dash.dx * p.dash.speed; vy = p.dash.dy * p.dash.speed;
      p.moving = true; running = true;
    } else if (p.moving) {
      running = !p.stunned && !(p.ghost && this.brawl) && !this._runLocked() && runSkill && p.input.run && p.runGauge > 0 && !p.exhausted;
      // 공격 모션 중에는 이동 속도 감소 (캐릭터별 attack.moveSpeedWhileAttacking, 근접 0.5)
      const slow = this.t < p.attackUntil ? (c.attack.moveSpeedWhileAttacking ?? 1) : 1;
      const boost = (this.t < p.speedUntil ? ITEM.shoe.mul : 1) * (buffOf(this, p)?.spd ?? 1); // 신발 · 궁극기 강화
      const speed = (running ? c.runSpeed : c.walkSpeed) * slow * boost * (p.channel ? p.channel.move : 1) * (this.t < p.charmUntil ? 0.5 : 1) * (this.t < p.slowUntil ? p.slowMul : 1) * (this.t < (p.atkSlowUntil || 0) ? p.atkSlowMul : 1) * (p.stunned ? 0.3 : 1) * (p.ghost && this.brawl ? 0.2 : 1); // 쓰러지면 30% · 대난투 유령은 20% // 진흙에 느려짐
      vx = p.input.mx * speed;
      vy = p.input.my * speed;
      const lock = !running && this.t < p.attackUntil ? this._aimDir(p, null, c.attack.range).near : null; // 공격 모션이 재생되는 동안만 자동 조준 대상을 바라봄 (평소엔 가는 방향)
      if (lock && Math.abs(lock.x - p.x) > 0.15) p.face = lock.x > p.x ? 1 : -1;
      else if (Math.abs(p.input.mx) > 0.1) p.face = p.input.mx > 0 ? 1 : -1;
    }
    p.running = running;
    if (dashing) { /* 돌진 중에는 달리기 게이지를 건드리지 않음 */ } else if (running) {
      p.runGauge = Math.max(0, p.runGauge - dt * RUN_DRAIN);
      if (p.runGauge === 0) p.exhausted = true;
    } else {
      p.runGauge = Math.min(c.runGauge, p.runGauge + (c.runGauge / c.runRecharge) * dt);
      if (p.exhausted && p.runGauge >= 1) p.exhausted = false;
    }

    const th = p.tether; // 혀로 묶임: 개구리에게서 멀어지는 속도는 줄고, 줄 길이를 넘으면 끌려옴
    if (th) {
      const by = this.players.get(th.by);
      if (!by || by.stunned || this.t >= th.until) p.tether = null;
      else {
        const tx = p.x - by.x, ty = p.y - by.y, d = Math.hypot(tx, ty);
        if (d > 0.01) {
          const ux = tx / d, uy = ty / d, away = vx * ux + vy * uy;
          if (away > 0) { vx -= ux * away * (1 - th.resist); vy -= uy * away * (1 - th.resist); }
          if (d > th.len) { vx -= ux * th.pull * (d - th.len); vy -= uy * th.pull * (d - th.len); }
        }
      }
    }
    if (this.phase === PHASE.HOLD) { vx = vy = 0; p.kx = p.ky = 0; p.dash = null; } // 시간이 끝나면 정답 공개 전까지 그 자리에 고정 (밀려도 안 움직임)
    p.x += (vx + p.kx) * dt;
    p.y += (vy + p.ky) * dt;
    const decay = Math.exp(-KNOCK_DECAY * dt);
    p.kx *= decay; p.ky *= decay;
    if (Math.abs(p.kx) < 0.01) p.kx = 0;
    if (Math.abs(p.ky) < 0.01) p.ky = 0;
    this._clamp(p);

    if (dashing && p.dash.hitAll) { // 궁극기 돌진: 닿는 모두에게 한 번씩, 멈추지 않음
      const h = p.dash.hitAll;
      for (const o of this._enemies(p)) {
        if (o.stunned || h.done.has(o.id) || Math.hypot(o.x - p.x, o.y - p.y) > p.cfg.radius + o.cfg.radius + 0.5) continue;
        h.done.add(o.id);
        this._applyHit(o, p, h.dmg, h.knock, p.dash.dx, p.dash.dy, 'bump');
      }
    }
    if (dashing && p.dash.hitDmg) { // 돌진: 처음 닿은 상대를 날리고 멈춤
      for (const o of this._enemies(p)) {
        if (o.stunned || Math.hypot(o.x - p.x, o.y - p.y) > p.cfg.radius + o.cfg.radius + 0.25) continue;
        this._applyHit(o, p, p.dash.hitDmg, p.dash.hitKnock, p.dash.dx, p.dash.dy, 'bump');
        p.dash.until = this.t;
        break;
      }
    }
  }

  _clamp(p) {
    const r = p.cfg.radius;
    p.x = Math.min(this.map.w - r, Math.max(r, p.x));
    p.y = Math.min(this.map.h - r, Math.max(r, p.y));
    if (this.solids) { const q = pushOut(p.x, p.y, r); p.x = q.x; p.y = q.y; } // 대난투: 강·장애물은 지나갈 수 없음
  }

  _collide(list) {
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (a.dashPass || b.dashPass) continue; // 도약 중에는 다른 캐릭터를 뛰어넘음
          const min = a.cfg.radius + b.cfg.radius;
          let dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          if (d >= min) continue;
          if (d < 1e-6) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy); }
          const push = (min - d) / 2;
          const nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
        }
      }
      for (const p of list) this._clamp(p);
    }
  }

  /** best 둘레 2.5칸 안에 (p 말고) 몇 명이 붙어 있는지 */
  _crowd(best, p) {
    let n = 0;
    for (const o of this.players.values()) if (o !== p && o !== best && o.connected && Math.hypot(o.x - best.x, o.y - best.y) < 2.5) n++;
    return n;
  }

  /** 봇이 노릴 줍기 대상: 가까운 동전(줍을 수 있는 것), 체력이 80% 미만이면 하트, 신발 */
  /** 체력이 35% 아래면 도망(60% 회복할 때까지): 가까운 적에게서 멀어지고(벽·모서리는 피함), 안전하게 닿을 수 있는 하트가 있으면 그쪽으로, 달리기·대쉬·궁극기로 탈출. 구석에 몰리면 맞서 싸움 */
  _botFlee(p) {
    const c = p.cfg, ai = p.ai, fight = !!this.brawl; // 대난투·토너먼트: 도망보다 전투 — 거의 죽어갈 때(15%)만 잠깐 빠졌다가(35%) 다시 싸움
    const lo = fight ? 0.15 : 0.35, hi = fight ? 0.35 : 0.6;
    if (ai.fleeing ? p.hp >= c.hp * hi : p.hp > c.hp * lo) { ai.fleeing = false; return false; }
    const foes = this._enemies(p).filter((o) => !this._stealthed(o) && !o.stunned && Math.hypot(o.x - p.x, o.y - p.y) < 12);
    if (!foes.length && !ai.fleeing) return false;
    if (fight) { // 사거리 안에 나보다 약한(체력 비율이 낮은) 적이 있으면 도망 대신 마무리하러 감
      const reach = (c.attack.range ?? 1.5) + 0.8;
      if (foes.some((o) => Math.hypot(o.x - p.x, o.y - p.y) <= reach && o.hp / o.cfg.hp <= p.hp / c.hp)) { ai.fleeing = false; return false; }
    }
    ai.fleeing = true;
    let fx = 0, fy = 0, dn = Infinity, nearest = null;
    for (const o of foes) { const dx = p.x - o.x, dy = p.y - o.y, d = Math.max(0.3, Math.hypot(dx, dy)); fx += (dx / d) / d; fy += (dy / d) / d; if (d < dn) { dn = d; nearest = o; } } // 가까운 적일수록 강하게 밀어냄
    const M = 3.5, W = this.map.w, H = this.map.h; // 벽에 몰리지 않게 가장자리에서 안쪽으로 밀어냄
    if (p.x < M) fx += (M - p.x) * 0.25; if (p.x > W - M) fx -= (p.x - (W - M)) * 0.25; if (p.y < M) fy += (M - p.y) * 0.25; if (p.y > H - M) fy -= (p.y - (H - M)) * 0.25;
    let heart = null, hd = 14;
    for (const it of this.items.values()) { // 하트: 나보다 적이 훨씬 가까운 곳은 피함
      if (it.k !== 'heart') continue; const d = Math.hypot(it.x - p.x, it.y - p.y); if (d >= hd) continue;
      if (foes.every((o) => Math.hypot(o.x - it.x, o.y - it.y) > d * 0.8)) { heart = it; hd = d; }
    }
    let mx = fx, my = fy; const fl = Math.hypot(fx, fy) || 1; mx /= fl; my /= fl;
    if (heart) { const hx = (heart.x - p.x) / Math.max(0.1, hd), hy = (heart.y - p.y) / Math.max(0.1, hd); mx = mx * 0.4 + hx * 0.6; my = my * 0.4 + hy * 0.6; const l = Math.hypot(mx, my) || 1; mx /= l; my /= l; }
    if (nearest && dn < 1.3 && Math.hypot(fx, fy) < 0.15 && this.botsCanAttack && p.botMode === 'aggro') { this._tryAttack(p, null); p.input = { mx: 0, my: 0, run: false }; return true; } // 막다른 곳이면 맞서 싸움
    const canRun = c.skill?.type === 'run' && p.runGauge > 0.3 && !p.exhausted;
    p.input = { mx, my, run: canRun && !!nearest && dn < 6 };
    if (c.skill?.type === 'dash' && nearest && dn < 3 && this.t >= p.skillReadyAt) this.skill(p.id); // 대쉬로 거리 벌리기
    if (nearest && ultReady(p) && dn <= (c.ult.range ?? 5) && p.botMode === 'aggro') this.ult(p.id, null);
    return true;
  }

  /** 대난투 맵의 장애물·강에 막혀 걸음이 안 나가면(0.4초에 0.35칸 미만) 0.9초 동안 옆으로 비껴 걸어 돌아감 */
  _botUnstick(p) {
    if (!this.solids || !p.input) return;
    const ai = p.ai, mag = Math.hypot(p.input.mx, p.input.my);
    if (this.t - (ai.stT ?? -1) >= 0.4) {
      if (ai.stT !== undefined && ai.wasMoving && !p.stunned && Math.hypot(p.x - ai.stX, p.y - ai.stY) < 0.35) { ai.slideUntil = this.t + 0.9; ai.slideDir = Math.random() < 0.5 ? 1 : -1; }
      ai.stT = this.t; ai.stX = p.x; ai.stY = p.y; ai.wasMoving = mag > 0.1;
    }
    if (this.t < (ai.slideUntil ?? 0) && mag > 0.1) { const s = ai.slideDir, mx = (-p.input.my * s) * 0.9 + p.input.mx * 0.2, my = (p.input.mx * s) * 0.9 + p.input.my * 0.2, l = Math.hypot(mx, my) || 1; p.input = { ...p.input, mx: mx / l, my: my / l }; }
  }

  /** 대난투 유령 봇: 가장 가까운 살아 있는 팀원에게 걸어가 겹쳐 선다 (겹쳐 있으면 제자리) */
  _botToAlly(p) {
    let best = null, bd = Infinity;
    for (const o of this.brawl.ids) { const a = this.players.get(o); if (!a || a === p || !a.connected || a.ghost || a.team !== p.team) continue; const d = Math.hypot(a.x - p.x, a.y - p.y); if (d < bd) { best = a; bd = d; } }
    p.input = !best || bd < 0.5 ? { mx: 0, my: 0, run: false } : { mx: (best.x - p.x) / bd, my: (best.y - p.y) / bd, run: false };
  }

  _botPickup(p, range) {
    let best = null, bd = range;
    const consider = (o, w = 1) => { const d = Math.hypot(o.x - p.x, o.y - p.y) * w; if (d < bd) { best = { x: o.x, y: o.y, d: Math.hypot(o.x - p.x, o.y - p.y) }; bd = d; } };
    const claimed = (c) => { // 한 동전을 노리는 봇은 가장 가까운 2마리까지만 (모두 한 동전에 몰리지 않게)
      let closer = 0, d0 = Math.hypot(c.x - p.x, c.y - p.y);
      for (const o of this.players.values()) if (o !== p && o.isBot && o.botMode !== 'idle' && o.connected && !o.stunned && Math.hypot(c.x - o.x, c.y - o.y) < d0) closer++;
      return closer >= 2;
    };
    for (const c of this.coins.values()) if (this.t >= c.readyAt && !claimed(c)) consider(c);
    for (const it of this.items.values()) if (it.k === 'shoe' || p.hp < p.cfg.hp * 0.8) consider(it, 0.8);
    return best;
  }

  // ---------- 더미 봇 ----------
  /** 샌드백 지킴이: 사람이 sense 안으로 오면 쫓아가 때리고, 집에서 leash보다 멀어지면 포기하고 제자리로 돌아간다 */
  _guardThink(p) {
    if (!SANDBAG_ATTACK) { p.input = { mx: 0, my: 0, run: false }; return; } // 샌드백 공격 기능 꺼짐: 가만히 서 있기만 함
    const h = p.home, a = p.cfg.attack, SENSE = 4.5, LEASH = 6.5, dh = Math.hypot(h.x - p.x, h.y - p.y);
    let best = null, bd = Infinity;
    for (const o of this.players.values()) { if (o.isBot || !o.connected || o.stunned || this._stealthed(o)) continue; const d = Math.hypot(o.x - p.x, o.y - p.y), dt = Math.hypot(o.x - h.x, o.y - h.y); if (dt <= SENSE + 1 && d < bd) { best = o; bd = d; } }
    if (p.ai.returning && dh < 0.5) p.ai.returning = false;
    if (dh > LEASH) p.ai.returning = true; // 구역을 벗어나면 제자리로
    if (best && !p.ai.returning) {
      const hold = a.type === 'melee' ? a.range * 0.85 : a.range * 0.8;
      p.input = bd > hold ? { mx: (best.x - p.x) / bd, my: (best.y - p.y) / bd, run: false } : { mx: 0, my: 0, run: false };
      if (bd <= a.range) this._tryAttack(p, null);
      if (ultReady(p) && bd <= (p.cfg.ult.range ?? 5)) this.ult(p.id, null);
    } else p.input = dh > 0.4 ? { mx: (h.x - p.x) / dh, my: (h.y - p.y) / dh, run: false } : { mx: 0, my: 0, run: false };
  }

  _botThink(p) {
    if (p.stunned || p.botMode === 'idle') { p.input = { mx: 0, my: 0, run: false }; return; }
    if (p.botMode === 'guard') { this._guardThink(p); return; }
    if (this.cal && this.phase === PHASE.MOVING && this.cal.ids.has(p.id)) { // 달력: 라운드마다 무작위 날짜 칸으로 걸어감 (유령은 가만히)
      if (p.ghost) { p.input = { mx: 0, my: 0, run: false }; return; }
      const key = `c${this.cal.round}`;
      if (p.ai.q !== key) { const ct = calCenter(this.cal.l, 1 + Math.floor(Math.random() * this.cal.l.days)); p.ai.q = key; p.ai.tx = ct.x + rand(-1.5, 1.5); p.ai.ty = ct.y + rand(-0.8, 0.8); p.ai.startAt = this.t + rand(0.5, 4); }
      const dx = p.ai.tx - p.x, dy = p.ai.ty - p.y, dist = Math.hypot(dx, dy);
      p.input = this.t < p.ai.startAt || dist < 0.3 ? { mx: 0, my: 0, run: false } : { mx: dx / dist, my: dy / dist, run: false };
      return;
    }
    // 문제를 푸는 중: 무작위로 구역을 하나 골라 그 안의 한 지점으로 걸어감
    if (this.phase === PHASE.MOVING && this.question && ZONES[this.question.type]) { // 정지 봇만 빼고 모두 문제를 풂 (공격형은 가는 길에 사거리 안의 상대를 때림)
      const q = this.question;
      if (p.ai.q !== q.id) {
        const z = ZONES[q.type][Math.floor(Math.random() * ZONES[q.type].length)];
        const ang = rand(0, Math.PI * 2), d = Math.sqrt(Math.random()) * z.r * 0.65; // 가장자리에서 밀려도 원 안에 남도록
        p.ai.q = q.id;
        p.ai.tx = z.cx + Math.cos(ang) * d; p.ai.ty = z.cy + Math.sin(ang) * d;
        p.ai.startAt = this.t + rand(0.5, 5); // 사람처럼 제각각 출발
      }
      const dx = p.ai.tx - p.x, dy = p.ai.ty - p.y, dist = Math.hypot(dx, dy);
      p.input = this.t < p.ai.startAt || dist < 0.3 ? { mx: 0, my: 0, run: false } : { mx: dx / dist, my: dy / dist, run: false };
      if (p.botMode === 'aggro' && this.botsCanAttack) {
        const near = this._enemies(p).some((o) => Math.hypot(o.x - p.x, o.y - p.y) <= p.cfg.attack.range);
        if (near) this._tryAttack(p, null);
      }
      return;
    }
    if (this.brawl && p.ghost) { this._botToAlly(p); return; } // 대난투 유령 봇: 살아 있는 팀원에게 가서 겹쳐 부활
    if (this._botFlee(p)) return; // 체력이 낮으면 도망 + 하트 찾기
    const humans = this._enemies(p).filter((o) => !this._stealthed(o)); // 공격형 봇은 봇끼리도 서로 공격 (은신한 상대는 못 찾음)
    p.ai.greed ??= Math.random(); // 봇마다 욕심(0 싸움꾼 ~ 1 수집가): 동전을 노리는 거리와 쫓아가는 거리가 달라 흩어진다
    const loot = p.botMode === 'idle' ? null : this._botPickup(p, p.botMode === 'aggro' ? 8 + p.ai.greed * 6 : 6); // 동전·아이템 줍기
    const toward = (t, d) => { p.input = { mx: (t.x - p.x) / d, my: (t.y - p.y) / d, run: false }; };
    if (p.botMode === 'aggro' && this.botsCanAttack && humans.length) {
      let best = null, bd = Infinity;
      for (const o of humans) {
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d < bd) { best = o; bd = d; }
      }
      const a = p.cfg.attack;
      const hold = a.type === 'melee' ? a.range * 0.85 : a.range * 0.8;
      const onBreak = this.t < (p.ai.breakUntil ?? 0); // 한 상대와 오래 붙어 싸웠으면 잠깐 떨어져서 줍거나 돌아다님
      if (bd <= a.range && !onBreak) { // 사거리 안: 때리되, 발 앞에 동전이 있으면 줍는다
        if (!p.ai.fightAt || this.t - p.ai.lastFight > 2) p.ai.fightAt = this.t; // 새 교전 시작
        p.ai.lastFight = this.t;
        if (this.t - p.ai.fightAt > 3.5 + p.ai.greed * 3) { p.ai.breakUntil = this.t + 3 + rand(0, 2); p.ai.fightAt = 0; }
        if (loot && loot.d < 3) toward(loot, loot.d); else p.input = bd > hold ? { mx: (best.x - p.x) / bd, my: (best.y - p.y) / bd, run: false } : { mx: 0, my: 0, run: false };
        this._tryAttack(p, null);
      } else if (loot) { toward(loot, loot.d); if (bd <= a.range) this._tryAttack(p, null); } // 싸울 상대가 멀거나 쉬는 중이면 동전부터 (지나가며 맞으면 때림)
      else if (!onBreak && bd <= 2.5 + (1 - p.ai.greed) * 2.5 && this._crowd(best, p) < 2) toward(best, bd); // 가까울 때만, 이미 둘 넘게 붙어 있는 상대는 쫓지 않음
      else { p.input = null; if (bd <= a.range) this._tryAttack(p, null); } // 아래 배회로
      if (ultReady(p) && bd <= (p.cfg.ult.range ?? 5)) this.ult(p.id, null);
      if (p.input) return;
    } else if (loot) { toward(loot, loot.d); return; }
    if (p.botMode === 'aggro') { // 할 일이 없으면 맵 곳곳을 돌아다님 (한곳에 모여 있지 않도록)
      let w = p.ai.wp;
      if (!w || this.t > w.until || Math.hypot(w.x - p.x, w.y - p.y) < 1) w = p.ai.wp = { x: rand(2, this.map.w - 2), y: rand(2, this.map.h - 2), until: this.t + rand(4, 8) };
      toward(w, Math.max(0.1, Math.hypot(w.x - p.x, w.y - p.y)));
      return;
    }
    // 배회
    if (this.t >= p.ai.nextThink) {
      p.ai.nextThink = this.t + rand(1, 2.5);
      if (Math.random() < 0.25) { p.ai.mx = 0; p.ai.my = 0; }
      else { const ang = rand(0, Math.PI * 2); p.ai.mx = Math.cos(ang); p.ai.my = Math.sin(ang); }
    }
    p.input = { mx: p.ai.mx, my: p.ai.my, run: false };
  }

  // ---------- 방송용 ----------
  snapshot() {
    const events = this.events;
    this.events = [];
    const players = [];
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      players.push({
        id: p.id, n: p.name, c: p.charId, s: p.stunned && p.egg ? 'egg' : buffOf(this, p)?.morph || p.cfg.sprite, b: p.isBot ? 1 : 0,
        x: r2(p.x), y: r2(p.y), f: p.face,
        hp: p.hp, mhp: p.stunned && p.egg ? p.eggMax || p.cfg.hp : p.cfg.hp,
        st: p.stunned ? 1 : 0, inv: this.t < p.invUntil ? 1 : 0,
        a: p.moving ? (p.running ? 'run' : 'walk') : 'idle',
        ...(p.cfg.skill?.type === 'dash'
          ? { k: 'dash', rg: r2(p.cfg.skill.cooldown - Math.max(0, p.skillReadyAt - this.t)), mrg: p.cfg.skill.cooldown } // 쿨타임 진행도
          : { k: 'run', rg: r2(p.runGauge), mrg: p.cfg.runGauge }),
        tn: p.cfg.tint || null, zs: buffOf(this, p)?.morph ? 1 : (p.cfg.scale || 1) * (buffOf(this, p)?.scale || 1),
        am: Math.floor(p.ammoF + 1e-9), amf: r2(p.ammoF % 1), mam: p.cfg.ammo?.max ?? 0,
        ul: p.cfg.ult ? r2(p.ult / p.cfg.ult.need) : 0, ur: ultReady(p) ? 1 : 0, ub: buffOf(this, p) ? r2(p.buff.until - this.t) : 0, pr: buffOf(this, p)?.morph === 'phoenix' ? p.cfg.ult.radius : 0, pu: buffOf(this, p)?.morph === 'phoenix' ? r2(1 - (p.buff.until - this.t) / p.cfg.ult.sec) : 0, mo: buffOf(this, p)?.morph === 'phoenix' && p.cfg.ult.sec - (p.buff.until - this.t) < 0.7 ? 1 : 0, sl: this._stealthed(p) ? 1 : 0, ch: p.channel ? 1 : 0, cm: this.t < p.charmUntil ? 1 : 0, tt: p.tether && this.t < p.tether.until ? p.tether.by : 0, rv: p.stunned ? r2(Math.max(0, p.stunUntil - this.t)) : 0, ob: p.orbit && this.t < p.orbit.until ? { a: r2(p.orbit.a0 + p.orbit.w * (this.t - p.orbit.t0)), w: p.orbit.w, n: p.orbit.n, r: p.orbit.r } : 0, bn: this.t < p.burnUntil ? 1 : 0, rt: this.t < p.rootUntil ? 1 : 0,
        si: this.t < (p.silenceUntil || 0) ? 1 : 0, sd: p.shield && this.t < p.shield.until ? r2(p.shield.until - this.t) : 0, ot: p.out ? 1 : 0, rp: p.ghost && this.brawl ? r2(p.reviveT || 0) : 0, rr: p.ghost && this.brawl ? r2(p.cfg.radius + 0.9) : 0, em: p.empNext ? 1 : 0, gh: p.ghost ? 1 : 0, ct: p.home ? 0 : 1, tm: p.team || 0, sc: this.totalScore(p), cn: p.coins, sp: r2(Math.max(0, p.speedUntil - this.t)),
      });
    }
    const q = this.question
      ? { id: this.question.id, vote: this.question.vote ? 1 : 0, type: this.question.type, text: this.question.text, options: this.question.options, time: this.question.time, mode: this.question.mode || '개인', image: this.question.image, tour: this.question.tour ? 1 : 0 }
      : null;
    return {
      phase: this.phase,
      left: this.phase === PHASE.READING || this.phase === PHASE.MOVING ? r2(Math.max(0, this.phaseEnd - this.t)) : 0,
      q,
      reveal: this.reveal,
      mp: this.map === MAP ? null : [this.map.w, this.map.h],
      pv: this.preview && this.phase === PHASE.LOBBY ? { type: this.preview.type, l: this.preview.type === 'calendar' ? calLayout(this.preview) : undefined } : null, // 맵 미리 보기
      cs: this.cast,
      off: this.humans().filter((p) => !p.connected && !p.parked).map((p) => [p.id, p.name]), // 접속이 끊긴 참가자 (진행자 화면: 내보내기용)
      pl: r2(this._prep()), pc: isCombat(this.question) ? 1 : 0, // 준비 시간 남은 초 · 전투 모드인가
      tr: this.tour ? { r: this.tour.round, m: this.tour.cur, n: this.tour.alive.length, log: this.tour.log } : null,
      cr: this.coinRun && (this.phase === PHASE.READING || this.phase === PHASE.MOVING) ? Object.keys(this.coinRun.start).map((id) => this.players.get(id)).filter((p) => p && this._present(p)).map((p) => [p.id, p.name, this._coinGot(p)]).sort((a, b) => b[2] - a[2]) : null,
      bw: this.brawl && (this.phase === PHASE.READING || this.phase === PHASE.MOVING) ? { g: new Set(this._brawlAlive().map((p) => this._bKey(p))).size, p: this._brawlAlive().length, lk: r2(this._prep()), tm: [...new Set([...this.brawl.ids].map((id) => this.players.get(id)?.team))].filter(Boolean).sort((a, b) => a - b).map((t) => { const m = [...this.brawl.ids].map((id) => this.players.get(id)).filter((p) => p && p.team === t); return [t, m.filter((p) => p.connected && !p.ghost).length, m.length]; }) } : null,
      cal: this.cal && (this.phase === PHASE.READING || this.phase === PHASE.MOVING) ? { l: this.cal.l, rv: this.cal.rv, r: this.cal.round, a: this._calAlive().length, f: this.cal.found.size, s: this.cal.safe } : null,
      ca: this.noAtk ? 1 : 0, cu: this.noUlt ? 1 : 0, gd: this.god ? 1 : 0,
      rank: this.showRank, ha: this.hideAns ? 1 : 0, qr: this.showQr ? 1 : 0, sm: this.screenMode, x2: this.multiplier, tp: this.timerPaused ? 1 : 0, fz: this.frozen ? 1 : 0, nt: this.notice && this.t < this.notice.until ? this.notice.text : null, ud: this.scoreLog.length,
      dist: this.phase === PHASE.MOVING || this.phase === PHASE.HOLD ? this._liveDist() : null,
      teams: this._teamTotals(),
      real: this.phase === PHASE.REAL ? { pending: [...this.realPending].map(([id, pts]) => ({ id, pts })), confirmed: this.realConfirmed } : null,
      pj: [...this.projectiles.values()].map((q) => q.kind === 'lob'
        ? { id: q.id, k: 'l', a: q.art, x: r2(q.x), y: r2(q.y), sx: r2(q.sx), sy: r2(q.sy), tx: r2(q.tx), ty: r2(q.ty), u: r2((this.t - q.t0) / q.T), T: r2(q.T), r: q.r }
        : { id: q.id, k: 'b', a: q.art, x: r2(q.x), y: r2(q.y), vx: r2(q.vx), vy: r2(q.vy) }),
      uz: zonesSnapshot(this),
      mn: minionsSnapshot(this),
      wl: wallsSnapshot(this),
      items: [...this.items.values()].map((i) => ({ id: i.id, k: i.k, x: r2(i.x), y: r2(i.y) })),
      coins: [...this.coins.values()].map((c) => ({ id: c.id, x: r2(c.x), y: r2(c.y), lk: r2(Math.max(0, c.lockUntil - this.t)) })),
      players,
      ev: events,
    };
  }

  totalScore(p) {
    return Math.round((p.score + p.coins * COIN.value) * 10) / 10;
  }

  leaderboard() {
    return this.contestants().filter((p) => this._present(p)).map((p) => ({ id: p.id, name: p.name, score: this.totalScore(p), coins: p.coins, team: p.team || 0, rep: p.rep ? 1 : 0 })).sort((a, b) => b.score - a.score);
  }

  /** 지금 구역별 인원 (진행자 화면의 실시간 응답) */
  _liveDist() {
    const d = {}; const q = this.question; if (!q) return d;
    for (const p of this.contestants()) { if (!p.connected) continue; const z = zoneAt(q.type, p.x, p.y); d[z ?? '-'] = (d[z ?? '-'] || 0) + 1; }
    return d;
  }

  _teamTotals() {
    if (!this.teamCount) return [];
    const tot = {}; for (const p of this.contestants()) if (this._present(p) && p.team) tot[p.team] = Math.round(((tot[p.team] || 0) + this.totalScore(p)) * 10) / 10;
    return Array.from({ length: this.teamCount }, (_, i) => ({ t: i + 1, score: tot[i + 1] || 0 }));
  }

  hostInfo() {
    return {
      questions: this.questions.map((q) => ({ id: q.id, type: q.type, text: q.text, options: q.options, answer: q.answer, time: q.time, mode: q.mode || '개인', image: q.image, pts: q.pts, bad: q.bad, days: q.days, start: q.start, tour: q.tour ? 1 : 0 })),
      teamCount: this.teamCount, asked: [...this.asked], log: this.log, history: this.history.slice(-100), rounds: this.rounds,
    };
  }
}
