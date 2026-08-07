import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearQueryCache } from './queryCache'

const mockSupabase = {
  from: vi.fn(),
  rpc: vi.fn(),
}

vi.mock('./supabaseClient', () => ({ supabase: mockSupabase }))

const {
  fetchCategoryShare,
  fetchCollectedDates,
  fetchEventHeadlineCounts,
  fetchHeadlineCount,
  fetchHeadlinesForEvent,
  fetchHeadlinesForWord,
  fetchKeywordGraph,
  fetchWordCounts,
  fetchWordCountsFor,
  searchWords,
} = await import('./queries')

// 이 파일의 함수들은 모듈 수준 캐시를 공유하므로, 비우지 않으면 한 테스트의
// 응답이 다음 테스트로 새어 간다.
beforeEach(() => {
  clearQueryCache()
})

function makeQueryChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    is: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
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

describe('fetchCollectedDates', () => {
  it('returns each collected day with its headline total, newest first', async () => {
    const chain = makeQueryChain({
      data: [
        { collected_date: '2026-08-02', headline_count: 691 },
        { collected_date: '2026-08-01', headline_count: 1144 },
      ],
      error: null,
    })
    mockSupabase.from.mockReturnValue(chain)

    const result = await fetchCollectedDates()

    expect(mockSupabase.from).toHaveBeenCalledWith('collected_dates')
    expect(chain.order).toHaveBeenCalledWith('collected_date', { ascending: false })
    expect(result).toEqual([
      { date: '2026-08-02', headlines: 691 },
      { date: '2026-08-01', headlines: 1144 },
    ])
  })

  it('coerces a bigint arriving as a string', async () => {
    // Postgres renders bigint as a JSON string in some drivers, and this column
    // is `count(*)::bigint`. Passing the string through would make every surge
    // ratio a division by a string.
    mockSupabase.from.mockReturnValue(
      makeQueryChain({
        data: [{ collected_date: '2026-08-01', headline_count: '1144' }],
        error: null,
      }),
    )

    const result = await fetchCollectedDates()

    expect(result[0].headlines).toBe(1144)
  })

  it('throws a real Error carrying the PostgREST message', async () => {
    mockSupabase.from.mockReturnValue(
      makeQueryChain({
        data: null,
        error: { message: 'permission denied for view collected_dates', code: '42501' },
      }),
    )

    await expect(fetchCollectedDates()).rejects.toThrow(
      'permission denied for view collected_dates (42501)',
    )
  })
})

describe('fetchCategoryShare', () => {
  it('returns one row per section, filtered by date server side', async () => {
    const chain = makeQueryChain({
      data: [
        { slug: 'society', headlines: 282, capped: false },
        { slug: 'it', headlines: 96, capped: false },
      ],
      error: null,
    })
    mockSupabase.from.mockReturnValue(chain)

    const share = await fetchCategoryShare('2026-08-04')

    expect(mockSupabase.from).toHaveBeenCalledWith('daily_category_counts')
    // 하루 여섯 행이라 안 거르면 166일 만에 1,000행 상한에 닿는다. 잘린 응답으로
    // 만든 분모는 아무 말 없이 틀린다.
    expect(chain.eq).toHaveBeenCalledWith('date', '2026-08-04')
    expect(share).toEqual([
      { slug: 'society', headlines: 282, capped: false },
      { slug: 'it', headlines: 96, capped: false },
    ])
  })

  it('coerces a count arriving as a string', async () => {
    mockSupabase.from.mockReturnValue(
      makeQueryChain({ data: [{ slug: 'it', headlines: '96', capped: false }], error: null }),
    )

    const share = await fetchCategoryShare('2026-08-04')

    expect(share[0].headlines).toBe(96)
  })

  it('serves a repeated read from the cache, as the same object', async () => {
    const chain = makeQueryChain({
      data: [{ slug: 'it', headlines: 96, capped: false }],
      error: null,
    })
    mockSupabase.from.mockClear()
    mockSupabase.from.mockReturnValue(chain)

    const first = fetchCategoryShare('2026-08-04')
    const second = fetchCategoryShare('2026-08-04')

    expect(await first).toBe(await second)
    expect(mockSupabase.from).toHaveBeenCalledTimes(1)
  })

  it('throws a real Error carrying the PostgREST message', async () => {
    mockSupabase.from.mockReturnValue(
      makeQueryChain({
        data: null,
        error: { message: 'permission denied for view daily_category_counts', code: '42501' },
      }),
    )

    await expect(fetchCategoryShare('2026-08-04')).rejects.toThrow(
      'permission denied for view daily_category_counts (42501)',
    )
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

  // 이 상한은 잘리면 안 되는 안전장치라 **실제 최댓값보다 한참 위**여야 한다.
  // 200이던 값은 그 조건을 잃은 지 오래였다: 2026-08-08에 라이브에서 재 본
  // 최악의 (단어, 날) 칸은 2026-08-07의 폭염으로 **198행**이고, 두 줄 남은 채
  // 아무것도 그 사실을 말하지 않았다. 움직이는 것은 단어가 아니라
  // `scoring_weights.collect_cap`이므로 숫자와 함께 그 근거를 적어 둔다.
  it('caps the rows it will pull for one word, far above the measured worst', async () => {
    const chain = makeQueryChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    await fetchHeadlinesForWord('2026-07-31', null, '폭염')

    expect(chain.limit).toHaveBeenCalledWith(600)
  })
})

describe('fetchEventHeadlineCounts', () => {
  it('세 인자를 그대로 넘기고 숫자 배열로 매핑한다', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: [63, 39], error: null })

    const result = await fetchEventHeadlineCounts('2026-07-31', null, [
      ['폭염', '양산'],
      ['트럼프', '하마스'],
    ])

    expect(mockSupabase.rpc).toHaveBeenCalledWith('event_headline_counts', {
      p_date: '2026-07-31',
      p_category: null,
      p_events: [
        ['폭염', '양산'],
        ['트럼프', '하마스'],
      ],
    })
    expect(result).toEqual([63, 39])
  })

  it('사건이 없으면 RPC를 부르지 않는다', async () => {
    mockSupabase.rpc.mockClear()
    expect(await fetchEventHeadlineCounts('2026-07-31', null, [])).toEqual([])
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('길이가 어긋나면 던진다', async () => {
    // 순서가 곧 신원이므로, 짧은 응답을 그대로 쓰면 사건에 남의 기사 수가
    // 붙고 화면상 그럴듯해 보인다. 조용히 틀리느니 시끄럽게 실패한다.
    mockSupabase.rpc.mockResolvedValue({ data: [63], error: null })

    await expect(
      fetchEventHeadlineCounts('2026-07-31', null, [['폭염'], ['트럼프']]),
    ).rejects.toThrow(/event_headline_counts/)
  })

  it('PostgREST 오류를 진짜 Error로 던진다', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'boom', code: 'PGRST202' },
    })

    await expect(fetchEventHeadlineCounts('2026-07-31', null, [['폭염']])).rejects.toThrow(
      'boom (PGRST202)',
    )
  })
})

describe('fetchHeadlinesForEvent', () => {
  it('단어 배열을 넘기고 헤드라인으로 매핑한다', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: [
        {
          id: 'h1',
          title: '폭염 특보 확대',
          link: 'https://n.news.naver.com/article/001/0000000001',
          category_slug: 'society',
        },
      ],
      error: null,
    })

    const result = await fetchHeadlinesForEvent('2026-07-31', 'society', ['폭염', '양산'])

    expect(mockSupabase.rpc).toHaveBeenCalledWith('event_headlines', {
      p_date: '2026-07-31',
      p_category: 'society',
      p_words: ['폭염', '양산'],
    })
    expect(result).toEqual([
      {
        id: 'h1',
        title: '폭염 특보 확대',
        link: 'https://n.news.naver.com/article/001/0000000001',
        category_slug: 'society',
      },
    ])
  })

  it('단어가 없으면 RPC를 부르지 않는다', async () => {
    mockSupabase.rpc.mockClear()
    expect(await fetchHeadlinesForEvent('2026-07-31', null, [])).toEqual([])
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })
})

describe('캐시', () => {
  it('같은 날짜·카테고리의 그래프는 한 번만 물어보고 **같은 객체**를 돌려준다', async () => {
    // 같은 객체라는 것이 요점의 절반이다. App.tsx의 메모는 전부 신원 비교라,
    // 값만 같고 객체가 다르면 라벨 측정 70회와 루뱅 분할과 300틱이 다시 돈다.
    mockSupabase.rpc.mockClear()
    mockSupabase.rpc.mockResolvedValue({ data: { nodes: [], edges: [] }, error: null })

    const first = await fetchKeywordGraph('2026-08-01', 'politics')
    const second = await fetchKeywordGraph('2026-08-01', 'politics')

    expect(mockSupabase.rpc).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })

  it('카테고리가 다르면 따로 물어본다', async () => {
    mockSupabase.rpc.mockClear()
    mockSupabase.rpc.mockResolvedValue({ data: { nodes: [], edges: [] }, error: null })

    await fetchKeywordGraph('2026-08-01', 'politics')
    await fetchKeywordGraph('2026-08-01', null)

    expect(mockSupabase.rpc).toHaveBeenCalledTimes(2)
  })

  it('그래프 요청이 실패하면 캐시하지 않는다 — 다시 시도가 실제로 다시 시도한다', async () => {
    mockSupabase.rpc.mockClear()
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
      .mockResolvedValue({ data: { nodes: [], edges: [] }, error: null })

    await expect(fetchKeywordGraph('2026-08-01', null)).rejects.toThrow('boom')
    await expect(fetchKeywordGraph('2026-08-01', null)).resolves.toEqual({ nodes: [], edges: [] })
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(2)
  })

  it('같은 사건 구성은 한 번만 세고, 구성이 바뀌면 다시 센다', async () => {
    mockSupabase.rpc.mockClear()
    mockSupabase.rpc.mockResolvedValue({ data: [63], error: null })

    await fetchEventHeadlineCounts('2026-08-01', null, [['폭염']])
    await fetchEventHeadlineCounts('2026-08-01', null, [['폭염']])
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(1)

    await fetchEventHeadlineCounts('2026-08-01', null, [['트럼프']])
    expect(mockSupabase.rpc).toHaveBeenCalledTimes(2)
  })

  it('같은 단어의 헤드라인은 다시 묻지 않는다', async () => {
    const chain = makeQueryChain({ data: [], error: null })
    mockSupabase.from.mockClear()
    mockSupabase.from.mockReturnValue(chain)

    await fetchHeadlinesForWord('2026-08-01', null, '폭염')
    await fetchHeadlinesForWord('2026-08-01', null, '폭염')
    expect(mockSupabase.from).toHaveBeenCalledTimes(1)

    await fetchHeadlinesForWord('2026-08-01', null, '양산')
    expect(mockSupabase.from).toHaveBeenCalledTimes(2)
  })

  it('일 헤드라인 수는 날짜마다 한 번만 센다', async () => {
    const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), then: (r: (v: unknown) => unknown) => r({ count: 1144, error: null }) }
    mockSupabase.from.mockClear()
    mockSupabase.from.mockReturnValue(chain)

    expect(await fetchHeadlineCount('2026-08-01')).toBe(1144)
    expect(await fetchHeadlineCount('2026-08-01')).toBe(1144)
    expect(mockSupabase.from).toHaveBeenCalledTimes(1)
  })
})

describe('캐시 — 급상승 카운트', () => {
  // 계획서는 이것을 캐시하지 않아도 된다고 봤다. 측정이 그 가정을 뒤집었다:
  // 날짜를 앞뒤로 왕복하면 graphWords의 신원은 그대로여도 selectedDate가
  // 바뀌므로 effect가 다시 돌고, 이 요청만 홀로 나간다.
  it('같은 날짜·단어 집합은 다시 묻지 않고, 단어가 달라지면 다시 묻는다', async () => {
    const chain = makeQueryChain({ data: [], error: null })
    mockSupabase.from.mockClear()
    mockSupabase.from.mockReturnValue(chain)

    await fetchWordCountsFor(['2026-08-01', '2026-07-31'], ['폭염', '양산'])
    await fetchWordCountsFor(['2026-08-01', '2026-07-31'], ['폭염', '양산'])
    expect(mockSupabase.from).toHaveBeenCalledTimes(1)

    await fetchWordCountsFor(['2026-08-01', '2026-07-31'], ['폭염', '트럼프'])
    expect(mockSupabase.from).toHaveBeenCalledTimes(2)
  })

  it('돌려주는 Map은 매번 같은 객체다', async () => {
    mockSupabase.from.mockReturnValue(makeQueryChain({ data: [], error: null }))

    const first = await fetchWordCountsFor(['2026-08-01'], ['폭염'])
    const second = await fetchWordCountsFor(['2026-08-01'], ['폭염'])

    expect(second).toBe(first)
  })
})

describe('searchWords', () => {
  const ROW = { word: '김민석', total: 120, days: 8, last_date: '2026-08-07' }

  it('asks the directory for a substring match, biggest first', async () => {
    const chain = makeQueryChain({ data: [ROW], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const result = await searchWords('민석')

    expect(mockSupabase.from).toHaveBeenCalledWith('word_directory')
    expect(chain.ilike).toHaveBeenCalledWith('word', '%민석%')
    expect(chain.order).toHaveBeenCalledWith('total', { ascending: false })
    expect(result).toEqual([
      { word: '김민석', total: 120, days: 8, lastDate: '2026-08-07' },
    ])
  })

  it('coerces counts arriving as strings', async () => {
    mockSupabase.from.mockReturnValue(
      makeQueryChain({
        data: [{ ...ROW, total: '120', days: '8' }],
        error: null,
      }),
    )

    const result = await searchWords('민석')

    expect(result[0].total).toBe(120)
    expect(result[0].days).toBe(8)
  })

  it('returns nothing for a blank term without going to the network', async () => {
    mockSupabase.from.mockClear()

    expect(await searchWords('   ')).toEqual([])

    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  // `_` is a LIKE wildcard, so left alone it matches every one-character word
  // in the archive. PostgREST also rewrites `*` into `%` before Postgres sees
  // the pattern, so escaping would have to happen at two layers with two sets
  // of rules; stripping is one rule in one place.
  it('strips wildcards rather than escaping them', async () => {
    const chain = makeQueryChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    await searchWords('민_석*%')

    expect(chain.ilike).toHaveBeenCalledWith('word', '%민석%')
  })

  it('trims the term', async () => {
    const chain = makeQueryChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    await searchWords('  민석  ')

    expect(chain.ilike).toHaveBeenCalledWith('word', '%민석%')
  })

  it('throws a real Error carrying the PostgREST message', async () => {
    mockSupabase.from.mockReturnValue(
      makeQueryChain({
        data: null,
        error: { message: 'permission denied for materialized view word_directory', code: '42501' },
      }),
    )

    await expect(searchWords('민석')).rejects.toThrow(
      'permission denied for materialized view word_directory (42501)',
    )
  })
})
