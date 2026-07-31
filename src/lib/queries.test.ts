import { describe, expect, it, vi } from 'vitest'

const mockSupabase = {
  from: vi.fn(),
}

vi.mock('./supabaseClient', () => ({ supabase: mockSupabase }))

const { fetchHeadlinesForWord, fetchWordCounts } = await import('./queries')

function makeQueryChain(result: { data: unknown; error: null }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    then: (resolve: (r: typeof result) => unknown) => resolve(result),
  }
  return chain
}

describe('fetchWordCounts', () => {
  it('aggregates word counts and sorts by frequency descending', async () => {
    const rows = [{ word: '예산안' }, { word: '여야' }, { word: '예산안' }]
    mockSupabase.from.mockReturnValue(makeQueryChain({ data: rows, error: null }))

    const result = await fetchWordCounts('2026-07-31', 'politics')

    expect(result).toEqual([
      { word: '예산안', count: 2 },
      { word: '여야', count: 1 },
    ])
  })
})

describe('fetchHeadlinesForWord', () => {
  it('deduplicates headlines that share the same id', async () => {
    const rows = [
      { headlines: { id: 'h1', title: '제목1', link: 'https://a' } },
      { headlines: { id: 'h1', title: '제목1', link: 'https://a' } },
      { headlines: { id: 'h2', title: '제목2', link: 'https://b' } },
    ]
    mockSupabase.from.mockReturnValue(makeQueryChain({ data: rows, error: null }))

    const result = await fetchHeadlinesForWord('2026-07-31', null, '예산안')

    expect(result).toEqual([
      { id: 'h1', title: '제목1', link: 'https://a' },
      { id: 'h2', title: '제목2', link: 'https://b' },
    ])
  })
})
