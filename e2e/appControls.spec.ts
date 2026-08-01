import { expect, test } from '@playwright/test'
import {
  DEFAULT_GRAPH,
  ECONOMY_GRAPH,
  EMPTY_GRAPH,
  previousDayInSeoul,
  todayInSeoul,
} from './support/fixtures'
import { mockSupabase } from './support/mockSupabase'

// The date, the section and the selected word live in the query string, so a
// reload or a pasted link lands on the same picture. These cover that round
// trip and the date stepper that moves through the archive.

const YESTERDAY_GRAPH = {
  nodes: [{ ...DEFAULT_GRAPH.nodes[0], word: '개각', count: 4 }],
  edges: [],
}

test('opens on the state carried in the query string', async ({ page }) => {
  await mockSupabase(page, {
    keyword_graph: ({ body }) => (body.p_category === 'economy' ? ECONOMY_GRAPH : DEFAULT_GRAPH),
  })
  await page.goto('/?category=economy')

  await expect(page.locator('svg text').filter({ hasText: /^금리$/ })).toBeVisible()
  // The tab has to agree with the graph, or the link restores half a state.
  await expect(page.getByRole('button', { name: '경제' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('opens the headline panel for a word named in the query string', async ({ page }) => {
  await mockSupabase(page)
  await page.goto(`/?word=${encodeURIComponent('예산안')}`)

  await expect(page.getByRole('complementary')).toBeVisible()
  await expect(page.getByRole('link', { name: '여야 예산안 처리 합의' })).toBeVisible()
})

test('ignores a category slug that matches no section', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/?category=sports')

  // Falls back to the all-categories view rather than filtering on something
  // nothing matches, which no tab could ever undo.
  await expect(page.locator('svg text').filter({ hasText: /^예산안$/ })).toBeVisible()
  await expect(page).toHaveURL((url) => !url.searchParams.has('category'))
})

test('writes the selection to the URL and restores it on Back', async ({ page }) => {
  await mockSupabase(page, {
    keyword_graph: ({ body }) => (body.p_category === 'economy' ? ECONOMY_GRAPH : DEFAULT_GRAPH),
  })
  await page.goto('/')

  await page.getByRole('button', { name: '경제' }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('category') === 'economy')

  await page.locator('svg text').filter({ hasText: /^금리$/ }).click()
  await expect(page).toHaveURL((url) => url.searchParams.get('word') === '금리')

  await page.goBack()
  await expect(page.getByRole('complementary')).toBeHidden()

  await page.goBack()
  await expect(page.locator('svg text').filter({ hasText: /^예산안$/ })).toBeVisible()
})

test('steps to the previous collected date and back', async ({ page }) => {
  await mockSupabase(page, {
    keyword_graph: ({ body }) =>
      body.p_date === previousDayInSeoul() ? YESTERDAY_GRAPH : DEFAULT_GRAPH,
  })
  await page.goto('/')

  const dateInput = page.locator('input[type="date"]')
  await expect(dateInput).toHaveValue(todayInSeoul())

  // Today is the newest collected date, so there is nowhere forward to go.
  await expect(page.getByRole('button', { name: '다음 수집일' })).toBeDisabled()

  await page.getByRole('button', { name: '이전 수집일' }).click()
  await expect(dateInput).toHaveValue(previousDayInSeoul())
  await expect(page.locator('svg text').filter({ hasText: /^개각$/ })).toBeVisible()

  // Oldest date in the archive: now it is the back button that has nowhere to
  // go, and the forward one that works.
  await expect(page.getByRole('button', { name: '이전 수집일' })).toBeDisabled()
  await page.getByRole('button', { name: '다음 수집일' }).click()
  await expect(dateInput).toHaveValue(todayInSeoul())
})

test('shows a skeleton in the graph’s place while it loads', async ({ page }) => {
  await mockSupabase(page, { delayOn: { endpoint: 'keyword_graph', ms: 1500 } })
  await page.goto('/')

  await expect(page.getByTestId('graph-skeleton')).toBeVisible()
  await expect(page.locator('svg text').filter({ hasText: /^예산안$/ })).toBeVisible()
  await expect(page.getByTestId('graph-skeleton')).toBeHidden()
})

test('leaves the date stepper alone when nothing has been collected', async ({ page }) => {
  await mockSupabase(page, { collected_dates: [], keyword_graph: EMPTY_GRAPH })
  await page.goto('/')

  await expect(page.getByRole('button', { name: '이전 수집일' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '다음 수집일' })).toBeDisabled()
})
