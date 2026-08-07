import { expect, test } from '@playwright/test'

// A static-content check only: it asserts a heading that renders before any
// Supabase call resolves, so it proves nothing about the backend.
test('renders the app shell', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '뉴스 스크랩' })).toBeVisible()
})

// No mocks here on purpose: this is the one test that proves the Vite env vars,
// the Supabase connection, the schema, and the RLS select policies are all live.
test('reaches the real Supabase project', async ({ page }) => {
  await page.goto('/')

  // categories is seeded by migration 0001 and never changes, so this holds
  // regardless of what the collector did that day. Asserting on collected words
  // instead would fail every day between midnight and 13:00 KST, when the cron
  // has not yet run for the date the app asks for.
  await expect(page.getByRole('navigation').getByRole('button')).toHaveCount(7)

  // App.tsx fetches categories/dates and word counts in separate effects that
  // race in parallel, so the button count above only proves the categories
  // query resolved. Wait for the word-count query to settle too: WordCloud
  // renders only once `!error && !loading`, and then shows either an <svg>
  // (words placed) or this empty-state paragraph (zero words for today) -
  // either one is proof fetchWordCounts resolved without error, regardless of
  // whether the collector has run yet today. Whenever the svg exists it
  // contains at least one <text>, because WordCloud renders the svg only when
  // it placed at least one word - so `svg text` avoids a strict-mode
  // violation the day a second, iconography <svg> is added to the page.
  // The default 5,000ms timeout is shorter than the real page's first paint on
  // a thick day. A browser probe against the live project on 2026-08-07 (3,224
  // headlines that day) measured the keyword_graph response landing at
  // +5,867ms and the first `svg text` painting at +6,007ms — this is the
  // day-boundary/collect-cap fix from CLAUDE.md's "Edge Function run budget"
  // section (cap raised to 300 on 2026-08-07) making days thick enough that
  // CLAUDE.md's own ~2,080–2,600ms keyword_graph table applies, plus the cold
  // connection, the JS and the layout on top. 20,000ms is headroom over that
  // measurement, not a guess.
  const wordCloudSvg = page.locator('svg text').first()
  const emptyState = page.getByText('아직 수집된 데이터가 없습니다.')
  await expect(wordCloudSvg.or(emptyState)).toBeVisible({ timeout: 20000 })

  // The retry button only renders when a query failed.
  await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0)

  // fetchCollectedDates()/collected_dates only surfaces through the date
  // input's min/max attributes, and the .or() above does not wait on it (it
  // only catches a collected_dates failure if it lands within about a second
  // of the word-count effect settling). Assert the max attribute deterministically
  // instead; it is not pinned to a specific date because the real database
  // accumulates dates over time.
  //
  // This is the same live round trip as the svg/empty-state wait above (both
  // effects race against the same cold connection to the same thick day), so
  // it gets the same generous timeout for the same reason rather than the
  // default 5,000ms — not separately measured, but the risk is identical.
  await expect(page.locator('input[type="date"]')).toHaveAttribute(
    'max',
    /^\d{4}-\d{2}-\d{2}$/,
    { timeout: 20000 },
  )
})
