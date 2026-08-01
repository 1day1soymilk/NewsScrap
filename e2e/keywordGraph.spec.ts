import { expect, test } from '@playwright/test'
import { DEFAULT_GRAPH, ECONOMY_GRAPH, EMPTY_GRAPH, todayInSeoul } from './support/fixtures'
import { mockSupabase } from './support/mockSupabase'

// Unlike d3-cloud, a force layout never silently drops a word for want of room,
// so presence assertions here are safe. Counts still are not: assert that a
// specific word is visible or absent, never how many were drawn.

test('renders every fixture word in the graph', async ({ page }) => {
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

test('draws an edge between words that share headlines', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  // One edge in the fixture (예산안—여야), so exactly one line. How many edges
  // are drawn is a property of the data rather than of what fits on the canvas,
  // so unlike a word count it is safe to assert precisely.
  await expect(page.locator('svg line')).toHaveCount(1)
})

test('names the day’s biggest event and shades it', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  // 예산안 and 여야 are the only connected pair in the fixture, so they are the
  // one event, and their headline counts (5 and 3) are what rank it.
  const caption = page.getByText('오늘의 톱 스토리')
  await expect(caption).toBeVisible()
  await expect(page.getByText('예산안 · 여야')).toBeVisible()
  await expect(page.getByText('8건')).toBeVisible()

  // One connected pair, so one blob. 국회 and 한파 are joined to nothing and
  // are not events.
  await expect(page.locator('svg polygon')).toHaveCount(1)
})

test('dims everything outside the clicked word’s neighbourhood', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  const words = page.locator('svg text')
  await words.filter({ hasText: /^예산안$/ }).click()

  // 여야 shares an edge with 예산안 and stays lit; 국회 has no edge and recedes.
  await expect(words.filter({ hasText: /^예산안$/ })).toHaveAttribute('opacity', '1')
  await expect(words.filter({ hasText: /^여야$/ })).toHaveAttribute('opacity', '1')
  await expect(words.filter({ hasText: /^국회$/ })).toHaveAttribute('opacity', '0.1')

  // Clicking the lit word again clears the focus.
  await words.filter({ hasText: /^예산안$/ }).click()
  await expect(words.filter({ hasText: /^국회$/ })).toHaveAttribute('opacity', '1')
})

test('fades a word the RPC marked as demoted', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  // 한파 arrives with faded: true, meaning past node_limit or dictionary
  // 'demote'. It is drawn, not dropped — that distinction is the whole reason
  // the RPC ships a flag instead of truncating the list.
  const demoted = page.locator('svg text').filter({ hasText: /^한파$/ })
  await expect(demoted).toBeVisible()
  await expect(demoted).toHaveAttribute('opacity', '0.38')
})

test('marks a word that grew against the previous collected day', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  // WORD_COUNTS has 예산안 at 1/8 of the previous day and 5/12 of this one.
  // Every other word holds its count while the day grows, so its share falls.
  await expect(page.getByText('직전 수집일 대비 급상승')).toBeVisible()
  await expect(page.locator('svg text').filter({ hasText: /^▲$/ })).toHaveCount(1)

  // The mark is decoration; the count it stands for has to reach a reader who
  // cannot see it.
  await expect(
    page.getByRole('button', { name: '예산안, 5건, 직전 수집일 대비 3.3배' }),
  ).toBeVisible()
})

test('marks nothing when there is no previous day to compare against', async ({ page }) => {
  await mockSupabase(page, { collected_dates: [{ collected_date: todayInSeoul() }] })
  await page.goto('/')

  // On the first collected day every word is new, which is true and useless.
  await expect(page.locator('svg text').filter({ hasText: /^예산안$/ })).toBeVisible()
  await expect(page.locator('svg text').filter({ hasText: /^▲$/ })).toHaveCount(0)
  await expect(page.getByText('직전 수집일 대비 급상승')).toHaveCount(0)
})

test('reaches a word by keyboard and opens its headlines', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  // <text> is not focusable by default; the component adds tabIndex and a
  // keydown handler so the graph is not mouse-only.
  const budget = page.getByRole('button', { name: '예산안, 5건' })
  await budget.focus()
  await expect(budget).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('complementary')).toBeVisible()
  await expect(budget).toHaveAttribute('aria-pressed', 'true')
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

test('swaps the graph when a category is selected', async ({ page }) => {
  await mockSupabase(page, {
    // p_category rides in the POST body, not the query string: keyword_graph is
    // an RPC.
    keyword_graph: ({ body }) => (body.p_category === 'economy' ? ECONOMY_GRAPH : DEFAULT_GRAPH),
  })
  await page.goto('/')

  const words = page.locator('svg text')
  await expect(words.filter({ hasText: /^예산안$/ })).toBeVisible()

  await page.getByRole('button', { name: '경제' }).click()

  await expect(words.filter({ hasText: /^금리$/ })).toBeVisible()
  await expect(words.filter({ hasText: /^예산안$/ })).toHaveCount(0)
})

test('shows the empty state when the day has no words', async ({ page }) => {
  await mockSupabase(page, { keyword_graph: EMPTY_GRAPH })
  await page.goto('/')

  await expect(page.getByText('아직 수집된 데이터가 없습니다.')).toBeVisible()
  // Distinguishes the empty state from the error state (the first assertion
  // does not, since KeywordGraph renders only the paragraph or the svg).
  await expect(page.getByRole('button', { name: '다시 시도' })).toHaveCount(0)
})

test('surfaces a query failure and recovers on retry', async ({ page }) => {
  await mockSupabase(page, { failOn: 'keyword_graph' })
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
