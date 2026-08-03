import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HeadlinePanel } from './HeadlinePanel'
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
})
