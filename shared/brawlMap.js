// 대난투 맵 (서버와 화면이 함께 씀): 기본 맵의 2배(80×44칸), 가운데를 가르는 건널 수 없는 강, 곳곳에 규칙적으로 놓인 장애물
export const BRAWL_MAP = { w: 80, h: 44 };
export const BRAWL_LOCK_SEC = 10; // 시작 뒤 이 시간 동안은 공격·궁극기·달리기 불가
export const BRAWL_REVIVE_SEC = 5; // 유령과 겹쳐 있어야 하는 시간
const sstep = (u) => { const t = Math.max(0, Math.min(1, u)); return t * t * (3 - 2 * t); };

/** 강 중심선 x (구불구불) */
export const riverCenter = (y) => 40 + 2.4 * Math.sin(y * 0.27);
/** 강 반폭: 위·아래는 6칸 폭, 가운데(y 16~28)는 땅이 이어지도록 좁아져 사라짐 */
export const riverHalf = (y) => (y <= 12 ? 3 : y < 16 ? 3 * (1 - sstep((y - 12) / 4)) : y < 28 ? 0 : y < 32 ? 3 * sstep((y - 28) / 4) : 3);
export const inWater = (x, y) => Math.abs(x - riverCenter(y)) < riverHalf(y);

// 장애물: k 종류, (x,y) 중심, hw·hh 반폭·반높이(충돌 상자). 왼쪽 절반만 적고 오른쪽은 180도 점대칭 (80-x, 44-y)
const SIZE = { boulder: [1, 1], wall: [1.5, 0.5], pillar: [0.5, 0.5] };
const LEFT = [{ type: 'wall', x: 15, y: 9 }, { type: 'pillar', x: 13, y: 10 }, { type: 'boulder', x: 21, y: 6 }, { type: 'boulder', x: 14, y: 34 }, { type: 'boulder', x: 16, y: 35 }, { type: 'pillar', x: 13, y: 40 }, { type: 'boulder', x: 21, y: 20 }, { type: 'wall', x: 26, y: 23 }, { type: 'pillar', x: 21, y: 26 }, { type: 'wall', x: 30, y: 8 }, { type: 'pillar', x: 32, y: 9 }, { type: 'boulder', x: 25, y: 36 }, { type: 'wall', x: 30, y: 39 }, { type: 'boulder', x: 32, y: 21 }, { type: 'wall', x: 32, y: 31 }, { type: 'pillar', x: 38, y: 21 }];
const mk = (t, x, y) => ({ k: t, x, y, hw: SIZE[t][0], hh: SIZE[t][1] });
export const OBSTACLES = [...LEFT.map((o) => mk(o.type, o.x, o.y)), ...LEFT.map((o) => mk(o.type, BRAWL_MAP.w - o.x, BRAWL_MAP.h - o.y))];

/** 은신 부쉬: 가로 구간 { y, x0, x1 } (타일 좌표, x0 <= tx <= x1). 이동·투사체는 통과, 안에 있으면 적 팀에게 숨겨짐 */
export const BUSH_SPANS = [{y: 8, x0: 26, x1: 27}, {y: 9, x0: 26, x1: 28}, {y: 10, x0: 27, x1: 28}, {y: 11, x0: 27, x1: 28}, {y: 12, x0: 20, x1: 21}, {y: 12, x0: 26, x1: 28}, {y: 13, x0: 13, x1: 22}, {y: 13, x0: 26, x1: 30}, {y: 13, x0: 55, x1: 65}, {y: 14, x0: 12, x1: 21}, {y: 14, x0: 27, x1: 32}, {y: 14, x0: 55, x1: 65}, {y: 15, x0: 13, x1: 17}, {y: 15, x0: 30, x1: 34}, {y: 15, x0: 42, x1: 50}, {y: 15, x0: 62, x1: 65}, {y: 16, x0: 32, x1: 35}, {y: 16, x0: 39, x1: 51}, {y: 17, x0: 34, x1: 34}, {y: 17, x0: 39, x1: 48}, {y: 26, x0: 31, x1: 40}, {y: 26, x0: 45, x1: 45}, {y: 27, x0: 28, x1: 40}, {y: 27, x0: 44, x1: 47}, {y: 28, x0: 14, x1: 17}, {y: 28, x0: 29, x1: 37}, {y: 28, x0: 45, x1: 49}, {y: 28, x0: 62, x1: 66}, {y: 29, x0: 14, x1: 24}, {y: 29, x0: 47, x1: 52}, {y: 29, x0: 58, x1: 67}, {y: 30, x0: 14, x1: 24}, {y: 30, x0: 49, x1: 53}, {y: 30, x0: 57, x1: 66}, {y: 31, x0: 51, x1: 53}, {y: 31, x0: 58, x1: 59}, {y: 32, x0: 51, x1: 52}, {y: 33, x0: 51, x1: 52}, {y: 34, x0: 51, x1: 53}, {y: 35, x0: 52, x1: 53}];
export const isBushTile = (tx, ty) => BUSH_SPANS.some((s) => s.y === ty && tx >= s.x0 && tx <= s.x1);
export const inBush = (x, y) => isBushTile(Math.floor(x), Math.floor(y));

/** 왼쪽 팀(1)·오른쪽 팀(2) 시작 위치 (맵 끝쪽, 세로로 펼침) */
export function brawlSpawn(side, i, n) {
  const x = side === 0 ? 4 + (i % 2) * 2.2 : BRAWL_MAP.w - 4 - (i % 2) * 2.2, rows = Math.max(1, Math.ceil(n / 2)), y = 10 + ((Math.floor(i / 2) + 0.5) / rows) * (BRAWL_MAP.h - 20);
  return { x, y };
}

/** 원(중심 x,y 반지름 r)이 장애물·강에 닿아 있으면 밀어내서 바깥 좌표를 돌려줌 */
export function pushOut(x, y, r) {
  const hw = riverHalf(y);
  if (hw > 0) { const c = riverCenter(y), lim = hw + r; if (Math.abs(x - c) < lim) x = c + (x >= c ? lim : -lim); }
  for (const o of OBSTACLES) {
    const cx = Math.max(o.x - o.hw, Math.min(o.x + o.hw, x)), cy = Math.max(o.y - o.hh, Math.min(o.y + o.hh, y)), dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
    if (d >= r) continue;
    if (d > 1e-6) { x = cx + (dx / d) * r; y = cy + (dy / d) * r; }
    else { // 상자 안쪽: 가장 가까운 면으로
      const l = x - (o.x - o.hw), rr = o.x + o.hw - x, t = y - (o.y - o.hh), b = o.y + o.hh - y, m = Math.min(l, rr, t, b);
      if (m === l) x = o.x - o.hw - r; else if (m === rr) x = o.x + o.hw + r; else if (m === t) y = o.y - o.hh - r; else y = o.y + o.hh + r;
    }
  }
  return { x, y };
}
/** 점이 장애물 상자 안인가 (투사체 막기용) */
export const inObstacle = (x, y) => OBSTACLES.some((o) => Math.abs(x - o.x) <= o.hw && Math.abs(y - o.y) <= o.hh);
