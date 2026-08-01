import type { Page } from '@playwright/test'
import {
  CATEGORIES,
  COLLECTED_DATES,
  DEFAULT_GRAPH,
  HEADLINE_ROWS,
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

export type EndpointName = 'categories' | 'collected_dates' | 'headline_nouns' | 'keyword_graph'

export type MockOptions = {
  categories?: RowsOrFn
  collected_dates?: RowsOrFn
  headline_nouns?: RowsOrFn
  keyword_graph?: GraphOrFn
  failOn?: EndpointName
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

const TABLE_DEFAULTS: Record<string, Rows> = {
  categories: CATEGORIES,
  collected_dates: COLLECTED_DATES,
  headline_nouns: HEADLINE_ROWS,
}

function resolve<T>(value: T | ((request: MockRequest) => T), fallback: T, request: MockRequest): T {
  if (value === undefined) return fallback
  return typeof value === 'function' ? (value as (r: MockRequest) => T)(request) : value
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

    const payload =
      endpoint === 'keyword_graph'
        ? resolve(options.keyword_graph, DEFAULT_GRAPH, request)
        : resolve(options[endpoint] as RowsOrFn, TABLE_DEFAULTS[endpoint] ?? [], request)

    await route.fulfill({
      status: 200,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    })
  })
}
