// 빔프로젝터용 큰 맵을 그리는 Phaser 장면. 서버 상태를 받아서 그리기만 한다.
import Phaser from 'phaser';
import { MAP, PHASE, SPRITE, ZONES } from '../shared/constants.js';
import { CoinLayer } from './coins.js';
import { ItemLayer } from './items.js';
import { sfxEvent } from './sfx.js';
import { THEME } from '../shared/theme.js';
import BOUNDS from '../shared/spriteBounds.json';
import { FXD } from './pixel.js';
import { MinionLayer } from './minions.js';
import { burstFx, chainFx, dmgText, hitFx, pixText, meleeFx, muzzleFx } from './fx.js';
import { tetherLines, auraOff, auraTick, beamFx, blink, burnTick, dashFx, fireRing, heartTick, meteorFall, orbitTick, orcDust, quake, shockRing, snipeAim, speedLines, spinFx, tongues, bhBlast, bhHole, bhThrow, stageFx, auraPulse, groundSlam, phoenixBlast, phoenixTick, rangeDisc, UltZoneLayer, WallLayer, warn as warnFx } from './ultFx.js';
import { ProjectileLayer } from './projectiles.js';
import sprites from '../shared/sprites.json';
import { BRAWL_MAP, OBSTACLES } from '../shared/brawlMap.js';
import { buildFloor, buildQuizFloor, buildBrawlFloor, buildObstacleTextures, MAT_MARGIN, matTexture, OBJ_PAD, objectTexture, TILE } from './mapArt.js';
import { mapObjects } from '../shared/mapObjects.js';

export const BU = 48; // 몸 폭 1칸의 화면 픽셀 수
export const WORLD_W = MAP.w * BU;
export const WORLD_H = MAP.h * BU;

export const hooks = { spriteUrl: (s, m) => `characters/${s}/${m}.png`, fxUrl: (n) => `fx/${n}.png` }; // 데모 페이지가 이미지 경로를 바꿔 끼울 수 있게
const SPRITES = ['blue', ...Object.keys(sprites)]; // 스프라이트 폴더 이름 (public/characters/<name>/)
const SPR_SCALE = 0.34; // 256px 셀 → 화면. 몸 폭이 약 1.1BU가 되도록
const FLASH_MS = 100; // 맞았을 때 하얗게 번쩍이는 시간


export class WorldScene extends Phaser.Scene {
  constructor() {
    super('world');
    this.views = new Map();
    this.pending = null;
    this.zoneKey = '';
  }

  preload() {
    this.load.image('diva-stage', hooks.fxUrl('diva_stage')); // 크림슨 디바 무대 장비
    this.load.spritesheet('diva-intro', hooks.fxUrl('diva_intro'), { frameWidth: 96, frameHeight: 131 });
    this.load.spritesheet('diva-spot', hooks.fxUrl('diva_spot'), { frameWidth: 48, frameHeight: 43 });
    this.load.spritesheet('diva-amp', hooks.fxUrl('diva_amp'), { frameWidth: 52, frameHeight: 59 });
    this.load.spritesheet('dust', hooks.fxUrl('puff'), { frameWidth: 40, frameHeight: 28 }); // 걷거나 달릴 때 뒤로 남는 먼지
    for (const s of SPRITES) {
      for (const m of [...Object.keys(SPRITE.motions), ...(sprites[s]?.die ? ['die'] : []), ...(sprites[s]?.ult ? ['ult'] : []), ...(sprites[s]?.morph ? ['morph'] : [])]) {
        this.load.spritesheet(`${s}-${m}`, hooks.spriteUrl(s, m), { frameWidth: SPRITE.cell, frameHeight: SPRITE.cell });
      }
    }
  }

  create() {
    // 바닥: 도트 1개 = 화면 2px (캐릭터와 같은 도트 크기)
    buildFloor(this);
    buildQuizFloor(this);
    this.add.image(0, 0, 'floor').setOrigin(0).setScale(BU / TILE).setDepth(-100);
    this.quizFloor = this.add.image(0, 0, 'floor-quiz').setOrigin(0).setScale(BU / TILE).setDepth(-99).setVisible(false); // 문제가 시작되면 잔디 위를 덮음
    this.brawlObjs = null; // 대난투 맵(바닥+장애물)은 처음 대난투가 시작될 때 만든다
    this.decor = [];

    for (const o of mapObjects()) { // 맵 장식물: 아래쪽 기준으로 캐릭터와 앞뒤가 맞게 겹침 (꽃·버섯은 바닥에 깔림)
      const low = o.kind === 'flower';
      this.decor.push(this.add.image(o.x * BU, o.y * BU + OBJ_PAD * (BU / TILE), objectTexture(this, o.kind, o.v)).setOrigin(0.5, 1).setScale(BU / TILE).setDepth(low ? -90 : o.y * BU));
    }
    this.zoneGfx = this.add.graphics().setDepth(-80);
    this.teleGfx = this.add.graphics().setDepth(-45); // 예고 범위 (타격 전 붉은 부채꼴)
    this.aimGfx = this.add.graphics().setDepth(-50); // 사거리 링 · 조준선 · 조준 대상 링 (캐릭터 아래, 바닥 위)
    this.aim = null;
    this.lockId = null;
    this.anims.create({ key: 'diva-spot', frames: this.anims.generateFrameNumbers('diva-spot', { start: 0, end: 7 }), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'diva-amp', frames: this.anims.generateFrameNumbers('diva-amp', { start: 0, end: 3 }), frameRate: 12, repeat: -1 });
    this.anims.create({ key: 'dust', frames: this.anims.generateFrameNumbers('dust', { start: 0, end: 4 }), frameRate: 12, repeat: 0 });
    this.coins = new CoinLayer(this, BU);
    this.coins.create();
    this.wallLayer = new WallLayer(this, BU);
    this.uzl = new UltZoneLayer(this, BU); // 궁극기 바닥 범위(불바다·화살비) 도트
    this.items = new ItemLayer(this, BU);
    this.items.create();
    this.minions = new MinionLayer(this, BU, SPR_SCALE);
    this.proj = new ProjectileLayer(this, BU);
    this.proj.create();
    this.zoneImgs = [];

    for (const s of SPRITES) {
      const n = sprites[s]?.idle ? sprites[s] : null; // 없으면 blue(constants의 프레임 수)
      if (sprites[s]?.ult) this.anims.create({ key: `${s}-ult`, frames: this.anims.generateFrameNumbers(`${s}-ult`, { start: 0, end: sprites[s].ult - 1 }), frameRate: s === 'shiba' ? 9 : s === 'diva' ? 8 : 16, repeat: -1 }); // 채널링 궁극기 모션
      if (sprites[s]?.morph) this.anims.create({ key: `${s}-morph`, frames: this.anims.generateFrameNumbers(`${s}-morph`, { start: 0, end: sprites[s].morph - 1 }), frameRate: 12, repeat: 0 }); // 병아리 → 불꽃 → 피닉스 변신
      if (sprites[s]?.die) this.anims.create({ key: `${s}-die`, frames: this.anims.generateFrameNumbers(`${s}-die`, { start: 0, end: sprites[s].die - 1 }), frameRate: 9, repeat: 0 });
      SPRITE.attackSteps.forEach((st, i) => {
        // 새 스프라이트의 공격은 한 동작(0번은 준비 자세)이라 단계마다 1~끝을 그 시간에 맞춰 재생
        const frames = n ? Array.from({ length: n.combo - 1 }, (_, k) => k + 1) : st.frames;
        const fps = n ? (frames.length * 1000) / st.ms : st.fps;
        this.anims.create({ key: `${s}-atk${i}`, frames: this.anims.generateFrameNumbers(`${s}-combo`, { frames }), frameRate: fps, repeat: 0 });
      });
      for (const [m, c] of Object.entries(SPRITE.motions)) {
        if (!c.fps) continue; // combo는 위에서 단계별로 만들었음
        this.anims.create({
          key: `${s}-${m}`,
          frames: this.anims.generateFrameNumbers(`${s}-${m}`, { start: 0, end: (n ? n[m] : c.frames) - 1 }),
          frameRate: c.fps,
          repeat: c.loop ? -1 : 0,
          yoyo: !!c.yoyo,
        });
      }
    }
    if (this.pending) this.applyState(this.pending);
  }

  // ---------- 조준 표시 ----------
  /** info: { id, dx, dy, manual, dragging, range, kind, radius, targetId } (null이면 숨김) */
  setAim(info) { this.aim = info; }
  setUltAim(a) { this.ultAim = a; }

  _glowOn(v) {
    if (v.glow || this.sys.game.renderer.type !== Phaser.WEBGL) return; // 글로우는 WebGL에서만
    v.sprite.preFX.setPadding(24);
    v.glow = v.sprite.preFX.addGlow(0xffffff, 0, 0, false, 0.12, 14);
  }

  /** 매혹에 걸린 동안 분홍빛으로 맥박치며 빛남 (조준 표시의 흰 빛과는 따로) */
  _charmGlow(v, on) {
    if (on && !v.cglow && this.sys.game.renderer.type === Phaser.WEBGL) {
      v.sprite.preFX.setPadding(24); // 빛이 번질 여백 (없으면 안 그려짐)
      v.cglow = v.sprite.preFX.addGlow(0xff6fb5, 6, 0, false, 0.12, 14);
      v.cpulse = this.tweens.add({ targets: v.cglow, outerStrength: { from: 3, to: 8 }, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    } else if (!on && v.cglow) { v.cpulse?.stop(); v.cpulse = null; v.sprite.preFX.remove(v.cglow); v.cglow = null; }
  }

  /** 강화된 다음 공격이 준비되면(공주·개구리) 몸에 노란 빛이 맥박침 */
  _readyGlow(v, on) {
    if (on && !v.rglow && this.sys.game.renderer.type === Phaser.WEBGL) {
      v.sprite.preFX.setPadding(24);
      v.rglow = v.sprite.preFX.addGlow(0xffe27a, 4, 0, false, 0.12, 14);
      v.rpulse = this.tweens.add({ targets: v.rglow, outerStrength: { from: 2, to: 6 }, duration: 320, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    } else if (!on && v.rglow) { v.rpulse?.stop(); v.rpulse = null; v.sprite.preFX.remove(v.rglow); v.rglow = null; }
  }

  _glowOff(v) {
    if (!v) return;
    this._charmGlow(v, false); this._readyGlow(v, false);
    v.pulse?.stop(); v.pulse = null;
    if (v.glow) { v.sprite.preFX.remove(v.glow); v.glow = null; }
  }

  // 조준 대상이 생기거나 바뀔 때: 이전 대상의 빛을 끄고, 새 대상에 잠금 연출(수축하는 링 + 강한 빛 → 은은한 맥박)
  _lockChange(oldId, newId) {
    this._glowOff(this.views.get(oldId));
    const v = this.views.get(newId);
    if (!v) return;
    this._glowOn(v);
    if (v.glow) {
      const glow = v.glow;
      this.tweens.add({ targets: glow, outerStrength: { from: 16, to: 4 }, duration: 260, ease: 'Cubic.easeOut',
        onComplete: () => { if (v.glow === glow) v.pulse = this.tweens.add({ targets: glow, outerStrength: { from: 2.5, to: 5 }, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }); } });
    }
    const ring = this.add.graphics().setDepth(FXD);
    this.tweens.addCounter({ from: 0, to: 1, duration: 300, ease: 'Cubic.easeOut', onUpdate: (tw) => {
      const k = tw.getValue();
      ring.clear().lineStyle(5 - 2 * k, 0xffffff, 1 - 0.5 * k).strokeCircle(v.x, v.y, (2.4 - 1.6 * k) * BU);
    }, onComplete: () => ring.destroy() });
  }

  // 달리면 발 뒤로 먼지, 걸으면 아주 연한 동그란 먼지
  _dust(v, p, now) {
    const dx = v.x - (v.lx ?? v.x); v.lx = v.x;
    const moving = !p.st && (p.a === 'walk' || p.a === 'run') && v.hopUntil <= now;
    if (!moving || now < (v.dustAt || 0)) return;
    const run = p.a === 'run';
    v.dustAt = now + (run ? 110 : 360);
    const back = Math.abs(dx) > 0.3 ? -Math.sign(dx) : -p.f; // 가는 방향의 반대쪽
    if (!run) { // 걸을 땐 아주 연한 동그란 먼지만 (달리기·대시에서만 기존 먼지)
      const c = this.add.circle(v.x + back * 0.3 * BU, v.y - 4, 6, 0xffffff, 0.22).setDepth(v.y - 1);
      this.tweens.add({ targets: c, scale: 1.8, alpha: 0, duration: 420, onComplete: () => c.destroy() });
      return;
    }
    const d = this.add.sprite(v.x + back * 0.42 * BU, v.y - 2, 'dust').setOrigin(0.5, 1).setScale((run ? 1.5 : 1) * (p.zs || 1) * 1.1).setFlipX(back < 0).setAlpha(0.9).setDepth(v.y - 1);
    d.play('dust');
    d.once('animationcomplete', () => d.destroy());
  }

  _drawTelegraph(now) {
    const g = this.teleGfx;
    g.clear();
    for (const v of this.views.values()) {
      const w = v.windup;
      if (!w) continue;
      if (now >= w.until || v.p.st) { v.windup = null; continue; }
      const u = (now - w.from) / (w.until - w.from), R = w.range * BU, ang = Math.atan2(w.dy, w.dx), half = (w.arc * Math.PI) / 180;
      g.fillStyle(0xff3b30, 0.12 + 0.3 * u).slice(v.x, v.y, R, ang - half, ang + half, false).fillPath(); // 시간이 갈수록 진해짐
      g.fillStyle(0xff3b30, 0.35).slice(v.x, v.y, R * u, ang - half, ang + half, false).fillPath(); // 안쪽부터 차오름
    }
  }

  _drawAim(now) {
    const g = this.aimGfx;
    g.clear();
    const cg = this.cmpGfx || (this.cmpGfx = this.add.graphics().setDepth(FXD)); cg.clear();
    const mv = this.views.get(this.focusId), lv = this.leaderId && this.leaderId !== this.focusId ? this.views.get(this.leaderId) : null;
    if (mv && lv) { // 나침반: 1등 쪽을 가리키는 화살표, 가까워질수록 투명 (5칸 이내 0%, 10칸 이상 100%)
      const dx = lv.x - mv.x, dy = lv.y - mv.y, d = Math.hypot(dx, dy) / BU, a = Math.max(0, Math.min(1, (d - 5) / 5));
      if (a > 0.02) {
        const ux = dx / (d * BU), uy = dy / (d * BU), cx = mv.x + ux * 1.7 * BU, cy = mv.y - 0.4 * BU + uy * 1.7 * BU * 0.8, nx = -uy, ny = ux, S = 11;
        const tri = (k, col, al) => cg.fillStyle(col, al * a).fillTriangle(cx + ux * S * k, cy + uy * S * k, cx - ux * S * k * 0.6 + nx * S * k * 0.8, cy - uy * S * k * 0.6 + ny * S * k * 0.8, cx - ux * S * k * 0.6 - nx * S * k * 0.8, cy - uy * S * k * 0.6 - ny * S * k * 0.8);
        tri(1.35, 0x14122b, 1); tri(1, 0xffd54a, 1);
      }
    }
    const ua = this.ultAim, uv = ua && this.views.get(ua.id);
    if (uv) { // 궁극기 직접 조준: 방향으로 뻗는 점선과 끝 원
      const ex = uv.x + ua.dx * ua.len * BU, ey = uv.y + ua.dy * ua.len * BU;
      for (let i = 1; i <= 12; i++) g.fillStyle(0xffd54a, 0.7).fillRect(Math.round((uv.x + (ex - uv.x) * i / 12) / 2) * 2 - 3, Math.round((uv.y + (ey - uv.y) * i / 12) / 2) * 2 - 3, 6, 6);
      g.fillStyle(0xffd54a, 0.3).fillCircle(ex, ey, 0.5 * BU);
    }
    const a = this.aim;
    const me = a && this.views.get(a.id);
    const tid = me && this.views.has(a.targetId) ? a.targetId : null;
    if (tid !== this.lockId) { this._lockChange(this.lockId, tid); this.lockId = tid; }
    if (!me) return;

    const cx = me.x, cy = me.y, R = a.range * BU, ang = Math.atan2(a.dy, a.dx);
    // 공격 범위는 항상 또렷하게 (직접 조준 중엔 더 진하게)
    const k = a.dragging ? 1 : 0.7;
    if (!a.lob) { // 근접은 부채꼴(맞는 범위), 원거리는 사거리만큼 뻗는 빔
      if (a.kind === 'melee' && a.line) { // 직선 주먹
        const w = (a.line * BU) / 2, nx = -Math.sin(ang) * w, ny = Math.cos(ang) * w, ex = cx + Math.cos(ang) * R, ey = cy + Math.sin(ang) * R;
        g.fillStyle(0xffffff, 0.34 * k).fillPoints([{ x: cx + nx, y: cy + ny }, { x: ex + nx, y: ey + ny }, { x: ex - nx, y: ey - ny }, { x: cx - nx, y: cy - ny }], true);
      } else if (a.kind === 'melee') {
        const half = ((a.arc ?? 60) * Math.PI) / 180;
        g.fillStyle(0xffffff, 0.34 * k).slice(cx, cy, R, ang - half, ang + half, false).fillPath();
      } else {
        const w = a.radius * BU, nx = -Math.sin(ang) * w, ny = Math.cos(ang) * w;
        const ex = cx + Math.cos(ang) * R, ey = cy + Math.sin(ang) * R;
        g.fillStyle(0xffffff, 0.34 * k).fillPoints([{ x: cx + nx, y: cy + ny }, { x: ex + nx, y: ey + ny }, { x: ex - nx, y: ey - ny }, { x: cx - nx, y: cy - ny }], true);
      }
    }
    if (a.lob) { // 던지기: 착탄 지점과 폭발 범위
      const lx = a.lob.x * BU, ly = a.lob.y * BU;
      g.lineStyle(3, 0xffffff, 0.5 * k).lineBetween(cx, cy, lx, ly);
      g.fillStyle(0xff7a1a, 0.4 * k).fillCircle(lx, ly, a.lob.r * BU);
      g.lineStyle(3, 0xffffff, 0.9).lineBetween(lx - 8, ly, lx + 8, ly).lineBetween(lx, ly - 8, lx, ly + 8);
    }
    // 조준 중인 적: 발밑 링 (빛나는 테두리는 _lockChange가 스프라이트에 입힘)
    const t = tid && this.views.get(tid);
    if (t) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 160);
      g.lineStyle(4, 0xffffff, 0.55 + 0.4 * pulse).strokeCircle(t.x, t.y, (0.78 + 0.05 * pulse) * BU);
    }
  }

  // ---------- 서버 상태 반영 ----------
  applyState(s) {
    if (!this.zoneGfx) { this.pending = s; return; }
    this.drawZones(s);
    this.uzl.apply(s.uz);
    this.wallLayer.apply(s.wl);

    let best = null; for (const p of s.players) if (p.sc > 0 && (!best || p.sc > best.sc)) best = p; // 1등(점수 있는 사람 중 최고)
    this.leaderId = best ? best.id : null;
    const seen = new Set();
    for (const p of s.players) {
      seen.add(p.id);
      let v = this.views.get(p.id);
      if (!v) v = this.makeView(p);
      v.p = p;
      const nx = p.x * BU, ny = p.y * BU, at = performance.now(), dt = v.stAt ? (at - v.stAt) / 1000 : 0;
      if (v.tx !== undefined && Math.hypot(nx - v.tx, ny - v.ty) > 8 * BU) { v.x = nx; v.y = ny; } // 한꺼번에 멀리 옮겨졌으면(모이기·맵 전환) 미끄러지지 말고 바로 이동
      if (dt > 0.01 && dt < 0.4 && Math.hypot(nx - v.tx, ny - v.ty) < 3 * BU) { // 서버 간격이 들쭉날쭉해도 가던 방향으로 계속 움직여 보이게 속도를 어림 (순간이동 수준 점프는 제외)
        const cap = 12 * BU, mx = (nx - v.tx) / dt, my = (ny - v.ty) / dt, sp = Math.hypot(mx, my), c = sp > cap ? cap / sp : 1;
        v.vx = (v.vx || 0) * 0.4 + mx * c * 0.6; v.vy = (v.vy || 0) * 0.4 + my * c * 0.6;
      } else { v.vx = 0; v.vy = 0; }
      v.tx = nx; v.ty = ny; v.stAt = at;
      if (v.x === undefined) { v.x = v.tx; v.y = v.ty; }
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) { this._glowOff(v); v.root.forEach((o) => o.destroy()); this.views.delete(id); }
    }
    for (const e of s.ev || []) this.handleEvent(e);
    this.coins.apply(s);
    this.items.apply(s);
    this.proj.apply(s);
    this.minions.apply(s);
  }

  makeView(p) {
    const sprite = this.add.sprite(0, 0, `${p.s}-idle`).setOrigin(SPRITE.anchor[0] / SPRITE.cell, SPRITE.anchor[1] / SPRITE.cell).setScale(SPR_SCALE * (p.zs || 1));
    const tint = p.tn ? parseInt(p.tn.slice(1), 16) : 0; // 임시 모습: 스프라이트가 오면 tint를 지운다
    if (tint) sprite.setTint(tint);
    sprite.play(`${p.s}-idle`);
    const name = this.add.text(0, 0, (p.b ? '🤖 ' : '') + p.n, { fontFamily: 'sans-serif', fontSize: '22px', color: '#1f2d3a', fontStyle: '900', stroke: '#ffffff', strokeThickness: 5 }).setOrigin(0.5, 1).setShadow(1, 0, '#1f2d3a', 0, false, true); // 이름: 굵게 22px, 옆으로 1px 겹쳐 더 두껍게
    const bar = this.add.graphics();
    const shoe = this.add.image(0, 0, 'item-shoe').setScale(1.5).setVisible(false);
    const status = this.add.text(0, 0, '', { fontFamily: 'sans-serif', fontSize: '18px', color: '#c0392b', fontStyle: 'bold', stroke: '#ffffff', strokeThickness: 4 }).setOrigin(0.5, 1);
    const coinIcon = this.add.image(0, 0, 'coin-f0').setScale(1.5).setVisible(false);
    const coinTxt = this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '17px', fontStyle: 'bold', color: '#ffe27a', stroke: '#14122b', strokeThickness: 4 }).setOrigin(0, 0.5).setVisible(false);
    const v = { sprite, name, bar, shoe, status, coinIcon, coinTxt, root: [sprite, name, bar, shoe, status, coinIcon, coinTxt], flashUntil: 0, punchUntil: 0, flashing: false, pending: 0, bump: 0, shown: 0, tint, hopUntil: 0, p };
    this.views.set(p.id, v);
    return v;
  }

  handleEvent(e) {
    { const sv = e.id ? this.views.get(e.id) : null, fv = this.views.get(this.focusId); // 효과음: 나와 가까울수록 크게 (좌표는 칸 단위)
      sfxEvent(e, { mine: (e.by ?? e.id) === this.focusId, screen: this.screen, x: e.x ?? (sv ? sv.x / BU : null), y: e.y ?? (sv ? sv.y / BU : null), fx: fv ? fv.x / BU : null, fy: fv ? fv.y / BU : null, charId: sv?.p?.c }); }
    const now = performance.now();
    const v = this.views.get(e.id);
    if (e.e === 'ult' && v) {
      if (['channel', 'charm', 'magnet', 'tether', 'stage', 'brood', 'rally'].includes(e.t)) auraPulse(this, { ...e, r: e.r || 2.25 }, BU, e.t === 'charm' ? [0xffe6f2, 0xffb3d9, 0xff7ab8, 0xc94c8a] : undefined);
      if (e.t === 'rush') speedLines(this, e, BU);
      else if (e.t === 'buff' || e.t === 'barrage') shockRing(this, { x: e.x, y: e.y, r: e.t === 'buff' ? 1.6 : 1.2 }, BU);
    } else if (e.e === 'wallBlast') {
      shockRing(this, e, BU); rangeDisc(this, e.x, e.y, e.r, BU);
    } else if (e.e === 'chain') {
      chainFx(this, e, BU);
    } else if (e.e === 'stageOpen') {
      stageFx(this, e, BU);
    } else if (e.e === 'eggDrop') {
      this.minions.drop(e);
    } else if (e.e === 'hatch') {
      this.minions.hatch(e);
    } else if (e.e === 'bhThrow') {
      bhThrow(this, e, BU);
    } else if (e.e === 'bhOpen') {
      bhHole(this, e, BU);
    } else if (e.e === 'bhBlast') {
      bhBlast(this, e, BU);
    } else if (e.e === 'tetherStart') {
      shockRing(this, { x: e.x, y: e.y, r: 2 }, BU, 'pink');
    } else if (e.e === 'charm') {
      shockRing(this, { x: e.x, y: e.y, r: e.r }, BU, 'pink');
    } else if (e.e === 'snipeAim') {
      snipeAim(this, e, BU);
    } else if (e.e === 'beam') {
      beamFx(this, e, BU);
    } else if (e.e === 'pull') {
      tongues(this, e, BU);
    } else if (e.e === 'blink') {
      blink(this, e, BU);
    } else if (e.e === 'magnet') {
      shockRing(this, { x: e.x, y: e.y, r: e.r || 3 }, BU);
    } else if (e.e === 'wallHit') {
      hitFx(this, { x: e.x, y: e.y, fx: 'stone' }, BU);
    } else if (e.e === 'burst') {
      if (e.r) rangeDisc(this, e.x, e.y, e.r, BU);
      if (e.fx === 'phoenix') phoenixBlast(this, e, BU); else if (e.fx === 'stomp') { const hv = this.views.get(e.id); if (hv) hv.slamAt = now; this.time.delayedCall(200, () => { quake(this, e, BU); groundSlam(this, e, BU); }); } else if (e.fx === 'shock') shockRing(this, e, BU); else if (e.fx === 'flurry') spinFx(this, e, BU); else if (e.fx === 'crescent') fireRing(this, e, BU); else burstFx(this, e, BU);
    } else if (e.e === 'warn') {
      warnFx(this, e, BU);
      meteorFall(this, e, BU);
    } else if (e.e === 'windup' && v) {
      v.windup = { from: now, until: now + e.sec * 1000, dx: e.dx, dy: e.dy, range: e.range, arc: e.arc };
    } else if (e.e === 'atk' && v) {
      const step = Math.min(e.step || 0, SPRITE.attackSteps.length - 1);
      const sp = e.fast ? 2.2 : 1; // 연타(3연타)는 빠르게 재생
      v.sprite.play(`${v.p.s}-atk${step}`, false); v.sprite.anims.timeScale = sp;
      v.punchUntil = now + SPRITE.attackSteps[step].ms / sp;
      if (e.kind === 'proj') { muzzleFx(this, e, v, BU); return; } // 투사체 공격은 날아가는 모습이 효과
      if (e.kind === 'ranged') { // 개구리 혀: 굵은 분홍 직선 + 끝 동그라미
        const x0 = v.x, y0 = v.y - 0.55 * BU, len = e.len * BU;
        const line = this.add.graphics().setDepth(FXD);
        line.lineStyle(9, 0xff6f91, 1).lineBetween(x0, y0, x0 + e.dx * len, y0 + e.dy * len);
        line.fillStyle(0xff6f91, 1).fillCircle(x0 + e.dx * len, y0 + e.dy * len, 10);
        this.tweens.add({ targets: line, alpha: 0, duration: 140, onComplete: () => line.destroy() });
      } else { meleeFx(this, e, v, BU); if (e.fx === 'smash') { orcDust(this, e, v, BU, v.p.id === this.focusId); groundSlam(this, { x: v.p.x + e.dx * e.range * 0.55, y: v.p.y + e.dy * e.range * 0.55, r: e.range * 0.6 }, BU); } }
    } else if (e.e === 'hit' && v) {
      v.flashUntil = now + FLASH_MS; // 0.1초 하얗게 번쩍
      const crit = !!e.crit;
      if (!this.focusId || e.by === this.focusId) { // 데미지 숫자는 내가 입힌 것만 (빔프로젝터처럼 '나'가 없는 화면에서는 전부)
        const t = dmgText(this, e.x * BU, e.y * BU - 2.9 * BU, e.dmg > 0 ? `${crit ? '' : '-'}${e.dmg}${crit ? '!' : ''}` : '…', crit);
        this.tweens.add({ targets: t, y: t.y - 36, alpha: 0, duration: 300, onComplete: () => t.destroy() });
      }
      // 화면 흔들림은 크리티컬이 터졌을 때만, 그리고 내가 때리거나 맞은 것만 (봇끼리의 크리티컬마다 흔들리면 정신없어서)
      if (crit && this.focusId && (e.id === this.focusId || e.by === this.focusId)) this.cameras.main.shake(130, 0.006);
      hitFx(this, e, BU);
      const ring = this.add.circle(e.x * BU, e.y * BU - 0.6 * BU, 8, 0xffffff, 0.9).setDepth(FXD);
      this.tweens.add({ targets: ring, scale: 3.2, alpha: 0, duration: 220, onComplete: () => ring.destroy() });
    } else if (e.e === 'dash' && v) {
      if (e.kind === 'hop') v.hopUntil = now + 350;
      dashFx(this, e, v, BU); // 캐릭터마다 다른 대쉬 이펙트
    } else if (e.e === 'block') {
      const t = this.add.text(e.x * BU, e.y * BU - 1.9 * BU, '무적', { fontFamily: 'sans-serif', fontSize: '20px', color: '#2e86de', fontStyle: 'bold', stroke: '#ffffff', strokeThickness: 4 }).setOrigin(0.5).setDepth(6000);
      this.tweens.add({ targets: t, y: t.y - 26, alpha: 0, duration: 500, onComplete: () => t.destroy() });
    }
  }

  // ---------- 구역 ----------
  /** 달력 퀴즈 판: 날짜 칸. 채점으로 드러난 칸만 초록(탈락)/노랑(안전)으로 표시, 정산 때는 탈락 칸 전부 공개 */
  drawCalendar(s) {
    const l = s.cal?.l || s.reveal?.l; if (!l) return;
    const rv = s.cal?.rv || {}, bad = new Set(s.reveal?.cal ? s.reveal.bad : []), key = `cal|${s.phase}|${JSON.stringify(rv)}|${[...bad]}`;
    if (key === this.zoneKey) return; this.zoneKey = key;
    const g = this.zoneGfx.clear(); this.zoneImgs.forEach((i) => i.destroy()); this.zoneImgs = [];
    '일월화수목금토'.split('').forEach((ch, c) => this.zoneImgs.push(this.add.text((l.x0 + (c + 0.5) * l.w) * BU, (l.y0 - 0.42) * BU, ch, { fontFamily: 'sans-serif', fontSize: `${Math.round(BU * 0.5)}px`, color: c === 0 ? '#ff9a90' : c === 6 ? '#8ab4ff' : '#e8ebff', fontStyle: '900', stroke: '#0d0f2a', strokeThickness: 4 }).setOrigin(0.5).setDepth(-79))); // 요일 줄
    const empty = l.rows * 7 - (l.start + l.days); // 마지막 줄에 남는 빈 칸이 2칸 이상이면 거기에 월을 크게 표시
    if (l.month && empty >= 2) this.zoneImgs.push(this.add.text((l.x0 + (7 - empty / 2) * l.w) * BU, (l.y0 + (l.rows - 0.5) * l.h) * BU, `${l.month}월`, { fontFamily: 'sans-serif', fontSize: `${Math.round(BU * 1.7)}px`, color: '#ffffff', fontStyle: '900', stroke: '#0d0f2a', strokeThickness: 8 }).setOrigin(0.5).setAlpha(0.55).setDepth(-79));
    for (let d = 1; d <= l.days; d++) {
      const i = d - 1 + l.start, x = (l.x0 + (i % 7) * l.w) * BU + 3, y = (l.y0 + Math.floor(i / 7) * l.h) * BU + 3, cw = l.w * BU - 6, ch = l.h * BU - 6, st = bad.has(d) || rv[d] === 2 ? 2 : rv[d] === 1 ? 1 : 0;
      g.fillStyle(st === 2 ? 0x6a9a2a : st === 1 ? 0xffe27a : 0x0d0f2a, st === 2 ? 0.8 : st === 1 ? 0.3 : 0.5).fillRect(x, y, cw, ch);
      g.lineStyle(3, st === 2 ? 0xb6e36a : st === 1 ? 0xffd54a : 0x6c73c4, 1).strokeRect(x, y, cw, ch);
      this.zoneImgs.push(this.add.text(x + 8, y + 4, String(d), { fontFamily: 'sans-serif', fontSize: `${Math.round(BU * 0.5)}px`, color: st === 2 ? '#eaffc8' : '#dfe3ff', fontStyle: '900', stroke: '#0d0f2a', strokeThickness: 4 }).setDepth(-79));
      if (st) this.zoneImgs.push(this.add.text(x + cw - 8, y + ch - 4, st === 2 ? '✕' : '✓', { fontFamily: 'sans-serif', fontSize: `${Math.round(BU * 0.7)}px`, color: st === 2 ? '#eaffc8' : '#ffe27a', fontStyle: '900', stroke: '#0d0f2a', strokeThickness: 4 }).setOrigin(1, 1).setDepth(-79));
    }
  }

  /** 대난투 맵 켜기/끄기: 강이 흐르는 80×44칸 바닥과 장애물. 빔프로젝터는 카메라를 절반으로 줌아웃해 맵 전체를 보여 줌 */
  _showBrawl(on) {
    if (on && !this.brawlObjs) {
      buildBrawlFloor(this); buildObstacleTextures(this);
      const floor = this.add.image(0, 0, 'floor-brawl').setOrigin(0).setScale(BU / TILE).setDepth(-98);
      const obs = OBSTACLES.map((o) => { const k = 'ob-' + o.k, img = this.add.image(o.x * BU, (o.y + o.hh) * BU - 2, k).setOrigin(0.5, k === 'ob-pillar' ? 0.9 : k === 'ob-wall' ? 0.82 : 0.9).setScale(BU / TILE).setDepth((o.y + o.hh) * BU); return img; });
      this.brawlObjs = [floor, ...obs];
    }
    if (!this.brawlObjs || this._brawlOn === on) return;
    this._brawlOn = on; this.brawlObjs.forEach((o) => o.setVisible(on));
    if (this.screen) { const cam = this.cameras.main; if (on) { cam.setZoom(0.5); cam.centerOn(BRAWL_MAP.w * BU / 2, BRAWL_MAP.h * BU / 2); } else { cam.setZoom(1); cam.setScroll(0, 0); } }
  }

  drawZones(s) {
    const quiz = s.phase !== PHASE.LOBBY; // 대기실은 잔디 들판, 문제 중에는 남색 퀴즈 무대
    if (quiz && s.q?.type === 'calendar') { this._showBrawl(false); this.quizFloor.setVisible(true); this._decorOn = false; this.decor.forEach((o) => o.setVisible(false)); this.drawCalendar(s); return; }
    const brawl = quiz && s.q?.type === 'brawl' && !!s.mp;
    this._showBrawl(brawl);
    if (this.quizFloor.visible !== (quiz && !brawl)) this.quizFloor.setVisible(quiz && !brawl);
    if (this._decorOn !== !quiz) { this._decorOn = !quiz; this.decor.forEach((o) => o.setVisible(!quiz)); } // 문제 중(대난투 포함)엔 대기실 장식(나무·꽃)을 숨김
    const type = s.q?.type || 'ox';
    const ans = s.reveal?.answer;
    const key = `${s.phase}|${type}|${ans ?? ''}`;
    if (key === this.zoneKey) return;
    this.zoneKey = key;
    this.zoneGfx.clear();
    this.zoneImgs.forEach((i) => i.destroy());
    this.zoneImgs = [];

    for (const z of ZONES[type] || []) {
      const correct = s.phase === PHASE.REVEAL && z.id === ans;
      const alpha = { [PHASE.LOBBY]: 0.35, [PHASE.READING]: 0.6, [PHASE.MOVING]: 0.85 }[s.phase] ?? (correct ? 1 : 0.2);
      this.zoneImgs.push(this.add.image((z.cx - z.r) * BU - MAT_MARGIN * (BU / TILE), (z.cy - z.r) * BU - MAT_MARGIN * (BU / TILE), matTexture(this, type, z)).setOrigin(0).setScale(BU / TILE).setDepth(-80).setAlpha(alpha));
      if (correct) this.zoneGfx.lineStyle(6, 0xffffff, 1).strokeCircle(z.cx * BU, z.cy * BU, z.r * BU - 3); // 정답 구역 강조
    }
  }

  // ---------- 매 프레임 ----------
  update(_time, delta) {
    const now = performance.now();
    this._drawTelegraph(now);
    this.uzl.update(now);
    this.minions.update(now, delta);
    tetherLines(this, now);
    this.wallLayer.update(now);
    const k = 1 - Math.exp(-delta / 50); // 지수 보간: 프레임 간격(60·120Hz)과 상관없이 같은 속도로 따라감 // 위치 보간 (끊김 완화)
    for (const v of this.views.values()) {
      const p = v.p;
      const ex = Math.min((now - (v.stAt || now)) / 1000, 0.2); // 마지막 서버 상태 이후 지난 시간 (최대 0.2초까지 앞질러 그림)
      v.x += (v.tx + (v.vx || 0) * ex - v.x) * k;
      v.y += (v.ty + (v.vy || 0) * ex - v.y) * k;
      const slamU = v.slamAt ? (now - v.slamAt) / 200 : 1; // 대지 강타: 30px 뛰었다 내려옴
      const hop0 = slamU < 1 ? Math.sin(Math.PI * slamU) * 30 : 0;
      const hop = v.hopUntil > now ? Math.sin(Math.PI * (1 - (v.hopUntil - now) / 350)) * 1.3 * BU : 0; // 도약: 포물선으로 뜸
      v.sprite.setPosition(v.x, v.y - hop - hop0).setDepth(v.y);
      this._dust(v, p, now);
      if (p.ub > 0 && !p.sl) auraTick(this, v, now, BU); else auraOff(v);
      if (p.bn) burnTick(this, v, now, BU);
      if (p.cm) heartTick(this, v, now, BU);
      this._charmGlow(v, !!p.cm); this._readyGlow(v, !!p.em && !p.st);
      orbitTick(this, v, now, BU);
      v.sprite.setFlipX(p.f < 0).setOrigin(p.f < 0 ? 1 - SPRITE.anchor[0] / SPRITE.cell : SPRITE.anchor[0] / SPRITE.cell, SPRITE.anchor[1] / SPRITE.cell); // 왼쪽을 볼 땐 기준점도 거울상으로 (체력바·이름이 몸 중앙에 맞게)
      const tint = p.si ? 0x8fa0c8 : p.tn ? parseInt(p.tn.slice(1), 16) : 0; // 침묵 중엔 회청색 // 캐릭터가 바뀌면 임시 색과 크기도 따라감
      if (!!p.gh !== !!v.gh) { v.gh = !!p.gh; v.tint = -1; if (p.gh) v.sprite.setTintFill(0x4d8dff); else v.sprite.clearTint(); } // 유령: 파란 실루엣 (끝나면 원래 색으로)
      if (!p.gh && tint !== v.tint) { v.tint = tint; if (tint) v.sprite.setTint(tint); else v.sprite.clearTint(); }
      v.zsCur = (v.zsCur ?? (p.zs || 1)) + ((p.zs || 1) - (v.zsCur ?? (p.zs || 1))) * Math.min(1, (delta / 1000) * 8); // 진화 등 크기 변화는 부드럽게
      const pop = v.popAt && now > v.popAt && now < v.popAt + 200 ? 1 + 0.35 * Math.sin(Math.PI * ((now - v.popAt) / 200)) : 1; // 오라에 맞으면 깜빡 → 팡
      v.sprite.setScale(SPR_SCALE * v.zsCur * pop);

      // 모션: 공격 중이면 유지, 아니면 이동 상태에 맞춰
      const dies = p.st && sprites[p.s]?.die; // 기절하면 죽음 모션을 한 번 재생하고 누운 채로 둠
      const chan = p.ch && sprites[p.s]?.ult; // 채널링 궁극기 중엔 전용 모션을 계속 재생
      if (dies) { if (!v.dead) { v.dead = true; v.sprite.play(`${p.s}-die`); } }
      else if (p.mo && sprites[p.s]?.morph) { v.dead = false; v.sprite.play(`${p.s}-morph`, true); }
      else if (chan) { v.dead = false; v.sprite.play(`${p.s}-ult`, true); }
      else { v.dead = false; if (now >= v.punchUntil) v.sprite.play(`${p.s}-${p.st ? 'idle' : p.a}`, true); }

      // 맞았을 때 0.1초 하얗게
      if (now < v.flashUntil) { v.sprite.setTintFill(0xffffff); v.flashing = true; }
      else if (v.flashing) { v.sprite.clearTint(); if (v.tint) v.sprite.setTint(v.tint); v.flashing = false; }

      // 기절: 쓰러진 모습 / 무적: 깜빡임
      v.sprite.setAngle(p.st && !dies ? 80 * p.f : 0);
      v.sprite.setAlpha(p.gh ? 0.3 : v.blinkUntil > now ? (Math.floor(now / 50) % 2 ? 0.2 : 1) : p.sl ? (p.id === this.focusId ? 0.35 : 0.12) : p.inv ? 0.45 + 0.35 * Math.sin(now / 70) : 1); // 은신 / 무적 깜빡임

      // 체력바 + 이름: 하트 + 칸 나뉜 바 (내 것은 크게, 남의 것은 작게)
      phoenixTick(this, v, p, BU, pixText);
      if (p.id === this.focusId) this._redTint = p.pr && !p.st ? p.pu : 0; // 내가 피닉스면 화면이 점점 붉어짐
      const me = p.id === this.focusId, sz = me ? 1 : 0.72;
      const half = this.screen ? 0.5 : 1; // 빔프로젝터 화면은 체력바를 절반 크기로
      const bw = 1.9 * BU * sz * (me ? 0.8 : 1) * half, bh = Math.max(4, Math.round(14 * sz * (me ? 0.7 : 1) * half)), bd = 2; // 내 바: 가로 20%·세로 30% 줄임
      // 머리 위 UI는 캐릭터의 실제 머리 꼭대기 위에 쌓는다 (내 게이지가 아래로 늘어나도 캐릭터를 가리지 않게 전체를 위로 올림)
      const headPx = (SPRITE.anchor[1] - (BOUNDS[p.s] ?? 20)) * SPR_SCALE * (v.zsCur ?? (p.zs || 1));
      const GH = 3.5, GG = 5, gauges = me ? (p.mam ? 1 : 0) + (p.mrg ? 1 : 0) : 0, below = gauges ? GG + gauges * GH + (gauges - 1) * GG + 2 : 0;
      const by = v.y - headPx - 10 - below - bh - bd;
      const bx0 = v.x - bw / 2; // 바 왼쪽 끝
      const bx = v.x;
      const f = Math.max(0, p.hp / p.mhp), low = f <= 0.3;
      v.bar.clear().setDepth(v.y + 1);
      v.bar.fillStyle(THEME.ink, 1).fillRect(bx0 - bd, by - bd, bw + bd * 2, bh + bd * 2); // 남색 테두리
      // 지연 칩: 체력은 바로 깎이고, 깎인 만큼 연한 조각이 0.25초 남았다가 0.3초에 걸쳐 줄어듦
      if (v.hpLast === undefined) { v.hpLast = f; v.chip = f; v.chipHold = 0; v.chipRate = 0; }
      if (f < v.hpLast) { v.chipHold = now + 250; v.chipRate = Math.max(0.05, v.chip - f) / 0.3; }
      if (f > v.chip) v.chip = f;
      if (now >= v.chipHold && v.chip > f) v.chip = Math.max(f, v.chip - (v.chipRate * delta) / 1000);
      v.hpLast = f;
      const hpCol = p.sd > 0 ? 0x4a86d9 : f > 0.6 ? 0x4fd16a : f > 0.3 ? 0xf2c230 : 0xe5483c; // 색 이동: 초록 → 노랑 → 빨강
      v.bar.fillStyle(THEME.hpEmpty, 1).fillRect(bx0, by, bw, bh);
      v.bar.fillStyle(0xfff1d6, 0.85).fillRect(bx0, by, bw * v.chip, bh);
      v.bar.fillStyle(hpCol, low ? 0.65 + 0.35 * Math.sin((now / 1000) * Math.PI * 6) : 1).fillRect(bx0, by, bw * f, bh); // 30% 아래는 초당 3번 깜빡임
      v.bar.fillStyle(THEME.hpShine, 0.55).fillRect(bx0, by, bw * f, Math.max(2, bh * 0.28)); // 윗면 하이라이트
      v.shoe.setVisible(p.sp > 0).setPosition(bx0 + bw + 14, by + bh / 2).setDepth(v.y + 2).setAlpha(p.sp < 1 ? 0.5 + 0.5 * Math.sin(now / 60) : 1); // 신발 효과 중
      if (me) { // 탄창 · 대쉬 게이지는 내 것만 (빔프로젝터엔 내 캐릭터가 없어서 안 나옴)
        const h = GH, bar2 = (x0, y0, w, f, col) => v.bar.fillStyle(THEME.ink, 1).fillRect(x0 - 1.5, y0 - 1.5, w + 3, h + 3).fillStyle(THEME.hpEmpty, 1).fillRect(x0, y0, w, h).fillStyle(col, 1).fillRect(x0, y0, w * f, h);
        let y0 = by + bh + GG;
        if (p.mam) { // 탄창: 가득 = 주황, 장전 중인 칸은 차오름
          const gap = 4, sw = (bw - gap * (p.mam - 1)) / p.mam;
          const pulse = 0.5 + 0.5 * Math.sin(now / 120); // 강화 평타가 준비되면(공주·개구리) 탄창 칸이 분홍색으로 맥박치며 빛남
          for (let i = 0; i < p.mam; i++) {
            const x0 = bx0 + i * (sw + gap);
            if (p.em) v.bar.fillStyle(0xff6fb5, 0.3 + 0.35 * pulse).fillRect(x0 - 4, y0 - 4, sw + 8, h + 8).fillStyle(0xff9ccd, 0.25 + 0.3 * pulse).fillRect(x0 - 2.5, y0 - 2.5, sw + 5, h + 5);
            bar2(x0, y0, sw, i < p.am ? 1 : i === p.am ? p.amf : 0, p.em ? (pulse > 0.5 ? 0xff6fb5 : 0xff8fc8) : THEME.ammo);
          }
          y0 += h + GG;
        }
        if (p.mrg) { bar2(bx0, y0, bw, Math.min(1, p.rg / p.mrg), p.rg >= p.mrg ? THEME.dashReady : THEME.dash); y0 += h + GG; } // 대쉬 쿨타임 / 달리기 게이지
      }
      const lead = p.id === this.leaderId, nm = (lead ? '👑 ' : '') + (p.b ? '🤖 ' : '') + p.n;
      if (v.nameStr !== nm) { v.nameStr = nm; v.name.setText(nm); }
      if (lead && this.sys.game.renderer.type === Phaser.WEBGL && !v.lglow) { v.sprite.preFX.setPadding(24); v.lglow = v.sprite.preFX.addGlow(0xffd54a, 4, 0, false, 0.1, 12); } // 1등: 항상 노란 테두리로 빛남
      else if (!lead && v.lglow) { v.sprite.preFX.remove(v.lglow); v.lglow = null; }
      if ((p.st && p.rv > 0) || (p.gh && p.rp > 0)) { // 쓰러진 캐릭터 몸통 위에 부활까지 남은 초 (내 화면 · 남의 화면 모두). 대난투 유령은 팀원이 겹쳐 있을 때 부활까지 남은 초
        if (!v.rvT) { v.rvT = this.add.text(0, 0, '', { fontFamily: 'sans-serif', fontSize: '30px', color: '#ffffff', fontStyle: '900', stroke: '#14122b', strokeThickness: 6 }).setOrigin(0.5); v.root.push(v.rvT); }
        const left = p.gh ? 5 - p.rp : p.rv; v.rvT.setText(String(Math.ceil(left))).setPosition(v.x, v.y - 0.45 * BU).setDepth(v.y + 3).setVisible(true).setColor(p.gh ? '#7dffcf' : left <= 1 ? '#ffe27a' : '#ffffff'); // 마지막 1초는 노랗게 · 유령 부활은 민트색
      } else if (v.rvT) v.rvT.setVisible(false);
      v.name.setPosition(bx, by - 8).setDepth(v.y + 1).setAlpha(p.gh ? 0.3 : this.screen || me || p.id === this.lockId ? 1 : 0.35); // 다른 사람 이름은 흐리게, 내가 조준한 상대만 또렷하게
      v.status.setText('').setPosition(bx, by - 32).setDepth(v.y + 1); // 상태이상 글자는 쓰지 않음
      const shown = Math.max(0, (p.cn || 0) - (v.pending || 0)); // 습득 연출이 끝나야 '기록'됨
      const bk = Math.max(0, 1 - (now - v.bump) / 250);
      v.coinIcon.setVisible(shown > 0).setPosition(bx0 + bw + (p.sp > 0 ? 40 : 18), by + 7).setDepth(v.y + 1).setScale(1.5 * (1 + 0.45 * bk));
      v.coinTxt.setVisible(shown > 0).setText(`×${shown}`).setPosition(bx0 + bw + (p.sp > 0 ? 52 : 30), by + 7).setDepth(v.y + 1);
    }
    this.coins.update(now);
    this.items.update(now);
    this.proj.update(now);
    this._drawAim(now);
    if (!this.redRect) this.redRect = this.add.rectangle(0, 0, 8000, 8000, 0xff2010, 0).setDepth(9000);
    const cam = this.cameras.main; this.redA = (this.redA || 0) + (((this._redTint || 0) * 0.45) - (this.redA || 0)) * 0.2;
    this.redRect.setPosition(cam.midPoint.x, cam.midPoint.y).setAlpha(this.redA).setVisible(this.redA > 0.005);
    this.onFrame?.(this, delta);
  }
}

// 렌더 해상도: 큰 화면(아이패드 등)은 dpr 그대로 그리면 픽셀 수가 너무 많아 끊긴다 → 총 픽셀 예산 안으로 줄이고, 프레임이 떨어지면 단계적으로 더 낮춘다
const PIXEL_BUDGET = 2.2e6, MIN_DPR = 1;
const pickDpr = (parent, cap = 3) => Math.max(MIN_DPR, Math.min(cap, window.devicePixelRatio || 1, Math.sqrt(PIXEL_BUDGET / Math.max(1, parent.clientWidth * parent.clientHeight))));
export function startWorld(parentId, opts = {}) {
  const scene = new WorldScene();
  scene.screen = !!opts.screen; // 빔프로젝터 화면: 이름은 항상 또렷하게, 체력바는 작게
  let config;
  if (opts.fill) {
    // 부모 영역을 가득 채우는 모드(폰·태블릿 화면용)
    const parent = document.getElementById(parentId);
    const dpr = pickDpr(parent);
    config = { width: Math.round(parent.clientWidth * dpr), height: Math.round(parent.clientHeight * dpr), scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr } };
    scene.dpr = dpr;
  } else {
    config = { width: WORLD_W, height: WORLD_H, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } };
  }
  const game = new Phaser.Game({ type: Phaser.AUTO, parent: parentId, backgroundColor: '#2b4d2a', scene, render: { antialias: false, powerPreference: 'high-performance' }, ...config });
  if (opts.fill) {
    const parent = document.getElementById(parentId);
    const apply = () => { game.scale.setZoom(1 / scene.dpr); game.scale.resize(Math.round(parent.clientWidth * scene.dpr), Math.round(parent.clientHeight * scene.dpr)); };
    let rt = 0, lw = parent.clientWidth, lh = parent.clientHeight; // 사파리 주소창이 접혔다 펴지며 크기가 조금씩 바뀔 때마다 캔버스를 다시 만들면 움직일 때 뚝 끊김 → 크게 바뀔 때만, 멈춘 뒤에
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (Math.abs(parent.clientWidth - lw) < 24 && Math.abs(parent.clientHeight - lh) < 24) return; lw = parent.clientWidth; lh = parent.clientHeight; scene.dpr = Math.min(scene.dpr, pickDpr(parent)); apply(); }, 250); });
    let slow = 0, born = performance.now(); // 시작 6초 뒤부터, 프레임이 3번 연속 30fps 아래면 해상도를 한 단계(0.25) 낮춤 (너무 자주 바꾸면 그 자체로 끊김)
    setInterval(() => {
      if (document.hidden || !game.loop || game.loop.actualFps === 0) return;
      if (performance.now() - born < 6000) return;
      slow = game.loop.actualFps < 30 ? slow + 1 : 0;
      if (slow >= 3 && scene.dpr > MIN_DPR) { scene.dpr = Math.max(MIN_DPR, scene.dpr - 0.25); slow = 0; apply(); }
    }, 1500);
  }
  return { game, scene };
}
