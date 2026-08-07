import { expect, test } from '@playwright/test'
import {
  DEFAULT_GRAPH,
  DENSE_GRAPH,
  ECONOMY_GRAPH,
  EMPTY_GRAPH,
  EVENT_GRAPH,
  dayLabel,
  todayInSeoul,
} from './support/fixtures'
import type { GraphNodeRow, GraphPayload } from './support/fixtures'
import { mockSupabase } from './support/mockSupabase'

// 캔버스의 svg. **`svg path`만으로는 더 이상 엣지를 뜻하지 않는다** — 몫 도넛이
// 같은 페이지에 여섯 개의 path를 그리므로, 엣지를 세는 자리는 그래프의 svg 안으로
// 범위를 좁혀야 한다. 좁히지 않은 단정은 도넛이 아직 도착하지 않은 프레임에서만
// 통과하는, 경주에 기대는 시험이다.
const GRAPH = 'svg[role="group"]'

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
  await expect(page.locator(`${GRAPH} path`)).toHaveCount(1)
})

test('draws no cluster blob', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')

  // Named in the event list, never shaded. A cluster blob was the convex hull
  // of its members' label boxes, so on a real day it enclosed words belonging
  // to other events and asserted a membership they did not have.
  await expect(page.locator('svg polygon')).toHaveCount(0)
  await expect(page.getByText('오늘의 톱 스토리')).toHaveCount(0)
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
  await mockSupabase(page, {
    collected_dates: [{ collected_date: todayInSeoul(), headline_count: 12 }],
  })
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

  // 패널은 모든 날이 닫힌 채로 열린다. 기사를 보려면 날을 하나 펼쳐야 한다.
  await panel.getByRole('button', { name: dayLabel(todayInSeoul()) }).click()

  const link = panel.getByRole('link', { name: '여야 예산안 처리 합의' })
  await expect(link).toHaveAttribute(
    'href',
    'https://n.news.naver.com/article/001/0000000001',
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

  // And the third place the same ink appears: the 정치 arc of the share donut.
  // The donut is a key like the tab row is, so an arc naming a different red
  // from the words is worse than no donut — the whole reason the colour has one
  // definition in sectionColors.ts.
  const share = page.getByRole('figure')
  const politicsArc = share.locator('svg path[data-section="politics"]')
  const arcFill = await politicsArc.evaluate((el) => getComputedStyle(el).fill)
  expect(arcFill).toBe('rgb(190, 18, 60)')
})

test('states the day’s real section proportions, and says when the cap hid some', async ({
  page,
}) => {
  await mockSupabase(page)
  await page.goto('/')

  // 오늘의 픽스처는 12건을 4/3/2/1/1/1로 나눈다 — 사회 33%, 정치 25%, 경제 17%.
  // 이것이 이 가지의 결론이다: 수집은 고르지 않고, 그 사실을 숨기지 않는다.
  const share = page.getByRole('figure')
  await expect(share).toBeVisible()
  await expect(share.getByRole('listitem').first()).toContainText('사회')
  await expect(share.getByRole('listitem').first()).toContainText('34%')

  // 사회만 상한에 걸린 픽스처이므로 캡션이 뜬다. 걸리지 않은 날에는 뜨지 않아야
  // 하고, 그래야 이 표시가 값을 구별한다고 말할 수 있다.
  await expect(share.getByText(/\*가 붙은 섹션/)).toBeVisible()
  // 그리고 그 섹션이 어디인지 말로도 적혀 있다 — 별표만으로는 스크린 리더가
  // 캡션이 가리키는 행을 찾을 수 없다.
  await expect(
    share.getByRole('listitem').first().getByText(/수집 상한에 닿았을 수 있어 최소치/),
  ).toBeAttached()

  // 한 섹션 탭 위에서는 그리지 않는다 — 몫이 100%인 원은 아무 말도 하지 않는다.
  await page.getByRole('button', { name: '경제' }).click()
  await expect(page.getByRole('figure')).toHaveCount(0)
})

// --- 브라우저만이 답할 수 있는 것 ---------------------------------------------
//
// 배치의 기하는 scripts/layout/measure.ts가 픽스처 위에서 이미 잰다. 브라우저가
// 그보다 더 아는 것은 딱 하나, **진짜 글자 폭**이다 — 하네스에는 캔버스가 없어
// `length * fontSize * 0.95`로 대신하므로, 하네스에서 겹침 0인 배치가 여기서는
// 겹칠 수 있다. 그래서 아래 둘은 하네스의 중복이 아니다.

/** `M x1 y1 Q cx cy x2 y2`를 폴리라인으로 편다. 교차 판정은 이 위에서 한다. */
function flatten(d: string, steps = 24): [number, number][] {
  const n = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
  const [x1, y1, cx, cy, x2, y2] = n
  const points: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const m = 1 - t
    points.push([m * m * x1 + 2 * m * t * cx + t * t * x2, m * m * y1 + 2 * m * t * cy + t * t * y2])
  }
  return points
}

function segmentsCross(
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number],
): boolean {
  const side = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const d1 = side(p3, p4, p1)
  const d2 = side(p3, p4, p2)
  const d3 = side(p1, p2, p3)
  const d4 = side(p1, p2, p4)
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0
}

function meets(a: [number, number][], b: [number, number][]): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentsCross(a[i], a[i + 1], b[j], b[j + 1])) return true
    }
  }
  return false
}

test('평면으로 그릴 수 있는 하루는 브라우저에서도 선이 안 엇갈린다', async ({ page }) => {
  // DENSE_GRAPH는 정육면체다. 힘 균형에 맡기면 교차 23개가 나오고, 평면 경로가
  // 돌면 0이 된다 — 이 단정이 그 경로가 **실제로 브라우저에서 도는지**를 묻는
  // 유일한 자리다. 나머지 픽스처는 전부 그 분기를 안 밟는다.
  await mockSupabase(page, { keyword_graph: DENSE_GRAPH })
  await page.goto('/')
  await expect(page.locator('svg text').filter({ hasText: /^예산안$/ })).toBeVisible()

  // **선과 라벨은 한 번의 왕복으로 함께 읽는다.** 둘을 따로 읽으면 그 사이에
  // 재배치가 끼어들 수 있고, 그러면 끝점은 이전 배치의 것이고 상자는 새 배치의
  // 것이 되어 되짚기가 통째로 어긋난다 — 전체 스위트를 돌릴 때 실제로 그렇게
  // 됐고, 열두 선이 세 쌍으로 접혔다. 한 evaluate 안에서는 레이아웃이 갈릴 수 없다.
  const snapshot = await page.evaluate((graphSel) => {
    const svg = document.querySelector(graphSel)
    if (!svg) return null
    return {
      drawn: [...svg.querySelectorAll('path')].map((el) => el.getAttribute('d') ?? ''),
      labels: [...svg.querySelectorAll('text[role="button"]')].map((el) => {
        const b = (el as SVGGraphicsElement).getBBox()
        return { word: el.textContent ?? '', x: b.x, y: b.y, w: b.width, h: b.height }
      }),
    }
  }, GRAPH)
  if (!snapshot) throw new Error('graph svg not found')
  const { drawn, labels } = snapshot
  expect(drawn.length).toBe(12)

  // 선은 자기가 어느 두 단어를 잇는지 DOM에 적어 두지 않는다. 끝점이 라벨 상자
  // 바로 바깥에서 시작하므로 제일 가까운 상자로 되짚는다 — 그리고 **못 찾으면
  // 조용히 넘어가지 않고 터진다.** 끝점을 공유하는 쌍을 빼는 것이 이 시험의
  // 전부이므로, 되짚기가 틀리면 시험이 거짓으로 통과한다.
  // 중심까지가 아니라 **상자까지**의 거리다. 라벨 폭이 50px에서 200px까지 벌어지므로
  // 중심으로 재면 넓은 라벨의 모서리에서 출발한 선이 옆의 좁은 라벨을 더 가깝게
  // 본다 — 처음 판본이 열두 선을 열한 쌍으로 되짚은 것이 그것이었다.
  const nearest = (x: number, y: number) => {
    let best = labels[0]
    let smallest = Infinity
    for (const l of labels) {
      const dx = Math.max(l.x - x, 0, x - (l.x + l.w))
      const dy = Math.max(l.y - y, 0, y - (l.y + l.h))
      const d = Math.hypot(dx, dy)
      if (d < smallest) {
        smallest = d
        best = l
      }
    }
    return best.word
  }

  const lines = drawn.map((d) => flatten(d))
  const ends = lines.map((points) => [
    nearest(points[0][0], points[0][1]),
    nearest(points[points.length - 1][0], points[points.length - 1][1]),
  ])
  // 열두 선이 여덟 단어를 잇는다면 서로 다른 쌍 열두 개가 나와야 한다. 되짚기가
  // 어긋나면 여기서 걸린다.
  expect(new Set(ends.map((e) => [...e].sort().join('—'))).size).toBe(12)

  let crossings = 0
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      if (ends[i].some((w) => ends[j].includes(w))) continue
      if (meets(lines[i], lines[j])) crossings++
    }
  }
  expect(crossings).toBe(0)
})

test('어느 두 라벨도 겹치지 않는다 — 진짜로 측정된 글자 폭으로', async ({ page }) => {
  // 이 배치의 유일한 절대 불변식이고, 하네스가 대신해 줄 수 없는 유일한 단정이다.
  for (const graph of [DENSE_GRAPH, EVENT_GRAPH]) {
    await mockSupabase(page, { keyword_graph: graph })
    await page.goto('/')
    await expect(page.locator('svg text').first()).toBeVisible()

    const boxes = await page.locator('svg text[role="button"]').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return { word: el.textContent ?? '', x: r.x, y: r.y, w: r.width, h: r.height }
      }),
    )
    expect(boxes.length).toBe(graph.nodes.length)

    const touching: string[] = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          touching.push(`${a.word}/${b.word}`)
        }
      }
    }
    expect(touching).toEqual([])
  }
})
