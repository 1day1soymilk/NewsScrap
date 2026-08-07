import { useEffect, useId, useMemo } from 'react'
import type { Category, HeadlineSummary } from '../lib/types'
import { formatDate } from '../lib/formatDate'
import { sectionColor } from '../lib/sectionColors'
import { WordHistory } from './WordHistory'
import type { HistoryPoint } from '../lib/history'

/**
 * 하루치 목록과 그 하루의 상태.
 *
 * 로딩과 오류가 날짜별인 것은 요청이 날짜별이기 때문이다. 여러 날을 한 요청으로
 * 받지 않는 이유는 크기다 — 폭염은 아카이브 9일에 952건이라 한 번에 받으면
 * PostgREST의 1,000행 캡에 앉아 말없이 잘린다.
 */
export interface DayHeadlines {
  headlines: HeadlineSummary[]
  loading: boolean
  error: string | null
}

const NO_DAYS: ReadonlyMap<string, DayHeadlines> = new Map()
const NO_OPEN: ReadonlySet<string> = new Set()
const EMPTY_DAY: DayHeadlines = { headlines: [], loading: false, error: null }

interface HeadlinePanelProps {
  /** 무엇에 대한 목록인가. null이면 패널이 닫힌다. */
  subject: string | null
  /** 사건의 이름은 단어 목록이므로 따옴표를 두르지 않는다. */
  isEvent?: boolean
  /**
   * 날짜별 목록. 구획 없이 그리는 경우(사건, 그리고 창 안 어느 날에도 그 단어가
   * 없는 경우)는 `activeDate` 한 칸만 읽는다 — 출처가 둘이 아니라 하나다.
   */
  days?: ReadonlyMap<string, DayHeadlines>
  /** 화면의 날짜. 구획을 쓰지 않을 때 그려지는 날이다. */
  activeDate: string
  /** In tab order, which is what the list groups by. */
  categories: Category[]
  onClose: () => void
  /**
   * The subject word's share across the collected days. Empty for an event —
   * event identity is not defined across days here, so there is no line to
   * draw.
   *
   * 이것은 스파크라인의 입력이면서 **동시에 아래 목록의 날짜 구획이다.** 두 개가
   * 아니라 하나인 이유는 그 둘이 같은 날 집합을 말해야 하기 때문이다: 창을 두 번
   * 계산하면 선의 점과 목록의 칸이 어긋날 수 있고, 어긋난 것은 화면에서 틀려
   * 보이지 않는다.
   */
  history?: HistoryPoint[]
  /**
   * 지금 펼쳐져 있는 날들. 각 날은 독립적으로 여닫히고, **기본은 전부 닫힘**이다.
   *
   * 집합인 것이 요점이다. 열린 날 하나를 문자열로 들고 있으면 같은 줄을 다시
   * 눌러도 값이 안 바뀌어 토글이 표현되지 않고, 전부 닫힌 상태를 만들 방법이
   * 아예 없다.
   */
  openDates?: ReadonlySet<string>
  onToggleDate?: (date: string) => void
  /**
   * The subject is a word the sieve did not draw on this day — reached by
   * search rather than by clicking the canvas. Saying so is what stops the
   * canvas looking broken for not lighting anything.
   */
  offCanvas?: boolean
}

export function HeadlinePanel({
  subject,
  isEvent = false,
  days = NO_DAYS,
  activeDate,
  categories,
  onClose,
  history = [],
  openDates = NO_OPEN,
  onToggleDate,
  offCanvas = false,
}: HeadlinePanelProps) {
  const open = subject !== null
  const heading = isEvent ? `${subject} 관련 헤드라인` : `"${subject}" 관련 헤드라인`
  const sectionId = useId()

  // Registered only while the panel is open, so Escape stays free for anything
  // else on the page the rest of the time.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const labels = useMemo(
    () => new Map(categories.map((category) => [category.slug, category.label])),
    [categories],
  )

  // 정렬과 중복 제거는 날짜별로 한다. 날을 가로질러 중복이 나올 일은 없다 —
  // `UNIQUE (category_id, link)`가 전역이라 한 기사는 한 날에만 앉는다 — 그래서
  // 이것은 날짜별로 쪼갠 것이지 규칙이 바뀐 것이 아니다.
  const sorted = useMemo(() => {
    const out = new Map<string, DayHeadlines>()
    for (const [date, day] of days) {
      out.set(date, { ...day, headlines: sortHeadlines(dedupe(day.headlines), categories) })
    }
    return out
  }, [days, categories])

  // 최신이 위. 선은 왼쪽에서 오른쪽으로 시간이 흐르고 목록은 위에서 아래로 흐르는데,
  // 목록에서 먼저 읽고 싶은 것은 오늘이다.
  //
  // **그 단어가 없던 날은 줄 자체가 없다.** 8월 3일 아래에 바로 8월 1일이 온다.
  // 열 것이 없는 줄은 열리지도 않는데, 비활성 컨트롤과 "기사 없음" 표식으로 자리를
  // 차지하면 읽을 것이 있는 날들 사이를 벌려 놓기만 한다. 궤적은 반대로 없는 날도
  // 계속 그린다 — 점유율 0인 날은 선의 일부이고, 빼면 "그날 없었다"가 "그날이
  // 없었다"로 바뀐다.
  //
  // **사건에는 날짜 구획이 없다.** 사건의 신원은 날 사이에 정의돼 있지 않으므로
  // (루뱅 분할은 하루짜리다) 어제의 같은 이름 사건이라는 것이 없고, 따라서 나눌
  // 날도 없다. 궤적이 단어에만 붙는 것과 정확히 같은 이유다.
  const rows = useMemo(
    () => (isEvent ? [] : history.filter((day) => day.present).reverse()),
    [isEvent, history],
  )

  // **판정은 "그릴 줄이 하나라도 있는가"이지 "무엇이 펼쳐져 있는가"가 아니다.**
  // 펼친 것으로 판정하면 기본값인 전부 닫힘이 곧바로 평평한 목록으로 튀어, 전부
  // 닫는 것이 불가능해진다.
  //
  // 줄이 없는 경우는 둘뿐이다: 사건, 그리고 창 안 어느 날에도 그 단어가 없는
  // 경우 — 아직 수집되지 않은 오늘에 검색으로 닿았을 때다. 그때는 예전처럼 화면의
  // 날짜를 평평하게 그리고, 그 목록이 "관련 헤드라인이 없습니다"를 제대로 말한다.
  const sectioned = rows.length > 0

  // 머리글의 수는 언제나 **지금 아래에 깔린 줄 수**다. 아직 받는 중이거나 실패한
  // 날은 셀 것이 없으므로 빠진다.
  const shownCount = useMemo(() => {
    const counted = sectioned ? [...openDates] : [activeDate]
    let total = 0
    for (const date of counted) {
      const day = sorted.get(date)
      if (day && !day.loading && !day.error) total += day.headlines.length
    }
    return total
  }, [sectioned, openDates, activeDate, sorted])

  if (!open) return null

  return (
    // Bottom sheet on a phone, side drawer from `sm` up. The fixed 320px drawer
    // it replaces covered most of the graph on a narrow screen, so clicking a
    // word hid the thing that had just been clicked.
    //
    // Starting below the toolbar rather than at sm:top-0: the toolbar is sticky,
    // and a panel starting at the top of the viewport covered the date and the
    // tabs, so choosing a word took away the controls for choosing a different
    // one. The offset is --header-height from src/index.css rather than a literal,
    // because the toolbar wraps to two rows below lg and any single hard-coded
    // value is wrong on one side of that breakpoint.
    <aside
      className="fixed inset-x-0 bottom-0 z-20 max-h-[70svh] overflow-y-auto rounded-t-xl border-t border-line bg-surface p-4 shadow-lg sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-(--header-height) sm:max-h-none sm:w-80 sm:rounded-none sm:border-l sm:border-t-0"
      aria-label={heading}
    >
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">
          {heading}
          {/* **여기 적히는 수는 언제나 "지금 아래에 깔린 줄 수"다.** 궤적이 아는
              그날의 건수를 여기 적으면 섹션 탭이 켜졌을 때 — 목록은 그 섹션으로
              좁혀지고 궤적은 규칙상 여섯 섹션 전부를 세므로 — 머리글이 목록보다
              큰 수를 말하게 된다. 그날 전체 건수는 스파크라인의 축이 지고, 그쪽은
              캡션이 무엇을 센 수인지 적어 둔다. 한 수는 한 곳에서만 적는다.
              아무 날도 안 열린 기본 상태에서 이 수가 0이 되어 사라지는 것은
              그 규칙의 결과이지 예외가 아니다. */}
          {shownCount > 0 && (
            <span className="ml-2 font-sans text-sm font-normal text-ink-faint">
              {shownCount}건
            </span>
          )}
        </h2>
        <button onClick={onClose} className="shrink-0 text-ink-faint hover:text-ink">
          닫기
        </button>
      </div>

      {offCanvas && (
        <p className="mb-3 text-xs text-ink-faint">
          이 날 화면에는 없는 단어입니다.
        </p>
      )}

      {!isEvent && <WordHistory points={history} openDates={openDates} />}

      {!sectioned ? (
        <DayList day={sorted.get(activeDate) ?? EMPTY_DAY} labels={labels} />
      ) : (
        <ul>
          {rows.map((day) => {
            const isOpen = openDates.has(day.date)
            const id = `${sectionId}-${day.date}`
            return (
              <li key={day.date} className="border-b border-line last:border-0">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={id}
                  onClick={() => onToggleDate?.(day.date)}
                  className="flex w-full items-center gap-2 py-2.5 text-left text-sm"
                >
                  <span
                    aria-hidden="true"
                    className={`shrink-0 text-xs text-ink-faint transition-transform ${
                      isOpen ? 'rotate-90' : ''
                    }`}
                  >
                    ▶
                  </span>
                  <span className={isOpen ? 'font-semibold text-ink' : 'text-ink-muted'}>
                    {formatDate(day.date).day}
                  </span>
                </button>
                {isOpen && (
                  <div id={id} className="pb-3">
                    <DayList day={sorted.get(day.date) ?? EMPTY_DAY} labels={labels} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}

function DayList({ day, labels }: { day: DayHeadlines; labels: Map<string, string> }) {
  return (
    <HeadlineList
      headlines={day.headlines}
      labels={labels}
      loading={day.loading}
      error={day.error}
    />
  )
}

function HeadlineList({
  headlines,
  labels,
  loading,
  error,
}: {
  headlines: HeadlineSummary[]
  labels: Map<string, string>
  loading: boolean
  error: string | null
}) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    )
  }
  if (loading) return <HeadlineSkeleton />
  if (headlines.length === 0) {
    return <p className="text-sm text-ink-muted">관련 헤드라인이 없습니다.</p>
  }

  return (
    <ul>
      {headlines.map((headline) => (
        <li key={headline.id} className="border-b border-line py-3 first:pt-0 last:border-0">
          {/* The section reads as the same dot the tab row and the canvas
              use, rather than as a pill of its own. On a word that ran in
              one section the old chips were a column of identical badges
              down the panel, each one louder than the headline beside it. */}
          <p className="mb-1 flex items-center gap-1.5 text-xs text-ink-faint">
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: sectionColor(headline.category_slug) }}
            />
            {labels.get(headline.category_slug) ?? headline.category_slug}
          </p>
          {/* Ink, not --color-top-story. A headline is not the day's biggest
              event, and painting every link in that blue meant the one
              colour on the page that names something specific also meant
              "this is a link". Outside the anchor stays outside it: the
              accessible name has to be the headline and nothing else. */}
          <a
            href={headline.link}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-ink-faint"
          >
            {headline.title}
          </a>
        </li>
      ))}
    </ul>
  )
}

// Holds the shape of the list rather than collapsing to a line of text, so the
// panel does not jump when the rows arrive.
function HeadlineSkeleton() {
  return (
    <div data-testid="headline-skeleton" aria-busy="true" aria-label="불러오는 중" className="space-y-4">
      {[0, 1, 2].map((row) => (
        <div key={row} className="space-y-2">
          <div className="h-4 w-12 animate-pulse rounded-full bg-line" />
          <div className="h-3.5 w-full animate-pulse rounded bg-line" />
          <div className="h-3.5 w-3/5 animate-pulse rounded bg-line" />
        </div>
      ))}
    </div>
  )
}

// Naver serves one article under two paths — /mnews/article/421/0009091462 and
// /article/421/0009091462 — but that no longer produces two rows: canonicalLink
// (lib/headlines.ts) folds both into one before insert, and migration 0007
// cleaned up the archive rows that had already leaked through. What this
// function still collapses is a genuinely different case — one article listed
// under two sections, which is two legitimate rows with two different links,
// and the panel should still show it once.
//
// The identity is the press id and the article id at the end of the path, so
// that is the key. Keyed on the link rather than on the title because two
// genuinely different articles can carry the same headline.
//
// dedupe() runs before sortHeadlines() below, on rows PostgREST returns in
// arbitrary order, so for that one cross-section article which of its two
// section badges survives is not deterministic.
function articleKey(headline: HeadlineSummary): string {
  const path = (headline.link ?? '').split('?')[0]
  const match = path.match(/(\d+)\/(\d+)\/?$/)
  return match ? `${match[1]}/${match[2]}` : headline.link || headline.id
}

function dedupe(headlines: HeadlineSummary[]): HeadlineSummary[] {
  const seen = new Set<string>()
  return headlines.filter((headline) => {
    const key = articleKey(headline)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// PostgREST hands these back in whatever order the join produced, which
// reshuffles between loads of the same word. Section first so the badges come
// in runs, then title so the order is fixed.
function sortHeadlines(headlines: HeadlineSummary[], categories: Category[]): HeadlineSummary[] {
  const rank = new Map(categories.map((category, index) => [category.slug, index]))
  // A slug with no matching category sorts last instead of colliding with the
  // first one at index 0.
  const rankOf = (slug: string) => rank.get(slug) ?? categories.length

  return [...headlines].sort(
    (a, b) =>
      rankOf(a.category_slug) - rankOf(b.category_slug) ||
      a.title.localeCompare(b.title, 'ko'),
  )
}
