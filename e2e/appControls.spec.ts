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

test('does not flash the skeleton when returning to a view it already holds', async ({ page }) => {
  // The response cache hands back the same promise, so a view that has been
  // seen resolves in a microtask. Showing the skeleton for that frame would
  // undo the whole point of taking the round trip to zero — nothing would look
  // any faster.
  // toBeHidden()으로는 잡히지 않는다 — 자동 재시도 단언은 한 프레임 뒤에 이미
  // 사라진 것을 보지 못하고 그냥 통과한다(확인함). 나타났는지 자체를
  // MutationObserver로 관측해야 한다.
  await mockSupabase(page, { delayOn: { endpoint: 'keyword_graph', ms: 800 } })
  await page.goto('/')
  await expect(page.getByTestId('graph-skeleton')).toBeHidden()

  const header = page.locator('header')
  await header.getByRole('button', { name: '정치' }).click()
  await expect(page.getByTestId('graph-skeleton')).toBeVisible()
  await expect(page.getByTestId('graph-skeleton')).toBeHidden()

  await page.evaluate(() => {
    const w = window as unknown as { __sawSkeleton: boolean }
    w.__sawSkeleton = false
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="graph-skeleton"]')) w.__sawSkeleton = true
    }).observe(document.body, { childList: true, subtree: true })
  })

  // 전체로 돌아온다. 이 뷰는 이미 손에 있다.
  await header.getByRole('button', { name: '전체' }).click()
  await expect(page.locator('svg text').filter({ hasText: /^예산안$/ })).toBeVisible()
  expect(
    await page.evaluate(() => (window as unknown as { __sawSkeleton: boolean }).__sawSkeleton),
  ).toBe(false)
})

test('leaves the date stepper alone when nothing has been collected', async ({ page }) => {
  await mockSupabase(page, { collected_dates: [], keyword_graph: EMPTY_GRAPH })
  await page.goto('/')

  await expect(page.getByRole('button', { name: '이전 수집일' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '다음 수집일' })).toBeDisabled()
})

// 유상증자 is in WORD_DIRECTORY and deliberately not in DEFAULT_GRAPH — that is
// the whole point of it, and if a later fixture edit adds it to the graph these
// tests stop testing anything.
test('a searched word that was not drawn opens the panel and says so', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  // Read only after first paint has settled: the mount effect that fills
  // ?date= into the URL runs via replaceState, and reading page.url() right
  // after goto() races it — goto() can resolve before React's first passive
  // effect flushes, which was observed reading `before` as null every time.
  await expect(page.locator('svg text').filter({ hasText: /^예산안$/ })).toBeVisible()
  const before = new URL(page.url()).searchParams.get('date')

  await page.getByRole('searchbox').fill('유상증자')
  await page.getByRole('option', { name: /유상증자/ }).click()

  const panel = page.getByRole('complementary')
  await expect(panel).toBeVisible()
  await expect(panel.getByText(/이 날 화면에는 없는 단어/)).toBeVisible()

  // The day did not move under the reader. Asserted on the date rather than on
  // a hand-encoded word, which would be testing URLSearchParams' escaping.
  await expect
    .poll(() => new URL(page.url()).searchParams.get('word'))
    .toBe('유상증자')
  expect(new URL(page.url()).searchParams.get('date')).toBe(before)
})

test('a searched word that was drawn does not carry the note', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  await page.getByRole('searchbox').fill('예산안')
  await page.getByRole('option', { name: /예산안/ }).click()

  const panel = page.getByRole('complementary')
  await expect(panel.getByText(/2일 중 2일/)).toBeVisible()
  await expect(panel.getByText(/이 날 화면에는 없는 단어/)).toHaveCount(0)
})
