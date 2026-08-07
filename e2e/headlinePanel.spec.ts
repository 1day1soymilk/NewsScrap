import { expect, test } from '@playwright/test'
import { mockSupabase } from './support/mockSupabase'
import { dayLabel, previousDayInSeoul, todayInSeoul } from './support/fixtures'

async function openPanel(page: import('@playwright/test').Page) {
  await page.locator('svg text').filter({ hasText: /^예산안$/ }).click()
  return page.getByRole('complementary')
}

// 패널은 **모든 날이 닫힌 채로** 열린다. 기사를 보려면 날을 하나 펼쳐야 하고, 그것이
// 대부분의 단정이 하려는 이야기의 앞부분이다.
async function openDay(panel: import('@playwright/test').Locator, iso: string) {
  await panel.getByRole('button', { name: dayLabel(iso) }).click()
}

test('groups the headlines by section and badges each one', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')
  const panel = await openPanel(page)
  await openDay(panel, todayInSeoul())

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
  await openDay(panel, todayInSeoul())

  await expect(panel.getByText('관련 헤드라인이 없습니다.')).toBeVisible()
  await expect(panel.getByRole('link')).toHaveCount(0)
})

test('shows a skeleton rather than an empty list while loading', async ({ page }) => {
  await mockSupabase(page, { delayOn: { endpoint: 'headline_nouns', ms: 1500 } })
  await page.goto('/')
  const panel = await openPanel(page)
  await openDay(panel, todayInSeoul())

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
  await openDay(panel, todayInSeoul())

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

// 이 배선은 단위 테스트가 볼 수 없는 자리에 있다: 날을 여닫는 것은 App이 들고 있는
// 집합이고, 그것이 **캔버스의 날짜를 건드리지 않는다**는 것도 App.tsx의 계약이다.
test('날짜 칸은 각각 여닫히고, 전부 닫을 수 있고, 화면의 날짜는 움직이지 않는다', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')
  const panel = await openPanel(page)
  const dateInput = page.locator('input[type="date"]')
  const today = panel.getByRole('button', { name: dayLabel(todayInSeoul()) })
  const yesterday = panel.getByRole('button', { name: dayLabel(previousDayInSeoul()) })

  // 전부 닫힌 채로 시작한다. 읽고 싶은 날을 고르는 것은 읽는 사람이다.
  await expect(today).toHaveAttribute('aria-expanded', 'false')
  await expect(panel.getByRole('link')).toHaveCount(0)

  await today.click()
  await expect(panel.getByRole('link')).toHaveCount(2)

  // 두 날이 **동시에** 열린다. 어제 것이 오늘 것을 밀어내지 않는다. 두 날이 같은
  // 답을 하는 목이었다면 이 단정은 아무것도 걸러내지 못한다 — 그래서 mockSupabase의
  // headline_nouns가 날짜를 읽는다.
  await yesterday.click()
  await expect(panel.getByRole('link', { name: '예산안 편성 지침 발표' })).toBeVisible()
  await expect(panel.getByRole('link')).toHaveCount(3)

  // **이것이 버그였다**: 열려 있는 줄을 다시 눌러도 닫히지 않아서, 전부 닫힌 상태를
  // 만들 방법이 아예 없었다.
  await yesterday.click()
  await expect(yesterday).toHaveAttribute('aria-expanded', 'false')
  await expect(panel.getByRole('link')).toHaveCount(2)

  await today.click()
  await expect(panel.getByRole('link')).toHaveCount(0)

  // **여기가 요점이다.** 날짜 입력도, 캔버스도, URL도 그대로다. 검색으로 닿은 단어가
  // 날짜를 옮기지 않는 것과 같은 판단으로, 읽던 화면이 발밑에서 움직이면 안 된다.
  await expect(dateInput).toHaveValue(todayInSeoul())
  await expect(page.locator('svg text').filter({ hasText: /^한파$/ })).toBeVisible()
  await expect(page).toHaveURL((url) => url.searchParams.get('date') === todayInSeoul())
})

// 전부 닫힌 채로 여는 것은 화면의 규칙이면서 **요청의 규칙이기도 하다.** 예전에는
// 단어를 누를 때마다 화면의 날짜 한 번이 무조건 나갔다.
//
// 여기서 지키는 두 번째 것은 궤적이 도착하기 **전**의 빈 목록을 "그릴 줄이 없다"로
// 읽지 않는 것이다. 그렇게 읽으면 도착 전 한 박자 동안 평평한 목록을 그리려고
// 화면의 날짜를 받아 버리고, 이 단정이 바로 그것을 잡는다.
test('opening a word asks for no headlines until a day is opened', async ({ page }) => {
  const asked: string[] = []
  await mockSupabase(page)
  page.on('request', (request) => {
    if (request.url().includes('/headline_nouns')) asked.push(request.url())
  })
  await page.goto('/')
  const panel = await openPanel(page)

  // 궤적은 도착했고(그래서 날짜 줄이 그려졌고) 그래도 헤드라인은 안 받았다.
  await expect(panel.getByRole('button', { name: dayLabel(todayInSeoul()) })).toBeVisible()
  expect(asked).toHaveLength(0)

  await openDay(panel, todayInSeoul())
  await expect(panel.getByRole('link')).toHaveCount(2)
  expect(asked).toHaveLength(1)
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
