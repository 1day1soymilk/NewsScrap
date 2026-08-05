import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CategoryShare } from './CategoryShare'

const CATEGORIES = [
  { slug: 'society', label: '사회' },
  { slug: 'it', label: 'IT/과학' },
]

describe('CategoryShare', () => {
  it('labels each arc with its section and share', () => {
    render(
      <CategoryShare
        share={[
          { slug: 'society', headlines: 282, capped: false },
          { slug: 'it', headlines: 96, capped: false },
        ]}
        categories={CATEGORIES}
      />,
    )

    expect(screen.getByText('사회')).toBeInTheDocument()
    expect(screen.getByText('IT/과학')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
  })

  it('says so when the cap hid part of a section', () => {
    render(
      <CategoryShare
        share={[
          { slug: 'society', headlines: 150, capped: true },
          { slug: 'it', headlines: 50, capped: false },
        ]}
        categories={CATEGORIES}
      />,
    )

    expect(screen.getByText(/최소치/)).toBeInTheDocument()
  })

  it('keeps the caveat off a day where no run reached the cap', () => {
    // 캡션이 늘 붙어 있으면 아무 말도 하지 않는 것과 같다. `capped`가 값을
    // 구별해야 존재할 이유가 있다.
    render(
      <CategoryShare
        share={[
          { slug: 'society', headlines: 282, capped: false },
          { slug: 'it', headlines: 96, capped: false },
        ]}
        categories={CATEGORIES}
      />,
    )

    expect(screen.queryByText(/최소치/)).not.toBeInTheDocument()
  })

  it('draws nothing at all when the day has no counts', () => {
    const { container } = render(<CategoryShare share={[]} categories={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('draws nothing when every section is empty, rather than dividing by zero', () => {
    const { container } = render(
      <CategoryShare
        share={[{ slug: 'society', headlines: 0, capped: false }]}
        categories={CATEGORIES}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('paints each arc from the one shared section palette', () => {
    // 색은 sectionColors.ts에서만 온다. 세 번째 사본이 생기면 탭 행과 캔버스가
    // 가리키는 초록과 도넛의 초록이 갈라지고, 그 순간 범례는 없느니만 못하다.
    const { container } = render(
      <CategoryShare
        share={[
          { slug: 'society', headlines: 282, capped: false },
          { slug: 'it', headlines: 96, capped: false },
        ]}
        categories={CATEGORIES}
      />,
    )

    const fills = [...container.querySelectorAll('path')].map((path) => path.style.fill)
    expect(fills).toEqual([
      'var(--color-section-society)',
      'var(--color-section-it)',
    ])
  })

  it('orders the sections by what they produced, largest first', () => {
    render(
      <CategoryShare
        share={[
          { slug: 'it', headlines: 96, capped: false },
          { slug: 'society', headlines: 282, capped: false },
        ]}
        categories={CATEGORIES}
      />,
    )

    const rows = screen.getAllByRole('listitem').map((row) => row.textContent)
    expect(rows[0]).toContain('사회')
    expect(rows[1]).toContain('IT/과학')
  })

  it('falls back to the slug for a section the category list does not name', () => {
    render(
      <CategoryShare
        share={[{ slug: 'sports', headlines: 10, capped: false }]}
        categories={CATEGORIES}
      />,
    )

    expect(screen.getByText('sports')).toBeInTheDocument()
  })
})
