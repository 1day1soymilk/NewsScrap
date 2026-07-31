import { expect, test } from '@playwright/test'

// A static-content check only: it asserts a heading that renders before any
// Supabase call resolves, so it proves nothing about the backend.
test('renders the app shell', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '오늘의 주요 뉴스 스크랩' })).toBeVisible()
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
  const wordCloudSvg = page.locator('svg text').first()
  const emptyState = page.getByText('아직 수집된 데이터가 없습니다.')
  await expect(wordCloudSvg.or(emptyState)).toBeVisible()

  // The retry button only renders when a query failed.
  await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0)

  // fetchAvailableDates()/collected_dates only surfaces through the date
  // input's min/max attributes, and the .or() above does not wait on it (it
  // only catches a collected_dates failure if it lands within about a second
  // of the word-count effect settling). Assert the max attribute deterministically
  // instead; it is not pinned to a specific date because the real database
  // accumulates dates over time.
  await expect(page.locator('input[type="date"]')).toHaveAttribute('max', /^\d{4}-\d{2}-\d{2}$/)
})
