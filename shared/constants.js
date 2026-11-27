// 서버와 클라이언트가 함께 쓰는 상수. 모든 길이 단위는 '몸 폭'(BU, 캐릭터 지름 = 1BU)이다.

export const MAP = { w: 40, h: 22 };

export const TICK_HZ = 30;
export const BROADCAST_HZ = 20;

// 조이스틱 데드존: 중심에서 패드 반지름의 이 비율 안쪽은 '움직이지 않음'. 바깥은 얼마나 밀었든 같은 속도
export const JOYSTICK_DEADZONE = 0.1;

// 동전: 3초마다 맵에 1개 생성, 다가가면 자동 습득(개당 0.5점). 문제를 못 맞히거나 쓰러지면 가진 동전이 전부 튀어나감
export const COIN = {
  spawnEverySec: 3,
  maxTotal: 100, // 습득된 것까지 포함해 이만큼만 생성
  value: 0.5, // 동전 1개의 점수
  pickupRadius: 1.0, // 캐릭터 중심과 동전 중심 사이 거리 (칸)
  scatterRadius: 2.5, // 튀어나온 동전이 떨어지는 반경 (칸, 48px/칸 기준 120px)
  scatterMin: 0.8, // 몸 바로 밑에는 떨어지지 않도록
  flightSec: 0.55, // 튀어나와 바닥에 닿기까지
  dropLockSec: 0, // 떨어진 동전의 줍기 금지 시간은 없음 (0). 날아가서 땅에 닿는 순간(flightSec)부터 누구나 줍는다
  dropOnNoAnswer: true, // 무응답도 틀린 것으로 보고 떨어뜨림
};
// 궁극기 충전: 때린 피해만큼(궁극기로 때린 건 절반), 맞은 피해의 절반, 가만히 있어도 초당 3%, 탱커는 맞을 때마다 2% 더
export const ULT_CHARGE = { ultHit: 0.5, auto: 0.03, tankHit: 0.02, ultCap: 0.05, humanMul: 1 }; // humanMul: 사람(봇 제외)의 궁극기 충전 배수. 1이 정식 값이고, 혼자 시험할 때만 2 등으로 올림

// 달리기 게이지는 이 배수로 빨리 닳는다 (대쉬 캐릭터는 게이지가 없어서 균형을 맞추기 위함)
export const RUN_DRAIN = 1.4;
export const CHAR_CD_SEC = 60; // 퀴즈 중 캐릭터 변경 쿨타임 (대기실은 제한 없음)

// 아이템: 하트(체력 회복) · 신발(잠깐 빨라짐). 동전처럼 맵에 생기고 닿으면 자동으로 먹는다
export const ITEM = {
  spawnEverySec: 8, // 이 간격으로 하트/신발 중 하나가 생김
  maxOnMap: 5,
  pickupRadius: 1.0,
  heart: { heal: 0.3 }, // 최대 체력의 30% 회복 (체력이 가득이면 못 먹음)
  shoe: { sec: 5, mul: 1.4 }, // 5초 동안 이동 속도 1.4배
};
// 크리티컬: 맞을 때마다 이 확률로 피해가 배수로 커지고, 크리티컬일 때만 화면이 흔들린다
export const CRIT = { chance: 0.1, mul: 1.5 };
export const fmtScore = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export const READ_SEC = 3; // 문제를 읽는 시간 (구역이 아직 잠겨 있음)

// 맵 한가운데 원형 구역. 원 안에 중심이 들어가 있으면 그 구역을 고른 것 (cx, cy, r 단위는 칸)
export const ZONES = {
  ox: [
    { id: 'O', cx: 14, cy: 11, r: 5, label: 'O' },
    { id: 'X', cx: 26, cy: 11, r: 5, label: 'X' },
  ],
  choice: [ // 가로 한 줄로 크게: 스킬에 밀려도 구역 안에 남기 쉽다
    { id: 1, cx: 5, cy: 12, r: 4.8, label: '1' },
    { id: 2, cx: 15, cy: 12, r: 4.8, label: '2' },
    { id: 3, cx: 25, cy: 12, r: 4.8, label: '3' },
    { id: 4, cx: 35, cy: 12, r: 4.8, label: '4' },
  ],
};

/** 달력 퀴즈 판: 문제 카드 아래를 7열 × 주 수만큼 칸으로 나눔 (days일, 1일이 start요일(0=일)에 시작) */
export function calLayout(q) {
  const start = q.start || 0, days = q.days || 30, rows = Math.ceil((start + days) / 7), x0 = 1.1, y0 = 6.5; // 위쪽 0.8칸은 요일 줄
  return { x0, y0, w: (MAP.w - 2.2) / 7, h: (MAP.h - 1.8 - y0) / rows, rows, start, days, month: q.month || 0 }; // 아래는 하단 안내 막대 자리
}
/** 그 위치의 날짜(없으면 null) */
export function calCell(l, x, y) {
  const c = Math.floor((x - l.x0) / l.w), r = Math.floor((y - l.y0) / l.h);
  if (c < 0 || c > 6 || r < 0 || r >= l.rows) return null;
  const d = r * 7 + c - l.start + 1; return d >= 1 && d <= l.days ? d : null;
}
export const calCenter = (l, d) => { const i = d - 1 + l.start; return { x: l.x0 + (i % 7 + 0.5) * l.w, y: l.y0 + (Math.floor(i / 7) + 0.5) * l.h }; };

/** 캐릭터 중심이 들어있는 구역 id (없으면 null = 무응답) */
export function zoneAt(type, x, y) {
  for (const z of ZONES[type] || []) if ((x - z.cx) ** 2 + (y - z.cy) ** 2 <= z.r * z.r) return z.id;
  return null;
}

// 스프라이트 모션별 프레임 수 (tools/build_sheets.py 결과와 일치해야 함)
export const SPRITE = {
  cell: 256,
  anchor: [104, 232], // 셀 안의 발(그림자) 위치 (오른쪽에 주먹이 뻗을 공간을 남기려고 왼쪽으로 치우침)
  motions: {
    idle: { frames: 4, fps: 6, yoyo: true, loop: true },
    walk: { frames: 7, fps: 12, loop: true },
    run: { frames: 7, fps: 15, loop: true },
    combo: { frames: 8 }, // 공격 시트: 아래 attackSteps로 나눠서 재생
  },
  // 근접 3타 콤보: 잽 → 잽 → 반대 주먹으로 크게 휘두르기 (combo 시트의 프레임 번호)
  attackSteps: [
    { frames: [0, 1], fps: 12, ms: 260 },
    { frames: [2, 3], fps: 12, ms: 260 },
    { frames: [4, 5, 6, 7], fps: 14, ms: 340 },
  ],
};
export const COMBO_RESET_SEC = 1.0; // 이 시간 동안 공격하지 않으면 다시 1타부터

export const PHASE = { LOBBY: 'lobby', READING: 'reading', MOVING: 'moving', HOLD: 'hold', REAL: 'real', REVEAL: 'reveal' }; // HOLD: 시간 종료, 진행자가 정답 공개를 누를 때까지 대기 · REAL: 현실 퀴즈(점수 입력 후 공개)
