import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HeadlinePanel } from './HeadlinePanel'
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

function renderPanel(props: Partial<Parameters<typeof HeadlinePanel>[0]> = {}) {
  return render(
    <HeadlinePanel
      subject="예산안"
      headlines={[]}
      categories={CATEGORIES}
      loading={false}
      error={null}
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

// 궤적이 지나온 날들이 그대로 목록의 칸이 된다. 한 번에 한 칸만 열리는 것은 취향이
// 아니라 크기 때문이다 — 폭염은 아카이브 8일에 952건이라 한 번에 받을 수도, 한
// 패널에 담을 수도 없다.
describe('HeadlinePanel 날짜 구획', () => {
  const DAYS: HistoryPoint[] = [
    { date: '2026-08-05', count: 0, share: 0, present: false },
    { date: '2026-08-06', count: 7, share: 0.1, present: true },
    { date: '2026-08-07', count: 12, share: 0.2, present: true },
  ]

  function renderDays(props: Partial<Parameters<typeof HeadlinePanel>[0]> = {}) {
    return renderPanel({
      subject: '호르무즈',
      history: DAYS,
      openDate: '2026-08-07',
      headlines: [headline('h1', '유가 급등', 'economy')],
      ...props,
    })
  }

  it('makes one row per collected day, newest first', () => {
    renderDays()
    // 최신이 위. 선은 왼쪽에서 오른쪽으로 흐르지만, 목록에서 먼저 읽고 싶은 것은
    // 오늘이다.
    const rows = screen.getAllByRole('button', { name: /월 \d+일/ })
    expect(rows.map((row) => row.textContent?.match(/\d+월 \d+일/)?.[0])).toEqual([
      '8월 7일',
      '8월 6일',
      '8월 5일',
    ])
    expect(rows[2]).toHaveTextContent('기사 없음')
  })

  // 열린 날의 기사만 깔린다. 다른 날의 기사가 같이 보이면 "날짜별로 구분"이 아니라
  // 그냥 섞인 목록에 머리글만 붙은 것이 된다.
  it('lists the headlines under the open day only', () => {
    renderDays()
    const open = screen.getByRole('button', { name: /8월 7일/ })
    expect(open).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /8월 6일/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('asks for another day when its row is clicked', () => {
    const onOpenDate = vi.fn()
    renderDays({ onOpenDate })
    fireEvent.click(screen.getByRole('button', { name: /8월 6일/ }))
    expect(onOpenDate).toHaveBeenCalledWith('2026-08-06')
  })

  // 그날 그 단어가 아예 없었으면 열 것이 없다. 이 판정은 궤적이 여섯 섹션 전부를
  // 세어 알고 있으므로 어느 탭에서도 참이다.
  it('will not open a day the word was absent from', () => {
    const onOpenDate = vi.fn()
    renderDays({ onOpenDate })
    const empty = screen.getByRole('button', { name: /8월 5일/ })
    expect(empty).toBeDisabled()
    fireEvent.click(empty)
    expect(onOpenDate).not.toHaveBeenCalled()
  })

  // 화면의 날짜가 아직 수집되지 않은 오늘이면 궤적에 그 날이 없다 — 그러면 어떤
  // 칸도 열리지 않아 헤드라인이 통째로 사라진다. 검색으로만 닿을 수 있는 상태라
  // 눈에 잘 띄지도 않는다.
  it('falls back to a flat list when no collected day matches the day on screen', () => {
    renderDays({ openDate: '2026-08-08' })
    expect(screen.queryByRole('button', { name: /8월 7일/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '유가 급등' })).toBeInTheDocument()
  })

  // 화면의 날짜에 그 단어가 없을 수 있다 — 검색으로 닿으면 흔하다. 그 칸은 열린
  // 채로 비어 있어야 하고, 펼쳐진 비활성 컨트롤이 되거나 "기사 없음"과 본문의
  // "관련 헤드라인이 없습니다"가 같은 말을 두 번 해서는 안 된다.
  it('leaves the open day usable even when the word was absent from it', () => {
    renderDays({ openDate: '2026-08-05', headlines: [] })
    const row = screen.getByRole('button', { name: /8월 5일/ })
    expect(row).toBeEnabled()
    expect(row).not.toHaveTextContent('기사 없음')
    expect(screen.getByText('관련 헤드라인이 없습니다.')).toBeInTheDocument()
    // 비어 있는 날은 08-05 하나뿐이고 그것이 열려 있으므로, 표식은 화면 어디에도
    // 남아 있으면 안 된다. 닫혀 있을 때 표식이 나오는 것은 위 첫 테스트가 본다.
    expect(screen.queryAllByText('기사 없음')).toHaveLength(0)
  })

  it('shows no date rows for an event', () => {
    renderDays({ subject: '김민석 · 정청래', isEvent: true })
    expect(screen.queryByRole('button', { name: /월 \d+일/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '유가 급등' })).toBeInTheDocument()
  })
})
