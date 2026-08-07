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
})
