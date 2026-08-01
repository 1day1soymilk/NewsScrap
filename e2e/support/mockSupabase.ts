import type { Page } from '@playwright/test'
import {
  CATEGORIES,
  COLLECTED_DATES,
  DEFAULT_GRAPH,
  HEADLINE_COUNTS,
  HEADLINE_ROWS,
  WORD_COUNTS,
} from './fixtures'
import type { GraphPayload } from './fixtures'

const SUPABASE_REST_GLOB = '**/rest/v1/**'

export type Rows = Record<string, unknown>[]

// keyword_graph is an RPC, so it is a POST and its arguments are in the body,
// not the query string. Handlers get both and read whichever applies.
export type MockRequest = { params: URLSearchParams; body: RpcBody }
export type RpcBody = { p_date?: string; p_category?: string | null }

export type RowsOrFn = Rows | ((request: MockRequest) => Rows)
export type GraphOrFn = GraphPayload | ((request: MockRequest) => GraphPayload)

export type EndpointName =
  | 'categories'
  | 'collected_dates'
  | 'headline_nouns'
  | 'daily_word_counts'
  | 'headlines'
  | 'keyword_graph'

export type MockOptions = {
  categories?: RowsOrFn
  collected_dates?: RowsOrFn
  headline_nouns?: RowsOrFn
  daily_word_counts?: RowsOrFn
  /** Headlines per collected_date, answered as a head-count. */
  headlines?: Record<string, number>
  keyword_graph?: GraphOrFn
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

function wordCountsFor({ params }: MockRequest): Rows {
  const dates = parseIn(params.get('collected_date'))
  const words = parseIn(params.get('word'))
  return WORD_COUNTS.filter(
    (row) =>
      (dates === null || dates.includes(row.collected_date)) &&
      (words === null || words.includes(row.word)),
  )
}

const TABLE_DEFAULTS: Record<string, RowsOrFn> = {
  categories: CATEGORIES,
  collected_dates: COLLECTED_DATES,
  headline_nouns: HEADLINE_ROWS,
  daily_word_counts: wordCountsFor,
}

// The fallback is resolved the same way the override is: daily_word_counts has
// to answer two different dates through one endpoint, so its default is a
// function too, and returning it unresolved would serialise to `undefined`.
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
