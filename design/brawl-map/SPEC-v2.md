# 대난투 맵 재배치 및 은신 부쉬 적용 가이드 (Claude 전달용)

기존 `brawl-map` 규격(80x44칸, 1칸 24px, 강 중심선 수식, 장애물 3종 충돌 크기)은 그대로 유지하면서, 규칙적인 격자 배치를 자연스러운 군락 배치로 바꾸고 근접 캐릭터용 분절 은신 부쉬 경로를 추가한 데이터 패키지입니다.

## 포함된 파일
- `brawl_map_layout.json` — 장애물 32개 전체 좌표 및 부쉬 236칸(40개 가로 스팬) 최종 데이터
- `preview_full_map.png` — 기존 바닥 + 신규 부쉬 + 재배치 장애물 합성 프리뷰 (1920x1056)
- `bush_overlay_1920x1056.png` — 부쉬만 분리된 투명 PNG 레이어 (1920x1056, 바로 오버레이 가능)
- `bush_tile_24x24.png` — 1칸(24x24) 단위 부쉬 투명 스프라이트 (타일 단위 렌더링용)

## 1. 장애물 변경 사항 (`shared/brawlMap.js`)
- 기존 충돌 크기 유지: `boulder` 2x2칸, `wall` 3x1칸, `pillar` 1x1칸 (기준점 아래 가운데)
- 전체 개수 유지: 32개 (왼쪽 16개 + 오른쪽 16개)
- 대칭 방식 변경: 기존 좌우 거울 대칭(`80 - x, y`)에서 **180도 점대칭(`80 - x, 44 - y`)** 으로 변경
- 검증 완료: 양쪽 끝 스폰 여유 10칸 이상, 강물과 최소 2칸 이상 이격, 장애물 간 겹침 및 애매한 틈(2.2칸 미만) 없음

```js
// 왼쪽 절반 16개 (오른쪽 절반은 x: 80 - x, y: 44 - y 로 생성)
export const LEFT_OBSTACLES = [
  { type: 'wall', x: 15, y: 9 },
  { type: 'pillar', x: 13, y: 10 },
  { type: 'boulder', x: 21, y: 6 },
  { type: 'boulder', x: 14, y: 34 },
  { type: 'boulder', x: 16, y: 35 },
  { type: 'pillar', x: 13, y: 40 },
  { type: 'boulder', x: 21, y: 20 },
  { type: 'wall', x: 26, y: 23 },
  { type: 'pillar', x: 21, y: 26 },
  { type: 'wall', x: 30, y: 8 },
  { type: 'pillar', x: 32, y: 9 },
  { type: 'boulder', x: 25, y: 36 },
  { type: 'wall', x: 30, y: 39 },
  { type: 'boulder', x: 32, y: 21 },
  { type: 'wall', x: 32, y: 31 },
  { type: 'pillar', x: 38, y: 21 },
];
```

## 2. 은신 부쉬 추가 사항 (`shared/brawlMap.js`, `src/mapArt.js`)
- 구성: 상단·하단 은신 경로를 180도 점대칭으로 배치, 총 8개 구간(구간당 10~13칸), 구간 사이 3칸 노출 틈(아군 중원 / 중앙 모래 건널목 / 적진 중원)
- 총 236칸이며 `brawl_map_layout.json`의 `bushRowSpans` 배열(`{ y, x0, x1 }` 포맷, `x0 <= tx <= x1`)로 바로 판정 가능
- 충돌 및 게임 규칙:
  - 캐릭터 이동 가능, 투사체 통과
  - 장애물 및 강물 타일과 겹침 0건
  - 부쉬 안에 들어간 캐릭터는 적 팀에게 숨겨짐(공격 시 또는 근접 시 노출, 아군/본인은 반투명 표시 권장)

```js
// 부쉬 판정 예시 (tx, ty는 0-based 정수 타일 좌표)
export function isBushTile(tx, ty, bushRowSpans) {
  return bushRowSpans.some(s => s.y === ty && tx >= s.x0 && tx <= s.x1);
}
```
