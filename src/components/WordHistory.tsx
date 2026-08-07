import { summariseHistory } from '../lib/history'
import type { HistoryPoint } from '../lib/history'

interface WordHistoryProps {
  points: HistoryPoint[]
}

// Drawn in its own coordinate space and scaled by CSS, exactly as the donut is.
const WIDTH = 240
const HEIGHT = 40
const PAD = 4

/**
 * 한 단어가 수집된 날들을 지나오며 그날의 몇 퍼센트를 차지했는지.
 *
 * **세로축은 점유율이지 건수가 아니다.** 하루 깊이가 691에서 4,218까지 벌어져
 * 있고 2026-08-07에는 수집 상한이 150에서 300으로 바뀌었으므로, 건수를 그리면
 * 뉴스가 아니라 수집량이 그려진다. 이 규칙은 `surge.ts`가 측정으로 정해 둔 것이고
 * 여기서는 그것을 아카이브 전체로 늘릴 뿐이다.
 *
 * **사실은 전부 캡션의 글자가 진다.** 도넛에서와 같은 이유다 — 이 저장소의 잉크는
 * 캔버스 위의 *글자*로서 대비 4.5:1과 색상 40° 간격에 묶여 있어 도형 칠에 좋은
 * 색과 반대 방향이고, 그래서 색만으로 무엇을 지시해서는 안 된다. 오르내림은
 * 부호(+/−)로도 적히고, svg는 `aria-hidden`이다.
 */
export function WordHistory({ points }: WordHistoryProps) {
  // 점 하나는 궤적이 아니다. 평평한 점 하나는 "이 단어는 내내 그대로였다"고
  // 주장하는데, 실제로 일어난 일은 비교할 것이 없다는 것이다.
  if (points.length < 2) return null

  const summary = summariseHistory(points)

  // 최대 점유율로 정규화한다. 0을 바닥으로 삼는 것은 이 그림이 "그날의 몇 퍼센트"를
  // 말하기 때문이다 — 최솟값을 바닥으로 잡으면 잔잔한 변화가 절벽처럼 보인다.
  // 엣지 굵기가 0이 아니라 0.3에서 정규화되는 것과는 반대 방향의 판단이고, 이유도
  // 반대다: 거기서는 쓰이지 않는 아래쪽이 있었고 여기서는 0이 실제 값이다.
  const peak = Math.max(...points.map((point) => point.share))
  const step = points.length > 1 ? (WIDTH - PAD * 2) / (points.length - 1) : 0
  const y = (value: number) =>
    HEIGHT - PAD - (peak > 0 ? (value / peak) * (HEIGHT - PAD * 2) : 0)

  const placed = points.map((point, index) => ({
    ...point,
    x: PAD + index * step,
    y: y(point.share),
  }))
  const line = placed.map((point) => `${point.x},${point.y}`).join(' ')
  const last = placed[placed.length - 1]

  return (
    <figure className="mb-4 border-b border-line pb-4">
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        className="h-10 w-full"
      >
        <polyline
          points={line}
          fill="none"
          style={{ stroke: 'var(--color-ink-faint)' }}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        {placed.map((point) => (
          <circle
            key={point.date}
            cx={point.x}
            cy={point.y}
            r={point === last ? 3 : 1.75}
            style={{
              fill: point === last ? 'var(--color-ink)' : 'var(--color-ink-faint)',
            }}
          />
        ))}
      </svg>
      <figcaption className="mt-2 text-xs text-ink-muted">
        <span className="tabular-nums">
          {summary.days}일 중 {summary.daysPresent}일
        </span>
        {summary.isNew && <> · 오늘 새로 등장</>}
        {!summary.isNew && summary.change !== null && (
          <> · 전날 대비 <span className="tabular-nums">{formatChange(summary.change)}</span></>
        )}
      </figcaption>
    </figure>
  )
}

// 부호를 반드시 적는다 — 오르내림이 색으로만 구별되면 안 되고, 그것이 이 차트가
// dataviz의 색 기준을 통과하지 못하는 팔레트 위에서 정직할 수 있는 방법이다.
// 마이너스는 하이픈이 아니라 U+2212로, 숫자 옆에서 폭이 맞는다.
function formatChange(change: number): string {
  const percent = Math.round(change * 100)
  return percent >= 0 ? `+${percent}%` : `−${Math.abs(percent)}%`
}
