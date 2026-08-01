import { expect, test } from '@playwright/test'
import { DEFAULT_GRAPH, ECONOMY_GRAPH, EMPTY_GRAPH, todayInSeoul } from './support/fixtures'
import type { GraphNodeRow, GraphPayload } from './support/fixtures'
import { mockSupabase } from './support/mockSupabase'

// DEFAULT_GRAPH only has four words, and "the viewport is cropped to the
// labels, not to the canvas the simulation ran in" (src/App.tsx / CLAUDE.md):
// four words clump into a small bounding box regardless of container width,
// so the rendered SVG never approaches its 640px ceiling. The sticky-header
// regression below needs a graph tall enough that the page genuinely
// overflows a short viewport, so it uses a wide spread of words instead.
const TALL_GRAPH: GraphPayload = {
  nodes: Array.from({ length: 36 }, (_, i): GraphNodeRow => ({
    word: `단어${i}`,
    count: 1 + (i % 12),
    spec: 0.5,
    standalone: 0.9,
    neighbors_per_doc: 1.5,
    assoc: 0.6,
    passed_by: 'length',
    category_slug: ['politics', 'economy', 'society', 'culture', 'world', 'it'][i % 6],
    faded: false,
  })),
  edges: [],
}

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

  // One edge in the fixture (예산안—여야), so exactly one stroke. How many edges
  // are drawn is a property of the data rather than of what fits on the canvas,
  // so unlike a word count it is safe to assert precisely.
  //
  // One <path> per edge is the point: the routing used to cut every label box
  // out of a straight line and draw the remainder, so a single relationship
  // could arrive as up to five separate strokes.
  await expect(page.locator('svg path')).toHaveCount(1)
})

test('names the day’s biggest event', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  // 예산안 and 여야 are the only connected pair in the fixture, so they are the
  // one event, and their headline counts (5 and 3) are what rank it.
  const caption = page.getByText('오늘의 톱 스토리')
  await expect(caption).toBeVisible()
  await expect(page.getByText('예산안 · 여야')).toBeVisible()
  await expect(page.getByText('8건')).toBeVisible()

  // Named, never shaded. A cluster blob was the convex hull of its members'
  // label boxes, so on a real day it enclosed words belonging to other events
  // and asserted a membership they did not have.
  await expect(page.locator('svg polygon')).toHaveCount(0)
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

test('keeps a keyboard-focused word clear of the sticky header', async ({ page }) => {
  // Short enough that the page genuinely scrolls: TALL_GRAPH's 36 words push
  // the SVG close to its 640px ceiling, and the header, captions and padding
  // push the full page well past this viewport. The suite's default 1280x900
  // project viewport does not scroll at all here, which would make the
  // assertion below vacuous.
  await page.setViewportSize({ width: 800, height: 200 })
  await mockSupabase(page, { keyword_graph: TALL_GRAPH })
  await page.goto('/')

  const header = page.locator('header')
  await expect(header).toBeVisible()
  const headerBox = (await header.boundingBox())!

  // Whichever word sits closest to the top of the graph is the one a sticky
  // header without scroll-margin would swallow; find it by rendered position
  // rather than assuming DOM order matches visual order.
  const words = page.locator('svg text[role="button"]')
  const rects = await words.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom })),
  )
  const topIndex = rects.reduce(
    (best, rect, i) => (rect.top < rects[best].top ? i : best),
    0,
  )
  const topWord = words.nth(topIndex)

  // Scroll the target word fully out of view above the fold first, so
  // focusing it forces a real scroll-into-view rather than a no-op on an
  // already-visible node — the bug only shows up when the browser has to
  // scroll to reach it.
  await page.evaluate((y) => window.scrollTo(0, y + 50), rects[topIndex].bottom)
  await expect(topWord).not.toBeInViewport()

  await topWord.focus()
  await expect(topWord).toBeFocused()

  // The header is sticky and stays pinned to the top of the viewport, so its
  // box is comparable directly against the freshly-focused word's: the word
  // must land below it, not underneath it.
  const wordBox = (await topWord.boundingBox())!
  expect(wordBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height)
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

test('resolves the design tokens to real colours in the SVG', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  // 예산안 is a politics word in the fixture and the all-categories view is the
  // default, so it must render in the politics ink rather than falling back to
  // the neutral one.
  const word = page.locator('svg text').filter({ hasText: /^예산안$/ })
  await expect(word).toBeVisible()
  const fill = await word.evaluate((el) => getComputedStyle(el).fill)
  // #be123c. An unresolved var() computes to rgb(0, 0, 0) here, which is the
  // failure this test exists for.
  expect(fill).toBe('rgb(190, 18, 60)')

  // The same politics ink on the tab that filters for it: the tab row is the
  // canvas's colour key, so the two resolving differently would make the key
  // wrong rather than merely plain.
  const tabDot = page.getByRole('button', { name: '정치' }).locator('span').first()
  const dotColor = await tabDot.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(dotColor).toBe('rgb(190, 18, 60)')
})
