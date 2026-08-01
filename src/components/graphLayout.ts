import { forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import type { GraphEdge } from '../lib/types'

// Everything in this file is arithmetic, deliberately separated from
// KeywordGraph.tsx so it can be tested under jsdom. The one thing jsdom cannot
// do is measure text — canvas is unimplemented — so measured widths arrive as
// arguments. Same split as wordCloudLayout.ts.

export interface MeasuredWord {
  word: string
  count: number
  fontSize: number
  /** Width of the rendered label in px, measured by the caller. */
  textWidth: number
  faded: boolean
}

export interface PlacedNode extends MeasuredWord {
  x: number
  y: number
  halfWidth: number
  halfHeight: number
}

export interface PlacedEdge extends GraphEdge {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface GraphLayout {
  nodes: PlacedNode[]
  edges: PlacedEdge[]
  /** Tight box around the drawn labels, for cropping the viewport to them. */
  bounds: { x: number; y: number; width: number; height: number }
}

export interface LayoutOptions {
  width: number
  height: number
  /** Simulation steps run synchronously before the first paint. */
  ticks?: number
  seed?: number
  /** Gap kept between two label boxes. */
  padding?: number
}

const DEFAULT_TICKS = 300
const DEFAULT_SEED = 0x5eed
const DEFAULT_PADDING = 6

interface LayoutNode extends SimulationNodeDatum, MeasuredWord {
  halfWidth: number
  halfHeight: number
}

type LayoutLink = SimulationLinkDatum<LayoutNode> & GraphEdge

// mulberry32, wired into the simulation below.
//
// This does not make the layout deterministic — it already is. Initial
// positions are seeded below, and d3's random source is reached only to jiggle
// two nodes that occupy the exact same point, by
// +/-5e-7. Passing a source of our own pins that behaviour to this file rather
// than to a d3 internal, so a change there cannot quietly start moving the
// graph between reloads and flaking the e2e suite.
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// d3's own forceCollide is circular, and a circle around a wide label wastes
// most of its area: 반도체 at 40px is roughly 120x40, so a bounding circle is
// three times taller than the text. Words end up floating in gaps. This is the
// rectangular equivalent — separate along whichever axis overlaps least, which
// is the minimum translation that resolves the collision.
function rectCollide(padding: number, strength: number) {
  let nodes: LayoutNode[] = []

  // Quadratic, but render_cap holds the node count at 130, so this is ~8k pairs
  // per tick and finishes well inside a frame budget for a one-off layout.
  function force() {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]
        const dx = (b.x ?? 0) - (a.x ?? 0)
        const overlapX = a.halfWidth + b.halfWidth + padding - Math.abs(dx)
        if (overlapX <= 0) continue

        const dy = (b.y ?? 0) - (a.y ?? 0)
        const overlapY = a.halfHeight + b.halfHeight + padding - Math.abs(dy)
        if (overlapY <= 0) continue

        if (overlapX < overlapY) {
          // dx of exactly 0 pushes b right and a left rather than picking a
          // direction at random, so two identical positions still resolve.
          const push = (dx < 0 ? -overlapX : overlapX) * 0.5 * strength
          a.vx = (a.vx ?? 0) - push
          b.vx = (b.vx ?? 0) + push
        } else {
          const push = (dy < 0 ? -overlapY : overlapY) * 0.5 * strength
          a.vy = (a.vy ?? 0) - push
          b.vy = (b.vy ?? 0) + push
        }
      }
    }
  }

  force.initialize = (n: LayoutNode[]) => {
    nodes = n
  }

  return force
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

// d3-force lays out any node without an x/y on a phyllotaxis spiral centred on
// the origin — the top-left corner of the canvas — and expects the centring
// forces to carry it in from there. At the force strengths this layout needs,
// 300 ticks is not enough to travel half a canvas, so a graph of eight words
// settled in a clump up and to the left of centre with the rest of the frame
// empty. Seeding the same spiral, centred and scaled to the frame, fixes the
// drift and starts the simulation somewhere already plausible.
//
// sqrt of the index is what makes the points evenly dense rather than bunched
// in the middle, and the count normalises it so eight words spread as widely as
// a hundred do.
function initialPosition(
  index: number,
  total: number,
  width: number,
  height: number,
  padding: number,
): { x: number; y: number; vx: number; vy: number } {
  const t = Math.sqrt((index + 0.5) / total)
  const angle = index * GOLDEN_ANGLE
  return {
    x: width / 2 + t * Math.max(0, width / 2 - padding) * Math.cos(angle),
    y: height / 2 + t * Math.max(0, height / 2 - padding) * Math.sin(angle),
    vx: 0,
    vy: 0,
  }
}

export function computeGraphLayout(
  words: MeasuredWord[],
  edges: GraphEdge[],
  options: LayoutOptions,
): GraphLayout {
  if (words.length === 0) {
    return { nodes: [], edges: [], bounds: { x: 0, y: 0, width: 0, height: 0 } }
  }

  const {
    width,
    height,
    ticks = DEFAULT_TICKS,
    seed = DEFAULT_SEED,
    padding = DEFAULT_PADDING,
  } = options

  const nodes: LayoutNode[] = words.map((w, i) => ({
    ...w,
    halfWidth: w.textWidth / 2,
    halfHeight: w.fontSize / 2,
    ...initialPosition(i, words.length, width, height, padding),
  }))

  const byWord = new Map(nodes.map((n) => [n.word, n]))

  // The RPC only emits edges between rendered nodes, but the layout must not
  // depend on that: d3's forceLink throws on an unresolvable endpoint, which
  // would take the whole graph down over one stray word.
  const links: LayoutLink[] = edges
    .filter((e) => byWord.has(e.a) && byWord.has(e.b))
    .map((e) => ({ ...e, source: e.a, target: e.b }))

  const simulation = forceSimulation(nodes)
    .randomSource(seededRandom(seed))
    .force(
      'link',
      forceLink<LayoutNode, LayoutLink>(links)
        .id((n) => n.word)
        // Strongly associated words sit closer, which is the whole point of
        // drawing edges at all; the size term keeps big labels from being
        // pulled on top of each other.
        .distance((l) => {
          const a = l.source as LayoutNode
          const b = l.target as LayoutNode
          return (a.halfWidth + b.halfWidth + 24) * (1.3 - 0.5 * clamp01(l.npmi))
        })
        .strength((l) => 0.15 + 0.55 * clamp01(l.npmi)),
    )
    // Bigger words claim more room. distanceMax keeps repulsion local so the
    // isolated majority spreads out instead of being blown to the margins.
    .force(
      'charge',
      forceManyBody<LayoutNode>()
        .strength((n) => -35 - n.halfWidth * 2.0)
        // Capping the range matters more than the strength does. Let repulsion
        // act across the whole canvas and the outermost words are pushed into
        // the bounds clamp, where they pile up into a column stuck to the wall.
        .distanceMax(Math.max(width, height) / 2),
    )
    .force('collide', rectCollide(padding, 0.8))
    // Weaker across the long axis, or the graph settles into a circular blob in
    // the middle of a wide canvas and leaves the sides empty.
    .force('x', forceX<LayoutNode>(width / 2).strength(0.03))
    .force('y', forceY<LayoutNode>(height / 2).strength(0.065))

  // Run the whole thing synchronously and paint once. An animated settle looks
  // busy on a page whose point is to be read, and a fixed tick count is what
  // makes the same day render the same picture twice.
  simulation.stop()
  simulation.alpha(1).alphaDecay(1 - Math.pow(0.001, 1 / ticks))

  for (let i = 0; i < ticks; i++) {
    simulation.tick()
    clampToBounds(nodes, width, height, padding)
  }

  const placed: PlacedNode[] = nodes.map((n) => ({
    word: n.word,
    count: n.count,
    fontSize: n.fontSize,
    textWidth: n.textWidth,
    faded: n.faded,
    halfWidth: n.halfWidth,
    halfHeight: n.halfHeight,
    x: round(n.x ?? 0),
    y: round(n.y ?? 0),
  }))

  const placedByWord = new Map(placed.map((n) => [n.word, n]))

  return {
    nodes: placed,
    edges: links.map((l) => {
      const a = placedByWord.get(l.a)!
      const b = placedByWord.get(l.b)!
      return { a: l.a, b: l.b, cooc: l.cooc, npmi: l.npmi, x1: a.x, y1: a.y, x2: b.x, y2: b.y }
    }),
    bounds: boundingBox(placed, padding),
  }
}

// Few words cannot generate enough mutual repulsion to resist the centring
// forces, so a category with eight of them settles into a clump adrift in an
// otherwise empty frame. Rather than tune the forces per node count — which
// trades one bad case for another — the caller crops the viewport to whatever
// was actually drawn.
function boundingBox(nodes: PlacedNode[], padding: number) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.halfWidth)
    minY = Math.min(minY, n.y - n.halfHeight)
    maxX = Math.max(maxX, n.x + n.halfWidth)
    maxY = Math.max(maxY, n.y + n.halfHeight)
  }

  return {
    x: round(minX - padding),
    y: round(minY - padding),
    width: round(maxX - minX + padding * 2),
    height: round(maxY - minY + padding * 2),
  }
}

// A label wider than the canvas cannot be kept inside it; centring it is the
// least bad outcome, and beats Math.min/Math.max silently inverting the range.
function clampToBounds(nodes: LayoutNode[], width: number, height: number, padding: number): void {
  for (const n of nodes) {
    const marginX = n.halfWidth + padding
    const marginY = n.halfHeight + padding
    n.x = marginX * 2 > width ? width / 2 : clamp(n.x ?? 0, marginX, width - marginX)
    n.y = marginY * 2 > height ? height / 2 : clamp(n.y ?? 0, marginY, height - marginY)
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

// Two decimals is well below a device pixel and keeps the emitted SVG stable
// enough to diff.
function round(value: number): number {
  return Math.round(value * 100) / 100
}
