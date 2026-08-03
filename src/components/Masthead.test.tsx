import { render, screen } from '@testing-library/react'
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
})
