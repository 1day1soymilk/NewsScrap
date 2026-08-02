import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { EVENT_GRAPH } from './support/fixtures'
import { mockSupabase } from './support/mockSupabase'

// EVENT_GRAPH는 삼각형 두 개가 약한 엣지 하나로 닿아 있다. 루뱅이 그것을 두
// 커뮤니티로 가르고, 엣지가 하나뿐이라 합치기 문턱 2에 걸리지 않으므로 두
// 사건으로 남는다 — 그리고 국회와 폭염이 그 사이의 다리가 된다.
const withEvents = { keyword_graph: EVENT_GRAPH }

// 캔버스에서 물러난 단어의 불투명도. KeywordGraph의 UNFOCUSED_OPACITY와 같아야
// 한다. 다리 단어에는 고정 잉크가 없으므로 검사할 표식이 없고, 불투명도가
// 유일한 관측 지점이다.
const UNFOCUSED = '0.1'

function label(page: Page, word: string) {
  return page.locator('svg text').filter({ hasText: new RegExp(`^${word}$`) })
}

// 목록의 버튼과 캔버스의 <text role="button">은 접근 가능한 이름이 둘 다 그
// 단어를 담으므로, 범위를 좁히지 않으면 strict mode에 걸린다.
function eventItem(page: Page, word: string) {
  return page
    .getByRole('list', { name: '오늘의 사건' })
    .getByRole('button', { name: new RegExp(word) })
}

test('사건을 기사 수와 함께 목록으로 그린다', async ({ page }) => {
  await mockSupabase(page, withEvents)
  await page.goto('/')

  const list = page.getByRole('list', { name: '오늘의 사건' })
  await expect(list).toBeVisible()

  // 12와 11은 event_headline_counts가 돌려준 중복 제거 수이고, 멤버 카운트의
  // 합(22와 17)이 아니다. 화면의 숫자가 합계에서 오지 않는다는 것이 요점이다.
  await expect(list.getByRole('button', { name: /예산안/ })).toContainText('12건')
  await expect(list.getByRole('button', { name: /폭염/ })).toContainText('11건')

  // 어디에도 붙지 않은 단어는 사건이 아니다.
  await expect(list.getByRole('button', { name: /까마귀/ })).toHaveCount(0)
})

test('사건을 누르면 캔버스가 좁혀지고 패널이 열린다', async ({ page }) => {
  await mockSupabase(page, withEvents)
  await page.goto('/')

  await eventItem(page, '예산안').click()

  // 멤버는 살고 나머지는 물러난다. **멤버의 이웃까지 살리지는 않는다** — 국회는
  // 폭염과 엣지를 갖고 있지만, 합치기가 두 사건을 합치지 않기로 판정한 것을
  // 화면이 뒤집으면 안 된다.
  await expect(label(page, '국회')).not.toHaveAttribute('opacity', UNFOCUSED)
  await expect(label(page, '폭염')).toHaveAttribute('opacity', UNFOCUSED)
  await expect(label(page, '까마귀')).toHaveAttribute('opacity', UNFOCUSED)

  await expect(page.getByRole('heading', { name: /관련 헤드라인/ })).toBeVisible()
  await expect(page.getByRole('link', { name: '국회 예산안 심사 착수' })).toBeVisible()

  // 사건 이름은 단어 목록이므로 따옴표를 두르지 않는다.
  await expect(page.getByRole('heading', { name: /^예산안 · 여야 · 국회 관련 헤드라인/ })).toBeVisible()
})

test('선택한 사건이 URL에 남고 뒤로 가기가 되돌린다', async ({ page }) => {
  await mockSupabase(page, withEvents)
  await page.goto('/')

  await eventItem(page, '예산안').click()
  await expect(page).toHaveURL(/event=/)

  await page.goBack()
  await expect(page).not.toHaveURL(/event=/)
  await expect(label(page, '폭염')).not.toHaveAttribute('opacity', UNFOCUSED)
})

test('다리 단어는 양쪽 사건 전체를 살리고, 보통 단어는 직접 이웃까지만 살린다', async ({
  page,
}) => {
  await mockSupabase(page, withEvents)
  await page.goto('/')

  // 보통 단어: 여야는 예산안·국회와만 엣지를 갖는다. 폭염 쪽은 물러난다.
  await label(page, '여야').click()
  await expect(label(page, '예산안')).not.toHaveAttribute('opacity', UNFOCUSED)
  await expect(label(page, '폭염')).toHaveAttribute('opacity', UNFOCUSED)
  await expect(label(page, '열대야')).toHaveAttribute('opacity', UNFOCUSED)
  await label(page, '여야').click()

  // 다리 단어: 국회는 폭염과 엣지를 하나 갖고 있다. 직접 이웃인 폭염만이 아니라
  // **폭염이 속한 사건 전체**가 산다 — 열대야와 양산은 국회의 이웃이 아니다.
  await label(page, '국회').click()
  await expect(label(page, '폭염')).not.toHaveAttribute('opacity', UNFOCUSED)
  await expect(label(page, '열대야')).not.toHaveAttribute('opacity', UNFOCUSED)
  await expect(label(page, '양산')).not.toHaveAttribute('opacity', UNFOCUSED)
  await expect(label(page, '예산안')).not.toHaveAttribute('opacity', UNFOCUSED)
  // 어느 사건에도 속하지 않은 단어는 여전히 물러난다.
  await expect(label(page, '까마귀')).toHaveAttribute('opacity', UNFOCUSED)

  // 패널에는 **그 단어의** 헤드라인이 열린다. 두 사건의 헤드라인을 합쳐 열면
  // 그 단어가 왜 접점인지가 오히려 묻힌다.
  await expect(page.getByRole('heading', { name: /^"국회" 관련 헤드라인/ })).toBeVisible()
})

test('캔버스 단어를 누르면 그 단어가 속한 사건의 행만 목록에 남는다', async ({ page }) => {
  await mockSupabase(page, withEvents)
  await page.goto('/')

  await label(page, '여야').click()

  await expect(eventItem(page, '예산안')).toHaveAttribute('data-related', 'true')
  await expect(eventItem(page, '폭염')).not.toHaveAttribute('data-related', 'true')
  await expect(eventItem(page, '폭염')).toHaveCSS('opacity', UNFOCUSED)
})

test('다리 단어를 누르면 그것이 닿는 사건의 행이 전부 남는다', async ({ page }) => {
  await mockSupabase(page, withEvents)
  await page.goto('/')

  // 캔버스가 두 사건 전체를 살리는 것과 같은 집합이어야 한다. 목록이 더 좁게
  // 밝히면 다리가 다리로 보이지 않는다.
  await label(page, '국회').click()

  await expect(eventItem(page, '예산안')).toHaveAttribute('data-related', 'true')
  await expect(eventItem(page, '폭염')).toHaveAttribute('data-related', 'true')
})

test('어느 사건에도 속하지 않는 단어를 누르면 아무 행도 물러나지 않는다', async ({ page }) => {
  await mockSupabase(page, withEvents)
  await page.goto('/')

  // 까마귀는 엣지가 없다. 밝힐 사건이 없을 때 목록 전체가 흐려지면 고장으로
  // 읽히므로, 그때는 아무것도 건드리지 않는다.
  await label(page, '까마귀').click()

  await expect(eventItem(page, '예산안')).toHaveCSS('opacity', '1')
  await expect(eventItem(page, '폭염')).toHaveCSS('opacity', '1')
})

test('단어 선택과 사건 선택은 상호 배타다', async ({ page }) => {
  await mockSupabase(page, withEvents)
  await page.goto('/')

  await eventItem(page, '예산안').click()
  await expect(page).toHaveURL(/event=/)

  await label(page, '까마귀').click()
  await expect(page).toHaveURL(/word=/)
  await expect(page).not.toHaveURL(/event=/)
})

test('카운트 RPC가 실패해도 목록은 그린다 — 숫자만 빈다', async ({ page }) => {
  await mockSupabase(page, { ...withEvents, failOn: 'event_headline_counts' })
  await page.goto('/')

  await expect(eventItem(page, '예산안')).toBeVisible()
  await expect(page.getByRole('list', { name: '오늘의 사건' })).not.toContainText('건')
})
