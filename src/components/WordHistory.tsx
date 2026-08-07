import { summariseHistory } from '../lib/history'
import type { HistoryPoint } from '../lib/history'

interface WordHistoryProps {
  points: HistoryPoint[]
  /**
   * 아래 목록에서 지금 펼쳐져 있는 날. 그 날의 점이 강조된다.
   *
   * 기본값은 마지막 점이다 — 창의 끝은 화면의 날짜이고, 목록도 그 날부터 열린다.
   */
  activeDate?: string
}

// Drawn in its own coordinate space and scaled by CSS, exactly as the donut is.
//
// **276은 임의의 숫자가 아니라 패널의 폭에서 나온 값이다.** 드로어는 `sm:w-80`
// (320px)이고 `p-4`가 양쪽에서 16px씩 가져가므로 내용 폭은 288px다. viewBox는
// 기본 `preserveAspectRatio`로 **균일 축소**되므로 — 세로가 고정이면 배율은
// min(288/276, 1) = 1 — 여기 적힌 좌표는 실제 픽셀 그대로 그려진다. 240이던 것을
// 276으로 넓힌 이유가 그것이다: 축 글자가 몇 픽셀을 더 받는 만큼 그대로 읽힌다.
const WIDTH = 276
// 선이 사는 띠. 축 글자는 이 아래 자기 띠에 따로 앉는다.
const PLOT_HEIGHT = 40
// **컨테이너 높이는 축 띠를 포함해야 한다.** 선만 겨우 들어가는 높이를 잡으면
// 축 글자가 잘리거나 카드 안에 작은 세로 스크롤이 생긴다 — dataviz가 이름 붙여 둔
// 실패 방식 그대로다. 그래서 HEIGHT는 둘의 합이고 `h-16`이 그 값(64px)이다.
const AXIS_HEIGHT = 24
const HEIGHT = PLOT_HEIGHT + AXIS_HEIGHT
// 가장자리 점의 글자가 잘리지 않도록 라벨 반폭만큼 안으로 들인다. 가장 넓은
// 라벨은 `12/25`로 9.5px 글자에서 24px 남짓이다.
const PAD_X = 16
const PAD_Y = 4
/**
 * 축 라벨 하나가 차지해야 하는 최소 가로 칸.
 *
 * 아카이브가 자라면 점은 최대 `HISTORY_WINDOW`(14)개가 되고 그때 점 간격은
 * 18.5px로 좁아진다 — 라벨을 전부 적으면 글자끼리 붙는다. 그래서 라벨은 **건너뛴다**.
 * 오늘(8일)은 간격이 34.9px라 건너뛰는 것이 없고, 14일이 되면 한 칸씩 걸러 7개가
 * 적힌다. 숫자를 하나 고르는 대신 규칙을 두는 이유는 이것이 날 수에 따라 저절로
 * 바뀌어야 하는 값이기 때문이다.
 */
const LABEL_SLOT = 34

/**
 * 한 단어가 수집된 날들을 지나오며 그날의 몇 퍼센트를 차지했는지.
 *
 * **세로축은 점유율이지 건수가 아니다.** 하루 깊이가 691에서 4,218까지 벌어져
 * 있고 2026-08-07에는 수집 상한이 150에서 300으로 바뀌었으므로, 건수를 그리면
 * 뉴스가 아니라 수집량이 그려진다. 이 규칙은 `surge.ts`가 측정으로 정해 둔 것이고
 * 여기서는 그것을 아카이브 전체로 늘릴 뿐이다.
 *
 * **그런데 축에 적히는 숫자는 건수다. 둘이 다르다는 것을 캡션이 말한다.** 폭염을
 * 예로 들면 2026-08-07은 194건, 08-04는 185건으로 건수가 거의 같은데 그날의 전체
 * 기사 수가 2,949와 4,218이라 점유율은 6.6%와 4.4%로 벌어진다 — 즉 **더 적은 건수의
 * 점이 더 높이 앉는 일이 실제로 일어난다.** 높이를 건수로 바꾸는 것은 위 규칙이
 * 금지하고, 숫자를 점유율로 바꾸면 "몇 건인지"를 답하지 않게 되므로, 남는 답은
 * 둘 다 보여 주고 무엇이 무엇인지 글자로 적는 것뿐이다.
 *
 * **사실은 전부 캡션의 글자가 진다.** 도넛에서와 같은 이유다 — 이 저장소의 잉크는
 * 캔버스 위의 *글자*로서 대비 4.5:1과 색상 40° 간격에 묶여 있어 도형 칠에 좋은
 * 색과 반대 방향이고, 그래서 색만으로 무엇을 지시해서는 안 된다. 오르내림은
 * 부호(+/−)로도 적히고, svg는 `aria-hidden`이다 — 축 글자까지 포함해서. 같은
 * 날짜와 같은 건수는 바로 아래 날짜별 목록의 머리글이 진짜 텍스트로 다시 말하고,
 * **그쪽이 이 그림의 표 대응물이자 유일한 조작 지점이다.** 점을 누를 수 있게
 * 만들지 않는 것은 그래서다: `aria-hidden` 안에 초점 받는 요소를 두는 것이 되고,
 * 목록 머리글이 이미 같은 일을 접근 가능하게 한다.
 */
export function WordHistory({ points, activeDate }: WordHistoryProps) {
  // 점 하나는 궤적이 아니다. 평평한 점 하나는 "이 단어는 내내 그대로였다"고
  // 주장하는데, 실제로 일어난 일은 비교할 것이 없다는 것이다.
  if (points.length < 2) return null

  const summary = summariseHistory(points)

  // 최대 점유율로 정규화한다. 0을 바닥으로 삼는 것은 이 그림이 "그날의 몇 퍼센트"를
  // 말하기 때문이다 — 최솟값을 바닥으로 잡으면 잔잔한 변화가 절벽처럼 보인다.
  // 엣지 굵기가 0이 아니라 0.3에서 정규화되는 것과는 반대 방향의 판단이고, 이유도
  // 반대다: 거기서는 쓰이지 않는 아래쪽이 있었고 여기서는 0이 실제 값이다.
  const peak = Math.max(...points.map((point) => point.share))
  const step = (WIDTH - PAD_X * 2) / (points.length - 1)
  const y = (value: number) =>
    PLOT_HEIGHT - PAD_Y - (peak > 0 ? (value / peak) * (PLOT_HEIGHT - PAD_Y * 2) : 0)

  // 라벨을 몇 칸씩 건너뛸지. 마지막 점부터 세는 것이 요점이다 — 화면의 날짜는
  // 어떤 간격에서도 반드시 적힌다.
  const stride = Math.max(1, Math.ceil(LABEL_SLOT / step))
  const lastIndex = points.length - 1

  const placed = points.map((point, index) => ({
    ...point,
    x: PAD_X + index * step,
    y: y(point.share),
    labelled: (lastIndex - index) % stride === 0,
  }))
  const line = placed.map((point) => `${point.x},${point.y}`).join(' ')
  const active =
    placed.find((point) => point.date === activeDate) ?? placed[placed.length - 1]

  return (
    <figure className="mb-4 border-b border-line pb-4">
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        className="h-16 w-full"
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
            r={point === active ? 3 : 1.75}
            style={{
              fill: point === active ? 'var(--color-ink)' : 'var(--color-ink-faint)',
            }}
          />
        ))}
        {/* 축 띠. 날짜가 윗줄, 건수가 아랫줄이고 둘 다 점 위에 중앙 정렬된다.
            점 **위쪽**에 얹지 않는 이유는 골짜기에 앉은 점의 숫자가 그 위를
            지나는 선에 깔리기 때문이다 — 띠로 내리면 그 충돌이 아예 생기지 않고,
            대신 자릿수가 세로로 맞아 표처럼 읽힌다(그래서 tabular-nums다). */}
        {placed
          .filter((point) => point.labelled)
          .map((point) => (
            <g key={point.date} style={{ fontVariantNumeric: 'tabular-nums' }}>
              <text
                x={point.x}
                y={PLOT_HEIGHT + 10}
                textAnchor="middle"
                fontSize={9.5}
                style={{ fill: 'var(--color-ink-faint)' }}
              >
                {shortDay(point.date)}
              </text>
              <text
                x={point.x}
                y={PLOT_HEIGHT + 21}
                textAnchor="middle"
                fontSize={9.5}
                fontWeight={point === active ? 600 : 400}
                style={{
                  fill:
                    point === active ? 'var(--color-ink)' : 'var(--color-ink-muted)',
                }}
              >
                {point.count}
              </text>
            </g>
          ))}
      </svg>
      <figcaption className="mt-2 space-y-0.5 text-xs text-ink-muted">
        <p>
          <span className="tabular-nums">
            {summary.days}일 중 {summary.daysPresent}일
          </span>
          {summary.isNew && <> · 오늘 새로 등장</>}
          {!summary.isNew && summary.change !== null && (
            <> · 전날 대비 <span className="tabular-nums">{formatChange(summary.change)}</span></>
          )}
        </p>
        {/* 숫자와 높이가 서로 다른 것을 재고 있다는 사실 자체가 캡션이다. 이 줄이
            없으면 185가 194보다 높이 앉은 것이 오류로 읽힌다. */}
        <p className="text-ink-faint">숫자는 그날 기사 수, 높이는 그날 전체 대비 비중</p>
      </figcaption>
    </figure>
  )
}

// `M/D`. Intl을 쓰지 않는 이유는 `history.ts`가 날짜를 문자열로만 다루는 이유와
// 같다 — 여기 오는 값은 이미 서버가 정한 KST 달력 날짜라 Date를 만들면 시간대가
// 딸려 들어올 뿐이고, ko-KR의 numeric 형식은 `8. 7.`이라 축에 쓰기에도 나쁘다.
function shortDay(iso: string): string {
  const [, month, day] = iso.split('-')
  return `${Number(month)}/${Number(day)}`
}

// 부호를 반드시 적는다 — 오르내림이 색으로만 구별되면 안 되고, 그것이 이 차트가
// dataviz의 색 기준을 통과하지 못하는 팔레트 위에서 정직할 수 있는 방법이다.
// 마이너스는 하이픈이 아니라 U+2212로, 숫자 옆에서 폭이 맞는다.
function formatChange(change: number): string {
  const percent = Math.round(change * 100)
  // Math.round(-0.3) is -0, which passes `>= 0` — so a small decline between
  // -0.5% and 0% would otherwise print as a rise. -0 === 0 in JS, so this
  // check has to come first rather than be folded into the sign branch below.
  if (percent === 0) return '0%'
  return percent > 0 ? `+${percent}%` : `−${Math.abs(percent)}%`
}
