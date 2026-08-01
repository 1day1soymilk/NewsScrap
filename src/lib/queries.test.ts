import { describe, expect, it, vi } from 'vitest'

const mockSupabase = {
  from: vi.fn(),
  rpc: vi.fn(),
}

vi.mock('./supabaseClient', () => ({ supabase: mockSupabase }))

const { fetchAvailableDates, fetchHeadlinesForWord, fetchKeywordGraph, fetchWordCounts } =
  await import('./queries')

function makeQueryChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
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

describe('fetchKeywordGraph', () => {
  const node = {
    word: '폭염',
    count: 45,
    spec: 0.478,
    standalone: 0.6,
    neighbors_per_doc: 2.733,
    assoc: 0.62,
    passed_by: 'allow',
    category_slug: 'culture',
    faded: false,
  }

  it('passes the date and category through as RPC arguments', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: { nodes: [node], edges: [] }, error: null })

    const result = await fetchKeywordGraph('2026-07-31', 'economy')

    expect(mockSupabase.rpc).toHaveBeenCalledWith('keyword_graph', {
      p_date: '2026-07-31',
      p_category: 'economy',
    })
    expect(result.nodes).toEqual([node])
  })

  it('keeps a null signal null rather than turning it into a measured zero', async () => {
    // assoc is null for a word that shares no headline with any other word.
    // Number(null) is 0, which would read as "measured, and it was zero".
    mockSupabase.rpc.mockResolvedValue({
      data: { nodes: [{ ...node, assoc: null }], edges: [] },
      error: null,
    })

    const result = await fetchKeywordGraph('2026-07-31', null)

    expect(result.nodes[0].assoc).toBeNull()
  })

  it('tolerates a day with no rows at all', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: { nodes: [], edges: [] }, error: null })

    await expect(fetchKeywordGraph('2026-01-01', null)).resolves.toEqual({ nodes: [], edges: [] })
  })

  it('throws a real Error carrying the PostgREST message', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for function keyword_graph', code: '42501' },
    })

    await expect(fetchKeywordGraph('2026-07-31', null)).rejects.toThrow(
      'permission denied for function keyword_graph (42501)',
    )
  })
})

describe('fetchHeadlinesForWord', () => {
  function headlineRow(id: string, title: string, link: string, slug: string) {
    return {
      headlines: {
        id,
        title,
        link,
        collected_date: '2026-07-31',
        categories: { slug },
      },
    }
  }

  it('deduplicates headlines that share the same id', async () => {
    const rows = [
      headlineRow('h1', '제목1', 'https://a', 'politics'),
      headlineRow('h1', '제목1', 'https://a', 'politics'),
      headlineRow('h2', '제목2', 'https://b', 'economy'),
    ]
    mockSupabase.from.mockReturnValue(makeQueryChain({ data: rows, error: null }))

    const result = await fetchHeadlinesForWord('2026-07-31', null, '예산안')

    expect(result).toEqual([
      { id: 'h1', title: '제목1', link: 'https://a', category_slug: 'politics' },
      { id: 'h2', title: '제목2', link: 'https://b', category_slug: 'economy' },
    ])
  })

  // The nested select has always joined categories in order to filter on the
  // slug; before this it dropped the slug on the way out and the panel had no
  // way to say which section a headline came from.
  it('lifts the category slug out of the nested join', async () => {
    mockSupabase.from.mockReturnValue(
      makeQueryChain({ data: [headlineRow('h1', '제목', 'https://a', 'society')], error: null }),
    )

    const result = await fetchHeadlinesForWord('2026-07-31', null, '폭염')

    expect(result[0].category_slug).toBe('society')
  })

  it('caps the rows it will pull for one word', async () => {
    const chain = makeQueryChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    await fetchHeadlinesForWord('2026-07-31', null, '폭염')

    expect(chain.limit).toHaveBeenCalledWith(200)
  })
})
