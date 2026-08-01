import { describe, expect, it } from 'vitest'
import { computeGraphLayout, convexHull, seededRandom } from './graphLayout'
import type { EdgeSegment, MeasuredWord, PlacedNode } from './graphLayout'
import type { GraphEdge } from '../lib/types'

const SIZE = { width: 800, height: 500 }

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

// Samples the segment rather than solving it: the routing already uses the slab
// method, so checking it with the same arithmetic would only prove the code
// agrees with itself. A tolerance of one pixel keeps rounding out of it.
function crossesBox(segment: EdgeSegment, box: PlacedNode): boolean {
  const steps = 200
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = segment.x1 + (segment.x2 - segment.x1) * t
    const y = segment.y1 + (segment.y2 - segment.y1) * t
    if (
      Math.abs(x - box.x) < box.halfWidth - 1 &&
      Math.abs(y - box.y) < box.halfHeight - 1
    ) {
      return true
    }
  }
  return false
}

// Winding-agnostic point-in-polygon, so it cannot pass merely because it shares
// the hull's orientation convention.
function insideHull(p: { x: number; y: number }, hull: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
    const a = hull[i]
    const b = hull[j]
    const straddles = a.y > p.y !== b.y > p.y
    if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

describe('convexHull', () => {
  it('keeps only the corners of a filled square', () => {
    const points = []
    for (let x = 0; x <= 2; x++) for (let y = 0; y <= 2; y++) points.push({ x, y })

    const hull = convexHull(points)

    expect(hull).toHaveLength(4)
    // The midpoints of each side are collinear and must not survive, or the
    // rendered polygon carries zero-length edges.
    expect(hull.some((p) => p.x === 1 && p.y === 0)).toBe(false)
  })

  it('returns the input for fewer than three points', () => {
    expect(convexHull([{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }])
  })
})

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

describe('computeGraphLayout', () => {
  it('returns nothing for no words', () => {
    expect(computeGraphLayout([], [edge('가', '나')], SIZE)).toEqual({
      nodes: [],
      edges: [],
      clusters: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    })
  })

  it('crops the bounds to the labels rather than to the canvas', () => {
    // The viewport is cropped to this box, which is what stops a category with
    // eight words from rendering as a clump adrift in a full-size frame.
    const words = ['폭염', '양산', '코스피'].map((w) => word(w))
    const { nodes, bounds } = computeGraphLayout(words, [], SIZE)

    expect(bounds.width).toBeLessThan(SIZE.width)
    expect(bounds.height).toBeLessThan(SIZE.height)

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

  it('keeps every label inside the canvas', () => {
    const words = Array.from({ length: 40 }, (_, i) => word(`단어${i}`, 14 + (i % 5) * 10))
    const { nodes } = computeGraphLayout(words, [], SIZE)

    for (const node of nodes) {
      expect(node.x - node.halfWidth).toBeGreaterThanOrEqual(0)
      expect(node.x + node.halfWidth).toBeLessThanOrEqual(SIZE.width)
      expect(node.y - node.halfHeight).toBeGreaterThanOrEqual(0)
      expect(node.y + node.halfHeight).toBeLessThanOrEqual(SIZE.height)
    }
  })

  it('centres a label too wide for the canvas instead of inverting the clamp', () => {
    const { nodes } = computeGraphLayout([word('아주긴단어입니다', 60)], [], {
      width: 200,
      height: 200,
    })
    expect(nodes[0].x).toBe(100)
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

  it('pulls a linked pair closer than an unlinked one', () => {
    const words = ['가가', '나나', '다다', '라라'].map((w) => word(w))
    const { nodes } = computeGraphLayout(words, [edge('가가', '나나', 0.9)], SIZE)

    const linked = distance(find(nodes, '가가'), find(nodes, '나나'))
    const unlinked = distance(find(nodes, '다다'), find(nodes, '라라'))

    expect(linked).toBeLessThan(unlinked)
  })

  it('gives edge endpoints the coordinates of the nodes they join', () => {
    const words = ['폭염', '양산'].map((w) => word(w))
    const { nodes, edges } = computeGraphLayout(words, [edge('폭염', '양산')], SIZE)

    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ a: '폭염', b: '양산', cooc: 3, npmi: 0.8 })
    expect([edges[0].x1, edges[0].y1]).toEqual([find(nodes, '폭염').x, find(nodes, '폭염').y])
    expect([edges[0].x2, edges[0].y2]).toEqual([find(nodes, '양산').x, find(nodes, '양산').y])
  })

  it('keeps every drawn segment clear of every label box', () => {
    // The property the routing exists for: no piece of any line overlaps any
    // word, including the two words the line connects.
    const words = ['폭염', '양산', '코스피', '트럼프', '국힘', '하이닉스'].map((w) => word(w, 28))
    const { nodes, edges } = computeGraphLayout(
      words,
      [edge('폭염', '하이닉스', 0.9), edge('코스피', '국힘', 0.5), edge('양산', '트럼프', 0.7)],
      SIZE,
    )

    expect(edges.flatMap((e) => e.segments).length).toBeGreaterThan(0)

    for (const segment of edges.flatMap((e) => e.segments)) {
      for (const node of nodes) {
        expect(crossesBox(segment, node)).toBe(false)
      }
    }
  })

  it('leaves a gap at both ends rather than starting inside the label', () => {
    const words = ['폭염', '양산'].map((w) => word(w, 30))
    const { nodes, edges } = computeGraphLayout(words, [edge('폭염', '양산')], SIZE)

    const [segment] = edges[0].segments
    const a = find(nodes, '폭염')
    const b = find(nodes, '양산')

    // The drawn piece is strictly shorter than centre-to-centre.
    const drawn = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1)
    expect(drawn).toBeLessThan(distance(a, b))
    expect(drawn).toBeGreaterThan(0)
  })

  it('drops an edge entirely when a label swallows it', () => {
    // Two words close enough that nothing survives between them: better to draw
    // no line than a two-pixel speck.
    const words = [word('가가', 60), word('나나', 60)]
    const { edges } = computeGraphLayout(words, [edge('가가', '나나')], {
      width: 120,
      height: 90,
    })
    expect(edges[0].segments).toEqual([])
  })

  it('drops an edge whose endpoint was never placed', () => {
    // d3's forceLink throws on an unresolvable endpoint, so one stray word in
    // the edge list would otherwise take the whole graph down.
    const { edges } = computeGraphLayout([word('폭염')], [edge('폭염', '없는단어')], SIZE)
    expect(edges).toEqual([])
  })

  it('groups connected words into one cluster and leaves loners out', () => {
    const words = ['트럼프', '공습', '이스라엘', '코스피', '폭염'].map((w) => word(w))
    const { clusters } = computeGraphLayout(
      words,
      [edge('트럼프', '공습'), edge('공습', '이스라엘')],
      SIZE,
    )

    expect(clusters).toHaveLength(1)
    expect([...clusters[0].words].sort()).toEqual(['공습', '이스라엘', '트럼프'])
  })

  it('joins two words linked only through a third', () => {
    // Union-find, not adjacency: 트럼프 and 이스라엘 share no edge of their own.
    const words = ['트럼프', '공습', '이스라엘'].map((w) => word(w))
    const { clusters } = computeGraphLayout(
      words,
      [edge('트럼프', '공습'), edge('공습', '이스라엘')],
      SIZE,
    )
    expect(clusters[0].words).toHaveLength(3)
  })

  it('splits two dense groups joined by a single bridge', () => {
    // The case connected components get wrong, and the reason clustering is
    // modularity-based. On the all-categories view a chain of shared words ran
    // four unrelated stories together into one nine-word "cluster".
    const words = ['가1', '가2', '가3', '나1', '나2', '나3'].map((w) => word(w))
    const { clusters } = computeGraphLayout(
      words,
      [
        edge('가1', '가2', 0.9),
        edge('가2', '가3', 0.9),
        edge('가3', '가1', 0.9),
        edge('나1', '나2', 0.9),
        edge('나2', '나3', 0.9),
        edge('나3', '나1', 0.9),
        // The bridge. Everything is one connected component because of it.
        edge('가1', '나1', 0.35),
      ],
      SIZE,
    )

    expect(clusters).toHaveLength(2)
    for (const cluster of clusters) {
      const prefixes = new Set(cluster.words.map((w) => w[0]))
      expect(prefixes.size).toBe(1)
    }
  })

  it('ranks the day’s biggest story first by headline count', () => {
    const words: MeasuredWord[] = [
      { ...word('트럼프'), count: 40 },
      { ...word('공습'), count: 53 },
      { ...word('최태원'), count: 12 },
      { ...word('노소영'), count: 7 },
    ]
    const { clusters } = computeGraphLayout(
      words,
      [edge('트럼프', '공습'), edge('최태원', '노소영')],
      SIZE,
    )

    expect(clusters.map((c) => c.headlines)).toEqual([93, 19])
    expect([...clusters[0].words].sort()).toEqual(['공습', '트럼프'])
  })

  it('wraps its members in a hull that contains their label boxes', () => {
    const words = ['트럼프', '공습'].map((w) => word(w))
    const { nodes, clusters } = computeGraphLayout(words, [edge('트럼프', '공습')], SIZE)

    const hull = clusters[0].hull
    expect(hull.length).toBeGreaterThanOrEqual(3)

    for (const node of nodes) {
      for (const corner of [
        { x: node.x - node.halfWidth, y: node.y - node.halfHeight },
        { x: node.x + node.halfWidth, y: node.y + node.halfHeight },
      ]) {
        expect(insideHull(corner, hull)).toBe(true)
      }
    }
  })

  it('reports no clusters when nothing is connected', () => {
    const words = ['폭염', '코스피'].map((w) => word(w))
    expect(computeGraphLayout(words, [], SIZE).clusters).toEqual([])
  })

  it('shades only the biggest clusters', () => {
    // Shading all 26 communities of an all-categories day tints most of the
    // canvas, and the shading stops carrying information.
    const words: MeasuredWord[] = []
    const edges: GraphEdge[] = []
    for (let i = 0; i < 8; i++) {
      words.push({ ...word(`가${i}`), count: 10 - i }, { ...word(`나${i}`), count: 10 - i })
      edges.push(edge(`가${i}`, `나${i}`, 0.9))
    }

    const { clusters } = computeGraphLayout(words, edges, { ...SIZE, clusterLimit: 3 })

    expect(clusters).toHaveLength(3)
    // Kept the biggest three, not the first three encountered.
    expect(clusters.map((c) => c.headlines)).toEqual([20, 18, 16])
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
