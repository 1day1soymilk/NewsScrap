// scripts/layout/measure.ts
//
// 배치가 실제로 나아졌는지 재는 자. `scripts/analysis/`가 체를 재듯이 이건
// 캔버스를 잰다 — "보기 좋아졌다"로 끝내지 않기 위해서다.
//
//   node --experimental-strip-types scripts/layout/measure.ts
//
// 픽스처(`graphDays.json`)는 배포된 프로젝트에서 뽑은 네 날의 keyword_graph
// 응답이고, `pullFixture.mjs`로 다시 뜬다. 날이 바뀌면 그려지는 70단어가 바뀌고
// 엣지 집합도 같이 바뀌므로(마이그레이션 0007이 기록한 함정), 체를 건드린 뒤에는
// 픽스처부터 다시 떠야 한다.
//
// **글자 폭은 브라우저와 다르다.** 캔버스가 없으므로 KeywordGraph.tsx의 jsdom
// 대체식(`length * fontSize * 0.95`)을 그대로 쓴다. 절대 픽셀 수는 화면과 다르지만
// 전후 비교는 같은 식 위에서 이뤄지므로 유효하다 — 이 자는 두 배치를 서로
// 비교하기 위한 것이지 화면을 예측하기 위한 것이 아니다.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { computeGraphLayout } from '../../src/components/graphLayout.ts'
import type { EdgeCurve, MeasuredWord, PlacedEdge, PlacedNode } from '../../src/components/graphLayout.ts'
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

// `desktop` 1024는 캔버스가 `max-w-5xl` 안에 있을 때 실제로 받던 폭이고, 그 상한이
// 풀린 지금도 **그대로 둔다** — 이 README의 모든 옛 표가 그 폭 위에서 쟀으므로,
// 바꾸면 비교할 수 있는 것이 오늘 잰 것뿐이 된다. 좁은 쪽은 아이폰 SE 세로.
//
// `wide` 1600은 그래프 상자의 새 상한이다. 넓은 창에서 캔버스가 실제로 받는 폭이라
// 세로가 얼마나 줄고 겹침이 여전히 0인지는 이 줄로 재야 답이 나온다.
const VIEWS = [
  { name: 'desktop', width: 1024 },
  { name: 'phone', width: 358 },
  { name: 'wide', width: 1600 },
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

// --- 지표 -----------------------------------------------------------------

/** 곡선을 폴리라인으로 편다. 교차 판정은 이 위에서 한다. */
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

function segmentsCross(
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number],
): boolean {
  const d = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const d1 = d(p3, p4, p1)
  const d2 = d(p3, p4, p2)
  const d3 = d(p1, p2, p3)
  const d4 = d(p1, p2, p4)
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))
}

/**
 * 서로 교차하는 엣지 **쌍**의 수. 한 쌍은 몇 번 만나든 한 번만 센다.
 *
 * 끝점을 공유하는 두 엣지는 제외한다 — 그건 단어 위에서 만나는 것이지 눈이
 * 길을 잃는 교차가 아니다.
 */
function crossings(drawn: PlacedEdge[]): number {
  const lines = drawn.map((e) => polyline(e.curve!))
  let count = 0
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      const x = drawn[i]
      const y = drawn[j]
      if (x.a === y.a || x.a === y.b || x.b === y.a || x.b === y.b) continue
      if (meets(lines[i], lines[j])) count++
    }
  }
  return count
}

function meets(a: [number, number][], b: [number, number][]): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentsCross(a[i], a[i + 1], b[j], b[j + 1])) return true
    }
  }
  return false
}

/** 겹치는 라벨 박스 쌍의 수. 이 배치의 불변식이라 0이어야 한다. */
function overlaps(nodes: PlacedNode[]): number {
  let count = 0
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      if (
        Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth &&
        Math.abs(a.y - b.y) < a.halfHeight + b.halfHeight
      ) {
        count++
      }
    }
  }
  return count
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((x, y) => x - y)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// --- 실행 -----------------------------------------------------------------

interface Row {
  view: string
  day: string
  nodes: number
  edges: number
  drawn: number
  crowded: number
  crossings: number
  /** 같은 구역 안의 선끼리만. 배치가 사건 하나를 얼마나 잘 폈는지. */
  xIn: number
  /** 다리가 낀 교차. 구역을 어떤 순서로 늘어놓았는지의 문제다. */
  xBr: number
  bridges: number
  lenMed: number
  lenMax: number
  /**
   * 선을 하나도 안 가진 단어 중, 중심이 **어떤 사건 구역 안**에 떨어진 것의 수.
   *
   * 흩뿌리기가 구역 안쪽 자리까지 후보로 두기 때문에 생기는 열이다. 그 허용은
   * 잠정적이었고 판단은 숫자를 보고 하기로 했으므로, 그 숫자가 여기다. 구역은
   * 그려지지 않으므로 "남의 이야기 안에 앉았다"는 것은 겹침도 관통도 아니지만,
   * 같은 이야기의 단어들 사이에 무관한 단어가 끼면 여백으로 읽히던 구분이
   * 흐려진다 — 예전 안쪽 고리 배치가 실패한 이유가 그것이었다.
   */
  inRegion: number
  overlap: number
  /**
   * 그려진 svg의 폭. **높이와 짝으로만 읽어야 하는 값이다.**
   *
   * svg는 제 크기로 그려진 뒤 `max-w-full`로 컨테이너에 맞춰 **균일 축소**되므로,
   * 폭이 뷰의 폭을 넘어가면 그 비율만큼 글자도 같이 작아진다 — 최소 글자 크기가
   * 14인데 배율 0.6이면 화면에서는 8.4px다. 높이만 보면 "자리를 더 쓴다"로 읽히는
   * 변화가 실제로는 "글자가 작아진다"인 경우가 있고, 그 둘은 다른 문제다.
   */
  width: number
  height: number
  /**
   * 한 번의 `computeGraphLayout`에 걸린 시간(ms), 세 번 중 제일 짧은 것.
   *
   * CLAUDE.md가 재작성 전의 48ms를 적어 두고 "이후로 다시 안 쟀다"고 스스로
   * 밝히고 있었다. 그 뒤로 평면 경로가 얹혔는데 그 비용이 만만치 않다 —
   * `triangulate`는 비인접 쌍마다 평면성 판정을 한 번씩 돌리고(13점이면 78회),
   * `minimumDropSet`은 크기 2에서 C(27,2)=351회, `flatPositions`는 후보 테두리
   * 예순네 개마다 가우스 소거와 교차 검사를 한다. 그리고 **리사이즈는 8px마다
   * 이걸 다시 돈다.**
   *
   * 최소값을 쓰는 것은 GC와 JIT 예열을 빼기 위해서다. 절대값은 이 기계의 것이고,
   * 이 자의 다른 열들과 마찬가지로 **두 배치를 서로 비교하기 위한 것**이다.
   */
  ms: number
}

const rows: Row[] = []

for (const view of VIEWS) {
  for (const [day, graph] of Object.entries(fixture)) {
    const words = measuredWords(graph.nodes)

    let fastest = Infinity
    for (let run = 0; run < 3; run++) {
      const started = performance.now()
      computeGraphLayout(measuredWords(graph.nodes), graph.edges, { width: view.width })
      fastest = Math.min(fastest, performance.now() - started)
    }

    const layout = computeGraphLayout(words, graph.edges, { width: view.width })
    const drawn = layout.edges.filter((e) => e.curve !== null)
    const lengths = drawn.map((e) => Math.hypot(e.x2 - e.x1, e.y2 - e.y1))

    // 어느 단어가 어느 구역에 있는지. 구역이 없는 단어(무연결)는 undefined다.
    const regionOf = new Map<string, number>()
    for (const region of layout.regions) {
      for (const word of region.words) regionOf.set(word, region.id)
    }
    const inner = drawn.filter(
      (e) => regionOf.has(e.a) && regionOf.get(e.a) === regionOf.get(e.b),
    )
    const all = crossings(drawn)

    // 선을 가진 단어는 반드시 구역을 받으므로, 구역에 안 든 단어가 곧 무연결
    // 단어다. 중심으로 재는 것은 구역이 그려지지 않아 경계가 눈에 없기 때문이다 —
    // 라벨 귀퉁이가 걸친 것과 단어가 그 이야기 한가운데 앉은 것은 다른 일이다.
    const inRegion = layout.nodes.filter(
      (n) =>
        !regionOf.has(n.word) &&
        layout.regions.some(
          (r) => n.x >= r.x && n.x <= r.x + r.width && n.y >= r.y && n.y <= r.y + r.height,
        ),
    ).length

    rows.push({
      view: view.name,
      day,
      nodes: layout.nodes.length,
      edges: layout.edges.length,
      drawn: drawn.length,
      crowded: drawn.filter((e) => !e.curve!.clear).length,
      crossings: all,
      xIn: crossings(inner),
      xBr: all - crossings(inner),
      bridges: drawn.length - inner.length,
      lenMed: Math.round(median(lengths)),
      lenMax: Math.round(Math.max(0, ...lengths)),
      inRegion,
      overlap: overlaps(layout.nodes),
      width: Math.round(layout.bounds.width),
      height: layout.bounds.height,
      ms: Math.round(fastest * 10) / 10,
    })
  }
}

const columns: (keyof Row)[] = [
  'view', 'day', 'nodes', 'edges', 'drawn', 'crowded', 'crossings', 'xIn', 'xBr',
  'bridges', 'lenMed', 'lenMax', 'inRegion', 'overlap', 'width', 'height', 'ms',
]
const widths = columns.map((c) =>
  Math.max(String(c).length, ...rows.map((r) => String(r[c]).length)),
)
const line = (cells: string[]) =>
  cells.map((cell, i) => cell.padStart(widths[i])).join('  ')

console.log(line(columns.map(String)))
console.log(widths.map((w) => '-'.repeat(w)).join('  '))
for (const row of rows) console.log(line(columns.map((c) => String(row[c]))))
