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

    // 두 군데서 말한다: 캡션이 한 번, 해당 행의 sr-only 텍스트가 한 번. 캡션만
    // 있으면 스크린 리더로는 어느 섹션인지 찾을 수 없다.
    expect(screen.getAllByText(/최소치/).length).toBeGreaterThanOrEqual(2)
  })

  it('makes the labelled shares add up to a hundred', () => {
    // 각자 반올림하면 33+25+17+8+8+8 = 99다. 몫을 말하는 차트에서 그 1은 읽힌다.
    render(
      <CategoryShare
        share={[
          { slug: 'society', headlines: 4, capped: false },
          { slug: 'politics', headlines: 3, capped: false },
          { slug: 'economy', headlines: 2, capped: false },
          { slug: 'culture', headlines: 1, capped: false },
          { slug: 'world', headlines: 1, capped: false },
          { slug: 'it', headlines: 1, capped: false },
        ]}
        categories={[
          ...CATEGORIES,
          { slug: 'politics', label: '정치' },
          { slug: 'economy', label: '경제' },
          { slug: 'culture', label: '생활/문화' },
          { slug: 'world', label: '세계' },
        ]}
      />,
    )

    const shown = screen
      .getAllByRole('listitem')
      .map((row) => Number(row.textContent!.match(/(\d+)%/)![1]))
    expect(shown.reduce((sum, value) => sum + value, 0)).toBe(100)
    // 어느 줄이 남은 자리를 받는지까지 고정한다. 소수부를 부동소수로 비교하면
    // 4/12와 1/12가 마지막 비트에서 갈려 여기가 잡음으로 정해졌다 — 실제로
    // 브라우저는 33을, 이 파일의 산수는 34를 내놨다.
    expect(shown).toEqual([34, 25, 17, 8, 8, 8])
  })

  it('says the count and the caveat in words, not only in colour and hover', () => {
    // 별표는 aria-hidden이고 건수는 aria-hidden인 svg의 <title> 안에만 있었다.
    // 캡션이 "*가 붙은 섹션"을 가리키는데 그 섹션을 찾을 수 없으면 캡션이 거짓이다.
    render(
      <CategoryShare
        share={[
          { slug: 'society', headlines: 150, capped: true },
          { slug: 'it', headlines: 50, capped: false },
        ]}
        categories={CATEGORIES}
      />,
    )

    const [capped, plain] = screen.getAllByRole('listitem')
    expect(capped).toHaveTextContent('150건')
    expect(capped).toHaveTextContent(/수집 상한에 닿았을 수 있어 최소치/)
    expect(plain).toHaveTextContent('50건')
    expect(plain).not.toHaveTextContent(/최소치/)
  })

  it('warns that an unflagged section may have been capped too', () => {
    // 저장된 행을 세므로, 창을 꽉 채우고도 이미 가진 기사를 하나 다시 본 회차는
    // 149건으로 남아 표시가 붙지 않는다 — 2026-08-04 경제가 정확히 그 경우다.
    render(
      <CategoryShare
        share={[
          { slug: 'society', headlines: 282, capped: false },
          { slug: 'it', headlines: 96, capped: false },
        ]}
        categories={CATEGORIES}
      />,
    )

    expect(screen.getByText(/표시가 없는 섹션도 상한에 걸렸을 수 있습니다/)).toBeInTheDocument()
  })

  it('keeps the per-section caveat off a day where no run reached the cap', () => {
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
    expect(screen.queryByText(/\*가 붙은 섹션/)).not.toBeInTheDocument()
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
