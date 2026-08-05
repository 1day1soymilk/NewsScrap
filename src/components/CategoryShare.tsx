import { sectionColor } from '../lib/sectionColors'
import type { CategoryShare as CategoryShareRow } from '../lib/queries'

interface CategoryShareProps {
  share: CategoryShareRow[]
  /** Slug → the section's Korean name. `Category` from the app, narrowed. */
  categories: { slug: string; label: string }[]
}

// The ring. 12 o'clock, clockwise, drawn in a square viewBox and scaled by CSS.
const SIZE = 128
const CENTRE = SIZE / 2
const OUTER = 60
const INNER = 38
const MID = (OUTER + INNER) / 2

// **The 2px gap is the separator, not a stroke.** A border drawn around each arc
// would add ink that is not data; a gap in the ground colour separates the fills
// and costs nothing. 2px is the measured spec, converted to an angle at the ring's
// mid radius so the gap looks the same width all the way round.
const GAP = 2 / MID

// A section that produced almost nothing still gets a visible mark. Vanishing is
// the one failure a chart about proportions cannot have — "0.2% of the day" and
// "absent from the archive" are different claims and must not look alike.
const MIN_SWEEP = 0.012

const TAU = Math.PI * 2

/**
 * 정수 퍼센트로 나누되 합을 정확히 100으로 맞춘다(최대잉여법).
 *
 * **나머지는 정수로 센다.** 소수부를 부동소수로 비교하면 4/12와 1/12의 소수부가
 * 마지막 비트에서 갈려 — 둘 다 수학적으로는 정확히 1/3이다 — 남은 한 자리가
 * 어느 줄로 가는지가 반올림 잡음으로 정해진다. 실제로 그렇게 갈렸고, 그래서
 * 같은 하루가 브라우저에서 33%, 단위 테스트의 산수로는 34%였다. `count * 100`을
 * `total`로 나눈 몫과 나머지는 정확하고, 동률은 입력 순서로 깬다 — 입력이 이미
 * 몫 내림차순·슬러그 오름차순이므로 같은 하루는 언제나 같은 숫자를 낸다.
 */
function percentOf(counts: number[], total: number): number[] {
  const floors = counts.map((count) => Math.floor((count * 100) / total))
  let left = 100 - floors.reduce((sum, value) => sum + value, 0)

  const order = counts
    .map((count, index) => ({ index, remainder: (count * 100) % total }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)

  for (const { index } of order) {
    if (left <= 0) break
    floors[index] += 1
    left -= 1
  }
  return floors
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function point(radius: number, angle: number): [number, number] {
  return [round(CENTRE + radius * Math.sin(angle)), round(CENTRE - radius * Math.cos(angle))]
}

/** One annular sector, `from` to `to` clockwise from 12 o'clock. */
function annulus(from: number, to: number): string {
  const large = to - from > Math.PI ? 1 : 0
  const [x1, y1] = point(OUTER, from)
  const [x2, y2] = point(OUTER, to)
  const [x3, y3] = point(INNER, to)
  const [x4, y4] = point(INNER, from)
  return (
    `M ${x1} ${y1} A ${OUTER} ${OUTER} 0 ${large} 1 ${x2} ${y2} ` +
    `L ${x3} ${y3} A ${INNER} ${INNER} 0 ${large} 0 ${x4} ${y4} Z`
  )
}

/**
 * 그날 각 섹션이 실제로 낸 기사의 몫.
 *
 * **이것이 이 가지의 마지막 사용자용 조각이고, 목적은 균등화가 아니라 정직이다.**
 * 1–12번 과제가 확인한 것은 수집을 고르게 만들 수 없다는 것 — 섹션들은 정말로
 * 다른 속도로 기사를 내고, 더 깊이 넘겨도 격차는 벌어질 뿐이다 — 그리고 순위
 * 단계에서 균형을 잡아도 측정되는 이득이 없다는 것이었다. 그래서 비율 자체를
 * 내놓는다. 캔버스가 일부러 말하지 않는 몫을 여기서 한 번 말한다.
 *
 * 색은 `sectionColors.ts` 하나에서만 온다. 탭의 점과 캔버스의 글자와 이 호가
 * 같은 초록이어야 하고, 다르면 범례는 없느니만 못하다.
 *
 * **팔레트는 이 차트의 기준보다 더 엄한 기준에 이미 묶여 있다.** 여섯 잉크는
 * 캔버스 위의 *글자*라서 `theme.test.ts`가 바탕 대비 4.5:1과 색상 40° 간격을
 * 요구한다 — 도형 칠에 좋은 밝고 채도 높은 색과는 반대 방향이다. dataviz의
 * 검사기를 그대로 돌리면 인접 쌍의 CVD 분리에서 떨어지고, 그것은 팔레트를 고칠
 * 이유가 아니라 **색에만 기대지 말라는 지시**다. 그래서 여기서 신원을 지는 것은
 * 색이 아니라 범례의 글자다: 이름과 퍼센트와 건수가 전부 잉크색 텍스트로 적혀
 * 있고, 호는 그 옆에 붙은 표식일 뿐이다.
 */
export function CategoryShare({ share, categories }: CategoryShareProps) {
  // **분모는 응답의 합이고, 이것은 이 저장소가 금지한 그 합이 아니다.** 금지된
  // 것은 잘렸을 수 있는 응답을 더해 하루 총계를 지어내는 일이다. 이 응답은 날짜로
  // 걸러진 섹션당 한 행이라 구조상 여섯 행이고, 나누려는 대상 자체가 "이 섹션들의
  // 합"이다 — 잘림이 끼어들 자리가 없다.
  const total = share.reduce((sum, row) => sum + row.headlines, 0)
  if (total <= 0) return null

  const named = new Map(categories.map((category) => [category.slug, category.label]))

  // 큰 것부터. 몫을 읽는 차트이므로 순서가 곧 순위이고, 도넛이 가까운 값들을 잘
   // 구별하지 못한다는 약점은 범례의 숫자가 대신 갚는다.
  const rows = [...share]
    .filter((row) => row.headlines > 0)
    .sort((a, b) => b.headlines - a.headlines || a.slug.localeCompare(b.slug))

  const anyCapped = rows.some((row) => row.capped)

  // **최대잉여법.** 각자 반올림하면 라벨의 합이 100이 아니게 된다 — 33+25+17+8+8+8
  // 은 99이고, 몫을 말하는 차트에서 그 1은 읽는 사람이 알아차린다. 내림한 뒤 남은
  // 자리를 소수부가 큰 순서로 준다. 호는 참값 그대로이고 움직이는 것은 라벨뿐이며,
  // 대신 한 줄은 자기 참값에서 최대 1만큼 멀어진다 — 합이 맞는 쪽을 택했다.
  const percents = percentOf(rows.map((row) => row.headlines), total)

  let boundary = 0
  const arcs = rows.map((row, index) => {
    const sweep = (row.headlines / total) * TAU
    // 경계는 진짜 비율 그대로 두고, 틈은 그 경계에 **가운데를 맞춰** 판다. 그래서
    // 색이 바뀌는 자리는 정확히 참값이고, 틈이 비율을 먹지 않는다.
    const from = boundary + GAP / 2
    const to = boundary + sweep - GAP / 2
    boundary += sweep
    const drawn = to > from ? [from, to] : [
      // 틈보다 좁은 조각. 참 중심에 최소 길이의 표식을 남긴다.
      boundary - sweep / 2 - MIN_SWEEP / 2,
      boundary - sweep / 2 + MIN_SWEEP / 2,
    ]
    return {
      ...row,
      label: named.get(row.slug) ?? row.slug,
      percent: percents[index],
      d: annulus(drawn[0], drawn[1]),
    }
  })

  return (
    <figure className="my-6 flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-8">
      {/* 범례가 이름·퍼센트·건수를 전부 글자로 말하므로, 링은 같은 내용을 한 번
          더 읽어 줄 필요가 없다. 보조 기술에는 아래 목록 하나만 보인다. */}
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        className="shrink-0"
      >
        {arcs.map((arc) => (
          // fill은 presentation attribute가 아니라 inline style로 간다 —
          // 전자에서는 var()가 신뢰할 수 없다.
          //
          // data-section은 호가 무엇인지를 DOM에 적어 둔다. 없으면 이 호를 가리키는
          // 유일한 방법이 위치(nth)뿐이고, 그러면 픽스처의 가중치를 바꾸는 순간
          // 색 단정이 조용히 **다른 섹션**을 검사하게 된다.
          <path
            key={arc.slug}
            data-section={arc.slug}
            d={arc.d}
            style={{ fill: sectionColor(arc.slug) }}
          >
            <title>{`${arc.label} ${arc.percent}% (${arc.headlines.toLocaleString('ko-KR')}건)`}</title>
          </path>
        ))}
      </svg>

      <div className="min-w-0">
        <figcaption className="mb-2 text-sm text-ink-muted">
          섹션별 기사 몫
        </figcaption>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          {arcs.map((arc) => (
            <li key={arc.slug} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: sectionColor(arc.slug) }}
              />
              <span className="truncate text-ink">{arc.label}</span>
              <span className="ml-auto tabular-nums text-ink-muted">
                {arc.percent}%{arc.capped && <span aria-hidden="true">*</span>}
              </span>
              {/* **별표와 건수는 눈에만 있었다.** 별표는 aria-hidden이고 건수는
                  aria-hidden인 svg의 <title> 안에만 있어서, 캡션이 "*가 붙은
                  섹션은"이라고 말해도 스크린 리더로는 어느 섹션인지 찾을 길이
                  없었다. 두 가지를 여기서 말로 적는다. */}
              <span className="sr-only">
                , {arc.headlines.toLocaleString('ko-KR')}건
                {arc.capped && ', 수집 상한에 닿았을 수 있어 최소치'}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-faint">
          모두 {total.toLocaleString('ko-KR')}건. 몫은 <strong className="font-medium">저장된</strong>{' '}
          기사 수로 셉니다 — 이미 가진 기사를 다시 본 회차는 창을 꽉 채우고도 상한보다
          적게 저장하므로, 표시가 없는 섹션도 상한에 걸렸을 수 있습니다.
          {anyCapped && (
            <>
              {' '}
              *가 붙은 섹션은 한 회차가 수집 상한에 닿았을 수 있어, 그 몫은{' '}
              <strong className="font-medium">최소치</strong>입니다.
            </>
          )}
        </p>
      </div>
    </figure>
  )
}
