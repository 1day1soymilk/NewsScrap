// scripts/layout/bridges.ts
//
// `measure.ts`의 `xBr` 한 열을 쪼개는 자.
//
//   node --experimental-strip-types --import ./scripts/layout/register.mjs scripts/layout/bridges.ts
//
// "다리가 낀 교차"는 한 덩어리가 아니라 성격이 다른 셋이 섞인 것이고, 어느
// 것이냐에 따라 손댈 곳이 완전히 다르다:
//
//   다리 × 다리              — 구역을 늘어놓은 **순서** 문제. orderForPacking.
//   다리 × 남의 구역 내부선   — 다리가 남의 상자를 관통. 역시 순서 문제.
//   다리 × **자기** 구역 내부선 — 다리를 든 단어가 자기 상자 안에서 앉은 **자리**
//                              문제. 순서로는 손댈 수 없다.
//
// 이걸 쪼개 보기 전까지 남은 난잡함이 순서 탓인 줄 알았고 틀렸다. 재어 보니 앞의
// 둘은 여덟 칸 통틀어 4개뿐이고 나머지가 전부 세 번째였다 — 그래서 나온 것이
// graphLayout.ts의 `faceBridges`다. 자세한 것은 README를 볼 것.
//
// 총계가 내려간 것만으로는 원인을 맞혔는지 알 수 없으므로, `xBr`를 움직이는
// 작업은 measure.ts의 표와 **이 표를 같이** 남긴다.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { computeGraphLayout } from '../../src/components/graphLayout.ts'
import type { EdgeCurve, MeasuredWord, PlacedEdge } from '../../src/components/graphLayout.ts'
import { computeFontSizes } from '../../src/components/wordCloudLayout.ts'
import type { GraphEdge } from '../../src/lib/types.ts'

interface FixtureNode {
  word: string
  count: number
  faded: boolean
  category_slug: string | null
}
type Fixture = Record<string, { nodes: FixtureNode[]; edges: GraphEdge[] }>

const here = dirname(fileURLToPath(import.meta.url))
const fixture: Fixture = JSON.parse(readFileSync(join(here, 'graphDays.json'), 'utf8'))

const VIEWS = [
  { name: 'desktop', width: 1024 },
  { name: 'phone', width: 358 },
]

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
  const side = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      const d1 = side(b[j], b[j + 1], a[i])
      const d2 = side(b[j], b[j + 1], a[i + 1])
      const d3 = side(a[i], a[i + 1], b[j])
      const d4 = side(a[i], a[i + 1], b[j + 1])
      if ((d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0)) return true
    }
  }
  return false
}

/** 끝점을 공유하는 두 선은 교차로 세지 않는다 — measure.ts와 같은 규칙이다. */
function shares(x: PlacedEdge, y: PlacedEdge): boolean {
  return x.a === y.a || x.a === y.b || x.b === y.a || x.b === y.b
}

/** 선분이 축정렬 사각형을 실제로 관통하는가. 슬랩법. */
function hitsBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  box: { x: number; y: number; width: number; height: number },
): boolean {
  let t0 = 0
  let t1 = 1
  const dx = x2 - x1
  const dy = y2 - y1
  const slabs: [number, number][] = [
    [-dx, x1 - box.x],
    [dx, box.x + box.width - x1],
    [-dy, y1 - box.y],
    [dy, box.y + box.height - y1],
  ]
  for (const [p, q] of slabs) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
  }
  return t0 < t1
}

interface Row {
  view: string
  day: string
  bridges: number
  /** 다리끼리 엇갈린 것. 구역을 늘어놓은 순서의 문제. */
  brBr: number
  /** 다리가 자기 구역의 내부 선을 자른 것. 상자 안에서의 자리 문제. */
  brOwn: number
  /** 다리가 남의 구역의 내부 선을 자른 것. 역시 순서의 문제. */
  brOther: number
  /** 다리가 실제로 관통한 남의 상자 수의 합. */
  overBoxes: number
}

const rows: Row[] = []

for (const view of VIEWS) {
  for (const [day, graph] of Object.entries(fixture)) {
    const layout = computeGraphLayout(measuredWords(graph.nodes), graph.edges, { width: view.width })

    const regionOf = new Map<string, number>()
    for (const region of layout.regions) {
      for (const word of region.words) regionOf.set(word, region.id)
    }

    const drawn = layout.edges.filter((e) => e.curve !== null)
    const bridges = drawn.filter(
      (e) => regionOf.has(e.a) && regionOf.has(e.b) && regionOf.get(e.a) !== regionOf.get(e.b),
    )
    const inner = drawn.filter((e) => regionOf.has(e.a) && regionOf.get(e.a) === regionOf.get(e.b))

    const line = new Map<PlacedEdge, [number, number][]>()
    for (const e of drawn) line.set(e, polyline(e.curve!))

    const row: Row = { view: view.name, day, bridges: bridges.length, brBr: 0, brOwn: 0, brOther: 0, overBoxes: 0 }

    for (let i = 0; i < bridges.length; i++) {
      const bridge = bridges[i]
      for (let j = i + 1; j < bridges.length; j++) {
        if (shares(bridge, bridges[j])) continue
        if (meets(line.get(bridge)!, line.get(bridges[j])!)) row.brBr++
      }

      const ends = new Set([regionOf.get(bridge.a), regionOf.get(bridge.b)])
      for (const edge of inner) {
        if (shares(bridge, edge)) continue
        if (!meets(line.get(bridge)!, line.get(edge)!)) continue
        if (ends.has(regionOf.get(edge.a))) row.brOwn++
        else row.brOther++
      }

      row.overBoxes += layout.regions.filter(
        (r) => !ends.has(r.id) && hitsBox(bridge.x1, bridge.y1, bridge.x2, bridge.y2, r),
      ).length
    }

    rows.push(row)
  }
}

const columns: (keyof Row)[] = ['view', 'day', 'bridges', 'brBr', 'brOwn', 'brOther', 'overBoxes']
const widths = columns.map((c) => Math.max(String(c).length, ...rows.map((r) => String(r[c]).length)))
const render = (cells: string[]) => cells.map((cell, i) => cell.padStart(widths[i])).join('  ')

console.log(render(columns.map(String)))
console.log(widths.map((w) => '-'.repeat(w)).join('  '))
for (const row of rows) console.log(render(columns.map((c) => String(row[c]))))
