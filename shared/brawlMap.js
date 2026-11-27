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

// 장애물: k 종류, (x,y) 바닥 중심, hw·hh 반폭·반높이(충돌 상자). 왼쪽 절반을 규칙적으로 깔고 오른쪽은 좌우 대칭
const SIZE = { boulder: [1, 1], wall: [1.5, 0.5], pillar: [0.5, 0.5] };
const half = [];
const KINDS = ['boulder', 'wall', 'pillar'];
[15, 25, 33].forEach((x, c) => [6, 14, 22, 30, 38].forEach((y, r) => { const k = KINDS[(r + c) % 3]; half.push({ k, x, y, hw: SIZE[k][0], hh: SIZE[k][1] }); }));
export const OBSTACLES = [
  ...half, ...half.map((o) => ({ ...o, x: BRAWL_MAP.w - o.x })),
  { k: 'pillar', x: 40, y: 19, hw: 0.5, hh: 0.5 }, { k: 'pillar', x: 40, y: 25, hw: 0.5, hh: 0.5 }, // 가운데 땅(건널목)에도 기둥 두 개
];

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
