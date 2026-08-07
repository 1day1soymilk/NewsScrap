import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HeadlinePanel } from './HeadlinePanel'
import type { DayHeadlines } from './HeadlinePanel'
import type { HistoryPoint } from '../lib/history'
import type { Category, HeadlineSummary } from '../lib/types'

// Ordered by section_id, which is the order fetchCategories() returns.
const CATEGORIES: Category[] = [
  { id: '1', slug: 'politics', label: '정치' },
  { id: '2', slug: 'economy', label: '경제' },
  { id: '3', slug: 'society', label: '사회' },
]

function headline(
  id: string,
  title: string,
  category_slug: string,
  link = `https://example.com/${id}`,
): HeadlineSummary {
  return { id, title, link, category_slug }
}

// 화면의 날짜. 구획을 쓰지 않는 목록은 이 한 칸을 읽는다.
const TODAY = '2026-08-08'

function day(partial: Partial<DayHeadlines> = {}): DayHeadlines {
  return { headlines: [], loading: false, error: null, ...partial }
}

type PanelProps = Parameters<typeof HeadlinePanel>[0]

// `headlines` / `loading` / `error`는 이제 컴포넌트의 prop이 아니라 하루의 상태다.
// 구획 없는 목록을 보는 테스트가 대부분이므로, 그 셋을 받아 화면의 날짜 한 칸으로
// 접어 준다 — 테스트가 말하려는 것이 "이 하루가 이렇게 생겼을 때"라서다.
type Flat = { headlines?: HeadlineSummary[]; loading?: boolean; error?: string | null }

function renderPanel({ headlines, loading, error, ...props }: Partial<PanelProps> & Flat = {}) {
  return render(
    <HeadlinePanel
      subject="예산안"
      activeDate={TODAY}
      days={
        new Map([
          [TODAY, day({ headlines: headlines ?? [], loading: loading ?? false, error: error ?? null })],
        ])
      }
      categories={CATEGORIES}
      onClose={vi.fn()}
      {...props}
    />,
  )
}

describe('HeadlinePanel', () => {
  it('renders nothing when no word is selected', () => {
    const { container } = renderPanel({ subject: null })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders headline titles as links to the original article', () => {
    renderPanel({ headlines: [headline('h1', '여야 예산안 처리', 'politics', 'https://example.com/a')] })

    const link = screen.getByRole('link', { name: '여야 예산안 처리' })
    expect(link).toHaveAttribute('href', 'https://example.com/a')
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    renderPanel({ onClose })
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    renderPanel({ onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('does not listen for Escape once it is closed', () => {
    const onClose = vi.fn()
    renderPanel({ subject: null, onClose })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows a skeleton while the headlines are loading', () => {
    renderPanel({ loading: true })
    expect(screen.getByTestId('headline-skeleton')).toBeInTheDocument()
    // The empty state and the loading state are different answers to "why is
    // this list blank"; showing both at once would say neither.
    expect(screen.queryByText('관련 헤드라인이 없습니다.')).not.toBeInTheDocument()
  })

  it('shows an empty state when the word has no headlines', () => {
    renderPanel({ headlines: [] })
    expect(screen.getByText('관련 헤드라인이 없습니다.')).toBeInTheDocument()
    expect(screen.queryByTestId('headline-skeleton')).not.toBeInTheDocument()
  })

  it('shows the error instead of the list when the query failed', () => {
    renderPanel({ error: 'mocked failure (PGRST500)' })
    expect(screen.getByRole('alert')).toHaveTextContent('mocked failure (PGRST500)')
    expect(screen.queryByText('관련 헤드라인이 없습니다.')).not.toBeInTheDocument()
  })

  it('badges each headline with its section label', () => {
    renderPanel({ headlines: [headline('h1', '금리 동결', 'economy')] })
    const item = screen.getByRole('listitem')
    expect(within(item).getByText('경제')).toBeInTheDocument()
  })

  it('falls back to the slug when the category list has not loaded', () => {
    renderPanel({ headlines: [headline('h1', '금리 동결', 'economy')], categories: [] })
    expect(screen.getByText('economy')).toBeInTheDocument()
  })

  // PostgREST returns these rows in whatever order the join produced, which
  // reshuffles between loads of the same word. Grouping by section and then
  // going alphabetical is stable, and puts the badges in runs instead of
  // scattering them.
  it('groups by section in tab order, then sorts by title', () => {
    renderPanel({
      headlines: [
        headline('h1', '나 사회 기사', 'society'),
        headline('h2', '가 경제 기사', 'economy'),
        headline('h3', '다 정치 기사', 'politics'),
        headline('h4', '가 사회 기사', 'society'),
      ],
    })

    const titles = screen.getAllByRole('link').map((link) => link.textContent)
    expect(titles).toEqual(['다 정치 기사', '가 경제 기사', '가 사회 기사', '나 사회 기사'])
  })

  it('puts an unknown section last rather than dropping it', () => {
    renderPanel({
      headlines: [headline('h1', '미분류', 'sports'), headline('h2', '정치 기사', 'politics')],
    })

    const titles = screen.getAllByRole('link').map((link) => link.textContent)
    expect(titles).toEqual(['정치 기사', '미분류'])
  })

  it('counts the headlines it is showing', () => {
    renderPanel({
      headlines: [headline('h1', '가', 'politics'), headline('h2', '나', 'politics')],
    })
    expect(screen.getByText('2건')).toBeInTheDocument()
  })

  it('사건 이름에는 따옴표를 두르지 않는다', () => {
    renderPanel({ subject: '폭염 · 양산 · 한반도 · 에어컨', isEvent: true })
    expect(
      screen.getByRole('heading', { name: /폭염 · 양산 · 한반도 · 에어컨 관련 헤드라인/ }),
    ).toBeInTheDocument()
  })

  it('shows the trajectory above the headlines for a word', () => {
    renderPanel({
      subject: '폭염',
      history: [
        { date: '2026-08-03', count: 4, share: 0.1, present: true },
        { date: '2026-08-04', count: 12, share: 0.2, present: true },
      ],
    })
    expect(screen.getByText(/2일 중 2일/)).toBeInTheDocument()
  })

  // An event is not a thing that persists across days here: the Louvain
  // partition is per day and mergeCommunities runs on one day's edges, so
  // nothing can say yesterday's event and today's are the same event.
  //
  // history holds a real two-point series here on purpose. WordHistory
  // returns null for anything under two points regardless of isEvent, so an
  // empty array cannot tell "suppressed because isEvent" apart from
  // "suppressed because there is nothing to draw" — this failed to catch
  // `!isEvent &&` being deleted from HeadlinePanel.tsx when it passed `[]`.
  it('shows no trajectory for an event', () => {
    renderPanel({
      subject: '김민석 · 정청래',
      isEvent: true,
      history: [
        { date: '2026-08-03', count: 4, share: 0.1, present: true },
        { date: '2026-08-04', count: 12, share: 0.2, present: true },
      ],
    })
    expect(screen.queryByText(/일 중 /)).not.toBeInTheDocument()
  })

  it('says when the word is not among the words drawn that day', () => {
    renderPanel({ subject: '유상증자', offCanvas: true })
    expect(screen.getByText(/이 날 화면에는 없는 단어/)).toBeInTheDocument()
  })

  it('says nothing of the sort for a word that is drawn', () => {
    renderPanel({ subject: '폭염' })
    expect(screen.queryByText(/이 날 화면에는 없는 단어/)).not.toBeInTheDocument()
  })
})

// 궤적이 지나온 날들이 그대로 목록의 칸이 된다. 각 칸은 독립적으로 여닫히고
// **기본은 전부 닫힘**이다 — 여러 날을 한 요청으로 받지 않는 것은 크기 때문이고
// (폭염은 아카이브 9일에 952건이라 1,000행 캡에 앉는다), 하루씩 받는 것은 캡이
// 구조적으로 못 걸린다.
describe('HeadlinePanel 날짜 구획', () => {
  const DAYS: HistoryPoint[] = [
    { date: '2026-08-05', count: 0, share: 0, present: false },
    { date: '2026-08-06', count: 7, share: 0.1, present: true },
    { date: '2026-08-07', count: 12, share: 0.2, present: true },
  ]

  const ROWS = new Map([
    ['2026-08-06', day({ headlines: [headline('h0', '어제 유가', 'economy')] })],
    ['2026-08-07', day({ headlines: [headline('h1', '유가 급등', 'economy')] })],
  ])

  function renderDays(props: Partial<PanelProps> = {}) {
    return render(
      <HeadlinePanel
        subject="호르무즈"
        activeDate="2026-08-07"
        history={DAYS}
        days={ROWS}
        categories={CATEGORIES}
        onClose={vi.fn()}
        {...props}
      />,
    )
  }

  function rowNames() {
    return screen
      .getAllByRole('button', { name: /월 \d+일/ })
      .map((row) => row.textContent?.match(/\d+월 \d+일/)?.[0])
  }

  // 최신이 위. 선은 왼쪽에서 오른쪽으로 흐르지만, 목록에서 먼저 읽고 싶은 것은
  // 오늘이다.
  //
  // **그 단어가 없던 날은 줄이 아예 없다** — 8월 7일 아래에 바로 8월 5일이 아니라
  // 아무것도 없이 8월 6일이 오고, 08-05는 목록에서 사라진다. 열 것이 없는 줄이
  // 비활성 컨트롤과 "기사 없음" 표식으로 자리만 차지하면 읽을 것이 있는 날들 사이가
  // 벌어질 뿐이다.
  it('gives a row only to the days the word appeared on, newest first', () => {
    renderDays()
    expect(rowNames()).toEqual(['8월 7일', '8월 6일'])
    expect(screen.queryByText(/8월 5일/)).not.toBeInTheDocument()
    expect(screen.queryByText('기사 없음')).not.toBeInTheDocument()
  })

  // 궤적은 반대다: 없는 날도 점으로 남는다. 점유율 0인 날을 빼면 "그날 없었다"가
  // "그날이 없었다"로 바뀐다. 8일이 아니라 3일을 세고 있는지로 본다.
  it('still counts the absent day in the trajectory', () => {
    renderDays()
    expect(screen.getByText(/3일 중 2일/)).toBeInTheDocument()
  })

  // 기본은 전부 닫힘. 패널을 열었다고 해서 하루치가 저절로 깔리지 않는다 —
  // 읽고 싶은 날을 고르는 것은 읽는 사람이다.
  it('starts with every day closed and nothing listed', () => {
    renderDays()
    for (const row of screen.getAllByRole('button', { name: /월 \d+일/ })) {
      expect(row).toHaveAttribute('aria-expanded', 'false')
    }
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    // 아래 깔린 줄이 없으므로 머리글의 건수도 없다.
    expect(screen.queryByText(/\d+건/)).not.toBeInTheDocument()
  })

  // 열린 날의 기사만 깔린다. 다른 날의 기사가 같이 보이면 "날짜별로 구분"이 아니라
  // 그냥 섞인 목록에 머리글만 붙은 것이 된다.
  it('lists the headlines under the open day only', () => {
    renderDays({ openDates: new Set(['2026-08-07']) })
    expect(screen.getByRole('button', { name: /8월 7일/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('button', { name: /8월 6일/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['유가 급등'])
  })

  // 한 번에 하나가 아니다. 두 날이 동시에 열리고, 머리글의 건수는 그 둘의 합이다 —
  // 그 수는 언제나 "지금 아래에 깔린 줄 수"다.
  it('opens two days at once and counts both', () => {
    renderDays({ openDates: new Set(['2026-08-06', '2026-08-07']) })
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      '유가 급등',
      '어제 유가',
    ])
    expect(screen.getByText('2건')).toBeInTheDocument()
  })

  // **이것이 버그였다.** 열려 있는 줄을 다시 눌러도 아무 일이 없어서, 닫으려면 다른
  // 날로 옮기는 수밖에 없었고 전부 닫힌 상태를 만들 방법이 없었다. 열림/닫힘에
  //상관없이 그 날짜로 토글을 부른다는 것이 이 컴포넌트의 계약이고, 집합이 실제로
  // 오가는 것은 App의 배선이라 e2e가 본다.
  it('asks to toggle the day whether it is open or shut', () => {
    const onToggleDate = vi.fn()
    renderDays({ openDates: new Set(['2026-08-07']), onToggleDate })

    fireEvent.click(screen.getByRole('button', { name: /8월 6일/ }))
    expect(onToggleDate).toHaveBeenCalledWith('2026-08-06')

    fireEvent.click(screen.getByRole('button', { name: /8월 7일/ }))
    expect(onToggleDate).toHaveBeenCalledWith('2026-08-07')
  })

  // 스켈레톤과 오류는 날짜별이다. 한 날이 아직 오는 중이어도 다른 날은 읽힌다.
  it('waits, fails and reads per day rather than all at once', () => {
    renderDays({
      openDates: new Set(['2026-08-06', '2026-08-07']),
      days: new Map([
        ['2026-08-06', day({ loading: true })],
        ['2026-08-07', day({ headlines: [headline('h1', '유가 급등', 'economy')] })],
      ]),
    })
    expect(screen.getByTestId('headline-skeleton')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '유가 급등' })).toBeInTheDocument()
    // 받는 중인 날은 셀 것이 없으므로 건수에 안 들어간다.
    expect(screen.getByText('1건')).toBeInTheDocument()
  })

  // 창 안 어느 날에도 그 단어가 없으면 그릴 줄이 하나도 없다 — 아직 수집되지 않은
  // 오늘에 검색으로 닿았을 때가 그렇다. 그러면 예전처럼 화면의 날짜를 평평하게
  // 그리고, 그 목록이 "관련 헤드라인이 없습니다"를 제대로 말한다.
  it('falls back to a flat list when the word appeared on no collected day', () => {
    renderDays({
      history: [
        { date: '2026-08-06', count: 0, share: 0, present: false },
        { date: '2026-08-07', count: 0, share: 0, present: false },
      ],
    })
    expect(screen.queryByRole('button', { name: /월 \d+일/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '유가 급등' })).toBeInTheDocument()
  })

  it('shows no date rows for an event', () => {
    renderDays({ subject: '김민석 · 정청래', isEvent: true })
    expect(screen.queryByRole('button', { name: /월 \d+일/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '유가 급등' })).toBeInTheDocument()
  })
})
