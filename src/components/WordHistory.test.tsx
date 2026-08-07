import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WordHistory } from './WordHistory'
import type { HistoryPoint } from '../lib/history'

function points(shares: number[]): HistoryPoint[] {
  return shares.map((value, index) => ({
    date: `2026-08-0${index + 1}`,
    count: value === 0 ? 0 : Math.round(value * 100),
    share: value,
    present: value > 0,
  }))
}

describe('WordHistory', () => {
  it('says how many of the days it appeared on, in text', () => {
    render(<WordHistory points={points([0, 0.1, 0.2])} />)
    expect(screen.getByText(/3일 중 2일/)).toBeInTheDocument()
  })

  it('states the day-over-day move as a percentage', () => {
    render(<WordHistory points={points([0.1, 0.2])} />)
    expect(screen.getByText(/\+100%/)).toBeInTheDocument()
  })

  it('says a word absent the day before is new rather than showing a ratio', () => {
    render(<WordHistory points={points([0, 0.2])} />)
    expect(screen.getByText(/새로 등장/)).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('marks a fall with a minus rather than only with colour', () => {
    render(<WordHistory points={points([0.2, 0.1])} />)
    expect(screen.getByText(/−50%/)).toBeInTheDocument()
  })

  // Math.round(-0.3) is -0, and -0 >= 0 is true in JS — so a decline this
  // small used to print "+0%", stating the wrong direction outright rather
  // than merely rounding away a small move.
  it('prints a rounding-to-zero decline as 0%, never as a rise', () => {
    render(<WordHistory points={points([0.201, 0.2])} />)
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.queryByText(/\+0%/)).not.toBeInTheDocument()
  })

  // One point is not a trajectory: a flat dot would claim the word has been
  // steady when what happened is that there is nothing to compare.
  it('renders nothing for fewer than two days', () => {
    const { container } = render(<WordHistory points={points([0.2])} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing with no days at all', () => {
    const { container } = render(<WordHistory points={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  // The caption carries every fact. Announcing the drawing as well would read
  // the same numbers out twice — the rule the donut already follows.
  it('hides the drawing from assistive technology', () => {
    const { container } = render(<WordHistory points={points([0.1, 0.2])} />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('draws one point per day', () => {
    const { container } = render(<WordHistory points={points([0.1, 0, 0.2])} />)
    expect(container.querySelectorAll('circle')).toHaveLength(3)
  })

  it('writes each point its date and its headline count', () => {
    render(<WordHistory points={points([0.1, 0.2, 0.15])} />)
    expect(screen.getByText('8/1')).toBeInTheDocument()
    expect(screen.getByText('8/3')).toBeInTheDocument()
    // points() derives count from share, so these are 10 / 20 / 15.
    expect(screen.getByText('20')).toBeInTheDocument()
  })

  // 높이는 점유율이고 축의 숫자는 건수라 서로 다른 것을 잰다 — 폭염처럼 건수가 거의
  // 같은데 그날 전체 기사 수가 달라 점유율이 벌어지면 **적은 건수가 더 높이 앉는다.**
  // 그 줄이 없으면 그것이 오류로 읽힌다.
  it('says which of the two quantities is the height and which is the number', () => {
    render(<WordHistory points={points([0.1, 0.2])} />)
    expect(screen.getByText(/숫자는 그날 기사 수/)).toBeInTheDocument()
    expect(screen.getByText(/높이는 그날 전체 대비 비중/)).toBeInTheDocument()
  })

  // 아카이브가 HISTORY_WINDOW(14일)까지 자라면 점 간격이 18.8px로 좁아져 라벨을
  // 전부 적으면 글자끼리 붙는다. 건너뛰되 **마지막 점은 어떤 간격에서도 적힌다** —
  // 화면의 날짜가 이름 없이 남으면 안 되기 때문이다.
  it('thins the axis labels when the days no longer fit, keeping the last', () => {
    const fourteen = Array.from({ length: 14 }, (_, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, '0')}`,
      count: index + 1,
      share: 0.1,
      present: true,
    }))
    const { container } = render(<WordHistory points={fourteen} />)

    // 14점은 한 칸 걸러 7개.
    expect(container.querySelectorAll('text')).toHaveLength(14)
    expect(screen.getByText('8/14')).toBeInTheDocument()
    expect(screen.queryByText('8/13')).not.toBeInTheDocument()
    expect(screen.getByText('8/12')).toBeInTheDocument()
  })

  it('labels every point while they still fit', () => {
    const { container } = render(<WordHistory points={points([0.1, 0.2, 0.3, 0.4])} />)
    expect(container.querySelectorAll('text')).toHaveLength(8)
  })

  // 강조된 점은 아래 목록에서 펼쳐 놓은 날이다. 그 둘이 어긋나면 선과 목록이 서로
  // 다른 날을 가리키면서도 화면에서는 멀쩡해 보인다.
  it('emphasises the day the list has open rather than always the last', () => {
    const { container } = render(
      <WordHistory points={points([0.1, 0.2, 0.3])} activeDate="2026-08-02" />,
    )
    const radii = [...container.querySelectorAll('circle')].map((c) => c.getAttribute('r'))
    expect(radii).toEqual(['1.75', '3', '1.75'])
  })

  it('falls back to the last day when nothing is open', () => {
    const { container } = render(<WordHistory points={points([0.1, 0.2, 0.3])} />)
    const radii = [...container.querySelectorAll('circle')].map((c) => c.getAttribute('r'))
    expect(radii).toEqual(['1.75', '1.75', '3'])
  })
})
