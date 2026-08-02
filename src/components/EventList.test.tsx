import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EventList } from './EventList'
import { UNFOCUSED_OPACITY } from '../lib/focus'
import type { RankedEvent } from '../lib/events'

function ranked(words: string[], headlines: number | null, index = 0): RankedEvent {
  return {
    event: {
      words: words.map((word, i) => ({ word, count: 10 - i })),
      index,
      countSum: words.length * 10,
    },
    headlines,
  }
}

describe('EventList', () => {
  it('사건이 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<EventList events={[]} selected={null} onSelect={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('멤버 단어와 기사 수를 그린다', () => {
    render(
      <EventList
        events={[ranked(['폭염', '양산', '한반도', '에어컨'], 63)]}
        selected={null}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('폭염 · 양산 · 한반도 · 에어컨')).toBeInTheDocument()
    expect(screen.getByText('63건')).toBeInTheDocument()
  })

  it('단어가 4개를 넘으면 외 N이 붙는다', () => {
    render(
      <EventList
        events={[ranked(['트럼프', '하마스', '우크라', '사우디', '이스라엘', '가자지구', '패트리엇'], 39)]}
        selected={null}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('트럼프 · 하마스 · 우크라 · 사우디')).toBeInTheDocument()
    expect(screen.getByText('외 3')).toBeInTheDocument()
  })

  it('기사 수가 null이면 자리를 비운다 — 목록 자체는 그린다', () => {
    // 카운트 RPC가 실패했을 때. 사건 이름이 숫자보다 중요하고, 목록 전체를
    // 감추면 캡션조차 없어진다.
    render(<EventList events={[ranked(['폭염', '양산'], null)]} selected={null} onSelect={vi.fn()} />)

    expect(screen.getByText('폭염 · 양산')).toBeInTheDocument()
    expect(screen.queryByText(/건$/)).not.toBeInTheDocument()
  })

  it('누르면 사건의 첫 단어로 onSelect를 부른다', () => {
    const onSelect = vi.fn()
    render(
      <EventList events={[ranked(['폭염', '양산'], 63)]} selected={null} onSelect={onSelect} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /폭염/ }))
    expect(onSelect).toHaveBeenCalledWith('폭염')
  })

  it('related에 든 사건만 남고 나머지는 캔버스와 같은 값으로 물러난다', () => {
    // 캔버스에서 단어를 눌렀을 때. 목록은 그 단어가 어느 이야기의 일부인지를
    // 말하고, 나머지는 캔버스가 하는 것과 같은 방식으로 뒤로 물러난다.
    render(
      <EventList
        events={[ranked(['폭염', '양산'], 63, 0), ranked(['트럼프', '하마스'], 39, 1)]}
        selected={null}
        related={new Set(['트럼프'])}
        onSelect={vi.fn()}
      />,
    )

    const lit = screen.getByRole('button', { name: /트럼프/ })
    const dimmed = screen.getByRole('button', { name: /폭염/ })

    expect(lit).toHaveAttribute('data-related', 'true')
    expect(dimmed).not.toHaveAttribute('data-related')
    expect(dimmed).toHaveStyle({ opacity: String(UNFOCUSED_OPACITY) })
    expect(lit).not.toHaveStyle({ opacity: String(UNFOCUSED_OPACITY) })
  })

  it('밝힐 사건이 없으면 아무 행도 물러나지 않는다', () => {
    // 엣지가 하나도 없는 단어를 눌렀을 때. 하루 70개 중 20개가 그렇다.
    // 목록 전체가 흐려지면 고장으로 읽힌다.
    render(
      <EventList
        events={[ranked(['폭염', '양산'], 63, 0), ranked(['트럼프', '하마스'], 39, 1)]}
        selected={null}
        related={new Set()}
        onSelect={vi.fn()}
      />,
    )

    for (const name of [/폭염/, /트럼프/]) {
      expect(screen.getByRole('button', { name })).not.toHaveStyle({
        opacity: String(UNFOCUSED_OPACITY),
      })
    }
  })

  it('선택된 항목만 aria-pressed다', () => {
    render(
      <EventList
        events={[ranked(['폭염', '양산'], 63, 0), ranked(['트럼프', '하마스'], 39, 1)]}
        selected="트럼프"
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /폭염/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /트럼프/ })).toHaveAttribute('aria-pressed', 'true')
  })
})
