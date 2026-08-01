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

export interface EdgeSegment {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface PlacedEdge extends GraphEdge {
  /** Centre to centre, before the label boxes are cut out of it. */
  x1: number
  y1: number
  x2: number
  y2: number
  /** The parts of that line that fall outside every label. Draw these. */
  segments: EdgeSegment[]
}

/** A connected component of the drawn graph: one event, in practice. */
export interface PlacedCluster {
  words: string[]
  /** Total headlines across the member words, which is how clusters rank. */
  headlines: number
  /** Convex hull of the member label boxes, for a background blob. */
  hull: { x: number; y: number }[]
}

export interface GraphLayout {
  nodes: PlacedNode[]
  edges: PlacedEdge[]
  /** Biggest first, so the day's top story is clusters[0]. Singletons omitted. */
  clusters: PlacedCluster[]
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
  /** How many of the biggest clusters get a shaded blob. */
  clusterLimit?: number
}

const DEFAULT_TICKS = 300
const DEFAULT_SEED = 0x5eed
// Labels rest this far apart. It has to leave more room than the edge routing
// consumes — a clearance either side plus a minimum drawable length — or two
// clustered words end up close enough that the whole line between them is cut
// away and the edge silently disappears.
const DEFAULT_PADDING = 12

// A rendered label is taller than its font size: getBBox on the drawn <text>
// reports about 1.2em for Hangul in a sans-serif, since the box spans ascender
// to descender. Treating the em box as the collision height left neighbouring
// rows grazing each other by a pixel — measured at 1px on the 정치 and IT tabs.
const LINE_HEIGHT = 1.2

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
    return {
      nodes: [],
      edges: [],
      clusters: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    }
  }

  const {
    width,
    height,
    ticks = DEFAULT_TICKS,
    seed = DEFAULT_SEED,
    padding = DEFAULT_PADDING,
    clusterLimit = DEFAULT_CLUSTER_LIMIT,
  } = options

  const nodes: LayoutNode[] = words.map((w, i) => ({
    ...w,
    halfWidth: w.textWidth / 2,
    halfHeight: (w.fontSize * LINE_HEIGHT) / 2,
    ...initialPosition(i, words.length, width, height, padding),
  }))

  const byWord = new Map(nodes.map((n) => [n.word, n]))

  // The RPC only emits edges between rendered nodes, but the layout must not
  // depend on that: d3's forceLink throws on an unresolvable endpoint, which
  // would take the whole graph down over one stray word.
  const links: LayoutLink[] = edges
    .filter((e) => byWord.has(e.a) && byWord.has(e.b))
    .map((e) => ({ ...e, source: e.a, target: e.b }))

  // Communities come from the edge topology alone, so they can be found before
  // anything is positioned — which is what lets the layout hold each event
  // together rather than discovering the grouping after the fact.
  const communities = detectCommunities(words, links)

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
    // Bounded on purpose, and the bound is the edges rather than the eye. Too
    // strong and a cluster's words are dragged into contact, the label clearance
    // consumes the whole line between them, and the graph silently loses the
    // edges that justify the grouping — 0.35 against a padding of 6 removed half
    // the lines on screen. Too weak and the members scatter, so the hull drawn
    // round them swallows unrelated words.
    .force('cluster', clusterCohesion(communities, 0.25))
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

  const placedEdges: PlacedEdge[] = links.map((l) => {
    const a = placedByWord.get(l.a)!
    const b = placedByWord.get(l.b)!
    return {
      a: l.a,
      b: l.b,
      cooc: l.cooc,
      npmi: l.npmi,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      segments: routeAroundLabels(a, b, placed),
    }
  })

  const clusters = findClusters(placed, communities).slice(0, clusterLimit)

  return {
    nodes: placed,
    edges: placedEdges,
    clusters,
    bounds: boundingBox(placed, clusters, padding),
  }
}

// Holds each event's words together on the canvas. Without it the layout knows
// only about individual edges, so a cluster's members end up scattered with
// unrelated words between them — and then the hull drawn around them swallows
// those strangers and the blobs pile up on each other. Pulling members toward
// their own centroid is what turns the partition into something visible.
function clusterCohesion(communities: Map<string, number>, strength: number) {
  let nodes: LayoutNode[] = []
  let sized = new Set<number>()

  function force(alpha: number) {
    const sums = new Map<number, { x: number; y: number; n: number }>()
    for (const n of nodes) {
      const id = communities.get(n.word)
      if (id === undefined || !sized.has(id)) continue
      const acc = sums.get(id) ?? { x: 0, y: 0, n: 0 }
      acc.x += n.x ?? 0
      acc.y += n.y ?? 0
      acc.n += 1
      sums.set(id, acc)
    }

    for (const n of nodes) {
      const id = communities.get(n.word)
      if (id === undefined) continue
      const acc = sums.get(id)
      if (!acc) continue
      n.vx = (n.vx ?? 0) + (acc.x / acc.n - (n.x ?? 0)) * strength * alpha
      n.vy = (n.vy ?? 0) + (acc.y / acc.n - (n.y ?? 0)) * strength * alpha
    }
  }

  force.initialize = (n: LayoutNode[]) => {
    nodes = n
    // A word alone in its community has no one to be pulled toward, and
    // including it would only add a no-op centroid at its own position.
    const counts = new Map<number, number>()
    for (const node of nodes) {
      const id = communities.get(node.word)
      if (id === undefined) continue
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    sized = new Set([...counts].filter(([, c]) => c > 1).map(([id]) => id))
  }

  return force
}

// Gap left between a line and the label it passes. Also what pulls an edge back
// off its own endpoints, since a node's centre is inside its own box.
const LABEL_CLEARANCE = 4
// Below this a surviving piece of line is a speck rather than a connection.
const MIN_SEGMENT = 3

// An edge is drawn centre to centre, which means it runs under both its endpoint
// labels and under anything it happens to cross on the way. Rather than draw it
// and rely on the text painting over the top, cut every label box out of the
// line and keep what is left. The endpoints get trimmed by the same pass that
// handles pass-throughs, so there is no special case for them.
function routeAroundLabels(
  from: PlacedNode,
  to: PlacedNode,
  nodes: PlacedNode[],
): EdgeSegment[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return []

  const blocked: [number, number][] = []
  for (const n of nodes) {
    const span = boxSpan(from.x, from.y, dx, dy, n)
    if (span) blocked.push(span)
  }

  const length = Math.hypot(dx, dy)
  const segments: EdgeSegment[] = []

  for (const [t0, t1] of freeIntervals(blocked)) {
    if ((t1 - t0) * length < MIN_SEGMENT) continue
    segments.push({
      x1: round(from.x + dx * t0),
      y1: round(from.y + dy * t0),
      x2: round(from.x + dx * t1),
      y2: round(from.y + dy * t1),
    })
  }

  return segments
}

// Where the ray enters and leaves one label's box, as a fraction of the edge.
// The slab method: clip the parameter range against each axis in turn and see
// whether anything survives.
function boxSpan(
  x: number,
  y: number,
  dx: number,
  dy: number,
  box: PlacedNode,
): [number, number] | null {
  let t0 = 0
  let t1 = 1

  const minX = box.x - box.halfWidth - LABEL_CLEARANCE
  const maxX = box.x + box.halfWidth + LABEL_CLEARANCE
  const minY = box.y - box.halfHeight - LABEL_CLEARANCE
  const maxY = box.y + box.halfHeight + LABEL_CLEARANCE

  // A ray parallel to an axis either sits inside that slab for its whole length
  // or misses the box entirely; dividing by zero would say neither.
  if (dx === 0) {
    if (x < minX || x > maxX) return null
  } else {
    const a = (minX - x) / dx
    const b = (maxX - x) / dx
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }

  if (dy === 0) {
    if (y < minY || y > maxY) return null
  } else {
    const a = (minY - y) / dy
    const b = (maxY - y) / dy
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }

  return t0 < t1 ? [t0, t1] : null
}

// Complement of the blocked spans within [0, 1], merging overlaps first.
function freeIntervals(blocked: [number, number][]): [number, number][] {
  if (blocked.length === 0) return [[0, 1]]

  const sorted = [...blocked].sort((a, b) => a[0] - b[0])
  const free: [number, number][] = []
  let cursor = 0

  for (const [start, end] of sorted) {
    if (start > cursor) free.push([cursor, start])
    cursor = Math.max(cursor, end)
    if (cursor >= 1) break
  }
  if (cursor < 1) free.push([cursor, 1])

  return free
}

// How far the shaded blob sits outside the labels it wraps.
const CLUSTER_PADDING = 14
// Width of the stroke that rounds the hull's corners. Drawn in the same colour
// as the fill, so it reads as one soft shape rather than as a polygon; half of
// it spills outside the hull, which the bounding box has to allow for.
export const CLUSTER_ROUNDING = 28
// The all-categories view of 2026-08-01 splits into 26 communities. Shading all
// of them tints most of the canvas and the shading stops meaning anything, so
// only the day's biggest stories get a blob; the rest are still grouped by the
// layout, just not outlined.
const DEFAULT_CLUSTER_LIMIT = 6

// Connected components are not enough, which is worth stating because they look
// like they would be. On a category tab they give clean events, but on the
// all-categories view the day's 130 words and 85 edges chain through shared
// words: 대통령 links to 한동훈 links to 민주당 links to 레버리지 links to
// 곽상언, and one "cluster" swallowed nine words spanning four unrelated
// stories. Any threshold that breaks that chain also disconnects the real
// clusters, because the problem is topological rather than one of edge strength.
//
// So this is modularity — Louvain's first phase, run to convergence — which is
// what the plan reserved clustering coefficient and chi-squared for. Both of
// those measure "which event does this word belong to" for a single word;
// modularity answers the same question for the partition as a whole, and cuts
// the chain at the words that bridge two dense neighbourhoods.
//
// Clusters rank on total headline count rather than on chi-squared. Chi-squared
// was rejected as a word score precisely because the day's biggest event
// dominates it, which for ranking events is the wanted behaviour rather than a
// fault — but headline count measures that directly and needs no second
// statistic shipped from the database.
function findClusters(
  nodes: PlacedNode[],
  communities: Map<string, number>,
): PlacedCluster[] {
  const members = new Map<number, PlacedNode[]>()
  for (const n of nodes) {
    const id = communities.get(n.word)
    if (id === undefined) continue
    const group = members.get(id)
    if (group) group.push(n)
    else members.set(id, [n])
  }

  const clusters: PlacedCluster[] = []
  for (const group of members.values()) {
    // A word joined to nothing is not an event.
    if (group.length < 2) continue

    const corners: { x: number; y: number }[] = []
    for (const n of group) {
      const left = n.x - n.halfWidth - CLUSTER_PADDING
      const right = n.x + n.halfWidth + CLUSTER_PADDING
      const top = n.y - n.halfHeight - CLUSTER_PADDING
      const bottom = n.y + n.halfHeight + CLUSTER_PADDING
      corners.push({ x: left, y: top }, { x: right, y: top })
      corners.push({ x: right, y: bottom }, { x: left, y: bottom })
    }

    clusters.push({
      words: group.map((n) => n.word),
      headlines: group.reduce((sum, n) => sum + n.count, 0),
      hull: convexHull(corners),
    })
  }

  // Biggest story first. Ties break on the first word so a rerun of the same day
  // marks the same cluster.
  return clusters.sort(
    (a, b) => b.headlines - a.headlines || a.words[0].localeCompare(b.words[0]),
  )
}

// Louvain's local-moving phase (Blondel et al. 2008), iterated until no word
// changes community. The aggregation phase is skipped: a day tops out around 130
// words and 150 edges, and on graphs that small the first phase already
// converges to the same partition.
//
// Every node starts alone. Each pass offers each word to the community of each
// neighbour and keeps the move with the largest modularity gain, which for a
// single node reduces to maximising
//
//     (weight from the word into that community) - (community degree * word degree) / 2m
//
// The subtracted term is what stops a hub joining everything it touches: a
// community that is already large has to earn a new member with proportionally
// stronger ties.
//
// Deterministic throughout — words are visited in the order they were drawn,
// which is frequency order, and ties go to the lowest community id.
function detectCommunities(
  nodes: { word: string }[],
  edges: GraphEdge[],
): Map<string, number> {
  const index = new Map<string, number>()
  nodes.forEach((n, i) => index.set(n.word, i))

  const neighbours: { node: number; weight: number }[][] = nodes.map(() => [])
  const degree = new Array(nodes.length).fill(0)
  let totalWeight = 0

  for (const e of edges) {
    const a = index.get(e.a)
    const b = index.get(e.b)
    if (a === undefined || b === undefined || a === b) continue
    // NPMI can in principle be negative; a non-positive weight would make the
    // gain arithmetic meaningless, so the floor keeps every drawn edge a real
    // pull of some size.
    const weight = Math.max(0.01, e.npmi)
    neighbours[a].push({ node: b, weight })
    neighbours[b].push({ node: a, weight })
    degree[a] += weight
    degree[b] += weight
    totalWeight += weight
  }

  const community = nodes.map((_, i) => i)
  const communityDegree = [...degree]
  if (totalWeight === 0) return new Map(nodes.map((n, i) => [n.word, i]))

  const twoM = 2 * totalWeight

  // Converges in a handful of passes at this size; the cap only guarantees
  // termination if two moves ever trade places.
  for (let pass = 0; pass < 20; pass++) {
    let moved = false

    for (let i = 0; i < nodes.length; i++) {
      if (neighbours[i].length === 0) continue

      const from = community[i]
      communityDegree[from] -= degree[i]

      const weightTo = new Map<number, number>()
      weightTo.set(from, 0)
      for (const { node, weight } of neighbours[i]) {
        weightTo.set(community[node], (weightTo.get(community[node]) ?? 0) + weight)
      }

      let best = from
      let bestGain = -Infinity
      for (const [candidate, weight] of weightTo) {
        const gain = weight - (communityDegree[candidate] * degree[i]) / twoM
        if (gain > bestGain || (gain === bestGain && candidate < best)) {
          bestGain = gain
          best = candidate
        }
      }

      communityDegree[best] += degree[i]
      if (best !== from) {
        community[i] = best
        moved = true
      }
    }

    if (!moved) break
  }

  return new Map(nodes.map((n, i) => [n.word, community[i]]))
}

// Andrew's monotone chain. Returns the hull counter-clockwise; collinear points
// are dropped, which keeps the rendered polygon free of zero-length edges.
export function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length < 3) return [...points]

  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const half = (input: { x: number; y: number }[]) => {
    const out: { x: number; y: number }[] = []
    for (const p of input) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) {
        out.pop()
      }
      out.push(p)
    }
    out.pop()
    return out
  }

  return [...half(sorted), ...half([...sorted].reverse())]
}

// Few words cannot generate enough mutual repulsion to resist the centring
// forces, so a category with eight of them settles into a clump adrift in an
// otherwise empty frame. Rather than tune the forces per node count — which
// trades one bad case for another — the caller crops the viewport to whatever
// was actually drawn.
function boundingBox(nodes: PlacedNode[], clusters: PlacedCluster[], padding: number) {
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

  // Cluster blobs reach further out than the words they wrap — CLUSTER_PADDING
  // to the hull, then half the rounding stroke beyond that — and cropping to the
  // labels alone would shave their edges off.
  const reach = CLUSTER_ROUNDING / 2
  for (const c of clusters) {
    for (const p of c.hull) {
      minX = Math.min(minX, p.x - reach)
      minY = Math.min(minY, p.y - reach)
      maxX = Math.max(maxX, p.x + reach)
      maxY = Math.max(maxY, p.y + reach)
    }
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
