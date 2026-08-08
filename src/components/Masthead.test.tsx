import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Masthead } from './Masthead'

describe('Masthead', () => {
  const base = {
    date: '2026-08-01',
    previousDate: '2026-07-31',
    nextDate: null,
    onDateChange: vi.fn(),
    words: 70,
    links: 63,
  }

  it('이웃한 수집일이 없는 쪽의 화살표는 눌리지 않는다', () => {
    // 스테퍼는 달력이 아니라 수집된 날짜를 걷는다. 아카이브에 구멍이 있고
    // 오늘은 07:00 KST cron이 돌기 전까지 비어 있다.
    render(<Masthead {...base} />)

    expect(screen.getByRole('button', { name: '이전 수집일' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '다음 수집일' })).toBeDisabled()
  })

  it('아직 그래프가 없으면 단어·관계 수를 걸지 않는다', () => {
    render(<Masthead {...base} words={null} links={null} />)

    expect(screen.queryByText(/단어 /)).not.toBeInTheDocument()
    expect(screen.queryByText(/관계 /)).not.toBeInTheDocument()
  })

  it('오늘을 지나쳐 왔으면 그 사실과 건수를 적고, 눌러서 갈 수 있다', () => {
    const onDateChange = vi.fn()
    render(
      <Masthead {...base} onDateChange={onDateChange} today={{ date: '2026-08-02', headlines: 539 }} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /아직 539건 수집 중/ }))
    expect(onDateChange).toHaveBeenCalledWith('2026-08-02')
  })

  it('수집 전인 오늘은 말만 하고 갈 곳을 내밀지 않는다', () => {
    // 날짜 입력의 max도 거기까지 못 가고, 가 봐야 빈 캔버스다. 막다른 길로
    // 부르는 것보다 사실만 적는 편이 낫다.
    render(<Masthead {...base} today={{ date: '2026-08-02', headlines: null }} />)

    expect(screen.getByText(/아직 수집 전/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /오늘/ })).not.toBeInTheDocument()
  })

  it('오늘을 보고 있으면 그 줄이 아예 없다', () => {
    render(<Masthead {...base} today={null} />)

    expect(screen.queryByText(/오늘\(/)).not.toBeInTheDocument()
  })
})
