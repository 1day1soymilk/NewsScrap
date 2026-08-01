import { expect, test } from '@playwright/test'
import { mockSupabase } from './support/mockSupabase'

async function openPanel(page: import('@playwright/test').Page) {
  await page.locator('svg text').filter({ hasText: /^예산안$/ }).click()
  return page.getByRole('complementary')
}

test('groups the headlines by section and badges each one', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')
  const panel = await openPanel(page)

  await expect(panel.getByText('정치')).toBeVisible()
  await expect(panel.getByText('경제')).toBeVisible()

  // HEADLINE_ROWS lists the economy row first; the panel orders by section in
  // tab order, so politics has to come out on top regardless.
  const titles = await panel.getByRole('link').allTextContents()
  expect(titles).toEqual(['여야 예산안 처리 합의', '예산안 국채 발행 규모 확정'])

  await expect(panel.getByText('2건')).toBeVisible()
})

test('says so when the word has no headlines', async ({ page }) => {
  await mockSupabase(page, { headline_nouns: [] })
  await page.goto('/')
  const panel = await openPanel(page)

  await expect(panel.getByText('관련 헤드라인이 없습니다.')).toBeVisible()
  await expect(panel.getByRole('link')).toHaveCount(0)
})

test('shows a skeleton rather than an empty list while loading', async ({ page }) => {
  await mockSupabase(page, { delayOn: { endpoint: 'headline_nouns', ms: 1500 } })
  await page.goto('/')
  const panel = await openPanel(page)

  await expect(panel.getByTestId('headline-skeleton')).toBeVisible()
  // The blank list and the loading list are different answers to the same
  // question, and only one of them is true at a time.
  await expect(panel.getByText('관련 헤드라인이 없습니다.')).toHaveCount(0)

  await expect(panel.getByRole('link', { name: '여야 예산안 처리 합의' })).toBeVisible()
  await expect(panel.getByTestId('headline-skeleton')).toBeHidden()
})

test('closes on Escape', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')
  const panel = await openPanel(page)
  await expect(panel).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  // Closing the panel is the same act as clearing the selection, so the URL
  // has to follow it back.
  await expect(page).toHaveURL((url) => !url.searchParams.has('word'))
})

test('reports a failed headline query inside the panel', async ({ page }) => {
  await mockSupabase(page, { failOn: 'headline_nouns' })
  await page.goto('/')
  const panel = await openPanel(page)

  await expect(panel.getByRole('alert')).toHaveText('mocked failure (PGRST500)')
  // The graph is unaffected: one query failing must not take the page down.
  await expect(page.locator('svg text').filter({ hasText: /^여야$/ })).toBeVisible()
})

test('sits at the bottom of a phone screen instead of over the graph', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await mockSupabase(page)
  await page.goto('/')
  const panel = await openPanel(page)

  const box = await panel.boundingBox()
  expect(box).not.toBeNull()
  // Full width, anchored to the bottom — the 320px side drawer it replaces
  // covered most of a 390px-wide graph, hiding the word that was just clicked.
  expect(box!.width).toBeGreaterThan(300)
  expect(box!.y + box!.height).toBeGreaterThan(700)
})
