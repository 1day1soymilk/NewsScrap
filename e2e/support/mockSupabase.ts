import type { Page } from '@playwright/test'
import {
  CATEGORIES,
  COLLECTED_DATES,
  DEFAULT_WORD_COUNTS,
  HEADLINE_ROWS,
} from './fixtures'

const SUPABASE_REST_GLOB = '**/rest/v1/**'

export type Rows = Record<string, unknown>[]
export type RowsOrFn = Rows | ((params: URLSearchParams) => Rows)
export type TableName =
  | 'categories'
  | 'collected_dates'
  | 'daily_word_counts'
  | 'headline_nouns'

export type MockOptions = {
  categories?: RowsOrFn
  collected_dates?: RowsOrFn
  daily_word_counts?: RowsOrFn
  headline_nouns?: RowsOrFn
  failOn?: TableName
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

const DEFAULTS: Record<TableName, Rows> = {
  categories: CATEGORIES,
  collected_dates: COLLECTED_DATES,
  daily_word_counts: DEFAULT_WORD_COUNTS,
  headline_nouns: HEADLINE_ROWS,
}

function resolveRows(value: RowsOrFn | undefined, fallback: Rows, params: URLSearchParams): Rows {
  if (value === undefined) return fallback
  return typeof value === 'function' ? value(params) : value
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
    const table = url.pathname.split('/').pop() as TableName

    if (options.failOn === table) {
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

    await route.fulfill({
      status: 200,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: JSON.stringify(resolveRows(options[table], DEFAULTS[table] ?? [], url.searchParams)),
    })
  })
}
