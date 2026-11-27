// 아이템 렌더링: 하트·신발 도트, 생성 팝, 위아래로 둥실, 습득(번쩍 → 하트는 빨갛게·신발은 파랗게 변해 떠올라 머리 위로 날아옴 → 글자)
import Phaser from 'phaser';
import { HEART_PALETTE, ITEM_SHADOW, SHOE_PALETTE, SHOE_ROWS, heartRows } from '../shared/itemPixels.js';

const SCALE = 3;
const REST = 0.55; // 바닥에서 뜬 높이 (칸)
const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const FLY = { heart: 0xff3b4e, shoe: 0x3b8bff }; // 날아올 때 색
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const LABEL = { heart: { color: '#ff8fa0' }, shoe: { color: '#8ec5ff', text: '속도 ↑' } };

export class ItemLayer {
  constructor(scene, bu) {
    this.s = scene;
    this.bu = bu;
    this.views = new Map();
    this.flies = []; // 습득해서 날아가는 중인 아이템
  }

  create() {
    const gen = (key, data, palette) => this.s.textures.generate(key, { data, pixelWidth: 1, pixelHeight: 1, palette }).setFilter(Phaser.Textures.FilterMode.NEAREST);
    gen('item-heart', heartRows(), HEART_PALETTE);
    gen('item-shoe', SHOE_ROWS, SHOE_PALETTE);
    gen('item-shadow', ITEM_SHADOW, { 5: '#000000' });
  }

  apply(state) {
    for (const e of state.ev || []) {
      if (e.e === 'itemSpawn') this._make(e.id, e.k, e.x, e.y, true);
      else if (e.e === 'itemGet') this._get(e);
    }
    const ids = new Set();
    for (const i of state.items || []) {
      ids.add(i.id);
      if (!this.views.has(i.id)) this._make(i.id, i.k, i.x, i.y, false);
    }
    for (const v of [...this.views.values()]) if (!ids.has(v.id)) this._destroy(v);
  }

  _make(id, k, gx, gy, pop) {
    if (this.views.has(id)) return;
    const sprite = this.s.add.image(0, 0, `item-${k}`).setScale(SCALE);
    const shadow = this.s.add.image(0, 0, 'item-shadow').setScale(SCALE).setAlpha(0.3).setDepth(-45);
    this.views.set(id, { id, k, gx, gy, sprite, shadow, t0: performance.now(), pop });
    if (pop) { // 생길 때 하얀 고리가 퍼짐
      const ring = this.s.add.circle(gx * this.bu, gy * this.bu - REST * this.bu, 10, 0xffffff, 0.9).setDepth(5300);
      this.s.tweens.add({ targets: ring, scale: 3.4, alpha: 0, duration: 380, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
    }
  }

  _destroy(v) {
    v.sprite.destroy();
    v.shadow.destroy();
    this.views.delete(v.id);
  }

  _get(e) { // 동전처럼: 하얗게 반짝 → 색이 바뀌며 떠오름 → 주운 사람 머리 위로 날아감 → 글자
    const v = this.views.get(e.id);
    const x = v ? v.sprite.x : e.x * this.bu, y = v ? v.sprite.y : e.y * this.bu - REST * this.bu;
    if (v) this._destroy(v);
    const sprite = this.s.add.image(x, y, `item-${e.k}`).setScale(SCALE).setTintFill(0xffffff).setDepth(7000);
    this.flies.push({ e, sprite, x0: x, y0: y, t0: performance.now(), colored: false });
  }

  _updateFly(f, now) {
    const bu = this.bu, t = (now - f.t0) / 1000, who = this.s.views.get(f.e.by);
    const tx = who ? who.x : f.x0, ty = who ? who.y - 2.0 * bu : f.y0 - 2 * bu, riseY = f.y0 - 1.1 * bu;
    if (t < 0.10) { f.sprite.setScale(SCALE * (1 - 0.3 * (t / 0.10))); return true; } // 하얗게 반짝이며 작아짐
    if (!f.colored) { f.colored = true; f.sprite.setTintFill(FLY[f.e.k] ?? 0xffffff); } // 하트는 빨강, 신발은 파랑
    if (t < 0.40) { const k = easeOut((t - 0.10) / 0.30); f.sprite.setPosition(f.x0, f.y0 + (riseY - f.y0) * k).setScale(SCALE * (0.7 + 0.1 * k)); return true; } // 상승
    if (t < 0.85) { const k = easeInOut((t - 0.40) / 0.45); f.sprite.setPosition(f.x0 + (tx - f.x0) * k, riseY + (ty - riseY) * k).setScale(SCALE * (0.8 - 0.25 * k)); return true; } // 머리 위로
    f.sprite.destroy(); // 도착: 글자
    const lab = LABEL[f.e.k];
    const text = this.s.add.text(tx, ty, f.e.k === 'heart' ? `+${f.e.amount}` : lab.text, { fontFamily: 'monospace', fontSize: '28px', fontStyle: 'bold', color: lab.color, stroke: '#14122b', strokeThickness: 6 }).setOrigin(0.5).setDepth(8000).setScale(1.5).setResolution(2);
    this.s.tweens.add({ targets: text, scale: 1, duration: 120, ease: 'Back.easeOut' });
    this.s.tweens.add({ targets: text, y: ty - 0.9 * bu, alpha: 0, delay: 300, duration: 650, ease: 'Cubic.easeOut', onComplete: () => text.destroy() });
    return false;
  }

  update(now) {
    const bu = this.bu;
    this.flies = this.flies.filter((f) => this._updateFly(f, now));
    for (const v of this.views.values()) {
      const u = Math.min(1, (now - v.t0) / 350);
      const k = v.pop ? easeOutBack(u) : 1;
      const bob = Math.sin(now / 260 + v.id) * 0.09; // 둥실
      v.sprite.setPosition(v.gx * bu, v.gy * bu - (REST + bob) * bu).setScale(SCALE * k).setDepth(v.gy * bu + 1);
      v.shadow.setPosition(v.gx * bu, v.gy * bu).setScale(SCALE * (1 - bob * 1.2) * k).setAlpha(0.3 - bob * 0.5);
    }
  }
}
