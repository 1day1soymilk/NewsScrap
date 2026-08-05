import type { Page } from '@playwright/test'
import {
  CATEGORIES,
  CATEGORY_SHARE,
  COLLECTED_DATES,
  DEFAULT_GRAPH,
  EVENT_HEADLINE_COUNTS,
  EVENT_HEADLINE_ROWS,
  HEADLINE_COUNTS,
  HEADLINE_ROWS,
  WORD_COUNTS,
} from './fixtures'
import type { GraphPayload, HeadlineSummary } from './fixtures'

const SUPABASE_REST_GLOB = '**/rest/v1/**'

export type Rows = Record<string, unknown>[]

// keyword_graph is an RPC, so it is a POST and its arguments are in the body,
// not the query string. Handlers get both and read whichever applies.
export type MockRequest = { params: URLSearchParams; body: RpcBody }
// 두 사건 RPC도 POST이고 인자가 본문에 있다. p_events는 단어 배열의 배열,
// p_words는 단어 배열이다.
export type RpcBody = {
  p_date?: string
  p_category?: string | null
  p_events?: string[][]
  p_words?: string[]
}

export type RowsOrFn = Rows | ((request: MockRequest) => Rows)
export type GraphOrFn = GraphPayload | ((request: MockRequest) => GraphPayload)
export type CountsOrFn = number[] | ((request: MockRequest) => number[])
export type HeadlinesOrFn = HeadlineSummary[] | ((request: MockRequest) => HeadlineSummary[])

export type EndpointName =
  | 'categories'
  | 'collected_dates'
  | 'headline_nouns'
  | 'daily_word_counts'
  | 'daily_category_counts'
  | 'headlines'
  | 'keyword_graph'
  | 'event_headline_counts'
  | 'event_headlines'

export type MockOptions = {
  categories?: RowsOrFn
  collected_dates?: RowsOrFn
  headline_nouns?: RowsOrFn
  daily_word_counts?: RowsOrFn
  daily_category_counts?: RowsOrFn
  /** Headlines per collected_date, answered as a head-count. */
  headlines?: Record<string, number>
  keyword_graph?: GraphOrFn
  event_headline_counts?: CountsOrFn
  event_headlines?: HeadlinesOrFn
  failOn?: EndpointName
  /** Held back this long before responding, so a loading state can be seen. */
  delayOn?: { endpoint: EndpointName; ms: number }
}

// The app is served from localhost:5173 and Supabase is a different origin, so
// the browser sends a preflight OPTIONS before every REST call. Fulfilling
// without these headers makes the browser block the real request.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
  'Access-Control-Expose-Headers': 'content-range',
}

// `in.("a","b")` is how PostgREST spells a set membership filter. The surge
// comparison asks for two days and a named list of words in one request, so
// this default has to read the request rather than being a constant — and
// applying the filters is the point: a mock that ignored them would pass even
// if the app asked for the wrong day.
function parseIn(filter: string | null): string[] | null {
  const match = filter?.match(/^in\.\((.*)\)$/)
  if (!match) return null
  return match[1].split(',').map((value) => value.replace(/^"|"$/g, ''))
}

// daily_category_counts is read one day at a time — six rows a day reaches
// PostgREST's cap in 166 days — so the default has to read the request rather
// than being a constant, exactly like wordCountsFor. A mock that ignored the
// filter would pass even if the app asked for the wrong day.
function categoryShareFor({ params }: MockRequest): Rows {
  const date = (params.get('date') ?? '').replace(/^eq\./, '')
  return CATEGORY_SHARE.filter((row) => row.date === date)
}

function wordCountsFor({ params }: MockRequest): Rows {
  const dates = parseIn(params.get('collected_date'))
  const words = parseIn(params.get('word'))
  return WORD_COUNTS.filter(
    (row) =>
      (dates === null || dates.includes(row.collected_date)) &&
      (words === null || words.includes(row.word)),
  )
}

// 사건은 첫 단어로 알아본다. 앱이 보내는 순서 그대로 돌려주는 것이 계약이므로,
// 목도 입력을 훑어 그 순서대로 만든다 — 상수 배열이면 순서 계약을 검사하지
// 못한다.
function eventCountsFor({ body }: MockRequest): number[] {
  return (body.p_events ?? []).map((words) => EVENT_HEADLINE_COUNTS[words[0]] ?? 0)
}

function eventHeadlinesFor({ body }: MockRequest): HeadlineSummary[] {
  return EVENT_HEADLINE_ROWS[(body.p_words ?? [])[0] ?? ''] ?? []
}

const TABLE_DEFAULTS: Record<string, RowsOrFn> = {
  categories: CATEGORIES,
  collected_dates: COLLECTED_DATES,
  headline_nouns: HEADLINE_ROWS,
  daily_word_counts: wordCountsFor,
  daily_category_counts: categoryShareFor,
}

// The fallback is resolved the same way the override is: daily_word_counts and
// daily_category_counts each have to answer two different dates through one
// endpoint, so their defaults are functions too, and returning one unresolved
// would serialise to `undefined` — which reaches the app as an empty result and
// reads exactly like "no data".
function resolve<T>(
  value: T | ((request: MockRequest) => T) | undefined,
  fallback: T | ((request: MockRequest) => T),
  request: MockRequest,
): T {
  const chosen = value === undefined ? fallback : value
  return typeof chosen === 'function' ? (chosen as (r: MockRequest) => T)(request) : chosen
}

export async function mockSupabase(page: Page, options: MockOptions = {}): Promise<void> {
  // Re-registering must replace rather than stack: the retry test installs a
  // failing mock and then a succeeding one. Relying on Playwright's handler
  // precedence would hide that intent and is version-dependent.
  await page.unroute(SUPABASE_REST_GLOB)

  await page.route(SUPABASE_REST_GLOB, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS })
      return
    }

    const url = new URL(route.request().url())
    const endpoint = url.pathname.split('/').pop() as EndpointName

    if (options.failOn === endpoint) {
      await route.fulfill({
        status: 500,
        headers: CORS_HEADERS,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'mocked failure',
          code: 'PGRST500',
          details: null,
          hint: null,
        }),
      })
      return
    }

    let body: RpcBody = {}
    try {
      body = (route.request().postDataJSON() as RpcBody | null) ?? {}
    } catch {
      // GETs have no body; postDataJSON throws rather than returning null.
      body = {}
    }
    const request: MockRequest = { params: url.searchParams, body }

    // A head-count. supabase-js sends HEAD and reads the total off
    // content-range rather than out of a body, which is what keeps the
    // 1,000-row cap out of the denominators.
    if (endpoint === 'headlines') {
      const date = (url.searchParams.get('collected_date') ?? '').replace(/^eq\./, '')
      const counts = options.headlines ?? HEADLINE_COUNTS
      await route.fulfill({
        status: 200,
        headers: { ...CORS_HEADERS, 'content-range': `*/${counts[date] ?? 0}` },
        body: '',
      })
      return
    }

    const payload =
      endpoint === 'keyword_graph'
        ? resolve(options.keyword_graph, DEFAULT_GRAPH, request)
        : endpoint === 'event_headline_counts'
          ? resolve(options.event_headline_counts, eventCountsFor, request)
          : endpoint === 'event_headlines'
            ? resolve(options.event_headlines, eventHeadlinesFor, request)
            : resolve(options[endpoint] as RowsOrFn, TABLE_DEFAULTS[endpoint] ?? [], request)

    if (options.delayOn?.endpoint === endpoint) {
      await new Promise((done) => setTimeout(done, options.delayOn!.ms))
    }

    await route.fulfill({
      status: 200,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    })
  })
}
