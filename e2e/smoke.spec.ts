import { expect, test } from '@playwright/test'

// No mocks here on purpose: this is the one test that proves the Vite env vars,
// the Supabase connection, the schema, and the RLS select policies are all live.
test('renders the app shell', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '오늘의 주요 뉴스 스크랩' })).toBeVisible()
})

test('reaches the real Supabase project', async ({ page }) => {
  await page.goto('/')

  // categories is seeded by migration 0001 and never changes, so this holds
  // regardless of what the collector did that day. Asserting on collected words
  // instead would fail every day between midnight and 13:00 KST, when the cron
  // has not yet run for the date the app asks for.
  await expect(page.getByRole('navigation').getByRole('button')).toHaveCount(7)

  // The retry button only renders when a query failed.
  await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0)
})
