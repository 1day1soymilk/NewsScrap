import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WordSearch } from './WordSearch'

const searchWords = vi.hoisted(() => vi.fn())
vi.mock('../lib/queries', () => ({ searchWords }))

const MATCH = { word: '김민석', total: 120, days: 8, lastDate: '2026-08-07' }

beforeEach(() => {
  searchWords.mockReset()
  searchWords.mockResolvedValue([MATCH])
})

describe('WordSearch', () => {
  it('lists what the directory returned', async () => {
    render(<WordSearch onSelect={() => {}} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '민석' } })
    expect(await screen.findByRole('option', { name: /김민석/ })).toBeInTheDocument()
  })

  it('says how many days a word appeared on and when it last did', async () => {
    render(<WordSearch onSelect={() => {}} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '민석' } })
    const option = await screen.findByRole('option', { name: /김민석/ })
    expect(option).toHaveTextContent('8일')
    expect(option).toHaveTextContent('120')
  })

  it('hands the chosen word up', async () => {
    const onSelect = vi.fn()
    render(<WordSearch onSelect={onSelect} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '민석' } })
    fireEvent.click(await screen.findByRole('option', { name: /김민석/ }))
    expect(onSelect).toHaveBeenCalledWith('김민석')
  })

  it('asks nothing for a whitespace-only term', async () => {
    vi.useFakeTimers()
    try {
      render(<WordSearch onSelect={() => {}} />)
      fireEvent.change(screen.getByRole('combobox'), { target: { value: '   ' } })
      // 디바운스를 지나 보낸 뒤에 묻는다. 타이머가 뛸 수 있는 시점보다 **앞에서**
      // 확인하는 단정은 구현이 틀려도 통과한다 — waitFor는 첫 검사를 동기로 한 번
      // 돌리므로 그대로 두면 t=0에서 판정된다.
      await vi.advanceTimersByTimeAsync(1000)
      expect(searchWords).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says so when a term matches nothing', async () => {
    searchWords.mockResolvedValue([])
    render(<WordSearch onSelect={() => {}} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '없는말' } })
    expect(await screen.findByText(/찾은 단어가 없습니다/)).toBeInTheDocument()
  })

  // A failed search must not take the page down: it annotates a screen that
  // reads perfectly well without it, the same choice the surge markers make.
  it('shows no results and no error page when the search fails', async () => {
    searchWords.mockRejectedValue(new Error('nope'))
    render(<WordSearch onSelect={() => {}} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '민석' } })
    // 빈 상태 문구는 거절이 처리된 **뒤에만** 나온다. 그것을 먼저 기다리는 것이
    // catch가 실제로 돌았다는 증거이고, 그 뒤라야 "옵션이 없다"가 의미를 가진다.
    expect(await screen.findByText(/찾은 단어가 없습니다/)).toBeInTheDocument()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('아래 화살표 뒤 Enter로 첫 결과를 고른다', async () => {
    const onSelect = vi.fn()
    searchWords.mockResolvedValue([
      MATCH,
      { word: '김병기', total: 40, days: 3, lastDate: '2026-08-05' },
    ])
    render(<WordSearch onSelect={onSelect} />)
    const combobox = screen.getByRole('combobox')
    fireEvent.change(combobox, { target: { value: '김' } })
    await screen.findByRole('option', { name: /김민석/ })

    fireEvent.keyDown(combobox, { key: 'ArrowDown' })
    fireEvent.keyDown(combobox, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith('김민석')
  })

  it('Escape는 목록을 닫지만 입력한 term은 지우지 않는다', async () => {
    render(<WordSearch onSelect={() => {}} />)
    const combobox = screen.getByRole('combobox')
    fireEvent.change(combobox, { target: { value: '민석' } })
    await screen.findByRole('option', { name: /김민석/ })

    fireEvent.keyDown(combobox, { key: 'Escape' })

    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(combobox).toHaveValue('민석')
  })

  it('aria-activedescendant는 화살표로 짚은 옵션의 id와 일치한다', async () => {
    render(<WordSearch onSelect={() => {}} />)
    const combobox = screen.getByRole('combobox')
    fireEvent.change(combobox, { target: { value: '민석' } })
    const option = await screen.findByRole('option', { name: /김민석/ })

    expect(combobox).not.toHaveAttribute('aria-activedescendant')

    fireEvent.keyDown(combobox, { key: 'ArrowDown' })

    expect(combobox).toHaveAttribute('aria-activedescendant', option.id)
    expect(option).toHaveAttribute('aria-selected', 'true')
  })
})
