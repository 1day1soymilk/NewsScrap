import { describe, expect, it } from 'vitest'
import { computeGraphLayout, nextLayoutWidth, routeEdge, seededRandom } from './graphLayout'
import type { EdgeCurve, MeasuredWord, PlacedNode } from './graphLayout'
import type { GraphEdge } from '../lib/types'

// 높이가 없다. 배치는 주어진 폭에 채우고 필요한 만큼 높아지므로 높이는 결과다.
const SIZE = { width: 800 }

function word(text: string, fontSize = 20): MeasuredWord {
  return {
    word: text,
    count: 5,
    fontSize,
    // Korean glyphs are close to square, so an em per character is a fair
    // stand-in for the measurement the browser does.
    textWidth: text.length * fontSize,
    faded: false,
  }
}

function edge(a: string, b: string, npmi = 0.8): GraphEdge {
  return { a, b, cooc: 3, npmi }
}

function distance(a: PlacedNode, b: PlacedNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function find(nodes: PlacedNode[], text: string): PlacedNode {
  const node = nodes.find((n) => n.word === text)
  if (!node) throw new Error(`${text} was not placed`)
  return node
}

function overlaps(a: PlacedNode, b: PlacedNode): boolean {
  return (
    Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth &&
    Math.abs(a.y - b.y) < a.halfHeight + b.halfHeight
  )
}

// Samples the curve rather than solving it: the routing bends by its own
// arithmetic, so checking it with that same arithmetic would only prove the
// code agrees with itself. A tolerance of one pixel keeps rounding out of it.
function curveCrossesBox(curve: EdgeCurve, box: PlacedNode): boolean {
  const steps = 200
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const m = 1 - t
    const x = m * m * curve.x1 + 2 * m * t * curve.cx + t * t * curve.x2
    const y = m * m * curve.y1 + 2 * m * t * curve.cy + t * t * curve.y2
    if (
      Math.abs(x - box.x) < box.halfWidth - 1 &&
      Math.abs(y - box.y) < box.halfHeight - 1
    ) {
      return true
    }
  }
  return false
}

// How far the control point sits off the chord. Zero means the quadratic has
// degenerated to the straight line, which is what "not bent" means here.
function bowOf(curve: EdgeCurve): number {
  const dx = curve.x2 - curve.x1
  const dy = curve.y2 - curve.y1
  const length = Math.hypot(dx, dy)
  if (length === 0) return 0
  return Math.abs((curve.cx - curve.x1) * dy - (curve.cy - curve.y1) * dx) / length
}

function node(text: string, x: number, y: number, halfWidth = 20, halfHeight = 12): PlacedNode {
  return {
    word: text,
    count: 5,
    fontSize: 20,
    textWidth: halfWidth * 2,
    faded: false,
    x,
    y,
    halfWidth,
    halfHeight,
  }
}

describe('seededRandom', () => {
  it('replays the same sequence for the same seed', () => {
    const draw = (seed: number) => {
      const rng = seededRandom(seed)
      return [rng(), rng(), rng()]
    }
    expect(draw(42)).toEqual(draw(42))
    expect(draw(42)).not.toEqual(draw(43))
  })

  it('stays inside [0, 1)', () => {
    const rng = seededRandom(7)
    for (let i = 0; i < 1000; i++) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('routeEdge', () => {
  // Placed by hand rather than through the simulation: the point is a label
  // sitting squarely on the straight line, which the force layout will not
  // reliably produce on demand.
  const left = node('가가', 100, 200)
  const right = node('다다', 400, 200)
  const middle = node('나나', 250, 200)

  it('bends around a label sitting on the straight line', () => {
    const curve = routeEdge(left, right, [left, middle, right])
    expect(curve).not.toBeNull()

    // The test is only worth anything if the straight line really would have
    // hit 나나 — otherwise there was nothing to bend around.
    expect(Math.abs((left.y + right.y) / 2 - middle.y)).toBeLessThan(middle.halfHeight)

    expect(curveCrossesBox(curve!, middle)).toBe(false)
    expect(bowOf(curve!)).toBeGreaterThan(middle.halfHeight)
  })

  it('stays straight when the same two words have a clear run', () => {
    const curve = routeEdge(left, right, [left, right])
    expect(bowOf(curve!)).toBeLessThan(1)
  })

  it('draws a route it could not keep clear, and says so', () => {
    // A wall of labels straight across the gap: no single quadratic gets past
    // it within the bow cap. The stroke is still drawn, flagged so the renderer
    // can fade it rather than let it fight the words it runs under.
    const wall = Array.from({ length: 9 }, (_, i) => node(`벽${i}`, 250, 60 + i * 45, 60, 22))
    const curve = routeEdge(left, right, [left, right, ...wall])

    expect(curve).not.toBeNull()
    expect(curve!.clear).toBe(false)
  })

  it('bends the short way round', () => {
    // 나나 sits above the chord, so the stroke has to dip below it — a bow
    // towards the label would have to travel past the whole box instead.
    const above = node('나나', 250, 188)
    const curve = routeEdge(left, right, [left, above, right])!
    const side = (curve.cy - curve.y1) * (right.x - left.x)
    expect(side).toBeGreaterThan(0)
  })
})

describe('computeGraphLayout', () => {
  it('returns nothing for no words', () => {
    expect(computeGraphLayout([], [edge('가', '나')], SIZE)).toEqual({
      nodes: [],
      edges: [],
      regions: [],
      communities: new Map(),
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    })
  })

  it('crops the bounds to the labels rather than to the canvas', () => {
    // The viewport is cropped to this box, which is what stops a category with
    // eight words from rendering as a clump adrift in a full-size frame.
    const words = ['폭염', '양산', '코스피'].map((w) => word(w))
    const { nodes, bounds } = computeGraphLayout(words, [], SIZE)

    expect(bounds.width).toBeLessThan(SIZE.width)

    for (const node of nodes) {
      expect(node.x - node.halfWidth).toBeGreaterThanOrEqual(bounds.x)
      expect(node.y - node.halfHeight).toBeGreaterThanOrEqual(bounds.y)
      expect(node.x + node.halfWidth).toBeLessThanOrEqual(bounds.x + bounds.width)
      expect(node.y + node.halfHeight).toBeLessThanOrEqual(bounds.y + bounds.height)
    }
  })

  it('places the same graph identically on every run', () => {
    // The simulation runs to a fixed tick count with a seeded random source
    // precisely so a reload does not reshuffle the picture, and so the e2e
    // suite can click a word by position.
    const words = ['폭염', '양산', '코스피', '트럼프', '국힘'].map((w) => word(w))
    const edges = [edge('폭염', '양산'), edge('코스피', '트럼프', 0.4)]

    const first = computeGraphLayout(words, edges, SIZE)
    const second = computeGraphLayout(words, edges, SIZE)

    expect(first).toEqual(second)
  })

  it('ignores the seed for a graph with no coincident nodes', () => {
    // Not a property to rely on, but worth pinning: d3-force reaches the random
    // source only to jiggle two nodes sharing the exact same point, and then by
    // +/-5e-7. Anyone who changes the seed expecting a different arrangement
    // should find out here rather than by staring at an unchanged screen.
    const words = ['폭염', '양산', '코스피'].map((w) => word(w))
    const a = computeGraphLayout(words, [], { ...SIZE, seed: 1 })
    const b = computeGraphLayout(words, [], { ...SIZE, seed: 2 })
    expect(a.nodes).toEqual(b.nodes)
  })

  it('keeps every label inside the reported bounds', () => {
    // 캔버스가 아니라 bounds다. 폭은 주어지지만 높이는 배치가 정하므로, 라벨이
    // 어떤 상자 안에 있는지 물을 수 있는 유일한 상대가 스스로 보고한 그 상자다.
    const words = Array.from({ length: 40 }, (_, i) => word(`단어${i}`, 14 + (i % 5) * 10))
    const { nodes, bounds } = computeGraphLayout(words, [], SIZE)

    for (const node of nodes) {
      expect(node.x - node.halfWidth).toBeGreaterThanOrEqual(bounds.x)
      expect(node.x + node.halfWidth).toBeLessThanOrEqual(bounds.x + bounds.width)
      expect(node.y - node.halfHeight).toBeGreaterThanOrEqual(bounds.y)
      expect(node.y + node.halfHeight).toBeLessThanOrEqual(bounds.y + bounds.height)
    }
  })

  it('폭보다 넓은 라벨은 넘치게 두고 bounds가 그만큼 넓어진다', () => {
    // 억지로 폭 안에 밀어 넣는 쪽이 더 나쁘다. svg는 자기 크기로 그려진 뒤
    // max-w-full로 축소되므로, 넘친 만큼 전체가 조금 작게 그려질 뿐이다.
    const wide = word('아주긴단어입니다', 60)
    const { nodes, bounds } = computeGraphLayout([wide], [], { width: 200 })

    expect(bounds.width).toBeGreaterThan(200)
    expect(nodes[0].x - nodes[0].halfWidth).toBeGreaterThanOrEqual(bounds.x)
  })

  it('separates labels that would otherwise overlap', () => {
    // Enough words at enough sizes that the seeded spiral cannot avoid
    // collisions on its own — only the rectangular collision force resolves
    // these, and an overlap is the one layout fault a reader notices instantly.
    const words = Array.from({ length: 40 }, (_, i) => word(`말${i}`, 14 + (i % 5) * 10))
    const { nodes } = computeGraphLayout(words, [], SIZE)

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        expect(overlaps(nodes[i], nodes[j])).toBe(false)
      }
    }
  })

  it('이어진 짝은 서로에게, 이어지지 않은 단어보다 가깝다', () => {
    // 예전에는 링크 힘이 당겨서 그렇게 됐다. 지금은 배치가 그렇게 만든다 —
    // 이어진 둘은 자기 구역 안에 나란히 놓이고, 이어지지 않은 단어는 구역
    // 바깥의 띠로 간다. 결과는 같지만 보장의 출처가 다르다.
    const words = ['가가', '나나', '다다', '라라'].map((w) => word(w))
    const { nodes } = computeGraphLayout(words, [edge('가가', '나나', 0.9)], SIZE)

    const linked = distance(find(nodes, '가가'), find(nodes, '나나'))
    for (const loner of ['다다', '라라']) {
      expect(distance(find(nodes, '가가'), find(nodes, loner))).toBeGreaterThan(linked)
      expect(distance(find(nodes, '나나'), find(nodes, loner))).toBeGreaterThan(linked)
    }
  })

  it('gives edge endpoints the coordinates of the nodes they join', () => {
    const words = ['폭염', '양산'].map((w) => word(w))
    const { nodes, edges } = computeGraphLayout(words, [edge('폭염', '양산')], SIZE)

    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ a: '폭염', b: '양산', cooc: 3, npmi: 0.8 })
    expect([edges[0].x1, edges[0].y1]).toEqual([find(nodes, '폭염').x, find(nodes, '폭염').y])
    expect([edges[0].x2, edges[0].y2]).toEqual([find(nodes, '양산').x, find(nodes, '양산').y])
  })

  it('keeps the whole curve clear of every label box', () => {
    // The property the routing exists for: no part of any stroke overlaps any
    // word, including the two words the stroke connects.
    const words = ['폭염', '양산', '코스피', '트럼프', '국힘', '하이닉스'].map((w) => word(w, 28))
    const { nodes, edges } = computeGraphLayout(
      words,
      [edge('폭염', '하이닉스', 0.9), edge('코스피', '국힘', 0.5), edge('양산', '트럼프', 0.7)],
      SIZE,
    )

    const drawn = edges.map((e) => e.curve).filter((c) => c !== null)
    expect(drawn.length).toBeGreaterThan(0)

    for (const curve of drawn) {
      for (const node of nodes) {
        expect(curveCrossesBox(curve, node), `${node.word}`).toBe(false)
      }
    }
  })

  // The complaint this routing was rewritten for. Cutting the label boxes out
  // of a straight line split one relationship into as many as five collinear
  // dashes, which reads as several relationships; strength is already carried
  // by the stroke width.
  it('keeps drawing a long edge across a crowded canvas', () => {
    // Thirty words in this canvas is dense enough that a stroke spanning it
    // cannot miss every label. Being unable to route cleanly is not a reason to
    // drop the relationship — that lost 18 of 68 edges when it was tried.
    const words = Array.from({ length: 30 }, (_, i) => word(`단어${i}`, 24))
    const { edges } = computeGraphLayout(
      words,
      [edge('단어0', '단어17'), edge('단어3', '단어28'), edge('단어9', '단어22')],
      SIZE,
    )

    expect(edges).toHaveLength(3)
    for (const e of edges) {
      expect(e.curve, `${e.a}—${e.b}`).not.toBeNull()
    }
  })

  it('leaves the stroke straight when nothing is in the way', () => {
    // Two words alone on the canvas: bending would be arbitrary, so the control
    // point stays on the chord.
    const words = ['폭염', '양산'].map((w) => word(w, 30))
    const { edges } = computeGraphLayout(words, [edge('폭염', '양산')], SIZE)

    expect(bowOf(edges[0].curve!)).toBeLessThan(1)
  })

  it('leaves a gap at both ends rather than starting inside the label', () => {
    const words = ['폭염', '양산'].map((w) => word(w, 30))
    const { nodes, edges } = computeGraphLayout(words, [edge('폭염', '양산')], SIZE)

    const curve = edges[0].curve!
    const a = find(nodes, '폭염')
    const b = find(nodes, '양산')

    // The drawn stroke is strictly shorter than centre-to-centre.
    const drawn = Math.hypot(curve.x2 - curve.x1, curve.y2 - curve.y1)
    expect(drawn).toBeLessThan(distance(a, b))
    expect(drawn).toBeGreaterThan(0)
  })

  it('drops an edge entirely when a label swallows it', () => {
    // Two words close enough that nothing survives between them: better to draw
    // no line than a two-pixel speck.
    const words = [word('가가', 60), word('나나', 60)]
    const { edges } = computeGraphLayout(words, [edge('가가', '나나')], { width: 120, padding: 1 })
    expect(edges[0].curve).toBeNull()
  })

  it('drops an edge whose endpoint was never placed', () => {
    // d3's forceLink throws on an unresolvable endpoint, so one stray word in
    // the edge list would otherwise take the whole graph down.
    const { edges } = computeGraphLayout([word('폭염')], [edge('폭염', '없는단어')], SIZE)
    expect(edges).toEqual([])
  })

  it('carries font size and the faded flag through untouched', () => {
    const words: MeasuredWord[] = [
      { ...word('폭염', 48), faded: false },
      { ...word('양산', 14), faded: true },
    ]
    const { nodes } = computeGraphLayout(words, [], SIZE)

    expect(find(nodes, '폭염')).toMatchObject({ fontSize: 48, faded: false })
    expect(find(nodes, '양산')).toMatchObject({ fontSize: 14, faded: true })
  })
})

describe('communities', () => {
  it('그려진 모든 단어에 배정을 준다 — 엣지가 없는 단어까지', () => {
    const words = [word('폭염'), word('양산'), word('까마귀')]
    const layout = computeGraphLayout(words, [edge('폭염', '양산')], SIZE)

    expect(layout.communities.size).toBe(3)
    expect(layout.communities.has('까마귀')).toBe(true)
  })

  it('한 구역의 단어들은 정확히 하나의 커뮤니티에 속한다', () => {
    // 노출된 배정과 캔버스가 실제로 쓴 분할이 갈리면 목록이 캔버스와 다른 하루를
    // 말하게 된다.
    const words = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map((w) => word(w))
    const layout = computeGraphLayout(words, [edge('a1', 'a2'), edge('b1', 'b2'), edge('c1', 'c2')], SIZE)

    expect(layout.regions.length).toBeGreaterThan(1)

    const seen = new Set<number>()
    for (const region of layout.regions) {
      const ids = new Set(region.words.map((w) => layout.communities.get(w)))
      expect(ids.size).toBe(1)
      const [id] = [...ids]
      expect(id).toBeDefined()
      expect(seen.has(id!)).toBe(false)
      seen.add(id!)
    }
  })

  it('단어가 없으면 빈 맵이다', () => {
    expect(computeGraphLayout([], [], SIZE).communities.size).toBe(0)
  })
})

describe('사건 구역', () => {
  // 다리 하나로 붙은 두 삼각형. 연결 요소로는 하나지만 모듈러리티로는 둘이고,
  // MERGE_MIN_EDGES가 2이므로 다리 하나로는 합쳐지지 않는다.
  const bridged = {
    words: ['가1', '가2', '가3', '나1', '나2', '나3'].map((w) => word(w)),
    edges: [
      edge('가1', '가2', 0.9),
      edge('가2', '가3', 0.9),
      edge('가3', '가1', 0.9),
      edge('나1', '나2', 0.9),
      edge('나2', '나3', 0.9),
      edge('나3', '나1', 0.9),
      edge('가1', '나1', 0.35),
    ],
  }

  it('다리 하나로 붙은 두 이야기를 다른 구역에 놓는다', () => {
    // 연결 요소가 틀리는 바로 그 경우다. 전체 보기에서는 공유 단어를 타고
    // 서로 무관한 네 이야기가 아홉 단어짜리 한 덩어리로 이어졌었다.
    const { regions } = computeGraphLayout(bridged.words, bridged.edges, SIZE)

    expect(regions).toHaveLength(2)
    for (const region of regions) {
      expect(new Set(region.words.map((w) => w[0])).size).toBe(1)
    }
  })

  it('구역끼리 겹치지 않는다', () => {
    // 이 배치의 핵심 불변식. 분리가 힘의 균형이 아니라 패킹에서 나오므로
    // 보장되어야 한다.
    const { regions } = computeGraphLayout(bridged.words, bridged.edges, SIZE)

    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        const a = regions[i]
        const b = regions[j]
        const apart =
          a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
        expect(apart).toBe(true)
      }
    }
  })

  it('구역은 자기 멤버의 라벨을 담는다', () => {
    const { nodes, regions } = computeGraphLayout(bridged.words, bridged.edges, SIZE)

    for (const region of regions) {
      for (const text of region.words) {
        const node = find(nodes, text)
        expect(node.x - node.halfWidth).toBeGreaterThanOrEqual(region.x - 1)
        expect(node.x + node.halfWidth).toBeLessThanOrEqual(region.x + region.width + 1)
        expect(node.y - node.halfHeight).toBeGreaterThanOrEqual(region.y - 1)
        expect(node.y + node.halfHeight).toBeLessThanOrEqual(region.y + region.height + 1)
      }
    }
  })

  it('다리를 든 단어를 상대 구역을 바라보는 쪽에 놓는다', () => {
    // 구역 밖으로 나가는 선이 자기 사건의 내부 선을 자르는 것이, 재어 보니
    // 다리가 낀 교차의 거의 전부였다(데스크톱 2026-08-03은 14개 중 14개).
    // 상자를 거울처럼 뒤집어 고치는데, 그 결과는 **고정점**이다 — 어느 쪽으로
    // 뒤집어도 다리가 더 짧아지지 않는 상태. 여기서 세 가지 뒤집기를 다 재는
    // 이유가 그것이고, 이 단정이 통과하면 뒤집기 순환이 끝났다는 뜻이기도 하다.
    const { nodes, regions } = computeGraphLayout(bridged.words, bridged.edges, SIZE)

    for (const [mine, theirs] of [
      ['가1', '나1'],
      ['나1', '가1'],
    ] as const) {
      const node = find(nodes, mine)
      const other = find(nodes, theirs)
      const box = regions.find((r) => r.words.includes(mine))!
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      const away = Math.hypot(node.x - other.x, node.y - other.y)

      for (const [flipX, flipY] of [
        [true, false],
        [false, true],
        [true, true],
      ] as const) {
        const x = flipX ? 2 * cx - node.x : node.x
        const y = flipY ? 2 * cy - node.y : node.y
        expect(Math.hypot(x - other.x, y - other.y)).toBeGreaterThanOrEqual(away - 1)
      }
    }
  })

  it('엣지가 없는 단어는 어느 구역에도 들어가지 않는다', () => {
    // 70개 중 23~28개가 그렇다. 예전에는 캔버스 안쪽 고리로 보내져 사건들
    // 사이사이에 끼었고, 그것이 가운데를 붐비게 만든 주범이었다.
    const words = ['트럼프', '공습', '까마귀', '폭염'].map((w) => word(w))
    const { regions } = computeGraphLayout(words, [edge('트럼프', '공습')], SIZE)

    const inRegions = new Set(regions.flatMap((r) => r.words))
    expect(inRegions).toEqual(new Set(['트럼프', '공습']))
  })

  it('아무것도 이어지지 않은 날에는 구역이 없다', () => {
    const words = ['폭염', '코스피'].map((w) => word(w))
    expect(computeGraphLayout(words, [], SIZE).regions).toEqual([])
  })

  it('별 모양 사건은 허브를 가운데 두고 두른다', () => {
    // 최대 차수가 멤버−1이면 진짜 별이고, 바큇살로 놓으면 교차가 원천적으로 없다.
    const words = ['허브', '가', '나', '다', '라'].map((w) => word(w))
    const { nodes } = computeGraphLayout(
      words,
      ['가', '나', '다', '라'].map((leaf) => edge('허브', leaf)),
      SIZE,
    )

    const hub = find(nodes, '허브')
    const spokes = ['가', '나', '다', '라'].map((w) => distance(hub, find(nodes, w)))
    // 한 반지름 위에 있다.
    expect(Math.max(...spokes) - Math.min(...spokes)).toBeLessThan(1)
  })
})

describe('nextLayoutWidth', () => {
  // 레이아웃 한 번은 루뱅 분할 + 300틱 + 엣지마다 도는 곡선 탐색이고, 그것이
  // 렌더 경로 안에서 동기로 돈다. 창 가장자리를 끄는 동안 프레임마다 한 번씩
  // 도는 것을 막는 문턱이다.
  it('움직임이 문턱보다 작으면 다시 그리지 않는다', () => {
    expect(nextLayoutWidth(800, 803)).toBeNull()
    expect(nextLayoutWidth(800, 797)).toBeNull()
  })

  it('문턱 이상 움직이면 채택할 폭을 돌려준다', () => {
    expect(nextLayoutWidth(800, 808)).toBe(808)
    expect(nextLayoutWidth(800, 792)).toBe(792)
  })

  it('소수점 폭은 반올림해서 채택한다', () => {
    // contentRect는 소수를 준다. 그대로 두면 같은 폭이 780.0001과 780.0002로
    // 갈려 캐시도 문턱도 새어 나간다.
    expect(nextLayoutWidth(800, 811.4)).toBe(811)
  })

  it('0 이하는 무시한다', () => {
    // 숨겨진 컨테이너의 ResizeObserver가 0을 보고한다. 그 폭으로 레이아웃을
    // 돌리면 라벨이 전부 한 점에 쌓인다.
    expect(nextLayoutWidth(800, 0)).toBeNull()
    expect(nextLayoutWidth(800, -5)).toBeNull()
  })
})
