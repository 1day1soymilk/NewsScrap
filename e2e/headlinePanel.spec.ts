import { expect, test } from '@playwright/test'
import { mockSupabase } from './support/mockSupabase'
import { previousDayInSeoul, todayInSeoul } from './support/fixtures'

// formatDate가 ko-KR의 { month: 'long', day: 'numeric' }으로 만드는 것과 같은 글자.
// Intl을 다시 부르지 않는 것은 이 값이 이미 서버가 정한 KST 달력 날짜이기 때문이고,
// 앱의 shortDay가 Date를 만들지 않는 이유와 같다.
function dayLabel(iso: string): string {
  const [, month, day] = iso.split('-')
  return `${Number(month)}월 ${Number(day)}일`
}

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

test('the panel shows the word trajectory across collected days', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')
  // The file's own way of clicking a word on the canvas — the labels are SVG
  // text, so getByText would also match the event list's copy of the word.
  await page.locator('svg text').filter({ hasText: /^예산안$/ }).click()

  const panel = page.getByRole('complementary')
  await expect(panel.getByText(/2일 중 2일/)).toBeVisible()
  // 5/12 today against 1/8 yesterday — a rise in **share**, which is the whole
  // point: the count went 1 → 5 while the day went 8 → 12 headlines.
  await expect(panel.getByText(/\+233%/)).toBeVisible()
})

// 이 배선은 단위 테스트가 볼 수 없는 자리에 있다: 다른 날을 펼치는 것은 패널의
// 상태이고, 그것이 **캔버스의 날짜를 건드리지 않는다**는 것은 App.tsx의 계약이다.
test('기사를 날짜별로 나누고, 다른 날을 열어도 화면의 날짜는 움직이지 않는다', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')
  const panel = await openPanel(page)
  const dateInput = page.locator('input[type="date"]')

  // 오늘 칸이 열린 채로 시작한다 — 화면의 날짜가 곧 펼쳐진 날이다.
  await expect(panel.getByRole('button', { name: dayLabel(todayInSeoul()) })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(panel.getByRole('link')).toHaveCount(2)

  await panel.getByRole('button', { name: dayLabel(previousDayInSeoul()) }).click()

  // 어제 자 한 건으로 바뀐다. 두 날이 같은 답을 하는 목이었다면 이 단정은 아무것도
  // 걸러내지 못한다 — 그래서 mockSupabase의 headline_nouns가 날짜를 읽는다.
  await expect(panel.getByRole('link', { name: '예산안 편성 지침 발표' })).toBeVisible()
  await expect(panel.getByRole('link')).toHaveCount(1)

  // **여기가 요점이다.** 날짜 입력도, 캔버스도, URL도 그대로다. 검색으로 닿은 단어가
  // 날짜를 옮기지 않는 것과 같은 판단으로, 읽던 화면이 발밑에서 움직이면 안 된다.
  await expect(dateInput).toHaveValue(todayInSeoul())
  await expect(page.locator('svg text').filter({ hasText: /^한파$/ })).toBeVisible()
  await expect(page).toHaveURL((url) => url.searchParams.get('date') === todayInSeoul())
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
