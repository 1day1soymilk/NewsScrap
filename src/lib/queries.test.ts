import { describe, expect, it, vi } from 'vitest'

const mockSupabase = {
  from: vi.fn(),
}

vi.mock('./supabaseClient', () => ({ supabase: mockSupabase }))

const { fetchAvailableDates, fetchHeadlinesForWord, fetchWordCounts } = await import('./queries')

function makeQueryChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    order: vi.fn(() => chain),
    then: (resolve: (r: typeof result) => unknown) => resolve(result),
  }
  return chain
}

describe('fetchWordCounts', () => {
  it('maps aggregated view rows and sorts by count descending', async () => {
    // daily_word_counts already aggregates in Postgres; the view may hand back
    // rows in any order, so the function still has to sort them.
    const rows = [
      { word: '여야', count: 1 },
      { word: '예산안', count: 2 },
    ]
    const chain = makeQueryChain({ data: rows, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const result = await fetchWordCounts('2026-07-31', 'politics')

    expect(mockSupabase.from).toHaveBeenCalledWith('daily_word_counts')
    expect(chain.eq).toHaveBeenCalledWith('collected_date', '2026-07-31')
    expect(chain.eq).toHaveBeenCalledWith('category_slug', 'politics')
    expect(result).toEqual([
      { word: '예산안', count: 2 },
      { word: '여야', count: 1 },
    ])
  })

  it('reads the all-categories rollup rows when no category is selected', async () => {
    const chain = makeQueryChain({ data: [{ word: '예산안', count: 5 }], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const result = await fetchWordCounts('2026-07-31', null)

    expect(chain.is).toHaveBeenCalledWith('category_slug', null)
    expect(chain.eq).not.toHaveBeenCalledWith('category_slug', expect.anything())
    expect(result).toEqual([{ word: '예산안', count: 5 }])
  })

  it('throws a real Error carrying the PostgREST message', async () => {
    mockSupabase.from.mockReturnValue(
      makeQueryChain({
        data: null,
        error: { message: 'permission denied for view daily_word_counts', code: '42501' },
      }),
    )

    await expect(fetchWordCounts('2026-07-31', null)).rejects.toThrow(
      'permission denied for view daily_word_counts (42501)',
    )
  })
})

describe('fetchAvailableDates', () => {
  it('returns distinct dates newest first', async () => {
    const rows = [
      { collected_date: '2026-07-31' },
      { collected_date: '2026-07-31' },
      { collected_date: '2026-07-30' },
    ]
    const chain = makeQueryChain({ data: rows, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const result = await fetchAvailableDates()

    expect(mockSupabase.from).toHaveBeenCalledWith('collected_dates')
    expect(chain.order).toHaveBeenCalledWith('collected_date', { ascending: false })
    expect(result).toEqual(['2026-07-31', '2026-07-30'])
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
