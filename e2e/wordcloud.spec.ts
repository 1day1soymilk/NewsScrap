import { expect, test } from '@playwright/test'
import { DEFAULT_WORD_COUNTS, ECONOMY_WORD_COUNTS, todayInSeoul } from './support/fixtures'
import { mockSupabase } from './support/mockSupabase'

test('renders every fixture word in the cloud', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  const words = page.locator('svg text')
  await expect(words.filter({ hasText: /^예산안$/ })).toBeVisible()
  await expect(words.filter({ hasText: /^여야$/ })).toBeVisible()
  await expect(words.filter({ hasText: /^국회$/ })).toBeVisible()

  // Only observable effect of fetchAvailableDates()/COLLECTED_DATES: the date
  // input's min/max attributes. Covers that query, which nothing else here does.
  await expect(page.locator('input[type="date"]')).toHaveAttribute('max', todayInSeoul())
})

test('opens and closes the headline panel for a clicked word', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  await page.locator('svg text').filter({ hasText: /^예산안$/ }).click()

  const panel = page.getByRole('complementary')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading', { name: '"예산안" 관련 헤드라인' })).toBeVisible()

  const link = panel.getByRole('link', { name: '여야 예산안 처리 합의' })
  await expect(link).toHaveAttribute(
    'href',
    'https://n.news.naver.com/mnews/article/001/0000000001',
  )
  await expect(link).toHaveAttribute('target', '_blank')

  await panel.getByRole('button', { name: '닫기' }).click()
  await expect(panel).toBeHidden()
})

test('swaps the cloud when a category is selected', async ({ page }) => {
  await mockSupabase(page, {
    daily_word_counts: (params) =>
      params.get('category_slug') === 'eq.economy' ? ECONOMY_WORD_COUNTS : DEFAULT_WORD_COUNTS,
  })
  await page.goto('/')

  const words = page.locator('svg text')
  await expect(words.filter({ hasText: /^예산안$/ })).toBeVisible()

  await page.getByRole('button', { name: '경제' }).click()

  await expect(words.filter({ hasText: /^금리$/ })).toBeVisible()
  await expect(words.filter({ hasText: /^예산안$/ })).toHaveCount(0)
})

test('shows the empty state when the day has no words', async ({ page }) => {
  await mockSupabase(page, { daily_word_counts: [] })
  await page.goto('/')

  await expect(page.getByText('아직 수집된 데이터가 없습니다.')).toBeVisible()
  // Distinguishes the empty state from the error state (the first assertion
  // does not, since WordCloud renders only the paragraph or the svg, never both).
  await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0)
})

test('surfaces a query failure and recovers on retry', async ({ page }) => {
  await mockSupabase(page, { failOn: 'daily_word_counts' })
  await page.goto('/')

  const retry = page.getByRole('button', { name: '다시 시도' })
  await expect(retry).toBeVisible()

  // queryError() appends the PostgREST code to the message; this exact string
  // only renders if queryError() ran, so it fails if that wrapping is removed.
  // The [object Object] check is a cheap belt-and-braces addition on top.
  await expect(page.getByText('mocked failure (PGRST500)', { exact: true })).toBeVisible()
  await expect(page.getByText('[object Object]')).toHaveCount(0)

  await mockSupabase(page)
  await retry.click()

  await expect(page.locator('svg text').filter({ hasText: /^예산안$/ })).toBeVisible()
})
