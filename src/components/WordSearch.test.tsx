import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '민석' } })
    expect(await screen.findByRole('option', { name: /김민석/ })).toBeInTheDocument()
  })

  it('says how many days a word appeared on and when it last did', async () => {
    render(<WordSearch onSelect={() => {}} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '민석' } })
    const option = await screen.findByRole('option', { name: /김민석/ })
    expect(option).toHaveTextContent('8일')
    expect(option).toHaveTextContent('120')
  })

  it('hands the chosen word up', async () => {
    const onSelect = vi.fn()
    render(<WordSearch onSelect={onSelect} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '민석' } })
    fireEvent.click(await screen.findByRole('option', { name: /김민석/ }))
    expect(onSelect).toHaveBeenCalledWith('김민석')
  })

  it('asks nothing for a whitespace-only term', async () => {
    render(<WordSearch onSelect={() => {}} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '   ' } })
    await waitFor(() => expect(searchWords).not.toHaveBeenCalled())
  })

  it('says so when a term matches nothing', async () => {
    searchWords.mockResolvedValue([])
    render(<WordSearch onSelect={() => {}} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '없는말' } })
    expect(await screen.findByText(/찾은 단어가 없습니다/)).toBeInTheDocument()
  })

  // A failed search must not take the page down: it annotates a screen that
  // reads perfectly well without it, the same choice the surge markers make.
  it('shows no results and no error page when the search fails', async () => {
    searchWords.mockRejectedValue(new Error('nope'))
    render(<WordSearch onSelect={() => {}} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '민석' } })
    await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument())
  })
})
