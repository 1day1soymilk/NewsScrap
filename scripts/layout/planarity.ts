// scripts/layout/planarity.ts
//
//   node --experimental-strip-types --import ./scripts/layout/register.mjs scripts/layout/planarity.ts
//
// 조밀한 사건이 내는 교차가 **위상 때문인지 배치 때문인지** 가르는 자.
//
// `measure.ts`의 `xIn` 열은 "한 사건 안에서 선이 몇 번 엇갈리는가"만 말하고, 그것이
// 어떻게 그려도 생기는 것인지 이 배치가 못 편 것인지는 말하지 않는다. 그 둘은 손댈
// 곳이 완전히 다르다 — 앞의 것은 배치를 아무리 고쳐도 안 내려간다.
//
// 사건마다 찍는 것:
//
//   planar    그 부분그래프를 선이 안 만나게 그릴 수 있는가
//   skew      못 그린다면 간선을 최소 몇 개 빼야 하는가.
//             **이 수가 피할 수 없는 교차의 하한이다.**
//   xIn       지금 실제로 나오는 교차 (데스크톱 / 폰)
//
// `skew`와 `xIn`의 차이가 배치가 아직 못 편 몫이다. 차이가 0에 가까우면 배치는
// 할 만큼 한 것이고, 평면 임베딩을 붙여도 얻을 것이 없다.
//
// 사건 구분(루뱅 + 병합)은 폭과 무관하므로 사건 목록은 한 번만 구한다. 교차는
// 좌표에서 나오므로 뷰마다 따로 센다.

import { computeGraphLayout } from '../../src/components/graphLayout.ts'
import type { EdgeCurve, MeasuredWord, PlacedEdge } from '../../src/components/graphLayout.ts'
import { isPlanar, skewness } from '../../src/components/planar.ts'
import { computeFontSizes } from '../../src/components/wordCloudLayout.ts'
import { loadFixture } from './fixture.ts'
import type { FixtureNode } from './fixture.ts'

const { fixture, path: fixturePath } = loadFixture()

const VIEWS = [
  { name: 'desktop', width: 1024 },
  { name: 'phone', width: 358 },
]

/** 전수 탐색의 상한. 넘으면 평면 경로가 값을 못 한다는 뜻이라 굳이 더 안 센다. */
const MAX_SKEW = 4

function measuredWords(nodes: FixtureNode[]): MeasuredWord[] {
  const sized = computeFontSizes(nodes.map((n) => ({ word: n.word, count: n.count })))
  const fadedByWord = new Map(nodes.map((n) => [n.word, n.faded]))
  return sized.map((s) => ({
    word: s.text,
    count: s.count,
    fontSize: s.fontSize,
    textWidth: s.text.length * s.fontSize * 0.95,
    faded: fadedByWord.get(s.text) ?? false,
  }))
}

function polyline(curve: EdgeCurve, steps = 24): [number, number][] {
  const points: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const m = 1 - t
    points.push([
      m * m * curve.x1 + 2 * m * t * curve.cx + t * t * curve.x2,
      m * m * curve.y1 + 2 * m * t * curve.cy + t * t * curve.y2,
    ])
  }
  return points
}

function meets(a: [number, number][], b: [number, number][]): boolean {
  const sideOf = (p: number[], q: number[], r: number[]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      const d1 = sideOf(b[j], b[j + 1], a[i])
      const d2 = sideOf(b[j], b[j + 1], a[i + 1])
      const d3 = sideOf(a[i], a[i + 1], b[j])
      const d4 = sideOf(a[i], a[i + 1], b[j + 1])
      if (d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0) return true
    }
  }
  return false
}

/** 한 사건 안에서 서로 교차하는 그려진 선의 쌍. 끝점을 공유하는 쌍은 뺀다. */
function crossingsWithin(edgesIn: PlacedEdge[]): number {
  const lines = edgesIn.map((e) => polyline(e.curve!))
  let count = 0
  for (let i = 0; i < edgesIn.length; i++) {
    for (let j = i + 1; j < edgesIn.length; j++) {
      const x = edgesIn[i]
      const y = edgesIn[j]
      if (x.a === y.a || x.a === y.b || x.b === y.a || x.b === y.b) continue
      if (meets(lines[i], lines[j])) count++
    }
  }
  return count
}

interface Row {
  day: string
  event: string
  words: number
  edges: number
  planar: string
  skew: string
  xDesk: number
  xPhone: number
  gap: string
}

const rows: Row[] = []

for (const [day, graph] of Object.entries(fixture)) {
  const words = measuredWords(graph.nodes)

  const layouts = new Map(
    VIEWS.map((v) => [v.name, computeGraphLayout(words, graph.edges, { width: v.width })]),
  )
  const base = layouts.get('desktop')!

  for (const region of base.regions) {
    const members = new Set(region.words)
    const within = graph.edges.filter((e) => members.has(e.a) && members.has(e.b))
    if (within.length < 2) continue

    const planar = isPlanar(region.words, within)
    const skew = planar ? 0 : skewness(region.words, within, MAX_SKEW)

    const crossings = VIEWS.map((v) => {
      const layout = layouts.get(v.name)!
      const drawn = layout.edges.filter((e) => e.curve !== null && members.has(e.a) && members.has(e.b))
      return crossingsWithin(drawn)
    })

    rows.push({
      day,
      event: region.words.slice(0, 3).join('·'),
      words: region.words.length,
      edges: within.length,
      planar: planar ? 'yes' : 'NO',
      skew: skew === null ? `>${MAX_SKEW}` : String(skew),
      xDesk: crossings[0],
      xPhone: crossings[1],
      gap: skew === null ? '?' : String(Math.max(crossings[0], crossings[1]) - skew),
    })
  }
}

// 교차를 내고 있는 사건이 먼저. 그것이 이 표를 보는 이유다.
rows.sort((a, b) => Math.max(b.xDesk, b.xPhone) - Math.max(a.xDesk, a.xPhone) || a.day.localeCompare(b.day))

const columns: (keyof Row)[] = ['day', 'event', 'words', 'edges', 'planar', 'skew', 'xDesk', 'xPhone', 'gap']
const widths = columns.map((c) => Math.max(String(c).length, ...rows.map((r) => String(r[c]).length)))
const render = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ')

console.log(`fixture: ${fixturePath}  (${Object.keys(fixture).length} days)`)
console.log(render(columns.map(String)))
console.log(widths.map((w) => '-'.repeat(w)).join('  '))
for (const row of rows) console.log(render(columns.map((c) => String(row[c]))))

const drawing = rows.filter((r) => Math.max(r.xDesk, r.xPhone) > 0)
const unavoidable = drawing.reduce((sum, r) => sum + (r.skew === `>${MAX_SKEW}` ? 0 : Number(r.skew)), 0)
const actual = drawing.reduce((sum, r) => sum + Math.max(r.xDesk, r.xPhone), 0)
console.log(
  `\n교차를 내는 사건 ${drawing.length}개 — 피할 수 없는 하한 합계 ${unavoidable}, 실제 ${actual}.` +
  ` 배치가 못 편 몫은 ${actual - unavoidable}.`,
)
