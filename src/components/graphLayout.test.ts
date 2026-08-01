import { describe, expect, it } from 'vitest'
import { computeGraphLayout, seededRandom } from './graphLayout'
import type { MeasuredWord, PlacedNode } from './graphLayout'
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
