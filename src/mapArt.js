// 잔디 필드 맵 도트 아트. 도트 1개 = 화면 2px, 한 칸(몸 폭 1) = 24도트라서 캐릭터와 같은 도트 크기다.
// 이미지 파일 없이 코드로 그려서 Phaser 캔버스 텍스처로 만든다.
import Phaser from 'phaser';
import { MAP } from '../shared/constants.js';
import { BRAWL_MAP, riverCenter, riverHalf } from '../shared/brawlMap.js';

export const TILE = 24;
const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const GRASS = [0x5fa34c, 0x4e9140].map(rgb);
const LIGHT = rgb(0x7dbb62), DARK = rgb(0x3f7a34), DARK_GRASS = DARK;
const LINE = rgb(0xf4f4f0);
export const ZONE_COLOR = { O: 0x2e86de, X: 0xee5253, 1: 0xee5253, 2: 0x2e86de, 3: 0xf0b429, 4: 0x1dd1a1 };

const nearest = (tex) => tex.refresh() && tex.setFilter(Phaser.Textures.FilterMode.NEAREST);

/** 잔디 바닥('floor'): 줄무늬 잔디 + 맵 테두리의 흰 라인 */
export function buildFloor(scene) {
  const W = MAP.w * TILE, H = MAP.h * TILE;
  const tex = scene.textures.createCanvas('floor', W, H);
  const ctx = tex.getContext();
  const img = ctx.createImageData(W, H), d = img.data;
  const put = (x, y, c) => { const i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
  for (let ty = 0; ty < MAP.h; ty++) {
    for (let tx = 0; tx < MAP.w; tx++) {
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const gx = tx * TILE + x, gy = ty * TILE + y;
          let c = GRASS[(tx + ty) % 2];
          const h = (x * 29 + y * 31 + tx * 7 + ty * 11) % 37; // 잔디 알갱이
          if (h === 0) c = LIGHT; else if (h === 1) c = DARK;
          if ((tx * 5 + ty * 3) % 4 === 0 && y >= 6 && y <= 8 && (x === 10 || x === 12 || (x === 11 && y === 8))) c = DARK; // 풀잎
          if (gx < 3 || gy < 3 || gx >= W - 3 || gy >= H - 3) c = LINE;
          put(gx, gy, c);
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  nearest(tex);
}

/** 퀴즈 바닥('floor-quiz'): 어두운 남색 타일 + 격자선 + 노란 테두리. 대기실 잔디와 한눈에 구분됨 */
export function buildQuizFloor(scene) {
  const W = MAP.w * TILE, H = MAP.h * TILE, T = [0x2b2f63, 0x252858].map(rgb), GRID = rgb(0x3d4287), STAR = rgb(0x6c73c4), EDGE = rgb(0xffd54a);
  const tex = scene.textures.createCanvas('floor-quiz', W, H), ctx = tex.getContext(), img = ctx.createImageData(W, H), d = img.data;
  for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
    const tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE), x = gx % TILE, y = gy % TILE;
    let c = T[(tx + ty) % 2];
    if (x === 0 || y === 0) c = GRID;
    else if ((gx * 29 + gy * 31) % 211 === 0) c = STAR;
    if (gx < 3 || gy < 3 || gx >= W - 3 || gy >= H - 3) c = EDGE;
    const i = (gy * W + gx) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  nearest(tex);
}

// ---------- 대난투 맵: 잔디 들판 + 건널 수 없는 강(모래 기슭이 잔디로 자연스럽게 이어짐) + 장애물 ----------
const SAND = [0xe9d79f, 0xdfc98d].map(rgb), SAND_DARK = rgb(0xc7a96b), SAND_WET = rgb(0xc8b07a), SAND_PEBBLE = rgb(0xa88a52);
const WATER = [0x3a8fd8, 0x2f7fcf, 0x2468b8, 0x1d5aa3].map(rgb), FOAM = rgb(0xe4f4ff), SPARK = rgb(0xa9d8ff);
const bayer4 = (x, y) => (BAYER[y & 3][x & 3] + 0.5) / 16;
const sm = (u) => { const t = Math.max(0, Math.min(1, u)); return t * t * (3 - 2 * t); };
const hash2 = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 대난투 바닥('floor-brawl', 80×44칸): 잔디 위로 강이 흐르고, 물가는 젖은 모래 → 마른 모래 → (점점 성기게) 잔디로 이어진다 */
export function buildBrawlFloor(scene) {
  const W = BRAWL_MAP.w * TILE, H = BRAWL_MAP.h * TILE, tex = scene.textures.createCanvas('floor-brawl', W, H), ctx = tex.getContext(), img = ctx.createImageData(W, H), d = img.data;
  for (let gy = 0; gy < H; gy++) {
    const ty = gy / TILE, hw = riverHalf(ty), cx = riverCenter(ty);
    for (let gx = 0; gx < W; gx++) {
      const tx = gx / TILE, dist = Math.abs(tx - cx) - hw; // 물가까지의 거리(칸): 음수면 물속
      let c;
      if (hw > 0.02 && dist < 0) { // 물: 깊을수록 진하게, 물가엔 거품, 흐름을 따라 가는 반짝임
        const depth = Math.min(1, -dist / Math.max(0.6, hw)), wave = Math.sin(gy * 0.22 + gx * 0.05 + (tx - cx) * 0.8) * 0.5 + 0.5;
        c = WATER[Math.min(3, Math.floor(depth * 2.2 + wave * 0.9))];
        if (dist > -0.32 && ((gx + gy * 2) % 7 < 3)) c = FOAM; // 가장자리 거품(점선)
        else if (hash2(gx >> 1, gy >> 1) > 0.965) c = SPARK;
      } else {
        const tileX = Math.floor(tx), tileY = Math.floor(ty), x = gx % TILE, y = gy % TILE;
        let grass = GRASS[(tileX + tileY) % 2]; const h = (x * 29 + y * 31 + tileX * 7 + tileY * 11) % 37;
        if (h === 0) grass = LIGHT; else if (h === 1) grass = DARK;
        if ((tileX * 5 + tileY * 3) % 4 === 0 && y >= 6 && y <= 8 && (x === 10 || x === 12 || (x === 11 && y === 8))) grass = DARK;
        const reach = 3.6 + (hash2(Math.floor(ty * 2), 7) - 0.5) * 0.9; // 기슭 폭이 구간마다 조금씩 다름
        const p = hw > 0.02 || dist < reach ? 1 - sm((dist - 1.0) / (reach - 1.0)) : 0; // 모래일 확률: 물가 1칸은 거의 확정 → 멀어질수록 성기게
        if (p > 0 && p > bayer4(gx, gy) * 0.98 + (hash2(gx, gy) - 0.5) * 0.12) {
          c = dist < 0.5 ? SAND_WET : SAND[(gx + gy) & 1]; // 물 바로 옆은 젖은(진한) 모래
          const r = hash2(gx * 3, gy * 5); if (r > 0.985) c = SAND_PEBBLE; else if (r < 0.04) c = SAND_DARK;
        } else c = grass;
        if (gx < 3 || gy < 3 || gx >= W - 3 || gy >= H - 3) c = LINE;
      }
      const i = (gy * W + gx) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0); nearest(tex);
}

/** 장애물 그림 (바닥 중심 기준): 이끼 낀 바위 · 석벽 · 돌기둥. 각각 'ob-boulder' 'ob-wall' 'ob-pillar' */
export function buildObstacleTextures(scene) {
  const INK = rgb(0x23262e), STONE = [0x4f5561, 0x6a717e, 0x8a919e, 0xaeb5c1].map(rgb), MOSS = [rgb(0x4a8030), rgb(0x66a043)];
  const make = (key, w, h, fn) => {
    const tex = scene.textures.createCanvas(key, w, h), ctx = tex.getContext(), img = ctx.createImageData(w, h), d = img.data;
    const put = (x, y, c, a = 255) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a; };
    fn(put, w, h); ctx.putImageData(img, 0, 0); nearest(tex);
  };
  const shade = (nx, ny, n) => { const l = -nx * 0.55 - ny * 0.7 + (n - 0.5) * 0.5; return l > 0.42 ? 3 : l > 0.12 ? 2 : l > -0.22 ? 1 : 0; }; // 왼쪽 위에서 빛이 옴
  // 바위: 2×2칸 바닥 + 위로 조금 솟음
  make('ob-boulder', 56, 56, (put, w, h) => {
    const cx = w / 2, cy = 33, rx = 25, ry = 21;
    for (let y = 40; y < 54; y++) for (let x = 0; x < w; x++) { const e = ((x - cx) / (rx + 2)) ** 2 + ((y - 47) / 6.5) ** 2; if (e < 1) put(x, y, rgb(0x1b3a14), 110); } // 그림자
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry, e = Math.abs(nx) ** 2.4 + Math.abs(ny) ** 2.4, bump = 1 + (hash2(Math.floor(x / 4), Math.floor(y / 4)) - 0.5) * 0.12;
      if (e * bump > 1) continue;
      const edge = e * bump > 0.84; let c = edge ? INK : STONE[shade(nx, ny, hash2(x, y))];
      if (!edge && ny < -0.15 && hash2(Math.floor(x / 3), Math.floor(y / 3)) > 0.45 + ny * 0.5) c = MOSS[(x + y) & 1]; // 위쪽 이끼
      if (!edge && ny > 0.55 && (x + y) % 5 === 0) c = STONE[0]; // 아래 갈라진 결
      put(x, y, c);
    }
  });
  // 석벽: 3×1칸 벽돌 담
  make('ob-wall', 84, 44, (put, w, h) => {
    for (let y = 30; y < 42; y++) for (let x = 2; x < w - 2; x++) put(x, y, rgb(0x1b3a14), 100); // 그림자
    for (let y = 8; y < 36; y++) for (let x = 2; x < w - 2; x++) {
      const top = y < 16, row = Math.floor((y - 16) / 7), off = row % 2 ? 6 : 0, seam = (y - 16) % 7 === 0 || (x + off) % 13 === 0;
      let c = top ? STONE[3] : seam ? STONE[0] : STONE[1 + ((x + off) / 13 | 0) % 2];
      if (y === 8 || y === 35 || x === 2 || x === w - 3) c = INK; else if (top && y === 9) c = STONE[3];
      if (top && hash2(x >> 2, y >> 1) > 0.78 && x < 40) c = MOSS[(x + y) & 1]; // 윗면 이끼
      put(x, y, c);
    }
  });
  // 돌기둥: 1칸 바닥, 높이 2칸
  make('ob-pillar', 28, 64, (put, w, h) => {
    for (let y = 52; y < 62; y++) for (let x = 0; x < w; x++) { const e = ((x - 14) / 13) ** 2 + ((y - 57) / 4.5) ** 2; if (e < 1) put(x, y, rgb(0x1b3a14), 110); }
    for (let y = 4; y < 58; y++) for (let x = 3; x < 25; x++) {
      const base = y > 50, cap = y < 14, u = (x - 3) / 21; let c = STONE[u < 0.28 ? 3 : u < 0.6 ? 2 : u < 0.85 ? 1 : 0];
      if (cap) c = STONE[u < 0.5 ? 3 : 2]; if (base) c = STONE[1];
      if (y === 4 || y === 57 || x === 3 || x === 24 || y === 14 || y === 50) c = INK;
      if (!cap && !base && y > 20 && (x * 7 + y * 3) % 23 === 0) c = STONE[0]; // 갈라진 금
      if (y > 44 && y < 50 && hash2(x, y) > 0.55) c = MOSS[(x + y) & 1]; // 밑동 이끼
      put(x, y, c);
    }
  });
}

export const MAT_MARGIN = 8; // 링 바깥 장식(꽃·풀잎)이 들어갈 여백 (도트)
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]; // 4x4 디더링 표
const NAVY = rgb(0x14122b), STONE = [rgb(0xefe3c2), rgb(0xcbbd98)], STONE_LINE = rgb(0x7a6a48);
const CREAM = rgb(0xf3ecd6);

/** 원형 구역: 돌 울타리 링 + 디더링 바닥 + 윤곽선 도트 글자 + 링 바깥 꽃·풀잎. 종류·구역별로 한 번만 만든다. */
export function matTexture(scene, type, z) {
  const key = `mat-${type}-${z.id}`;
  if (scene.textures.exists(key)) return key;
  const R = Math.round(z.r * TILE), M = MAT_MARGIN, D = 2 * (R + M), C = D / 2;
  const base = rgb(ZONE_COLOR[z.id]);
  const mul = (k) => base.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  const BASE = mul(1), DARK = mul(0.66), LIGHTER = mul(1.12);
  const tex = scene.textures.createCanvas(key, D, D);
  const ctx = tex.getContext();
  const out = ctx.createImageData(D, D), o = out.data;
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= D || y >= D) return; const i = (y * D + x) * 4; o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2]; o[i + 3] = 255; };

  // 글자: 부드럽게 그린 뒤 반투명 픽셀을 없애 도트로 만든다
  const fs = Math.round(R * 1.1);
  const tmp = document.createElement('canvas'); tmp.width = D; tmp.height = D;
  const t = tmp.getContext('2d');
  t.fillStyle = '#fff'; t.font = `bold ${fs}px sans-serif`; t.textAlign = 'center'; t.textBaseline = 'middle';
  t.fillText(String(z.label), C, C + fs * 0.05);
  const src = t.getImageData(0, 0, D, D).data;
  const on = (x, y) => x >= 0 && y >= 0 && x < D && y < D && src[(y * D + x) * 4 + 3] >= 128;

  for (let y = 0; y < D; y++) {
    for (let x = 0; x < D; x++) {
      const dist = Math.hypot(x + 0.5 - C, y + 0.5 - C);
      if (dist > R) continue; // 링 바깥은 장식만 (아래에서 따로)
      let c;
      if (dist > R - 1) c = NAVY; // 바깥 윤곽선
      else if (dist > R - 7) { // 돌 울타리: 8도트 길이의 돌, 사이에 어두운 틈
        const len = (2 * Math.PI * R) / 8, a = ((Math.atan2(y + 0.5 - C, x + 0.5 - C) + Math.PI) / (2 * Math.PI)) * len;
        const seg = Math.floor(a);
        c = a - seg < 0.14 ? STONE_LINE : STONE[seg & 1];
      } else if (dist > R - 8) c = STONE_LINE; // 돌 안쪽 선
      else { // 바닥: 단색 + 가장자리 디더링(깊이감) + 드문 점 무늬
        const edge = R - 8 - dist; // 가장자리에서 안쪽으로 몇 도트
        const th = (BAYER[y & 3][x & 3] + 0.5) / 16;
        c = BASE;
        if (edge < 7 && th > edge / 7) c = DARK;
        else if ((x * 7 + y * 13) % 23 === 0) c = LIGHTER;
        else if ((x * 5 + y * 3) % 29 === 0) c = DARK;
      }
      // 글자: 윤곽선(남색) → 그림자 → 크림색, 왼쪽 위 가장자리는 하이라이트
      if (on(x, y)) c = on(x - 1, y - 1) ? CREAM : [255, 255, 255];
      else if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) c = NAVY;
      else if (on(x - 3, y - 3)) c = c.map((v) => v * 0.55);
      put(x, y, c);
    }
  }

  // 링 바깥 장식: 꽃과 풀잎 (구역마다 같은 모양이 나오게 고정 난수)
  let seed = String(z.id).charCodeAt(0) * 9301 + 49297;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const FLOWER = [rgb(0xffffff), rgb(0xffe27a), rgb(0xff9ec7)], YELLOW = rgb(0xf7c531);
  for (let n = 0, count = Math.round(R / 4); n < count; n++) {
    const ang = rnd() * Math.PI * 2, d = R + 3 + rnd() * (M - 5);
    const x = Math.round(C + Math.cos(ang) * d), y = Math.round(C + Math.sin(ang) * d);
    if (n % 3 === 2) { put(x, y, DARK_GRASS); put(x + 2, y, DARK_GRASS); put(x + 1, y + 1, DARK_GRASS); put(x + 1, y + 2, DARK_GRASS); continue; } // 풀잎
    const petal = FLOWER[n % FLOWER.length];
    put(x, y, YELLOW); put(x - 1, y, petal); put(x + 1, y, petal); put(x, y - 1, petal); put(x, y + 1, petal);
  }
  ctx.putImageData(out, 0, 0);
  nearest(tex);
  return key;
}

// ---------- 맵 장식물 (나무·덤불·바위·그루터기·꽃·버섯): 도트 + 4x4 디더링 음영, 바닥 그림자 ----------
const INK = rgb(0x1d2e2a);
const GREENS = [[0x2d6e38, 0x3f8f45, 0x5fb353, 0x8ad468], [0x2a6a4a, 0x3b8a5a, 0x57ad6c, 0x86d498], [0x4a7a2c, 0x6a9c38, 0x90bf4a, 0xbddb70]].map((l) => l.map(rgb));
const ROCKS = [0x6f7684, 0x8b93a1, 0xaab2bf, 0xd0d6df].map(rgb);
const BARK = [0x5a3a24, 0x7a5233, 0x9a6b42].map(rgb);

/** kind·v(변형 번호)별 텍스처를 한 번만 만든다. 기준점은 아래쪽 가운데(여백 PAD 포함이라 그릴 때 y를 PAD도트만큼 내려 줌). */
export const OBJ_PAD = 3;
const OBJ_SIZE = { tree: [44, 54], bush: [30, 20], rock: [26, 18], stump: [20, 16], flower: [18, 10], mushroom: [14, 12] };
export function objectTexture(scene, kind, v = 0) {
  const key = `obj-${kind}-${v}`;
  if (scene.textures.exists(key)) return key;
  const [w0, h0] = OBJ_SIZE[kind], P = OBJ_PAD, W = w0 + 2 * P, H = h0 + 2 * P;
  const tex = scene.textures.createCanvas(key, W, H);
  const ctx = tex.getContext();
  const out = ctx.createImageData(W, H), o = out.data;
  const put = (x, y, c, a = 255) => { x = Math.round(x) + P; y = Math.round(y) + P; if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2]; o[i + 3] = a; };
  const bayer = (x, y) => (BAYER[y & 3][x & 3] + 0.5) / 16;
  const shadow = (cx, cy, rx, ry) => { for (let y = 0; y < h0; y++) for (let x = 0; x < w0; x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1 && bayer(x, y) < 0.7) put(x, y, rgb(0x14352c), 120); };
  /** 형태(안쪽 판정)를 받아 윤곽선 + 4단계 디더 음영으로 칠한다. 빛은 왼쪽 위. 형태는 그림 영역 안에 완전히 들어와야 한다 */
  const blob = (inside, pal, x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) { put(x, y, INK); continue; }
      const t = ((x - x0) / (x1 - x0 + 1)) * 0.45 + ((y - y0) / (y1 - y0 + 1)) * 0.65 + (bayer(x, y) - 0.5) * 0.32; // 0(밝음) → 1(어두움)
      put(x, y, pal[t < 0.28 ? 3 : t < 0.5 ? 2 : t < 0.72 ? 1 : 0]);
    }
  };
  const circ = (cx, cy, r) => (x, y) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;
  const any = (...f) => (x, y) => f.some((g) => g(x, y));
  const pal = GREENS[v % 3];

  if (kind === 'tree') {
    // 변형 0 둥근 나무 · 1 키 큰 나무 · 2 넓고 낮은 나무. 잎 덩이는 겹친 원이라 가장자리가 물결 모양이다
    const SH = [[circ(22, 20, 12), circ(12, 24, 8), circ(32, 24, 8), circ(22, 11, 9), circ(14, 15, 6), circ(30, 15, 6)],
      [circ(22, 24, 10), circ(22, 14, 9), circ(22, 6, 6), circ(13, 27, 6), circ(31, 27, 6), circle2(22, 18, 11, 8)],
      [circ(12, 22, 9), circ(32, 22, 9), circ(22, 19, 12), circ(22, 28, 8), circ(16, 12, 6), circ(28, 12, 6)]][v % 3];
    function circle2(cx, cy, rx, ry) { return (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1; }
    shadow(22, h0 - 3, 14, 3);
    for (let y = 34; y < h0 - 3; y++) { const wid = y > h0 - 7 ? 4 : 3; for (let x = 22 - wid; x <= 22 + wid; x++) put(x, y, x === 22 - wid || x === 22 + wid ? INK : x < 21 ? BARK[2] : x < 23 ? BARK[1] : BARK[0]); } // 줄기 (아래로 갈수록 넓어짐)
    for (let x = 17; x <= 27; x++) put(x, h0 - 3, INK);
    blob(any(...SH), pal, 0, 0, w0 - 1, 36);
  } else if (kind === 'bush') {
    shadow(15, h0 - 3, 12, 3);
    blob(any(circ(15, 11, 8), circ(8, 13, 6), circ(22, 13, 6)), pal, 0, 2, w0 - 1, h0 - 4);
  } else if (kind === 'rock') {
    shadow(13, h0 - 3, 11, 2.5);
    blob(any(circ(13, 10, 8), circ(8, 12, 5.5), circ(18, 12, 5.5)), ROCKS, 0, 1, w0 - 1, h0 - 4);
  } else if (kind === 'stump') {
    shadow(10, h0 - 3, 9, 2.5);
    blob((x, y) => y >= 7 && y <= 12 && ((x + 0.5 - 10) / 8) ** 2 + ((y + 0.5 - 9.5) / 3) ** 2 <= 1 || (x >= 4 && x <= 15 && y >= 9 && y <= 13), BARK.slice().reverse().concat([rgb(0xc08a58)]), 0, 6, w0 - 1, 13);
    for (let x = 6; x <= 13; x++) put(x, 8, rgb(0xd9a873)); // 윗면 나이테 밝은 면
    put(9, 8, BARK[0]); put(10, 8, BARK[0]);
  } else if (kind === 'flower') {
    const cols = [[0xffffff, 0xffe27a], [0xff9ec7, 0xffe27a], [0xb48cff, 0xffffff]][v % 3].map(rgb);
    for (const [fx, fy] of [[5, 4], [11, 3], [8, 7]]) { put(fx, fy + 2, rgb(0x3f7a34)); put(fx, fy + 3, rgb(0x3f7a34)); put(fx, fy, rgb(0xf7c531)); put(fx - 1, fy, cols[0]); put(fx + 1, fy, cols[0]); put(fx, fy - 1, cols[0]); put(fx, fy + 1, cols[0]); }
  } else { // mushroom
    shadow(7, h0 - 2, 6, 2);
    for (let y = 7; y < 11; y++) for (let x = 6; x <= 8; x++) put(x, y, x === 6 ? INK : rgb(0xf0e6d0));
    blob(circ(7, 6, 5), [rgb(0xb02a3a), rgb(0xd94652), rgb(0xf0707a), rgb(0xffa0a6)], 1, 1, 12, 7);
    put(5, 4, rgb(0xffffff)); put(9, 3, rgb(0xffffff)); put(8, 5, rgb(0xffffff));
  }
  ctx.putImageData(out, 0, 0);
  nearest(tex);
  return key;
}
